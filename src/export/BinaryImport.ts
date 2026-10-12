// Schema-less reader for the Clyde "export" binary format (BinaryExporter, BSD-2-Clause).
//
// The format writes class names, class flags, field names and field types into the stream,
// so a full object graph can be recovered without having any of the classes that wrote it.
// The only parts that are not self-describing are enums and Encodable types, which write raw
// bytes. Encodables are a small fixed set in Clyde (handled below); enums are recognised by
// a registry of known names plus a structural check that is cached per class.
//
// This is written from the open Clyde sources only. No proprietary code is used or needed.

import registry from "./registry.json";

export const MAGIC = 0xfaceaf0e | 0;
const COMPRESSED = 0x1000;
const FINAL = 1 << 0;
const INNER = 1 << 1;
const COLLECTION = 1 << 2;
const MAP = 1 << 3;
const MULTI = 1 << 4;

/** An Exportable object: its Java class name plus its exported fields. */
export interface JObject {
  $class: string;
  $outer?: unknown;
  [field: string]: unknown;
}

/** An enum constant. */
export interface JEnum {
  $enum: string;
  name: string;
}

/** A Java collection (list/set/multiset). */
export interface JCollection {
  $collection: string;
  items: unknown[];
  counts?: number[];
}

/** A Java map. */
export interface JMap {
  $map: string;
  entries: [unknown, unknown][];
}

export type Inflate = (data: Uint8Array) => Uint8Array | Promise<Uint8Array>;

interface ClassInfo {
  name: string;
  flags: number;
  component?: ClassInfo;
  primitive?: string;
}

const PRIMITIVES = ["boolean", "byte", "char", "double", "float", "int", "long", "short"];

const PRIMITIVE_ARRAY_CODES: Record<string, string> = {
  Z: "boolean", B: "byte", C: "char", D: "double", F: "float", I: "int", J: "long", S: "short",
};

/** Clyde's Encodable classes and their fixed stream layouts. */
const ENCODABLES: Record<string, { fields: string[]; type: "f" | "i" }> = {
  "com.threerings.math.Vector2f": { fields: ["x", "y"], type: "f" },
  "com.threerings.math.Vector3f": { fields: ["x", "y", "z"], type: "f" },
  "com.threerings.math.Vector4f": { fields: ["x", "y", "z", "w"], type: "f" },
  "com.threerings.math.Quaternion": { fields: ["x", "y", "z", "w"], type: "f" },
  "com.threerings.math.SphereCoords": { fields: ["azimuth", "elevation", "distance"], type: "f" },
  "com.threerings.math.Plane": { fields: ["nx", "ny", "nz", "constant"], type: "f" },
  "com.threerings.opengl.renderer.Color4f": { fields: ["r", "g", "b", "a"], type: "f" },
  "com.threerings.tudey.util.Coord": { fields: ["x", "y"], type: "i" },
  "com.threerings.math.Matrix3f": {
    fields: ["m00", "m10", "m20", "m01", "m11", "m21", "m02", "m12", "m22"], type: "f",
  },
  "com.threerings.math.Matrix4f": {
    fields: ["m00", "m10", "m20", "m30", "m01", "m11", "m21", "m31",
      "m02", "m12", "m22", "m32", "m03", "m13", "m23", "m33"], type: "f",
  },
};

const BUFFERS: Record<string, string> = {
  "java.nio.ByteBuffer": "byte", "java.nio.CharBuffer": "char", "java.nio.DoubleBuffer": "double",
  "java.nio.FloatBuffer": "float", "java.nio.IntBuffer": "int", "java.nio.LongBuffer": "long",
  "java.nio.ShortBuffer": "short",
};

const ENUM_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export class ImportError extends Error {}

