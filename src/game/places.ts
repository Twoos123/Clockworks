// Scenes that are not plain entries of the scenes cache: the player's guild hall (the cached
// hall, refurnished), and the scene files the install ships under rsrc/world (the Ready Room
// and the knight creation crash site), each loaded through SceneLoader like a cached scene.

import type { Vfs } from "../vfs";
import type { SceneLoader } from "../scene";
import type { SaveData } from "./save";
import { guildOf, hallRoot } from "./guild";

/** Scene ids for selectScene. */
export const GUILD_HALL = "guild:hall";
export const READY_ROOM = "rsrc:world/readyroom/scene.dat";
export const CREATE_KNIGHT = "rsrc:world/createknight/scene.dat";

/** Display names (the HUD's minimap label); both count as towns (no monsters, no run). */
const NAMES: Record<string, string> = { [READY_ROOM]: "ready room", [CREATE_KNIGHT]: "crash site" };

/** Where the knight stands in scenes without a start platform. */
export const PLACE_SPAWN: Record<string, [number, number]> = { [READY_ROOM]: [0, 0], [CREATE_KNIGHT]: [0.5, 0.5] };

/** The cached guild hall's scene id (its name is "%guild:m.hall|~..."). */
export function cachedHallId(list: { id: string; name: string }[]): string | null {
  return list.find(s => /^hall\b/i.test(s.name))?.id ?? null;
}

/** The parsed scene root for a special id, or null when the id is an ordinary cached scene. */
export async function placeRoot(id: string, vfs: Vfs, loader: SceneLoader, list: { id: string; name: string }[], save: SaveData): Promise<any | null> {
  if (id === GUILD_HALL) {
    const hall = cachedHallId(list);
    if (!hall) throw new Error("No guild hall in the scenes cache.");
    return hallRoot(await loader.parse(await vfs.readScene(hall)), guildOf(save));
  }
  if (id.startsWith("rsrc:")) {
    const root = await loader.parse(await vfs.read(id.slice(5)));
    // the Ready Room's fog runs backwards (start 4.8, end 3), blacking out the foreground
    // between its fixed camera and the knight; with a free camera it hides the room, so it goes
    const entries = id === READY_ROOM ? (root.entries ?? []).filter((e: any) => e.sceneGlobal?.name !== "Environment/Fog") : root.entries;
    return { ...root, entries, name: NAMES[id] ?? id.slice(5) };
  }
  return null;
}
