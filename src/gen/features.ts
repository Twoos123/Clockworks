// Puzzles, special rooms and decoration for generated floors, built from the game's own
// placeables and wired the way the cached Clockworks levels wire them (see
// docs/research/generated-features.md for the levels each pattern is copied from):
//
//   gold key      a "Dynamic/Lift Objects/Gold Key" on its "Dynamic/Misc/Altar/Gold Key" in a
//                 room off the main path; a "Dynamic/Door/Iron Gate/Gold 3" seals a room on the
//                 path ahead (Jigsaw Valley: The Jade Tangle, scene 376)
//   switch gate   a closed "Iron Gate/Trigger 3" in front of a side room, opened by a "Dynamic/
//                 Switch/Party Platform/Base" in the room next to it, or by a "One-Time" button a
//                 "Trigger/Start Up Trigger" drops on one of several "Generic Marker"s (scene 370)
//   secret room   what such a gate hides: treasure boxes and a crown cache ("Trigger/One Time
//                 Action" with a "Treasure/Crowns/Scaled Crown" table spawn, scene 376)
//   block wall    a corridor filled with the tileset's breakable blocks or crystal blocks
//   spike run     "Dynamic/Traps and Hazards/Floor/Spikes" plates down a corridor, alternating
//                 cycles A and B (the game's trap tiles spawn the same actor at start-up)
//   turrets       Gun Puppy spawners in a room's corners (Construct turrets are monsters)
//   minerals      "Dynamic/Block/Mineral/Class {tb}/Generic Mineral" against room walls
//   danger room   a side room sealed by its own platform: escalating waves chained by
//                 "Trigger/Actor Removed", battle music, then a reward of rare treasure boxes
//                 and crowns (the wave chain and music are scene 370's; the reward is ours)
//   arena hall    the same chain in one big hall whose gates close on entry
//   vault         every room holds vault treasure and prize-vault breakables; side rooms sit
//                 behind "Dynamic/Door/Vault/Trigger 3" doors opened by platforms; no monsters
//   decoration    the tileset's props (Prop/<tileset>/...) and the stratum family's lairs and
//                 litter; blocking ones against walls, the rest on the floor; lights
//
// Every gate opens from the start side, and flood fills check the plan: the exit is reachable
// with every puzzle solved, and each key is reachable with its gate shut.

import type { Room } from "./layout";

export type FloorStyle = "standard" | "vault" | "danger" | "arena";

export interface FeatureOptions {
  style?: FloorStyle;
  /** The generator theme key (valley, clockworks, castle...). */
  theme: string;
  rand: () => number;
  /** The stratum's spawn tables (src/game/clockworks.ts stratumTables), if any. */
  tables?: string[];
  /** Walkable cells, if known from the tiles; else the plan's floor. */
  walkable?: (x: number, y: number) => boolean;
}

export interface FeatureReport {
  style: FloorStyle;
  /** What was added, e.g. "gold key", "danger room". */
  features: string[];
  /** The exit is reachable from the start with every puzzle solved. */
  reachable: boolean;
  /** Every key is reachable from the start with its gate closed. */
  keysReachable: boolean;
  /** Feature cells for tests and the in-browser checks. */
  marks: { kind: string; x: number; y: number }[];
}

/** Layout options for a floor style (src/gen/layout.ts). */
export function layoutFor(style: FloorStyle | undefined): { rooms?: number; sizes?: [number, number][]; chain?: boolean } | undefined {
  if (style === "arena") return { rooms: 3, chain: true, sizes: [[9, 9], [20, 18], [9, 9]] };
  if (style === "vault") return { rooms: 6 };
  if (style === "danger") return { rooms: 7 };
  return undefined;
}

// ------------------------------------------------------------------- config references

const CLS = "com.threerings.tudey.data.TudeySceneModel$";
const REF = "com.threerings.config.ConfigReference";
const ACT = "com.threerings.tudey.config.ActionConfig$";
const DACT = "com.threerings.projectx.dungeon.config.DungeonActionConfig$";
const TAGGED = "com.threerings.tudey.config.TargetConfig$Tagged";
const argMap = (entries: [string, unknown][]) => ({ $map: "com.threerings.config.ArgumentMap", entries });
const ref = (name: string, args?: [string, unknown][]) => (args ? { $class: REF, name, arguments: argMap(args) } : { $class: REF, name });
const signal = (name: string, tag: string) => ({ $class: ACT + "Signal", name, target: { $class: TAGGED, tag } });
const compound = (...actions: any[]) => ({ $class: ACT + "Compound", actions });
const spawnActor = (actor: any) => ({ $class: ACT + "SpawnActor", actor });
const destroyTagged = (tag: string) => ({ $class: ACT + "DestroyActor", target: { $class: TAGGED, tag } });
const tableSpawn = (table: string) => ({ $class: DACT + "TableSpawn", spawnTable: ref(table) });
const color = (r: number, g: number, b: number) => ({ $class: "com.threerings.opengl.renderer.Color4f", r, g, b, a: 1 });
/** The battle music a wave room plays until its last wave falls (scene 370's platform). */
const music = (tag: string, file = "sound/music/battle_1.ogg") => spawnActor(ref("Environment/Music", [
  ["Destruction Transient", ref("model/scripted/play_sound_clip.dat", [["File", "sound/music/fanfare_victory_1.ogg"], ["Gain", 1]])],
  ["Fade In", 0], ["Fade Out", 3], ["File", file], ["Override", true], ["Stack", "default"], ["Tag", tag]]));
const table = (name: string, wave: string, depthOffset = 0) =>
  ref(name, [["Alternate Loot", null], ["Depth Offset", depthOffset], ["Loot", "Primary"], ["Wave Tag", wave]]);

// ------------------------------------------------------------------- theme palettes

/** A decoration piece: its placeable, whether it blocks, and its length along a wall (cells). */
interface Piece { name: string; len?: number }
interface Palette {
  /** Blocking props, stood against walls. */
  wall: Piece[];
  /** Non-blocking props, scattered on floors. */
  floor: Piece[];
  /** Breakable decoration (blocks), against walls. */
  breakable: string[];
  /** The block a block wall is built of. */
  block: string;
  /** Light props stood against walls (lamps, braziers, lanterns). */
  lamps: Piece[];
  /** Point light colour for the rooms. */
  light: [number, number, number];
}

const P = (names: string[], len?: number): Piece[] => names.map(name => ({ name, len }));
const GRASS = "Prop/General/Nature/Foliage/Grass variants/";

