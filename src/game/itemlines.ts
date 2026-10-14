// The bonus rows of a levelled item's tooltip, as the client's ItemConfig builds its pills:
//
// - weapons first list their status effects (ItemConfig.Weapon: "Good chance of causing
//   Strong FIRE", each with the condition's icon), before the unique variants;
// - then the level's lines (ItemConfig.Level): health, charge time, movement speed and attack
//   speed, then the charge time and attack speed a weapon class gets on top (with that
//   class's icon);
// - weapons then give their damage bonuses against tagged monsters ("Damage Bonus vs Beast:
//   High"); armour, helmets and shields their damage bonus, tagged bonuses, and what each
//   weapon class gets on top.
//
// The level is the item's global modifier and its level table's entry at its level, read at
// depth 30. Words come from the item bundle (ItemValueKey grades, StatusChance and
// StatusPower words).

import { itemValue, type ValueKey } from "./bonus";
import type { GameData } from "./data";
import type { Economy } from "./economy";
import { message, text as bundleText } from "../i18n";

export interface TipLine { text: string; bonus: boolean; icon?: string | null }

const DEPTH = 30;
const kind = (o: any) => { const c: string = o?.$class ?? ""; return c.substring(c.lastIndexOf("$") + 1); };
const enumName = (v: any, d = "") => String(v?.name ?? v ?? d).split(".").pop()!;
const STEPS: Record<ValueKey, number> = { DAMAGE: 0.08, SPEED: 0.04, CHARGE: 0.08, HEALTH: 40, TAGGED: 0.1 };
const GRADES = ["low", "medium", "high", "very_high", "ultra"];
const CLASSES = ["SWORD", "HANDGUN", "BOMB"] as const;
type WeaponClass = (typeof CLASSES)[number];

/** StatusCondition in order: name, mask, enabled. */
const CONDITIONS: [string, number][] = [["stun", 1], ["poison", 2], ["fire", 4], ["freeze", 8], ["shock", 16], ["curse", 32], ["blind", 64],
  ["muddle", 128], ["sleep", 256], ["petrify", 512], ["jelly", 1024], ["doom", 2048], ["charm", 4096]];
/** StatusChance's words. */
const CHANCE: Record<string, string> = { CUSTOM: "m.custom", LOW: "m.slight", MEDIUM: "m.slight", HIGH: "m.fair", VERY_HIGH: "m.good", ULTRA: "m.high", MAXIMUM: "m.high" };

const word = (key: string) => bundleText("item", key, key.replace(/^[mt]\./, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()));
const say = (key: string, fallback: string, ...args: (string | number)[]) => { const t = message("item", key, ...args); return t && !t.startsWith("m.") ? t : fallback; };

/** ItemValueKey.key: the grade word for an amount ("m.medium"). */
export function gradeKey(key: ValueKey, amount: number): string {
  const a = Math.abs(amount), step = STEPS[key];
  const i = GRADES.findIndex((_, k) => a <= step * (k + 1) + 1e-6);
  return "m." + (i < 0 ? "maximum" : GRADES[i]);
}

/** The weapon class an item config is (LevelConfig.Weapons), or null for gear. */
function weaponClass(impl: any): WeaponClass | null {
  const k = kind(impl);
  if (k === "Sword") return "SWORD";
  if (k === "Handgun" || k === "SwingingHandgun") return "HANDGUN";
  if (k === "Bomb") return "BOMB";
  return null;
}

interface Mods { charge: number; speed: number; attackSpeed: number }

/** EquipmentModifiers from the configs for a weapon class (null: the class-less ones). */
function mods(configs: any[], cls: WeaponClass | null): Mods {
  const m: Mods = { charge: 0, speed: 0, attackSpeed: 0 };
  const walk = (c: any, d: number) => {
    if (!c || d > 8) return;
    switch (kind(c)) {
      case "Compound": for (const x of c.levels ?? []) walk(x, d + 1); break;
      case "ChargeTimeReduction": m.charge += itemValue("CHARGE", c.bonus, c.positive, c.reduction ?? 0); break;
      case "SpeedChange": m.speed += itemValue("SPEED", c.bonus, c.positive, c.speed ?? 0); break;
      case "AttackSpeedChange": m.attackSpeed += itemValue("SPEED", c.bonus, c.positive, c.speed ?? 0); break;
      case "WeaponClass": if (enumName(c.weaponClass, "SWORD") === cls) walk(c.level, d + 1); break;
    }
  };
  for (const c of configs) walk(c, 0);
  return m;
}

/** DamageSummary from the configs: the relative (capped) bonus and the tagged bonuses. */
function damage(configs: any[], cls: WeaponClass | null): { relative: number; tagged: Map<string, number> } {
  const out = { relative: 0, tagged: new Map<string, number>() };
  const walk = (c: any, d: number) => {
    if (!c || d > 8) return;
    switch (kind(c)) {
      case "Compound": for (const x of c.levels ?? []) walk(x, d + 1); break;
      // gear sums its capped bonuses; the uncapped ones are left out of the tooltip
      case "RelativeDamageBonus":
        if (DEPTH >= (c.startDepth ?? 0) && c.capped !== false) out.relative += itemValue("DAMAGE", c.bonus, c.positive, c.damage ?? 0);
        break;
      case "TaggedDamageBonus":
        if (c.tag) out.tagged.set(c.tag, (out.tagged.get(c.tag) ?? 0) + itemValue("DAMAGE", c.bonus, c.positive, c.damage ?? 0));
        break;
      case "WeaponClass": if (enumName(c.weaponClass, "SWORD") === cls) walk(c.level, d + 1); break;
    }
  };
  for (const c of configs) walk(c, 0);
  return out;
}

