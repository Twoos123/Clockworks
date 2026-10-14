// The Arcade's real gates. The game's servers make a new gate every two days (at 22:00
// America/Chicago) and four are open at once. The community Gate Map
// (https://gatemap.knightlauncher.com/, silverhawke's gatemap-viewer) records each one from the
// game: its depths' level options, its six stratum themes, and how each depth's options rotate.
// The local server fetches and caches that data (server/gates.ts); this module reads it.
//
// Level codes. Each depth is a line of level codes ("tunnel beast freeze", "aurora jly",
// "rjp d1", "compound gremlin freeze slime"), led by the rotation direction ("r", "l") or
// "rand..." for a randomised depth; a line with no direction takes the opposite of the line
// before. Older files use keywords for whole fixed sets ("jv_ax", "s_gww"). The decoding below is
// written from the site's published format, not copied from its code.
//
// Rotation, as the client's GateSummary does it (dungeon/data/GateSummary, dungeon/util/o): a
// depth with several levels is a wheel turning at a constant `velocity` (radians a second) from
// its `start` (epoch ms), cut into wedges of `lengths` radians, one a level. The level the next
// depth's elevator leads to is the next wheel's wedge under the centre of this depth's wedge,
// so it changes as the two wheels turn against each other; a randomised wheel picks at random.
//
// Icons: the game draws a level's icon (ui/icon/map/<icon>.png) colourised in two zones, the red
// field by the level's status (colour class theme-status) and the magenta glyph by its monster
// family (theme-family); fixed sets, bosses and towns have colours of their own. The gate's
// emblem is its symbol (ui/icon/gate/<symbol>.png) in its colour. The colours of the fixed sets
// and the gate colours are offsets read off icons the game drew.

import { BOSSES, type BossKey, type Family } from "./clockworks";
import { levelText } from "./text";

export type Element = "Fire" | "Freeze" | "Poison" | "Shock";

/** One gate in the list: its date (YYYYMMDD), colour and symbol. */
export interface GateEntry { date: string; colour: string; symbol: string }

export interface RotationData { velocity: number; num_entries: number; lengths: number[]; start: number }
/** A gate's data file. */
export interface GateFile {
  levels: string[];
  themes?: string[];
  rotations?: ({ n: number; data: RotationData | null } | null)[];
}

/** What a level is, decoded from its code. */
export interface RealLevel {
  code: string;
  /** The dungeon bundle key of the game's level ("m.ct_beast"). */
  key: string;
  /** "Clockwork Tunnels" and "Wild Path" (the bundle's name, else ours). */
  title: string;
  subtitle: string;
  /** The map icon: ui/icon/map/<icon>.png. */
  icon: string;
  /** The icon's colourisations (ColorizationConfig objects). */
  colorizations: any[];
  kind: "level" | "boss" | "miniboss" | "vault" | "terminal" | "town" | "lobby" | "core";
  /** Level style (clockworks.ts STYLES key), for the generator when the archive lacks the level. */
  style: string | null;
  family: Family | null;
  element: Element | null;
  /** A boss stratum's stage or boss. */
  boss?: BossKey;
}

/** One depth of a gate: its levels and how they rotate. */
export interface Wheel {
  depth: number;
  options: RealLevel[];
  /** "l" or "r" (rotation direction), "?" randomised, "" a single level. */
  dir: "l" | "r" | "?" | "";
  random: boolean;
  /** Radians a second (signed); 0 for none. */
  velocity: number;
  lengths: number[];
  start: number;
  /** True when the rotation is the site's recorded one, false when ours (old gates without it). */
  recorded: boolean;
}

export interface RealGate {
  entry: GateEntry;
  /** "Coral King". */
  name: string;
  themes: string[];
  /** One wheel a depth, 0 (the Arcade's lobby) to 29 (the Core's terminal). */
  wheels: Wheel[];
}

// ---------------------------------------------------------------------------- names

export const GATE_COLOURS = ["amber", "copper", "coral", "dark", "diamond", "emerald", "golden", "iron", "jade", "onyx", "ruby", "sapphire", "silver"];
export const GATE_SYMBOLS = ["bishop", "clover", "falcon", "king", "knight", "lion", "pawn", "phantom", "queen", "rook", "serpent", "skull", "sun", "titan"];

