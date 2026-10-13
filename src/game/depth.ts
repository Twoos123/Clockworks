// Depth scales (config/depth_scale.dat): the game's tables for values that grow with dungeon
// depth, such as weapon damage, monster health and armour defence. A scale is a small tree:
// tiered segments interpolated by depth, multipliers, adders, depth caps, and choices by
// item star rating or by difficulty. Damage and defence configs refer to these scales.

import { applyArguments } from "../config/params";
import { modifyDamage } from "./combat";
import type { ModelLoader } from "../model";

const kind = (o: any) => { const c: string = o?.$class ?? ""; return c.substring(c.lastIndexOf("$") + 1); };

export type Difficulty = "easy" | "medium" | "hard";

export interface DepthContext {
  /** Dungeon depth (1 is the first Clockworks level below Haven). */
  depth: number;
  /** Star rating of the item a scale belongs to, 0 to 5. */
  rarity: number;
  difficulty: Difficulty;
  /** Extra damage factor for an attacker (buffs). */
  multiplier?: number;
  /** An uncapped damage bonus (a weapon's level), applied with the game's damage modifier. */
  uncapped?: number;
  /** The attacker's summed damage bonus (gear and capped level bonuses), before tags. */
  bonus?: number;
  /** Family damage bonuses of the attacking knight's gear, by family tag (fam_slime). */
  tagged?: Record<string, number>;
}

export const DAMAGE_TYPES = ["NORMAL", "PIERCING", "ELEMENTAL", "SHADOW"] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];
/** Damage or defence amounts per type; unblockable damage (no defence meets it) is apart. */
export type Amounts = Record<DamageType, number> & { UNBLOCKABLE?: number };
export const zeroAmounts = (): Amounts => ({ NORMAL: 0, PIERCING: 0, ELEMENTAL: 0, SHADOW: 0 });

export class DepthScales {
  private lib: Promise<Map<string, any>>;
  private table = new Map<string, any>();

  constructor(loader: ModelLoader) {
    this.lib = loader.importFile("config/depth_scale.dat").then(root => {
      const list: any[] = Array.isArray(root) ? root : (root as any)?.array ?? [];
      const m = new Map(list.map(c => [c.name as string, c]));
      this.table = m;
      return m;
    });
  }

  /** Resolves once the library has loaded; evaluate() is synchronous after that. */
  ready() { return this.lib; }

  /** Evaluates a depth scale reference. Unknown scales evaluate to 0. */
  evaluate(ref: any, ctx: DepthContext, depthLimit = 24): number {
    if (!ref?.name || depthLimit <= 0) return 0;
    const base = this.table.get(ref.name);
    if (!base) return 0;
    const impl = applyArguments(base, ref).implementation;
    if (kind(impl) === "Derived") return this.evaluate(impl.depthScale, ctx, depthLimit - 1);
    return this.node(impl?.root, ctx, depthLimit - 1);
  }

  private node(n: any, ctx: DepthContext, lim: number): number {
    if (!n || lim <= 0) return 0;
    const sub = (r: any, c: DepthContext = ctx) => this.evaluate(r, c, lim - 1);
    switch (kind(n)) {
      case "Constant": return n.value ?? 0;
      case "Multiplier": return sub(n.scale) * (n.multiplier ?? 1);
      // the game's damage modifier (an increase halfway to the multiple); 2 by default
      case "ModifyDamage": return modifyDamage(sub(n.scale), n.multiplier ?? 2);
      case "LinearEntry": return twoPoint(n, ctx.depth, 1);
      case "PowerEntry": return twoPoint(n, ctx.depth, n.power ?? 2);
      case "Offset": return sub(n.scale, { ...ctx, depth: ctx.depth + (n.offset ?? 0) });
      case "Adder": return sub(n.scale) + (n.add ?? 0);
      case "MinValue": return Math.max(n.min ?? 0, sub(n.scale));
      case "DepthCap": return sub(n.scale, { ...ctx, depth: Math.min(ctx.depth, n.cap ?? ctx.depth) });
      case "Difficulty": return sub(n[ctx.difficulty] ?? n.medium);
      case "Rarity": {
        const list: any[] = n.depthScales ?? [];
        const r = list[Math.max(0, Math.min(list.length - 1, ctx.rarity))];
        return r ? sub(r.depthScale) : 0;
      }
      case "ScaleReference": return sub(n.depthScale);
      case "SegmentedEntry": return segmented(n.segments ?? [], ctx.depth);
      default: return 0;
    }
  }

