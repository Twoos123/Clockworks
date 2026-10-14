// Floors assembled from the game's own prefab rooms (cut out of the captured floors by
// src/gen/prefabs.ts), joined at their connections the way the servers join them: a path from
// the start elevator through rooms, an airlock, more rooms and the exit elevator, every other
// opening closed by a dead end (a treasure room, a mineral room, a trivial nook), as the
// RandomLayoutConfig's path of Rooms with their branches lays it out. Prefabs never turn (their
// names give fixed sides), so a piece joins another where an opening on one side meets an
// opening of the same width on the opposite side. docs/research/prefab-generator.md.

import { OPPOSITE, STEP, nameSides, segment, type Piece, type Side, type TileFacts } from "./prefabs";

/** What a piece does in a floor. */
export type PieceKind = "start" | "exit" | "airlock" | "room" | "dead";

/** An opening of a library piece, relative to the piece. */
export interface Opening { side: Side; x: number; y: number; width: number }

/** A piece ready to place: its cells relative to its own origin, its openings and its entries. */
export interface LibPiece {
  label: string;
  file: string;
  kind: PieceKind;
  /** The captured floor it came from. */
  source: string;
  tiles: { x: number; y: number; ref: any; rot: number; elev: number }[];
  cells: string[];
  walk: string[];
  openings: Opening[];
  entries: any[];
  /** Elevation steps taken off its tiles (its placement's), and the z taken off its entries. */
  base: number;
}

/** Prefabs left out: mission set pieces, gold key puzzles, danger rooms, arena and field layouts. */
const LEFT_OUT = /golddoor|goldkey|danger|reward|entrance|finale|knight|rescue|breakingin|lostsoul|owlite|office|camefrombelow|oil_furnace|casino|spiral|maze|stairs|battle|break_|wilds|trans_|frame|field|void|option|_end_|choice/;

export function pieceKind(file: string, sides: number): PieceKind | null {
  if (LEFT_OUT.test(file)) return null;
  if (/^elevator_start/.test(file)) return "start";
  if (/^elevator_next/.test(file)) return "exit";
  if (/^airlock/.test(file)) return "airlock";
  if (sides === 1 && /^room_(treasure|mineral|trivial)/.test(file)) return "dead";
  return sides >= 2 ? "room" : null;
}

const K = (x: number, y: number) => x + "," + y;
const P = (k: string) => k.split(",").map(Number) as [number, number];

/**
 * The usable pieces of a captured floor: those whose cut opens exactly on the sides their
 * name gives, with openings at least three cells wide, moved to their own origin and with
 * their placement's elevation taken off.
 */
export function libraryPieces(source: string, root: any, facts: (ref: any) => TileFacts): LibPiece[] {
  const seg = segment(root, facts);
  const out: LibPiece[] = [];
  for (const p of seg.pieces) {
    const lib = toLib(source, p);
    if (lib) out.push(lib);
  }
  return out;
}

function toLib(source: string, p: Piece): LibPiece | null {
  if (!p.walk.length) return null;
  const named = p.sides ?? nameSides(p.file);
  // openings: merge the runs on one side and line (they may lead to two pieces)
  const openings: Opening[] = [];
  for (const c of p.connections) {
    const along = c.side === "N" || c.side === "S" ? 0 : 1;
    const same = openings.find(o => o.side === c.side && (along === 0 ? o.y === c.y : o.x === c.x)
      && Math.abs((along === 0 ? o.x : o.y) - (along === 0 ? c.x : c.y)) <= o.width + c.width);
    if (same) {
      const a0 = along === 0 ? same.x : same.y, b0 = along === 0 ? c.x : c.y;
      const lo = Math.min(a0, b0), hi = Math.max(a0 + same.width, b0 + c.width);
      if (along === 0) same.x = lo; else same.y = lo;
      same.width = hi - lo;
    } else openings.push({ side: c.side, x: c.x, y: c.y, width: c.width });
  }
  const widest = Math.max(5, ...[...p.label.matchAll(/(\d+)w/g)].map(m => Number(m[1])).filter(w => w < 10));
  if (openings.some(o => o.width < 3 || o.width > widest + 2)) return null;
  const sides = new Set(openings.map(o => o.side));
  if (named && (named.length !== sides.size || named.some(s => !sides.has(s)))) return null;
  // one opening a side (the names give one)
  if (openings.length !== sides.size) return null;
  const kind = pieceKind(p.file, openings.length);
  if (!kind) return null;
  // the floor's own elevation: the commonest among its walkable cells
  const elevAt = new Map<string, number>();
  for (const t of p.tiles) elevAt.set(K(t.x, t.y), t.elev);
  const count = new Map<number, number>();
  for (const k of p.walk) { const e = elevAt.get(k); if (e !== undefined) count.set(e, (count.get(e) ?? 0) + 1); }
  const base = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  // the piece's own origin: its lowest cell
  let ox = Infinity, oy = Infinity;
  for (const k of p.cells) { const [x, y] = P(k); ox = Math.min(ox, x); oy = Math.min(oy, y); }
  const rel = (k: string) => { const [x, y] = P(k); return K(x - ox, y - oy); };
  return {
    label: p.label, file: p.file, kind, source,
    tiles: p.tiles.map(t => ({ ...t, x: t.x - ox, y: t.y - oy, elev: t.elev - base })),
    cells: p.cells.map(rel), walk: p.walk.map(rel),
    openings: openings.map(o => ({ ...o, x: o.x - ox, y: o.y - oy })),
    entries: p.entries.map(e => moveEntry(e, -ox, -oy, -base * 0.5)),
    base,
  };
}

