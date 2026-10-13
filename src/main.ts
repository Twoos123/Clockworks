import { lookAt, perspective, type Vec3 } from "./math";
import { loadAnimation, ModelLoader, type LoadedModel } from "./model";
import { Renderer, type ModelInstance } from "./render/renderer";
import { SceneLoader, sceneName, type LoadedScene } from "./scene";
import { ColorPository } from "./colors";
import { loadEnvironment, VIEWER_ENVIRONMENT, type Environment } from "./environment";
import { identity, type Mat4 } from "./math";
import {
  canPickDirectory, DevServerVfs, FileListVfs, HandleVfs, recallHandle, rememberHandle, VfsError, type Vfs,
} from "./vfs";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- choosing the install

async function start() {
  if (!canPickDirectory()) {
    $("pick").hidden = true;
    $("fallback").hidden = false;
  }
  if (await DevServerVfs.available()) $("dev").hidden = false;
  const saved = await recallHandle();
  if (saved) {
    const btn = $("reopen");
    btn.textContent = `Reopen "${saved.name}"`;
    btn.hidden = false;
    btn.onclick = async () => {
      // permission must be re-granted from a user gesture each session
      const perm = await (saved as any).requestPermission?.({ mode: "read" });
      if (perm && perm !== "granted") return showWelcomeError("Permission to read the folder was not granted.");
      await open(() => new HandleVfs(saved).init());
    };
  }
  $("pick").onclick = async () => {
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await (window as any).showDirectoryPicker({ id: "install", mode: "read" });
    } catch { return; /* cancelled */ }
    await open(async () => {
      const vfs = await new HandleVfs(handle).init();
      await rememberHandle(handle);
      return vfs;
    });
  };
  $("dev").onclick = () => open(async () => new DevServerVfs());
  $<HTMLInputElement>("dirInput").onchange = (e) => {
    const files = (e.target as HTMLInputElement).files;
    if (!files?.length) return;
    open(async () => new FileListVfs(
      [...files].map(f => [f.webkitRelativePath || f.name, f] as [string, File]), files[0].webkitRelativePath.split("/")[0]));
  };
  setupDrop();
  $("change").onclick = () => location.reload();
  if (location.hash.includes("dev=1") && !$("dev").hidden) await open(async () => new DevServerVfs());
}

function showWelcomeError(msg: string) {
  const el = $("welcomeError");
  el.textContent = msg;
  el.hidden = false;
}

function setupDrop() {
  const w = $("welcome");
  w.addEventListener("dragover", e => { e.preventDefault(); w.classList.add("dragging"); });
  w.addEventListener("dragleave", () => w.classList.remove("dragging"));
  w.addEventListener("drop", async e => {
    e.preventDefault();
    w.classList.remove("dragging");
    const item = e.dataTransfer?.items?.[0];
    if (!item) return;
    const handle = await (item as any).getAsFileSystemHandle?.();
    if (handle?.kind === "directory") {
      await open(async () => { const v = await new HandleVfs(handle).init(); await rememberHandle(handle); return v; });
      return;
    }
    const entry = item.webkitGetAsEntry();
    if (!entry?.isDirectory) return showWelcomeError("Drop the install folder itself, not a file.");
    await open(async () => new FileListVfs(await readEntries(entry as FileSystemDirectoryEntry), entry.name));
  });
}

async function readEntries(root: FileSystemDirectoryEntry): Promise<[string, File][]> {
  const out: [string, File][] = [];
  const walk = async (dir: FileSystemDirectoryEntry, prefix: string): Promise<void> => {
    const reader = dir.createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (batch.length === 0) break;
      await Promise.all(batch.map(async en => {
        if (en.isDirectory) await walk(en as FileSystemDirectoryEntry, prefix + en.name + "/");
        else out.push([prefix + en.name, await new Promise<File>((res, rej) => (en as FileSystemFileEntry).file(res, rej))]);
      }));
    }
  };
  await walk(root, root.name + "/");
  return out;
}

async function open(make: () => Promise<Vfs>) {
  try {
    $("welcomeError").hidden = true;
    const vfs = await make();
    const files = await vfs.list();
    if (!files.some(f => f.endsWith(".dat"))) throw new VfsError("No .dat files were found in that folder.");
    $("welcome").hidden = true;
    $("app").hidden = false;
    new Viewer(vfs, files);
  } catch (e) {
    showWelcomeError((e as Error).message);
  }
}