  /**
   * A DamageConfig as amounts per damage type. Depth-scaled damage may split between two
   * types by a split table (the fraction that stays the first type). Status and action
   * damage carry no amount here.
   */
  damage(d: any, ctx: DepthContext, out: Amounts = zeroAmounts()): Amounts {
    switch (kind(d)) {
      case "Normal": out.NORMAL += d.amount ?? 0; break;
      case "Piercing": out.PIERCING += d.amount ?? 0; break;
      case "Elemental": out.ELEMENTAL += d.amount ?? 0; break;
      case "Shadow": out.SHADOW += d.amount ?? 0; break;
      case "Unblockable": case "DepthUnblockable": out.UNBLOCKABLE = (out.UNBLOCKABLE ?? 0) + (d.amount ?? 0); break;
      case "Optional": if (Math.random() < (d.probability ?? 0.5)) this.damage(d.damage, ctx, out); break;
      case "Compound": for (const x of d.damages ?? []) this.damage(x, ctx, out); break;
      case "DepthNormal": out.NORMAL += lerpDepth(d, ctx.depth); break;
      case "DepthScale": case "DepthScaleMulti": {
        const total = this.evaluate(d.depthScale, ctx) * (d.multiplier ?? 1);
        const t1 = typeName(d.type, "NORMAL"), t2 = d.type2 ? typeName(d.type2, "NORMAL") : null;
        if (t2 && d.splitDepth) {
          const f = Math.max(0, Math.min(1, this.evaluate(d.splitDepth, ctx)));
          out[t1] += total * f;
          out[t2] += total * (1 - f);
        } else if (t2) {
          out[t1] += total / 2;
          out[t2] += total / 2;
        } else out[t1] += total;
        break;
      }
    }
    return out;
  }

  /** A DefenseConfig as amounts per damage type. */
  defense(d: any, ctx: DepthContext, out: Amounts = zeroAmounts()): Amounts {
    switch (kind(d)) {
      case "Compound": for (const x of d.defenses ?? []) this.defense(x, ctx, out); break;
      case "Normal": out.NORMAL += d.amount ?? 0; break;
      case "Piercing": out.PIERCING += d.amount ?? 0; break;
      case "Elemental": out.ELEMENTAL += d.amount ?? 0; break;
      case "Shadow": out.SHADOW += d.amount ?? 0; break;
      case "DepthNormal": out.NORMAL += lerpDepth(d, ctx.depth); break;
      case "DepthPiercing": out.PIERCING += lerpDepth(d, ctx.depth); break;
      case "DepthElemental": out.ELEMENTAL += lerpDepth(d, ctx.depth); break;
      case "DepthShadow": out.SHADOW += lerpDepth(d, ctx.depth); break;
      case "DepthScale": out[typeName(d.type, "NORMAL")] += this.evaluate(d.depthScale, ctx); break;
      case "DepthScaleMonster":
        for (const t of DAMAGE_TYPES) if (d[t.toLowerCase()]) out[t] += this.evaluate(d[t.toLowerCase()], ctx);
        break;
    }
    return out;
  }
}

const typeName = (e: any, d: DamageType): DamageType => (DAMAGE_TYPES as readonly string[]).includes(e?.name) ? e.name : d;

/** Depth* damage and defence: amount at startDepth rising to endAmount at endDepth. */
function lerpDepth(d: any, depth: number) {
  const a = d.amount ?? 0, b = d.endAmount ?? a, s = d.startDepth ?? 0, e = d.endDepth ?? 30;
  if (e <= s) return a;
  const t = Math.max(0, Math.min(1, (depth - s) / (e - s)));
  return a + (b - a) * t;
}

/** Linear and power entries: startValue to endValue between startDepth and endDepth. */
function twoPoint(n: any, depth: number, power: number) {
  const s = n.startDepth ?? 0, e = n.endDepth ?? 0, a = n.startValue ?? 0, b = n.endValue ?? 0;
  const t = depth <= s ? 0 : depth >= e ? 1 : (depth - s) / (e - s);
  return a + (b - a) * Math.pow(t, power);
}

/** Linear interpolation between (depth, value) points, clamped at the ends. */
function segmented(segs: any[], depth: number) {
  if (!segs.length) return 0;
  const pts = segs.map(s => [s.depth ?? 0, s.value ?? 0] as const);
  if (depth <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [d0, v0] = pts[i - 1], [d1, v1] = pts[i];
    if (depth <= d1) return d1 === d0 ? v1 : v0 + (v1 - v0) * (depth - d0) / (d1 - d0);
  }
  return pts[pts.length - 1][1];
}
