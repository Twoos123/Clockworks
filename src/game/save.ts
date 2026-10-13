// The player's saved state, kept in the browser (localStorage): the equipped loadout, crowns
// and materials banked between runs, and the deepest floor reached. Nothing leaves the
// machine.

import type { GuildSave } from "./guild";

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
  version: 1;
  loadout: Loadout;
  crowns: number;
  heat: number;
  materials: Record<string, number>;
  bestDepth: number;
  runs: number;
  /** Item config names the knight owns (bought or starting gear). */
  owned: string[];
  /** The knight's personal colour: a colour print (class << 8 | colour), 257 by default. */
  color: number;
  /** Heat each weapon has absorbed (it levels the weapon up). */
  weaponHeat: Record<string, number>;
  /** Consumables carried in the pocket slots (capsules and vials): item name and count. */
  pocket: [string, number][];
  /** Rank, completed missions and prestige (src/game/missions.ts); made on first use. */
  missions?: MissionProgress;
  /** Letters in the knight's mailbox (welcome notes, mission rewards). */
  mail?: { from: string; subject: string; body: string; read: boolean; at: number }[];
  /** The knight made at character creation; absent until then (a fresh save). */
  knight?: KnightProfile;
  /** The player's guild: name, emblem, vault and hall furniture (src/game/guild.ts). */
  guild?: GuildSave;
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
  const fresh: SaveData = { version: 1, loadout: { ...DEFAULT_LOADOUT, weapons: [...DEFAULT_LOADOUT.weapons], trinkets: [] }, crowns: 0, heat: 0,
    materials: {}, bestDepth: 0, runs: 0, owned: [...DEFAULT_LOADOUT.weapons, DEFAULT_LOADOUT.shield], color: 257, weaponHeat: {}, pocket: [] };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const d = JSON.parse(raw) as Partial<SaveData>;
    return {
      ...fresh, ...d,
      loadout: { ...fresh.loadout, ...(d.loadout ?? {}), weapons: (d.loadout?.weapons ?? fresh.loadout.weapons).slice(0, 3),
        trinkets: (d.loadout?.trinkets ?? []).slice(0, 2) },
      materials: { ...(d.materials ?? {}) },
      weaponHeat: { ...(d.weaponHeat ?? {}) },
      pocket: (d.pocket ?? []).filter(p => Array.isArray(p) && p[1] > 0).slice(0, POCKET_SLOTS),
      owned: [...new Set([...fresh.owned, ...(d.owned ?? []), ...(d.loadout?.weapons ?? []), d.loadout?.shield, d.loadout?.armor, d.loadout?.helmet, ...(d.loadout?.trinkets ?? []), d.loadout?.vitapod]
        .filter((x): x is string => !!x))],
    };
  } catch { return fresh; }
}

export function writeSave(d: SaveData) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* storage unavailable */ }
}

/**
 * Shop prices by star rating, in crowns. Real prices come from the game's servers, so these
 * are tuning numbers.
 */
export const PRICES = [100, 300, 1200, 3500, 9000, 20000];
export const price = (rarity: number) => PRICES[Math.max(0, Math.min(5, rarity))];

/** Highest star rating shops sell, from progress: deeper floors and finished runs unlock more. */
export function shopTier(d: SaveData): number {
  return d.runs >= 2 ? 5 : d.runs >= 1 ? 4 : d.bestDepth >= 3 ? 3 : 2;
}

/** Heat for weapon levels 1 to 10. The game's curve is server data; these are tuning numbers. */
const LEVEL_HEAT = [0, 5, 15, 30, 50, 80, 120, 170, 230, 300];
export const weaponLevel = (heat: number) => LEVEL_HEAT.filter(h => heat >= h).length;
/** Damage bonus per weapon level above 1 (tuning). */
export const levelMultiplier = (level: number) => 1 + 0.03 * (level - 1);
