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
import { knightName, loadSave, shopTier, writeSave, type SaveData } from "./game/save";
import { ECONOMY_FILES, Economy } from "./game/economy";
import { Places } from "./ui/places";
import { GameScreens } from "./ui/screens";
import { GameData } from "./game/data";
import { TitleScreen } from "./ui/title";
import { Outfit } from "./game/outfit";
import { openWardrobe } from "./ui/wardrobe";
import { LoadingScreen, loadingInfo } from "./ui/loading";
import { ElevatorScreen } from "./ui/elevator";
import { GateBoard } from "./ui/gates";
import { MusicPlayer } from "./game/musicplayer";

/** The game app (title screen, no asset browser); the asset viewer is at #viewer (and #dev=1 for tests). */
const GAME = !/viewer|dev=1/.test(location.hash);
import { ACTIONS, keyName, loadSettings, saveSettings, SettingsMenu, type Action, type Settings } from "./ui/settings";
import { OptionsScreen } from "./ui/options";
import { ReviveScreen } from "./ui/revive";
import { pad as padOptions } from "./gamepad";
import { generateLevel, type TileInfo } from "./gen/level";
import { addFeatures, layoutFor, type FeatureReport, type FloorStyle } from "./gen/features";
import { THEMES as GEN_THEMES, themeAvailable, themeLevel } from "./gen/themes";
import { decodeTiles } from "./gen/autotile";
import { arcadeGates, BOSSES, gateFloors, stratumTables, tierStars, type BossKey, type Floor, type Gate } from "./game/clockworks";
import { rng } from "./gen/layout";
import { rankLabel, tierLock } from "./game/missions";
import { MissionBoard, notice, progressOf } from "./ui/missions";

/** Towns and lobbies: no monsters, and the run starts or ends here. */
const TOWN = /haven|bazaar|lobby|^hall|ready room|crash site/i;
/**
 * The order a run takes through the cached levels, after the Clockworks: a stratum of
 * Jigsaw Valley, the terminal rest stop, deeper levels, then the Core terminal whose
 * elevator returns to Haven. Levels missing from the cache are skipped.
 */
const RUN_ORDER = ["jigsaw valley emerald axis", "jigsaw valley perimeter promenade", "jigsaw valley the jade tangle",
  "terminal 1", "emberlight", "dark halls finale", "terminal core"];

/** Themes generated floors are learned from: cached levels whose names match, and a label. */
const THEMES: { key: string; test: RegExp; label: string }[] = [
  { key: "valley", test: /^jigsaw valley/i, label: "Jigsaw Valley" },
  { key: "clockworks", test: /^(terminal 1|emberlight|terminal core)/i, label: "Clockwork Tunnels" },
];
const themeOf = (name: string) => THEMES.find(t => t.test.test(name)) ?? null;
/** Generated floor ids: "gen:<theme>:<seed>". */
const GEN = /^gen:([a-z-]+):(\d+)$/;

import { invert } from "./math";
import {
  canPickDirectory, DevServerVfs, FileListVfs, HandleVfs, recallHandle, rememberHandle, VfsError, type Vfs,
} from "./vfs";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- choosing the install

