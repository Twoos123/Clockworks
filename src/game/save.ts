// The player's saved state, kept in the browser (localStorage): the equipped loadout, crowns
// and materials banked between runs, and the deepest floor reached. Nothing leaves the
// machine.

import type { GearState } from "./economy";
import type { GuildSave } from "./guild";
import { normalizeAppearance, type Appearance } from "./accessories";
import { normalizeSpriteSave, type SpriteSave } from "./sprites";

export interface Loadout {
  /** Item config names, e.g. "Weapon/Sword/Proto Sword"; up to three weapons. */
  weapons: string[];
  shield: string;
  /** Empty for the knight model's default armour and helmet. */
  armor: string;
  helmet: string;
  /** Up to two trinkets. */
  trinkets: string[];
  /** The vitapod (Gear/Dungeon/Vitapod): extra health capsules, or empty. */
  vitapod: string;
}

export interface SaveData {
  version: 2;
  loadout: Loadout;
  crowns: number;
  /** Heat banked in total (statistics; each item keeps its own heat in `gear`). */
  heat: number;
  /** Materials and minerals by item name. */
  materials: Record<string, number>;
  bestDepth: number;
  runs: number;
  /** Item config names the knight owns (bought, crafted, found or starting gear). */
  owned: string[];
  /** Per owned item: its heat, level (1-10) and unique variants (variant config names). */
  gear: Record<string, GearState>;
  /** Recipes learned (recipe config names, "Sword/Calibur"); crafting needs the recipe. */
  recipes: string[];
  /** The knight's personal colour: a colour print (class << 8 | colour), 257 by default. */
  color: number;
  /** Consumables carried in the pocket slots (capsules and vials): item name and count. */
  pocket: [string, number][];
  /** Until when (ms) the heat amplifier doubles heat; 0 for none. An Energy item in the game. */
  heatAmplifier: number;
  /** Battle sprites: the one in the field and each one's level and augments (sprites.ts). */
  sprites?: SpriteSave;
  /** Accessories and costumes the knight shows (accessories.ts). */
  appearance?: Appearance;
  /** Rank, completed missions and prestige (src/game/missions.ts); made on first use. */
  missions?: MissionProgress;
  /** Sparks of Life: each revives a knocked-out knight (a fresh knight has three). */
  sparks?: number;
  /** Letters in the knight's mailbox (welcome notes, mission rewards). */
  mail?: { from: string; subject: string; body: string; read: boolean; at: number }[];
  /** The knight made at character creation; absent until then (a fresh save). */
  knight?: KnightProfile;
  /** The player's guild: name, emblem, vault and hall furniture (src/game/guild.ts). */
  guild?: GuildSave;
  /** Loadouts saved from the equipment window (its Save Loadout button), newest last. */
  loadouts?: SavedLoadout[];
}

/** A named loadout: the gear, the costumes and accessories, and the battle sprite. */
export interface SavedLoadout {
  name: string;
  loadout: Loadout;
  appearance: Appearance;
  /** The battle sprite taken along ("" for none). */
  sprite: string;
}

/** The game's loadout list holds this many. */
export const MAX_LOADOUTS = 10;

/** Saved loadouts from a save, repaired. */
export function normalizeLoadouts(list: unknown): SavedLoadout[] {
  if (!Array.isArray(list)) return [];
  const out: SavedLoadout[] = [];
  for (const l of list) {
    if (!l || typeof l.name !== "string" || !l.name.trim() || !l.loadout) continue;
    const g = l.loadout;
    out.push({
      name: l.name.trim().slice(0, 24),
      loadout: {
        weapons: (Array.isArray(g.weapons) ? g.weapons : []).filter((w: unknown) => typeof w === "string").slice(0, 3),
        shield: String(g.shield ?? ""), armor: String(g.armor ?? ""), helmet: String(g.helmet ?? ""),
        trinkets: (Array.isArray(g.trinkets) ? g.trinkets : []).filter((w: unknown) => typeof w === "string").slice(0, 2),
        vitapod: String(g.vitapod ?? ""),
      },
      appearance: normalizeAppearance(l.appearance),
      sprite: typeof l.sprite === "string" ? l.sprite : "",
    });
  }
  return out.slice(0, MAX_LOADOUTS);
}

/**
 * Saves the knight's current loadout under a name: an existing loadout of that name is
 * replaced, else it is added (false when the list is full).
 */
export function saveLoadout(d: SaveData, name: string, sprite: string): boolean {
  const list = d.loadouts ??= [];
  const entry: SavedLoadout = { name: name.trim().slice(0, 24), loadout: JSON.parse(JSON.stringify(d.loadout)),
    appearance: normalizeAppearance(d.appearance), sprite };
  const i = list.findIndex(l => l.name.toLowerCase() === entry.name.toLowerCase());
  if (i >= 0) { list[i] = entry; return true; }
  if (list.length >= MAX_LOADOUTS) return false;
  list.push(entry);
  return true;
}

