// A small zip reader for the local server: parses an archive's central directory and inflates
// single entries with node's zlib. Used to read the message bundles out of the player's own
// projectx-config.jar; nothing is unpacked to disk.

import { inflateRawSync } from "node:zlib";

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;

export interface ZipEntry {
  name: string;
  /** 0 stored, 8 deflated. */
  method: number;
  compressedSize: number;
  size: number;
  /** Offset of the entry's local header. */
  offset: number;
}

/** The archive's entries by name, from its central directory. */
export function readZipDirectory(zip: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // the end-of-central-directory record sits in the last 64 KB + 22 bytes (after any comment)
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (view.getUint32(i, true) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip archive");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = new Map<string, ZipEntry>();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (p + 46 > zip.length || view.getUint32(p, true) !== CENTRAL) throw new Error("corrupt central directory");
    const nameLen = view.getUint16(p + 28, true), extraLen = view.getUint16(p + 30, true), commentLen = view.getUint16(p + 32, true);
    const name = decoder.decode(zip.subarray(p + 46, p + 46 + nameLen));
    out.set(name, {
      name,
      method: view.getUint16(p + 10, true),
      compressedSize: view.getUint32(p + 20, true),
      size: view.getUint32(p + 24, true),
      offset: view.getUint32(p + 42, true),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** One entry's uncompressed bytes. */
export function readZipEntry(zip: Uint8Array, e: ZipEntry): Uint8Array {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  if (view.getUint32(e.offset, true) !== LOCAL) throw new Error("corrupt local header");
  const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + view.getUint16(e.offset + 28, true);
  const data = zip.subarray(start, start + e.compressedSize);
  if (e.method === 0) return data;
  if (e.method !== 8) throw new Error(`unsupported compression method ${e.method}`);
  return new Uint8Array(inflateRawSync(data));
}