async function start() {
  if (GAME) {
    document.title = "Spiral Knights";
    document.querySelector("#welcome h1")!.textContent = "Spiral Knights";
    document.querySelector("#welcome .card p")!.textContent =
      "A single-player browser port of Spiral Knights that plays from your own game install. Nothing is uploaded or downloaded: the game's files stay on your computer.";
  }
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
  private readonly options_: Settings = loadSettings();
  private settings: SettingsMenu | null = null;
  /** The key bound to an action (options menu). */
  private bound(a: Action) { return this.options_.keys[a] ?? ACTIONS[a].key; }
  private gui: GuiContext | null = null;
  private audio: AudioSystem | null = null;
  private save: SaveData = loadSave();
  /** The guild hall and furniture, the Ready Room and knight creation (src/ui/places.ts). */
  private readonly places: Places;
  /** The battle sprite, accessories and costumes (game/outfit.ts); missions call outfit.setSprite. */
  private outfit_: Outfit | null = null;
  get outfit() { return this.outfit_ ??= new Outfit(this.loader, () => this.save, () => writeSave(this.save)); }
  /** Scenes in the install's cache, by name. */
  private sceneList: { id: string; name: string }[] = [];
  /** The current run through the Clockworks: depth, and the knight's health between floors. */
  private run = { depth: 1, health: null as number | null, floors: 0 };
  /** Totals for the current gate run, for the summary when it ends. */
  private runTotals = { kills: 0, crowns: 0, heat: 0, materials: 0, deepest: 0, gate: "" };

  /** The gate being descended and its floors by depth (null outside the Clockworks). */
  private gate: Gate | null = null;
  private floors: Floor[] = [];
  /** Spawn tables generated floors are re-themed with (by scene id). */
  private genTables = new Map<string, string[]>();
  /** Generated floors that are safe towns (no monsters; an alchemy machine). */
  private safeGen = new Set<string>();
  /** Names generated floors show (by scene id). */
  private genNames = new Map<string, string>();
  /** Special floor styles (vault, danger, arena) by scene id, and the last floor's feature report. */
  private genStyles = new Map<string, FloorStyle>();
  genReport: FeatureReport | null = null;
  /** The boss of the floor being played, if any. */
  private bossFloor: BossKey | null = null;
  /** The mission board (src/ui/missions.ts), made on first use. */
  private missionBoard: MissionBoard | null = null;
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
    this.places = this.makePlaces();
    this.settings = new SettingsMenu($("settings"), this.options_, {
      changed: () => this.applyOptions(),
      playing: () => !!this.world,
      resume: () => { this.paused = false; this.canvas.focus(); },
      returnToHaven: () => { this.paused = false; void this.returnToHaven(); },
      leave: () => { this.paused = false; this.stopPlaying(); if (GAME) void this.enterTitle(); },
      saveReplaced: d => { this.save = d; },
      sound: f => this.uiSound(f),
    });
    this.applyOptions();
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
      if (this.gate) { $("floorDone").hidden = true; this.paused = false; this.gate = null; void this.returnToHaven(); return; }
      void this.descend(true);
    };
    $("clockworks").onclick = () => this.openGates();
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
      this.reviveScreen?.close();
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
      if (this.places.key(e)) { e.preventDefault(); return; }
      // Esc opens the options menu (and closes whatever window is open)
      if (e.key === "Escape") {
        if (this.itemScreens?.escape()) return;
        if (this.settings?.isOpen) this.settings.close();
        else if (this.options?.isOpen) this.options.close();
        else { this.paused = true; void this.openOptions(); }
        return;
      }
      if (this.settings?.isOpen || this.options?.isOpen) return;
      const key = e.key.toLowerCase(), b = (a: Action) => key === this.bound(a);
      (["weapon1", "weapon2", "weapon3"] as const).forEach((a, i) => { if (b(a)) this.weaponSlot = i; });
      if (b("cycle") && !e.repeat) { e.preventDefault(); const n = Math.max(1, this.world.knight.weapons.length); this.weaponSlot = (this.world.knight.slot + 1) % n; }
      // pocket items
      (["item1", "item2", "item3", "item4"] as const).forEach((a, i) => {
        if (b(a) && !e.repeat && !this.paused && this.world!.useItem(i)) writeSave(this.save);
      });
      (["sprite1", "sprite2", "sprite3"] as const).forEach((a, i) => { if (b(a) && !e.repeat && !this.paused) this.outfit.useSkill(i); });
      if (b("interact") && !e.repeat) this.interactPressed = true;
      if (b("dash") && !e.repeat) this.dashPressed = true;
      if (b("help") && !e.repeat) $("playHint").hidden = !$("playHint").hidden;
      if (b("forge") && !e.repeat) void this.toggleArsenal("craft");
      if (key === "n" && !e.repeat) this.openFeed();
      if (key === "m" && !e.repeat) this.openMail();
      // Shift while the shield is up also dashes (right click, then Shift)
      if (e.key === "Shift" && !e.repeat && this.shieldHeld) this.dashPressed = true;
      if (b("arsenal") && !e.repeat) void this.toggleArsenal();
      if (b("backpack") && !e.repeat) void this.ensureScreens().toggleBackpack();
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
    genScenes = this.sceneList;
    if (GAME) void this.enterTitle();
  }

  private title: TitleScreen | null = null;
  /** Music for each place and floor (src/game/music.ts), the loading and elevator screens. */
  private readonly music = new MusicPlayer(() => this.ensureAudio());
  private loadingScreen: LoadingScreen | null = null;
  private elevator: ElevatorScreen | null = null;
  private played = false;

  private ensureAudio(): AudioSystem {
    if (!this.audio) { this.audio = new AudioSystem(this.vfs, this.loader); this.audio.unlock(); this.applyOptions(); }
    return this.audio;
  }

  /** The loading and elevator screens (game interfaces over the stage). */
  private screens() {
    this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors);
    const stage = this.canvas.parentElement!;
    this.loadingScreen ??= new LoadingScreen(this.gui, stage);
    if (!this.elevator) {
      this.elevator = new ElevatorScreen(this.gui, stage, $("floorDone"), () => {
        const w = this.world;
        if (!w) return null;
        const v = new PortraitView(this.renderer, this.loader, w.portraitRef(), "character/pc/animation_pose_dash.dat");
        return (c, g, x, y, ww, h) => v.draw(c, g, x, y, ww, h);
      });
      this.elevator.onShow = () => this.music.stinger("elevator");
    }
    return { loading: this.loadingScreen, elevator: this.elevator };
  }

  /** Shows the loading screen for a scene about to load (in the game, not the asset viewer). */
  private showLoading(id: string): LoadingScreen | null {
    if (!GAME && !this.played) return null;
    const { loading } = this.screens();
    const f = this.gate && this.run.depth > 0 ? this.floors[this.run.depth] ?? null : null;
    const name = this.genNames.get(id) ?? this.sceneList.find(s => s.id === id)?.name ?? id;
    void loading.show(loadingInfo(this.arenaMode ? "arena" : name, f, this.gate?.name));
    loading.progress(0.05);
    return loading;
  }

  /** The title screen over Haven (the game app's start; the asset viewer lives behind #viewer). */
  private async enterTitle() {
    document.body.classList.add("game");
    this.music.title();
    this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors);
    this.title ??= new TitleScreen(this.gui, $<HTMLCanvasElement>("titleCanvas"), {
      play: () => {
        this.uiSound("sound/feedback/ui_confirm.ogg"); this.title?.hide();
        // a fresh save makes its knight first, then enters Haven
        if (this.places.needsKnight()) void this.places.startCreation(); else void this.startPlaying();
      },
      options: () => void this.openOptions(),
      viewer: import.meta.env.DEV ? () => { location.hash = "#viewer"; location.reload(); } : undefined,
    });
    const haven = this.sceneList.find(s => /haven town square/i.test(s.name)) ?? this.sceneList.find(s => TOWN.test(s.name));
    if (haven && this.scene?.id !== haven.id) await this.selectScene(haven.id);
    await this.title.show();
  }

  private instanceOf(model: LoadedModel): Promise<ModelInstance> {
    let p = this.instances.get(model);
    if (!p) {
      p = this.renderer.instantiate(model).then(async inst => {
        // scene props play their automatic animation (idle loops, flags, machinery)
        const first = model.autoAnimations[0];
        if (first && model.root) {
          const clip = await loadAnimation(this.loader, first).catch(() => null);
          // each plays as its config says: idle machinery loops, the start elevator's
          // arrival plays once and holds its last frame
          if (clip) inst.clip = clip;
        }
        return inst;
      });
      this.instances.set(model, p);
    }
    return p;
  }

  private tileInfos = new Map<string, TileInfo>();

  /**
   * Builds a generated floor: learns the theme's tiling from its cached levels and paints a
   * new layout with their spawners, treasure and elevators (src/gen).
   */
  private async generatedRoot(id: string): Promise<any> {
    const [, key, seed] = GEN.exec(id)!;
    // the theme's tiling: learned from its cached levels, mirrored from a related theme, or
    // rule-based (src/gen/themes.ts)
    const readRoot = async (sid: string) => this.sceneLoader.parse(await this.vfs.readScene(sid));
    const level = await themeLevel(key, {
      scenes: this.sceneList, readRoot,
      tileNames: () => this.sceneLoader.configNames("config/tile.dat"),
      tileInfo: ref => this.sceneLoader.tileInfo(ref),
    });
    const ids = level.sources.map(s => s.id);
    // spawners and treasure from every cached combat level, for themes whose levels spawn
    // their monsters another way
    const others = this.runLevels().filter(s => !ids.includes(s.id)).map(s => s.id);
    const pool = (await Promise.all(others.map(async sid => (await readRoot(sid)).entries ?? []))).flat();
    const style = this.genStyles.get(id);
    const root = generateLevel(level.sources, () => ({ width: 1, height: 1, walkable: false }), Number(seed),
      this.genNames.get(id) ?? `${level.def.label} · new floor`, pool, { model: level.model, globals: level.globals, layout: layoutFor(style) });
    // a stratum's monsters: every spawner draws from the stratum's spawn tables
    const tables = this.genTables.get(id);
    if (tables?.length) retheme(root, tables, rng(Number(seed) ^ 0x5bd1e995));
    if (this.safeGen.has(id)) {
      // a town floor: no spawners or encounters, and an alchemy machine near the start
      root.entries = (root.entries as any[]).filter(e => !/Single Spawn/.test(e.placeable?.name ?? "") && e.area?.name !== "Player Enter/Spawn Activate");
      const haven = this.sceneList.find(sc => /haven town square/i.test(sc.name));
      const machine = haven ? ((await readRoot(haven.id)).entries as any[]).find(e => /^Shop\/Haven\/Alchemy$/.test(e.placeable?.name ?? "")) : null;
      const start = (root.entries as any[]).find(e => /Elevator\/Start Platform/.test(e.placeable?.name ?? ""));
      if (machine && start) {
        const t = start.transform.translation;
        root.entries.push({ ...JSON.parse(JSON.stringify(machine, (k, v) => (k === "$outer" ? undefined : v))), id: 999999,
          transform: { ...start.transform, translation: { ...t, x: t.x + 4, y: t.y } } });
      }
      return root;
    }
    // rooms seal while their waves are fought, as the game's own levels do (walkability from
    // the tiles the floor uses)
    const refKey = (r: any) => JSON.stringify(r, (k, v) => (k === "$outer" ? undefined : v));
    for (const m of (root.tileConfigs ?? []) as any[]) {
      const k = refKey(m?.tile);
      if (m?.tile && !this.tileInfos.has(k)) this.tileInfos.set(k, await this.sceneLoader.tileInfo(m.tile));
    }
    const info = (r: any) => this.tileInfos.get(refKey(r)) ?? { width: 1, height: 1, walkable: false };
    const walk = walkableCells(root, info);
    arenaRooms(root, (x, y) => walk.has(x + "," + y));
    // puzzles, the floor style's special rooms and decoration (src/gen/features.ts)
    this.genReport = addFeatures(root, { style, theme: key, tables, rand: rng(Number(seed) ^ 0x2545f491), walkable: (x, y) => walk.has(x + "," + y) });
    return root;
  }

  private async selectScene(id: string) {
    const token = ++this.loadToken;
    this.status("Loading scene " + id + "...");
    const loading = this.showLoading(id);
    for (const li of $("scenes").children) li.classList.toggle("active", (li as HTMLElement).dataset.scene === id);
    for (const li of $("list").children) li.classList.remove("active");
    history.replaceState(null, "", "#scene=" + id);
    const t0 = performance.now();
    try {
      const progress = (done: number, total: number) => {
        if (token !== this.loadToken) return;
        this.status("Loading scene: " + done + " of " + total + " objects");
        loading?.progress(0.1 + 0.7 * done / Math.max(1, total));
      };
      const special = GEN.test(id) ? null : await this.places.sceneRoot(id);
      const scene = special ? await this.sceneLoader.loadRoot(id, special, progress)
        : GEN.test(id) ? await this.sceneLoader.loadRoot(id, await this.generatedRoot(id), progress) : await this.sceneLoader.load(id, await this.vfs.readScene(id), progress);
      loading?.progress(0.8);
      const items = await Promise.all(scene.objects.map(async o => ({ instance: await this.instanceOf(o.model), matrix: o.matrix })));
      loading?.progress(0.9);
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
      loading?.done();
    } catch (e) {
      if (token !== this.loadToken) return;
      loading?.done();
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
    const spawn = this.places.spawn(this.scene.id) ?? this.scene.collision.findSpawn(sx, sy, 1 / 3, 43);
    if (!spawn) { this.status("No walkable floor found in this scene.", true); return; }
    this.status("Spawning a knight...");
    // one-shot scene animations (the start elevator arriving) play from the top as the knight arrives
    for (const it of this.sceneItems ?? []) if (it.instance.clip && !it.instance.clip.loop) it.instance.time = 0;
    this.audio ??= new AudioSystem(this.vfs, this.loader);
    this.audio.unlock();
    const world = new World(this.loader, this.renderer, this.scene, this.scene.collision,
      { audio: this.audio, depth: this.run.depth, arena: this.arenaMode && !TOWN.test(this.scene.name) });
    world.onArenaCheckpoint = wave => this.arenaCheckpoint(wave);
    this.itemScreens?.closeAll();
    world.onNextFloor = () => this.floorCleared();
    world.exitLocked = this.bossFloor ? () => this.bossAlive() : null;
    world.onOpenShop = keeper => void this.openShop(keeper);
    // Haven's north exit leads to the Arcade, which the scenes cache lacks: walking into it
    // brings up the Arcade's gate board
    world.onPortal = tags => { if (tags.some(t => /arcade/i.test(t)) && !this.gate) this.openGates(); };
    const town = TOWN.test(this.scene.name);
    $("clockworks").hidden = !town;
    $("arenaBtn").hidden = !town;
    world.color = this.save.color;
    world.gear = this.save.gear;
    if (this.eco) world.economy = this.eco;
    // treasure on a family stratum drops that family's materials
    const theme = this.gate ? this.floors[this.run.depth]?.stratum?.theme : null;
    world.themeTags = theme && /^(Beast|Construct|Fiend|Gremlin|Slime|Undead)$/.test(theme) ? [`fam_${theme.toLowerCase()}`] : [];
    world.pocket = this.save.pocket;
    await this.outfit.dress(world);
    await world.start(spawn, this.save.loadout);
    this.eco ??= world.economy;
    this.outfit.hotkeys = (["sprite1", "sprite2", "sprite3"] as const).map(a => keyName(this.bound(a)));
    void this.outfit.accompany(world);
    if (this.run.health !== null) world.knight.health = Math.max(1, Math.min(world.knight.maxHealth, this.run.health));
    // the floor's music (src/game/music.ts: gate floors by kind, theme and style, else the scene's own) and ambient loops
    this.played = true;
    this.screens();
    this.music.enter({ scene: this.scene.name, sceneMusic: this.environment.music, world, arena: !!world.arena, boss: this.bossFloor,
      floor: this.gate && this.run.depth > 0 ? this.floors[this.run.depth] ?? null : null });
    for (const a of this.environment.ambience ?? []) this.audio.ambient(a);
    this.world = world;
    this.hud ??= new Hud($<HTMLCanvasElement>("hudCanvas"));
    this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors);
    const portrait = new PortraitView(this.renderer, this.loader, world.portraitRef());
    if (import.meta.env.DEV) (window as any).__portrait = portrait;
    this.outfit.onRedress = () => portrait.setModelRef(world.portraitRef());
    // render views: the knight portrait, the heat meter's flame, the dash cooldown's ring and
    // the target panel's monster (a view per target)
    const heatView = new PortraitView(this.renderer, this.loader, undefined, null);
    const ringView = new PortraitView(this.renderer, this.loader, undefined, null);
    let targetView: { key: string; view: PortraitView } | null = null;
    this.gameHud = new GameHud(this.gui, { view: (c, g, x, y, w, h) => {
      if (c.viewOwner === "target") {
        const t = world.hudTarget();
        if (!t) return;
        if (targetView?.key !== t.key) targetView = { key: t.key, view: new PortraitView(this.renderer, this.loader, undefined, t.idle) };
        targetView.view.draw(c, g, x, y, w, h);
      } else (c.viewOwner === "cooldown" ? ringView : c.tag === "heat_view" ? heatView : portrait).draw(c, g, x, y, w, h);
    } });
    void this.gameHud.init(hudState(world, knightName(this.save))).catch(e => console.warn("HUD failed to load", e));
    $("spawnJelly").hidden = false;
    if (import.meta.env.DEV) openWardrobe(this.outfit, () => this.world, () => this.save, () => writeSave(this.save));
    // the scene's own camera: its elevation and distance (scaled for this viewer's narrower lens)
    const cam = this.environment.camera;
    this.el = cam?.elevation ?? 0.785;
    this.az = -Math.PI / 2;
    this.dist = (cam?.distance ?? 10) * 1.35 * this.options_.zoom;
    this.applyOptions();
    $("play").textContent = "Stop playing";
    $("playHint").hidden = true; // the ? button on the HUD (or H) shows the controls
    document.body.classList.add("playing");
    this.status(`Playing in ${this.scene.name}`);
    this.canvas.focus();
    this.places.started(this.scene.id);
  }

  private stopPlaying() {
    if (!this.world) return;
    this.outfit.leave(this.world);
    this.world = null;
    this.gameHud = null;
    this.music.leave();
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
    return this.world ? this.rayPoint(this.world.knight.z + 0.5) : null;
  }

  /** Where the pointer's ray meets the horizontal plane at height gz. */
  private rayPoint(gz: number): [number, number] | null {
    if (!this.mouse || !this.lastProj || !this.lastView) return null;
    const c = this.canvas;
    const nx = (this.mouse[0] / c.clientWidth) * 2 - 1, ny = 1 - (this.mouse[1] / c.clientHeight) * 2;
    const inv = invert(multiplyMat(this.lastProj, this.lastView));
    const un = (x: number, y: number, z: number) => {
      const w = inv[3] * x + inv[7] * y + inv[11] * z + inv[15];
      return [(inv[0] * x + inv[4] * y + inv[8] * z + inv[12]) / w, (inv[1] * x + inv[5] * y + inv[9] * z + inv[13]) / w,
        (inv[2] * x + inv[6] * y + inv[10] * z + inv[14]) / w];
    };
    const a = un(nx, ny, -1), b = un(nx, ny, 1);
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

  private itemScreens: GameScreens | null = null;
  private previewView: { key: string; view: PortraitView } | null = null;

  /** The game's item windows: arsenal, forge, shops, backpack (src/ui/screens.ts). */
  private ensureScreens() {
    this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors);
    return this.itemScreens ??= new GameScreens({
      gui: this.gui, colors: this.renderer.colors, eco: () => this.economy(),
      data: () => this.world?.data ?? new GameData(this.loader),
      save: () => this.save, sound: f => this.uiSound(f),
      write: () => { if (this.world) this.world.pocket = this.save.pocket; writeSave(this.save); },
      paused: on => { this.paused = on && !!this.world; if (!on) this.canvas.focus(); },
      arsenalClosed: () => this.places.arsenalClosed(),
      // the equipment window's knight preview
      view: (c, g, x, y, w, h) => {
        const ref = this.world?.portraitRef();
        if (!ref) return;
        const key = JSON.stringify(ref, (k, v) => (k === "$outer" ? undefined : v));
        if (this.previewView?.key !== key) this.previewView = { key, view: new PortraitView(this.renderer, this.loader, ref) };
        this.previewView.view.draw(c, g, x, y, w, h);
      },
    });
  }

  /** Opens or closes the arsenal (or the forge); the world pauses while it is open. */
  private async toggleArsenal(tab?: "craft") {
    const screens = this.ensureScreens();
    await (tab === "craft" ? screens.toggleForge() : screens.toggleArsenal());
  }

  /** Applies the options menu's settings to audio, rendering, the HUD and input. */
  private applyOptions() {
    const o = this.options_;
    if (this.audio) {
      this.audio.volume = o.masterVolume; this.audio.musicVolume = o.musicVolume;
      this.audio.effectsVolume = o.effectsVolume; this.audio.uiVolume = o.uiVolume; this.audio.muted = o.muted;
      this.audio.applyVolumes();
    }
    this.renderer.particlesOn = o.particles;
    if (this.hud) this.hud.options = { healthBars: o.healthBars, damageNumbers: o.damageNumbers, hudScale: o.hudScale, fps: o.showFps };
    if (this.gameHud) this.gameHud.options = { minimap: o.minimap, screenFlash: o.screenFlash };
    if (this.world) this.world.autoAimOn = o.autoAim;
    padOptions.deadZone = o.deadZone;
    document.body.classList.toggle("no-hint", !o.controlsHint);
  }

  /** What the HUD shows besides the knight: the objective lines and whether this is a town. */
  private hudContext(): { objectives: string[]; town: boolean } {
    const f = this.gate ? this.floors[this.run.depth] : null;
    if (f && (f.kind === "terminal" || f.kind === "subtown" || f.kind === "core")) {
      return { town: true, objectives: [`${f.name}, depth ${f.depth}: rest, resupply at the Supply Depot, then take the elevator down.`] };
    }
    if (f?.kind === "boss") return { town: false, objectives: [`Defeat ${f.stratum?.boss ? BOSSES[f.stratum.boss].name : "the boss"}.`, "The elevator opens when it falls."] };
    const town = !!this.scene && TOWN.test(this.scene.name);
    const a = this.world?.arena;
    const objectives = town ? ["Visit the shops, then enter the Clockworks."]
      : a ? [`Survive the arena: wave ${Math.max(1, a.wave)}.`]
      : ["Defeat the monsters that bar your way.", "Find the elevator to the next depth."];
    return { objectives, town };
  }

  /** A HUD button was clicked (the corner menus and the activities panel). */
  private hudAction(tag: string) {
    this.uiSound("sound/feedback/ui_confirm.ogg");
    if (this.places.hudAction(tag)) return;
    switch (tag) {
      case "button_menu": this.openSettings(); break;
      case "button_help": $("playHint").hidden = !$("playHint").hidden; break;
      case "button_feed": this.openFeed(); break;
      case "button_mail": this.openMail(); break;
      case "button_loadout": case "button_gear": void this.toggleArsenal(); break;
      case "button_arsenal": void this.ensureScreens().toggleBackpack(); break;
      case "button_forge": void this.toggleArsenal("craft"); break;
      // in town the first activity leads to the Arcade's gates; below, it rides back to Haven
      case "button_haven": if (this.hudContext().town && !this.gate) this.openGates(); else void this.returnToHaven(); break;
      case "button_missions": void this.missions().toggle(); break;
      case "button_supplydepot": void this.openShop("Supply Depot"); break;
      default: break;
    }
  }

  /** The guild, Ready Room and knight creation module's view of the viewer. */
  private makePlaces(): Places {
    let data: GameData | null = null;
    const places = new Places({
      vfs: this.vfs,
      sceneLoader: this.sceneLoader,
      gui: () => (this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors)),
      data: () => this.world?.data ?? (data ??= new GameData(this.loader)),
      instanceOf: m => this.instanceOf(m),
      save: () => this.save,
      write: () => writeSave(this.save),
      scene: () => this.scene,
      pick: z => this.rayPoint(z),
      knightZ: () => this.world?.knight.z ?? 0,
      sound: f => this.uiSound(f),
      sceneList: () => this.sceneList,
      go: async id => { this.stopPlaying(); await this.selectScene(id); await this.startPlaying(); },
      restart: async () => { this.stopPlaying(); await this.startPlaying(); },
      world: () => this.world,
      camera: (az, el, dist) => { this.az = az; this.el = el; this.dist = dist * this.options_.zoom; },
      openArsenal: async () => { if (!this.itemScreens?.arsenal.isOpen) await this.toggleArsenal(); },
      arsenalOpen: () => !!this.itemScreens?.arsenal.isOpen,
      colors: () => this.renderer.colors,
      returnToHaven: () => void this.returnToHaven(),
      pause: on => { this.paused = on && !!this.world; },
      focus: () => this.canvas.focus(),
    });
    places.onCreated = () => {
      this.run = { depth: 1, health: null, floors: 0 };
      const haven = this.sceneList.find(s => /haven town square/i.test(s.name)) ?? this.sceneList.find(s => TOWN.test(s.name));
      if (haven) void (async () => { this.stopPlaying(); await this.selectScene(haven.id); await this.startPlaying(); })();
    };
    return places;
  }

  private missions(): MissionBoard {
    this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors);
    return this.missionBoard ??= new MissionBoard({
      data: this.world?.data ?? new GameData(this.loader), gui: this.gui,
      save: () => this.save, write: () => writeSave(this.save), sound: f => this.uiSound(f),
      pause: on => { this.paused = on && !!this.world; },
      startRun: (g, floors) => void this.enterGate(g, floors),
      openGates: () => this.openGates(),
      // the sprite missions (Drakon, Maskeraith, Seraphynx) give the knight that battle sprite
      completed: m => {
        const sprite = /(Drakon|Maskeraith|Seraphynx)/.exec(m.title)?.[1];
        if (sprite) void this.outfit.spriteNames().then(names => {
          const name = names.find(n => n.toLowerCase().includes(sprite.toLowerCase()));
          if (name) this.outfit.setSprite(name);
        });
      },
    });
  }

  /** A simple window in the options' style (news and mail). */
  private showPanel(title: string, fill: (body: HTMLElement) => void) {
    const root = $("gates");
    root.replaceChildren();
    const card = document.createElement("div");
    card.className = "settings-card";
    const head = document.createElement("div");
    head.className = "settings-head";
    const h = document.createElement("h2");
    h.textContent = title;
    const close = document.createElement("button");
    close.textContent = "Close";
    close.onclick = () => { root.hidden = true; this.paused = false; this.uiSound("sound/feedback/ui_dismiss.ogg"); };
    head.append(h, close);
    const body = document.createElement("div");
    body.className = "settings-body";
    fill(body);
    card.append(head, body);
    root.append(card);
    root.hidden = false;
    this.paused = !!this.world;
  }

  /** The news feed: what this port has and lacks (the game's feed came from its servers). */
  private openFeed() {
    this.showPanel("News", body => {
      const items: [string, string][] = [
        ["The Clockworks are open", "Four gates a day in the Arcade, six strata from depth 1 to 28, terminals, Moorcroft Manor, Emberlight and the Core."],
        ["Generated floors", "Floors are built from the game's own tiles, spawners, gates and treasure; the real layouts of levels you have not visited are not in the install."],
        ["Single player", "Parties, trading, PvP and guild chat are online features and are not part of this port."],
      ];
      for (const [t, d] of items) {
        const p = document.createElement("p");
        p.innerHTML = `<b style="color:#f3d36b">${t}</b><br>${d}`;
        body.append(p);
      }
    });
  }

  /** The mailbox: letters kept in the save (a welcome note; missions add their rewards here). */
  private openMail() {
    const mail = this.save.mail ??= [];
    if (!mail.length) mail.push({ from: "Spiral HQ", subject: "Welcome to Haven", at: Date.now(), read: false,
      body: "Welcome, knight. Visit the Bazaar for gear, then take a gate in the Arcade into the Clockworks. Good luck below!" });
    this.showPanel("Mail", body => {
      for (const m of [...mail].reverse()) {
        const d = document.createElement("details");
        d.className = "settings-row";
        d.style.display = "block";
        d.innerHTML = `<summary><b>${m.read ? "" : "● "}${m.subject}</b> <span class="settings-note">from ${m.from}</span></summary><p>${m.body}</p>`;
        d.ontoggle = () => { if (d.open && !m.read) { m.read = true; writeSave(this.save); } };
        body.append(d);
      }
    });
    writeSave(this.save);
  }

  /** The settings menu (filled in by the settings module). */
  private openSettings() { this.paused = !!this.world; void this.openOptions(); }

  private options: OptionsScreen | null = null;

  /** The game's own options window (ui/options), bound to our settings. */
  private async openOptions() {
    this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors);
    this.options ??= new OptionsScreen(this.gui, $<HTMLCanvasElement>("optionsCanvas"), this.options_, {
      changed: () => { saveSettings(this.options_); this.applyOptions(); },
      advanced: tab => this.settings?.open(tab),
      returnToHaven: () => { this.paused = false; void this.returnToHaven(); },
      quit: () => { this.paused = false; this.stopPlaying(); if (GAME) void this.enterTitle(); },
      closed: () => { if (!this.settings?.isOpen) { this.paused = false; this.canvas.focus(); } },
      playing: () => !!this.world,
      sound: f => this.uiSound(f),
    });
    await this.options.open();
  }

  /** Plays a UI feedback sound once audio exists (it starts with the first play). */
  private uiSound(file: string) {
    this.audio ??= new AudioSystem(this.vfs, this.loader);
    this.audio.unlock();
    this.audio.ui(file);
  }

  /** A shopkeeper's stock, by what the NPC's config name says it sells. */
  private async openShop(keeper: string) {
    this.paused = true;
    const eco = await this.economy();
    // in the Clockworks a terminal's keepers stock their tier (Basil sells its recipes, the
    // Supply Depot its supplies); Haven's bazaar shows what progress has unlocked
    const f = this.gate ? this.floors[this.run.depth] : null;
    const tier = f && f.depth > 0 ? f.tier : 0;
    const maxRarity = f ? Math.max(shopTier(this.save), tierStars(f.tier)) : shopTier(this.save);
    const kp = eco.keeper(keeper, { tier, maxRarity });
    // Basil's stock changes each visit (catalogCycle INSTANCE): seeded by the gate and depth
    const stock = eco.catalogue(kp, { seed: (this.gate?.seed ?? 0) + this.run.depth * 7919 + Math.floor(Date.now() / 86400000) });
    await this.ensureScreens().openShop(kp.title, stock, kp.maxRarity);
  }

  /** The economy over the install's configs (prices, levels, variants, recipes). */
  private eco: Economy | null = null;
  private async economy(): Promise<Economy> {
    if (this.eco) return this.eco;
    const data = this.world?.data ?? new GameData(this.loader);
    await data.preload(...ECONOMY_FILES);
    return this.eco ??= new Economy(f => data.library_(f));
  }

  /**
   * Banks a floor's loot: crowns, materials and minerals; gear found joins the arsenal (a
   * duplicate sells for its price); the heat goes into every equipped heatable item, which
   * levels up. Returns lines describing found gear and level-ups.
   */
  private bankLoot(l: World["loot"]): string[] {
    const notes: string[] = [];
    const eco = this.eco ?? this.world?.economy ?? null;
    this.save.crowns += l.crowns;
    this.save.heat += l.heat;
    for (const [k, v] of l.materials) this.save.materials[k] = (this.save.materials[k] ?? 0) + v;
    for (const it of l.items) {
      if (!eco) break;
      if (this.save.owned.includes(it.name)) {
        const paid = eco.sellPrice(it.name);
        this.save.crowns += paid;
        notes.push(`${eco.displayName(it.name, { heat: 0, level: 1, variants: it.variants })} (already owned: sold for ${paid} cr)`);
      } else {
        eco.grant(this.save, it.name, it.variants);
        notes.push(`Found ${eco.displayName(it.name, this.save.gear[it.name])}`);
      }
    }
    if (eco) for (const up of eco.addHeat(this.save, l.heat)) notes.push(`${up.name.split("/").pop()} reached level ${up.level}`);
    return notes;
  }

  /** The knight reached the exit elevator: offer the next floor. */
  private floorCleared() {
    if (!this.world) return;
    // bank what the floor gave
    const l = this.world.loot;
    const notes = this.bankLoot(l);
    this.save.bestDepth = Math.max(this.save.bestDepth, this.run.depth);
    const t = this.runTotals;
    t.kills += this.world.killCount; t.crowns += l.crowns; t.heat += l.heat;
    t.materials += [...l.materials.values()].reduce((a, b) => a + b, 0);
    t.deepest = Math.max(t.deepest, this.run.depth);
    writeSave(this.save);
    this.run.health = this.world.knight.health;
    this.run.floors++;
    if (this.gate) {
      // in a gate: on to the next depth, or ride back up to Haven with the loot banked
      const next = this.floors[this.run.depth + 1];
      this.elevator?.setNext(next ? loadingInfo(next.name, next, this.gate.name) : { title: "Haven", zone: "Home sweet Home", depth: "" });
      $("floorTitle").textContent = `Depth ${this.run.depth} cleared`;
      $("descend").textContent = next ? `Down to ${next.name} (depth ${next.depth})` : "Ride up to Haven";
      $("deeper").textContent = "Return to Haven";
      $("deeper").hidden = !next;
      // an Arcade stratum cleared counts for prestige gate missions of its theme
      const here = this.floors[this.run.depth], s = here?.stratum;
      if (s && here.depth === s.last && !this.gate.id.startsWith("mission:")) { const b = this.missions(); void b.load().then(() => b.stratumCleared(s.theme)); }
    } else {
      const last = this.nextLevel() === null;
      const nl = this.nextLevel();
      this.elevator?.setNext(nl ? { ...loadingInfo(nl.name, null), depth: `DEPTH ${this.run.depth + 1}` } : { title: "Haven", zone: "Home sweet Home", depth: "" });
      $("floorTitle").textContent = last ? "Back to Haven" : `Depth ${this.run.depth} cleared`;
      $("descend").textContent = last ? "Ride up to Haven" : "Take the elevator down";
      // past the Core the Clockworks go on: cycle the levels again, deeper
      $("deeper").hidden = !last || this.run.depth >= 29;
    }
    const mats = [...l.materials.values()].reduce((a, b) => a + b, 0);
    $("floorInfo").textContent = `${this.world.killCount} monsters defeated, ${l.crowns} crowns, ${l.heat} heat, ${mats} materials.`
      + (notes.length ? ` ${notes.join(". ")}.` : "");
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
    const notes = this.bankLoot(l);
    l.crowns = 0; l.heat = 0; l.materials.clear(); l.items.length = 0;
    writeSave(this.save);
    this.paused = true;
    $("floorTitle").textContent = `Arena: wave ${wave} cleared`;
    this.elevator?.setNext({ title: "Arena", zone: `Wave ${wave + 1} awaits`, depth: "" });
    $("floorInfo").textContent = `Loot banked. You have ${this.save.crowns} crowns.` + (notes.length ? ` ${notes.join(". ")}.` : "");
    $("descend").textContent = "Ride up to Haven";
    $("deeper").textContent = "Fight on";
    $("deeper").hidden = false;
    $("floorDone").hidden = false;
  }

  /** Crowns a revive costs: more the deeper the knight is (towns are free). */
  private reviveScreen: ReviveScreen | null = null;

  /** The knockout window: use a Spark of Life, or buy one with crowns. */
  private async openRevive() {
    this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors);
    const sparkView = new PortraitView(this.renderer, this.loader, undefined, null);
    this.reviveScreen ??= new ReviveScreen(this.gui, $<HTMLCanvasElement>("reviveCanvas"), {
      sparks: () => this.save.sparks ?? 3,
      price: () => this.reviveCost(),
      crowns: () => this.save.crowns,
      use: () => {
        const n = this.save.sparks ?? 3;
        if (n <= 0 || !this.world) return false;
        this.save.sparks = n - 1;
        writeSave(this.save);
        this.world.revive();
        $("defeated").hidden = true;
        this.uiSound("sound/feedback/ui_confirm.ogg");
        this.canvas.focus();
        return true;
      },
      buy: () => {
        const cost = this.reviveCost();
        if (this.save.crowns < cost) return false;
        this.save.crowns -= cost;
        this.save.sparks = (this.save.sparks ?? 3) + 1;
        writeSave(this.save);
        return true;
      },
      sound: f => this.uiSound(f),
    }, { view: (c, g, x, y, w, h) => sparkView.draw(c, g, x, y, w, h) });
    await this.reviveScreen.open();
  }

  private reviveCost() { return TOWN.test(this.scene?.name ?? "") ? 0 : 25 * Math.max(1, this.run.depth); }

  private async returnToHaven() {
    // the end of a gate run: a summary of what it brought home
    const t = this.runTotals;
    const summary = this.gate || t.deepest ? { ...t, best: this.save.bestDepth } : null;
    this.gate = null;
    this.runTotals = { kills: 0, crowns: 0, heat: 0, materials: 0, deepest: 0, gate: "" };
    this.stopPlaying();
    this.run = { depth: 0, health: null, floors: 0 };
    const haven = this.sceneList.find(s => /haven town square/i.test(s.name)) ?? this.sceneList.find(s => TOWN.test(s.name));
    if (!haven) return;
    await this.selectScene(haven.id);
    await this.startPlaying();
    if (summary && summary.deepest > 0) {
      this.showPanel("Back in Haven", body => {
        const rows: [string, string][] = [["Gate", summary.gate || "The Clockworks"], ["Deepest depth this run", String(summary.deepest)],
          ["Deepest depth ever", String(summary.best)], ["Monsters defeated", String(summary.kills)],
          ["Crowns banked", String(summary.crowns)], ["Heat earned", String(summary.heat)], ["Materials and items", String(summary.materials)]];
        for (const [k, v] of rows) {
          const r = document.createElement("div");
          r.className = "settings-row";
          r.innerHTML = `<span>${k}</span><b>${v}</b><span></span>`;
          body.append(r);
        }
      });
    }
  }

  /** The cached levels in run order. */
  // ------------------------------------------------------------------ the Arcade and its gates

  private gateBoard_: GateBoard | null = null;
  /** The Arcade's gate board (the game's adventure board, src/ui/gates.ts). */
  get gateBoard(): GateBoard {
    this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors);
    return this.gateBoard_ ??= new GateBoard(this.gui, {
      sound: f => this.uiSound(f),
      closed: () => { this.paused = false; this.canvas.focus(); },
      gates: () => arcadeGates(),
      progress: () => progressOf(this.save),
      enter: g => void this.enterGate(g),
      arena: () => void this.enterArena(),
      missions: () => void this.missions().open(),
    });
  }

  /**
   * The Arcade's gate board: today's four gates and the Arena, each gate's lineup on the
   * map with its level and theme icons, as the game's adventure board draws them.
   */
  private openGates() {
    this.paused = !!this.world;
    void this.gateBoard.open();
  }

  /** Starts a gate at depth 1. */
  private async enterGate(g: Gate, floors = gateFloors(g)) {
    this.gate = g;
    this.runTotals = { kills: 0, crowns: 0, heat: 0, materials: 0, deepest: 0, gate: g.name };
    this.usedScenes.clear();
    this.floors = floors;
    this.arenaMode = false;
    // the descent starts above the first floor (a mission's floors start deeper)
    this.run = { depth: Math.max(0, floors.findIndex(f => f && f.depth > 0) - 1), health: null, floors: 0 };
    await this.descend();
  }

  /**
   * The scene for a floor of the gate. Terminals, subtowns and the Core use the cached town
   * scenes; levels use a cached level of the stratum's style when there is one not yet played
   * this run, else a generated floor painted with the style's tileset and re-themed with the
   * stratum's monsters. Boss floors are generated arenas with the boss waiting by the exit.
   */
  private floorScene(f: Floor): { id: string; name: string } | null {
    const cached = (re: RegExp) => this.sceneList.find(s => re.test(s.name));
    if (f.kind === "terminal") return cached(/^terminal 1$/i) ?? null;
    if (f.kind === "core") return cached(/^terminal core$/i) ?? cached(/^terminal 1$/i) ?? null;
    if (f.kind === "subtown" && f.depth === 18) return cached(/^emberlight$/i) ?? cached(/^terminal 1$/i) ?? null;
    if (f.kind === "subtown") {
      // Moorcroft Manor is not in the cache: a generated town in the graveyard's tiles
      const id = `gen:${genTheme("graveyard")}:${((this.gate?.seed ?? 1) + 8) >>> 0}`;
      this.safeGen.add(id);
      this.genNames.set(id, "Moorcroft Manor");
      return { id, name: "Moorcroft Manor" };
    }
    const s = f.stratum!;
    if (f.kind === "level" && s.style.cached && !f.special) {
      const options = this.sceneList.filter(sc => s.style.cached!.test(sc.name) && !this.usedScenes.has(sc.id));
      if (options.length && Math.random() < 0.5) { this.usedScenes.add(options[0].id); return options[0]; }
    }
    const theme = genTheme(f.tileset);
    const seed = ((this.gate?.seed ?? 1) * 31 + f.depth * 977 + this.save.runs * 7919) >>> 0;
    const id = `gen:${theme}:${seed}`;
    this.genTables.set(id, stratumTables(s.theme, rng(seed)));
    this.genNames.set(id, f.kind === "boss" ? f.name : `${f.name} · ${s.theme}`); // no parentheses: TOWN matches "("
    if (f.special) this.genStyles.set(id, f.special);
    return { id, name: `${f.name} · depth ${f.depth}` };
  }
  private usedScenes = new Set<string>();

  /** A boss floor: the boss's actors wait by the exit elevator, which stays shut until they fall. */
  private spawnBoss(key: BossKey) {
    const w = this.world, scene = this.scene;
    if (!w || !scene) return;
    const exit = scene.logic.find(l => /Elevator\/Next Floor/.test(l.name));
    const [x, y] = exit ? [exit.x, exit.y] : [w.knight.x + 6, w.knight.y];
    BOSSES[key].actors.forEach((name, i) => {
      const spot = scene.collision.findSpawn(x + (i ? 4 : -2), y + 2, 1.5, 43) ?? [x, y];
      w.spawnAt({ name }, spot[0], spot[1], Math.atan2(w.knight.y - spot[1], w.knight.x - spot[0]));
    });
  }

  /** The boss of this floor is still standing. */
  private bossAlive(): boolean {
    const w = this.world;
    if (!w || !this.bossFloor) return false;
    return w.liveMonsters.some(m => /\/Boss\//.test(m.entity?.name ?? "")) || w.logic.actors.some(e => !e.destroyed && /\/Boss\//.test(e.name) && e.mobile);
  }

  private runLevels(): { id: string; name: string }[] {
    const levels = RUN_ORDER.map(n => this.sceneList.find(s => s.name.toLowerCase().startsWith(n))).filter((s): s is { id: string; name: string } => !!s);
    // levels in the cache that the order does not name come before the Core
    for (const s of this.sceneList) if (!TOWN.test(s.name) && !levels.includes(s)) levels.splice(levels.length - 1, 0, s);
    return levels;
  }

  /**
   * The run: each cached combat level followed by a generated floor of its theme (a new
   * layout every run), ending at the Core.
   */
  private runPlan(): { id: string; name: string }[] {
    const out: { id: string; name: string }[] = [];
    this.runLevels().forEach((s, i) => {
      out.push(s);
      const t = themeOf(s.name);
      if (t && !/core/i.test(s.name)) out.push({ id: `gen:${t.key}:${(this.save.runs * 97 + i * 13 + 1) >>> 0}`, name: `${t.label} · new floor` });
    });
    return out;
  }

  private nextLevel(): { id: string; name: string } | null {
    const levels = this.runPlan();
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
    if (this.gate) {
      // the gate's next floor (after the Core's terminal, back to Haven)
      const f = this.floors[this.run.depth + 1];
      this.stopPlaying();
      if (!f) {
        const id = this.gate.id;
        this.gate = null; this.save.runs++; writeSave(this.save); await this.returnToHaven();
        this.missionBoard?.runFinished(id);
        return;
      }
      // deeper tiers need rank (missions take the knight to their own depth)
      const lock = this.gate.id.startsWith("mission:") ? null : tierLock(f.tier, progressOf(this.save));
      if (lock) { this.gate = null; await this.returnToHaven(); notice(lock); return; }
      const sc = this.floorScene(f);
      if (!sc) { this.status(`No scene for ${f.name}`, true); return; }
      this.run.depth = f.depth;
      this.bossFloor = f.kind === "boss" ? f.stratum!.boss : null;
      await this.selectScene(sc.id);
      await this.startPlaying();
      if (this.bossFloor) this.spawnBoss(this.bossFloor);
      // terminals and subtowns are safe floors: the knight is healed on arrival
      if ((f.kind === "terminal" || f.kind === "subtown" || f.kind === "core") && this.world) {
        this.world.knight.health = this.world.knight.maxHealth;
        this.run.health = null;
      }
      return;
    }
    let next = this.nextLevel();
    // past the end of the run, deeper floors are generated
    if (deeper && !next) {
      // any tileset theme whose source levels are cached (src/gen/themes.ts)
      const usable = GEN_THEMES.filter(t => themeAvailable(t.key, this.sceneList));
      const t = usable[Math.floor(Math.random() * usable.length)];
      next = t ? { id: `gen:${t.key}:${Math.floor(Math.random() * 1e9)}`, name: `${t.label} · new floor` } : this.runLevels()[0] ?? null;
    }
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
    const on = (a: Action) => k.has(this.bound(a));
    const f = (on("up") || k.has("arrowup") ? 1 : 0) - (on("down") || k.has("arrowdown") ? 1 : 0);
    const r = (on("right") || k.has("arrowright") ? 1 : 0) - (on("left") || k.has("arrowleft") ? 1 : 0);
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
      // clicks on the HUD's menus go to the HUD, not the sword
      if (this.world && this.gameHud && e.button === 0) {
        const r = c.getBoundingClientRect(), s = this.options_.hudScale;
        const x = (e.clientX - r.left) / s, y = (e.clientY - r.top) / s;
        if (this.gameHud.covers(x, y)) {
          const tag = this.gameHud.pointer(x, y, true);
          if (tag && tag !== "handle") this.hudAction(tag);
          else if (tag === "handle") this.uiSound("sound/feedback/ui_dropdown_activate.ogg");
          return;
        }
      }
      // furniture mode: clicks place, pick up and drop furniture instead of attacking
      if (this.world && this.places.pointerDown(e.button)) return;
      if (this.world && (e.button === 0 || e.button === 2)) {
        // play mode: left attacks (hold to charge), right raises the shield
        // Shift + right click dashes (the game's default binding); right click alone shields
        if (e.button === 0) { this.attackPressed = true; this.attackHeld = true; }
        else if (e.shiftKey) this.dashPressed = true;
        else this.shieldHeld = true;
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
      // hovering the HUD's buttons
      const s = this.options_.hudScale;
      if (this.gameHud) { this.gameHud.pointer(this.mouse[0] / s, this.mouse[1] / s, false); c.style.cursor = this.gameHud.covers(this.mouse[0] / s, this.mouse[1] / s) ? "pointer" : ""; }
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
    const c = this.canvas, dpr = Math.min(2, devicePixelRatio || 1) * this.options_.renderScale;
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    if (this.instance || this.sceneItems) {
      if (!this.paused) {
        if (this.instance) this.instance.time += dt;
        // shared instances appear in several placements; advance each clock once per frame
        for (const it of this.sceneItems ?? []) it.instance.time += dt / (this.shares.get(it.instance) ?? 1);
      }
      // the title screen's camera drifts slowly around the town
      if (!this.world && this.title?.visible) this.az += dt * 0.04;
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
            shield: this.shieldHeld || !!pad?.shield, aim, weaponSlot: this.weaponSlot,
            interact: this.interactPressed || !!pad?.interact, dash: this.dashPressed || !!pad?.dash,
          });
          this.dashPressed = false;
          this.weaponSlot = null;
          this.interactPressed = false;
        }
        this.attackPressed = false;
        // Q and E turn the camera; it follows the knight smoothly
        if (this.keys.has(this.bound("turnLeft"))) this.az += dt * this.options_.cameraSpeed;
        if (this.keys.has(this.bound("turnRight"))) this.az -= dt * this.options_.cameraSpeed;
        const k = this.world.knight;
        const f = 1 - Math.exp(-dt * 10);
        this.target = [this.target[0] + (k.x - this.target[0]) * f, this.target[1] + (k.y - this.target[1]) * f,
          this.target[2] + (k.z + 1 - this.target[2]) * f];
        if ($("defeated").hidden === this.world.defeated) {
          $("defeated").hidden = !this.world.defeated;
          // the game's revive window (Sparks of Life); in town the knight simply gets up
          if (this.world.defeated) {
            if (TOWN.test(this.scene?.name ?? "")) { this.world.revive(); $("defeated").hidden = true; }
            else void this.openRevive();
          } else this.reviveScreen?.close();
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
        const fogOn = $<HTMLInputElement>("fog").checked && this.options_.fog;
        if (env.fog && (!fogOn || env.camera)) {
          const shift = Math.max(0, this.dist - (env.camera?.distance ?? this.dist));
          env = { ...env, fog: fogOn ? { ...env.fog, start: env.fog.start + shift, end: env.fog.end + shift } : null };
        }
        const items = this.world ? [...this.sceneItems, ...this.world.items(), ...this.places.items()] : this.sceneItems;
        this.renderer.drawAll(items, proj, view, env, this.skyboxes);
        if (this.scene && this.options_.decals) this.renderer.drawDecals(this.sceneDecals(), proj, view, env.shadow ?? [0, 0.08, 0.1, 0.4]);
        this.places.drawMarks(this.renderer, proj, view);
        if (this.world && this.options_.shadows) this.renderer.drawShadows(this.world.shadows(), proj, view, env.shadow ?? [0, 0.08, 0.1, 0.4]);
        this.lastProj = proj;
        this.lastView = view;
        if (this.world && this.hud) {
          const gh = this.gameHud;
          gh?.minimap.setWorld(this.world);
          gh?.update({ ...hudState(this.world, knightName(this.save), this.floorLabel()), ...this.hudContext(), rank: rankLabel(progressOf(this.save)) }, dt);
          this.hud.draw(this.world, proj, view, gh ? (g, cw, ch) => gh.draw(g, cw, ch) : undefined);
        }
      }
      else this.renderer.draw(this.instance!, proj, view);
    }
    requestAnimationFrame(this.frame);
  };
}

