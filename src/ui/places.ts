// The guild hall, the Ready Room and knight creation, wired to the viewer through a small host
// interface so main.ts only forwards HUD buttons, clicks, keys and render items here.
//
//  - Guild Hall (HUD activity): the player's hall, with its furniture layer.
//  - Furniture (HUD activity): furniture mode in the hall (goes there first).
//  - Social (HUD menu button, G): the guild window (name, emblem, vault, hall furniture).
//  - Ready Room (HUD activity): rsrc/world/readyroom/scene.dat with the arsenal open.
//  - Knight creation: rsrc/world/createknight/scene.dat, on a fresh save before Haven.

import type { Mat4 } from "../math";
import type { Renderer } from "../render/renderer";
import type { Vfs } from "../vfs";
import type { World } from "../game/world";
import type { ColorPository } from "../colors";
import { cachedPlacements, guildOf } from "../game/guild";
import { cachedHallId, CREATE_KNIGHT, GUILD_HALL, placeRoot, PLACE_SPAWN, READY_ROOM } from "../game/places";
import { writeSave } from "../game/save";
import { FurnitureLayer, FurnitureWindow, type FurnitureHost } from "./furniture";
import { GuildWindow } from "./guild";
import { CreateKnight, starterGear, type KnightLook } from "./createknight";
import { el, injectStyle } from "./panel";

export interface PlacesHost extends FurnitureHost {
  vfs: Vfs;
  sceneList(): { id: string; name: string }[];
  /** Leaves the current scene and plays in another (selectScene, then startPlaying). */
  go(id: string): Promise<void>;
  /** Restarts play in the current scene (a new look for the knight). */
  restart(): Promise<void>;
  world(): World | null;
  /** Sets the play camera (azimuth and elevation in the viewer's terms, distance). */
  camera(az: number, el: number, dist: number): void;
  openArsenal(): Promise<void>;
  arsenalOpen(): boolean;
  colors(): Promise<ColorPository | null>;
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
  private readonly readyBar: HTMLElement;
  private swatches: { print: number; name: string; rgb: [number, number, number] }[] = [];
  private urls = new Map<string, Promise<string | null>>();
  /** Called when knight creation finishes (the viewer enters Haven). */
  onCreated: (() => void) | null = null;

  constructor(private readonly host: PlacesHost) {
    injectStyle();
    this.layer = new FurnitureLayer(host);
    this.furniture = new FurnitureWindow(host, this.layer);
    this.furniture.onClose = () => host.focus();
    this.guild = new GuildWindow({
      save: () => host.save(), write: () => host.write(), sound: f => host.sound(f),
      image: p => this.image(p),
      goToHall: () => void this.goToHall(),
      openFurniture: () => void this.openFurniture(),
      furnish: cached => void this.furnish(cached),
      inHall: () => this.inHall(),
      onClose: () => { host.pause(false); host.focus(); },
    });
    this.create = new CreateKnight({
      gear: async () => {
        const d = host.data();
        await d.preload("config/item.dat");
        return starterGear(d.library_("config/item.dat").keys(), n => d.resolveSync("config/item.dat", { name: n }, "item")?.rarity ?? 0);
      },
      colors: () => this.swatches,
      preview: look => this.preview(look),
      done: (name, look) => this.created(name, look),
      sound: f => host.sound(f),
    });
    this.readyBar = el("div", "sk-card ready-bar");
    this.readyBar.hidden = true;
    this.readyBar.addEventListener("pointerdown", e => e.stopPropagation());
    document.body.append(this.readyBar);
    void host.colors().then(pos => {
      const cls = pos?.classes.get(host.save().color >> 8);
      if (!pos || !cls) return;
      this.swatches = [...cls.colors.values()].map(c => {
        const z = pos.byPrint((cls.classId << 8) | c.colorId);
        return { print: (cls.classId << 8) | c.colorId, name: c.name, rgb: z ? z.colorizedRoot() : [128, 128, 128] as [number, number, number] };
      });
      if (this.create.isOpen) void this.create.open(host.save());
    });
  }

  /** An object URL for an rsrc image (emblem heraldry). */
  image(path: string): Promise<string | null> {
    let p = this.urls.get(path);
    if (!p) { p = this.host.vfs.blob(path).then(b => URL.createObjectURL(b)).catch(() => null); this.urls.set(path, p); }
    return p;
  }

  // ------------------------------------------------------------ scenes

  /** The root of a special scene (guild hall, rsrc scene files), or null for cached scenes. */
  sceneRoot(id: string): Promise<any | null> {
    return placeRoot(id, this.host.vfs, this.host.sceneLoader, this.host.sceneList(), this.host.save());
  }

  /** Where the knight stands in a special scene without a start platform. */
  spawn(id: string | undefined): [number, number] | null {
    return (id && PLACE_SPAWN[id]) || null;
  }

  /** After play starts in a scene: the hall's furniture, the Ready Room's camera and bar. */
  started(id: string) {
    const scene = this.host.scene();
    if (id === GUILD_HALL && scene) void this.layer.attach(scene).then(() => this.furniture.refresh());
    else this.layer.detach();
    if (id !== GUILD_HALL) this.furniture.close();
    this.readyBar.hidden = id !== READY_ROOM;
    if (id === READY_ROOM) {
      // the room's Camera/Default placeable looks from azimuth -120 degrees, 11 degrees up, with
      // a narrow lens; this wider lens looks from a little higher to clear the crates
      this.host.camera(0.15, 0.55, 6.5);
      this.renderReadyBar();
    }
    if (id === CREATE_KNIGHT) this.host.camera(-Math.PI / 2 + 0.35, 0.2, 6.5);
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

  async readyRoom() {
    if (this.host.scene()?.id !== READY_ROOM) await this.host.go(READY_ROOM);
    if (!this.host.arsenalOpen()) await this.host.openArsenal();
  }

  private renderReadyBar() {
    const arsenal = el("button", "", "Arsenal (I)"), leave = el("button", "", "Return to Haven");
    arsenal.onclick = () => void this.host.openArsenal();
    leave.onclick = () => this.host.returnToHaven();
    this.readyBar.replaceChildren(el("h2", "", "Ready Room"), arsenal, leave);
  }

  /** The arsenal closed: in the Ready Room the knight changes into the new loadout at once. */
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
        save.loadout = { ...save.loadout, helmet: l.helmet, armor: l.armor };
        await this.host.restart();
        if (this.pending === l) this.pending = null;
      }
    });
  }

  private created(name: string, look: KnightLook) {
    const save = this.host.save();
    save.knight = { name, helmet: look.helmet, armor: look.armor };
    save.color = look.color;
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
    if (this.guild.isOpen) { if (e.key === "Escape") this.guild.close(); return e.key === "Escape"; }
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