function skyPalette(season: "Day" | "Night" | "Autumn" | "Winter"): Palette {
  const p = `Prop/Sky Islands, ${season}/`;
  const grass = season === "Night" ? "Sky Islands Night" : season === "Day" ? "Sky Islands Day" : season === "Autumn" ? "Dry" : "Haven, Winter/Grass";
  const shrub = season === "Day" ? ["Shrub 1, green", "Shrub 2, yellow-green", "Shrub 1, yellow-green"]
    : season === "Autumn" ? ["Shrub 1, gold autumn", "Shrub 2, red autumn"] : season === "Winter" ? ["Shrub 1, winter blue", "Shrub 2, winter blue"] : ["Shrub 1, blue", "Shrub 2, blue"];
  return {
    wall: P([`${p}Natural/Spiral Tree`, `${p}Natural/Spiral Tree`, `${p}Natural/Boulder 01`, `${p}Natural/Boulder, Short`, `${p}Natural/Boulder, Stacked`,
      `${p}Natural/Boulder, Runes 01`, `${p}Natural/Stump`, `${p}Natural/Stump (Axe)`, `${p}Natural/Log (Lrg)`, `${p}Puppy Statue`]),
    floor: P([`${GRASS}${grass} billboard, small 1`, `${GRASS}${grass} billboard, single 1`, `${GRASS}${grass} billboard, large 1`, `${GRASS}${grass} tuft 1`]),
    breakable: shrub.map(s => `Dynamic/Breakable Objects/Sky Islands, Day/${s}`),
    block: `Dynamic/Block/Breakable/Sky Islands, ${season}`,
    lamps: season === "Night" ? P([`${p}Lantern, blue`, `${p}Lantern, orange`, `${p}Lantern, violet`]) : [],
    light: season === "Night" ? [0.45, 0.5, 1] : [1, 0.95, 0.8],
  };
}

const CLOCKWORKS: Palette = {
  wall: [...P(["Prop/Knights/Block - Toughbox", "Prop/Knights/Block - Toughbox, Empty", "Prop/Gremlin/Roadblock 01", "Prop/Gremlin/Toolbox",
    "Prop/Factory/Electrical Bits/Transformer", "Prop/Catacombs/Rubble/Brick pile 01, catacombs", "Prop/Clockworks/Tech/Water Drums/Water drum, cylindrical"]),
    ...P(["Prop/Gremlin/Lockers - tall, 01", "Prop/Gremlin/Lockers - tall, 02"], 2)],
  floor: P(["Prop/Clockworks/Pipes, floor small/Iron, straight x2", "Prop/Clockworks/Pipes, floor small/Iron, elbow L", "Prop/Clockworks/Pipes, floor small/Iron, Terminate",
    "Prop/Clockworks/Tech/Nut & Bolt/Nut & Bolt, Iron 01", "Prop/Clockworks/Tech/Screw (giant 01)", "Prop/Gremlin/Tool, wrench",
    "Prop/Catacombs/Rubble/Brick loose 01, catacombs", "Prop/Catacombs/Rubble/Brick loose 02, catacombs",
    `${GRASS}Clockworks Base billboard, small 1`, `${GRASS}Clockworks Base billboard, single 1`, `${GRASS}Clockworks Base tuft 1`, "Prop/Knights/Flare"]),
  breakable: ["Dynamic/Breakable Objects/Clockworks/Bucket o bolts", "Dynamic/Breakable Objects/Clockworks/Bucket, empty"],
  block: "Dynamic/Block/Breakable/Clockworks, base",
  lamps: P(["Prop/Clockworks/Lamp, tall rail-mounted", "Prop/Clockworks/Lamp, short rail-mounted"]),
  light: [1, 0.76, 0.45],
};

const CASTLE: Palette = {
  wall: P(["Prop/Castle/Structural/Stonework/Full block 01", "Prop/Catacombs/Natural/Stone, medium 01", "Prop/Catacombs/Rubble/Brick pile 01, catacombs",
    "Prop/Catacombs/Rubble/Brick pile 02, catacombs", "Prop/General/Undead/Bone pile, skulls"]),
  floor: P(["Prop/Catacombs/Rubble/Brick loose 01, catacombs", "Prop/Catacombs/Rubble/Brick loose 02, catacombs", "Prop/General/Undead/Bones, skull",
    "Prop/General/Undead/Bone plane, pieces", "Prop/Catacombs/Fungibulb/Fungibulb, small 1", "Prop/General/Undead/Dust Pile"]),
  breakable: ["Dynamic/Breakable Objects/Castle/Library/Book stack 01", "Dynamic/Breakable Objects/Castle/Library/Book stack 02",
    "Dynamic/Breakable Objects/Castle/Furniture/Candlestick Keep/Chair, antique 1", "Dynamic/Breakable Objects/Castle/Furniture/Candlestick Keep/Bench, antique 1"],
  block: "Dynamic/Block/Breakable/Castle",
  lamps: P(["Prop/Castle/Brazier/Brazier, tall", "Dynamic/Breakable Objects/Castle/Gaslamps/Gaslamp, tall", "Prop/Castle/Brazier/Brazier, ground"]),
  light: [1, 0.6, 0.3],
};

const GRAVEYARD: Palette = {
  wall: P(["Prop/Graveyard/Tombstones/Tombstone, busted", "Prop/Graveyard/Tombstones/Tombstone, creature head", "Prop/Graveyard/Tombstones/Tombstone, obelisk",
    "Prop/Graveyard/Tombstones/Tombstone, small rounded; Static", "Prop/Graveyard/Tombstones/Tombstone, small planed; Static", "Prop/Graveyard/Stone, medium 01",
    "Prop/Graveyard/Rubble/Brick pile 01, graveyard"]),
  floor: P(["Prop/Graveyard/Candles", "Prop/Graveyard/Burial Mound Prop", "Prop/General/Undead/Bones, skull", "Prop/General/Undead/Ground Fog",
    "Prop/Graveyard/Rubble/Brick loose 01, graveyard", `${GRASS}Graveyard billboard, small 1`, `${GRASS}Graveyard tuft 1`]),
  breakable: ["Dynamic/Breakable Objects/Graveyard/Brazier, ground"],
  block: "Dynamic/Block/Breakable/Graveyard",
  lamps: P(["Dynamic/Breakable Objects/Graveyard/Brazier, tall"]),
  light: [0.55, 0.7, 1],
};

const VAULT: Palette = {
  wall: [...P(["Prop/Knights/Block - Toughbox", "Prop/Knights/Block - Toughbox, Gear 01", "Prop/Knights/Computer 1, toughbox"]),
    ...P(["Prop/Gremlin/Lockers - tall, 01"], 2)],
  floor: P(["Prop/Knights/Flare", "Prop/Clockworks/Tech/Nut & Bolt/Nut & Bolt, Iron 01", "Prop/Clockworks/Pipes, floor small/Iron, straight x2"]),
  breakable: ["Dynamic/Block/Breakable/Random/Prize Vault - 100%, no-ghost"],
  block: "Dynamic/Block/Breakable/Random/Prize Vault, base",
  lamps: P(["Prop/Clockworks/Lamp, tall rail-mounted", "Prop/Castle/Brazier/Brazier, tall"]),
  light: [1, 0.85, 0.5],
};

