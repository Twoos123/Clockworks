// Damage against defence, as the game computes it (the client's damage summary, see
// docs/research/client-fidelity.md):
//
// - Each damage type meets the defence of the same type. With no defence of that type the
//   damage goes through whole; unblockable damage never meets a defence.
// - Damage at or above the defence loses half the defence: 100 against 60 deals 70, and equal
//   damage and defence deal half.
// - Damage below the defence loses half and then more, 19% per decade of
//   (defence - damage) / 15 + 1, down to nothing.
// - Damage modifiers are not plain products. An increase by m deals the average of the
//   damage and m times the damage (a 50% bonus adds 25%). A decrease by m deals the damage
//   that, against a defence equal to the original damage, does m times what the original
//   would.
// - Damage bonuses from gear, levels and family tags add up, are capped at +/-0.48 (six
//   steps of 0.08) and go through the modifier above.

import { DAMAGE_TYPES, type Amounts } from "./depth";

/** The fraction of `damage` a `defense` of the same type takes off. */
export function reduction(damage: number, defense: number): number {
  if (damage <= 0) return 1;
  let r = 0.5;
  if (damage > defense) r -= (damage - defense) / (2 * damage);
  else if (damage < defense) r += 0.19 * Math.log10((defense - damage) / 15 + 1);
  return r;
}

/** Damage of one type after a defence of that type. */
export function afterDefense(damage: number, defense: number): number {
  const r = reduction(damage, defense);
  return r > 0 ? damage * Math.max(0, 1 - r) : damage;
}

/** Increases damage by a factor above 1: halfway between the damage and its multiple. */
export function increaseDamage(damage: number, factor: number): number {
  if (damage <= 0) return 0;
  return factor <= 1 ? damage : (damage * factor + damage) / 2;
}

const decreased = new Map<string, number>();

/**
 * Decreases damage by a factor below 1: the damage that, against a defence equal to the
 * original damage, does `factor` times what the original does against it (a bisection to
 * the whole-number result, thirty halvings at most).
 */
export function decreaseDamage(damage: number, factor: number): number {
  const key = `${damage}:${factor}`;
  const hit = decreased.get(key);
  if (hit !== undefined) return hit;
  const goal = Math.trunc(f32(damage * factor / 2));
  let step = damage / 2, cur = damage - step;
  for (let i = 0; i < 30; i++) {
    step /= 2;
    const got = Math.trunc(afterDefense(cur, damage));
    if (got === goal) break;
    cur += got > goal ? -step : step;
  }
  decreased.set(key, cur);
  return cur;
}

/** Applies a damage factor the game's way (1 leaves it, 0 or less removes it). */
export function modifyDamage(damage: number, factor: number): number {
  if (factor === 1) return damage;
  if (factor <= 0) return 0;
  return factor > 1 ? increaseDamage(damage, factor) : decreaseDamage(damage, factor);
}

/** The cap of a summed damage bonus: six ItemBonus steps of 0.08. */
export const DAMAGE_BONUS_CAP = 0.48;

/** A summed damage bonus within its cap. */
export const cappedBonus = (b: number) => Math.min(DAMAGE_BONUS_CAP, Math.max(-DAMAGE_BONUS_CAP, b));

/**
 * Damage dealt by `attack` amounts against `defense` amounts, after a summed damage
 * `bonus` (gear, levels and tags against this target; capped here).
 */
export function dealt(attack: Amounts, defense: Amounts | null, bonus = 0): number {
  const factor = 1 + cappedBonus(bonus);
  let total = 0;
  for (const t of DAMAGE_TYPES) {
    let a = attack[t];
    if (!(a > 0)) continue;
    if (bonus !== 0) a = modifyDamage(a, factor);
    const d = defense?.[t] ?? 0;
    total += d > 0 ? afterDefense(a, d) : a;
  }
  const u = attack.UNBLOCKABLE ?? 0;
  if (u > 0) total += bonus !== 0 ? modifyDamage(u, factor) : u;
  return total;
}

/**
 * A damage impulse (ImpulseConfig DamageImpulse): units of knockback, over how many ms, and
 * its level (it moves only targets whose impulse level it reaches). A bare number is a
 * distance with the usual duration.
 */
export type Knock = number | { distance: number; duration: number; level: number };

/** An ImpulseConfig as a Knock; none (0) when the config has no impulse. */
export function readKnock(imp: any): Knock {
  if (!imp) return 0;
  return { distance: imp.translation?.x ?? 0, duration: imp.duration ?? 0, level: imp.level ?? 1 };
}

/**
 * The share of an impulse's displacement covered between progress u0 and u1 (0 to 1): the
 * client moves an actor by T * (2u - u^2), so the speed falls linearly to nothing.
 */
export function impulseShare(u0: number, u1: number): number {
  const f = (u: number) => { u = Math.max(0, Math.min(1, u)); return 2 * u - u * u; };
  return f(u1) - f(u0);
}

/** The largest damage type in an amount set, for colouring damage numbers. */
export function mainType(a: Amounts) {
  let best: (typeof DAMAGE_TYPES)[number] = "NORMAL";
  for (const t of DAMAGE_TYPES) if (a[t] > a[best]) best = t;
  return best;
}

export const TYPE_COLORS: Record<(typeof DAMAGE_TYPES)[number], string> = {
  NORMAL: "#ffe066", PIERCING: "#7fd6ff", ELEMENTAL: "#ff9a4d", SHADOW: "#c58cff",
};

const f32buf = new Float32Array(1);
/** Rounds to single precision, as the game's float arithmetic does. */
function f32(x: number) { f32buf[0] = x; return f32buf[0]; }
