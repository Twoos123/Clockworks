// WebGL2 renderer for loaded Clyde models.
//
// Clyde's desktop renderer uses the OpenGL compatibility profile (fixed-function lighting,
// texture environments, alpha test, texgen, client arrays). WebGL2 has none of that, so
// each material pass resolved from the install's material library is drawn through one
// GLSL ES 3.00 program that emulates those stages: alpha test functions, the Modulate,
// Replace, Add and Decal texture environments plus Combine scaling, sphere-map texgen,
// color-state overrides, and GL_LIGHT0-style lighting with a light-state override.
// Blend, depth and cull state map directly onto WebGL. Skinning (Clyde's "Vertex/Skin"
// shader or CPU skin deformer) runs in the vertex shader from a bone-matrix texture.

import { identity, invert, multiply, slerp, lerp3, toMatrix, type Mat4, type Transform } from "../math";
import type { PassState, TextureUnitState } from "../config/materials";
import { VIEWER_ENVIRONMENT, type Environment, type Rgb } from "../environment";
import { Emitter } from "../particles";
import { recolorPixels, type ColorPository } from "../colors";
import type { AnimationClip, ClientArray, LoadedModel, MeshPart, NodeDef } from "../model";
import type { Vfs } from "../vfs";

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_normal;
layout(location=2) in vec2 a_uv;
layout(location=3) in vec4 a_color;
layout(location=4) in vec4 a_boneIdx;
layout(location=5) in vec4 a_boneW;
layout(location=6) in mat4 a_model; // per instance (locations 6-9)
uniform mat4 u_proj, u_view, u_texMatrix;
uniform bool u_skinned, u_sphereMap, u_wave;
uniform float u_time, u_choppiness;
uniform vec2 u_waveVectors[2];
uniform float u_waveFreq[2], u_waveAmp[2], u_wavePhase[2];
uniform highp sampler2D u_bones;
out vec3 v_normal;
out vec2 v_uv;
out vec4 v_color;
out vec3 v_eye;
mat4 bone(float i) {
  int b = int(i) * 4;
  return mat4(texelFetch(u_bones, ivec2(b, 0), 0), texelFetch(u_bones, ivec2(b + 1, 0), 0),
              texelFetch(u_bones, ivec2(b + 2, 0), 0), texelFetch(u_bones, ivec2(b + 3, 0), 0));
}
void main() {
  vec4 pos = vec4(a_pos, 1.0);
  vec3 nrm = a_normal;
  if (u_skinned) {
    mat4 skin = bone(a_boneIdx.x) * a_boneW.x + bone(a_boneIdx.y) * a_boneW.y
              + bone(a_boneIdx.z) * a_boneW.z + bone(a_boneIdx.w) * a_boneW.w;
    pos = skin * pos;
    nrm = mat3(skin) * nrm;
  }
  mat4 mv = u_view * a_model;
  if (u_wave) {
    // Vertex/Wave: Gerstner waves applied in world space (rsrc/shader/vertex/wave.vert)
    vec4 wv = a_model * pos;
    vec3 wn = mat3(a_model) * nrm;
    for (int i = 0; i < 2; i++) {
      float ang = dot(u_waveVectors[i], wv.xy) - u_waveFreq[i] * u_time + u_wavePhase[i];
      vec2 off = u_waveVectors[i] * u_waveAmp[i] * sin(ang);
      wn.xy -= off;
      float l = max(length(u_waveVectors[i]), 1e-4);
      wv.xyz += vec3(off * (u_choppiness / l), u_waveAmp[i] * cos(ang));
    }
    pos = wv;
    nrm = wn;
    mv = u_view;
  }
  v_normal = mat3(mv) * nrm;
  v_uv = a_uv;
  if (u_sphereMap) {
    // GL_SPHERE_MAP texture coordinate generation, as in the fixed-function pipeline
    vec3 u = normalize((mv * pos).xyz);
    vec3 r = reflect(u, normalize(v_normal));
    float m = 2.0 * sqrt(r.x * r.x + r.y * r.y + (r.z + 1.0) * (r.z + 1.0));
    v_uv = vec2(r.x / m + 0.5, r.y / m + 0.5);
  }
  v_uv = (u_texMatrix * vec4(v_uv, 0.0, 1.0)).xy;
  v_color = a_color;
  vec4 eye = mv * pos;
  v_eye = eye.xyz;
  gl_Position = u_proj * eye;
}`;

const FS = `#version 300 es
precision mediump float;
in vec3 v_normal;
in vec2 v_uv;
in vec4 v_color;
in vec3 v_eye;
uniform sampler2D u_tex, u_emissiveTex;
uniform bool u_emissive;
uniform bool u_hasTex, u_lit, u_useVertexColor, u_particle;
uniform int u_alphaFunc, u_env;
uniform float u_alphaRef, u_rgbScale;
uniform vec4 u_color;
uniform vec3 u_ambient;
uniform int u_numLights;
uniform vec3 u_lightDirs[4], u_lightColors[4];
uniform int u_fogMode; // 0 none, 1 linear, 2 exp, 3 exp2
uniform vec3 u_fogColor;
uniform float u_fogStart, u_fogEnd, u_fogDensity;
out vec4 fragColor;
bool alphaPasses(float a) {
  switch (u_alphaFunc) {
    case 1: return false;
    case 2: return a < u_alphaRef;
    case 3: return a == u_alphaRef;
    case 4: return a <= u_alphaRef;
    case 5: return a > u_alphaRef;
    case 6: return a != u_alphaRef;
    case 7: return a >= u_alphaRef;
    default: return true;
  }
}
void main() {
  vec4 c = u_color * (u_useVertexColor ? v_color : vec4(1.0));
  if (u_lit) {
    vec3 n = normalize(v_normal), light = u_ambient;
    for (int i = 0; i < 4; i++) {
      if (i >= u_numLights) break;
      light += u_lightColors[i] * max(dot(n, u_lightDirs[i]), 0.0);
    }
    c.rgb *= light;
  }
  if (u_emissive) {
    // Fragment/Emissive: diffuse * (lit + emissive - lit * emissive)
    vec4 e = texture(u_emissiveTex, v_uv);
    c = c + e - c * e;
  }
  if (u_hasTex) {
    vec4 t = texture(u_tex, v_uv);
    if (u_env == 1) c = t;                                   // Replace
    else if (u_env == 2) c = vec4(c.rgb + t.rgb, c.a * t.a); // Add
    else if (u_env == 3) c.rgb = mix(c.rgb, t.rgb, t.a);     // Decal
    else c *= t;                                             // Modulate, Combine
  }
  c.rgb *= u_rgbScale;
  if (!alphaPasses(c.a)) discard;
  if (u_fogMode > 0) {
    float d = length(v_eye), f;
    if (u_fogMode == 1) f = clamp((u_fogEnd - d) / max(u_fogEnd - u_fogStart, 1e-4), 0.0, 1.0);
    else if (u_fogMode == 2) f = exp(-u_fogDensity * d);
    else f = exp(-pow(u_fogDensity * d, 2.0));
    c.rgb = mix(u_fogColor, c.rgb, f);
  }
  fragColor = c;
}`;

const FOG_MODES = { linear: 1, exp: 2, exp2: 3 } as const;
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const ALPHA_FUNCS = ["ALWAYS", "NEVER", "LESS", "EQUAL", "LEQUAL", "GREATER", "NOTEQUAL", "GEQUAL"];
const ENVS = ["Modulate", "Replace", "Add", "Decal"];
const QUEUE_ORDER: Record<string, number> = {
  Skybox: 0, "Skybox (Fov Standard)": 0, Opaque: 1, Transparent: 3, Overlay: 4, Blurred: 5,
};

interface GpuPart {
  part: MeshPart;
  vao: WebGLVertexArrayObject;
  count: number;
  indexed: boolean;
  primitive: number;
  /** Texture for each pass (unit 0). */
  textures: (WebGLTexture | null)[];
  /** Emissive map for each pass (unit 1), for Fragment/Emissive passes. */
  emissive: (WebGLTexture | null)[];
}

/** Runtime state for one placed model (and, recursively, its attachments). */
export class ModelInstance {
  readonly parts: GpuPart[] = [];
  readonly children: { node: string; transform: Mat4; instance: ModelInstance }[] = [];
  /** Node name -> local transform (bind pose). */
  private readonly bindLocal = new Map<string, Transform>();
  /** Node name -> inverse of the bind-pose model-space transform. */
  private readonly invRef = new Map<string, Mat4>();
  /** Node name -> current model-space transform. */
  readonly world = new Map<string, Mat4>();
  clip: AnimationClip | null = null;
  /** Seconds since the current clip started (or since the instance was made). */
  time = 0;
  /** Playback speed multiplier for the current clip. */
  speed = 1;
  /** The clip being faded out, its time when the fade began, and its speed. */
  private prev: { clip: AnimationClip; time: number; speed: number } | null = null;
  private blendDuration = 0;
  /** Frame number of the last update, so shared instances update once per frame. */
  private updatedFrame = -1;
  /**
   * A second clip layered over the first on a subset of nodes (the upper body), so a knight
   * can swing a sword while its legs run. Its time is advanced by the owner.
   */
  overlay: { clip: AnimationClip; time: number; speed: number; mask: Set<string>; blendIn: number } | null = null;
  /**
   * Frame actions (AnimationConfig.FrameAction) the clips have passed since the owner last
   * drained this list; the owner executes them (sounds, swing trails).
   */
  readonly events: any[] = [];
  private baseMark = { clip: null as AnimationClip | null, frame: 0 };
  private overlayMark = { clip: null as AnimationClip | null, frame: 0 };

  /** Queues the actions of `clip` between the mark's frame and time `t` (seconds). */
  private markActions(clip: AnimationClip | null, t: number, mark: { clip: AnimationClip | null; frame: number }) {
    if (!clip) { mark.clip = null; return; }
    let f = t * clip.rate;
    if (!clip.loop) f = Math.min(f, clip.frames.length - 1);
    let prev = mark.clip === clip ? mark.frame : -1e-6;
    if (f < prev) prev = -1e-6;
    mark.clip = clip;
    mark.frame = f;
    if (!clip.actions?.length || f === prev) return;
    const n = clip.frames.length;
    for (const a of clip.actions) {
      if (!clip.loop || n <= 0) { if (a.frame > prev && a.frame <= f) this.events.push(a.action); continue; }
      for (let k = Math.ceil((prev - a.frame) / n); a.frame + k * n <= f; k++) {
        if (a.frame + k * n > prev) this.events.push(a.action);
      }
    }
  }

  /** Plays a clip on the masked nodes only, over whatever the base clip does. */
  playOverlay(clip: AnimationClip, mask: Set<string>, opts: { loop?: boolean; speed?: number; blendIn?: number } = {}) {
    if (this.overlay && this.overlay.clip.path === clip.path && (opts.loop ?? false) && this.overlay.clip.loop) return;
    this.overlay = { clip: { ...clip, loop: opts.loop ?? false }, time: 0, speed: opts.speed ?? 1, mask, blendIn: opts.blendIn ?? 0.08 };
  }

  get overlayFinished(): boolean {
    const o = this.overlay;
    return !!o && !o.clip.loop && o.time * o.speed >= (o.clip.frames.length - 1) / o.clip.rate;
  }

  /** Names of a node and all nodes below it in this model's skeleton. */
  subtree(name: string): Set<string> {
    const out = new Set<string>();
    const find = (n: NodeDef): NodeDef | null => n.name === name ? n : n.children.map(find).find(Boolean) ?? null;
    const start = this.model.root ? find(this.model.root) : null;
    const add = (n: NodeDef) => { out.add(n.name); n.children.forEach(add); };
    if (start) add(start);
    return out;
  }

  constructor(readonly model: LoadedModel) {
    if (model.root) {
      const walk = (n: NodeDef, parent: Mat4) => {
        this.bindLocal.set(n.name, n.transform);
        const ref = multiply(parent, toMatrix(n.transform));
        this.invRef.set(n.name, invert(ref));
        n.children.forEach(c => walk(c, ref));
      };
      walk(model.root, identity());
    }
  }

  /**
   * Starts a clip, cross-fading from the current one over `blend` seconds. Restarting a
   * looping clip that is already playing does nothing.
   */
  play(clip: AnimationClip, opts: { loop?: boolean; speed?: number; blend?: number } = {}) {
    const loop = opts.loop ?? true;
    if (this.clip && this.clip.path === clip.path && loop && this.clip.loop) {
      this.speed = opts.speed ?? this.speed;
      return;
    }
    this.prev = this.clip ? { clip: this.clip, time: this.time, speed: this.speed } : null;
    this.clip = { ...clip, loop };
    this.speed = opts.speed ?? 1;
    this.time = 0;
    this.blendDuration = opts.blend ?? 0.15;
    // a model without a skeleton of its own (a compound monster: body, head and arms as
    // separate articulated parts) passes the clip to its parts, each taking the nodes it has
    if (!this.model.root) for (const c of this.children) c.instance.play(clip, opts);
  }

  /** Advances this instance's clock and its attachments' (a weapon's own animations). */
  advance(dt: number) {
    this.time += dt;
    for (const c of this.children) c.instance.advance(dt);
  }

  /** Every instance in this one's attachment tree, itself first. */
  *descendants(): Generator<ModelInstance> {
    yield this;
    for (const c of this.children) yield* c.instance.descendants();
  }

  /** Length of the current clip in seconds at its speed. */
  get duration(): number {
    const c = this.clip;
    return c && c.frames.length ? (c.frames.length - 1) / c.rate / this.speed : 0;
  }

  /** True once a non-looping clip has played to its end. */
  get finished(): boolean {
    return !!this.clip && !this.clip.loop && this.time >= this.duration;
  }

  /** Recomputes node transforms for the current animation time. */
  update(frame = -1) {
    if (frame >= 0) {
      if (frame === this.updatedFrame) return;
      this.updatedFrame = frame;
    }
    this.markActions(this.clip, this.time * this.speed, this.baseMark);
    this.markActions(this.overlay?.clip ?? null, (this.overlay?.time ?? 0) * (this.overlay?.speed ?? 1), this.overlayMark);
    if (this.events.length > 64) this.events.splice(0, this.events.length - 64);
    if (!this.model.root) return;
    const current = this.clip ? sampleClip(this.clip, this.time * this.speed) : new Map<string, Transform>();
    let pose = current;
    if (this.prev && this.time < this.blendDuration) {
      const w = this.time / this.blendDuration;
      const old = sampleClip(this.prev.clip, (this.prev.time + this.time) * this.prev.speed);
      pose = new Map();
      for (const name of new Set([...old.keys(), ...current.keys()])) {
        const a = old.get(name) ?? this.bindLocal.get(name), b = current.get(name) ?? this.bindLocal.get(name);
        if (!a || !b) continue;
        pose.set(name, a.matrix || b.matrix ? (w < 0.5 ? a : b)
          : { t: lerp3(a.t, b.t, w), r: slerp(a.r, b.r, w), s: a.s + (b.s - a.s) * w });
      }
    } else {
      this.prev = null;
    }
    const o = this.overlay;
    if (o) {
      const layer = sampleClip(o.clip, o.time * o.speed);
      const w = Math.min(1, o.time / Math.max(0.001, o.blendIn));
      if (pose === current) pose = new Map(current);
      for (const name of o.mask) {
        const b = layer.get(name);
        if (!b) continue;
        const a = pose.get(name) ?? this.bindLocal.get(name);
        pose.set(name, w >= 1 || !a || a.matrix || b.matrix ? b
          : { t: lerp3(a.t, b.t, w), r: slerp(a.r, b.r, w), s: a.s + (b.s - a.s) * w });
      }
    }
    const overrides = new Map<string, Mat4>();
    for (const [name, x] of pose) overrides.set(name, toMatrix(x));
    // procedural animations set the target nodes' local transforms outright
    for (const p of this.model.procedurals) {
      const m = p.transform(this.time);
      for (const t of p.targets) overrides.set(t, m);
    }
    const walk = (n: NodeDef, parent: Mat4) => {
      const local = overrides.get(n.name) ?? toMatrix(this.bindLocal.get(n.name)!);
      const w = multiply(parent, local);
      this.world.set(n.name, w);
      n.children.forEach(c => walk(c, w));
    };
    walk(this.model.root, identity());
  }

  /** Bone matrices (bone node world * inverse reference) for a skinned part. */
  /**
   * The articulated model whose skeleton drives this one's skinned meshes. A skinned model
   * attached to an articulated one (armour on a knight) has no skeleton of its own, and in
   * Clyde its bones resolve against the parent's nodes.
   */
  boneParent: ModelInstance | null = null;
  /** World placement of boneParent, for skinned meshes driven by its bones. */
  bonePlacement: Mat4 | null = null;

  boneMatrices(bones: string[]): Float32Array {
    const out = new Float32Array(bones.length * 16);
    const src = !this.model.root && this.boneParent ? this.boneParent : this;
    bones.forEach((b, i) => {
      const w = src.world.get(b), r = src.invRef.get(b);
      out.set(w && r ? multiply(w, r) : identity(), i * 16);
    });
    return out;
  }

  nodeMatrix(node: string): Mat4 {
    return this.world.get(node) ?? identity();
  }
}

/** Samples a clip's local node transforms at time t (seconds, already speed-scaled). */
function sampleClip(clip: AnimationClip, time: number): Map<string, Transform> {
  const out = new Map<string, Transform>();
  const n = clip.frames.length;
  if (n === 0) return out;
  let f = time * clip.rate;
  f = clip.loop ? ((f % n) + n) % n : Math.max(0, Math.min(f, n - 1));
  const i0 = Math.floor(f), i1 = clip.loop ? (i0 + 1) % n : Math.min(i0 + 1, n - 1), t = f - i0;
  clip.targets.forEach((name, ti) => {
    const a = clip.frames[i0][ti], b = clip.frames[i1][ti];
    if (!a) return;
    if (a.matrix || !b || b.matrix) { out.set(name, a); return; }
    out.set(name, { t: lerp3(a.t, b.t, t), r: slerp(a.r, b.r, t), s: a.s + (b.s - a.s) * t });
  });
  return out;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly u: Record<string, WebGLUniformLocation | null> = {};
  private readonly buffers = new WeakMap<Float32Array | Int16Array, WebGLBuffer>();
  private readonly textures = new Map<string, Promise<WebGLTexture | null>>();
  private readonly loadedTextures = new Map<string, WebGLTexture | null>();
  private readonly boneTex: WebGLTexture;
  private readonly instanceBuffer: WebGLBuffer;
  private readonly particleBuffer: WebGLBuffer;
  private readonly particleVao: WebGLVertexArrayObject;
  /** Emitters per model instance, one per placement in traversal order. */
  private readonly emitters = new WeakMap<ModelInstance, Emitter[]>();
  /** Particle effects in the scene (the options menu can turn them off; HUD views keep theirs). */
  particlesOn = true;
  private drawingOffscreen = false;
  private lastTime = 0;
  private view: Mat4 = identity();
  private instanceData = new Float32Array(16 * 1024);
  private readonly white: WebGLTexture;
  stats = { draws: 0, triangles: 0 };

  constructor(readonly canvas: HTMLCanvasElement, private readonly vfs: Vfs) {
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
    if (!gl) throw new Error("WebGL 2 is not available in this browser.");
    this.gl = gl;
    this.program = link(gl, VS, FS);
    for (const name of ["u_proj", "u_view", "u_model", "u_skinned", "u_bones", "u_tex", "u_hasTex",
      "u_lit", "u_alphaRef", "u_sphereMap", "u_useVertexColor", "u_alphaFunc", "u_env",
      "u_rgbScale", "u_color", "u_ambient", "u_numLights", "u_lightDirs", "u_lightColors", "u_fogMode",
      "u_fogColor", "u_fogStart", "u_fogEnd", "u_fogDensity", "u_texMatrix", "u_particle", "u_wave", "u_time", "u_choppiness", "u_waveVectors",
      "u_waveFreq", "u_waveAmp", "u_wavePhase", "u_emissive", "u_emissiveTex"]) {
      this.u[name] = gl.getUniformLocation(this.program, name);
    }
    this.boneTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.boneTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.instanceBuffer = gl.createBuffer()!;
    this.particleBuffer = gl.createBuffer()!;
    this.particleVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.particleVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 36, 20);
    gl.bindVertexArray(null);
    this.white = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.white);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  }

  /** Uploads a model's geometry and starts loading its textures. */
  async instantiate(model: LoadedModel): Promise<ModelInstance> {
    const inst = new ModelInstance(model);
    const gl = this.gl;
    for (const part of model.parts) {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      this.attrib(0, part.vertex);
      if (part.normal) this.attrib(1, part.normal); else gl.vertexAttrib3f(1, 0, 0, 1);
      if (part.texCoord) this.attrib(2, part.texCoord); else gl.vertexAttrib2f(2, 0, 0);
      if (part.color) this.attrib(3, part.color); else gl.vertexAttrib4f(3, 1, 1, 1, 1);
      if (part.boneIndices) this.attrib(4, part.boneIndices);
      if (part.boneWeights) this.attrib(5, part.boneWeights);
      let count: number, indexed = false;
      if (part.indices) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffer(part.indices, gl.ELEMENT_ARRAY_BUFFER));
        count = part.indices.length;
        indexed = true;
      } else {
        const stride = part.vertex.stride ? part.vertex.stride / 4 : part.vertex.size;
        count = Math.floor(part.vertex.data.length / stride);
      }
      gl.bindVertexArray(null);
      const textures = await Promise.all(part.material.passes.map(p => {
        const u = p.units[0];
        return u?.texture ? this.texture(u) : Promise.resolve(null);
      }));
      const emissive = await Promise.all(part.material.passes.map(p => {
        const u = p.units[1];
        return p.emissive && u?.texture ? this.texture(u) : Promise.resolve(null);
      }));
      inst.parts.push({ part, vao, count, indexed, primitive: primitive(gl, part.mode), textures, emissive });
    }
    for (const a of model.attachments) {
      inst.children.push({ node: a.node, transform: toMatrix(a.transform), instance: await this.instantiate(a.model) });
    }
    return inst;
  }

  private attrib(loc: number, a: ClientArray) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer(a.data, gl.ARRAY_BUFFER));
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, a.size, gl.FLOAT, false, a.stride, a.offset);
  }

  private buffer(data: Float32Array | Int16Array, target: number): WebGLBuffer {
    let b = this.buffers.get(data);
    if (!b) {
      const gl = this.gl;
      b = gl.createBuffer()!;
      gl.bindBuffer(target, b);
      // index data is a Java ShortBuffer drawn as GL_UNSIGNED_SHORT
      const view = data instanceof Int16Array ? new Uint16Array(data.buffer, data.byteOffset, data.length) : data;
      gl.bufferData(target, view, gl.STATIC_DRAW);
      this.buffers.set(data, b);
    }
    return b;
  }

  /** Colour definitions used to recolor textures; set once loaded. */
  colors: Promise<ColorPository | null> = Promise.resolve(null);

  private texture(unit: TextureUnitState): Promise<WebGLTexture | null> {
    const path = unit.texture!;
    const sm = unit.sampler;
    const key = (unit.premultiply ? "p:" : "s:") + `${sm.wrapS},${sm.wrapT},${sm.minFilter},${sm.magFilter}:` + (unit.colorizations.length
      ? path + "|" + JSON.stringify(unit.colorizations, (k, v) => (k === "$outer" ? undefined : v)) : path);
    let p = this.textures.get(key);
    if (!p) {
      p = (async () => {
        try {
          // Clyde premultiplies alpha on load by default, and its blend states assume it
          // Clyde's Texture.setImage flips images vertically (GL's origin is the bottom row);
          // WebGL ignores UNPACK_FLIP_Y for ImageBitmaps, so flip while decoding
          const bmp = await createImageBitmap(await this.vfs.blob(path), { premultiplyAlpha: "none", imageOrientation: "flipY" });
          const gl = this.gl;
          const t = gl.createTexture()!;
          gl.bindTexture(gl.TEXTURE_2D, t);
          const pos = unit.colorizations.length ? await this.colors : null;
          if (pos) {
            // ImageUtil.recolorImage: shift colours near each class's source colour
            const canvas = new OffscreenCanvas(bmp.width, bmp.height);
            const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
            ctx.drawImage(bmp, 0, 0);
            const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
            recolorPixels(img.data, unit.colorizations.map(c => pos.resolve(c)));
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, unit.premultiply);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          } else {
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, unit.premultiply);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
          }
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          // sampler state from the TextureConfig (CLAMP becomes CLAMP_TO_EDGE in WebGL)
          const g = gl as unknown as Record<string, number>;
          const wrap = (w: string) => (w === "REPEAT" ? gl.REPEAT : w === "MIRRORED_REPEAT" ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE);
          if (sm.minFilter.includes("MIPMAP")) gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, g[sm.minFilter] ?? gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, g[sm.magFilter] ?? gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap(sm.wrapS));
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap(sm.wrapT));
          bmp.close();
          this.loadedTextures.set(key, t);
          return t;
        } catch {
          this.loadedTextures.set(key, null);
          return null;
        }
      })();
      this.textures.set(key, p);
    }
    return p;
  }

  get missingTextures(): string[] {
    return [...this.loadedTextures].filter(([, t]) => t === null).map(([p]) => p);
  }

  private frame = 0;

  /** Draws one model at the origin. */
  draw(root: ModelInstance, proj: Mat4, view: Mat4) {
    this.drawAll([{ instance: root, matrix: identity() }], proj, view);
  }

  /** Seconds since the renderer started; drives texture animation. */
  time = 0;
  private env: Environment = VIEWER_ENVIRONMENT;
  private sceneAmbient: Rgb = VIEWER_ENVIRONMENT.ambient;

  /**
   * Draws many placed model instances (instances may be shared between placements), under a
   * scene environment, with optional skyboxes drawn around the camera first.
   */
  drawAll(items: { instance: ModelInstance; matrix: Mat4 }[], proj: Mat4, view: Mat4,
    env: Environment = VIEWER_ENVIRONMENT, skyboxes: ModelInstance[] = [],
    target?: { width: number; height: number; clear: [number, number, number, number] }) {
    const gl = this.gl;
    const w = target?.width ?? this.canvas.width, h = target?.height ?? this.canvas.height;
    gl.viewport(0, 0, w, h);
    const bg = env.background ?? [0.16, 0.18, 0.22];
    if (target) gl.clearColor(...target.clear);
    else gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.u.u_proj, false, proj);
    gl.uniform1i(this.u.u_tex, 0);
    gl.uniform1i(this.u.u_bones, 1);
    this.stats = { draws: 0, triangles: 0 };
    this.env = env;
    this.sceneAmbient = env.ambient;
    this.setLights(env, view);
    this.view = view;
    if (skyboxes.length) {
      // skyboxes follow the camera: drop the view translation, never write depth
      const sky = view.slice();
      sky[12] = sky[13] = sky[14] = 0;
      gl.uniformMatrix4fv(this.u.u_view, false, sky);
      this.setFog(null);
      this.skyboxPass = true;
      this.drawItems(skyboxes.map(instance => ({ instance, matrix: identity() })));
      this.skyboxPass = false;
      gl.clear(gl.DEPTH_BUFFER_BIT);
    }
    gl.uniformMatrix4fv(this.u.u_view, false, view);
    this.setFog(env.fog);
    this.drawItems(items);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  private offscreen: { fb: WebGLFramebuffer; color: WebGLRenderbuffer; depth: WebGLRenderbuffer; w: number; h: number } | null = null;

  /**
   * Draws items into an offscreen buffer with a transparent background and returns the
   * pixels top row first, with alpha not premultiplied (as ImageData expects). Used for
   * interface views such as the HUD portrait.
   */
  renderToPixels(items: { instance: ModelInstance; matrix: Mat4 }[], proj: Mat4, view: Mat4, width: number, height: number,
    env: Environment = VIEWER_ENVIRONMENT): ImageData {
    this.drawingOffscreen = true;
    try { return this.renderToPixelsInner(items, proj, view, width, height, env); } finally { this.drawingOffscreen = false; }
  }

  private renderToPixelsInner(items: { instance: ModelInstance; matrix: Mat4 }[], proj: Mat4, view: Mat4, width: number, height: number,
    env: Environment): ImageData {
    const gl = this.gl;
    let o = this.offscreen;
    if (!o || o.w !== width || o.h !== height) {
      if (o) { gl.deleteFramebuffer(o.fb); gl.deleteRenderbuffer(o.color); gl.deleteRenderbuffer(o.depth); }
      const fb = gl.createFramebuffer()!, color = gl.createRenderbuffer()!, depth = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, color);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, width, height);
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      o = this.offscreen = { fb, color, depth, w: width, h: height };
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, o.fb);
    const stats = this.stats;
    this.drawAll(items, proj, view, env, [], { width, height, clear: [0, 0, 0, 0] });
    this.stats = stats;
    const px = new Uint8ClampedArray(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // flip rows (GL's first row is the bottom) and undo premultiplied alpha
    const out = new ImageData(width, height);
    const row = width * 4;
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * row, dst = y * row;
      for (let i = 0; i < row; i += 4) {
        // additive effects (glows, flames) add colour without alpha; count their brightness
        // as coverage so they survive compositing over the HUD
        const glow = Math.max(px[src + i], px[src + i + 1], px[src + i + 2]);
        const a = Math.max(px[src + i + 3], glow > 40 ? Math.min(255, (glow - 40) * 1.2) : 0);
        const k = a > 0 ? 255 / a : 0;
        out.data[dst + i] = px[src + i] * k;
        out.data[dst + i + 1] = px[src + i + 1] * k;
        out.data[dst + i + 2] = px[src + i + 2] * k;
        out.data[dst + i + 3] = a;
      }
    }
    return out;
  }

  private shadowProgram: WebGLProgram | null = null;
  private shadowVao: WebGLVertexArrayObject | null = null;

  /**
   * Soft round shadows under actors: a ground-aligned quad per actor with a radial falloff,
   * blended over the scene without writing depth. Call after drawAll with the same matrices.
   */
  drawShadows(list: { x: number; y: number; z: number; r: number }[], proj: Mat4, view: Mat4, color: [number, number, number, number]) {
    if (!list.length || color[3] <= 0) return;
    const gl = this.gl;
    if (!this.shadowProgram) {
      this.shadowProgram = link(gl, `#version 300 es
        in vec2 a_pos;
        uniform mat4 u_pv;
        uniform vec4 u_shadow; // x, y, z, radius
        out vec2 v_uv;
        void main() {
          v_uv = a_pos;
          // a little above the ground height: grass and floor tiles have some thickness
          gl_Position = u_pv * vec4(u_shadow.xy + a_pos * u_shadow.w, u_shadow.z + 0.16, 1.0);
        }`, `#version 300 es
        precision mediump float;
        in vec2 v_uv;
        uniform vec4 u_color;
        out vec4 o;
        void main() {
          float d = length(v_uv);
          float a = min(1.0, u_color.a * 1.5) * (1.0 - smoothstep(0.3, 1.0, d));
          o = vec4(u_color.rgb * a, a);
        }`);
      this.shadowVao = gl.createVertexArray();
      gl.bindVertexArray(this.shadowVao);
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(this.shadowProgram, "a_pos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
    const p = this.shadowProgram;
    gl.useProgram(p);
    gl.bindVertexArray(this.shadowVao);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix4fv(gl.getUniformLocation(p, "u_pv"), false, multiply(proj, view));
    gl.uniform4fv(gl.getUniformLocation(p, "u_color"), color);
    const u = gl.getUniformLocation(p, "u_shadow");
    for (const sh of list) {
      gl.uniform4f(u, sh.x, sh.y, sh.z, sh.r);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  private decalProgram: WebGLProgram | null = null;
  private decalTextures = new Map<string, Promise<WebGLTexture | null>>();
  private decalReady = new Map<string, WebGLTexture | null>();

  private decalTexture(file: string): WebGLTexture | null {
    if (!this.decalTextures.has(file)) {
      this.decalTextures.set(file, (async () => {
        try {
          const bmp = await createImageBitmap(await this.vfs.blob(file), { premultiplyAlpha: "none", imageOrientation: "flipY" });
          const gl = this.gl, t = gl.createTexture()!;
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          return t;
        } catch { return null; }
      })().then(t => { this.decalReady.set(file, t); return t; }));
    }
    return this.decalReady.get(file) ?? null;
  }

  /**
   * Projected shadow decals (SceneInfluencer projectors): horizontal textured quads on the
   * ground, placed by `matrix` (its rotation and position), drawn over the scene.
   */
  drawDecals(list: { matrix: Mat4; width: number; height: number; texture: string; glow: boolean }[], proj: Mat4, view: Mat4,
    color: [number, number, number, number]) {
    if (!list.length) return;
    const gl = this.gl;
    if (!this.decalProgram) {
      this.decalProgram = link(gl, `#version 300 es
        in vec2 a_pos;
        uniform mat4 u_pv, u_model;
        uniform vec2 u_size;
        out vec2 v_uv;
        void main() {
          v_uv = a_pos * 0.5 + 0.5;
          gl_Position = u_pv * u_model * vec4(a_pos * u_size * 0.5, 0.12, 1.0);
        }`, `#version 300 es
        precision mediump float;
        in vec2 v_uv;
        uniform sampler2D u_tex;
        uniform vec4 u_color;
        uniform bool u_shadow;
        out vec4 o;
        void main() {
          vec4 t = texture(u_tex, v_uv);
          // shadow decals darken in the shadow colour; others (floor logos) show their texture
          float a = u_shadow ? u_color.a * t.a : t.a;
          o = u_shadow ? vec4(u_color.rgb * a, a) : vec4(t.rgb * a, a);
        }`);
    }
    if (!this.shadowVao) this.drawShadows([{ x: 0, y: 0, z: -1e6, r: 0 }], proj, view, [0, 0, 0, 0.001]);
    const p = this.decalProgram;
    gl.useProgram(p);
    gl.bindVertexArray(this.shadowVao);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix4fv(gl.getUniformLocation(p, "u_pv"), false, multiply(proj, view));
    gl.uniform4fv(gl.getUniformLocation(p, "u_color"), color);
    gl.uniform1i(gl.getUniformLocation(p, "u_tex"), 0);
    gl.activeTexture(gl.TEXTURE0);
    const uModel = gl.getUniformLocation(p, "u_model"), uSize = gl.getUniformLocation(p, "u_size");
    const uShadow = gl.getUniformLocation(p, "u_shadow");
    for (const d of list) {
      if (d.glow) continue;
      gl.uniform1i(uShadow, d.texture.includes("/shadow/") ? 1 : 0);
      const t = this.decalTexture(d.texture);
      if (!t) continue;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniformMatrix4fv(uModel, false, d.matrix);
      gl.uniform2f(uSize, d.width, d.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  private skyboxPass = false;
  private fogOn = false;

  private setLights(env: Environment, view: Mat4) {
    const gl = this.gl;
    const n = Math.min(4, env.lights.length);
    const dirs = new Float32Array(12), colors = new Float32Array(12);
    for (let i = 0; i < n; i++) {
      let [x, y, z] = env.lights[i].dir;
      if (!env.eyeSpace) {
        // rotate the world-space direction into eye space
        [x, y, z] = [view[0] * x + view[4] * y + view[8] * z, view[1] * x + view[5] * y + view[9] * z,
          view[2] * x + view[6] * y + view[10] * z];
      }
      const len = Math.hypot(x, y, z) || 1;
      dirs.set([x / len, y / len, z / len], i * 3);
      colors.set(env.lights[i].color, i * 3);
    }
    gl.uniform1i(this.u.u_numLights, n);
    gl.uniform3fv(this.u.u_lightDirs, dirs);
    gl.uniform3fv(this.u.u_lightColors, colors);
  }

  private setFog(fog: Environment["fog"]) {
    const gl = this.gl;
    this.fogOn = !!fog;
    gl.uniform1i(this.u.u_fogMode, !fog ? 0 : fog.mode === "linear" ? 1 : fog.mode === "exp" ? 2 : 3);
    if (fog) {
      gl.uniform3f(this.u.u_fogColor, fog.color[0], fog.color[1], fog.color[2]);
      gl.uniform1f(this.u.u_fogStart, fog.start);
      gl.uniform1f(this.u.u_fogEnd, fog.end);
      gl.uniform1f(this.u.u_fogDensity, fog.density);
    }
  }

  private drawItems(items: { instance: ModelInstance; matrix: Mat4 }[]) {
    const gl = this.gl;
    const frame = ++this.frame;

    // Group placements by mesh part so each part and pass is one instanced draw. A part
    // belongs to one (possibly shared) ModelInstance, so all of its placements share a pose.
    const groups = new Map<GpuPart, { inst: ModelInstance; matrices: Mat4[] }>();
    const dt = Math.min(0.1, Math.max(0, this.time - this.lastTime));
    const visits = new Map<ModelInstance, number>();
    const particles: { emitter: Emitter; matrix: Mat4 }[] = [];
    // skel: the nearest articulated ancestor, whose skeleton drives skinned meshes in wrapper
    // models below it (armour inside compound/conditional wrappers on a knight)
    const collect = (inst: ModelInstance, placement: Mat4, skel: { inst: ModelInstance; placement: Mat4 } | null = null) => {
      inst.update(frame);
      if (inst.model.root) skel = { inst, placement };
      else if (skel && inst.model.parts.some(p => p.bones)) {
        inst.boneParent = skel.inst;
        inst.bonePlacement = skel.placement;
      }
      if (inst.model.particles?.length && (this.particlesOn || this.drawingOffscreen)) {
        const n = visits.get(inst) ?? 0;
        visits.set(inst, n + 1);
        let list = this.emitters.get(inst);
        if (!list) this.emitters.set(inst, list = []);
        const emitter = list[n] ??= new Emitter(inst.model.particles);
        // each emitter keeps its own clock, so views drawn offscreen in the same frame (HUD
        // portraits, the heat flame) still advance
        const last = (emitter as any).lastTime as number | undefined;
        (emitter as any).lastTime = this.time;
        emitter.update(last === undefined ? dt : Math.min(0.1, Math.max(0, this.time - last)), placement);
        particles.push({ emitter, matrix: placement });
        // model-emitting layers place their model at each particle
        emitter.states.forEach((state, li) => {
          const model = state.layer.model;
          if (!model || state.layer.geometry === "Meshes") return;
          const meshInst = this.meshInstance(model);
          if (meshInst) for (const m of emitter.meshMatrices(li, placement)) collect(meshInst, m);
        });
      }
      for (const gp of inst.parts) {
        let m = gp.part.node ? multiply(placement, inst.nodeMatrix(gp.part.node)) : placement;
        // skinned meshes borrowing a parent's skeleton are positioned by the parent's bones
        if (gp.part.bones && !inst.model.root && inst.boneParent && inst.bonePlacement) m = inst.bonePlacement;
        const bb = gp.part.node ? inst.model.billboards.get(gp.part.node) : undefined;
        if (bb) m = this.faceCamera(m, bb);
        let g = groups.get(gp);
        if (!g) groups.set(gp, g = { inst, matrices: [] });
        g.matrices.push(m);
      }
      for (const c of inst.children) {
        let at = c.node && inst.world.has(c.node) ? multiply(placement, inst.nodeMatrix(c.node)) : placement;
        const bb = c.node ? inst.model.billboards.get(c.node) : undefined;
        if (bb) at = this.faceCamera(at, bb);
        collect(c.instance, multiply(at, c.transform), skel);
      }
    };
    for (const it of items) collect(it.instance, it.matrix);

    // upload every instance matrix for this frame in one buffer
    let total = 0;
    for (const g of groups.values()) total += g.matrices.length;
    if (this.instanceData.length < total * 16) this.instanceData = new Float32Array(total * 16 * 2);
    const order = [...groups].sort((a, b) =>
      (QUEUE_ORDER[a[0].part.material.queue] ?? 2) - (QUEUE_ORDER[b[0].part.material.queue] ?? 2));
    const offsets = new Map<GpuPart, number>();
    let at = 0;
    for (const [gp, g] of order) {
      offsets.set(gp, at);
      for (const m of g.matrices) { this.instanceData.set(m, at * 16); at++; }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.subarray(0, total * 16), gl.DYNAMIC_DRAW);

    for (const [gp, g] of order) this.drawPart(g.inst, gp, offsets.get(gp)!, g.matrices.length);
    if (!this.skyboxPass) this.lastTime = this.time;
    if (particles.length) this.drawParticles(particles);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /**
   * Replaces a world matrix's rotation so it faces the camera, keeping position and scale.
   * Billboard: x right, y up, z toward the viewer. Upright: z stays up, turning about it.
   */
  private faceCamera(m: Mat4, kind: "Billboard" | "Upright"): Mat4 {
    const v = this.view, s = Math.hypot(m[0], m[1], m[2]);
    const out = m.slice();
    let rx = v[0], ry = v[4], rz = v[8];
    let ux = v[1], uy = v[5], uz = v[9];
    let bx = v[2], by = v[6], bz = v[10];
    if (kind === "Upright") {
      const l = Math.hypot(rx, ry) || 1;
      rx /= l; ry /= l; rz = 0;
      ux = 0; uy = 0; uz = 1;
      bx = ry; by = -rx; bz = 0;
      // x right, z up, y away from the viewer
      out.set([rx * s, ry * s, 0, 0, -bx * s, -by * s, 0, 0, 0, 0, s, 0], 0);
      return out;
    }
    out.set([rx * s, ry * s, rz * s, 0, ux * s, uy * s, uz * s, 0, bx * s, by * s, bz * s, 0], 0);
    return out;
  }

  private readonly meshInstances = new Map<LoadedModel, ModelInstance | null>();

  /** Instance for a particle-emitted model; null until its textures have loaded. */
  private meshInstance(model: LoadedModel): ModelInstance | null {
    if (!this.meshInstances.has(model)) {
      this.meshInstances.set(model, null);
      this.instantiate(model).then(i => this.meshInstances.set(model, i)).catch(() => {});
    }
    return this.meshInstances.get(model) ?? null;
  }

  private readonly particleTextures = new Map<string, Promise<WebGLTexture | null>>();
  private readonly readyParticleTextures = new Map<string, WebGLTexture | null>();

  private drawParticles(list: { emitter: Emitter; matrix: Mat4 }[]) {
    const gl = this.gl, v = this.view;
    const right: [number, number, number] = [v[0], v[4], v[8]], up: [number, number, number] = [v[1], v[5], v[9]];
    gl.bindVertexArray(this.particleVao);
    gl.disableVertexAttribArray(1);
    gl.vertexAttrib3f(1, 0, 0, 1);
    for (let k = 0; k < 4; k++) {
      gl.disableVertexAttribArray(6 + k);
      gl.vertexAttrib4f(6 + k, k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0, k === 3 ? 1 : 0);
    }
    gl.uniform1i(this.u.u_skinned, 0);
    gl.uniform1i(this.u.u_particle, 1);
    const data: number[] = [];
    for (const { emitter, matrix } of list) {
      emitter.states.forEach((state, li) => {
        if (state.particles.length === 0) return;
        if (state.layer.geometry === "Meshes") {
          this.drawMeshParticles(emitter, li, matrix);
          gl.bindVertexArray(this.particleVao);
          return;
        }
        data.length = 0;
        emitter.emit(li, matrix, right, up, data);
        if (data.length === 0) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STREAM_DRAW);
        for (const pass of state.layer.material.passes) {
          const unit = pass.units[0];
          let tex: WebGLTexture | null = null;
          if (unit?.texture) {
            const key = unit.texture;
            if (this.readyParticleTextures.has(key)) tex = this.readyParticleTextures.get(key)!;
            else if (!this.particleTextures.has(key)) {
              this.particleTextures.set(key, this.texture(unit).then(t => { this.readyParticleTextures.set(key, t); return t; }));
            }
            // never draw a textured particle as a bare quad while its texture is loading
            if (!tex) continue;
          }
          // particle colours are premultiplied, so blend accordingly and never write depth
          this.applyPass({ ...pass, srcBlend: "ONE", destBlend: "ONE_MINUS_SRC_ALPHA", depthMask: false, cullFace: "DISABLED", lit: false },
            tex, false, true);
          gl.drawArrays(gl.TRIANGLES, 0, data.length / 9);
          this.stats.draws++;
        }
      });
    }
    gl.uniform1i(this.u.u_particle, 0);
    gl.bindVertexArray(null);
  }

  /**
   * Meshes geometry: each particle draws the layer's mesh with the layer's material and the
   * particle's colour, rather than the mesh's own material.
   */
  private drawMeshParticles(emitter: Emitter, li: number, matrix: Mat4) {
    const gl = this.gl, layer = emitter.states[li].layer;
    const inst = layer.model ? this.meshInstance(layer.model) : null;
    if (!inst) return;
    const passes = layer.material.passes;
    const textures = passes.map(p => {
      const unit = p.units[0];
      if (!unit?.texture) return null;
      const key = unit.texture;
      if (!this.particleTextures.has(key)) {
        this.particleTextures.set(key, this.texture(unit).then(t => { this.readyParticleTextures.set(key, t); return t; }));
      }
      return this.readyParticleTextures.get(key) ?? undefined;
    });
    if (textures.some(t => t === undefined)) return; // still loading
    for (const { matrix: m, color } of emitter.meshParticles(li, matrix)) {
      for (const gp of inst.parts) {
        gl.bindVertexArray(gp.vao);
        for (let k = 0; k < 4; k++) {
          gl.disableVertexAttribArray(6 + k);
          gl.vertexAttrib4f(6 + k, m[k * 4], m[k * 4 + 1], m[k * 4 + 2], m[k * 4 + 3]);
        }
        passes.forEach((pass, i) => {
          this.applyPass({ ...pass, color, srcBlend: "ONE", destBlend: "ONE_MINUS_SRC_ALPHA", depthMask: false, lit: false },
            textures[i] ?? null, false, false);
          if (gp.indexed) gl.drawElements(gp.primitive, gp.count, gl.UNSIGNED_SHORT, 0);
          else gl.drawArrays(gp.primitive, 0, gp.count);
          this.stats.draws++;
        });
      }
    }
  }

  private drawPart(inst: ModelInstance, gp: GpuPart, first: number, instances: number) {
    const gl = this.gl;
    const skinned = !!(gp.part.bones && gp.part.boneIndices && gp.part.boneWeights);
    gl.uniform1i(this.u.u_skinned, skinned ? 1 : 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.boneTex);
    if (skinned) {
      const bones = inst.boneMatrices(gp.part.bones!);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, bones.length / 4, 1, 0, gl.RGBA, gl.FLOAT, bones);
    }
    gl.bindVertexArray(gp.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    for (let k = 0; k < 4; k++) {
      gl.enableVertexAttribArray(6 + k);
      gl.vertexAttribPointer(6 + k, 4, gl.FLOAT, false, 64, first * 64 + k * 16);
      gl.vertexAttribDivisor(6 + k, 1);
    }
    gp.part.material.passes.forEach((pass, i) => {
      this.applyPass(pass, gp.textures[i], !!gp.part.normal, !!gp.part.color, gp.emissive[i]);
      if (gp.indexed) gl.drawElementsInstanced(gp.primitive, gp.count, gl.UNSIGNED_SHORT, 0, instances);
      else gl.drawArraysInstanced(gp.primitive, 0, gp.count, instances);
      this.stats.draws++;
      if (gp.primitive === gl.TRIANGLES) this.stats.triangles += (gp.count / 3) * instances;
    });
    gl.bindVertexArray(null);
  }

  private applyPass(pass: PassState, texture: WebGLTexture | null, hasNormals: boolean, hasColors: boolean,
    emissive: WebGLTexture | null = null) {
    const gl = this.gl, g = gl as unknown as Record<string, number>;
    gl.uniform1i(this.u.u_emissive, emissive ? 1 : 0);
    if (emissive) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, emissive);
      gl.uniform1i(this.u.u_emissiveTex, 2);
    }
    const w = pass.wave;
    gl.uniform1i(this.u.u_wave, w ? 1 : 0);
    if (w) {
      gl.uniform1f(this.u.u_time, this.time);
      gl.uniform1f(this.u.u_choppiness, w.choppiness);
      gl.uniform2fv(this.u.u_waveVectors, w.vectors);
      gl.uniform1fv(this.u.u_waveFreq, w.frequencies);
      gl.uniform1fv(this.u.u_waveAmp, w.amplitudes);
      gl.uniform1fv(this.u.u_wavePhase, w.phases);
    }
    const unit = pass.units[0];
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture ?? this.white);
    gl.uniform1i(this.u.u_hasTex, texture ? 1 : 0);
    gl.uniform1i(this.u.u_sphereMap, unit?.sphereMap ? 1 : 0);
    gl.uniform1i(this.u.u_env, Math.max(0, ENVS.indexOf(unit?.env ?? "Modulate")));
    gl.uniform1f(this.u.u_rgbScale, unit?.rgbScale ?? 1);
    // OpenGL lights normal-less meshes too, using the default normal (0, 0, 1)
    void hasNormals;
    gl.uniform1i(this.u.u_lit, pass.lit ? 1 : 0);
    // a light-state override replaces the scene lights: its ambient term plus its own lights
    const amb = pass.ambient ?? this.sceneAmbient;
    gl.uniform3f(this.u.u_ambient, amb[0], amb[1], amb[2]);
    gl.uniform1i(this.u.u_numLights, pass.ambient && pass.overrideLights === 0 ? 0 : Math.min(4, this.env.lights.length));
    if (this.fogOn) gl.uniform1i(this.u.u_fogMode, pass.fog ? FOG_MODES[this.env.fog!.mode] : 0);
    gl.uniformMatrix4fv(this.u.u_texMatrix, false, unit?.transform ? unit.transform(this.time) : IDENTITY);
    const c = pass.color ?? [1, 1, 1, 1];
    gl.uniform4f(this.u.u_color, c[0], c[1], c[2], c[3]);
    gl.uniform1i(this.u.u_useVertexColor, hasColors && !pass.ignoreVertexColors ? 1 : 0);
    gl.uniform1i(this.u.u_alphaFunc, Math.max(0, ALPHA_FUNCS.indexOf(pass.alphaFunc)));
    gl.uniform1f(this.u.u_alphaRef, pass.alphaRef);
    if (pass.srcBlend === "ONE" && pass.destBlend === "ZERO") {
      gl.disable(gl.BLEND);
    } else {
      gl.enable(gl.BLEND);
      gl.blendFunc(g[pass.srcBlend] ?? gl.ONE, g[pass.destBlend] ?? gl.ZERO);
    }
    gl.depthFunc(g[pass.depthFunc] ?? gl.LEQUAL);
    gl.depthMask(pass.depthMask && !this.skyboxPass);
    if (pass.cullFace === "DISABLED") {
      gl.disable(gl.CULL_FACE);
    } else {
      gl.enable(gl.CULL_FACE);
      gl.cullFace(g[pass.cullFace] ?? gl.BACK);
    }
  }
}

function primitive(gl: WebGL2RenderingContext, mode: string): number {
  switch (mode) {
    case "POINTS": return gl.POINTS;
    case "LINES": return gl.LINES;
    case "LINE_STRIP": return gl.LINE_STRIP;
    case "TRIANGLE_STRIP": return gl.TRIANGLE_STRIP;
    case "TRIANGLE_FAN": return gl.TRIANGLE_FAN;
    default: return gl.TRIANGLES; // QUADS and polygons were converted to triangles on import
  }
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader error");
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link error");
  return p;
}
