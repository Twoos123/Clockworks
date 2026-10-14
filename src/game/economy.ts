// The single-player economy: prices, shops, selling, heat and item levels, unique variants,
// crafting and item drops by depth. Everything is read from the install's config libraries;
// the rules that turn them into play (the game's server code) are closed, so their meaning is
// inferred from the data and the game's public wiki. Nothing here touches the DOM: the
// arsenal, shop and forge windows call these functions.
//
// Data used:
//   config/item_property.dat   ItemPropertyConfig: per star rating, buyPrice, sellPrice,
//                              baseHeat and maxHeat, the level table, the forge property
//   config/level_table.dat     LevelTableConfig: per item level (1-10), damage, charge time,
//                              defence and health bonuses
//   config/recipe.dat          RecipeConfig: ingredients, the base item and its level, the
//                              output's variant table and recipe property
//   config/recipe_property.dat RecipePropertyConfig: the crowns a recipe costs per star
//   config/variant.dat         VariantConfig: unique variant bonuses
//   config/variant_table.dat   VariantTableConfig: how variants are rolled
//   config/item_depth_weight.dat  ItemDepthWeightConfig: drop weights per star by depth
//
// PRICE TABLE (crowns, from item_property.dat; index is the item's star rating 0-5):
//   weapons, shields, armour, helmets   buy 150, 3000, 7500, 35000, 100000, 300000
//                                       sell  1,  300,  750,  3500,  10000,  30000
//   trinkets                            buy 150, 3000, 7500, 35000, 100000, 300000
//                                       sell  1,  100,  250,  1200,   3500,  10000
//   vitapods                            buy 400,  600,  800,  1200,   1800,   3000
//   recipes (Recipe/Base)               buy  10,  250, 1000,  4000,  10000,  25000
//   pickups (capsules and vials)        buy  50,  100,  150,   200,    250,    500
//   materials                           sell  1,    1,    5,    10,     25,     50
//   crafting (recipe_property.dat Base/Equipment): 40, 200, 400, 1000, 2500, 5000
// The game's shops priced from these same configs; which items a shop stocked on a day was
// server data (config/catalog.dat ships empty). Haven's Strangers stock the wiki's lists
// (src/game/vendors.ts: always-stocked goods and a daily random few per knight); other keepers
// sell every item of their kind within the star range their place allows. The Supply Depot
// adds its energy goods (depotCost: the heat amplifier, sparks, orbs of alchemy), and crafts
// take three orbs of their star or a pack's energy (src/game/energy.ts).

import { resolveRef } from "./logic";
import { itemName, variantText } from "./text";
import type { DepthContext } from "./depth";
import { itemValue } from "./bonus";
import { energyNow, orbFor, ORBS_PER_CRAFT, spendEnergy, type EnergyState } from "./energy";
import { crystalBand, crystalFor, forgedLevel, forgeSteps, HEAT_BONUS, rollForge, type ForgeOutcome, type ForgeStep } from "./forge";
import { isLobbyBasil, lobbyStock, terminalCount, terminalStars, vendorDay, vendorKey, vendorMatch, vendorNames, vendorSeed, VENDORS } from "./vendors";

const kind = (o: any) => { const c: string = o?.$class ?? ""; return c.substring(c.lastIndexOf("$") + 1); };
const enumName = (v: any, d = "") => String(v?.name ?? v ?? d).split(".").pop()!;
const last = (n: string) => n.split("/").pop() ?? n;

/** Config libraries by file name (preloaded). */
export type Libs = (file: string) => Map<string, any>;

export const ECONOMY_FILES = ["config/item.dat", "config/item_property.dat", "config/level_table.dat", "config/recipe.dat",
  "config/forge_property.dat", "config/recipe_property.dat", "config/variant.dat", "config/variant_table.dat", "config/item_depth_weight.dat", "config/spawn_table.dat"];

export type Category = "sword" | "handgun" | "bomb" | "shield" | "armor" | "helm" | "trinket" | "vitapod" | "pickup"
  | "material" | "mineral" | "deposit" | "recipe" | "other";

export interface ItemInfo {
  name: string;
  /** Display name (the config path's last part; game text lives in the code jars). */
  label: string;
  category: Category;
  rarity: number;
  icon: any;
  /** The item's ItemProps for its star rating (prices, heat), or null. */
  props: any | null;
  tags: string[];
  /** ItemCodes AutoSpawnType: GEAR, MATERIAL or TOKEN items drop as loot. */
  autoSpawn: string | null;
  /** Gear levels with heat (weapons, shields, armour, helmets). */
  heatable: boolean;
}

/** One owned item: its heat, level and unique variants. */
export interface GearState {
  heat: number; level: number; variants: string[];
  /** The forge's Heat Bonus: extra heat toward the next level (0.25), until the next forging. */
  heatBonus?: number;
}

/** What the economy reads and writes in the save (a subset of SaveData). */
export interface Wallet {
  crowns: number;
  materials: Record<string, number>;
  owned: string[];
  gear: Record<string, GearState>;
  recipes: string[];
  pocket: [string, number][];
  loadout: { weapons: string[]; shield: string; armor: string; helmet: string; trinkets: string[]; vitapod: string };
  /** Time (ms) until which the heat amplifier doubles heat (an Energy item in the game). */
  heatAmplifier?: number;
  /** Energy (src/game/energy.ts): pays for orbs of alchemy and Supply Depot goods. */
  energy?: EnergyState;
  /** Sparks of Life (a fresh knight has three). */
  sparks?: number;
}

/** A Supply Depot good sold for energy: its item, the energy it costs and how many come. */
export interface DepotGood { name: string; energy: number; count: number; kind: "heat" | "spark" | "orb" | "crystal" }

/** The forge's buy panel offer: a stack of a tier's fire crystals, for energy or for crowns. */
export interface CrystalOffer { name: string; count: number; energy: number; crowns: number }

/** The Supply Depot sells fire crystals by fifty (the wiki: "50 units for 85 energy"). */
export const CRYSTAL_PACK = 50;
/** Vatel sells Cracked and Dim crystals for crowns by five (the wiki: "5 units for 50 crowns"). */
export const CROWN_CRYSTAL_PACK = 5;

/** What one forging did: the outcome, the crystals spent, the level reached, a prize box's crystals. */
export interface ForgeResult extends ForgeOutcome { spent: number; level: number; prize: { name: string; count: number } | null }

