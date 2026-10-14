// Music for every place in the game, from the install's music (rsrc/sound/music, also in
// full-music-bundle.jar) and the scene globals that name it (config/scene_global.dat: the
// "Environment/Custom/.../Music Mix" mixes, "Music/Monster Family/*" and "Music/Status/*").
//
// Cached scenes carry their own music globals, but generated floors copy theirs from the
// cached level they were learned from, and a gate's themes (castle, graveyard, wolver den,
// element strata...) mostly have no cached source scene at all. So a gate floor's music comes
// from this table, by what the floor is (terminal, subtown, boss, level), its stratum's theme
// and its level style. docs/research/music.md lists where each choice comes from.

import { BOSSES, type BossKey, type Floor, type StratumTheme } from "./clockworks";

export interface MusicFile { file: string; weight: number }
/** A Meta Stream mix: a weighted pick, played through, then another (cross-faded). */
export interface Track { files: MusicFile[]; gain: number; crossFade: number; source: string }

const M = (name: string) => `sound/music/${name}.ogg`;
const one = (name: string, gain: number, source: string): Track => ({ files: [{ file: M(name), weight: 1 }], gain, crossFade: 0, source });
const mix = (files: [string, number][], gain: number, crossFade: number, source: string): Track =>
  ({ files: files.map(([f, w]) => ({ file: M(f), weight: w })), gain, crossFade, source });

const SG = "scene_global: ";
/** Places, mostly straight from the data (scene globals and the cached scenes' own music). */
export const PLACES = {
  title: one("main_theme", 0.45, "ours: the game's main theme for the title screen"),
  haven: one("haven", 0.25, SG + "Environment/Custom/Town/Haven/Default/Music"),
  havenWinter: one("haven_winter", 0.35, SG + "Environment/Custom/Town/Haven/Winter/Music"),
  havenHaunted: one("haven_haunted", 0.25, "scenes cache: haven_town_square (Environment/Music)"),
  /** The Arcade lobby is part of Haven. */
  arcade: one("haven", 0.25, SG + "Environment/Custom/Town/Haven/Default/Music"),
  terminal: one("title", 0.45, "scenes cache: terminal_1 (Environment/Music Mix)"),
  /** The terminal above the Core: its cached scene has no music global; the terminals' track. */
  core: one("title", 0.45, "ours: terminal_core has no music global; the terminals' track"),
  /** Emberlight's own track; Moorcroft Manor (not cached) shares the subtown track. */
  subtown: one("subtown_1", 0.45, "scenes cache: emberlight (Environment/Music)"),
  guildHall: mix([["clockwork_ambient", 1.75], ["clockwork_ambient_2", 1.75], ["clockwork_action", 1]], 0.45, 0, "scenes cache: hall (Clockwork Tunnels/Default/Music Mix)"),
  hallOfHeroes: one("hall_heroes", 0.45, "ours: hall_heroes.ogg"),
  arena: one("clockwork_action", 0.3, SG + "Environment/Custom/Battle Arena/Default/Music Mix (gain raised from 0.15)"),
  arenaBoss: mix([["boss_1", 1], ["boss_2", 1]], 0.45, 0, "ours: boss_1/boss_2 for the arena's boss waves"),
  dangerRoom: mix([["battle_1", 1], ["battle_2", 1]], 0.45, 0, "ours: battle_1/battle_2"),
  treasureVault: one("treasure_vault", 0.45, "ours: treasure_vault.ogg"),
  missionLobby: one("mission_lobby", 0.5, "scenes cache: mission_lobby (Environment/Music)"),
  readyRoom: one("mission_ui", 0.45, "world/readyroom/scene.dat (Environment/Music)"),
  comlink: one("comlink", 0.45, SG + "Music/Missions/ComLink"),
  comlinkUrgent: one("comlink_urgent", 0.9, "sounder: Custom/Mission/Comlink (urgent)"),
  darkHallsLobby: one("apocrea", 0.6, "scenes cache: dark_halls_lobby (Environment/Music)"),
  darkHallsFinale: one("somber", 0.45, "scenes cache: dark_halls_finale (Environment/Music)"),
  swarm: one("whitespace_ambient", 0.45, "character/npc/monster/swarm/model.dat"),
  swarmBattle: one("whitespace_swarm", 0.45, "character/npc/monster/swarm/model.dat"),
  /** The intro cinematic's score (the prologue plays before character creation). */
  prologue: one("prologue_audio_only", 0.6, "ours: prologue_audio_only.ogg"),
} satisfies Record<string, Track>;

