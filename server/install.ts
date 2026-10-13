// Finding and serving the player's own Spiral Knights install. Used by the dev server
// (vite.config.ts) and the launcher (server/play.ts); both listen on localhost only, so the
// game's files go from the player's disk to the player's browser and nowhere else.

import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join, normalize, sep } from "node:path";

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

/** Handles /__sk requests: the install's rsrc files, scenes cache and colour definitions. */
export function installMiddleware(dir: () => string | null) {
  let listing: string[] | null = null;
  const walk = (d: string, prefix: string, out: string[]) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p, prefix + name + "/", out);
      else out.push(prefix + name);
    }
    return out;
  };
  const send = (res: ServerResponse, file: string) => createReadStream(file).on("error", () => { res.statusCode = 404; res.end(); }).pipe(res);
  return (req: IncomingMessage, res: ServerResponse) => {
    const root = dir();
    const url = decodeURIComponent((req.url ?? "").split("?")[0]);
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
    const scenes = join(root, "scenes");
    if (url === "/scenelist") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(existsSync(scenes) ? readdirSync(scenes).filter(n => /^[0-9]+$/.test(n)) : []));
      return;
    }
    if (url.startsWith("/scenes/")) {
      const name = url.substring(8);
      const file = join(scenes, name);
      if (!/^[0-9]+$/.test(name) || !existsSync(file)) { res.statusCode = 404; res.end(); return; }
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
