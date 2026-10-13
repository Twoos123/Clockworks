// Status conditions (config/status_condition.dat): fire, freeze, shock, poison, curse, sleep
// and stun. The configs give durations, tick intervals, depth-scaled damage, the effect
// model shown on the victim, application and removal effects, and the HUD icon. What each
// condition does is game code, so the effects here follow the configs' own field names:
// fire burns each tick, freeze holds the victim until its duration ends (damage
// shortens it), shock spasms the victim and arcs to neighbours, poison weakens attack,
// defence and healing, curse burns and stops attacks, sleep holds until hit, stun slows.

import { applyArguments } from "../config/params";
import type { DepthContext, DepthScales } from "./depth";

const kind = (o: any) => { const c: string = o?.$class ?? ""; return c.substring(c.lastIndexOf("$") + 1); };

export type StatusKind = "Fire" | "Freeze" | "Shock" | "Poison" | "Curse" | "Sleep" | "Stun" | "Buff";

/** A condition resolved for one application. */
export interface StatusDef {
  name: string;
  kind: StatusKind;
  cfg: any;
  /** Seconds the condition lasts. */
  duration: number;
  /** Seconds between ticks (damage, spasms). */
  interval: number;
  /** Damage per tick (fire, shock arcs, curse). */
  tickDamage: number;
  /** 0 to 1: how strong (poison reductions, stun slow). */
  power: number;
  /** The HUD icon name (the "Icon" argument of ui/health/debuff.dat, or buff.dat for buffs). */
  icon: string;
  /** The HUD icon interface: ui/health/debuff.dat or ui/health/buff.dat. */
  iconUi: string;
}

/** An active condition on an actor. */
export interface ActiveStatus { def: StatusDef; remaining: number; tick: number; fx: any }

// StatusCodes chance and power levels. Their values are game code; these are tuning numbers.
const CHANCE: Record<string, number> = { LOW: 0.1, MEDIUM: 0.2, HIGH: 0.35, VERY_HIGH: 0.5, ULTRA: 0.7, MAXIMUM: 1 };
const POWER: Record<string, number> = { MINOR: 0.2, MODERATE: 0.4, STRONG: 0.6, DEADLY: 0.8, ULTIMATE: 1 };
const KINDS: StatusKind[] = ["Fire", "Freeze", "Shock", "Poison", "Curse", "Sleep", "Stun", "Buff"];

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
   * Resolves a condition reference with its chance and power arguments. Returns null for
   * conditions this game does not model (buffs, boss scripts).
   */
  get(ref: any, ctx: DepthContext): { def: StatusDef; chance: number } | null {
    const r = this.resolve(ref, ctx);
    if (!r) return null;
    const k = kind(r.cfg) as StatusKind;
    if (!KINDS.includes(k)) return null;
    const c = r.cfg, a = r.args;
    const level = (v: unknown, table: Record<string, number>, custom: unknown) => {
      const n = (v as any)?.name ?? (typeof v === "string" ? v.split(".").pop() : undefined);
      if (n && n !== "CUSTOM" && table[n] !== undefined) return table[n];
      return typeof custom === "number" ? custom : Number(custom ?? 0) || 0;
    };
    const chance = Math.max(0, Math.min(1, level(a.get("Status Chance"), CHANCE, a.get("Chance"))));
    const power = Math.max(0, Math.min(1, level(a.get("Status Power"), POWER, a.get("Power")) || 0.3));
    const minD = (c.minDuration ?? 4000) / 1000, maxD = (c.maxDuration ?? c.minDuration ?? 8000) / 1000;
    const dmg = (x: any) => x ? this.depth.evaluate(x, ctx) : 0;
    const tickDamage = dmg(c.damageStart) + (dmg(c.damageEnd) - dmg(c.damageStart)) * power
      || (k === "Curse" ? (c.damage?.amount ?? 20) : 0);
    return {
      chance,
      def: {
        name: ref.name, kind: k, cfg: c,
        duration: minD + (maxD - minD) * power,
        interval: (c.signalInterval ?? 1000) / 1000,
        tickDamage, power,
        icon: String(c.icon?.arguments?.entries?.find?.(([n]: [string]) => n === "Icon")?.[1] ?? k),
        iconUi: String(c.icon?.name ?? "ui/health/debuff.dat"),
      },
    };
  }
}