const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;
/** "Coral King". */
export const gateName = (e: GateEntry) => `${cap(e.colour)} ${cap(e.symbol)}`;
/** "2026-10-13". */
export const gateDate = (e: GateEntry) => `${e.date.slice(0, 4)}-${e.date.slice(4, 6)}-${e.date.slice(6, 8)}`;

/** The gate list file (a JSON list of [date, colour, symbol]). */
export function parseGateList(text: string): GateEntry[] {
  const a = JSON.parse(text);
  if (!Array.isArray(a)) return [];
  return a.filter(e => Array.isArray(e) && e.length === 3 && /^\d{8}$/.test(e[0]))
    .map(([date, colour, symbol]) => ({ date, colour: String(colour).toLowerCase(), symbol: String(symbol).toLowerCase() }));
}

/** A gate data file: "##JSON" and a line of JSON. */
export function parseGateFile(text: string): GateFile | null {
  if (!text.startsWith("##JSON")) return null;
  try {
    const d = JSON.parse(text.slice(text.indexOf("\n") + 1));
    return d && Array.isArray(d.levels) ? d : null;
  } catch { return null; }
}

/** The file name of a gate's data: "20261013_coral_king". */
export const gateFileName = (e: GateEntry) => `${e.date}_${e.colour}_${e.symbol}`;

/**
 * When a gate opens: 22:00 America/Chicago the day before its date (the list's dates are a day
 * ahead). Central time is UTC-5 in daylight saving time (second Sunday of March to first Sunday
 * of November) and UTC-6 otherwise.
 */
export function gateOpens(e: GateEntry): number {
  const y = +e.date.slice(0, 4), m = +e.date.slice(4, 6) - 1, d = +e.date.slice(6, 8);
  const sunday = (month: number, nth: number) => { const first = new Date(Date.UTC(y, month, 1)).getUTCDay(); return 1 + ((7 - first) % 7) + (nth - 1) * 7; };
  const day = Date.UTC(y, m, d);
  const dst = day >= Date.UTC(y, 2, sunday(2, 2)) && day < Date.UTC(y, 10, sunday(10, 1));
  return Date.UTC(y, m, d - 1, 22 + (dst ? 5 : 6));
}

/** The gates open at a time: the four newest that have opened (newest first). */
export function activeGates(list: GateEntry[], now = Date.now()): GateEntry[] {
  return list.filter(e => gateOpens(e) <= now).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
}

// ---------------------------------------------------------------------------- colours

const CC = "com.threerings.opengl.renderer.config.ColorizationConfig";
/** A colour print of the colour pository (theme-family is class 8, theme-status class 9). */
const normal = (print: number) => ({ $class: `${CC}$Normal`, colorization: print });
const FIELD = { r: 1, g: 0, b: 0, a: 1 }, GLYPH = { r: 1, g: 0, b: 1, a: 1 };
/** A colourisation of one zone (the red field or the magenta glyph) by HSV offsets. */
const custom = (src: typeof FIELD, h: number, s: number, v: number) => ({
  $class: `${CC}$FullyCustom`, source: src, range: { hue: 0.03, saturation: 1, value: 1 }, offsets: { hue: h, saturation: s, value: v },
});
const STATUS_PRINT: Record<string, number> = { none: 2305, Fire: 2306, Freeze: 2307, Poison: 2308, Shock: 2309 };
const FAMILY_PRINT: Record<string, number> = { none: 2049, Beast: 2050, Undead: 2051, Slime: 2052, Construct: 2053, Fiend: 2054, Gremlin: 2055 };
/** The level icon's field by status and glyph by family. */
export const themeColours = (element: Element | null, family: Family | null) =>
  [normal(STATUS_PRINT[element ?? "none"]), normal(FAMILY_PRINT[family ?? "none"])];

