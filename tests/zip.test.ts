import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { BundleJar } from "../server/install.ts";
import { readZipDirectory, readZipEntry } from "../server/zip.ts";

/** A minimal zip archive: one local header per entry, then the central directory. */
function makeZip(files: [string, string, boolean][], comment = ""): Uint8Array {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text, deflate] of files) {
    const raw = Buffer.from(text, "latin1"), data = deflate ? deflateRawSync(raw) : raw;
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    local.writeUInt16LE(3, 28); // an extra field, which the reader must skip
    const extra = Buffer.from([1, 2, 3]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, extra, data);
    centrals.push(central, n);
    offset += 30 + n.length + extra.length + data.length;
  }
  const dir = Buffer.concat(centrals), c = Buffer.from(comment);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(dir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(c.length, 20);
  return new Uint8Array(Buffer.concat([...locals, dir, eocd, c]));
}

const FILES: [string, string, boolean][] = [
  ["rsrc/i18n/", "", false],
  ["rsrc/i18n/alpha.properties", "m.one=First\nm.two=Second {0}\n".repeat(20), true],
  ["rsrc/i18n/alpha_xx.properties", "m.one=Primero\n", false],
  ["rsrc/i18n/beta-names.properties", "a.thing=Thing\n", true],
  ["rsrc/config/other.dat", "not a bundle", true],
];

test("zip directory and entries, stored and deflated", () => {
  const zip = makeZip(FILES, "a trailing comment");
  const dir = readZipDirectory(zip);
  assert.deepEqual([...dir.keys()], FILES.map(f => f[0]));
  const dec = (b: Uint8Array) => Buffer.from(b).toString("latin1");
  for (const [name, text] of FILES) assert.equal(dec(readZipEntry(zip, dir.get(name)!)), text);
  assert.equal(dir.get("rsrc/i18n/alpha.properties")!.method, 8);
  assert.equal(dir.get("rsrc/i18n/alpha_xx.properties")!.method, 0);
  assert.throws(() => readZipDirectory(new Uint8Array(100)));
});

test("bundle jar lists and serves only rsrc/i18n bundles with safe names", () => {
  const dir = mkdtempSync(join(tmpdir(), "zip-test-"));
  try {
    const jar = join(dir, "test.jar");
    writeFileSync(jar, makeZip(FILES));
    const b = new BundleJar(() => jar);
    assert.deepEqual(b.names().sort(), ["alpha", "alpha_xx", "beta-names"]);
    assert.equal(Buffer.from(b.read("alpha_xx")!).toString(), "m.one=Primero\n");
    assert.equal(Buffer.from(b.read("beta-names")!).toString(), "a.thing=Thing\n");
    assert.equal(b.read("other"), null);
    assert.equal(b.read("../config/other"), null);
    assert.equal(b.read("Alpha"), null);
    assert.equal(new BundleJar(() => join(dir, "missing.jar")).read("alpha"), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
