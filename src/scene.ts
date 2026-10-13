// Loads Tudey scenes (com.threerings.tudey.data.TudeySceneModel) from the install's scenes/
// cache: the tile grid plus placeable props, resolved through the install's tile and
// placeable config libraries into model references and placements.

import { applyArguments } from "./config/params";
import { importBinary } from "./export/BinaryImport";
import { compose, toMatrix, readTransform, type Mat4 } from "./math";
import { inflate, type LoadedModel, type ModelLoader } from "./model";

export interface SceneObject {
  model: LoadedModel;
  matrix: Mat4;
}

export interface LoadedScene {
  id: string;
  name: string;
  objects: SceneObject[];
  stats: { tiles: number; placeables: number; markers: number; unresolved: number; uniqueModels: number };
  /** The scene's GlobalEntry references (lighting, fog, skybox, camera, music...). */
  globals: any[];
  bounds: { min: [number, number]; max: [number, number] };
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
  const m = /^%[a-z]+:m\.([^|]+)(?:\|~(.*))?$/.exec(raw);
  if (!m) return raw || "(unnamed)";
  const base = m[1].replace(/_/g, " ");
  return m[2] ? `${base} (${m[2]})` : base;
}

export class SceneLoader {
  private libs = new Map<string, Promise<Map<string, any>>>();

  constructor(private readonly loader: ModelLoader) {}

  private library(file: string): Promise<Map<string, any>> {
    let p = this.libs.get(file);
    if (!p) {
      p = this.loader.importFile(file).then(root => {
        const map = new Map<string, any>();
        for (const c of Array.isArray(root) ? root : []) map.set((c as any).name, c);
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

  async load(id: string, data: Uint8Array, onProgress?: (done: number, total: number) => void): Promise<LoadedScene> {
    const s: any = (await importBinary(data, inflate)).root;
    const objects: SceneObject[] = [];
    const stats = { tiles: 0, placeables: 0, markers: 0, unresolved: 0, uniqueModels: 0 };
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
        if (!impl?.model) { stats.unresolved++; continue; }
        const w = impl.width ?? 1, h = impl.height ?? 1, rotation = v & 3, elevation = (v << 16) >> 18;
        // TudeySceneMetrics.getTileTransform
        let tx = x, ty = y;
        if (rotation === 1) tx += h;
        else if (rotation === 2) { tx += w; ty += h; }
        else if (rotation === 3) ty += w;
        jobs.push({ ref: impl.model, matrix: compose([tx, ty, elevation * ELEVATION_SCALE], TILE_ROTATIONS[rotation], 1) });
        stats.tiles++;
        grow(x, y); grow(x + w, y + h);
      }
    }

    // --- placeables: config reference plus a free transform
    for (const e of s.entries ?? []) {
      if (!e.$class.endsWith("PlaceableEntry")) continue;
      const impl = await this.resolveImpl("config/placeable.dat", e.placeable, "placeable");
      if (!impl) { stats.unresolved++; continue; }
      if (HIDDEN.test(impl.$class)) { stats.markers++; continue; }
      if (!impl.model) { stats.unresolved++; continue; }
      const t = readTransform(e.transform);
      jobs.push({ ref: impl.model, matrix: toMatrix(t) });
      stats.placeables++;
      grow(t.t[0], t.t[1]);
    }

    // --- load each distinct model reference once
    let done = 0;
    const unique = new Set<LoadedModel>();
    for (const job of jobs) {
      const model = await this.loader.loadRef(job.ref);
      if (model) { objects.push({ model, matrix: job.matrix }); unique.add(model); } else stats.unresolved++;
      if (++done % 200 === 0) onProgress?.(done, jobs.length);
    }
    stats.uniqueModels = unique.size;
    const globals = (s.entries ?? []).filter((e: any) => e.$class.endsWith("GlobalEntry")).map((e: any) => e.sceneGlobal);
    return { id, name: prettySceneName(s.name ?? id), objects, stats, bounds: { min, max }, globals };
  }
}
