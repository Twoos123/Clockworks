// Read-only access to the player's own Spiral Knights install. Nothing is uploaded or
// copied off the machine: files are read in the page, on demand.
//
// Sources, in order of preference:
//  - a directory handle from showDirectoryPicker (Chromium), remembered in IndexedDB
//  - a FileList from <input webkitdirectory> or a dropped folder (Firefox, Safari)
//  - the local dev server's /__sk/ route (development only, never in a production build)

export interface Vfs {
  /** Human-readable description of the source. */
  readonly label: string;
  /** All file paths relative to rsrc/, using forward slashes. */
  list(): Promise<string[]>;
  /** Reads a file relative to rsrc/. */
  read(path: string): Promise<Uint8Array>;
  /** Returns a Blob for a file relative to rsrc/ (used for image decoding). */
  blob(path: string): Promise<Blob>;
}

export class VfsError extends Error {}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\/+/, "");

/** Locates rsrc/ within a picked folder: the install root, rsrc itself, or a parent. */
function rsrcPrefix(paths: string[]): string | null {
  let best: string | null = null;
  for (const p of paths) {
    const i = p.indexOf("rsrc/");
    if (i === 0 || (i > 0 && p[i - 1] === "/")) {
      const prefix = p.substring(0, i + 5);
      if (best === null || prefix.length < best.length) best = prefix;
    }
  }
  return best;
}

export class FileListVfs implements Vfs {
  private readonly files = new Map<string, File>();
  readonly label: string;

  constructor(files: Iterable<[string, File]>, label: string) {
    const all = [...files].map(([p, f]) => [norm(p), f] as const);
    const prefix = rsrcPrefix(all.map(([p]) => p));
    if (prefix === null) {
      // the user may have picked rsrc itself
      const looksLikeRsrc = all.some(([p]) => /(^|\/)config\/[^/]+\.dat$/.test(p));
      if (!looksLikeRsrc) throw new VfsError("That folder does not contain a Spiral Knights rsrc folder.");
      const root = commonRoot(all.map(([p]) => p));
      for (const [p, f] of all) this.files.set(p.substring(root.length), f);
    } else {
      for (const [p, f] of all) if (p.startsWith(prefix)) this.files.set(p.substring(prefix.length), f);
    }
    this.label = label;
  }

  async list() { return [...this.files.keys()]; }

  private get(path: string) {
    const f = this.files.get(norm(path));
    if (!f) throw new VfsError(`Missing file: ${path}`);
    return f;
  }

  async read(path: string) { return new Uint8Array(await this.get(path).arrayBuffer()); }
  async blob(path: string) { return this.get(path); }
}

function commonRoot(paths: string[]): string {
  const first = paths[0] ?? "";
  const slash = first.indexOf("/");
  if (slash < 0) return "";
  const head = first.substring(0, slash + 1);
  return paths.every(p => p.startsWith(head)) ? head : "";
}

/** Wraps a FileSystemDirectoryHandle, resolving paths lazily segment by segment. */
export class HandleVfs implements Vfs {
  private rsrc?: FileSystemDirectoryHandle;
  private readonly dirs = new Map<string, Promise<FileSystemDirectoryHandle>>();
  readonly label: string;

  constructor(readonly root: FileSystemDirectoryHandle) {
    this.label = root.name;
  }

  async init(): Promise<this> {
    try {
      this.rsrc = await this.root.getDirectoryHandle("rsrc");
    } catch {
      // maybe the user picked rsrc itself
      try {
        await this.root.getDirectoryHandle("config");
        this.rsrc = this.root;
      } catch {
        throw new VfsError("That folder does not contain a Spiral Knights rsrc folder.");
      }
    }
    return this;
  }

  private dir(path: string): Promise<FileSystemDirectoryHandle> {
    if (path === "") return Promise.resolve(this.rsrc!);
    let p = this.dirs.get(path);
    if (!p) {
      const i = path.lastIndexOf("/");
      const parent = i < 0 ? "" : path.substring(0, i);
      p = this.dir(parent).then(d => d.getDirectoryHandle(path.substring(i + 1)));
      this.dirs.set(path, p);
    }
    return p;
  }

  private async file(path: string): Promise<File> {
    path = norm(path);
    const i = path.lastIndexOf("/");
    try {
      const d = await this.dir(i < 0 ? "" : path.substring(0, i));
      return await (await d.getFileHandle(path.substring(i + 1))).getFile();
    } catch {
      throw new VfsError(`Missing file: ${path}`);
    }
  }

  async list(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (d: FileSystemDirectoryHandle, prefix: string) => {
      const subdirs: Promise<void>[] = [];
      // @ts-expect-error: values() is not yet in every DOM lib version
      for await (const entry of d.values() as AsyncIterable<FileSystemHandle>) {
        if (entry.kind === "directory") subdirs.push(walk(entry as FileSystemDirectoryHandle, prefix + entry.name + "/"));
        else out.push(prefix + entry.name);
      }
      await Promise.all(subdirs);
    };
    await walk(this.rsrc!, "");
    return out;
  }

  async read(path: string) { return new Uint8Array(await (await this.file(path)).arrayBuffer()); }
  async blob(path: string) { return this.file(path); }
}

/** Development-only source served by the Vite plugin in vite.config.ts. */
export class DevServerVfs implements Vfs {
  readonly label = "local install (dev server)";
  async list(): Promise<string[]> {
    const r = await fetch("/__sk/list");
    if (!r.ok) throw new VfsError("Dev server has no install configured.");
    return r.json();
  }
  async read(path: string) { return new Uint8Array(await (await this.blob(path)).arrayBuffer()); }
  async blob(path: string) {
    const r = await fetch("/__sk/rsrc/" + norm(path).split("/").map(encodeURIComponent).join("/"));
    if (!r.ok) throw new VfsError(`Missing file: ${path}`);
    return r.blob();
  }
  static async available(): Promise<boolean> {
    if (!import.meta.env.DEV) return false;
    try { return (await fetch("/__sk/ping")).ok; } catch { return false; }
  }
}

// --- remembering the picked folder (Chromium) ---

const DB = "clyde-web", STORE = "handles";

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function rememberHandle(h: FileSystemDirectoryHandle) {
  try {
    const d = await db();
    d.transaction(STORE, "readwrite").objectStore(STORE).put(h, "install");
  } catch { /* storage may be unavailable; remembering is a convenience */ }
}

export async function recallHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const d = await db();
    return await new Promise(resolve => {
      const req = d.transaction(STORE).objectStore(STORE).get("install");
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

export const canPickDirectory = () => "showDirectoryPicker" in window;
