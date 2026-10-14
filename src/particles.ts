// Particle systems (com.threerings.opengl.effect.config.ParticleSystemConfig), simulated on
// the CPU and drawn as camera-facing, fixed or velocity-aligned quads. Exported configs omit
// default-valued fields, so every reader below falls back to Clyde's declared defaults.

import { fromAngles } from "./expr";
import { compose, multiply, type Mat4, type Quat, type Vec3 } from "./math";
import type { ResolvedMaterial } from "./config/materials";
import type { LoadedModel } from "./model";

type Rgba = [number, number, number, number];
const kind = (e: any) => (e?.$class ?? "").substring((e?.$class ?? "").lastIndexOf("$") + 1);
const v3 = (v: any, d: Vec3): Vec3 => (v ? [v.x ?? 0, v.y ?? 0, v.z ?? 0] : d);
const c4 = (c: any, d: Rgba): Rgba => (c ? [c.r ?? 0, c.g ?? 0, c.b ?? 0, c.a ?? 0] : d);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp4 = (a: Rgba, b: Rgba, t: number): Rgba => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];

// ---- easing and functions of normalized age

function easing(e: any): (t: number) => number {
  switch (kind(e)) {
    case "QuadraticIn": return t => t * t;
    case "QuadraticOut": return t => t * (2 - t);
    case "QuadraticInAndOut": return t => (t <= 0.5 ? 2 * t * t : 2 * t * (2 - t) - 1);
    case "CubicIn": return t => t * t * t;
    case "CubicOut": return t => { const u = t - 1; return u * u * u + 1; };
    case "CubicInAndOut": return t => { const u = t * 2; if (u < 1) return 0.5 * u * u * u; const w = u - 2; return 0.5 * (w * w * w + 2); };
    default: return t => t;
  }
}

/** Shared shape of Clyde's FloatFunction and ColorFunction families. */
function curve<T>(f: any, read: (x: any, d: T) => T, mix: (a: T, b: T, t: number) => T, d: {
  constant: T; linear: [T, T]; inOut: [T, T]; three: [T, T, T]; multi: [T, T];
}, valueKey: string): (t: number) => T {
  switch (kind(f)) {
    case "Linear": {
      const s = read(f.start, d.linear[0]), e = read(f.end, d.linear[1]), ez = easing(f.easing);
      return t => mix(s, e, ez(t));
    }
    case "InAndOut": {
      const s = read(f.start, d.inOut[0]), e = read(f.end, d.inOut[1]), i = f.in ?? 0.25, o = f.out ?? 0.25;
      return t => (t < i ? mix(s, e, t / i) : t <= 1 - o ? e : mix(s, e, (1 - t) / o));
    }
    case "ThreePoint": {
      const s = read(f.start, d.three[0]), m = read(f.middle, d.three[1]), e = read(f.end, d.three[2]);
      const i = f.in ?? 0.25, o = f.out ?? 0.25;
      return t => (t < i ? mix(s, m, t / i) : t <= 1 - o ? m : mix(e, m, (1 - t) / o));
    }
    case "Multipoint": {
      const pts: { t: number; v: T }[] = [{ t: 0, v: read(f.start, d.multi[0]) }];
      let acc = 0;
      for (const p of f.middle ?? []) { acc += p.offset ?? 0.25; pts.push({ t: acc, v: read(p[valueKey], d.constant) }); }
      pts.push({ t: 1, v: read(f.end, d.multi[1]) });
      return t => {
        for (let i = 1; i < pts.length; i++) {
          if (t <= pts[i].t) { const a = pts[i - 1], b = pts[i]; return mix(a.v, b.v, b.t > a.t ? (t - a.t) / (b.t - a.t) : 0); }
        }
        return pts[pts.length - 1].v;
      };
    }
    default: { const v = read(f?.[valueKey], d.constant); return () => v; }
  }
}

const floatCurve = (f: any, def: number) => curve<number>(f, (x, d) => (typeof x === "number" ? x : d), lerp,
  { constant: def, linear: [0, 0], inOut: [0, 0], three: [0, 0, 0], multi: [0, 0] }, "value");
