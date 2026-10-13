// Gear bonuses: the LevelConfig "global modifiers" and status resistances on armour, helmets,
// shields and trinkets (Heart Pendants add health, Focus Modules shorten charges, Slash
// Modules add sword damage, Katnip Pouches resist sleep). The configs give the kind of bonus,
// its level (ItemCodes ItemBonus LOW to MAXIMUM) and, usually, the amount; the amounts for
// levels a config leaves at its default follow the configs that do spell them out.

import type { WeaponKind } from "./data";

const kind = (o: any) => { const c: string = o?.$class ?? ""; return c.substring(c.lastIndexOf("$") + 1); };
const level = (v: any) => String(v?.name ?? v ?? "LOW").split(".").pop()!;

// Amounts per ItemBonus level, from the configs that state them (Heart Pendants: 80 at
// MEDIUM, 160 at VERY_HIGH, 200 at ULTRA; Slash Modules: 0.1 LOW, 0.2 MEDIUM; Quick Draw:
// 0.02 LOW, 0.05 MEDIUM).
const LEVELS = ["LOW", "MEDIUM", "HIGH", "VERY_HIGH", "ULTRA", "MAXIMUM"];
const HEALTH = [40, 80, 120, 160, 200, 240];
const DAMAGE = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
const CHARGE = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3];
const ATTACK_SPEED = [0.02, 0.05, 0.08, 0.12, 0.16, 0.2];
const SPEED = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3];
const at = (table: number[], v: any) => table[Math.max(0, LEVELS.indexOf(level(v)))];

/** LevelConfig Weapons values to the weapon kinds here; "All" applies to every weapon. */
type Cls = WeaponKind | "All";
const WEAPON: Record<string, Cls> = { SWORD: "Sword", HANDGUN: "Handgun", BOMB: "Bomb" };

export interface Bonuses {
  /** Extra health in the game's units (a heart pip is 40). */
  health: number;
  damage: Record<Cls, number>;
  /** Fraction taken off charge times. */
  charge: Record<Cls, number>;
  attackSpeed: Record<Cls, number>;
  /** Fraction added to movement speed. */
  speed: number;
  /** Damage bonus against monsters with a tag (fam_slime and so on). */
  tagged: Record<string, number>;
  /** Status resistance by StatusConditionConfig flag bit (stun 1, poison 2, fire 4, ...). */
  resist: Record<number, number>;
}

const perClass = (): Record<Cls, number> => ({ Sword: 0, Handgun: 0, Bomb: 0, Other: 0, All: 0 });

export function emptyBonuses(): Bonuses {
  return { health: 0, damage: perClass(), charge: perClass(), attackSpeed: perClass(), speed: 0, tagged: {}, resist: {} };
}

/** Adds an item's globalModifier and defense (status resists) to `b`. */
export function addItemBonuses(b: Bonuses, item: any) {
  if (!item) return;
  const mod = (m: any, cls: Cls, depth = 0) => {
    if (!m || depth > 6) return;
    switch (kind(m)) {
      case "Compound": for (const x of m.levels ?? []) mod(x, cls, depth + 1); break;
      // the class field defaults to SWORD (sword modules leave it out)
      case "WeaponClass": mod(m.level, WEAPON[level(m.weaponClass ?? "SWORD")] ?? "Sword", depth + 1); break;
      case "HealthBonus": b.health += m.health ?? at(HEALTH, m.bonus); break;
      case "RelativeDamageBonus": b.damage[cls] += m.damage ?? at(DAMAGE, m.bonus); break;
      case "TaggedDamageBonus": if (m.tag) b.tagged[m.tag] = (b.tagged[m.tag] ?? 0) + (m.damage ?? at(DAMAGE, m.bonus)); break;
      case "ChargeTimeReduction": b.charge[cls] += m.reduction ?? at(CHARGE, m.bonus); break;
      case "AttackSpeedChange": b.attackSpeed[cls] += m.speed ?? at(ATTACK_SPEED, m.bonus); break;
      case "SpeedChange": b.speed += m.speed ?? at(SPEED, m.bonus); break;
    }
  };
  mod(item.globalModifier, "All");
  const def = (d: any, depth = 0) => {
    if (!d || depth > 6) return;
    if (kind(d) === "Compound") for (const x of d.defenses ?? []) def(x, depth + 1);
    else if (kind(d) === "StatusResist") {
      const mask = d.conditionMask ?? 0;
      for (let bit = 1; bit <= mask; bit <<= 1) if (mask & bit) b.resist[bit] = (b.resist[bit] ?? 0) + (d.resist ?? 0);
    }
  };
  def(item.defense);
}

/** A bonus for a weapon kind: its own class plus the all-weapons part. */
export const forWeapon = (r: Record<Cls, number>, k: WeaponKind | undefined) => (r[k ?? "Other"] ?? 0) + r.All;

/** StatusConditionConfig flag bits for the conditions modelled here. */
export const STATUS_BITS: Record<string, number> = { Stun: 1, Poison: 2, Fire: 4, Freeze: 8, Shock: 16, Curse: 32, Sleep: 256 };

/** Fraction a status resistance takes off a condition's chance and duration (20 points: 40%). */
export const resistFactor = (points: number) => Math.max(0.2, 1 - points * 0.02);
