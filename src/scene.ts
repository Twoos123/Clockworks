// Loads Tudey scenes (com.threerings.tudey.data.TudeySceneModel) from the install's scenes/
// cache: the tile grid plus placeable props, resolved through the install's tile and
// placeable config libraries into model references and placements.

import { applyArguments } from "./config/params";
import { importBinary } from "./export/BinaryImport";
import { compose, toMatrix, readTransform, type Mat4 } from "./math";
import { editorOnly, inflate, type LoadedModel, type ModelLoader } from "./model";
import { CollisionMap, forTileCells } from "./game/collision";
import { LevelMap } from "./game/levelmap";
import { shapeFromConfig, type Shape } from "./game/shapes";

export interface SceneObject {
  model: LoadedModel;
  matrix: Mat4;
}

/** A monster spawn point (a marker whose action activates a spawn table). */
export interface SpawnPoint { x: number; y: number; heading: number; table: any; tag: string }
/** A polygon that sends a signal to tagged entries when the player enters it. */
export interface TriggerArea { poly: [number, number][]; tags: string[] }
/** An actor a marker spawns at startup (blocks, breakables, doors, pads). */
export interface StartupActor { x: number; y: number; heading: number; actor: any; shape: any }
/**
 * A scene entry that takes part in the game logic: a placeable or area with handlers or tags
 * (TudeySceneModel entries as EntryLogic sees them).
 */
export interface LogicEntry {
  id: number;
  name: string;
  x: number;
  y: number;
  /** Placeables: the Z rotation minus a quarter turn (EntryLogic); areas: 0. */
  rotation: number;
  /** World-space shape: a placeable's ShapeConfig placed by its transform, or an area polygon. */
  shape: Shape | null;
  tags: string[];
  handlers: any[];
  /** StatefulProp and ElevatorProp placeables spawn this actor once the level starts. */
  actor?: any;
}

export interface LoadedScene {
  id: string;
  name: string;
  objects: SceneObject[];
  stats: { tiles: number; placeables: number; furniture: number; markers: number; unresolved: number; uniqueModels: number };
  /** The scene's GlobalEntry references (lighting, fog, skybox, camera, music...). */
  globals: any[];
  bounds: { min: [number, number]; max: [number, number] };
  /** Tile and prop collision, for walking around. */
  collision: CollisionMap;
  /** The level map the minimap and map overlay draw. */
  levelMap: LevelMap;
  spawns: SpawnPoint[];
  triggers: TriggerArea[];
  startupActors: StartupActor[];
  logic: LogicEntry[];
  /** Where knights arrive: the start elevator platform, when the level has one. */
  start: [number, number] | null;
}

// TudeySceneMetrics: elevation_scale defaults to 0.5 world units per elevation step
const ELEVATION_SCALE = 0.5;
const TILE_ROTATIONS: [number, number, number, number][] = [
  [0, 0, 0, 1], [0, 0, 0.707106781, 0.707106781], [0, 0, 1, 0], [0, 0, 0.707106781, -0.707106781],
];
// editor-only placeables that the game does not draw
const HIDDEN = /PlaceableConfig\$(Marker|DebugMarker|EventMarker)$/;

/** Reads just the display name of a cached scene. */
export async function sceneName(data: Uint8Array): Promise<string> {
  const s: any = (await importBinary(data, inflate)).root;
  return prettySceneName(s?.name ?? "");
}

export function prettySceneName(raw: string): string {
  // e.g. "%town:m.haven_town_square" or "%guild:m.hall|~The Exceeds"
  // a key may name another bundle's key: "%dungeon:%town:m.haven"
  const m = /^(?:%[a-z]+:)+m\.([^|]+)(?:\|~(.*))?$/.exec(raw);
  if (!m) return raw || "(unnamed)";
  const base = m[1].replace(/_/g, " ");
  return m[2] ? `${base} (${m[2]})` : base;
}

/** TagConfig: its tags plus the chain of derived tag configs. */
function tagList(t: any, depth = 0): string[] {
  if (!t || depth > 8) return [];
  return [...((t.tags ?? []) as any[]).filter((x): x is string => typeof x === "string" && x !== ""), ...tagList(t.derived, depth + 1)];
}