const W: Rgba = [1, 1, 1, 1], W0: Rgba = [1, 1, 1, 0];
const colorCurve = (f: any) => curve<Rgba>(f, (x, d) => c4(x, d), lerp4,
  { constant: W, linear: [W, W0], inOut: [W0, W], three: [W0, W, W0], multi: [W, W0] }, "color");

// ---- random variables

function floatVar(v: any, def: () => number): () => number {
  if (!v) return def;
  switch (kind(v)) {
    case "Constant": { const x = v.value ?? 0; return () => x; }
    case "Uniform": { const a = v.minimum ?? 0, b = v.maximum ?? 0; return () => lerp(a, b, Math.random()); }
    case "Normal": {
      const m = v.mean ?? 0, s = v.stddev ?? 0;
      return () => m + s * Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());
    }
    case "Exponential": { const m = v.mean ?? 1; return () => -m * Math.log(Math.random() || 1e-9); }
    default: return def;
  }
}

/** A FloatFunctionVariable: picks a curve per particle. */
function floatFunctionVar(v: any, def: number): () => (t: number) => number {
  if (!v) return () => () => def;
  if (kind(v) === "Fixed") { const c = floatCurve(v.function, 0); return () => c; }
  // Variable* forms: sample each endpoint per particle
  const k = kind(v);
  return () => {
    const s = floatVar(v.start ?? v.value, () => 0)(), e = floatVar(v.end, () => 0)();
    if (k === "VariableConstant") return () => s;
    if (k === "VariableLinear") { const ez = easing(v.easing); return t => lerp(s, e, ez(t)); }
    if (k === "VariableThreePoint") {
      const m = floatVar(v.middle, () => 0)(), i = floatVar(v.in, () => 0.25)(), o = floatVar(v.out, () => 0.25)();
      return t => (t < i ? lerp(s, m, t / i) : t <= 1 - o ? m : lerp(e, m, (1 - t) / o));
    }
    if (k === "VariableMultipoint") {
      // as Multipoint: each middle point's offset adds to the last, all sampled per particle
      const pts: { t: number; v: number }[] = [{ t: 0, v: s }];
      let acc = 0;
      for (const p of v.middle ?? []) {
        acc += floatVar(p.offset, () => 0.25)();
        pts.push({ t: acc, v: floatVar(p.value, () => 0)() });
      }
      pts.push({ t: 1, v: e });
      return t => {
        for (let i = 1; i < pts.length; i++) {
          if (t <= pts[i].t) { const a = pts[i - 1], b = pts[i]; return lerp(a.v, b.v, b.t > a.t ? (t - a.t) / (b.t - a.t) : 0); }
        }
        return pts[pts.length - 1].v;
      };
    }
    return () => s;
  };
}

function colorFunctionVar(v: any): () => (t: number) => Rgba {
  if (!v) return () => () => W;
  if (kind(v) === "Fixed") { const c = colorCurve(v.function); return () => c; }
  const pick = (cv: any): Rgba => {
    if (kind(cv) === "Uniform") { const a = c4(cv.minimum, W), b = c4(cv.maximum, W); return lerp4(a, b, Math.random()); }
    return c4(cv?.value, W);
  };
  return () => {
    const s = pick(v.start ?? v.value), e = pick(v.end);
    if (kind(v) === "VariableLinear") { const ez = easing(v.easing); return t => lerp4(s, e, ez(t)); }
    return () => s;
  };
}

function quatVar(v: any): () => Quat {
  switch (kind(v)) {
    case "Constant": { const q: Quat = v.value ? [v.value.x ?? 0, v.value.y ?? 0, v.value.z ?? 0, v.value.w ?? 1] : [0, 0, 0, 1]; return () => q; }
    case "Uniform": {
      const a = v3(v.minimum, [0, 0, 0]), b = v3(v.maximum, [0, 0, 0]);
      return () => fromAngles(lerp(a[0], b[0], Math.random()), lerp(a[1], b[1], Math.random()), lerp(a[2], b[2], Math.random()));
    }
    case "Random": return () => fromAngles(Math.random() * 2 * Math.PI, Math.random() * 2 * Math.PI, Math.random() * 2 * Math.PI);
    default: return () => [0, 0, 0, 1];
  }
}

