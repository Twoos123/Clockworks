// Scene environments: resolves a Tudey scene's GlobalEntry references (config/scene_global.dat)
// into ambient light, directional lights, fog, background colour, skyboxes, environment
// models and the default camera, as Clyde's SceneInfluencer and ViewerAffecter models do.

import { applyArguments } from "./config/params";
import type { LoadedModel, ModelLoader } from "./model";

export type Rgb = [number, number, number];

export interface Fog {
  mode: "linear" | "exp" | "exp2";
  color: Rgb;
  start: number;
  end: number;
  density: number;
}

export interface Environment {
  ambient: Rgb;
  /** Directional lights; dir points toward the light, as GL's w=0 light position. */
  lights: { dir: [number, number, number]; color: Rgb }[];
  /** True when light directions are in eye space (the model viewer's head light). */
  eyeSpace: boolean;
  fog: Fog | null;
  background: Rgb | null;
  skyboxes: LoadedModel[];
  models: LoadedModel[];
  camera: { azimuth: number; elevation: number; distance: number } | null;
}

export const VIEWER_ENVIRONMENT: Environment = {
  ambient: [0.4, 0.4, 0.4],
  lights: [{ dir: [0.35, 0.6, 0.72], color: [0.8, 0.8, 0.8] }],
  eyeSpace: true,
  fog: null,
  background: null,
  skyboxes: [],
  models: [],
  camera: null,
};

const rgb = (c: any, d: Rgb = [0, 0, 0]): Rgb => (c ? [c.r ?? 0, c.g ?? 0, c.b ?? 0] : d);

export function readFog(state: any): Fog | null {
  const kind = state?.$class?.substring(state.$class.lastIndexOf("$") + 1);
  if (!kind || kind === "Disabled") return null;
  const color = rgb(state.color);
  if (kind === "Linear") return { mode: "linear", color, start: state.start ?? 0, end: state.end ?? 1, density: 0 };
  return { mode: kind === "ExponentialSquared" ? "exp2" : "exp", color, start: 0, end: 1, density: state.density ?? 1 };
}

export async function loadEnvironment(loader: ModelLoader, globals: any[]): Promise<Environment> {
  const lib = new Map<string, any>();
  try {
    const root: any = await loader.importFile("config/scene_global.dat");
    for (const c of root?.array ?? (Array.isArray(root) ? root : [])) lib.set(c.name, c);
  } catch { /* no globals library */ }

  const env: Environment = {
    ambient: [0, 0, 0], lights: [], eyeSpace: false, fog: null, background: null, skyboxes: [], models: [], camera: null,
  };
  let sawAmbient = false;

  const resolveGlobal = (ref: any, depth = 0): any => {
    const base = lib.get(ref?.name);
    if (!base || depth > 8) return null;
    const cfg = applyArguments(base, ref);
    if (cfg.$class?.endsWith("DerivedConfig")) return resolveGlobal(cfg.base, depth + 1);
    return cfg;
  };

  const applyModel = async (ref: any, depth = 0) => {
    if (!ref?.name || depth > 4) return;
    let root: any;
    try { root = applyArguments(await loader.importFile(ref.name), ref); } catch { return; }
    const impl = root?.implementation;
    const kind = impl?.$class ?? "";
    if (kind.endsWith("SceneInfluencerConfig")) {
      const inf = impl.influence;
      const ik = inf?.$class?.substring(inf.$class.lastIndexOf("$") + 1) ?? "AmbientLight";
      if (ik === "AmbientLight") {
        const c = rgb(inf?.color, [0.2, 0.2, 0.2]);
        env.ambient = [env.ambient[0] + c[0], env.ambient[1] + c[1], env.ambient[2] + c[2]];
        sawAmbient = true;
      } else if (ik === "Light" && (inf.light?.$class ?? "").endsWith("$Directional")) {
        const d = inf.light.direction ?? { x: 0, y: 0, z: 1 };
        env.lights.push({ dir: [d.x ?? 0, d.y ?? 0, d.z ?? 0], color: rgb(inf.light.colors?.diffuse, [1, 1, 1]) });
      } else if (ik === "Fog") {
        env.fog = readFog(inf.state);
      }
    } else if (kind.endsWith("ViewerAffecterConfig")) {
      const eff = impl.effect;
      const ek = eff?.$class?.substring(eff.$class.lastIndexOf("$") + 1);
      if (ek === "BackgroundColor") env.background = rgb(eff.color);
      else if (ek === "Skybox") {
        const m = await loader.loadRef(eff.model);
        if (m) env.skyboxes.push(m);
      }
    } else if (kind.endsWith("ModelConfig$Derived")) {
      await applyModel(impl.model, depth + 1);
    } else {
      const m = await loader.loadRef(ref);
      if (m && (m.parts.length || m.attachments.length)) env.models.push(m);
    }
  };

  for (const ref of globals) {
    const cfg = resolveGlobal(ref);
    if (!cfg) continue;
    const kind = cfg.$class ?? "";
    if (kind.endsWith("SceneGlobalConfig$EnvironmentModel")) await applyModel(cfg.model);
    else if (kind.endsWith("SceneGlobalConfig$Camera")) {
      const c = cfg.camera?.coords;
      if (c) env.camera = { azimuth: c.azimuth ?? 0, elevation: c.elevation ?? 0, distance: c.distance ?? 10 };
    }
  }
  if (!sawAmbient) env.ambient = [0.2, 0.2, 0.2];
  if (env.lights.length === 0) env.lights.push({ dir: [0, 0, 1], color: [0.8, 0.8, 0.8] });
  return env;
}
