// The forge: levelling gear with fire crystals. Gear gathers heat in the Clockworks, but a full
// heat bar does not raise its level: the item waits at the forge (LevelItem.N: heat progress
// at 1 below the top level, the HUD's forge button carrying its notice) until fire crystals of
// its star are applied (ItemCodes.bwC: Cracked for 0 stars up to Radiant for 5).
//
// What the install gives (config/forge_property.dat, ForgePropertyConfig "Star 0" to "Star 5",
// one ForgeProps per level step 1-2 ... 9-10, chosen by the item's LevelItemProps
// forgeProperty):
//   crystalsNeeded  the minimal, medium and maximum crystals (the forge's three buttons); fewer
//                   than the minimum cannot forge, and the step's crystals are capped at the maximum
//   success         the chance of success at each amount (ForgeProps.fj: the band an amount falls in)
//   bonuses         Heat Bonus, Skip Level, the tier's Forge Prize Box (locked for 0-2 stars), each
//                   offered from a band (minUnlock: 1 medium, 2 maximum); the last step has no
//                   heat bonus or skip
// The crystal counts are the wiki's "Fire Crystals Requirements" tables exactly (Forge, read
// 2026-10-14). The wiki's success chances are older (40% to 100% by band for 2-5 stars): the
// install's are 100% for every star's step, as the live client shows ("100% Guaranteed chance
// of forge success!" with the minimal 34 Radiant crystals at level 9), so the install's are
// used. Only the "Promo" table keeps 90%/95% bands.
//
// What neither gives (the server's ForgePropertyConfig.Bonus success, a transient field): the
// chance of each bonus. Ours, documented: a Heat Bonus 25% with the medium crystals and 50%
// with the maximum, a level skip 5% and 10%, a prize box 10% with the maximum; a forging wins
// at most one bonus (the server answers with one message). Failure loses the crystals and
// never the heat (wiki). The Heat Bonus adds 25% to the heat the item gains toward its next
// level (LevelItem._heatBonus); the forge prize boxes' spawn tables are server data, so a box
// opens at once into fire crystals of its tier (the step's minimal count), our stand-in for
// the wiki's "random assortment of various rarities".
//
// Where fire crystals come from in single play (the game's own sources, as the wiki's Fire
// Crystal page lists them): mission rewards (the install's Mission/Rank reward tables give
// Cracked, Dim, Warm and Glowing stacks), Clockworks treasure (the Treasure/Rarities tables'
// fire crystal entries, Warm from stratum 3 down to Radiant from depth 25, by the stack), and
// buying: the Supply Depot sells Warm to Radiant by fifty for energy (item_property.dat's
// Depot/Fire Crystal depotCost: 85, 175, 350, 700), and the forge's buy panel sells the
// crystal an item needs, Cracked and Dim by five for crowns (that config's buyPrice, 50 and
// 125: Vatel's price on the wiki).

/** The fire crystal for each star rating (ItemCodes.bwC). */
export const FIRE_CRYSTALS = [
  "Rarity/Fire Crystal/Cracked", "Rarity/Fire Crystal/Dim", "Rarity/Fire Crystal/Warm",
  "Rarity/Fire Crystal/Glowing", "Rarity/Fire Crystal/Shining", "Rarity/Fire Crystal/Radiant",
];
export const crystalFor = (rarity: number) => FIRE_CRYSTALS[Math.max(0, Math.min(5, Math.round(rarity)))];

export type ForgeBonusKind = "heat" | "skip" | "prize";
export interface ForgeBonus {
  kind: ForgeBonusKind;
  /** The crystal band it is offered from (0 minimal, 1 medium, 2 maximum). */
  minUnlock: number;
  /** A prize box's item. */
  item: string | null;
  /** LockedItemBonus: the box comes bound ("Locked"). */
  locked: boolean;
}
/** One level step's ForgeProps. */
export interface ForgeStep { crystals: [number, number, number]; success: [number, number, number]; bonuses: ForgeBonus[] }

