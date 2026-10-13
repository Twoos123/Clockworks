// Achievements, tracked offline in the save.
//
// The client names its achievements in an enum and gives each a code: the CRC-32 of the
// enum constant's name, written in hex. The code picks the texts ("m.achievement_<code>" and
// "d.achievement_<code>" in the projectx bundle) and the icon (ui/icon/cheevos/<code>.png;
// locked ones show ui/icon/cheevos/locked.png). Some achievements the client checks itself
// against the player's statistics (items crafted, gear owned by kind, capsules used); the
// rest the server grants when something happens (a boss falls, a depth is reached).
//
// Here everything is checked on the knight's own machine:
// - from the save as it stands (evaluate): gear owned by kind, five-star sets, a level-10
//   item, every socket filled, tier clearance from the mission rank, the deepest floor;
// - from events the game reports (record*): crafting, capsules used, revives, bosses
//   defeated, kills, and the run in progress (tiers and the full Clockworks without revives).
// Achievements that need other players or the server's games (reviving a party member,
// Lockdown, the prize wheel) stay locked.

import { TIER_RANK } from "./missions";

/** Achievement types in the client's enum order (UNUSED left out). */
export const ACHIEVEMENT_TYPES = [
  "REACHED_RESCUE_CAMP", "REACHED_HAVEN", "REACHED_TERMINAL_1", "REACHED_SUBTOWN_1", "EARNED_TIER_2",
  "REACHED_SUBTOWN_2", "EARNED_TIER_3", "REACHED_CORE_TERMINAL",
  "DEFEATED_ROYAL_JELLY", "DEFEATED_VANADUKE", "DEFEATED_SNARBOLAX", "DEFEATED_ROARMULUS",
  "CRAFTED_RARITY_1", "CRAFTED_RARITY_2", "CRAFTED_RARITY_3", "CRAFTED_RARITY_4", "CRAFTED_RARITY_5",
  "ITEMS_CRAFTED_1", "ITEMS_CRAFTED_2", "ITEMS_CRAFTED_3", "ITEMS_CRAFTED_4",
  "SWORDS_OWNED_1", "SWORDS_OWNED_2", "SWORDS_OWNED_3", "HANDGUNS_OWNED_1", "HANDGUNS_OWNED_2", "HANDGUNS_OWNED_3",
  "BOMBS_OWNED_1", "BOMBS_OWNED_2", "BOMBS_OWNED_3", "HELMS_OWNED_1", "HELMS_OWNED_2", "HELMS_OWNED_3",
  "ARMORS_OWNED_1", "ARMORS_OWNED_2", "ARMORS_OWNED_3", "SHIELDS_OWNED_1", "SHIELDS_OWNED_2", "SHIELDS_OWNED_3",
  "RARITY_SET_1", "LEVELLED_ITEM_1",
  "MINERALS_DEPOSITED_1", "MINERALS_DEPOSITED_2", "MINERALS_DEPOSITED_3", "MINERALS_DEPOSITED_4", "MINERALS_DEPOSITED_5",
  "SLOTS_FILLED_1", "REVIVE_SELF", "REVIVE_FRIEND", "REVIVE_FRIEND_MINIMUM",
  "HEALTH_CAPSULES_USED_1", "REMEDY_CAPSULES_USED_1", "MECHA_KNIGHT_ACTIVATED",
  "REVIVELESS_COMPLETE_TIER_1", "REVIVELESS_COMPLETE_TIER_2", "REVIVELESS_COMPLETE_TIER_3",
  "FULL_RUN", "REVIVELESS_FULL_RUN", "FIRECRACKER_BOMB_OWNED", "LOCKDOWN_SNOWBALL",
  "CASINO_SPIN_1", "CASINO_WHAMMIE", "CASINO_SPIN_2", "CASINO_SPIN_3", "CASINO_VIP",
] as const;
export type AchievementType = (typeof ACHIEVEMENT_TYPES)[number];

/** Retired achievements: listed apart (the panel's obsolete table) and shown only once earned. */
const OBSOLETE = new Set<AchievementType>(["MINERALS_DEPOSITED_1", "MINERALS_DEPOSITED_2", "MINERALS_DEPOSITED_3",
  "MINERALS_DEPOSITED_4", "MINERALS_DEPOSITED_5", "REVIVE_FRIEND_MINIMUM"]);
