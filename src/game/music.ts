// Music for every place in the game, from the install's music (rsrc/sound/music, also in
// full-music-bundle.jar) and the scene globals that name it (config/scene_global.dat: the
// "Environment/Custom/.../Music Mix" mixes, "Music/Monster Family/*" and "Music/Status/*").
//
// Archived levels carry their own music globals and play them (MusicPlayer.choose): a gate
// floor that loads one of the game's own levels plays that level's music. This table is for
// everything else: generated floors (whose globals come from whatever level they were learned
// from, not from the stratum they stand in for), the gate themes no archived level shows, and
// places the port builds itself. Each entry's `source` cites the data it comes from: a scene
// ("scene: <name> [<archive id>]"), a scene global ("scene_global: ..."), the levels' scripted
// music ("level logic: ...") or the client ("client: <class>"). The few the data does not
// settle say "GUESS:" and why. tools/music-survey.ts prints the survey these come from, and
// docs/research/music.md lists them.

import { BOSSES, type BossKey, type Floor, type StratumTheme } from "./clockworks";

export interface MusicFile { file: string; weight: number }
/** A Meta Stream mix: a weighted pick, played through, then another (cross-faded). */
export interface Track { files: MusicFile[]; gain: number; crossFade: number; source: string }

const M = (name: string) => `sound/music/${name}.ogg`;
const one = (name: string, gain: number, source: string): Track => ({ files: [{ file: M(name), weight: 1 }], gain, crossFade: 0, source });
const mix = (files: [string, number][], gain: number, crossFade: number, source: string): Track =>
  ({ files: files.map(([f, w]) => ({ file: M(f), weight: w })), gain, crossFade, source });

const SG = "scene_global: ";
const SC = "scene: ";
/** What every boss lair scripts for its fight (tools/music-survey.ts). */
const LAIR_FIGHT = "level logic: the lairs spawn Environment/Music boss_1 (gain 1, Override, fade out 2-3 s, then fanfare_victory_1) "
  + "when the boss is roused: royal jelly lair [255], gloaming wildwoods snarbolax [90], ironclaw munitions factory twins [94], firestorm citadel vanaduke [32]";
/** Places, mostly straight from the data (scene globals and the cached scenes' own music). */
export const PLACES = {
  title: one("title", 0.45, "ProjectXApp and dK: sound/music/title.ogg (\"Cradle\") at 0.45 on the login and knight select screens"),
  haven: one("haven", 0.25, SG + "Environment/Custom/Town/Haven/Default/Music"),
  havenWinter: one("haven_winter", 0.35, SG + "Environment/Custom/Town/Haven/Winter/Music"),
  havenHaunted: one("haven_haunted", 0.25, "scenes cache: haven_town_square (Environment/Music)"),
  /** The Arcade lobby is part of Haven. */
  arcade: one("haven", 0.25, SG + "Environment/Custom/Town/Haven/Default/Music"),
  terminal: one("title", 0.45, "scenes cache: terminal_1 (Environment/Music Mix)"),
  /**
   * The terminal above the Core plays no music: its scenes (terminal core [48], [329]) name no
   * music global, and the client plays scene music only from globals (I.java stops the app's
   * own title music on entering the game). Only its ambience is heard.
   */
  core: { files: [], gain: 0, crossFade: 0, source: SC + "terminal core [48] names no music global: silence" } as Track,
  /** Emberlight's own track; Moorcroft Manor (not cached) shares the subtown track. */
  subtown: one("subtown_1", 0.45, "scenes cache: emberlight (Environment/Music)"),
  guildHall: mix([["clockwork_ambient", 1.75], ["clockwork_ambient_2", 1.75], ["clockwork_action", 1]], 0.45, 0, "scenes cache: hall (Clockwork Tunnels/Default/Music Mix)"),
  hallOfHeroes: one("hall_heroes", 0.45, SC + "hall of heroes star0-5 [449,178-182] (Environment/Music)"),
  arena: one("clockwork_action", 0.3, SG + "Environment/Custom/Battle Arena/Default/Music Mix (gain raised from 0.15)"),
  /** The arena's every-tenth wave. */
  arenaBoss: mix([["boss_1", 1], ["boss_2", 1]], 0.45, 0, "GUESS: no archived Battle Arena boss wave; boss_1 and boss_2 are what the levels script for boss and mini-boss fights"),
  /** A danger room's waves (src/gen/features.ts scripts battle_1 itself, as scene 370 does). */
  dangerRoom: mix([["battle_1", 10], ["battle_2", 1]], 1, 0, "level logic: wave rooms spawn Environment/Music battle_1 (250 spawns) or battle_2 (25), gain 1, then fanfare_victory_1"),
  treasureVault: one("treasure_vault", 0.35, SC + "treasure vault end rainbow [379] (Environment/Music)"),
  missionLobby: one("mission_lobby", 0.5, "scenes cache: mission_lobby (Environment/Music)"),
  readyRoom: one("mission_ui", 0.45, "world/readyroom/scene.dat (Environment/Music)"),
  comlink: one("comlink", 0.45, SG + "Music/Missions/ComLink"),
  comlinkUrgent: one("comlink_urgent", 0.9, "sounder: Custom/Mission/Comlink (urgent)"),
  darkHallsLobby: one("apocrea", 0.6, "scenes cache: dark_halls_lobby (Environment/Music)"),
  darkHallsFinale: one("somber", 0.45, "scenes cache: dark_halls_finale (Environment/Music)"),
  swarm: one("whitespace_ambient", 0.45, "character/npc/monster/swarm/model.dat"),
  swarmBattle: one("whitespace_swarm", 0.45, "character/npc/monster/swarm/model.dat"),
  /** The intro cinematic's score (the prologue plays before character creation). */
  prologue: one("prologue_audio_only", 0.45, "dK: sound/music/prologue_audio_only.ogg at 0.45, a 0.5 s fade, played once"),
} satisfies Record<string, Track>;