const strip = (o: any) => JSON.parse(JSON.stringify(o, (k, v) => (k === "$outer" ? undefined : v)));

/** An entry moved by (dx, dy) and raised by dz: placeables, areas and paths. */
export function moveEntry(e: any, dx: number, dy: number, dz = 0): any {
  const c = strip(e);
  const t = c.transform?.translation;
  if (t) { t.x = (t.x ?? 0) + dx; t.y = (t.y ?? 0) + dy; if (dz && t.z) t.z = t.z + dz; }
  else if (c.$class?.endsWith("PlaceableEntry")) {
    c.transform = { $class: "com.threerings.math.Transform3D", ...(c.transform ?? {}),
      translation: { $class: "com.threerings.math.Vector3f", x: dx, y: dy, z: 0 } };
  }
  for (const v of c.vertices ?? []) { v.x = (v.x ?? 0) + dx; v.y = (v.y ?? 0) + dy; }
  return c;
}

/** A small seeded random generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Placed { piece: LibPiece; dx: number; dy: number; used: Set<number> }

export interface AssembleOptions {
  /** Rooms before and after the airlock (default two or three each). */
  before?: number;
  after?: number;
  /** Tries before giving up. */
  attempts?: number;
}

export interface Assembled {
  placed: { piece: LibPiece; dx: number; dy: number }[];
  /** Indices into `placed` of the main path, start to exit. */
  path: number[];
}

/**
 * Lays out a floor from library pieces: a path start, rooms, airlock, rooms, exit, with every
 * other opening closed by a dead end. Null when the pieces cannot make one.
 */
export function assemble(lib: LibPiece[], seed: number, opts: AssembleOptions = {}): Assembled | null {
  const rand = rng(seed);
  const by = (k: PieceKind) => lib.filter(p => p.kind === k);
  const starts = by("start"), exits = by("exit"), airlocks = by("airlock"), rooms = by("room"), deads = by("dead");
  if (!starts.length || !exits.length || rooms.length < 2) return null;
  const shuffle = <T>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  for (let attempt = 0; attempt < (opts.attempts ?? 40); attempt++) {
    const before = opts.before ?? 2 + Math.floor(rand() * 2), after = opts.after ?? 2 + Math.floor(rand() * 2);
    const plan: PieceKind[] = ["start", ...Array(before).fill("room"), ...(airlocks.length ? ["airlock"] : []), ...Array(after).fill("room"), "exit"] as PieceKind[];
    const r = tryPath(plan, { start: starts, exit: exits, airlock: airlocks, room: rooms, dead: deads }, shuffle, rand);
    if (r) return r;
  }
  return null;
}

