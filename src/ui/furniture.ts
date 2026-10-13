// Guild hall furniture: the layer that stands the player's placed furniture in the hall
// (models resolved like the scene's own Furni Placer placeables, with collision), and the
// furniture mode that places, moves, rotates and removes it, with a side window listing the
// furniture the guild owns and the furniture it can buy.
//
// Controls in furniture mode: pick an item in the window, then click the floor to place it
// (it snaps to the tiles); click a placed item to pick it up and move it; R rotates (Shift+R
// back); Delete removes (back to the guild's storage); right click or Esc drops what is held.

import { compose, type Mat4 } from "../math";
import type { LoadedModel } from "../model";
import type { ModelInstance, Renderer } from "../render/renderer";
import type { LoadedScene, SceneLoader } from "../scene";
import type { GameData } from "../game/data";
import type { SaveData } from "../game/save";
import {
  buyFurniture, cellsOf, furniPrice, furnitureCatalogue, guildOf, nextRotation, place, snap, unplace,
  type FurniEntry, type Placement,
} from "../game/guild";
import type { GuiContext } from "./gui";
import { el, injectStyle, drawIcon } from "./panel";

export interface FurnitureHost {
  sceneLoader: SceneLoader;
  gui: () => GuiContext;
  data: () => GameData;
  instanceOf(model: LoadedModel): Promise<ModelInstance>;
  save(): SaveData;
  write(): void;
  /** The scene on show. */
  scene(): LoadedScene | null;
  /** Where the pointer meets the horizontal plane at height z. */
  pick(z: number): [number, number] | null;
  /** The knight's height (the pointer is first cast onto its floor). */
  knightZ(): number;
  sound(file: string): void;
}

interface Furni { impl: any; model: LoadedModel | null; instance: ModelInstance | null; width: number; height: number }
interface Placed { p: Placement; id: number; matrix: Mat4 }

const BASE_ID = 0x7f000000;
const MARK = "world/environment/shadow/square.png";

export class FurnitureLayer {
  private scene: LoadedScene | null = null;
  private placed: Placed[] = [];
  private furni = new Map<string, Promise<Furni>>();
  private ready = new Map<string, Furni>();
  private nextId = BASE_ID;
  /** The item held in furniture mode, following the pointer. */
  held: { item: string; rot: number; origin: Placement | null } | null = null;
  private ghost: { x: number; y: number; z: number; ok: boolean; cells: [number, number][] } | null = null;
  private last = performance.now();

  constructor(private readonly host: FurnitureHost) {}

  /** Loads an item's config and model once. */
  furniture(item: string): Promise<Furni> {
    let f = this.furni.get(item);
    if (!f) {
      f = this.host.sceneLoader.furniture({ name: item }).then(async ({ impl, model }) => {
        const out: Furni = { impl, model, instance: model ? await this.host.instanceOf(model) : null,
          width: Math.max(1, impl?.footprintWidth ?? 1), height: Math.max(1, impl?.footprintHeight ?? 1) };
        this.ready.set(item, out);
        return out;
      }).catch(() => ({ impl: null, model: null, instance: null, width: 1, height: 1 }));
      this.furni.set(item, f);
    }
    return f;
  }

  get attached() { return !!this.scene && this.scene === this.host.scene(); }

  /** Stands the guild's furniture in a freshly loaded hall. */
  async attach(scene: LoadedScene) {
    this.detach();
    this.scene = scene;
    const g = guildOf(this.host.save());
    await Promise.all([...new Set(g.placements.map(p => p.item))].map(n => this.furniture(n)));
    if (this.scene !== scene) return;
    for (const p of g.placements) this.add(p);
  }

  detach() {
    if (this.scene) for (const e of this.placed) this.scene.collision.remove(e.id);
    this.placed = [];
    this.scene = null;
    this.held = null;
    this.ghost = null;
  }

  private matrixOf(p: Placement): Mat4 {
    const a = p.rot * Math.PI / 4;
    return compose([p.x, p.y, p.z], [0, 0, Math.sin(a / 2), Math.cos(a / 2)], 1);
  }

