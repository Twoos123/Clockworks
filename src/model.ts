// Turns imported Clyde ModelConfig object graphs into renderable descriptions.
// Covers the implementations that hold geometry (ArticulatedConfig, StaticConfig,
// StaticSetConfig) and the ones that reference other models (Derived, Compound, plus
// articulated attachments). Particle systems and scripted models are reported, not drawn.

import { ConfigLibrary, defaultMaterialRef, localConfigs, type LocalConfigs, type ResolvedMaterial } from "./config/materials";
import { applyArguments, hasArguments } from "./config/params";
import { readParticleLayers, type ParticleLayer } from "./particles";
import { transformExpr, type F } from "./expr";
import { importBinary, type JObject } from "./export/BinaryImport";
import { IDENTITY_TRANSFORM, identity, multiply, readTransform, toMatrix, type Mat4, type Transform } from "./math";
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
   * The same automatic animations as references, with their arguments (a comic panel's word
   * balloon is animation/sequential/simple.dat given its "Animations" list: a delay, then the
   * pop).
   */
  autoRefs?: any[];
  /** A ComponentBillboardConfig model's component (drawn once paintBillboards gives it a quad). */
  component?: ComponentBillboardDef;
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
  /** ViewerAffecterConfig RenderEffect: the render effect's name (e.g. "Uniform Blur (Skybox)"). */
  renderEffect?: string;
  /** False when the model's InfluenceFlagConfig turns light influences off. */
  receivesLights?: boolean;
  /**
   * The model's own CollisionMesh triangles in model space (9 floats each, v1 v2 v3), which
   * Static/Articulated.getIntersection test rays against: a StaticConfig's or the chosen
   * StaticSetConfig mesh set's collision mesh, the skin's, and each articulated mesh node's
   * (placed by the node's rest transform). Attachments keep their own; see floorTriangles.
   */
  collision?: Float32Array;
  /**
   * The articulated nodes whose collision meshes are in `collision` (an animation moving one
   * moves the floor: the start platform's "collision" node).
   */
  collisionNodes?: string[];
}

/** Appends a CollisionMesh's triangles (its BVH leaves), transformed by `m` when given. */
function collisionTriangles(mesh: any, m: Mat4 | null, out: number[]) {
  const stack: any[] = mesh?.root ? [mesh.root] : [];
  const seen = new Set<any>();
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== "object" || seen.has(n)) continue;
    seen.add(n);
    const t = n.triangle;
    if (t) {
      for (const v of [t.v1, t.v2, t.v3]) {
        const x = v?.x ?? 0, y = v?.y ?? 0, z = v?.z ?? 0;
        if (m) out.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
        else out.push(x, y, z);
      }
    }
    if (n.left) stack.push(n.left);
    if (n.right) stack.push(n.right);
  }
}

/** Articulated mesh nodes' collision meshes, each placed by its node's rest transform. */
function nodeCollision(n: any, parent: Mat4, out: number[], depth = 0, names: string[] = []): string[] {
  if (!n || depth > 64) return names;
  const m = multiply(parent, toMatrix(readTransform(n.transform)));
  if (n.collision) {
    const before = out.length;
    collisionTriangles(n.collision, m, out);
    if (out.length > before && n.name) names.push(n.name);
  }
  for (const c of n.children ?? []) nodeCollision(c, m, out, depth + 1, names);
  return names;
}

/** A node's rest-pose transform in model space (identity when the node is not found). */
export function nodeMatrix(root: NodeDef | undefined, name: string): Mat4 {
  if (!root || !name) return identity();
  const find = (n: NodeDef, parent: Mat4): Mat4 | null => {
    const m = multiply(parent, toMatrix(n.transform));
    if (n.name === name) return m;
    for (const c of n.children) { const r = find(c, m); if (r) return r; }
    return null;
  };
  return find(root, identity()) ?? identity();
}

const floorCache = new WeakMap<LoadedModel, Float32Array>();
/**
 * Every collision triangle a model answers ray queries with (Model.getIntersection: its own
 * meshes plus its attachments' and components', placed by their node and transform), in model
 * space, 9 floats per triangle.
 */
export function floorTriangles(model: LoadedModel, depth = 0): Float32Array {
  let out = floorCache.get(model);
  if (out) return out;
  const tris: number[] = model.collision ? Array.from(model.collision) : [];
  if (depth < 12) {
    for (const a of model.attachments) {
      const sub = floorTriangles(a.model, depth + 1);
      if (!sub.length) continue;
      const m = multiply(nodeMatrix(model.root, a.node), toMatrix(a.transform));
      for (let i = 0; i < sub.length; i += 3) {
        const x = sub[i], y = sub[i + 1], z = sub[i + 2];
        tris.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
      }
    }
  }
  out = new Float32Array(tris);
  floorCache.set(model, out);
  return out;
}

