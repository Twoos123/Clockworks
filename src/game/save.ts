// The player's saved state, kept in the browser (localStorage): the equipped loadout, crowns
// and materials banked between runs, and the deepest floor reached. Nothing leaves the
// machine.

import type { GearState } from "./economy";

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
  /** Letters in the knight's mailbox (welcome notes, mission rewards). */
  mail?: { from: string; subject: string; body: string; read: boolean; at: number }[];
}

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
