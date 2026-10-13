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
// server data (config/catalog.dat ships empty), so the catalogues below are every item of a
// keeper's kind within the star range its place allows.

import { resolveRef } from "./logic";
import type { DepthContext } from "./depth";

const kind = (o: any) => { const c: string = o?.$class ?? ""; return c.substring(c.lastIndexOf("$") + 1); };
const enumName = (v: any, d = "") => String(v?.name ?? v ?? d).split(".").pop()!;
const last = (n: string) => n.split("/").pop() ?? n;

/** Config libraries by file name (preloaded). */
export type Libs = (file: string) => Map<string, any>;

export const ECONOMY_FILES = ["config/item.dat", "config/item_property.dat", "config/level_table.dat", "config/recipe.dat",
  "config/recipe_property.dat", "config/variant.dat", "config/variant_table.dat", "config/item_depth_weight.dat"];

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
export interface GearState { heat: number; level: number; variants: string[] }

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
}

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
  variantTable: any;
}

export interface LevelStats {
  /** Fraction added to the weapon's damage. */
  damage: number;
  /** Fraction taken off the weapon's charge time. */
  charge: number;
  /** Percent added to the item's defence. */
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
  resist?: { mask: number; points: number };
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
const RESIST = { LOW: 5, MEDIUM: 10, HIGH: 15, MAXIMUM: 25, VERY_HIGH: 25 } as Record<string, number>;
const TAGGED = { LOW: 0.05, MEDIUM: 0.1, HIGH: 0.15, VERY_HIGH: 0.25 } as Record<string, number>;
const ASI = { LOW: 0.02, MEDIUM: 0.03, HIGH: 0.05, VERY_HIGH: 0.08 } as Record<string, number>;
const CTR = { LOW: 0.05, MEDIUM: 0.1, HIGH: 0.15, VERY_HIGH: 0.2 } as Record<string, number>;
const DAMAGE = { LOW: 0.1, MEDIUM: 0.2, HIGH: 0.3, VERY_HIGH: 0.4 } as Record<string, number>;
const SPEED = { LOW: 0.05, MEDIUM: 0.1, HIGH: 0.15, VERY_HIGH: 0.2 } as Record<string, number>;
/** Item groups (ItemCodes Group) of variant tables' GroupEntry; SWORD is the default. */
const GROUP: Partial<Record<Category, string>> = { sword: "SWORD", handgun: "HANDGUN", bomb: "BOMB", helm: "HELM", armor: "ARMOR", shield: "SHIELD" };
/** Star 1's maxHeat is left at the class default; this sits between stars 0 and 2 (FLAG). */
const DEFAULT_MAX_HEAT = 2500;
export const MAX_LEVEL = 10;
/** The heat amplifier doubles heat (wiki: Heat Amplifier). */
export const HEAT_AMPLIFIER = 2;

const SKIP = /\/Parts\/|\/Dev\/|\(Dev\)|\bTEST\b|\/Test\/|PvP|\(Test\)|Tutorial|Promo|\/Base\//;

/** Shop keepers: what each sells, by the shop actor's config name. */
export interface Keeper { title: string; categories: Category[]; minRarity: number; maxRarity: number; rotate?: number }

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
      out = { name, label: last(name), category, rarity, icon: impl.icon ?? null, props, tags, autoSpawn: auto,
        heatable: ["sword", "handgun", "bomb", "shield", "armor", "helm"].includes(category) && !!props?.levelTable };
    }
    this.infos.set(name, out);
    return out;
  }

  /** The crowns a shop asks for an item (its ItemProps buyPrice), or 0 when it is not sold for crowns. */
  price(name: string): number {
    return Math.max(0, Math.round(this.info(name)?.props?.buyPrice ?? 0));
  }

  /** The crowns an item sells back for (ItemProps sellPrice). */
  sellPrice(name: string): number {
    return Math.max(0, Math.round(this.info(name)?.props?.sellPrice ?? 0));
  }

  // ---------------------------------------------------------------- shops

  /** What a shop keeper sells, from its actor config name (Shop/Haven/Swords and so on). */
  keeper(keeper: string, opts: { tier?: number; maxRarity?: number } = {}): Keeper {
    const k = keeper.toLowerCase(), max = opts.maxRarity ?? 5, tier = opts.tier ?? 0;
    const tierMax = tier === 1 ? 2 : tier === 2 ? 3 : tier === 3 ? 5 : max;
    const tierMin = tier === 3 ? 4 : tier === 2 ? 3 : 1;
    // Basil, the traveller in Clockwork Terminals, sells recipes for the tier's gear
    if (/traveler|basil/.test(k)) return { title: "Basil", categories: ["recipe"], minRarity: tierMin, maxRarity: Math.min(5, tierMax), rotate: 12 };
    if (/supply depot|general goods|quartermaster/.test(k)) return { title: /supply/.test(k) ? "Supply Depot" : last(keeper), categories: ["pickup"], minRarity: 0, maxRarity: tier ? tierMax : 5 };
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
  catalogue(keeper: string | Keeper, opts: { tier?: number; maxRarity?: number; seed?: number } = {}): { name: string; price: number; rarity: number; category: Category }[] {
    const kp = typeof keeper === "string" ? this.keeper(keeper, opts) : keeper;
    const out: { name: string; price: number; rarity: number; category: Category }[] = [];
    for (const name of this.libs("config/item.dat").keys()) {
      if (SKIP.test(name) || !/^(Weapon|Gear|Recipe|Pickup)\//.test(name)) continue;
      const it = this.info(name);
      if (!it || !kp.categories.includes(it.category) || it.rarity < kp.minRarity || it.rarity > kp.maxRarity) continue;
      const price = this.price(name);
      if (price <= 0 || !it.icon) continue;
      if (it.category === "recipe" && !this.recipeOfItem(name)) continue;
      out.push({ name, price, rarity: it.rarity, category: it.category });
    }
    out.sort((a, b) => a.category.localeCompare(b.category) || a.rarity - b.rarity || a.name.localeCompare(b.name));
    if (kp.rotate && out.length > kp.rotate) {
      const rand = seeded(opts.seed ?? Math.floor(Date.now() / 86400000));
      const pool = [...out];
      const pick: typeof out = [];
      while (pick.length < kp.rotate && pool.length) pick.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
      return pick.sort((a, b) => a.rarity - b.rarity || a.name.localeCompare(b.name));
    }
    return out;
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
   * The ItemProps give the first step (baseHeat) and the total (maxHeat); the steps between
   * grow geometrically (the game's curve is server code).
   */
  heatTable(name: string): number[] {
    const p = this.info(name)?.props;
    const base = Math.max(1, p?.baseHeat ?? 10), total = Math.max(base * 9, p?.maxHeat ?? DEFAULT_MAX_HEAT);
    return heatCurve(base, total);
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

  /** Equipped items that take heat: weapons, shield, armour and helmet below level 10. */
  heatedItems(w: Wallet): string[] {
    const l = w.loadout;
    return [...new Set([...l.weapons, l.shield, l.armor, l.helmet].filter(n => n && w.owned.includes(n) && this.info(n)?.heatable && this.level(w, n) < MAX_LEVEL))];
  }

  /**
   * Banks a floor's heat: every equipped heatable item absorbs the full amount (the wiki's
   * Heat page), then levels up. Returns the items that gained levels and their new level.
   */
  addHeat(w: Wallet, raw: number, now = Date.now()): { name: string; level: number }[] {
    const heat = this.heatGain(w, raw, now);
    const ups: { name: string; level: number }[] = [];
    if (heat <= 0) return ups;
    for (const n of this.heatedItems(w)) {
      const s = w.gear[n] ??= { heat: 0, level: 1, variants: [] };
      s.heat += heat;
      const lv = this.levelUp(w, n);
      if (lv) ups.push({ name: n, level: lv });
    }
    return ups;
  }

  /** Applies the levels an item's heat has earned. Returns the new level, or 0 if unchanged. */
  levelUp(w: Wallet, name: string): number {
    const s = w.gear[name];
    if (!s) return 0;
    const t = this.heatTable(name);
    s.heat = Math.min(s.heat, t[MAX_LEVEL - 1]);
    const lv = this.levelFor(name, s.heat);
    if (lv <= s.level) return 0;
    s.level = lv;
    return lv;
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
  private levelConfigs(name: string, level: number): any[] {
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
    const st: LevelStats = { damage: 0, charge: 0, defense: 0, health: 0 };
    const add = (c: any, d: number) => {
      if (!c || d > 6) return;
      switch (kind(c)) {
        case "Compound": for (const x of c.levels ?? []) add(x, d + 1); break;
        case "RelativeDamageBonus": if (depth >= (c.startDepth ?? 0)) st.damage += c.damage ?? DAMAGE[enumName(c.bonus, "LOW")] ?? 0; break;
        case "ChargeTimeReduction": st.charge += c.reduction ?? CTR[enumName(c.bonus, "CUSTOM")] ?? 0; break;
        case "DefenseIncrease": st.defense += c.defense ?? 0; break;
        case "HealthBonus": if (depth >= (c.minDepth ?? 0)) st.health += c.health ?? 0; break;
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
      case "StatusResist": e.resist = { mask: v.conditionMask ?? 0, points: v.resist ?? RESIST[enumName(v.statusResist, "LOW")] ?? 5 }; break;
      case "DefenseTypeBonus": e.defense = { type: enumName(v.type, "NORMAL"), depthScale: v.depthScale ?? null, amount: v.amount ?? 5 * grade }; break;
      case "TaggedDamage": e.tagged = { tag: v.tag ?? "", damage: v.damage ?? TAGGED[bonus] ?? 0.05 }; break;
      case "AttackSpeedChange": e.attackSpeed = v.speed ?? ASI[bonus] ?? 0.02; break;
      case "ChargeTimeReduction": e.charge = v.reduction ?? CTR[bonus] ?? 0.05; break;
      case "HealthBonus": e.health = v.health ?? 40; break;
      case "SpeedChange": e.speed = v.speed ?? SPEED[bonus] ?? 0.05; break;
      case "WeaponClass": {
        e.weaponClass = enumName(v.weaponClass, "SWORD");
        const b = v.bonus, bk = kind(b), bg = enumName(b?.bonus, "LOW");
        if (bk === "ChargeTimeReduction") e.charge = b.reduction ?? CTR[bg];
        else if (bk === "RelativeDamageBonus") e.damage = b.damage ?? DAMAGE[bg];
        else if (bk === "AttackSpeedChange") e.attackSpeed = b.speed ?? ASI[bg];
        break;
      }
      default: return null;
    }
    return e;
  }

  /** "Beast Damage: Medium" */
  variantLabel(name: string): string {
    const v = this.variant(name);
    return v ? `${v.label}: ${GRADES[Math.min(4, v.grade)]}` : last(name);
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
      list.push({ name, item: itemOf.get(name) ?? null, output, rarity, materials, base, baseLevel, crowns, variantTable: r.variantTable ?? null });
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
    return need;
  }

  canCraft(w: Wallet, r: Recipe): boolean { return this.missing(w, r).length === 0; }

  /**
   * Crafts: spends crowns, materials and the base item; the new item starts at level 1 with
   * variants rolled from the recipe's table and takes the base item's place in the loadout.
   */
  craft(w: Wallet, r: Recipe, rand: () => number = Math.random): GearState | null {
    if (!this.canCraft(w, r)) return null;
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
export function heatCurve(base: number, total: number): number[] {
  // steps base * r^k (k = 0..8) summing to total; solve r by bisection
  const sum = (r: number) => (Math.abs(r - 1) < 1e-9 ? 9 * base : base * (Math.pow(r, 9) - 1) / (r - 1));
  let lo = 1, hi = 4;
  if (sum(1) >= total) hi = 1;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (sum(m) < total) lo = m; else hi = m; }
  const r = (lo + hi) / 2, out = [0];
  let acc = 0;
  for (let k = 0; k < 9; k++) { acc += base * Math.pow(r, k); out.push(Math.round(acc)); }
  out[9] = Math.round(total);
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
