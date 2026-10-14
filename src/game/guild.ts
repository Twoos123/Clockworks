// The player's own guild (single player): a name and emblem, a vault for materials and crowns,
// and the furniture placed in the guild hall. The hall itself is the cached guild hall scene
// with its owners' furniture taken out; the player's placements go back in as the same
// "Furni Placer" placeables the game uses (a placeable whose "Furni" argument names the item).
//
// FLAG: hall layouts (expansions, themes, room doors) are bought and stored on the game's
// servers; only the one cached hall exists here, so every guild gets that layout.

import type { GearState } from "./economy";
import type { SaveData } from "./save";
import { itemName } from "./text";

/** One furniture item standing in the hall. */
export interface Placement {
  /** Item config name, e.g. "Furni/Chair/Spiral Order/Field/Spiral Order, Cool tone". */
  item: string;
  /** Centre of the footprint, in world units (tiles are one unit). */
  x: number;
  y: number;
  z: number;
  /** Eighth turns about Z (the game places furniture in 45 degree steps). */
  rot: number;
}

export interface Emblem {
  /** A gate heraldry icon (ui/icon/gate/<symbol>.png). */
  symbol: string;
  /** CSS colour of the field. */
  color: string;
}

export interface GuildSave {
  name: string;
  emblem: Emblem;
  /** Materials kept in the guild vault (item name and count). */
  vault: Record<string, number>;
  /** Crowns in the guild treasury. */
  treasury: number;
  /** Furniture owned and not placed: item name and count. */
  furni: Record<string, number>;
  placements: Placement[];
  /** The rank storages (GuildBagType MEMBER, VETERAN and OFFICER_STORAGE): gear and materials left there. */
  storage?: Partial<Record<StorageBag, BagStore>>;
}

/**
 * GuildBagType: the treasury (crowns, materials and furniture, given and never taken back) and
 * the three storages by the rank that may use them (gear and materials, both ways). The knight
 * leads its own guild, so it may use all four.
 */
export type GuildBag = "treasury" | StorageBag;
export type StorageBag = "member" | "veteran" | "officer";
export const GUILD_BAGS: GuildBag[] = ["treasury", "member", "veteran", "officer"];

/** What a storage holds: gear with its heat, level and variants, and material counts. */
export interface BagStore { gear: Record<string, GearState>; materials: Record<string, number> }

export function bagStore(g: GuildSave, bag: StorageBag): BagStore {
  const s = (g.storage ??= {});
  const b = (s[bag] ??= { gear: {}, materials: {} });
  b.gear ??= {}; b.materials ??= {};
  return b;
}

/** GuildBagType.canRemove: everything but the treasury gives back. */
export const bagGivesBack = (bag: GuildBag) => bag !== "treasury";

/** One line of the trade cart: an item and count given to the bag (`give`) or taken from it. */
export interface CartLine { item: string; count: number; give: boolean; gear: boolean }

/**
 * Commits a trade cart (the client's trade cart confirm): gives and takes the lines and gives
 * `crowns` (the treasury's crowns slot). The treasury takes materials and crowns only (its
 * furniture is bought straight into it); worn gear cannot be given. False, with nothing moved,
 * when any line cannot be done.
 */
export function commitCart(save: SaveData, bag: GuildBag, lines: CartLine[], crowns = 0): boolean {
  const g = guildOf(save);
  crowns = Math.max(0, Math.floor(crowns));
  if (crowns && (bag !== "treasury" || save.crowns < crowns)) return false;
  const l = save.loadout, worn = new Set([...l.weapons, l.shield, l.armor, l.helmet, ...l.trinkets, l.vitapod]);
  const store = bag === "treasury" ? null : bagStore(g, bag);
  for (const c of lines) {
    if (c.count <= 0) return false;
    if (!c.give && !store) return false;
    if (c.gear) {
      if (!store) return false;
      if (c.give ? !save.owned.includes(c.item) || worn.has(c.item) : !store.gear[c.item] || save.owned.includes(c.item)) return false;
    } else {
      const from = c.give ? save.materials : store!.materials;
      if ((from[c.item] ?? 0) < c.count) return false;
    }
  }
  for (const c of lines) {
    if (c.gear && store) {
      if (c.give) { store.gear[c.item] = save.gear[c.item] ?? { heat: 0, level: 1, variants: [] }; save.owned = save.owned.filter(o => o !== c.item); delete save.gear[c.item]; }
      else { save.owned.push(c.item); save.gear[c.item] = store.gear[c.item]; delete store.gear[c.item]; }
      continue;
    }
    const from = c.give ? save.materials : store!.materials, to = c.give ? (store ? store.materials : g.vault) : save.materials;
    from[c.item] -= c.count;
    if (!from[c.item]) delete from[c.item];
    to[c.item] = (to[c.item] ?? 0) + c.count;
  }
  save.crowns -= crowns;
  g.treasury += crowns;
  return true;
}