// ---------------------------------------------------------------- viewer

const LIKELY_MODEL = /(^|\/)model[^/]*\.dat$/;
const NOT_ANIMATION = /(^|\/)(model|fx_|particle|ambient_|bullet_|bomb_|aoe_|meta_|compound_|conditional_|modelset)[^/]*\.dat$/;

class Viewer {
  private readonly loader: ModelLoader;
  private readonly renderer: Renderer;
  private readonly canvas = $<HTMLCanvasElement>("canvas");
  private instance: ModelInstance | null = null;
  private sceneItems: { instance: ModelInstance; matrix: Mat4 }[] | null = null;
  private environment: Environment = VIEWER_ENVIRONMENT;
  private skyboxes: ModelInstance[] = [];
  private readonly sceneLoader: SceneLoader;
  private readonly instances = new Map<LoadedModel, Promise<ModelInstance>>();
  private shares = new Map<ModelInstance, number>();
  private model: LoadedModel | null = null;
  private readonly datFiles: string[];
  private az = -0.6; private el = 0.35; private dist = 3;
  private target: Vec3 = [0, 0, 0.5];
  private home = { dist: 3, target: [0, 0, 0.5] as Vec3 };
  private paused = false;
  private last = performance.now();
  private loadToken = 0;

  constructor(private readonly vfs: Vfs, files: string[]) {
    this.loader = new ModelLoader(vfs);
    this.renderer = new Renderer(this.canvas, vfs);
    this.renderer.colors = vfs.colorDefs().then(b => (b ? ColorPository.fromSerialized(b) : null)).catch(() => null);
    this.sceneLoader = new SceneLoader(this.loader);
    this.listScenes(vfs);
    this.datFiles = files.filter(f => f.endsWith(".dat")).sort();
    $("sourceLabel").textContent = `${vfs.label} · ${files.length.toLocaleString()} files`;
    const search = $<HTMLInputElement>("search");
    search.oninput = () => this.renderList();
    $<HTMLInputElement>("onlyModels").onchange = () => this.renderList();
    $<HTMLSelectElement>("anim").onchange = e => this.setAnimation((e.target as HTMLSelectElement).value);
    $("pause").onclick = () => { this.paused = !this.paused; $("pause").textContent = this.paused ? "Play" : "Pause"; };
    $("reset").onclick = () => { this.dist = this.home.dist; this.target = [...this.home.target]; this.az = -0.6; this.el = 0.35; };
    this.setupCamera();
    const hash = new URLSearchParams(location.hash.substring(1));
    const fromHash = hash.get("model");
    search.value = fromHash ? fromHash.replace(/\.dat$/, "") : "jellycube/model";
    this.renderList();
    if (fromHash) this.select(fromHash);
    else if (hash.get("scene")) this.selectScene(hash.get("scene")!);
    requestAnimationFrame(this.frame);
    if (import.meta.env.DEV) (window as any).__viewer = this;
  }

  /** Development smoke test: loads every matching file and reports failures. */
  async smokeTest(filter: RegExp = LIKELY_MODEL, limit = Infinity) {
    const results = { ok: 0, failed: [] as string[], kinds: {} as Record<string, number>, skipped: {} as Record<string, number>,
      fallbackMaterials: {} as Record<string, number>, shaders: {} as Record<string, number>, materialUses: 0 };
    const tally = (m: LoadedModel) => {
      for (const p of m.parts) {
        results.materialUses++;
        if (!p.material.resolved) results.fallbackMaterials[p.material.name] = (results.fallbackMaterials[p.material.name] ?? 0) + 1;
        for (const pass of p.material.passes) for (const sh of pass.shaders) results.shaders[sh] = (results.shaders[sh] ?? 0) + 1;
      }
      m.attachments.forEach(a => tally(a.model));
    };
    for (const f of this.datFiles.filter(f => filter.test(f)).slice(0, limit)) {
      try {
        const m = await this.loader.load(f);
        const inst = await this.renderer.instantiate(m);
        inst.update();
        results.ok++;
        results.kinds[m.kind] = (results.kinds[m.kind] ?? 0) + 1;
        tally(m);
        for (const s of m.skipped) results.skipped[s] = (results.skipped[s] ?? 0) + 1;
      } catch (e) {
        results.failed.push(`${f}: ${(e as Error).message}`);
      }
    }
    return results;
  }

