import { lookAt, perspective, type Vec3 } from "./math";
import { loadAnimation, ModelLoader, nodeMatrix, type LoadedModel } from "./model";
import type { FloorLift } from "./game/collision";
import { Renderer, type ModelInstance, type SkyboxItem } from "./render/renderer";
import { SceneLoader, sceneName, type LoadedScene } from "./scene";
import { ColorPository } from "./colors";
import { loadEnvironment, readCamera, VIEWER_ENVIRONMENT, type CameraView, type Environment } from "./environment";
import { multiply as multiplyMat, toMatrix, type Mat4 } from "./math";
import { World } from "./game/world";
import { Hud } from "./game/hud";
import { GuiContext, messageText, type MenuEntry } from "./ui/gui";
import { choosePlace, TabIcon, type PlaceState } from "./ui/favicon";
import { guildOf } from "./game/guild";
import { GameHud, hudState } from "./ui/hud";
import { PortraitView } from "./ui/portrait";
import { AudioSystem } from "./audio";
import { Gamepads } from "./gamepad";
import { catalogue } from "./game/items";
import { addKnight, deleteKnight, energyOf, gameRoster, knightName, loadSave, namedKnights, saveRoster, selectKnight, shopTier, writeSave, type SaveData } from "./game/save";
import { energyNow, exchangeCost, payEnergy, spendEnergy, SPARK_COST } from "./game/energy";
import type { Difficulty } from "./game/depth";
import { difficultyPref } from "./game/difficulty";
import { ECONOMY_FILES, Economy } from "./game/economy";
import { Places } from "./ui/places";
import { GameScreens } from "./ui/screens";
import { GameData } from "./game/data";
import { TitleScreen } from "./ui/title";
import { PickScreen, type KnightCard } from "./ui/pick";
import { PrologueScreen } from "./ui/prologue";
import { dressArgs, emptyAppearance, resolveDressing } from "./game/accessories";
import { faceArgs } from "./game/creator";
import { Outfit } from "./game/outfit";
import { LoadingScreen, loadingInfo } from "./ui/loading";
import { ElevatorScreen, type HeatReport, type HeatRow, type PrizeWheel } from "./ui/elevator";
import { ChatLog, shouldReportLoot } from "./game/lootlog";
import { buildReel, floorHasWheel, type Prize } from "./game/prizewheel";
import { GateBoard } from "./ui/gates";
import { GateSource } from "./game/gatesource";
import { lockNext } from "./game/gatemap";
import { RunSummaryScreen } from "./ui/runsummary";
import { ReportScreen } from "./ui/report";
import { MusicPlayer } from "./game/musicplayer";
import { spawnsMusic } from "./game/musicstack";

/** The game app (title screen, no asset browser); the asset viewer is at #viewer (and #dev=1 for tests). */
const GAME = !/viewer|dev=1/.test(location.hash);
import { ACTIONS, commandKeys, gameKeyName, keyName, loadSettings, saveSettings, uiScale, type Action, type Settings } from "./ui/settings";
import { hasMessage, loadMessages, message, messages, text } from "./i18n";
import { itemName, itemType, levelText } from "./game/text";
import { OptionsScreen } from "./ui/options";
import { ReviveScreen } from "./ui/revive";
import { pad as padOptions } from "./gamepad";
import { generateLevel, type TileInfo } from "./gen/level";
import { bossArena, startBossFight, type BossFight } from "./game/bosses";
import { addFeatures, layoutFor, type FeatureReport, type FloorStyle } from "./gen/features";
import { THEMES as GEN_THEMES, themeAvailable, themeLevel } from "./gen/themes";
import { decodeTiles } from "./gen/autotile";
import { bossName, BOSSES, gateFloors, realFloor, stratumTables, tierStars, type BossKey, type Floor, type Gate } from "./game/clockworks";
import { rng } from "./gen/layout";
import { LevelArchive } from "./game/archive";
import { assemble, assembledRoot, libraryPieces, type LibPiece } from "./gen/assemble";
import { lairRun, missionRun, rankLabel, tierLock } from "./game/missions";
import { LAIR_GATES } from "./game/missionfloors";
import type { Prop } from "./game/props";
import { MissionBoard, notice, progressOf } from "./ui/missions";
import { currentNotice, initNotices } from "./ui/notice";
import {
  ACHIEVEMENTS, evaluate as evaluateAchievements, recordBoss, recordDepth, recordHaven, recordKills, recordPocketUse, recordRescueCamp, recordRevive,
  recordRunEnd, recordRunStart, type AchievementType,
} from "./game/achievements";
import { UplinkScreen, mailbox } from "./ui/uplink";
import { EventHubScreen } from "./ui/eventhub";
import { FEED_BOSS, logFeed } from "./game/feed";
import { TooSmallWarning } from "./ui/toosmall";
import { itemTip } from "./ui/itemlist";
import { cachedHallId, crashSiteScene, CREATE_KNIGHT, GUILD_HALL, READY_ROOM, rescueCampScene } from "./game/places";
import { HelpScreen, type HelpTab } from "./ui/help";
import { SocialScreen } from "./ui/social";
import { arrivalPoint, exitTarget, type PortalInfo } from "./game/portals";
import { readConversation } from "./game/conversation";
import { ConversationScreen } from "./ui/conversation";
import { Balloons } from "./ui/balloons";
import { rangeRoot, rangeSpawn, TEST_RANGE } from "./dev/rangescene";
import type { TestRange } from "./dev/testrange";

/**
 * Towns: safe places where the knight walks unarmed, with the town HUD. Lobbies are not towns:
 * the client's LOBBY levels (the Arcade's party lobby, the Mission Lobby, a mission's own lobby)
 * are dungeon levels (DungeonCodes.LevelType.LOBBY: safe, but the knight is armed, the dungeon
 * HUD shows and the map is FULL).
 */
const TOWN = /haven|bazaar|^hall|ready room|crash site|rescue camp/i;
/** The lobbies (dungeon levels of type LOBBY): no monsters, never a floor of the legacy run. */
const LOBBY = /lobby/i;
/** The Rescue Camp's scenes (the archive's "rescue camp central", "rescue camp state 1"...). */
const RESCUE_CAMP = /^rescue camp/i;
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
/** Generated floor ids: "gen:<theme>:<seed>", or "gen:<theme>:<seed>:<boss>" for a boss arena. */
const GEN = /^gen:([a-z-]+):(\d+)(?::([a-z]+))?$/;

import { invert } from "./math";
import {
  canPickDirectory, DevServerVfs, FileListVfs, HandleVfs, recallHandle, rememberHandle, VfsError, type Vfs,
} from "./vfs";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- choosing the install

