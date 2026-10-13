// Generated levels: a new TudeySceneModel built from a theme's cached scenes. The floor plan
// comes from the layout generator, the tiles from learned auto-tiling, and the rest is the
// game's own wiring copied from the sources and retagged: each encounter room gets a "Player
// Enter/Spawn Activate" area that signals its "Single Spawn" markers (with spawn tables taken
// from the source levels' markers), treasure boxes, the start platform and the exit elevator,
// and the source's lighting, fog, music and camera globals.

import { learn, paint, type TileModel } from "./autotile";
import { generateLayout, rng, type Layout, type Room } from "./layout";

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o, (k, v) => (k === "$outer" ? undefined : v)));
const CLS = "com.threerings.tudey.data.TudeySceneModel$";

const argMap = (entries: [string, unknown][]) => ({ $map: "com.threerings.config.ArgumentMap", entries });
const getArg = (ref: any, name: string) => (ref?.arguments?.entries as [string, any][] | undefined)?.find(([k]) => k === name)?.[1];
const withArgs = (ref: any, set: Record<string, unknown>) => {
  const r = clone(ref);
  const entries: [string, unknown][] = (r.arguments?.entries ?? []).map(([k, v]: [string, unknown]) => [k, k in set ? set[k] : v]);
  for (const [k, v] of Object.entries(set)) if (!entries.some(([n]) => n === k)) entries.push([k, v]);
  r.arguments = argMap(entries);
  return r;
};

const transform = (x: number, y: number, z: number, heading = 0) => ({
  $class: "com.threerings.math.Transform3D",
  translation: { $class: "com.threerings.math.Vector3f", x, y, z },
  rotation: { $class: "com.threerings.math.Quaternion", x: 0, y: 0, z: Math.sin(heading / 2), w: Math.cos(heading / 2) },
  scale: 1,
});

export interface TileInfo { width: number; height: number; walkable: boolean }

/** Options for special floors (boss arenas). */
export interface LevelOptions {
  /** A fixed floor plan instead of a generated one (`deep`: the theme's edges run two cells deep). */
  layout?: (deep: boolean) => Layout;
  /** Encounter rooms with spawners and treasure (default true). */
  encounters?: boolean;
  /** Renames painted tiles (a tileset's look-alike in another theme), or null to keep one. */
  retile?: (name: string, rand: () => number) => string | null;
}

/** The learned tiling for a theme, cached by the sources' ids. */
const models = new Map<string, TileModel>();

/**
 * Builds a scene root. `sources` are parsed scene roots of one theme; `tileInfo` gives each
 * tile reference's footprint and whether it is walkable floor (resolved from config/tile.dat).
 */
