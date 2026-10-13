// Learned auto-tiling. The game's level editor paints floors and walls with GroundConfig and
// WallConfig brushes (Tudey's TilePainter picks each tile from its neighbours), but the client
// ships those brush libraries empty. The same knowledge is in the levels themselves: every
// placed tile sits in a neighbourhood of floor, other tiles and empty space. This learns, from
// a theme's cached scenes, which tile (and rotation and elevation offset) appears in which
// neighbourhood, and paints new layouts from what it learned.

/** A cell's role in a layout: nothing there, walkable floor, or a non-floor tile (edge, wall). */
export const enum State { Void = 0, Floor = 1, Other = 2 }

// Tudey's Direction order: north, northwest, west, southwest, south, southeast, east, northeast
// (counter-clockwise from north, so a quarter turn counter-clockwise moves index d to d + 2).
export const DIRS: [number, number][] = [[0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1]];

interface Placed { tile: number; rot: number; elev: number }
/** One observation: a tile in a rotation, its elevation relative to the nearby floor. */
interface Obs { tile: number; rot: number; rel: number; weight: number }

export interface TileModel {
  /** Tile config references, by index. */
  tiles: any[];
  /** Observations by key: own state then the eight neighbour states. */
  cases: Map<string, Obs[]>;
  /** Share of non-floor tiles two cells from the floor (cliff faces two tiles deep). */
  deepEdges: number;
}

const keyOf = (own: State, ns: State[]) => own + ":" + ns.join("");

/** Decodes a TudeySceneModel's tile grid: origin cell to tile, rotation and elevation. */
export function decodeTiles(root: any): { refs: any[]; cells: Map<string, Placed> } {
  const refs: any[] = ((root.tileConfigs?.items ?? root.tileConfigs) as any[]).map(m => m?.tile ?? null);
  const g = root.tiles?.granularity ?? 3, mask = (1 << g) - 1, empty = root.tiles?.empty ?? -1;
  const cells = new Map<string, Placed>();
  for (const [coord, cell] of root.tiles?.cells?.entries ?? []) {
    const vals: Int32Array = cell.values;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (v === empty) continue;
      const x = (coord.x << g) | (i & mask), y = (coord.y << g) | (i >> g);
      cells.set(x + "," + y, { tile: v >>> 16, rot: v & 3, elev: (v << 16) >> 18 });
    }
  }
  return { refs, cells };
}

const refKey = (r: any) => JSON.stringify(r, (k, v) => (k === "$outer" ? undefined : v));

/**
 * Learns from scene roots. `size` gives a tile reference's footprint; only single-cell tiles
 * are learned (multi-cell pieces still count as floor or other for their neighbours), and
 * `isFloor` says whether a tile is walkable floor (by its config path: ".../Floor/...").
 */