start();

/** The scenes cache, for genTheme's availability check (set once scenes are listed). */
let genScenes: { id: string; name: string }[] | null = null;

/** Generator themes for a floor's tileset (src/gen); unknown tilesets fall back by family. */
function genTheme(tileset: string): string {
  const known = GEN_THEMES.map(t => t.key);
  if (known.includes(tileset) && (!genScenes || themeAvailable(tileset, genScenes))) return tileset;
  if (/^valley/.test(tileset) && known.includes("valley")) return "valley";
  return known.includes("clockworks") ? "clockworks" : known[0];
}

/** Points every Single Spawn marker of a generated root at the stratum's spawn tables. */
function retheme(root: any, tables: string[], rand: () => number) {
  // one table per room (spawners of a room share their Spawn Tag)
  const byTag = new Map<string, string>();
  for (const e of root.entries ?? []) {
    const args: [string, any][] | undefined = e.placeable?.arguments?.entries;
    if (!args || !/Single Spawn/.test(e.placeable?.name ?? "")) continue;
    const tag = String(args.find(([k]) => k === "Spawn Tag")?.[1] ?? "");
    if (!byTag.has(tag)) byTag.set(tag, tables[Math.floor(rand() * tables.length)]);
    const i = args.findIndex(([k]) => k === "Spawn Table");
    const old = i >= 0 ? args[i][1] : null;
    const wave = (old?.arguments?.entries as [string, any][] | undefined)?.find(([k]) => k === "Wave Tag")?.[1] ?? "(Wave Tag)";
    const table = { $class: "com.threerings.config.ConfigReference", name: byTag.get(tag)!,
      arguments: { $map: "com.threerings.config.ArgumentMap", entries: [["Depth Offset", 0], ["Loot", "Primary"], ["Wave Tag", wave]] } };
    if (i >= 0) args[i] = ["Spawn Table", table]; else args.push(["Spawn Table", table]);
  }
}