/** The fixed sets' and special levels' colours: [field hue, value], [glyph hue, saturation, value]. */
const DARK = (h: number) => custom(FIELD, h, 0, -0.671);
const PALE = (h: number) => custom(GLYPH, h, -0.591, -0.376);
const SPECIAL: Record<string, any[]> = {
  aurora: [DARK(0.5), PALE(0.5)], jigsaw: [DARK(0.5), PALE(0.5)],
  starlight: [DARK(0.667), PALE(0.669)], concrete: [DARK(0.333), PALE(0.336)],
  darkcity: [DARK(0.667), PALE(0)], scarlet: [DARK(0), PALE(0.169)],
  rjp: [DARK(0.75), custom(GLYPH, 0, 0, 0)], gww: [DARK(0.5), custom(GLYPH, 0.37, -0.25, -0.2)],
  imf: [custom(FIELD, 0.5, 0, -0.533), custom(GLYPH, 0.276, -0.789, -0.404)], fsc: [DARK(0.081), PALE(0.251)],
  tv: [custom(FIELD, 0.331, -0.591, -0.376), custom(GLYPH, 0.5, -0.667, 0)],
  brown: [DARK(0.081), PALE(0.251)], haven: [DARK(0.081), PALE(0.336)], moorcroft: [DARK(0.75), PALE(0.169)],
  emberlight: [DARK(0), PALE(0.251)], unknown: [custom(FIELD, 0, -1, 0), custom(GLYPH, 0.167, -1, -1)],
};
/** Sleep strata (the Starlight Cradle) are ultramarine. */
const SLEEP_FIELD = DARK(0.667);

/** Each gate colour: its emblem's field and device. */
const GATE_COLOURS_CFG: Record<string, any[]> = {
  amber: [custom(FIELD, 0.05, -0.292, -0.651), custom(GLYPH, 0.225, -0.149, 0)],
  copper: [custom(FIELD, 0.055, 0, -0.502), custom(GLYPH, 0.771, -0.248, -0.4)],
  coral: [custom(FIELD, 0.9, -0.647, 0), custom(GLYPH, 0.93, -0.497, -0.353)],
  dark: [custom(FIELD, 0.794, 0, -0.753), custom(GLYPH, 0.85, -0.247, 0)],
  diamond: [custom(FIELD, 0.5, -0.794, -0.6), custom(GLYPH, 0.75, -0.898, 0)],
  emerald: [custom(FIELD, 0.375, 0, -0.651), custom(GLYPH, 0.375, -0.149, -0.051)],
  golden: [custom(FIELD, 0.11, 0, 0), custom(GLYPH, 0.225, 0, -0.302)],
  iron: [custom(FIELD, 0.573, -0.492, -0.753), custom(GLYPH, 0.7, -0.724, -0.502)],
  jade: [custom(FIELD, 0.369, 0, 0), custom(GLYPH, 0.701, 0, -0.6)],
  onyx: [custom(FIELD, 0.131, -0.449, -0.502), custom(GLYPH, 0.167, -1, -0.851)],
  ruby: [custom(FIELD, 0.968, 0, -0.251), custom(GLYPH, 0, 0, -0.804)],
  sapphire: [custom(FIELD, 0.667, 0, -0.651), custom(GLYPH, 0.75, -0.247, 0)],
  silver: [custom(FIELD, 0.6, -0.649, -0.251), custom(GLYPH, 0.745, -0.346, -0.502)],
};

/** A gate's emblem: its symbol's icon and colourisations. */
export function gateEmblem(colour: string, symbol: string): { file: string; colorizations: any[] } {
  return { file: `ui/icon/gate/${GATE_SYMBOLS.includes(symbol) ? symbol : "pawn"}.png`, colorizations: GATE_COLOURS_CFG[colour] ?? GATE_COLOURS_CFG.iron };
}

// ---------------------------------------------------------------------------- level codes

const FAMILIES: Record<string, Family> = { beast: "Beast", construct: "Construct", fiend: "Fiend", gremlin: "Gremlin", slime: "Slime", undead: "Undead" };
const ELEMENTS: Record<string, Element | null> = { x: null, fire: "Fire", freeze: "Freeze", poison: "Poison", shock: "Shock" };
const THEMED = (el: Element | null) => el ? el.toLowerCase() : "vanilla";
const TUNNEL: Record<string, string> = { x: "ct", fire: "bf", freeze: "cc", poison: "ww", shock: "pc" };
const ARENA: Record<string, string> = { x: "iea", fire: "fla", freeze: "ima", poison: "vfa", shock: "tfa" };
const COMPOUND: Record<string, string> = { x: "rc", fire: "cc", freeze: "fc", poison: "bc", shock: "sc" };
const COMPOUND_ICON: Record<string, string> = { beast: "compound_critter", slime: "compound_glopdrop", undead: "compound_scarab" };
const STARLIGHT: Record<string, string> = { mm: "meteor_mile", mm2: "meteor_mile_2", mm3: "meteor_mile_3", ss: "shrine_of_slumber", ss2: "shrine_of_slumber_2",
  ss3: "shrine_of_slumber_3", ss4: "shrine_of_slumber_4" };
