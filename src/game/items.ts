// The item catalogue, recipes and the save-data rules behind the arsenal, the shops and the
// forge: which items exist (from config/item.dat), which slot each fits, equipping, buying
// and crafting. No UI here; the screens in src/ui draw it.

import type { GameData } from "./data";
import { LEVEL_HEAT, price, weaponLevel, type Loadout, type SaveData } from "./save";

export type Slot = "weapon" | "shield" | "armor" | "helmet" | "trinket" | "vitapod";

export interface Category {
  id: string;
  /** The list header's text. */
  label: string;
  slot: Slot;
  test: RegExp;
  /** The category icon (ui/icon/inventory/categories). */
  icon: string;
}

const CAT = "ui/icon/inventory/categories/";
export const CATEGORIES: Category[] = [
  { id: "sword", label: "Swords", slot: "weapon", test: /^Weapon\/Sword\//, icon: CAT + "icon_sword.png" },
  { id: "gun", label: "Guns", slot: "weapon", test: /^Weapon\/Handgun\//, icon: CAT + "icon_handgun.png" },
  { id: "bomb", label: "Bombs", slot: "weapon", test: /^Weapon\/Bomb\//, icon: CAT + "icon_bomb.png" },
  { id: "shield", label: "Shields", slot: "shield", test: /^Gear\/Shield\//, icon: CAT + "icon_shield.png" },
  { id: "armor", label: "Armor", slot: "armor", test: /^Gear\/Armor\//, icon: CAT + "icon_armor.png" },
  { id: "helmet", label: "Helmets", slot: "helmet", test: /^Gear\/Helm\//, icon: CAT + "icon_helmet.png" },
  { id: "trinket", label: "Trinkets", slot: "trinket", test: /^Gear\/Trinket\//, icon: CAT + "icon_amulet.png" },
  { id: "vitapod", label: "Vitapods", slot: "vitapod", test: /^Gear\/Dungeon\/Vitapod\//, icon: CAT + "icon_capsule.png" },
];

/** Items that are parts, developer or test items, PvP and promotional variants. */
export const SKIP = /\/Parts\/|\/Dev\/|\(Dev\)|\bTEST\b|\/Test\/|PvP|\(Test\)|Tutorial|Promo/;

export interface ItemEntry {
  name: string;
  /** The config path's last segment ("Proto Sword"). */
  label: string;
  category: Category;
  rarity: number;
  /** The item's IconConfig. */
  icon: any;
}

/** An item's display name: the last segment of its config path. */
export const itemLabel = (name: string) => name.split("/").pop() ?? name;

const CATALOGUE = new WeakMap<object, ItemEntry[]>();

/** Every equippable item, by category, then rarity, then name (config/item.dat must be preloaded). */
export function catalogue(data: GameData): ItemEntry[] {
  const lib = data.library_("config/item.dat");
  const cached = CATALOGUE.get(lib);
  if (cached) return cached;
  const list: ItemEntry[] = [];
  for (const name of lib.keys()) {
    // names starting with "_" are templates other items derive from
    if (SKIP.test(name) || itemLabel(name).startsWith("_")) continue;
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

/** Any item's icon and rarity (materials and consumables included), or null. */
export function itemInfo(data: GameData, name: string): { icon: any; rarity: number; kind: string } | null {
  const impl = data.resolveSync("config/item.dat", { name }, "item");
  if (!impl) return null;
  return { icon: impl.icon ?? null, rarity: impl.rarity ?? 0, kind: String(impl.$class ?? "").split("$").pop() ?? "" };
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

// ----------------------------------------------------------------------------- levels

export const MAX_LEVEL = 10;

/** An owned item's level: weapons level with heat, other gear counts as fully levelled. */
export function itemLevel(save: SaveData, name: string): number {
  if (!save.owned.includes(name)) return 0;
  return /^Weapon\//.test(name) ? weaponLevel(save.weaponHeat[name] ?? 0) : MAX_LEVEL;
}

/** Progress through the current level, 0 to 1 (1 at the maximum level). */
export function levelProgress(save: SaveData, name: string): number {
  if (!/^Weapon\//.test(name)) return 1;
  const heat = save.weaponHeat[name] ?? 0, lv = weaponLevel(heat);
  if (lv >= MAX_LEVEL) return 1;
  const lo = LEVEL_HEAT[lv - 1], hi = LEVEL_HEAT[lv];
  return Math.max(0, Math.min(1, (heat - lo) / (hi - lo)));
}

// ----------------------------------------------------------------------------- shops

/** Buys an item with crowns; false when it is owned already or the crowns fall short. */
export function buyItem(save: SaveData, name: string, cost: number): boolean {
  if (save.crowns < cost || save.owned.includes(name)) return false;
  save.crowns -= cost;
  save.owned.push(name);
  return true;
}

/** What a shop sells: the catalogue's items of the shop's categories up to its star rating. */
export function shopStock(data: GameData, categories: string[], maxRarity: number): ItemEntry[] {
  return catalogue(data).filter(e => categories.includes(e.category.id) && e.rarity >= 1 && e.rarity <= maxRarity);
}

/** The categories a shopkeeper sells, from what its config name says. */
export function keeperCategories(keeper: string): string[] {
  const k = keeper.toLowerCase();
  return /sword|gun|bomb|weapon/.test(k) ? ["sword", "gun", "bomb"] : /armor|helm/.test(k) ? ["armor", "helmet"]
    : /shield/.test(k) ? ["shield", "trinket"] : /trinket|jewel/.test(k) ? ["trinket"]
    : CATEGORIES.map(c => c.id);
}

export { price };

// ----------------------------------------------------------------------------- recipes

export interface Recipe {
  name: string;
  output: string;
  label: string;
  rarity: number;
  icon: any;
  category: Category | null;
  materials: [string, number][];
  /** The base item the recipe upgrades (it must reach `level`), or null. */
  consumes: string | null;
  level: number;
  cost: number;
}

const RECIPES = new WeakMap<object, Recipe[]>();

/** The recipe library (config/recipe.dat): ingredients and the item each makes. */
export async function recipes(data: GameData): Promise<Recipe[]> {
  await data.preload("config/recipe.dat", "config/item.dat");
  const lib = data.library_("config/recipe.dat");
  const cached = RECIPES.get(lib);
  if (cached) return cached;
  const out: Recipe[] = [];
  for (const name of lib.keys()) {
    const r = data.resolveSync("config/recipe.dat", { name }, "recipe");
    const output = r?.item?.name;
    if (!output || SKIP.test(output)) continue;
    const item = data.resolveSync("config/item.dat", { name: output }, "item");
    if (!item?.icon) continue;
    const materials: [string, number][] = [];
    let consumes: string | null = null, level = 0;
    for (const ing of r.ingredients ?? []) {
      const k = String(ing?.$class ?? "").split("$").pop();
      if (k === "LevelItem" && ing.item?.name) { consumes = ing.item.name; level = ing.level ?? 0; }
      else if (ing?.item?.name) materials.push([ing.item.name, ing.count ?? 1]);
    }
    out.push({ name, output, label: itemLabel(output), rarity: item.rarity ?? 0, icon: item.icon,
      category: CATEGORIES.find(c => c.test.test(output)) ?? null, materials, consumes, level,
      cost: Math.round(price(item.rarity ?? 0) / 2) });
  }
  out.sort((a, b) => a.rarity - b.rarity || a.label.localeCompare(b.label));
  RECIPES.set(lib, out);
  return out;
}

/** Recipes the knight can work toward: not made yet, and its base item owned (or none needed). */
export function availableRecipes(save: SaveData, all: Recipe[]): Recipe[] {
  const owned = new Set(save.owned);
  return all.filter(r => !owned.has(r.output) && (!r.consumes || owned.has(r.consumes)));
}

/** What a recipe still lacks: missing materials, the base item's level, crowns. */
export function craftShortfall(save: SaveData, r: Recipe) {
  const missing = r.materials.filter(([n, k]) => (save.materials[n] ?? 0) < k);
  const levelShort = !!r.consumes && itemLevel(save, r.consumes) < r.level;
  const crownsShort = save.crowns < r.cost;
  return { missing, levelShort, crownsShort, ok: !missing.length && !levelShort && !crownsShort };
}

/**
 * Crafts: spends the crowns and materials and adds the output. An upgrade recipe replaces its
 * base item, wherever it was equipped, and the new weapon starts at level 1.
 */
export function craftRecipe(save: SaveData, r: Recipe): boolean {
  if (!craftShortfall(save, r).ok || save.owned.includes(r.output)) return false;
  save.crowns -= r.cost;
  for (const [n, k] of r.materials) save.materials[n] -= k;
  if (r.consumes) {
    save.owned = save.owned.filter(o => o !== r.consumes);
    const l = save.loadout;
    l.weapons = l.weapons.map(w => (w === r.consumes ? r.output : w));
    l.trinkets = l.trinkets.map(w => (w === r.consumes ? r.output : w));
    for (const slot of ["shield", "armor", "helmet", "vitapod"] as const) if (l[slot] === r.consumes) l[slot] = r.output;
    if (save.weaponHeat[r.consumes] !== undefined) { delete save.weaponHeat[r.consumes]; save.weaponHeat[r.output] = 0; }
  }
  save.owned.push(r.output);
  return true;
}
