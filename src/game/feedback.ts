// Hit feedback as the client shows it: the struck actor's colour flash, camera shakes
// (Clyde's ShakeCamera action), damage numbers (particle/fx_damagenumber.dat and its
// part_damagenumber.dat label styles) and the knight's hit hearts. Pure maths; the world and
// the HUD draw it. See docs/research/client-fidelity.md section 10.

export type Rgba = [number, number, number, number];

/**
 * The colour flash of a struck actor (`dungeon/client/a/x` and `y`): its model's colour goes
 * red and fades back to white over 150 ms, eased by the square of the time. Null once over.
 */
export const FLASH_MS = 150;
export function hitFlash(elapsedMs: number): Rgba | null {
  if (elapsedMs < 0 || elapsedMs >= FLASH_MS) return null;
  const t = Math.min(1, (elapsedMs / FLASH_MS) ** 2);
  return [1, t, t, 1];
}

/** A ShakeCamera action with the class defaults filled in (opengl/model/config/ActionConfig). */
export interface ShakeSpec {
  frequency: number; falloff: number; duration: number;
  innerRadius: number; outerRadius: number;
  amplitude: [number, number, number];
}

export function readShake(a: any): ShakeSpec {
  const v = a?.amplitude;
  return {
    frequency: a?.frequency ?? 50, falloff: a?.falloff ?? 30, duration: a?.duration ?? 1,
    innerRadius: a?.innerRadius ?? 10, outerRadius: a?.outerRadius ?? 100,
    amplitude: v ? [v.x ?? 0, v.y ?? 0, v.z ?? 0] : [0, 0, 1],
  };
}

/**
 * How strongly a shake at `dist` from the viewer (an orbit camera's target) is felt: fully
 * within the inner radius, fading to nothing at the outer one, none beyond.
 */
export function shakeScale(s: ShakeSpec, dist: number): number {
  if (dist > s.outerRadius) return 0;
  if (dist <= s.innerRadius) return 1;
  return 1 - (dist - s.innerRadius) / (s.outerRadius - s.innerRadius);
}

/** The camera's offset from one shake `t` seconds in: amplitude x scale x e^(-falloff t) x sin(frequency t). */
export function shakeOffset(s: ShakeSpec, scale: number, t: number): [number, number, number] {
  const f = scale * Math.exp(-s.falloff * t) * Math.sin(s.frequency * t);
  return [s.amplitude[0] * f, s.amplitude[1] * f, s.amplitude[2] * f];
}

/**
 * How a hit performed (DamageSummary.Performance): it picks the hit particle's variant and the
 * damage number's style. The server decides it; ours: a hit the target's defence barely
 * blunts is effective, one it more than halves is weak; small, medium or large by the share
 * of the target's health it took.
 */
export type Performance = { kind: "WEAK" | "NORMAL" | "STRONG"; size: "SMALL" | "MEDIUM" | "LARGE" };
export function performanceOf(dealt: number, undefended: number, maxHealth: number): Performance {
  const r = undefended > 0 ? dealt / undefended : 1;
  const kind = r >= 0.9 ? "STRONG" : r <= 0.5 ? "WEAK" : "NORMAL";
  const share = maxHealth > 0 ? dealt / maxHealth : 0;
  const size = share < 0.1 ? "SMALL" : share < 0.3 ? "MEDIUM" : "LARGE";
  return { kind, size };
}

/** The hit particle's variant name (`Performance.variant()`), as fx_gethit_monster-scaled.dat names them. */
export function performanceVariant(p: Performance): string {
  const k = p.kind === "WEAK" ? "Crap" : p.kind === "STRONG" ? "Effective" : "Normal";
  return `${k} (${p.size[0] + p.size.slice(1).toLowerCase()})`;
}

/** The damage number's style (the monster sprite's switch on the performance), or Heal. */
export type NumberStyle = "Damage" | "Crap" | "Effective Damage" | "Heal";
export function numberStyle(p: Performance | null): NumberStyle {
  return !p ? "Heal" : p.kind === "WEAK" ? "Crap" : p.kind === "STRONG" ? "Effective Damage" : "Damage";
}

/**
 * The label styles of particle/part_damagenumber.dat (StyleConfig: Arial Black, outlined):
 * text colour, outline colour and width, font size and style.
 */
export const NUMBER_FONTS: Record<NumberStyle, { color: string; outline: string; outlineSize: number; size: number; italic: boolean; bold: boolean }> = {
  "Damage": { color: "rgb(203,243,255)", outline: "rgb(20,86,140)", outlineSize: 8, size: 32, italic: true, bold: false },
  "Crap": { color: "rgb(153,153,153)", outline: "rgb(74,54,69)", outlineSize: 8, size: 32, italic: true, bold: false },
  "Effective Damage": { color: "rgb(255,217,161)", outline: "rgb(115,40,0)", outlineSize: 12, size: 48, italic: true, bold: false },
  "Heal": { color: "rgb(255,61,61)", outline: "rgb(159,0,0)", outlineSize: 6, size: 28, italic: false, bold: true },
};

/**
 * One damage number layer of particle/fx_damagenumber.dat: when it appears, how long it
 * lives, its time scale, launch (speed along its shooter's direction), drag and gravity, its
 * size over its life (a Multipoint from 0 back to 0), and its spin.
 */
