// The player's saved state, kept in the browser (localStorage): the equipped loadout, crowns
// and materials banked between runs, and the deepest floor reached. Nothing leaves the
// machine.

import type { GearState } from "./economy";
import type { GuildSave } from "./guild";
import { normalizeAppearance, type Appearance } from "./accessories";
import { normalizeAchievements, type AchievementSave } from "./achievements";
import { normalizeSpriteSave, type SpriteSave } from "./sprites";
import { normalizeEnergy, type EnergyState } from "./energy";
import { normalizeFeed, type FeedRecord } from "./feed";

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
  /** The knight's height and eyes, picked at creation (src/game/creator.ts); absent for the defaults. */
  face?: KnightFace;
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
  /** Energy: the mist tank and Crystal Energy (src/game/energy.ts). */
  energy?: EnergyState;
  /** Letters in the knight's mailbox (welcome notes, mission rewards). */
  mail?: { from: string; subject: string; body: string; read: boolean; at: number }[];
  /** The knight made at character creation; absent until then (a fresh save). */
  knight?: KnightProfile;
  /** The player's guild: name, emblem, vault and hall furniture (src/game/guild.ts). */
  guild?: GuildSave;
  /** Loadouts saved from the equipment window (its Save Loadout button), newest last. */
  loadouts?: SavedLoadout[];
  /** Achievements earned, the statistics behind them and the run under way (achievements.ts). */
  achievements?: AchievementSave;
  /** Seconds played as this knight (the knight select card's "Played"). */
  played?: number;
  /** Deeds the Event Hub lists besides the achievements: bosses defeated, ranks earned (feed.ts). */
  feed?: FeedRecord[];
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
  /** The knight has talked through a conversation (the client's "converse" hint shows until then). */
  conversed?: boolean;
}

/** ProjectXCodes.KnightHeight's value ("-1", "0", "+1") and EyeType's name ("HAPPY"). */
export interface KnightFace { height: string; eyes: string }

/** The name plate's text: the created knight's name, else "Knight". */
export const knightName = (d: SaveData) => d.knight?.name || "Knight";

import type { MissionProgress } from "./missions";

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

/** A fresh save: a new knight's starting gear and nothing else. */
export function freshSave(): SaveData {
  return { version: 2, loadout: { ...DEFAULT_LOADOUT, weapons: [...DEFAULT_LOADOUT.weapons], trinkets: [] }, crowns: 0, heat: 0,
    materials: {}, bestDepth: 0, runs: 0, owned: [...DEFAULT_LOADOUT.weapons, DEFAULT_LOADOUT.shield], gear: {}, recipes: [], color: 257,
    pocket: [], heatAmplifier: 0, energy: normalizeEnergy(null), played: 0 };
}

/** A stored save (any version) repaired into the current shape; a fresh save when it is not one. */
export function normalizeSave(raw: unknown): SaveData {
  const fresh = freshSave();
  let out = fresh;
  try {
    if (raw && typeof raw === "object") {
      const d = JSON.parse(JSON.stringify(raw)) as Partial<SaveData> & { weaponHeat?: unknown };
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
        achievements: normalizeAchievements(d.achievements),
        energy: normalizeEnergy(d.energy),
        played: Math.max(0, Number(d.played) || 0),
        feed: normalizeFeed(d.feed),
        owned: [...new Set([...fresh.owned, ...(d.owned ?? []), ...(d.loadout?.weapons ?? []), d.loadout?.shield, d.loadout?.armor, d.loadout?.helmet, ...(d.loadout?.trinkets ?? []), d.loadout?.vitapod]
          .filter((x): x is string => !!x))],
      };
    }
  } catch { out = fresh; }
  const f = out.face as Partial<KnightFace> | undefined;
  if (f && (typeof f.height !== "string" || typeof f.eyes !== "string")) delete out.face;
  // every owned item has its state (heat, level, variants)
  for (const n of out.owned) {
    const g = out.gear[n];
    out.gear[n] = { heat: Math.max(0, Number(g?.heat) || 0), level: Math.max(1, Math.min(10, Number(g?.level) || 1)),
      variants: Array.isArray(g?.variants) ? g.variants.filter(v => typeof v === "string") : [],
      // the forge's Heat Bonus (+25% heat toward the next level), kept until the next forging
      ...(Number(g?.heatBonus) > 0 ? { heatBonus: Number(g!.heatBonus) } : {}) };
  }
  return out;
}

// ---------------------------------------------------------------- the knights (several saves)
//
// The game's account holds up to three knights (PlayerObject.availableKnights; the knight
// select window ui/pick/interface.dat has three cards). Here each knight is a whole save of
// its own (its arsenal, crowns, missions, rank, played time and look), kept together in one
// roster under ROSTER_KEY; `current` is the knight being played. A browser that still has the
// old single save (LEGACY_KEY) has it moved into the first slot when the roster first loads.

/** Knight slots (the knight select window's cards). */
export const MAX_KNIGHTS = 3;

export interface Roster {
  version: 1;
  /** Each knight's save. A save without `knight` is one whose creation has not finished. */
  knights: SaveData[];
  /** The knight being played (an index into `knights`), or -1 for none. */
  current: number;
}