  private add(p: Placement) {
    const id = this.nextId++;
    const f = this.ready.get(p.item);
    if (this.scene && f?.impl) {
      const a = p.rot * Math.PI / 4;
      this.scene.collision.addProp(f.impl, { translation: { x: p.x, y: p.y, z: p.z }, rotation: { x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) } }, id);
    }
    this.placed.push({ p, id, matrix: this.matrixOf(p) });
  }

  private drop(p: Placement) {
    const i = this.placed.findIndex(e => e.p === p);
    if (i < 0) return;
    this.scene?.collision.remove(this.placed[i].id);
    this.placed.splice(i, 1);
  }

  /** The placement under the pointer, if any. */
  hovered(): Placement | null {
    const pt = this.pointer();
    if (!pt) return null;
    const cx = Math.floor(pt[0]), cy = Math.floor(pt[1]);
    for (let i = this.placed.length - 1; i >= 0; i--) {
      const e = this.placed[i], f = this.ready.get(e.p.item);
      if (cellsOf(e.p, f?.width ?? 1, f?.height ?? 1).some(([x, y]) => x === cx && y === cy)) return e.p;
    }
    return null;
  }

  /** The pointer on the floor: cast onto the knight's level, then onto the floor found there. */
  private pointer(): [number, number] | null {
    const c = this.scene?.collision;
    let pt = this.host.pick(this.host.knightZ());
    for (let i = 0; pt && c && i < 3; i++) {
      const cell = c.cell(Math.floor(pt[0]), Math.floor(pt[1]));
      if (!cell?.floor || !isFinite(cell.z)) break;
      const next = this.host.pick(cell.z);
      if (!next) break;
      pt = next;
    }
    return pt;
  }

  /** Where the held item would stand, and whether it fits there. */
  private updateGhost() {
    this.ghost = null;
    const h = this.held, c = this.scene?.collision, f = h && this.ready.get(h.item);
    const pt = this.pointer();
    if (!h || !c || !f || !pt) return;
    const s = snap(pt[0], pt[1], f.width, f.height, h.rot);
    const taken = new Set<string>();
    for (const e of this.placed) {
      const g = this.ready.get(e.p.item);
      for (const [x, y] of cellsOf(e.p, g?.width ?? 1, g?.height ?? 1)) taken.add(x + "," + y);
    }
    let z = NaN, ok = true;
    for (const [x, y] of s.cells) {
      const cell = c.cell(x, y);
      if (!cell?.floor || (cell.flags & 1) || taken.has(x + "," + y)) { ok = false; continue; }
      if (isNaN(z)) z = cell.z; else if (Math.abs(cell.z - z) > 0.01) ok = false;
      // walls and solid props standing in the tile (the hall's own furniture-free props)
      for (const p of c.props) {
        if (p.id !== undefined && p.id >= BASE_ID) continue;
        if ((p.flags & 1) && p.maxX > x + 0.15 && p.minX < x + 0.85 && p.maxY > y + 0.15 && p.minY < y + 0.85) { ok = false; break; }
      }
    }
    this.ghost = { x: s.x, y: s.y, z: isNaN(z) ? c.groundZ(pt[0], pt[1]) : z, ok: ok && !isNaN(z), cells: s.cells };
  }

  /** Render items: the placed furniture and the held item at the pointer. */
  items(): { instance: ModelInstance; matrix: Mat4 }[] {
    if (!this.attached) return [];
    const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const out: { instance: ModelInstance; matrix: Mat4 }[] = [];
    const ticked = new Set<ModelInstance>();
    const push = (item: string, matrix: Mat4) => {
      const inst = this.ready.get(item)?.instance;
      if (!inst) return;
      if (!ticked.has(inst)) { ticked.add(inst); inst.time += dt; }
      out.push({ instance: inst, matrix });
    };
    for (const e of this.placed) push(e.p.item, e.matrix);
    if (this.held) {
      this.updateGhost();
      const g = this.ghost;
      if (g) push(this.held.item, this.matrixOf({ item: this.held.item, x: g.x, y: g.y, z: g.z, rot: this.held.rot }));
    }
    return out;
  }

  /** The footprint marker under the held item (green where it fits, red where it does not). */
  drawMarks(renderer: Renderer, proj: Mat4, view: Mat4) {
    const g = this.ghost;
    if (!this.attached || !this.held || !g) return;
    const list = g.cells.map(([x, y]) => ({ matrix: compose([x + 0.5, y + 0.5, g.z], [0, 0, 0, 1], 1), width: 0.92, height: 0.92, texture: MARK, glow: false }));
    renderer.drawDecals(list, proj, view, g.ok ? [0.15, 0.85, 0.3, 0.75] : [0.95, 0.15, 0.1, 0.75]);
  }

  // ------------------------------------------------------------ editing

  /** Holds an owned item to place it. */
  hold(item: string) {
    void this.furniture(item);
    this.held = { item, rot: this.held?.rot ?? 0, origin: null };
  }

  /** A click on the floor: place what is held, or pick up the item under the pointer. */
  click(): "placed" | "picked" | "blocked" | "loading" | null {
    const g = guildOf(this.host.save());
    if (this.held) {
      this.updateGhost();
      const gh = this.ghost;
      if (!this.ready.has(this.held.item)) return "loading";
      if (!gh?.ok) return "blocked";
      const p: Placement = { item: this.held.item, x: gh.x, y: gh.y, z: gh.z, rot: this.held.rot };
      // a moved item goes back to storage when picked up, so placing always takes from storage
      if (!place(g, p)) return "blocked";
      this.add(p);
      this.host.write();
      if ((g.furni[p.item] ?? 0) < 1) this.held = null;
      else this.held = { ...this.held, origin: null };
      return "placed";
    }
    const p = this.hovered();
    if (!p) return null;
    this.drop(p);
    unplace(g, p);
    this.host.write();
    this.held = { item: p.item, rot: p.rot, origin: p };
    return "picked";
  }

  /** R: turns the held item, or the one under the pointer in place. */
  rotate(back = false) {
    if (this.held) {
      const f = this.ready.get(this.held.item);
      this.held.rot = nextRotation(f?.width ?? 1, f?.height ?? 1, this.held.rot, back);
      return true;
    }
    const p = this.hovered();
    if (!p) return false;
    const f = this.ready.get(p.item), w = f?.width ?? 1, h = f?.height ?? 1;
    const rot = nextRotation(w, h, p.rot, back);
    // a quarter turn of an oblong item re-centres it on its new footprint
    const s = snap(p.x, p.y, w, h, rot);
    this.drop(p);
    p.rot = rot; p.x = s.x; p.y = s.y;
    this.add(p);
    this.host.write();
    return true;
  }

  /** Delete: the held item, or the one under the pointer, goes back to storage. */
  remove(): boolean {
    if (this.held) { this.held = null; return true; }
    const p = this.hovered();
    if (!p) return false;
    this.drop(p);
    unplace(guildOf(this.host.save()), p);
    this.host.write();
    return true;
  }

  /** Right click / Esc: lets go of the held item (a moved item returns to where it stood). */
  cancel(): boolean {
    const h = this.held;
    if (!h) return false;
    this.held = null;
    if (h.origin) {
      const g = guildOf(this.host.save());
      if (place(g, h.origin)) { this.add(h.origin); this.host.write(); }
    }
    return true;
  }

  /** Replaces every placement (the "furnish like the cached hall" and "clear" buttons). */
  async replaceAll(list: Placement[]) {
    const g = guildOf(this.host.save());
    for (const p of [...g.placements]) unplace(g, p);
    for (const p of list) { g.furni[p.item] = (g.furni[p.item] ?? 0) + 1; place(g, p); }
    this.host.write();
    if (this.scene) await this.attach(this.scene);
  }

  get count() { return this.placed.length; }
}