export interface Recipe {
  /** The recipe config name ("Sword/Calibur"). */
  name: string;
  /** The recipe item a shop sells ("Recipe/Sword/Calibur Recipe"), when one exists. */
  item: string | null;
  output: string;
  rarity: number;
  materials: [string, number][];
  /** The base item consumed, and the level it must have reached. */
  base: string | null;
  baseLevel: number;
  crowns: number;
  /** The orbs of alchemy a craft takes (three of its star), or null for unrated recipes. */
  orbs: [string, number] | null;
  variantTable: any;
}

export interface LevelStats {
  /** Damage bonus that joins the capped bonus pool (RelativeDamageBonus, capped). */
  damage: number;
  /** Damage bonus applied on its own, uncapped (the level tables' RelativeDamageBonus). */
  uncapped: number;
  /** Fraction taken off the weapon's charge time. */
  charge: number;
  /** Defence added to each damage type the item defends against (LevelConfig DefenseIncrease). */
  defense: number;
  /** Health in the game's units (a heart pip is 40). */
  health: number;
}

/** A variant's effect on the knight. */
export interface VariantEffect {
  label: string;
  /** 1 (low) to 4 (very high). */
  grade: number;
  defense?: { type: string; depthScale: any; amount: number };
  /**
   * A status resistance. A named level (`scaled`) shrinks with the resistance already held:
   * round(min(1, 1 - held / 100) * points).
   */
  resist?: { mask: number; points: number; scaled?: boolean };
  tagged?: { tag: string; damage: number };
  attackSpeed?: number;
  charge?: number;
  damage?: number;
  health?: number;
  speed?: number;
  weaponClass?: string;
}

export const GRADES = ["", "Low", "Medium", "High", "Very High"];
const BONUS_GRADE: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, VERY_HIGH: 4, ULTRA: 4, MAXIMUM: 4 };
// amounts for enum-valued bonuses the configs leave unspelled, from the ones they spell out
/** StatusCodes StatusResist: named resist levels (CUSTOM takes the variant's own amount). */
const RESIST = { LOW: 10, MEDIUM: 20, HIGH: 30, MAXIMUM: 40 } as Record<string, number>;
/** Item groups (ItemCodes Group) of variant tables' GroupEntry; SWORD is the default. */
const GROUP: Partial<Record<Category, string>> = { sword: "SWORD", handgun: "HANDGUN", bomb: "BOMB", helm: "HELM", armor: "ARMOR", shield: "SHIELD" };
/** LevelItemProps defaults: baseHeat 5, maxHeat 2000 (star 1's props leave maxHeat at it). */
const DEFAULT_BASE_HEAT = 5, DEFAULT_MAX_HEAT = 2000;
export const MAX_LEVEL = 10;
/** The heat amplifier doubles heat (wiki: Heat Amplifier). */
export const HEAT_AMPLIFIER = 2;

const SKIP = /\/Parts\/|\/Dev\/|\(Dev\)|\bTEST\b|\/Test\/|PvP|\(Test\)|Tutorial|Promo|\/Base\//;

/** Shop keepers: what each sells, by the shop actor's config name. */
export interface Keeper {
  title: string; categories: Category[]; minRarity: number; maxRarity: number; rotate?: number;
  /** The Supply Depot: also sells the energy goods (depotGoods). */
  depot?: boolean;
  /** A Haven Stranger with the wiki's stock list (src/game/vendors.ts). */
  vendor?: string;
  /** Basil in a mission lobby: the mission's recipes (by output) and his supplies (src/game/vendors.ts). */
  lobby?: { recipes: Set<string>; supplies: Set<string> };
  /** Basil at a terminal: a random six to twenty-five, at least one of the top star. */
  terminal?: boolean;
}

/** One thing a keeper sells, and its price in crowns (or energy, for the Supply Depot's goods). */
export interface StockEntry { name: string; price: number; rarity: number; category: Category; currency?: "energy"; /** How many come for the price (the depot's packs). */ pack?: number }

export class Economy {
  private infos = new Map<string, ItemInfo | null>();
  private recipeList: Recipe[] | null = null;
  private byOutput = new Map<string, Recipe>();
  private autoCache = new Map<string, ItemInfo[]>();

  constructor(private readonly libs: Libs) {}

  private resolve(file: string, name: string, field: string): any | null {
    return resolveRef(this.libs(file), { name }, field);
  }

  // ---------------------------------------------------------------- items

  /** An item's category, star rating, props and tags. */
  info(name: string): ItemInfo | null {
    if (this.infos.has(name)) return this.infos.get(name)!;
    const impl = this.resolve("config/item.dat", name, "item");
    let out: ItemInfo | null = null;
    if (impl) {
      const k = kind(impl);
      const category: Category = k === "Sword" ? "sword" : k === "Handgun" || k === "SwingingHandgun" ? "handgun"
        : k === "Bomb" || k === "BlastNetworkBomb" ? "bomb" : k === "Shield" ? "shield" : k === "Armor" ? "armor"
        : k === "Helm" ? "helm" : k === "Trinket" ? "trinket" : k === "Capsule" || k === "Vial" ? "pickup"
        : k === "Craft" ? "material" : k === "Mineral" ? "mineral" : k === "MetaMineral" ? "deposit"
        : k === "RecipeDerived" ? "recipe" : k === "Dungeon" && /Vitapod/.test(name) ? "vitapod" : "other";
      let rarity = Number(impl.rarity ?? 0);
      if (category === "recipe") rarity = this.recipe(impl.recipe?.name ?? "")?.rarity ?? rarity;
      const prop = impl.itemProp?.name ? this.resolve("config/item_property.dat", impl.itemProp.name, "itemProps") : null;
      const list: any[] = prop?.itemProps ?? [];
      const props = list.length ? list[Math.max(0, Math.min(list.length - 1, rarity))] : null;
      const tags: string[] = ((impl.tags?.tags ?? []) as any[]).filter(t => typeof t === "string");
      const auto = impl.autoSpawnType ? enumName(impl.autoSpawnType) : null;
      out = { name, label: itemName(name), category, rarity, icon: impl.icon ?? null, props, tags, autoSpawn: auto,
        heatable: ["sword", "handgun", "bomb", "shield", "armor", "helm"].includes(category) && !!props?.levelTable };
    }
    this.infos.set(name, out);
    return out;
  }

  /** The crowns a shop asks for an item (its ItemProps buyPrice), or 0 when it is not sold for crowns. */
  price(name: string): number {
    return Math.max(0, Math.round(this.info(name)?.props?.buyPrice ?? 0));
  }

