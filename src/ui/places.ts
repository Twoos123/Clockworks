// The guild hall, the Ready Room and knight creation, wired to the viewer through a small host
// interface so main.ts only forwards HUD buttons, clicks, keys and render items here.
//
//  - Guild Hall (HUD activity): the player's hall, with its furniture layer.
//  - Furniture (HUD activity): furniture mode in the hall (goes there first).
//  - Social (HUD menu button, G): the guild window (name, emblem, vault, hall furniture).
//  - Ready Room (HUD activity): rsrc/world/readyroom/scene.dat as the client shows it, a stage
//    and not a place to walk: the knight posed at the room's console (READY_ROOM_POSE), the
//    room's own fixed camera (its Camera/Default placeable), the HUD without its minimap, and
//    the HUD's Haven activity leading back to where the player came from.
//  - Knight creation: rsrc/world/createknight/scene.dat, on a fresh save before Haven.

import type { Mat4 } from "../math";
import type { CameraView } from "../environment";
import type { Renderer } from "../render/renderer";
import type { Vfs } from "../vfs";
import type { World } from "../game/world";
import type { ColorPository } from "../colors";
import type { Economy } from "../game/economy";
import { cachedPlacements, guildOf } from "../game/guild";
import { cachedHallId, CREATE_KNIGHT, CREATE_KNIGHT_CAMERA, CREATE_KNIGHT_POSE, GUILD_HALL, placeCamera, placeRoot, PLACE_SPAWN, READY_ROOM, READY_ROOM_POSE } from "../game/places";
import { writeSave, type SaveData } from "../game/save";
import { accessoryDef, equipAccessory, loadAccessoryLibraries, normalizeAppearance } from "../game/accessories";
import { itemName } from "../game/text";

/** A colour's hue (0 to 1), greys first. */
function hue([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 8) return -1 + max / 255;
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h / 6;
}
import { FurnitureLayer, FurnitureWindow, type FurnitureHost } from "./furniture";
import { GuildWindow } from "./guild";
import { CreateKnight, starterGear, type KnightLook } from "./createknight";

/** Where the knight stood, to come back to. */
export interface StandPoint { x: number; y: number; heading: number }

export interface PlacesHost extends FurnitureHost {
  vfs: Vfs;
  sceneList(): { id: string; name: string }[];
  /** Leaves the current scene and plays in another (selectScene, then startPlaying), standing at `at` when given. */
  go(id: string, at?: StandPoint): Promise<void>;
  /** Restarts play in the current scene (a new look for the knight). */
  restart(): Promise<void>;
  world(): World | null;
  /** Sets the play camera (azimuth and elevation in the viewer's terms, distance). */
  camera(az: number, el: number, dist: number): void;
  /** Fixes the play camera at a scene's CameraConfig as it stands (no zoom option, no turning). */
  stageCamera(view: CameraView): void;
  openArsenal(): Promise<void>;
  arsenalOpen(): boolean;
  colors(): Promise<ColorPository | null>;
  /** The economy (the guild storages list items as the arsenal does). */
  eco(): Promise<Economy>;
  returnToHaven(): void;
  pause(on: boolean): void;
  focus(): void;
}

export { GUILD_HALL, READY_ROOM, CREATE_KNIGHT };

export class Places {
  readonly layer: FurnitureLayer;
  readonly furniture: FurnitureWindow;
  readonly guild: GuildWindow;
  readonly create: CreateKnight;
  /** The Ready Room's camera (read from its scene file when it loads). */
  private stageView: CameraView | null = null;
  /** The scene and spot the player went to the Ready Room from. */
  private from: { id: string; at: StandPoint | undefined } | null = null;
  private swatches: { print: number; name: string; rgb: [number, number, number] }[] = [];
  /** Called when knight creation finishes (the viewer enters Haven). */
  onCreated: (() => void) | null = null;
  /** Called on knight creation's Back. */
  onCreationBack: (() => void) | null = null;
  /** When the creation scene came up (the knight turns only 3.5 s after). */
  creationAt = 0;
  /** Which way the creator's knight faces (turned with the mouse). */
  creationHeading = CREATE_KNIGHT_POSE.heading;

