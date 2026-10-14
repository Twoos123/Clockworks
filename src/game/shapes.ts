// 2D shapes for Tudey logic (sensors, regions, entry and actor shapes) and their
// intersection tests. ShapeConfigs from the data become world-space shapes.

export type Pt = [number, number];
export type Shape =
  | { k: "point"; x: number; y: number }
  | { k: "circle"; x: number; y: number; r: number }
  | { k: "poly"; pts: Pt[] }
  | { k: "multi"; shapes: Shape[] };

const kind = (o: any) => { const c: string = o?.$class ?? ""; return c.substring(c.lastIndexOf("$") + 1); };

/** A shape's axis-aligned bounds: [minX, minY, maxX, maxY]. */
export function shapeBounds(s: Shape): [number, number, number, number] {
  switch (s.k) {
    case "point": return [s.x, s.y, s.x, s.y];
    case "circle": return [s.x - s.r, s.y - s.r, s.x + s.r, s.y + s.r];
    case "poly": {
      const xs = s.pts.map(p => p[0]), ys = s.pts.map(p => p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    case "multi": {
      const b = s.shapes.map(shapeBounds);
      return [Math.min(...b.map(v => v[0])), Math.min(...b.map(v => v[1])), Math.max(...b.map(v => v[2])), Math.max(...b.map(v => v[3]))];
    }
  }
}

/** A ShapeConfig placed at (x, y) with rotation `rot` (radians) and uniform scale. */
export function shapeFromConfig(cfg: any, x: number, y: number, rot: number, scale = 1, depth = 0): Shape | null {
  if (!cfg || depth > 6) return null;
  const c = Math.cos(rot), s = Math.sin(rot);
  const at = (lx: number, ly: number): Pt => [x + (lx * c - ly * s) * scale, y + (lx * s + ly * c) * scale];
  switch (kind(cfg)) {
    case "Point": { const p = at(cfg.location?.x ?? 0, cfg.location?.y ?? 0); return { k: "point", x: p[0], y: p[1] }; }
    case "Segment": return { k: "poly", pts: [at(cfg.start?.x ?? 0, cfg.start?.y ?? 0), at(cfg.end?.x ?? 1, cfg.end?.y ?? 0)] };
    case "Circle": { const p = at(cfg.center?.x ?? 0, cfg.center?.y ?? 0); return { k: "circle", x: p[0], y: p[1], r: (cfg.radius ?? 1) * scale }; }
    case "Capsule": {
      const r = cfg.radius ?? 1, l = (cfg.length ?? 1) / 2 + r;
      return { k: "poly", pts: [at(-l, -r), at(l, -r), at(l, r), at(-l, r)] };
    }
    case "Rectangle": {
      const w = (cfg.width ?? 1) / 2, h = (cfg.height ?? 1) / 2;
      const ox = cfg.center?.x ?? 0, oy = cfg.center?.y ?? 0;
      return { k: "poly", pts: [at(ox - w, oy - h), at(ox + w, oy - h), at(ox + w, oy + h), at(ox - w, oy + h)] };
    }
    case "Polygon": return { k: "poly", pts: ((cfg.vertices ?? []) as any[]).map(v => at(v.x ?? 0, v.y ?? 0)) };
    case "Transformed": {
      const t = cfg.transform, tr = t?.translation;
      const p = at(tr?.x ?? 0, tr?.y ?? 0);
      return shapeFromConfig(cfg.shape, p[0], p[1], rot + (t?.rotation ?? 0), scale * (t?.scale ?? 1), depth + 1);
    }
    case "Compound": {
      const shapes = ((cfg.shapes ?? []) as any[]).map(ts => {
        const t = ts?.transform, tr = t?.translation;
        const p = at(tr?.x ?? 0, tr?.y ?? 0);
        return shapeFromConfig(ts?.shape, p[0], p[1], rot + (t?.rotation ?? 0), scale * (t?.scale ?? 1), depth + 1);
      }).filter((v): v is Shape => !!v);
      return shapes.length ? { k: "multi", shapes } : null;
    }
    default: return null;
  }
}

/** Grows a shape outward by `e` (circles exactly, polygons about their centroid). */
export function expand(sh: Shape, e: number): Shape {
  if (!e) return sh;
  switch (sh.k) {
    case "point": return { k: "circle", x: sh.x, y: sh.y, r: e };
    case "circle": return { ...sh, r: sh.r + e };
    case "multi": return { k: "multi", shapes: sh.shapes.map(s => expand(s, e)) };
    case "poly": {
      const cx = sh.pts.reduce((a, p) => a + p[0], 0) / sh.pts.length, cy = sh.pts.reduce((a, p) => a + p[1], 0) / sh.pts.length;
      return { k: "poly", pts: sh.pts.map(([x, y]) => { const d = Math.hypot(x - cx, y - cy) || 1; return [x + (x - cx) / d * e, y + (y - cy) / d * e] as Pt; }) };
    }
  }
}

export function centroid(sh: Shape): Pt {
  switch (sh.k) {
    case "point": case "circle": return [sh.x, sh.y];
    case "poly": return [sh.pts.reduce((a, p) => a + p[0], 0) / sh.pts.length, sh.pts.reduce((a, p) => a + p[1], 0) / sh.pts.length];
    case "multi": return sh.shapes.length ? centroid(sh.shapes[0]) : [0, 0];
  }
}

function pointInPoly(x: number, y: number, pts: Pt[]): boolean {
  if (pts.length < 3) return false;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist2(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l)) : 0;
  const x = a[0] + t * dx - px, y = a[1] + t * dy - py;
  return x * x + y * y;
}

function segsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

const edges = (pts: Pt[]) => pts.length < 2 ? [] : pts.length === 2 ? [[pts[0], pts[1]] as [Pt, Pt]] : pts.map((p, i) => [p, pts[(i + 1) % pts.length]] as [Pt, Pt]);

function circlePoly(x: number, y: number, r: number, pts: Pt[]): boolean {
  if (pointInPoly(x, y, pts)) return true;
  return edges(pts).some(([a, b]) => segDist2(x, y, a, b) <= r * r);
}

export function intersects(a: Shape, b: Shape): boolean {
  if (a.k === "multi") return a.shapes.some(s => intersects(s, b));
  if (b.k === "multi") return b.shapes.some(s => intersects(a, s));
  if (a.k === "point") return intersects({ k: "circle", x: a.x, y: a.y, r: 0 }, b);
  if (b.k === "point") return intersects(a, { k: "circle", x: b.x, y: b.y, r: 0 });
  if (a.k === "circle" && b.k === "circle") return Math.hypot(a.x - b.x, a.y - b.y) <= a.r + b.r;
  if (a.k === "circle" && b.k === "poly") return circlePoly(a.x, a.y, a.r, b.pts);
  if (a.k === "poly" && b.k === "circle") return circlePoly(b.x, b.y, b.r, a.pts);
  if (a.k === "poly" && b.k === "poly") {
    if (a.pts.some(p => pointInPoly(p[0], p[1], b.pts)) || b.pts.some(p => pointInPoly(p[0], p[1], a.pts))) return true;
    for (const [p, q] of edges(a.pts)) for (const [r, s] of edges(b.pts)) if (segsCross(p, q, r, s)) return true;
    return false;
  }
  return false;
}