const DARKCITY: Record<string, string> = { rr: "devilish_drudgery", rr2: "devilish_drudgery_2", rr3: "devilish_drudgery_3", ss: "devilish_drudgery_4",
  ss2: "devilish_drudgery_5", pm: "devilish_drudgery_6" };
const CONCRETE: Record<string, string> = { bb: "blight_boulevard", bb2: "blight_boulevard_2", tt: "totem_trouble", tt2: "totem_trouble_2" };
const SCARLET: Record<string, string> = { ch: "lost_castle_cravat_hall", ch2: "lost_castle_cravat_hall_2", ch3: "lost_castle_cravat_hall_3",
  sc: "lost_castle_spiral_court", sc2: "lost_castle_spiral_court_2", gg: "scarlet_fortress_grim_gallery" };
const AURORA: Record<string, string> = { sto: "stone_grove", jly: "the_jelly_farm", jly2: "the_jelly_farm_2", low: "the_low_gardens" };
const JIGSAW: Record<string, string> = { ax: "emerald_axis", ax2: "emerald_axis_2", jt: "the_jade_tangle", jt2: "the_jade_tangle_2",
  pp: "perimeter_promenade", pp2: "perimeter_promenade_2" };
const STAGE: Record<string, [BossKey, Record<string, string>]> = {
  gww: ["snarbolax", { d1: "m.gloaming_wildwoods_path", d2: "m.gloaming_wildwoods_ruins" }],
  rjp: ["jelly", { d1: "m.royal_jelly_garden", d2: "m.royal_jelly_court" }],
  imf: ["twins", { d1: "m.ironclaw_munitions_factory_assembly", d2: "m.ironclaw_munitions_factory_workshop" }],
  fsc: ["vanaduke", { d1: "m.firestorm_citadel_blackstone_bridge", d2: "m.firestorm_citadel_charred_court", d3: "m.firestorm_citadel_ash_armory",
    d4: "m.firestorm_citadel_smoldering_steps" }],
};
const BOSS_CODE: Record<string, BossKey> = { snarb: "snarbolax", jk: "jelly", rt: "twins", vana: "vanaduke" };
const BOSS_COLOURS: Record<BossKey, string> = { snarbolax: "gww", jelly: "rjp", twins: "imf", vanaduke: "scarlet" };
const STAGE_ICON: Record<string, string> = { gww: "woods", rjp: "castle", imf: "munitions", fsc: "castle" };

/** A level's names from the dungeon bundle ("Set|Level"), else ours. */
function named(key: string, title: string, subtitle: string): { title: string; subtitle: string } {
  const t = levelText(key);
  return t ? { title: t.title, subtitle: t.zone } : { title, subtitle };
}

/** Our English for a key the bundle lacks: "m.lost_castle_cravat_hall_2" is "Cravat Hall 2". */
const english = (key: string, drop: string) => key.replace(/^m\./, "").replace(drop, "").split("_").filter(Boolean).map(cap).join(" ");

