// Energy, the game's second currency, kept by its servers. What the install and the wiki give:
//
// - The client's own UI: the arsenal's energy module (ui/energy/interface.dat, "Remaining
//   Energy"), the energy row of the shop cart, the revive window's Buy mode with its spark
//   cost, and the Get Energy mini panel (ui/exchange/mini_getenergy.dat: "Get 100 [energy] for
//   6500 [crowns]", the exchange's instant buy, i.mini_buy "Instantly buy energy with crowns at
//   the energy exchange"). Its text still names the old Mist Energy (t.mist_tip "Remaining Mist
//   Energy", m.use_energy "Use a mist tank").
// - The server defaults the client carries (admin/data/CostsConfigObject):
//   dungeonSparkOfLifeCost 50, guildFormationEnergy 500.
// - item_property.dat's depotCost: what the Supply Depot asks in energy (Heat Bonus 800 for two
//   days, 1600 for seven, 5000 for thirty; Spark of Life 200 for ten; the Orbs of Alchemy 10,
//   50, 200, 400 and 800 a pack of three, by star).
// - The wiki (Energy, Revive, Spark of Life, Orb of Alchemy, Heat Amplifier; read 2026-10-14):
//   energy gates and danger rooms 3, mecha knights and turrets 5; a spark bought on the spot
//   50; a craft takes three orbs of its star (Calibur: 3 Simple Orbs, Leviathan Blade: 3
//   Eternal Orbs).
//
// The single-player source (ours, from the game's history): before the 2013-07-30 release
// every knight had a free Mist Energy tank of 100 that refilled over 22 hours, beside the
// Crystal Energy bought for money. Here the mist tank comes back, and Crystal Energy is had
// only at the exchange's instant rate for crowns (no real money). Spending takes mist first.

/** The knight's energy (kept in the save). */
export interface EnergyState {
  /** Mist Energy in the tank when `at` was stamped (it refills from there). */
  mist: number;
  /** When `mist` was last stamped (ms). */
  at: number;
  /** Crystal Energy: bought at the exchange, never lost unless spent. */
  crystal: number;
}

/** The mist tank: 100, refilled over 22 hours (the game before 2013-07-30). */
export const MIST_MAX = 100;
export const MIST_REFILL_MS = 22 * 3600_000;
/** The exchange's instant buy: 100 energy for 6500 crowns (the client's Get Energy panel). */
export const EXCHANGE_ENERGY = 100;
export const EXCHANGE_CROWNS = 6500;
/** Crowns one point of energy costs at that rate. */
export const ENERGY_CROWNS = EXCHANGE_CROWNS / EXCHANGE_ENERGY;
/** A Spark of Life bought in the knockout window (CostsConfigObject dungeonSparkOfLifeCost). */
export const SPARK_COST = 50;
/** Orbs a craft takes (three of the recipe's star: the wiki's recipes). */
export const ORBS_PER_CRAFT = 3;
/** The orbs by star rating 1-5 (Rarity/Orb of Alchemy/...). */
export const ORBS = ["", "Rarity/Orb of Alchemy/Flawed", "Rarity/Orb of Alchemy/Simple", "Rarity/Orb of Alchemy/Advanced",
  "Rarity/Orb of Alchemy/Elite", "Rarity/Orb of Alchemy/Eternal"];
export const orbFor = (rarity: number) => ORBS[Math.max(1, Math.min(5, rarity))];

export const freshEnergy = (now = Date.now()): EnergyState => ({ mist: MIST_MAX, at: now, crystal: 0 });

/** Energy from a save, repaired (a new knight starts with a full tank). */
export function normalizeEnergy(x: unknown, now = Date.now()): EnergyState {
  const e = x as Partial<EnergyState> | null;
  if (!e || typeof e !== "object") return freshEnergy(now);
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return { mist: Math.max(0, Math.min(MIST_MAX, num(e.mist, MIST_MAX))), at: Math.min(now, num(e.at, now)), crystal: Math.max(0, Math.floor(num(e.crystal, 0))) };
}

/** The mist in the tank now (whole points), refilled since it was stamped. */
export function mistNow(e: EnergyState, now = Date.now()): number {
  const refill = Math.max(0, now - e.at) * MIST_MAX / MIST_REFILL_MS;
  return Math.floor(Math.min(MIST_MAX, e.mist + refill));
}

/** All the energy the knight can spend now. */
export const energyNow = (e: EnergyState, now = Date.now()) => mistNow(e, now) + e.crystal;

/** Milliseconds until the tank is full again (0 when it is). */
export function mistFullIn(e: EnergyState, now = Date.now()): number {
  const m = Math.min(MIST_MAX, e.mist + Math.max(0, now - e.at) * MIST_MAX / MIST_REFILL_MS);
  return m >= MIST_MAX ? 0 : Math.ceil((MIST_MAX - m) * MIST_REFILL_MS / MIST_MAX);
}

/** Stamps the tank: the refill so far is banked into `mist` (partial points kept). */
function stamp(e: EnergyState, now: number) {
  e.mist = Math.min(MIST_MAX, e.mist + Math.max(0, now - e.at) * MIST_MAX / MIST_REFILL_MS);
  e.at = now;
}

/** Spends energy, mist first; false (and nothing spent) when there is not enough. */
export function spendEnergy(e: EnergyState, amount: number, now = Date.now()): boolean {
  const n = Math.max(0, Math.ceil(amount));
  if (energyNow(e, now) < n) return false;
  stamp(e, now);
  const fromMist = Math.min(Math.floor(e.mist), n);
  e.mist -= fromMist;
  e.crystal -= n - fromMist;
  return true;
}

/** Crowns the exchange asks for `amount` energy, in whole lots of 100. */
export const exchangeCost = (amount: number) => Math.ceil(Math.max(0, amount) / EXCHANGE_ENERGY) * EXCHANGE_CROWNS;

/**
 * The exchange's instant buy: `lots` of 100 Crystal Energy for crowns. Returns false (and
 * changes nothing) when the crowns do not cover it.
 */
export function buyEnergy(w: { crowns: number }, e: EnergyState, lots = 1): boolean {
  const cost = lots * EXCHANGE_CROWNS;
  if (lots <= 0 || w.crowns < cost) return false;
  w.crowns -= cost;
  e.crystal += lots * EXCHANGE_ENERGY;
  return true;
}

/**
 * Pays an energy price, buying the shortfall at the exchange first (whole lots of 100, as
 * the Get Energy panel does) when the knight's crowns cover it. `crowns` pays for the lots
 * (the floor's then the bank's, say); it returns false when it cannot. Returns whether it was paid.
 */
export function payEnergy(e: EnergyState, amount: number, crowns: (n: number) => boolean, now = Date.now()): boolean {
  const short = Math.max(0, Math.ceil(amount) - energyNow(e, now));
  if (short > 0) {
    const lots = Math.ceil(short / EXCHANGE_ENERGY);
    if (!crowns(lots * EXCHANGE_CROWNS)) return false;
    e.crystal += lots * EXCHANGE_ENERGY;
  }
  return spendEnergy(e, amount, now);
}

/** "1,234 energy (mist 80)": the energy line the windows show. */
export function energyLine(e: EnergyState, now = Date.now()): string {
  const m = mistNow(e, now), t = m + e.crystal;
  return `${t.toLocaleString("en-US")} energy (mist ${m}/${MIST_MAX}${e.crystal ? `, crystal ${e.crystal.toLocaleString("en-US")}` : ""})`;
}