export interface SkyboxDef {
  model: LoadedModel;
  /** ViewerEffectConfig.Skybox translationScale and translationOrigin. */
  scale: [number, number, number];
  origin: [number, number, number];
}

/** The skybox, background and render effects anywhere in a model's tree (attachments included). */
export function viewerEffects(m: LoadedModel, out: { skyboxes: SkyboxDef[]; background: [number, number, number] | null; effects: string[] } =
  { skyboxes: [], background: null, effects: [] }, depth = 0) {
  if (depth > 12) return out;
  // a skybox model may hold viewer affecters of its own ("Environment/Skybox" around the
  // clockwork tunnels' model): they act on the view just the same
  if (m.skybox) { out.skyboxes.push(m.skybox); viewerEffects(m.skybox.model, out, depth + 1); }
  if (m.background) out.background = m.background;
  if (m.renderEffect) out.effects.push(m.renderEffect);
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

/**
 * The model references a model file loads in any case: a derived model's base, a compound's
 * components, attachments, and a conditional's default (before its arguments are applied).
 */
export function componentRefs(root: any): any[] {
  const impl = root?.$class === "com.threerings.opengl.model.config.ModelConfig" ? root.implementation : null;
  if (!impl || typeof impl !== "object") return [];
  const c = String(impl.$class ?? "");
  if (c.endsWith("ModelConfig$Derived")) return [impl.model];
  if (c.endsWith("CompoundConfig") || c.endsWith("MergedStaticConfig")) return ((impl.models ?? []) as any[]).map(m => m?.model);
  if (c.endsWith("ConditionalConfig")) return [impl.defaultModel];
  if (c.endsWith("ModelConfig$Schemed")) {
    // the variant tried first (see fromImplementation)
    const list: any[] = impl.models ?? [];
    return [(list.find(m => m?.scheme == null) ?? list[0])?.model];
  }
  return ((impl.attachments ?? []) as any[]).map(a => a?.model);
}

const EDITOR_LIGHTS = /^editor\/marker\/(point|directional)light\/(model|parts\/influencer_pointlight|influencer_directionallight)\.dat$/;
/** Editor-only helpers (spawn markers, gizmos) the game never draws; light markers are real lights. */
/** The game camera's distance from what it looks at is within this many units. */
export const CAMERA_NEAR = 15;

/**
 * A ConditionalConfig case that holds while the camera is near: `distance < d` (a FloatLess of
 * the "distance" reference) with d at least the camera's distance.
 */
export function nearCase(cond: any): boolean {
  if (!String(cond?.$class ?? "").endsWith("$FloatLess")) return false;
  const a = cond.firstOperand, b = cond.secondOperand;
  if (!String(a?.$class ?? "").endsWith("$Reference") || a.name !== "distance") return false;
  const v = String(b?.$class ?? "").endsWith("$Constant") ? b.value ?? 0 : null;
  return typeof v === "number" && v >= CAMERA_NEAR;
}

export const editorOnly = (name: string) => name.startsWith("editor/") && !EDITOR_LIGHTS.test(name);

/** What a ComponentBillboardConfig shows: an interface component, its styles and bundle. */
export interface ComponentBillboardDef {
  root: any;
  /** The message bundle its text is translated in ("global" for the config's blank one). */
  bundle: string;
  /** The model file's own interface styles. */
  styles: Map<string, any>;
  /** World units an interface pixel. */
  scale: number;
  priority: number;
  queue: string;
  /** Whether it turns to face the viewer (else it keeps its node's orientation). */
  rotate: boolean;
}

/**
 * Draws a billboard's component and registers the picture as a texture: its texture path and
 * its size in interface pixels (the GUI lives outside the model loader, so the screens that
 * show such models supply this).
 */
export type ComponentPainter = (def: ComponentBillboardDef) => Promise<{ texture: string; width: number; height: number } | null>;

/** The node a rotating ComponentBillboard's quad hangs from (it turns to face the camera). */
const BILLBOARD_NODE = "%component%";

const paints = new WeakMap<ComponentBillboardDef, Promise<MeshPart | null>>();

/**
 * Gives the ComponentBillboardConfig models in a model's attachment tree their quads, drawn by
 * `painter` (once per loaded model). The interface screens do this for the models in their
 * views (the prologue's word balloons); elsewhere such models stay undrawn, as the game's
 * name labels and damage numbers are drawn over the scene by the HUD instead.
 */
export async function paintBillboards(model: LoadedModel, painter: ComponentPainter, depth = 0): Promise<void> {
  if (depth > 12) return;
  const c = model.component;
  if (c) {
    // (derived models share their base's component and parts)
    let p = paints.get(c);
    if (!p) {
      p = painter(c).then(img => img && billboardPart(img.texture, img.width, img.height, c.scale, c.priority, c.queue,
        c.rotate ? BILLBOARD_NODE : undefined), () => null);
      paints.set(c, p);
    }
    const part = await p;
    if (part && !model.parts.includes(part)) model.parts.push(part);
    if (part && c.rotate && !model.root) {
      model.root = { name: "%ROOT%", transform: IDENTITY_TRANSFORM, children: [{ name: BILLBOARD_NODE, transform: IDENTITY_TRANSFORM, children: [] }] };
      model.billboards.set(BILLBOARD_NODE, "Billboard");
    }
  }
  for (const a of model.attachments) await paintBillboards(a.model, painter, depth + 1);
}

/**
 * ComponentBillboard's batch as a mesh: the component laid out centred on the origin at its
 * preferred size, `scale` world units an interface pixel, drawn from a texture of it into the
 * config's queue at its priority, premultiplied-alpha blended (ONE, ONE_MINUS_SRC_ALPHA) with
 * no depth writes, unlit and unfogged.
 */
/**
 * A ConditionalConfig case that holds only in the scene editor: model/conditional/marker.dat's
 * `markersVisible` reference, which the game's scope never sets (Clyde reads an unset boolean
 * reference as false). The sunbeam props (world/prop/outershell/sunbeam/compound_model.dat)
 * wrap their editor marker poles in it, untextured opaque Model/Opaque meshes the game never
 * shows.
 */
export function editorCase(cond: any): boolean {
  return String(cond?.$class ?? "").endsWith("BooleanExpression$Reference") && cond.name === "markersVisible";
}

export function billboardPart(texture: string, width: number, height: number, scale: number, priority = 0, queue = "Transparent",
  node?: string): MeshPart {
  const x = (width / 2) * scale, y = (height / 2) * scale;
  const arr = (size: number, v: number[]): ClientArray => ({ size, stride: 0, offset: 0, data: new Float32Array(v) });
  return {
    material: {
      name: "ComponentBillboard", queue, priority, resolved: true,
      passes: [{
        srcBlend: "ONE", destBlend: "ONE_MINUS_SRC_ALPHA", alphaFunc: "ALWAYS", alphaRef: 0, depthFunc: "LEQUAL", depthMask: false,
        cullFace: "DISABLED", color: null, lit: false, ambient: null, overrideLights: 0, ignoreVertexColors: false, fog: false,
        units: [{ texture, colorizations: [], premultiply: true,
          sampler: { wrapS: "CLAMP", wrapT: "CLAMP", minFilter: "LINEAR_MIPMAP_LINEAR", magFilter: "LINEAR" },
          env: "Modulate", rgbScale: 1, sphereMap: false, coordSet: 0, transform: null }],
        shaders: [],
      }],
    },
    mode: "TRIANGLES",
    vertex: arr(3, [-x, -y, 0, x, -y, 0, x, y, 0, -x, y, 0]),
    normal: arr(3, [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    // the picture is uploaded bottom row first (as Clyde's textures are), so v runs upward
    texCoord: arr(2, [0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Int16Array([0, 1, 2, 0, 2, 3]),
    node,
  };
}

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
   * Starts reading and parsing the files these model references name, all at once, for loads
   * that follow one by one (a scene's models, a compound's components): their reads overlap
   * instead of each waiting for the last. Each file's own components, attachments and base
   * model are fetched as soon as it is read. Failures surface when the model itself is loaded.
   */
  prefetch(refs: Iterable<any>, depth = 0) {
    for (const ref of refs) {
      const name: unknown = ref?.name;
      if (typeof name !== "string" || !name.endsWith(".dat") || editorOnly(name) || this.cache.has(name)) continue;
      this.importFile(name).then(root => { if (depth < 8) this.prefetch(componentRefs(root), depth + 1); }).catch(() => undefined);
    }
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
        // the components its arguments name
        if (hasArguments(ref)) this.prefetch(componentRefs(root));
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
      this.prefetch(((impl.models ?? []) as any[]).map(c => c?.model));
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
      // a level-of-detail switch on the distance to the camera (model/conditional/distance.dat:
      // its near case below a distance): the game's camera sits closer than the item models'
      // 20 to 25 units, so dropped crowns and items show their detailed models, not the far
      // stand-ins (a flat inventory icon for a crown)
      const near = (impl.cases ?? []).find((c: any) => nearCase(c?.condition));
      if (near) {
        const nm = await this.loadRef(near.model, depth, chain);
        if (nm) {
          model.attachments.push({ node: "", transform: readTransform(near.transform), model: nm });
          model.animations = { ...nm.animations };
          return model;
        }
      }
      const m = await this.loadRef(impl.defaultModel, depth, chain);
      if (m) {
        model.attachments.push({ node: "", transform: readTransform(impl.defaultTransform), model: m });
        model.animations = { ...m.animations };
        return model;
      }
      for (const c of impl.cases ?? []) {
        // (never an editor-only case: the sunbeams' marker poles show only in the scene editor)
        if (editorCase(c?.condition)) continue;
        const cm = await this.loadRef(c.model, depth, chain);
        if (cm) { model.attachments.push({ node: "", transform: readTransform(c.transform), model: cm }); model.animations = { ...cm.animations }; return model; }
      }
      model.skipped.push("Conditional (no file-backed case)");
      return model;
    }

    // ComponentBillboardConfig: an interface component drawn in the scene (a comic panel's word
    // balloon, ui/conversation/parts/part_interface_balloon.dat), laid out at its preferred
    // size and centred on the model, `scale` world units a pixel; with rotation enabled it
    // turns to face the viewer, else it keeps the orientation of the node it hangs from. Its
    // quad comes from paintBillboards, for the screens that draw them
    if (impl.$class.endsWith("ComponentBillboardConfig")) {
      if (impl.root) {
        model.component = {
          root: impl.root, bundle: impl.bundle || "global", styles: local.styles ?? new Map(), scale: impl.scale ?? 0.01,
          priority: Number(impl.priority ?? 0) || 0, queue: impl.queue ?? "Transparent", rotate: impl.rotationEnabled ?? true,
        };
      }
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
      } else if (ek === "RenderEffect" && eff.renderEffect?.name) {
        model.renderEffect = String(eff.renderEffect.name);
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
      this.prefetch(model.particles.map(l => l.modelRef));
      for (const layer of model.particles) if (layer.modelRef) layer.model = await this.loadRef(layer.modelRef, depth, chain);
      if (model.particles.length === 0) model.skipped.push(model.kind);
      return model;
    }

    for (const nt of impl.nodeTransforms ?? []) {
      const k = nt.$class?.endsWith("$Upright") ? "Upright" : "Billboard";
      if (nt.node) model.billboards.set(nt.node, k);
    }

    // the attachments' and automatic animations' files load while the meshes are read
    this.prefetch(((impl.attachments ?? []) as any[]).map(a => a?.model));
    this.prefetch(((impl.animationMappings ?? []) as any[]).filter(am => am?.startAutomatically).map(am => am.animation));
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
    {
      const tris: number[] = [];
      collisionTriangles(impl.skin?.collision, null, tris);
      if (impl.meshes?.$map) {
        const entries: [unknown, any][] = impl.meshes.entries;
        collisionTriangles((entries.find(([k]) => k === impl.model) ?? entries[0])?.[1]?.collision, null, tris);
      } else collisionTriangles(impl.meshes?.collision, null, tris);
      const own = tris.length;
      const nodes = impl.root ? nodeCollision(impl.root, identity(), tris) : [];
      if (tris.length) model.collision = new Float32Array(tris);
      // (only when the nodes hold all of it: a lift moves every triangle of the model's floor)
      if (nodes.length && !own) model.collisionNodes = nodes;
    }

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
        (model.autoRefs ??= []).push(ref);
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
    // Imported.getScaledRate: the rate as scaled by the animation's speed (a word balloon's pop
    // plays at 20 fps times 1.5)
    rate: (impl.rate ?? 30) * (impl.speed ?? 1),
    loop: !!impl.loop,
    targets: impl.targets,
    frames: (impl.transforms as any[]).map(f => (f as any[]).map(readTransform)),
    actions: ((impl.actions ?? []) as any[]).filter(a => a?.action).map(a => ({ frame: a.frame ?? 0, action: a.action })),
  };
}

/**
 * AnimationConfig$Sequential: component animations played one after another (a gun's fire
 * then cool-down, a charged shot's release). Joined into one clip at the fastest component's
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
  // sampled at the fastest component's rate, so a slow one (animation/common/delay.dat, two
  // frames at 1 fps) leaves the quick ones after it (a word balloon's pop) their frames
  const rate = Math.max(...parts.map(p => p.clip.rate * p.speed));
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