/** Secret ones (shown only once earned), besides the obsolete. */
const SECRET = new Set<AchievementType>(["CASINO_WHAMMIE", "CASINO_VIP"]);
/** Achievements that need other players or the server's own games: never earned offline. */
export const ONLINE_ONLY = new Set<AchievementType>(["REVIVE_FRIEND", "REVIVE_FRIEND_MINIMUM", "MECHA_KNIGHT_ACTIVATED",
  "LOCKDOWN_SNOWBALL", "CASINO_SPIN_1", "CASINO_WHAMMIE", "CASINO_SPIN_2", "CASINO_SPIN_3", "CASINO_VIP",
  "MINERALS_DEPOSITED_1", "MINERALS_DEPOSITED_2", "MINERALS_DEPOSITED_3", "MINERALS_DEPOSITED_4", "MINERALS_DEPOSITED_5"]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 of an ASCII string. */
export function crc32(s: string): number {
  let c = 0xffffffff;
  for (let i = 0; i < s.length; i++) c = CRC_TABLE[(c ^ s.charCodeAt(i)) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface AchievementDef {
  type: AchievementType;
  /** The code in hex, as the texts and icon use it. */
  code: string;
  /** Name and description keys in the projectx bundle. */
  nameKey: string;
  descKey: string;
  icon: string;
  obsolete: boolean;
  /** Shown only once earned. */
  hidden: boolean;
  online: boolean;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = ACHIEVEMENT_TYPES.map(type => {
  const code = crc32(type).toString(16);
  return {
    type, code, nameKey: `m.achievement_${code}`, descKey: `d.achievement_${code}`, icon: `ui/icon/cheevos/${code}.png`,
    obsolete: OBSOLETE.has(type), hidden: OBSOLETE.has(type) || SECRET.has(type), online: ONLINE_ONLY.has(type),
  };
});
export const LOCKED_ICON = "ui/icon/cheevos/locked.png";

/** What the save keeps: when each was earned, the statistics behind them, the run under way. */
export interface AchievementSave {
  /** Earned achievements: type to the time (ms) it was earned. */
  unlocked: Partial<Record<AchievementType, number>>;
  /** Counters: kills, itemsCrafted, healthCapsulesUsed, remedyCapsulesUsed, revives, bosses... */
  stats: Record<string, number>;
  /** The run under way: the depth it set out from and whether the knight was revived. */
  run: { start: number; revived: boolean } | null;
}

export const freshAchievements = (): AchievementSave => ({ unlocked: {}, stats: {}, run: null });

/** A save's achievements, repaired. */
export function normalizeAchievements(a: unknown): AchievementSave {
  const out = freshAchievements();
  const x = a as Partial<AchievementSave> | null | undefined;
  for (const t of ACHIEVEMENT_TYPES) {
    const v = Number(x?.unlocked?.[t]);
    if (Number.isFinite(v) && v > 0) out.unlocked[t] = v;
  }
  for (const [k, v] of Object.entries(x?.stats ?? {})) if (Number.isFinite(Number(v))) out.stats[k] = Number(v);
  if (x?.run && Number.isFinite(Number(x.run.start))) out.run = { start: Number(x.run.start), revived: !!x.run.revived };
  return out;
}

/** The part of the save the checks read (SaveData has it all). */
export interface AchievementSource {
  achievements?: AchievementSave;
  owned: string[];
  gear: Record<string, { level: number }>;
  bestDepth: number;
  loadout: { weapons: string[]; shield: string; trinkets: string[]; vitapod: string };
  appearance?: { costume: { armor: string; helmet: string; shield: string } };
  missions?: { rank: number };
}

/** An item's kind and star rating, as the checks need them (economy.info). */
export type ItemLookup = (name: string) => { category: string; rarity: number } | null;

const progress = (s: AchievementSource) => (s.achievements ??= freshAchievements());

/** Earns an achievement (once); true when it is new. */
export function unlock(s: AchievementSource, t: AchievementType, now = Date.now()): boolean {
  const a = progress(s);
  if (a.unlocked[t]) return false;
  a.unlocked[t] = now;
  return true;
}

export const isUnlocked = (s: AchievementSource, t: AchievementType) => !!s.achievements?.unlocked[t];

const bump = (s: AchievementSource, stat: string, n = 1) => {
  const a = progress(s);
  return (a.stats[stat] = (a.stats[stat] ?? 0) + n);
};

/** Thresholds of the client's statistic checks. */
const CRAFT_COUNTS: [AchievementType, number][] = [["ITEMS_CRAFTED_1", 5], ["ITEMS_CRAFTED_2", 10], ["ITEMS_CRAFTED_3", 25], ["ITEMS_CRAFTED_4", 50]];
const OWNED: [string, string][] = [["SWORDS", "sword"], ["HANDGUNS", "handgun"], ["BOMBS", "bomb"], ["HELMS", "helm"], ["ARMORS", "armor"], ["SHIELDS", "shield"]];
const OWNED_COUNTS = [3, 5, 10];
const CAPSULES = 10;
/** Floors that earn a visit: the first terminal, the two subtowns, the Core's terminal. */
const DEPTHS: [AchievementType, number][] = [["REACHED_TERMINAL_1", 4], ["REACHED_SUBTOWN_1", 8], ["REACHED_SUBTOWN_2", 18], ["REACHED_CORE_TERMINAL", 29]];
/** A tier's expedition: from its first floor to the next tier's town (the Core's terminal for tier 3). */
const TIERS: [number, number, number][] = [[1, 0, 8], [2, 8, 18], [3, 18, 29]];
const BOSS: Record<string, AchievementType> = { jelly: "DEFEATED_ROYAL_JELLY", snarbolax: "DEFEATED_SNARBOLAX", twins: "DEFEATED_ROARMULUS", vanaduke: "DEFEATED_VANADUKE" };

/**
 * Checks what the save shows: gear owned, levels, sockets, rank and depth. Returns the
 * achievements it earned now.
 */
export function evaluate(s: AchievementSource, look: ItemLookup, now = Date.now()): AchievementType[] {
  const got: AchievementType[] = [];
  const earn = (t: AchievementType, ok: boolean) => { if (ok && unlock(s, t, now)) got.push(t); };
  const a = progress(s);
  // statistics kept by the events
  for (const [t, n] of CRAFT_COUNTS) earn(t, (a.stats.itemsCrafted ?? 0) >= n);
  for (let r = 1; r <= 5; r++) earn(`CRAFTED_RARITY_${r}` as AchievementType, (a.stats[`crafted${r}`] ?? 0) > 0);
  earn("HEALTH_CAPSULES_USED_1", (a.stats.healthCapsulesUsed ?? 0) >= CAPSULES);
  earn("REMEDY_CAPSULES_USED_1", (a.stats.remedyCapsulesUsed ?? 0) >= CAPSULES);
  earn("REVIVE_SELF", (a.stats.revives ?? 0) > 0);
  // the arsenal
  const count = new Map<string, number>(), five = new Set<string>();
  for (const n of new Set(s.owned)) {
    const i = look(n);
    if (!i) continue;
    count.set(i.category, (count.get(i.category) ?? 0) + 1);
    if (i.rarity >= 5) five.add(i.category);
  }
  for (const [prefix, cat] of OWNED) OWNED_COUNTS.forEach((n, i) => earn(`${prefix}_OWNED_${i + 1}` as AchievementType, (count.get(cat) ?? 0) >= n));
  earn("RARITY_SET_1", ["helm", "armor", "shield", "handgun", "bomb"].every(c => five.has(c)));
  earn("LEVELLED_ITEM_1", Object.values(s.gear).some(g => (g?.level ?? 0) >= 10));
  earn("FIRECRACKER_BOMB_OWNED", s.owned.some(n => /^Weapon\/Bomb\/.*Firecracker/i.test(n)));
  const l = s.loadout, c = s.appearance?.costume;
  earn("SLOTS_FILLED_1", l.weapons.filter(Boolean).length >= 3 && !!l.shield && l.trinkets.filter(Boolean).length >= 2 && !!l.vitapod
    && !!c?.armor && !!c.helmet && !!c.shield);
  // clearance and depth
  const rank = s.missions?.rank ?? 1;
  earn("EARNED_TIER_2", rank >= TIER_RANK[2]);
  earn("EARNED_TIER_3", rank >= TIER_RANK[3]);
  for (const [t, d] of DEPTHS) earn(t, s.bestDepth >= d);
  return got;
}

// ------------------------------------------------------------------------------ events

/** The knight arrived in Haven (creation done): the tutorial's end and the town. */
export function recordHaven(s: AchievementSource, now = Date.now()): AchievementType[] {
  return (["REACHED_RESCUE_CAMP", "REACHED_HAVEN"] as const).filter(t => unlock(s, t, now));
}

/** An item was crafted (alchemized) at a star rating. */
export function recordCraft(s: AchievementSource, rarity: number) {
  bump(s, "itemsCrafted");
  if (rarity >= 1 && rarity <= 5) bump(s, `crafted${Math.round(rarity)}`);
}

/** A pocket item was used: health and remedy capsules count. */
export function recordPocketUse(s: AchievementSource, item: string) {
  // "Pickup/Capsule/Health Capsule" and its Super and Ultra kinds; "Pickup/Capsule/Remedy Capsule"
  if (/Health Capsule$/.test(item)) bump(s, "healthCapsulesUsed");
  else if (/Remedy Capsule$/.test(item)) bump(s, "remedyCapsulesUsed");
}

/** Monsters defeated. */
export function recordKills(s: AchievementSource, n: number) { if (n > 0) bump(s, "kills", n); }

/** The knight revived itself (a Spark of Life). */
export function recordRevive(s: AchievementSource) {
  bump(s, "revives");
  const r = progress(s).run;
  if (r) r.revived = true;
}

/** A boss fell (src/game/clockworks.ts BossKey). Returns what it earned. */
export function recordBoss(s: AchievementSource, boss: string, now = Date.now()): AchievementType[] {
  const t = BOSS[boss];
  if (!t) return [];
  bump(s, `boss_${boss}`);
  return unlock(s, t, now) ? [t] : [];
}

/** A Clockworks run set out from a depth (the floor above its first). */
export function recordRunStart(s: AchievementSource, depth: number) {
  progress(s).run = { start: Math.max(0, depth), revived: false };
}

/** The run ended (back in Haven). */
export function recordRunEnd(s: AchievementSource) { progress(s).run = null; }

/**
 * The knight reached a floor of the run in progress. A tier's expedition is complete on
 * reaching the next tier's town (Moorcroft Manor, Emberlight, the Core's terminal) from the
 * tier's start; the full run goes from depth 0 to 29. Returns what it earned.
 */
export function recordDepth(s: AchievementSource, depth: number, now = Date.now()): AchievementType[] {
  const a = progress(s), r = a.run;
  a.stats.deepest = Math.max(a.stats.deepest ?? 0, depth);
  if (!r) return [];
  const got: AchievementType[] = [];
  const earn = (t: AchievementType, ok: boolean) => { if (ok && unlock(s, t, now)) got.push(t); };
  for (const [tier, from, to] of TIERS) earn(`REVIVELESS_COMPLETE_TIER_${tier}` as AchievementType, !r.revived && r.start <= from && depth >= to);
  earn("FULL_RUN", r.start <= 0 && depth >= 29);
  earn("REVIVELESS_FULL_RUN", r.start <= 0 && depth >= 29 && !r.revived);
  return got;
}

/** How far along a counted achievement is ("3 / 5"), or null for the others. */
export function progressText(s: AchievementSource, t: AchievementType, look: ItemLookup): string | null {
  const a = s.achievements ?? freshAchievements();
  const of = (have: number, need: number) => `${Math.min(have, need)} / ${need}`;
  const crafted = CRAFT_COUNTS.find(([x]) => x === t);
  if (crafted) return of(a.stats.itemsCrafted ?? 0, crafted[1]);
  if (t === "HEALTH_CAPSULES_USED_1") return of(a.stats.healthCapsulesUsed ?? 0, CAPSULES);
  if (t === "REMEDY_CAPSULES_USED_1") return of(a.stats.remedyCapsulesUsed ?? 0, CAPSULES);
  const m = /^(\w+)_OWNED_(\d)$/.exec(t);
  const cat = m && OWNED.find(([p]) => p === m[1])?.[1];
  if (m && cat) return of([...new Set(s.owned)].filter(n => look(n)?.category === cat).length, OWNED_COUNTS[Number(m[2]) - 1]);
  const d = DEPTHS.find(([x]) => x === t);
  if (d) return of(s.bestDepth, d[1]);
  return null;
}
