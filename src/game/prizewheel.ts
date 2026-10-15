// The prize wheel at the end of a Clockworks floor (client dungeon/client/c and d over
// casino/a/a; the prizes are Heat.lockboxPrizes, a list of SlotPrize.Item the server sends).
//
// What the client shows: ui/report/parts/bonus/interface_bonus.dat ("PRIZE WHEEL!", or the
// golden wheel's "GOLDEN PRIZE WHEEL"), a reel of slots (model_bonusslot.dat: the item's icon
// and name) stacked 2 units apart that spins for 4 seconds on an exponential ease-out and lands
// on the list's first prize, which opens with prizewheel_prize.ogg (prizewheel_spin_open.ogg as
// it starts). The level-end window waits for the wheel before it moves on.
//
// What the server decides is not in the client. Rebuilt from the wiki's Prize Wheel page
// (the facts and the guesses live in src/game/droprates.ts):
// - the wheel turns after a floor with monsters (no wheel at terminals, subtowns, lobbies, the
//   Core);
// - prizes: crowns (always 5, 10, 25 or 50, more deeper), materials (better deeper), a heart
//   healing as many pips as the wheel's tier, the much rarer Full Health, and a pickup by the
//   belt's rules (a random one on an empty belt, maybe another of a stack that is not full,
//   and never one that would replace what is there).
// The odds and the crowns by tier are GUESSES (the wiki gives none); lockboxes and the
// Kleptolisk's empty slot (events) are left out.

import { tierOf, WHEEL_CROWNS_BY_TIER, WHEEL_ODDS } from "./droprates";

export type PrizeKind = "crowns" | "heart" | "material" | "pickup";

/** One slot of the reel: an item config name and how many. */
export interface Prize { kind: PrizeKind; item: string; count: number }

/** The reel's spin in seconds (dungeon/client/c: 4000 ms). */
export const SPIN_TIME = 4;
/** Slots on the reel (the server's list length is not known; enough to blur past). */
export const REEL_LENGTH = 12;

/** The crown items (Instant/Crown/*) by their worth (their InstantAction number). */
export const CROWN_ITEMS: Record<number, string> = {
  1: "Instant/Crown/Copper Crown", 5: "Instant/Crown/Copper-Silver Crown", 10: "Instant/Crown/Silver Crown",
  25: "Instant/Crown/Silver-Gold Crown", 50: "Instant/Crown/Gold Crown",
};
/** The heart items: Heart 1 to 3 heal 40 a pip, Heart Full all of it (their Heal action). */
export const HEART_ITEMS = ["Instant/Heart/Heart 1", "Instant/Heart/Heart 2", "Instant/Heart/Heart 3"];
export const FULL_HEALTH = "Instant/Heart/Heart Full";

/** The Clockworks tier of a depth, as the world's drops count it: 2 from Moorcroft (8), 3 from Emberlight (18). */
export function wheelTier(depth: number): 1 | 2 | 3 {
  return tierOf(depth);
}

/** The crowns a tier's wheel can give (GUESS within the wiki's 5, 10, 25 or 50: droprates.ts). */
export function crownChoices(tier: number): number[] {
  return WHEEL_CROWNS_BY_TIER[Math.min(3, Math.max(1, tier)) as 1 | 2 | 3];
}

/** GUESSED odds of each kind of prize (droprates.ts WHEEL_ODDS; the wiki gives none). */
export const PRIZE_ODDS = WHEEL_ODDS;

export interface PrizeSource {
  depth: number;
  /** A material for the depth (the drop pool's pick by depth weight), or null. */
  material(): string | null;
  /**
   * A pickup for the tier (Treasure/Pickups/Pickups N) that the belt takes, or null: the
   * world applies the wiki's belt rules (droprates.ts wheelPickup).
   */
  pickup(): string | null;
}

/** Rolls one prize. Materials and pickups fall back to crowns when the source has none. */
export function rollPrize(src: PrizeSource, rand: () => number = Math.random): Prize {
  const tier = wheelTier(src.depth);
  let r = rand(), kind: PrizeKind | "full" = "crowns";
  for (const [k, w] of PRIZE_ODDS) { if (r < w) { kind = k; break; } r -= w; }
  const crowns = (): Prize => {
    const c = crownChoices(tier), n = c[Math.min(c.length - 1, Math.floor(rand() * c.length))];
    return { kind: "crowns", item: CROWN_ITEMS[n], count: n };
  };
  switch (kind) {
    case "material": { const m = src.material(); return m ? { kind: "material", item: m, count: 1 } : crowns(); }
    case "pickup": { const p = src.pickup(); return p ? { kind: "pickup", item: p, count: 1 } : crowns(); }
    case "heart": return { kind: "heart", item: HEART_ITEMS[tier - 1], count: 1 };
    case "full": return { kind: "heart", item: FULL_HEALTH, count: 1 };
    default: return crowns();
  }
}

/** The reel the client spins: the prize first (where it lands), then other rolls. */
export function buildReel(src: PrizeSource, rand: () => number = Math.random, length = REEL_LENGTH): Prize[] {
  const out: Prize[] = [];
  for (let i = 0; i < length; i++) out.push(rollPrize(src, rand));
  return out;
}

/**
 * Where the reel is `t` seconds into the spin (casino/a/a.ag): the slot index at the window's
 * centre, as a fraction. The models are built last prize first (index n-1 is lockboxPrizes[0])
 * and slide 2 units each; the expo-out ease runs from 0.35 of a slot below the first to the
 * last. Here 0 is the reel's first slot at the start and n-1 the landing on the prize.
 */
export function reelPosition(t: number, n: number, spin = SPIN_TIME): number {
  const e = Math.min(1, Math.max(0, t / spin));
  // var2 = 2(n-1) - 0.7; var3 = var2 (1 - 2^(-10 e)) + 0.7, in units of 2 per slot
  const travel = 2 * (n - 1) - 0.7;
  const at = travel * (1 - Math.pow(2, -10 * e)) + 0.7;
  // at the end (e = 1) the ease stops just short of 1; the client snaps the last model to 0
  return e >= 1 ? n - 1 : at / 2;
}

/** The wheel turns after floors with monsters, not at lobbies, terminals, subtowns or the Core. */
export function floorHasWheel(kind: string | undefined, kills: number): boolean {
  if (kind && /^(lobby|terminal|subtown|core)$/.test(kind)) return false;
  return kills > 0;
}
