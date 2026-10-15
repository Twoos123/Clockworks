// Status conditions (config/status_condition.dat): fire, freeze, shock, poison, curse, sleep,
// stun and buffs. The configs give chance and power (StatusCodes levels), durations, tick
// intervals, depth-scaled damage, the effect model shown on the victim, application and
// removal effects, and the HUD icon. The client holds the field defaults and the level
// tables (docs/research/client-fidelity.md); applying a condition is server code, so the
// rule here for every "min/max" pair is the same: power picks the point between them.
//
// - fire burns every damageInterval;
// - freeze holds the victim behind ice with its own health, which hits wear down;
// - shock spasms the victim (it cannot act), weakens its defence and arcs to neighbours;
// - poison weakens attack, defence and healing;
// - curse burns (unblockable, capped) and stops attacks;
// - sleep holds until hit and regenerates health;
// - stun (a Slow) and slow cut movement speed.

import { applyArguments } from "../config/params";
import type { DepthContext, DepthScales, Difficulty } from "./depth";

const kind = (o: any) => { const c: string = o?.$class ?? ""; return c.substring(c.lastIndexOf("$") + 1); };

export type StatusKind = "Fire" | "Freeze" | "Shock" | "Poison" | "Curse" | "Sleep" | "Stun" | "Slow" | "Buff";

/** A condition resolved for one application. */
export interface StatusDef {
  name: string;
  kind: StatusKind;
  cfg: any;
  /** Seconds the condition lasts. */
  duration: number;
  /** Seconds between ticks (fire's damage, sleep's regeneration). */
  interval: number;
  /** Damage per tick (fire, curse); arc damage for shock. */
  tickDamage: number;
  /** 0 to 1: the condition's power (StatusPower / 100), the point between each min and max. */
  power: number;
  /** Movement factor (slow, stun). */
  speed: number;
  /** Factor on the victim's damage dealt (poison). */
  attack: number;
  /** Factor on the victim's defence (poison, shock). */
  defense: number;
  /** Factor on healing the victim receives (poison). */
  heal: number;
  /** Ice health (freeze). */
  ice: number;
  /** Freeze: the thaw damage a monster takes when its ice runs out by itself (damageStart to damageEnd). */
  thaw: number;
  /** Shock: seconds between spasms and how long each lasts. */
  spasmInterval: number;
  spasmDuration: number;
  /** Sleep: seconds asleep before regeneration starts, and health a tick (knight, monster). */
  regenDelay: number;
  regen: number;
  playerRegen: number;
  /** The HUD icon name (the "Icon" argument of ui/health/debuff.dat, or buff.dat for buffs). */
  icon: string;
  /** The HUD icon interface: ui/health/debuff.dat or ui/health/buff.dat. */
  iconUi: string;
}

/** An active condition on an actor. */
export interface ActiveStatus { def: StatusDef; remaining: number; tick: number; fx: any; ice?: number; spasm?: number; nextSpasm?: number; asleep?: number; /** Curse: the knight's weapon slots it locked. */ cursed?: number[] }

/** StatusCodes StatusChance levels. */
export const CHANCE: Record<string, number> = { LOW: 0.05, MEDIUM: 0.1, HIGH: 0.25, VERY_HIGH: 0.5, ULTRA: 0.65, MAXIMUM: 0.9 };
/** StatusCodes StatusPower levels (0 to 100). */
export const POWER: Record<string, number> = { MINOR: 20, MODERATE: 40, STRONG: 60, DEADLY: 80, ULTIMATE: 100 };
const KINDS: StatusKind[] = ["Fire", "Freeze", "Shock", "Poison", "Curse", "Sleep", "Stun", "Slow", "Buff"];

// DungeonCodes Difficulty: a base chance maps onto the difficulty's table between the levels
const CHANCE_STEPS = [0, 0.05, 0.1, 0.25, 0.5, 0.65, 0.9, 1];
const CHANCE_BY_DIFFICULTY: Partial<Record<Difficulty, number[]>> = {
  easy: [0, 0.05, 0.05, 0.1, 0.25, 0.5, 0.65, 1],
  hard: [0, 0.1, 0.25, 0.5, 0.65, 0.9, 0.9, 1],
};
/** DungeonCodes Difficulty status power change (easy -20, hard +20) and floor (easy 10). */
const POWER_CHANGE: Record<Difficulty, number> = { easy: -20, medium: 0, hard: 20 };