class Cursor {
  pos = 0;
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  need(n: number) {
    if (this.pos + n > this.bytes.length) {
      throw new ImportError(`Unexpected end of stream at ${this.pos} (need ${n})`);
    }
  }
  u8() { this.need(1); return this.bytes[this.pos++]; }
  i8() { this.need(1); return this.view.getInt8(this.pos++); }
  bool() { return this.u8() !== 0; }
  u16() { this.need(2); const v = this.view.getUint16(this.pos); this.pos += 2; return v; }
  i16() { this.need(2); const v = this.view.getInt16(this.pos); this.pos += 2; return v; }
  i32() { this.need(4); const v = this.view.getInt32(this.pos); this.pos += 4; return v; }
  f32() { this.need(4); const v = this.view.getFloat32(this.pos); this.pos += 4; return v; }
  f64() { this.need(8); const v = this.view.getFloat64(this.pos); this.pos += 8; return v; }
  i64() { this.need(8); const v = this.view.getBigInt64(this.pos); this.pos += 8; return Number(v); }
  varint() {
    let ret = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      const b = this.u8();
      ret += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) return ret;
    }
    throw new ImportError(`Bad varint at ${this.pos}`);
  }
  utf() {
    const len = this.u16();
    this.need(len);
    const s = UTF8.decode(this.bytes.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }
}

const UTF8 = new TextDecoder("utf-8");

/** Enums declared in the open-source libraries, plus any discovered at runtime. */
export const knownEnums = new Set<string>(registry.enums);
/** Non-enum classes declared in the open-source libraries, plus Exportables seen with fields. */
const knownExportables = new Set<string>(registry.classes);

export interface ImportResult {
  root: unknown;
  version: number;
  compressed: boolean;
  /** Every class name seen in the stream. */
  classes: Set<string>;
  /** Bytes left unread after the root object (should be zero). */
  trailing: number;
}

/** Parses the header and returns the (possibly inflated) body bytes. */
export async function readBody(data: Uint8Array, inflate: Inflate) {
  const head = new Cursor(data);
  const magic = head.i32();
  if (magic !== MAGIC) {
    throw new ImportError(`Invalid magic number 0x${(magic >>> 0).toString(16)}`);
  }
  const version = head.u16();
  if (version !== 0x1002 && version !== 0x1001 && version !== 0x1000) {
    throw new ImportError(`Unsupported version 0x${version.toString(16)}`);
  }
  const flags = head.u16();
  const compressed = (flags & COMPRESSED) !== 0;
  const rest = data.subarray(8);
  const body = compressed ? await inflate(rest) : rest;
  return { body, version, compressed };
}

export async function importBinary(data: Uint8Array, inflate: Inflate): Promise<ImportResult> {
  const { body, version, compressed } = await readBody(data, inflate);
  return importBody(body, version, compressed);
}

export function importBody(body: Uint8Array, version = 0x1002, compressed = true,
    trace?: string[]): ImportResult {
  const reader = new Reader(new Cursor(body), version);
  reader.trace = trace;
  const root = reader.readObject();
  return {
    root, version, compressed, classes: reader.classNames,
    trailing: body.length - reader.cursor.pos,
  };
}

/** Id reader matching the three historic BinaryExporter versions. */
class IdReader {
  private highest = 0;
  constructor(private readonly c: Cursor, private readonly version: number) {}
  read(): number {
    if (this.version !== 0x1000) return this.c.varint();
    let id: number;
    if (this.highest < 255) id = this.c.u8();
    else if (this.highest < 65535) id = this.c.u16();
    else id = this.c.i32();
    this.highest = Math.max(this.highest, id);
    return id;
  }
  readLength(): number {
    return this.version === 0x1002 ? this.c.varint() : this.c.i32();
  }
}

interface FieldInfo { name: string; type: ClassInfo }

class Reader {
  readonly classNames = new Set<string>();
  private readonly objects = new Map<number, unknown>([[0, null]]);
  private readonly classes = new Map<number, ClassInfo>();
  private readonly byName = new Map<string, ClassInfo>();
  private readonly classData = new Map<string, { ids: IdReader; fields: Map<number, FieldInfo> }>();
  private readonly objectIds: IdReader;
  private readonly classIds: IdReader;
  private readonly objectClass: ClassInfo;
  private readonly stringClass: ClassInfo;

  constructor(readonly cursor: Cursor, private readonly version: number) {
    PRIMITIVES.forEach((p, i) => {
      const info: ClassInfo = { name: p, flags: FINAL, primitive: p };
      this.byName.set(p, info);
      this.classes.set(i + 1, info);
    });
    this.objectIds = new IdReader(cursor, version);
    this.classIds = new IdReader(cursor, version);
    this.objectClass = this.info("java.lang.Object", 0);
    this.stringClass = this.info("java.lang.String", FINAL);
  }

