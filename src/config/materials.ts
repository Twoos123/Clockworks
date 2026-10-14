// Resolves Clyde MaterialConfig references (from the install's config/material.dat) into
// the render states each pass needs. This is the data side of the fixed-function
// emulation: alpha test and blending, depth and cull state, color overrides, lighting
// overrides, texture environments and texture-coordinate generation.

import { applyArguments, CONFIG_REF, getArg, setArg } from "./params";
import { transformExpr, type F } from "../expr";
import { readTransform, toMatrix, type Mat4 } from "../math";

export type Rgba = [number, number, number, number];

export interface TextureUnitState {
  texture: string | null;
  /** ColorizationConfig objects applied to the image when it is loaded. */
  colorizations: any[];
  /** Whether alpha is premultiplied on load (TextureConfig ImageFile.premultiply, default true). */
  premultiply: boolean;
  /** GL sampler settings from the TextureConfig (REPEAT / LINEAR_MIPMAP_LINEAR by default). */
  sampler: { wrapS: string; wrapT: string; minFilter: string; magFilter: string };
  /** Modulate, Replace, Add, Decal, Blend or Combine. */
  env: string;
  rgbScale: number;
  sphereMap: boolean;
  /** Which of the mesh's texture-coordinate sets the unit samples (TextureUnitConfig.coordSet). */
  coordSet: number;
  /** Texture-coordinate transform: static, or animated by a dynamic binding. */
  transform: F<Mat4> | null;
}

export interface PassState {
  srcBlend: string;
  destBlend: string;
  alphaFunc: string;
  alphaRef: number;
  depthFunc: string;
  depthMask: boolean;
  cullFace: string;
  /** Color State Override, multiplied into the result. */
  color: Rgba | null;
  /** False when the pass disables lighting (full-bright). */
  lit: boolean;
  ambient: Rgba | null;
  /** Lights supplied by a light-state override (none means ambient only). */
  overrideLights: number;
  ignoreVertexColors: boolean;
  /** False when the pass disables fog. */
  fog: boolean;
  units: TextureUnitState[];
  /** GLSL programs the original pass uses; this renderer emulates them, see renderer.ts. */
  shaders: string[];
  /** Vertex/Wave parameters (Gerstner waves), when the pass uses that shader. */
  wave?: Wave;
  /** Fragment/Emissive: unit 1 is an emissive map added over the lit colour. */
  emissive?: boolean;
}

export interface Wave {
  vectors: number[];
  frequencies: number[];
  amplitudes: number[];
  phases: number[];
  choppiness: number;
}

export interface ResolvedMaterial {
  name: string;
  queue: string;
  /** For a GroupedEnqueuer, the queue its passes take inside the group (Opaque, Transparent). */
  subQueue?: string;
  passes: PassState[];
  /** True when the material came from the library rather than a fallback. */
  resolved: boolean;
}

/** Configs stored inside a model file's own ConfigManager. */
export interface LocalConfigs {
  materials: Map<string, any>;
  textures: Map<string, any>;
}

export function localConfigs(modelConfig: any): LocalConfigs {
  const out: LocalConfigs = { materials: new Map(), textures: new Map() };
  for (const group of modelConfig?.configs?.groups ?? []) {
    for (const c of group.configs ?? []) {
      if (c.$class?.endsWith("MaterialConfig")) out.materials.set(c.name, c);
      else if (c.$class?.endsWith("TextureConfig")) out.textures.set(c.name, c);
    }
  }
  return out;
}

const color = (c: any): Rgba | null => c ? [c.r ?? 0, c.g ?? 0, c.b ?? 0, c.a ?? 0] : null;
const enumName = (e: any, def: string): string => e?.name ?? def;

export class ConfigLibrary {
  private materials = new Map<string, any>();
  private textures = new Map<string, any>();
  private shaderConfigs = new Map<string, any>();
  private readonly cache = new Map<string, ResolvedMaterial>();

  async load(importFile: (path: string) => Promise<any>) {
    const list = async (path: string) => {
      try {
        const root = await importFile(path);
        return (Array.isArray(root) ? root : []) as any[];
      } catch { return []; }
    };
    for (const c of await list("config/material.dat")) this.materials.set(c.name, c);
    for (const c of await list("config/texture.dat")) this.textures.set(c.name, c);
    for (const c of await list("config/shader.dat")) this.shaderConfigs.set(c.name, c);
    return this;
  }

  get materialCount() { return this.materials.size; }

  /**
   * Resolves a material reference (name plus arguments) into render passes. Configs local to
   * a model (its own ConfigManager) take precedence over the shared library, as in Clyde.
   */
  resolve(ref: any, fallbackTexture: string | null, local?: LocalConfigs): ResolvedMaterial {
    if (local?.materials.has(ref?.name)) return this.resolveUncached(ref, fallbackTexture, local);
    const key = JSON.stringify(ref, (k, v) => (k === "$outer" ? undefined : v)) + "|" + fallbackTexture;
    let r = this.cache.get(key);
    if (!r) {
      r = this.resolveUncached(ref, fallbackTexture, local);
      this.cache.set(key, r);
    }
    return r;
  }