  /** The energy the Supply Depot asks for an item (ItemProps depotCost), or 0. */
  depotCost(name: string): number {
    return Math.max(0, Math.round(this.info(name)?.props?.depotCost ?? 0));
  }

  /**
   * The Supply Depot's energy goods the install prices (item_property.dat depotCost): the heat
   * amplifier for two, seven and thirty days, Sparks of Life by ten, and the orbs of alchemy
   * by three (the wiki's pack sizes). The depot's other goods (slots, renames, keys, sprite
   * eggs) have no use here.
   */
  depotGoods(): DepotGood[] {
    const out: DepotGood[] = [];
    const add = (name: string, count: number, kind: DepotGood["kind"]) => {
      const energy = this.depotCost(name);
      if (energy > 0 && this.info(name)) out.push({ name, energy, count, kind });
    };
    for (const n of ["Upgrade/Heat Bonus", "Upgrade/Heat Bonus (7 days)", "Upgrade/Heat Bonus (30 days)"]) add(n, 1, "heat");
    add("Rarity/Spark of Life", 10, "spark");
    for (let r = 1; r <= 5; r++) add(orbFor(r), ORBS_PER_CRAFT, "orb");
    // the fire crystals the depot prices in energy (Warm to Radiant), by fifty
    for (let r = 2; r <= 5; r++) add(crystalFor(r), CRYSTAL_PACK, "crystal");
    return out;
  }

  /** Days a heat amplifier item runs (ItemConfig$Upgrade days), 0 for other items. */
  amplifierDays(name: string): number {
    const impl = this.resolve("config/item.dat", name, "item");
    return impl?.heatBonus ? Math.max(0, Number(impl.days ?? 0)) : 0;
  }

  /**
   * Buys a depot good with energy: a heat amplifier adds its days (from now, or from the
   * end of the one running), sparks and orbs join the knight's stock. False when the energy
   * does not cover it.
   */
  buyDepot(w: Wallet, good: DepotGood, now = Date.now()): boolean {
    if (!w.energy || !spendEnergy(w.energy, good.energy, now)) return false;
    if (good.kind === "heat") w.heatAmplifier = Math.max(now, w.heatAmplifier ?? 0) + this.amplifierDays(good.name) * 86400_000;
    else if (good.kind === "spark") w.sparks = (w.sparks ?? 3) + good.count;
    else w.materials[good.name] = (w.materials[good.name] ?? 0) + good.count;
    return true;
  }

  /** The crowns an item sells back for (ItemProps sellPrice). */
  sellPrice(name: string): number {
    return Math.max(0, Math.round(this.info(name)?.props?.sellPrice ?? 0));
  }

  // ---------------------------------------------------------------- shops

  /** What a shop keeper sells, from its actor config name (Shop/Haven/Swords and so on). */
  keeper(keeper: string, opts: { tier?: number; maxRarity?: number; mission?: string | null } = {}): Keeper {
    const k = keeper.toLowerCase(), max = opts.maxRarity ?? 5, tier = opts.tier ?? 0;
    const tierMax = tier === 1 ? 2 : tier === 2 ? 3 : tier === 3 ? 5 : max;
    const tierMin = tier === 3 ? 4 : tier === 2 ? 3 : 1;
    // Basil, the traveller in Clockwork Terminals, sells recipes for the tier's gear
    // Basil in a mission lobby: the mission's recipes and his supplies (capsules, vials, a vitapod)
    if (isLobbyBasil(keeper)) return { title: "Basil", categories: ["recipe", "pickup", "vitapod"], minRarity: 0, maxRarity: 5, lobby: lobbyStock(opts.mission) };
    if (/traveler|basil/.test(k)) {
      const [lo, hi] = tier ? terminalStars(tier) : [tierMin, Math.min(5, tierMax)];
      return { title: "Basil", categories: ["recipe"], minRarity: lo, maxRarity: hi, rotate: 12, terminal: !!tier };
    }
    if (/supply depot|general goods|quartermaster/.test(k)) return { title: /supply/.test(k) ? "Supply Depot" : last(keeper), categories: ["pickup"], minRarity: 0, maxRarity: tier ? tierMax : 5,
      depot: /supply depot|quartermaster/.test(k) };
    // Haven's Strangers: the wiki's stock lists (src/game/vendors.ts)
    const vendor = vendorKey(keeper) ?? undefined;
    if (vendor === "recipes") return { title: "Recipes", categories: ["recipe"], minRarity: 1, maxRarity: 5, vendor };
    if (vendor === "swords") return { title: "Swords", categories: ["sword"], minRarity: 0, maxRarity: 5, vendor };
    if (vendor === "guns") return { title: "Guns and Bombs", categories: ["handgun", "bomb"], minRarity: 0, maxRarity: 5, vendor };
    if (vendor === "armor") return { title: "Armour and Helmets", categories: ["armor", "helm"], minRarity: 0, maxRarity: 5, vendor };
    if (vendor === "shields") return { title: "Shields and Trinkets", categories: ["shield", "trinket", "vitapod"], minRarity: 0, maxRarity: max, vendor };
    if (/recipe/.test(k)) return { title: "Recipes", categories: ["recipe"], minRarity: 1, maxRarity: max };
    if (/sword/.test(k)) return { title: "Swords", categories: ["sword"], minRarity: 1, maxRarity: max };
    if (/gun|bomb/.test(k)) return { title: "Guns and Bombs", categories: ["handgun", "bomb"], minRarity: 1, maxRarity: max };
    if (/armor|helm/.test(k)) return { title: "Armour and Helmets", categories: ["armor", "helm"], minRarity: 1, maxRarity: max };
    if (/shield|trinket/.test(k)) return { title: "Shields and Trinkets", categories: ["shield", "trinket", "vitapod"], minRarity: 1, maxRarity: max };
    return { title: last(keeper), categories: ["sword", "handgun", "bomb", "shield", "armor", "helm", "trinket"], minRarity: 1, maxRarity: tier ? tierMax : max };
  }

