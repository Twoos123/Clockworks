// Town exits. A scene's exits are areas named "Portals/...": walking into one runs its
// IntersectionStart handler, whose action the server carries out (the client data keeps the
// action's fields, not its class). They come in these shapes (tools/exits.ts lists them all):
//
//  - a scene move (Tudey's AbstractMove: "Portals/Portal" with a scene id and a tagged portal,
//    the exits between the town square, the Bazaar, the Arcade and the Garrison);
//  - a town move (TownActionConfig.MoveToTown: "Portals/Town Portal", a town and a scene's
//    internal name, such as the Laboratory's, the Hall of Heroes' and a guild hall's ways out
//    to the Garrison; the old guild hall names the town and a portal only);
//  - a training floor (TownActionConfig.StartTraining: "Portals/To Advanced Training", whose
//    action the data strips; DungeonCodes.TrainingGate: the town's advanced_training_gate, and
//    a guild hall's "Portals/To Guild Training" with a floor, the guild_training_gate's tiers);
//    the training hall's "Portals/Leave Party" (DungeonActionConfig.LeaveParty) goes back to
//    Haven, at the hall's door;
//  - the Garrison's doors whose actions the data strips (TownActionConfig.EnterLaboratory,
//    EnterHallOfHeroes, GuildList: the server picks the instance, the guild list dialog a
//    hall) and the guild training hall's way back (GuildActionConfig.MoveToGuildhall).
//
// The game puts the knight at the target scene's placeable carrying the portal's tag (a
// "Dynamic/Portal/Destination" marker), facing along the marker, else at its default entrance
// ("Dynamic/Portal/Level Start"); the target scene has to be in the player's level archive.

import type { LogicEntry } from "../scene";

/** What a walked-into exit says (world.ts reports it through World.onPortal). */
export interface PortalInfo {
  /** The exit area's own tags ("to_bazaar_east"). */
  tags: string[];
  /** The target scene's id (a scene move), or NaN. */
  sceneId: number;
  /** The tag of the destination placeable in the target scene ("from_town_square_west"). */
  portal: string;
  /** The exit area's config name ("Portals/Portal"). */
  area?: string;
  /** A town move: the town and its scene's internal name ("haven", "haven_eastside"). */
  townName?: string;
  sceneInternalId?: string;
  /** A training gate's floor (a guild hall's training tiers: 0, 1, 2). */
  floor?: number;
  /** The action's class when the data names one ("MoveToGuildhall", "LeaveParty"). */
  action?: string;
}

/** Where an exit leads. */
export type ExitTarget =
  /** an archived scene, arriving at the portal's destination there ("" for the default entrance) */
  | { kind: "scene"; id: string; portal: string }
  /** the player's guild hall (src/game/places.ts GUILD_HALL) */
  | { kind: "guildhall"; portal: string }
  /** the Arcade's gate board, standing in for an Arcade the archive lacks */
  | { kind: "arcade" }
  /** a place the archive lacks (its message key, for the notice) */
  | { kind: "missing"; place: string };

/** Message keys naming places the cache may lack, by a word of the exit's tags or names. */
const PLACES: [RegExp, string][] = [
  [/arcade/i, "%town:m.border_arcade"],
  [/garrison|eastside/i, "%town:m.border_eastside"],
  [/bazaar/i, "%town:m.border_bazaar"],
  [/town_square/i, "%town:m.border_town_square"],
  [/guild training|guild_training/i, "%guild:m.border_training_hall"],
  [/advanced training|advanced_training/i, "%town:m.border_training_hall"],
  [/guildhall|guild hall|guild list/i, "%town:m.border_guildhall"],
  [/hall of heroes|hoh/i, "%town:m.border_hoh"],
  [/laboratory|spirallab/i, "%town:m.border_spirallab"],
  [/rescue_camp/i, "%town:m.border_rescue_camp"],
];

/** The message key naming the place an exit leads to, or null when nothing says. */
export function placeKey(info: PortalInfo): string | null {
  const words = [info.sceneInternalId ?? "", ...info.tags, info.area ?? "", info.portal];
  for (const w of words) for (const [re, key] of PLACES) if (w && re.test(w)) return key;
  return null;
}

