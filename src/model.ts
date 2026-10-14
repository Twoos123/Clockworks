// Turns imported Clyde ModelConfig object graphs into renderable descriptions.
// Covers the implementations that hold geometry (ArticulatedConfig, StaticConfig,
// StaticSetConfig) and the ones that reference other models (Derived, Compound, plus
// articulated attachments). Particle systems and scripted models are reported, not drawn.

import { ConfigLibrary, defaultMaterialRef, localConfigs, type LocalConfigs, type ResolvedMaterial } from "./config/materials";
import { applyArguments, hasArguments } from "./config/params";
import { readParticleLayers, type ParticleLayer } from "./particles";
import { transformExpr, type F } from "./expr";
import type { Mat4 } from "./math";
import { importBinary, type JObject } from "./export/BinaryImport";
import { IDENTITY_TRANSFORM, readTransform, type Transform } from "./math";
import type { Vfs } from "./vfs";

export interface ClientArray {
  size: number;
  stride: number;
  offset: number;
  data: Float32Array;
}

export interface MeshPart {
  material: ResolvedMaterial;
  mode: string;
  vertex: ClientArray;
  normal?: ClientArray;
  texCoord?: ClientArray;
  /** The second texture-coordinate set, for texture units with coordSet 1. */
  texCoord1?: ClientArray;
  color?: ClientArray;
  boneIndices?: ClientArray;
  boneWeights?: ClientArray;
  indices?: Int16Array;
  /** Names of the nodes each bone index refers to (skinned meshes). */
  bones?: string[];
  /** Node whose transform positions this mesh (rigid meshes on articulated nodes). */
  node?: string;
}

export interface NodeDef {
  name: string;
  transform: Transform;
  children: NodeDef[];
}

export interface Attachment {
  node: string;
  transform: Transform;
  model: LoadedModel;
}

export interface LoadedModel {
  path: string;
  kind: string;
  parts: MeshPart[];
  root?: NodeDef;
  attachments: Attachment[];
  /** Imported animations that start automatically, by path. */
  autoAnimations: string[];
  /**
   * The model's named animations (ArticulatedConfig animation mappings), as references with
   * their arguments: a monster's "reacting" and "dying", a weapon's "ks_attack". Compound
   * models list their components' too.
   */
  animations: Record<string, any>;
  /** Nodes that turn to face the camera (ArticulatedConfig node transforms). */
  billboards: Map<string, "Billboard" | "Upright">;
  /** Procedural animations that start automatically: node local transforms from expressions. */
  procedurals: { targets: string[]; transform: F<Mat4> }[];
  /** Implementation classes that were found but are not drawn yet. */
  skipped: string[];
  /** Particle-system layers, for ParticleSystemConfig models. */
  particles?: ParticleLayer[];
  /**
   * SceneInfluencerConfig projectors (fake shadows under roofs, trees and characters): an
   * orthographic decal of `texture` covering width by height, tinted by the shadow colour.
   */
  decal?: { width: number; height: number; texture: string; glow: boolean };
  /** ScriptedConfig models: timed model actions (spawn a transient, play a sound). */
  script?: { loopDuration: number; actions: { time: number; action: any }[] };
  bounds?: { min: [number, number, number]; max: [number, number, number] };
  /** SceneInfluencerConfig lights (LightConfig): lights nearby geometry inside their extent. */
  light?: LightDef;
  /**
   * ViewerAffecterConfig Skybox: a model drawn at the camera's position plus
   * (origin - camera) * scale, in world orientation, whatever this model's own placement.
   */
  skybox?: SkyboxDef;
  /** ViewerAffecterConfig BackgroundColor. */
  background?: [number, number, number];
  /** False when the model's InfluenceFlagConfig turns light influences off. */
  receivesLights?: boolean;
}

export interface SkyboxDef {
  model: LoadedModel;
  /** ViewerEffectConfig.Skybox translationScale and translationOrigin. */
  scale: [number, number, number];
  origin: [number, number, number];
}

/** The skybox and background effects anywhere in a model's tree (attachments included). */
export function viewerEffects(m: LoadedModel, out: { skyboxes: SkyboxDef[]; background: [number, number, number] | null } =
  { skyboxes: [], background: null }, depth = 0) {
  if (depth > 12) return out;
  if (m.skybox) out.skyboxes.push(m.skybox);
  if (m.background) out.background = m.background;
  for (const a of m.attachments) viewerEffects(a.model, out, depth + 1);
  return out;
}