function vecVar(v: any): () => Vec3 {
  if (kind(v) === "Uniform") {
    const a = v3(v.minimum, [0, 0, 0]), b = v3(v.maximum, [0, 0, 0]);
    return () => [lerp(a[0], b[0], Math.random()), lerp(a[1], b[1], Math.random()), lerp(a[2], b[2], Math.random())];
  }
  const c = v3(v?.value, [0, 0, 0]);
  return () => c;
}

// ---- layer definitions

export interface ParticleLayer {
  name: string;
  count: number;
  alphaMode: string;
  alignment: string;
  geometry: string;
  /** Quads or Lines drawn as trails of this many segments (0: plain). */
  segments: number;
  /**
   * GroupPriority: the layer sorts at its group's centre, nudged toward the camera by its
   * priority, so a system's layers draw in rising priority (null: sorted by its own centre).
   */
  priority: number | null;
  material: ResolvedMaterial;
  divisionsS: number;
  divisionsT: number;
  color: () => (t: number) => Rgba;
  size: () => (t: number) => number;
  length: () => (t: number) => number;
  frame: () => (t: number) => number;
  speed: () => number;
  lifespan: () => number;
  orientation: () => Quat;
  angularVelocity: () => Vec3;
  place: () => Vec3;
  shoot: (pos: Vec3) => Vec3;
  counter: { kind: string; rate: number; interval: () => number };
  respawn: boolean;
  startTime: number;
  timeScale: number;
  moveWithEmitter: boolean;
  transform: Mat4;
  influences: ((p: Particle, dt: number) => void)[];
  /** Model drawn per particle (Meshes geometry, or a MetaParticleSystemConfig layer). */
  modelRef?: any;
  model?: LoadedModel | null;
}

function randomUnit(): Vec3 {
  const z = Math.random() * 2 - 1, a = Math.random() * 2 * Math.PI, r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), r * Math.sin(a), z];
}

function placer(p: any): () => Vec3 {
  switch (kind(p)) {
    case "Line": { const l = p.length ?? 1; return () => [(Math.random() - 0.5) * l, 0, 0]; }
    case "Box": {
      const w = p.width ?? 1, l = p.length ?? 1, h = p.height ?? 1;
      return () => [(Math.random() - 0.5) * w, (Math.random() - 0.5) * l, (Math.random() - 0.5) * h];
    }
    case "Ring": {
      const ri = p.innerRadius ?? 0, ro = p.outerRadius ?? 1;
      return () => { const a = Math.random() * 2 * Math.PI, r = lerp(ri, ro, Math.sqrt(Math.random())); return [r * Math.cos(a), r * Math.sin(a), 0]; };
    }
    case "Shell": {
      const ri = p.innerRadius ?? 0, ro = p.outerRadius ?? 1;
      return () => { const u = randomUnit(), r = lerp(ri, ro, Math.cbrt(Math.random())); return [u[0] * r, u[1] * r, u[2] * r]; };
    }
    default: return () => [0, 0, 0];
  }
}

function shooter(s: any): (pos: Vec3) => Vec3 {
  if (kind(s) === "Outward") {
    const bias = s.upwardBias ?? 0;
    return pos => {
      const l = Math.hypot(...pos);
      const d: Vec3 = l > 1e-5 ? [pos[0] / l, pos[1] / l, pos[2] / l] : randomUnit();
      d[2] += bias;
      const n = Math.hypot(...d) || 1;
      return [d[0] / n, d[1] / n, d[2] / n];
    };
  }
  // Cone (the default): a direction between the minimum and maximum angle from the axis
  const dir = v3(s?.direction, [0, 0, 1]);
  const min = s ? (s.minimumAngle ?? 0) : 0, max = s ? (s.maximumAngle ?? Math.PI / 4) : Math.PI / 4;
  const n = Math.hypot(...dir) || 1, d: Vec3 = [dir[0] / n, dir[1] / n, dir[2] / n];
  // any vector perpendicular to the axis
  const ref: Vec3 = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const p1: Vec3 = [d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]];
  const l1 = Math.hypot(...p1); p1[0] /= l1; p1[1] /= l1; p1[2] /= l1;
  const p2: Vec3 = [d[1] * p1[2] - d[2] * p1[1], d[2] * p1[0] - d[0] * p1[2], d[0] * p1[1] - d[1] * p1[0]];
  return () => {
    const ang = lerp(min, max, Math.random()), az = Math.random() * 2 * Math.PI;
    const s1 = Math.sin(ang) * Math.cos(az), s2 = Math.sin(ang) * Math.sin(az), c = Math.cos(ang);
    return [d[0] * c + p1[0] * s1 + p2[0] * s2, d[1] * c + p1[1] * s1 + p2[1] * s2, d[2] * c + p1[2] * s1 + p2[2] * s2];
  };
}