/**
 * The scene a place's internal name stands for, when the archive holds several scenes of that
 * name: the live servers' scene. Haven's four districts are the scenes the current town's
 * exits name by id (the town square's lead to 2, 3 and 445; the archive's 134-136 and 435 are
 * Haven's 2012 copies, whose exits lead to each other). The other places are server instances
 * the client never names: the Advanced Training Hall the town's gate starts is 294 (a
 * TrainingSceneConfig; 83 is its older copy, 28906 the Pumping Up mission's floor); the
 * Laboratory's plain visit (MissionCodes' lab_default) is 25132 (Morlin's "Sprite Info" and
 * the harness installer; 437 and 438 are the sprite missions', 25133-25135 the sprites'
 * post-mission labs, 30893-30897 the boss-trophy labs, 27911 A New Threat's); the Hall of
 * Heroes' hall is star0, 449.
 */
export const PLACE_SCENES: Record<string, string[]> = {
  haven_town_square: ["1"],
  haven_bazaar: ["2"],
  haven_arcade: ["3"],
  haven_eastside: ["445"],
  rescue_camp_central: ["4"],
  advanced_training: ["294", "83", "28906"],
  haven_laboratory: ["25132", "25131"],
  hall_of_heroes_star0: ["449"],
  guild_training: ["446"],
  guild_training_t2: ["447"],
  guild_training_t3: ["448"],
};

/** A guild training gate's tiers, by floor (DungeonCodes.TrainingGate.GUILD). */
export const GUILD_TRAINING = ["guild_training", "guild_training_t2", "guild_training_t3"];

/**
 * Haven's arrival doors by their tags, for a town move that names no scene (the old guild
 * hall's way out names the town and "from_town_square_north", the Arcade's south door).
 */
export const HAVEN_DOORS: Record<string, string> = {
  from_garrison_west: "haven_town_square", from_arcade_central: "haven_town_square",
  from_bazaar_east: "haven_town_square", from_advanced_training: "haven_town_square",
  from_town_square_west: "haven_bazaar", from_arcade_northwest: "haven_bazaar", from_arcade_west: "haven_bazaar",
  from_arena: "haven_bazaar",
  from_garrison_north: "haven_arcade", from_town_square_north: "haven_arcade", from_bazaar_west: "haven_arcade",
  from_bazaar_northwest: "haven_arcade", from_dungeon: "haven_arcade",
  from_gate_0: "haven_arcade", from_gate_1: "haven_arcade", from_gate_2: "haven_arcade", from_gate_3: "haven_arcade",
  from_your_guildhall: "haven_eastside", from_arcade_east: "haven_eastside", from_town_square_east: "haven_eastside",
  from_hoh: "haven_eastside", from_lab: "haven_eastside", exit_guild_list: "haven_eastside",
};