  private async listScenes(vfs: Vfs) {
    const ids = await vfs.scenes();
    if (ids.length === 0) return;
    const named = await Promise.all(ids.map(async id => {
      try { return { id, name: await sceneName(await vfs.readScene(id)) }; } catch { return null; }
    }));
    const ul = $("scenes");
    const found = named.filter((s): s is { id: string; name: string } => s !== null);
    ul.replaceChildren(...found.sort((a, b) => a.name.localeCompare(b.name)).map(s => {
      const li = document.createElement("li");
      li.textContent = s.name;
      li.dataset.scene = s.id;
      li.onclick = () => this.selectScene(s.id);
      return li;
    }));
    $("scenesBox").hidden = false;
  }

  private instanceOf(model: LoadedModel): Promise<ModelInstance> {
    let p = this.instances.get(model);
    if (!p) { p = this.renderer.instantiate(model); this.instances.set(model, p); }
    return p;
  }

  private async selectScene(id: string) {
    const token = ++this.loadToken;
    this.status("Loading scene " + id + "...");
    for (const li of $("scenes").children) li.classList.toggle("active", (li as HTMLElement).dataset.scene === id);
    for (const li of $("list").children) li.classList.remove("active");
    history.replaceState(null, "", "#scene=" + id);
    const t0 = performance.now();
    try {
      const scene = await this.sceneLoader.load(id, await this.vfs.readScene(id), (done, total) => {
        if (token === this.loadToken) this.status("Loading scene: " + done + " of " + total + " objects");
      });
      const items = await Promise.all(scene.objects.map(async o => ({ instance: await this.instanceOf(o.model), matrix: o.matrix })));
      const env = await loadEnvironment(this.loader, scene.globals);
      for (const m of env.models) items.push({ instance: await this.instanceOf(m), matrix: identity() });
      const skyboxes = await Promise.all(env.skyboxes.map(m => this.instanceOf(m)));
      if (token !== this.loadToken) return;
      this.environment = env;
      this.skyboxes = skyboxes;
      this.sceneItems = items;
      this.shares = new Map();
      for (const it of items) this.shares.set(it.instance, (this.shares.get(it.instance) ?? 0) + 1);
      this.instance = null;
      this.model = null;
      this.frameScene(scene, env);
      const anim = $<HTMLSelectElement>("anim");
      anim.replaceChildren(new Option("Scene animations", ""));
      anim.disabled = true;
      const ms = Math.round(performance.now() - t0);
      this.status(scene.name + " · " + scene.objects.length.toLocaleString() + " objects · loaded in " + ms + " ms");
      this.showSceneInfo(scene);
    } catch (e) {
      if (token !== this.loadToken) return;
      this.status("Could not load scene " + id + ": " + (e as Error).message, true);
    }
  }

  private frameScene(scene: LoadedScene, env: Environment) {
    const { min, max } = scene.bounds;
    const ok = isFinite(min[0]);
    const cx = ok ? (min[0] + max[0]) / 2 : 0, cy = ok ? (min[1] + max[1]) / 2 : 0;
    const extent = ok ? Math.max(max[0] - min[0], max[1] - min[1]) : 20;
    this.target = [cx, cy, 0];
    this.dist = Math.max(10, extent * 0.55);
    this.home = { dist: this.dist, target: [cx, cy, 0] };
    // the scene's own camera global gives the in-game viewing angle
    this.el = env.camera?.elevation ?? 0.95;
    this.az = -Math.PI / 2 + (env.camera?.azimuth ?? 0);
  }

  private showSceneInfo(scene: LoadedScene) {
    const rows: [string, string][] = [
      ["Scene", scene.name],
      ["Cache file", "scenes/" + scene.id],
      ["Tiles", scene.stats.tiles.toLocaleString()],
      ["Props", scene.stats.placeables.toLocaleString()],
      ["Distinct models", scene.stats.uniqueModels.toLocaleString()],
      ["Editor markers hidden", scene.stats.markers.toLocaleString()],
      ["Unresolved", scene.stats.unresolved.toLocaleString()],
    ];
    const table = document.createElement("table");
    for (const [k, v] of rows) { const tr = table.insertRow(); tr.insertCell().textContent = k; tr.insertCell().textContent = v; }
    $("info").replaceChildren(table);
  }

