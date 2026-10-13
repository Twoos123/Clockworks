// Clyde expressions (com.threerings.expr) compiled to functions of time. Covers the forms the
// game data uses for animated texture transforms and procedural node animation: constants,
// clock/elapsed, arithmetic, sin/cos/noise, parsed text expressions, Cartesian vectors,
// Euler-angle quaternions and uniform/non-uniform transforms.

import { compose, type Mat4, type Quat, type Vec3 } from "./math";

export type F<T> = (t: number) => T;

const kind = (e: any) => (e?.$class ?? "").substring((e?.$class ?? "").lastIndexOf("$") + 1);

// ---- noise (gradient noise as Clyde's NoiseUtil, with a fixed permutation table)
const PERM = (() => {
  const p = Array.from({ length: 256 }, (_, i) => i);
  let seed = 1337;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  return [...p, ...p];
})();
const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const grad = (h: number, x: number) => ((h & 1) ? -x : x) * (1 + (h & 7) / 8);
export function noise1(x: number): number {
  const x0 = Math.floor(x), f = x - x0, i = x0 & 255;
  const a = grad(PERM[i], f), b = grad(PERM[i + 1], f - 1);
  return a + (b - a) * ease(f);
}
const frac = (x: number) => x - Math.floor(x);

// ---- parsed text expressions, e.g. "1+sin(clock()*1)*0.025"
const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, pow: Math.pow, abs: Math.abs,
  min: Math.min, max: Math.max, floor: Math.floor, sqrt: Math.sqrt,
  noise1: noise1, noise2: (x, y) => noise1(x + y * 57.31),
  square: x => (frac(x) < 0.5 ? 1 : -1), triangle: x => 1 - 4 * Math.abs(frac(x + 0.25) - 0.5),
  ramp: x => frac(x), saw: x => 1 - frac(x),
};

export function parseFloatExpression(src: string): F<number> {
  const tokens = src.match(/\d*\.\d+(?:[eE][-+]?\d+)?|\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|[A-Za-z_]\w*|\S/g) ?? [];
  let i = 0;
  const peek = () => tokens[i], next = () => tokens[i++];
  const expect = (t: string) => { if (next() !== t) throw new Error(`Expected ${t} in "${src}"`); };
  const primary = (): F<number> => {
    const t = next();
    if (t === undefined) throw new Error(`Unexpected end of "${src}"`);
    if (t === "(") { const e = add(); expect(")"); return e; }
    if (t === "-") { const e = unary(); return x => -e(x); }
    if (t === "+") return unary();
    if (/^[\d.]/.test(t)) { const v = parseFloat(t); return () => v; }
    if (peek() === "(") {
      next();
      const args: F<number>[] = [];
      if (peek() !== ")") { do { args.push(add()); } while (peek() === "," && next()); }
      expect(")");
      if (t === "clock" || t === "elapsed") return x => x;
      const fn = FUNCS[t];
      if (!fn) throw new Error(`Unknown function ${t}`);
      return x => fn(...args.map(a => a(x)));
    }
    if (t === "PI" || t === "pi") return () => Math.PI;
    throw new Error(`Unknown token ${t} in "${src}"`);
  };
  const unary = primary;
  const mul = (): F<number> => {
    let left = unary();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = next(), l = left, r = unary();
      left = op === "*" ? x => l(x) * r(x) : op === "/" ? x => l(x) / r(x) : x => l(x) % r(x);
    }
    return left;
  };
  const add = (): F<number> => {
    let left = mul();
    while (peek() === "+" || peek() === "-") {
      const op = next(), l = left, r = mul();
      left = op === "+" ? x => l(x) + r(x) : x => l(x) - r(x);
    }
    return left;
  };
  const result = add();
  if (i < tokens.length) throw new Error(`Trailing input in "${src}"`);
  return result;
}

// ---- object expressions

export function floatExpr(e: any, def = 0): F<number> {
  if (e == null) return () => def;
  if (typeof e === "number") return () => e;
  const two = (op: (a: number, b: number) => number) => {
    const a = floatExpr(e.firstOperand), b = floatExpr(e.secondOperand);
    return (t: number) => op(a(t), b(t));
  };
  const one = (op: (a: number) => number) => { const a = floatExpr(e.operand); return (t: number) => op(a(t)); };
  switch (kind(e)) {
    case "Constant": { const v = e.value ?? 0; return () => v; }
    case "Clock": case "Elapsed": return t => t;
    case "Add": return two((a, b) => a + b);
    case "Subtract": return two((a, b) => a - b);
    case "Multiply": return two((a, b) => a * b);
    case "Divide": return two((a, b) => a / b);
    case "Remainder": return two((a, b) => a % b);
    case "Negate": return one(a => -a);
    case "Sin": return one(Math.sin);
    case "Cos": return one(Math.cos);
    case "Tan": return one(Math.tan);
    case "Noise1": return one(noise1);
    case "Noise2": return two((a, b) => noise1(a + b * 57.31));
    case "Parsed": try { return parseFloatExpression(e.expression ?? "0.0"); } catch { return () => def; }
    default: return () => def;
  }
}

export function vec3Expr(e: any, def: Vec3 = [0, 0, 0]): F<Vec3> {
  if (!e) return () => def;
  if (kind(e) === "Cartesian") {
    const x = floatExpr(e.x), y = floatExpr(e.y), z = floatExpr(e.z);
    return t => [x(t), y(t), z(t)];
  }
  if (kind(e) === "Constant" && e.value) { const v: Vec3 = [e.value.x ?? 0, e.value.y ?? 0, e.value.z ?? 0]; return () => v; }
  return () => def;
}

/** Quaternion.fromAngles(x, y, z), float-for-float with Clyde. */
export function fromAngles(x: number, y: number, z: number): Quat {
  const hx = x / 2, hy = y / 2, hz = z / 2;
  const sz = Math.sin(hz), cz = Math.cos(hz), sy = Math.sin(hy), cy = Math.cos(hy), sx = Math.sin(hx), cx = Math.cos(hx);
  const szsy = sz * sy, czsy = cz * sy, szcy = sz * cy, czcy = cz * cy;
  return [czcy * sx - szsy * cx, czsy * cx + szcy * sx, szcy * cx - czsy * sx, czcy * cx + szsy * sx];
}

export function quatExpr(e: any): F<Quat> {
  if (kind(e) === "Angles") {
    const x = floatExpr(e.x), y = floatExpr(e.y), z = floatExpr(e.z);
    return t => fromAngles(x(t), y(t), z(t));
  }
  if (kind(e) === "Constant" && e.value) { const q: Quat = [e.value.x ?? 0, e.value.y ?? 0, e.value.z ?? 0, e.value.w ?? 1]; return () => q; }
  return () => [0, 0, 0, 1];
}

/** Compiles a Transform3DExpression to a matrix function, or null if it is constant identity. */
export function transformExpr(e: any): F<Mat4> | null {
  switch (kind(e)) {
    case "Uniform": {
      const tr = vec3Expr(e.translation), rot = quatExpr(e.rotation), sc = floatExpr(e.scale, 1);
      return t => compose(tr(t), rot(t), sc(t));
    }
    case "NonUniform": {
      const tr = vec3Expr(e.translation), rot = quatExpr(e.rotation), sc = vec3Expr(e.scale, [1, 1, 1]);
      return t => {
        const m = compose(tr(t), rot(t), 1), s = sc(t);
        for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] *= s[c];
        return m;
      };
    }
    default: return null;
  }
}
