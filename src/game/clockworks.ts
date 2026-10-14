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
import { lockNext, STRATA as REAL_STRATA, type RealGate, type RealLevel } from "./gatemap";
import { firstKey, levelText, monsterName } from "./text";

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
  { key: "den", name: "Wolver Den", tileset: "sky-night", families: ["Beast", "Undead"] },
  { key: "grove", name: "Lichenous Lumberyard", tileset: "sky-autumn", families: ["Slime", "Construct", "Beast"] },
  { key: "keep", name: "Candlestick Keep", tileset: "castle", families: ["Fiend", "Undead", "Gremlin"] },
  { key: "graveyard", name: "Graveyard", tileset: "graveyard", families: ["Undead", "Fiend"] },
  { key: "compound", name: "Gremlin Compound", tileset: "city", families: ["Gremlin", "Construct"] },
  { key: "deconstruction", name: "Deconstruction Zone", tileset: "clockworks-white", families: ["Construct", "Gremlin"] },
  { key: "frostwood", name: "Frosty Islands", tileset: "sky-winter", families: ["Beast", "Slime", "Construct"] },
  { key: "halls", name: "Dark Halls", tileset: "castle-light", families: ["Undead", "Fiend", "Beast"] },
  { key: "pools", name: "Frozen Pools", tileset: "ice", families: ["Slime", "Beast", "Undead"] },
  // the game's own level sets the player's archive holds (src/game/archive.ts), with the
  // families their strata have on the wiki
  { key: "drudgery", name: "Devilish Drudgery", tileset: "castle-fire", families: ["Fiend"] },
  { key: "lair", name: "Lichenous Lair", tileset: "sky-autumn", families: ["Slime"] },
  { key: "arena", name: "Battle Arena", tileset: "clockworks", families: ["Construct", "Gremlin", "Slime", "Beast", "Fiend", "Undead"] },
  { key: "aurora", name: "Aurora Isles", tileset: "valley", families: ["Beast", "Slime"], cached: /^aurora isles/i },
  { key: "cradle", name: "Starlight Cradle", tileset: "sky-night", families: ["Slime"], cached: /^starlight cradle/i },
  { key: "jungle", name: "Concrete Jungle", tileset: "city", families: ["Slime", "Undead"], cached: /^concrete jungle/i },
  { key: "darkcity", name: "Dark City", tileset: "castle-fire", families: ["Fiend", "Undead"], cached: /^dark city/i },
  { key: "fortress", name: "Scarlet Fortress", tileset: "castle", families: ["Undead", "Fiend"], cached: /^(lost castle|scarlet fortress)/i },
];

/** Element strata paint their floors with the element's Clockworks tileset. */
const ELEMENT_TILESETS: Record<string, string> = { Fire: "clockworks-fire", Freeze: "clockworks-freeze", Poison: "clockworks-poison", Shock: "clockworks-shock" };

export type BossKey = "jelly" | "snarbolax" | "twins" | "vanaduke";
/** The four bosses: their levels, tiers, and the actors their arenas start (all in config/actor.dat). */
export const BOSSES: Record<BossKey, { name: string; level: string; tier: number; actors: string[]; tileset: string; nameKey: string; levelKey: string;
  /** The boss stratum's levels in order, by their dungeon bundle keys (the last is the boss's). */
  stages: string[] }> = {
  jelly: { name: "Royal Jelly", level: "Royal Jelly Palace", tier: 1, actors: ["Character/NPC/Monster/Boss/Royal Jelly/Royal Jelly 1"], tileset: "castle",
    nameKey: "n.royal_jelly", levelKey: "m.royal_jelly_lair", stages: ["m.royal_jelly_garden", "m.royal_jelly_court", "m.royal_jelly_lair"] },
  snarbolax: { name: "Snarbolax", level: "Gloaming Wildwoods", tier: 1, actors: ["Character/NPC/Monster/Boss/Snarbolax/Snarbolax"], tileset: "sky-night",
    nameKey: "n.snarbolax", levelKey: "m.gloaming_wildwoods_snarbolax",
    stages: ["m.gloaming_wildwoods_path", "m.gloaming_wildwoods_ruins", "m.gloaming_wildwoods_snarbolax"] },
  twins: { name: "Roarmulus Twins", level: "Ironclaw Munitions Factory", tier: 2,
    actors: ["Character/NPC/Monster/Boss/Roarmulus Twins/East", "Character/NPC/Monster/Boss/Roarmulus Twins/West"], tileset: "clockworks",
    nameKey: "n.roarmulus_twins", levelKey: "m.ironclaw_munitions_factory_twins",
    stages: ["m.ironclaw_munitions_factory_assembly", "m.ironclaw_munitions_factory_workshop", "m.ironclaw_munitions_factory_twins"] },
  vanaduke: { name: "Lord Vanaduke", level: "Firestorm Citadel", tier: 3, actors: ["Character/NPC/Monster/Boss/Vanaduke/Stage 1"], tileset: "castle-fire",
    nameKey: "n.vanaduke", levelKey: "m.firestorm_citadel_vanaduke",
    stages: ["m.firestorm_citadel_blackstone_bridge", "m.firestorm_citadel_charred_court", "m.firestorm_citadel_ash_armory",
      "m.firestorm_citadel_smoldering_steps", "m.firestorm_citadel_vanaduke"] },
};

