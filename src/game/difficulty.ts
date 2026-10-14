// The difficulty a gate or mission is played at (DungeonCodes.Difficulty) and the party
// configuration's preferences (ProjectXPrefs: difficulty, party_mode, the AUTO_CREATE prompt).
//
// The client's three difficulties, in order, with what each changes:
//
//   EASY   ("Normal",   m.difficulty_easy):   monster health x0.8, status power -20 (at least 10), reward scale 0.8
//   MEDIUM ("Advanced", m.difficulty_medium): monster health x1,   status power +0,                reward scale 1
//   HARD   ("Elite",    m.difficulty_hard):   monster health x1.25, status power +20 (at most 1000), reward scale 1.2
//
// The status changes and the monster health are applied by the world (src/game/status.ts,
// world.ts); the reward scale multiplies the spawn tables' modifyForDifficulty entries (the
// chance of OptionalEntry drops and the crowns and heat of ValueDepthListEntry), as
// SpawnTableConfig does; DifficultySwitchEntry and the depth scales' Difficulty nodes pick by
// it. A mission's rewards are tiered by difficulty too (MissionConfig.Reward.difficulty): a
// completion gives the tiers above the difficulty it was last done at, up to this one.
//
// The client's default difficulty is EASY (Difficulty.getDefault, "Normal"), and the default
// party mode JOIN (ProjectXPrefs.If).

import type { Difficulty } from "./depth";

export const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];

/** DungeonCodes.Difficulty's numbers. */
export const DIFFICULTY_SCALES: Record<Difficulty, { monsterHealth: number; statusPowerChange: number; reward: number }> = {
  easy: { monsterHealth: 0.8, statusPowerChange: -20, reward: 0.8 },
  medium: { monsterHealth: 1, statusPowerChange: 0, reward: 1 },
  hard: { monsterHealth: 1.25, statusPowerChange: 20, reward: 1.2 },
};

export const rewardScale = (d: Difficulty) => DIFFICULTY_SCALES[d]?.reward ?? 1;

/** A difficulty's place in the order (EASY 0, MEDIUM 1, HARD 2). */
export const difficultyIndex = (d: Difficulty | string | null | undefined) => Math.max(0, DIFFICULTIES.indexOf((d ?? "easy") as Difficulty));

/** A config's Difficulty enum ("EASY", {$enum, name}) as ours; null when there is none. */
export function difficultyOf(v: unknown): Difficulty | null {
  const name = v && typeof v === "object" && "name" in (v as any) ? String((v as any).name) : typeof v === "string" ? v.split(".").pop()! : "";
  const d = name.toLowerCase();
  return (DIFFICULTIES as readonly string[]).includes(d) ? d as Difficulty : null;
}

/** ProjectXPrefs.PartyMode: the party configuration's four buttons. */
export type PartyMode = "join" | "create" | "private" | "solo";

const PREF_DIFFICULTY = "clyde-web-pref-difficulty";
const PREF_PARTY = "clyde-web-pref-party_mode";
/** ConfirmPrompt.AUTO_CREATE: ask before starting a party when none can be joined (on by default). */
const PREF_AUTO_CREATE = "clyde-web-pref-auto_create";

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* storage unavailable */ }
}

/** The difficulty chosen in the party configuration (ProjectXPrefs.Bj), EASY by default. */
export function difficultyPref(): Difficulty {
  const v = read(PREF_DIFFICULTY);
  return (DIFFICULTIES as readonly string[]).includes(v ?? "") ? v as Difficulty : "easy";
}
export function setDifficultyPref(d: Difficulty) { write(PREF_DIFFICULTY, d); }

/** The party mode chosen (ProjectXPrefs.If), JOIN by default. */
export function partyModePref(): PartyMode {
  const v = read(PREF_PARTY);
  return v === "join" || v === "create" || v === "private" || v === "solo" ? v : "join";
}
export function setPartyModePref(m: PartyMode) { write(PREF_PARTY, m); }

/** Whether the "no party to join" prompt is asked (its "Don't ask again" box unticked). */
export function autoCreatePrompt(): boolean { return read(PREF_AUTO_CREATE) !== "0"; }
export function setAutoCreatePrompt(ask: boolean) { write(PREF_AUTO_CREATE, ask ? "1" : "0"); }
