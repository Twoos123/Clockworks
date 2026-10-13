// Scene collision, following TudeySceneModel.collides: each tile cell carries collision flags
// (TileConfig.getRotatedValue), props carry a shape plus flags, and an actor collides with
// anything whose flags intersect its collision mask. Floors give the ground height.

import { readTransform, type Mat4 } from "../math";

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

export class CollisionMap {
  readonly cells = new Map<number, CellInfo>();
  readonly props: PropShape[] = [];

  static key(x: number, y: number) { return (x + 32768) * 65536 + (y + 32768); }

  cell(x: number, y: number): CellInfo | undefined { return this.cells.get(CollisionMap.key(x, y)); }

  /** TileConfig.Original at (x, y) with rotation and elevation. */
  addTile(impl: any, x: number, y: number, rotation: number, elevation: number, elevationScale: number) {
    const width = impl.width ?? 1, height = impl.height ?? 1;
    const flagsTable: ArrayLike<number>[] = impl.collisionFlags ?? [[1]];
    const floor = ((impl.floorFlags ?? 1) & 1) !== 0;
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
        const k = CollisionMap.key(tx, ty);
        const c = this.cells.get(k) ?? { flags: 0, floor: false, z: -Infinity };
        c.flags |= flags;
        if (floor) { c.floor = true; c.z = Math.max(c.z, elevation * elevationScale); }
        this.cells.set(k, c);
      }
    }
  }

  /** A placeable prop with a ShapeConfig, placed by transform. */
  addProp(impl: any, transform: any) {
    const flags = impl.collisionFlags ?? 1;
    if (!flags || !impl.shape) return;
    const t = readTransform(transform);
    const s = t.s, [x, y] = t.t;
    const angle = 2 * Math.atan2(t.r[2], t.r[3]);
    const add = (shape: any, ox: number, oy: number) => {
      const kind = shape?.$class?.substring(shape.$class.lastIndexOf("$") + 1);
      if (kind === "Circle" || kind === "Capsule") {
        const r = (shape.radius ?? 1) * s + (kind === "Capsule" ? (shape.length ?? 1) * s / 2 : 0);
        this.props.push({ flags, kind: "circle", x: x + ox, y: y + oy, r, minX: x + ox - r, minY: y + oy - r, maxX: x + ox + r, maxY: y + oy + r });
      } else if (kind === "Rectangle" || kind === "Polygon") {
        // axis-aligned bounds of the rotated shape
        const pts: [number, number][] = kind === "Rectangle"
          ? [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [a * (shape.width ?? 1) / 2, b * (shape.height ?? 1) / 2])
          : (shape.vertices ?? []).map((v: any) => [v.x ?? 0, v.y ?? 0]);
        if (!pts.length) return;
        const c = Math.cos(angle), sn = Math.sin(angle);
        const wp = pts.map(([a, b]) => [x + ox + (a * c - b * sn) * s, y + oy + (a * sn + b * c) * s]);
        const xs = wp.map(p => p[0]), ys = wp.map(p => p[1]);
        this.props.push({ flags, kind: "box", x, y, r: 0, minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) });
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

  /** Ground height under (x, y). */
  groundZ(x: number, y: number): number {
    const c = this.cell(Math.floor(x), Math.floor(y));
    return c && isFinite(c.z) ? c.z : 0;
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
