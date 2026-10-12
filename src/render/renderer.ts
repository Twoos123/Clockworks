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

import { identity, invert, multiply, slerp, lerp3, toMatrix, compose, type Mat4, type Transform } from "../math";
import type { PassState } from "../config/materials";
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
uniform mat4 u_proj, u_view, u_model;
uniform bool u_skinned, u_sphereMap;
uniform highp sampler2D u_bones;
out vec3 v_normal;
out vec2 v_uv;
out vec4 v_color;
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
  mat4 mv = u_view * u_model;
  v_normal = mat3(mv) * nrm;
  v_uv = a_uv;
  if (u_sphereMap) {
    // GL_SPHERE_MAP texture coordinate generation, as in the fixed-function pipeline
    vec3 u = normalize((mv * pos).xyz);
    vec3 r = reflect(u, normalize(v_normal));
    float m = 2.0 * sqrt(r.x * r.x + r.y * r.y + (r.z + 1.0) * (r.z + 1.0));
    v_uv = vec2(r.x / m + 0.5, r.y / m + 0.5);
  }
  v_color = a_color;
  gl_Position = u_proj * mv * pos;
}`;

const FS = `#version 300 es
precision mediump float;
in vec3 v_normal;
in vec2 v_uv;
in vec4 v_color;
uniform sampler2D u_tex;
uniform bool u_hasTex, u_lit, u_useVertexColor;
uniform int u_alphaFunc, u_env;
uniform float u_alphaRef, u_rgbScale;
uniform vec4 u_color;
uniform vec3 u_lightDir, u_ambient;
uniform float u_diffuse;
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
    float ndl = max(dot(normalize(v_normal), u_lightDir), 0.0);
    c.rgb *= u_ambient + vec3(u_diffuse) * ndl;
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
  fragColor = c;
}`;

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
  time = 0;

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

  /** Recomputes node transforms for the current animation time. */
  update() {
    if (!this.model.root) return;
    const overrides = this.sample();
    const walk = (n: NodeDef, parent: Mat4) => {
      const local = overrides.get(n.name) ?? toMatrix(this.bindLocal.get(n.name)!);
      const w = multiply(parent, local);
      this.world.set(n.name, w);
      n.children.forEach(c => walk(c, w));
    };
    walk(this.model.root, identity());
  }

  private sample(): Map<string, Mat4> {
    const out = new Map<string, Mat4>();
    const clip = this.clip;
    if (!clip || clip.frames.length === 0) return out;
    const n = clip.frames.length;
    let f = this.time * clip.rate;
    f = clip.loop ? ((f % n) + n) % n : Math.min(f, n - 1);
    const i0 = Math.floor(f), i1 = clip.loop ? (i0 + 1) % n : Math.min(i0 + 1, n - 1), t = f - i0;
    clip.targets.forEach((name, ti) => {
      const a = clip.frames[i0][ti], b = clip.frames[i1][ti];
      if (!a) return;
      if (a.matrix || !b || b.matrix) { out.set(name, toMatrix(a)); return; }
      out.set(name, compose(lerp3(a.t, b.t, t), slerp(a.r, b.r, t), a.s + (b.s - a.s) * t));
    });
    return out;
  }

  /** Bone matrices (bone node world * inverse reference) for a skinned part. */
  boneMatrices(bones: string[]): Float32Array {
    const out = new Float32Array(bones.length * 16);
    bones.forEach((b, i) => {
      const w = this.world.get(b), r = this.invRef.get(b);
      out.set(w && r ? multiply(w, r) : identity(), i * 16);
    });
    return out;
  }

  nodeMatrix(node: string): Mat4 {
    return this.world.get(node) ?? identity();
  }
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly u: Record<string, WebGLUniformLocation | null> = {};
  private readonly buffers = new WeakMap<Float32Array | Int16Array, WebGLBuffer>();
  private readonly textures = new Map<string, Promise<WebGLTexture | null>>();
  private readonly loadedTextures = new Map<string, WebGLTexture | null>();
  private readonly boneTex: WebGLTexture;
  private readonly white: WebGLTexture;
  stats = { draws: 0, triangles: 0 };

  constructor(readonly canvas: HTMLCanvasElement, private readonly vfs: Vfs) {
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
    if (!gl) throw new Error("WebGL 2 is not available in this browser.");
    this.gl = gl;
    this.program = link(gl, VS, FS);
    for (const name of ["u_proj", "u_view", "u_model", "u_skinned", "u_bones", "u_tex", "u_hasTex",
      "u_lit", "u_alphaRef", "u_lightDir", "u_sphereMap", "u_useVertexColor", "u_alphaFunc", "u_env",
      "u_rgbScale", "u_color", "u_ambient", "u_diffuse"]) {
      this.u[name] = gl.getUniformLocation(this.program, name);
    }
    this.boneTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.boneTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
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
        const t = p.units[0]?.texture;
        return t ? this.texture(t) : Promise.resolve(null);
      }));
      inst.parts.push({ part, vao, count, indexed, primitive: primitive(gl, part.mode), textures });
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

  private texture(path: string): Promise<WebGLTexture | null> {
    let p = this.textures.get(path);
    if (!p) {
      p = (async () => {
        try {
          const bmp = await createImageBitmap(await this.vfs.blob(path), { premultiplyAlpha: "none" });
          const gl = this.gl;
          const t = gl.createTexture()!;
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
          bmp.close();
          this.loadedTextures.set(path, t);
          return t;
        } catch {
          this.loadedTextures.set(path, null);
          return null;
        }
      })();
      this.textures.set(path, p);
    }
    return p;
  }

  get missingTextures(): string[] {
    return [...this.loadedTextures].filter(([, t]) => t === null).map(([p]) => p);
  }

  draw(root: ModelInstance, proj: Mat4, view: Mat4) {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.16, 0.18, 0.22, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.u.u_proj, false, proj);
    gl.uniformMatrix4fv(this.u.u_view, false, view);
    // light from over the viewer's shoulder, in eye space
    const l = [0.35, 0.6, 0.72], len = Math.hypot(...l);
    gl.uniform3f(this.u.u_lightDir, l[0] / len, l[1] / len, l[2] / len);
    gl.uniform1i(this.u.u_tex, 0);
    gl.uniform1i(this.u.u_bones, 1);
    this.stats = { draws: 0, triangles: 0 };

    const queue: { inst: ModelInstance; gp: GpuPart; model: Mat4 }[] = [];
    const collect = (inst: ModelInstance, placement: Mat4) => {
      inst.update();
      for (const gp of inst.parts) {
        const m = gp.part.node ? multiply(placement, inst.nodeMatrix(gp.part.node)) : placement;
        queue.push({ inst, gp, model: m });
      }
      for (const c of inst.children) {
        const at = c.node && inst.world.has(c.node) ? multiply(placement, inst.nodeMatrix(c.node)) : placement;
        collect(c.instance, multiply(at, c.transform));
      }
    };
    collect(root, identity());

    const rank = (q: string) => QUEUE_ORDER[q] ?? 2;
    queue.sort((a, b) => rank(a.gp.part.material.queue) - rank(b.gp.part.material.queue));
    for (const { inst, gp, model } of queue) this.drawPart(inst, gp, model);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  private drawPart(inst: ModelInstance, gp: GpuPart, model: Mat4) {
    const gl = this.gl;
    gl.uniformMatrix4fv(this.u.u_model, false, model);
    const skinned = !!(gp.part.bones && gp.part.boneIndices && gp.part.boneWeights);
    gl.uniform1i(this.u.u_skinned, skinned ? 1 : 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.boneTex);
    if (skinned) {
      const bones = inst.boneMatrices(gp.part.bones!);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, bones.length / 4, 1, 0, gl.RGBA, gl.FLOAT, bones);
    }
    gl.bindVertexArray(gp.vao);
    gp.part.material.passes.forEach((pass, i) => {
      this.applyPass(pass, gp.textures[i], !!gp.part.normal, !!gp.part.color);
      if (gp.indexed) gl.drawElements(gp.primitive, gp.count, gl.UNSIGNED_SHORT, 0);
      else gl.drawArrays(gp.primitive, 0, gp.count);
      this.stats.draws++;
      if (gp.primitive === gl.TRIANGLES) this.stats.triangles += gp.count / 3;
    });
    gl.bindVertexArray(null);
  }

  private applyPass(pass: PassState, texture: WebGLTexture | null, hasNormals: boolean, hasColors: boolean) {
    const gl = this.gl, g = gl as unknown as Record<string, number>;
    const unit = pass.units[0];
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture ?? this.white);
    gl.uniform1i(this.u.u_hasTex, texture ? 1 : 0);
    gl.uniform1i(this.u.u_sphereMap, unit?.sphereMap ? 1 : 0);
    gl.uniform1i(this.u.u_env, Math.max(0, ENVS.indexOf(unit?.env ?? "Modulate")));
    gl.uniform1f(this.u.u_rgbScale, unit?.rgbScale ?? 1);
    gl.uniform1i(this.u.u_lit, pass.lit && hasNormals ? 1 : 0);
    // a light-state override replaces the scene lights: its ambient term plus its own lights
    const amb = pass.ambient ?? [0.4, 0.4, 0.4, 1];
    gl.uniform1f(this.u.u_diffuse, pass.ambient && pass.overrideLights === 0 ? 0 : 0.8);
    gl.uniform3f(this.u.u_ambient, amb[0], amb[1], amb[2]);
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
    gl.depthMask(pass.depthMask);
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