  readObject(): unknown {
    return this.read(this.objectClass);
  }

  private info(name: string, flags: number): ClassInfo {
    let info = this.byName.get(name);
    if (info) return info;
    if (name.startsWith("[")) {
      const cname = name.substring(1);
      const t = cname.charAt(0);
      let component: ClassInfo;
      if (t === "[") component = this.info(cname, flags);
      else if (t === "L") component = this.info(cname.substring(1, cname.length - 1), flags);
      else component = this.byName.get(PRIMITIVE_ARRAY_CODES[t])!;
      info = { name, flags: FINAL, component };
    } else {
      info = { name, flags };
    }
    this.byName.set(name, info);
    return info;
  }

  private readClass(): ClassInfo {
    const id = this.classIds.read();
    const known = this.classes.get(id);
    if (known) return known;
    const name = this.cursor.utf();
    const flags = this.cursor.i8();
    const info = this.info(name, flags);
    this.classes.set(id, info);
    this.classNames.add(name);
    return info;
  }

  private read(type: ClassInfo): unknown {
    if (type.primitive) return this.readPrimitive(type.primitive);
    const id = this.objectIds.read();
    if (this.objects.has(id)) return this.objects.get(id);
    return this.readValue(type, id);
  }

  private readPrimitive(p: string): unknown {
    const c = this.cursor;
    switch (p) {
      case "boolean": return c.bool();
      case "byte": return c.i8();
      case "char": return String.fromCharCode(c.u16());
      case "double": return c.f64();
      case "float": return c.f32();
      case "int": return c.i32();
      case "long": return c.i64();
      case "short": return c.i16();
    }
    throw new ImportError(`Unknown primitive ${p}`);
  }

  /** Optional trace of (position, class) decisions, for debugging the format. */
  trace?: string[];

  private readValue(type: ClassInfo, id: number): unknown {
    const cls = (type.flags & FINAL) ? type : this.readClass();
    this.trace?.push(`${this.cursor.pos} ${cls.name} flags=${cls.flags}`);
    const streamed = this.tryStream(cls);
    if (streamed !== NOT_STREAMED) {
      this.objects.set(id, streamed);
      return streamed;
    }
    const c = this.cursor;
    if (cls.component) {
      const length = this.objectIds.readLength();
      const arr: unknown[] = new Array(length);
      this.objects.set(id, arr);
      for (let i = 0; i < length; i++) arr[i] = this.read(cls.component);
      return arr;
    }
    const outer = (cls.flags & INNER) ? this.read(this.objectClass) : undefined;
    if (cls.flags & COLLECTION) {
      const coll: JCollection = { $collection: cls.name, items: [] };
      this.objects.set(id, coll);
      if (cls.name === "java.util.EnumSet" || cls.name.endsWith("EnumSet")) {
        const enumClass = this.readClass();
        knownEnums.add(enumClass.name);
      }
      const n = this.objectIds.readLength();
      const multi = (cls.flags & MULTI) !== 0;
      if (multi) coll.counts = [];
      for (let i = 0; i < n; i++) {
        coll.items.push(this.read(this.objectClass));
        if (multi) coll.counts!.push(this.objectIds.readLength());
      }
      return coll;
    }
    if ((cls.flags & (MAP | MULTI)) === MAP) {
      const map: JMap = { $map: cls.name, entries: [] };
      this.objects.set(id, map);
      const n = this.objectIds.readLength();
      for (let i = 0; i < n; i++) {
        const k = this.read(this.objectClass);
        const v = this.read(this.objectClass);
        map.entries.push([k, v]);
      }
      return map;
    }
    if (this.isEnum(cls)) {
      this.trace?.push(`  -> enum`);
      const value: JEnum = { $enum: cls.name, name: c.utf() };
      this.objects.set(id, value);
      return value;
    }
    // an Exportable: read its field table
    const obj: JObject = { $class: cls.name };
    if (outer !== undefined) obj.$outer = outer;
    this.objects.set(id, obj);
    let data = this.classData.get(cls.name);
    if (!data) this.classData.set(cls.name, data = { ids: new IdReader(c, this.version), fields: new Map() });
    const count = data.ids.readLength();
    for (let i = 0; i < count; i++) {
      const fid = data.ids.read();
      let field = data.fields.get(fid);
      if (!field) {
        const name = this.read(this.stringClass) as string;
        const ftype = this.readClass();
        data.fields.set(fid, field = { name, type: ftype });
      }
      this.trace?.push(`  .${field.name} : ${field.type.name}`);
      obj[field.name] = this.read(field.type);
    }
    if (count > 0) knownExportables.add(cls.name);
    return obj;
  }