  private resolveUncached(ref: any, fallbackTexture: string | null, local?: LocalConfigs, depth = 0): ResolvedMaterial {
    const base = local?.materials.get(ref?.name) ?? this.materials.get(ref?.name);
    if (!base || depth > 8) return fallback(ref?.name ?? "Model/Opaque", fallbackTexture);
    const cfg = applyArguments(base, ref);
    const impl = cfg.implementation;
    if (impl?.$class?.endsWith("MaterialConfig$Derived")) {
      return { ...this.resolveUncached(impl.material, fallbackTexture, local, depth + 1), name: ref.name };
    }
    const technique = (impl?.techniques ?? [])[0];
    const enqueuer = technique?.enqueuer;
    // GroupedEnqueuer (TechniqueConfig): its enqueuers go into a group inside its own queue
    // ("Skybox" for the skybox materials), each into that group's queue of its own name;
    // CompoundEnqueuer just lists enqueuers. Their passes are drawn in order.
    const leaves: any[] = [];
    const flatten = (e: any, d = 0) => {
      if (!e || d > 4) return;
      if (Array.isArray(e.enqueuers)) for (const c of e.enqueuers) flatten(c, d + 1);
      else leaves.push(e);
    };
    flatten(enqueuer);
    const passes: PassState[] = leaves.flatMap(e => (e.passes ?? []).map((p: any) => this.pass(p, local)));
    const grouped = enqueuer?.$class?.endsWith("$GroupedEnqueuer");
    const inner = leaves[0]?.queue ?? "Opaque";
    return grouped
      ? { name: ref.name, queue: enqueuer.queue ?? "Opaque", subQueue: inner, passes, resolved: true }
      : { name: ref.name, queue: enqueuer?.$class?.endsWith("$CompoundEnqueuer") ? inner : enqueuer?.queue ?? "Opaque", passes, resolved: true };
  }

  private pass(p: any, local?: LocalConfigs): PassState {
    const alpha = p.alphaState ?? {}, depth = p.depthState ?? {}, cull = p.cullState ?? {};
    const light = p.lightStateOverride;
    const shaders: string[] = [];
    let wave: Wave | undefined;
    if (p.shaderState?.$class?.endsWith("$Enabled")) {
      for (const s of [p.shaderState.vertex, p.shaderState.fragment]) if (s?.name) shaders.push(s.name);
      if (p.shaderState.vertex?.name === "Vertex/Wave") wave = this.wave(p.shaderState.vertex);
    }
    return {
      srcBlend: enumName(alpha.srcBlendFactor, "ONE"),
      destBlend: enumName(alpha.destBlendFactor, "ZERO"),
      alphaFunc: enumName(alpha.testFunc, "ALWAYS"),
      alphaRef: alpha.testRef ?? 0,
      depthFunc: enumName(depth.testFunc, "LEQUAL"),
      depthMask: depth.mask ?? true,
      cullFace: enumName(cull.face, "BACK"),
      color: p.colorStateOverride ? color(p.colorStateOverride.color ?? { r: 1, g: 1, b: 1, a: 1 }) : null,
      lit: !light?.$class?.endsWith("$Disabled"),
      ambient: light?.$class?.endsWith("$Enabled") ? color(light.globalAmbient ?? { r: 0.2, g: 0.2, b: 0.2, a: 1 }) : null,
      overrideLights: light?.lights?.length ?? 0,
      ignoreVertexColors: !!p.ignoreVertexColors,
      fog: !p.fogStateOverride?.$class?.endsWith("$Disabled"),
      units: (p.textureState?.units ?? []).map((u: any, i: number) => this.unit(u, local, bindingFor(p, i))),
      shaders,
      wave,
      emissive: p.shaderState?.fragment?.name === "Fragment/Emissive",
    };
  }

  /** Reads the uniforms of a Vertex/Wave shader reference (arguments applied). */
  private wave(ref: any): Wave {
    const base = this.shaderConfigs.get(ref.name);
    const uniforms: any[] = base ? applyArguments(base, ref).implementation?.uniforms ?? [] : [];
    const get = (name: string) => uniforms.find(u => u.name === name)?.value;
    const out: Wave = { vectors: [], frequencies: [], amplitudes: [], phases: [], choppiness: get("choppiness") ?? 0 };
    for (let i = 0; i < 2; i++) {
      const v = get(`vectors[${i}]`);
      out.vectors.push(v?.x ?? 0, v?.y ?? 0);
      out.frequencies.push(get(`frequencies[${i}]`) ?? 0);
      out.amplitudes.push(get(`amplitudes[${i}]`) ?? 0);
      out.phases.push(get(`phases[${i}]`) ?? 0);
    }
    return out;
  }

