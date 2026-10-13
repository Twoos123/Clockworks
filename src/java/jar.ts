// Extracts named entries from a zip/jar archive in the browser, without unpacking the rest.

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;

interface Entry { method: number; compressed: number; local: number }

/** An archive read once, its central directory parsed; entries are inflated on demand. */
export class JarReader {
  private constructor(private readonly bytes: Uint8Array, private readonly entries: Map<string, Entry>) {}

  static async open(archive: Blob): Promise<JarReader> {
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
    const entries = new Map<string, Entry>();
    for (let i = 0; i < count; i++) {
      if (view.getUint32(p, true) !== CENTRAL) throw new Error("Corrupt central directory");
      const nameLen = view.getUint16(p + 28, true), extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      entries.set(decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen)),
        { method: view.getUint16(p + 10, true), compressed: view.getUint32(p + 20, true), local: view.getUint32(p + 42, true) });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return new JarReader(bytes, entries);
  }

  names(): string[] { return [...this.entries.keys()]; }

  async read(name: string): Promise<Uint8Array | null> {
    const e = this.entries.get(name);
    if (!e) return null;
    const view = new DataView(this.bytes.buffer);
    if (view.getUint32(e.local, true) !== LOCAL) throw new Error("Corrupt local header");
    const start = e.local + 30 + view.getUint16(e.local + 26, true) + view.getUint16(e.local + 28, true);
    const data = this.bytes.slice(start, start + e.compressed);
    if (e.method === 0) return data;
    if (e.method !== 8) throw new Error(`Unsupported compression method ${e.method}`);
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
}

export async function readJarEntry(archive: Blob, name: string): Promise<Uint8Array | null> {
  return (await JarReader.open(archive)).read(name);
}
