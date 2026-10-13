// Lists config/tile.dat's tile configs grouped by theme prefix (the part of the name before the
// first "/": "Sky Islands, Night", "Clockworks, Fire", "Graveyard"...), with each tile's
// footprint and whether it is walkable floor (floor flag set and no collision flags, as
// SceneLoader.tileInfo decides). Reads only the user's own install.
// Usage: tsx tools/tile-themes.ts [theme filter] [--json out.json]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { importBinary } from "../src/export/BinaryImport.ts";
import { applyArguments } from "../src/config/params.ts";
import { nodeInflate, skDir } from "./common.ts";

const args = process.argv.slice(2);
const ji = args.indexOf("--json");
const jsonOut = ji >= 0 ? args.splice(ji, 2)[1] : null;
const filter = args[0]?.toLowerCase();
const r: any = (await importBinary(new Uint8Array(readFileSync(join(skDir(), "rsrc/config/tile.dat"))), nodeInflate)).root;
const list: any[] = Array.isArray(r) ? r : r.array ?? r.configs ?? [];
const by = new Map(list.map(c => [c.name, c]));

function resolve(ref: any, depth = 0): any {
  const base = by.get(ref?.name);
  if (!base || depth > 8) return null;
  const impl = applyArguments(base, ref).implementation;
  if (impl?.$class?.endsWith("$Derived") && impl.tile) return resolve(impl.tile, depth + 1);
  return impl ?? null;
}

interface Row { name: string; width: number; height: number; walkable: boolean; model: string }
const themes = new Map<string, Row[]>();
for (const c of list) {
  const impl = resolve({ name: c.name });
  const flags: any[] = impl?.collisionFlags ?? [[1]];
  const blocked = Array.from(flags as ArrayLike<ArrayLike<number>>).some(row => Array.from(row ?? []).some(f => f !== 0));
  const walkable = !!impl && ((impl.floorFlags ?? 1) & 1) !== 0 && !blocked;
  const theme = c.name.split("/")[0];
  const t = themes.get(theme) ?? [];
  t.push({ name: c.name, width: impl?.width ?? 1, height: impl?.height ?? 1, walkable, model: impl?.model?.name ?? "" });
  themes.set(theme, t);
}
const out: Record<string, Row[]> = {};
for (const [theme, tiles] of [...themes].sort(([a], [b]) => a.localeCompare(b))) {
  if (filter && !theme.toLowerCase().includes(filter)) continue;
  out[theme] = tiles;
  console.log(`${theme}  (${tiles.length} tiles, ${tiles.filter(t => t.walkable).length} walkable)`);
  for (const t of tiles) console.log(`  ${t.walkable ? "W" : "."} ${t.width}x${t.height}  ${t.name.slice(theme.length + 1)}`);
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 1));