function influence(i: any): ((p: Particle, dt: number) => void) | null {
  switch (kind(i)) {
    case "Gravity": { const a = v3(i.acceleration, [0, 0, -1]); return (p, dt) => { p.vel[0] += a[0] * dt; p.vel[1] += a[1] * dt; p.vel[2] += a[2] * dt; }; }
    case "Wind": {
      const d = v3(i.direction, [1, 0, 0]), s = i.strength ?? 2;
      return (p, dt) => { for (let k = 0; k < 3; k++) p.vel[k] += (d[k] * s - p.vel[k]) * Math.min(1, dt); };
    }
    case "LinearDrag": { const a = i.amount ?? 1; return (p, dt) => { const f = Math.max(0, 1 - a * dt); p.vel[0] *= f; p.vel[1] *= f; p.vel[2] *= f; }; }
    case "QuadraticDrag": {
      const a = i.amount ?? 1;
      return (p, dt) => { const sp = Math.hypot(...p.vel), f = Math.max(0, 1 - a * sp * dt); p.vel[0] *= f; p.vel[1] *= f; p.vel[2] *= f; };
    }
    case "CylindricalVortex": {
      const s = i.strength ?? 2;
      return (p, dt) => { const x = p.pos[0], y = p.pos[1]; p.vel[0] += -y * s * dt; p.vel[1] += x * s * dt; };
    }
    case "Wander": case "Jitter": {
      const s = i.strength ?? 0.05;
      return (p, dt) => { const r = randomUnit(); p.vel[0] += r[0] * s * dt * 60; p.vel[1] += r[1] * s * dt * 60; p.vel[2] += r[2] * s * dt * 60; };
    }
    case "AngularAcceleration": { const a = v3(i.acceleration, [0, 0, 0]); return (p, dt) => { p.spin[0] += a[0] * dt; p.spin[1] += a[1] * dt; p.spin[2] += a[2] * dt; }; }
    default: return null;
  }
}

/** Reads a ParticleSystemConfig implementation's layers. */
export function readParticleLayers(impl: any, resolveMaterial: (ref: any) => ResolvedMaterial, meta = false): ParticleLayer[] {
  const layers: ParticleLayer[] = [];
  for (const l of impl.layers ?? []) {
    if (l.visible === false) continue;
    const t = l.transform;
    const xf = t?.translation || t?.rotation || t?.scale
      ? compose(v3(t.translation, [0, 0, 0]), t.rotation ? [t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w] : [0, 0, 0, 1], t.scale ?? 1)
      : compose([0, 0, 0], [0, 0, 0, 1], 1);
    const counterKind = l.counter ? kind(l.counter) : "Unlimited";
    layers.push({
      name: l.name ?? "",
      count: l.particleCount ?? 100,
      alphaMode: l.alphaMode?.name ?? "TRANSLUCENT",
      alignment: l.alignment?.name ?? (meta ? "FIXED" : "BILLBOARD"),
      geometry: l.geometry ? kind(l.geometry) : "Points",
      segments: l.geometry?.segments ?? 0,
      priority: l.priorityMode ? l.priorityMode.priority ?? 0 : null,
      material: resolveMaterial(l.material ?? { $class: "com.threerings.config.ConfigReference", name: "Model/Translucent" }),
      divisionsS: l.textureDivisionsS ?? 1,
      divisionsT: l.textureDivisionsT ?? 1,
      color: colorFunctionVar(l.color),
      size: l.size ? floatFunctionVar(l.size, 0.1) : () => () => 0.1,
      length: l.length ? floatFunctionVar(l.length, 0.1) : () => () => 0.1,
      frame: l.frame ? floatFunctionVar(l.frame, 0) : () => () => 0,
      speed: l.speed ? floatVar(l.speed, () => 0) : () => lerp(1, 1.5, Math.random()),
      lifespan: l.lifespan ? floatVar(l.lifespan, () => 0) : () => lerp(1, 1.5, Math.random()),
      orientation: quatVar(l.orientation),
      angularVelocity: vecVar(l.angularVelocity),
      place: placer(l.placer),
      shoot: shooter(l.shooter),
      counter: {
        kind: counterKind,
        rate: l.counter?.rate ?? 10,
        interval: floatVar(l.counter?.interval, () => lerp(0.07, 0.2, Math.random())),
      },
      respawn: l.respawnDeadParticles ?? true,
      startTime: l.startTime ?? 0,
      timeScale: l.timeScale ?? 1,
      moveWithEmitter: !!l.moveParticlesWithEmitter,
      transform: xf,
      influences: (l.influences ?? []).map(influence).filter(Boolean) as ParticleLayer["influences"],
      modelRef: meta ? l.model : kind(l.geometry) === "Meshes" ? l.geometry.model : undefined,
    });
  }
  return layers;
}

