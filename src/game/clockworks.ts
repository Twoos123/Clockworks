// The Clockworks: the Arcade's gates and the floors below them. A gate runs from depth 0 (the
// Arcade lobby) to depth 29 (the terminal above the Core) in three tiers of two strata each:
//
//   tier 1: depths 0-7    strata 1 (1-3) and 2 (5-7), terminal at 4
//   tier 2: depths 8-17   Moorcroft Manor at 8, strata 3 (9-12) and 4 (14-17), terminal at 13
//   tier 3: depths 18-28  Emberlight at 18, strata 5 (19-22) and 6 (24-28), terminal at 23
//   depth 29: the terminal above the Core
//
// Each stratum has a theme (a monster family or an element) and a level style; gate themes are
// random, and two strata of one tier never share a theme (the game's wiki). The gate lineups
// themselves come from the game's servers, so the choices here are our own, seeded per day.

import { rng } from "../gen/layout";

export const FAMILIES = ["Beast", "Construct", "Fiend", "Gremlin", "Slime", "Undead"] as const;
export const ELEMENTS = ["Fire", "Freeze", "Poison", "Shock"] as const;
export type Family = typeof FAMILIES[number];
export type StratumTheme = Family | typeof ELEMENTS[number];

/**
 * Level styles: how a floor looks (the tileset its generated layout is painted with) and which
 * monsters suit it. `tileset` names a generator theme (src/gen); `cached` matches cached scene
 * names of that style, used when the cache has them.
 */
export interface LevelStyle { key: string; name: string; tileset: string; families: Family[]; cached?: RegExp }
export const STYLES: LevelStyle[] = [
  { key: "tunnels", name: "Clockwork Tunnels", tileset: "clockworks", families: ["Construct", "Gremlin", "Slime", "Beast", "Fiend", "Undead"] },
  { key: "valley", name: "Jigsaw Valley", tileset: "valley", families: ["Construct", "Gremlin", "Slime", "Beast"], cached: /^jigsaw valley/i },
  { key: "den", name: "Wolver Den", tileset: "valley-night", families: ["Beast", "Undead"] },
  { key: "grove", name: "Lichenous Lumberyard", tileset: "valley-autumn", families: ["Slime", "Construct", "Beast"] },
  { key: "keep", name: "Candlestick Keep", tileset: "castle", families: ["Fiend", "Undead", "Gremlin"], cached: /^dark halls/i },
  { key: "graveyard", name: "Graveyard", tileset: "graveyard", families: ["Undead", "Fiend"] },
  { key: "compound", name: "Gremlin Compound", tileset: "city", families: ["Gremlin", "Construct"] },
  { key: "deconstruction", name: "Deconstruction Zone", tileset: "clockworks-white", families: ["Construct", "Gremlin"] },
];

/** Element strata paint their floors with the element's Clockworks tileset. */
const ELEMENT_TILESETS: Record<string, string> = { Fire: "clockworks-fire", Freeze: "clockworks-freeze", Poison: "clockworks-poison", Shock: "clockworks-shock" };

export type BossKey = "jelly" | "snarbolax" | "twins" | "vanaduke";
/** The four bosses: their levels, tiers, and the actors their arenas start (all in config/actor.dat). */
export const BOSSES: Record<BossKey, { name: string; level: string; tier: number; actors: string[]; tileset: string }> = {
  jelly: { name: "Royal Jelly", level: "Royal Jelly Palace", tier: 1, actors: ["Character/NPC/Monster/Boss/Royal Jelly/Royal Jelly 1"], tileset: "castle" },
  snarbolax: { name: "Snarbolax", level: "Gloaming Wildwoods", tier: 1, actors: ["Character/NPC/Monster/Boss/Snarbolax/Snarbolax"], tileset: "valley-night" },
  twins: { name: "Roarmulus Twins", level: "Ironclaw Munitions Factory", tier: 2,
    actors: ["Character/NPC/Monster/Boss/Roarmulus Twins/East", "Character/NPC/Monster/Boss/Roarmulus Twins/West"], tileset: "clockworks" },
  vanaduke: { name: "Lord Vanaduke", level: "Firestorm Citadel", tier: 3, actors: ["Character/NPC/Monster/Boss/Vanaduke/Stage 1"], tileset: "castle-fire" },
};

export interface Stratum {
  index: number;
  tier: number;
  theme: StratumTheme;
  style: LevelStyle;
  /** The stratum's last floor is this boss's level. */
  boss: BossKey | null;
  /** First and last depth. */
  first: number;
  last: number;
}

export type FloorKind = "lobby" | "level" | "terminal" | "subtown" | "boss" | "core";
export interface Floor {
  depth: number;
  kind: FloorKind;
  name: string;
  tier: number;
  stratum: Stratum | null;
  /** The generator theme to paint the floor with (levels and bosses). */
  tileset: string;
  /** A special level: a treasure vault, a floor with a danger room, or an arena (src/gen/features.ts). */
  special?: "vault" | "danger" | "arena";
}

export interface Gate { id: string; name: string; seed: number; strata: Stratum[] }

const STRATA: [number, number, number][] = [[1, 1, 3], [1, 5, 7], [2, 9, 12], [2, 14, 17], [3, 19, 22], [3, 24, 28]];
/** Gate names (the Arcade's gates are named for gems in the game; these are ours). */
const GATE_NAMES = ["Amber Gate", "Topaz Gate", "Emerald Gate", "Sapphire Gate", "Ruby Gate", "Amethyst Gate", "Pearl Gate", "Onyx Gate"];