// ---------------------------------------------------------------- the furniture window

type View = "owned" | "shop";

export class FurnitureWindow {
  private readonly root: HTMLElement;
  private view: View = "owned";
  private filter = "";
  private category = "";
  private catalogue: FurniEntry[] | null = null;
  status = "";
  onClose: (() => void) | null = null;

  constructor(private readonly host: FurnitureHost, readonly layer: FurnitureLayer) {
    injectStyle();
    this.root = el("div", "furni-window sk-card");
    this.root.hidden = true;
    document.body.append(this.root);
    // keep clicks and wheel in the window away from the game canvas
    this.root.addEventListener("pointerdown", e => e.stopPropagation());
  }

  get isOpen() { return !this.root.hidden; }

  async open() {
    await this.host.data().preload("config/item.dat");
    const d = this.host.data();
    this.catalogue ??= furnitureCatalogue(d.library_("config/item.dat").keys(), n => d.resolveSync("config/item.dat", { name: n }, "item"));
    if (!this.isOpen) this.host.sound("sound/feedback/ui_open.ogg");
    this.root.hidden = false;
    document.body.classList.add("furni-mode");
    this.render();
  }

  close() {
    if (!this.isOpen) return;
    this.layer.cancel();
    this.root.hidden = true;
    document.body.classList.remove("furni-mode");
    this.host.sound("sound/feedback/ui_dismiss.ogg");
    this.onClose?.();
  }