/**
 * A light influence (SceneInfluenceConfig.Light with its LightConfig), in model space. Exported
 * configs omit default-valued fields, so LightConfig's defaults fill the gaps.
 */
export interface LightDef {
  kind: "Directional" | "Point" | "Spot";
  ambient: [number, number, number];
  diffuse: [number, number, number];
  /** Point and spot lights. */
  position: [number, number, number];
  /** Directional: toward the light. Spot: the spot direction. */
  direction: [number, number, number];
  /** Constant, linear and quadratic attenuation. */
  attenuation: [number, number, number];
  /** Spot falloff exponent and cutoff angle in degrees. */
  exponent: number;
  cutoff: number;
  /** Full sizes of the influence's box extent (Extent.Limited), or null when unlimited. */
  extent: [number, number, number] | null;
}

export function readLight(impl: any): LightDef | null {
  const l = impl?.influence?.light;
  const kind = (l?.$class ?? "$Directional").replace(/^.*\$/, "");
  if (kind !== "Directional" && kind !== "Point" && kind !== "Spot") return null;
  const v = (o: any, d: [number, number, number]): [number, number, number] => (o ? [o.x ?? 0, o.y ?? 0, o.z ?? 0] : d);
  const c = (o: any, d: [number, number, number]): [number, number, number] => (o ? [o.r ?? 0, o.g ?? 0, o.b ?? 0] : d);
  const att = l?.attenuation;
  const ext = impl.extent;
  return {
    kind,
    ambient: c(l?.colors?.ambient, [0, 0, 0]),
    diffuse: c(l?.colors?.diffuse, [1, 1, 1]),
    position: v(l?.position, [0, 0, 0]),
    direction: v(l?.direction, kind === "Spot" ? [0, 0, -1] : [0, 0, 1]),
    attenuation: [att?.constant ?? 1, att?.linear ?? 0, att?.quadratic ?? 0],
    exponent: l?.falloff?.exponent ?? 0,
    cutoff: l?.falloff?.cutoff ?? 0,
    extent: ext?.$class?.endsWith("$Unlimited") ? null : [ext?.sizeX ?? 1, ext?.sizeY ?? 1, ext?.sizeZ ?? 1],
  };
}

