// Scene collision, following TudeySceneModel.collides: each tile cell carries collision flags
// (TileConfig.getRotatedValue), props carry a shape plus flags, and an actor collides with
// anything whose flags intersect its collision mask. Floors give the ground height.

import { readTransform, type Mat4 } from "../math";
import { intersects, shapeBounds, type Shape } from "./shapes";

export interface CellInfo {
  flags: number;
  floor: boolean;
  /** Ground height from the highest floor tile covering the cell. */
  z: number;
}

export interface PropShape {
  /** Set for shapes owned by a game actor, so they can be removed (destroyed blocks). */
  id?: number;
  flags: number;
  kind: "circle" | "box";
  x: number;
  y: number;
  r: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Each cell a tile at (x, y) covers, with its collision flags there (TileConfig.getRotatedValue). */
export function forTileCells(impl: any, x: number, y: number, rotation: number, fn: (x: number, y: number, flags: number) => void) {
  const width = impl.width ?? 1, height = impl.height ?? 1;
  const flagsTable: ArrayLike<number>[] = impl.collisionFlags ?? [[1]];
  const w = rotation % 2 === 0 ? width : height, h = rotation % 2 === 0 ? height : width;
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      let fx: number, fy: number;
      switch (rotation) {
        case 1: fx = ty - y; fy = tx - x; break;
        case 2: fx = width - 1 - (tx - x); fy = ty - y; break;
        case 3: fx = width - 1 - (ty - y); fy = height - 1 - (tx - x); break;
        default: fx = tx - x; fy = height - 1 - (ty - y);
      }
      let flags = 0;
      if (flagsTable.length) {
        const row = flagsTable[fy % flagsTable.length];
        flags = row && row.length ? row[fx % row.length] : 0;
      }
      fn(tx, ty, flags);
    }
  }
}

/**
 * A floor whose collision mesh moves up and down with its sprite's animation: an articulated
 * model's collision node animated by a clip (the start platform's Arrive brings its
 * "collision" node down from 3.27 units up to rest). `dz` is the node's height over its rest
 * pose, in world units, kept current by whoever plays the animation.
 */
export interface FloorLift { node: string; dz: number }

/** A floor collision triangle in world space (v1 v2 v3) with its sprite's floor flags. */
interface FloorTri { v: Float32Array; flags: number; lift?: FloorLift }

/**
 * Where a vertical line through (x, y) crosses triangle v (world space, 9 floats), or -Infinity
 * when it misses (edges inclusive, as Triangle.getIntersection's barycentric bounds are).
 */
export function rayDownZ(v: ArrayLike<number>, x: number, y: number): number {
  const ax = v[0], ay = v[1], bx = v[3], by = v[4], cx = v[6], cy = v[7];
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(d) < 1e-12) return -Infinity;
  const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
  const w = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
  const e = 1e-6;
  if (u < -e || w < -e || u + w > 1 + e) return -Infinity;
  return u * v[2] + w * v[5] + (1 - u - w) * v[8];
}

/**
 * Where something moving in a straight line from (ax, ay), a free point, to (bx, by), a
 * blocked one, first meets what blocks it: the last free point, bisected `steps` times. A
 * bullet stepped into a wall goes off at the wall's face, so its impact is not drawn inside it.
 */
export function contactPoint(ax: number, ay: number, bx: number, by: number, blocked: (x: number, y: number) => boolean, steps = 10): [number, number] {
  if (blocked(ax, ay)) return [ax, ay];
  let lo = 0, hi = 1;
  for (let i = 0; i < steps; i++) {
    const t = (lo + hi) / 2;
    if (blocked(ax + (bx - ax) * t, ay + (by - ay) * t)) hi = t; else lo = t;
  }
  return [ax + (bx - ax) * lo, ay + (by - ay) * lo];
}

export class CollisionMap {
  readonly cells = new Map<number, CellInfo>();
  readonly props: PropShape[] = [];
  /** Floor collision triangles by the cells their bounds touch. */
  readonly floors = new Map<number, FloorTri[]>();

  static key(x: number, y: number) { return (x + 32768) * 65536 + (y + 32768); }

