// The game's text for its configs: item names, descriptions and types, monster names, and the
// other keys the configs carry, translated in the bundles the client uses for each (src/i18n.ts).
// Each lookup falls back to the English this port made up before the bundles were read, so a
// missing bundle or key never leaves a blank.

import { compose, hasMessage, message, qualify, tcompose, text, xlate } from "../i18n";

type ItemResolver = (name: string) => any | null;
let resolveItem: ItemResolver | null = null;
const names = new Map<string, string>();

/** Called when config/item.dat is loaded: item configs by name (resolved through derivations). */
export function setItemResolver(fn: ItemResolver) {
  resolveItem = fn;
  names.clear();
}

const last = (name: string) => name.split("/").pop() ?? name;

/**
 * An item's name, as ItemConfig.Original's getName: its name key qualified with the item
 * bundle ("%item:m.calibur"). Falls back to the config path's last segment.
 */
export function itemName(name: string): string {
  const known = names.get(name);
  if (known !== undefined) return known;
  let impl: any = null;
  try { impl = resolveItem?.(name) ?? null; } catch { impl = null; }
  const key = typeof impl?.name === "string" ? impl.name : "";
  const out = key && hasMessage("item", key) ? xlate("global", qualify("item", key)) : last(name);
  if (resolveItem) names.set(name, out);
  return out;
}

/** The item's flavor text (the tooltip's description), or "" when it has none. */
export function itemFlavor(name: string): string {
  let impl: any = null;
  try { impl = resolveItem?.(name) ?? null; } catch { impl = null; }
  const key = typeof impl?.flavor === "string" ? impl.flavor : "";
  return key && hasMessage("item", key) ? xlate("item", key) : "";
}

/** The item's description key translated (the tooltip body some items have), or "". */
export function itemDescription(name: string): string {
  let impl: any = null;
  try { impl = resolveItem?.(name) ?? null; } catch { impl = null; }
  const key = typeof impl?.description === "string" ? impl.description : "";
  return key && hasMessage("item", key) ? xlate("item", key) : "";
}

/** ItemCodes.Group's type keys, by the economy's categories. */
const TYPE_KEYS: Record<string, string> = {
  sword: "m.sword", handgun: "m.handgun", gun: "m.handgun", bomb: "m.bomb", helm: "m.helm", helmet: "m.helm", armor: "m.armor",
  shield: "m.shield", trinket: "m.trinket", vitapod: "m.dungeon_gear", material: "m.material", mineral: "m.mineral",
  capsule: "m.capsule", vial: "m.vial", recipe: "m.recipe", token: "m.token", accessory: "m.accessory", key: "m.key",
  ticket: "m.ticket", sprite: "m.sprite", furni: "m.furni", item: "m.item",
};

/** An item type's name ("Sword", "Material") in the item bundle, else the fallback. */
export function itemType(kind: string, fallback: string): string {
  return text("item", TYPE_KEYS[kind.toLowerCase()], fallback);
}

/** A monster's name from its description config's name key, in the monster bundle. */
export function monsterName(def: { nameKey?: string | null; name: string } | null | undefined, fallback?: string): string {
  const plain = fallback ?? last(def?.name ?? "").replace(/\s+\d+(\.\d+)?$/, "");
  return text("monster", def?.nameKey, plain);
}

/**
 * A level's name from the dungeon bundle: its value is "Title|Subtitle" (the loading screen's
 * name and zone lines), or a title alone. Null when the bundle lacks the key.
 */
export function levelText(key: string | null | undefined, bundle = "dungeon"): { title: string; zone: string } | null {
  if (!key || !hasMessage(bundle, key)) return null;
  const [title, zone = ""] = xlate(bundle, key).split("|");
  return { title, zone };
}

/** The first of several keys the bundle has. */
export function firstKey(bundle: string, keys: string[]): string | null {
  return keys.find(k => hasMessage(bundle, k)) ?? null;
}

/** "DEPTH 12" as the dungeon bundle words it. */
export function depthText(depth: number): string {
  return hasMessage("dungeon", "m.depth") ? message("dungeon", "m.depth", String(depth)) : `DEPTH ${depth}`;
}

// ----------------------------------------------------------------------------- variants

const enumOf = (v: any, d: string) => String(v?.name ?? v ?? d).split(".").pop()!;
const BONUSES = ["CUSTOM", "LOW", "MEDIUM", "HIGH", "VERY_HIGH", "ULTRA", "MAXIMUM"];
/** ItemCodes.ItemValueKey's steps: a CUSTOM bonus is graded by its value. */
const STEPS: Record<string, number> = { DAMAGE: 0.08, SPEED: 0.04, CHARGE: 0.08, HEALTH: 40, TAGGED: 0.1 };
function valueKey(kind: string, bonus: string, value: number): string {
  if (bonus !== "CUSTOM") return "m." + bonus.toLowerCase();
  const v = Math.abs(value);
  for (let i = 1; i < BONUSES.length; i++) if (v <= STEPS[kind] * i) return "m." + BONUSES[i].toLowerCase();
  return "m.maximum";
}
/** StatusResist.key(resist): a CUSTOM resistance is graded by its points. */
function resistKey(grade: string, points: number): string {
  if (grade !== "CUSTOM") return "m." + grade.toLowerCase();
  for (const [g, v] of [["low", 10], ["medium", 20], ["high", 30], ["maximum", 40]] as const) if (points < v) return "m." + g;
  return "m.maximum";
}
/** Status condition bits (StatusCodes) to their keys in the status bundle. */
const CONDITIONS: Record<number, string> = { 1: "m.stun", 2: "m.poison", 4: "m.fire", 8: "m.freeze", 16: "m.shock", 32: "m.curse", 256: "m.sleep" };

/**
 * A unique variant's compound key in the item bundle, as VariantConfig builds it ("Attack
 * Speed Increase: Medium" and so on), or null for a kind without one.
 */
export function variantKey(v: any): string | null {
  const kind = String(v?.$class ?? "").split("$").pop();
  const bonus = enumOf(v?.bonus, "LOW");
  const q = (key: string) => qualify("item", key);
  switch (kind) {
    case "AttackSpeedChange": return q(compose("m.attack_speed", valueKey("SPEED", bonus, v.speed ?? 0)));
    case "ChargeTimeReduction": return q(compose("m.charge_reduction", valueKey("CHARGE", bonus, v.reduction ?? 0)));
    case "SpeedChange": return q(compose("m.move_speed", valueKey("SPEED", bonus, v.speed ?? 0)));
    case "DefenseTypeBonus": return q(compose("m.defense_type", "m." + enumOf(v.type, "NORMAL").toLowerCase(), "m." + bonus.toLowerCase()));
    case "HealthBonus": return q(tcompose("m.health_bonus", Math.trunc((v.health ?? 40) / 40)));
    case "TaggedDamage": return q(compose("m.tagged_damage", "t." + (v.tag ?? ""), valueKey("DAMAGE", bonus, v.damage ?? 0)));
    case "StatusResist": {
      const c = CONDITIONS[v.conditionMask ?? 0];
      return c ? q(compose("m.new_status_resist", qualify("status", c), resistKey(enumOf(v.statusResist, "LOW"), v.resist ?? 0))) : null;
    }
    case "Message": return typeof v.message === "string" && v.message ? qualify(v.bundle || "item", v.message) : null;
    default: return null;
  }
}

/** A variant's line in the game's words, else the fallback. */
export function variantText(v: any, fallback: string): string {
  const key = variantKey(v);
  return key && hasMessage("global", key) ? xlate("global", key) : fallback;
}