/**
 * Music for content this port does not have yet (missions and their story levels, Shadow
 * Lairs, PvP), keyed for when it arrives. The pairings follow the files' names; none of these
 * places is cached, so none is confirmed by a scene global.
 */
export const MISSION_MUSIC = {
  barracks: one("barracks", 0.45, "ours: barracks.ogg"),
  comlinkSomber: one("comlink_somber", 0.45, "ours: comlink_somber.ogg (ComLink, somber variant)"),
  crashSite: one("crash_site", 0.45, "ours: crash_site.ogg"),
  shadowLair: mix([["creepy_ambient", 1], ["creepy_battle", 1]], 0.45, 1, "ours: creepy_ambient, creepy_battle"),
  crimson: one("crimson", 0.45, "ours: crimson.ogg"),
  dreadful: one("dreadful", 0.45, "ours: dreadful.ogg"),
  sanctuary: one("sanctuary", 0.45, "ours: sanctuary.ogg"),
  unknownPassage: one("unknown_passage", 0.45, "ours: unknown_passage.ogg"),
  lockdown: one("lockdown", 0.45, "ours: lockdown.ogg (PvP)"),
  lockdownSuddenDeath: one("lockdown_sd", 0.45, "ours: lockdown_sd.ogg (PvP sudden death)"),
  blastNetwork: one("blast_network", 0.45, "ours: blast_network.ogg (PvP)"),
  blastNetworkSuddenDeath: one("blast_network_sd", 0.45, "ours: blast_network_sd.ogg (PvP sudden death)"),
} satisfies Record<string, Track>;

/** Monster family music ("Music/Monster Family/*"). */
export const FAMILY_MUSIC: Record<string, Track> = {
  Beast: one("beast", 0.7, SG + "Music/Monster Family/Beast"),
  Construct: one("construct", 0.4, SG + "Music/Monster Family/Construct"),
  Fiend: one("fiend", 0.4, SG + "Music/Monster Family/Fiend"),
  Gremlin: one("gremlin", 0.4, SG + "Music/Monster Family/Gremlin"),
  Slime: one("slime", 0.4, SG + "Music/Monster Family/Slime"),
  Undead: one("undead", 0.4, SG + "Music/Monster Family/Undead"),
};

/** Element strata ("Environment/Custom/Universal/<Element>/Music (<Element>)", which the Clockwork Tunnels element mixes derive from). */
export const ELEMENT_MUSIC: Record<string, Track> = {
  Fire: one("fire", 0.45, SG + "Environment/Custom/Universal/Fire/Music (Fire)"),
  Freeze: one("freeze", 0.45, SG + "Environment/Custom/Universal/Freeze/Music (Freeze)"),
  Poison: one("poison", 0.45, SG + "Environment/Custom/Universal/Poison/Music (Poison)"),
  Shock: one("shock", 0.75, SG + "Environment/Custom/Universal/Shock/Music (Shock)"),
};

