// A reader for the Java Object Serialization Stream Protocol (java.io.ObjectInputStream),
// enough to load Nenya's CompiledConfig files such as the colour pository. It never runs
// or loads code: it only decodes the documented stream grammar into plain objects.

const STREAM_MAGIC = 0xaced;
const TC_NULL = 0x70, TC_REFERENCE = 0x71, TC_CLASSDESC = 0x72, TC_OBJECT = 0x73, TC_STRING = 0x74,
  TC_ARRAY = 0x75, TC_CLASS = 0x76, TC_BLOCKDATA = 0x77, TC_ENDBLOCKDATA = 0x78, TC_RESET = 0x79,
  TC_BLOCKDATALONG = 0x7a, TC_LONGSTRING = 0x7c, TC_PROXYCLASSDESC = 0x7d, TC_ENUM = 0x7e;
const BASE_HANDLE = 0x7e0000;
/**
 * Classes whose writeObject does not call defaultWriteObject, so their declared fields are
 * absent and only the custom data follows. The stream cannot say this; the class's code does.
 */
const NO_DEFAULT_FIELDS = new Set(["com.samskivert.util.HashIntMap"]);
const SC_WRITE_METHOD = 0x01, SC_SERIALIZABLE = 0x02, SC_EXTERNALIZABLE = 0x04, SC_BLOCK_DATA = 0x08;

export interface JavaClassDesc {
  name: string;
  flags: number;
  fields: { type: string; name: string; className?: string }[];
  superDesc: JavaClassDesc | null;
}

/** Custom writeObject data: raw block bytes interleaved with objects, in stream order. */
export type Annotation = (Uint8Array | unknown)[];

export interface JavaObject {
  $class: string;
  /** Fields by name (subclass fields win on a name clash). */
  fields: Record<string, unknown>;
  /** writeObject annotations, keyed by the class that wrote them. */
  annotations: Record<string, Annotation>;
}

export class JavaSerializationError extends Error {}

export function readJavaObject(bytes: Uint8Array): unknown {
  return new Reader(bytes).readStream();
}

class Reader {
  private pos = 0;
  private readonly view: DataView;
  private handles: unknown[] = [];

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  readStream(): unknown {
    if (this.u16() !== STREAM_MAGIC) throw new JavaSerializationError("Not a Java serialization stream");
    this.u16(); // version
    return this.content();
  }

  private need(n: number) {
    if (this.pos + n > this.bytes.length) throw new JavaSerializationError(`Unexpected end at ${this.pos}`);
  }
  private u8() { this.need(1); return this.bytes[this.pos++]; }
  private u16() { this.need(2); const v = this.view.getUint16(this.pos); this.pos += 2; return v; }
  private i32() { this.need(4); const v = this.view.getInt32(this.pos); this.pos += 4; return v; }
  private take(n: number) { this.need(n); const b = this.bytes.slice(this.pos, this.pos + n); this.pos += n; return b; }

  private utf(len = this.u16()): string {
    // modified UTF-8; for the ASCII and BMP text in configs, TextDecoder is equivalent
    return new TextDecoder().decode(this.take(len));
  }

  private newHandle(value: unknown): number {
    this.handles.push(value);
    return this.handles.length - 1;
  }

  /** content := object | blockdata */
  private content(): unknown {
    const tc = this.bytes[this.pos];
    if (tc === TC_BLOCKDATA) { this.pos++; return this.take(this.u8()); }
    if (tc === TC_BLOCKDATALONG) { this.pos++; return this.take(this.i32()); }
    return this.object();
  }

  private object(): unknown {
    const tc = this.u8();
    switch (tc) {
      case TC_NULL: return null;
      case TC_REFERENCE: return this.handles[this.i32() - BASE_HANDLE];
      case TC_STRING: { const s = this.utf(); this.newHandle(s); return s; }
      case TC_LONGSTRING: { this.i32(); const s = this.utf(this.i32()); this.newHandle(s); return s; }
      case TC_CLASSDESC: case TC_PROXYCLASSDESC: this.pos--; return this.classDesc();
      case TC_CLASS: { const d = this.classDesc(); const c = { $classRef: d?.name }; this.newHandle(c); return c; }
      case TC_ARRAY: return this.array();
      case TC_ENUM: {
        const d = this.classDesc();
        const e: { $enum?: string; name?: string } = { $enum: d?.name };
        this.newHandle(e);
        e.name = this.object() as string;
        return e;
      }
      case TC_OBJECT: return this.newObject();
      case TC_RESET: this.handles = []; return this.object();
      default: throw new JavaSerializationError(`Unknown type code 0x${tc.toString(16)} at ${this.pos - 1}`);
    }
  }

