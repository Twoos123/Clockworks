// Town exits. A scene's exits are areas named "Portals/...": walking into one runs its
// IntersectionStart handler, whose action the server carries out (the client data keeps the
// action's fields, not its class). They come in three shapes:
//
//  - a scene move (Tudey's AbstractMove: "Portals/Portal" with a scene id and a tagged portal,
//    the town square's and bazaar's exits);
//  - a town move (TownActionConfig.MoveToTown: "Portals/Town Portal", a town and a scene's
//    internal name, such as the guild hall's way out to Haven's Garrison);
//  - a training floor ("Portals/To Guild Training", "Portals/To Advanced Training": the
//    StartTraining action, stripped from the data).
//
// The game puts the knight at the target scene's placeable carrying the portal's tag (a
// "Dynamic/Portal/Destination" marker), facing along the marker; the target scene has to be
// in the install's scenes cache to be walked into here.

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
}

/** Where an exit leads: a cached scene to walk into, the Arcade, or a place the cache lacks. */
export type ExitTarget =
  | { kind: "scene"; id: string; portal: string }
  | { kind: "arcade" }
  | { kind: "missing"; place: string };

/** Message keys naming places the cache may lack, by a word of the exit's tags or names. */
const PLACES: [RegExp, string][] = [
  [/arcade/i, "%town:m.border_arcade"],
  [/garrison|eastside/i, "%town:m.border_eastside"],
  [/bazaar/i, "%town:m.border_bazaar"],
  [/town_square/i, "%town:m.border_town_square"],
  [/guild training|guild_training/i, "%guild:m.border_training_hall"],
  [/advanced training|advanced_training/i, "%town:m.border_training_hall"],
  [/guildhall|guild hall/i, "%town:m.border_guildhall"],
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
 * Where an exit leads, given the scenes in the cache and level archive (their ids are the
 * server's scene ids). When the Arcade (scene 3) is not there, its gate board stands in for it.
 */
export function exitTarget(info: PortalInfo, scenes: { id: string; name: string }[], ids: ReadonlySet<string> = new Set()): ExitTarget {
  const arcade = [...info.tags, info.portal].some(t => /arcade/i.test(t));
  if (Number.isFinite(info.sceneId)) {
    // (the archive's ids, named or not: its file names are the scene ids)
    const id = String(info.sceneId);
    if (ids.has(id) || scenes.some(s => s.id === id)) return { kind: "scene", id, portal: info.portal };
    if (arcade) return { kind: "arcade" };
  } else if (info.sceneInternalId) {
    // a town move names the scene by its message key ("haven_eastside" is "%town:m.haven_eastside")
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const hit = scenes.find(s => norm(s.name) === norm(info.sceneInternalId!));
    if (hit) return { kind: "scene", id: hit.id, portal: info.portal };
  } else if (arcade) return { kind: "arcade" };
  return { kind: "missing", place: placeKey(info) ?? "" };
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