export const inflate = async (data: Uint8Array): Promise<Uint8Array> => {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const short = (c: string) => c.substring(c.lastIndexOf(".") + 1);

interface Ctx { lib: ConfigLibrary; local: LocalConfigs; impl: any; dir: string }

function resolveMaterial(ctx: Ctx, texture: string, tag: string): ResolvedMaterial {
  const { lib, impl, dir } = ctx;
  const mappings: any[] = impl.materialMappings ?? [];
  const mapping = mappings.find(m => (m.texture ?? "") === texture && (m.tag ?? "default") === tag)
    ?? mappings.find(m => (m.texture ?? "") === texture);
  const fallbackTexture = texture ? dir + texture : null;
  const ref = mapping?.material ?? defaultMaterialRef(tag, fallbackTexture ?? "");
  return lib.resolve(ref, fallbackTexture, ctx.local);
}

function clientArray(a: any): ClientArray | undefined {
  if (!a?.floatArray) return undefined;
  return { size: a.size ?? 4, stride: a.stride ?? 0, offset: a.offset ?? 0, data: a.floatArray };
}

function meshPart(ctx: Ctx, m: any, node?: string): MeshPart | null {
  const g = m?.geometry;
  if (!g?.vertexArray) return null;
  const part: MeshPart = {
    material: resolveMaterial(ctx, m.texture ?? "", m.tag ?? "default"),
    mode: g.mode?.name ?? "TRIANGLES",
    vertex: clientArray(g.vertexArray)!,
    normal: clientArray(g.normalArray),
    texCoord: clientArray(g.texCoordArrays?.[0]),
    texCoord1: clientArray(g.texCoordArrays?.[1]),
    color: clientArray(g.colorArray),
    indices: g.indices,
    node,
  };
  for (const attr of g.vertexAttribArrays ?? []) {
    if (attr.name === "boneIndices") part.boneIndices = clientArray(attr);
    else if (attr.name === "boneWeights") part.boneWeights = clientArray(attr);
  }
  if (g.bones) part.bones = g.bones;
  return part;
}

function readNode(ctx: Ctx, n: any, parts: MeshPart[]): NodeDef {
  if (n.visible) {
    const p = meshPart(ctx, n.visible, n.name);
    if (p) parts.push(p);
  }
  return {
    name: n.name ?? "",
    transform: readTransform(n.transform),
    children: (n.children ?? []).map((c: any) => readNode(ctx, c, parts)),
  };
}

function boundsOf(b: any): LoadedModel["bounds"] {
  if (!b?.minExtent && !b?.maxExtent) return undefined;
  const mn = b.minExtent ?? { x: 0, y: 0, z: 0 }, mx = b.maxExtent ?? { x: 0, y: 0, z: 0 };
  return { min: [mn.x, mn.y, mn.z], max: [mx.x, mx.y, mx.z] };
}

const EDITOR_LIGHTS = /^editor\/marker\/(point|directional)light\/(model|parts\/influencer_pointlight|influencer_directionallight)\.dat$/;
/** Editor-only helpers (spawn markers, gizmos) the game never draws; light markers are real lights. */
export const editorOnly = (name: string) => name.startsWith("editor/") && !EDITOR_LIGHTS.test(name);

export class ModelLoader {
  private readonly cache = new Map<string, Promise<JObject>>();
  private readonly models = new Map<string, Promise<LoadedModel>>();
  private library?: Promise<ConfigLibrary>;
  constructor(readonly vfs: Vfs) {}

  /** The install's shared config library (materials, textures), loaded once. */
  configs(): Promise<ConfigLibrary> {
    this.library ??= new ConfigLibrary().load(p => this.importFile(p));
    return this.library;
  }

  /** Imports any export file, cached by path. */
  importFile(path: string): Promise<JObject> {
    let p = this.cache.get(path);
    if (!p) {
      p = this.vfs.read(path).then(async d => (await importBinary(d, inflate)).root as JObject);
      this.cache.set(path, p);
    }
    return p;
  }

  /**
   * Loads a model file. When a reference with arguments is given (as tiles, props and
   * derived models supply), the arguments are applied through the model's parameters first.
   * Results are cached per path and argument set, so identical references share GPU data.
   */
  load(path: string, ref?: any, depth = 0, chain: string[] = []): Promise<LoadedModel> {
    const key = hasArguments(ref) ? path + "|" + argKey(ref) : path;
    // a model that (through attachments or particles) contains itself would otherwise wait
    // on its own pending load forever
    if (chain.includes(key)) return Promise.reject(new Error(`Model cycle at ${path}`));
    const inner = [...chain, key];
    let p = this.models.get(key);
    if (!p) {
      p = (async () => {
        let root: any = await this.importFile(path);
        if (root?.$class !== "com.threerings.opengl.model.config.ModelConfig") {
          throw new Error(`${path} is a ${short(String(root?.$class ?? typeof root))}, not a model`);
        }
        root = applyArguments(root, ref);
        return this.fromImplementation(path, root.implementation, depth, localConfigs(root), inner);
      })();
      this.models.set(key, p);
    }
    return p;
  }

  /** Loads the model a ConfigReference names, or null if it is not a model file. */
  async loadRef(ref: any, depth = 0, chain: string[] = []): Promise<LoadedModel | null> {
    const name: string | undefined = ref?.name;
    if (!name || !name.endsWith(".dat") || depth > 8) return null;
    // editor-only helpers (spawn markers, vertices, gizmos) are never drawn in the game; the
    // point and directional light markers are real lights though (their visible parts sit
    // behind a "markersVisible" condition, which loads nothing here)
    if (editorOnly(name)) return null;
    try { return await this.load(name, ref, depth + 1, chain); } catch { return null; }
  }

  private async fromImplementation(path: string, impl: any, depth: number, local: LocalConfigs,
    chain: string[]): Promise<LoadedModel> {
    const lib = await this.configs();
    const dir = path.substring(0, path.lastIndexOf("/") + 1);
    const model: LoadedModel = {
      path, kind: short(impl?.$class ?? "none"), parts: [], attachments: [], autoAnimations: [], animations: {}, procedurals: [], billboards: new Map(), skipped: [],
    };
    if (!impl) return model;
    if (impl.influences?.lights === false) model.receivesLights = false;

    // Derived models point at another model; their own arguments were already pushed into
    // impl.model's argument map by the derived config's parameters
    if (impl.$class.endsWith("ModelConfig$Derived")) {
      const base = await this.loadRef(impl.model, depth, chain);
      if (base) return { ...base, path, kind: `Derived → ${base.kind}` };
      model.skipped.push(`Derived reference ${impl.model?.name ?? "?"} (config-bundle reference)`);
      return model;
    }

    // Compound models place several component models
    // (merged static models, such as the unbreakable crystal, list their components the same way)
    if (impl.$class.endsWith("CompoundConfig") || impl.$class.endsWith("MergedStaticConfig")) {
      for (const c of impl.models ?? []) {
        const m = await this.loadRef(c.model, depth, chain);
        if (m) model.attachments.push({ node: c.node ?? "", transform: readTransform(c.transform), model: m });
      }
      for (const a of model.attachments) for (const [k, v] of Object.entries(a.model.animations)) model.animations[k] ??= v;
      return model;
    }

    // Schemed models pick a variant per render scheme (quality level): the one for no scheme
    // (the full-detail default Clyde's Schemed.getModel matches first), else the top of the list
    if (impl.$class.endsWith("ModelConfig$Schemed")) {
      const list: any[] = impl.models ?? [];
      for (const sm of [...list.filter(m => m?.scheme == null), ...list.filter(m => m?.scheme != null)]) {
        const m = await this.loadRef(sm.model, depth, chain);
        if (m) return { ...m, path, kind: `Schemed → ${m.kind}` };
      }
      model.skipped.push("Schemed (no file-backed variant)");
      return model;
    }

    // Conditional models choose a case from runtime expressions; show the default case
    if (impl.$class.endsWith("ConditionalConfig")) {
      const m = await this.loadRef(impl.defaultModel, depth, chain);
      if (m) {
        model.attachments.push({ node: "", transform: readTransform(impl.defaultTransform), model: m });
        model.animations = { ...m.animations };
        return model;
      }
      for (const c of impl.cases ?? []) {
        const cm = await this.loadRef(c.model, depth, chain);
        if (cm) { model.attachments.push({ node: "", transform: readTransform(c.transform), model: cm }); model.animations = { ...cm.animations }; return model; }
      }
      model.skipped.push("Conditional (no file-backed case)");
      return model;
    }

    // ViewerAffecterConfig: an effect on the viewer (Unlimited extents act everywhere). A Skybox
    // effect's model is added to the scene by itself, ignoring this model's transform, and
    // follows the camera (ViewerEffectConfig.Skybox); a BackgroundColor sets the clear colour
    if (impl.$class.endsWith("ViewerAffecterConfig")) {
      const eff = impl.effect ?? {};
      const ek = String(eff.$class ?? "").replace(/^.*\$/, "");
      const v = (o: any): [number, number, number] => [o?.x ?? 0, o?.y ?? 0, o?.z ?? 0];
      if (ek === "Skybox") {
        const m = await this.loadRef(eff.model, depth, chain);
        if (m) model.skybox = { model: m, scale: v(eff.translationScale), origin: v(eff.translationOrigin) };
      } else if (ek === "BackgroundColor" && eff.color) {
        model.background = [eff.color.r ?? 0, eff.color.g ?? 0, eff.color.b ?? 0];
      } else model.skipped.push("ViewerEffect " + ek);
      return model;
    }

    if (impl.$class.endsWith("SceneInfluencerConfig") && impl.influence?.$class?.endsWith("$Light")) {
      const light = readLight(impl);
      if (light) model.light = light;
      else model.skipped.push("SceneInfluencer light");
      return model;
    }

    // Scripted models run timed actions (ScriptedConfig.TimeAction); the owner executes them
    if (impl.$class.endsWith("SceneInfluencerConfig") && impl.influence?.$class?.endsWith("$Projector")) {
      const proj = impl.influence.projection ?? {};
      // the projected material's "Texture" argument names the shadow image
      const tex = proj.material?.arguments?.entries?.find(([k]: [string]) => k === "Texture")?.[1];
      const file = tex?.arguments?.entries?.find(([k]: [string]) => k === "File")?.[1];
      if (typeof file === "string") {
        model.decal = { width: proj.width ?? impl.extent?.sizeX ?? 1, height: proj.height ?? impl.extent?.sizeY ?? 1, texture: file,
          glow: /glow/i.test(file) };
      }
      return model;
    }

    if (impl.$class.endsWith("ScriptedConfig")) {
      model.script = {
        loopDuration: impl.loopDuration ?? 0,
        actions: ((impl.actions ?? []) as any[]).filter(a => a?.action).map(a => ({ time: a.time ?? 0, action: a.action }))
          .sort((a, b) => a.time - b.time),
      };
      return model;
    }

    if (impl.$class.endsWith("ParticleSystemConfig")) {
      model.particles = readParticleLayers(impl, ref => lib.resolve(ref, null, local),
        impl.$class.endsWith("MetaParticleSystemConfig"));
      for (const layer of model.particles) if (layer.modelRef) layer.model = await this.loadRef(layer.modelRef, depth, chain);
      if (model.particles.length === 0) model.skipped.push(model.kind);
      return model;
    }

    for (const nt of impl.nodeTransforms ?? []) {
      const k = nt.$class?.endsWith("$Upright") ? "Upright" : "Billboard";
      if (nt.node) model.billboards.set(nt.node, k);
    }

    const ctx: Ctx = { lib, local, impl, dir };
    if (impl.root) model.root = readNode(ctx, impl.root, model.parts);
    for (const am of impl.animationMappings ?? []) {
      if (typeof am?.name === "string" && am.animation?.name) model.animations[am.name] ??= am.animation;
    }
    for (const m of impl.skin?.visible ?? []) {
      const p = meshPart(ctx, m);
      if (p) model.parts.push(p);
    }
    for (const m of impl.meshes?.visible ?? []) {
      const p = meshPart(ctx, m);
      if (p) model.parts.push(p);
    }
    // StaticSetConfig: a map of named mesh sets, one selected by "model"
    if (impl.meshes?.$map) {
      const entries: [unknown, any][] = impl.meshes.entries;
      const chosen = entries.find(([k]) => k === impl.model) ?? entries[0];
      for (const m of chosen?.[1]?.visible ?? []) {
        const p = meshPart(ctx, m);
        if (p) model.parts.push(p);
      }
      model.bounds = boundsOf(chosen?.[1]?.bounds);
    }
    model.bounds ??= boundsOf(impl.skin?.bounds) ?? boundsOf(impl.meshes?.bounds);

    for (const a of impl.attachments ?? []) {
      const m = await this.loadRef(a.model, depth, chain);
      if (m) model.attachments.push({ node: a.node ?? "", transform: readTransform(a.transform ?? IDENTITY_TRANSFORM), model: m });
    }
    for (const am of impl.animationMappings ?? []) {
      const ref = am.animation;
      if (!am.startAutomatically || typeof ref?.name !== "string" || !ref.name.endsWith(".dat")) continue;
      let anim: any;
      try { anim = applyArguments(await this.importFile(ref.name), ref); } catch { continue; }
      const ai = anim?.implementation;
      if (ai?.$class?.endsWith("$Procedural")) {
        for (const tt of ai.transforms ?? []) {
          const fn = transformExpr(tt.expression);
          if (fn) model.procedurals.push({ targets: (tt.targets ?? []).filter(Boolean), transform: fn });
        }
      } else {
        model.autoAnimations.push(ref.name);
      }
    }
    if (model.parts.length === 0 && model.attachments.length === 0) model.skipped.push(model.kind);
    return model;
  }
}

// --- animations ---

export interface AnimationClip {
  /** The file, plus its arguments when it was loaded through a reference that has some. */
  path: string;
  rate: number;
  loop: boolean;
  targets: string[];
  /** frames[frame][target] */
  frames: Transform[][];
  /** AnimationConfig.FrameAction: model actions (sounds, transients) at fractional frames. */
  actions: { frame: number; action: any }[];
}

/**
 * Loads an animation file, or a ConfigReference to one whose arguments are applied (attack
 * animations take their sound and swing effect as arguments).
 */
export async function loadAnimation(loader: ModelLoader, pathOrRef: string | any, depth = 0): Promise<AnimationClip | null> {
  const ref = typeof pathOrRef === "string" ? null : pathOrRef;
  const path: string = ref ? ref.name : pathOrRef;
  if (!path?.endsWith(".dat")) return null;
  let root: any = await loader.importFile(path);
  if (root?.$class !== "com.threerings.opengl.model.config.AnimationConfig") return null;
  root = applyArguments(root, ref);
  const impl = root.implementation;
  if (!impl) return null;
  if (impl.$class.endsWith("$Derived")) {
    return impl.animation?.name && depth < 6 ? loadAnimation(loader, impl.animation, depth + 1) : null;
  }
  if (impl.$class.endsWith("$Sequential")) return sequential(loader, impl, hasArguments(ref) ? path + "|" + argKey(ref) : path, depth);
  if (!impl.transforms || !impl.targets) return null;
  return {
    path: hasArguments(ref) ? path + "|" + argKey(ref) : path,
    rate: impl.rate ?? 30,
    loop: !!impl.loop,
    targets: impl.targets,
    frames: (impl.transforms as any[]).map(f => (f as any[]).map(readTransform)),
    actions: ((impl.actions ?? []) as any[]).filter(a => a?.action).map(a => ({ frame: a.frame ?? 0, action: a.action })),
  };
}

/**
 * AnimationConfig$Sequential: component animations played one after another (a gun's fire
 * then cool-down, a charged shot's release). Joined into one clip at the first component's
 * rate; a node a component does not animate holds its pose from the components around it,
 * and each component's frame actions move to where it starts.
 */
async function sequential(loader: ModelLoader, impl: any, path: string, depth: number): Promise<AnimationClip | null> {
  if (depth > 6) return null;
  const parts: { clip: AnimationClip; speed: number }[] = [];
  for (const c of impl.animations ?? []) {
    const clip = c?.animation?.name ? await loadAnimation(loader, c.animation, depth + 1).catch(() => null) : null;
    if (clip && clip.frames.length) parts.push({ clip, speed: Math.max(0.01, c.speed ?? 1) });
  }
  if (!parts.length) return null;
  const rate = parts[0].clip.rate;
  const targets = [...new Set(parts.flatMap(p => p.clip.targets))];
  const index = new Map(targets.map((t, i) => [t, i]));
  const frames: (Transform | undefined)[][] = [];
  const actions: AnimationClip["actions"] = [];
  const row = (clip: AnimationClip, f: number) => {
    const out: (Transform | undefined)[] = new Array(targets.length);
    clip.targets.forEach((t, ti) => { out[index.get(t)!] = clip.frames[f][ti]; });
    return out;
  };
  for (const { clip, speed } of parts) {
    // the component's length at its speed, resampled to the joined rate
    const seconds = (clip.frames.length - 1) / clip.rate / speed;
    const n = Math.max(1, Math.round(seconds * rate));
    const start = frames.length;
    for (const a of clip.actions) actions.push({ frame: start + (a.frame / clip.rate / speed) * rate, action: a.action });
    for (let f = 0; f < n; f++) frames.push(row(clip, Math.min(clip.frames.length - 1, Math.round((f / rate) * speed * clip.rate))));
  }
  // the last component's final frame, so its end pose is held exactly
  const last = parts[parts.length - 1].clip;
  frames.push(row(last, last.frames.length - 1));
  // gaps hold the previous known transform, else take the next one
  for (let t = 0; t < targets.length; t++) {
    let prev: Transform | undefined;
    for (const r of frames) { if (r[t]) prev = r[t]; else if (prev) r[t] = prev; }
    let next: Transform | undefined;
    for (let f = frames.length - 1; f >= 0; f--) { if (frames[f][t]) next = frames[f][t]; else frames[f][t] = next; }
  }
  return { path, rate, loop: !!impl.loop, targets, frames: frames as Transform[][], actions };
}

/** A stable key for a reference's arguments (nested references included). */
function argKey(ref: any): string {
  return JSON.stringify(ref.arguments, (k, v) => (k === "$outer" ? undefined : ArrayBuffer.isView(v) ? Array.from(v as any) : v));
}