/** Walkable cells of a generated root ("x,y"), from its tiles' configs. */
function walkableCells(root: any, info: (ref: any) => TileInfo): Set<string> {
  const { refs, cells } = decodeTiles(root);
  const out = new Set<string>();
  for (const [k, c] of cells) {
    const t = info(refs[c.tile]);
    if (!t.walkable) continue;
    const [x, y] = k.split(",").map(Number);
    const [w, h] = c.rot & 1 ? [t.height, t.width] : [t.width, t.height];
    for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) out.add((x + dx) + "," + (y + dy));
  }
  return out;
}

const SIGNAL = "com.threerings.tudey.config.ActionConfig$Signal";
const TAGGED = "com.threerings.tudey.config.TargetConfig$Tagged";
const REF = "com.threerings.config.ConfigReference";
const signal = (name: string, tag: string) => ({ $class: SIGNAL, name, target: { $class: TAGGED, tag } });
const argMap = (entries: [string, unknown][]) => ({ $map: "com.threerings.config.ArgumentMap", entries });
const placeEntry = (id: number, name: string, args: [string, unknown][], x: number, y: number, rotZ = 0) => ({
  $class: "com.threerings.tudey.data.TudeySceneModel$PlaceableEntry", id,
  placeable: { $class: REF, name, arguments: argMap(args) },
  transform: { $class: "com.threerings.math.Transform3D", translation: { $class: "com.threerings.math.Vector3f", x, y, z: 0 },
    rotation: { $class: "com.threerings.math.Quaternion", x: 0, y: 0, z: Math.sin(rotZ / 2), w: Math.cos(rotZ / 2) }, scale: 1 },
});