interface NumberLayer {
  start: number; life: number; timeScale: number;
  speed: [number, number]; dir: [number, number, number]; drag: number; gravity: number;
  offset: [number, number, number]; spread: number;
  size: [number, number][]; spin: number;
  /** Its turn: random up to this either way, or exactly this when fixed. */
  tilt: number; fixedTilt?: boolean;
}
const POP: [number, number][] = [[0.05, 0.675], [0.1, 1.125], [0.15, 0.715], [0.25, 0.75], [0.95, 0.75]];
export const NUMBER_LAYERS: Record<NumberStyle, NumberLayer> = {
  "Damage": { start: 0.15, life: 0.5, timeScale: 1, speed: [9, 11], dir: [0, 0, -1], drag: 9, gravity: -2,
    offset: [0, 0.3, 0.5], spread: 0.6, size: POP, spin: 0, tilt: 0 },
  "Crap": { start: 0.15, life: 0.5, timeScale: 0.85, speed: [9, 11], dir: [0, 0, -1], drag: 8, gravity: -20,
    offset: [0, 0.3, 0.5], spread: 0.6, size: [[0.05, 0.6], [0.1, 0.975], [0.15, 0.6375], [0.25, 0.675], [0.95, 0.675]], spin: -5.236, tilt: 0.1745, fixedTilt: true },
  "Effective Damage": { start: 0.15, life: 1.5, timeScale: 2, speed: [30, 30], dir: [0, 0, -1], drag: 25, gravity: -5,
    offset: [0, 0.3, 0.5], spread: 0.125, size: [[0.01, 0.675], [0.02, 1.3125], [0.07, 0.71], [0.17, 0.75], [0.97, 0.75]], spin: 0, tilt: 0.1745 },
  "Heal": { start: 0, life: 1.5, timeScale: 1, speed: [9, 11], dir: [-0.94, 0, 0.342], drag: 9, gravity: -2,
    offset: [0.5, -0.75, 0.75], spread: 0.15, size: [[0.05, 0.75], [0.95, 0.75]], spin: 0, tilt: 0 },
};

/** How long a number of this style is shown, from the hit (seconds of real time). */
export function numberLength(style: NumberStyle): number {
  const l = NUMBER_LAYERS[style];
  return l.start + l.life / l.timeScale;
}

/**
 * Where a damage number is `age` seconds after the hit, relative to where it was launched
 * (world units, z up), its size factor and its turn (radians); null before it appears or once
 * it has gone. `seed` (0 to 1) picks its launch speed. Linear drag and gravity integrate
 * exactly: v(t) = (v0 - g/k) e^(-kt) + g/k.
 */
export function numberPose(style: NumberStyle, age: number, seed = 0.5): { dx: number; dy: number; dz: number; scale: number; turn: number } | null {
  const l = NUMBER_LAYERS[style];
  const t = (age - l.start) * l.timeScale;
  if (t < 0 || t >= l.life) return null;
  const v0 = l.speed[0] + (l.speed[1] - l.speed[0]) * seed, k = l.drag;
  const e = Math.exp(-k * t);
  const along = (v0 / k) * (1 - e);
  const fall = (l.gravity / k) * (t - (1 - e) / k);
  const u = t / l.life;
  let scale = 0, prevT = 0, prevV = 0;
  for (const [pt, pv] of [...l.size, [1, 0] as [number, number]]) {
    if (u <= pt) { scale = prevV + (pv - prevV) * (pt > prevT ? (u - prevT) / (pt - prevT) : 1); break; }
    prevT = pt; prevV = pv;
  }
  const turn = (l.fixedTilt ? l.tilt : (seed - 0.5) * 2 * l.tilt) + 0.5 * l.spin * t * t;
  return { dx: l.dir[0] * along, dy: l.dir[1] * along, dz: l.dir[2] * along + fall, scale, turn };
}

/**
 * The knight's hit hearts (particle/fx_damagenumber-pc.dat): a burst of heart particles per
 * damage type, in the type's colour. The count is packed by the server (four bits a type);
 * ours: one heart per 10 health lost, 1 to 15.
 */
export function heartCount(damage: number): number {
  return Math.max(1, Math.min(15, Math.ceil(damage / 10)));
}
export const HEART_TYPES: Record<string, string> = { NORMAL: "Normal", PIERCING: "Piercing", ELEMENTAL: "Elemental", SHADOW: "Shadow" };

/**
 * A text label from a particle effect (particle/debuff_name.dat's status names, fx_item_fail.dat's
 * "Health At Max!"): one particle, 0.75 above the emitter, shot at speed 5 up (buffs) or down
 * (debuffs) against a linear drag of 5, living 2 seconds; its size rises to 1 by a tenth of
 * its life and eases to 0.95 by nine tenths (a Multipoint from 0 back to 0). The label is
 * Arial Black (part_ui_debuffname.dat 22, part_ui_itemfail.dat 16) with an 8 outline, wrapped
 * to the billboard's width (160 or 120).
 */
export interface LabelStyle {
  color: string; outline: string; size: number; outlineSize: number;
  /** The billboard's width in GUI pixels (the text wraps to it). */
  width: number;
  /** 1 drifts up, -1 down. */
  rise: 1 | -1;
  life: number;
}

const LABEL_SIZE: [number, number][] = [[0.1, 1], [0.9, 0.95], [1, 0]];

/** Where a label is `age` seconds in (relative to its start) and its size; null once gone. */
export function labelPose(l: LabelStyle, age: number): { dz: number; scale: number } | null {
  if (age < 0 || age >= l.life) return null;
  const speed = 5, drag = 5;
  const dz = l.rise * (speed / drag) * (1 - Math.exp(-drag * age));
  const u = age / l.life;
  let scale = 0, pt = 0, pv = 0;
  for (const [t, v] of LABEL_SIZE) {
    if (u <= t) { scale = pv + (v - pv) * (t > pt ? (u - pt) / (t - pt) : 1); break; }
    pt = t; pv = v;
  }
  return { dz, scale };
}