  private renderList() {
    const q = $<HTMLInputElement>("search").value.trim().toLowerCase();
    const only = $<HTMLInputElement>("onlyModels").checked;
    const terms = q.split(/\s+/).filter(Boolean);
    const matches = this.datFiles.filter(f => (!only || LIKELY_MODEL.test(f)) && terms.every(t => f.toLowerCase().includes(t)));
    const ul = $("list");
    ul.replaceChildren(...matches.slice(0, 400).map(f => {
      const li = document.createElement("li");
      li.textContent = f;
      li.title = f;
      if (f === this.model?.path) li.classList.add("active");
      li.onclick = () => this.select(f);
      return li;
    }));
    $("count").textContent = matches.length > 400 ? `Showing 400 of ${matches.length.toLocaleString()}` : `${matches.length.toLocaleString()} files`;
  }

  private async select(path: string) {
    const token = ++this.loadToken;
    this.status(`Loading ${path}…`);
    for (const li of $("list").children) li.classList.toggle("active", li.textContent === path);
    history.replaceState(null, "", "#model=" + path);
    const t0 = performance.now();
    try {
      const model = await this.loader.load(path);
      const inst = await this.renderer.instantiate(model);
      if (token !== this.loadToken) return;
      this.model = model;
      this.instance = inst;
      this.sceneItems = null;
      this.environment = VIEWER_ENVIRONMENT;
      this.skyboxes = [];
      for (const li of $("scenes").children) li.classList.remove("active");
      this.frameModel(model);
      await this.fillAnimations(model);
      const ms = Math.round(performance.now() - t0);
      this.status(`${path} · ${model.kind} · loaded in ${ms} ms`);
      this.showInfo(model);
    } catch (e) {
      if (token !== this.loadToken) return;
      this.status(`Could not load ${path}: ${(e as Error).message}`, true);
    }
  }

  private async fillAnimations(model: LoadedModel) {
    const sel = $<HTMLSelectElement>("anim");
    const dir = model.path.substring(0, model.path.lastIndexOf("/") + 1);
    const nearby = this.datFiles.filter(f => f.startsWith(dir) && f !== model.path && !NOT_ANIMATION.test(f)).slice(0, 300);
    const all = [...new Set([...model.autoAnimations, ...nearby])];
    sel.replaceChildren(new Option("Bind pose", ""), ...all.map(a => new Option(a.substring(a.startsWith(dir) ? dir.length : 0), a)));
    sel.disabled = !model.root;
    const first = model.autoAnimations[0] ?? all.find(a => /(^|\/)(idle|standing|walking|stand)/.test(a.substring(dir.length)));
    if (first && model.root) {
      sel.value = first;
      await this.setAnimation(first);
    }
  }

  private async setAnimation(path: string) {
    if (!this.instance) return;
    if (!path) { this.instance.clip = null; return; }
    try {
      const clip = await loadAnimation(this.loader, path);
      if (!clip) { this.status(`${path} is not an imported animation`, true); return; }
      this.instance.clip = { ...clip, loop: true };
      this.instance.time = 0;
    } catch (e) {
      this.status(`Could not load animation: ${(e as Error).message}`, true);
    }
  }