/** Level styles (clockworks.ts STYLES keys). */
export const STYLE_MUSIC: Record<string, Track> = {
  tunnels: mix([["clockwork_ambient", 1.75], ["clockwork_ambient_2", 1.75], ["clockwork_action", 1]], 0.45, 0, SG + "Environment/Custom/Clockwork Tunnels/Default/Music Mix"),
  valley: mix([["sky_islands_day_ambient", 1], ["sky_islands_day_action", 1]], 0.25, 1, "scenes cache: jigsaw_valley_* (Environment/Music Mix)"),
  den: one("beast", 0.7, SG + "Environment/Custom/Wolver's Den/Music Mix"),
  grove: one("slime", 0.4, SG + "Environment/Custom/Lichenous Lair/Music Mix (Environment/Custom/Music/Slime)"),
  keep: mix([["candlestick_keep", 1.5], ["castle_ambient", 1], ["castle_action", 1]], 0.45, 1, "ours: candlestick_keep, castle_ambient, castle_action"),
  graveyard: one("undead", 0.6, SG + "Environment/Custom/Graveyard/Music Mix"),
  compound: mix([["gremlin", 1.5], ["city_ambient", 1], ["city_action", 1]], 0.4, 1, "ours: gremlin (Music/Monster Family/Gremlin) with city_ambient, city_action"),
  deconstruction: one("construct", 0.4, SG + "Music/Monster Family/Construct"),
  city: mix([["city_ambient", 1], ["city_action", 1]], 0.4, 1, "ours: city_ambient, city_action"),
  frostwood: mix([["sky_islands_day_ambient", 1], ["sky_islands_day_action", 1]], 0.25, 1, "scenes cache: jigsaw_valley_* (the sky islands mix; Frosty Islands are a sky-islands tileset)"),
  halls: mix([["apocrea", 1], ["somber", 1]], 0.5, 1, "scenes cache: dark_halls_lobby (apocrea), dark_halls_finale (somber)"),
  pools: one("freeze", 0.45, "ours: Frozen Pools play the freeze track (Universal/Freeze/Music)"),
  vault: one("treasure_vault", 0.45, "ours: the prize vault tileset plays treasure_vault"),
  whitespace: one("whitespace_ambient", 0.45, "character/npc/monster/swarm/model.dat (the Swarm's whitespace)"),
  haven: one("haven", 0.25, SG + "Environment/Custom/Town/Haven/Default/Music"),
  // the game's level sets from the archive (their scenes carry their own music globals too)
  drudgery: one("fiend", 0.4, SG + "Environment/Custom/Devilish Drudgery/Music Mix"),
  lair: one("slime", 0.4, SG + "Environment/Custom/Lichenous Lair/Music Mix (Environment/Custom/Music/Slime)"),
  arena: mix([["battle_1", 1], ["battle_2", 1]], 0.45, 1, "ours: battle_1, battle_2 for the Battle Arenas"),
  aurora: mix([["sky_islands_day_ambient", 1], ["sky_islands_day_action", 1]], 0.25, 1, "scenes cache: aurora_isles_* (the sky islands mix)"),
  cradle: one("slime", 0.4, "ours: Starlight Cradle plays the slime track"),
  jungle: mix([["city_ambient", 1], ["city_action", 1]], 0.4, 1, "ours: city_ambient, city_action for the Concrete Jungle"),
  darkcity: mix([["city_ambient", 1], ["city_action", 1]], 0.4, 1, "ours: city_ambient, city_action for Dark City"),
  fortress: mix([["castle_ambient", 1], ["castle_action", 1]], 0.45, 1, "ours: castle_ambient, castle_action for the Scarlet Fortress"),
};

/** Tilesets (src/gen themes) to a style's music, for styles this table does not know by key. */
const TILESET_MUSIC: [RegExp, string][] = [
  [/^(valley|sky)-night/, "den"], [/^(valley|sky)-autumn|lichen|grove/, "grove"], [/^(valley|sky)-winter|frost/, "frostwood"],
  [/^valley|sky|island/, "valley"], [/castle-light|dark-?halls/, "halls"], [/^ice|pool/, "pools"], [/vault/, "vault"], [/whitespace/, "whitespace"], [/^haven/, "haven"],
  [/castle|keep/, "keep"], [/graveyard/, "graveyard"], [/city|compound/, "compound"], [/clockworks-white/, "deconstruction"],
];
const TILESET_ELEMENT: [RegExp, string][] = [[/fire|lava|ember/, "Fire"], [/freeze|ice|snow|frost/, "Freeze"], [/poison/, "Poison"], [/shock/, "Shock"]];

/** Boss levels: the level's own track, and the fight once the boss is roused. */
export const BOSS_MUSIC: Record<BossKey, { level: Track; fight: Track }> = {
  jelly: { level: one("royal_jelly", 0.45, "ours: royal_jelly.ogg"), fight: one("boss_1", 0.5, "ours: boss_1.ogg") },
  snarbolax: { level: one("wildwoods", 0.45, "ours: wildwoods.ogg"), fight: one("boss_2", 0.5, "ours: boss_2.ogg") },
  twins: { level: one("munitions", 0.45, "ours: munitions.ogg"), fight: one("boss_1", 0.5, "ours: boss_1.ogg") },
  vanaduke: {
    level: mix([["citadel_ambient", 1], ["citadel_action", 1]], 0.45, 1, "ours: citadel_ambient, citadel_action"),
    fight: one("battle_citadel", 0.5, "ours: battle_citadel.ogg"),
  },
};

