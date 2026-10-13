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
  /** Nodes that turn to face the camera (ArticulatedConfig node transforms). */
  billboards: Map<string, "Billboard" | "Upright">;
  /** Procedural animations that start automatically: node local transforms from expressions. */
  procedurals: { targets: string[]; transform: F<Mat4> }[];
  /** Implementation classes that were found but are not drawn yet. */
  skipped: string[];
  /** Particle-system layers, for ParticleSystemConfig models. */
  particles?: ParticleLayer[];
  bounds?: { min: [number, number, number]; max: [number, number, number] };
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
    // editor-only helpers (spawn markers, vertices, gizmos) are never drawn in the game
    if (name.startsWith("editor/")) return null;
    try { return await this.load(name, ref, depth + 1, chain); } catch { return null; }
  }

  private async fromImplementation(path: string, impl: any, depth: number, local: LocalConfigs,
    chain: string[]): Promise<LoadedModel> {
    const lib = await this.configs();
    const dir = path.substring(0, path.lastIndexOf("/") + 1);
    const model: LoadedModel = {
      path, kind: short(impl?.$class ?? "none"), parts: [], attachments: [], autoAnimations: [], procedurals: [], billboards: new Map(), skipped: [],
    };
    if (!impl) return model;

    // Derived models point at another model; their own arguments were already pushed into
    // impl.model's argument map by the derived config's parameters
    if (impl.$class.endsWith("ModelConfig$Derived")) {
      const base = await this.loadRef(impl.model, depth, chain);
      if (base) return { ...base, path, kind: `Derived → ${base.kind}` };
      model.skipped.push(`Derived reference ${impl.model?.name ?? "?"} (config-bundle reference)`);
      return model;
    }

    // Compound models place several component models
    if (impl.$class.endsWith("CompoundConfig")) {
      for (const c of impl.models ?? []) {
        const m = await this.loadRef(c.model, depth, chain);
        if (m) model.attachments.push({ node: c.node ?? "", transform: readTransform(c.transform), model: m });
      }
      return model;
    }

    // Schemed models pick a variant per render scheme (quality level); show the first one
    if (impl.$class.endsWith("ModelConfig$Schemed")) {
      for (const sm of impl.models ?? []) {
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
        return model;
      }
      for (const c of impl.cases ?? []) {
        const cm = await this.loadRef(c.model, depth, chain);
        if (cm) { model.attachments.push({ node: "", transform: readTransform(c.transform), model: cm }); return model; }
      }
      model.skipped.push("Conditional (no file-backed case)");
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
  path: string;
  rate: number;
  loop: boolean;
  targets: string[];
  /** frames[frame][target] */
  frames: Transform[][];
}

export async function loadAnimation(loader: ModelLoader, path: string, depth = 0): Promise<AnimationClip | null> {
  const root: any = await loader.importFile(path);
  if (root?.$class !== "com.threerings.opengl.model.config.AnimationConfig") return null;
  const impl = root.implementation;
  if (!impl) return null;
  if (impl.$class.endsWith("$Derived")) {
    const name = impl.animation?.name;
    return name?.endsWith(".dat") && depth < 6 ? loadAnimation(loader, name, depth + 1) : null;
  }
  if (!impl.transforms || !impl.targets) return null;
  return {
    path,
    rate: impl.rate ?? 30,
    loop: !!impl.loop,
    targets: impl.targets,
    frames: (impl.transforms as any[]).map(f => (f as any[]).map(readTransform)),
  };
}

/** A stable key for a reference's arguments (nested references included). */
function argKey(ref: any): string {
  return JSON.stringify(ref.arguments, (k, v) => (k === "$outer" ? undefined : ArrayBuffer.isView(v) ? Array.from(v as any) : v));
}