/** Heraldry the emblem can use: the gate icons in ui/icon/gate. */
export const EMBLEM_SYMBOLS = ["lion", "falcon", "serpent", "dragonfly", "sparrow", "clover", "sun", "skull", "phantom",
  "titan", "king", "queen", "bishop", "knight", "rook", "pawn"];
export const EMBLEM_COLORS = ["#2f6fde", "#c0392b", "#27ae60", "#f1c40f", "#8e44ad", "#e67e22", "#16a085", "#7f8c8d", "#2c3e50", "#d35400", "#ecf0f1", "#c2185b"];

export function defaultGuild(): GuildSave {
  return { name: "Knights of Haven", emblem: { symbol: "lion", color: "#2f6fde" }, vault: {}, treasury: 0, furni: {}, placements: [] };
}

/** The save's guild, created on first use. */
export function guildOf(save: SaveData): GuildSave {
  const g = save.guild ?? (save.guild = defaultGuild());
  g.emblem ??= defaultGuild().emblem;
  g.vault ??= {}; g.furni ??= {}; g.placements ??= []; g.treasury ??= 0;
  return g;
}

// ---------------------------------------------------------------- furniture catalogue

/** What the furniture window lists: one entry per item, from config/item.dat. */
export interface FurniEntry {
  name: string;
  label: string;
  /** The category: the path segment after "Furni/" (Chair, Table, Pet...). */
  category: string;
  rarity: number;
  icon: any;
  /** Footprint in tiles at rotation 0. */
  width: number;
  height: number;
}

/** Item names that are furniture the player can own: "Furni/..." but not the parts they derive from. */
export const isFurniture = (name: string) => /^Furni\//.test(name) && !/\/Parts\/|\/Dev\/|\(Dev\)|\bTEST\b/.test(name);

/**
 * Builds the catalogue from the item library: every furniture item whose implementation (after
 * following Derived items) is a FurniConfig (Prop, Actor, Placeable, KnightStatue...).
 */
export function furnitureCatalogue(names: Iterable<string>, resolve: (name: string) => any): FurniEntry[] {
  const out: FurniEntry[] = [];
  for (const name of names) {
    if (!isFurniture(name)) continue;
    const impl = resolve(name);
    if (!impl || !/FurniConfig\$/.test(impl.$class ?? "") || !(impl.model || impl.placeable || impl.actor)) continue;
    out.push({ name, label: itemName(name), category: name.split("/")[1] ?? "Other", rarity: impl.rarity ?? 0, icon: impl.icon ?? null,
      width: Math.max(1, impl.footprintWidth ?? 1), height: Math.max(1, impl.footprintHeight ?? 1) });
  }
  out.sort((a, b) => a.category.localeCompare(b.category) || a.rarity - b.rarity || a.label.localeCompare(b.label));
  return out;
}

/**
 * Crowns for a furniture item, by its star rating (the shop tuning prices, scaled down: the
 * game sold furniture for energy and crowns on its servers). Items without a rating (-1:
 * event prizes and promotions) cost as much as a three star item.
 */
export const FURNI_PRICES = [150, 400, 900, 2000, 4500, 9000];
export function furniPrice(rarity: number): number {
  return FURNI_PRICES[rarity < 0 ? 3 : Math.min(5, rarity)];
}

/** Buys one furniture item with banked crowns; false if the knight cannot afford it. */
export function buyFurniture(save: SaveData, item: string, rarity: number): boolean {
  const cost = furniPrice(rarity);
  if (save.crowns < cost) return false;
  save.crowns -= cost;
  const g = guildOf(save);
  g.furni[item] = (g.furni[item] ?? 0) + 1;
  return true;
}

// ---------------------------------------------------------------- placing

/** The footprint at an eighth-turn rotation: quarter turns swap width and height. */
export function footprint(w: number, h: number, rot: number): [number, number] {
  return Math.floor(rot / 2) % 2 === 1 ? [h, w] : [w, h];
}

/** Next allowed rotation: 45 degree steps for square footprints, 90 for others. */
export function nextRotation(w: number, h: number, rot: number, back = false): number {
  const step = w === h ? 1 : 2;
  const r = ((rot + (back ? -step : step)) % 8 + 8) % 8;
  return w === h ? r : r - (r % 2);
}

/**
 * Snaps a pointed-at spot to the tile grid: the footprint's cells, and the centre the model
 * stands at (half-tile centres for odd sizes, as the cached hall's furniture is placed).
 */
