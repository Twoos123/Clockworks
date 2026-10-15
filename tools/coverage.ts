// Prefab coverage: for each level type the servers build from prefab rooms and each status
// (src/game/coverage.ts), which captured floors (mission floors included) give it rooms and an
// environment, and whether the generator would build a faithful floor of it. Reads the player's
// archive (read only) and the install's config libraries.
//
//   npm run coverage [-- --seeds 20]
//
// For every pair it cuts the rooms out of the captures as the game does (src/gen/prefabs.ts),
// keeps those in the style's tiles, assembles floors from them with the library the generator
// would use (the status's own rooms, else every status's) and picks the environment the
// generator would give it.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { archiveDir } from "../server/install.ts";
import { classifyCapture, classifyLevel, INSTANCE_IDS } from "../src/game/archive.ts";
import { coverageRow, coverageSources, envDir, envFits, environmentFor, envOrder, recastRooms, PREFAB_TYPES, prefabType, roomFits, STATUSES, statusLabel,
  type CaptureFacts } from "../src/game/coverage.ts";
import { importBinary } from "../src/export/BinaryImport.ts";
import { SpawnTypes, statusTag } from "../src/game/derive.ts";
import { assembleFloor, libraryPieces, type LibPiece } from "../src/gen/assemble.ts";
import { prettySceneName } from "../src/scene.ts";
import { nodeInflate, skDir } from "./common.ts";

/** A captured prefab floor in the archive: its id, display name and parsed root. */
export interface CaptureScene { id: string; name: string; root: any }

/** The archive's captured prefab floors (the server-generated floors of the styles the generator assembles). */
export async function captureScenes(archive = archiveDir()): Promise<CaptureScene[]> {
  const index = join(dirname(archive), "scene-index.json");
  if (!existsSync(index)) return [];
  const raw = JSON.parse(readFileSync(index, "utf8")) as Record<string, { name?: string }>;
  const out: CaptureScene[] = [];
  for (const [id, v] of Object.entries(raw)) {
    const name = prettySceneName(v?.name ?? "");
    const c = Number(id) >= INSTANCE_IDS ? classifyCapture(name) : null;
    if (!c || !prefabType(c.style) || !existsSync(join(archive, id))) continue;
    out.push({ id, name, root: (await importBinary(new Uint8Array(readFileSync(join(archive, id))), nodeInflate)).root });
  }
  return out;
}

const globalsOf = (root: any): any[] => ((root?.entries ?? []) as any[]).filter(e => String(e?.$class).endsWith("GlobalEntry"));
const tileNames = (root: any): string[] => ((root?.tileConfigs?.items ?? root?.tileConfigs ?? []) as any[]).map(m => String(m?.tile?.name ?? "")).filter(Boolean);

/** Each capture's facts (tile groups and global names), by lower-case name, for the checklist. */
export function captureFacts(scenes: CaptureScene[]): Map<string, CaptureFacts> {
  const out = new Map<string, CaptureFacts>();
  for (const s of scenes) {
    const key = s.name.toLowerCase();
    const f = { tiles: tileNames(s.root), globals: globalsOf(s.root).map(g => String(g?.sceneGlobal?.name ?? "")) };
    // several captures of one name: their tiles together, and the globals of one that is its
    // style's environment if any is
    const had = out.get(key), c = classifyCapture(s.name)!;
    const fits = (g: string[]) => envFits(c.style, c.element, c.family, g);
    out.set(key, had ? { tiles: [...new Set([...had.tiles, ...f.tiles])], globals: fits(had.globals) || !fits(f.globals) ? had.globals : f.globals } : f);
  }
  return out;
}