/** A gate from a seed: six strata with themes, styles and (sometimes) a boss. */
export function makeGate(seed: number, index = 0): Gate {
  const rand = rng(seed);
  const pick = <T>(a: readonly T[]) => a[Math.floor(rand() * a.length)];
  const strata: Stratum[] = [];
  for (let i = 0; i < 6; i++) {
    const [tier, first, last] = STRATA[i];
    // two strata of a tier never share a theme
    const taken = strata.filter(s => s.tier === tier).map(s => s.theme);
    let theme: StratumTheme;
    do { theme = rand() < 0.7 ? pick(FAMILIES) : pick(ELEMENTS); } while (taken.includes(theme));
    const family = (FAMILIES as readonly string[]).includes(theme) ? theme as Family : null;
    const styles = STYLES.filter(s => !family || s.families.includes(family));
    const style = pick(styles.length ? styles : STYLES);
    // the second stratum of a tier may end in that tier's boss
    const bosses = (Object.keys(BOSSES) as BossKey[]).filter(b => BOSSES[b].tier === tier);
    const boss = i % 2 === 1 && rand() < 0.5 ? pick(bosses) : null;
    strata.push({ index: i + 1, tier, theme, style, boss, first, last });
  }
  return { id: `gate${index}-${seed}`, name: GATE_NAMES[(seed + index) % GATE_NAMES.length], seed, strata };
}

/** The Arcade's four gates for a day (gates rotate daily). */
export function arcadeGates(day = Math.floor(Date.now() / 86400000)): Gate[] {
  return [0, 1, 2, 3].map(i => makeGate((day * 4 + i) * 2654435761 >>> 0, i));
}

/** Every floor of a gate, indexed by depth (0 to 29). */
export function gateFloors(g: Gate): Floor[] {
  const floors: Floor[] = [];
  const tierOf = (d: number) => (d >= 18 ? 3 : d >= 8 ? 2 : 1);
  for (let d = 0; d <= 29; d++) {
    const s = g.strata.find(x => d >= x.first && d <= x.last) ?? null;
    const base = { depth: d, tier: tierOf(d), stratum: s };
    if (d === 0) floors.push({ ...base, kind: "lobby", name: "Arcade", tileset: "" });
    else if (d === 4 || d === 13 || d === 23) floors.push({ ...base, kind: "terminal", name: "Clockwork Terminal", tileset: "" });
    else if (d === 8) floors.push({ ...base, kind: "subtown", name: "Moorcroft Manor", tileset: "" });
    else if (d === 18) floors.push({ ...base, kind: "subtown", name: "Emberlight", tileset: "" });
    else if (d === 29) floors.push({ ...base, kind: "core", name: "Terminal above the Core", tileset: "" });
    else if (s && s.boss && d === s.last) floors.push({ ...base, kind: "boss", name: BOSSES[s.boss].level, tileset: BOSSES[s.boss].tileset });
    else if (s) {
      const element = ELEMENT_TILESETS[s.theme];
      floors.push({ ...base, kind: "level", name: s.style.name, tileset: element ?? s.style.tileset });
    }
  }
  // special floors: in each stratum, one level floor (never its first) may be a treasure
  // vault, a floor with a danger room, or an arena; the game's gates mix such floors into
  // their strata the same way (the lineups are server-side, so the odds are ours)
  const rand = rng((g.seed ^ 0x6a09e667) >>> 0);
  for (const s of g.strata) {
    const levels = floors.filter(f => f.kind === "level" && f.stratum === s && f.depth > s.first);
    const roll = rand(), which = rand(), at = rand();
    if (!levels.length || roll >= SPECIAL_CHANCE) continue;
    const f = levels[Math.floor(at * levels.length)];
    f.special = which < 0.3 ? "vault" : which < 0.65 ? "danger" : "arena";
    if (f.special === "vault") { f.name = "Treasure Vault"; f.tileset = "prize-vault"; }
    else if (f.special === "arena") f.name = `${s.style.name} Arena`;
    else f.name = `${s.style.name}, Danger Room`;
  }
  return floors;
}

/** The chance a stratum holds a special floor (vault, danger room or arena). */
export const SPECIAL_CHANCE = 0.6;

/**
 * Spawn tables for a stratum's monsters: the family's role tables (grunts, brutes, support,
 * turrets...) for family themes; element themes draw from every family's status variants.
 */
export function stratumTables(theme: StratumTheme, rand: () => number): string[] {
  if ((FAMILIES as readonly string[]).includes(theme)) {
    const roles = ["Grunt", "Grunt", "Brute", "Support", "Turret", "Elite", "Mini"];
    return roles.map(r => `Monster/Class {stc}/Family/${theme}/${theme} - ${r}`);
  }
  const fams = [...FAMILIES].sort(() => rand() - 0.5).slice(0, 2);
  return fams.flatMap(f => [`Monster/Class {stc}/Family/${f}/${f} - Grunt`, `Monster/Class {stc}/Family/${f}/${f} - Brute`]);
}

/** Star rating of a tier's gear (shops and drops): tier 1 one to two stars, tier 2 three, tier 3 four to five. */
export const tierStars = (tier: number) => (tier === 1 ? 2 : tier === 2 ? 3 : 5);