/**
 * The game's arena pattern for each encounter room of a generated floor: Iron Gates (Monster)
 * stand open in every corridor mouth; entering closes them and wakes the first wave; when the
 * first wave is gone ("Trigger/Actor Removed") the second wakes; when it is gone the gates open.
 */
function arenaRooms(root: any, walkable: (x: number, y: number) => boolean) {
  const entries: any[] = root.entries ?? [];
  let id = entries.reduce((m, e) => Math.max(m, e.id ?? 0), 0) + 1;
  const tagOf = (e: any, key: string) => (e.placeable?.arguments?.entries as [string, any][] | undefined)?.find(([k]) => k === key)?.[1];
  for (const area of entries.filter(e => e.area?.name === "Player Enter/Spawn Activate")) {
    const trigger = (area.area.arguments?.entries as [string, any][]).find(([k]) => k === "Trigger Action");
    const spawnTag: string | undefined = trigger?.[1]?.target?.tag;
    if (!trigger || !spawnTag?.startsWith("gen spawn ")) continue;
    const n = spawnTag.slice("gen spawn ".length), doorTag = `gen door ${n}`;
    // the area is the room inset by a cell
    const xs = area.vertices.map((v: any) => v.x), ys = area.vertices.map((v: any) => v.y);
    const rx = Math.min(...xs) - 1, ry = Math.min(...ys) - 1, rw = Math.max(...xs) + 1 - rx, rh = Math.max(...ys) + 1 - ry;
    // corridor mouths: runs of walkable cells just outside each side
    const doors: { x: number; y: number; rot: number }[] = [];
    const side = (cells: [number, number][], rot: number) => {
      let run: [number, number][] = [];
      const flush = () => {
        if (run.length) { const m = run[Math.floor(run.length / 2)]; doors.push({ x: m[0] + 0.5, y: m[1] + 0.5, rot }); }
        run = [];
      };
      for (const c of cells) { if (walkable(c[0], c[1])) run.push(c); else flush(); }
      flush();
    };
    const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);
    side(range(rx, rx + rw).map(x => [x, ry + rh] as [number, number]), 0);
    side(range(rx, rx + rw).map(x => [x, ry - 1] as [number, number]), 0);
    side(range(ry, ry + rh).map(y => [rx - 1, y] as [number, number]), Math.PI / 2);
    side(range(ry, ry + rh).map(y => [rx + rw, y] as [number, number]), Math.PI / 2);
    if (!doors.length) continue;
    for (const d of doors) entries.push(placeEntry(id++, "Dynamic/Door/Iron Gate/Monster 3", [["Open", true], ["Tag", doorTag]], d.x, d.y, d.rot));
    // entering: close the gates, wake wave one
    trigger[1] = { $class: "com.threerings.tudey.config.ActionConfig$Compound", actions: [signal("close", doorTag), signal("activate", spawnTag)] };
    // half the spawners become a second wave
    const spawners = entries.filter(e => /Single Spawn/.test(e.placeable?.name ?? "") && tagOf(e, "Spawn Tag") === spawnTag);
    const wave1 = `gen wave ${n}`, wave2 = `gen wave ${n}b`, spawn2 = `${spawnTag}b`;
    spawners.forEach((e, i) => {
      if (i % 2 === 0 || spawners.length < 3) return;
      const args: [string, any][] = e.placeable.arguments.entries;
      args.forEach(a => { if (a[0] === "Spawn Tag") a[1] = spawn2; });
      const table = args.find(a => a[0] === "Spawn Table")?.[1];
      const targs: [string, any][] | undefined = table?.arguments?.entries;
      targs?.forEach(a => { if (a[0] === "Wave Tag") a[1] = wave2; });
    });
    const hasSecond = spawners.length >= 3;
    const cx = rx + rw / 2, cy = ry + rh / 2;
    if (hasSecond) entries.push(placeEntry(id++, "Trigger/Actor Removed", [["Action", signal("activate", spawn2)], ["Actor Tag", wave1]], cx, cy));
    entries.push(placeEntry(id++, "Trigger/Actor Removed", [["Action", signal("open", doorTag)], ["Actor Tag", hasSecond ? wave2 : wave1]], cx + 1, cy));
  }
}
