// Haven's exit map, read from the player's level archive: every exit area ("Portals/...") of
// Haven's districts and the places their doors lead to, with its tags, scene id, internal scene
// name and portal, resolved as the game resolves it (src/game/portals.ts exitTarget) against the
// archive's real scene index, and the door the knight arrives at there.
//
//   npx tsx tools/exits.ts [scene ids...]
//
// With no ids it starts from the town square (scene 1) and follows every exit to the places
// beyond, and back. Needs the install (for the config libraries) and the level archive
// (server/install.ts archiveDir(): %LOCALAPPDATA%/clyde-web/scenes, its scene-index.json beside it).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { archiveDir } from "../server/install.ts";
import { arrivalPoint, exitsOf, exitTarget, type PortalInfo } from "../src/game/portals.ts";
import { cachedHallId } from "../src/game/places.ts";
import type { LoadedScene, LogicEntry } from "../src/scene.ts";
import { skDir } from "./common.ts";

export interface ExitRow {
  from: string;
  fromName: string;
  area: string;
  /** Where the exit area is (its centre). */
  at: [number, number];
  info: PortalInfo;
  /** The scene it leads to (the guild hall: the archived hall the player's hall is built from). */
  to: string | null;
  toName: string;
  kind: string;
  /** The door the knight arrives at: its tag ("" for the default entrance), position, heading. */
  arrival: { tag: string; x: number; y: number; heading: number; exact: boolean } | null;
}

/** Whether the archive and install this map needs are present. */
export function archivePresent(): boolean {
  const archive = archiveDir();
  return existsSync(join(archive, "1")) && existsSync(join(dirname(archive), "scene-index.json"))
    && existsSync(join(skDir(), "rsrc", "config", "area.dat"));
}

/** The archive's scene index ([{id, name}]) and every archived id. */
export function archiveIndex(): { scenes: { id: string; name: string }[]; ids: Set<string> } {
  const archive = archiveDir();
  const raw = JSON.parse(readFileSync(join(dirname(archive), "scene-index.json"), "utf8")) as Record<string, { name: string }>;
  const scenes = Object.entries(raw).filter(([, v]) => v?.name).map(([id, v]) => ({ id, name: v.name }));
  const ids = new Set(readdirSync(archive).filter(n => /^\d+$/.test(n)));
  return { scenes, ids };
}

/** Walks the exits from `start` (default: the town square), loading each scene reached once. */
export async function exitMap(start: string[] = ["1"], follow = true): Promise<{ rows: ExitRow[]; scenes: Map<string, LoadedScene> }> {
  const { nodeLoader } = await import("./audit/nodevfs.ts");
  const { SceneLoader } = await import("../src/scene.ts");
  const loader = new SceneLoader(nodeLoader());
  const { scenes: index, ids } = archiveIndex();
  const hall = cachedHallId(index);
  const loaded = new Map<string, LoadedScene>();
  const load = async (id: string) => {
    let s = loaded.get(id);
    if (!s) loaded.set(id, s = await loader.load(id, new Uint8Array(readFileSync(join(archiveDir(), id)))));
    return s;
  };
  const rows: ExitRow[] = [];
  const queue = [...start], seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const s = await load(id);
    for (const { entry, info } of exitsOf(s.logic)) {
      const t = exitTarget(info, index, ids, s.name);
      const to = t.kind === "scene" ? t.id : t.kind === "guildhall" ? hall : null;
      const portal = t.kind === "scene" || t.kind === "guildhall" ? t.portal : "";
      let arrival: ExitRow["arrival"] = null;
      if (to) {
        const dest = await load(to);
        const a = arrivalPoint(dest.logic, portal);
        const exact = !portal || dest.logic.some((e: LogicEntry) => /Portal\/(Destination|Level Start)/.test(e.name) && e.tags.includes(portal));
        if (a) arrival = { tag: portal, ...a, exact };
        if (follow) queue.push(to);
      }
      rows.push({ from: id, fromName: s.name, area: entry.name, at: [entry.x, entry.y], info, to, toName: to ? (await load(to)).name : "",
        kind: t.kind === "missing" ? `missing ${t.place}` : t.kind, arrival });
    }
  }
  return { rows, scenes: loaded };
}

const isMain = process.argv[1] && /exits\.ts$/.test(process.argv[1]);
if (isMain) {
  if (!archivePresent()) { console.log("No level archive or install found."); process.exit(1); }
  const args = process.argv.slice(2);
  const { rows } = await exitMap(args.length ? args : ["1"], !args.length);
  const f = (n: number) => n.toFixed(1);
  for (const r of rows) {
    const i = r.info;
    const what = [i.tags.length ? `tags=${i.tags.join("|")}` : "", Number.isFinite(i.sceneId) ? `sceneId=${i.sceneId}` : "",
      i.townName !== undefined ? `town=${i.townName}` : "", i.sceneInternalId !== undefined ? `sceneInternalId=${i.sceneInternalId}` : "",
      i.floor !== undefined ? `floor=${i.floor}` : "", i.action ? `action=${i.action}` : "", `portal=${i.portal || "-"}`].filter(Boolean).join(" ");
    const dest = r.to ? `${r.to} ${r.toName}` : r.kind;
    const at = r.arrival ? ` at ${r.arrival.tag || "(default entrance)"} ${f(r.arrival.x)},${f(r.arrival.y)} facing ${f(r.arrival.heading)}${r.arrival.exact ? "" : " (NO SUCH DOOR: default entrance)"}` : r.to ? " (no arrival point)" : "";
    console.log(`${r.from} ${r.fromName} | ${r.area} @${f(r.at[0])},${f(r.at[1])} | ${what}\n    -> ${dest}${at}`);
  }
}