function health(configs: any[]): number {
  let h = 0;
  const walk = (c: any, d: number) => {
    if (!c || d > 8) return;
    if (kind(c) === "Compound") for (const x of c.levels ?? []) walk(x, d + 1);
    else if (kind(c) === "HealthBonus" && DEPTH >= (c.minDepth ?? 0)) h += itemValue("HEALTH", c.bonus, c.positive, c.health ?? 40);
  };
  for (const c of configs) walk(c, 0);
  return Math.trunc(h);
}

const classIcon = (cls: WeaponClass) => `ui/icon/inventory/categories/icon_${cls.toLowerCase()}.png`;

/** ItemConfig.Weapon's status rows: one per condition each status value causes (or risks). */
export function statusLines(data: GameData, name: string): TipLine[] {
  let impl: any = null;
  try { impl = data.resolveSync("config/item.dat", { name }, "item"); } catch { impl = null; }
  if (!impl || !weaponClass(impl)) return [];
  const out: TipLine[] = [];
  for (const sv of (impl.statusValues ?? []) as any[]) {
    const positive = sv?.positive !== false, flags = Number(sv?.flags ?? 0);
    for (const [cond, mask] of CONDITIONS) {
      if (!(flags & mask)) continue;
      const c = word("m." + cond);
      const text = positive
        ? say("m.status_cause", `${word(CHANCE[enumName(sv.chance, "LOW")] ?? "m.slight")} chance of causing ${word("m." + enumName(sv.power, "MINOR").toLowerCase())} ${c}`,
          word(CHANCE[enumName(sv.chance, "LOW")] ?? "m.slight"), word("m." + enumName(sv.power, "MINOR").toLowerCase()), c)
        : say("m.status_receive", `Chance of receiving ${c}`, c);
      out.push({ text, bonus: positive, icon: `ui/icon/debuff/${cond}.png` });
    }
  }
  return out;
}

/** ItemConfig.Level (and Weapon or Gear) rows for an item at its level. */
export function levelLines(data: GameData, eco: Economy, name: string, level: number): TipLine[] {
  let impl: any = null;
  try { impl = data.resolveSync("config/item.dat", { name }, "item"); } catch { impl = null; }
  const configs = [impl?.globalModifier ?? null, ...eco.levelConfigs(name, Math.max(1, level))];
  const cls = impl ? weaponClass(impl) : null;
  const out: TipLine[] = [];
  const grade = (key: ValueKey, v: number) => word(gradeKey(key, v));
  const h = health(configs);
  if (h) out.push({ bonus: h > 0, text: say(h > 0 ? "m.health_bonus" : "m.health_penalty", `Health ${h > 0 ? "Bonus: +" : "Penalty: "}${Math.trunc(h / 40)}`, Math.trunc(h / 40)) });
  const base = mods(configs, null);
  const charge = (v: number, icon: string | null) => out.push({ bonus: v > 0, icon,
    text: say(v > 0 ? "m.charge_reduction" : "m.charge_increase", `Charge Time ${v > 0 ? "Reduction" : "Increase"}: ${grade("CHARGE", v)}`, grade("CHARGE", v)) });
  const attackSpeed = (v: number, icon: string | null) => out.push({ bonus: v > 0, icon,
    text: say(v < 0 ? "m.attack_speed_decrease" : "m.attack_speed_increase", `Attack Speed ${v < 0 ? "Decreased" : "Increased"}: ${grade("SPEED", v)}`, grade("SPEED", v)) });
  if (base.charge) charge(base.charge, null);
  if (base.speed) out.push({ bonus: base.speed > 0, text: say(base.speed < 0 ? "m.speed_decrease" : "m.speed_increase",
    `Movement Speed ${base.speed < 0 ? "Decreased" : "Increased"}: ${grade("SPEED", base.speed)}`, grade("SPEED", base.speed)) });
  if (base.attackSpeed) attackSpeed(base.attackSpeed, null);
  for (const c of CLASSES) {
    const m = mods(configs, c);
    if (m.charge !== base.charge) charge(m.charge - base.charge, classIcon(c));
    if (m.attackSpeed !== base.attackSpeed) attackSpeed(m.attackSpeed - base.attackSpeed, classIcon(c));
  }
  const tagLine = (tag: string, v: number, icon: string | null) => out.push({ bonus: v > 0, icon,
    text: say(v < 0 ? "m.tagged_damage_penalty" : "m.tagged_damage_bonus", `Damage ${v < 0 ? "Penalty" : "Bonus"} vs ${word("t." + tag)}: ${grade("DAMAGE", v)}`,
      grade("DAMAGE", v), word("t." + tag)) });
  const dmgLine = (v: number, icon: string | null) => out.push({ bonus: v > 0, icon,
    text: say(v < 0 ? "m.damage_penalty" : "m.damage_bonus", `Damage ${v < 0 ? "Penalty" : "Bonus"}: ${grade("DAMAGE", v)}`, grade("DAMAGE", v)) });
  if (cls) {
    // ItemConfig.Weapon: the tagged bonuses of its own class
    for (const [tag, v] of damage(configs, cls).tagged) if (v) tagLine(tag, v, null);
    return out;
  }
  if (!impl || !/^(Armor|Helm|Shield|Gear|Accessorized)$/.test(kind(impl))) return out;
  const d = damage(configs, null);
  if (d.relative) dmgLine(d.relative, null);
  for (const [tag, v] of d.tagged) if (v) tagLine(tag, v, null);
  for (const c of CLASSES) {
    const dc = damage(configs, c);
    if (dc.relative !== d.relative) dmgLine(dc.relative - d.relative, classIcon(c));
    for (const [tag, v] of dc.tagged) {
      const was = d.tagged.get(tag);
      if (was === undefined || was !== v) tagLine(tag, v - (was ?? 0), classIcon(c));
    }
  }
  return out;
}
