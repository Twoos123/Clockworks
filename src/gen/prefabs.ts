// Prefab rooms cut out of the game's own generated floors. The servers build a Clockworks
// floor from prefabs (com.threerings.projectx.dungeon.server.random.Prefab: a layer of a
// prefab scene file, with its bounds and its connections, each a typed, oriented opening of
// a given width on the bounds' edge) and leave a "Dev/Label - Prefab" marker naming each one
// ("room_general_EW_5w_03:4", file and layer) in the floor they send, at the point the prefab
// was placed. They also renumber each prefab's tags with its placement number
// ("3_auto_spawn 1"). The client caches those floors, so the rooms can be recovered from them.
//
// The cut: the floor's walkable cells split into rooms (wide areas) and corridors (straight
// runs of a fixed cross-section three to five cells wide, where prefabs meet). Every room and
// corridor goes to one label, so that each label's region is connected, holds the entries of
// one tag number, and opens on the sides its name gives ("NEW": north, east and west). Where
// two regions meet inside a corridor, the corridor is cut at the step in elevation the two
// prefabs' placements left there, else at its middle. Tiles and entries go with the region
// they stand in. docs/research/prefab-generator.md.

import { decodeTiles } from "./autotile";

export interface TileFacts { width: number; height: number; walkable: boolean }

export type Side = "N" | "S" | "E" | "W";
export const SIDES: Side[] = ["N", "E", "S", "W"];
export const OPPOSITE: Record<Side, Side> = { N: "S", S: "N", E: "W", W: "E" };
/** The step from a cell across each side. */
export const STEP: Record<Side, [number, number]> = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] };

/**
 * An opening in a piece: `width` walkable cells on its `side`, the run starting at (x, y)
 * (the lowest cell of the run, inside the piece) and going along the side. `to` is the piece
 * it led to in the floor it was cut from.
 */
export interface Connection { side: Side; x: number; y: number; width: number; to: number }

/** A placed tile: origin cell, tile reference, rotation and elevation. */
export interface PieceTile { x: number; y: number; ref: any; rot: number; elev: number }

export interface Piece {
  /** The label's text ("room_general_EW_5w_03:4") and its file and layer. */
  label: string;
  file: string;
  layer: number;
  /** The label's position (the prefab's placement point) and elevation offset (z). */
  x: number; y: number; z: number;
  tiles: PieceTile[];
  /** Walkable cells ("x,y"). */
  walk: string[];
  /** Every cell its tiles cover ("x,y"). */
  cells: string[];
  /** The scene entries that stand in it (placeables, areas, paths), as they were. */
  entries: any[];
  connections: Connection[];
  /** The tag number the servers gave its entries ("3" of "3_auto_spawn 1"), if any. */
  tagNumber: string | null;
  /** The sides its name gives ("NEW" for room_general_NEW_3w_5w_02), if it names any. */
  sides: Side[] | null;
}

export interface Segmentation {
  pieces: Piece[];
  /** Which piece each covered cell belongs to. */
  owner: Map<string, number>;
  walk: Set<string>;
  /** How well the cut fits the names: sides named but not found, and found but not named. */
  misfit: number;
}

const K = (x: number, y: number) => x + "," + y;
const P = (k: string) => k.split(",").map(Number) as [number, number];
const strip = (o: any) => JSON.stringify(o, (k, v) => (k === "$outer" ? undefined : v));
const AUTO = /"(\d+)_auto[_ ]/;

/** Where an entry stands: its translation, an area's or path's middle... */
export function entryPoint(e: any): [number, number] | null {
  const t = e.transform?.translation;
  if (t) return [t.x ?? 0, t.y ?? 0];
  const vs: any[] | undefined = e.vertices;
  if (vs?.length) return [vs.reduce((a, v) => a + (v.x ?? 0), 0) / vs.length, vs.reduce((a, v) => a + (v.y ?? 0), 0) / vs.length];
  if (e.$class?.endsWith("PlaceableEntry")) return [0, 0];
  return null;
}

/** The tag number the servers gave an entry ("3" of "3_auto_spawn 1"). */
export function tagNumber(e: any): string | null {
  const m = AUTO.exec(strip(e));
  return m ? m[1] : null;
}

/** The sides a prefab's name gives: "room_general_NEW_3w_5w_02" opens north, east and west. */
export function nameSides(file: string): Side[] | null {
  for (const part of file.split("_")) {
    if (/^[NSEW]{1,4}$/.test(part)) return [...new Set(part.split(""))] as Side[];
  }
  // transitions name theirs with the terrain beyond ("trans_Nwild_Scompound_01")
  const t = [...file.matchAll(/_([NSEW])(?=[a-z])/g)].map(m => m[1] as Side);
  return t.length ? [...new Set(t)] : null;
}