/** A boss's name in the monster bundle (our English without it). */
export const bossName = (b: BossKey) => monsterName({ nameKey: BOSSES[b].nameKey, name: BOSSES[b].name }, BOSSES[b].name);

/**
 * Dungeon bundle keys for the level styles' names: "<prefix>_<theme>" when the game has that
 * theme's variant (its subtitle becomes the zone line), else the first key listed. Styles of
 * our own, with no level of that name in the game, keep their names.
 */
const STYLE_KEYS: Record<string, string[]> = {
  tunnels: ["m.ct", "m.ct_construct"], valley: ["m.jigsaw_valley", "m.jigsaw_valley_emerald_axis"], den: ["m.wolver_den", "m.wolver_den_fire"],
  keep: ["m.candlestick_keep", "m.candlestick_keep_fire"], graveyard: ["m.graveyard", "m.graveyard_fire"],
  deconstruction: ["m.deconstruction_zone", "m.deconstruction_zone_fire"],
  drudgery: ["m.devilish_drudgery", "m.devilish_drudgery_vanilla"], lair: ["m.lichenous_lair", "m.lichenous_lair_vanilla"],
  arena: ["m.iea", "m.iea_beast"], aurora: ["m.aurora_isles", "m.aurora_isles_stone_grove"], cradle: ["m.starlight_cradle", "m.starlight_cradle_meteor_mile"],
  jungle: ["m.concrete_jungle", "m.concrete_jungle_blight_boulevard"], darkcity: ["m.dark_city", "m.dark_city_devilish_drudgery"],
  fortress: ["m.lost_castle", "m.lost_castle_cravat_hall"],
};

/** The game's name (and zone line, for a theme of its own) for a stratum's levels. */
function styleText(s: Stratum): { title: string; zone: string } {
  const keys = STYLE_KEYS[s.style.key];
  if (!keys) return { title: s.style.name, zone: "" };
  const own = firstKey("dungeon", [keys[0] + "_" + s.theme.toLowerCase()]);
  const t = levelText(own ?? keys[1]);
  return t ? { title: t.title, zone: own ? t.zone : "" } : { title: s.style.name, zone: "" };
}

/** A fixed level's title and zone from the dungeon bundle, else our English. */
function fixedText(key: string, title: string, zone = "") {
  return levelText(key) ?? { title, zone };
}

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

/** The gate lineup's level icon (rsrc/ui/icon/map/<icon>.png) for a level style. */
export const STYLE_ICONS: Record<string, string> = {
  tunnels: "clockwork", valley: "island", den: "woods", grove: "island", keep: "castle", graveyard: "graveyard",
  compound: "city", deconstruction: "decon", frostwood: "island", halls: "castle", pools: "island",
  drudgery: "castle", lair: "island", arena: "arena", aurora: "island", cradle: "island", jungle: "city", darkcity: "city", fortress: "castle",
};

/** A floor's lineup icon. */
export function floorIcon(f: { kind: string; stratum: Stratum | null }): string {
  switch (f.kind) {
    case "lobby": return "lobby";
    case "terminal": return "terminal";
    case "subtown": return "town";
    case "core": return "core";
    case "boss": return "boss";
    default: return STYLE_ICONS[f.stratum?.style.key ?? ""] ?? "monsters";
  }
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
  /** The loading screen's zone line, when the game's text has one for the floor. */
  zone?: string;
  /**
   * The game's own level for this floor, by its dungeon bundle key ("m.royal_jelly_court"):
   * a boss stratum's stages. Played from the level archive when it holds it.
   */
  levelKey?: string;
  /** A real gate's floor: the level this depth's elevator led to, and its place on the wheel. */
  level?: RealLevel;
  wedge?: number;
}