  /**
   * Turns the creator's knight (client T): `side` is -1 with the pointer left of the knight,
   * +1 right of it; a half turn a second, once the scene has been up 3.5 s.
   */
  turnKnight(side: number, dt: number) {
    if (!this.create.isOpen || performance.now() - this.creationAt < CREATE_KNIGHT_POSE.turnDelay * 1000) return;
    this.creationHeading += side * CREATE_KNIGHT_POSE.turnSpeed * dt;
    const w = this.host.world();
    if (w) w.knight.heading = this.creationHeading;
  }

  /** The creator's knight may be turned now. */
  canTurn() { return this.create.isOpen && performance.now() - this.creationAt >= CREATE_KNIGHT_POSE.turnDelay * 1000; }

  constructor(private readonly host: PlacesHost) {
    this.layer = new FurnitureLayer(host);
    this.furniture = new FurnitureWindow(host, this.layer);
    this.furniture.onClose = () => host.focus();
    this.guild = new GuildWindow(host.gui(), {
      save: () => host.save(), write: () => host.write(), sound: f => host.sound(f),
      icon: item => host.data().resolveSync("config/item.dat", { name: item }, "item")?.icon ?? null,
      data: () => host.data(), eco: () => host.eco(),
      goToHall: () => void this.goToHall(),
      openFurniture: () => void this.openFurniture(),
      furnish: cached => void this.furnish(cached),
      inHall: () => this.inHall(),
      onClose: () => { host.pause(false); host.focus(); },
    });
    this.create = new CreateKnight(host.gui(), {
      gear: async () => {
        const d = host.data();
        await d.preload("config/item.dat", "config/accessory.dat");
        return starterGear(d.library_("config/item.dat").keys(), n => d.resolveSync("config/item.dat", { name: n }, "item")?.rarity ?? 0);
      },
      accessoryName: config => {
        const a = host.data().config("config/accessory.dat", config)?.aName;
        return typeof a === "string" ? a : undefined;
      },
      itemLabel: item => itemName(item),
      colors: () => this.swatches,
      preview: look => this.preview(look),
      done: (name, look) => void this.created(name, look),
      back: () => this.onCreationBack?.(),
      sound: f => host.sound(f),
    });
    void host.colors().then(pos => {
      const cls = pos?.classes.get(host.save().color >> 8);
      if (!pos || !cls) return;
      // the creator's colour picker runs through the class's colours as a rainbow, by hue
      this.swatches = [...cls.colors.values()].map(c => {
        const z = pos.byPrint((cls.classId << 8) | c.colorId);
        return { print: (cls.classId << 8) | c.colorId, name: c.name, rgb: z ? z.colorizedRoot() : [128, 128, 128] as [number, number, number] };
      }).sort((a, b) => hue(a.rgb) - hue(b.rgb));
    });
  }

  // ------------------------------------------------------------ scenes

  /** The root of a special scene (guild hall, rsrc scene files), or null for cached scenes. */
  async sceneRoot(id: string): Promise<any | null> {
    const root = await placeRoot(id, this.host.vfs, this.host.sceneLoader, this.host.sceneList(), this.host.save());
    if (id === READY_ROOM) this.stageView = placeCamera(root);
    return root;
  }

  /** The scene is a stage (the Ready Room): the knight is shown, not played. */
  staged(id: string | undefined) { return id === READY_ROOM || id === CREATE_KNIGHT; }

  /** Where the knight stands in a special scene without a start platform. */
  spawn(id: string | undefined): [number, number] | null {
    return (id && PLACE_SPAWN[id]) || null;
  }

