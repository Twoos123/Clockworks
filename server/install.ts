// Finding and serving the player's own Spiral Knights install. Used by the dev server
// (vite.config.ts) and the launcher (server/play.ts); both listen on localhost only, so the
// game's files go from the player's disk to the player's browser and nowhere else.

import { execFileSync } from "node:child_process";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, join, normalize, sep } from "node:path";
import { handleGates } from "./gates";
import { readZipDirectory, readZipEntry, type ZipEntry } from "./zip";

const GAME_DIR = "Spiral Knights";
const isInstall = (dir: string) => existsSync(join(dir, "rsrc")) && existsSync(join(dir, "rsrc", "config"));

/** Steam's own folder, from the registry on Windows and the usual places elsewhere. */
function steamRoots(): string[] {
  const roots: string[] = [];
  if (process.platform === "win32") {
    for (const [key, value] of [["HKCU\\Software\\Valve\\Steam", "SteamPath"], ["HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"],
      ["HKLM\\SOFTWARE\\Valve\\Steam", "InstallPath"]]) {
      try {
        const out = execFileSync("reg", ["query", key, "/v", value], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        const m = /REG_SZ\s+(.+)/.exec(out);
        if (m) roots.push(m[1].trim());
      } catch { /* no such key */ }
    }
    for (const pf of [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, "C:/Program Files (x86)", "C:/Program Files"])
      if (pf) roots.push(join(pf, "Steam"));
  } else if (process.platform === "darwin") {
    roots.push(join(homedir(), "Library/Application Support/Steam"));
  } else {
    roots.push(join(homedir(), ".steam/steam"), join(homedir(), ".local/share/Steam"), join(homedir(), ".var/app/com.valvesoftware.Steam/.local/share/Steam"));
  }
  return roots;
}

/** Every Steam library: each root and the paths its libraryfolders.vdf lists. */
function steamLibraries(): string[] {
  const libs: string[] = [];
  for (const root of steamRoots()) {
    libs.push(root);
    const vdf = join(root, "steamapps", "libraryfolders.vdf");
    if (!existsSync(vdf)) continue;
    try {
      for (const m of readFileSync(vdf, "utf8").matchAll(/"path"\s+"([^"]+)"/g)) libs.push(m[1].replace(/\\\\/g, "\\"));
    } catch { /* unreadable */ }
  }
  return libs;
}

/** Candidate install folders, most likely first. */
export function candidates(): string[] {
  const out: string[] = [];
  if (process.env.SK_DIR) out.push(process.env.SK_DIR);
  for (const lib of steamLibraries()) out.push(join(lib, "steamapps", "common", GAME_DIR));
  // the standalone (non-Steam) installer's places
  const local = process.env.LOCALAPPDATA, appdata = process.env.APPDATA;
  if (process.platform === "win32") {
    for (const base of [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, local, appdata])
      if (base) out.push(join(base, GAME_DIR), join(base, "Three Rings Design", GAME_DIR));
  } else if (process.platform === "darwin") {
    out.push(join(homedir(), "Library/Application Support", GAME_DIR), join("/Applications", GAME_DIR + ".app/Contents/Resources/Java"));
  } else {
    out.push(join(homedir(), GAME_DIR), join(homedir(), "." + GAME_DIR.toLowerCase().replace(" ", "")));
  }
  return [...new Set(out.map(p => normalize(p)))];
}

/** The install folder (the one holding rsrc/), or null when none is found. */
export function detectInstall(): string | null {
  return candidates().find(isInstall) ?? null;
}

/**
 * The player's private level archive. The official client caches every level the servers send
 * it in the install's scenes/ folder, and may clear or replace that folder; each level found
 * there is copied here and kept, so a level visited once in the real game stays playable. It
 * lives in the player's own app-data folder and is never uploaded anywhere.
 */
export function archiveDir(): string {
  if (process.env.SK_ARCHIVE) return process.env.SK_ARCHIVE;
  const base = process.platform === "win32" ? process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local")
    : process.platform === "darwin" ? join(homedir(), "Library", "Application Support")
    : process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(base, "clyde-web", "scenes");
}

const SCENE = /^[0-9]+$/;
/** A message bundle's name: "item", "item-names", "global_de". */
const BUNDLE = /^[a-z0-9_-]+$/;
const I18N = "rsrc/i18n/";

/**
 * The message bundles (rsrc/i18n/*.properties) inside the install's projectx-config.jar. The
 * jar and its parsed directory are kept until the file changes (a game update).
 */
export class BundleJar {
  private cached: { key: string; zip: Uint8Array; dir: Map<string, ZipEntry> } | null = null;
  constructor(private readonly jar: () => string | null) {}

  private open() {
    const file = this.jar();
    if (!file || !existsSync(file)) return null;
    const st = statSync(file), key = `${file}|${st.size}|${st.mtimeMs}`;
    if (this.cached?.key !== key) {
      const zip = new Uint8Array(readFileSync(file));
      this.cached = { key, zip, dir: readZipDirectory(zip) };
    }
    return this.cached;
  }

  /** Bundle names, locale variants included ("global", "global_de"). */
  names(): string[] {
    const c = this.open();
    if (!c) return [];
    return [...c.dir.keys()].filter(n => n.startsWith(I18N) && n.endsWith(".properties"))
      .map(n => n.slice(I18N.length, -".properties".length)).filter(n => BUNDLE.test(n));
  }

  /** One bundle's .properties bytes, or null for a bad name or a missing entry. */
  read(name: string): Uint8Array | null {
    if (!BUNDLE.test(name)) return null;
    const c = this.open(), e = c?.dir.get(I18N + name + ".properties");
    return c && e ? readZipEntry(c.zip, e) : null;
  }
}

/** Copies new or updated cached levels from the install into the archive; returns how many. */
export function syncArchive(install: string | null, archive = archiveDir()): number {
  if (!install) return 0;
  const src = join(install, "scenes");
  if (!existsSync(src)) return 0;
  mkdirSync(archive, { recursive: true });
  let copied = 0;
  for (const name of readdirSync(src)) {
    if (!SCENE.test(name)) continue;
    const from = join(src, name), to = join(archive, name);
    try {
      const a = statSync(from);
      if (existsSync(to)) {
        const b = statSync(to);
        // the same level unchanged: keep the archived copy
        if (b.size === a.size && b.mtimeMs >= a.mtimeMs) continue;
      }
      copyFileSync(from, to);
      copied++;
    } catch { /* being written by the client: next sync */ }
  }
  return copied;
}

/**
 * Each archived level's display name, kept in a JSON file beside the archive so the game learns
 * the names of thousands of levels in one request; a level is parsed only when it is new or
 * has changed. Returns [id, name] pairs.
 */
let indexing: Promise<[string, string][]> | null = null;
export function sceneIndex(archive = archiveDir()): Promise<[string, string][]> {
  return indexing ??= (async () => {
    try {
      const file = join(dirname(archive), "scene-index.json");
      let cache: Record<string, { size: number; mtime: number; name: string }> = {};
      try { cache = JSON.parse(readFileSync(file, "utf8")); } catch { /* first run */ }
      const { sceneName } = await import("../src/scene");
      const out: [string, string][] = [];
      let changed = false;
      for (const id of existsSync(archive) ? readdirSync(archive).filter(n => SCENE.test(n)) : []) {
        const st = statSync(join(archive, id));
        let e = cache[id];
        if (!e || e.size !== st.size || e.mtime !== st.mtimeMs) {
          let name = "";
          try { name = await sceneName(new Uint8Array(readFileSync(join(archive, id)))); } catch { /* unreadable */ }
          e = cache[id] = { size: st.size, mtime: st.mtimeMs, name };
          changed = true;
        }
        if (e.name) out.push([id, e.name]);
      }
      if (changed) writeFileSync(file, JSON.stringify(cache));
      return out;
    } finally { setTimeout(() => { indexing = null; }, 0); }
  })();
}

/** Handles /__sk requests: the install's rsrc files, scenes cache and colour definitions. */
export function installMiddleware(dir: () => string | null, archive = archiveDir()) {
  let listing: string[] | null = null;
  const walk = (d: string, prefix: string, out: string[]) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p, prefix + name + "/", out);
      else out.push(prefix + name);
    }
    return out;
  };
  const bundles = new BundleJar(() => { const root = dir(); return root ? join(root, "code", "projectx-config.jar") : null; });
  const send = (res: ServerResponse, file: string) => createReadStream(file).on("error", () => { res.statusCode = 404; res.end(); }).pipe(res);
  return (req: IncomingMessage, res: ServerResponse) => {
    const root = dir();
    const url = decodeURIComponent((req.url ?? "").split("?")[0]);
    // the Arcade's real gates (server/gates.ts): fetched from the community Gate Map and cached
    if (handleGates(url, req, res)) return;
    if (!root) { res.statusCode = 404; res.end(); return; }
    const rsrc = join(root, "rsrc");
    if (url === "/ping") { res.end("ok"); return; }
    if (url === "/list") {
      listing ??= walk(rsrc, "", []);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(listing));
      return;
    }
    if (url === "/configjar") {
      // the one file read from code/: a data archive the game extracts colordefs from
      const jar = join(root, "code", "projectx-config.jar");
      if (!existsSync(jar)) { res.statusCode = 404; res.end(); return; }
      send(res, jar);
      return;
    }
    // the game's text: message bundles read from the config jar ("/i18n/" lists them)
    if (url === "/i18n/") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(bundles.names()));
      return;
    }
    if (url.startsWith("/i18n/")) {
      const m = /^\/i18n\/([a-z0-9_-]+)\.properties$/.exec(url);
      let body: Uint8Array | null = null;
      try { body = m ? bundles.read(m[1]) : null; } catch { body = null; }
      if (!body) { res.statusCode = 404; res.end(); return; }
      res.setHeader("content-type", "text/plain; charset=iso-8859-1");
      res.end(body);
      return;
    }
    // levels: the archive (every level ever cached), refreshed from the install on each listing
    if (url === "/sceneindex") {
      syncArchive(root, archive);
      void sceneIndex(archive).then(list => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(list));
      }, () => { res.statusCode = 500; res.end(); });
      return;
    }
    if (url === "/scenelist") {
      syncArchive(root, archive);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(existsSync(archive) ? readdirSync(archive).filter(n => SCENE.test(n)) : []));
      return;
    }
    if (url.startsWith("/scenes/")) {
      const name = url.substring(8);
      const file = [join(archive, name), join(root, "scenes", name)].find(f => SCENE.test(name) && existsSync(f));
      if (!file) { res.statusCode = 404; res.end(); return; }
      send(res, file);
      return;
    }
    if (url.startsWith("/rsrc/")) {
      const file = normalize(join(rsrc, url.substring(6)));
      if (!file.startsWith(normalize(rsrc) + sep) || !existsSync(file)) { res.statusCode = 404; res.end(); return; }
      send(res, file);
      return;
    }
    res.statusCode = 404; res.end();
  };
}