async function main() {
  const seedsArg = process.argv.indexOf("--seeds");
  const seeds = seedsArg > 0 ? Number(process.argv[seedsArg + 1]) : 20;
  const archive = archiveDir();
  const scenes = await captureScenes(archive);
  if (!scenes.length) { console.log(`No captured prefab floors in ${archive}`); return; }
  const { nodeLoader } = await import("./audit/nodevfs.ts");
  const { SceneLoader } = await import("../src/scene.ts");
  const loader = new SceneLoader(nodeLoader());
  const sceneGlobals = await loader.configs("config/scene_global.dat");
  const has = (n: string) => sceneGlobals.has(n);
  const types = new SpawnTypes(await loader.configs("config/spawn_table.dat"));
  console.log(`Archive: ${archive}\nInstall: ${skDir()}\nCaptured prefab floors: ${scenes.length}\n`);

  // every capture's rooms, cut as the generator cuts them, and which fit the style's tiles
  const refKey = (ref: any) => JSON.stringify(ref, (k, v) => (k === "$outer" ? undefined : v));
  const pieces = new Map<string, { fit: LibPiece[]; foreign: number }>();
  for (const s of scenes) {
    const c = classifyCapture(s.name)!;
    const infos = new Map<string, any>();
    for (const m of (s.root.tileConfigs?.items ?? s.root.tileConfigs ?? []) as any[])
      if (m?.tile && !infos.has(refKey(m.tile))) infos.set(refKey(m.tile), await loader.tileInfo(m.tile));
    const all = libraryPieces(s.id, s.root, ref => infos.get(refKey(ref)) ?? { width: 1, height: 1, walkable: false });
    const fit = all.filter(p => roomFits(c.style, c.element, p.tiles.map(t => String(t.ref?.name ?? ""))));
    pieces.set(s.id, { fit, foreign: all.length - fit.length });
  }

  const facts = captureFacts(scenes);
  const src = coverageSources(scenes.map(s => s.name), facts);
  const caps = scenes.map(s => ({ ...s, ...classifyCapture(s.name)! }));
  const kinds = (lib: LibPiece[]) => ["start", "room", "airlock", "dead", "exit"].map(k => `${lib.filter(p => p.kind === k).length} ${k}`).join(", ");
  const summary: string[] = [];
  for (const t of PREFAB_TYPES) {
    console.log(`== ${t.name} (rooms ${t.statusTiles ? "per status: its tiles are the status's" : "shared by every status"}; environment ${t.env ? `"${t.env}/<status>" globals` : "in its captures' own globals"})`);
    for (const status of STATUSES) {
      const row = coverageRow(t, status, src);
      const own = caps.filter(c => c.style === t.style && c.element === status);
      console.log(`  ${statusLabel(status)}: ${row.state.toUpperCase()}${row.note ? ` - ${row.note}` : ""}`);
      for (const c of own) {
        const f = facts.get(c.name.toLowerCase())!, p = pieces.get(c.id)!;
        const env = src.find(x => x.name.toLowerCase() === c.name.toLowerCase())!.env;
        console.log(`    ${c.id} ${c.name}${classifyLevel(c.name) ? "" : " (mission floor)"}: ${p.fit.length} rooms${p.foreign ? ` (+${p.foreign} in other tiles, left out)` : ""}, `
          + `environment ${env ? "its style's" : `not its style's (${f.globals.find(g => /Light Set$/.test(g)) ?? "generic globals"})`}`);
      }
      // the library the generator uses: the status's own rooms, else (too few) the style's every room
      const ownLib = own.flatMap(c => pieces.get(c.id)!.fit);
      const anyLib = caps.filter(c => c.style === t.style).flatMap(c => pieces.get(c.id)!.fit);
      let built = 0, fallback = 0;
      for (let seed = 1; seed <= seeds; seed++) {
        // as the generator does (src/main.ts prefabRoot): its own rooms, a few seeds on, then
        // every status's rooms where they are the same
        if (assembleFloor(ownLib, () => [], seed, false)) built++;
        else if (!t.statusTiles && assembleFloor(anyLib, () => [], seed, false)) fallback++;
      }
      const fams = t.family ? [t.family] : (["Beast", "Construct", "Fiend", "Gremlin", "Slime", "Undead"] as const);
      const envs = new Map<string, string>();
      for (const fam of fams) {
        let pick: ReturnType<typeof environmentFor> = null;
        const order = envOrder(status, caps.filter(c => c.style === t.style));
        for (const c of order.filter(c => c.element === status)) {
          const r = environmentFor(t.style, status, fam, [{ ...c, globals: globalsOf(c.root) }], has);
          if (r && !r.derived) { pick = r; break; }
        }
        for (const c of pick ? [] : order) { pick = environmentFor(t.style, status, fam, [{ ...c, globals: globalsOf(c.root) }], has); if (pick) break; }
        const d = envDir(t.style, status, fam);
        const text = pick ? `${pick.derived ? "derived from" : "from"} "${pick.source}" (${t.env ? `${t.env}/${d}` : "its globals"})` : "none of its own (the start room's floor's)";
        envs.set(text, [envs.get(text), fam].filter(Boolean).join(", "));
      }
      console.log(`    rooms: ${kinds(ownLib)} of its own${t.statusTiles ? "" : `; ${anyLib.length} in every status`}`);
      console.log(`    assembled: ${built} of ${seeds} seeds from its own rooms${fallback ? `, ${fallback} more from every status's rooms` : ""}`
        + `${built + fallback < seeds ? `, ${seeds - built - fallback} fall back to the older generator` : ""}`);
      for (const [text, fams2] of envs) console.log(`    environment${t.family ? "" : ` (${fams2})`}: ${text}`);
      // the monsters: a floor's spawns as captured, and re-cast for each family and the status
      // as the generator does; how many name another status's monster, how many the family's own
      const sample = assembleFloor(ownLib, () => anyLib, 1, !t.statusTiles);
      if (sample) {
        const capsById = new Map(caps.map(c => [c.id, c]));
        const rate = (placed: typeof sample.placed, fam: string) => {
          let n = 0, other = 0, own = 0;
          const want = statusTag(status);
          for (const p of placed) for (const e of p.piece.entries) {
            const ref = (e.placeable?.arguments?.entries as [string, any][] | undefined)?.find(([k]) => k === "Spawn Table")?.[1];
            const ty = typeof ref?.name === "string" ? types.types(ref.name) : [];
            const st = ty.find(x => ["vanilla", "fire", "freeze", "poison", "shock"].includes(x));
            if (!st || ref.name.startsWith("Block/")) continue;
            n++;
            if (st !== want && st !== "vanilla") { other++; if (process.env.DEBUG) console.log("      other:", ref.name, ty.join(",")); }
            if (ty.includes(fam.toLowerCase())) own++;
          }
          return `${n} typed spawns, ${other} of another status, ${own} of the ${fam}s`;
        };
        for (const fam of fams) {
          const recast = recastRooms(sample.placed, capsById, t.style, fam, status, types, 1);
          console.log(`    monsters (${fam}): captured ${rate(sample.placed, fam)}; re-cast ${rate(recast, fam)}`);
        }
      }
      // rooms of other statuses are the type's own when its tiles do not depend on the status
      const good = built + fallback;
      const verdict = row.state === "missing" ? "not faithful"
        : row.state === "derived" ? `derived (environment from the library), ${good}/${seeds} assemble`
        : good === seeds ? "faithful" : `faithful, but ${seeds - good}/${seeds} seeds fall back to the older generator`;
      console.log(`    verdict: ${verdict}`);
      summary.push(`  ${t.name.padEnd(20)} ${statusLabel(status).padEnd(10)} ${row.state.padEnd(9)} ${String(row.captures.length).padStart(2)} captures  ${verdict}`);
    }
    console.log("");
  }
  console.log(`Summary (type, status, coverage, captures of it, verdict over ${seeds} seeds):`);
  for (const l of summary) console.log(l);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
