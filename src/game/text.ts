// The game's text for its configs: item names, descriptions and types, monster names, and the
// other keys the configs carry, translated in the bundles the client uses for each (src/i18n.ts).
// Each lookup falls back to the English this port made up before the bundles were read, so a
// missing bundle or key never leaves a blank.

import { hasMessage, qualify, text, xlate } from "../i18n";

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