/**
 * Music for content this port does not have yet (PvP, story missions and their levels), keyed
 * for when it arrives. Archived mission levels play their own globals and scripted music; these
 * cite where each track is played. Shadow Lairs (the archive's "... ultimate" scenes) play
 * their normal level's own music globals, so they need no entry.
 */
export const MISSION_MUSIC = {
  /** PvP: before the match and after it (client dungeon/arena/a/g: PRE_GAME, POST_GAME). */
  barracks: one("barracks", 0.6, "client: dungeon/arena/a/g plays barracks.ogg at 0.6 before and after a PvP match"),
  comlinkSomber: one("comlink_somber", 0.45, SC + "ghost machine treasure vault [433] (Environment/Music)"),
  crashSite: one("crash_site", 0.65, "level logic: tutorial b [216,398] spawns Environment/Music crash_site at 0.65 (tag \"music crash\")"),
  creepy: one("creepy_ambient", 0.6, SC + "spark roar finale [31444] (Environment/Music); also scripted in cogmaster castle 2 [298]"),
  creepyBattle: one("creepy_battle", 0.85, "level logic: firestorm citadel throne room [34417], haven laboratory [27911] spawn creepy_battle at 0.85 for a conversation"),
  crimson: one("crimson", 0.65, SC + "cogmaster castle 1-6 [295-310] (Environment/Music)"),
  dreadful: one("dreadful", 1, "level logic: ghost machine compound [432] spawns dreadful (tag \"music_main\")"),
  sanctuary: one("sanctuary", 0.65, SC + "sleeper sanctuary [152], core treasure vault [34891] (Environment/Music)"),
  unknownPassage: one("unknown_passage", 0.7, SC + "ultimate swarm trap [149], terminal core camefrombelow [34505] (Environment/Music)"),
  /** PvP Lockdown: the sudden-death track takes over for the last 60 s (client dungeon/arena/a/C). */
  lockdown: one("lockdown", 0.6, "client: dungeon/arena/a/C plays lockdown.ogg at 0.6"),
  lockdownSuddenDeath: one("lockdown_sd", 0.6, "client: dungeon/arena/a/C plays lockdown_sd.ogg at 0.6 for the last 60 s"),
  /** PvP Blast Network: the sudden-death track for the last 30 s (client dungeon/arena/a/y). */
  blastNetwork: one("blast_network", 0.75, "client: dungeon/arena/a/y plays blast_network.ogg at 0.75 (jellycube arena [439] names it at 1)"),
  blastNetworkSuddenDeath: one("blast_network_sd", 0.75, "client: dungeon/arena/a/y plays blast_network_sd.ogg at 0.75 for the last 30 s"),
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
  keep: one("candlestick_keep", 0.55, SC + "candlestick keep * [1073741841,1073741844,1073741883,1073741920], ck freeze owlite tome [1073741868] (Environment/Music)"),
  graveyard: one("undead", 0.6, SG + "Environment/Custom/Graveyard/Music Mix"),
  compound: one("gremlin", 0.4, "GUESS: no archived plain Gremlin Compound (the archived compounds are element and mission ones); the style's family global, " + SG + "Music/Monster Family/Gremlin"),
  deconstruction: one("construct", 0.5, SC + "deconstruction zone fire the gauntlet [1073741835], deconstruction zone shock [1073741854], dz * (Environment/Music)"),
  city: mix([["city_ambient", 2], ["city_action", 1]], 0.4, 1, SC + "concrete jungle *, dark city * (Environment/Music Mix)"),
  frostwood: mix([["sky_islands_day_ambient", 1], ["sky_islands_day_action", 1]], 0.25, 1, "scenes cache: jigsaw_valley_* (the sky islands mix; Frosty Islands are a sky-islands tileset)"),
  halls: mix([["apocrea", 1], ["somber", 1]], 0.5, 1, "scenes cache: dark_halls_lobby (apocrea), dark_halls_finale (somber)"),
  pools: one("freeze", 0.45, "GUESS: no archived Frozen Pools level; the ice's element global, " + SG + "Environment/Custom/Universal/Freeze/Music (Freeze)"),
  vault: one("treasure_vault", 0.35, SC + "treasure vault end rainbow [379] (Environment/Music)"),
  whitespace: one("whitespace_ambient", 0.45, "character/npc/monster/swarm/model.dat (the Swarm's whitespace)"),
  haven: one("haven", 0.25, SG + "Environment/Custom/Town/Haven/Default/Music"),
  // the game's level sets from the archive (their scenes carry their own music globals too)
  drudgery: one("fiend", 0.4, SG + "Environment/Custom/Devilish Drudgery/Music Mix"),
  lair: one("slime", 0.4, SG + "Environment/Custom/Lichenous Lair/Music Mix (Environment/Custom/Music/Slime)"),
  arena: one("clockwork_action", 0.15, SG + "Environment/Custom/Battle Arena/Default/Music Mix"),
  aurora: mix([["sky_islands_day_ambient", 1], ["sky_islands_day_action", 1]], 0.25, 1, "scenes cache: aurora_isles_* (the sky islands mix)"),
  cradle: mix([["sky_islands_day_ambient", 2]], 1, 1, SC + "starlight cradle * [190,386-393] (Environment/Music Mix)"),
  jungle: mix([["city_ambient", 2], ["city_action", 1]], 0.4, 1, SC + "concrete jungle * [33-38,194-197] (Environment/Music Mix)"),
  darkcity: mix([["city_ambient", 2], ["city_action", 1]], 0.4, 1, SC + "dark city * [42-44,283-285,292] (Environment/Music Mix)"),
  fortress: mix([["castle_ambient", 2], ["castle_action", 1]], 0.15, 0, SC + "scarlet fortress grim gallery [92], lost castle * [17-21,249,250] (Environment/Music Mix)"),
};

