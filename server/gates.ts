// The Arcade's real gates, from the community Gate Map (https://gatemap.knightlauncher.com/,
// silverhawke's gatemap-viewer): the list of every gate since 2019 and each gate's data file,
// captured from the game. The local server fetches them on the player's behalf (the site sends
// no CORS headers) and keeps a copy in the player's app-data folder beside the level archive,
// so the Arcade still has its gates when the site cannot be reached. Nothing is committed.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { archiveDir } from "./install";

export const GATEMAP = "https://gatemap.knightlauncher.com";

/** Where the gate list and data files are cached: %LOCALAPPDATA%\clyde-web\gates (or SK_GATES). */
export function gatesDir(): string {
  return process.env.SK_GATES ?? join(dirname(archiveDir()), "gates");
}

/** A gate data file's name: 20261013_coral_king. */
const GATE_FILE = /^(\d{8})_([a-z]+)_([a-z]+)$/;
/** The cached list is refetched after this long (new gates come every two days). */
const LIST_TTL = 30 * 60 * 1000;
const TIMEOUT = 10000;

async function fetchText(url: string): Promise<string | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "clyde-web (single-player Spiral Knights remake)" } });
    return r.ok ? await r.text() : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

const validList = (t: string | null) => {
  if (!t) return false;
  try { const a = JSON.parse(t); return Array.isArray(a) && a.length > 0 && a.every(e => Array.isArray(e) && e.length === 3); } catch { return false; }
};
const validGate = (t: string | null) => !!t && t.startsWith("##JSON");

function cached(file: string): string | null {
  try { return existsSync(file) ? readFileSync(file, "utf8") : null; } catch { return null; }
}

function store(file: string, text: string) {
  try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); } catch { /* read-only: serve uncached */ }
}

/** The gate list: fresh from the site when the cached copy is old, else (or offline) the cache. */
export async function gateList(dir = gatesDir()): Promise<string | null> {
  const file = join(dir, "gate_list.txt");
  const had = cached(file);
  const age = had ? Date.now() - statSync(file).mtimeMs : Infinity;
  if (had && age < LIST_TTL) return had;
  const fresh = await fetchText(`${GATEMAP}/gate/gate_list.txt`);
  if (validList(fresh)) { store(file, fresh!); return fresh; }
  return had;
}

/** One gate's data file ("##JSON" and its JSON), cached forever once fetched. */
export async function gateData(name: string, dir = gatesDir()): Promise<string | null> {
  if (!GATE_FILE.test(name)) return null;
  const file = join(dir, "data", name + ".txt");
  const had = cached(file);
  if (validGate(had)) return had;
  const fresh = await fetchText(`${GATEMAP}/gate/data/${name}.txt`);
  if (validGate(fresh)) { store(file, fresh!); return fresh; }
  return null;
}

/** Handles /gates/list and /gates/data/<name>.txt (under the /__sk route). True when handled. */
export function handleGates(url: string, _req: IncomingMessage, res: ServerResponse, dir = gatesDir()): boolean {
  let job: Promise<string | null> | null = null;
  if (url === "/gates/list") job = gateList(dir);
  else {
    const m = /^\/gates\/data\/([a-z0-9_]+)\.txt$/.exec(url);
    if (m) job = gateData(m[1], dir);
    else if (url.startsWith("/gates/")) job = Promise.resolve(null);
  }
  if (!job) return false;
  void job.then(text => {
    if (text === null) { res.statusCode = 404; res.end(); return; }
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end(text);
  }, () => { res.statusCode = 500; res.end(); });
  return true;
}