/** A saved loadout's gear as the knight can wear it now: items no longer owned are left out. */
export function wearableLoadout(d: SaveData, l: SavedLoadout): Loadout {
  const owned = new Set(d.owned);
  const has = (n: string) => !!n && owned.has(n);
  return {
    weapons: l.loadout.weapons.filter(has), shield: has(l.loadout.shield) ? l.loadout.shield : "",
    armor: has(l.loadout.armor) ? l.loadout.armor : "", helmet: has(l.loadout.helmet) ? l.loadout.helmet : "",
    trinkets: l.loadout.trinkets.filter(has), vitapod: has(l.loadout.vitapod) ? l.loadout.vitapod : "",
  };
}

export interface KnightProfile {
  /** Shown on the HUD name plate. */
  name: string;
  /** The look picked at creation (starting helmet and armour; the colour is SaveData.color). */
  helmet: string;
  armor: string;
}

/** The name plate's text: the created knight's name, else "Knight". */
export const knightName = (d: SaveData) => d.knight?.name || "Knight";

import type { MissionProgress } from "./missions";

const KEY = "clyde-web-save";

/** Pocket slots on the quickbar. */
export const POCKET_SLOTS = 4;

export const DEFAULT_LOADOUT: Loadout = {
  weapons: ["Weapon/Sword/Proto Sword", "Weapon/Handgun/Proto Gun", "Weapon/Bomb/Proto Bomb"],
  shield: "Gear/Shield/Proto Shield",
  armor: "",
  helmet: "",
  trinkets: [],
  vitapod: "",
};

export function loadSave(): SaveData {
  const fresh: SaveData = { version: 2, loadout: { ...DEFAULT_LOADOUT, weapons: [...DEFAULT_LOADOUT.weapons], trinkets: [] }, crowns: 0, heat: 0,
    materials: {}, bestDepth: 0, runs: 0, owned: [...DEFAULT_LOADOUT.weapons, DEFAULT_LOADOUT.shield], gear: {}, recipes: [], color: 257,
    pocket: [], heatAmplifier: 0 };
  let out = fresh;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<SaveData> & { weaponHeat?: unknown };
      // version 1 kept tuning-scale weapon heat; items start over at level 1
      delete d.weaponHeat;
      out = {
        ...fresh, ...d, version: 2,
        loadout: { ...fresh.loadout, ...(d.loadout ?? {}), weapons: (d.loadout?.weapons ?? fresh.loadout.weapons).slice(0, 3),
          trinkets: (d.loadout?.trinkets ?? []).slice(0, 2) },
        materials: { ...(d.materials ?? {}) },
        gear: { ...(d.gear ?? {}) },
        recipes: [...new Set(d.recipes ?? [])],
        pocket: (d.pocket ?? []).filter(p => Array.isArray(p) && p[1] > 0).slice(0, POCKET_SLOTS),
        sprites: normalizeSpriteSave(d.sprites),
        appearance: normalizeAppearance(d.appearance),
        loadouts: normalizeLoadouts(d.loadouts),
        owned: [...new Set([...fresh.owned, ...(d.owned ?? []), ...(d.loadout?.weapons ?? []), d.loadout?.shield, d.loadout?.armor, d.loadout?.helmet, ...(d.loadout?.trinkets ?? []), d.loadout?.vitapod]
          .filter((x): x is string => !!x))],
      };
    }
  } catch { out = fresh; }
  // every owned item has its state (heat, level, variants)
  for (const n of out.owned) {
    const g = out.gear[n];
    out.gear[n] = { heat: Math.max(0, Number(g?.heat) || 0), level: Math.max(1, Math.min(10, Number(g?.level) || 1)),
      variants: Array.isArray(g?.variants) ? g.variants.filter(v => typeof v === "string") : [] };
  }
  return out;
}

export function writeSave(d: SaveData) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* storage unavailable */ }
}

/**
 * Gear prices by star rating, in crowns: config/item_property.dat ItemProps buyPrice of
 * weapons, shields, armour and helmets. economy.ts prices every item from its own props.
 */
export const PRICES = [150, 3000, 7500, 35000, 100000, 300000];
export const price = (rarity: number) => PRICES[Math.max(0, Math.min(5, rarity))];

/** Highest star rating Haven's shops show, from progress: deeper floors and finished runs unlock more. */
export function shopTier(d: SaveData): number {
  return d.runs >= 2 ? 5 : d.runs >= 1 ? 4 : d.bestDepth >= 3 ? 3 : 2;
}