  /** Redraws the window (after a placement changes the counts). */
  refresh() { if (this.isOpen) this.render(); }

  private render() {
    const save = this.host.save(), g = guildOf(save), list = this.catalogue ?? [];
    this.root.replaceChildren();
    const head = el("div", "furni-head");
    const close = el("button", "", "Done");
    close.onclick = () => this.close();
    head.append(el("h2", "", "Furniture"), el("span", "furni-bank", `${save.crowns} cr`), close);
    const tabs = el("div", "furni-tabs");
    for (const [v, label] of [["owned", `Storage (${Object.values(g.furni).reduce((a, b) => a + b, 0)})`], ["shop", "Buy"]] as [View, string][]) {
      const b = el("button", v === this.view ? "active" : "", label);
      b.onclick = () => { this.view = v; this.host.sound("sound/feedback/ui_dropdown_select.ogg"); this.render(); };
      tabs.append(b);
    }
    const search = document.createElement("input");
    search.type = "search"; search.placeholder = "Search"; search.value = this.filter;
    search.oninput = () => { this.filter = search.value; this.fill(grid); };
    const cat = document.createElement("select");
    cat.append(new Option("All kinds", ""));
    for (const c of [...new Set(list.map(e => e.category))]) cat.append(new Option(c, c));
    cat.value = this.category;
    cat.onchange = () => { this.category = cat.value; this.fill(grid); };
    const tools = el("div", "furni-tools");
    tools.append(search, cat);
    const help = el("p", "furni-help", "Pick an item, then click the floor to place it. Click a placed item to move it. R rotates, Delete stores, right click or Esc lets go.");
    const status = el("p", "furni-status", this.status || `${this.layer.count} items placed in the hall.`);
    const grid = el("div", "furni-grid");
    this.root.append(head, tabs, tools, help, status, grid);
    this.fill(grid);
  }

  private fill(grid: HTMLElement) {
    const save = this.host.save(), g = guildOf(save);
    const q = this.filter.toLowerCase();
    grid.replaceChildren();
    let shown = 0;
    for (const e of this.catalogue ?? []) {
      if (this.category && e.category !== this.category) continue;
      if (q && !e.name.toLowerCase().includes(q)) continue;
      const have = g.furni[e.name] ?? 0;
      if (this.view === "owned" && !have) continue;
      if (++shown > 300) break;
      const held = this.layer.held?.item === e.name;
      const tile = el("button", "furni-item" + (held ? " held" : ""));
      tile.title = `${e.name}\n${e.width}x${e.height} tiles · ${e.rarity < 0 ? "event prize" : e.rarity + "★"}`;
      const c = document.createElement("canvas");
      c.width = c.height = 40;
      if (e.icon) void this.host.gui().icon(e.icon).then(im => drawIcon(c, im));
      tile.append(c, el("span", "furni-name", e.label), el("span", "furni-meta", this.view === "owned" ? `×${have}` : `${furniPrice(e.rarity)} cr${have ? ` · own ${have}` : ""}`));
      tile.onclick = () => {
        if (this.view === "shop") {
          if (buyFurniture(save, e.name, e.rarity)) { this.host.write(); this.host.sound("sound/feedback/ui_merchant_trade_add.ogg"); this.status = `Bought ${e.label}. It is in storage.`; }
          else { this.host.sound("sound/feedback/ui_dismiss.ogg"); this.status = `${e.label} costs ${furniPrice(e.rarity)} crowns.`; }
        } else {
          this.layer.hold(e.name);
          this.host.sound("sound/feedback/ui_confirm.ogg");
          this.status = `Placing ${e.label}: click the floor.`;
        }
        this.render();
      };
      grid.append(tile);
    }
    if (!shown) grid.append(el("p", "furni-help", this.view === "owned" ? "Storage is empty. Buy furniture with crowns, or pick up placed items." : "Nothing matches."));
  }
}