export function snap(px: number, py: number, w: number, h: number, rot: number): { x: number; y: number; cells: [number, number][] } {
  const [ew, eh] = footprint(w, h, rot);
  const ox = Math.round(px - ew / 2), oy = Math.round(py - eh / 2);
  const cells: [number, number][] = [];
  for (let dy = 0; dy < eh; dy++) for (let dx = 0; dx < ew; dx++) cells.push([ox + dx, oy + dy]);
  return { x: ox + ew / 2, y: oy + eh / 2, cells };
}

/** The tiles a placement covers. */
export function cellsOf(p: Placement, w: number, h: number): [number, number][] {
  return snap(p.x, p.y, w, h, p.rot).cells;
}

/** Takes one owned item and stands it in the hall. */
export function place(g: GuildSave, p: Placement): boolean {
  if ((g.furni[p.item] ?? 0) < 1) return false;
  g.furni[p.item]--;
  if (!g.furni[p.item]) delete g.furni[p.item];
  g.placements.push(p);
  return true;
}

/** Picks a placed item back up into the inventory. */
export function unplace(g: GuildSave, p: Placement) {
  const i = g.placements.indexOf(p);
  if (i < 0) return;
  g.placements.splice(i, 1);
  g.furni[p.item] = (g.furni[p.item] ?? 0) + 1;
}

// ---------------------------------------------------------------- vault

/** Moves materials (or crowns, as "crowns") between the knight's bank and the guild vault. */
export function transfer(save: SaveData, what: string, count: number, toVault: boolean): boolean {
  const g = guildOf(save);
  count = Math.floor(count);
  if (count <= 0) return false;
  if (what === "crowns") {
    if (toVault ? save.crowns < count : g.treasury < count) return false;
    save.crowns += toVault ? -count : count;
    g.treasury += toVault ? count : -count;
    return true;
  }
  const from = toVault ? save.materials : g.vault, to = toVault ? g.vault : save.materials;
  if ((from[what] ?? 0) < count) return false;
  from[what] -= count;
  if (!from[what]) delete from[what];
  to[what] = (to[what] ?? 0) + count;
  return true;
}

// ---------------------------------------------------------------- the hall scene

const REF = "com.threerings.config.ConfigReference";

/** A Furni Placer placeable entry, as the cached hall stores furniture. */
export function furniEntry(id: number, p: Placement) {
  const a = p.rot * Math.PI / 4;
  return {
    $class: "com.threerings.tudey.data.TudeySceneModel$PlaceableEntry", id,
    placeable: { $class: REF, name: "Furni Placer", arguments: { $map: "com.threerings.config.ArgumentMap", entries: [["Furni", { $class: REF, name: p.item }]] } },
    transform: { $class: "com.threerings.math.Transform3D", translation: { $class: "com.threerings.math.Vector3f", x: p.x, y: p.y, z: p.z },
      rotation: { $class: "com.threerings.math.Quaternion", x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) }, scale: 1 },
  };
}

const argOf = (ref: any, key: string) => {
  const a = ref?.arguments;
  if (!a) return undefined;
  if (a.$map) return (a.entries as [string, any][]).find(([k]) => k === key)?.[1];
  return a[key];
};

/** The furniture the cached hall's owners placed, as placements (for "furnish like the cached hall"). */
export function cachedPlacements(root: any): Placement[] {
  const out: Placement[] = [];
  for (const e of root.entries ?? []) {
    if (e.placeable?.name !== "Furni Placer") continue;
    const item = argOf(e.placeable, "Furni")?.name;
    if (!item) continue;
    const t = e.transform?.translation ?? {}, r = e.transform?.rotation;
    const angle = r ? 2 * Math.atan2(r.z ?? 0, r.w ?? 1) : 0;
    out.push({ item, x: t.x ?? 0, y: t.y ?? 0, z: t.z ?? 0, rot: ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8 });
  }
  return out;
}

/**
 * The player's hall: the cached hall without its furniture, named for the guild. The player's
 * furniture is drawn by the furniture layer (so it can move without reloading the hall);
 * `withFurniture` bakes it into the scene instead.
 */
export function hallRoot(cached: any, guild: GuildSave, withFurniture = false): any {
  const entries = (cached.entries ?? []).filter((e: any) => e.placeable?.name !== "Furni Placer");
  if (withFurniture) {
    let id = entries.reduce((m: number, e: any) => Math.max(m, e.id ?? 0), 0) + 1;
    for (const p of guild.placements) entries.push(furniEntry(id++, p));
  }
  return { ...cached, entries, name: `%guild:m.hall|~${guild.name || "Guild"}` };
}
