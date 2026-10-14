// Scenes that are not plain entries of the scenes cache: the player's guild hall (the cached
// hall, refurnished), and the scene files the install ships under rsrc/world (the Ready Room
// and the knight creation crash site), each loaded through SceneLoader like a cached scene.

import type { Vfs } from "../vfs";
import type { SceneLoader } from "../scene";
import type { SaveData } from "./save";
import { readCamera, type CameraView } from "../environment";
import { guildOf, hallRoot } from "./guild";

/** Scene ids for selectScene. */
export const GUILD_HALL = "guild:hall";
export const READY_ROOM = "rsrc:world/readyroom/scene.dat";
export const CREATE_KNIGHT = "rsrc:world/createknight/scene.dat";

/** Display names (the HUD's minimap label); both count as towns (no monsters, no run). */
const NAMES: Record<string, string> = { [READY_ROOM]: "ready room", [CREATE_KNIGHT]: "crash site" };

/** Where the knight stands in scenes without a start platform. */
export const PLACE_SPAWN: Record<string, [number, number]> = { [READY_ROOM]: [0, 0], [CREATE_KNIGHT]: [0, 0] };

/**
 * Knight creation is a stage too (client S, the creator's scene view): its own knight
 * (a Dungeoneer with the starter sword and Proto Shield) stands at the origin facing -pi/2, the
 * camera on it; it takes no orders. Holding the mouse on the scene turns it: a half turn a
 * second, toward the side of the knight the pointer is on (client T), once the scene has been
 * up 3.5 s (client U).
 */
export const CREATE_KNIGHT_POSE = { heading: -Math.PI / 2, turnSpeed: Math.PI, turnDelay: 3.5 };

/**
 * The creation camera, as the real client's screen shows it (the scene names no camera of its
 * own): low and close, a little to the knight's left, the knight standing right of centre.
 * The offset moves the camera's target 0.8 units to the screen's left of the knight.
 */
export const CREATE_KNIGHT_CAMERA: CameraView = {
  zoom: 0, fov: 0.75, azimuth: 0.35, elevation: 0.15, distance: 6.5,
  offset: [-0.8 * Math.cos(0.35), -0.8 * Math.sin(0.35), 1],
};

/**
 * The Ready Room is a stage, not a place to walk (the client's ReadyRoomSceneConfig and its
 * scene view): the client puts a Knight sprite of its own at the origin, rotation -pi/2, in
 * activity 3, which KnightSprite plays as "use_inventory_start" then "use_inventory_loop"; no
 * pawn exists there to steer.
 */
export const READY_ROOM_POSE = {
  heading: -Math.PI / 2,
  start: "character/pc/use_inventory_start.dat",
  loop: "character/pc/use_inventory_loop.dat",
};

/** The cached guild hall's scene id (its name is "%guild:m.hall|~..."). */
export function cachedHallId(list: { id: string; name: string }[]): string | null {
  return list.find(s => /^hall\b/i.test(s.name))?.id ?? null;
}

/**
 * The CameraConfig of a scene's "Camera/Default" placeable (a camera area; the Ready Room's
 * covers the whole room: fov 30 degrees, azimuth -120, elevation 11, distance 4.93, offset
 * 0.667 toward -y and 1 up), or null without one.
 */
export function placeCamera(root: any): CameraView | null {
  for (const e of root?.entries ?? []) {
    if (e?.placeable?.name !== "Camera/Default") continue;
    const args = e.placeable.arguments?.entries as [string, any][] | undefined;
    const cam = args?.find(([k]) => k === "Camera")?.[1];
    if (cam) return readCamera(cam);
  }
  return null;
}

/** The parsed scene root for a special id, or null when the id is an ordinary cached scene. */
export async function placeRoot(id: string, vfs: Vfs, loader: SceneLoader, list: { id: string; name: string }[], save: SaveData): Promise<any | null> {
  if (id === GUILD_HALL) {
    const hall = cachedHallId(list);
    if (!hall) throw new Error("No guild hall in the scenes cache.");
    return hallRoot(await loader.parse(await vfs.readScene(hall)), guildOf(save));
  }
  if (id.startsWith("rsrc:")) {
    // (the Ready Room's fog runs backwards, start 4.8 and end 3: from its fixed camera it blacks
    // out the foreground between the lens and the knight, as its loading picture shows)
    const root = await loader.parse(await vfs.read(id.slice(5)));
    return { ...root, name: NAMES[id] ?? id.slice(5) };
  }
  return null;
}