const GENERIC: Palette = {
  wall: P(["Prop/Knights/Block - Toughbox", "Prop/Gremlin/Roadblock 01", "Prop/Gremlin/Toolbox"]),
  floor: P(["Prop/Knights/Flare", `${GRASS}Grass billboard, small 1`, `${GRASS}Grass tuft 1`]),
  breakable: ["Dynamic/Block/Crystal/Random/Any Color"],
  block: "Dynamic/Block/Crystal/Random/Any Color",
  lamps: P(["Prop/Clockworks/Lamp, tall rail-mounted"]),
  light: [1, 0.9, 0.75],
};

/** The palette for a generator theme key (both src/gen/themes.ts keys and the older ones). */
export function paletteFor(theme: string, style: FloorStyle = "standard"): Palette {
  if (style === "vault" || /vault/.test(theme)) return VAULT;
  if (/night/.test(theme)) return skyPalette("Night");
  if (/autumn/.test(theme)) return skyPalette("Autumn");
  if (/winter/.test(theme)) return skyPalette("Winter");
  if (/valley|sky/.test(theme)) return skyPalette("Day");
  if (/clockworks|tunnels/.test(theme)) return CLOCKWORKS;
  if (/graveyard/.test(theme)) return GRAVEYARD;
  if (/castle|keep|halls/.test(theme)) return CASTLE;
  return GENERIC;
}

/** Litter and lairs of the stratum's monster family (monster beds, bones, sigils, slime). */
function familyPieces(family: string | null, sky: boolean): { floor: Piece[]; wall: Piece[] } {
  const dens = sky ? "Prop/Sky Islands, Day/Natural/Beast Dens/" : "Prop/Clockworks/Beast Dens (default)/";
  switch (family) {
    case "Beast": return { floor: P([`${dens}Beast Nest Large`, `${dens}Beast Nest Small`, `${dens}Wolver Den`, `${dens}Beast Debris Large`, `${dens}Beast Debris Small`]), wall: [] };
    case "Undead": return { floor: P(["Prop/General/Undead/Bone plane, ribs", "Prop/General/Undead/Bones, ribcage", "Prop/General/Undead/Ground Fog", "Prop/General/Undead/Dust Pile"]),
      wall: P(["Prop/General/Undead/Bone pile, skulls", "Prop/General/Undead/Bone pile, stack"]) };
    case "Fiend": return { floor: P(["Prop/General/Fiend/Sigil - Circle, medium full", "Prop/General/Fiend/Sigil - Rune 01", "Prop/General/Fiend/Sigil - Rune 04",
      "Prop/General/Fiend/Sigil - Line, curled", "Prop/General/Fiend/Fiend Shards"]), wall: [] };
    case "Slime": return { floor: P(["Prop/General/Jelly/Jelly glob, small", "Prop/General/Jelly/Jelly glob, medium", "Prop/General/Jelly/Jelly glob, large"]), wall: [] };
    case "Gremlin": return { floor: P(["Prop/Gremlin/Tool, shovel", "Prop/Gremlin/Tool, wrench", "Prop/Gremlin/Tool, drillgun", "Prop/Gremlin/Junk, Busted Sword"]),
      wall: P(["Prop/Gremlin/Toolbox", "Prop/Gremlin/Stool", "Prop/Gremlin/Anvil"]) };
    case "Construct": return { floor: P(["Prop/Clockworks/Tech/Nut & Bolt/Nut & Bolt, Iron 01", "Prop/Clockworks/Tech/Screw (giant 01)", "Prop/Clockworks/Tech/Warning Light"]), wall: [] };
    default: return { floor: [], wall: [] };
  }
}

const FAMILY = /Family\/(Beast|Construct|Fiend|Gremlin|Slime|Undead)\//;

// ------------------------------------------------------------------- the floor plan

const key = (x: number, y: number) => x + "," + y;
const N4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

interface Mouth {
  room: number;
  /** Corridor component it opens onto. */
  comp: number;
  /** Cells just outside the room side. */
  cells: [number, number][];
  side: "n" | "s" | "e" | "w";
  /** Gate position (the run's middle cell's centre) and rotation (as arenaRooms). */
  x: number; y: number; rot: number;
}

class Plan {
  readonly rooms: Room[];
  readonly start: number;
  readonly exit: number;
  readonly floor = new Set<string>();
  readonly roomAt = new Map<string, number>();
  readonly comps: { cells: string[]; rooms: Set<number> }[] = [];
  readonly compAt = new Map<string, number>();
  readonly mouths: Mouth[] = [];
  readonly graph: Set<number>[];
  readonly path: number[];
  /** Cells that features or decoration took (nothing else goes there). */
  readonly used = new Set<string>();
  /** Cells blocked for good by decoration (props with collision). */
  readonly blocked = new Set<string>();
  /** Cells closed until a puzzle is solved: gate or block wall cells, by puzzle. */
  readonly gates: { kind: string; cells: string[] }[] = [];
  /** Keys: where each lies and the gate it opens. */
  readonly keys: { x: number; y: number; gate: number }[] = [];