/** One-shot stingers (fanfares), played over the music. */
export const STINGERS = {
  elevator: M("fanfare_elevator_1"),
  victory: M("fanfare_victory_1"),
  failure: M("fanfare_failure_1"),
  resurrect: M("fanfare_resurrect_1"),
  levelUp: M("fanfare_item_levelup_1"),
  discovery: M("fanfare_discovery_1"),
  missionComplete: M("mission_complete"),
  pvpWin: M("fanfare_pvp_win"),
  pvpLose: M("fanfare_pvp_lose"),
  swell: M("dramatic_swell_1"),
} as const;
export type Stinger = keyof typeof STINGERS;

const ELEMENTS = new Set(["Fire", "Freeze", "Poison", "Shock"]);

/** A level floor's music: element strata play their element, else the style's mix. */
export function levelMusic(theme: StratumTheme | null, styleKey: string | null, tileset: string): Track {
  if (theme && ELEMENTS.has(theme)) return ELEMENT_MUSIC[theme];
  // the Clockwork Tunnels have family variants: Spooky (undead) and the fiends' Devilish Drudgery
  if (styleKey === "tunnels" && theme === "Undead") return { ...one("undead", 0.6, SG + "Environment/Custom/Clockwork Tunnels/Spooky/Music Mix") };
  if (styleKey === "tunnels" && theme === "Fiend") return { ...one("fiend", 0.4, SG + "Environment/Custom/Devilish Drudgery/Music Mix") };
  if (styleKey && STYLE_MUSIC[styleKey]) return STYLE_MUSIC[styleKey];
  // mission floors: their element, else their monster family's track (Music/Monster Family/*)
  if (styleKey === "mission" && theme && FAMILY_MUSIC[theme] && !TILESET_ELEMENT.some(([re]) => re.test(tileset))) return FAMILY_MUSIC[theme];
  const el = TILESET_ELEMENT.find(([re]) => re.test(tileset));
  if (el) return ELEMENT_MUSIC[el[1]];
  const byTileset = TILESET_MUSIC.find(([re]) => re.test(tileset));
  if (byTileset) return STYLE_MUSIC[byTileset[1]];
  if (theme && FAMILY_MUSIC[theme]) return FAMILY_MUSIC[theme];
  return STYLE_MUSIC.tunnels;
}

/** Music for a floor of a gate. */
export function floorMusic(f: Floor): Track {
  switch (f.kind) {
    case "lobby": return PLACES.arcade;
    case "terminal": return PLACES.terminal;
    case "core": return PLACES.core;
    case "subtown": return PLACES.subtown;
    case "boss": return f.stratum?.boss ? BOSS_MUSIC[f.stratum.boss].level : PLACES.arenaBoss;
    default: return levelMusic(f.stratum?.theme ?? null, f.stratum?.style.key ?? null, f.tileset);
  }
}

/** Music for a cached scene that names none, by its name (null when nothing fits). */
export function sceneMusic(name: string): Track | null {
  const n = name.toLowerCase();
  if (/haven|bazaar/.test(n)) return PLACES.haven;
  if (/arcade/.test(n)) return PLACES.arcade;
  if (/terminal core|core/.test(n)) return PLACES.core;
  if (/terminal/.test(n)) return PLACES.terminal;
  if (/emberlight|moorcroft/.test(n)) return PLACES.subtown;
  if (/^hall\b|guild/.test(n)) return PLACES.guildHall;
  if (/hall of heroes/.test(n)) return PLACES.hallOfHeroes;
  if (/mission lobby/.test(n)) return PLACES.missionLobby;
  if (/ready ?room/.test(n)) return PLACES.readyRoom;
  if (/dark halls lobby/.test(n)) return PLACES.darkHallsLobby;
  if (/dark halls/.test(n)) return PLACES.darkHallsFinale;
  if (/jigsaw|valley/.test(n)) return STYLE_MUSIC.valley;
  for (const k of Object.keys(BOSSES) as BossKey[]) if (n.includes(BOSSES[k].level.toLowerCase())) return BOSS_MUSIC[k].level;
  return null;
}

/** Every music file this table plays (for the docs and a test against the install's list). */
export function mappedFiles(): Set<string> {
  const out = new Set<string>();
  const add = (t: Track) => t.files.forEach(f => out.add(f.file));
  [...Object.values(PLACES), ...Object.values(MISSION_MUSIC), ...Object.values(FAMILY_MUSIC), ...Object.values(ELEMENT_MUSIC), ...Object.values(STYLE_MUSIC)].forEach(add);
  for (const b of Object.values(BOSS_MUSIC)) { add(b.level); add(b.fight); }
  for (const s of Object.values(STINGERS)) out.add(s);
  return out;
}
