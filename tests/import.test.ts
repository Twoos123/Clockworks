// Format tests that need no game files: streams are built by a tiny encoder that follows
// Clyde's BinaryExporter (BSD-2-Clause) byte for byte.
import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { importBinary, type JObject } from "../src/export/BinaryImport.ts";
import { nodeInflate } from "../tools/common.ts";

const FINAL = 1, INNER = 2, COLLECTION = 4, MAP = 8;

class Writer {
  bytes: number[] = [];
  private classIds = new Map<string, number>();
  private lastClass = 8; // boolean..short are bootstrap ids 1-8
  private lastObject = 0;
  private fieldIds = new Map<string, Map<string, number>>();

  varint(v: number) { while (v >= 0x80) { this.bytes.push((v & 0x7f) | 0x80); v >>>= 7; } this.bytes.push(v); }
  u16(v: number) { this.bytes.push((v >> 8) & 0xff, v & 0xff); }
  i32(v: number) { this.bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff); }
  f32(v: number) { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, v); this.bytes.push(...new Uint8Array(b.buffer)); }
  utf(s: string) { const b = new TextEncoder().encode(s); this.u16(b.length); this.bytes.push(...b); }
  newId() { this.varint(++this.lastObject); return this.lastObject; }
  cls(name: string, flags: number) {
    const id = this.classIds.get(name);
    if (id) { this.varint(id); return; }
    this.classIds.set(name, ++this.lastClass);
    this.varint(this.lastClass);
    this.utf(name);
    this.bytes.push(flags);
  }
  /** Writes an exportable object (non-final, so its class is written). */
  object(name: string, fields: [string, string, number, () => void][]): number {
    const id = this.newId();
    this.cls(name, 0);
    let ids = this.fieldIds.get(name);
    if (!ids) this.fieldIds.set(name, ids = new Map());
    this.varint(fields.length);
    for (const [fname, ftype, fflags, value] of fields) {
      const known = ids.get(fname);
      if (known) this.varint(known);
      else {
        ids.set(fname, ids.size + 1);
        this.varint(ids.size);
        this.newId(); this.utf(fname); // field name is a String object
        this.cls(ftype, fflags);
      }
      value();
    }
    return id;
  }
  file() {
    const head = [0xfa, 0xce, 0xaf, 0x0e, 0x10, 0x02, 0x10, 0x00];
    return new Uint8Array([...head, ...deflateSync(Uint8Array.from(this.bytes))]);
  }
}

test("reads exportable objects, primitives, strings, encodables, arrays and enums", async () => {
  const w = new Writer();
  w.object("com.example.Thing", [
    ["name", "java.lang.String", FINAL, () => { w.newId(); w.utf("jelly"); }],
    ["count", "int", 0, () => w.i32(42)],
    ["scale", "float", 0, () => w.f32(0.5)],
    ["position", "com.threerings.math.Vector3f", FINAL, () => { w.newId(); w.f32(1); w.f32(2); w.f32(3); }],
    ["data", "[F", FINAL, () => { w.newId(); w.i32(2); w.f32(7); w.f32(8); }],
    ["mode", "com.threerings.opengl.renderer.config.AlphaStateConfig$TestFunc", FINAL, () => { w.newId(); w.utf("GEQUAL"); }],
  ]);
  const r = await importBinary(w.file(), nodeInflate);
  assert.equal(r.trailing, 0);
  const o = r.root as JObject;
  assert.equal(o.$class, "com.example.Thing");
  assert.equal(o.name, "jelly");
  assert.equal(o.count, 42);
  assert.equal(o.scale, 0.5);
  assert.deepEqual({ ...(o.position as object) }, { $class: "com.threerings.math.Vector3f", x: 1, y: 2, z: 3 });
  assert.deepEqual([...(o.data as Float32Array)], [7, 8]);
  assert.deepEqual(o.mode, { $enum: "com.threerings.opengl.renderer.config.AlphaStateConfig$TestFunc", name: "GEQUAL" });
});

test("resolves back-references and object arrays", async () => {
  const w = new Writer();
  w.object("com.example.Pair", [
    ["items", "[Ljava.lang.Object;", FINAL, () => {
      w.newId();
      w.varint(2);
      const leaf = w.object("com.example.Leaf", [["v", "int", 0, () => w.i32(1)]]);
      w.varint(leaf); // back-reference to the Leaf written above
    }],
  ]);
  const r = await importBinary(w.file(), nodeInflate);
  const items = (r.root as JObject).items as JObject[];
  assert.equal(r.trailing, 0);
  assert.equal(items.length, 2);
  assert.equal(items[0], items[1]);
  assert.equal(items[0].v, 1);
});

test("reads collections and maps by their class flags", async () => {
  const w = new Writer();
  w.object("com.example.Holder", [
    ["list", "java.util.ArrayList", COLLECTION, () => {
      w.newId(); w.cls("java.util.ArrayList", COLLECTION); w.varint(1);
      w.newId(); w.cls("java.lang.String", FINAL); w.utf("a");
    }],
    ["map", "com.threerings.config.ArgumentMap", MAP, () => {
      w.newId(); w.cls("com.threerings.config.ArgumentMap", MAP); w.varint(1);
      w.newId(); w.cls("java.lang.String", FINAL); w.utf("File");
      w.newId(); w.cls("java.lang.String", FINAL); w.utf("a.png");
    }],
  ]);
  const r = await importBinary(w.file(), nodeInflate);
  const o = r.root as any;
  assert.equal(r.trailing, 0);
  assert.deepEqual(o.list.items, ["a"]);
  assert.deepEqual(o.map.entries, [["File", "a.png"]]);
});

test("inner classes carry their outer instance", async () => {
  const w = new Writer();
  w.object("com.example.Outer", [
    ["child", "com.example.Outer$Inner", INNER, () => {
      w.newId();
      w.cls("com.example.Outer$Inner", INNER);
      w.varint(1); // outer reference: object id 1 is the Outer being read
      w.varint(0); // no fields
    }],
  ]);
  const r = await importBinary(w.file(), nodeInflate);
  const o = r.root as any;
  assert.equal(r.trailing, 0);
  assert.equal(o.child.$outer, o);
});

test("rejects bad magic numbers", async () => {
  await assert.rejects(importBinary(new Uint8Array(8), nodeInflate), /magic/);
});