  constructor(gen: { rooms: Room[]; start: number; exit: number; floor: string[] }, walkable?: (x: number, y: number) => boolean) {
    this.rooms = gen.rooms; this.start = gen.start; this.exit = gen.exit;
    for (const k of gen.floor) {
      const [x, y] = k.split(",").map(Number);
      if (!walkable || walkable(x, y)) this.floor.add(k);
    }
    this.rooms.forEach((r, i) => { for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) this.roomAt.set(key(x, y), i); });
    // corridor components: floor outside the rooms, joined four ways
    for (const k of this.floor) {
      if (this.roomAt.has(k) || this.compAt.has(k)) continue;
      const id = this.comps.length, comp = { cells: [] as string[], rooms: new Set<number>() };
      this.comps.push(comp);
      const q = [k];
      this.compAt.set(k, id);
      while (q.length) {
        const c = q.pop()!;
        comp.cells.push(c);
        const [x, y] = c.split(",").map(Number);
        for (const [dx, dy] of N4) {
          const n = key(x + dx, y + dy);
          const r = this.roomAt.get(n);
          if (r !== undefined) { if (this.floor.has(n)) comp.rooms.add(r); continue; }
          if (this.floor.has(n) && !this.compAt.has(n)) { this.compAt.set(n, id); q.push(n); }
        }
      }
    }
    this.graph = this.rooms.map(() => new Set<number>());
    for (const c of this.comps) for (const a of c.rooms) for (const b of c.rooms) if (a !== b) this.graph[a].add(b);
    // rooms touching directly (no corridor between) count as joined too
    this.rooms.forEach((r, i) => {
      for (let x = r.x - 1; x <= r.x + r.w; x++) for (let y = r.y - 1; y <= r.y + r.h; y++) {
        const o = this.roomAt.get(key(x, y));
        if (o !== undefined && o !== i) { this.graph[i].add(o); this.graph[o].add(i); }
      }
    });
    // mouths: runs of corridor cells just outside each room side
    this.rooms.forEach((r, i) => {
      const side = (cells: [number, number][], s: Mouth["side"]) => {
        let run: [number, number][] = [];
        const flush = () => {
          if (run.length) {
            const m = run[Math.floor(run.length / 2)];
            this.mouths.push({ room: i, comp: this.compAt.get(key(m[0], m[1]))!, cells: run, side: s, x: m[0] + 0.5, y: m[1] + 0.5,
              rot: s === "n" || s === "s" ? 0 : Math.PI / 2 });
          }
          run = [];
        };
        for (const c of cells) { if (this.compAt.has(key(c[0], c[1]))) run.push(c); else flush(); }
        flush();
      };
      const xs = Array.from({ length: r.w }, (_, k) => r.x + k), ys = Array.from({ length: r.h }, (_, k) => r.y + k);
      side(xs.map(x => [x, r.y + r.h] as [number, number]), "n");
      side(xs.map(x => [x, r.y - 1] as [number, number]), "s");
      side(ys.map(y => [r.x - 1, y] as [number, number]), "w");
      side(ys.map(y => [r.x + r.w, y] as [number, number]), "e");
    });
    this.path = this.roomPath(this.start, this.exit) ?? [this.start, this.exit];
  }

  roomPath(a: number, b: number, without?: (i: number, j: number) => boolean): number[] | null {
    const prev = new Map<number, number>([[a, -1]]);
    const q = [a];
    while (q.length) {
      const i = q.shift()!;
      if (i === b) break;
      for (const j of this.graph[i]) if (!prev.has(j) && !without?.(i, j)) { prev.set(j, i); q.push(j); }
    }
    if (!prev.has(b)) return null;
    const out: number[] = [];
    for (let i = b; i !== -1; i = prev.get(i)!) out.unshift(i);
    return out;
  }

  centre(i: number): [number, number] { const r = this.rooms[i]; return [Math.floor(r.x + r.w / 2), Math.floor(r.y + r.h / 2)]; }
  onPath(i: number) { return this.path.includes(i); }
  /** Rooms off the main path with a single way in (dead ends). */
  deadEnds(): number[] {
    return this.rooms.map((_, i) => i).filter(i => i !== this.start && i !== this.exit && !this.onPath(i) && this.graph[i].size === 1
      && this.mouths.filter(m => m.room === i).length === 1);
  }

  /** Cells reachable from (x, y) over the floor, avoiding `closed`. */
  flood(x: number, y: number, closed: Set<string>): Set<string> {
    const seen = new Set<string>();
    const s = key(x, y);
    if (!this.floor.has(s) || closed.has(s)) return seen;
    seen.add(s);
    const q: [number, number][] = [[x, y]];
    while (q.length) {
      const [cx, cy] = q.pop()!;
      for (const [dx, dy] of N4) {
        const n = key(cx + dx, cy + dy);
        if (this.floor.has(n) && !closed.has(n) && !seen.has(n)) { seen.add(n); q.push([cx + dx, cy + dy]); }
      }
    }
    return seen;
  }

  /** A free cell in room `i` near its middle, `off` cells from the centre. */
  freeCell(i: number, rand: () => number, opts: { margin?: number; avoidCentre?: number } = {}): [number, number] | null {
    const r = this.rooms[i], m = opts.margin ?? 1, [cx, cy] = this.centre(i);
    const cells: [number, number][] = [];
    for (let x = r.x + m; x < r.x + r.w - m; x++) for (let y = r.y + m; y < r.y + r.h - m; y++) {
      if (this.used.has(key(x, y)) || !this.floor.has(key(x, y))) continue;
      if (opts.avoidCentre && Math.max(Math.abs(x - cx), Math.abs(y - cy)) < opts.avoidCentre) continue;
      cells.push([x, y]);
    }
    return cells.length ? cells[Math.floor(rand() * cells.length)] : null;
  }
}

// ------------------------------------------------------------------- the features

/**
 * Adds puzzles, a special level style's rooms and decoration to a generated root (from
 * src/gen/level.ts, which leaves its plan in `root.gen`). Called after arenaRooms (main.ts):
 * rooms given a role lose the arena wiring it added, and puzzle gates replace its gates.
 */