/** A status chance after the difficulty (DungeonCodes Difficulty getModifiedStatusChance). */
export function difficultyChance(c: number, difficulty: Difficulty): number {
  const t = CHANCE_BY_DIFFICULTY[difficulty];
  if (!t) return c;
  const i = CHANCE_STEPS.findIndex(s => c <= s);
  if (i <= 0) return c;
  const a = CHANCE_STEPS[i - 1], b = CHANCE_STEPS[i];
  return t[i - 1] + (t[i] - t[i - 1]) * (c - a) / (b - a);
}

const total = (d: Record<string, number | undefined>) => Object.values(d).reduce<number>((s, x) => s + (x ?? 0), 0);
const levelName = (v: unknown) => (v as any)?.name ?? (typeof v === "string" ? v.split(".").pop() : undefined);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The weapon slots a curse locks (StatusConditionConfig$Curse minCurseWeapons 1 to
 * maxCurseWeapons 4, power picking between them), out of the knight's `weapons`; using one
 * hurts. Which ones is the server's roll: `rand` picks.
 */
export function cursedSlots(cfg: any, power: number, weapons: number, rand = Math.random): number[] {
  const lo = cfg?.minCurseWeapons ?? 1, hi = cfg?.maxCurseWeapons ?? 4;
  const n = Math.max(0, Math.min(weapons, Math.round(lerp(lo, hi, power))));
  const slots = Array.from({ length: weapons }, (_, i) => i);
  for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
  return slots.slice(0, n).sort((a, b) => a - b);
}

/**
 * Whether a condition hurts on a timer. Fire burns every damageInterval; a curse does not
 * tick (its signalInterval defaults to 0): it bites when the victim acts (a monster attacking,
 * a knight using a locked weapon). It ticked every second here, which took 126% of a fresh
 * knight's health over a depth-1 curse (tools/audit/balance.ts).
 */
export const ticksDamage = (kind: StatusKind) => kind === "Fire";

export class StatusConditions {
  constructor(private readonly lib: Map<string, any>, private readonly depth: DepthScales) {}

  private resolve(ref: any, ctx: DepthContext, d = 0): { cfg: any; args: Map<string, unknown> } | null {
    if (!ref?.name || d > 12) return null;
    const base = this.lib.get(ref.name);
    if (!base) return null;
    const cfg = applyArguments(base, ref);
    const args = new Map<string, unknown>((ref.arguments?.entries ?? []) as [string, unknown][]);
    if (cfg.$class?.endsWith("DerivedConfig")) {
      const r = this.resolve(cfg.base, ctx, d + 1);
      if (r) for (const [k, v] of args) if (!r.args.has(k)) r.args.set(k, v);
      return r;
    }
    if (kind(cfg) === "DepthScaled") {
      // tiers by depth: the deepest condition whose depth has been reached
      let pick: any = null;
      for (const c of cfg.conditions ?? []) if ((c?.depth ?? 0) <= ctx.depth && (!pick || (c.depth ?? 0) >= (pick.depth ?? 0))) pick = c;
      const inner = pick?.statusCondition ?? null;
      const r = inner ? this.resolve(inner, ctx, d + 1) : null;
      if (r) for (const [k, v] of args) if (!r.args.has(k)) r.args.set(k, v);
      return r;
    }
    return { cfg, args };
  }