const norm = (s: string) => s.toLowerCase().replace(/^(?:%[a-z]+:)+m\./, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/**
 * The archived scene a place's internal name ("haven_eastside", or a scene name such as
 * "haven eastside") stands for: the live scene of PLACE_SCENES when archived, else the newest
 * (highest id) archived scene of that name, else null.
 */
export function sceneForPlace(key: string, scenes: { id: string; name: string }[], ids: ReadonlySet<string> = new Set()): string | null {
  const k = norm(key);
  const have = (id: string) => ids.has(id) || scenes.some(s => s.id === id);
  for (const id of PLACE_SCENES[k] ?? []) if (have(id)) return id;
  const named = scenes.filter(s => norm(s.name) === k).sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
  return named[0]?.id ?? null;
}

/** The last word of an action's class ("com...GuildActionConfig$MoveToGuildhall": "MoveToGuildhall"). */
export function actionKind(cls: unknown): string | undefined {
  return typeof cls === "string" && cls ? cls.split(/[$.]/).pop() : undefined;
}

/**
 * Where an exit leads, given the scenes in the level archive (their ids are the server's scene
 * ids; `ids` holds every archived id, named or not) and the name of the scene it is in.
 */
export function exitTarget(info: PortalInfo, scenes: { id: string; name: string }[], ids: ReadonlySet<string> = new Set(), from = ""): ExitTarget {
  const have = (id: string) => ids.has(id) || scenes.some(s => s.id === id);
  const area = info.area ?? "";
  const missing = (): ExitTarget => ({ kind: "missing", place: placeKey(info) ?? "" });
  const place = (key: string, portal: string): ExitTarget => {
    const id = sceneForPlace(key, scenes, ids);
    return id ? { kind: "scene", id, portal } : missing();
  };
  // the guild training hall's way back, and the Garrison's guild list (a hall to visit)
  if (info.action === "MoveToGuildhall" || /^Portals\/To Guildhall$/i.test(area)) return { kind: "guildhall", portal: info.portal };
  if (/^Portals\/Guild List$/i.test(area)) return { kind: "guildhall", portal: "" };
  // a training floor's way out (DungeonActionConfig.LeaveParty): back to Haven, at the door the
  // place is entered by (the Advanced Training Hall's in the town square; a Hall of Heroes
  // mission level's, the Hall of Heroes' in the Garrison)
  if (info.action === "LeaveParty" || /^Portals\/Leave Party$/i.test(area))
    return /^hall of heroes/i.test(from) ? place("haven_eastside", "from_hoh") : place("haven_town_square", "from_advanced_training");
  // the training gates: the town's Advanced Training Hall, a guild hall's tiers by floor
  if (/^Portals\/To Advanced Training$/i.test(area)) return place("advanced_training", info.portal);
  if (/^Portals\/To Guild Training$/i.test(area)) {
    const tier = GUILD_TRAINING[Math.max(0, Math.min(GUILD_TRAINING.length - 1, Number(info.floor) || 0))];
    return place(tier, info.portal);
  }
  if (/^Portals\/To Laboratory$/i.test(area)) return place("haven_laboratory", info.portal);
  if (/^Portals\/To Hall of Heroes$/i.test(area)) return place("hall_of_heroes_star0", info.portal);
  if (Number.isFinite(info.sceneId)) {
    const id = String(info.sceneId);
    if (have(id)) return { kind: "scene", id, portal: info.portal };
    // an id the archive lacks: the place of that name, else (the Arcade) its gate board
    if (/arcade/i.test([...info.tags, info.portal].join(" "))) {
      const arcade = sceneForPlace("haven_arcade", scenes, ids);
      return arcade ? { kind: "scene", id: arcade, portal: info.portal } : { kind: "arcade" };
    }
    return missing();
  }
  // a town move names the scene by its internal name ("haven_eastside": "%town:m.haven_eastside"),
  // or only the town (the scene holding the portal's door)
  if (info.sceneInternalId) return place(info.sceneInternalId, info.portal);
  if (info.townName) {
    const key = HAVEN_DOORS[info.portal] ?? (/^haven$/i.test(info.townName) ? "haven_town_square" : info.townName);
    return place(key, info.portal);
  }
  return missing();
}

/**
 * What each of a scene's exit areas reports when walked into, read from its logic entries as
 * the logic engine reads them (src/game/logic.ts and world.ts: a parameter-built action with
 * a portal, or a guild hall's training floor, is a scene change; an exit area whose action
 * the data dropped is an exit still; the guild training hall's MoveToGuildhall and the
 * training hall's LeaveParty, inside a Compound or not, are exits too).
 */
export function exitsOf(logic: LogicEntry[]): { entry: LogicEntry; info: PortalInfo }[] {
  const out: { entry: LogicEntry; info: PortalInfo }[] = [];
  for (const e of logic) {
    if (!/^Portals\//.test(e.name)) continue;
    for (const h of e.handlers) {
      if (actionKind(h?.$class) !== "IntersectionStart") continue;
      const actions = (a: any): any[] => a && actionKind(a.$class) === "Compound" ? (a.actions ?? []).flatMap(actions) : [a];
      for (const a of actions(h.action)) {
        const k = actionKind(a?.$class);
        if (a && k && k !== "MoveToGuildhall" && k !== "LeaveParty") continue;
        out.push({ entry: e, info: {
          tags: e.tags, sceneId: Number(a?.sceneId), portal: String(a?.portal?.tag ?? ""), area: e.name,
          ...(a?.townName !== undefined ? { townName: a.townName } : {}),
          ...(a?.sceneInternalId !== undefined ? { sceneInternalId: a.sceneInternalId } : {}),
          ...(typeof a?.floor === "number" ? { floor: a.floor } : {}),
          ...(k ? { action: k } : {}),
        } });
      }
    }
  }
  return out;
}

/** Where the knight arrives: a placement and the heading it faces (along +x at 0). */
export interface Arrival { x: number; y: number; heading: number }

/**
 * The destination placeable carrying a portal's tag in a scene's logic entries, else the
 * scene's default entrance ("Dynamic/Portal/Level Start"). Logic entries already hold the
 * placeable's rotation as an actor heading (its Z rotation less a quarter turn, as Tudey's
 * EntryLogic does), which faces out of the portal the knight came through.
 */
export function arrivalPoint(logic: LogicEntry[], portal: string): Arrival | null {
  const at = (portal && logic.find(e => /Portal\/(Destination|Level Start)/.test(e.name) && e.tags.includes(portal)))
    || logic.find(e => /Portal\/Level Start/.test(e.name))
    || null;
  return at ? { x: at.x, y: at.y, heading: at.rotation } : null;
}