export function learn(roots: any[], size: (ref: any) => [number, number], isFloor: (ref: any) => boolean): TileModel {
  const tiles: any[] = [], index = new Map<string, number>();
  const tileIndex = (ref: any) => {
    const k = refKey(ref);
    let i = index.get(k);
    if (i === undefined) { index.set(k, i = tiles.length); tiles.push(ref); }
    return i;
  };
  const raw: { tile: number; rot: number; rel: number; ns: State[]; own: State }[] = [];
  let other = 0, deep = 0;
  for (const root of roots) {
    const { refs, cells } = decodeTiles(root);
    // every covered cell's state and elevation (multi-cell tiles cover their footprint)
    const state = new Map<string, { s: State; elev: number }>();
    const single = new Map<string, Placed>();
    for (const [k, c] of cells) {
      const ref = refs[c.tile];
      if (!ref) continue;
      const [w, h] = size(ref);
      const [x, y] = k.split(",").map(Number);
      const [cw, ch] = c.rot & 1 ? [h, w] : [w, h];
      const s = isFloor(ref) ? State.Floor : State.Other;
      for (let dx = 0; dx < cw; dx++) for (let dy = 0; dy < ch; dy++) state.set((x + dx) + "," + (y + dy), { s, elev: c.elev });
      if (w === 1 && h === 1) single.set(k, c);
    }
    for (const [k, c] of single) {
      const [x, y] = k.split(",").map(Number);
      const own = state.get(k)!.s;
      const ns = DIRS.map(([dx, dy]) => state.get((x + dx) + "," + (y + dy))?.s ?? State.Void);
      // elevation relative to the highest floor within two cells (or to itself)
      let base = -Infinity;
      for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
        const n = state.get((x + dx) + "," + (y + dy));
        if (n?.s === State.Floor) base = Math.max(base, n.elev);
      }
      const rel = base === -Infinity ? 0 : c.elev - base;
      // floors are painted level: raised or sunken floor pieces (steps, platforms) are left out
      if (own === State.Floor && rel !== 0) continue;
      raw.push({ tile: tileIndex(refs[c.tile]), rot: c.rot, rel, ns, own });
      if (own === State.Other) {
        other++;
        if (!ns.includes(State.Floor) && base !== -Infinity) deep++;
      }
    }
  }
  // tiles seen in more than one rotation are rotatable pieces (cliff faces, corners); the
  // rest (directional trims) only ever appear as placed
  const rots = new Map<number, Set<number>>();
  for (const o of raw) { const s = rots.get(o.tile) ?? new Set(); s.add(o.rot); rots.set(o.tile, s); }
  const cases = new Map<string, Obs[]>();
  const add = (key: string, o: Obs) => {
    const list = cases.get(key) ?? [];
    const same = list.find(x => x.tile === o.tile && x.rot === o.rot && x.rel === o.rel);
    if (same) same.weight += o.weight; else list.push(o);
    cases.set(key, list);
  };
  for (const o of raw) {
    const turns = (rots.get(o.tile)?.size ?? 1) > 1 ? 4 : 1;
    for (let k = 0; k < turns; k++) {
      const ns = DIRS.map((_, d) => o.ns[((d - 2 * k) % 8 + 8) % 8]);
      // the observed orientation counts fully; the inferred ones a little less
      add(keyOf(o.own, ns), { tile: o.tile, rot: (o.rot + k) % 4, rel: o.rel, weight: k === 0 ? 1 : 0.5 });
    }
  }
  return { tiles, cases, deepEdges: other ? deep / other : 0 };
}

/** A painted tile. */
export interface Painted { x: number; y: number; tile: number; rot: number; elev: number }

/**
 * Paints a layout: `cells` maps "x,y" to Floor or Other (absent is Void). Each cell takes a
 * tile observed in the same neighbourhood, or in the closest one learned (fewest differing
 * neighbours, cardinal directions weighing double).
 */
export function paint(model: TileModel, cells: Map<string, State>, rand: () => number, elevation = 0): Painted[] {
  const out: Painted[] = [];
  // edges and walls come in runs: each 6x6 block keeps to one tile family ("Edge", "Wall/High
  // ruin"...) where the neighbourhood allows, instead of mixing them cell by cell
  const family = (o: Obs) => String(model.tiles[o.tile]?.name ?? "").split("/").slice(0, -1).join("/");
  const blockFamily = new Map<string, string>();
  const keys = [...model.cases.keys()];
  const nearest = new Map<string, string | null>();
  const closest = (key: string): string | null => {
    if (model.cases.has(key)) return key;
    if (nearest.has(key)) return nearest.get(key)!;
    let best: string | null = null, bestD = Infinity;
    for (const k of keys) {
      if (k[0] !== key[0]) continue;
      let d = 0;
      for (let i = 0; i < 8; i++) if (k[2 + i] !== key[2 + i]) d += i % 2 === 0 ? 2 : 1;
      if (d < bestD) { bestD = d; best = k; }
    }
    nearest.set(key, best);
    return best;
  };
  for (const [k, s] of cells) {
    const [x, y] = k.split(",").map(Number);
    const ns = DIRS.map(([dx, dy]) => cells.get((x + dx) + "," + (y + dy)) ?? State.Void);
    const key = closest(keyOf(s, ns));
    let list = key ? model.cases.get(key)! : [];
    if (!list.length) continue;
    const block = s === State.Other ? Math.floor(x / 6) + "," + Math.floor(y / 6) : null;
    const pref = block ? blockFamily.get(block) : undefined;
    if (pref) { const same = list.filter(o => family(o) === pref); if (same.length) list = same; }
    let r = rand() * list.reduce((a, o) => a + o.weight, 0);
    let pick = list[0];
    for (const o of list) if ((r -= o.weight) <= 0) { pick = o; break; }
    if (block && !pref) blockFamily.set(block, family(pick));
    out.push({ x, y, tile: pick.tile, rot: pick.rot, elev: elevation + pick.rel });
  }
  return out;
}

