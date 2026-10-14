// What the game's item pills and tooltips show about a weapon's or a piece of gear's power,
// worked out as the client's item configs do for its interface (ItemConfig's Weapon and Gear
// tooltips, docs/research/ui-audit-windows.md):
//
// - Weapons list their attackValues: each a damage type and a depth scale, read at depth 30
//   for the item's star rating (several values share the damage, each decreased to its
//   share). The level's damage bonus applies on top. A bar is min(164, value * 5/12 + 14)
//   pixels wide; the "potential" bar is the same at the item's top level. Attack speed is
//   a bar of displaySpeed * 15 + 14.
// - Armour and helmets show their defence per type at depth 30 times 0.75 (shields 0.375,
//   with a shield health bar of health / 40 * 6 + 14), plus the level's defence increase.
// - A pill's backing is coloured by the item's first two damage types other than normal.

import { modifyDamage, cappedBonus } from "./combat";
import { DAMAGE_TYPES, type Amounts, type DamageType } from "./depth";
import type { GameData } from "./data";
import { MAX_LEVEL, type Economy } from "./economy";

/** The depth the client evaluates item stats at. */
const STAT_DEPTH = 30;
const WIDTH_CAP = 164;

export interface StatBar {
  /** "attack_normal", "defense_piercing", "attack_speed", "shield_health". */
  icon: string;
  /** The label's message key in the item bundle ("t.normal"). */
  label: string;
  now: number;
  potential: number;
}

export interface ItemStats {
  /** "t.attack_power" or "t.defense_power". */
  title: string;
  bars: StatBar[];
}

const kind = (o: any) => { const c: string = o?.$class ?? ""; return c.substring(c.lastIndexOf("$") + 1); };
const barWidth = (v: number) => Math.min(Math.trunc(v > 0 ? v + 14 : 0), WIDTH_CAP);

function config(data: GameData, name: string): any | null {
  try { return data.resolveSync("config/item.dat", { name }, "item"); } catch { return null; }
}

/** Attack amounts per type at a level (weapons), or null for anything else. */
function attack(data: GameData, eco: Economy, name: string, cfg: any, level: number): Amounts | null {
  const values: any[] = cfg?.attackValues ?? [];
  if (!values.length) return null;
  const rarity = Number(cfg.rarity ?? 0);
  const out: Amounts = { NORMAL: 0, PIERCING: 0, ELEMENTAL: 0, SHADOW: 0 };
  const st = eco.levelStats(name, level, STAT_DEPTH);
  for (const v of values) {
    let amount = v.depthScale ? Math.trunc(data.depth.evaluate(v.depthScale, { depth: STAT_DEPTH, rarity, difficulty: "medium" })) : Number(v.value ?? 0);
    if (values.length > 1) amount = modifyDamage(amount, 1 / values.length);
    if (st.damage) amount = modifyDamage(amount, 1 + cappedBonus(st.damage));
    if (st.uncapped) amount = modifyDamage(amount, 1 + st.uncapped);
    const t = (DAMAGE_TYPES as readonly string[]).includes(v.damageType?.name) ? v.damageType.name as DamageType : "NORMAL";
    out[t] += amount;
  }
  return out;
}

/** Defence amounts per type at a level (armour, helmets, shields), before the display factor. */
function defense(data: GameData, eco: Economy, name: string, cfg: any, level: number): Amounts | null {
  if (!cfg?.defense) return null;
  const own = data.depth.defense(cfg.defense, { depth: STAT_DEPTH, rarity: Number(cfg.rarity ?? 0), difficulty: "medium" });
  const add = eco.info(name)?.heatable ? eco.levelStats(name, level, STAT_DEPTH).defense : 0;
  for (const t of DAMAGE_TYPES) if (own[t] > 0) own[t] += add;
  return own;
}

/**
 * The damage types an item pill is coloured by: up to two types other than normal that its
 * attack or defence has ("Default" when it has none).
 */
export function pillDamage(data: GameData, eco: Economy, name: string, level = 1): [string, string] {
  const cfg = config(data, name);
  const a = attack(data, eco, name, cfg, level) ?? defense(data, eco, name, cfg, level);
  const out = ["Default", "Default"];
  if (!a) return out as [string, string];
  let i = 0;
  for (const t of DAMAGE_TYPES) if (t !== "NORMAL" && a[t] > 0 && i < 2) out[i++] = t;
  return out as [string, string];
}

/** The tooltip's stat bars for a weapon or a piece of gear at its level; null for other items. */
export function itemStats(data: GameData, eco: Economy, name: string, level: number): ItemStats | null {
  const cfg = config(data, name);
  if (!cfg) return null;
  const top = eco.info(name)?.heatable ? MAX_LEVEL : level;
  const now = attack(data, eco, name, cfg, level);
  if (now) {
    const pot = attack(data, eco, name, cfg, top)!;
    const bars: StatBar[] = [];
    for (const t of DAMAGE_TYPES) {
      const a = now[t] * 5 / 12, b = pot[t] * 5 / 12;
      if (a > 0 || b > 0) bars.push({ icon: `attack_${t.toLowerCase()}`, label: `t.${t.toLowerCase()}`, now: barWidth(a), potential: barWidth(b) });
    }
    // speed: the weapon's display speed (attack speed bonuses are variants', not levels')
    const speed = Math.min(Math.trunc(Number(cfg.displaySpeed ?? 0) * 15) + 14, WIDTH_CAP);
    bars.push({ icon: "attack_speed", label: "t.speed", now: speed, potential: speed });
    return { title: "t.attack_power", bars };
  }
  const d = defense(data, eco, name, cfg, level);
  if (!d) return null;
  const shield = kind(cfg) === "Shield";
  const factor = shield ? 0.375 : 0.75;
  const pot = defense(data, eco, name, cfg, top)!;
  const bars: StatBar[] = [];
  for (const t of DAMAGE_TYPES) {
    const a = d[t] * factor, b = pot[t] * factor;
    if (a > 0 || b > 0) bars.push({ icon: `defense_${t.toLowerCase()}`, label: `t.${t.toLowerCase()}`, now: barWidth(a), potential: barWidth(b) });
  }
  if (shield && cfg.healthScale) {
    const h = Math.trunc(data.depth.evaluate(cfg.healthScale, { depth: STAT_DEPTH, rarity: Number(cfg.rarity ?? 0), difficulty: "medium" }));
    bars.push({ icon: "shield_health", label: "t.health", now: Math.min(Math.trunc(h / 40) * 6 + 14, WIDTH_CAP), potential: 0 });
  }
  return bars.length ? { title: "t.defense_power", bars } : null;
}