/** Decodes one level code ("tunnel beast freeze"); null for a code this port does not know. */
export function decodeLevel(code: string): RealLevel | null {
  const w = code.trim().toLowerCase().split(/\s+/);
  const lv = (key: string, title: string, subtitle: string, icon: string, colorizations: any[], kind: RealLevel["kind"], style: string | null,
    family: Family | null, element: Element | null, boss?: BossKey): RealLevel =>
    ({ code: w.join(" "), key, ...named(key, title, subtitle), icon, colorizations, kind, style, family, element, ...(boss ? { boss } : {}) });
  const el = (s: string | undefined) => (s ?? "x") in ELEMENTS ? ELEMENTS[s ?? "x"] : null;
  switch (w[0]) {
    case "tunnel": case "arena": {
      const fam = FAMILIES[w[1]], e = el(w[2]);
      if (!fam) return null;
      const area = (w[0] === "tunnel" ? TUNNEL : ARENA)[w[2] ?? "x"] ?? (w[0] === "tunnel" ? "ct" : "iea");
      return lv(`m.${area}_${w[1]}`, w[0] === "tunnel" ? "Clockwork Tunnels" : "Battle Arena", cap(w[1]), w[0] === "tunnel" ? "clockwork" : "shield",
        themeColours(e, fam), "level", w[0] === "tunnel" ? "tunnels" : "arena", fam, e);
    }
    case "compound": {
      const fam = FAMILIES[w[1]], e = el(w[2]), minis = w[3] ?? "beast";
      if (!fam) return null;
      return lv(`m.${COMPOUND[w[2] ?? "x"] ?? "rc"}_${minis}_minis`, "Compound", cap(minis), COMPOUND_ICON[minis] ?? "compound_critter",
        themeColours(e, fam), "level", "compound", fam, e);
    }
    case "csk": case "decon": case "den": case "lichen": case "dd": {
      const e = el(w[1]);
      const [set, title, icon, glyph, fam, style] = ({
        csk: ["candlestick_keep", "Candlestick Keep", "pawn", "Undead", "Undead", "keep"],
        decon: ["deconstruction_zone", "Deconstruction Zone", "decon", "Construct", "Gremlin", "deconstruction"],
        den: ["wolver_den", "Wolver Den", "monsters", "Beast", "Beast", "den"],
        lichen: ["lichenous_lair", "Lichenous Lair", "monsters", "Slime", "Slime", "lair"],
        dd: ["devilish_drudgery", "Devilish Drudgery", "monsters", "Fiend", "Fiend", "drudgery"],
      } as Record<string, [string, string, string, Family, Family, string]>)[w[0]];
      return lv(`m.${set}_${THEMED(e)}`, title, e ?? "", icon, themeColours(e, glyph), "level", style, fam, e);
    }
    case "graveyard":
      return lv("m.graveyard_vanilla", "Graveyard", "", "graveyard", themeColours(null, "Undead"), "level", "graveyard", "Undead", null);
    case "tv":
      return lv("m.treasure_vault_1", "Treasure Trove", "", "treasure", SPECIAL.tv, "vault", null, null, null);
    case "pv": {
      const e = el(w[1]);
      return lv(`m.tvault_${THEMED(e)}`, "Treasure Vault", "", "treasure", [normal(STATUS_PRINT[e ?? "none"]), SPECIAL.tv[1]], "vault", null, null, e);
    }
    case "starlight": {
      const k = STARLIGHT[w[1]];
      return k ? lv(`m.starlight_cradle_${k}`, "Starlight Cradle", english(k, ""), "island", [SLEEP_FIELD, SPECIAL.starlight[1]], "level", "cradle", "Slime", null) : null;
    }
    case "starlight_boss": return lv("m.starlight_cradle_miniboss", "Starlight Cradle", "Torporal Titan", "miniboss", SPECIAL.starlight, "miniboss", "cradle", "Slime", null);
    case "darkcity": {
      const k = DARKCITY[w[1]];
      return k ? lv(`m.dark_city_${k}`, "Dark City", english(k, ""), "city", SPECIAL.darkcity, "level", "darkcity", "Fiend", null) : null;
    }
    case "darkcity_boss": return lv("m.dark_city_miniboss", "Dark City", "Stygian Steeds", "miniboss", SPECIAL.darkcity, "miniboss", "darkcity", "Fiend", null);
    case "concrete": {
      const k = CONCRETE[w[1]];
      return k ? lv(`m.concrete_jungle_${k}`, "Concrete Jungle", english(k, ""), "city", SPECIAL.concrete, "level", "jungle", "Slime", "Poison") : null;
    }
    case "concrete_boss": return lv("m.concrete_jungle_miniboss", "Concrete Jungle", "Briar Bone Barrage", "miniboss", SPECIAL.concrete, "miniboss", "jungle", "Undead", "Poison");
    case "scarlet": {
      const k = SCARLET[w[1]];
      return k ? lv(`m.${k}`, "Scarlet Fortress", english(k.replace(/^(lost_castle|scarlet_fortress)_/, ""), ""), "castle",
        SPECIAL.scarlet, "level", "fortress", "Undead", null) : null;
    }
    case "aurora": {
      const k = AURORA[w[1]];
      return k ? lv(`m.aurora_isles_${k}`, "Aurora Isles", english(k, ""), "island", SPECIAL.aurora, "level", "aurora", "Beast", null) : null;
    }
    case "jigsaw": {
      const k = JIGSAW[w[1]];
      return k ? lv(`m.jigsaw_valley_${k}`, "Jigsaw Valley", english(k, ""), "island", SPECIAL.jigsaw, "level", "valley", "Construct", null) : null;
    }
    case "gww": case "rjp": case "imf": case "fsc": {
      const [boss, stages] = STAGE[w[0]], key = stages[w[1]];
      return key ? lv(key, BOSSES[boss].level, english(key, ""), STAGE_ICON[w[0]], SPECIAL[w[0]], "level", null, null, boss === "vanaduke" ? "Fire" : null, boss) : null;
    }
    case "snarb": case "jk": case "rt": case "vana": {
      const boss = BOSS_CODE[w[0]];
      return lv(BOSSES[boss].levelKey, BOSSES[boss].level, BOSSES[boss].name, "boss", SPECIAL[BOSS_COLOURS[boss]] ?? SPECIAL.scarlet, "boss", null, null,
        boss === "vanaduke" ? "Fire" : null, boss);
    }
  }
  return null;
}