  private classDesc(): JavaClassDesc | null {
    const tc = this.u8();
    if (tc === TC_NULL) return null;
    if (tc === TC_REFERENCE) return this.handles[this.i32() - BASE_HANDLE] as JavaClassDesc;
    if (tc === TC_PROXYCLASSDESC) {
      const desc: JavaClassDesc = { name: "$Proxy", flags: 0, fields: [], superDesc: null };
      this.newHandle(desc);
      const n = this.i32();
      for (let i = 0; i < n; i++) this.utf();
      this.skipAnnotation();
      desc.superDesc = this.classDesc();
      return desc;
    }
    if (tc !== TC_CLASSDESC) throw new JavaSerializationError(`Expected class descriptor at ${this.pos - 1}`);
    const name = this.utf();
    this.take(8); // serialVersionUID
    const desc: JavaClassDesc = { name, flags: 0, fields: [], superDesc: null };
    this.newHandle(desc);
    desc.flags = this.u8();
    const count = this.u16();
    for (let i = 0; i < count; i++) {
      const type = String.fromCharCode(this.u8());
      const fname = this.utf();
      const field: JavaClassDesc["fields"][number] = { type, name: fname };
      if (type === "L" || type === "[") field.className = this.object() as string;
      desc.fields.push(field);
    }
    this.skipAnnotation();
    desc.superDesc = this.classDesc();
    return desc;
  }

  private skipAnnotation() {
    for (;;) {
      if (this.bytes[this.pos] === TC_ENDBLOCKDATA) { this.pos++; return; }
      this.content();
    }
  }

  private annotation(): Annotation {
    const out: Annotation = [];
    for (;;) {
      if (this.bytes[this.pos] === TC_ENDBLOCKDATA) { this.pos++; return out; }
      out.push(this.content());
    }
  }

  private newObject(): JavaObject {
    const desc = this.classDesc();
    if (!desc) throw new JavaSerializationError("Object without class");
    const obj: JavaObject = { $class: desc.name, fields: {}, annotations: {} };
    this.newHandle(obj);
    // class data is written from the top-most serializable superclass down
    const chain: JavaClassDesc[] = [];
    for (let d: JavaClassDesc | null = desc; d; d = d.superDesc) chain.unshift(d);
    for (const d of chain) {
      if (d.flags & SC_SERIALIZABLE) {
        if (!NO_DEFAULT_FIELDS.has(d.name)) for (const f of d.fields) obj.fields[f.name] = this.value(f.type);
        if (d.flags & SC_WRITE_METHOD) obj.annotations[d.name] = this.annotation();
      } else if (d.flags & SC_EXTERNALIZABLE) {
        if (!(d.flags & SC_BLOCK_DATA)) throw new JavaSerializationError(`Old-format externalizable ${d.name}`);
        obj.annotations[d.name] = this.annotation();
      }
    }
    return obj;
  }

  private array(): unknown[] | ArrayLike<number> {
    const desc = this.classDesc();
    const size = this.i32();
    const type = desc?.name.charAt(1) ?? "L";
    let out: unknown[] | Float32Array | Int32Array;
    if (type === "F") out = new Float32Array(size);
    else if (type === "I") out = new Int32Array(size);
    else out = new Array(size);
    this.newHandle(out);
    for (let i = 0; i < size; i++) (out as unknown[])[i] = this.value(type === "[" ? "[" : type);
    return out;
  }

  private value(type: string): unknown {
    switch (type) {
      case "B": { this.need(1); return this.view.getInt8(this.pos++); }
      case "C": return String.fromCharCode(this.u16());
      case "D": { this.need(8); const v = this.view.getFloat64(this.pos); this.pos += 8; return v; }
      case "F": { this.need(4); const v = this.view.getFloat32(this.pos); this.pos += 4; return v; }
      case "I": return this.i32();
      case "J": { this.need(8); const v = Number(this.view.getBigInt64(this.pos)); this.pos += 8; return v; }
      case "S": { this.need(2); const v = this.view.getInt16(this.pos); this.pos += 2; return v; }
      case "Z": return this.u8() !== 0;
      default: return this.object();
    }
  }
}

/** Reads primitives and objects back out of a writeObject annotation, in order. */
export class AnnotationReader {
  private block = new Uint8Array(0);
  private pos = 0;
  private item = 0;
  constructor(private readonly items: Annotation) {}

  private bytes(n: number): DataView {
    while (this.block.length - this.pos < n) {
      const next = this.items[this.item++];
      if (!(next instanceof Uint8Array)) throw new JavaSerializationError("Expected block data");
      const merged = new Uint8Array(this.block.length - this.pos + next.length);
      merged.set(this.block.subarray(this.pos));
      merged.set(next, this.block.length - this.pos);
      this.block = merged;
      this.pos = 0;
    }
    const v = new DataView(this.block.buffer, this.block.byteOffset + this.pos, n);
    this.pos += n;
    return v;
  }
  readInt() { return this.bytes(4).getInt32(0); }
  readFloat() { return this.bytes(4).getFloat32(0); }
  readObject(): unknown {
    if (this.pos < this.block.length) throw new JavaSerializationError("Unread block data before object");
    const next = this.items[this.item++];
    if (next instanceof Uint8Array) throw new JavaSerializationError("Expected an object");
    return next;
  }
}
