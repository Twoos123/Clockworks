// The gear catalogue and the loadout rules behind the arsenal: which equippable items exist
// (from config/item.dat), which slot each fits, equipping and unequipping. Prices, levels,
// recipes, buying and selling are the economy's (src/game/economy.ts). No UI here.

import type { GameData } from "./data";
import type { Category as EcoCategory } from "./economy";
import type { Loadout } from "./save";
import { itemName } from "./text";

export type Slot = "weapon" | "shield" | "armor" | "helmet" | "trinket" | "vitapod";

export interface Category {
  id: string;
  /** The list header's text. */
  label: string;
  slot: Slot;
  test: RegExp;
  /** The category icon (ui/icon/inventory/categories). */
  icon: string;
  /** The economy's category (src/game/economy.ts). */
  eco: EcoCategory;
}

const CAT = "ui/icon/inventory/categories/";
export const CATEGORIES: Category[] = [
  { id: "sword", eco: "sword", label: "Swords", slot: "weapon", test: /^Weapon\/Sword\//, icon: CAT + "icon_sword.png" },
  { id: "gun", eco: "handgun", label: "Guns", slot: "weapon", test: /^Weapon\/Handgun\//, icon: CAT + "icon_handgun.png" },
  { id: "bomb", eco: "bomb", label: "Bombs", slot: "weapon", test: /^Weapon\/Bomb\//, icon: CAT + "icon_bomb.png" },
  { id: "shield", eco: "shield", label: "Shields", slot: "shield", test: /^Gear\/Shield\//, icon: CAT + "icon_shield.png" },
  { id: "armor", eco: "armor", label: "Armor", slot: "armor", test: /^Gear\/Armor\//, icon: CAT + "icon_armor.png" },
  { id: "helmet", eco: "helm", label: "Helmets", slot: "helmet", test: /^Gear\/Helm\//, icon: CAT + "icon_helmet.png" },
  { id: "trinket", eco: "trinket", label: "Trinkets", slot: "trinket", test: /^Gear\/Trinket\//, icon: CAT + "icon_amulet.png" },
  { id: "vitapod", eco: "vitapod", label: "Vitapods", slot: "vitapod", test: /^Gear\/Dungeon\/Vitapod\//, icon: CAT + "icon_capsule.png" },
];

/** Items that are parts, developer or test items, PvP and promotional variants. */
export const SKIP = /\/Parts\/|\/Dev\/|\(Dev\)|\bTEST\b|\/Test\/|PvP|\(Test\)|Tutorial|Promo/;

export interface ItemEntry {
  name: string;
  /** The item's name in the game's text (the config path's last segment without it). */
  label: string;
  category: Category;
  rarity: number;
  /** The item's IconConfig. */
  icon: any;
}

/** An item's display name: its name in the game's text, else the last segment of its config path. */
export const itemLabel = (name: string) => itemName(name);

const CATALOGUE = new WeakMap<object, ItemEntry[]>();

/** Every equippable item, by category, then rarity, then name (config/item.dat must be preloaded). */
export function catalogue(data: GameData): ItemEntry[] {
  const lib = data.library_("config/item.dat");
  const cached = CATALOGUE.get(lib);
  if (cached) return cached;
  const list: ItemEntry[] = [];
  for (const name of lib.keys()) {
    // names starting with "_" are templates other items derive from
    if (SKIP.test(name) || (name.split("/").pop() ?? "").startsWith("_")) continue;
    const category = CATEGORIES.find(c => c.test.test(name));
    if (!category) continue;
    const impl = data.resolveSync("config/item.dat", { name }, "item");
    if (!impl?.icon || (!impl.model && category.slot !== "trinket" && category.slot !== "vitapod")) continue;
    if (category.slot === "weapon" && !impl.attacks && !impl.chargedAttack) continue;
    list.push({ name, label: itemLabel(name), category, rarity: impl.rarity ?? 0, icon: impl.icon });
  }
  const order = (e: ItemEntry) => CATEGORIES.indexOf(e.category);
  list.sort((a, b) => order(a) - order(b) || a.rarity - b.rarity || a.label.localeCompare(b.label));
  if (lib.size) CATALOGUE.set(lib, list);
  return list;
}

// ----------------------------------------------------------------------------- loadout

export const copyLoadout = (l: Loadout): Loadout => ({ ...l, weapons: [...l.weapons], trinkets: [...(l.trinkets ?? [])] });

/** True when the item is worn in the loadout. */
export function isEquipped(l: Loadout, e: ItemEntry): boolean {
  switch (e.category.slot) {
    case "weapon": return l.weapons.includes(e.name);
    case "trinket": return l.trinkets.includes(e.name);
    default: return l[e.category.slot] === e.name;
  }
}

/**
 * Equips the item, or takes it off when it is worn: up to three weapons (the oldest makes
 * room), two trinkets, one of each other slot. The last weapon and the shield stay on.
 */
export function toggleEquip(loadout: Loadout, e: ItemEntry): Loadout {
  const l = copyLoadout(loadout);
  const slot = e.category.slot;
  if (slot === "weapon") {
    const i = l.weapons.indexOf(e.name);
    if (i >= 0) { if (l.weapons.length > 1) l.weapons.splice(i, 1); }
    else { if (l.weapons.length >= 3) l.weapons.shift(); l.weapons.push(e.name); }
  } else if (slot === "trinket") {
    const i = l.trinkets.indexOf(e.name);
    if (i >= 0) l.trinkets.splice(i, 1);
    else { if (l.trinkets.length >= 2) l.trinkets.shift(); l.trinkets.push(e.name); }
  } else l[slot] = l[slot] === e.name && slot !== "shield" ? "" : e.name;
  return l;
}

/** Takes off what a loadout slot holds (`index` for weapons and trinkets). */
export function unequip(loadout: Loadout, slot: Slot, index = 0): Loadout {
  const l = copyLoadout(loadout);
  if (slot === "weapon") { if (l.weapons.length > 1 && index < l.weapons.length) l.weapons.splice(index, 1); }
  else if (slot === "trinket") l.trinkets.splice(index, 1);
  else if (slot !== "shield") l[slot] = "";
  return l;
}