/** The fixed floors: the lobby, terminals, towns and the Core. */
export function fixedLevel(depth: number): RealLevel {
  const base = { style: null, family: null, element: null } as const;
  const make = (key: string, title: string, subtitle: string, icon: string, colours: any[], kind: RealLevel["kind"], bundle = "dungeon"): RealLevel =>
    ({ code: kind, key, ...(levelText(key, bundle) ? { title: levelText(key, bundle)!.title, subtitle: levelText(key, bundle)!.zone } : { title, subtitle }),
      icon, colorizations: colours, kind, ...base });
  if (depth < 0) return make("m.haven", "Haven", "", "town", SPECIAL.haven, "town", "town");
  if (depth === 0) return make("m.arcade_lobby", "The Clockworks", "Party Lobby", "lobby", SPECIAL.brown, "lobby");
  if (depth === 8) return make("m.moorcroft", "Moorcroft Manor", "Town of Restless Spirits", "town", SPECIAL.moorcroft, "town");
  if (depth === 18) return make("m.emberlight", "Emberlight", "Town of Gremlin Outcasts", "town", SPECIAL.emberlight, "town");
  if (depth === 29) return make("m.terminal_core", "The Core", "The Path is Sealed", "terminal", SPECIAL.brown, "core");
  return make("m.terminal_1", "Clockwork Terminal", "The Crossroads of Adventure", "terminal", SPECIAL.brown, "terminal");
}

/** The randomised depths' unknown level ("?"). */
export const UNKNOWN_ICON = { file: "ui/icon/map/unknown.png", colorizations: SPECIAL.unknown };

/** Depths with a fixed floor (no level line in the file). */
export const FIXED_DEPTHS = [0, 4, 8, 13, 18, 23, 29];

/** The six strata: tier, first and last depth. */
export const STRATA: [number, number, number][] = [[1, 1, 3], [1, 5, 7], [2, 9, 12], [2, 14, 17], [3, 19, 22], [3, 24, 28]];

/** Whole fixed sets written as one keyword in older files: each line it stands for ("" keeps the direction going). */
const KEYWORDS: Record<string, string[][]> = {
  ai: [["aurora low", "aurora sto", "aurora jly", "aurora jly2"]],
  dc_2d: [["darkcity ss", "darkcity ss2"], ["darkcity pm"]],
  dc_3d: [["darkcity rr", "darkcity rr2", "darkcity rr3"], ["darkcity ss", "darkcity ss2"], ["darkcity_boss"]],
  cj_bb: [["concrete bb", "concrete bb2"]], cj_tt: [["concrete tt", "concrete tt2"]],
  jv_ax: [["jigsaw ax", "jigsaw ax2"]], jv_jt: [["jigsaw jt", "jigsaw jt2"]], jv_pp: [["jigsaw pp", "jigsaw pp2"]],
  sf_sc: [["scarlet sc", "scarlet sc2", "scarlet gg"]], sf_ch: [["scarlet ch", "scarlet ch2", "scarlet ch3", "scarlet gg"]],
  sf_2d: [["scarlet sc", "scarlet sc2", "scarlet gg"], ["scarlet ch", "scarlet ch2", "scarlet ch3"]],
  sc_mm: [["starlight mm", "starlight mm2"]], sc_ss: [["starlight ss", "starlight ss2"], ["starlight ss3", "starlight ss4"]],
  s_gww: [["gww d1"], ["gww d2"], ["snarb"]], s_rjp: [["rjp d1"], ["rjp d2"], ["jk"]], s_imf: [["imf d1"], ["imf d2"], ["rt"]],
  s_fsc: [["fsc d1"], ["fsc d2"], ["fsc d3"], ["fsc d4"], ["vana"]],
};
/** A randomised depth's extra levels: the graveyard always, and a vault ("rand_fire": a fire vault). */
const RANDOM_EXTRA: Record<string, string> = { rand: "tv", rand_x: "pv x", rand_fire: "pv fire", rand_freeze: "pv freeze", rand_poison: "pv poison", rand_shock: "pv shock" };