  private unit(u: any, local?: LocalConfigs, animated: F<Mat4> | null = null): TextureUnitState {
    let transform = animated;
    if (!transform && (u.transform?.translation || u.transform?.rotation || u.transform?.matrix || u.transform?.scale)) {
      const m = toMatrix(readTransform(u.transform));
      transform = () => m;
    }
    const env = u.environment?.$class ?? "Modulate";
    const scale = u.environment?.rgbScale?.name;
    return {
      texture: this.texturePath(u.texture, local),
      colorizations: this.textureColorizations(u.texture, local),
      premultiply: this.texturePremultiply(u.texture, local),
      sampler: this.textureSampler(u.texture, local),
      env: env.substring(env.lastIndexOf("$") + 1),
      rgbScale: scale === "TWO" ? 2 : scale === "FOUR" ? 4 : 1,
      sphereMap: !!u.coordGenS?.$class?.endsWith("$SphereMap"),
      coordSet: u.coordSet ?? 0,
      transform,
    };
  }

  /** Resolves a TextureConfig reference to an image path under rsrc/. */
  /** The colorizations a TextureConfig reference applies to its image. */
  textureSampler(ref: any, local?: LocalConfigs) {
    const base = ref && (local?.textures.get(ref.name) ?? this.textures.get(ref.name));
    const impl = base ? applyArguments(base, ref).implementation : null;
    return {
      wrapS: impl?.wrapS?.name ?? "REPEAT", wrapT: impl?.wrapT?.name ?? "REPEAT",
      minFilter: impl?.minFilter?.name ?? "LINEAR_MIPMAP_LINEAR", magFilter: impl?.magFilter?.name ?? "LINEAR",
    };
  }

  texturePremultiply(ref: any, local?: LocalConfigs): boolean {
    const base = ref && (local?.textures.get(ref.name) ?? this.textures.get(ref.name));
    if (!base) return true;
    return applyArguments(base, ref).implementation?.contents?.premultiply ?? true;
  }

  textureColorizations(ref: any, local?: LocalConfigs): any[] {
    const base = ref && (local?.textures.get(ref.name) ?? this.textures.get(ref.name));
    if (!base) return [];
    const list = applyArguments(base, ref).implementation?.contents?.colorizations;
    return Array.isArray(list) ? list.filter(Boolean) : [];
  }

  texturePath(ref: any, local?: LocalConfigs): string | null {
    if (!ref) return null;
    const base = local?.textures.get(ref.name) ?? this.textures.get(ref.name);
    if (base) {
      const cfg = applyArguments(base, ref);
      const file = cfg.implementation?.contents?.file;
      if (typeof file === "string") return file;
      if (file && typeof file === "object" && file.$file) return file.$file;
    }
    const direct = getArg(ref, "File");
    return typeof direct === "string" ? direct : null;
  }
}

/** Mirrors ModelConfig.Imported's default material: textured, lit, opaque. */
function fallback(name: string, texture: string | null): ResolvedMaterial {
  const n = name.toLowerCase();
  const translucent = n.includes("translucent") || n.includes("additive");
  return {
    name, queue: translucent ? "Transparent" : "Opaque", resolved: false,
    passes: [{
      srcBlend: translucent ? "SRC_ALPHA" : "ONE",
      destBlend: n.includes("additive") ? "ONE" : translucent ? "ONE_MINUS_SRC_ALPHA" : "ZERO",
      alphaFunc: n.includes("masked") ? "GEQUAL" : "ALWAYS", alphaRef: n.includes("masked") ? 0.5 : 0,
      depthFunc: "LEQUAL", depthMask: !translucent, cullFace: "BACK", color: null, lit: true, ambient: null, overrideLights: 0,
      ignoreVertexColors: false, fog: true, units: [{ texture, colorizations: [], premultiply: true,
        sampler: { wrapS: "REPEAT", wrapT: "REPEAT", minFilter: "LINEAR_MIPMAP_LINEAR", magFilter: "LINEAR" }, env: "Modulate", rgbScale: 1, sphereMap: false, coordSet: 0, transform: null }], shaders: [],
    }],
  };
}

/** Builds the material reference Clyde uses for a mesh with no explicit mapping. */
export function defaultMaterialRef(tag: string, texture: string) {
  const ref: any = { $class: CONFIG_REF, name: tag === "skinned" ? "Model/Skinned/Opaque" : "Model/Opaque" };
  const tex: any = { $class: CONFIG_REF, name: "2D/File/Default" };
  setArg(tex, "File", texture);
  setArg(ref, "Texture", tex);
  return ref;
}

/** The animated texture transform a pass's dynamic bindings give texture unit `unit`. */
function bindingFor(pass: any, unit: number): F<Mat4> | null {
  for (const b of pass.dynamicBindings ?? []) {
    if (!b.$class?.endsWith("Transform3DBinding")) continue;
    for (const path of b.paths ?? []) {
      const m = /states\[14\]\._units\[(\d+)\]\.?transform/.exec(path);
      if (m && Number(m[1]) === unit) return transformExpr(b.expression);
    }
  }
  return null;
}