function tryPath(plan: PieceKind[], pool: Record<PieceKind, LibPiece[]>, shuffle: <T>(a: T[]) => T[], rand: () => number): Assembled | null {
  const placed: Placed[] = [];
  const covered = new Map<string, number>(), walkable = new Map<string, number>();
  const used = new Set<LibPiece>();
  const put = (p: Placed) => {
    const i = placed.length;
    placed.push(p);
    for (const k of p.piece.cells) { const [x, y] = P(k); covered.set(K(x + p.dx, y + p.dy), i); }
    for (const k of p.piece.walk) { const [x, y] = P(k); walkable.set(K(x + p.dx, y + p.dy), i); }
    used.add(p.piece);
  };
  // where a piece would go to meet opening `o` of placed piece `a` with its own opening `b`
  const offset = (a: Placed, o: Opening, piece: LibPiece, b: Opening): [number, number] => {
    const [sx, sy] = STEP[o.side];
    // the first cell across a's opening is b's first cell
    return [a.dx + o.x + sx - b.x, a.dy + o.y + sy - b.y];
  };
  // whether a piece fits there: no cell over another piece's, no floor beside another's floor
  // but at the joint, and its other openings not facing straight into another piece
  const fits = (piece: LibPiece, dx: number, dy: number, joint: number, at: Opening): boolean => {
    for (const k of piece.cells) { const [x, y] = P(k); if (covered.has(K(x + dx, y + dy))) return false; }
    for (const k of piece.walk) {
      const [x, y] = P(k);
      for (const s of ["N", "S", "E", "W"] as Side[]) {
        const o = walkable.get(K(x + dx + STEP[s][0], y + dy + STEP[s][1]));
        if (o !== undefined && o !== joint) return false;
      }
    }
    // its other openings must have room beyond them for what will close them
    for (const op of piece.openings) {
      if (op === at) continue;
      const [sx, sy] = STEP[op.side];
      for (let d = 1; d <= 4; d++) for (let w = 0; w < op.width; w++) {
        const ax = op.side === "N" || op.side === "S" ? w : 0, ay = ax ? 0 : w;
        if (covered.has(K(op.x + dx + sx * d + ax, op.y + dy + sy * d + ay))) return false;
      }
    }
    return true;
  };
  // the joint between two placed pieces must be floor against floor along the whole opening
  const attach = (ai: number, o: Opening, kind: PieceKind): boolean => {
    const a = placed[ai];
    // a prefab once a floor where the library allows (captures can hold the same room twice)
    const free = pool[kind].filter(p => !used.has(p));
    const fresh = free.filter(p => ![...used].some(u => u.label === p.label));
    for (const piece of [...shuffle(fresh), ...shuffle(free.filter(p => !fresh.includes(p)))]) {
      for (const b of shuffle(piece.openings.filter(x => x.side === OPPOSITE[o.side] && x.width === o.width))) {
        const [dx, dy] = offset(a, o, piece, b);
        if (!fits(piece, dx, dy, ai, b)) continue;
        a.used.add(a.piece.openings.indexOf(o));
        put({ piece, dx, dy, used: new Set([piece.openings.indexOf(b)]) });
        return true;
      }
    }
    return false;
  };

  const start = shuffle(pool.start)[0];
  put({ piece: start, dx: 0, dy: 0, used: new Set() });
  const path = [0];
  for (let step = 1; step < plan.length; step++) {
    const ai = path[path.length - 1], a = placed[ai];
    const open = shuffle(a.piece.openings.filter((_, i) => !a.used.has(i)));
    let ok = false;
    for (const o of open) if (attach(ai, o, plan[step])) { ok = true; break; }
    if (!ok) return null;
    path.push(placed.length - 1);
  }
  // every other opening closes with a dead end
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    for (let j = 0; j < p.piece.openings.length; j++) {
      if (p.used.has(j)) continue;
      const o = p.piece.openings[j];
      if (!attach(i, o, "dead")) return null;
    }
  }
  return { placed: placed.map(p => ({ piece: p.piece, dx: p.dx, dy: p.dy })), path };
}

const CLS = "com.threerings.tudey.data.TudeySceneModel$";

/**
 * The scene root of an assembled floor: the pieces' tiles and entries moved to their places
 * (their tag numbers renumbered by piece, their ids anew), and the globals given.
 */
export function assembledRoot(a: Assembled, globals: any[], title: string): any {
  const refIndex = new Map<string, number>(), tileConfigs: any[] = [];
  const refOf = (ref: any) => {
    const k = JSON.stringify(ref, (kk, v) => (kk === "$outer" ? undefined : v));
    let i = refIndex.get(k);
    if (i === undefined) { refIndex.set(k, i = tileConfigs.length); tileConfigs.push({ tile: strip(ref) }); }
    return i;
  };
  const granularity = 3, size = 1 << granularity;
  const blocks = new Map<string, { coord: { x: number; y: number }; values: Int32Array }>();
  const entries: any[] = [];
  let id = 1, tagCount = 0;
  for (const g of globals) entries.push({ ...strip(g), id: id++ });
  a.placed.forEach(({ piece, dx, dy }) => {
    for (const t of piece.tiles) {
      const x = t.x + dx, y = t.y + dy, bx = x >> granularity, by = y >> granularity;
      const k = bx + "," + by;
      let b = blocks.get(k);
      if (!b) blocks.set(k, b = { coord: { x: bx, y: by }, values: new Int32Array(size * size).fill(-1) });
      b.values[((y & (size - 1)) << granularity) | (x & (size - 1))] = (refOf(t.ref) << 16) | ((t.elev & 0x3fff) << 2) | (t.rot & 3);
    }
    // the piece's tag numbers become numbers of its own in this floor
    const nums = new Map<string, number>();
    const renumber = (e: any) => JSON.parse(JSON.stringify(e).replace(/"(\d+)_auto([_ ])/g, (_m, num: string, sep: string) => {
      let v = nums.get(num);
      if (v === undefined) nums.set(num, v = ++tagCount);
      return `"${v}_auto${sep}`;
    }));
    for (const e of piece.entries) entries.push({ ...renumber(moveEntry(e, dx, dy)), id: id++ });
  });
  const tiles = { granularity, empty: -1, cells: { entries: [...blocks.values()].map(b => [b.coord, { values: b.values }]) } };
  return { $class: "com.threerings.tudey.data.TudeySceneModel", name: title, sceneId: 0, version: 0, tiles, tileConfigs, entries,
    prefabs: a.placed.map(p => ({ label: p.piece.label, source: p.piece.source, x: p.dx, y: p.dy })) };
}

export { CLS };