  /** After play starts in a scene: the hall's furniture, the Ready Room's stage. */
  started(id: string) {
    const scene = this.host.scene();
    if (id === GUILD_HALL && scene) void this.layer.attach(scene).then(() => this.furniture.refresh());
    else this.layer.detach();
    if (id !== GUILD_HALL) this.furniture.close();
    if (id === READY_ROOM) {
      // the client's ready room view: its own knight at the origin in the inventory pose, seen
      // through the room's Camera/Default (azimuth -120 degrees, 11 up, a 30 degree lens)
      const p = READY_ROOM_POSE;
      this.host.world()?.stage(p.heading, p.start, p.loop);
      if (this.stageView) this.host.stageCamera(this.stageView);
    } else this.from = null;
    if (id === CREATE_KNIGHT) {
      // the creator's knight on display, facing the camera (client S); a new look (the knight
      // dressed again) keeps the way it was turned
      if (!this.create.isOpen) { this.creationHeading = CREATE_KNIGHT_POSE.heading; this.creationAt = performance.now(); }
      const w = this.host.world();
      if (w) w.knight.heading = this.creationHeading;
      this.host.stageCamera(CREATE_KNIGHT_CAMERA);
    }
  }

  inHall() { return this.host.scene()?.id === GUILD_HALL; }

  async goToHall() {
    if (!cachedHallId(this.host.sceneList())) return;
    if (!this.inHall()) await this.host.go(GUILD_HALL);
  }

  async openFurniture() {
    await this.goToHall();
    if (this.inHall()) await this.furniture.open();
  }

  async furnish(cached: boolean) {
    const id = cachedHallId(this.host.sceneList());
    if (!id) return;
    const list = cached ? cachedPlacements(await this.host.sceneLoader.parse(await this.host.vfs.readScene(id))) : [];
    await this.layer.replaceAll(list);
    this.furniture.refresh();
  }

  /**
   * The Ready Room activity (client dt "readyroom": the zone director moves to the local ready
   * room scene). The arsenal open on leaving opens again on arrival, as the client's HUD
   * reopens its inventory window after a move.
   */
  async readyRoom() {
    const scene = this.host.scene();
    if (scene?.id === READY_ROOM) return;
    const k = this.host.world()?.knight;
    this.from = scene ? { id: scene.id, at: k ? { x: k.x, y: k.y, heading: k.heading } : undefined } : null;
    const arsenal = this.host.arsenalOpen();
    await this.host.go(READY_ROOM);
    if (arsenal && !this.host.arsenalOpen()) await this.host.openArsenal();
  }

  /**
   * Out of the Ready Room (the client's HUD Haven activity there, which asks the server to
   * return the player): back to the scene and spot the player came from, else Haven.
   */
  async leaveReadyRoom() {
    const from = this.from;
    this.from = null;
    if (from && from.id !== READY_ROOM) await this.host.go(from.id, from.at);
    else this.host.returnToHaven();
  }

  /** The arsenal closed: in the Ready Room the knight changes into the new loadout at once (client dQ: "equipment" updates). */
  arsenalClosed() {
    if (this.host.scene()?.id === READY_ROOM && this.host.world()) void this.host.restart();
  }

  // ------------------------------------------------------------ knight creation

  /** A fresh save has no knight yet. */
  needsKnight() { return !this.host.save().knight; }

  async startCreation() {
    await this.host.go(CREATE_KNIGHT);
    await this.create.open(this.host.save());
  }

  private previewing: Promise<void> = Promise.resolve();
  private pending: KnightLook | null = null;

  /** A look's accessories on the save's appearance (each in its own slot), the rest taken off. */
  private async wear(save: SaveData, look: KnightLook) {
    const data = this.host.data();
    await loadAccessoryLibraries(data);
    const app = save.appearance = normalizeAppearance(save.appearance);
    app.accessories = {};
    for (const a of look.accessories) {
      const def = accessoryDef(data, a);
      if (def) equipAccessory(app, a, def, n => accessoryDef(data, n));
    }
  }

