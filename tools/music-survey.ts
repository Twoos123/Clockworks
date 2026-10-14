// Surveys the music of every archived level: each scene's music global (Environment/Music,
// Environment/Music Mix, or a named music global from config/scene_global.dat, resolved to its
// files and gain) and the "Environment/Music" actors its logic spawns (file, gain, tag,
// override, Destruction Transient), with what spawns them and what destroys them (a
// DestroyActor on the tag). Prints per scene, then per tileset (the scenes' commonest tile
// prefix), then the music globals of config/scene_global.dat.
//
// Reads the scenes this app archived (%LOCALAPPDATA%\clyde-web\scenes, index in
// ..\scene-index.json) and the install's config. Guild halls ("hall (...)") are skipped.
//
// Usage: npx tsx tools/music-survey.ts [--json out.json] [--filter <regex on scene name>]
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { importBinary } from "../src/export/BinaryImport.ts";
import { nodeInflate, skDir } from "./common.ts";

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const filter = opt("--filter") ? new RegExp(opt("--filter")!, "i") : null;

const dir = join(process.env.LOCALAPPDATA!, "clyde-web", "scenes");
const index = JSON.parse(readFileSync(join(dir, "..", "scene-index.json"), "utf8")) as Record<string, { name: string }>;
const files = new Map(readdirSync(dir).map(f => [f.replace(/\..*$/, ""), f]));

// ---- config/scene_global.dat: the named music globals ----
const raw: any = (await importBinary(new Uint8Array(readFileSync(join(skDir(), "rsrc", "config/scene_global.dat"))), nodeInflate)).root;
const lib = new Map<string, any>((raw.array ?? raw).map((c: any) => [c.name, c]));
const entriesOf = (ref: any): [string, any][] => (ref?.arguments?.entries ?? []) as [string, any][];