// ---- simulation

export interface Particle {
  pos: Vec3;
  vel: Vec3;
  age: number;
  life: number;
  /** Initial screen-plane roll (billboards) and rotation accumulated from angular velocity. */
  roll: number;
  spun: number;
  spin: Vec3;
  orientation: Quat;
  color: (t: number) => Rgba;
  size: (t: number) => number;
  length: (t: number) => number;
  frame: (t: number) => number;
}

class LayerState {
  particles: Particle[] = [];
  time = 0;
  accumulator = 0;
  nextInterval = 0;
  spawned = 0;
  constructor(readonly layer: ParticleLayer) {}
}

/** One placed particle system. */
export class Emitter {
  readonly states: LayerState[];
  /** Layer indices in drawing order: GroupPriority layers by rising priority (see layerOrder). */
  readonly order: number[];
  /** The instance age and renderer time it was last advanced to (clockEmitter). */
  lastAge?: number;
  lastTime?: number;
  constructor(layers: ParticleLayer[]) {
    this.states = layers.map(l => new LayerState(l));
    this.order = layerOrder(layers);
  }

  update(dt: number, emitter: Mat4) {
    for (const s of this.states) {
      const L = s.layer;
      const step = dt * L.timeScale;
      s.time += step;
      if (s.time < L.startTime) continue;
      const toWorld = multiply(emitter, L.transform);
      // advance and cull
      for (const p of s.particles) {
        p.age += step;
        for (const inf of L.influences) inf(p, step);
        p.pos[0] += p.vel[0] * step; p.pos[1] += p.vel[1] * step; p.pos[2] += p.vel[2] * step;
        p.spun += p.spin[2] * step;
      }
      s.particles = s.particles.filter(p => p.age < p.life);
      // spawn
      let want = 0;
      if (L.counter.kind === "ConstantRate") { s.accumulator += L.counter.rate * step; want = Math.floor(s.accumulator); s.accumulator -= want; }
      else if (L.counter.kind === "RandomIntervals") {
        s.nextInterval -= step;
        while (s.nextInterval <= 0) { want++; s.nextInterval += Math.max(0.01, L.counter.interval()); }
      } else want = L.count - s.particles.length;
      if (!L.respawn && s.spawned >= L.count) want = 0;
      want = Math.min(want, L.count - s.particles.length);
      for (let i = 0; i < want; i++) { s.particles.push(this.spawn(L, toWorld)); s.spawned++; }
    }
  }

  private spawn(L: ParticleLayer, toWorld: Mat4): Particle {
    const local = L.place();
    const dir = L.shoot(local);
    const speed = L.speed();
    let pos: Vec3 = local, vel: Vec3 = [dir[0] * speed, dir[1] * speed, dir[2] * speed];
    if (!L.moveWithEmitter) {
      pos = transformPoint(toWorld, local);
      vel = transformVector(toWorld, vel);
    }
    const life = Math.max(0.01, L.lifespan());
    const q = L.orientation();
    return {
      pos, vel, age: 0, life, spin: L.angularVelocity(), orientation: q,
      roll: 2 * Math.atan2(q[2], q[3]), spun: 0,
      color: L.color(), size: L.size(), length: L.length(), frame: L.frame(),
    };
  }

