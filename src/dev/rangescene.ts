// The Test Range's scene (development only, src/dev/testrange.ts): one flat hall painted with
// a simple floor tileset through the level generator's rule-based tiling (src/gen/themes.ts:
// the 000_Dev "Test Chamber" tiles, else Whitespace, else the Clockwork tunnels), no
// spawners, no treasure, no elevators. Nothing of the game's is shipped: the tiles, lights and
// sky come from the player's install like every generated floor's.

import { State } from "../gen/autotile";
import { generateLevel } from "../gen/level";
import type { Layout } from "../gen/layout";
import { themeLevel, type ThemeContext } from "../gen/themes";

/** The Test Range's scene id (Viewer.selectScene). */
export const TEST_RANGE = "dev:testrange";
/** The hall: floor cells wide and deep. */
export const RANGE_SIZE = { w: 32, h: 24 };
/** Tilesets tried in order: the plain grey test chamber first. */
export const RANGE_THEMES = ["dev", "whitespace", "clockworks"];

/** The hall's plan: a floor rectangle ringed by one (two for deep-edged tilesets) cells of wall. */
export function rangePlan(deep = false, w = RANGE_SIZE.w, h = RANGE_SIZE.h): Layout {
  const cells = new Map<string, State>();
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) cells.set(x + "," + y, State.Floor);
  const ring = deep ? 2 : 1;
  for (let x = -ring; x < w + ring; x++) for (let y = -ring; y < h + ring; y++) if (!cells.has(x + "," + y)) cells.set(x + "," + y, State.Other);
  const room = { x: 0, y: 0, w, h };
  return { cells, rooms: [room], start: 0, exit: 0 };
}

/** Where the knight stands in the hall (its middle, a little toward the south wall). */
export function rangeSpawn(w = RANGE_SIZE.w, h = RANGE_SIZE.h): [number, number] {
  return [Math.floor(w / 2) + 0.5, Math.floor(h * 0.4) + 0.5];
}

/** The scene root of the hall: the first tileset of RANGE_THEMES the install can paint. */
export async function rangeRoot(ctx: ThemeContext): Promise<any> {
  let last: unknown = null;
  for (const key of RANGE_THEMES) {
    try {
      const level = await themeLevel(key, ctx);
      if (!level.model.tiles.length) throw new Error(`no tiles for ${key}`);
      return generateLevel([], () => ({ width: 1, height: 1, walkable: false }), 1, "Test Range", [],
        { model: level.model, globals: level.globals, plan: deep => rangePlan(deep), encounters: false });
    } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error("no tileset for the Test Range");
}