/** The prefab labels of a generated floor. */
export function prefabLabels(root: any): { text: string; x: number; y: number; z: number; entry: any }[] {
  return ((root.entries ?? []) as any[]).filter(e => e.placeable?.name === "Dev/Label - Prefab").map(e => {
    const t = e.transform?.translation ?? {};
    const text = String((e.placeable.arguments?.entries as [string, any][] | undefined)?.find(([k]) => k === "Text")?.[1] ?? "");
    return { text, x: t.x ?? 0, y: t.y ?? 0, z: t.z ?? 0, entry: e };
  });
}

/**
 * Widest cross-section a corridor may have, in cells: the widest opening the floor's names
 * give and two more (Devilish Drudgery's "5w" openings are seven cells between their posts).
 */
const corridorWidth = (labels: { text: string }[]) =>
  Math.max(6, ...labels.flatMap(l => [...l.text.matchAll(/(\d+)w/g)].map(m => Number(m[1]) + 2)).filter(w => w <= 9));

interface Node { id: number; cells: string[]; corridor: "EW" | "NS" | null; numbers: Map<string, number> }

/** Cuts a generated floor into its prefabs. */
export function segment(root: any, facts: (ref: any) => TileFacts): Segmentation {
  const { refs, cells } = decodeTiles(root);
  // every covered cell, whether it is walkable, and the elevation of its floor
  const cover = new Set<string>(), walk = new Set<string>(), elev = new Map<string, number>();
  for (const [k, c] of cells) {
    const ref = refs[c.tile];
    if (!ref) continue;
    const f = facts(ref);
    const [x, y] = P(k);
    const [w, h] = c.rot & 1 ? [f.height, f.width] : [f.width, f.height];
    for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) {
      const ck = K(x + dx, y + dy);
      cover.add(ck);
      if (f.walkable) { walk.add(ck); elev.set(ck, c.elev); }
    }
  }
  const labels = prefabLabels(root);
  const owner = new Map<string, number>();
  if (!labels.length || !walk.size) return { pieces: [], owner, walk, misfit: 0 };
  const W = (x: number, y: number) => walk.has(K(x, y));

  // --- rooms and corridors
  const run = (x: number, y: number, dx: number, dy: number): [number, number] => {
    let a = 0, b = 0;
    while (W(x - dx * (a + 1), y - dy * (a + 1))) a++;
    while (W(x + dx * (b + 1), y + dy * (b + 1))) b++;
    return [a, b];
  };
  const sameRun = (x: number, y: number, dx: number, dy: number, r: [number, number]) => {
    if (!W(x, y)) return false;
    const s = run(x, y, dx, dy);
    return s[0] === r[0] && s[1] === r[1];
  };
  const kind = new Map<string, "EW" | "NS" | null>();
  const MAX_CORRIDOR = corridorWidth(labels);
  for (const k of walk) {
    const [x, y] = P(k);
    // an east-west corridor: a short north-south cross-section, the same a cell either way
    const v = run(x, y, 0, 1), h = run(x, y, 1, 0);
    const ew = v[0] + v[1] + 1 <= MAX_CORRIDOR && sameRun(x - 1, y, 0, 1, v) && sameRun(x + 1, y, 0, 1, v);
    const ns = h[0] + h[1] + 1 <= MAX_CORRIDOR && sameRun(x, y - 1, 1, 0, h) && sameRun(x, y + 1, 1, 0, h);
    kind.set(k, ew && !ns ? "EW" : ns && !ew ? "NS" : null);
  }
  const nodeOf = new Map<string, number>();
  const nodes: Node[] = [];
  for (const k of walk) {
    if (nodeOf.has(k)) continue;
    const kd = kind.get(k)!;
    const n: Node = { id: nodes.length, cells: [], corridor: kd, numbers: new Map() };
    nodes.push(n);
    const stack = [k];
    nodeOf.set(k, n.id);
    while (stack.length) {
      const c = stack.pop()!;
      n.cells.push(c);
      const [x, y] = P(c);
      for (const s of SIDES) {
        const m = K(x + STEP[s][0], y + STEP[s][1]);
        if (walk.has(m) && !nodeOf.has(m) && kind.get(m) === kd) { nodeOf.set(m, n.id); stack.push(m); }
      }
    }
  }
  // adjacency, with the side from one node to the other (by majority of the cells that touch)
  const adj = nodes.map(() => new Map<number, Map<Side, number>>());
  for (const k of walk) {
    const [x, y] = P(k), a = nodeOf.get(k)!;
    for (const s of SIDES) {
      const b = nodeOf.get(K(x + STEP[s][0], y + STEP[s][1]));
      if (b === undefined || b === a) continue;
      const m = adj[a].get(b) ?? new Map<Side, number>();
      m.set(s, (m.get(s) ?? 0) + 1);
      adj[a].set(b, m);
    }
  }
  const sideTo = (a: number, b: number): Side => [...adj[a].get(b)!].sort((p, q) => q[1] - p[1])[0][0];

  // the nearest walkable cell to a point
  const nearestWalk = (px: number, py: number): string | null => {
    const cx = Math.floor(px), cy = Math.floor(py);
    for (let r = 0; r <= 10; r++) {
      let best: string | null = null, bd = Infinity;
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const k = K(cx + dx, cy + dy);
        if (!walk.has(k)) continue;
        const d = Math.hypot(cx + dx + 0.5 - px, cy + dy + 0.5 - py);
        if (d < bd) { bd = d; best = k; }
      }
      if (best) return best;
    }
    return null;
  };

  // entries: their tag numbers mark the nodes they stand in
  const entries: any[] = (root.entries ?? []).filter((e: any) => !e.$class.endsWith("GlobalEntry") && e.placeable?.name !== "Dev/Label - Prefab");
  const numbers = new Map<any, string | null>();
  for (const e of entries) {
    const n = tagNumber(e);
    numbers.set(e, n);
    if (!n || /Door|Gate|Barrier/.test(e.placeable?.name ?? "")) continue;
    const p = entryPoint(e), k = p ? nearestWalk(p[0], p[1]) : null;
    if (!k) continue;
    const node = nodes[nodeOf.get(k)!];
    node.numbers.set(n, (node.numbers.get(n) ?? 0) + 1);
  }

  // --- each node to a label
  const L = labels.length;
  const home = labels.map(l => { const k = nearestWalk(l.x, l.y); return k ? nodeOf.get(k)! : -1; });
  const sides = labels.map(l => nameSides(l.text.split(":")[0]));
  const own = new Int32Array(nodes.length).fill(-1);
  // two labels in one node: the node goes to the first; the other grows from a neighbour
  const homeOf = new Map<number, number>();
  home.forEach((h, i) => {
    if (h < 0) return;
    // two labels in one node (a corridor between two prefabs): the second takes the
    // biggest free node beside it
    if (homeOf.has(h)) h = [...adj[h].keys()].filter(m => !homeOf.has(m)).sort((a, b) => nodes[b].cells.length - nodes[a].cells.length)[0] ?? -1;
    if (h >= 0) homeOf.set(h, i);
  });
  // regions grown from the labels over the node graph, weighted by the nodes' sizes; `pace`
  // slows some labels' growth (dead ends and elevators are small rooms)
  const grow = (pace: number[]) => {
    const o = new Int32Array(nodes.length).fill(-1);
    const dist = new Float64Array(nodes.length).fill(Infinity);
    const queue: [number, number, number][] = [];
    for (const [h, i] of homeOf) { dist[h] = 0; o[h] = i; queue.push([0, h, i]); }
    while (queue.length) {
      queue.sort((x, y) => x[0] - y[0]);
      const [d, n, i] = queue.shift()!;
      if (d > dist[n]) continue;
      for (const m of adj[n].keys()) {
        const nd = d + Math.sqrt(nodes[m].cells.length) * pace[i];
        if (nd < dist[m]) { dist[m] = nd; o[m] = i; queue.push([nd, m, i]); }
      }
    }
    return o;
  };
  const pinned = new Set(homeOf.keys());

  // the cost of an assignment: names' sides not matched, openings of widths the name does
  // not give or between two rooms (prefabs meet in corridors), tag numbers split or mixed
  const widths = labels.map(l => new Set([...l.text.matchAll(/(\d+)w/g)].map(m => Number(m[1]))));
  const contactWidth = (a: number, b: number) => [...adj[a].get(b)!.values()].reduce((x, y) => x + y, 0);
  const cost = (o: Int32Array): number => {
    let c = 0;
    const found = labels.map(() => new Map<Side, Set<number>>());
    const contacts = labels.map(() => 0);
    for (let a = 0; a < nodes.length; a++) {
      if (o[a] < 0) continue;
      for (const b of adj[a].keys()) {
        if (o[b] === o[a] || o[b] < 0) continue;
        const s = sideTo(a, b);
        const m = found[o[a]].get(s) ?? new Set<number>();
        m.add(o[b]);
        found[o[a]].set(s, m);
        contacts[o[a]]++;
        const w = contactWidth(a, b);
        if (widths[o[a]].size && !widths[o[a]].has(w)) c += 3;
        if (!nodes[a].corridor && !nodes[b].corridor) c += 2;
      }
    }
    for (let i = 0; i < L; i++) if (sides[i] && contacts[i] > sides[i]!.length) c += 3 * (contacts[i] - sides[i]!.length);
    for (let i = 0; i < L; i++) {
      const want = sides[i], got = found[i];
      if (!want) continue;
      for (const s of want) if (!got.has(s)) c += 10;
      for (const [s, to] of got) if (!want.includes(s)) c += 10 * to.size; else if (to.size > 1) c += 4 * (to.size - 1);
    }
    const where = new Map<string, Map<number, number>>();
    for (let a = 0; a < nodes.length; a++) for (const [n, cnt] of nodes[a].numbers) {
      const m = where.get(n) ?? new Map<number, number>();
      m.set(o[a], (m.get(o[a]) ?? 0) + cnt);
      where.set(n, m);
    }
    const regionNums = new Map<number, number>();
    for (const m of where.values()) {
      const total = [...m.values()].reduce((x, y) => x + y, 0), top = Math.max(...m.values());
      c += 6 * (total - top) / Math.max(1, total) * Math.min(4, m.size - 1 + 1);
      for (const r of m.keys()) regionNums.set(r, (regionNums.get(r) ?? 0) + 1);
    }
    for (const n of regionNums.values()) if (n > 1) c += 8 * (n - 1);
    return c;
  };
  // a region's nodes still joined to its label once `without` leaves it
  const reach = (o: Int32Array, i: number, without: number): Set<number> => {
    const seen = new Set<number>();
    const start = [...homeOf].find(([, l]) => l === i)?.[0];
    if (start === undefined || start === without) return seen;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const n = stack.pop()!;
      for (const m of adj[n].keys()) if (m !== without && !seen.has(m) && o[m] === i) { seen.add(m); stack.push(m); }
    }
    return seen;
  };
  const search = (o: Int32Array): number => {
    let best = cost(o);
    for (let iter = 0; iter < 300 && best > 0; iter++) {
      let move: { o: Int32Array; c: number } | null = null;
      for (let n = 0; n < nodes.length; n++) {
        const from = o[n];
        if (from < 0 || pinned.has(n)) continue;
        for (const m of adj[n].keys()) {
          const to = o[m];
          if (to === from || to < 0) continue;
          // the node moves, and with it whatever of its region hangs off it
          const keep = reach(o, from, n);
          const t = o.slice();
          for (let j = 0; j < nodes.length; j++) if (o[j] === from && !keep.has(j)) t[j] = to;
          const c = cost(t);
          if (c < (move?.c ?? best) - 1e-9) move = { o: t, c };
        }
      }
      if (!move) break;
      o.set(move.o);
      best = move.c;
    }
    return best;
  };
  // several starts: even growth, dead ends and elevators slowed, and a few shuffled paces
  const small = labels.map(l => /treasure|mineral|trivial|elevator|reward|goldkey/.test(l.text) ? 3 : 1);
  let seed = labels.length * 7919 + nodes.length;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const paces = [labels.map(() => 1), small, ...[0, 1, 2, 3].map(() => small.map(v => v * (0.6 + rand() * 0.8)))];
  let best = Infinity;
  for (const pace of paces) {
    const o = grow(pace);
    const c = search(o);
    if (c < best) { best = c; own.set(o); }
    if (best === 0) break;
  }

  // --- cells: corridors between two regions are cut at their elevation step or middle
  for (const n of nodes) for (const k of n.cells) owner.set(k, own[n.id]);
  for (const n of nodes) {
    if (!n.corridor || own[n.id] < 0) continue;
    const others = [...adj[n.id].keys()].filter(m => own[m] !== own[n.id] && own[m] >= 0);
    if (!others.length) continue;
    const axis = n.corridor === "EW" ? 0 : 1;
    const along = (k: string) => P(k)[axis];
    const lo = Math.min(...n.cells.map(along)), hi = Math.max(...n.cells.map(along));
    // which end each foreign neighbour touches
    for (const m of others) {
      const s = sideTo(n.id, m);
      const atHigh = s === "E" || s === "N";
      // the elevation along the corridor, slice by slice
      const slice = new Map<number, number>();
      for (const k of n.cells) slice.set(along(k), elev.get(k) ?? 0);
      let cut = -1;
      const endElev = slice.get(atHigh ? hi : lo)!;
      // walk in from that end while the elevation stays that of the far end's prefab
      if (atHigh) { for (let v = hi; v > lo; v--) if (slice.get(v) !== endElev) { cut = v + 1; break; } }
      else { for (let v = lo; v < hi; v++) if (slice.get(v) !== endElev) { cut = v - 1; break; } }
      const neighbourElev = elev.get(nodes[m].cells[0]) ?? 0;
      if (cut < 0 || endElev !== neighbourElev) cut = atHigh ? Math.floor((lo + hi) / 2) + 1 : Math.floor((lo + hi) / 2);
      for (const k of n.cells) {
        const v = along(k);
        if (atHigh ? v >= cut : v <= cut) owner.set(k, own[m]);
      }
    }
  }
  for (const k of walk) if (!owner.has(k) || owner.get(k)! < 0) owner.delete(k);
  // the rest of the tiles (walls, edges, cliffs) go with the floor nearest them
  let front = [...owner.keys()];
  while (front.length) {
    const next: string[] = [];
    for (const k of front) {
      const i = owner.get(k)!;
      const [x, y] = P(k);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = K(x + dx, y + dy);
        if (cover.has(n) && !owner.has(n)) { owner.set(n, i); next.push(n); }
      }
    }
    front = next;
  }

  // --- the pieces
  const regionNumber = new Map<number, string>();
  {
    const votes = new Map<number, Map<string, number>>();
    for (const n of nodes) for (const [num, c] of n.numbers) {
      const m = votes.get(own[n.id]) ?? new Map<string, number>();
      m.set(num, (m.get(num) ?? 0) + c);
      votes.set(own[n.id], m);
    }
    for (const [r, m] of votes) if (r >= 0) regionNumber.set(r, [...m].sort((a, b) => b[1] - a[1])[0][0]);
  }
  const numberRegion = new Map([...regionNumber].map(([r, n]) => [n, r]));
  const pieces: Piece[] = labels.map((l, i) => {
    const [file, layer] = l.text.split(":");
    return { label: l.text, file, layer: Number(layer ?? 0), x: l.x, y: l.y, z: l.z, tiles: [], walk: [], cells: [], entries: [], connections: [],
      tagNumber: regionNumber.get(i) ?? null, sides: sides[i] };
  });
  for (const [k, c] of cells) {
    const i = owner.get(k);
    if (i === undefined || !refs[c.tile]) continue;
    const [x, y] = P(k);
    pieces[i].tiles.push({ x, y, ref: refs[c.tile], rot: c.rot, elev: c.elev });
  }
  for (const [k, i] of owner) { pieces[i].cells.push(k); if (walk.has(k)) pieces[i].walk.push(k); }
  for (const e of entries) {
    const n = numbers.get(e);
    let i = n ? numberRegion.get(n) : undefined;
    if (i === undefined) {
      const p = entryPoint(e);
      const k = p ? K(Math.floor(p[0]), Math.floor(p[1])) : null;
      i = k ? owner.get(k) : undefined;
      if (i === undefined && p) { const w = nearestWalk(p[0], p[1]); i = w ? owner.get(w) : undefined; }
    }
    if (i !== undefined && i >= 0) pieces[i].entries.push(e);
  }
  // the openings: runs of walkable cells whose neighbour across a side is another piece's
  pieces.forEach((p, i) => {
    const runs = new Map<string, { side: Side; to: number; cells: [number, number][] }>();
    for (const k of p.walk) {
      const [x, y] = P(k);
      for (const s of SIDES) {
        const n = K(x + STEP[s][0], y + STEP[s][1]);
        const o = owner.get(n);
        if (o === undefined || o === i || !walk.has(n)) continue;
        const line = s === "N" || s === "S" ? y : x;
        const key = `${s}:${o}:${line}`;
        const r = runs.get(key) ?? { side: s, to: o, cells: [] };
        r.cells.push([x, y]);
        runs.set(key, r);
      }
    }
    for (const r of runs.values()) {
      const along = (c: [number, number]) => (r.side === "N" || r.side === "S" ? c[0] : c[1]);
      r.cells.sort((a, b) => along(a) - along(b));
      let start = 0;
      for (let j = 1; j <= r.cells.length; j++) {
        if (j < r.cells.length && along(r.cells[j]) === along(r.cells[j - 1]) + 1) continue;
        const c = r.cells[start];
        p.connections.push({ side: r.side, x: c[0], y: c[1], width: j - start, to: r.to });
        start = j;
      }
    }
  });
  return { pieces, owner, walk, misfit: best };
}