  /** World matrices for each live particle of a model-emitting layer. */
  meshMatrices(layerIndex: number, emitter: Mat4): Mat4[] {
    return this.meshParticles(layerIndex, emitter).map(p => p.matrix);
  }

  /** World matrix and premultiplied colour for each live particle of a model-emitting layer. */
  meshParticles(layerIndex: number, emitter: Mat4): { matrix: Mat4; color: Rgba }[] {
    const s = this.states[layerIndex], L = s.layer;
    const toWorld = multiply(emitter, L.transform);
    const out: { matrix: Mat4; color: Rgba }[] = [];
    for (const p of s.particles) {
      const t = Math.min(1, p.age / p.life);
      const c = p.color(t), a = c[3];
      const color: Rgba = L.alphaMode === "PREMULTIPLIED" ? c
        : [c[0] * a, c[1] * a, c[2] * a, L.alphaMode === "OPAQUE" ? 1 : L.alphaMode === "ADDITIVE" ? 0 : a];
      const spin = compose([0, 0, 0], [0, 0, Math.sin(p.spun / 2), Math.cos(p.spun / 2)], 1);
      const local = multiply(compose(p.pos, p.orientation, p.size(t)), spin);
      out.push({ matrix: L.moveWithEmitter ? multiply(toWorld, local) : local, color });
    }
    return out;
  }

  /**
   * Appends quads (two triangles each) as interleaved x,y,z,u,v,r,g,b,a to out.
   * right/up are the camera axes in world space.
   */
  emit(layerIndex: number, emitter: Mat4, right: Vec3, up: Vec3, out: number[]) {
    const s = this.states[layerIndex], L = s.layer;
    if (L.modelRef) return;
    const toWorld = multiply(emitter, L.transform);
    const frames = L.divisionsS * L.divisionsT;
    // sizes are in emitter space, so they scale with the emitter's transform
    const scale = Math.hypot(toWorld[0], toWorld[1], toWorld[2]);
    for (const p of s.particles) {
      const t = Math.min(1, p.age / p.life);
      let col = p.color(t);
      // AlphaMode: colours are converted to premultiplied alpha
      const a = col[3];
      col = L.alphaMode === "PREMULTIPLIED" ? col
        : [col[0] * a, col[1] * a, col[2] * a, L.alphaMode === "OPAQUE" ? 1 : L.alphaMode === "ADDITIVE" ? 0 : a];
      // a quad reaches its size each way from the particle (Clyde's quad geometry writes
      // position ± s ± t, with s and t the oriented axes times the size)
      const size = p.size(t) * scale;
      if (size <= 0) continue;
      const center = L.moveWithEmitter ? transformPoint(toWorld, p.pos) : p.pos;
      let ax: Vec3, ay: Vec3;
      if (L.alignment === "FIXED") {
        const spin = compose([0, 0, 0], [0, 0, Math.sin(p.spun / 2), Math.cos(p.spun / 2)], 1);
        const mm = multiply(multiply(toWorld, compose([0, 0, 0], p.orientation, 1)), spin);
        ax = [mm[0], mm[1], mm[2]]; ay = [mm[4], mm[5], mm[6]];
      } else if (L.alignment === "VELOCITY" || L.geometry === "Lines" || L.geometry === "Trails") {
        const v = L.moveWithEmitter ? transformVector(toWorld, p.vel) : p.vel;
        const vl = Math.hypot(...v) || 1;
        const dirv: Vec3 = [v[0] / vl, v[1] / vl, v[2] / vl];
        // a plain velocity-aligned quad is as long as it is wide (its size); lines and trails
        // take their length
        const len = L.geometry === "Quads" && !L.segments ? size : (p.length(t) / 2) * scale || size;
        ay = [dirv[0] * len / size, dirv[1] * len / size, dirv[2] * len / size];
        // perpendicular to both the velocity and the view
        const fwd: Vec3 = [right[1] * up[2] - right[2] * up[1], right[2] * up[0] - right[0] * up[2], right[0] * up[1] - right[1] * up[0]];
        ax = [dirv[1] * fwd[2] - dirv[2] * fwd[1], dirv[2] * fwd[0] - dirv[0] * fwd[2], dirv[0] * fwd[1] - dirv[1] * fwd[0]];
        const al = Math.hypot(...ax) || 1; ax = [ax[0] / al, ax[1] / al, ax[2] / al];
      } else {
        const r = p.roll + p.spun, c = Math.cos(r), sn = Math.sin(r);
        ax = [right[0] * c + up[0] * sn, right[1] * c + up[1] * sn, right[2] * c + up[2] * sn];
        ay = [up[0] * c - right[0] * sn, up[1] * c - right[1] * sn, up[2] * c - right[2] * sn];
      }
      // sprite-sheet frame
      const f = frames > 1 ? Math.max(0, Math.min(frames - 1, Math.floor(p.frame(t)))) : 0;
      const fs = f % L.divisionsS, ft = Math.floor(f / L.divisionsS);
      const u0 = fs / L.divisionsS, u1 = (fs + 1) / L.divisionsS, v0 = ft / L.divisionsT, v1 = (ft + 1) / L.divisionsT;
      const corner = (sx: number, sy: number, u: number, v: number) => {
        out.push(center[0] + (ax[0] * sx + ay[0] * sy) * size, center[1] + (ax[1] * sx + ay[1] * sy) * size,
          center[2] + (ax[2] * sx + ay[2] * sy) * size, u, v, col[0], col[1], col[2], col[3]);
      };
      corner(-1, -1, u0, v1); corner(1, -1, u1, v1); corner(1, 1, u1, v0);
      corner(-1, -1, u0, v1); corner(1, 1, u1, v0); corner(-1, 1, u0, v0);
    }
  }
}