export interface Gate {
  id: string; name: string; seed: number; strata: Stratum[]; emblem: string;
  /** A real gate (src/game/gatemap.ts): its wheels, levels and colour. */
  real?: RealGate;
}

const STRATA: [number, number, number][] = [[1, 1, 3], [1, 5, 7], [2, 9, 12], [2, 14, 17], [3, 19, 22], [3, 24, 28]];
/** The Arcade's gate emblems (rsrc/ui/icon/gate/<emblem>.png); a gate is named for its emblem. */
const EMBLEMS = ["pawn", "rook", "knight", "bishop", "queen", "king", "lion", "falcon", "serpent", "sparrow", "sun", "titan", "clover", "dragonfly", "phantom", "skull"];

/** A gate from a seed: six strata with themes, styles and (sometimes) a boss. */
export function makeGate(seed: number, index = 0, emblemIndex?: number): Gate {
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
  const emblem = EMBLEMS[(emblemIndex ?? seed + index * 7) % EMBLEMS.length];
  return { id: `gate${index}-${seed}`, name: emblem[0].toUpperCase() + emblem.slice(1) + " Gate", seed, strata, emblem };
}

/** The Arcade's four gates for a day (gates rotate daily). */
export function arcadeGates(day = Math.floor(Date.now() / 86400000)): Gate[] {
  // four different emblems a day
  const first = (day * 5) % EMBLEMS.length;
  return [0, 1, 2, 3].map(i => makeGate((day * 4 + i) * 2654435761 >>> 0, i, first + i * 3));
}

/** A real gate's stratum theme: the file's theme, a status the port has no monsters for as its nearest family. */
function realTheme(t: string | undefined): StratumTheme {
  const k = (t ?? "").toLowerCase();
  const all = [...FAMILIES, ...ELEMENTS] as StratumTheme[];
  return all.find(x => x.toLowerCase() === k) ?? (k === "sleep" ? "Slime" : k === "curse" ? "Undead" : k === "stun" ? "Construct" : "Construct");
}

/** A gate of the Arcade from its real data: strata with the file's themes, their styles and bosses read off their levels. */
export function realGate(rg: RealGate): Gate {
  const strata: Stratum[] = REAL_STRATA.map(([tier, first, last], i) => {
    const levels = rg.wheels.slice(first, last + 1).flatMap(w => w.options);
    const boss = levels.find(l => l.kind === "boss")?.boss ?? null;
    // the stratum's style: its most common level style
    const counts = new Map<string, number>();
    for (const l of levels) if (l.style) counts.set(l.style, (counts.get(l.style) ?? 0) + 1);
    const key = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "tunnels";
    const style = STYLES.find(s => s.key === key) ?? STYLES[0];
    return { index: i + 1, tier, theme: realTheme(rg.themes[i]), style, boss, first, last };
  });
  const seed = Number(rg.entry.date) >>> 0;
  return { id: `gate:${rg.entry.date}_${rg.entry.colour}_${rg.entry.symbol}`, name: rg.name, seed, strata, emblem: rg.entry.symbol, real: rg };
}

/** A real gate's floor at a depth, for the wedge (level) its elevator leads to. */
export function realFloor(g: Gate, depth: number, wedge: number): Floor {
  const rg = g.real!, w = rg.wheels[depth];
  const lv = w.options[Math.min(Math.max(0, wedge), w.options.length - 1)];
  const tier = depth >= 18 ? 3 : depth >= 8 ? 2 : 1;
  const stratum = g.strata.find(x => depth >= x.first && depth <= x.last) ?? null;
  const base = { depth, tier, stratum, name: lv.title, ...(lv.subtitle ? { zone: lv.subtitle } : {}), level: lv, wedge, tileset: "" };
  switch (lv.kind) {
    case "lobby": return { ...base, kind: "lobby" };
    case "terminal": return { ...base, kind: "terminal" };
    case "town": return { ...base, kind: "subtown" };
    case "core": return { ...base, kind: "core" };
  }
  const style = STYLES.find(s => s.key === lv.style);
  const tileset = lv.boss ? BOSSES[lv.boss].tileset : lv.element ? ELEMENT_TILESETS[lv.element] : style?.tileset ?? "clockworks";
  if (lv.kind === "boss") return { ...base, kind: "boss", tileset, levelKey: lv.key };
  return { ...base, kind: "level", tileset: lv.kind === "vault" ? "prize-vault" : tileset, levelKey: lv.key,
    ...(lv.kind === "vault" ? { special: "vault" as const } : {}) };
}