/** The Heat Bonus: +25% heat toward the next level (m.bonus_heat_bonus). */
export const HEAT_BONUS = 0.25;
/** Our bonus chances by band (minimal, medium, maximum); see the header. */
export const BONUS_CHANCE: Record<ForgeBonusKind, [number, number, number]> = { heat: [0, 0.25, 0.5], skip: [0, 0.05, 0.1], prize: [0, 0, 0.1] };
/** The order bonuses are rolled in: the rarest first. */
const BONUS_ORDER: ForgeBonusKind[] = ["skip", "prize", "heat"];

const kind = (o: any) => { const c: string = o?.$class ?? ""; return c.substring(c.lastIndexOf("$") + 1); };
const triple = (v: any, d: number): [number, number, number] => {
  const a = v ? Array.from(v as ArrayLike<number>).map(Number) : [];
  return [a[0] ?? d, a[1] ?? d, a[2] ?? d];
};

/** A ForgePropertyConfig's steps (index 0 is level 1 to 2). */
export function forgeSteps(cfg: any): ForgeStep[] {
  return ((cfg?.props ?? []) as any[]).map(p => ({
    crystals: triple(p?.crystalsNeeded, 0),
    success: triple(p?.success, 0),
    bonuses: ((p?.bonuses ?? []) as any[]).flatMap((b): ForgeBonus[] => {
      const k = kind(b), minUnlock = Number(b?.minUnlock ?? 0);
      if (k === "HeatBonus") return [{ kind: "heat", minUnlock, item: null, locked: false }];
      if (k === "SkipLevel") return [{ kind: "skip", minUnlock, item: null, locked: false }];
      if (k === "ItemBonus" || k === "LockedItemBonus") return [{ kind: "prize", minUnlock, item: b?.item?.name ?? null, locked: k === "LockedItemBonus" }];
      return [];
    }),
  }));
}

/** ForgeProps.fj: the band an amount of crystals falls in (-1 below the minimum). */
export function crystalBand(step: ForgeStep, n: number): -1 | 0 | 1 | 2 {
  if (n < step.crystals[0]) return -1;
  if (n < step.crystals[1]) return 0;
  return n < step.crystals[2] ? 1 : 2;
}

/** ForgeProps.fi: the chance of success with `n` crystals. */
export function successChance(step: ForgeStep, n: number): number {
  const b = crystalBand(step, n);
  return b === -1 ? 0 : step.success[b];
}

/** ForgeProps.fl: the bonuses a band offers (none: "Add more fire crystals to unlock chances for bonuses!"). */
export function bonusesAt(step: ForgeStep, band: number): ForgeBonus[] {
  return step.bonuses.filter(b => band >= b.minUnlock);
}

/** The chance of a bonus in a band (ours). */
export const bonusChance = (b: ForgeBonus, band: number) => (band < 0 ? 0 : BONUS_CHANCE[b.kind][Math.min(2, band)]);

export interface ForgeOutcome {
  success: boolean;
  /** The bonus won, if any. */
  bonus: ForgeBonus | null;
}

/** Rolls a forging with `n` crystals: success, then at most one bonus. */
export function rollForge(step: ForgeStep, n: number, rand: () => number = Math.random): ForgeOutcome {
  const band = crystalBand(step, n);
  if (band < 0) return { success: false, bonus: null };
  if (rand() >= successChance(step, n)) return { success: false, bonus: null };
  const offered = bonusesAt(step, band);
  for (const k of BONUS_ORDER) {
    const b = offered.find(x => x.kind === k);
    if (b && rand() < bonusChance(b, band)) return { success: true, bonus: b };
  }
  return { success: true, bonus: null };
}

/** The level a successful forging reaches: one up, two with a skip (never past the top). */
export function forgedLevel(level: number, outcome: ForgeOutcome, max = 10): number {
  if (!outcome.success) return level;
  return Math.min(max, level + (outcome.bonus?.kind === "skip" ? 2 : 1));
}