/** The storage the saves live in (localStorage in the browser; a map in tests). */
export interface SaveStore { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export const LEGACY_KEY = "clyde-web-save";
export const ROSTER_KEY = "clyde-web-knights";

function browserStore(): SaveStore | null {
  try { return (globalThis as any).localStorage ?? null; } catch { return null; }
}

/**
 * The roster from storage: the stored roster, else the old single save migrated into the
 * first slot (with all its progress, even when its knight was never named), else empty.
 */
export function parseRoster(rosterRaw: string | null, legacyRaw: string | null): Roster {
  if (rosterRaw) {
    try {
      const r = JSON.parse(rosterRaw);
      if (r && Array.isArray(r.knights)) {
        const knights = (r.knights as unknown[]).filter(k => !!k && typeof k === "object").slice(0, MAX_KNIGHTS).map(normalizeSave);
        const cur = Number.isInteger(r.current) && r.current >= 0 && r.current < knights.length ? r.current : (knights.length ? 0 : -1);
        return { version: 1, knights, current: cur };
      }
    } catch { /* a broken roster: try the old save */ }
  }
  if (legacyRaw) {
    try {
      const d = JSON.parse(legacyRaw);
      if (d && typeof d === "object" && !Array.isArray(d)) return { version: 1, knights: [normalizeSave(d)], current: 0 };
    } catch { /* not a save */ }
  }
  return { version: 1, knights: [], current: -1 };
}

/** Reads the roster, migrating the old single save (whose key goes once the roster is written). */
export function loadRoster(s: SaveStore | null = browserStore()): Roster {
  if (!s) return { version: 1, knights: [], current: -1 };
  let rosterRaw: string | null = null, legacyRaw: string | null = null;
  try { rosterRaw = s.getItem(ROSTER_KEY); legacyRaw = s.getItem(LEGACY_KEY); } catch { /* storage unavailable */ }
  const r = parseRoster(rosterRaw, rosterRaw ? null : legacyRaw);
  if (!rosterRaw && legacyRaw && r.knights.length && writeRoster(r, s)) {
    try { s.removeItem(LEGACY_KEY); } catch { /* kept */ }
  }
  return r;
}

export function writeRoster(r: Roster, s: SaveStore | null = browserStore()): boolean {
  if (!s) return false;
  try { s.setItem(ROSTER_KEY, JSON.stringify(r)); return true; } catch { return false; }
}

/** The knights whose creation finished, with their slots (the knight select window's cards). */
export function namedKnights(r: Roster): { slot: number; save: SaveData }[] {
  return r.knights.map((save, slot) => ({ slot, save })).filter(k => !!k.save.knight);
}

/**
 * Starts a new knight: a slot whose creation never finished is reused (keeping what it has),
 * else a fresh save is added. Its slot becomes current; -1 when every slot holds a knight.
 */
export function addKnight(r: Roster): number {
  let i = r.knights.findIndex(k => !k.knight);
  if (i < 0) {
    if (r.knights.length >= MAX_KNIGHTS) return -1;
    r.knights.push(freshSave());
    i = r.knights.length - 1;
  }
  r.current = i;
  return i;
}

/** Plays as the knight in a slot: its save, or null for an empty slot. */
export function selectKnight(r: Roster, slot: number): SaveData | null {
  if (slot < 0 || slot >= r.knights.length) return null;
  r.current = slot;
  return r.knights[slot];
}

/** Deletes the knight in a slot (the others keep their saves); `current` follows its knight. */
export function deleteKnight(r: Roster, slot: number): boolean {
  if (slot < 0 || slot >= r.knights.length) return false;
  const cur = r.knights[r.current] ?? null;
  r.knights.splice(slot, 1);
  r.current = cur ? r.knights.indexOf(cur) : -1;
  return true;
}

/** Puts a knight's save in the roster: in the current slot, or a new one when none is current. */
export function storeKnight(r: Roster, d: SaveData) {
  if (r.knights[r.current] === d) return;
  if (r.current >= 0 && r.current < r.knights.length) r.knights[r.current] = d;
  else if (r.knights.length < MAX_KNIGHTS) { r.knights.push(d); r.current = r.knights.length - 1; }
}

/** The roster the game plays from (read once). */
let roster: Roster | null = null;
export function gameRoster(): Roster { return roster ??= loadRoster(); }
/** Forgets the roster read, so the next use reads storage again (after an import or a reset). */
export function reloadRoster() { roster = null; }

/** The current knight's save, or a fresh one (not in the roster yet) when no knight is chosen. */
export function loadSave(): SaveData {
  const r = gameRoster();
  return r.knights[r.current] ?? freshSave();
}

/** "Played" as the card shows it: days:hours:minutes:seconds, two digits each. */
export function playedText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds)), m = Math.floor(s / 60), h = Math.floor(m / 60);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(Math.floor(h / 24))}:${two(h % 24)}:${two(m % 60)}:${two(s % 60)}`;
}

/** The knight's energy, made on first use (a full mist tank). */
export function energyOf(d: SaveData): EnergyState {
  return d.energy ??= normalizeEnergy(null);
}

/** Writes the knight's save: into its slot of the roster, and the roster to storage. */
export function writeSave(d: SaveData) {
  const r = gameRoster();
  storeKnight(r, d);
  writeRoster(r);
}

/** Writes the roster as it stands (after choosing, adding or deleting a knight). */
export function saveRoster() { writeRoster(gameRoster()); }

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