/** Every floor of a gate, indexed by depth (0 to 29). */
export function gateFloors(g: Gate, t = Date.now()): Floor[] {
  if (g.real) {
    // the levels the elevators lead to now (randomised depths decided by the gate's seed)
    const rand = rng(g.seed ^ 0x5bd1e995);
    const out: Floor[] = [realFloor(g, 0, 0)];
    for (let d = 0; d < 29; d++) out.push(realFloor(g, d + 1, lockNext(g.real, d, out[d].wedge ?? 0, t, rand)));
    return out;
  }
  const floors: Floor[] = [];
  const tierOf = (d: number) => (d >= 18 ? 3 : d >= 8 ? 2 : 1);
  for (let d = 0; d <= 29; d++) {
    const s = g.strata.find(x => d >= x.first && d <= x.last) ?? null;
    const base = { depth: d, tier: tierOf(d), stratum: s };
    const named = (t: { title: string; zone: string }) => ({ name: t.title, ...(t.zone ? { zone: t.zone } : {}) });
    if (d === 0) floors.push({ ...base, kind: "lobby", ...named(fixedText("m.arcade_lobby", "Arcade")), tileset: "" });
    else if (d === 4 || d === 13 || d === 23) floors.push({ ...base, kind: "terminal", ...named(fixedText("m.terminal_1", "Clockwork Terminal")), tileset: "" });
    else if (d === 8) floors.push({ ...base, kind: "subtown", ...named(fixedText("m.moorcroft", "Moorcroft Manor")), tileset: "" });
    else if (d === 18) floors.push({ ...base, kind: "subtown", ...named(fixedText("m.emberlight", "Emberlight")), tileset: "" });
    else if (d === 29) floors.push({ ...base, kind: "core", ...named(fixedText("m.core_1", "Terminal above the Core")), tileset: "" });
    else if (s && s.boss && d === s.last) {
      const b = BOSSES[s.boss];
      floors.push({ ...base, kind: "boss", ...named(fixedText(b.levelKey, b.level)), tileset: b.tileset, levelKey: b.levelKey });
    } else if (s && s.boss && d > s.last - BOSSES[s.boss].stages.length) {
      // the floors before a boss are its stratum's own levels (the Wildwoods' Terrilous Trail and
      // Roarsterous Ruins before the Snarbolax's lair), as many as the stratum has depths for
      const b = BOSSES[s.boss], key = b.stages[b.stages.length - 1 - (s.last - d)];
      floors.push({ ...base, kind: "level", ...named(fixedText(key, b.level)), tileset: b.tileset, levelKey: key });
    } else if (s) {
      const element = ELEMENT_TILESETS[s.theme];
      floors.push({ ...base, kind: "level", ...named(styleText(s)), tileset: element ?? s.style.tileset });
    }
  }
  // special floors: in each stratum, one level floor (never its first) may be a treasure
  // vault, a floor with a danger room, or an arena; the game's gates mix such floors into
  // their strata the same way (the lineups are server-side, so the odds are ours)
  const rand = rng((g.seed ^ 0x6a09e667) >>> 0);
  for (const s of g.strata) {
    const levels = floors.filter(f => f.kind === "level" && f.stratum === s && f.depth > s.first && !f.levelKey);
    const roll = rand(), which = rand(), at = rand();
    if (!levels.length || roll >= SPECIAL_CHANCE) continue;
    const f = levels[Math.floor(at * levels.length)];
    f.special = which < 0.3 ? "vault" : which < 0.65 ? "danger" : "arena";
    const title = styleText(s).title;
    if (f.special === "vault") {
      const t = fixedText(firstKey("dungeon", ["m.tvault_" + s.theme.toLowerCase()]) ?? "m.tvault_vanilla", "Treasure Vault");
      f.name = t.title; f.zone = t.zone || undefined; f.tileset = "prize-vault";
    } else if (f.special === "arena") f.name = `${title} Arena`;
    else f.name = `${title}, Danger Room`;
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
  // element strata field the element's variants of every family (Ash Tails, Hotrodes, Firo
  // Knights for fire...), a handful per stratum
  const pool = [...ELEMENT_MONSTERS[theme]].sort(() => rand() - 0.5).slice(0, 6);
  return pool.map(m => `Monster/Class {stc}/Family/${m}`);
}

/** Each element's monster variants (spawn tables under Monster/Class {stc}/Family/). */
const ELEMENT_MONSTERS: Record<string, string[]> = {
  Fire: ["Beast/Wolver/Ash Tail", "Beast/Chromalisk/Salamander", "Beast/Dust Bunny/Toast Bunny", "Construct/Retrode/Hotrode", "Construct/Mecha Knight/Firo Knight", "Construct/Gun Puppy/Red Rover", "Construct/Lumber/Redward", "Construct/Scuttlebot/Cinderbot", "Fiend/Devilite/Firebrander", "Fiend/Gorgo/Firegut", "Gremlin/Mortafire/Blazing Mortafire", "Gremlin/Thwacker/Scorcher", "Gremlin/Knocker/Lighter", "Slime/Glop Drop/Spice Drop", "Slime/Jelly Cube/Toxilargo, Fire", "Undead/Bombie/Fire Bombie", "Undead/Deadnaught/Fire Deadnaught", "Undead/Grave Scarab/Sun Scarab", "Undead/Howlizter/Smoking Howlitzer", "Undead/Spookat/Pepper Kat"],
  Freeze: ["Beast/Wolver/Frostifur", "Beast/Chromalisk/Tundralisk", "Beast/Dust Bunny/Snow Bunny", "Construct/Retrode/Sleetrode", "Construct/Mecha Knight/Cryo Knight", "Construct/Gun Puppy/Slush Puppy", "Construct/Lumber/Silversap", "Construct/Scuttlebot/Brumabot", "Gremlin/Mortafire/Icy Mortafire", "Gremlin/Knocker/Cooler", "Slime/Glop Drop/Snow Drop", "Slime/Jelly Cube/Ice Cube", "Slime/Polyp/Polar Polyp", "Undead/Bombie/Freeze Bombie", "Undead/Deadnaught/Freeze Deadnaught", "Undead/Grave Scarab/Pale Scarab", "Undead/Howlizter/Chilling Howlitzer", "Undead/Spookat/Bloogato"],
  Shock: ["Beast/Wolver/Voltail", "Beast/Chromalisk/Electolisk", "Beast/Dust Bunny/Jolt Bunny", "Construct/Retrode/Voltrode", "Construct/Mecha Knight/Volt Knight", "Construct/Gun Puppy/Sparky", "Construct/Lumber/Electreant", "Gremlin/Mortafire/Static Mortafire", "Gremlin/Knocker/Jumper", "Slime/Glop Drop/Power Drop", "Slime/Jelly Cube/Quicksilver", "Slime/Polyp/Silver Polyp", "Undead/Bombie/Shock Bombie", "Undead/Deadnaught/Shock Deadnaught", "Undead/Grave Scarab/Silver Scarab", "Undead/Howlizter/Shocking Howlitzer", "Undead/Spookat/Statikat", "Fiend/Gorgo/Storm Belly"],
  Poison: ["Beast/Wolver/Rabid Wolver", "Beast/Chromalisk/Virulisk", "Beast/Dust Bunny/Blech Bunny", "Construct/Retrode/Isotrode", "Construct/Mecha Knight/Blight Knight", "Construct/Gun Puppy/Sick Puppy", "Construct/Lumber/Vilewood", "Gremlin/Mortafire/Toxic Mortafire", "Gremlin/Knocker/Choker", "Slime/Glop Drop/Germ Drop", "Slime/Jelly Cube/Toxigel", "Slime/Polyp/Caustic Polyp", "Undead/Bombie/Poison Bombie", "Undead/Deadnaught/Poison Deadnaught", "Undead/Grave Scarab/Plague Scarab", "Undead/Howlizter/Vile Howlitzer", "Undead/Spookat/Hurkat", "Fiend/Gorgo/Waster"],
};

/** Star rating of a tier's gear (shops and drops): tier 1 one to two stars, tier 2 three, tier 3 four to five. */
export const tierStars = (tier: number) => (tier === 1 ? 2 : tier === 2 ? 3 : 5);