  /**
   * A keeper's stock with prices. Rotating keepers (Basil) pick `rotate` items with a seed
   * (one per terminal visit in the game: its catalogCycle INSTANCE).
   */
  catalogue(keeper: string | Keeper, opts: { tier?: number; maxRarity?: number; seed?: number; player?: string; now?: number } = {}): StockEntry[] {
    const kp = typeof keeper === "string" ? this.keeper(keeper, opts) : keeper;
    const out: StockEntry[] = [];
    // a Haven Stranger's day: its wiki list, the random part drawn for this player and day
    const listed = kp.vendor && VENDORS[kp.vendor]
      ? new Set(vendorNames(VENDORS[kp.vendor], seeded(vendorSeed(vendorDay(opts.now), opts.player ?? ""))).map(n => n.toLowerCase())) : null;
    const listedCats = new Set<Category>(kp.vendor === "shields" ? ["shield"] : kp.categories);
    for (const name of this.libs("config/item.dat").keys()) {
      if (SKIP.test(name) || !/^(Weapon|Gear|Recipe|Pickup)\//.test(name)) continue;
      const it = this.info(name);
      if (!it || !kp.categories.includes(it.category) || it.rarity < kp.minRarity || it.rarity > kp.maxRarity) continue;
      const price = this.price(name);
      if (price <= 0 || !it.icon) continue;
      const recipe = it.category === "recipe" ? this.recipeOfItem(name) : null;
      if (it.category === "recipe" && !recipe) continue;
      if (kp.lobby) {
        if (!(recipe ? kp.lobby.recipes : kp.lobby.supplies).has(vendorMatch(recipe ? recipe.output : name))) continue;
      } else if (it.category === "pickup" && !this.supplies().has(name)) continue;
      if (listed && listedCats.has(it.category)) {
        if (!listed.has(vendorMatch(recipe ? recipe.output : name))) continue;
      } else if (listed && it.rarity < 1) continue;
      out.push({ name, price, rarity: it.rarity, category: it.category });
    }
    out.sort((a, b) => a.category.localeCompare(b.category) || a.rarity - b.rarity || a.name.localeCompare(b.name));
    if (kp.depot) for (const g of this.depotGoods()) out.push({ name: g.name, price: g.energy, rarity: Math.max(0, this.info(g.name)?.rarity ?? 0), category: "other", currency: "energy", pack: g.count });
    const rotate = kp.terminal ? terminalCount(seeded((opts.seed ?? Math.floor(Date.now() / 86400000)) ^ 0x2545f491)) : kp.rotate;
    if (rotate && out.length > rotate) {
      const rand = seeded(opts.seed ?? Math.floor(Date.now() / 86400000));
      const pool = [...out];
      const pick: typeof out = [];
      // a terminal's list holds at least one recipe of its top star (the wiki)
      const top = kp.terminal ? pool.filter(e => e.rarity === kp.maxRarity) : [];
      if (top.length) { const t = top[Math.floor(rand() * top.length)]; pick.push(t); pool.splice(pool.indexOf(t), 1); }
      while (pick.length < rotate && pool.length) pick.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
      return pick.sort((a, b) => a.rarity - b.rarity || a.name.localeCompare(b.name));
    }
    return out;
  }

  private supplySet: Set<string> | null = null;
  /**
   * The capsules and vials the Clockworks hands out: every pickup item the treasure and
   * health spawn tables name (health capsules, remedies, vials, barriers), plus the remedy
   * capsule. Event and premium capsules (turret kits, beacons) are not stocked.
   */
  supplies(): Set<string> {
    if (this.supplySet) return this.supplySet;
    const out = new Set<string>(["Pickup/Capsule/Remedy Capsule"]);
    const walk = (o: any, d: number) => {
      if (!o || typeof o !== "object" || d > 30) return;
      if (typeof o.name === "string" && /^Pickup\/(Capsule|Vial)\//.test(o.name) && !SKIP.test(o.name)) out.add(o.name);
      if (o.$map) { for (const [, v] of o.entries ?? []) walk(v, d + 1); return; }
      for (const k of Object.keys(o)) if (k !== "$outer") walk(o[k], d + 1);
    };
    for (const [n, cfg] of this.libs("config/spawn_table.dat")) if (/^Treasure\/(Pickups|Health)\//.test(n)) walk(cfg, 0);
    return this.supplySet = out;
  }

  /**
   * Buys an item: gear joins the arsenal (with no variants: shop stock has none), recipes are
   * learned, pickups go to the pocket. Returns false when it cannot be afforded or held.
   */
  buy(w: Wallet, name: string, cost = this.price(name)): boolean {
    const it = this.info(name);
    if (!it || cost <= 0 || w.crowns < cost) return false;
    if (it.category === "recipe") {
      const r = this.recipeOfItem(name);
      if (!r || w.recipes.includes(r.name)) return false;
      w.recipes.push(r.name);
    } else if (it.category === "pickup") {
      const slot = w.pocket.find(p => p[0] === name);
      if (slot) slot[1]++;
      else if (w.pocket.length < 4) w.pocket.push([name, 1]);
      else return false;
    } else {
      if (w.owned.includes(name)) return false;
      this.grant(w, name, []);
    }
    w.crowns -= cost;
    return true;
  }

  /** Adds an item to the arsenal with the given variants. */
  grant(w: Wallet, name: string, variants: string[] = []) {
    if (!w.owned.includes(name)) w.owned.push(name);
    w.gear[name] = { heat: 0, level: 1, variants };
  }

  /** Whether an item can be sold: owned, not equipped, and worth something. */
  canSell(w: Wallet, name: string): boolean {
    const l = w.loadout;
    const equipped = l.weapons.includes(name) || l.trinkets.includes(name) || [l.shield, l.armor, l.helmet, l.vitapod].includes(name);
    return w.owned.includes(name) && !equipped && this.sellPrice(name) > 0;
  }

  /** Sells an owned item (or `count` of a material) back for crowns. Returns the crowns paid. */
  sell(w: Wallet, name: string, count = 1): number {
    if ((w.materials[name] ?? 0) > 0) {
      const n = Math.min(count, w.materials[name]);
      const paid = n * this.sellPrice(name);
      w.materials[name] -= n;
      if (w.materials[name] <= 0) delete w.materials[name];
      w.crowns += paid;
      return paid;
    }
    if (!this.canSell(w, name)) return 0;
    const paid = this.sellPrice(name);
    w.owned = w.owned.filter(o => o !== name);
    delete w.gear[name];
    w.crowns += paid;
    return paid;
  }

  // ---------------------------------------------------------------- heat and levels

  /**
   * Total heat needed to reach each level, index 0 = level 1 (always 0) to index 9 = level 10.
   * The ItemProps give the first step (baseHeat) and maxHeat; each level costs a fixed step
   * more than the one before (the client's LevelItem heat series).
   */
  heatTable(name: string): number[] {
    const p = this.info(name)?.props;
    return heatCurve(p?.baseHeat ?? DEFAULT_BASE_HEAT, p?.maxHeat ?? DEFAULT_MAX_HEAT);
  }

  /** The level an amount of heat reaches. */
  levelFor(name: string, heat: number): number {
    const t = this.heatTable(name);
    let lv = 1;
    while (lv < MAX_LEVEL && heat >= t[lv]) lv++;
    return lv;
  }

  /** An owned item's level (1 for unowned or unheated items). */
  level(w: Wallet, name: string): number {
    return w.gear[name]?.level ?? (w.owned.includes(name) ? 1 : 0);
  }

  /** The heat a run's raw heat gives, with the heat amplifier. */
  heatGain(w: Wallet, raw: number, now = Date.now()): number {
    return Math.round(raw * ((w.heatAmplifier ?? 0) > now ? HEAT_AMPLIFIER : 1));
  }

  /**
   * The heat an item can hold at its level: the next level's threshold. A full bar waits for
   * the forge (LevelItem: heat progress stops at 1; the level rises only by forging).
   */
  heatCap(name: string, level: number): number {
    return this.heatTable(name)[Math.max(0, Math.min(MAX_LEVEL - 1, level))];
  }

  /** LevelItem.N: an owned item whose heat bar is full below the top level, ready for the forge. */
  forgeReady(w: Wallet, name: string): boolean {
    const s = w.gear[name];
    return !!s && w.owned.includes(name) && !!this.info(name)?.heatable && s.level < MAX_LEVEL && s.heat >= this.heatCap(name, s.level);
  }

  /** Every owned item ready for the forge (the forge window's list, the HUD button's notice). */
  forgeable(w: Wallet): string[] {
    return w.owned.filter(n => this.forgeReady(w, n));
  }

  /** Equipped items that take heat: weapons, shield, armour and helmet below level 10 whose bar is not full. */
  heatedItems(w: Wallet): string[] {
    const l = w.loadout;
    return [...new Set([...l.weapons, l.shield, l.armor, l.helmet].filter(n => n && w.owned.includes(n) && this.info(n)?.heatable
      && this.level(w, n) < MAX_LEVEL && !this.forgeReady(w, n)))];
  }

  /**
   * Banks a floor's heat: the total is shared evenly between the equipped items that can
   * still take heat (the client's end-of-level report), each filling its bar no further than
   * its next level (with its Heat Bonus). Items do not level here: the ones whose bar filled
   * are returned, ready for the forge at the level they hold.
   */
  addHeat(w: Wallet, raw: number, now = Date.now()): { name: string; level: number }[] {
    const items = this.heatedItems(w);
    const heat = items.length ? this.heatGain(w, raw, now) / items.length : 0;
    const ready: { name: string; level: number }[] = [];
    if (heat <= 0) return ready;
    for (const n of items) {
      const s = w.gear[n] ??= { heat: 0, level: 1, variants: [] };
      s.heat = this.heatAfter(n, s, heat);
      if (this.forgeReady(w, n)) ready.push({ name: n, level: s.level });
    }
    return ready;
  }

  /** An item's heat after gaining `heat` (its Heat Bonus applied), held at its level's full bar. */
  heatAfter(name: string, s: GearState, heat: number): number {
    return Math.min(this.heatCap(name, s.level), s.heat + heat * (1 + (s.heatBonus ?? 0)));
  }

  // ---------------------------------------------------------------- the forge

  /** The forge's step for an item at a level (its star's ForgePropertyConfig), or null at the top level. */
  forgeStep(name: string, level: number): ForgeStep | null {
    const ref = this.info(name)?.props?.forgeProperty;
    if (!ref?.name || level < 1 || level >= MAX_LEVEL) return null;
    const cfg = resolveRef(this.libs("config/forge_property.dat"), ref, "props");
    return forgeSteps(cfg)[level - 1] ?? null;
  }

  /** The fire crystals of an item's star the knight holds. */
  crystalsHeld(w: Wallet, name: string): number {
    return w.materials[crystalFor(this.info(name)?.rarity ?? 0)] ?? 0;
  }

  /**
   * The forge's buy panel: a stack of a tier's fire crystals, fifty for the depot's energy
   * (Warm to Radiant), else five for Vatel's crowns (Cracked and Dim).
   */
  crystalOffer(rarity: number): CrystalOffer | null {
    const name = crystalFor(rarity);
    if (!this.info(name)) return null;
    const energy = this.depotCost(name);
    if (energy > 0) return { name, count: CRYSTAL_PACK, energy, crowns: 0 };
    const crowns = this.price(name);
    return crowns > 0 ? { name, count: CROWN_CRYSTAL_PACK, energy: 0, crowns } : null;
  }

  /** Buys a crystal offer; false when the energy or crowns do not cover it. */
  buyCrystals(w: Wallet, offer: CrystalOffer, now = Date.now()): boolean {
    if (offer.energy > 0) { if (!w.energy || !spendEnergy(w.energy, offer.energy, now)) return false; }
    else if (w.crowns < offer.crowns) return false;
    else w.crowns -= offer.crowns;
    w.materials[offer.name] = (w.materials[offer.name] ?? 0) + offer.count;
    return true;
  }

  /**
   * Forges an item ready for it with `n` fire crystals (capped at the step's maximum): the
   * crystals are spent whatever happens; success raises the level (two with a skip) and the
   * heat bar starts empty there; failure keeps the heat. A Heat Bonus speeds the next level's
   * heat; a prize box opens into fire crystals of its tier. Null when the forging cannot be
   * made (not ready, too few crystals).
   */
  forge(w: Wallet, name: string, n: number, rand: () => number = Math.random): ForgeResult | null {
    const s = w.gear[name];
    if (!s || !this.forgeReady(w, name)) return null;
    const step = this.forgeStep(name, s.level);
    if (!step) return null;
    const crystal = crystalFor(this.info(name)?.rarity ?? 0);
    const spent = Math.min(n, step.crystals[2]);
    if (crystalBand(step, spent) < 0 || (w.materials[crystal] ?? 0) < spent) return null;
    w.materials[crystal] -= spent;
    if (w.materials[crystal] <= 0) delete w.materials[crystal];
    const outcome = rollForge(step, spent, rand);
    if (!outcome.success) return { ...outcome, spent, level: s.level, prize: null };
    s.level = forgedLevel(s.level, outcome, MAX_LEVEL);
    s.heat = this.heatTable(name)[s.level - 1];
    delete s.heatBonus;
    if (outcome.bonus?.kind === "heat") s.heatBonus = HEAT_BONUS;
    let prize: ForgeResult["prize"] = null;
    if (outcome.bonus?.kind === "prize") {
      const box = outcome.bonus.item ? this.info(outcome.bonus.item) : null;
      const tier = crystalFor(box && box.rarity >= 0 ? box.rarity : this.info(name)?.rarity ?? 0);
      prize = { name: tier, count: step.crystals[0] };
      w.materials[tier] = (w.materials[tier] ?? 0) + prize.count;
    }
    return { ...outcome, spent, level: s.level, prize };
  }

  /** Progress toward the next level, 0 to 1 (1 at level 10). */
  heatProgress(w: Wallet, name: string): number {
    const s = w.gear[name];
    if (!s) return 0;
    if (s.level >= MAX_LEVEL) return 1;
    const t = this.heatTable(name);
    return Math.max(0, Math.min(1, (s.heat - t[s.level - 1]) / Math.max(1, t[s.level] - t[s.level - 1])));
  }

  /** The level table entries for an item at a level (1-10), with arguments applied. */
  levelConfigs(name: string, level: number): any[] {
    const ref = this.info(name)?.props?.levelTable;
    const out: any[] = [];
    const walk = (r: any, depth: number) => {
      if (!r?.name || depth > 8) return;
      const t = resolveRef(this.libs("config/level_table.dat"), r, "levels");
      if (!t) return;
      if (kind(t) === "Compound") for (const x of t.tables ?? []) walk(x?.table, depth + 1);
      else if (t.levels) { const c = t.levels[Math.max(0, Math.min(t.levels.length - 1, level - 1))]; if (c) out.push(c); }
    };
    walk(ref, 0);
    return out;
  }

  /**
   * The bonuses an item's level gives at a depth: weapons gain damage and charge time
   * reduction, armour, helmets and shields defence and (most armour) health. Bonuses with a
   * start or minimum depth apply from that depth (the tier their stars belong to) down.
   */
  levelStats(name: string, level: number, depth: number): LevelStats {
    const st: LevelStats = { damage: 0, uncapped: 0, charge: 0, defense: 0, health: 0 };
    const add = (c: any, d: number) => {
      if (!c || d > 6) return;
      switch (kind(c)) {
        case "Compound": for (const x of c.levels ?? []) add(x, d + 1); break;
        case "RelativeDamageBonus":
          if (depth >= (c.startDepth ?? 0)) {
            const v = itemValue("DAMAGE", c.bonus, c.positive, c.damage ?? 0);
            if (c.capped === false) st.uncapped += v; else st.damage += v;
          }
          break;
        case "ChargeTimeReduction": st.charge += itemValue("CHARGE", c.bonus, c.positive, c.reduction ?? 0); break;
        case "DefenseIncrease": st.defense += c.defense ?? 0; break;
        case "HealthBonus": if (depth >= (c.minDepth ?? 0)) st.health += itemValue("HEALTH", c.bonus, c.positive, c.health ?? 40); break;
      }
    };
    for (const c of this.levelConfigs(name, level)) add(c, 0);
    return st;
  }

  // ---------------------------------------------------------------- unique variants

  /** A variant's effect and display label. */
  variant(name: string): VariantEffect | null {
    const v = this.resolve("config/variant.dat", name, "variant");
    if (!v) return null;
    const label = last(name).replace(/\s+\d+$/, "");
    const k = kind(v);
    const bonus = enumName(v.bonus ?? v.statusResist, "LOW");
    const grade = Number(/\s(\d)$/.exec(name)?.[1] ?? 0) || BONUS_GRADE[bonus] || 1;
    const e: VariantEffect = { label, grade };
    switch (k) {
      case "StatusResist": {
        const named = RESIST[enumName(v.statusResist, "CUSTOM")];
        e.resist = named !== undefined ? { mask: v.conditionMask ?? 0, points: named, scaled: true } : { mask: v.conditionMask ?? 0, points: v.resist ?? 0 };
        break;
      }
      case "DefenseTypeBonus": e.defense = { type: enumName(v.type, "NORMAL"), depthScale: v.depthScale ?? null, amount: v.amount ?? 5 * grade }; break;
      // VariantConfig: weapon variants take ItemValueKey steps (CUSTOM: their own amount)
      case "TaggedDamage": e.tagged = { tag: v.tag ?? "", damage: itemValue("DAMAGE", v.bonus, v.positive, v.damage ?? 0) }; break;
      case "AttackSpeedChange": e.attackSpeed = itemValue("SPEED", v.bonus, v.positive, v.speed ?? 0); break;
      case "ChargeTimeReduction": e.charge = itemValue("CHARGE", v.bonus, v.positive, v.reduction ?? 0); break;
      case "HealthBonus": e.health = v.health ?? 40; break;
      case "SpeedChange": e.speed = itemValue("SPEED", v.bonus, v.positive, v.speed ?? 0); break;
      case "WeaponClass": {
        // a LevelConfig for one weapon class (ChargeTimeReduction by default)
        e.weaponClass = enumName(v.weaponClass, "SWORD");
        const b = v.bonus ?? { $class: "LevelConfig$ChargeTimeReduction" }, bk = kind(b);
        if (bk === "ChargeTimeReduction") e.charge = itemValue("CHARGE", b.bonus, b.positive, b.reduction ?? 0);
        else if (bk === "RelativeDamageBonus") e.damage = itemValue("DAMAGE", b.bonus, b.positive, b.damage ?? 0);
        else if (bk === "AttackSpeedChange") e.attackSpeed = itemValue("SPEED", b.bonus, b.positive, b.speed ?? 0);
        break;
      }
      default: return null;
    }
    return e;
  }

  /** "Beast Damage: Medium": the variant's line in the item bundle, else ours. */
  variantLabel(name: string): string {
    const v = this.variant(name);
    const ours = v ? `${v.label}: ${GRADES[Math.min(4, v.grade)]}` : last(name);
    return v ? variantText(this.resolve("config/variant.dat", name, "variant"), ours) : ours;
  }

  /** An item's name with its variants, as the arsenal and tooltips show it. */
  displayName(name: string, state?: GearState | null): string {
    const base = this.info(name)?.label ?? last(name);
    const vs = state?.variants ?? [];
    return vs.length ? `${base} (${vs.map(v => this.variantLabel(v)).join(", ")})` : base;
  }

  /**
   * Rolls unique variants from a variant table (a recipe's, or the item kind's general
   * table). Selection entries pick how many variants by their weights (most items get none),
   * then distinct bonus kinds, then a grade from each kind's weighted table.
   */
  rollVariants(name: string, table?: any, rand: () => number = Math.random): string[] {
    const it = this.info(name);
    if (!it) return [];
    const ref = table ?? this.recipeFor(name)?.variantTable ?? (GROUP[it.category] ? { name: `Item/${generalTable(it.category)}, general` } : null);
    if (!ref?.name) return [];
    const group = GROUP[it.category] ?? "SWORD";
    const out: string[] = [];
    this.variantTable(ref, group, rand, out, 0);
    return [...new Set(out)];
  }

  private variantTable(ref: any, group: string, rand: () => number, out: string[], depth: number) {
    if (depth > 12) return;
    const t = resolveRef(this.libs("config/variant_table.dat"), ref, "root");
    if (!t) return;
    const res: string[] = [];
    this.variantEntry(t.root, group, rand, res, depth + 1);
    const max = t.maxResults ?? Infinity;
    out.push(...res.slice(0, max));
  }

  private variantEntry(e: any, group: string, rand: () => number, out: string[], depth: number) {
    if (!e || depth > 16) return;
    const sub = (x: any) => this.variantEntry(x, group, rand, out, depth + 1);
    switch (kind(e)) {
      case "VariantEntry": if (e.variant?.name) out.push(e.variant.name); break;
      case "TableEntry": this.variantTable(e.variantTable, group, rand, out, depth + 1); break;
      case "WeightedEntry": sub(e.entry); break;
      case "CompoundEntry": for (const x of e.entries ?? []) sub(x); break;
      case "GroupEntry": if (enumName(e.group, "SWORD") === group) sub(e.entry); break;
      case "RandomEntry": { const w = pickWeighted<any>(e.entries ?? [], x => x?.weight ?? 1, rand); if (w) sub(w); break; }
      case "RandomSelectionEntry": case "SelectionEntry": {
        let n = e.selections ?? 1;
        if (kind(e) === "RandomSelectionEntry") {
          const ws: number[] = Array.from(e.selectionWeights ?? [1]);
          n = pickIndex(ws, rand);
        }
        const pool = [...(e.entries ?? [])];
        for (let i = 0; i < n && pool.length; i++) {
          const w = pickWeighted(pool, x => x?.weight ?? 1, rand);
          if (!w) break;
          pool.splice(pool.indexOf(w), 1);
          sub(w);
        }
        break;
      }
    }
  }

  /** Effects of every variant on the knight's worn items. */
  variantEffects(variants: string[]): VariantEffect[] {
    return variants.map(v => this.variant(v)).filter((v): v is VariantEffect => !!v);
  }

  // ---------------------------------------------------------------- crafting

  /** Every recipe that makes a gear item, with its costs. */
  recipes(): Recipe[] {
    if (this.recipeList) return this.recipeList;
    const lib = this.libs("config/recipe.dat");
    const itemOf = new Map<string, string>();
    for (const n of this.libs("config/item.dat").keys()) {
      if (!/^Recipe\//.test(n) || /\/Base\//.test(n)) continue;
      const impl = this.resolve("config/item.dat", n, "item");
      if (impl?.recipe?.name) itemOf.set(impl.recipe.name, n);
    }
    const list: Recipe[] = [];
    for (const name of lib.keys()) {
      const r = resolveRef(lib, { name }, "recipe");
      const output = r?.item?.name;
      if (!output || SKIP.test(output)) continue;
      const out = this.resolve("config/item.dat", output, "item");
      if (!out) continue;
      const rarity = Number(out.rarity ?? 0);
      const materials: [string, number][] = [];
      let base: string | null = null, baseLevel = 0;
      for (const ing of r.ingredients ?? []) {
        const k = kind(ing);
        if ((k === "LevelItem" || k === "ChoiceLevelItem") && ing.item?.name) { base = ing.item.name; baseLevel = ing.level ?? 1; }
        else if (ing?.item?.name) materials.push([ing.item.name, ing.count ?? 1]);
      }
      const prop = r.recipeProp?.name ? this.resolve("config/recipe_property.dat", r.recipeProp.name, "recipeProps") : null;
      const props: any[] = prop?.recipeProps ?? [];
      const crowns = props.length ? props[Math.max(0, Math.min(props.length - 1, rarity))]?.crowns ?? 0 : 0;
      const orbs: [string, number] | null = rarity >= 1 ? [orbFor(rarity), ORBS_PER_CRAFT] : null;
      list.push({ name, item: itemOf.get(name) ?? null, output, rarity, materials, base, baseLevel, crowns, orbs, variantTable: r.variantTable ?? null });
    }
    list.sort((a, b) => a.rarity - b.rarity || a.output.localeCompare(b.output));
    for (const r of list) if (!this.byOutput.has(r.output)) this.byOutput.set(r.output, r);
    return this.recipeList = list;
  }

  recipe(name: string): Recipe | null { return this.recipes().find(r => r.name === name) ?? null; }
  /** The recipe that makes an item. */
  recipeFor(output: string): Recipe | null { this.recipes(); return this.byOutput.get(output) ?? null; }
  /** The recipe a recipe item teaches. */
  recipeOfItem(item: string): Recipe | null { return this.recipes().find(r => r.item === item) ?? null; }
  /** Recipes that upgrade an item (its next star in the tree). */
  upgradesFrom(base: string): Recipe[] { return this.recipes().filter(r => r.base === base); }
  /** An item's upgrade line from its first recipe up: the 2 -> 3 -> 4 -> 5 star tree. */
  lineage(name: string): string[] {
    const line = [name];
    for (let r = this.recipeFor(name); r?.base && line.length < 8; r = this.recipeFor(r.base)) line.unshift(r.base);
    return line;
  }

  /** What a craft still needs; empty when it can be made. */
  missing(w: Wallet, r: Recipe): string[] {
    const need: string[] = [];
    if (!w.recipes.includes(r.name)) need.push(`recipe (${r.item ? this.price(r.item) : "?"} cr)`);
    if (w.owned.includes(r.output)) need.push("already owned");
    if (r.base && !w.owned.includes(r.base)) need.push(`${last(r.base)}`);
    else if (r.base && this.level(w, r.base) < r.baseLevel) need.push(`${last(r.base)} at level ${r.baseLevel}`);
    for (const [m, n] of r.materials) if ((w.materials[m] ?? 0) < n) need.push(`${last(m)} ${w.materials[m] ?? 0}/${n}`);
    if (w.crowns < r.crowns) need.push(`${r.crowns} crowns`);
    const orbEnergy = this.orbEnergy(w, r);
    if (orbEnergy > 0 && (!w.energy || energyNow(w.energy) < orbEnergy)) need.push(`${r.orbs![1]} ${itemName(r.orbs![0])} or ${orbEnergy} energy`);
    return need;
  }

  /**
   * The energy a craft spends on orbs of alchemy: none when the knight holds the three it
   * takes, else the Supply Depot's price for a pack of three (the game sold them so; before
   * 2013-07-30 crafting asked for energy outright).
   */
  orbEnergy(w: Wallet, r: Recipe): number {
    if (!r.orbs || (w.materials[r.orbs[0]] ?? 0) >= r.orbs[1]) return 0;
    return this.depotCost(r.orbs[0]);
  }

  canCraft(w: Wallet, r: Recipe): boolean { return this.missing(w, r).length === 0; }

  /**
   * Crafts: spends crowns, materials and the base item; the new item starts at level 1 with
   * variants rolled from the recipe's table and takes the base item's place in the loadout.
   */
  craft(w: Wallet, r: Recipe, rand: () => number = Math.random): GearState | null {
    if (!this.canCraft(w, r)) return null;
    // three orbs of the recipe's star: the knight's own, else a pack bought for energy
    const orbEnergy = this.orbEnergy(w, r);
    if (orbEnergy > 0 && !spendEnergy(w.energy!, orbEnergy)) return null;
    if (r.orbs && orbEnergy === 0) { w.materials[r.orbs[0]] -= r.orbs[1]; if (w.materials[r.orbs[0]] <= 0) delete w.materials[r.orbs[0]]; }
    w.crowns -= r.crowns;
    for (const [m, n] of r.materials) { w.materials[m] -= n; if (w.materials[m] <= 0) delete w.materials[m]; }
    if (r.base) {
      w.owned = w.owned.filter(o => o !== r.base);
      delete w.gear[r.base];
      const l = w.loadout;
      l.weapons = l.weapons.map(x => (x === r.base ? r.output : x));
      for (const slot of ["shield", "armor", "helmet", "vitapod"] as const) if (l[slot] === r.base) l[slot] = r.output;
      l.trinkets = l.trinkets.map(x => (x === r.base ? r.output : x));
    }
    this.grant(w, r.output, this.rollVariants(r.output, r.variantTable, rand));
    return w.gear[r.output];
  }

  // ---------------------------------------------------------------- drops

  /**
   * ItemDepthWeightConfig: the weight of a star rating at a depth. A rating starts at its
   * startDepth, ramps up to its full weight at idealDepth, and keeps it below that.
   */
  depthWeight(table: string, rarity: number, depth: number): number {
    const cfg = this.resolve("config/item_depth_weight.dat", table, "depthWeights");
    const w = (cfg?.depthWeights ?? [])[rarity];
    if (!w) return 0;
    const weight = w.weight ?? 0, start = w.startDepth ?? 0, ideal = Math.max(start, w.idealDepth ?? 0);
    if (depth < start) return 0;
    if (depth >= ideal) return weight;
    return weight * (depth - start + 1) / (ideal - start + 1);
  }

  /** Items that drop as AutoSpawnType loot (GEAR, MATERIAL, TOKEN). */
  autoItems(type: string): ItemInfo[] {
    let list = this.autoCache.get(type);
    if (list) return list;
    list = [];
    for (const n of this.libs("config/item.dat").keys()) {
      if (SKIP.test(n)) continue;
      const it = this.info(n);
      if (it?.autoSpawn === type) list.push(it);
    }
    this.autoCache.set(type, list);
    return list;
  }

  /**
   * An AutoItem drop (SpawnTableConfig$AutoItem): an item of the table's type, weighted by its
   * star rating's depth weight; materials must share a tag with the source (the dropping
   * monster's family). Null when nothing fits (the table's failsafe applies).
   */
  autoItem(type: string, depthWeight: string, ctx: { depth: number; tags?: string[] }, rand: () => number = Math.random): string | null {
    const tags = ctx.tags ?? [];
    const pool = this.autoItems(type).filter(it => !tags.length || !it.tags.length || it.tags.some(t => tags.includes(t)));
    const pick = pickWeighted(pool, it => this.depthWeight(depthWeight, it.rarity, ctx.depth), rand);
    return pick?.name ?? null;
  }

  /** Minerals a deposit is worth (MetaMineral mineralCount; 1, 2, 4 or 6) and their kind. */
  deposit(name: string): { mineral: string; count: number } | null {
    const impl = this.resolve("config/item.dat", name, "item");
    if (kind(impl) !== "MetaMineral" || !impl.mineral?.name) return null;
    return { mineral: impl.mineral.name, count: impl.mineralCount ?? 1 };
  }
}

const generalTable = (c: Category) => (c === "sword" ? "Sword" : c === "handgun" ? "Handgun" : c === "bomb" ? "Bomb" : c === "helm" ? "Helm" : c === "shield" ? "Shield" : "Armor");

/** Cumulative heat thresholds for levels 1-10: first step `base`, steps growing to `total`. */
/**
 * Total heat to reach each level (index 0 = level 1, always 0), as the client's LevelItem
 * computes it: level i+1 to i+2 costs base + i * step, with step = (2 * max / n - 2 * base) /
 * (n - 1) for n levels, and thresholds truncated to whole heat. The series as the client runs
 * it reaches level n at base + (n - 2) / n * max, short of maxHeat (its editor's own table,
 * which sums to maxHeat exactly, uses n - 1 in the step).
 */
export function heatCurve(base: number, max: number, levels = MAX_LEVEL): number[] {
  const step = levels > 1 ? (2 * max / levels - 2 * base) / (levels - 1) : 0;
  const sum = (l: number) => ((l + 1) * (2 * base + l * step)) / 2;
  const out = [0];
  for (let i = 0; i < levels - 1; i++) out.push(Math.trunc(sum(i)));
  return out;
}

function pickIndex(weights: number[], rand: () => number): number {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  let x = rand() * total;
  for (let i = 0; i < weights.length; i++) { x -= Math.max(0, weights[i]); if (x < 0) return i; }
  return Math.max(0, weights.length - 1);
}

export function pickWeighted<T>(list: T[], weight: (x: T) => number, rand: () => number): T | null {
  const ws = list.map(x => Math.max(0, weight(x)));
  const total = ws.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let x = rand() * total;
  for (let i = 0; i < list.length; i++) { x -= ws[i]; if (x < 0) return list[i]; }
  return list[list.length - 1];
}

/** A small seeded generator (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Variant defence amounts are depth scales of the item they sit on (Variant Base is 10% of armour). */
export type DepthEval = (ref: any, ctx: DepthContext) => number;