export interface Music { global: string; files: { file: string; weight: number }[]; gain: number; crossFade: number }
const short = (f: string) => f.replace(/^sound\/music\//, "").replace(/\.ogg$/, "");

/** A scene global reference resolved to the music it plays (null when it plays none). */
function resolveMusic(ref: any): Music | null {
  const args = new Map<string, any>();
  let cur = ref, depth = 0;
  while (cur && depth++ < 10) {
    for (const [k, v] of entriesOf(cur)) if (!args.has(k)) args.set(k, v);
    const cfg = lib.get(cur.name);
    if (!cfg) return null;
    if (cfg.$class.endsWith("DerivedConfig")) { cur = cfg.base; continue; }
    const model = cfg.model;
    if (!model) return null;
    for (const [k, v] of entriesOf(model)) if (!args.has(k)) args.set(k, v);
    if (model.name === "world/environment/global_music.dat") {
      const file = args.get("File");
      return file ? { global: ref.name, files: [{ file, weight: 1 }], gain: args.get("Gain") ?? 1, crossFade: 0 } : null;
    }
    if (model.name === "world/environment/global_music_mix.dat") {
      const fs = ((args.get("Files") ?? []) as any[]).filter(f => f?.file).map(f => ({ file: f.file as string, weight: f.weight ?? 1 }));
      return fs.length ? { global: ref.name, files: fs, gain: args.get("Gain") ?? 1, crossFade: args.get("Cross Fade") ?? 1 } : null;
    }
    return null;
  }
  return null;
}

// ---- the scenes ----
export interface Scripted {
  file: string; gain: number; tag: string; override: boolean; stack: string; fadeIn: number; fadeOut: number;
  transient: string | null; spawnedBy: string; destroyedBy: string[];
}
interface SceneMusic { id: string; name: string; tileset: string; music: Music[]; scripted: Scripted[]; other: string[] }

const cls = (o: any) => String(o?.$class ?? "").replace(/^.*[.$]/, "");
/** What an entry is, for the report: its kind, config and tag. */
function describe(e: any): string {
  const ref = e.placeable ?? e.area ?? e.path ?? e.actor ?? e.tile;
  const tag = entriesOf(ref).find(([k]) => k === "Tag")?.[1];
  const target = entriesOf(ref).find(([k]) => /Target|Actor Tag|Watched/.test(k))?.[1];
  const tgt = target?.tag ? ` watching "${target.tag}"` : "";
  return `${cls(e).replace(/Entry$/, "").toLowerCase()} ${ref?.name ?? "?"}${tag ? ` [${tag}]` : ""}${tgt} #${e.id}`;
}

function survey(id: string, name: string): SceneMusic | null {
  const f = files.get(id);
  if (!f) return null;
  const r: any = (importBinarySync(join(dir, f)));
  const out: SceneMusic = { id, name, tileset: "", music: [], scripted: [], other: [] };
  const tiles = new Map<string, number>();
  for (const m of (r.tileConfigs?.items ?? []) as any[]) {
    const p = String(m?.tile?.name ?? "").split("/")[0];
    if (p) tiles.set(p, (tiles.get(p) ?? 0) + 1);
  }
  out.tileset = [...tiles].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "(no tiles)";
  const destroys = new Map<string, string[]>();
  const spawns: [any, string][] = [];
  for (const e of (r.entries ?? []) as any[]) {
    if (cls(e) === "GlobalEntry") {
      const g = e.sceneGlobal;
      if (/music/i.test(g?.name ?? "")) {
        const m = resolveMusic(g);
        if (m) out.music.push(m); else out.other.push(`global ${g.name} (resolves to no music)`);
      }
      continue;
    }
    const seen = new WeakSet();
    const walk = (o: any, path: string) => {
      if (!o || typeof o !== "object" || seen.has(o)) return;
      seen.add(o);
      const c = cls(o);
      if (c === "SpawnActor" && /music/i.test(o.actor?.name ?? "")) { spawns.push([o, `${describe(e)} ${path}`]); return; }
      if (c === "DestroyActor") {
        const tag = o.target?.tag;
        if (tag) { const l = destroys.get(tag) ?? []; l.push(describe(e)); destroys.set(tag, l); }
      } else if (c === "StartConversation" && o.music) {
        // a conversation's own music (ProjectXActionConfig.StartConversation.music, a sounder)
        out.other.push(`${describe(e)}: conversation music ${o.music.name}${entriesOf(o.music).length ? ` ${JSON.stringify(Object.fromEntries(entriesOf(o.music)))}` : ""}`);
      } else if (c === "ConfigReference" && typeof o.name === "string" && /music/i.test(o.name)) {
        // a music actor placed by other means (a Single Spawn Actor), or a "Triggers/Music Area"
        // (config/area.dat: spawns Environment/Music while a knight is inside, destroys it on leaving)
        const a = Object.fromEntries(entriesOf(o).filter(([k, v]) => /File|Gain|Tag|Override|Fade/.test(k) && v !== null && typeof v !== "object"));
        out.other.push(`${describe(e)}: ${o.name}${Object.keys(a).length ? ` ${JSON.stringify(a).replace(/sound\/music\//g, "")}` : ""}`);
      }
      for (const [k, v] of Object.entries(o)) {
        if (k === "$outer") continue;
        // the argument names along the way ("Action", "Trigger Action")
        const step = Array.isArray(v) && v.length === 2 && typeof v[0] === "string" ? v[0] : null;
        walk(v, step ? `${path}.${step}` : path);
      }
    };
    walk(e, "");
  }
  for (const [s, by] of spawns) {
    const a = new Map(entriesOf(s.actor));
    const dt = a.get("Destruction Transient");
    const tf = entriesOf(dt).find(([k]) => k === "File")?.[1];
    const tag = a.get("Tag") ?? "";
    out.scripted.push({
      file: a.get("File") ?? "?", gain: a.get("Gain") ?? 1, tag, override: !!a.get("Override"), stack: a.get("Stack") ?? "default",
      fadeIn: a.get("Fade In") ?? 0, fadeOut: a.get("Fade Out") ?? 0, transient: tf ?? null,
      spawnedBy: by.replace(/\s+$/, ""), destroyedBy: destroys.get(tag) ?? [],
    });
  }
  return out;
}

// importBinary is async but does no I/O of its own; collect the scenes up front
const parsed = new Map<string, any>();
function importBinarySync(p: string) { return parsed.get(p); }
const levels = Object.entries(index).filter(([, v]) => !/^hall \(/.test(v.name) && (!filter || filter.test(v.name)));
const results: SceneMusic[] = [];
for (const [id, v] of levels) {
  const f = files.get(id);
  if (!f) continue;
  const p = join(dir, f);
  try { parsed.set(p, (await importBinary(new Uint8Array(readFileSync(p)), nodeInflate)).root); } catch { continue; }
  const s = survey(id, v.name);
  parsed.delete(p);
  if (s) results.push(s);
}

const fmtMusic = (m: Music) => `${m.global}: ${m.files.map(f => short(f.file) + (f.weight !== 1 ? `×${+f.weight.toFixed(2)}` : "")).join(", ")} @${+m.gain.toFixed(2)}${m.files.length > 1 ? ` xfade ${m.crossFade}` : ""}`;
const fmtScripted = (s: Scripted) =>
  `${short(s.file)} @${+s.gain.toFixed(2)} tag "${s.tag}"${s.override ? " override" : ""}${s.stack !== "default" ? ` stack ${s.stack}` : ""}`
  + ` in ${s.fadeIn}/out ${s.fadeOut}${s.transient ? ` then ${short(s.transient)}` : ""}`
  + `\n        spawned by ${s.spawnedBy}`
  + `\n        destroyed by ${s.destroyedBy.length ? s.destroyedBy.join("; ") : "(nothing: plays to the end of the level)"}`;

// ---- per scene (identical scenes, by name and music, once) ----
console.log("# Per scene\n");
const byName = new Map<string, SceneMusic[]>();
for (const s of results) { const l = byName.get(s.name) ?? []; l.push(s); byName.set(s.name, l); }
for (const [name, list] of [...byName].sort((a, b) => a[0].localeCompare(b[0]))) {
  const variants = new Map<string, SceneMusic[]>();
  for (const s of list) {
    const key = JSON.stringify([s.music.map(fmtMusic), s.scripted.map(x => [x.file, x.tag, x.override])]);
    const l = variants.get(key) ?? []; l.push(s); variants.set(key, l);
  }
  for (const vs of variants.values()) {
    const s = vs[0];
    console.log(`${name} [${vs.map(v => v.id).join(",")}] tiles: ${s.tileset}`);
    console.log(`    music: ${s.music.length ? s.music.map(fmtMusic).join(" | ") : "(none)"}`);
    for (const x of s.scripted) console.log(`    scripted: ${fmtScripted(x)}`);
    for (const o of s.other) console.log(`    other: ${o}`);
  }
}

// ---- per tileset ----
console.log("\n# Per tileset (scenes by their commonest tile prefix)\n");
const byTiles = new Map<string, SceneMusic[]>();
for (const s of results) { const l = byTiles.get(s.tileset) ?? []; l.push(s); byTiles.set(s.tileset, l); }
for (const [t, list] of [...byTiles].sort((a, b) => a[0].localeCompare(b[0]))) {
  const music = new Map<string, Set<string>>();
  const scripted = new Map<string, number>();
  for (const s of list) {
    for (const m of s.music.length ? s.music.map(fmtMusic) : ["(none)"]) { const n = music.get(m) ?? new Set(); n.add(s.name); music.set(m, n); }
    for (const x of s.scripted) { const k = `${short(x.file)}${x.transient ? ` (then ${short(x.transient)})` : ""}`; scripted.set(k, (scripted.get(k) ?? 0) + 1); }
  }
  console.log(`${t} (${list.length} scenes)`);
  for (const [m, n] of music) console.log(`    ${m}  <- ${[...n].slice(0, 6).join("; ")}${n.size > 6 ? ` (+${n.size - 6})` : ""}`);
  if (scripted.size) console.log(`    scripted: ${[...scripted].map(([k, c]) => `${k} ×${c}`).join(", ")}`);
}

// ---- totals ----
const nScripted = results.reduce((a, s) => a + s.scripted.length, 0);
console.log(`\n${results.length} scenes; ${results.filter(s => s.music.length).length} with a music global; ${results.filter(s => s.scripted.length).length} spawn ${nScripted} music actors`);
const files2 = new Map<string, number>();
for (const s of results) for (const x of s.scripted) files2.set(short(x.file), (files2.get(short(x.file)) ?? 0) + 1);
console.log(`scripted files: ${[...files2].sort((a, b) => b[1] - a[1]).map(([f, c]) => `${f} ×${c}`).join(", ")}`);

// ---- the library's music globals ----
console.log("\n# config/scene_global.dat music globals\n");
for (const name of [...lib.keys()].sort()) {
  const m = resolveMusic({ name });
  if (m) console.log(`    ${fmtMusic(m)}`);
}

if (opt("--json")) writeFileSync(opt("--json")!, JSON.stringify(results, null, 1));
