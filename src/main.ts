import { lookAt, perspective, type Vec3 } from "./math";
import { loadAnimation, ModelLoader, type LoadedModel } from "./model";
import { Renderer, type ModelInstance } from "./render/renderer";
import { SceneLoader, sceneName, type LoadedScene } from "./scene";
import { ColorPository } from "./colors";
import { loadEnvironment, VIEWER_ENVIRONMENT, type Environment } from "./environment";
import { identity, multiply as multiplyMat, toMatrix, type Mat4 } from "./math";
import { World } from "./game/world";
import { Hud } from "./game/hud";
import { GuiContext } from "./ui/gui";
import { GameHud, hudState } from "./ui/hud";
import { PortraitView } from "./ui/portrait";
import { AudioSystem } from "./audio";
import { Gamepads } from "./gamepad";
import { Arsenal } from "./ui/arsenal";
import { loadSave, shopTier, weaponLevel, writeSave, type SaveData } from "./game/save";
import type { ShopMode } from "./ui/arsenal";
import { GameData } from "./game/data";

/** Towns and lobbies: no monsters, and the run starts or ends here. */
const TOWN = /haven|bazaar|\(|lobby/i;
/**
 * The order a run takes through the cached levels, after the Clockworks: a stratum of
 * Jigsaw Valley, the terminal rest stop, deeper levels, then the Core terminal whose
 * elevator returns to Haven. Levels missing from the cache are skipped.
 */
const RUN_ORDER = ["jigsaw valley emerald axis", "jigsaw valley perimeter promenade", "jigsaw valley the jade tangle",
  "terminal 1", "emberlight", "dark halls finale", "terminal core"];

/** The name shown on the HUD name plate. */
const KNIGHT_NAME = "Knight";
import { invert } from "./math";
import {
  canPickDirectory, DevServerVfs, FileListVfs, HandleVfs, recallHandle, rememberHandle, VfsError, type Vfs,
} from "./vfs";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- choosing the install

async function start() {
  // Wire every control before any async work, so a folder picked immediately is not lost.
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
  private scene: LoadedScene | null = null;
  private world: World | null = null;
  private hud: Hud | null = null;
  private gameHud: GameHud | null = null;
  private gui: GuiContext | null = null;
  private audio: AudioSystem | null = null;
  private save: SaveData = loadSave();
  private arsenal: Arsenal | null = null;
  /** Scenes in the install's cache, by name. */
  private sceneList: { id: string; name: string }[] = [];
  /** The current run through the Clockworks: depth, and the knight's health between floors. */
  private run = { depth: 1, health: null as number | null, floors: 0 };
  /** Arena mode: waves on a cached level instead of its own wiring. */
  private arenaMode = false;
  private attackPressed = false;
  private attackHeld = false;
  /** A weapon slot picked with the number keys, applied on the next update. */
  private weaponSlot: number | null = null;
  /** The action key (F) went down since the last update. */
  private interactPressed = false;
  private dashPressed = false;
  private readonly pads = new Gamepads();
  private shieldHeld = false;
  /** Mouse position over the canvas in CSS pixels, for aiming. */
  private mouse: [number, number] | null = null;
  private lastProj: Mat4 | null = null;
  private lastView: Mat4 | null = null;
  private readonly keys = new Set<string>();
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
    $("play").onclick = () => {
      if (this.world) { this.stopPlaying(); return; }
      this.run = { depth: 1, health: null, floors: 0 };
      void this.startPlaying();
    };
    // the run's menu buttons click with the game's button sound
    for (const id of ["descend", "deeper", "revive", "giveUp", "clockworks", "arenaBtn"]) {
      $(id).addEventListener("click", () => this.uiSound(id === "giveUp" ? "sound/feedback/ui_dismiss.ogg" : "sound/feedback/button_press.ogg"));
    }
    $("descend").onclick = () => void this.descend();
    $("deeper").onclick = () => {
      if (this.arenaMode && this.world?.arena) { $("floorDone").hidden = true; this.paused = false; this.world.continueArena(); return; }
      void this.descend(true);
    };
    $("clockworks").onclick = () => { this.run = { depth: 0, health: null, floors: 0 }; this.arenaMode = false; void this.descend(); };
    $("arenaBtn").onclick = () => void this.enterArena();
    $("arsenalBtn").onclick = () => void this.toggleArsenal();
    // reviving costs crowns from the bank (the game spends energy); giving up returns to town
    $("revive").onclick = () => {
      const cost = this.reviveCost();
      if (!this.world || this.save.crowns < cost) return;
      this.save.crowns -= cost;
      writeSave(this.save);
      this.world.revive();
      $("defeated").hidden = true;
      this.canvas.focus();
    };
    $("giveUp").onclick = () => {
      $("defeated").hidden = true;
      this.run = { depth: 29, health: null, floors: 0 };
      // past the last level, descend() rides up to Haven; the floor's loot is lost
      void this.returnToHaven();
    };
    $("spawnJelly").onclick = () => {
      const k = this.world?.knight;
      if (!k) return;
      const a = Math.random() * Math.PI * 2;
      const spot = this.scene!.collision.findSpawn(k.x + Math.cos(a) * 4, k.y + Math.sin(a) * 4, 0.4, 43);
      if (spot) this.world!.spawnAt({ name: "Character/NPC/Monster/Slime/Jelly/Jelly Cube/Jelly Cube 1" }, spot[0], spot[1]);
      this.canvas.focus();
    };
    const typing = () => document.activeElement instanceof HTMLInputElement && document.activeElement.type !== "checkbox";
    addEventListener("keydown", e => {
      if (!this.world || typing()) return;
      if (e.key === "Escape") { this.stopPlaying(); return; }
      if (/^[1-3]$/.test(e.key)) this.weaponSlot = Number(e.key) - 1;
      // 4 to 7 use the pocket items
      if (/^[4-7]$/.test(e.key) && !e.repeat && !this.paused && this.world.useItem(Number(e.key) - 4)) writeSave(this.save);
      if (e.key.toLowerCase() === "f" && !e.repeat) this.interactPressed = true;
      if (e.key === " " && !e.repeat) this.dashPressed = true;
      if (e.key.toLowerCase() === "i" && !e.repeat) void this.toggleArsenal();
      this.keys.add(e.key.toLowerCase());
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(e.key.toLowerCase())) e.preventDefault();
    });
    addEventListener("keyup", e => this.keys.delete(e.key.toLowerCase()));
    addEventListener("blur", () => { this.keys.clear(); this.attackHeld = false; this.shieldHeld = false; });
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
    this.sceneList = found;
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
    if (!p) {
      p = this.renderer.instantiate(model).then(async inst => {
        // scene props play their automatic animation (idle loops, flags, machinery)
        const first = model.autoAnimations[0];
        if (first && model.root) {
          const clip = await loadAnimation(this.loader, first).catch(() => null);
          if (clip) inst.clip = { ...clip, loop: true };
        }
        return inst;
      });
      this.instances.set(model, p);
    }
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
      this.stopPlaying();
      this.scene = scene;
      $("play").hidden = false;
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
      ["Guild furniture", scene.stats.furniture.toLocaleString()],
      ["Distinct models", scene.stats.uniqueModels.toLocaleString()],
      ["Editor markers hidden", scene.stats.markers.toLocaleString()],
      ["Unresolved", scene.stats.unresolved.toLocaleString()],
    ];
    const table = document.createElement("table");
    for (const [k, v] of rows) { const tr = table.insertRow(); tr.insertCell().textContent = k; tr.insertCell().textContent = v; }
    $("info").replaceChildren(table);
  }

  private async startPlaying() {
    if (!this.scene || this.world) return;
    const { min, max } = this.scene.bounds;
    // knights arrive on the level's start platform, else near the middle
    const [sx, sy] = this.scene.start ?? [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
    const spawn = this.scene.collision.findSpawn(sx, sy, 1 / 3, 43);
    if (!spawn) { this.status("No walkable floor found in this scene.", true); return; }
    this.status("Spawning a knight...");
    this.audio ??= new AudioSystem(this.vfs, this.loader);
    this.audio.unlock();
    const world = new World(this.loader, this.renderer, this.scene, this.scene.collision,
      { audio: this.audio, depth: this.run.depth, arena: this.arenaMode && !TOWN.test(this.scene.name) });
    world.onArenaCheckpoint = wave => this.arenaCheckpoint(wave);
    this.arsenal?.close();
    world.onNextFloor = () => this.floorCleared();
    world.onOpenShop = keeper => void this.openShop(keeper);
    const town = TOWN.test(this.scene.name);
    $("clockworks").hidden = !town;
    $("arenaBtn").hidden = !town;
    world.color = this.save.color;
    for (const [n, h] of Object.entries(this.save.weaponHeat)) world.weaponLevels.set(n, weaponLevel(h));
    world.pocket = this.save.pocket;
    await world.start(spawn, this.save.loadout);
    if (this.run.health !== null) world.knight.health = Math.max(1, Math.min(world.knight.maxHealth, this.run.health));
    // the scene's music (a weighted pick from its mix) and ambient loops
    const music = this.environment.music;
    if (music?.files.length) {
      const total = music.files.reduce((t, f) => t + f.weight, 0);
      let r = Math.random() * total;
      const pick = music.files.find(f => (r -= f.weight) <= 0) ?? music.files[0];
      void this.audio.playMusic(pick.file, music.gain);
    }
    for (const a of this.environment.ambience ?? []) this.audio.ambient(a);
    this.world = world;
    this.hud ??= new Hud($<HTMLCanvasElement>("hudCanvas"));
    this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors);
    const portrait = new PortraitView(this.renderer, this.loader, world.portraitRef());
    if (import.meta.env.DEV) (window as any).__portrait = portrait;
    // two render views: the knight portrait and the heat meter's flame
    const heatView = new PortraitView(this.renderer, this.loader);
    this.gameHud = new GameHud(this.gui, { view: (c, g, x, y, w, h) => (c.tag === "heat_view" ? heatView : portrait).draw(c, g, x, y, w, h) });
    void this.gameHud.init(hudState(world, KNIGHT_NAME)).catch(e => console.warn("HUD failed to load", e));
    $("spawnJelly").hidden = false;
    // the scene's own camera: its elevation and distance (scaled for this viewer's narrower lens)
    const cam = this.environment.camera;
    this.el = cam?.elevation ?? 0.785;
    this.az = -Math.PI / 2;
    this.dist = (cam?.distance ?? 10) * 1.35;
    $("play").textContent = "Stop playing";
    $("playHint").hidden = false;
    document.body.classList.add("playing");
    this.status(`Playing in ${this.scene.name}`);
    this.canvas.focus();
  }

  private stopPlaying() {
    if (!this.world) return;
    this.world = null;
    this.gameHud = null;
    this.audio?.stopMusic(1);
    this.audio?.stopAmbience();
    this.hud?.clear();
    $("defeated").hidden = true;
    $("floorDone").hidden = true;
    $("clockworks").hidden = true;
    $("arenaBtn").hidden = true;
    $("spawnJelly").hidden = true;
    this.keys.clear();
    $("play").textContent = "Play as knight";
    $("playHint").hidden = true;
    document.body.classList.remove("playing");
  }

  /** Where the mouse points on the knight's ground plane, for aiming attacks. */
  private aimPoint(): [number, number] | null {
    if (!this.mouse || !this.lastProj || !this.lastView || !this.world) return null;
    const c = this.canvas;
    const nx = (this.mouse[0] / c.clientWidth) * 2 - 1, ny = 1 - (this.mouse[1] / c.clientHeight) * 2;
    const inv = invert(multiplyMat(this.lastProj, this.lastView));
    const un = (x: number, y: number, z: number) => {
      const w = inv[3] * x + inv[7] * y + inv[11] * z + inv[15];
      return [(inv[0] * x + inv[4] * y + inv[8] * z + inv[12]) / w, (inv[1] * x + inv[5] * y + inv[9] * z + inv[13]) / w,
        (inv[2] * x + inv[6] * y + inv[10] * z + inv[14]) / w];
    };
    const a = un(nx, ny, -1), b = un(nx, ny, 1);
    const gz = this.world.knight.z + 0.5;
    const t = (gz - a[2]) / (b[2] - a[2]);
    if (!isFinite(t)) return null;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  private decals: { scene: unknown; list: { matrix: Mat4; width: number; height: number; texture: string; glow: boolean }[] } | null = null;

  /** The scene's projected shadow decals (from SceneInfluencer projector models), cached per scene. */
  private sceneDecals() {
    if (this.decals?.scene === this.scene) return this.decals.list;
    const list: { matrix: Mat4; width: number; height: number; texture: string; glow: boolean }[] = [];
    const walk = (m: LoadedModel, matrix: Mat4, depth: number) => {
      if (depth > 4) return;
      if (m.decal) list.push({ matrix, ...m.decal });
      for (const a of m.attachments) walk(a.model, multiplyMat(matrix, a.transform.matrix ?? toMatrix(a.transform)), depth + 1);
    };
    for (const o of this.scene?.objects ?? []) walk(o.model, o.matrix, 0);
    this.decals = { scene: this.scene, list };
    return list;
  }

  /** The minimap's label: the depth in the Clockworks, or the town's name. */
  private floorLabel(): string {
    if (!this.scene) return "";
    return TOWN.test(this.scene.name) ? this.scene.name.replace(/\w/g, c => c.toUpperCase()) : `Depth ${this.run.depth}`;
  }

  /** Opens or closes the arsenal; the world pauses while it is open. */
  private async toggleArsenal() {
    const arsenal = this.ensureArsenal();
    if (arsenal.isOpen) { arsenal.close(); this.paused = false; this.canvas.focus(); return; }
    this.paused = !!this.world;
    await arsenal.open(this.save.loadout);
  }

  /** Plays a UI feedback sound once audio exists (it starts with the first play). */
  private uiSound(file: string) {
    this.audio ??= new AudioSystem(this.vfs, this.loader);
    this.audio.unlock();
    this.audio.ui(file);
  }

  private ensureArsenal() {
    if (!this.gui) this.gui = new GuiContext(this.loader, this.vfs, this.renderer.colors);
    this.arsenal ??= new Arsenal($("arsenal"), this.world?.data ?? new GameData(this.loader), this.gui,
      l => { this.save.loadout = l; writeSave(this.save); },
      () => ({ crowns: this.save.crowns, heat: this.save.heat }),
      () => new Set(this.save.owned),
      (name, cost) => {
        if (this.save.crowns < cost || this.save.owned.includes(name)) return false;
        this.save.crowns -= cost;
        this.save.owned.push(name);
        writeSave(this.save);
        return true;
      });
    this.arsenal.onClose = () => { this.paused = false; this.canvas.focus(); };
    this.arsenal.sound = file => this.uiSound(file);
    this.arsenal.crafting = {
      materials: () => this.save.materials,
      level: name => this.save.owned.includes(name) ? (/^Weapon\//.test(name) ? weaponLevel(this.save.weaponHeat[name] ?? 0) : 10) : 0,
      crowns: () => this.save.crowns,
      craft: r => {
        if (this.save.crowns < r.cost || r.materials.some(([n, k]) => (this.save.materials[n] ?? 0) < k)) return false;
        this.save.crowns -= r.cost;
        for (const [n, k] of r.materials) this.save.materials[n] -= k;
        if (r.consumes) {
          // the base item becomes the new one, wherever it was equipped
          this.save.owned = this.save.owned.filter(o => o !== r.consumes);
          const l = this.save.loadout;
          l.weapons = l.weapons.map(w => (w === r.consumes ? r.output : w));
          for (const slot of ["shield", "armor", "helmet"] as const) if (l[slot] === r.consumes) l[slot] = r.output;
          if (this.save.weaponHeat[r.consumes] !== undefined) this.save.weaponHeat[r.output] = 0;
        }
        this.save.owned.push(r.output);
        writeSave(this.save);
        return true;
      },
    };
    this.arsenal.color = this.save.color;
    this.arsenal.onColor = print => { this.save.color = print; writeSave(this.save); };
    // the personal colour class (the default print's class) and its named colours
    void this.renderer.colors.then(pos => {
      const cls = pos?.classes.get(this.save.color >> 8);
      if (!pos || !cls || !this.arsenal) return;
      this.arsenal.colors = [...cls.colors.values()].map(c => {
        const z = pos.byPrint((cls.classId << 8) | c.colorId);
        return { print: (cls.classId << 8) | c.colorId, name: c.name, rgb: z ? z.colorizedRoot() : [128, 128, 128] as [number, number, number] };
      });
      this.arsenal.refresh();
    });
    return this.arsenal;
  }

  /** A shopkeeper's stock, by what the NPC's config name says it sells. */
  private async openShop(keeper: string) {
    const k = keeper.toLowerCase();
    const tabs: ShopMode["tabs"] = /sword|gun|bomb|weapon/.test(k) ? ["weapons"] : /armor|helm/.test(k) ? ["armor", "helmet"]
      : /shield/.test(k) ? ["shield", "trinket"] : /trinket|jewel/.test(k) ? ["trinket"] : ["weapons", "shield", "armor", "helmet", "trinket"];
    this.paused = true;
    await this.ensureArsenal().open(this.save.loadout, { title: keeper.split("/").pop() ?? "Shop", tabs, maxRarity: shopTier(this.save) });
  }

  /** The knight reached the exit elevator: offer the next floor. */
  private floorCleared() {
    if (!this.world) return;
    // bank what the floor gave
    const l = this.world.loot;
    this.save.crowns += l.crowns;
    this.save.heat += l.heat;
    for (const [k, v] of l.materials) this.save.materials[k] = (this.save.materials[k] ?? 0) + v;
    // equipped weapons absorb the floor's heat
    for (const w of this.save.loadout.weapons) this.save.weaponHeat[w] = (this.save.weaponHeat[w] ?? 0) + l.heat;
    this.save.bestDepth = Math.max(this.save.bestDepth, this.run.depth);
    writeSave(this.save);
    this.run.health = this.world.knight.health;
    this.run.floors++;
    const last = this.nextLevel() === null;
    $("floorTitle").textContent = last ? "Back to Haven" : `Depth ${this.run.depth} cleared`;
    $("descend").textContent = last ? "Ride up to Haven" : "Take the elevator down";
    // past the Core the Clockworks go on: cycle the levels again, deeper
    $("deeper").hidden = !last || this.run.depth >= 29;
    const mats = [...l.materials.values()].reduce((a, b) => a + b, 0);
    $("floorInfo").textContent = `${this.world.killCount} monsters defeated, ${l.crowns} crowns, ${l.heat} heat, ${mats} other pickups.`;
    $("floorDone").hidden = false;
  }

  /** The run's next level after the current scene, or null when the run is over. */
  /** The arena: a random combat level with its wiring off and waves instead. */
  private async enterArena() {
    const levels = this.runLevels().filter(s => /jigsaw|valley|dark halls|grove|cave|keep/i.test(s.name));
    const pick = (levels.length ? levels : this.runLevels())[Math.floor(Math.random() * Math.max(1, levels.length))];
    if (!pick) return;
    this.stopPlaying();
    this.arenaMode = true;
    this.run = { depth: 1, health: null, floors: 0 };
    await this.selectScene(pick.id);
    await this.startPlaying();
  }

  /** Every fifth arena wave: bank the loot, then fight on or go home. */
  private arenaCheckpoint(wave: number) {
    if (!this.world) return;
    const l = this.world.loot;
    this.save.crowns += l.crowns;
    this.save.heat += l.heat;
    for (const w of this.save.loadout.weapons) this.save.weaponHeat[w] = (this.save.weaponHeat[w] ?? 0) + l.heat;
    for (const [k, v] of l.materials) this.save.materials[k] = (this.save.materials[k] ?? 0) + v;
    l.crowns = 0; l.heat = 0; l.materials.clear();
    writeSave(this.save);
    this.paused = true;
    $("floorTitle").textContent = `Arena: wave ${wave} cleared`;
    $("floorInfo").textContent = `Loot banked. You have ${this.save.crowns} crowns.`;
    $("descend").textContent = "Ride up to Haven";
    $("deeper").textContent = "Fight on";
    $("deeper").hidden = false;
    $("floorDone").hidden = false;
  }

  /** Crowns a revive costs: more the deeper the knight is (towns are free). */
  private reviveCost() { return TOWN.test(this.scene?.name ?? "") ? 0 : 25 * Math.max(1, this.run.depth); }

  private async returnToHaven() {
    this.stopPlaying();
    this.run = { depth: 0, health: null, floors: 0 };
    const haven = this.sceneList.find(s => /haven town square/i.test(s.name)) ?? this.sceneList.find(s => TOWN.test(s.name));
    if (!haven) return;
    await this.selectScene(haven.id);
    await this.startPlaying();
  }

  /** The cached levels in run order. */
  private runLevels(): { id: string; name: string }[] {
    const levels = RUN_ORDER.map(n => this.sceneList.find(s => s.name.toLowerCase().startsWith(n))).filter((s): s is { id: string; name: string } => !!s);
    // levels in the cache that the order does not name come before the Core
    for (const s of this.sceneList) if (!TOWN.test(s.name) && !levels.includes(s)) levels.splice(levels.length - 1, 0, s);
    return levels;
  }

  private nextLevel(): { id: string; name: string } | null {
    const levels = this.runLevels();
    if (!this.scene || TOWN.test(this.scene.name)) return levels[0] ?? null;
    const i = levels.findIndex(s => s.id === this.scene!.id);
    return i >= 0 && i + 1 < levels.length ? levels[i + 1] : null;
  }

  /**
   * Takes the elevator: the run's next level, one depth deeper. The cache holds only levels
   * this account has visited, so the run goes through those; after the last, back to Haven.
   */
  private async descend(deeper = false) {
    $("floorDone").hidden = true;
    this.paused = false;
    if (this.arenaMode) { this.arenaMode = false; await this.returnToHaven(); return; }
    let next = this.nextLevel();
    if (deeper && !next) next = this.runLevels()[0] ?? null;
    this.stopPlaying();
    if (!next) {
      // the run is over: back to town
      this.save.runs++;
      writeSave(this.save);
      this.run = { depth: 0, health: null, floors: 0 };
      const haven = this.sceneList.find(s => /haven town square/i.test(s.name)) ?? this.sceneList.find(s => TOWN.test(s.name));
      if (!haven) return;
      await this.selectScene(haven.id);
      await this.startPlaying();
      return;
    }
    this.run.depth++;
    await this.selectScene(next.id);
    await this.startPlaying();
  }

  /** WASD or arrows, relative to where the camera looks. */
  private moveInput() {
    const k = this.keys;
    const f = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0);
    const r = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
    const fx = -Math.cos(this.az), fy = -Math.sin(this.az);
    return { x: fx * f + fy * r, y: fy * f - fx * r };
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
      this.stopPlaying();
      this.scene = null;
      $("play").hidden = true;
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
    c.addEventListener("pointerdown", e => {
      if (this.world && (e.button === 0 || e.button === 2)) {
        // play mode: left attacks (hold to charge), right raises the shield
        if (e.button === 0) { this.attackPressed = true; this.attackHeld = true; } else this.shieldHeld = true;
        c.setPointerCapture(e.pointerId);
        return;
      }
      drag = { x: e.clientX, y: e.clientY, button: this.world ? 0 : e.button };
      c.setPointerCapture(e.pointerId);
    });
    const release = (e: PointerEvent) => {
      if (e.button === 0) this.attackHeld = false;
      if (e.button === 2) this.shieldHeld = false;
    };
    c.addEventListener("pointerup", release);
    c.addEventListener("pointercancel", () => { this.attackHeld = false; this.shieldHeld = false; });
    c.addEventListener("pointermove", e => {
      const r = c.getBoundingClientRect();
      this.mouse = [e.clientX - r.left, e.clientY - r.top];
    });
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
      if (this.world) {
        const mv = this.moveInput();
        // a gamepad adds to the keyboard and mouse; sticks are camera-relative like WASD
        const pad = this.pads.poll();
        const fx = -Math.cos(this.az), fy = -Math.sin(this.az);
        const rel = (x: number, y: number): [number, number] => [fx * y + fy * x, fy * y - fx * x];
        let move: [number, number] = [mv.x, mv.y], aim = this.aimPoint();
        if (pad) {
          if (pad.move[0] || pad.move[1]) move = rel(pad.move[0], pad.move[1]);
          if (pad.aim) { const [ax, ay] = rel(pad.aim[0], pad.aim[1]); const k = this.world.knight; aim = [k.x + ax * 3, k.y + ay * 3]; }
          else if (pad.move[0] || pad.move[1]) aim = null;
          if (pad.item >= 0 && !this.paused && this.world.useItem(pad.item)) writeSave(this.save);
          if (pad.cycle && this.world.knight.weapons.length) {
            const n = this.world.knight.weapons.length;
            this.weaponSlot = (this.world.knight.slot + pad.cycle + n) % n;
          }
        }
        if (!this.paused) {
          this.world.update(dt, {
            move, attackDown: this.attackPressed || !!pad?.attackDown, attackHeld: this.attackHeld || !!pad?.attackHeld,
            shield: this.shieldHeld || this.keys.has("shift") || !!pad?.shield, aim, weaponSlot: this.weaponSlot,
            interact: this.interactPressed || !!pad?.interact, dash: this.dashPressed || !!pad?.dash,
          });
          this.dashPressed = false;
          this.weaponSlot = null;
          this.interactPressed = false;
        }
        this.attackPressed = false;
        // Q and E turn the camera; it follows the knight smoothly
        if (this.keys.has("q")) this.az += dt * 1.8;
        if (this.keys.has("e")) this.az -= dt * 1.8;
        const k = this.world.knight;
        const f = 1 - Math.exp(-dt * 10);
        this.target = [this.target[0] + (k.x - this.target[0]) * f, this.target[1] + (k.y - this.target[1]) * f,
          this.target[2] + (k.z + 1 - this.target[2]) * f];
        if ($("defeated").hidden === this.world.defeated) {
          $("defeated").hidden = !this.world.defeated;
          if (this.world.defeated) {
            const cost = this.reviveCost();
            $("reviveInfo").textContent = TOWN.test(this.scene?.name ?? "") ? "" : `Reviving costs ${cost} crowns (you have ${this.save.crowns}).`;
            ($("revive") as HTMLButtonElement).disabled = this.save.crowns < cost;
          }
        }
      }
      const eye: Vec3 = [
        this.target[0] + this.dist * Math.cos(this.el) * Math.cos(this.az),
        this.target[1] + this.dist * Math.cos(this.el) * Math.sin(this.az),
        this.target[2] + this.dist * Math.sin(this.el),
      ];
      const proj = perspective(0.75, w / Math.max(1, h), this.dist * 0.01, this.dist * 50);
      // camera shake from explosions (ShakeCamera actions)
      const shake = this.world?.shake ?? 0;
      if (shake > 0) for (let i = 0; i < 3; i++) eye[i] += (Math.random() - 0.5) * shake * 0.6;
      const view = lookAt(eye, this.target, [0, 0, 1]);
      if (this.world) this.audio?.setListener([this.world.knight.x, this.world.knight.y, this.world.knight.z]);
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
        const items = this.world ? [...this.sceneItems, ...this.world.items()] : this.sceneItems;
        this.renderer.drawAll(items, proj, view, env, this.skyboxes);
        if (this.scene) this.renderer.drawDecals(this.sceneDecals(), proj, view, env.shadow ?? [0, 0.08, 0.1, 0.4]);
        if (this.world) this.renderer.drawShadows(this.world.shadows(), proj, view, env.shadow ?? [0, 0.08, 0.1, 0.4]);
        this.lastProj = proj;
        this.lastView = view;
        if (this.world && this.hud) {
          const gh = this.gameHud;
          gh?.minimap.setWorld(this.world);
          gh?.update(hudState(this.world, KNIGHT_NAME, this.floorLabel()), dt);
          this.hud.draw(this.world, proj, view, gh ? (g, cw, ch) => gh.draw(g, cw, ch) : undefined);
        }
      }
      else this.renderer.draw(this.instance!, proj, view);
    }
    requestAnimationFrame(this.frame);
  };
}

start();