/**
 * Advances a placed system for one draw of its instance: by the instance's own clock when its
 * owner advances it (age > 0: an effect, an actor, a projectile), caught up in short steps
 * from where it was last drawn, else by the renderer's clock (scenery, offscreen views).
 */
export function clockEmitter(e: Emitter, age: number, time: number, dt: number, placement: Mat4) {
  if (age > 0) {
    // an instance its owner advances (an effect, an actor, a projectile): the world's clock
    const last = e.lastAge;
    e.lastAge = age;
    for (const s of catchUpSteps(last, age)) e.update(s, placement);
  } else {
    // scenery nobody advances: the renderer's clock
    const last = e.lastTime;
    e.lastTime = time;
    e.update(last === undefined ? dt : Math.min(0.1, Math.max(0, time - last)), placement);
  }
}

/**
 * The steps an emitter takes to catch up with its model instance's own clock (the seconds its
 * owner has advanced it: an effect, an actor), from `last` (undefined: never updated, so from
 * 0) to `age`. A system is simulated over the time its effect has lived even when it is drawn
 * only now (a stepped audit draws one frame per shot; an effect's first frame), so a layer that
 * fades in (the shield bubble's rings start transparent) is not caught at age 0. At most `cap`
 * seconds are replayed, in steps of at most `maxStep`.
 */
export function catchUpSteps(last: number | undefined, age: number, cap = 2, maxStep = 1 / 30): number[] {
  let span = Math.min(cap, Math.max(0, age - (last ?? 0)));
  if (span <= 0) return [];
  const n = Math.ceil(span / maxStep - 1e-9), out: number[] = [];
  for (let i = 0; i < n; i++) { const s = Math.min(maxStep, span); out.push(s); span -= s; }
  return out;
}

/**
 * The order a system's layers draw in. Clyde sorts transparent layers back to front; a layer
 * with a GroupPriority sorts at its group's centre moved toward the camera by priority x 1e-4,
 * so within one system they draw by rising priority. Layers without one sort at their own
 * centre, taken here as the group's (priority 0); ties keep the config's order.
 */
export function layerOrder(layers: { priority: number | null }[]): number[] {
  return layers.map((_, i) => i).sort((a, b) => (layers[a].priority ?? 0) - (layers[b].priority ?? 0) || a - b);
}

function transformPoint(m: Mat4, p: Vec3): Vec3 {
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
}
function transformVector(m: Mat4, p: Vec3): Vec3 {
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2], m[1] * p[0] + m[5] * p[1] + m[9] * p[2], m[2] * p[0] + m[6] * p[1] + m[10] * p[2]];
}