  private frameModel(model: LoadedModel) {
    let min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    const visit = (m: LoadedModel) => {
      for (const p of m.parts) {
        const a = p.vertex, step = a.stride ? a.stride / 4 : a.size, off = a.offset / 4;
        for (let i = off; i + 2 < a.data.length; i += step) {
          for (let k = 0; k < 3; k++) { const v = a.data[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
        }
      }
      m.attachments.forEach(a => visit(a.model));
    };
    visit(model);
    if (!isFinite(min[0]) && model.bounds) { min = model.bounds.min; max = model.bounds.max; }
    if (!isFinite(min[0])) { min = [-0.5, -0.5, 0]; max = [0.5, 0.5, 1]; }
    const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const radius = Math.max(0.05, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
    this.target = center;
    this.dist = radius * 2.6;
    this.home = { dist: this.dist, target: [...center] };
  }

  private showInfo(model: LoadedModel) {
    const parts: LoadedModel["parts"] = [];
    const collect = (m: LoadedModel) => { parts.push(...m.parts); m.attachments.forEach(a => collect(a.model)); };
    collect(model);
    const tris = parts.reduce((s, p) => s + (p.indices ? p.indices.length / 3 : 0), 0);
    const materials = [...new Set(parts.map(p => `${p.material.name}${p.material.resolved ? "" : " (fallback)"}`))];
    const textures = [...new Set(parts.flatMap(p => p.material.passes.flatMap(s => s.units.map(u => u.texture))).filter(Boolean))] as string[];
    const rows: [string, string][] = [
      ["Path", model.path],
      ["Type", model.kind],
      ["Meshes", String(parts.length)],
      ["Triangles", Math.round(tris).toLocaleString()],
      ["Skinned", String(parts.filter(p => p.bones).length)],
      ["Attachments", String(model.attachments.length)],
      ["Materials", materials.join("\n") || "none"],
      ["Textures", textures.join("\n") || "none"],
    ];
    const skipped = new Set<string>();
    const skip = (m: LoadedModel) => { m.skipped.forEach(s => skipped.add(s)); m.attachments.forEach(a => skip(a.model)); };
    skip(model);
    if (skipped.size) rows.push(["Not drawn yet", [...skipped].join("\n")]);
    setTimeout(() => {
      const missing = this.renderer.missingTextures;
      if (missing.length) {
        const t = $("info").querySelector("table");
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>Missing textures</td><td></td>`;
        (tr.lastChild as HTMLElement).innerText = missing.join("\n");
        t?.append(tr);
      }
    }, 500);
    const table = document.createElement("table");
    for (const [k, v] of rows) {
      const tr = table.insertRow();
      tr.insertCell().textContent = k;
      tr.insertCell().innerText = v;
    }
    $("info").replaceChildren(table);
  }

  private status(msg: string, error = false) {
    const s = $("status");
    s.textContent = msg;
    s.classList.toggle("error", error);
  }

  private setupCamera() {
    const c = this.canvas;
    let drag: { x: number; y: number; button: number } | null = null;
    c.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY, button: e.button }; c.setPointerCapture(e.pointerId); });
    c.addEventListener("pointerup", () => { drag = null; });
    c.addEventListener("contextmenu", e => e.preventDefault());
    c.addEventListener("pointermove", e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.button === 0 && !e.shiftKey) {
        this.az -= dx * 0.008;
        this.el = Math.max(-1.5, Math.min(1.5, this.el + dy * 0.008));
      } else {
        // pan in the camera plane
        const s = this.dist * 0.0015;
        const rx = Math.cos(this.az), ry = Math.sin(this.az);
        this.target = [this.target[0] - (-ry * dx) * s, this.target[1] - (rx * dx) * s, this.target[2] + dy * s];
      }
    });
    c.addEventListener("wheel", e => { e.preventDefault(); this.dist *= Math.exp(e.deltaY * 0.0012); }, { passive: false });
  }

  private frame = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const c = this.canvas, dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    if (this.instance || this.sceneItems) {
      if (!this.paused) {
        if (this.instance) this.instance.time += dt;
        // shared instances appear in several placements; advance each clock once per frame
        for (const it of this.sceneItems ?? []) it.instance.time += dt / (this.shares.get(it.instance) ?? 1);
      }
      const eye: Vec3 = [
        this.target[0] + this.dist * Math.cos(this.el) * Math.cos(this.az),
        this.target[1] + this.dist * Math.cos(this.el) * Math.sin(this.az),
        this.target[2] + this.dist * Math.sin(this.el),
      ];
      const proj = perspective(0.75, w / Math.max(1, h), this.dist * 0.01, this.dist * 50);
      const view = lookAt(eye, this.target, [0, 0, 1]);
      if (!this.paused) this.renderer.time += dt;
      if (this.sceneItems) {
        // Fog in the game is tuned for a camera about camera.distance from the player; shift it so
        // it is measured around the orbit target instead, and honour the fog toggle.
        let env = this.environment;
        const fogOn = $<HTMLInputElement>("fog").checked;
        if (env.fog && (!fogOn || env.camera)) {
          const shift = Math.max(0, this.dist - (env.camera?.distance ?? this.dist));
          env = { ...env, fog: fogOn ? { ...env.fog, start: env.fog.start + shift, end: env.fog.end + shift } : null };
        }
        this.renderer.drawAll(this.sceneItems, proj, view, env, this.skyboxes);
      }
      else this.renderer.draw(this.instance!, proj, view);
    }
    requestAnimationFrame(this.frame);
  };
}

start();