/** A file's level lines as depths: direction and level codes, one entry per non-fixed depth. */
export function expandLines(lines: string[]): { dir: Wheel["dir"]; codes: string[] }[] {
  const out: { dir: Wheel["dir"]; codes: string[] }[] = [];
  let next: "l" | "r" = "r";
  const flip = () => { next = next === "r" ? "l" : "r"; };
  for (const line of lines) {
    const parts = line.split(",").map(s => s.trim()).filter(Boolean);
    if (!parts.length) continue;
    const head = parts[0].toLowerCase();
    if (head in RANDOM_EXTRA) {
      // a randomised depth: its levels, the graveyard, and a vault or the trove
      out.push({ dir: "?", codes: ["graveyard", ...parts.slice(1), RANDOM_EXTRA[head]] });
      continue;
    }
    let codes = parts;
    if (head === "l" || head === "r" || head === "x") { if (head !== "x") next = head; codes = parts.slice(1); }
    const kw = codes.length === 1 ? KEYWORDS[codes[0].toLowerCase()] : undefined;
    if (kw) {
      // its lines alternate from the current direction; after an odd number the next line turns
      // the other way (a boss stratum's single-level lines leave the direction as it was)
      const start = next;
      kw.forEach((l, i) => out.push({ dir: l.length > 1 ? (i % 2 ? (start === "r" ? "l" : "r") : start) : "", codes: l }));
      if (!codes[0].toLowerCase().startsWith("s_") && kw.length % 2 === 1) flip();
      continue;
    }
    out.push({ dir: codes.length > 1 ? next : "", codes });
    flip();
  }
  return out;
}

const TWO_PI = 6.2831855;

/** A gate from its list entry and data file. */
export function readGate(entry: GateEntry, file: GateFile): RealGate {
  const lines = expandLines(file.levels);
  const wheels: Wheel[] = [];
  let line = 0;
  for (let d = 0; d <= 29; d++) {
    let options: RealLevel[], dir: Wheel["dir"] = "";
    if (FIXED_DEPTHS.includes(d)) options = [fixedLevel(d)];
    else {
      const l = lines[line++];
      options = (l?.codes ?? []).map(decodeLevel).filter((x): x is RealLevel => !!x);
      if (!options.length) options = [decodeLevel("tunnel construct x")!];
      dir = options.length > 1 ? (l?.dir ?? "r") : "";
    }
    const rot = file.rotations?.[d];
    const random = dir === "?" || (!!rot && rot.data === null && options.length > 1);
    let velocity = 0, lengths = options.map(() => TWO_PI / options.length), start = gateOpens(entry), recorded = false;
    if (rot?.data && rot.data.lengths?.length === options.length) {
      velocity = rot.data.velocity; lengths = rot.data.lengths; start = rot.data.start; recorded = true;
    } else if (options.length > 1 && !random) {
      // a gate recorded without its rotation: ours, a level every five minutes
      velocity = (dir === "l" ? -1 : 1) * TWO_PI / (options.length * 300);
    }
    wheels.push({ depth: d, options, dir: random ? "?" : dir, random, velocity, lengths, start, recorded });
  }
  return { entry, name: gateName(entry), themes: file.themes ?? [], wheels };
}

// ---------------------------------------------------------------------------- rotation

/** MathUtil.normalizeAngle: into (-pi, pi]. */
const normA = (a: number) => { while (a < -Math.PI) a += TWO_PI; while (a > Math.PI) a -= TWO_PI; return a; };
/** MathUtil.normalizeAnglePositive: into [0, 2 pi). */
const normP = (a: number) => { while (a < 0) a += TWO_PI; while (a >= TWO_PI) a -= TWO_PI; return a; };

/** The wheel's angle at a time (the client's dungeon.util.o.a: the turn so far, within one period). */
export function wheelAngle(w: Wheel, t: number): number {
  const speed = Math.abs(w.velocity);
  if (w.random || speed < 1e-6) return 0;
  const period = Math.trunc(6283.1855 / speed);
  const ms = ((t - w.start) % period + period) % period;
  return normA(ms * w.velocity / 1000);
}