  /** Decides whether an unrecognised, non-collection class is an enum. */
  private isEnum(cls: ClassInfo): boolean {
    if (knownEnums.has(cls.name)) return true;
    if (knownExportables.has(cls.name) || ENCODABLES[cls.name]) return false;
    // An enum value is a 16-bit length followed by a Java identifier. An Exportable starts
    // with a varint field count, which would put an identifier-looking run here only by chance.
    const c = this.cursor;
    const save = c.pos;
    try {
      const len = c.u16();
      if (len === 0 || len > 128 || save + 2 + len > c.bytes.length) return false;
      const s = UTF8.decode(c.bytes.subarray(c.pos, c.pos + len));
      if (!ENUM_NAME.test(s)) return false;
      knownEnums.add(cls.name);
      return true;
    } catch {
      return false;
    } finally {
      c.pos = save;
    }
  }

  private tryStream(cls: ClassInfo): unknown {
    const c = this.cursor;
    const n = cls.name;
    if (cls.primitive) return this.readPrimitive(cls.primitive);
    switch (n) {
      case "java.lang.Boolean": return c.bool();
      case "java.lang.Byte": return c.i8();
      case "java.lang.Character": return String.fromCharCode(c.u16());
      case "java.lang.Double": return c.f64();
      case "java.lang.Float": return c.f32();
      case "java.lang.Integer": return c.i32();
      case "java.lang.Long": return c.i64();
      case "java.lang.Short": return c.i16();
      case "java.lang.String": return c.utf();
      case "java.lang.Class": return { $classRef: c.utf() };
      case "java.io.File": return { $file: c.utf() };
    }
    // primitive arrays: 32-bit length then elements
    if (cls.component?.primitive) return this.readPrimitiveArray(cls.component.primitive, c.i32());
    const buf = BUFFERS[n];
    if (buf) return this.readPrimitiveArray(buf, c.i32());
    const enc = ENCODABLES[n];
    if (enc) {
      const o: JObject = { $class: n };
      for (const f of enc.fields) o[f] = enc.type === "f" ? c.f32() : c.i32();
      return o;
    }
    return NOT_STREAMED;
  }

  private readPrimitiveArray(p: string, len: number): unknown {
    const c = this.cursor;
    switch (p) {
      case "float": { const a = new Float32Array(len); for (let i = 0; i < len; i++) a[i] = c.f32(); return a; }
      case "int": { const a = new Int32Array(len); for (let i = 0; i < len; i++) a[i] = c.i32(); return a; }
      case "short": { const a = new Int16Array(len); for (let i = 0; i < len; i++) a[i] = c.i16(); return a; }
      case "byte": { c.need(len); const a = new Int8Array(c.bytes.slice(c.pos, c.pos + len).buffer); c.pos += len; return a; }
      case "double": { const a = new Float64Array(len); for (let i = 0; i < len; i++) a[i] = c.f64(); return a; }
      case "char": { const a = new Uint16Array(len); for (let i = 0; i < len; i++) a[i] = c.u16(); return a; }
      case "long": { const a: number[] = []; for (let i = 0; i < len; i++) a.push(c.i64()); return a; }
      case "boolean": { const a: boolean[] = []; for (let i = 0; i < len; i++) a.push(c.bool()); return a; }
    }
    throw new ImportError(`Unknown primitive array ${p}`);
  }
}

const NOT_STREAMED = Symbol("not-streamed");