export function generateLevel(sources: { id: string; root: any }[], tileInfo: (ref: any) => TileInfo, seed: number, title: string,
  pool: any[] = [], opts: LevelOptions = {}): any {
  const rand = rng(seed);
  const key = sources.map(s => s.id).join(",");
  let model = models.get(key);
  if (!model) {
    model = learn(sources.map(s => s.root), r => { const t = tileInfo(r); return [t.width, t.height]; }, r => tileInfo(r).walkable);
    models.set(key, model);
  }
  const layout = opts.layout ? opts.layout(model.deepEdges > 0.25) : generateLayout(rand, { deepEdges: model.deepEdges > 0.25 });
  const painted = paint(model, layout.cells, rand);

  // --- the tile grid: CoordIntMap cells of 8x8, values (config << 16 | elevation << 2 | rotation)
  const granularity = 3, size = 1 << granularity;
  const blocks = new Map<string, { coord: { x: number; y: number }; values: Int32Array }>();
  for (const p of painted) {
    const bx = p.x >> granularity, by = p.y >> granularity;
    const k = bx + "," + by;
    let b = blocks.get(k);
    if (!b) blocks.set(k, b = { coord: { x: bx, y: by }, values: new Int32Array(size * size).fill(-1) });
    b.values[((p.y & (size - 1)) << granularity) | (p.x & (size - 1))] = (p.tile << 16) | ((p.elev & 0x3fff) << 2) | (p.rot & 3);
  }
  const tiles = { granularity, empty: -1, cells: { entries: [...blocks.values()].map(b => [b.coord, { values: b.values }]) } };
  const tileConfigs = model.tiles.map(tile => {
    const name = opts.retile?.(String(tile?.name ?? ""), rand);
    return { tile: name ? { ...clone(tile), name } : tile };
  });

  // --- entries copied from the sources
  const all = sources.flatMap(s => s.root.entries ?? []);
  const pick = (list: any[], re: RegExp) => list.filter((e: any) => e.$class.endsWith("PlaceableEntry") && re.test(e.placeable?.name ?? ""));
  // the theme's own entries, else any cached level's (`pool`: other levels' entries)
  const placeable = (re: RegExp) => { const own = pick(all, re); return own.length ? own : pick(pool, re); };
  const entries: any[] = [];
  let id = 1;
  const place = (src: any, x: number, y: number, heading = 0, ref = src.placeable) =>
    entries.push({ $class: CLS + "PlaceableEntry", id: id++, placeable: ref, transform: transform(x, y, 0, heading) });
  for (const g of sources[0].root.entries ?? []) if (g.$class.endsWith("GlobalEntry")) entries.push({ ...clone(g), id: id++ });

  const mid = (r: Room): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];
  const startPad = placeable(/Elevator\/Start Platform/)[0];
  const exitLift = placeable(/Elevator\/Next Floor/)[0];
  const [sx, sy] = mid(layout.rooms[layout.start]);
  if (startPad) place(startPad, Math.floor(sx) + 0.5, Math.floor(sy) + 0.5);
  const [ex, ey] = mid(layout.rooms[layout.exit]);
  if (exitLift) place(exitLift, Math.floor(ex) + 0.5, Math.floor(ey) + 0.5);

  // encounters: every room but the start and exit; the spawn tables come from the sources
  const spawners = placeable(/Monster\/Generic\/Single Spawn/).filter((e: any) => getArg(e.placeable, "Spawn Table"));
  const treasure = placeable(/Block\/Treasure/);
  let wave = 0;
  layout.rooms.forEach((r, i) => {
    if (i === layout.start || i === layout.exit || !spawners.length || opts.encounters === false) return;
    wave++;
    const tag = `gen spawn ${wave}`;
    const area = {
      $class: CLS + "AreaEntry", id: id++,
      area: { $class: "com.threerings.config.ConfigReference", name: "Player Enter/Spawn Activate",
        arguments: argMap([["Trigger Action", { $class: "com.threerings.tudey.config.ActionConfig$Signal", name: "activate",
          target: { $class: "com.threerings.tudey.config.TargetConfig$Tagged", tag } }]]) },
      vertices: [[r.x + 1, r.y + 1], [r.x + r.w - 1, r.y + 1], [r.x + r.w - 1, r.y + r.h - 1], [r.x + 1, r.y + r.h - 1]]
        .map(([x, y]) => ({ $class: CLS + "Vertex", x, y })),
    };
    entries.push(area);
    // one monster family per room, three to six spawns around the middle
    const src = spawners[Math.floor(rand() * spawners.length)];
    const table = withArgs(getArg(src.placeable, "Spawn Table"), { "Wave Tag": `gen wave ${wave}` });
    const n = 3 + Math.floor(rand() * 4);
    const [cx, cy] = mid(r);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rand();
      const d = Math.min(r.w, r.h) * 0.3;
      const ref = withArgs(src.placeable, { "Spawn Table": table, "Spawn Tag": tag, "Wave Number": String(wave) });
      place(src, Math.floor(cx + Math.cos(a) * d) + 0.5, Math.floor(cy + Math.sin(a) * d) + 0.5, a + Math.PI, ref);
    }
    // a treasure box in some rooms, in a corner
    if (treasure.length && rand() < 0.45) place(treasure[0], r.x + 1.5 + (rand() < 0.5 ? 0 : r.w - 3), r.y + 1.5 + (rand() < 0.5 ? 0 : r.h - 3));
  });

  return { $class: "com.threerings.tudey.data.TudeySceneModel", name: title, sceneId: 0, version: 0, tiles, tileConfigs, entries };
}