  /**
   * Resolves a condition reference with its chance and power. Returns null for conditions
   * this game does not model (boss scripts, shields, grabs).
   */
  get(ref: any, ctx: DepthContext): { def: StatusDef; chance: number } | null {
    const r = this.resolve(ref, ctx);
    if (!r) return null;
    const k = kind(r.cfg) as StatusKind;
    if (!KINDS.includes(k)) return null;
    const c = r.cfg, a = r.args;
    // StatusChance / StatusPower: a named level, or CUSTOM and the config's own number
    const named = (v: unknown, table: Record<string, number>) => { const n = levelName(v); return n && n !== "CUSTOM" ? table[n] : undefined; };
    const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);
    const baseChance = named(c.statusChance ?? a.get("Status Chance"), CHANCE) ?? num(c.chance ?? a.get("Chance"));
    const chance = Math.max(0, Math.min(1, difficultyChance(baseChance, ctx.difficulty)));
    let powerPts = named(c.statusPower ?? a.get("Status Power"), POWER) ?? num(c.power ?? a.get("Power"));
    powerPts += POWER_CHANGE[ctx.difficulty] ?? 0;
    if (ctx.difficulty === "easy") powerPts = Math.max(10, powerPts);
    if (ctx.difficulty === "hard") powerPts = Math.min(1000, powerPts);
    const p = Math.max(0, Math.min(1, powerPts / 100));
    const ms = (v: unknown, d: number) => (typeof v === "number" ? v : d) / 1000;
    const scale = (x: any) => x ? this.depth.evaluate(x, ctx) : 0;
    const between = (s: any, e: any) => lerp(scale(s), scale(e), p);
    const tickDamage = k === "Fire" ? between(c.damageStart, c.damageEnd)
      : k === "Curse" ? Math.min(c.maxCurseDamage ?? 120, between(c.damageStart, c.damageEnd) || (c.damage?.amount ?? 0))
      : k === "Shock" ? total(this.depth.damage(c.arcDamage, ctx))
      : 0;
    const interval = k === "Fire" ? ms(c.damageInterval, 2000) : k === "Sleep" ? ms(c.healthRegenInterval, 2000) : Math.max(0.1, ms(c.signalInterval, 1000));
    const red = (lo: unknown, hi: unknown, dlo: number, dhi: number) => lerp(num(lo ?? dlo), num(hi ?? dhi), p);
    return {
      chance,
      def: {
        name: ref.name, kind: k, cfg: c,
        duration: lerp(ms(c.minDuration, 1000), ms(c.maxDuration, 10000), p),
        interval, tickDamage, power: p,
        speed: k === "Stun" || k === "Slow" ? 1 - red(c.minSpeedReduction, c.maxSpeedReduction, 0.4, 0.6)
          : k === "Buff" ? 1 + num(c.speedModifier) : 1,
        attack: k === "Poison" ? 1 - red(c.minAttackReduction, c.maxAttackReduction, 0.15, 0.65) : 1,
        defense: k === "Poison" ? 1 - red(c.minDefenseReduction, c.maxDefenseReduction, 0.15, 0.65)
          : k === "Shock" ? 1 - red(c.minDefenseDebuff, c.maxDefenseDebuff, 0.15, 0.45)
          : k === "Buff" ? 1 + num(c.defenseModifier) : 1,
        heal: k === "Poison" ? 1 + red(c.minHealModifier, c.maxHealModifier, -0.1, -0.5) : 1,
        ice: k === "Freeze" ? Math.max(1, between(c.healthStart, c.healthEnd)) : 0,
        thaw: k === "Freeze" ? between(c.damageStart, c.damageEnd) : 0,
        spasmInterval: lerp(ms(c.minSpasmInterval, 1000), ms(c.maxSpasmInterval, 4000), p),
        spasmDuration: lerp(ms(c.minSpasmDuration, 500), ms(c.maxSpasmDuration, 2000), p),
        regenDelay: ms(c.healthRegenDelay, 4000),
        regen: lerp(num(c.minHealthRegen ?? 10), num(c.maxHealthRegen ?? 30), p),
        playerRegen: lerp(num(c.minPlayerHealthRegen ?? 30), num(c.maxPlayerHealthRegen ?? 90), p),
        icon: String(c.icon?.arguments?.entries?.find?.(([n]: [string]) => n === "Icon")?.[1] ?? k),
        iconUi: String(c.icon?.name ?? "ui/health/debuff.dat"),
      },
    };
  }
}
