// The level map the minimap and the map overlay draw, built as the game's map renderer builds it
// (Tudey's map renderer, configured by ProjectX's map components):
// - every cell a tile covers holds the tile's collision flags under the map mask (wall, edge,
//   player, player barrier); a placeable or area with such flags marks the cells its shape
//   covers (more than four of a cell's nine thirds), and a floor-tile placeable marks floor;
// - the floor is flooded from the entrances (default-entrance placeables and the knight's spawn)
//   through 4-connected cells without flags; flooded floor is "reached";
// - each cell is one texel: reached floor dark blue, other floor grey-blue, blocked cells light
//   blue, cells nothing covers clear. Walls and edges are one cell deep, so the map reads as an
//   outline of the walkable area.
// How much of each cell shows is the exploration alpha: in Clockworks levels, a disc around each
// two-unit square the knight has visited (solid to 20 units, fading out at 32); elsewhere the same
// disc around every reached cell.

import { intersects, shapeBounds, type Shape } from "./shapes";

/** wall | edge | player | player_barrier (the collision mask names' bits). */
export const MAP_MASK = 1 | 2 | 4 | 32;

/** Exploration disc: solid within 20 cells, fading to nothing at 32. */
const INNER = 20 * 20, OUTER = 32 * 32, RADIUS = 32;

export const mapKey = (x: number, y: number) => (x + 32768) * 65536 + (y + 32768);
const keyX = (k: number) => Math.floor(k / 65536) - 32768;
const keyY = (k: number) => (k % 65536) - 32768;

/** The disc's alpha at squared distance d2 from its centre. */
export function discAlpha(d2: number): number {
  return d2 > OUTER ? 0 : d2 > INNER ? 1 - (d2 - INNER) / (OUTER - INNER) : 1;
}

/** Whether a shape covers a cell: more than four of its nine thirds touch it. */
function covers(shape: Shape, x: number, y: number): boolean {
  const third = 1 / 3;
  let hit = 0, miss = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const x0 = x + third * i, x1 = x + third * (i + 1), y0 = y + third * j, y1 = y + third * (j + 1);
      if (intersects(shape, { k: "poly", pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] })) { if (++hit > 4) return true; }
      else if (++miss > 4) return false;
    }
  }
  return hit > 4;
}

export class LevelMap {
  /** Cell value: 0 for floor, the masked collision flags for blocked cells; absent cells are clear. */
  readonly values = new Map<number, number>();
  /** Flooded floor cells. */
  readonly reached = new Set<number>();
  private readonly seeds = new Set<number>();
  /** Bumped whenever the flood is redone. */
  version = 0;

  get(x: number, y: number): number | undefined { return this.values.get(mapKey(x, y)); }

  private raise(x: number, y: number, v: number) {
    const k = mapKey(x, y), old = this.values.get(k);
    this.values.set(k, old === undefined ? v : Math.max(old, v));
  }

  /** A tile's cell with its (rotated) collision flags. */
  tile(x: number, y: number, flags: number) { this.raise(x, y, flags & MAP_MASK); }

  /** A placeable or area entry: its shape marks the cells it covers with its masked flags (floor tiles mark floor). */
  entry(shape: Shape | null, flags: number, floorTile = false) {
    const v = flags & MAP_MASK;
    if ((!v && !floorTile) || !shape) return;
    const [x0, y0, x1, y1] = shapeBounds(shape);
    for (let y = Math.floor(y0); y <= Math.floor(y1); y++) {
      for (let x = Math.floor(x0); x <= Math.floor(x1); x++) if (covers(shape, x, y)) this.raise(x, y, v);
    }
  }

  /** A flood seed (a default-entrance placeable, the spawn point). */
  entrance(x: number, y: number) { this.seeds.add(mapKey(Math.trunc(x), Math.trunc(y))); }

  /** Floods the floor from the seeds: cells without flags reached through their four sides. */
  flood() {
    if (!this.seeds.size) return;
    this.reached.clear();
    const queue = [...this.seeds];
    const dirs = [[1, 0], [0, -1], [-1, 0], [0, 1]];
    for (let i = 0; i < queue.length; i++) {
      const x = keyX(queue[i]), y = keyY(queue[i]);
      for (const [dx, dy] of dirs) {
        const k = mapKey(x + dx, y + dy);
        if (this.values.get(k) === 0 && !this.reached.has(k)) { this.reached.add(k); queue.push(k); }
      }
    }
    this.version++;
  }

  /** The covered cells' bounds, inclusive (null for an empty map). */
  bounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const k of this.values.keys()) {
      const x = keyX(k), y = keyY(k);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
  }

  /** Every covered cell with its value and whether the flood reached it. */
  *cells(): Generator<[number, number, number, boolean]> {
    for (const [k, v] of this.values) yield [keyX(k), keyY(k), v, this.reached.has(k)];
  }
}

/** Per-cell exploration alpha over a map's bounds. */
export class Exploration {
  readonly alpha: Float32Array;
  readonly width: number;
  readonly height: number;

  constructor(readonly minX: number, readonly minY: number, maxX: number, maxY: number) {
    this.width = maxX - minX + 1;
    this.height = maxY - minY + 1;
    this.alpha = new Float32Array(this.width * this.height);
  }

  at(x: number, y: number): number {
    const i = x - this.minX, j = y - this.minY;
    return i < 0 || j < 0 || i >= this.width || j >= this.height ? 0 : this.alpha[j * this.width + i];
  }

  /** Raises the cells around (cx, cy) to the disc's alpha; true when any cell changed. */
  stamp(cx: number, cy: number): boolean {
    let changed = false;
    const i0 = Math.max(0, cx - RADIUS - this.minX), i1 = Math.min(this.width - 1, cx + RADIUS - this.minX);
    const j0 = Math.max(0, cy - RADIUS - this.minY), j1 = Math.min(this.height - 1, cy + RADIUS - this.minY);
    for (let j = j0; j <= j1; j++) {
      const dy = j + this.minY - cy;
      for (let i = i0; i <= i1; i++) {
        const dx = i + this.minX - cx, a = Math.fround(discAlpha(dx * dx + dy * dy));
        const n = j * this.width + i;
        if (a > this.alpha[n]) { this.alpha[n] = a; changed = true; }
      }
    }
    return changed;
  }

  /**
   * The disc around every reached cell (the full map's alpha). Only reached cells with an
   * unreached side need stamping: the rest lie inside the solid part of their neighbours' discs.
   */
  static around(map: LevelMap): Exploration | null {
    const b = map.bounds();
    if (!b) return null;
    const e = new Exploration(b.minX, b.minY, b.maxX, b.maxY);
    for (const k of map.reached) {
      const x = keyX(k), y = keyY(k);
      const edge = !map.reached.has(mapKey(x + 1, y)) || !map.reached.has(mapKey(x - 1, y))
        || !map.reached.has(mapKey(x, y + 1)) || !map.reached.has(mapKey(x, y - 1));
      if (edge) e.stamp(x, y);
      else e.alpha[(y - e.minY) * e.width + (x - e.minX)] = 1;
    }
    return e;
  }
}