  private preview(look: KnightLook) {
    // one restart at a time; only the latest look matters
    const first = !this.pending;
    this.pending = look;
    if (!first) return;
    this.previewing = this.previewing.then(async () => {
      while (this.pending) {
        const l = this.pending;
        const save = this.host.save();
        save.color = l.color;
        save.face = { ...l.face };
        save.loadout = { ...save.loadout, helmet: l.helmet, armor: l.armor };
        await this.wear(save, l);
        await this.host.restart();
        if (this.pending === l) this.pending = null;
      }
    });
  }

  private async created(name: string, look: KnightLook) {
    const save = this.host.save();
    // (a preview still under way finishes first: it dresses the same save)
    await this.previewing;
    save.knight = { name, helmet: look.helmet, armor: look.armor };
    save.color = look.color;
    save.face = { ...look.face };
    await this.wear(save, look);
    save.loadout = { ...save.loadout, helmet: look.helmet, armor: look.armor };
    for (const n of [look.helmet, look.armor]) if (n && !save.owned.includes(n)) save.owned.push(n);
    guildOf(save);
    writeSave(save);
    this.onCreated?.();
  }

  // ------------------------------------------------------------ input and drawing

  /** HUD buttons this module answers; false for the rest. */
  hudAction(tag: string): boolean {
    switch (tag) {
      case "button_guildhall": void this.goToHall(); return true;
      case "button_furni": void this.openFurniture(); return true;
      case "button_readyroom": void this.readyRoom(); return true;
      // in the Ready Room the Haven activity leaves it (client hud/b: the "readyroom" case)
      case "button_haven": if (!this.staged(this.host.scene()?.id)) return false; void this.leaveReadyRoom(); return true;
      case "button_social": this.host.pause(true); this.guild.open(); return true;
      default: return false;
    }
  }

  /** A press on the game canvas; true when furniture mode took it. */
  pointerDown(button: number): boolean {
    if (!this.furniture.isOpen || !this.layer.attached) return false;
    if (button === 2) { if (this.layer.cancel()) this.host.sound("sound/feedback/ui_dismiss.ogg"); this.furniture.refresh(); return true; }
    if (button !== 0) return false;
    const r = this.layer.click();
    if (r === "placed") { this.host.sound("sound/feedback/ui_merchant_trade_add.ogg"); this.furniture.status = "Placed."; }
    else if (r === "picked") { this.host.sound("sound/feedback/ui_confirm.ogg"); this.furniture.status = "Moving: click to put it down, R to rotate, Delete to store."; }
    else if (r === "blocked") { this.host.sound("sound/feedback/ui_dismiss.ogg"); this.furniture.status = "It does not fit there."; }
    else if (r === "loading") this.furniture.status = "Still loading that item...";
    this.furniture.refresh();
    return true;
  }

  /** Keys while a window of this module is open; true when handled. */
  key(e: KeyboardEvent): boolean {
    if (this.guild.isOpen) { if (e.key === "Escape") this.guild.escape(); return e.key === "Escape"; }
    if (this.create.isOpen) return e.key === "Escape";
    if (!this.furniture.isOpen) return false;
    const k = e.key.toLowerCase();
    if (k === "r") { if (!e.repeat && this.layer.rotate(e.shiftKey)) this.host.sound("sound/feedback/ui_dropdown_select.ogg"); return true; }
    if (k === "delete" || k === "backspace") { if (this.layer.remove()) { this.host.sound("sound/feedback/ui_dismiss.ogg"); this.furniture.status = "Stored."; this.furniture.refresh(); } return true; }
    if (k === "escape") { if (!this.layer.cancel()) this.furniture.close(); else this.furniture.refresh(); return true; }
    return false;
  }

  items() { return this.layer.items(); }

  drawMarks(renderer: Renderer, proj: Mat4, view: Mat4) { if (this.furniture.isOpen) this.layer.drawMarks(renderer, proj, view); }

  /** Saves through the shared save object (writes it to the browser). */
  write() { writeSave(this.host.save()); }
}