/** What the remapping and rule-based tiling need to know about a tile config. */
export interface TileFacts { width: number; height: number; walkable: boolean }

/**
 * A theme substitution: tiles named "<from>/<suffix>" become "<to>/<suffix>". `alias` rewrites
 * the suffix first where the two themes name the same piece differently (Castle, Light's
 * "Rail/02" is Graveyard's "Floor Edge/02").
 */
export interface RemapRule { from: string; to: string; alias?: [RegExp, string][] }

const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * The target-theme tile standing in for a source tile name, or null to keep the source tile:
 * the same suffix when the target theme has it, else the nearest-named target tile (same
 * folder first, then shared words and leading characters) with the same walkability and a
 * single-cell footprint (only single-cell tiles are painted).
 */
export function remapName(name: string, rules: RemapRule[], target: Map<string, TileFacts>, source?: TileFacts): string | null {
  for (const rule of rules) {
    if (!name.startsWith(rule.from + "/")) continue;
    let suffix = name.slice(rule.from.length + 1);
    for (const [re, to] of rule.alias ?? []) suffix = suffix.replace(re, to);
    const fits = (f: TileFacts) => f.width === 1 && f.height === 1 && (!source || f.walkable === source.walkable);
    const exact = target.get(rule.to + "/" + suffix);
    if (exact && fits(exact)) return rule.to + "/" + suffix;
    const folder = suffix.includes("/") ? suffix.slice(0, suffix.lastIndexOf("/")) : "";
    const want = new Set(tokens(suffix));
    let best: string | null = null, bestScore = 0;
    for (const [n, f] of target) {
      if (!n.startsWith(rule.to + "/") || !fits(f)) continue;
      const s = n.slice(rule.to.length + 1);
      const sf = s.includes("/") ? s.slice(0, s.lastIndexOf("/")) : "";
      let shared = 0;
      for (const t of new Set(tokens(s))) if (want.has(t)) shared++;
      if (shared === 0 && sf !== folder) continue;
      let prefix = 0;
      while (prefix < s.length && s[prefix] === suffix[prefix]) prefix++;
      // the same folder is worth more than any word match; words before leading characters
      const score = (sf === folder ? 1000 : 0) + shared * 20 + prefix;
      if (score > bestScore) { bestScore = score; best = n; }
    }
    if (best) return best;
  }
  return null;
}

/**
 * A learned model with every tile reference substituted (`map` returns the new name, or null
 * to keep the tile): the neighbourhoods, rotations and elevations carry over unchanged, so a
 * theme variant inherits its source's tiling.
 */
export function remapModel(model: TileModel, map: (name: string) => string | null): TileModel {
  const tiles = model.tiles.map(ref => {
    const n = ref?.name ? map(ref.name) : null;
    return n ? { ...ref, name: n } : ref;
  });
  return { tiles, cases: model.cases, deepEdges: model.deepEdges };
}
