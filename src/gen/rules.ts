// Rule-based tiling for tilesets no cached level uses. The pieces are picked by name (each
// theme's spec says which tile names are floor, straight walls or edges, and inner and outer
// corners) and placed by the conventions the learned tilesets show: a straight piece at
// rotation 0 has the floor to its north and each quarter turn moves that side
// counter-clockwise (north, west, south, east); an outer corner at rotation 0 has the floor to
// its northwest; an inner corner at rotation 0 has floor north and west. Some tilesets turn
// their corners differently (`cornerInRot`, `cornerOutRot`), and some name their pieces by
// the side they sit on instead of turning them ("edge N", "out SW"): those are placed
// unrotated on their side.

import { State, type TileFacts, type TileModel } from "./autotile";

export interface RuleSpec {
  /** The tileset's name prefix in config/tile.dat ("Whitespace"). */
  prefix: string;
  /** Walkable single-cell floor tiles (matched against the name after the prefix). */
  floor: RegExp;
  /** Straight wall or edge pieces, turned to face the floor. */
  wall: RegExp;
  /** Pieces for the far side (floor to the south), placed unturned; else turned walls. */
  back?: RegExp;
  /** Inner corners (floor on two sides) and outer corners (floor on a diagonal). */
  cornerIn?: RegExp;
  cornerOut?: RegExp;
  /** The rotation at which an inner corner has floor north and west (default 0). */
  cornerInRot?: number;
  /** Quarter turns added to straight pieces (default 0: floor to the north at rotation 0). */
  wallRot?: number;
  /** The rotation at which an outer corner has the floor to its northwest (default 0). */
  cornerOutRot?: number;
  /**
   * Pieces named by where they sit, placed unturned: "N" is the piece on the north side of
   * the floor (floor to its south), "NE" an outer corner at the floor's northeast, "inNE" an
   * inner corner whose floor lies south and west. Each is a pattern with `$` standing for the
   * direction token, e.g. /^Ice\/edge $/.
   */
  sided?: { edge?: string; out?: string; in?: string };
  /**
   * A full tile config name for the near side (floor to the north only), where a tall wall
   * would hide the room from the camera: typically "Null, no-walk", an invisible blocker.
   */
  front?: string;
  /** Floors may be turned freely (plain textures). */
  floorTurns?: boolean;
}

/** Tile names of the theme matching a pattern: walkable single-cell for floors, else blocked. */
function pick(names: Map<string, TileFacts>, spec: RuleSpec, re: RegExp | undefined, walkable: boolean): string[] {
  if (!re) return [];
  const out: string[] = [];
  for (const [n, f] of names) {
    if (!n.startsWith(spec.prefix + "/") || f.width !== 1 || f.height !== 1 || f.walkable !== walkable) continue;
    if (re.test(n.slice(spec.prefix.length + 1))) out.push(n);
  }
  return out.sort();
}

// cardinal neighbour indices in DIRS (north, west, south, east) and the diagonals between
// them (northwest, southwest, southeast, northeast)
const CARD = [0, 2, 4, 6], DIAG = [1, 3, 5, 7];
const SIDE = ["N", "W", "S", "E"], CORNER = ["NW", "SW", "SE", "NE"];

/**
 * Builds a tiling model from a spec: every combination of floor and non-floor neighbours gets
 * the piece the rules choose. Floors are level; walls sit at the floor's elevation.
 */
export function ruleModel(spec: RuleSpec, names: Map<string, TileFacts>): TileModel {
  const floors = pick(names, spec, spec.floor, true);
  const walls = pick(names, spec, spec.wall, false);
  const backs = pick(names, spec, spec.back, false);
  const ins = pick(names, spec, spec.cornerIn, false);
  const outs = pick(names, spec, spec.cornerOut, false);
  if (!floors.length || !walls.length) throw new Error(`no floor or wall tiles for ${spec.prefix}`);
  const sided = (pattern: string | undefined, dir: string) => {
    if (!pattern) return [];
    const re = new RegExp("^" + pattern.replace("$", dir) + "$", "i");
    return [...names.keys()].filter(n => n.startsWith(spec.prefix + "/") && re.test(n.slice(spec.prefix.length + 1))
      && names.get(n)!.width === 1 && names.get(n)!.height === 1);
  };

  const tiles: any[] = [], index = new Map<string, number>();
  const tile = (name: string) => {
    let i = index.get(name);
    if (i === undefined) { index.set(name, i = tiles.length); tiles.push({ $class: "com.threerings.config.ConfigReference", name }); }
    return i;
  };
  type Choice = { names: string[]; rot: number };
  const turn = (r: number) => (r + (spec.wallRot ?? 0)) % 4;
  // the piece for a non-floor cell, by which neighbours are floor
  const choose = (f: boolean[]): Choice | null => {
    const card = CARD.map(d => f[d]);
    const n = card.filter(Boolean).length;
    if (spec.front && !card[1] && !card[2] && !card[3] && (f[0] || f[1] || f[7])) return { names: [spec.front], rot: 0 };
    if (n === 1) {
      const side = card.indexOf(true); // floor is on this side: the piece sits opposite
      const named = sided(spec.sided?.edge, SIDE[(side + 2) % 4]);
      if (named.length) return { names: named, rot: 0 };
      if (side === 2 && backs.length) return { names: backs, rot: 0 };
      return { names: walls, rot: turn(side) };
    }
    if (n === 2) {
      // two neighbouring sides: an inner corner; opposite sides: a thin wall
      for (let s = 0; s < 4; s++) if (card[s] && card[(s + 1) % 4]) {
        // floor on sides s and s+1 (north+west is s = 0)
        const named = sided(spec.sided?.in, CORNER[(s + 2) % 4]);
        if (named.length) return { names: named, rot: 0 };
        if (ins.length) return { names: ins, rot: (s + (spec.cornerInRot ?? 0)) % 4 };
        return { names: walls, rot: turn(s) };
      }
      return { names: walls, rot: turn(card.indexOf(true)) };
    }
    if (n >= 3) return { names: walls, rot: turn(card.indexOf(true)) };
    const diag = DIAG.map(d => f[d]);
    const c = diag.indexOf(true);
    if (c < 0) return null;
    // floor on one diagonal only: an outer corner (several: the first)
    const named = sided(spec.sided?.out, CORNER[(c + 2) % 4]);
    if (named.length) return { names: named, rot: 0 };
    if (outs.length) return { names: outs, rot: (c + (spec.cornerOutRot ?? 0)) % 4 };
    return { names: walls, rot: turn(c) };
  };

  const cases = new Map<string, { tile: number; rot: number; rel: number; weight: number }[]>();
  const floorObs = floors.flatMap(n => (spec.floorTurns ? [0, 1, 2, 3] : [0]).map(rot => ({ tile: tile(n), rot, rel: 0, weight: 1 })));
  // every neighbourhood of three states: floor, other, void
  for (let code = 0; code < 3 ** 8; code++) {
    const ns: State[] = [];
    for (let i = 0, c = code; i < 8; i++, c = Math.floor(c / 3)) ns.push(c % 3);
    cases.set(State.Floor + ":" + ns.join(""), floorObs);
    const ch = choose(ns.map(s => s === State.Floor));
    if (ch) cases.set(State.Other + ":" + ns.join(""), ch.names.map(n => ({ tile: tile(n), rot: ch.rot, rel: 0, weight: 1 })));
  }
  return { tiles, cases, deepEdges: 0 };
}