export function addFeatures(root: any, opts: FeatureOptions): FeatureReport {
  const style = opts.style ?? "standard";
  const report: FeatureReport = { style, features: [], reachable: true, keysReachable: true, marks: [] };
  const gen = root.gen;
  if (!gen?.rooms?.length) return report;
  const plan = new Plan(gen, opts.walkable);
  const rand = opts.rand;
  const entries: any[] = root.entries ??= [];
  let id = entries.reduce((m: number, e: any) => Math.max(m, e.id ?? 0), 0) + 1;
  const pal = paletteFor(opts.theme, style);
  const family = opts.tables?.map(t => FAMILY.exec(t)?.[1]).find(Boolean) ?? null;
  const pick = <T>(a: readonly T[]) => a[Math.floor(rand() * a.length)];
  const mark = (kind: string, x: number, y: number) => report.marks.push({ kind, x, y });

  const place = (name: string, args: [string, unknown][] | null, x: number, y: number, rot = 0, z = 0) => {
    // a puzzle gate takes a mouth's place from the arena gate arenaRooms (main.ts) put there
    if (/\/Door\//.test(name)) {
      for (let n = entries.length - 1; n >= 0; n--) {
        const o = entries[n], t = o.transform?.translation;
        if (/\/Door\//.test(o.placeable?.name ?? "") && t && Math.hypot(t.x - x, t.y - y) < 1) entries.splice(n, 1);
      }
    }
    const e = { $class: CLS + "PlaceableEntry", id: id++, placeable: args ? ref(name, args) : ref(name),
      transform: { $class: "com.threerings.math.Transform3D", translation: { $class: "com.threerings.math.Vector3f", x, y, z },
        rotation: { $class: "com.threerings.math.Quaternion", x: 0, y: 0, z: Math.sin(rot / 2), w: Math.cos(rot / 2) }, scale: 1 } };
    entries.push(e);
    return e;
  };
  const posOf = (e: any) => e.transform?.translation ?? { x: NaN, y: NaN };
  const inRoom = (i: number, x: number, y: number) => { const r = plan.rooms[i]; return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h; };
  const argOf = (e: any, k: string) => (e.placeable?.arguments?.entries as [string, any][] | undefined)?.find(([n]) => n === k)?.[1];
  /** The room's own fight (its "Player Enter" area and spawners) and treasure, removed. */
  const clearRoom = (i: number, treasureToo = false) => {
    // the arena wiring arenaRooms (main.ts) gave the room: its gates and wave triggers
    const ns = new Set<string>();
    for (const e of entries) {
      const t = posOf(e), m = /^gen spawn (\d+)/.exec(String(argOf(e, "Spawn Tag") ?? ""));
      if (m && /Single Spawn/.test(e.placeable?.name ?? "") && inRoom(i, Math.floor(t.x), Math.floor(t.y))) ns.add(m[1]);
    }
    for (let n = entries.length - 1; n >= 0; n--) {
      const e = entries[n];
      const tag = String(argOf(e, "Tag") ?? ""), actor = String(argOf(e, "Actor Tag") ?? "");
      if ([...ns].some(k => tag === `gen door ${k}` || actor === `gen wave ${k}` || actor === `gen wave ${k}b`)) entries.splice(n, 1);
    }
    for (let n = entries.length - 1; n >= 0; n--) {
      const e = entries[n];
      if (e.area?.name === "Player Enter/Spawn Activate") {
        const xs = e.vertices.map((v: any) => v.x), ys = e.vertices.map((v: any) => v.y);
        if (inRoom(i, (Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2)) entries.splice(n, 1);
        continue;
      }
      const name: string = e.placeable?.name ?? "";
      const t = posOf(e);
      if (!inRoom(i, Math.floor(t.x), Math.floor(t.y))) continue;
      if (/Single Spawn/.test(name) || (treasureToo && /Block\/Treasure/.test(name))) entries.splice(n, 1);
    }
  };
  const roomTreasure = () => entries.filter(e => /Block\/Treasure/.test(e.placeable?.name ?? ""));
  for (const e of roomTreasure()) { const t = posOf(e); plan.used.add(key(Math.floor(t.x), Math.floor(t.y))); }
  // the elevators keep their pads clear
  for (const i of [plan.start, plan.exit]) {
    const [cx, cy] = plan.centre(i);
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) plan.used.add(key(cx + dx, cy + dy));
  }
  // corridor mouths stay clear of decoration (gates and walls come here)
  const nearMouth = new Set<string>();
  for (const m of plan.mouths) for (const [x, y] of m.cells) for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) nearMouth.add(key(x + dx, y + dy));
  const taken = new Set<number>(); // rooms given a role

  /** A gate sealing a mouth (closed until its puzzle is solved). */
  const gate = (m: Mouth, kind: string) => {
    const cells = m.cells.map(([x, y]) => key(x, y));
    for (const c of cells) plan.used.add(c);
    plan.gates.push({ kind, cells });
    mark(kind, m.x, m.y);
    return plan.gates.length - 1;
  };
  const singleMouth = (i: number) => { const ms = plan.mouths.filter(m => m.room === i); return ms.length === 1 && ms[0].cells.length <= 3 ? ms[0] : null; };
  const neighbourOf = (m: Mouth) => [...plan.comps[m.comp].rooms].find(r => r !== m.room) ?? null;
  /** A cell for a switch platform in room `i` (3x3 plate): well inside, off the elevator pads. */
  const platformCell = (i: number): [number, number] | null => {
    for (const o of [{ margin: 2, avoidCentre: 3 }, { margin: 2 }, { margin: 1 }]) {
      const c = plan.freeCell(i, rand, (i === plan.start || i === plan.exit) ? o : { margin: o.margin });
      if (c) return c;
    }
    return null;
  };

  const spawner = (name: string, tag: string, wave: string, x: number, y: number, depthOffset = 0) =>
    place("Character/Monster/Generic/Single Spawn", [["Spawn Table", table(name, wave, depthOffset)], ["Spawn Tag", tag], ["Wave Number", wave]],
      x, y, rand() * Math.PI * 2);
  const role = (r: string) => opts.tables?.find(t => t.endsWith(" - " + r)) ?? `Monster/Class {stc}/Class - ${r}`;

  /**
   * A chain of escalating waves in room `i`: `begin` (a signal tag) wakes the first; each
   * "Trigger/Actor Removed" wakes the next; the last opens `door` and activates `reward`.
   */
  const waveChain = (i: number, n: string, waves: [string, number][][], door: string, reward: string, musicTag: string) => {
    const r = plan.rooms[i], [cx, cy] = plan.centre(i);
    waves.forEach((wave, w) => {
      const tag = `feat spawn ${n}${w}`, wtag = `feat wave ${n}${w}`;
      const count = wave.reduce((s, [, c]) => s + c, 0);
      let k = 0;
      for (const [roleName, c] of wave) for (let j = 0; j < c; j++, k++) {
        const a = (k / count) * Math.PI * 2 + w;
        const d = Math.min(r.w, r.h) * (0.22 + 0.08 * (k % 2));
        spawner(role(roleName), tag, wtag, Math.floor(cx + Math.cos(a) * d) + 0.5, Math.floor(cy + Math.sin(a) * d) + 0.5, Math.floor(w / 2));
      }
      const next = w + 1 < waves.length
        ? signal("activate", `feat spawn ${n}${w + 1}`)
        : compound(destroyTagged(musicTag), signal("open", door), signal("activate", reward));
      place("Trigger/Actor Removed", [["Action", next], ["Actor Tag", wtag]], cx + 0.5 + w * 0.3, cy + 0.5);
    });
    // the reward: rare treasure boxes and crowns appear in the middle of the room
    for (let j = 0; j < 3; j++) place("Trigger/One Time Action", [["Action", spawnActor(ref("Block/Treasure, Rare"))], ["Tag", reward]], cx - 1.5 + j * 1.5, cy + 2.5);
    for (let j = 0; j < 4; j++) place("Trigger/One Time Action", [["Action", tableSpawn("Treasure/Crowns/Scaled Crown")], ["Tag", reward]], cx - 1.5 + j, cy - 1.5);
    mark("reward", cx + 0.5, cy + 2.5);
  };
  const ESCALATE: [string, number][][] = [[["Grunt", 3]], [["Grunt", 2], ["Brute", 2]], [["Support", 2], ["Brute", 2], ["Grunt", 1]],
    [["Elite", 2], ["Brute", 2]], [["Mini", 1], ["Elite", 2]]];

  // ------------------------------------------------ special level styles

  if (style === "vault") {
    // no fights: every room's spawners go; treasure in every room, vault doors on side rooms
    plan.rooms.forEach((_, i) => clearRoom(i, true));
    for (const e of [...entries]) if (/Block\/Treasure/.test(e.placeable?.name ?? "")) entries.splice(entries.indexOf(e), 1);
    let doors = 0;
    plan.rooms.forEach((r, i) => {
      if (i === plan.start) return;
      const boxes = i === plan.exit ? 1 : 2 + Math.floor(rand() * 3);
      for (let j = 0; j < boxes; j++) {
        const c = plan.freeCell(i, rand, { margin: 1, avoidCentre: i === plan.exit ? 3 : 0 });
        if (!c) break;
        plan.used.add(key(c[0], c[1]));
        place(rand() < 0.25 ? "Dynamic/Block/Treasure/Rare" : "Dynamic/Block/Treasure/Vault - No Baby", null, c[0] + 0.5, c[1] + 0.5);
        mark("treasure", c[0] + 0.5, c[1] + 0.5);
      }
      // prize-vault breakables in clusters (they may hold more)
      for (let j = 0; j < 3 + Math.floor(rand() * 4); j++) {
        const c = plan.freeCell(i, rand, { margin: 1, avoidCentre: 2 });
        if (!c) break;
        plan.used.add(key(c[0], c[1]));
        place(pick(VAULT.breakable), null, c[0] + 0.5, c[1] + 0.5);
      }
      const m = singleMouth(i);
      const nb = m ? neighbourOf(m) : null;
      const c = m && nb !== null && i !== plan.exit && !plan.onPath(i) ? platformCell(nb) : null;
      if (m && c) {
        // a vault door opened by a platform in the room before it
        const tag = `feat vault ${++doors}`;
        place("Dynamic/Door/Vault/Trigger 3", [["Open", false], ["Tag", tag]], m.x, m.y, m.rot);
        gate(m, "vault door");
        {
          plan.used.add(key(c[0], c[1]));
          place("Dynamic/Switch/Party Platform/Base", [["Action", compound(signal("open", tag))]], c[0] + 0.5, c[1] + 0.5);
          mark("platform", c[0] + 0.5, c[1] + 0.5);
        }
      }
      // a crown cache in the middle of each room
      const [cx, cy] = plan.centre(i);
      if (i !== plan.exit) for (let j = 0; j < 2; j++) place("Trigger/Start Up Trigger (Generic)", [["Action", tableSpawn("Treasure/Crowns/Scaled Crown")]], cx + j, cy + 0.5);
    });
    report.features.push("treasure vault");
  }

  if (style === "arena") {
    // the biggest room is the hall: gates on its mouths close as the knight walks in, five
    // escalating waves, then the gates open and the reward appears
    let hall = -1;
    plan.rooms.forEach((r, i) => { if (i !== plan.start && i !== plan.exit && (hall < 0 || r.w * r.h > plan.rooms[hall].w * plan.rooms[hall].h)) hall = i; });
    if (hall >= 0) {
      clearRoom(hall, true);
      taken.add(hall);
      const r = plan.rooms[hall], doorTag = "feat arena door", musicTag = "feat arena music";
      for (const m of plan.mouths.filter(m => m.room === hall)) {
        place("Dynamic/Door/Iron Gate/Monster 5", [["Open", true], ["Tag", doorTag]], m.x, m.y, m.rot);
        for (const [x, y] of m.cells) plan.used.add(key(x, y));
        mark("arena gate", m.x, m.y);
      }
      entries.push({ $class: CLS + "AreaEntry", id: id++,
        area: ref("Player Enter/Spawn Activate", [["Trigger Action", compound(signal("close", doorTag), signal("activate", "feat spawn A0"), music(musicTag, "sound/music/battle_2.ogg"))]]),
        vertices: [[r.x + 3, r.y + 3], [r.x + r.w - 3, r.y + 3], [r.x + r.w - 3, r.y + r.h - 3], [r.x + 3, r.y + r.h - 3]].map(([x, y]) => ({ $class: CLS + "Vertex", x, y })) });
      waveChain(hall, "A", ESCALATE, doorTag, "feat arena reward", musicTag);
      const [cx, cy] = plan.centre(hall);
      for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) plan.used.add(key(cx + dx, cy + dy));
      report.features.push("arena hall");
    }
  }

  if (style === "danger") {
    // the danger room: a dead end (else any room off the path), sealed by its own platform
    const cands = plan.deadEnds().filter(i => singleMouth(i));
    const room = cands.sort((a, b) => plan.rooms[b].w * plan.rooms[b].h - plan.rooms[a].w * plan.rooms[a].h)[0];
    if (room !== undefined) {
      const m = singleMouth(room)!;
      clearRoom(room, true);
      taken.add(room);
      const doorTag = "feat danger door", musicTag = "feat danger music", [cx, cy] = plan.centre(room);
      place("Dynamic/Door/Iron Gate/Trigger 3", [["Open", true], ["Tag", doorTag]], m.x, m.y, m.rot);
      for (const [x, y] of m.cells) plan.used.add(key(x, y));
      mark("danger gate", m.x, m.y);
      place("Dynamic/Switch/Party Platform/Base", [["Action", compound(signal("close", doorTag), signal("activate", "feat spawn D0"), music(musicTag))]], cx + 0.5, cy + 0.5);
      mark("danger platform", cx + 0.5, cy + 0.5);
      waveChain(room, "D", ESCALATE.slice(0, 4), doorTag, "feat danger reward", musicTag);
      for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) plan.used.add(key(cx + dx, cy + dy));
      report.features.push("danger room");
    }
  }

  // ------------------------------------------------ puzzles (standard and danger floors)

  if (style === "standard" || style === "danger") {
    // gold key: a gate on the path's last stretch; its key on an altar in a room reachable
    // with the gate shut, preferring rooms off the main path
    if (plan.path.length >= 3 && rand() < 0.75) {
      for (let k = plan.path.length - 1; k >= 2; k--) {
        const g = plan.path[k], before = plan.path[k - 1];
        const m = plan.mouths.find(m => m.room === g && m.cells.length <= 3 && plan.comps[m.comp].rooms.has(before) && plan.comps[m.comp].rooms.size === 2);
        if (!m || plan.used.has(key(...m.cells[0]))) continue;
        // with this mouth shut the exit must be cut off; the key goes where the start still reaches
        const seen = plan.flood(...plan.centre(plan.start), new Set(m.cells.map(([x, y]) => key(x, y))));
        if (seen.has(key(...plan.centre(plan.exit)))) continue; // another way round
        const pool = plan.rooms.map((_, i) => i).filter(i => i !== plan.start && i !== g && !taken.has(i) && seen.has(key(...plan.centre(i))));
        const keyRoom = pool.find(i => !plan.onPath(i)) ?? pool[pool.length - 1];
        if (keyRoom === undefined) continue;
        const c = plan.freeCell(keyRoom, rand, { margin: 2 });
        if (!c) continue;
        place("Dynamic/Door/Iron Gate/Gold 3", null, m.x, m.y, m.rot);
        const gi = gate(m, "gold gate");
        plan.used.add(key(c[0], c[1]));
        place("Dynamic/Misc/Altar/Gold Key", null, c[0] + 0.5, c[1] + 0.5, Math.PI);
        place("Dynamic/Lift Objects/Gold Key", null, c[0] + 0.5, c[1] + 0.5, 0, 0.5);
        plan.keys.push({ x: c[0], y: c[1], gate: gi });
        mark("gold key", c[0] + 0.5, c[1] + 0.5);
        taken.add(keyRoom);
        report.features.push("gold key");
        break;
      }
    }

    // secret treasure rooms behind switch gates: dead ends behind a closed Trigger 3 gate
    let secrets = 0;
    for (const i of plan.deadEnds()) {
      if (taken.has(i) || secrets >= 2 || rand() < 0.3) continue;
      const m = singleMouth(i);
      const nb = m ? neighbourOf(m) : null;
      if (!m || nb === null || plan.used.has(key(...m.cells[0]))) continue;
      // the opener first (a gate is only shut when something opens it): a party platform in
      // the room in front, or a one-time button dropped at start-up on one of several markers
      // around it (scene 370)
      const platform = rand() < 0.5 ? platformCell(nb) : null;
      const near = [nb, ...plan.graph[nb]].filter(r => r !== i && (r === nb || !taken.has(r)));
      const spots: [number, number][] = [];
      if (!platform) for (let j = 0; j < 4; j++) {
        const c = plan.freeCell(pick(near), rand, { margin: 1, avoidCentre: 2 });
        if (c && !spots.some(s => s[0] === c[0] && s[1] === c[1])) spots.push(c);
      }
      if (!platform && !spots.length) continue;
      const tag = `feat secret ${++secrets}`;
      clearRoom(i, true);
      taken.add(i);
      place("Dynamic/Door/Iron Gate/Trigger 3", [["Open", false], ["Tag", tag]], m.x, m.y, m.rot);
      gate(m, "switch gate");
      if (platform) {
        plan.used.add(key(...platform));
        place("Dynamic/Switch/Party Platform/Base", [["Action", compound(signal("open", tag))]], platform[0] + 0.5, platform[1] + 0.5);
        mark("platform", platform[0] + 0.5, platform[1] + 0.5);
      } else {
        const markers = `feat button ${secrets}`;
        for (const c of spots) {
          plan.used.add(key(c[0], c[1]));
          place("Generic Marker", [["Tag", markers]], c[0] + 0.5, c[1] + 0.5);
          mark("button marker", c[0] + 0.5, c[1] + 0.5);
        }
        const [sx, sy] = plan.centre(nb);
        place("Trigger/Start Up Trigger", [["Actor", ref("Dynamic/Switch/Button/One-Time", [["(On Signal)", "open"], ["(On Tag)", tag], ["Tag", "(Button Tag)"]])],
          ["Marker Tag", markers], ["Number", 1]], sx + 0.5, sy - 0.5);
      }
      // the hoard
      const boxes = 2 + Math.floor(rand() * 2);
      for (let j = 0; j < boxes; j++) {
        const c = plan.freeCell(i, rand, { margin: 1 });
        if (!c) break;
        plan.used.add(key(c[0], c[1]));
        place(j === 0 && rand() < 0.5 ? "Dynamic/Block/Treasure/Rare" : "Dynamic/Block/Treasure/Normal", null, c[0] + 0.5, c[1] + 0.5);
        mark("treasure", c[0] + 0.5, c[1] + 0.5);
      }
      const [cx, cy] = plan.centre(i);
      for (let j = 0; j < 3; j++) place("Trigger/Start Up Trigger (Generic)", [["Action", tableSpawn("Treasure/Crowns/Scaled Crown")]], cx + 0.5 + j - 1, cy + 0.5);
      report.features.push("secret room");
    }

    // corridors on the main path: a block wall, a spike run
    const pathComps = plan.comps.map((c, ci) => ci).filter(ci => {
      const rs = [...plan.comps[ci].rooms];
      return rs.length === 2 && plan.path.includes(rs[0]) && plan.path.includes(rs[1]) && !plan.comps[ci].cells.some(c => plan.used.has(c));
    }).sort(() => rand() - 0.5);
    /** Straight three-wide cross-sections of a corridor: centre cells with their cross cells. */
    const sections = (ci: number) => {
      const cells = new Set(plan.comps[ci].cells), out: { x: number; y: number; cross: [number, number][]; along: [number, number] }[] = [];
      for (const c of cells) {
        const [x, y] = c.split(",").map(Number);
        const all = (pts: [number, number][]) => pts.every(([a, b]) => cells.has(key(a, b)));
        // a horizontal corridor: three cells stacked in y, open to either side in x
        if (all([[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y], [x - 1, y - 1], [x + 1, y + 1], [x - 1, y + 1], [x + 1, y - 1]])) {
          if (!cells.has(key(x, y - 2)) && !cells.has(key(x, y + 2))) out.push({ x, y, cross: [[x, y - 1], [x, y], [x, y + 1]], along: [1, 0] });
          else if (!cells.has(key(x - 2, y)) && !cells.has(key(x + 2, y))) out.push({ x, y, cross: [[x - 1, y], [x, y], [x + 1, y]], along: [0, 1] });
        }
      }
      return out;
    };
    let ci = pathComps.shift();
    if (ci !== undefined && rand() < 0.7) {
      const secs = sections(ci);
      if (secs.length) {
        const s = secs[Math.floor(secs.length / 2)];
        const crystal = rand() < 0.35;
        const block = crystal ? pick(["Dynamic/Block/Crystal/Random/Green", "Dynamic/Block/Crystal/Random/Blue", "Dynamic/Block/Crystal/Random/Purple"]) : pal.block;
        const cells: string[] = [];
        for (const step of [0, 1]) for (const [x, y] of s.cross) {
          const cx = x + s.along[0] * step, cy = y + s.along[1] * step;
          if (!plan.floor.has(key(cx, cy)) || plan.compAt.get(key(cx, cy)) !== ci) continue;
          place(block, null, cx + 0.5, cy + 0.5);
          cells.push(key(cx, cy));
          plan.used.add(key(cx, cy));
        }
        plan.gates.push({ kind: "block wall", cells });
        mark("block wall", s.x + 0.5, s.y + 0.5);
        report.features.push(crystal ? "crystal wall" : "block wall");
      }
      ci = pathComps.shift();
    }
    if (ci !== undefined && rand() < 0.6) {
      const secs = sections(ci).filter(s => !s.cross.some(([x, y]) => plan.used.has(key(x, y))));
      // plates three cells apart along the corridor, cycles alternating
      const chosen: typeof secs = [];
      for (const s of secs) if (chosen.every(o => Math.abs(o.x - s.x) + Math.abs(o.y - s.y) >= 3)) chosen.push(s);
      chosen.slice(0, 4).forEach((s, j) => {
        place("Trigger/Start Up Trigger (Generic)", [["Action", spawnActor(ref("Dynamic/Traps and Hazards/Floor/Spikes", [
          ["Cycle", { $enum: "com.threerings.projectx.dungeon.config.DungeonActorConfig$Trap$Cycle", name: j % 2 ? "B" : "A" }],
          ["Model", ref("world/dynamic/traps_n_hazards/floor/spikes/spikes/spikes_3x3.dat")], ["Tag", "(Signal Tag)"], ["Warning and Damage Size", "3x3"]]))]],
          s.x + 0.5, s.y + 0.5);
        // the plate itself (the trap tile's model; its origin is its corner)
        place("Model Tester", [["Model", ref("world/dynamic/traps_n_hazards/floor/spikes/tile_3x3.dat")]], s.x - 1, s.y - 1, 0, 0.01);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) plan.used.add(key(s.x + dx, s.y + dy));
        mark("spikes", s.x + 0.5, s.y + 0.5);
      });
      if (chosen.length) report.features.push("spike run");
    }

    // turrets: Gun Puppies in two corners of an encounter room on the path
    const turretRoom = plan.path.find(i => i !== plan.start && i !== plan.exit && !taken.has(i));
    if (turretRoom !== undefined && rand() < 0.5) {
      const r = plan.rooms[turretRoom];
      const spawn = entries.find(e => /Single Spawn/.test(e.placeable?.name ?? "") && inRoom(turretRoom, Math.floor(posOf(e).x), Math.floor(posOf(e).y)));
      const tag = spawn ? argOf(spawn, "Spawn Tag") : null;
      const wave = (argOf(spawn, "Spawn Table")?.arguments?.entries as [string, any][] | undefined)?.find(([k]) => k === "Wave Tag")?.[1];
      if (tag && wave) {
        const corners: [number, number][] = [[r.x + 1, r.y + 1], [r.x + r.w - 2, r.y + r.h - 2], [r.x + r.w - 2, r.y + 1], [r.x + 1, r.y + r.h - 2]];
        for (const [x, y] of corners.slice(0, 2)) {
          if (plan.used.has(key(x, y))) continue;
          plan.used.add(key(x, y));
          spawner("Monster/Class {stc}/Family/Construct/Gun Puppy/Gun Puppy", tag, wave, x + 0.5, y + 0.5);
          mark("turret", x + 0.5, y + 0.5);
        }
        report.features.push("turrets");
      }
    }
  }

  // ------------------------------------------------ minerals, decoration and lights

  const wallCells = (i: number) => {
    const r = plan.rooms[i], out: { x: number; y: number; rot: number; side: string }[] = [];
    for (let x = r.x; x < r.x + r.w; x++) { out.push({ x, y: r.y, rot: 0, side: "s" }); out.push({ x, y: r.y + r.h - 1, rot: Math.PI, side: "n" }); }
    for (let y = r.y + 1; y < r.y + r.h - 1; y++) { out.push({ x: r.x, y, rot: -Math.PI / 2, side: "w" }); out.push({ x: r.x + r.w - 1, y, rot: Math.PI / 2, side: "e" }); }
    return out.filter(c => plan.floor.has(key(c.x, c.y)) && !nearMouth.has(key(c.x, c.y)) && !plan.used.has(key(c.x, c.y)));
  };
  const fam = familyPieces(family, /valley|sky/.test(opts.theme));
  /** Blocking decoration entries (removed again if they ever cut the way to the exit). */
  const decor: any[] = [];
  plan.rooms.forEach((r, i) => {
    const walls = wallCells(i).sort(() => rand() - 0.5);
    const take = (n: number, fn: (c: { x: number; y: number; rot: number; side: string }) => boolean) => {
      for (let j = 0; j < walls.length && n > 0; j++) {
        const c = walls[j];
        if (plan.used.has(key(c.x, c.y))) continue;
        if (fn(c)) { n--; walls.splice(j--, 1); }
      }
    };
    // lamps and lights
    if (pal.lamps.length) take(2, c => {
      const p = pick(pal.lamps);
      decor.push(place(p.name, null, c.x + 0.5, c.y + 0.5, c.rot));
      plan.used.add(key(c.x, c.y)); plan.blocked.add(key(c.x, c.y));
      return true;
    });
    const [cx, cy] = plan.centre(i);
    place("Lights/Point Light", [["Diffuse", color(...pal.light)], ["Extent", Math.max(r.w, r.h)]], cx + 0.5, cy + 0.5, 0, 6);
    // a mineral node now and then
    if (style !== "vault" && i !== plan.start && rand() < 0.3) take(1, c => {
      place("Dynamic/Block/Mineral/Class {tb}/Generic Mineral", null, c.x + 0.5, c.y + 0.5);
      plan.used.add(key(c.x, c.y));
      mark("mineral", c.x + 0.5, c.y + 0.5);
      return true;
    });
    // blocking props against the walls; breakables too
    const wallPieces = [...pal.wall, ...fam.wall];
    take(Math.floor((r.w + r.h) / 4), c => {
      const p = pick(wallPieces);
      const len = p.len ?? 1;
      const cells: string[] = [key(c.x, c.y)];
      if (len > 1) {
        const [ax, ay] = c.side === "s" || c.side === "n" ? [1, 0] : [0, 1];
        for (let s = 1; s < len; s++) cells.push(key(c.x + ax * s, c.y + ay * s));
        if (cells.some(k => plan.used.has(k) || nearMouth.has(k) || !plan.roomAt.has(k) || plan.roomAt.get(k) !== i)) return false;
        decor.push(place(p.name, null, c.x + 0.5 + ax * (len - 1) / 2, c.y + 0.5 + ay * (len - 1) / 2, c.rot));
      } else decor.push(place(p.name, null, c.x + 0.5, c.y + 0.5, c.rot + (rand() - 0.5) * 0.6));
      for (const k of cells) { plan.used.add(k); plan.blocked.add(k); }
      return true;
    });
    if (pal.breakable.length) take(1 + Math.floor(rand() * 3), c => {
      place(pick(pal.breakable), null, c.x + 0.5, c.y + 0.5, rand() * Math.PI * 2);
      plan.used.add(key(c.x, c.y));
      return true;
    });
    // floor litter: the tileset's and the family's
    const floorPieces = [...pal.floor, ...fam.floor, ...fam.floor];
    for (let j = 0; j < 2 + Math.floor((r.w * r.h) / 30); j++) {
      const c = plan.freeCell(i, rand, { margin: 1, avoidCentre: i === plan.start || i === plan.exit ? 3 : 0 });
      if (!c) break;
      place(pick(floorPieces).name, null, c[0] + 0.2 + rand() * 0.6, c[1] + 0.2 + rand() * 0.6, rand() * Math.PI * 2);
      plan.used.add(key(c[0], c[1]));
    }
  });
  // a little litter in the corridors
  for (const c of plan.comps) {
    if (rand() < 0.5 || !pal.floor.length) continue;
    const free = c.cells.filter(k => !plan.used.has(k));
    if (!free.length) continue;
    const [x, y] = pick(free).split(",").map(Number);
    place(pick(pal.floor).name, null, x + 0.5, y + 0.5, rand() * Math.PI * 2);
    plan.used.add(key(x, y));
  }
  report.features.push("decoration");

  // ------------------------------------------------ checks

  const [sx, sy] = plan.centre(plan.start), [ex, ey] = plan.centre(plan.exit);
  report.reachable = plan.flood(sx, sy, plan.blocked).has(key(ex, ey));
  if (!report.reachable) {
    // decoration must never cut the way: drop every blocking piece and check again
    for (const e of decor) entries.splice(entries.indexOf(e), 1);
    plan.blocked.clear();
    report.reachable = plan.flood(sx, sy, plan.blocked).has(key(ex, ey));
  }
  for (const k of plan.keys) {
    const shut = new Set([...plan.blocked, ...plan.gates[k.gate].cells]);
    // the key stands on its altar: reaching a cell next to it is enough
    const seen = plan.flood(sx, sy, shut);
    if (!N4.some(([dx, dy]) => seen.has(key(k.x + dx, k.y + dy)))) report.keysReachable = false;
  }
  return report;
}