/** Tilesets (src/gen themes) to a style's music, for styles this table does not know by key. */
const TILESET_MUSIC: [RegExp, string][] = [
  [/^(valley|sky)-night/, "den"], [/^(valley|sky)-autumn|lichen|grove/, "grove"], [/^(valley|sky)-winter|frost/, "frostwood"],
  [/^valley|sky|island/, "valley"], [/castle-light|dark-?halls/, "halls"], [/^ice|pool/, "pools"], [/vault/, "vault"], [/whitespace/, "whitespace"], [/^haven/, "haven"],
  [/castle|keep/, "keep"], [/graveyard/, "graveyard"], [/city|compound/, "compound"], [/clockworks-white/, "deconstruction"],
];
const TILESET_ELEMENT: [RegExp, string][] = [[/fire|lava|ember/, "Fire"], [/freeze|ice|snow|frost/, "Freeze"], [/poison/, "Poison"], [/shock/, "Shock"]];

/**
 * Boss levels: the lair's own track, and the fight once the boss is roused. The game's own lairs
 * play both from their data (the level's music global, then the boss_1 their logic spawns), so
 * MusicPlayer uses `fight` only on a generated arena, whose logic scripts none.
 */
export const BOSS_MUSIC: Record<BossKey, { level: Track; fight: Track }> = {
  jelly: { level: one("royal_jelly", 0.45, SC + "royal jelly lair [255] (Environment/Music)"), fight: one("boss_1", 1, LAIR_FIGHT) },
  snarbolax: { level: one("wildwoods", 0.6, SC + "gloaming wildwoods snarbolax [90] (Environment/Music)"), fight: one("boss_1", 1, LAIR_FIGHT) },
  /**
   * The Twins' lair [94] names a rumble (sound/effect/world/environmental_rumble_01 at 0.5) as
   * its music and scripts munitions.ogg from its entrance until the doors close on the fight;
   * a generated arena plays the factory's track, as the other stages do.
   */
  twins: {
    level: one("munitions", 0.45, SC + "ironclaw munitions factory assembly [93], workshop [95] (Environment/Music); the lair [94] scripts it from the entrance"),
    fight: one("boss_1", 1, LAIR_FIGHT),
  },
  vanaduke: { level: one("citadel_ambient", 0.45, SC + "firestorm citadel vanaduke [32] (Environment/Music)"), fight: one("boss_1", 1, LAIR_FIGHT) },
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
  // knight creation at the crash site (client S): title.ogg plays on from the prologue's end (dK)
  if (/^crash site$/.test(n)) return PLACES.title;
  if (/haven|bazaar/.test(n)) return PLACES.haven;
  if (/arcade/.test(n)) return PLACES.arcade;
  if (/terminal core|core/.test(n)) return PLACES.core;
  if (/terminal/.test(n)) return PLACES.terminal;
  if (/emberlight|moorcroft/.test(n)) return PLACES.subtown;
  // (before the guild halls: "hall of heroes" starts with "hall" too)
  if (/hall of heroes/.test(n)) return PLACES.hallOfHeroes;
  if (/^hall\b|guild/.test(n)) return PLACES.guildHall;
  if (/mission lobby/.test(n)) return PLACES.missionLobby;
  if (/ready ?room/.test(n)) return PLACES.readyRoom;
  if (/dark halls lobby/.test(n)) return PLACES.darkHallsLobby;
  if (/dark halls/.test(n)) return PLACES.darkHallsFinale;
  if (/jigsaw|valley/.test(n)) return STYLE_MUSIC.valley;
  for (const k of Object.keys(BOSSES) as BossKey[]) if (n.includes(BOSSES[k].level.toLowerCase())) return BOSS_MUSIC[k].level;
  return null;
}

/**
 * Tracks only the archived levels play, from their own data (tools/music-survey.ts): their
 * logic spawns "Environment/Music" actors (the Royal Jelly court's arena plays main_theme under
 * the tag "music 1g"; the Firestorm Citadel's wave rooms battle_citadel, its Smoldering Steps
 * citadel_action), and the citadel's first four stages name the citadel_ambient/citadel_action
 * mix as their music global.
 */
export const SCRIPTED_MUSIC = [M("main_theme"), M("battle_citadel"), M("citadel_action")];

/** Every music file this table plays (for the docs and a test against the install's list). */
export function mappedFiles(): Set<string> {
  const out = new Set<string>(SCRIPTED_MUSIC);
  const add = (t: Track) => t.files.forEach(f => out.add(f.file));
  [...Object.values(PLACES), ...Object.values(MISSION_MUSIC), ...Object.values(FAMILY_MUSIC), ...Object.values(ELEMENT_MUSIC), ...Object.values(STYLE_MUSIC)].forEach(add);
  for (const b of Object.values(BOSS_MUSIC)) { add(b.level); add(b.fight); }
  for (const s of Object.values(STINGERS)) out.add(s);
  return out;
}