export class SceneLoader {
  private libs = new Map<string, Promise<Map<string, any>>>();

  constructor(private readonly loader: ModelLoader) {}

  /** The config names in a library file (e.g. config/tile.dat). */
  async configNames(file: string): Promise<string[]> { return [...(await this.library(file)).keys()]; }

  private library(file: string): Promise<Map<string, any>> {
    let p = this.libs.get(file);
    if (!p) {
      p = this.loader.importFile(file).then(root => {
        const map = new Map<string, any>();
        const list: any[] = Array.isArray(root) ? root : (root as any)?.array ?? [];
        for (const c of list) map.set(c.name, c);
        return map;
      }).catch(() => new Map());
      this.libs.set(file, p);
    }
    return p;
  }

  /** Follows Derived configs to the implementation that names a model. */
  private async resolveImpl(file: string, ref: any, derivedField: string, depth = 0): Promise<any | null> {
    if (!ref?.name || depth > 8) return null;
    const lib = await this.library(file);
    const base = lib.get(ref.name);
    if (!base) return null;
    const cfg = applyArguments(base, ref);
    const impl = cfg.implementation;
    if (impl?.$class?.endsWith("$Derived") || impl?.[derivedField] && !impl.model) {
      return this.resolveImpl(file, impl[derivedField], derivedField, depth + 1);
    }
    return impl ?? null;
  }

  /** The model a FurniConfig shows: its own, a placeable's, or an actor's sprite. */
  private async furnitureModel(item: any): Promise<any> {
    if (!item) return null;
    if (item.model) return item.model;
    if (item.placeable) return (await this.resolveImpl("config/placeable.dat", item.placeable, "placeable"))?.model;
    if (item.actor) return (await this.resolveImpl("config/actor.dat", item.actor, "actor"))?.sprite?.model;
    return null;
  }

  /**
   * A furniture item as a Furni Placer shows it: the item's FurniConfig (footprint, shape,
   * collision) and its loaded model, resolved the way scene furniture is.
   */
  async furniture(item: any): Promise<{ impl: any; model: LoadedModel | null }> {
    const impl = await this.resolveImpl("config/item.dat", item, "item");
    const ref = await this.furnitureModel(impl);
    return { impl, model: ref ? await this.loader.loadRef(ref) : null };
  }

  async load(id: string, data: Uint8Array, onProgress?: (done: number, total: number) => void): Promise<LoadedScene> {
    return this.loadRoot(id, (await importBinary(data, inflate)).root, onProgress);
  }

  /** A scene file's parsed root (TudeySceneModel). */
  async parse(data: Uint8Array): Promise<any> { return (await importBinary(data, inflate)).root; }

  /**
   * A tile reference's footprint and whether it is walkable floor (floor flag set and no
   * collision flags), from config/tile.dat.
   */
  async tileInfo(ref: any): Promise<{ width: number; height: number; walkable: boolean }> {
    const impl = await this.resolveImpl("config/tile.dat", ref, "tile");
    const flags: ArrayLike<number>[] = impl?.collisionFlags ?? [[1]];
    const blocked = Array.from(flags as ArrayLike<ArrayLike<number>>).some(row => Array.from(row ?? []).some(f => f !== 0));
    return { width: impl?.width ?? 1, height: impl?.height ?? 1, walkable: !!impl && ((impl.floorFlags ?? 1) & 1) !== 0 && !blocked };
  }

