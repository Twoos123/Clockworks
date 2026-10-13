// Extracts one named entry from a zip/jar archive in the browser, without unpacking the rest.

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;

export async function readJarEntry(archive: Blob, name: string): Promise<Uint8Array | null> {
  const bytes = new Uint8Array(await archive.arrayBuffer());
  const view = new DataView(bytes.buffer);
  // the end-of-central-directory record sits within the last 64 KB + 22 bytes
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a zip archive");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== CENTRAL) throw new Error("Corrupt central directory");
    const method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true), extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const entryName = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (entryName === name) {
      if (view.getUint32(local, true) !== LOCAL) throw new Error("Corrupt local header");
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.slice(start, start + compressed);
      if (method === 0) return data;
      if (method !== 8) throw new Error(`Unsupported compression method ${method}`);
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}