/** The wedge holding an angle of the wheel's own frame. */
function wedgeOf(lengths: number[], a: number): number {
  a = normP(a);
  for (let i = 0; i < lengths.length; i++) if ((a -= lengths[i]) < 0) return i;
  return lengths.length - 1;
}

/** A wedge's centre in the wheel's own frame. */
function wedgeCentre(lengths: number[], i: number): number {
  let a = 0;
  for (let k = 0; k < i; k++) a += lengths[k];
  return normA(a + lengths[i] * 0.5);
}

/** The wedge under a world angle at a time. */
export function wedgeAt(w: Wheel, angle: number, t: number): number {
  return w.random ? 0 : wedgeOf(w.lengths, normA(angle - wheelAngle(w, t)));
}

/** A wedge's centre as a world angle at a time (0 for a randomised wheel). */
export function wedgeWorld(w: Wheel, i: number, t: number): number {
  return w.random ? 0 : normA(wheelAngle(w, t) + wedgeCentre(w.lengths, i));
}

/**
 * The level the elevator from (depth, wedge) leads to at a time, and how many seconds until it
 * changes: null for a randomised next depth (decided when the elevator is taken).
 */
export function nextLevel(g: RealGate, depth: number, wedge: number, t: number): { wedge: number; seconds: number } | null {
  const a = g.wheels[depth], b = g.wheels[depth + 1];
  if (!a || !b) return null;
  if (b.random) return null;
  if (b.options.length === 1) return { wedge: 0, seconds: Infinity };
  const world = wedgeWorld(a, wedge, t);
  const i = wedgeAt(b, world, t);
  // the point moves over the next wheel at the two wheels' relative speed
  const rate = (a.random ? 0 : a.velocity) - b.velocity;
  if (Math.abs(rate) < 1e-9) return { wedge: i, seconds: Infinity };
  const p = normP(world - wheelAngle(b, t));
  let cum = 0;
  for (let k = 0; k < i; k++) cum += b.lengths[k];
  const left = rate > 0 ? cum + b.lengths[i] - p : p - cum;
  return { wedge: i, seconds: Math.max(0, left / Math.abs(rate)) };
}

/** The wedges a run would take from a depth's wedge onward, now: -1 at randomised depths. */
export function predictedPath(g: RealGate, from: number, wedge: number, t: number): number[] {
  const path: number[] = [];
  path[from] = wedge;
  for (let d = from; d < 29; d++) {
    // a randomised depth's wheel stands still with every wedge at the top (the client's
    // GateSummary.Random), so the depth after it is still foretold
    const n = path[d] < 0 && !g.wheels[d].random ? null : nextLevel(g, d, Math.max(0, path[d]), t);
    path[d + 1] = n ? n.wedge : g.wheels[d + 1].options.length === 1 ? 0 : -1;
  }
  return path;
}

/** The elevator is taken: the next depth's level, locked in (a random pick at a randomised depth). */
export function lockNext(g: RealGate, depth: number, wedge: number, t: number, rand: () => number = Math.random): number {
  const n = nextLevel(g, depth, wedge, t);
  if (n) return n.wedge;
  const b = g.wheels[depth + 1];
  return b ? Math.floor(rand() * b.options.length) % b.options.length : 0;
}

/**
 * The order the gate map shows a depth's levels in (the client's map turns each row with its
 * wheel, as dungeon/client/u.Pg does): the wedge at the top of the wheel in the middle.
 */
export function displayOrder(w: Wheel, t: number): number[] {
  const n = w.options.length;
  if (n < 2) return [0];
  let top: number;
  if (w.random) top = 0;
  else if (n % 2 === 0) {
    // between the two wedges straddling the top (the client's dungeon.util.o.b)
    let a = normP(normA(0 - wheelAngle(w, t))) - w.lengths[0] / 2;
    top = n - 1;
    if (a >= 0) for (let i = 0; i < n; i++) { if ((a -= w.lengths[i] / 2 + w.lengths[(i + 1) % n] / 2) < 0) { top = i; break; } }
  } else top = wedgeAt(w, 0, t);
  const shift = top + Math.floor(n / 2) + 1;
  return Array.from({ length: n }, (_, k) => (k + shift) % n);
}