  cell(x: number, y: number): CellInfo | undefined { return this.cells.get(CollisionMap.key(x, y)); }

  /** TileConfig.Original at (x, y) with rotation and elevation. */
  addTile(impl: any, x: number, y: number, rotation: number, elevation: number, elevationScale: number) {
    const floor = ((impl.floorFlags ?? 1) & 1) !== 0;
    forTileCells(impl, x, y, rotation, (tx, ty, flags) => {
      const k = CollisionMap.key(tx, ty);
      const c = this.cells.get(k) ?? { flags: 0, floor: false, z: -Infinity };
      c.flags |= flags;
      if (floor) { c.floor = true; c.z = Math.max(c.z, elevation * elevationScale); }
      this.cells.set(k, c);
    });
  }

  /** A placeable prop with a ShapeConfig, placed by transform. */
  addProp(impl: any, transform: any, id?: number) {
    const flags = impl.collisionFlags ?? 1;
    if (!flags || !impl.shape) return;
    const t = readTransform(transform);
    const s = t.s, [x, y] = t.t;
    const angle = 2 * Math.atan2(t.r[2], t.r[3]);
    const add = (shape: any, ox: number, oy: number) => {
      const kind = shape?.$class?.substring(shape.$class.lastIndexOf("$") + 1);
      if (kind === "Circle" || kind === "Capsule") {
        const r = (shape.radius ?? 1) * s + (kind === "Capsule" ? (shape.length ?? 1) * s / 2 : 0);
        this.props.push({ id, flags, kind: "circle", x: x + ox, y: y + oy, r, minX: x + ox - r, minY: y + oy - r, maxX: x + ox + r, maxY: y + oy + r });
      } else if (kind === "Rectangle" || kind === "Polygon") {
        // axis-aligned bounds of the rotated shape
        const pts: [number, number][] = kind === "Rectangle"
          ? [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [a * (shape.width ?? 1) / 2, b * (shape.height ?? 1) / 2])
          : (shape.vertices ?? []).map((v: any) => [v.x ?? 0, v.y ?? 0]);
        if (!pts.length) return;
        const c = Math.cos(angle), sn = Math.sin(angle);
        const wp = pts.map(([a, b]) => [x + ox + (a * c - b * sn) * s, y + oy + (a * sn + b * c) * s]);
        const xs = wp.map(p => p[0]), ys = wp.map(p => p[1]);
        this.props.push({ id, flags, kind: "box", x, y, r: 0, minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) });
      } else if (kind === "Compound") {
        for (const ts of shape.shapes ?? []) {
          const tr = ts.transform?.translation;
          add(ts.shape, (tr?.x ?? 0) * s, (tr?.y ?? 0) * s);
        }
      } else if (kind === "Transformed") {
        const tr = shape.transform?.translation;
        add(shape.shape, (tr?.x ?? 0) * s, (tr?.y ?? 0) * s);
      }
    };
    add(impl.shape, 0, 0);
  }

  /** Adds an axis-aligned box owned by actor `id`. */
  addBox(id: number, x: number, y: number, halfW: number, halfH: number, flags: number) {
    this.props.push({ id, flags, kind: "box", x, y, r: 0, minX: x - halfW, minY: y - halfH, maxX: x + halfW, maxY: y + halfH });
  }

  remove(id: number) {
    for (let i = this.props.length - 1; i >= 0; i--) if (this.props[i].id === id) this.props.splice(i, 1);
  }

  /** Whether a circle at (x, y) with radius r hits anything matching mask. */
  /** `walking` treats cells without a floor as blocked (drops); projectiles fly over them. */
  collides(x: number, y: number, r: number, mask: number, walking = true): boolean {
    for (let cy = Math.floor(y - r); cy <= Math.floor(y + r); cy++) {
      for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++) {
        const c = this.cell(cx, cy);
        // outside the map, or no floor and nothing else: treat as a drop, which blocks walking
        const blocked = c ? (c.flags & mask) !== 0 || (walking && !c.floor) : walking;
        if (!blocked) continue;
        const nx = Math.max(cx, Math.min(x, cx + 1)), ny = Math.max(cy, Math.min(y, cy + 1));
        if ((nx - x) ** 2 + (ny - y) ** 2 < r * r) return true;
      }
    }
    for (const p of this.props) {
      if ((p.flags & mask) === 0 || x + r < p.minX || x - r > p.maxX || y + r < p.minY || y - r > p.maxY) continue;
      if (p.kind === "circle") {
        if ((p.x - x) ** 2 + (p.y - y) ** 2 < (p.r + r) ** 2) return true;
      } else {
        const nx = Math.max(p.minX, Math.min(x, p.maxX)), ny = Math.max(p.minY, Math.min(y, p.maxY));
        if ((nx - x) ** 2 + (ny - y) ** 2 < r * r) return true;
      }
    }
    return false;
  }

  /** Whether a circle can travel in a straight line from a to b (sampled every half radius). */
  clearLine(ax: number, ay: number, bx: number, by: number, r: number, mask: number): boolean {
    const d = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(d / Math.max(0.2, r * 0.75)));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (this.collides(ax + (bx - ax) * t, ay + (by - ay) * t, r, mask)) return false;
    }
    return true;
  }

  /**
   * Grid A* between cell centres (eight directions, no corner cutting), as Tudey's
   * Pathfinder does over its walkable map. Returns waypoints after the start, or null when no
   * path is found within `maxNodes` expansions.
   */
  findPath(ax: number, ay: number, bx: number, by: number, r: number, mask: number, maxNodes = 1500): [number, number][] | null {
    const sx = Math.floor(ax), sy = Math.floor(ay), gx = Math.floor(bx), gy = Math.floor(by);
    const key = (x: number, y: number) => (x + 32768) * 65536 + (y + 32768);
    const free = new Map<number, boolean>();
    const walkable = (x: number, y: number) => {
      const k = key(x, y);
      let f = free.get(k);
      if (f === undefined) free.set(k, f = !this.collides(x + 0.5, y + 0.5, r, mask));
      return f;
    };
    const open: { x: number; y: number; g: number; f: number }[] = [{ x: sx, y: sy, g: 0, f: Math.hypot(gx - sx, gy - sy) }];
    const came = new Map<number, number>(), best = new Map<number, number>([[key(sx, sy), 0]]);
    let expanded = 0;
    while (open.length && expanded++ < maxNodes) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (cur.x === gx && cur.y === gy) {
        const out: [number, number][] = [];
        let k = key(cur.x, cur.y);
        while (came.has(k)) {
          const x = Math.floor(k / 65536) - 32768, y = (k % 65536) - 32768;
          out.unshift([x + 0.5, y + 0.5]);
          k = came.get(k)!;
        }
        if (out.length) out[out.length - 1] = [bx, by];
        return out;
      }
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const nx = cur.x + dx, ny = cur.y + dy;
        if (!walkable(nx, ny)) continue;
        if (dx && dy && (!walkable(cur.x + dx, cur.y) || !walkable(cur.x, cur.y + dy))) continue;
        const g = cur.g + (dx && dy ? Math.SQRT2 : 1), k = key(nx, ny);
        if (g >= (best.get(k) ?? Infinity)) continue;
        best.set(k, g);
        came.set(k, key(cur.x, cur.y));
        open.push({ x: nx, y: ny, g, f: g + Math.hypot(gx - nx, gy - ny) });
      }
    }
    return null;
  }

  /**
   * Tudey's Pathfinder.getPath (clyde tudey/server/util/Pathfinder): straight there when the
   * swept shape is clear; else A* over the walkable grid, at most `longest` units of path
   * (AStarPathUtil's longest), and when `partial` the path to the explored cell nearest the
   * goal if the goal cannot be reached; with `shortcut` the waypoints are pulled tight
   * (each waypoint skips to the farthest later one the swept shape reaches). Returns the
   * waypoints after the start, or null when no step can be made.
   */
  getPath(ax: number, ay: number, bx: number, by: number, r: number, mask: number,
    opts: { longest?: number; partial?: boolean; shortcut?: boolean } = {}): [number, number][] | null {
    if (ax === bx && ay === by) return [];
    if (this.clearLine(ax, ay, bx, by, r, mask)) return [[bx, by]];
    const longest = opts.longest ?? Infinity;
    const sx = Math.floor(ax), sy = Math.floor(ay), gx = Math.floor(bx), gy = Math.floor(by);
    const key = (x: number, y: number) => (x + 32768) * 65536 + (y + 32768);
    const unkey = (k: number): [number, number] => [Math.floor(k / 65536) - 32768, (k % 65536) - 32768];
    const free = new Map<number, boolean>();
    const walkable = (x: number, y: number) => {
      const k = key(x, y);
      let f = free.get(k);
      if (f === undefined) free.set(k, f = !this.collides(x + 0.5, y + 0.5, r, mask));
      return f;
    };
    const open: { x: number; y: number; g: number; f: number }[] = [{ x: sx, y: sy, g: 0, f: Math.hypot(gx - sx, gy - sy) }];
    const came = new Map<number, number>(), best = new Map<number, number>([[key(sx, sy), 0]]);
    let closest = key(sx, sy), cd = Math.hypot(gx - sx, gy - sy), goal: number | null = null, expanded = 0;
    while (open.length && expanded++ < 2000) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const cur = open.splice(bi, 1)[0];
      const ck = key(cur.x, cur.y), h = Math.hypot(gx - cur.x, gy - cur.y);
      if (h < cd) { cd = h; closest = ck; }
      if (cur.x === gx && cur.y === gy) { goal = ck; break; }
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const nx = cur.x + dx, ny = cur.y + dy;
        if (!walkable(nx, ny)) continue;
        if (dx && dy && (!walkable(cur.x + dx, cur.y) || !walkable(cur.x, cur.y + dy))) continue;
        const g = cur.g + (dx && dy ? Math.SQRT2 : 1), k = key(nx, ny);
        if (g > longest || g >= (best.get(k) ?? Infinity)) continue;
        best.set(k, g);
        came.set(k, ck);
        open.push({ x: nx, y: ny, g, f: g + Math.hypot(gx - nx, gy - ny) });
      }
    }
    const end = goal ?? (opts.partial ? closest : null);
    if (end === null || end === key(sx, sy)) return null;
    let pts: [number, number][] = [];
    for (let k = end; came.has(k); k = came.get(k)!) { const [x, y] = unkey(k); pts.unshift([x + 0.5, y + 0.5]); }
    if (goal !== null) pts[pts.length - 1] = [bx, by];
    if (!opts.shortcut) return pts;
    const out: [number, number][] = [];
    let cx = ax, cy = ay;
    for (let i = 0; i < pts.length;) {
      let j = pts.length - 1;
      while (j > i && !this.clearLine(cx, cy, pts[j][0], pts[j][1], r, mask)) j--;
      out.push(pts[j]);
      [cx, cy] = pts[j];
      i = j + 1;
    }
    return out;
  }

  /**
   * Adds a floor sprite's collision triangles (model space, 9 floats each) placed by `matrix`:
   * a tile or placeable whose floorFlags are set (TileConfig/PlaceableConfig floorFlags,
   * default 0x01). TudeySceneView.getFloorZ casts a ray straight down onto these.
   */
  addFloor(tris: ArrayLike<number>, matrix: Mat4, floorFlags = 1, lift?: FloorLift) {
    if (!floorFlags || tris.length < 9) return;
    const m = matrix;
    // a mirroring placement flips the winding the ray test culls by (it runs in model space)
    const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
    const sign = det < 0 ? -1 : 1;
    for (let i = 0; i + 8 < tris.length; i += 9) {
      const w = new Float32Array(9);
      for (let k = 0; k < 3; k++) {
        const x = tris[i + k * 3], y = tris[i + k * 3 + 1], z = tris[i + k * 3 + 2];
        w[k * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
        w[k * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        w[k * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
      // Triangle.getIntersection only takes faces whose front looks along -ray (up, here)
      const nz = ((w[3] - w[0]) * (w[7] - w[1]) - (w[4] - w[1]) * (w[6] - w[0])) * sign;
      if (nz <= 1e-9) continue;
      const tri: FloorTri = { v: w, flags: floorFlags, lift };
      const x0 = Math.floor(Math.min(w[0], w[3], w[6])), x1 = Math.floor(Math.max(w[0], w[3], w[6]));
      const y0 = Math.floor(Math.min(w[1], w[4], w[7])), y1 = Math.floor(Math.max(w[1], w[4], w[7]));
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) continue;
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        const k = CollisionMap.key(cx, cy);
        let list = this.floors.get(k);
        if (!list) this.floors.set(k, list = []);
        list.push(tri);
      }
    }
  }

  /**
   * TudeySceneView.getFloorZ: the height where a ray cast straight down from high above
   * (x, y) first meets a floor sprite's collision mesh whose floor flags match `mask` (actors'
   * floorMask defaults to 0xFF), so stairs, ramps and raised floors lift what stands on them.
   * Where no floor mesh lies under the point, the tile grid's elevation stands in
   * (TudeySceneModel.getFloorZ), else `defvalue`.
   */
  floorZ(x: number, y: number, mask = 0xff, defvalue = 0): number {
    const hit = this.floorHit(x, y, mask);
    if (hit) return hit.z;
    const c = this.cell(Math.floor(x), Math.floor(y));
    return c && isFinite(c.z) ? c.z : defvalue;
  }

  /** The floor mesh face a downward ray through (x, y) meets first, and its height (null: none). */
  private floorHit(x: number, y: number, mask = 0xff): { z: number; lift?: FloorLift } | null {
    const list = this.floors.get(CollisionMap.key(Math.floor(x), Math.floor(y)));
    let best = -Infinity, lift: FloorLift | undefined;
    if (list) {
      for (const t of list) {
        if ((t.flags & mask) === 0) continue;
        const z = rayDownZ(t.v, x, y) + (t.lift?.dz ?? 0);
        if (z > best) { best = z; lift = t.lift; }
      }
    }
    return best > -Infinity ? { z: best, lift } : null;
  }

  /** The moving floor under (x, y) while it is off its rest pose (actors on it ride it). */
  liftAt(x: number, y: number, mask = 0xff): FloorLift | null {
    const lift = this.floorHit(x, y, mask)?.lift;
    return lift && lift.dz !== 0 ? lift : null;
  }

  /**
   * A floor-tile placeable (PlaceableConfig.Original.floorTile, the start platform): its shape
   * is floor where no tile is, at the placeable's elevation, as TudeySceneModel.getFloorZ
   * falls back to the floor placeables' elevations (FloorPlaceableFilter) where no tile lies.
   * Cells whose centres the shape covers become walkable; it adds no collision flags.
   */
  addFloorPlaceable(shape: Shape, z: number) {
    const [x0, y0, x1, y1] = shapeBounds(shape);
    for (let y = Math.floor(y0); y <= Math.floor(y1); y++) {
      for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
        if (!intersects(shape, { k: "point", x: x + 0.5, y: y + 0.5 })) continue;
        const k = CollisionMap.key(x, y);
        const c = this.cells.get(k) ?? { flags: 0, floor: false, z: -Infinity };
        // a tile's floor keeps its own elevation (the placeables only stand in where none is)
        if (!c.floor) { c.floor = true; c.z = z; }
        this.cells.set(k, c);
      }
    }
  }

  /** Ground height under (x, y): the floor the client stands actors and effects on. */
  groundZ(x: number, y: number): number {
    return this.floorZ(x, y);
  }

  /** A walkable spot near (x, y), searching outward. */
  findSpawn(x: number, y: number, r: number, mask: number): [number, number] | null {
    for (let d = 0; d < 60; d++) {
      for (let dy = -d; dy <= d; dy++) {
        for (let dx = -d; dx <= d; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
          const px = Math.floor(x) + dx + 0.5, py = Math.floor(y) + dy + 0.5;
          if (!this.collides(px, py, r, mask)) return [px, py];
        }
      }
    }
    return null;
  }
}

export type { Mat4 };