  /** Loads a scene from its parsed root (a cached scene, or a generated one). */
  async loadRoot(id: string, s: any, onProgress?: (done: number, total: number) => void): Promise<LoadedScene> {
    const objects: SceneObject[] = [];
    const collision = new CollisionMap();
    const levelMap = new LevelMap();
    const spawns: SpawnPoint[] = [], triggers: TriggerArea[] = [], startupActors: StartupActor[] = [];
    const logic: LogicEntry[] = [];
    let start: [number, number] | null = null;
    for (const e of s.entries ?? []) {
      if (!e.$class.endsWith("AreaEntry") || !e.vertices?.length) continue;
      const tags = collectSignalTags(e.area);
      if (tags.length) triggers.push({ poly: e.vertices.map((v: any) => [v.x ?? 0, v.y ?? 0]), tags });
      const area = await this.resolveImpl("config/area.dat", e.area, "area");
      const vpts: [number, number][] = e.vertices.map((v: any) => [v.x ?? 0, v.y ?? 0]);
      levelMap.entry(vpts.length === 1 ? { k: "point", x: vpts[0][0], y: vpts[0][1] } : { k: "poly", pts: vpts }, area?.collisionFlags ?? 0);
      const atags = tagList(area?.tags);
      if (area && (area.handlers?.length || atags.length)) {
        const pts: [number, number][] = e.vertices.map((v: any) => [v.x ?? 0, v.y ?? 0]);
        const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
        logic.push({ id: e.id ?? 0, name: e.area?.name ?? "area", x: cx, y: cy, rotation: 0,
          shape: pts.length === 1 ? { k: "point", x: cx, y: cy } : { k: "poly", pts }, tags: atags, handlers: area.handlers ?? [] });
      }
    }
    const stats = { tiles: 0, placeables: 0, furniture: 0, markers: 0, unresolved: 0, uniqueModels: 0 };
    const min: [number, number] = [Infinity, Infinity], max: [number, number] = [-Infinity, -Infinity];
    const grow = (x: number, y: number) => {
      min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y);
      max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y);
    };

    // --- tiles: a CoordIntMap of packed (config index << 16 | elevation << 2 | rotation)
    const mappings: any[] = s.tileConfigs?.items ?? s.tileConfigs ?? [];
    const tileImpls = await Promise.all(mappings.map(m => m ? this.resolveImpl("config/tile.dat", m.tile, "tile") : null));
    const granularity = s.tiles?.granularity ?? 3, mask = (1 << granularity) - 1, empty = s.tiles?.empty ?? -1;
    const jobs: { ref: any; matrix: Mat4 }[] = [];
    for (const [coord, cell] of s.tiles?.cells?.entries ?? []) {
      const values: Int32Array = cell.values;
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v === empty) continue;
        const x = (coord.x << granularity) | (i & mask), y = (coord.y << granularity) | (i >> granularity);
        const impl = tileImpls[v >>> 16];
        // the map takes every tile, marker tiles included
        if (impl) forTileCells(impl, x, y, v & 3, (tx, ty, flags) => levelMap.tile(tx, ty, flags));
        if (!impl?.model) { stats.unresolved++; continue; }
        const w = impl.width ?? 1, h = impl.height ?? 1, rotation = v & 3, elevation = (v << 16) >> 18;
        // TudeySceneMetrics.getTileTransform
        let tx = x, ty = y;
        if (rotation === 1) tx += h;
        else if (rotation === 2) { tx += w; ty += h; }
        else if (rotation === 3) ty += w;
        jobs.push({ ref: impl.model, matrix: compose([tx, ty, elevation * ELEVATION_SCALE], TILE_ROTATIONS[rotation], 1) });
        collision.addTile(impl, x, y, rotation, elevation, ELEVATION_SCALE);
        stats.tiles++;
        grow(x, y); grow(x + w, y + h);
      }
    }

    // --- placeables: config reference plus a free transform
    for (const e of s.entries ?? []) {
      if (!e.$class.endsWith("PlaceableEntry")) continue;
      const impl = await this.resolveImpl("config/placeable.dat", e.placeable, "placeable");
      if (!impl) { stats.unresolved++; continue; }
      {
        // the map: the placeable's shape with its collision flags (markers have none: what they
        // spawn collides instead); default entrances seed its flood
        const t = readTransform(e.transform);
        if (impl.defaultEntrance) levelMap.entrance(t.t[0], t.t[1]);
        const shape = impl.shape ? shapeFromConfig(impl.shape, t.t[0], t.t[1], 2 * Math.atan2(t.r[2], t.r[3]), t.s) : null;
        levelMap.entry(shape, HIDDEN.test(impl.$class) ? 0 : impl.collisionFlags ?? 1, !!impl.floorTile);
      }
      if (/Elevator\/Start Platform/.test(e.placeable?.name ?? "") && !start) {
        const t0 = readTransform(e.transform);
        start = [t0.t[0], t0.t[1]];
      }
      {
        const ptags = tagList(impl.tags);
        const actor = impl.actor?.name && /StatefulProp|ElevatorProp/.test(impl.$class) ? impl.actor : undefined;
        // (gate props too: the party lobby's consoles have no handlers of their own, the game
        // finds them by name)
        if (impl.handlers?.length || ptags.length || actor || /\$GateProp$/.test(impl.$class)) {
          const t = readTransform(e.transform);
          const rotZ = 2 * Math.atan2(t.r[2], t.r[3]);
          const rotation = Math.atan2(Math.sin(rotZ - Math.PI / 2), Math.cos(rotZ - Math.PI / 2));
          logic.push({ id: e.id ?? 0, name: e.placeable?.name ?? "placeable", x: t.t[0], y: t.t[1], rotation,
            shape: impl.shape ? shapeFromConfig(impl.shape, t.t[0], t.t[1], rotZ, t.s) : null, tags: ptags, handlers: impl.handlers ?? [], actor });
        }
      }
      if (HIDDEN.test(impl.$class)) {
        stats.markers++;
        const t = readTransform(e.transform);
        const heading = 2 * Math.atan2(t.r[2], t.r[3]);
        const table = argOf(e.placeable, "Spawn Table");
        if (table) spawns.push({ x: t.t[0], y: t.t[1], heading, table, tag: String(argOf(e.placeable, "Spawn Tag") ?? "") });
        for (const h of impl.handlers ?? []) {
          if (h?.$class?.endsWith("HandlerConfig$Startup") && h.action?.$class?.endsWith("ActionConfig$SpawnActor") && h.action.actor) {
            startupActors.push({ x: t.t[0], y: t.t[1], heading, actor: h.action.actor, shape: impl.shape });
          }
        }
        continue;
      }
      let modelRef = impl.model;
      if (impl.$class.endsWith("$Furni")) {
        // guild furniture: the placeable names a furniture item, whose config gives the model
        const item = await this.resolveImpl("config/item.dat", impl.furni, "item");
        modelRef = await this.furnitureModel(item);
        if (modelRef) stats.furniture++;
      }
      if (!modelRef) { stats.unresolved++; continue; }
      const t = readTransform(e.transform);
      collision.addProp(impl, e.transform);
      jobs.push({ ref: modelRef, matrix: toMatrix(t) });
      stats.placeables++;
      grow(t.t[0], t.t[1]);
    }

    // --- load each distinct model reference once
    let done = 0;
    const unique = new Set<LoadedModel>();
    for (const job of jobs) {
      if (editorOnly(job.ref?.name ?? "")) { stats.markers++; continue; }
      const model = await this.loader.loadRef(job.ref);
      if (model) { objects.push({ model, matrix: job.matrix }); unique.add(model); } else stats.unresolved++;
      if (++done % 200 === 0) onProgress?.(done, jobs.length);
    }
    stats.uniqueModels = unique.size;
    const globals = (s.entries ?? []).filter((e: any) => e.$class.endsWith("GlobalEntry")).map((e: any) => e.sceneGlobal);
    return { id, name: prettySceneName(s.name ?? id), objects, stats, bounds: { min, max }, globals, collision, levelMap, spawns, triggers, startupActors, logic, start };
  }
}

function argOf(ref: any, name: string): unknown {
  return (ref?.arguments?.entries as [unknown, unknown][] | undefined)?.find(([k]) => k === name)?.[1];
}

/** Tags targeted by Signal actions anywhere inside an area's config reference. */
function collectSignalTags(o: any, out: string[] = [], depth = 0): string[] {
  if (!o || typeof o !== "object" || depth > 12 || ArrayBuffer.isView(o)) return out;
  if (o.$class?.endsWith("ActionConfig$Signal") && o.target?.tag) out.push(o.target.tag);
  if (o.$map) for (const [, v] of o.entries) collectSignalTags(v, out, depth + 1);
  else for (const k of Object.keys(o)) if (k !== "$outer") collectSignalTags(o[k], out, depth + 1);
  return out;
}