async function start() {
  if (!GAME) {
    document.title = "Clyde Web Viewer";
    document.querySelector("#welcome h1")!.textContent = "Clyde Web Viewer";
    $("welcomeIntro").textContent = "A browser viewer for models built with Three Rings' open-source Clyde engine. " +
      "It reads models straight from your own game install. Files stay on your computer and are never uploaded.";
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
  // the asset viewer (#viewer) goes back to the game: the log-on screen at the page's plain address
  $("backToGame").onclick = () => { location.hash = ""; history.replaceState(null, "", location.pathname + location.search); location.reload(); };
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
  if (location.hash.includes("dev=1") && !$("dev").hidden) return void await open(async () => new DevServerVfs());
  if (GAME) {
    // the game never asks for its install: the local server (npm start, or the dev server)
    // finds it and serves it; without one the page explains how to start the game
    if (!$("dev").hidden) return void await open(async () => new DevServerVfs());
    bootStatus(null);
    $("welcome").querySelector(".actions")!.remove();
    $("welcome").querySelectorAll(".hint").forEach(h => h.remove());
    $("welcomeIntro").innerHTML = "Spiral Knights wasn't found on this computer.<br><br>Start the game with <code>npm start</code>: " +
      "it finds your install (Steam or the standalone installer) by itself. If the game is somewhere unusual, " +
      "set <code>SK_DIR</code> to its folder first.";
  }
  $("welcome").classList.add("ready");
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

/** The loading screen's status line (index.html #boot); null text hides it once the game shows. */
export function bootStatus(text: string | null) {
  const el = document.getElementById("boot");
  if (!el) return;
  if (text === null) { el.classList.add("done"); setTimeout(() => el.remove(), 500); return; }
  const t = document.getElementById("bootText");
  if (t) t.textContent = text;
}

async function open(make: () => Promise<Vfs>) {
  try {
    $("welcomeError").hidden = true;
    bootStatus("Finding your Spiral Knights install…");
    const vfs = await make();
    bootStatus("Reading the game's files…");
    const files = await vfs.list();
    if (!files.some(f => f.endsWith(".dat"))) throw new VfsError("No .dat files were found in that folder.");
    // the game's text, from the install's message bundles (our own English where they are missing)
    bootStatus("Loading the game's text…");
    await loadMessages(vfs, loadSettings().locale).catch(() => 0);
    bootStatus("Loading the log-on screen…");
    $("welcome").hidden = true;
    $("app").hidden = false;
    new Viewer(vfs, files);
  } catch (e) {
    bootStatus(null);
    showWelcomeError((e as Error).message);
  }
}

// ---------------------------------------------------------------- viewer

const LIKELY_MODEL = /(^|\/)model[^/]*\.dat$/;
const NOT_ANIMATION = /(^|\/)(model|fx_|particle|ambient_|bullet_|bomb_|aoe_|meta_|compound_|conditional_|modelset)[^/]*\.dat$/;

/** The scene globals with every "Variant" TierN choice set to the given tier. */
export function retierGlobals(globals: any[], tier: number): any[] {
  const retier = (ref: any): any => {
    const entries = ref?.arguments?.entries as [string, unknown][] | undefined;
    if (!entries?.some(([k, v]) => k === "Variant" && typeof v === "string" && /^Tier[123]$/.test(v))) return ref;
    return { ...ref, arguments: { ...ref.arguments, entries: entries.map(([k, v]) => [k, k === "Variant" && typeof v === "string" && /^Tier[123]$/.test(v) ? `Tier${tier}` : v]) } };
  };
  return globals.map(g => (g?.sceneGlobal ? { ...g, sceneGlobal: retier(g.sceneGlobal) } : retier(g)));
}

class Viewer {
  private readonly loader: ModelLoader;
  private readonly renderer: Renderer;
  private readonly canvas = $<HTMLCanvasElement>("canvas");
  private instance: ModelInstance | null = null;
  private sceneItems: { instance: ModelInstance; matrix: Mat4; lift?: FloorLift }[] | null = null;
  private environment: Environment = VIEWER_ENVIRONMENT;
  private scene: LoadedScene | null = null;
  private world: World | null = null;
  private hud: Hud | null = null;
  private gameHud: GameHud | null = null;
  private readonly options_: Settings = loadSettings();
  /** The key bound to an action (options menu). */
  private bound(a: Action) { return this.options_.keys[a] ?? ACTIONS[a].key; }
  private gui: GuiContext | null = null;
  private audio: AudioSystem | null = null;
  private save: SaveData = loadSave();
  /** The guild hall and furniture, the Ready Room and knight creation (src/ui/places.ts). */
  private readonly places: Places;
  /** The browser tab's icon and title, following where the knight is (src/ui/favicon.ts). */
  private readonly tab = new TabIcon(() => this.gui);
  /** The battle sprite, accessories and costumes (game/outfit.ts); missions call outfit.setSprite. */
  private outfit_: Outfit | null = null;
  get outfit() { return this.outfit_ ??= new Outfit(this.loader, () => this.save, () => writeSave(this.save)); }
  /** Scenes in the install's cache, by name. */
  private sceneList: { id: string; name: string }[] = [];
  /** The archive's Clockworks levels, boss stages, terminals and subtowns (src/game/archive.ts). */
  private archive = new LevelArchive([]);
  /** Every scene id the archive and cache hold (named or not yet: exits lead to them by id). */
  private sceneIds = new Set<string>();
  /** The current run through the Clockworks: depth, and the knight's health between floors. */
  private run = { depth: 1, health: null as number | null, floors: 0 };
  /** Totals for the current gate run, for the summary when it ends. */
  private runTotals = { kills: 0, crowns: 0, heat: 0, materials: 0, deepest: 0, gate: "", notes: [] as string[] };

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
  /** Floors built from the game's prefab rooms: the generator theme to paint instead if they cannot be. */
  private genFallback = new Map<string, string>();
  /** The prefab rooms cut out of the captured floors, per style and status (src/gen/prefabs.ts). */
  private prefabLibs = new Map<string, Promise<LibPiece[]>>();
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
  /** The mouse-move scheme's left button: run toward the pointer. */
  private mouseMoveHeld = false;
  private bashPressed = false;
  private readonly pads = new Gamepads();
  private shieldHeld = false;
  /** Mouse position over the canvas in CSS pixels, for aiming. */
  private mouse: [number, number] | null = null;
  private lastProj: Mat4 | null = null;
  private lastView: Mat4 | null = null;
  private readonly keys = new Set<string>();
  private skyboxes: SkyboxItem[] = [];
  private readonly sceneLoader: SceneLoader;
  private readonly instances = new Map<LoadedModel, Promise<ModelInstance>>();
  private shares = new Map<ModelInstance, number>();
  private model: LoadedModel | null = null;
  private readonly datFiles: string[];
  private az = -0.6; private el = 0.35; private dist = 3;
  /** Vertical field of view: the scene camera's in play (60 degrees by default), ours elsewhere. */
  private fov = 0.75;
  /**
   * Play mode's camera (TudeySceneView): locked on the knight plus the config's offset, at the
   * scene camera's coordinates; the zoom toggle (=) picks a scene's closer camera, easing there
   * over 1.5 s (QuadraticOut), as the client's TOGGLE_ZOOM does.
   */
  private cam: { views: CameraView[]; zoom: number; from: CameraView; to: CameraView; t: number } | null = null;
  private target: Vec3 = [0, 0, 0.5];
  private home = { dist: 3, target: [0, 0, 0.5] as Vec3 };
  /** The asset viewer's Pause button (and the play audit's stepping): the clocks and the world stop. No game window pauses. */
  private paused = false;
  private last = performance.now();
  private loadToken = 0;
  /** The scenes cache has been listed (the Test Range's tileset borrows its lights from it). */
  private readonly scenesListed: Promise<void>;
  /** The Test Range (src/dev/testrange.ts, the asset viewer only) and the depth it plays at. */
  private testRange: TestRange | null = null;
  private rangeDepth = 1;

  constructor(private readonly vfs: Vfs, files: string[]) {
    this.loader = new ModelLoader(vfs);
    this.renderer = new Renderer(this.canvas, vfs);
    messages.controls = command => commandKeys(this.options_, command);
    this.renderer.colors = vfs.colorDefs().then(b => (b ? ColorPository.fromSerialized(b) : null)).catch(() => null);
    this.sceneLoader = new SceneLoader(this.loader);
    this.places = this.makePlaces();
    this.applyOptions();
    this.scenesListed = this.listScenes(vfs);
    // the Test Range: a developer's hall for trying gear and monsters, from the asset viewer only
    if (!GAME) { $("testRangeBtn").hidden = false; $("testRangeBtn").onclick = () => void this.openTestRange(); }
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
    $("arsenalBtn").onclick = () => void this.toggleArsenal();
    $("spawnJelly").onclick = () => {
      const k = this.world?.knight;
      if (!k) return;
      const a = Math.random() * Math.PI * 2;
      const spot = this.scene!.collision.findSpawn(k.x + Math.cos(a) * 4, k.y + Math.sin(a) * 4, 0.4, 43);
      if (spot) this.world!.spawnAt({ name: "Character/NPC/Monster/Slime/Jelly/Jelly Cube/Jelly Cube 1" }, spot[0], spot[1]);
      this.canvas.focus();
    };
    const typing = () => document.activeElement instanceof HTMLInputElement && document.activeElement.type !== "checkbox";
    // the log-on, knight select and prologue screens: Escape closes a prompt, or skips the prologue
    addEventListener("keydown", e => {
      const s = this.glScreen();
      if (!s || e.key !== "Escape" || this.options?.isOpen) return;
      if (s.escape()) e.preventDefault();
    });
    addEventListener("keydown", e => {
      if (!this.world || typing()) return;
      if (this.places.key(e)) { e.preventDefault(); return; }
      if (this.conversation?.isOpen) { if (this.conversation.key(e)) e.preventDefault(); return; }
      // Esc opens the options menu (and closes whatever window is open)
      if (e.key === "Escape") {
        if (this.gameHud?.menuOpen) { this.gameHud.closeMenu(); return; }
        if (this.itemScreens?.escape()) return;
        if (this.missionBoard?.escape()) return;
        if (this.escapeWindow()) return;
        if (this.options?.isOpen) this.options.close();
        else void this.openOptions();
        return;
      }
      const key = e.key.toLowerCase(), b = (a: Action) => key === this.bound(a);
      // a command's function key or Tab is the game's, not the browser's (F5 reloading, Tab moving focus)
      const browserKey = /^f\d+$/.test(key) || key === "tab";
      if (browserKey && (Object.keys(ACTIONS) as Action[]).some(b)) e.preventDefault();
      if (this.options?.isOpen) return;
      // on a stage (the Ready Room) only the HUD's commands answer: there is no knight to steer
      if (this.staged) {
        // knight creation answers only its own window: no arsenal, no menus
        if (this.places.create.isOpen) return;
        if (!e.repeat) for (const [a, run] of Object.entries(this.commands()) as [Action, () => void][]) if (b(a)) run();
        return;
      }
      (["weapon1", "weapon2", "weapon3"] as const).forEach((a, i) => { if (b(a)) this.weaponSlot = i; });
      if (b("cycle") && !e.repeat) { e.preventDefault(); this.switchWeapon(1); }
      if (b("prevWeapon") && !e.repeat) { e.preventDefault(); this.switchWeapon(-1); }
      // pocket items
      (["item1", "item2", "item3", "item4"] as const).forEach((a, i) => {
        if (b(a) && !e.repeat && !this.paused && !this.controlLocked) this.usePocket(i);
      });
      (["sprite1", "sprite2", "sprite3"] as const).forEach((a, i) => { if (b(a) && !e.repeat && !this.paused && !this.controlLocked) this.outfit.useSkill(i); });
      if (b("interact") && !e.repeat) this.interactPressed = true;
      if (b("dash") && !e.repeat) this.dashPressed = true;
      // the mouse-move scheme's keys: Z attacks (Shift + Z bashes), X shields (Shift + X dodges)
      if (this.options_.mouseMove && !e.repeat) {
        if (key === "z") { if (e.shiftKey) this.bashPressed = true; else { this.attackPressed = true; this.attackHeld = true; } }
        if (key === "x") { if (e.shiftKey) this.dashPressed = true; else this.shieldHeld = true; }
      }
      // the client's toggle commands (as.a(dt) binds them to the same actions as the HUD's buttons)
      if (!e.repeat) for (const [a, run] of Object.entries(this.commands()) as [Action, () => void][]) if (b(a)) run();
      // Shift while the shield is up also dashes (right click, then Shift)
      if (e.key === "Shift" && !e.repeat && this.shieldHeld) this.dashPressed = true;
      this.keys.add(e.key.toLowerCase());
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(e.key.toLowerCase())) e.preventDefault();
    });
    addEventListener("keyup", e => {
      const key = e.key.toLowerCase();
      this.keys.delete(key);
      if (this.options_.mouseMove && key === "z") this.attackHeld = false;
      if (this.options_.mouseMove && key === "x") this.shieldHeld = false;
    });
    addEventListener("blur", () => { this.keys.clear(); this.attackHeld = false; this.shieldHeld = false; });
    const hash = new URLSearchParams(location.hash.substring(1));
    const fromHash = hash.get("model");
    search.value = fromHash ? fromHash.replace(/\.dat$/, "") : "jellycube/model";
    this.renderList();
    if (fromHash) this.select(fromHash);
    else if (hash.get("scene")) this.selectScene(hash.get("scene")!);
    else if (hash.has("range") && !GAME) void this.openTestRange();
    requestAnimationFrame(this.frame);
    if (import.meta.env.DEV) { (window as any).__viewer = this; (window as any).__notice = currentNotice; }
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
    // the local server keeps every level's name in an index; a picked folder is read file by file
    const index = vfs instanceof DevServerVfs ? await vfs.sceneIndex().catch(() => null) : null;
    const ids = index ? [] : await vfs.scenes();
    // every id the archive holds (exits lead to levels by id)
    this.sceneIds = new Set(index ? index.map(([id]) => id) : ids);
    if (!index && ids.length === 0) return;
    const named = index ? index.map(([id, name]) => ({ id, name })) : await Promise.all(ids.map(async id => {
      try { return { id, name: await sceneName(await vfs.readScene(id)) }; } catch { return null; }
    }));
    const ul = $("scenes");
    const found = named.filter((s): s is { id: string; name: string } => s !== null);
    this.sceneList = found;
    this.archive = new LevelArchive(found);
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
      this.elevator = new ElevatorScreen(this.gui, stage, () => {
        const w = this.world;
        if (!w) return null;
        const v = new PortraitView(this.renderer, this.loader, w.portraitRef(), "character/pc/animation_pose_dash.dat");
        return (c, g, x, y, ww, h) => v.draw(c, g, x, y, ww, h);
      });
      this.elevator.onShow = () => this.music.stinger("elevator");
      this.elevator.onSound = f => this.uiSound(f);
    }
    return { loading: this.loadingScreen, elevator: this.elevator };
  }

  /** Shows the loading screen for a scene about to load (in the game, not the asset viewer). */
  private showLoading(id: string): LoadingScreen | null {
    if (!GAME && !this.played) return null;
    const { loading } = this.screens();
    const f = this.gate && (this.run.depth > 0 || this.gateLobby) ? this.floors[this.run.depth] ?? null : null;
    const name = this.genNames.get(id) ?? this.sceneList.find(s => s.id === id)?.name ?? id;
    const info = loadingInfo(this.arenaMode ? "arena" : name, f, this.gate?.name);
    // a mission's lobby arrives under the mission's name, the lobby's under it ("Dreams and
    // Nightmares" / "Mission Lobby"; a mission's own lobby: "Base Camp", "Ancient Grove")
    if (this.gate?.id.startsWith("mission:") && this.inLobby && !f) {
      info.title = this.gate.name;
      info.zone = this.gate.lobby ? text("dungeon", `m.${this.gate.lobby}`, info.zone) : text("dungeon", "m.mission_lobby", "Mission Lobby");
      info.depth = "";
    }
    void loading.show(info);
    loading.progress(0.05);
    return loading;
  }

  private pick: PickScreen | null = null;
  private prologue: PrologueScreen | null = null;

  /** The full-screen interface on the game canvas (log-on, knight select, prologue), if one is up. */
  private glScreen(): TitleScreen | PickScreen | PrologueScreen | null {
    for (const s of [this.prologue, this.pick, this.title]) if (s?.visible) return s;
    return null;
  }

  /**
   * The log-on screen (the game app's start; the asset viewer lives behind #viewer), as the
   * client's startup shows it: ui/logon over the Cradle skybox, with title.ogg.
   */
  private async enterTitle() {
    document.body.classList.add("game");
    this.music.title();
    this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors);
    if (!this.title) {
      this.title = new TitleScreen(this.gui, this.renderer, this.loader, "titleScreen");
      this.title.sound = f => this.uiSound(f);
      if (import.meta.env.DEV) (window as any).__title = this.title.debugHandle();
      this.title.actions = {
        play: () => { this.uiSound("sound/feedback/ui_confirm.ogg"); this.logOn(); },
        options: () => void this.openOptions(),
        quit: () => {
          // a browser tab closes itself only when a script opened it
          window.close();
          this.title?.setStatus("Close this tab to quit.");
        },
      };
    } else this.title.replay();
    this.pick?.hide();
    this.prologue?.hide();
    const n = namedKnights(gameRoster()).length;
    this.title.setStatus(n ? `${n} knight${n === 1 ? "" : "s"} saved in this browser` : "");
    await this.title.show();
    bootStatus(null);
    this.showTab("title");
  }

  /**
   * The browser tab's title and icon for where the knight is (src/ui/favicon.ts): a full-screen
   * interface's, else the scene's (a town, a gate's floor or lobby, a mission, a Shadow Lair).
   * The asset viewer keeps its own title. Cosmetic: nothing here can break the game.
   */
  private showTab(screen?: PlaceState["screen"]) {
    if (!GAME) return;
    try {
      const sc = this.scene;
      // (the Mission Lobby is no floor: its mission's first floor waits below it)
      const f = this.inLobby && !this.gateLobby ? null
        : this.gate && (this.run.depth > 0 || this.gateLobby) ? this.floors[this.run.depth] ?? null : null;
      const mission = /^mission:(.+)$/.exec(this.gate?.id ?? "")?.[1];
      const guild = this.save.guild ? guildOf(this.save) : null;
      this.tab.show(choosePlace({
        screen: screen ?? (sc?.id === TEST_RANGE ? "range" : null), sceneId: sc?.id ?? null, sceneName: sc?.name ?? null,
        town: !!sc && TOWN.test(sc.name), gate: this.gate, floor: f, depth: this.scaleDepth(),
        missionCard: mission ? this.missionBoard?.byId(mission)?.cardImage ?? null : null,
        guild: guild ? { name: guild.name, symbol: guild.emblem.symbol, color: guild.emblem.color } : null, arena: this.arenaMode,
      }));
    } catch { /* the tab keeps what it showed */ }
  }

  /**
   * Log On (ProjectXApp.Gx): an account with knights goes to the knight select window (client
   * cB); one with none plays the prologue (dK) and then knight creation.
   */
  private logOn() {
    if (namedKnights(gameRoster()).length) void this.showPick();
    else this.newKnight();
  }

  /** The knight select window with the roster's knights. */
  private async showPick() {
    this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors);
    if (!this.pick) {
      this.pick = new PickScreen(this.gui, this.renderer, this.loader, "pickScreen");
      this.pick.sound = f => this.uiSound(f);
      this.pick.actions = {
        choose: slot => void this.playKnight(slot),
        create: () => { this.uiSound("sound/feedback/ui_confirm.ogg"); this.newKnight(); },
        remove: slot => {
          const r = gameRoster(), gone = r.knights[slot];
          deleteKnight(r, slot);
          saveRoster();
          if (gone === this.save) this.save = loadSave();
          if (namedKnights(r).length) void this.showPick(); else void this.enterTitle();
        },
        back: () => { this.uiSound("sound/feedback/ui_dismiss.ogg"); void this.enterTitle(); },
      };
    }
    this.music.title();
    const cards = await Promise.all(namedKnights(gameRoster()).map(async ({ slot, save }): Promise<KnightCard> => ({
      slot, save, name: knightName(save), rank: rankLabel(progressOf(save)), guild: save.guild?.name ?? "",
      look: await this.knightLook(save).catch(() => [["Colorization", save.color]] as [string, any][]),
      weapon: await this.cardWeapon(save).catch(() => null),
    })));
    this.title?.hide();
    this.prologue?.hide();
    this.showTab("pick");
    await this.pick.setKnights(cards);
  }

  /**
   * A knight's look as model arguments for the knight select cards: its colour, its armour and
   * helmet (the proto parts without), its shield, and its costumes and accessories.
   */
  private async knightLook(save: SaveData): Promise<[string, any][]> {
    const data = this.world?.data ?? new GameData(this.loader);
    const ref = (name: string, args: [string, unknown][]) => ({ $class: "com.threerings.config.ConfigReference", name,
      arguments: { $map: "com.threerings.config.ArgumentMap", entries: args } });
    const colored = (r: any) => !r?.arguments?.entries?.some(([k]: [string]) => k === "Colorization") ? r
      : { ...r, arguments: { ...r.arguments, entries: r.arguments.entries.map(([k, v]: [string, unknown]) => [k, k === "Colorization" ? save.color : v]) } };
    const args: [string, any][] = [["Colorization", save.color], ...faceArgs(save.face) as [string, any][]];
    const armor = save.loadout.armor ? await data.armor(save.loadout.armor) : null;
    const helmet = save.loadout.helmet ? await data.armor(save.loadout.helmet) : null;
    args.push(["Armor", colored(armor?.model ?? ref("item/gear/armor/doublebelt/model.dat", [["Colorization", save.color], ["Variant", "grey"]]))]);
    args.push(["Helmet", colored(helmet?.model ?? ref("item/gear/helm/pith/model.dat", [["Colorization", save.color], ["Variant", "grey"]]))]);
    const shield = save.loadout.shield ? await data.shield(save.loadout.shield).catch(() => null) : null;
    if (shield?.model) args.push(["Shield", shield.model]);
    const dressing = await resolveDressing(data, save.appearance ?? emptyAppearance()).catch(() => null);
    return dressing ? dressArgs(args, dressing, save.color) : args;
  }

  /**
   * The weapon a knight select card raises on hover (client cB.a): the knight's first weapon's
   * model and its ready pose (ready_sword, ready_pistol or ready_bomb by the weapon's kind).
   */
  private async cardWeapon(save: SaveData): Promise<{ model: any; idle: string } | null> {
    const name = save.loadout.weapons[0];
    if (!name) return null;
    const w = await (this.world?.data ?? new GameData(this.loader)).weapon(name);
    if (!w?.model) return null;
    const idle = w.kind === "Handgun" ? "ready_pistol" : w.kind === "Bomb" ? "ready_bomb" : "ready_sword";
    return { model: w.model, idle };
  }

  /** Plays as a knight from the select window: its save, in Haven. */
  private async playKnight(slot: number) {
    const r = gameRoster();
    const save = selectKnight(r, slot);
    if (!save) { this.pick?.ready(); return; }
    saveRoster();
    this.uiSound("sound/feedback/ui_confirm.ogg");
    this.save = save;
    this.run = { depth: 1, health: null, floors: 0 };
    this.gate = null;
    const haven = this.sceneList.find(s => /haven town square/i.test(s.name)) ?? this.sceneList.find(s => TOWN.test(s.name));
    this.pick?.hide();
    this.title?.hide();
    this.stopPlaying();
    if (haven) await this.selectScene(haven.id);
    await this.startPlaying();
  }

  /**
   * A new knight (Create a Knight, or Log On with none): a slot for it, then the prologue
   * (client dK, with prologue_audio_only.ogg), then knight creation at the crash site.
   */
  private newKnight() {
    const r = gameRoster();
    if (addKnight(r) < 0) { this.pick?.ready(); return; }
    saveRoster();
    this.save = r.knights[r.current];
    this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors);
    if (!this.prologue) {
      this.prologue = new PrologueScreen(this.gui, this.renderer, this.loader, "prologueScreen");
      this.prologue.sound = f => this.uiSound(f);
      if (import.meta.env.DEV) (window as any).__prologue = this.prologue.debugHandle();
      // the prologue's scripts follow its score's playback (dK starts both together)
      this.prologue.clock = () => this.music.prologueTime();
      this.prologue.onDone = () => {
        // dK.wasRemoved: the title music again, under knight creation
        this.music.title();
        void this.places.startCreation();
      };
    }
    this.title?.hide();
    this.pick?.hide();
    this.music.prologue();
    this.showTab("prologue");
    void this.prologue.play();
  }

  /** Knight creation's Back: the knight select window when there are knights, else the log-on screen. */
  private leaveCreation() {
    this.places.create.close();
    this.stopPlaying();
    if (namedKnights(gameRoster()).length) void this.showPick(); else void this.enterTitle();
  }

  /**
   * Moving floors follow their sprites' animations: the collision node's height over its rest
   * pose (the start platform's grate, 3.27 up as Arrive begins, at rest once it has played).
   */
  private updateLifts() {
    for (const it of this.sceneItems ?? []) {
      const lift = it.lift;
      if (!lift) continue;
      const inst = it.instance;
      inst.update();
      lift.dz = inst.clip && inst.world.has(lift.node)
        ? (inst.nodeMatrix(lift.node)[14] - nodeMatrix(inst.model.root, lift.node)[14]) * it.matrix[10] : 0;
    }
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
    const [, genKey, seed, boss] = GEN.exec(id)!;
    let key = genKey;
    const pf = /^pf-([a-z]+)-([a-z]+)$/.exec(key);
    if (pf) {
      // a floor of the game's own prefab rooms; the old way when they cannot make one
      const root = await this.prefabRoot(pf[1], pf[2] === "none" ? null : pf[2][0].toUpperCase() + pf[2].slice(1), Number(seed),
        this.genNames.get(id) ?? "New floor").catch(e => { console.warn("prefab floor", e); return null; });
      if (root) {
        const tables = this.genTables.get(id);
        const theme = this.floors[this.run.depth]?.stratum?.theme;
        if (tables?.length && theme && /^(Beast|Construct|Fiend|Gremlin|Slime|Undead)$/.test(theme)) rethemeMasters(root, tables, rng(Number(seed) ^ 0x5bd1e995));
        this.genReport = null;
        return root;
      }
      key = this.genFallback.get(id) ?? "clockworks";
    }
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
    // a boss's arena (src/game/bosses.ts): its own plan, props and gates
    if (boss) return bossArena(boss as BossKey, level.sources, Number(seed), this.genNames.get(id) ?? BOSSES[boss as BossKey].level, pool,
      { model: level.model, globals: level.globals });
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

  /**
   * The prefab rooms of a style and status: every usable room cut out of the captured floors
   * the archive holds of it (src/gen/prefabs.ts), cached.
   */
  private prefabLibrary(style: string, element: string | null, any = false): Promise<LibPiece[]> {
    const k = `${style}|${element}|${any}`;
    let p = this.prefabLibs.get(k);
    if (!p) {
      p = (async () => {
        const out: LibPiece[] = [];
        for (const c of this.archive.prefabSources(style, element as any, any)) {
          const r = await this.sceneLoader.parse(await this.vfs.readScene(c.id));
          // the tiles' footprints and walkability, resolved first (the cut asks synchronously)
          const infos = new Map<string, TileInfo>();
          const refKey = (ref: any) => JSON.stringify(ref, (kk, v) => (kk === "$outer" ? undefined : v));
          for (const m of (r.tileConfigs?.items ?? r.tileConfigs ?? []) as any[]) {
            if (m?.tile && !infos.has(refKey(m.tile))) infos.set(refKey(m.tile), await this.sceneLoader.tileInfo(m.tile));
          }
          out.push(...libraryPieces(c.id, r, ref => infos.get(refKey(ref)) ?? { width: 1, height: 1, walkable: false }));
        }
        return out;
      })();
      p.catch(() => this.prefabLibs.delete(k));
      this.prefabLibs.set(k, p);
    }
    return p;
  }

  /** A floor assembled from a style's prefab rooms, with the globals of the floor its start came from. */
  private async prefabRoot(style: string, element: string | null, seed: number, title: string): Promise<any | null> {
    let a = assemble(await this.prefabLibrary(style, element), seed);
    // too few rooms of this status: the style's rooms of every status
    if (!a) a = assemble(await this.prefabLibrary(style, element, true), seed);
    if (!a) return null;
    const src = await this.sceneLoader.parse(await this.vfs.readScene(a.placed[0].piece.source));
    const globals = ((src.entries ?? []) as any[]).filter(e => e.$class.endsWith("GlobalEntry"));
    return assembledRoot(a, globals, title);
  }

  private async selectScene(id: string) {
    const token = ++this.loadToken;
    this.status("Loading scene " + id + "...");
    const loading = this.showLoading(id);
    for (const li of $("scenes").children) li.classList.toggle("active", (li as HTMLElement).dataset.scene === id);
    for (const li of $("list").children) li.classList.remove("active");
    history.replaceState(null, "", id === TEST_RANGE ? `#${location.hash.includes("dev=1") ? "dev=1" : "viewer"}&range` : "#scene=" + id);
    if (id !== TEST_RANGE) this.testRange?.hide();
    const t0 = performance.now();
    try {
      const progress = (done: number, total: number) => {
        if (token !== this.loadToken) return;
        this.status("Loading scene: " + done + " of " + total + " objects");
        loading?.progress(0.1 + 0.7 * done / Math.max(1, total));
      };
      const special = id === TEST_RANGE ? await rangeRoot({
        scenes: this.sceneList, readRoot: async sid => this.sceneLoader.parse(await this.vfs.readScene(sid)),
        tileNames: () => this.sceneLoader.configNames("config/tile.dat"), tileInfo: ref => this.sceneLoader.tileInfo(ref),
      }) : GEN.test(id) ? null : await this.places.sceneRoot(id);
      const scene = special ? await this.sceneLoader.loadRoot(id, special, progress)
        : GEN.test(id) ? await this.sceneLoader.loadRoot(id, await this.generatedRoot(id), progress) : await this.sceneLoader.load(id, await this.vfs.readScene(id), progress);
      loading?.progress(0.8);
      const items = await Promise.all(scene.objects.map(async (o): Promise<{ instance: ModelInstance; matrix: Mat4; lift?: FloorLift }> =>
        ({ instance: await this.instanceOf(o.model), matrix: o.matrix, lift: o.lift })));
      loading?.progress(0.9);
      // a level's tiered globals (lights, fog, skies: "Variant" Tier1-3) follow the depth it is
      // played at, as the game's server sets them; an archived floor keeps the tier it was captured in
      const tier = this.gate ? this.floors[this.run.depth]?.tier ?? null : null;
      const env = await loadEnvironment(this.loader, tier ? retierGlobals(scene.globals, tier) : scene.globals);
      for (const m of env.models) items.push({ instance: await this.instanceOf(m.model), matrix: m.matrix });
      const skyboxes = await Promise.all(env.skyboxes.map(async s => ({ instance: await this.instanceOf(s.model), scale: s.scale, origin: s.origin })));
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
      this.showTab();
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
    // (towns: at the portal the knight walked in through, else the scene's default entrance)
    // (back from the Ready Room: where the knight stood before it)
    const resume = this.resumeAt;
    this.resumeAt = null;
    const arrival = this.scene.start || resume ? null : arrivalPoint(this.scene.logic, this.arrivalTag ?? "");
    this.arrivalTag = null;
    const [sx, sy] = resume ? [resume.x, resume.y] : this.scene.start ?? (arrival ? [arrival.x, arrival.y] : [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2]);
    const [rx, ry] = this.scene.id === TEST_RANGE ? rangeSpawn() : [sx, sy];
    const spawn = this.places.spawn(this.scene.id) ?? this.scene.collision.findSpawn(rx, ry, 1 / 3, 43);
    if (!spawn) { this.status("No walkable floor found in this scene.", true); return; }
    this.status("Spawning a knight...");
    this.audio ??= new AudioSystem(this.vfs, this.loader);
    this.audio.unlock();
    const world = new World(this.loader, this.renderer, this.scene, this.scene.collision,
      { audio: this.audio, depth: this.scaleDepth(), arena: this.arenaMode && !TOWN.test(this.scene.name),
        // a gate's floors at the run's difficulty (the cached-level run and the arena as before)
        ...(this.gate && !TOWN.test(this.scene.name) ? { difficulty: this.runDifficulty } : {}) });
    world.onArenaCheckpoint = wave => this.arenaCheckpoint(wave);
    this.itemScreens?.closeAll();
    world.onNextFloor = () => this.floorCleared();
    // the terminal's Shadow Lair elevators lead to their lairs (the depth-23 terminal of a gate with that boss)
    world.elevatorAllowed = p => this.lairElevator(p);
    world.exitLocked = this.bossFloor ? () => this.bossAlive() : null;
    world.onOpenShop = (keeper, portrait) => void this.openShop(keeper, portrait);
    world.onOpenCrafter = () => void this.openCrafter();
    world.onConversation = (actor, action, source) => void this.openConversation(actor, action, source);
    // the exit elevator animates the scene's elevator model where it stands
    world.rideModel = (x, y) => {
      let best: ModelInstance | null = null, bestD = 3;
      for (const it of this.sceneItems ?? []) {
        const path = it.instance.model.path;
        if (!/world\/dynamic\/elevator\//.test(path) || /start/.test(path)) continue;
        const d = Math.hypot(it.matrix[12] - x, it.matrix[13] - y);
        if (d < bestD) { best = it.instance; bestD = d; }
      }
      return best;
    };
    // town exits lead to their scenes (src/game/portals.ts); the Arcade, which the scenes cache
    // lacks, brings up its gate board
    world.onPortal = (tags, sceneId, portal, more) => this.walkOut({ tags, sceneId, portal, ...more });
    // energy uses (energy gates, crates) take the knight's energy, mist first; a shortfall is
    // bought at the exchange with crowns, the floor's first, then the bank's
    world.spendEnergy = n => {
      const paid = payEnergy(energyOf(this.save), n, c => this.payCrowns(c));
      if (paid) writeSave(this.save);
      return paid;
    };
    world.color = this.save.color;
    world.face = this.save.face ?? null;
    world.gear = this.save.gear;
    if (this.eco) world.economy = this.eco;
    // treasure on a family stratum drops that family's materials
    const theme = this.gate ? this.floors[this.run.depth]?.stratum?.theme : null;
    world.themeTags = theme && /^(Beast|Construct|Fiend|Gremlin|Slime|Undead)$/.test(theme) ? [`fam_${theme.toLowerCase()}`] : [];
    world.pocket = this.save.pocket;
    world.onLoot = (item, count) => this.lootMessage(item, count);
    await this.outfit.dress(world);
    // the party lobby's gate pillar shows the gate being played: its six strata's themes, launched
    if (this.gateLobby && this.gate) world.gateDisplay = { themes: this.gate.real?.themes ?? this.gate.strata.map(st => st.theme), active: true };
    // towns and the Rescue Camp are safe places: the knight walks them unarmed
    // (the creator's knight at the crash site holds the starter sword and shield, client S)
    await world.start(spawn, this.save.loadout, TOWN.test(this.scene.name) && this.scene.id !== CREATE_KNIGHT);
    if (arrival && !this.places.spawn(this.scene.id)) world.knight.heading = arrival.heading;
    if (resume && !this.places.spawn(this.scene.id)) world.knight.heading = resume.heading;
    this.eco ??= world.economy;
    this.outfit.hotkeys = (["sprite1", "sprite2", "sprite3"] as const).map(a => keyName(this.bound(a)));
    // (a stage shows the knight alone: the client's ready room view builds only its sprite)
    if (!this.places.staged(this.scene.id)) void this.outfit.accompany(world);
    if (this.run.health !== null) world.knight.health = Math.max(1, Math.min(world.knight.maxHealth, this.run.health));
    // the floor's music (src/game/music.ts: gate floors by kind, theme and style, else the scene's own) and ambient loops
    this.played = true;
    this.screens();
    // (an archived level's own music global wins over the table; its own scripted music, a
    // boss lair's fight among it, over our fight track)
    this.music.enter({ scene: this.scene.name, sceneMusic: this.environment.music, world, arena: !!world.arena, boss: this.bossFloor,
      archived: !GEN.test(this.scene.id), scriptsMusic: spawnsMusic(this.scene.logic),
      floor: this.gate && this.run.depth > 0 ? this.floors[this.run.depth] ?? null : null });
    for (const a of this.environment.ambience ?? []) this.audio.ambient(a);
    // one-shot scene animations play from the top as the knight appears: the client's sprites
    // start their automatic animations on their first tick (ArticulatedModel.tick), and the
    // scene ticks with no time while the loading window is up (TudeySceneView.tick), so the
    // start platform's Arrive plays as play begins, the knight riding its grate down
    // (back from the Ready Room the level carries on as it was)
    if (!resume) for (const it of this.sceneItems ?? []) if (it.instance.clip && !it.instance.clip.loop) it.instance.time = 0;
    this.updateLifts();
    world.knight.z = this.scene.collision.groundZ(world.knight.x, world.knight.y);
    this.world = world;
    this.hud ??= new Hud($<HTMLCanvasElement>("hudCanvas"));
    this.hud.chat = this.chat;
    // the level's help bubbles (src/ui/balloons.ts)
    this.balloons ??= new Balloons(this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors));
    this.balloons.clear();
    this.hud.image = f => (this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors)).image(f);
    this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors);
    initNotices(this.gui);
    this.tooSmall ??= new TooSmallWarning(this.gui);
    // arriving in Haven, and the arsenal as it stands, may earn achievements
    this.achieve();
    // the status panel's portraits: still pictures cut to their masks (client hud/F)
    const still = (mask: string) => ({ time: 0.5, mask: this.gui?.image(mask) ?? Promise.resolve(null) });
    const portrait = new PortraitView(this.renderer, this.loader, world.portraitRef(), "character/pc/idle.dat", still("ui/hud_v2/images/portrait/mask.png"));
    if (import.meta.env.DEV) (window as any).__portrait = portrait;
    this.outfit.onRedress = () => portrait.setModelRef(world.portraitRef());
    // render views: the knight portrait, the heat meter's flame, the dash cooldown's ring and
    // the target panel's monster (a view per target)
    const heatView = new PortraitView(this.renderer, this.loader, undefined, null);
    const ringView = new PortraitView(this.renderer, this.loader, undefined, null);
    let targetView: { key: string; view: PortraitView } | null = null;
    let petView: { key: string; view: PortraitView } | null = null;
    const acquireViews = new Map<string, PortraitView>();
    this.gameHud = new GameHud(this.gui, { view: (c, g, x, y, w, h) => {
      if (c.viewOwner?.startsWith("acquire:")) {
        // each item-acquire icon plays its own 3D animation
        let v = acquireViews.get(c.viewOwner);
        if (!v) {
          acquireViews.set(c.viewOwner, v = new PortraitView(this.renderer, this.loader, undefined, null));
          if (acquireViews.size > 12) acquireViews.delete(acquireViews.keys().next().value!);
        }
        v.draw(c, g, x, y, w, h);
      } else if (c.viewOwner === "pet") {
        const p = world.companion?.portrait();
        if (!p) return;
        const key = JSON.stringify(p.ref, (k, v) => (k === "$outer" ? undefined : v));
        if (petView?.key !== key) petView = { key, view: new PortraitView(this.renderer, this.loader, p.ref, p.idle, still("ui/hud_v2/images/portrait_mini/mask.png")) };
        petView.view.draw(c, g, x, y, w, h);
      } else if (c.viewOwner === "target") {
        const t = world.hudTarget();
        if (!t) return;
        if (targetView?.key !== t.key) targetView = { key: t.key, view: new PortraitView(this.renderer, this.loader, undefined, t.idle) };
        targetView.view.draw(c, g, x, y, w, h);
      } else (c.viewOwner === "cooldown" ? ringView : c.tag === "heat_view" ? heatView : portrait).draw(c, g, x, y, w, h);
    } });
    void this.gameHud.init(hudState(world, knightName(this.save))).catch(e => console.warn("HUD failed to load", e));
    $("spawnJelly").hidden = false;
    // in town, the item windows and the options are built while the player looks around, so
    // their first opening is instant
    if (TOWN.test(this.scene.name)) void this.prebuildWindows();
    // the scene's own camera: its field of view, elevation, distance and offset
    const cam = this.environment.camera ?? readCamera(undefined);
    this.cam = { views: this.environment.cameras ?? [cam], zoom: 0, from: cam, to: cam, t: 1 };
    this.applyCamView(cam);
    this.applyOptions();
    $("play").textContent = "Stop playing";
    document.body.classList.add("playing");
    this.status(`Playing in ${this.scene.name}`);
    this.canvas.focus();
    this.places.started(this.scene.id);
    if (this.scene.id === TEST_RANGE) await this.testRange?.attach(world);
    // the session's first arrival in town opens the uplink's news and the Event Hub (as.DX)
    if (this.scene.id !== TEST_RANGE) this.welcome();
  }

  /**
   * The Test Range (development, the asset viewer only): the flat hall, the knight in it and
   * the range's panel (src/dev/testrange.ts).
   */
  private async openTestRange() {
    if (GAME) return;
    await this.scenesListed;
    if (this.scene?.id !== TEST_RANGE || !this.world) {
      this.gate = null;
      this.bossFloor = null;
      this.arenaMode = false;
      if (this.scene?.id !== TEST_RANGE) await this.selectScene(TEST_RANGE);
      if (this.scene?.id !== TEST_RANGE) return;
    }
    if (!this.testRange) {
      const { TestRange } = await import("./dev/testrange");
      const host = this;
      this.testRange = new TestRange({
        world: () => this.world, loader: this.loader, renderer: this.renderer, datFiles: this.datFiles,
        get depth() { return host.rangeDepth; },
        set depth(d: number) { host.rangeDepth = d; },
        restart: async d => {
          this.rangeDepth = d;
          if (this.scene?.id !== TEST_RANGE) return;
          this.stopPlaying();
          await this.startPlaying();
        },
        focus: () => this.canvas.focus(),
      }, this.canvas.parentElement!);
    }
    this.testRange.showPanel();
    if (!this.world) await this.startPlaying();
    else await this.testRange.attach(this.world);
  }

  /** The portal tag the knight arrives at in the next scene (a town exit walked through). */
  private arrivalTag: string | null = null;
  /** Where the knight stands when play next starts (back from the Ready Room). */
  private resumeAt: { x: number; y: number; heading: number } | null = null;

  /** Play is a stage (the Ready Room): the knight is posed, not controlled, and the camera fixed. */
  private get staged(): boolean { return !!this.world && this.places.staged(this.scene?.id); }
  private travelling = false;

  /**
   * The knight walked into a town exit: on to the scene it leads to, arriving at its portal
   * there, after the loading screen; the Arcade's gate board for the Arcade; and for a place
   * the scenes cache lacks, the game's notice that it is not available.
   */
  private walkOut(info: PortalInfo) {
    if (this.travelling) return;
    const t = exitTarget(info, this.sceneList, this.sceneIds);
    if (t.kind === "arcade") { if (!this.gate) this.openGates(); return; }
    if (t.kind === "missing") {
      const msg = messageText("%helptips:m.sl_elevator_closed");
      notice(t.place ? `${messageText(t.place)}: ${msg}` : msg, 4);
      return;
    }
    this.travelling = true;
    // (after this frame: the exit is reported from inside the world's update)
    setTimeout(async () => {
      try {
        this.stopPlaying();
        await this.selectScene(t.id);
        this.arrivalTag = t.portal;
        await this.startPlaying();
      } finally { this.travelling = false; }
    }, 0);
  }

  /** Ends play in the scene; `keepMusic` (the same scene again, a new look) lets the music play on. */
  private stopPlaying(keepMusic = false) {
    if (!this.world) return;
    this.testRange?.detach();
    // the time played so far goes into the knight's save
    if (this.save.knight) writeSave(this.save);
    this.conversation?.end();
    this.outfit.leave(this.world);
    this.world = null;
    this.gameHud = null;
    this.music.leave();
    if (!keepMusic) this.audio?.stopMusic(1);
    this.audio?.stopAmbience();
    this.hud?.clear();
    this.knockedOut = false;
    this.reviveScreen?.close();
    this.elevator?.hide();
    $("spawnJelly").hidden = true;
    this.keys.clear();
    $("play").textContent = "Play as knight";
    document.body.classList.remove("playing");
  }

  /** Where the mouse points on the knight's ground plane, for aiming attacks. */
  /**
   * Where the pointer points for the knight's facing: TudeySceneController intersects the pick
   * ray with the horizontal plane through the camera's target (the knight plus the camera
   * offset, 1 unit up by default) and faces from the target toward that point.
   */
  private aimPoint(): [number, number] | null {
    if (!this.world) return null;
    const k = this.world.knight, off = this.cam?.to.offset ?? [0, 0, 1];
    const p = this.rayPoint(k.z + off[2]);
    return p ? [p[0] - off[0], p[1] - off[1]] : null;
  }

  /** Puts the play camera at a CameraConfig's view (the distance times the Camera Distance option). */
  private applyCamView(v: CameraView) {
    this.el = v.elevation;
    this.az = -Math.PI / 2 + v.azimuth;
    this.dist = v.distance * this.options_.zoom;
    this.fov = v.fov;
  }

  /** TOGGLE_ZOOM: the next zoom level the scene's cameras offer (a town's closer camera), eased over 1.5 s. */
  private toggleZoom() {
    const c = this.cam;
    if (!c || c.views.length < 2) return;
    const levels = [...new Set(c.views.map(v => v.zoom))].sort((a, b) => a - b);
    const zoom = levels[(levels.indexOf(c.zoom) + 1) % levels.length];
    const to = c.views.find(v => v.zoom === zoom);
    if (!to) return;
    c.zoom = zoom;
    c.from = { ...c.to, ...this.currentView() };
    c.to = to;
    c.t = 0;
  }

  private currentView(): Partial<CameraView> {
    return { elevation: this.el, distance: this.dist / (this.options_.zoom || 1), fov: this.fov };
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
    // the party lobby has no depth (NO_DEPTH): the client's minimap names the level ("The Clockworks")
    if (this.gateLobby) return this.floors[this.run.depth]!.name;
    return TOWN.test(this.scene.name) ? this.scene.name.replace(/\w/g, c => c.toUpperCase())
      // the dungeon minimap names the depth as the client does (the dungeon bundle's m.depth)
      : hasMessage("dungeon", "m.depth") ? message("dungeon", "m.depth", this.scaleDepth()) : `Depth ${this.scaleDepth()}`;
  }

  /** The depth the floor is played at: its place in the run, or its own (a Shadow Lair's Logical Floor 26). */
  private scaleDepth(): number {
    if (this.scene?.id === TEST_RANGE) return this.rangeDepth;
    const f = this.gate ? this.floors[this.run.depth] : null;
    return f?.scaleDepth ?? this.run.depth;
  }

  private itemScreens: GameScreens | null = null;
  /** The item windows' render views (the knight, the battle sprite, a shopkeeper), by model. */
  private previewViews = new Map<string, PortraitView>();
  private prebuilding: Promise<void> | null = null;

  /**
   * Builds the arsenal, backpack, forge and options windows in idle time, one at a time,
   * once the knight is in town (building one takes long enough to notice on first open).
   */
  private prebuildWindows() {
    const idle = () => new Promise<void>(r => typeof requestIdleCallback === "function" ? requestIdleCallback(() => r(), { timeout: 2000 }) : setTimeout(r, 200));
    return this.prebuilding ??= (async () => {
      await this.ensureScreens().prebuild(idle);
      await idle();
      await this.optionsScreen().prebuild().catch(e => console.warn("options prebuild failed", e));
      // the townsfolk's conversation interface (its styles, images and fonts load once)
      await idle();
      await ConversationScreen.prebuild(this.gui!).catch(() => undefined);
    })();
  }

  /** The game's item windows: arsenal, forge, shops, backpack (src/ui/screens.ts). */
  private ensureScreens() {
    this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors);
    return this.itemScreens ??= new GameScreens({
      gui: this.gui, colors: this.renderer.colors, eco: () => this.economy(),
      data: () => this.world?.data ?? new GameData(this.loader),
      save: () => this.save, sound: f => this.uiSound(f),
      write: () => { if (this.world) this.world.pocket = this.save.pocket; writeSave(this.save); this.achieve(); },
      // the game goes on behind the windows (as the online client's does); the last one closing
      // gives the keys back to the game (unless the mission board, under its arsenal, is still up)
      allClosed: () => { if (!this.missionBoard?.isOpen) this.canvas.focus(); },
      arsenalClosed: () => { this.places.arsenalClosed(); this.achieve(); },
      outfit: () => this.outfit,
      previewModel: async item => { const ref = this.world?.previewRef(item); return ref ? { ref, idle: "character/pc/idle.dat" } : null; },
      // the equipment window's knight preview, the battle sprite page's sprite, the vendor's keeper
      view: (c, g, x, y, w, h, model) => {
        const ref = model ? model.ref : this.world?.portraitRef();
        if (!ref) return;
        const idle = model ? model.idle : "character/pc/idle.dat";
        const key = JSON.stringify([ref, idle], (k, v) => (k === "$outer" ? undefined : v));
        let view = this.previewViews.get(key);
        if (!view) {
          // a few views stay loaded (switching tabs or shops comes back to them)
          if (this.previewViews.size >= 6) this.previewViews.delete(this.previewViews.keys().next().value!);
          this.previewViews.set(key, view = new PortraitView(this.renderer, this.loader, ref, idle));
        }
        view.draw(c, g, x, y, w, h);
      },
    });
  }

  /** The next (+1) or previous (-1) weapon (NEXT_WEAPON, PREV_WEAPON), applied on the next update. */
  private switchWeapon(step: 1 | -1) {
    const k = this.world?.knight;
    if (!k) return;
    const n = Math.max(1, k.weapons.length);
    this.weaponSlot = (k.slot + step + n) % n;
  }

  /** When the wheel last changed weapons: a touchpad's flick sends many small turns, taken as one. */
  private wheelAt = 0;

  /** A turn of the mouse wheel over the game: down the next weapon, up the previous. */
  private wheelWeapon(deltaY: number) {
    if (!deltaY || this.paused || this.controlLocked || this.options?.isOpen) return;
    const now = performance.now();
    if (now - this.wheelAt < 150) return;
    this.wheelAt = now;
    this.switchWeapon(deltaY > 0 ? 1 : -1);
  }

  /** Opens or closes the character window (equipment); the game goes on behind it. */
  private async toggleArsenal() {
    await this.ensureScreens().toggleArsenal();
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
    if (this.hud) this.hud.options = { healthBars: o.healthBars, damageNumbers: o.damageNumbers, get hudScale() { return uiScale(o); }, fps: o.showFps };
    if (this.gameHud) this.gameHud.options = { minimap: o.minimap, screenFlash: o.screenFlash };
    if (this.world) this.world.autoAimOn = o.autoAim;
    padOptions.deadZone = o.deadZone;
    document.body.classList.toggle("no-hint", !o.controlsHint);
  }

  /**
   * What the HUD shows besides the knight: the objective lines and whether this is a town. The
   * client's objective panel lists the server's Objective configs (PlayerObject.objectives),
   * which no town, gate floor or arena here has, so it stays hidden as the client's does with none.
   */
  private hudContext(): { objectives: string[]; town: boolean } {
    return { objectives: this.missionObjectives(), town: !!this.scene && TOWN.test(this.scene.name) };
  }

  /**
   * A mission's objective lines while it is played (its lobby and its floors): the mission's
   * objective (o.<id>, the board's gold line, "Prepare for the worst and journey to the Core"),
   * as the client's CURRENT OBJECTIVE panel shows it under the minimap in a mission lobby.
   */
  private missionObjectives(): string[] {
    const id = /^mission:(.+)$/.exec(this.gate?.id ?? "")?.[1];
    const m = id ? this.missionBoard?.byId(id) : null;
    // (a mission without one of its own reads "No current objective" on the board; none here)
    return m?.objective && hasMessage("mission", `o.${m.id}`) ? [m.objective.replace(/\{0\}/g, knightName(this.save))] : [];
  }

  /**
   * The portrait's personal menu (client cr: FV, FW, aJ): the knight's name, Equipment, and the
   * guild's options (the hall, the treasury). Friends and party options need other players.
   */
  private personalMenu(x: number, y: number) {
    this.uiSound("sound/feedback/ui_dropdown_activate.ogg");
    const t = (b: string, k: string, f: string) => text(b, k, f);
    const inHall = this.scene?.id === GUILD_HALL;
    const entries: ({ label: string; action: string } | { header: string })[] = [
      { label: t("projectx", "m.equipment", "Equipment"), action: "equipment" },
      { header: t("guild", "m.guild_options", "Guild Options") },
      ...(cachedHallId(this.sceneList) && !inHall ? [{ label: t("projectx", "b.to_guildhall", "Go to Guild Hall"), action: "guild_hall" }] : []),
      { label: t("guild", "m.show_treasury", "Show Guild Treasury"), action: "show_treasury" },
    ];
    void this.gameHud?.openMenu(x, y, knightName(this.save), entries, a => {
      this.uiSound("sound/feedback/ui_dropdown_select.ogg");
      // as.DI: the character window on its equipment
      if (a === "equipment") void this.ensureScreens().showCharacter("equipment");
      else if (a === "guild_hall") this.hudAction("button_guildhall");
      else if (a === "show_treasury") this.hudAction("guild_window");
    });
  }

  /** The personal menu's guild options (cr.aJ), for the social window's Guild Options header. */
  private guildOptions(): { entries: MenuEntry[]; run(action: string): void } {
    const inHall = this.scene?.id === GUILD_HALL;
    return {
      entries: [
        ...(cachedHallId(this.sceneList) && !inHall ? [{ action: "guild_hall", text: text("projectx", "b.to_guildhall", "Go to Guild Hall") }] : []),
        { action: "show_treasury", text: text("guild", "m.show_treasury", "Show Guild Treasury") },
      ],
      run: a => {
        this.social?.close();
        this.hudAction(a === "guild_hall" ? "button_guildhall" : "guild_window");
      },
    };
  }

  /**
   * The main menu (client et, the HUD's wrench button): a MAIN MENU popup rising from the
   * button (PopupMenu.popup above it), an item per window with its command's bound key
   * ("Arsenal (I)", m.add_command_key; none for an unbound command). Report a Bug and Redeem
   * Code reach the game's servers and show disabled; the Crucible items are offered only to the
   * Crucible Creator Crew (the player's flag 4096), which no knight here is; the gate map's
   * party item needs a party. Support opens the help window's Support page (as.Ea), Purchase
   * Energy the Supply Depot.
   */
  private mainMenu() {
    const hud = this.gameHud;
    if (!hud) return;
    if (hud.menuOpen) { hud.closeMenu(); return; }
    this.uiSound("sound/feedback/ui_dropdown_activate.ogg");
    const item = (key: string, fallback: string, command?: Action, enabled = true) => {
      let label = text("projectx", "m." + key, fallback);
      const bound = command ? this.bound(command) : "";
      if (bound) label = message("projectx", "m.add_command_key", label, gameKeyName(bound)) || `${label} (${gameKeyName(bound)})`;
      return { label, action: key, enabled };
    };
    const entries = [
      item("arsenal_item", "Arsenal", "arsenal"), item("status_item", "Character", "character"), item("missions_item", "Missions", "mission"),
      item("social_item", "Social", "social"), item("feed_item", "Event Hub", "feed"), item("recipes_item", "Recipes", "recipes"),
      item("achievements", "Achievements", "achievements"), item("messages_item", "Messages"), item("options_item", "Options (Esc)"),
      item("help_item", "Help", "help"), item("support_item", "Support"), item("report_bug", "Report a Bug", undefined, false),
      item("purchase_energy_item", "Purchase Energy"), item("redeem_code", "Redeem Code", undefined, false),
    ];
    const r = hud.buttonRect("button_menu");
    const run: Record<string, () => void> = {
      arsenal_item: () => this.hudAction("button_arsenal"), status_item: () => this.hudAction("button_gear"),
      missions_item: () => this.hudAction("button_missions"), social_item: () => this.hudAction("button_social"),
      feed_item: () => this.hudAction("button_feed"), recipes_item: () => this.hudAction("recipes"),
      achievements: () => this.hudAction("achievements"), messages_item: () => this.hudAction("button_mail"),
      options_item: () => this.openSettings(), help_item: () => this.hudAction("button_help"),
      support_item: () => this.toggleHelp("support"), purchase_energy_item: () => this.hudAction("button_supplydepot"),
    };
    void hud.openMenu(r?.x ?? 0, r?.y ?? innerHeight, text("projectx", "m.main_menu", "MAIN MENU"), entries, a => {
      this.uiSound("sound/feedback/ui_dropdown_select.ogg");
      run[a]?.();
    }, { above: true, owner: "button_menu" });
  }

  /** The HUD's view of the bindings, mail, camera, places and the knight's action (see HudState). */
  private hudExtras() {
    const key = (a: Action) => gameKeyName(this.bound(a));
    const kb = (a: Action) => (/^mouse/.test(this.bound(a)) ? "" : key(a));
    const id = this.scene?.id;
    const w = this.world;
    return {
      menuKeys: { button_help: key("help"), button_social: key("social"), button_feed: key("feed"), button_mail: key("uplink"),
        button_gear: key("character"), button_loadout: key("loadout"), button_arsenal: key("arsenal"), button_forge: key("forge") },
      commandKeys: { zoom: kb("zoom"), map: kb("map"), hudLock: kb("hudLock") },
      mailNews: mailbox(this.save).some(m => !m.read),
      // as.EF: the forge button's notice while an item is ready to level
      forgeReady: !!(this.eco ?? w?.economy)?.forgeable(this.save).length,
      windows: this.itemScreens?.openWindows(),
      zoomable: (this.cam?.views.length ?? 0) > 1, zoomed: (this.cam?.zoom ?? 0) > 0,
      prestige: progressOf(this.save).prestige,
      pet: !!w?.companion,
      place: { guildHall: id === GUILD_HALL, readyRoom: id === READY_ROOM, hall: !!cachedHallId(this.sceneList) },
      // the help notice: m.elevator while waiting on a dungeon's elevator, else the knight's action
      // hint (none while a window is open over the game); the action's description for the target panel
      action: (() => {
        // a vendor or alchemy machine the knight is using keeps its hint and target panel while
        // its windows are open (the client's stay up over the shop)
        if (w && this.vendorAction && (this.itemScreens?.shop.isOpen || this.itemScreens?.recipes.isOpen)) return this.vendorAction;
        if (!this.vendorOpening) this.vendorAction = null;
        if (!w || this.paused || this.windowOver() || this.talking) return null;
        const dungeon = !!this.scene && !TOWN.test(this.scene.name);
        if (dungeon && w.onElevator) return { hint: "m.elevator", desc: null };
        return w.actionTarget();
      })(),
      pocketTips: w ? w.pocket.map(([n]) => {
        const it = w.pocketItem(n);
        return it ? itemTip({ plain: true, label: this.eco?.displayName(n) ?? n.split("/").pop()!, type: "", rarity: it.rarity ?? 0, flavor: "", item: n }) : null;
      }) : [],
    };
  }

  /** The client's toggle commands by our action (as.a(dt) and the dungeon HUD's TOGGLE_HUD_LOCK). */
  private commands(): Partial<Record<Action, () => void>> {
    const hud = (tag: string) => () => this.hudAction(tag);
    return {
      help: hud("button_help"), forge: hud("button_forge"), arsenal: hud("button_arsenal"), character: hud("button_gear"),
      loadout: hud("button_loadout"), social: hud("button_social"), feed: hud("button_feed"), uplink: hud("button_mail"),
      mission: hud("button_missions"), panels: hud("panels"),
      // TOGGLE_RECIPES (as.DM) and TOGGLE_PROGRESS (as.DE), the main menu's Recipes and Achievements
      recipes: () => { this.uiSound("sound/feedback/ui_confirm.ogg"); void this.ensureScreens().toggleRecipes(); },
      achievements: () => { this.uiSound("sound/feedback/ui_confirm.ogg"); void this.ensureScreens().toggleAchievements(); },
      map: () => this.gameHud?.toggleMap(),
      zoom: () => { if (!this.paused) this.toggleZoom(); },
      hudLock: () => this.gameHud?.toggleLock(),
    };
  }

  /** A HUD button was clicked (the corner menus and the activities panel). */
  private hudAction(tag: string) {
    this.uiSound("sound/feedback/ui_confirm.ogg");
    if (this.places.hudAction(tag)) return;
    switch (tag) {
      case "button_menu": this.mainMenu(); break;
      case "button_help": this.toggleHelp(); break;
      case "button_social": this.toggleSocial(); break;
      // TOGGLE_RECIPES (as.DM): the recipe window; TOGGLE_PROGRESS (as.DE): the character window's achievements
      case "recipes": void this.ensureScreens().toggleRecipes(); break;
      case "achievements": void this.ensureScreens().toggleAchievements(); break;
      // TOGGLE_PANELS (as's ax): with the character and arsenal windows up, every window closes;
      // else they open (the character window here holds the arsenal's list)
      case "panels": this.togglePanels(); break;
      case "button_feed": this.openFeed(); break;
      case "button_mail": this.openMail(); break;
      // hud/P: P the character window (as.DD), L the loadouts (as.DF), I the arsenal (as.DG),
      // U the forge (as.DH)
      case "button_gear": void this.toggleArsenal(); break;
      case "button_loadout": void this.ensureScreens().toggleLoadouts(); break;
      case "button_arsenal": void this.ensureScreens().toggleBackpack(); break;
      case "button_forge": void this.ensureScreens().toggleForge(); break;
      // in town the first activity leads to the Arcade's gates; below, it rides back to Haven
      // (the Rescue Camp's leads to Haven: the elevator its story repairs)
      case "button_haven": if (this.hudContext().town && !this.gate && !RESCUE_CAMP.test(this.scene?.name ?? "")) this.openGates(); else void this.returnToHaven(); break;
      case "button_missions": void this.missions().toggle(); break;
      // the minimap's buttons: the map overlay (ProjectXPrefs map_overlay), the camera zoom and the HUD lock
      case "button_map": this.gameHud?.toggleMap(); break;
      case "button_zoom": this.toggleZoom(); break;
      case "button_lockhud": this.gameHud?.toggleLock(); break;
      // the pet portrait opens the character window on the battle sprite (as.DJ)
      case "pet_portrait": void this.ensureScreens().showCharacter("sprite"); break;
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
      go: async (id, at) => { this.stopPlaying(); await this.selectScene(id); this.resumeAt = at ?? null; await this.startPlaying(); },
      // (a new look on the same stage: the music plays on, client S only re-dresses its knight)
      restart: async () => { this.stopPlaying(true); await this.startPlaying(); },
      world: () => this.world,
      camera: (az, el, dist) => { this.az = az; this.el = el; this.dist = dist * this.options_.zoom; this.fov = 0.75; this.cam = null; },
      // a stage's camera holds its CameraConfig exactly (its fog is set for that distance)
      stageCamera: v => { this.applyCamView(v); this.dist = v.distance; this.cam = { views: [v], zoom: 0, from: v, to: v, t: 1 }; },
      openArsenal: async () => { if (!this.itemScreens?.arsenal.isOpen) await this.toggleArsenal(); },
      arsenalOpen: () => !!this.itemScreens?.arsenal.isOpen,
      colors: () => this.renderer.colors,
      eco: () => this.economy(),
      returnToHaven: () => void this.returnToHaven(),
      focus: () => this.canvas.focus(),
    });
    places.onCreated = () => {
      this.run = { depth: 1, health: null, floors: 0 };
      this.gate = null;
      // a new knight wakes in the crash site ("The Crash Site / Waking in a New World", the
      // tutorial level) when the archive has it, as in the game; else the Rescue Camp (Pod
      // Town), else Haven
      const to = crashSiteScene(this.sceneList) ?? rescueCampScene(this.sceneList)
        ?? this.sceneList.find(s => /haven town square/i.test(s.name)) ?? this.sceneList.find(s => TOWN.test(s.name));
      if (to) void (async () => { this.stopPlaying(); await this.selectScene(to.id); await this.startPlaying(); })();
    };
    places.onCreationBack = () => this.leaveCreation();
    return places;
  }

  private missions(): MissionBoard {
    this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors);
    // (the Featured Items price the depot's goods from the economy)
    if (!this.eco) void this.economy();
    return this.missionBoard ??= new MissionBoard({
      data: this.world?.data ?? new GameData(this.loader), gui: this.gui,
      save: () => this.save, write: () => writeSave(this.save), sound: f => this.uiSound(f),
      stream: (f, gain) => this.ensureAudio().playStream(f, gain, 2),
      toggleArsenal: () => this.toggleArsenal(),
      arsenalOpen: () => !!this.itemScreens?.arsenal.isOpen,
      openForge: () => { if (!this.itemScreens?.recipes.isOpen) void this.ensureScreens().toggleRecipes(); },
      closed: () => { if (!this.itemScreens?.isOpen) this.canvas.focus(); },
      startRun: (g, floors, difficulty) => void this.enterGate(g, floors, false, { difficulty }),
      openGates: () => this.openGates(),
      // the ARCADE tab: today's gates, the run's place on the map, entering a gate at a tier
      gates: () => this.gateSource.choices(0),
      gateRun: () => this.gate?.real ? { gate: this.gate, depth: this.run.depth, wedges: this.floors.slice(0, this.run.depth + 1).map(f => f?.wedge ?? 0) } : null,
      enterGate: (g, tier, difficulty) => {
        if (this.gate) { notice("Finish this run, or return to Haven, before entering another gate."); return; }
        void this.enterGate(g, gateFloors(g), false, { tier, difficulty });
      },
      // the Featured Items: gear the depot prices in energy (src/game/featured.ts)
      featured: {
        source: () => {
          const eco = this.eco;
          return eco ? { info: n => eco.info(n), depotCost: n => eco.depotCost(n) } : null;
        },
        energy: () => energyNow(energyOf(this.save)),
        buy: (name, price) => {
          if (!this.eco || this.save.owned.includes(name) || !spendEnergy(energyOf(this.save), price)) return false;
          this.eco.grant(this.save, name, []);
          writeSave(this.save);
          return true;
        },
        openDepot: () => void this.openShop("Supply Depot"),
      },
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

  private uplink: UplinkScreen | null = null;
  private help: HelpScreen | null = null;

  /** The game's news and mail and help windows (src/ui/uplink.ts, help.ts). */
  private windows() {
    const gui = this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors);
    initNotices(gui);
    const host = {
      sound: (f: string) => this.uiSound(f),
      closed: () => { if (!this.anyWindowOpen()) this.canvas.focus(); },
    };
    this.uplink ??= new UplinkScreen(gui, { ...host, save: () => this.save, write: () => writeSave(this.save) });
    this.help ??= new HelpScreen(gui, { ...host,
      username: () => knightName(this.save),
      // the help's action links: OPTIONS MENU (the controls page) and ENERGY DEPOT
      link: a => {
        if (a === "controls") { this.help?.close(); void this.optionsScreen().open("controls"); }
        else if (a === "exchange") { this.help?.close(); this.hudAction("button_supplydepot"); }
      } });
    this.social ??= new SocialScreen(gui, { ...host,
      knight: () => knightName(this.save),
      guild: () => this.save.guild?.name ?? null,
      whereabouts: () => this.scene?.id === GUILD_HALL ? "guild" : this.hudContext().town ? "town" : "dungeon",
      guildOptions: () => this.guildOptions(),
    });
    this.eventHub ??= new EventHubScreen(gui, { ...host, save: () => this.save, name: () => knightName(this.save),
      missions: () => this.missions().hubMissions(),
      inspect: id => void this.missions().inspect(id),
      // social/client/i.Cj: past the Social window (as.DK) when it is docked open at the left
      dockX: () => (this.social?.isOpen ? this.social.dockedWidth : 0) });
    return { uplink: this.uplink, help: this.help, social: this.social, eventHub: this.eventHub };
  }

  private social: SocialScreen | null = null;
  private eventHub: EventHubScreen | null = null;

  /** True while one of the windows above is open. */
  private anyWindowOpen() {
    return !!(this.uplink?.isOpen || this.help?.isOpen || this.social?.isOpen || this.eventHub?.isOpen || this.summaryScreen?.isOpen);
  }

  /**
   * True while any window stands over the game (the item windows, the boards, the options...).
   * The game goes on behind them, as the online client's does; only the action hint hides.
   */
  private windowOver() {
    return this.anyWindowOpen() || !!(this.itemScreens?.isOpen || this.missionBoard?.isOpen || this.options?.isOpen
      || this.gateBoard_?.isOpen || this.report?.isOpen || this.places.guild.isOpen);
  }

  /**
   * The knight takes no orders (the world still runs): during a conversation or a comlink call
   * (the client's conversation freezes the controller) and while the expedition's REPORT is up
   * at the elevator.
   */
  private get controlLocked() {
    return !!(this.talking || this.conversation?.isOpen || this.report?.isOpen);
  }

  /** Escape: closes the topmost of the windows above; false when none is open. */
  private escapeWindow(): boolean {
    for (const w of [this.summaryScreen, this.help, this.uplink, this.eventHub, this.social]) if (w?.isOpen) { w.escape(); return true; }
    return false;
  }

  /** The social window (F6): friends and the guild, docked at the left. */
  private toggleSocial() {
    const s = this.windows().social;
    s.toggle();
  }

  /**
   * TOGGLE_PANELS (the help's Inventory, Tab): with the character and arsenal windows up, every
   * window closes (as.Eb); else they open (as.Em).
   */
  private togglePanels() {
    const screens = this.ensureScreens();
    if (screens.arsenal.isOpen) {
      screens.closeAll();
      for (const w of [this.help, this.uplink, this.social, this.eventHub]) w?.close();
      return;
    }
    void screens.toggle(screens.arsenal);
  }

  /** as.DO: the Event Hub (F7) opens, or closes when it is open. */
  private openFeed() {
    const hub = this.windows().eventHub;
    if (hub.isOpen) { hub.close(); return; }
    void hub.open();
  }

  /** as.DP: the uplink on its Mail tab (letters kept in the save), or closed when it is open. */
  private openMail() {
    const up = this.windows().uplink;
    if (up.isOpen) { up.close(); return; }
    void up.show("mail");
  }

  /** as.DX's once-a-session windows are still to open (aV.EO: the session's first arrival). */
  private welcomePending = true;

  /**
   * as.DX, on the session's first loading screen finishing (aV.ER): the uplink on its News tab
   * (the live client's content_url deployment) and the Event Hub (outside the development
   * build), unless a scene dialog is up. Here: the first arrival in a town with a knight made.
   */
  private welcome() {
    if (!GAME || !this.welcomePending || !this.save.knight || !this.scene || !TOWN.test(this.scene.name) || /crash site/i.test(this.scene.name)) return;
    if (this.talking || this.anyWindowOpen() || this.missionBoard?.isOpen) return;
    this.welcomePending = false;
    const { uplink, eventHub } = this.windows();
    void uplink.show("news").then(() => eventHub.open());
  }

  /** The help window (the HUD's help button, F1) on its controls page, or the support page (the main menu's Support). */
  private toggleHelp(tab: HelpTab = "controls") {
    const h = this.windows().help;
    h.toggle(tab);
  }

  /** The settings menu (filled in by the settings module). */
  private openSettings() { void this.openOptions(); }

  private options: OptionsScreen | null = null;

  /** The game's own options window (ui/options), bound to our settings. */
  private async openOptions() {
    await this.optionsScreen().open();
  }

  private optionsScreen(): OptionsScreen {
    this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors);
    return this.options ??= new OptionsScreen(this.gui, $<HTMLCanvasElement>("optionsCanvas"), this.options_, {
      changed: () => { saveSettings(this.options_); this.applyOptions(); },
      saveReplaced: d => { this.save = d; },
      // a cheat for trying everything: every equippable item owned, and a million crowns
      unlockAll: async () => {
        const data = this.world?.data;
        if (!data) return false;
        await data.preload("config/item.dat");
        const names = catalogue(data).map(e => e.name);
        this.save.owned = [...new Set([...this.save.owned, ...names])];
        this.save.crowns += 1_000_000;
        writeSave(this.save);
        return true;
      },
      returnToHaven: () => void this.returnToHaven(),
      quit: () => this.leaveGame(false),
      // Logoff: back to the knight select window (the log-on screen when no knight is saved)
      logoff: () => this.leaveGame(true),
      awayFrom: () => (this.world && !/haven/i.test(this.scene?.name ?? "") ? "Haven" : null),
      closed: () => this.canvas.focus(),
      playing: () => !!this.world,
      sound: f => this.uiSound(f),
      sceneNames: () => this.sceneList.map(s => s.name),
    });
  }

  /** Quit and Logoff: the windows close, play stops and the log-on screen (or, logging off, the knight select) comes back. */
  private leaveGame(logoff: boolean) {
    this.gameHud?.closeMenu();
    this.itemScreens?.closeAll();
    for (const w of [this.help, this.uplink, this.social, this.eventHub]) w?.close();
    this.stopPlaying();
    if (!GAME) return;
    void this.enterTitle().then(() => { if (logoff && namedKnights(gameRoster()).length) void this.showPick(); });
  }

  /** Plays a UI feedback sound once audio exists (it starts with the first play). */
  private uiSound(file: string) {
    this.audio ??= new AudioSystem(this.vfs, this.loader);
    this.audio.unlock();
    this.audio.ui(file);
  }

  /** The window-too-small warning (client hud/n), made when play first starts. */
  private tooSmall: TooSmallWarning | null = null;
  private conversation: ConversationScreen | null = null;
  /** Help bubbles pinned in the world. */
  private balloons: Balloons | null = null;

  /**
   * A townsperson's conversation (ProjectXActionConfig.StartConversation): the game's
   * conversation interface with the NPC's lines from the bundles; the NPC turns to the knight
   * and the knight takes no orders while they talk (the world goes on).
   */
  private async openConversation(actor: string, action: any, source: { x: number; y: number; rotation: number }) {
    const w = this.world;
    if (!w || this.conversation?.isOpen || !action?.conversation?.name) return;
    await w.data.preload("config/conversation.dat", "config/actor.dat");
    const impl = w.data.resolveSync("config/conversation.dat", action.conversation, "conversation");
    const conv = impl ? readConversation(impl, action.name ?? "") : null;
    if (!conv || this.world !== w) return;
    const k = w.knight;
    // the NPC's look: the action's model, else its actor's sprite model
    const cfg = w.data.resolveSync("config/actor.dat", { name: actor }, "actor");
    // (a townsperson turns to the knight; a radio call comes from a marker, which stays put)
    if (cfg) source.rotation = Math.atan2(k.y - source.y, k.x - source.x);
    const npcRef = action.model ?? cfg?.sprite?.model ?? null;
    const idle = cfg?.sprite?.idles?.[0]?.animation ?? null;
    this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors);
    const views = new Map<string, PortraitView>();
    this.conversation ??= new ConversationScreen(this.gui, this.canvas.parentElement!, {
      sound: f => this.uiSound(f),
      view: (who, anim) => {
        const ref = who === "knight" ? this.world?.portraitRef() : this.talking?.ref;
        if (!ref) return null;
        const a = who === "knight" ? "character/pc/idle.dat" : anim ?? this.talking?.idle ?? null;
        const key = who + JSON.stringify([ref, a], (kk, v) => (kk === "$outer" ? undefined : v));
        let v = views.get(key);
        if (!v) views.set(key, v = new PortraitView(this.renderer, this.loader, ref, a));
        return (c, g, x, y, ww, h) => v!.draw(c, g, x, y, ww, h);
      },
      closed: () => {
        this.talking = null; views.clear(); this.canvas.focus();
        // the conversation controls hint shows until the knight has talked once
        if (this.save.knight && !this.save.knight.conversed) { this.save.knight.conversed = true; writeSave(this.save); }
      },
    });
    this.talking = { ref: npcRef, idle };
    await this.conversation.start(conv, knightName(this.save), !this.save.knight?.conversed);
  }
  /** The NPC in the conversation: its model and idle animation. */
  private talking: { ref: any; idle: any } | null = null;

  /** The vendor or machine in use: its hint and description stay on the HUD while its windows are open. */
  private vendorAction: ReturnType<World["actionTarget"]> = null;

  /** An alchemy machine: the crafting window (craft/a/o), its hint and target panel staying up. */
  private async openCrafter() {
    this.vendorAction = this.world?.actionTarget() ?? null;
    this.vendorOpening = true;
    try {
      await this.ensureScreens().openCrafter();
    } catch (e) {
      console.error("crafting window failed", e);
    } finally { this.vendorOpening = false; }
  }

  /** A vendor's or machine's windows are on their way (its hint stays up meanwhile). */
  private vendorOpening = false;
  /** The keeper whose shop opened last. */
  private shopKeeper: string | null = null;

  /** A shopkeeper's stock, by what the NPC's config name says it sells. */
  private async openShop(keeper: string, portrait: { ref: any; idle: any } | null = null) {
    // (the game runs on behind the shop: using its keeper again leaves it as it is)
    if (this.vendorOpening || (this.itemScreens?.shop.isOpen && this.shopKeeper === keeper)) return;
    this.shopKeeper = keeper;
    this.vendorAction = this.world?.actionTarget() ?? null;
    this.vendorOpening = true;
    try { await this.openShop_(keeper, portrait); } catch (e) { console.error("shop failed", e); } finally { this.vendorOpening = false; }
  }

  private async openShop_(keeper: string, portrait: { ref: any; idle: any } | null) {
    const eco = await this.economy();
    // in the Clockworks a terminal's keepers stock their tier (Basil sells its recipes, the
    // Supply Depot its supplies); Haven's bazaar shows what progress has unlocked
    const f = this.gate ? this.floors[this.run.depth] : null;
    const tier = f && f.depth > 0 ? f.tier : 0;
    const maxRarity = f ? Math.max(shopTier(this.save), tierStars(f.tier)) : shopTier(this.save);
    // Basil in a mission's lobby stocks that mission's recipes (src/game/vendors.ts)
    const kp = eco.keeper(keeper, { tier, maxRarity, mission: this.gate?.id.startsWith("mission:") ? this.gate.name : null });
    // Basil's stock changes each visit (catalogCycle INSTANCE): seeded by the gate and depth;
    // Haven's Strangers draw the random part of their wiki lists per knight and day
    const stock = eco.catalogue(kp, { seed: (this.gate?.seed ?? 0) + this.run.depth * 7919 + Math.floor(Date.now() / 86400000), player: knightName(this.save) });
    // the keeper's name and title line from its description config, in the shop bundle
    const desc = await (this.world?.data ?? new GameData(this.loader)).actorDescription(keeper).catch(() => null);
    await this.ensureScreens().openShop(text("shop", desc?.dname, kp.title), stock, kp.maxRarity, portrait, text("shop", desc?.title, ""));
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
  /** The chat overlay's lines (loot messages). */
  private readonly chat = new ChatLog();

  /**
   * A find's loot message in the chat (dungeon m.item_awarded: "You have obtained Material
   * (Bronze Bolt)."), its group as ItemCodes.Group names it, unless Loot Messages filters it.
   */
  private lootMessage(item: string, count: number) {
    const eco = this.eco ?? this.world?.economy ?? null, info = eco?.info(item) ?? null;
    if (!shouldReportLoot(this.options_.lootMessages, info?.rarity ?? 0, count, this.run.depth)) return;
    const cat = info?.category ?? "";
    const group = /^Rarity\//.test(item) ? text("item", "m.rarity", "Rarity")
      : itemType(cat === "deposit" ? "mineral" : cat === "pickup" ? (/^Pickup\/Vial\//.test(item) ? "vial" : "capsule") : cat === "other" || !cat ? "item" : cat, "Item");
    let name = itemName(item);
    if (count > 1) name = hasMessage("global", "m.multiple") ? message("global", "m.multiple", count, name) : `${name} x${count}`;
    this.chat.add(hasMessage("dungeon", "m.item_awarded") ? message("dungeon", "m.item_awarded", group, name) : `You have obtained ${group} (${name}).`);
  }

  /**
   * The prize wheel after a floor with monsters (src/game/prizewheel.ts): the reel's prize is
   * given when it lands, crowns and materials banked, hearts and pickups on the knight.
   */
  private prizeWheel(): PrizeWheel | null {
    const w = this.world;
    if (!w || w.arena) return null;
    const floor = this.gate ? this.floors[this.run.depth] : null;
    if (!floorHasWheel(floor?.kind, w.killCount)) return null;
    const reel = buildReel(w.prizeSource());
    const eco = this.eco ?? w.economy ?? null;
    const slot = (p: Prize) => {
      const icon = eco?.info(p.item)?.icon ?? null;
      const base = itemName(p.item);
      const name = p.kind !== "crowns" && p.count > 1 && hasMessage("global", "m.multiple") ? message("global", "m.multiple", p.count, base) : base;
      return { name, icon, shine: !/^Instant\/Heart\//.test(p.item) };
    };
    const prize = reel[0];
    return {
      reel: reel.map(slot),
      landed: () => {
        if (prize.kind === "crowns") this.save.crowns += prize.count;
        else if (prize.kind === "material") this.save.materials[prize.item] = (this.save.materials[prize.item] ?? 0) + prize.count;
        else if (this.world === w) {
          w.awardPrize(prize);
          if (prize.kind === "heart") this.run.health = w.knight.health;
        }
        if (prize.kind !== "heart") this.lootMessage(prize.item, prize.count);
        writeSave(this.save);
      },
    };
  }

  private bankLoot(l: World["loot"]): string[] {
    const notes: string[] = [];
    const eco = this.eco ?? this.world?.economy ?? null;
    this.save.crowns += l.crowns;
    this.save.heat += l.heat;
    for (const [k, v] of l.materials) this.save.materials[k] = (this.save.materials[k] ?? 0) + v;
    // (the expedition's loot, for its REPORT)
    this.runCrowns += l.crowns;
    for (const [k, v] of l.materials) this.runLoot.set(k, (this.runLoot.get(k) ?? 0) + v);
    for (const it of l.items) this.runLoot.set(it.name, (this.runLoot.get(it.name) ?? 0) + 1);
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
    if (eco) for (const up of eco.addHeat(this.save, l.heat)) notes.push(`${itemName(up.name)} is ready to forge to level ${up.level + 1}`);
    return notes;
  }

  /**
   * The floor's heat report (client EndOfLevelWindow), worked out before the heat is banked: the
   * floor's heat shared evenly between the equipped items that can take it, each row's progress
   * toward its next level before and after; items at the top level are listed with no gain.
   */
  private heatReport(raw: number): HeatReport | null {
    const eco = this.eco ?? this.world?.economy ?? null;
    if (!eco || raw <= 0) return null;
    const items = eco.heatedItems(this.save);
    if (!items.length) return null;
    const total = eco.heatGain(this.save, raw);
    const each = total / items.length;
    const row = (name: string, gain: number): HeatRow => {
      const state = this.save.gear[name] ?? { heat: 0, level: 1, variants: [] };
      const before = eco.heatProgress(this.save, name);
      // the bar fills no further than the level's end: the item then waits for the forge
      const trial = { ...this.save, gear: { ...this.save.gear, [name]: { ...state, variants: [...(state.variants ?? [])], heat: eco.heatAfter(name, state, gain) } } };
      const after = eco.heatProgress(trial, name);
      const levelUp = gain > 0 && before < 1 && after >= 1;
      const icon = eco.info(name)?.icon;
      return { name: eco.displayName(name, state), icon: icon?.file ?? "ui/icon/inventory/blank.png", colorizations: icon?.colorizations ?? [],
        level: state.level, before, after, levelUp };
    };
    const l = this.save.loadout;
    const maxed = [...new Set([...l.weapons, l.shield, l.armor, l.helmet])].filter(n => n && !items.includes(n) && this.save.owned.includes(n) && eco.info(n)?.heatable);
    return { total: Math.round(total), rows: [...items.map(n => row(n, each)), ...maxed.map(n => row(n, 0))] };
  }

  /** The knight reached the exit elevator: offer the next floor. */
  private floorCleared() {
    if (!this.world) return;
    if (!this.gate && this.scene && crashSiteScene([this.scene])) {
      // the crash site's way out leads into the Rescue Camp (else Haven), the loot banked
      const notes = this.bankLoot(this.world.loot);
      this.runTotals.notes.push(...notes);
      recordKills(this.save, this.world.killCount);
      writeSave(this.save);
      const camp = rescueCampScene(this.sceneList);
      if (camp) void (async () => { this.stopPlaying(); await this.selectScene(camp.id); await this.startPlaying(); })();
      else void this.returnToHaven();
      return;
    }
    if (this.inLobby && this.gate) {
      // the Mission Lobby's elevator: down to the mission's first floor
      const next = this.floors[this.run.depth + 1];
      const here = this.floors[this.run.depth], mission = this.gate.id.startsWith("mission:");
      void this.screens().elevator.show({
        title: here?.kind === "lobby" ? here.name : messageText("%dungeon:m.mission_lobby"),
        next: next ? loadingInfo(next.name, next, this.gate.name) : null,
        // (a lobby is a safe level: the stripe without its title; no tally, labelWaiting stays hidden)
        tally: "", safe: true,
        advance: { label: "Advance", run: () => { this.inLobby = false; void this.descend(); } },
        quit: { run: () => { if (mission) this.missionBoard?.runAbandoned(); this.quitExpedition(); } },
      });
      return;
    }
    // bank what the floor gave (the heat report is read first, from the items' heat before)
    const l = this.world.loot;
    const heat = this.heatReport(l.heat);
    const notes = this.bankLoot(l);
    this.save.bestDepth = Math.max(this.save.bestDepth, this.run.depth);
    recordKills(this.save, this.world.killCount);
    if (this.bossFloor && !this.bossAlive()) {
      // the Event Hub's boss line (FeedEvent.Boss): the lair's boss in a Shadow Lair
      const key = FEED_BOSS[this.bossFloor];
      if (key) logFeed(this.save, { kind: "boss", key: /^lair:/.test(this.gate?.id ?? "") ? "sl_" + key : key, at: Date.now() });
      this.achieve(recordBoss(this.save, this.bossFloor));
    } else this.achieve();
    const t = this.runTotals;
    t.kills += this.world.killCount; t.crowns += l.crowns; t.heat += l.heat;
    t.materials += [...l.materials.values()].reduce((a, b) => a + b, 0);
    t.deepest = Math.max(t.deepest, this.run.depth);
    writeSave(this.save);
    this.run.health = this.world.knight.health;
    this.run.floors++;
    this.runTotals.notes.push(...notes);
    const tally = `${l.crowns} crowns, ${l.heat} heat`;
    const prize = this.prizeWheel();
    const { elevator } = this.screens();
    // a terminal's Shadow Lair elevator: down into that boss's Shadow Lair
    const lair = this.gate ? LAIR_GATES[String(this.world.exitElevator?.args["Push Gate"] ?? "")] : undefined;
    if (lair && /Shadow Lair/.test(this.world.exitElevator?.entity.name ?? "")) {
      const run = lairRun(lair, this.save.runs), first = run.floors.find(Boolean)!;
      void elevator.show({
        title: "", next: loadingInfo(first.name, first, run.gate.name), tally, heat, prize,
        advance: { label: "Advance", run: () => { this.elevator?.hide(); void this.enterGate(run.gate, run.floors, true); } },
        quit: { run: () => this.quitExpedition() },
      });
      return;
    }
    if (this.gate) {
      // in a gate: on to the next depth, or ride back up to Haven with the loot banked; on a real
      // gate the next depth's level is locked in as the knight steps on the elevator
      const d = this.run.depth, here0 = this.floors[d];
      if (this.gate.real && d < 29) this.floors[d + 1] = realFloor(this.gate, d + 1, lockNext(this.gate.real, d, here0?.wedge ?? 0, Date.now()));
      const next = this.floors[this.run.depth + 1];
      void elevator.show({
        title: "",
        next: next ? loadingInfo(next.name, next, this.gate.name) : { title: "Haven", zone: "Home sweet Home", depth: "" },
        tally, heat, prize,
        advance: { label: next ? "Advance" : "Ride Up", run: () => void this.descend() },
        quit: next ? { run: () => this.quitExpedition() } : null,
      });
      // an Arcade stratum cleared counts for prestige gate missions of its theme
      const here = this.floors[this.run.depth], s = here?.stratum;
      if (s && here.depth === s.last && !/^(mission|lair):/.test(this.gate.id)) { const b = this.missions(); void b.load().then(() => b.stratumCleared(s.theme, this.runDifficulty)); }
    } else {
      const nl = this.nextLevel();
      // past the Core the Clockworks go on: cycle the levels again, deeper
      const deeper = !nl && this.run.depth < 29;
      void elevator.show({
        title: nl ? "" : "Back to Haven",
        next: nl ? { ...loadingInfo(nl.name, null), depth: `DEPTH ${this.run.depth + 1}` } : deeper ? { title: "Deeper", zone: "A new floor below the Core", depth: `DEPTH ${this.run.depth + 1}` } : { title: "Haven", zone: "Home sweet Home", depth: "" },
        tally, heat, prize,
        advance: { label: nl || deeper ? "Advance" : "Ride Up", run: () => void this.descend(deeper) },
        quit: deeper ? { run: () => void this.descend() } : null,
      });
    }
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
    this.runTotals.notes.push(...notes);
    void this.screens().elevator.show({
      title: `Arena: wave ${wave} cleared`,
      next: { title: "Arena", zone: `Wave ${wave + 1} awaits`, depth: "" },
      tally: `Loot banked: ${this.save.crowns} crowns`,
      advance: { label: "Fight On", run: () => this.world?.continueArena() },
      quit: { run: () => void this.descend() },
    });
  }

  /** Pays crowns: the floor's loot first, then the bank's; false (nothing paid) when short. */
  private payCrowns(n: number): boolean {
    const l = this.world?.loot, fromFloor = Math.min(l?.crowns ?? 0, n);
    if (fromFloor + this.save.crowns < n) return false;
    if (l) l.crowns -= fromFloor;
    this.save.crowns -= n - fromFloor;
    return true;
  }

  private reviveScreen: ReviveScreen | null = null;

  /** The knockout window: use a Spark of Life, or buy one with crowns. */
  private async openRevive() {
    this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors);
    const sparkView = new PortraitView(this.renderer, this.loader, undefined, null);
    this.reviveScreen ??= new ReviveScreen(this.gui, $<HTMLCanvasElement>("reviveCanvas"), {
      sparks: () => this.save.sparks ?? 3,
      price: () => this.reviveCost(),
      energy: () => energyNow(energyOf(this.save)),
      canBuy: () => {
        const short = Math.max(0, this.reviveCost() - energyNow(energyOf(this.save)));
        return short === 0 || (this.world?.loot.crowns ?? 0) + this.save.crowns >= exchangeCost(short);
      },
      use: () => {
        const n = this.save.sparks ?? 3;
        if (n <= 0 || !this.world) return false;
        this.save.sparks = n - 1;
        recordRevive(this.save);
        this.achieve();
        this.world.revive();
        this.world.energyBlast();
        this.knockedOut = false;
        this.uiSound("sound/feedback/ui_confirm.ogg");
        this.canvas.focus();
        return true;
      },
      buy: () => {
        // a spark for energy (the exchange buys any shortfall with crowns)
        if (!payEnergy(energyOf(this.save), this.reviveCost(), c => this.payCrowns(c))) return false;
        this.save.sparks = (this.save.sparks ?? 3) + 1;
        writeSave(this.save);
        return true;
      },
      sound: f => this.uiSound(f),
      giveUp: () => this.giveUp(),
    }, { view: (c, g, x, y, w, h) => sparkView.draw(c, g, x, y, w, h) });
    await this.reviveScreen.open();
  }

  /** The knight is down and the revive window is up. */
  private knockedOut = false;

  /** Gives up after a knockout: back to Haven, the floor's loot lost. */
  private giveUp() {
    this.knockedOut = false;
    this.reviveScreen?.close();
    this.missionBoard?.runAbandoned();
    void this.returnToHaven();
  }

  /** Uses a pocket item (slot i); capsules count toward achievements. */
  private usePocket(i: number) {
    const item = this.world?.pocket[i]?.[0];
    if (!item || !this.world?.useItem(i)) return;
    recordPocketUse(this.save, item);
    this.achieve();
  }

  /**
   * Checks the achievements (src/game/achievements.ts) against the save, with those an event
   * just earned, writes the save and announces the new ones.
   */
  private achieve(earned: AchievementType[] = []) {
    const eco = this.eco;
    const got = [...earned, ...evaluateAchievements(this.save, n => eco?.info(n) ?? null)];
    // the knight made it to Haven (after creation)
    if (this.save.knight && /haven/i.test(this.scene?.name ?? "")) got.push(...recordHaven(this.save));
    if (this.save.knight && RESCUE_CAMP.test(this.scene?.name ?? "")) got.push(...recordRescueCamp(this.save));
    writeSave(this.save);
    for (const t of got) {
      const d = ACHIEVEMENTS.find(a => a.type === t);
      if (d) notice(`${messageText("m.achievement_unlocked", "chat").replace(/\.$/, "")}: ${messageText(d.nameKey, "projectx")}`);
    }
  }

  /**
   * Energy a Spark of Life costs in the knockout window: the client's dungeonSparkOfLifeCost
   * default, the same at every depth (the wiki's 50; towns are free).
   */
  private reviveCost() { return TOWN.test(this.scene?.name ?? "") ? 0 : SPARK_COST; }

  /** The run summary on arrival in Haven (the game's mission-complete window). */
  private summaryScreen: RunSummaryScreen | null = null;

  private report: ReportScreen | null = null;

  /**
   * QUIT EXPEDITION at the elevator (EndOfLevelWindow.bX(false), then its END state): the
   * expedition's REPORT (dungeon/client/e) over the level, the knight and the loot the run
   * took; ADVANCE NOW goes on to the loading screen back to Haven.
   */
  private quitExpedition() {
    if (/^mission:/.test(this.gate?.id ?? "")) this.missionBoard?.runAbandoned();
    this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors);
    this.report ??= new ReportScreen(this.gui, { sound: f => this.uiSound(f), closed: () => undefined }, (c, g, x, y, w, h) => {
      const wd = this.world;
      if (!wd) return;
      const key = JSON.stringify(wd.portraitRef(), (k, v) => (k === "$outer" ? undefined : v));
      if (this.reportView?.key !== key) this.reportView = { key, view: new PortraitView(this.renderer, this.loader, wd.portraitRef(), "character/pc/animation_pose_dash.dat") };
      this.reportView.view.draw(c, g, x, y, w, h);
    });
    const eco = this.eco;
    const loot = [...this.runLoot].map(([name, count]) => {
      const it = eco?.info(name);
      return { name, label: itemName(name), count, rarity: it?.rarity ?? 0, icon: it?.icon ?? null };
    });
    void this.report.show({ knight: knightName(this.save), crowns: this.runCrowns, loot, done: () => void this.returnToHaven(false) });
  }
  private reportView: { key: string; view: PortraitView } | null = null;
  /** The expedition's crowns and loot so far (for its REPORT). */
  private runCrowns = 0;
  private runLoot = new Map<string, number>();

  /** Back to Haven; the end of a gate run shows what it brought home unless its REPORT has (`summary` false). */
  private async returnToHaven(summaryShown = true) {
    this.inLobby = false;
    // the last boss floor's boss is not this level's (its music, locked exit, records)
    this.bossFloor = null;
    // the end of a gate run: a summary of what it brought home
    const t = this.runTotals;
    const summary = summaryShown && (this.gate || t.deepest) ? { ...t, best: this.save.bestDepth } : null;
    this.runCrowns = 0;
    this.runLoot = new Map();
    this.gate = null;
    recordRunEnd(this.save);
    this.runTotals = { kills: 0, crowns: 0, heat: 0, materials: 0, deepest: 0, gate: "", notes: [] };
    this.stopPlaying();
    this.run = { depth: 0, health: null, floors: 0 };
    const haven = this.sceneList.find(s => /haven town square/i.test(s.name)) ?? this.sceneList.find(s => TOWN.test(s.name));
    if (!haven) return;
    await this.selectScene(haven.id);
    await this.startPlaying();
    if (summary && summary.deepest > 0) {
      this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors);
      this.summaryScreen ??= new RunSummaryScreen(this.gui, { sound: f => this.uiSound(f), closed: () => this.canvas.focus() });
      void this.summaryScreen.show({
        title: "Back in Haven",
        name: summary.gate || "The Clockworks",
        lines: [`Deepest depth this run: ${summary.deepest} (deepest ever: ${summary.best})`, `${summary.kills} monsters defeated`,
          `${summary.materials} materials and items found`, ...summary.notes],
        crowns: summary.crowns, heat: summary.heat,
      });
    }
  }

  /** The cached levels in run order. */
  // ------------------------------------------------------------------ the Arcade and its gates

  private gateBoard_: GateBoard | null = null;
  /** The Arcade's real gates (src/game/gatesource.ts), generated ones when they cannot be had. */
  private readonly gateSource = new GateSource();
  /** The Arcade's gate board (the game's adventure board, src/ui/gates.ts). */
  get gateBoard(): GateBoard {
    this.gui ??= new GuiContext(this.loader, this.vfs, this.renderer.colors);
    return this.gateBoard_ ??= new GateBoard(this.gui, {
      sound: f => this.uiSound(f),
      closed: () => this.canvas.focus(),
      gates: older => this.gateSource.choices(older),
      gate: e => this.gateSource.gate(e),
      offline: () => this.gateSource.offline,
      run: () => this.gate?.real ? { gate: this.gate, depth: this.run.depth, wedges: this.floors.slice(0, this.run.depth + 1).map(f => f?.wedge ?? 0) } : null,
      progress: () => progressOf(this.save),
      enter: g => {
        if (this.gate) { notice("Finish this run, or return to Haven, before entering another gate."); return; }
        void this.enterGate(g);
      },
      arena: () => void this.enterArena(),
      missions: () => void this.missions().open(),
    });
  }

  /**
   * The Arcade's gate board: today's four gates and the Arena, each gate's lineup on the
   * map with its level and theme icons, as the game's adventure board draws them.
   */
  private openGates() {
    void this.gateBoard.openOn(this.gate);
  }

  /**
   * Starts a gate at depth 1, or (the mission board's tier buttons, board/a/b: "TIER 2 (Depth
   * 8)") at its tier's first depth, at a difficulty (the party configuration's; DungeonCodes
   * Difficulty: monster health, status effects and rewards).
   */
  private async enterGate(g: Gate, floors = gateFloors(g), keepTotals = false, opts: { tier?: number; difficulty?: Difficulty } = {}) {
    this.gate = g;
    this.bossFloor = null;
    this.runDifficulty = opts.difficulty ?? (keepTotals ? this.runDifficulty : difficultyPref());
    if (keepTotals) this.runTotals.gate = g.name;
    else {
      this.runTotals = { kills: 0, crowns: 0, heat: 0, materials: 0, deepest: 0, gate: g.name, notes: [] };
      this.runCrowns = 0;
      this.runLoot = new Map();
    }
    this.usedScenes.clear();
    this.floors = floors;
    const startAt = [1, 8, 18][Math.max(0, Math.min(2, (opts.tier ?? 1) - 1))];
    // a real gate: the first depth's level is the one the Arcade's elevator leads to now
    if (g.real) this.floors[startAt] = realFloor(g, startAt, lockNext(g.real, startAt - 1, 0, Date.now()));
    this.arenaMode = false;
    // the descent starts above the first floor (a mission's floors start deeper; a deeper tier's above its first depth)
    this.run = { depth: Math.max(0, floors.findIndex(f => f && f.depth > 0) - 1), health: null, floors: 0 };
    if (startAt > 1 && this.floors[startAt]) {
      this.run.depth = startAt - 1;
      recordRunStart(this.save, this.run.depth);
      await this.descend();
      return;
    }
    if (!/^(mission|lair):/.test(g.id)) recordRunStart(this.save, this.run.depth);
    // a mission starts in the Mission Lobby (the client's LOBBY level: knights gear up, then
    // its elevator takes them down), or its own lobby (Base Camp, Ancient Grove...), when the
    // level archive has it; some missions have none (the Hall of Heroes, the Lab, a Shadow Lair)
    // (the archive holds several revisions: the newest scene id, not an instance's huge one)
    const own = g.lobby ? this.archive.level(`m.${g.lobby}`) : null;
    const lobby = g.id.startsWith("mission:") && g.lobby !== null ? own ?? this.sceneList.filter(s => /^mission lobby$/i.test(s.name) && Number(s.id) < 1e6)
      .sort((a, b) => Number(b.id) - Number(a.id))[0] ?? null : null;
    // an Arcade gate starts in its party lobby (depth 0, the client's arcade_lobby level: the
    // gate's pillar, the lobby consoles, Kozma's Supply Depot and the elevator to depth 1)
    const party = !lobby && this.run.depth === 0 && floors[0]?.kind === "lobby" ? this.archive.level("m.arcade_lobby") : null;
    if (lobby || party) {
      this.inLobby = true;
      this.stopPlaying();
      await this.selectScene((lobby ?? party)!.id);
      await this.startPlaying();
      return;
    }
    await this.descend();
  }

  /**
   * The scene for a floor of the gate: the game's own level from the archive wherever it has
   * one (src/game/archive.ts). Terminals, subtowns and the Core are their archived scenes; a
   * boss stratum's floors are its stages, the boss's own lair last; other floors take an
   * archived level of the stratum's style and theme not yet played this run. Otherwise the
   * floor is generated: painted with the style's tileset and re-themed with the stratum's
   * monsters, and for a boss, an arena of our own with the boss waiting by the exit.
   */
  private floorScene(f: Floor): { id: string; name: string } | null {
    const a = this.archive;
    if (f.kind === "terminal") return a.level("m.terminal_1");
    if (f.kind === "core") return a.level("m.terminal_core") ?? a.level("m.terminal_1");
    if (f.kind === "subtown" && f.depth === 18) return a.level("m.emberlight") ?? a.level("m.terminal_1");
    if (f.kind === "subtown") {
      const real = a.level("m.moorcroft");
      if (real) return real;
      // without Moorcroft Manor in the archive: a generated town in the graveyard's tiles
      const id = `gen:${genTheme("graveyard")}:${((this.gate?.seed ?? 1) + 8) >>> 0}`;
      this.safeGen.add(id);
      this.genNames.set(id, "Moorcroft Manor");
      return { id, name: "Moorcroft Manor" };
    }
    const s = f.stratum!;
    const seed = ((this.gate?.seed ?? 1) * 31 + f.depth * 977 + this.save.runs * 7919) >>> 0;
    if (f.level) return this.realFloorScene(f, seed);
    if (f.mission) return this.missionFloorScene(f, seed);
    // a boss stratum's own stage (the boss's lair on its last floor)
    if (f.levelKey) {
      const real = a.level(f.levelKey);
      if (real) return real;
    }
    if (f.kind === "level" && !f.special && !f.levelKey) {
      const options = a.forStratum(s.style.key, s.theme).filter(l => !this.usedScenes.has(l.id));
      if (options.length) {
        const real = options[Math.floor(rng(seed)() * options.length)];
        this.usedScenes.add(real.id);
        // the floor takes the level's own name ("Clockwork Tunnels|Wild Path")
        const t = levelText("m." + real.name.replace(/ /g, "_"));
        if (t) { f.name = t.title; f.zone = t.zone || undefined; }
        return real;
      }
    }
    const theme = genTheme(f.tileset);
    // a floor of a style the servers generate (tunnels, keeps, dens...): built from the
    // prefab rooms of the captured floors of that style (src/gen/assemble.ts)
    const element = (["Fire", "Freeze", "Poison", "Shock"] as string[]).includes(s.theme) ? s.theme.toLowerCase() : "none";
    if (f.kind === "level" && !f.special && !f.levelKey && a.prefabSources(s.style.key, null, true).length) {
      const id = `gen:pf-${s.style.key}-${element}:${seed}`;
      this.genFallback.set(id, theme);
      this.genTables.set(id, stratumTables(s.theme, rng(seed)));
      this.genNames.set(id, `${f.name} · ${s.theme}`);
      return { id, name: `${f.name} · depth ${f.depth}` };
    }
    const id = f.kind === "boss" ? `gen:${theme}:${seed}:${s.boss}` : `gen:${theme}:${seed}`;
    this.genTables.set(id, stratumTables(s.theme, rng(seed)));
    this.genNames.set(id, f.kind === "boss" ? f.name : `${f.name} · ${s.theme}`); // no parentheses: TOWN matches "("
    if (f.special) this.genStyles.set(id, f.special);
    return { id, name: `${f.name} · depth ${f.depth}` };
  }
  /**
   * A real gate's level (src/game/gatemap.ts): the game's own from the archive (its fixed
   * revision, or one of the floors of it the servers generated and the client cached); else a
   * floor assembled from the captured prefab rooms of its style and status; else the older
   * generator in its style's tiles, with the level's monster family.
   */
  private realFloorScene(f: Floor, seed: number): { id: string; name: string } | null {
    const lv = f.level!, a = this.archive, s = f.stratum;
    const copies = a.copies(lv.key);
    if (copies.length) {
      const fresh = copies.filter(c => !this.usedScenes.has(c.id));
      const pick = (fresh.length ? fresh : copies)[Math.floor(rng(seed)() * (fresh.length || copies.length))];
      this.usedScenes.add(pick.id);
      return pick;
    }
    const family = lv.family ?? (s?.theme as any) ?? "Construct";
    const tables = stratumTables(lv.family ?? s?.theme ?? "Construct", rng(seed));
    const theme = genTheme(f.tileset || "clockworks");
    const label = `${f.name}${f.zone ? " " + f.zone : ""}`;
    if (lv.kind === "level" && lv.style && a.prefabSources(lv.style, null, true).length) {
      const id = `gen:pf-${lv.style}-${lv.element ? lv.element.toLowerCase() : "none"}:${seed}`;
      this.genFallback.set(id, theme);
      this.genTables.set(id, tables);
      this.genNames.set(id, `${label} · ${family}`);
      return { id, name: `${f.name} · depth ${f.depth}` };
    }
    const id = f.kind === "boss" && lv.boss ? `gen:${theme}:${seed}:${lv.boss}` : `gen:${theme}:${seed}`;
    this.genTables.set(id, tables);
    this.genNames.set(id, f.kind === "boss" ? f.name : `${label} · ${family}`);
    if (f.special) this.genStyles.set(id, f.special);
    return { id, name: `${f.name} · depth ${f.depth}` };
  }
  /**
   * A mission's own floor (src/game/missionfloors.ts): its level from the archive (its fixed
   * revision, or a floor of it the servers generated and the client cached; one of the keys the
   * floor rotates between); else a floor in the style its key names, assembled from the captured
   * prefab rooms of that style and status or generated in its tiles, with the floor's monsters;
   * a boss floor without its level is the boss's generated arena.
   */
  private missionFloorScene(f: Floor, seed: number): { id: string; name: string } {
    const ms = f.mission!, a = this.archive, s = f.stratum;
    const copies = ms.keys.flatMap(k => a.copies(`m.${k}`));
    if (copies.length) {
      const fresh = copies.filter(c => !this.usedScenes.has(c.id));
      const pool = fresh.length ? fresh : copies;
      const pick = pool[Math.floor(rng(seed)() * pool.length)];
      this.usedScenes.add(pick.id);
      return pick;
    }
    const theme = genTheme(f.tileset || "clockworks");
    const tables = stratumTables(ms.element ?? ms.family, rng(seed));
    const label = `${f.name}${f.zone ? " " + f.zone : ""}`;
    if (f.kind === "boss" && s?.boss) {
      const id = `gen:${theme}:${seed}:${s.boss}`;
      this.genTables.set(id, tables);
      this.genNames.set(id, f.name);
      return { id, name: `${f.name} · depth ${f.depth}` };
    }
    if (a.prefabSources(ms.style, null, true).length) {
      const id = `gen:pf-${ms.style}-${ms.element ? ms.element.toLowerCase() : "none"}:${seed}`;
      this.genFallback.set(id, theme);
      this.genTables.set(id, stratumTables(ms.family, rng(seed)));
      this.genNames.set(id, `${label} · ${ms.family}`);
      return { id, name: `${f.name} · depth ${f.depth}` };
    }
    const id = `gen:${theme}:${seed}`;
    this.genTables.set(id, tables);
    this.genNames.set(id, `${label} · ${ms.family}`);
    return { id, name: `${f.name} · depth ${f.depth}` };
  }

  /**
   * Whether an elevator the knight stands on runs: a terminal's Shadow Lair elevators (one per
   * boss, by their "Push Gate") only from the depth-23 terminal of a gate with that boss. (The
   * game also wants a Shadow Key; there are none here.)
   */
  private lairElevator(p: Prop): boolean {
    if (!/Shadow Lair/.test(p.entity.name)) return true;
    const key = LAIR_GATES[String(p.args["Push Gate"] ?? "")];
    const f = this.gate ? this.floors[this.run.depth] : null;
    const open = !!key && !!f && f.kind === "terminal" && f.depth === 23 && !!this.gate?.strata.some(s => s.boss === key);
    if (!open && this.world && Date.now() - this.lairNotice > 4000) {
      this.lairNotice = Date.now();
      const k = this.world.knight;
      this.world.say(k.x, k.y, key ? `Sealed: the Shadow Lair of a gate with ${bossName(key)}, from the depth-23 terminal` : "Sealed", "#c9a6ff");
    }
    return open;
  }
  private lairNotice = 0;

  /** Development: plays a boss's Shadow Lair from its first floor (window.__viewer.testLair("twins")). */
  async testLair(key: BossKey) {
    this.stopPlaying();
    const run = lairRun(key, this.save.runs);
    await this.enterGate(run.gate, run.floors);
  }

  /** Development: starts a mission's run by its id (window.__viewer.testMission("alien_ooze")), its floors as the board would play them. */
  async testMission(id: string) {
    const b = this.missions();
    await b.load();
    const m = b.missionById(id);
    if (!m) return null;
    this.stopPlaying();
    const run = missionRun(m, this.save.runs);
    b.track(m);
    await this.enterGate(run.gate, run.floors);
    return run.floors.filter(Boolean).map(f => `${f.depth} ${f.name}${f.zone ? ": " + f.zone : ""} [${f.mission?.keys.join("/") ?? ""}]`);
  }

  private usedScenes = new Set<string>();
  /** In the Mission Lobby before a mission's first floor (or a gate's party lobby). */
  private inLobby = false;
  /** The difficulty the gate run is played at (the party configuration's; DungeonCodes.Difficulty). */
  private runDifficulty: Difficulty = "medium";
  /** In an Arcade gate's party lobby (depth 0, the arcade_lobby level). */
  private get gateLobby(): boolean { return !!this.gate && this.inLobby && this.floors[this.run.depth]?.kind === "lobby"; }

  /** A boss floor: the boss's fight director runs its arena; the exit stays shut until it is won. */
  private spawnBoss(key: BossKey, ultimate = false) {
    // on the game's own boss level the level's logic brings the boss on, and the director
    // runs the parts of the fight that are server code; on a generated arena it runs it all
    if (this.world && this.scene) startBossFight(key, this.world, !GEN.test(this.scene.id), ultimate);
  }

  /** The boss of this floor is still standing. */
  private bossAlive(): boolean {
    const w = this.world;
    if (!w || !this.bossFloor) return false;
    return !(w.boss as BossFight | null)?.defeated;
  }

  /**
   * Development: plays a boss's level (window.__viewer.testBoss("snarbolax")): the game's own
   * when the archive has it, else (or with `arena`) a generated arena.
   */
  async testBoss(key: BossKey, depth = BOSSES[key].tier === 1 ? 7 : BOSSES[key].tier === 2 ? 17 : 28, arena = false) {
    this.stopPlaying();
    this.arenaMode = false;
    this.bossFloor = key;
    this.run = { depth, health: null, floors: 0 };
    const real = arena ? null : this.archive.level(BOSSES[key].levelKey);
    const id = real?.id ?? `gen:${genTheme(BOSSES[key].tileset)}:${(Math.random() * 1e9) >>> 0}:${key}`;
    if (!real) this.genNames.set(id, BOSSES[key].level);
    await this.selectScene(id);
    await this.startPlaying();
    this.spawnBoss(key);
    return this.world?.boss ?? null;
  }

  private runLevels(): { id: string; name: string }[] {
    const levels = RUN_ORDER.map(n => this.sceneList.find(s => s.name.toLowerCase().startsWith(n))).filter((s): s is { id: string; name: string } => !!s);
    // levels in the cache that the order does not name come before the Core
    for (const s of this.sceneList) if (!TOWN.test(s.name) && !LOBBY.test(s.name) && !levels.includes(s)) levels.splice(levels.length - 1, 0, s);
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
    if (!this.scene || TOWN.test(this.scene.name) || LOBBY.test(this.scene.name)) return levels[0] ?? null;
    const i = levels.findIndex(s => s.id === this.scene!.id);
    return i >= 0 && i + 1 < levels.length ? levels[i + 1] : null;
  }

  /**
   * Takes the elevator: the run's next level, one depth deeper. The cache holds only levels
   * this account has visited, so the run goes through those; after the last, back to Haven.
   */
  private async descend(deeper = false) {
    this.elevator?.hide();
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
      const lock = /^(mission|lair):/.test(this.gate.id) ? null : tierLock(f.tier, progressOf(this.save));
      if (lock) { this.gate = null; await this.returnToHaven(); notice(lock); return; }
      const sc = this.floorScene(f);
      if (!sc) { this.status(`No scene for ${f.name}`, true); return; }
      this.run.depth = f.depth;
      this.achieve(recordDepth(this.save, f.scaleDepth ?? f.depth));
      this.bossFloor = f.kind === "boss" ? f.level?.boss ?? f.stratum!.boss : null;
      await this.selectScene(sc.id);
      await this.startPlaying();
      if (this.bossFloor) this.spawnBoss(this.bossFloor, !!f.mission?.ultimate);
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
    // keys first (TudeySceneController: an absolute direction before a relative one), else the
    // held left button's "forward": toward the pointer
    if ((f || r) || !this.mouseMoveHeld || !this.world) return { x: fx * f + fy * r, y: fy * f - fx * r };
    const kn = this.world.knight, aim = this.aimPoint();
    const dx = aim ? aim[0] - kn.x : 0, dy = aim ? aim[1] - kn.y : 0, l = Math.hypot(dx, dy);
    return l > 1e-3 ? { x: dx / l, y: dy / l } : { x: 0, y: 0 };
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
        const r = c.getBoundingClientRect(), s = uiScale(this.options_);
        const x = (e.clientX - r.left) / s, y = (e.clientY - r.top) / s;
        if (this.gameHud.covers(x, y)) {
          const tag = this.gameHud.pointer(x, y, true);
          if (tag === "personal_menu") this.personalMenu(x, y);
          else if (tag === "button_menu") this.mainMenu();
          else if (tag === "menu") { /* the popup menu took the press */ }
          else if (tag && tag !== "handle") this.hudAction(tag);
          else if (tag === "handle") this.uiSound("sound/feedback/ui_dropdown_activate.ogg");
          return;
        }
      }
      // furniture mode: clicks place, pick up and drop furniture instead of attacking
      if (this.world && this.places.pointerDown(e.button)) return;
      // knight creation: holding the left button on the scene turns the knight
      if (this.staged && this.places.create.isOpen && e.button === 0) { this.turning = true; c.setPointerCapture(e.pointerId); return; }
      // a stage's knight takes no orders and its camera does not turn
      if (this.staged) return;
      if (this.world && (e.button === 0 || e.button === 2)) {
        // play mode: left attacks (hold to charge), right raises the shield
        // Shift + right click dashes (the game's default binding); right click alone shields
        // the mouse-move scheme: the left button runs toward the pointer, the right attacks
        if (this.options_.mouseMove) {
          if (e.button === 0) this.mouseMoveHeld = true;
          else { this.attackPressed = true; this.attackHeld = true; }
          c.setPointerCapture(e.pointerId);
          return;
        }
        // Shift + left click is the shield bash (the WASD scheme's SHIELD_BASH)
        if (e.button === 0 && e.shiftKey) this.bashPressed = true;
        else if (e.button === 0) { this.attackPressed = true; this.attackHeld = true; }
        else if (e.shiftKey) this.dashPressed = true;
        else this.shieldHeld = true;
        c.setPointerCapture(e.pointerId);
        return;
      }
      drag = { x: e.clientX, y: e.clientY, button: this.world ? 0 : e.button };
      c.setPointerCapture(e.pointerId);
    });
    const release = (e: PointerEvent) => {
      if (e.button === 0) this.turning = false;
      if (this.options_.mouseMove) {
        if (e.button === 0) this.mouseMoveHeld = false;
        if (e.button === 2) this.attackHeld = false;
        return;
      }
      if (e.button === 0) this.attackHeld = false;
      if (e.button === 2) this.shieldHeld = false;
    };
    c.addEventListener("pointerup", release);
    c.addEventListener("pointercancel", () => { this.attackHeld = false; this.shieldHeld = false; this.mouseMoveHeld = false; this.turning = false; });
    c.addEventListener("pointermove", e => {
      const r = c.getBoundingClientRect();
      this.mouse = [e.clientX - r.left, e.clientY - r.top];
      // knight creation: the scene shows the turning arrows (client T: the arrow cursor turned
      // to point at the side the knight will turn toward)
      if (this.staged && this.places.create.isOpen && this.world) {
        const side = this.places.canTurn() ? this.screenSide(this.world.knight) : 0;
        c.style.cursor = side ? this.turnCursor(side) : "";
        return;
      }
      // hovering the HUD's buttons
      const s = uiScale(this.options_);
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
    c.addEventListener("wheel", e => {
      e.preventDefault();
      if (this.staged) return;
      // in play the wheel's turns are the weapon commands' second keys (Command: 516 down for
      // NEXT_WEAPON, 515 up for PREV_WEAPON); the camera's distance is the zoom command's
      if (this.world) { this.wheelWeapon(e.deltaY); return; }
      this.dist *= Math.exp(e.deltaY * 0.0012);
    }, { passive: false });
  }

  /** The left button is held on the knight creation scene (the knight turns). */
  private turning = false;

  /** Which side of the knight the pointer is on, on screen: -1 left, +1 right (0 unknown). */
  private screenSide(k: { x: number; y: number; z: number }): number {
    if (!this.mouse || !this.lastProj || !this.lastView) return 0;
    const m = multiplyMat(this.lastProj, this.lastView);
    const cx = m[0] * k.x + m[4] * k.y + m[8] * (k.z + 1) + m[12], cw = m[3] * k.x + m[7] * k.y + m[11] * (k.z + 1) + m[15];
    if (cw <= 0) return 0;
    const sx = (cx / cw * 0.5 + 0.5) * this.canvas.clientWidth;
    return this.mouse[0] < sx ? -1 : 1;
  }

  private turnCursors: Record<string, string> = {};
  /**
   * The turning cursor (client dt.s): ui/cursor/arrow.png turned by -pi/2 (left) or -3pi/2
   * (right) plus pi/4, its hot spot at the arrow's tip.
   */
  private turnCursor(side: number): string {
    const key = side < 0 ? "l" : "r";
    if (this.turnCursors[key] !== undefined) return this.turnCursors[key];
    this.turnCursors[key] = "ew-resize";
    void this.gui?.image("ui/cursor/arrow.png").then(im => {
      if (!im) return;
      const w = im.width, h = im.height, a = (side < 0 ? 8 : 24) * (-Math.PI / 16);
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      const g = cv.getContext("2d")!;
      g.translate(w / 2, h / 2);
      g.rotate(a + Math.PI / 4);
      g.translate(-w / 2, -h / 2);
      g.drawImage(im.source, 0, 0);
      const r = w * Math.SQRT2 * 0.25;
      const hx = Math.round(w / 2 + r * Math.sin(a)), hy = Math.round(h / 2 - r * Math.cos(a));
      this.turnCursors[key] = `url(${cv.toDataURL()}) ${Math.max(0, Math.min(w - 1, hx))} ${Math.max(0, Math.min(h - 1, hy))}, ew-resize`;
    }).catch(() => {});
    return this.turnCursors[key];
  }

  private frame = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const c = this.canvas, dpr = Math.min(2, devicePixelRatio || 1) * this.options_.renderScale;
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    // the log-on screen, the knight select window and the prologue are the whole screen
    const screen = this.glScreen();
    if (screen) {
      try { screen.draw(dt); } catch (e) { console.error("screen draw failed", e); }
      requestAnimationFrame(this.frame);
      return;
    }
    if (this.instance || this.sceneItems) {
      if (!this.paused) {
        if (this.instance) this.instance.time += dt;
        // shared instances appear in several placements; advance each clock once per frame
        for (const it of this.sceneItems ?? []) it.instance.time += dt / (this.shares.get(it.instance) ?? 1);
        this.updateLifts();
      }
      // time played as this knight (the knight select card's "Played"), saved with its save
      if (this.world && !this.paused && this.save.knight) this.save.played = (this.save.played ?? 0) + dt;
      if (this.world && this.staged) {
        // a stage (the Ready Room, knight creation): the knight holds its pose and the camera its place
        if (!this.paused) this.world.update(dt, { move: [0, 0], attackDown: false, attackHeld: false, shield: false, aim: null, weaponSlot: null, interact: false, dash: false, bash: false });
        // knight creation: the mouse held on the scene turns the knight (client T)
        if (this.turning && this.mouse && this.places.canTurn()) {
          const side = this.screenSide(this.world.knight);
          if (side) this.places.turnKnight(side, dt);
        }
        this.attackPressed = this.dashPressed = this.bashPressed = this.interactPressed = false;
        this.weaponSlot = null;
        const k = this.world.knight, off = this.cam?.to.offset ?? [0, 0, 1];
        this.target = [k.x + off[0], k.y + off[1], k.z + off[2]];
      } else if (this.world) {
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
          if (pad.item >= 0 && !this.paused && !this.controlLocked) this.usePocket(pad.item);
          if (pad.cycle && this.world.knight.weapons.length) {
            const n = this.world.knight.weapons.length;
            this.weaponSlot = (this.world.knight.slot + pad.cycle + n) % n;
          }
        }
        // the Arcade's gate control panels (their server action picks the gate): the gate board;
        // in a gate's party lobby its lobby consoles show the gate being played
        const lobbyHere = this.gateLobby;
        if (!this.paused && !this.controlLocked && (this.interactPressed || pad?.interact) && this.scene && ((/arcade/i.test(this.scene.name) && !this.gate) || lobbyHere)) {
          const k = this.world.knight;
          const panel = lobbyHere ? /Gates\/Lobby Console/ : /Gates\/Control Panel/;
          if (this.scene.logic.some(e => panel.test(e.name) && Math.hypot(e.x - k.x, e.y - k.y) < 3)) {
            this.interactPressed = false;
            this.openGates();
          }
        }
        if (!this.paused && this.controlLocked) {
          // a conversation or comlink call holds the knight (the client freezes its controller)
          // while the world goes on
          this.world.update(dt, { move: [0, 0], attackDown: false, attackHeld: false, shield: false, aim: null, weaponSlot: null, interact: false, dash: false, bash: false });
          this.dashPressed = this.bashPressed = this.interactPressed = false;
          this.weaponSlot = null;
        } else if (!this.paused) {
          this.world.update(dt, {
            move, attackDown: this.attackPressed || !!pad?.attackDown, attackHeld: this.attackHeld || !!pad?.attackHeld,
            shield: this.shieldHeld || !!pad?.shield, aim, weaponSlot: this.weaponSlot,
            interact: this.interactPressed || !!pad?.interact, dash: this.dashPressed || !!pad?.dash,
            bash: this.bashPressed,
          });
          this.dashPressed = false;
          this.bashPressed = false;
          this.weaponSlot = null;
          this.interactPressed = false;
        }
        this.attackPressed = false;
        // Q and E turn the camera (ours: the game's camera does not turn)
        if (this.keys.has(this.bound("turnLeft"))) this.az += dt * this.options_.cameraSpeed;
        if (this.keys.has(this.bound("turnRight"))) this.az -= dt * this.options_.cameraSpeed;
        // the camera is locked on the knight plus the camera offset, no smoothing (TudeySceneView)
        const k = this.world.knight, cam = this.cam;
        if (cam && cam.t < 1) {
          cam.t = Math.min(1, cam.t + dt / 1.5);
          const e = 1 - (1 - cam.t) * (1 - cam.t), lerp = (a: number, b: number) => a + (b - a) * e;
          this.el = lerp(cam.from.elevation, cam.to.elevation);
          this.dist = lerp(cam.from.distance, cam.to.distance) * this.options_.zoom;
          this.fov = lerp(cam.from.fov, cam.to.fov);
        }
        const off = cam?.to.offset ?? [0, 0, 1];
        this.target = [k.x + off[0], k.y + off[1], k.z + off[2]];
        if (this.knockedOut !== this.world.defeated) {
          this.knockedOut = this.world.defeated;
          // the game's revive window (Sparks of Life); in town the knight simply gets up
          if (this.world.defeated) {
            // (the Test Range's knight lies where it fell until its panel revives it)
            if (this.scene?.id === TEST_RANGE) { /* the panel's Revive */ }
            else if (TOWN.test(this.scene?.name ?? "")) { this.world.revive(); this.knockedOut = false; }
            else void this.openRevive();
          } else this.reviveScreen?.close();
        }
      }
      const eye: Vec3 = [
        this.target[0] + this.dist * Math.cos(this.el) * Math.cos(this.az),
        this.target[1] + this.dist * Math.cos(this.el) * Math.sin(this.az),
        this.target[2] + this.dist * Math.sin(this.el),
      ];
      const proj = perspective(this.fov, w / Math.max(1, h), this.dist * 0.01, this.dist * 50);
      // camera shakes (ShakeCamera actions: hits, explosions) move the camera, not its aim
      const shake: [number, number, number] = this.world && !this.options_.noShake ? this.world.cameraShake() : [0, 0, 0];
      const aimAt: Vec3 = [this.target[0] + shake[0], this.target[1] + shake[1], this.target[2] + shake[2]];
      for (let i = 0; i < 3; i++) eye[i] += shake[i];
      const view = lookAt(eye, aimAt, [0, 0, 1]);
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
          const dungeon = !!this.scene && !TOWN.test(this.scene.name);
          // the client's map types: Clockworks levels reveal their map as the knight explores
          // (DISCOVER); terminals, towns and arenas show it all (FULL)
          const floor = this.gate && (this.run.depth > 0 || this.gateLobby) ? this.floors[this.run.depth] : null;
          // (lobbies are FULL too: LevelType.LOBBY.mapType())
          const discover = dungeon && !this.world.arena && !LOBBY.test(this.scene!.name)
            && !(floor && (floor.kind === "terminal" || floor.kind === "subtown" || floor.kind === "core" || floor.kind === "lobby"));
          gh?.minimap.setWorld(this.world, this.scene, { discover, dungeon });
          gh?.update({ ...hudState(this.world, knightName(this.save), this.floorLabel()), ...this.hudContext(), rank: rankLabel(progressOf(this.save)),
            dungeon,
            pocketKeys: (["item1", "item2", "item3", "item4"] as const).map(a => keyName(this.bound(a))), ...this.hudExtras() }, dt);
          // items the knight gained come up as the HUD's acquire icons
          while (this.world.acquired.length) { const a = this.world.acquired.shift()!; gh?.acquire(a); }
          // (the HUD hides while the knight talks, as the game's conversation dialog hides it,
          // and while the elevator's Advancing card or the expedition's report is up)
          const hudOff = this.talking || !!this.elevator?.current || !!this.report?.isOpen;
          const world = this.world, balloons = this.balloons;
          this.hud.draw(world, proj, view, gh && !hudOff ? (g, cw, ch) => gh.draw(g, cw, ch) : undefined,
            balloons ? (g, project) => balloons.draw(g, world.balloons(), project) : undefined);
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

/**
 * Points the Master Signal Triggers of a floor built from prefab rooms at the stratum's spawn
 * tables, one table per spawn group, keeping their arguments (wave tags). The rooms' Class
 * Spawns (support and turret classes) and drones stay as the servers chose them.
 */
function rethemeMasters(root: any, tables: string[], rand: () => number) {
  const byTag = new Map<string, string>();
  for (const e of root.entries ?? []) {
    const args: [string, any][] | undefined = e.placeable?.arguments?.entries;
    if (!args || e.placeable?.name !== "Trigger/Master Signal Trigger") continue;
    const tag = String(args.find(([k]) => k === "Spawn Tag")?.[1] ?? "");
    if (!byTag.has(tag)) byTag.set(tag, tables[Math.floor(rand() * tables.length)]);
    const t = args.find(([k]) => k === "Spawn Table");
    if (t?.[1]) t[1] = { ...t[1], name: byTag.get(tag)! };
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
