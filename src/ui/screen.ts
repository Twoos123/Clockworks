// A full-screen window drawn from the game's own user interface configs on its own canvas
// over the game, as the options window does: the interface is laid out, centred and drawn
// each frame, pointer input goes to Clyde-style dispatch, hovering a component can show a
// tooltip interface, and a modal overlay (a confirmation, the forging animation) can sit on
// top. Subclasses build the tree and bind it to the save data.

import { CONFIG_REF } from "../config/params";
import { ScriptRunner } from "./script";
import { text as bundleText } from "../i18n";
import type { ItemStats } from "../game/itemstats";
import { buildComponentConfig, buildInterface, buildMenu, Component, dispatch, hitTest, openMenu, pack, render, resetInput, type GuiContext, type GuiImage, type MenuEntry,
  type RenderHooks } from "./gui";

const BONUS = "ui/window/tooltip_parts/bonus.dat";
const STATS = "ui/window/tooltip_parts/container_stats.dat";
const BAR = "ui/window/tooltip_parts/stat_bar.dat";
const COMPARE = "ui/window/tooltip_compare.dat";
/**
 * The HUD's height under a docked list (as.i: the display height less 145). The client's list
 * windows (client/g.Ah) stand that tall from the screen's top, against its edge (g.Cj: the
 * display width less their own; bL.Cj: the loadouts against the arsenal), with no margin or gap.
 */
const DOCK_BOTTOM = 145;
/** Pixels between a centred window and the docked ones beside it. */
const DOCK_GAP = 4;
/** hud/r: the energy panel's bottom edge above the screen's (its anchor's 70 pixel offset). */
const ENERGY_BOTTOM = 70;
const COMPONENT = "com.threerings.opengl.gui.config.ComponentConfig$";

/**
 * ProjectXApp's modal shade (Root.setModalShade: black at half opacity), drawn behind the
 * topmost modal window only: the confirm prompts (client/ui/k), the popups (client/ui/O: the
 * forging, a craft's success) and the like. The game's ordinary windows (the arsenal, the
 * shops, the boards, the options) are not modal and leave the game undimmed behind them.
 */
export function modalShade(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = "rgba(0,0,0,0.5)";
  g.fillRect(0, 0, w, h);
}

export interface ScreenHost {
  /** Plays a UI feedback sound. */
  sound(file: string): void;
  /** Called when the window closes (the game canvas takes the keys back). */
  closed(): void;
  /**
   * Draws a RenderableView, when the game can: the knight preview, or another model (a
   * battle sprite, a shopkeeper) in the view's place.
   */
  view?(c: Component, g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, model?: ViewModel): void;
}

/** A window docked beside another (the arsenal, the loadouts): its interface and how it fills itself. */
export interface DockPanel { ui: Component; refresh(): void | Promise<void> }

/** A model shown in a RenderableView instead of the knight: its reference (null for none) and idle animation. */
export interface ViewModel { ref: any; idle: string | null }

/** A popup menu entry whose icon may still be loading (it is put in when it arrives). */
export type PopupEntry = Omit<MenuEntry, "icon"> & { icon?: GuiImage | null | Promise<GuiImage | null> };

/** A ConfigReference to an interface with arguments. */
export function uiRef(name: string, args: Record<string, unknown> = {}) {
  return { $class: CONFIG_REF, name, arguments: { $map: "com.threerings.config.ArgumentMap", entries: Object.entries(args) } };
}

/**
 * Builds an interface, dropping the icons plain labels took from their styles: the window
 * styles carry a placeholder alert icon (Tooltip_Title, StatusLabel_aqua...) that the game's
 * labels do not draw; a label's own icon config is kept.
 */
export async function buildUi(ctx: GuiContext, ref: any): Promise<Component | null> {
  const root = await buildInterface(ctx, ref);
  const strip = (c: Component) => {
    if (c.kind === "label" && c.icon && !c.config?.icon && c.icon === c.styles[0]?.icon) c.icon = null;
    c.children.forEach(strip);
    c.tabs.forEach(strip);
  };
  if (root) strip(root);
  return root;
}

/** A tooltip: an interface reference and lines of bonus text (ui/window/tooltip_parts/bonus.dat). */
export interface TipSpec {
  ref: any; /** A text tooltip (Component.setTooltipText) in place of the interface. */ text?: string; lines?: string[]; /** Texts set on tagged labels after the build. */ texts?: Record<string, string>;
  /** An item's attack or defence power bars (tooltip_parts/container_stats.dat), before the lines. */
  stats?: ItemStats;
  /** Bonus and penalty lines (green or red, with an icon), after the lines. */
  bonuses?: { text: string; bonus: boolean; icon?: string | null; /** "Variant" for a unique variant's line. */ color?: string }[];
  /**
   * The 3D preview in the tooltip's renderview (ItemConfig.Original.a): the item's model in
   * its kind's item/preview model, turning; none hides the view.
   */
  model?: any;
  /**
   * The item this one is compared with (item/client/k, ItemConfig.Level's compare tooltip):
   * both tooltips side by side in ui/window/tooltip_compare.dat, the compared one first.
   */
  compare?: TipSpec;
  /**
   * item/client/M.a's placement (client/ui/f): the tooltip sits beside its anchor (an item
   * pill's tip_anchor, else the component the tooltip belongs to) rather than by the mouse,
   * its right edge this many pixels into the anchor, above it, or below it when there is no
   * room above (item/client/N).
   */
  anchored?: number;
}

/**
 * ItemConfig's stat map across a compared pair: each box shows the bars either item has, an
 * empty bar where one lacks a type the other has, in the client's order.
 */
function alignStats(a: ItemStats | undefined, b: ItemStats | undefined): [ItemStats | undefined, ItemStats | undefined] {
  if (!a || !b || a.title !== b.title) return [a, b];
  const order = (icon: string) => { const i = ["normal", "piercing", "elemental", "shadow"].findIndex(t => icon.endsWith("_" + t)); return i < 0 ? 10 : i; };
  const icons = [...new Set([...a.bars, ...b.bars].map(x => x.icon))].sort((x, y) => order(x) - order(y));
  const bars = (s: ItemStats) => icons.map(i => s.bars.find(x => x.icon === i) ?? { ...[...a.bars, ...b.bars].find(x => x.icon === i)!, now: 0, potential: 0 });
  const st = [...new Set([...(a.resists ?? []), ...(b.resists ?? [])].map(x => x.status))];
  const resists = (s: ItemStats) => st.map(k => s.resists?.find(x => x.status === k) ?? { status: k, bonus: 0, bonusPotential: 0, penalty: 0, penaltyPotential: 0 });
  return [{ ...a, bars: bars(a), resists: resists(a) }, { ...b, bars: bars(b), resists: resists(b) }];
}

/**
 * A tooltip's stat container as ItemConfig builds it: the title and a bar per damage type
 * (the placeholder bar removed), each with its icon, label and the bars' widths.
 */
export async function buildStats(ctx: GuiContext, st: ItemStats): Promise<Component[]> {
  const t = (k: string) => bundleText("item", k, k.replace(/^t\./, "").replace(/_/g, " ").toUpperCase());
  const box = async (title: string, refs: any[]) => {
    const [b, ...bars] = await Promise.all([buildUi(ctx, uiRef(STATS, { "Stat Title": t(title) })), ...refs.map(r => buildUi(ctx, r))]);
    const list = b?.find("stats") ?? b;
    if (!b || !list) return null;
    list.children = [list.children[0], ...bars.filter((x): x is Component => !!x)].filter(Boolean);
    for (const x of list.children.slice(1)) x.constraints = null;
    return b;
  };
  const out = await Promise.all([
    st.bars.length ? box(st.title, st.bars.map(b => uiRef(BAR, { Icon: `ui/icon/stats/${b.icon}.png`, "Stat Label": t(b.label), Alignment: "Left",
      "Bonus Width": b.now, "Bonus Potential Width": b.potential, "Bar Type": "Bonus" }))) : null,
    // client/l.a: centred bars, resistance to the right and weakness to the left
    st.resists?.length ? box("t.status_resist", st.resists.map(r => uiRef(BAR, { Icon: `ui/icon/debuff/${r.status}.png`,
      "Stat Label": bundleText("item", `m.${r.status}`, r.status.toUpperCase()), Alignment: "Center",
      "Bonus Width": r.bonus, "Bonus Potential Width": r.bonusPotential, "Penalty Width": r.penalty, "Penalty Potential Width": r.penaltyPotential,
      "Bar Type": "Bonus", "Negative Bar Type": "Penalty" }))) : null,
  ]);
  return out.filter((c): c is Component => !!c);
}

/** An image scaled to fit `size` pixels. */
export function scaleImage(im: GuiImage, size: number): GuiImage {
  const s = Math.min(size / im.width, size / im.height), w = Math.max(1, Math.round(im.width * s)), h = Math.max(1, Math.round(im.height * s));
  const canvas = new OffscreenCanvas(w, h);
  const g = canvas.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(im.source, 0, 0, w, h);
  return { source: canvas, width: w, height: h };
}

/** A synthetic container laying children out in a row (as interface_forge.dat does). */
export function row(kids: Component[], gap = 0, align = "TOP"): Component {
  const c = new Component("container", null);
  c.layout = { $class: "LayoutConfig$HorizontalGroup", policy: { name: "NONE" }, justification: { name: "CENTER" }, offAxisPolicy: { name: "NONE" },
    offAxisJustification: { name: align }, gap };
  c.children = kids;
  for (const k of kids) k.constraints = { fixed: true };
  return c;
}

export abstract class GuiScreen {
  protected root: Component | null = null;
  /** Modal interfaces over the root, topmost last. */
  protected overlays: Component[] = [];
  protected readonly canvas: HTMLCanvasElement;
  private running = false;
  private building: Promise<Component | null> | null = null;
  private pointer: { x: number; y: number } | null = null;
  /** Where the last press or release was (a menu a click asks for opens there). */
  private pressed: { x: number; y: number } | null = null;
  /** Tooltips by component: the tooltip interface's reference, built on first hover. */
  protected tips = new Map<Component, TipSpec>();
  /** Click handlers for components Clyde's dispatch does not press (sockets, icons). */
  protected clicks = new Map<Component, () => void>();
  private pressedAt: Component | null = null;
  private tipCache = new Map<string, Promise<Component | null> | Component | null>();
  private icons = new Map<string, GuiImage | null>();
  protected hooks: RenderHooks = {};
  private runners = new Map<Component, ScriptRunner>();
  private last = 0;

  constructor(protected readonly ctx: GuiContext, protected readonly host: ScreenHost, id: string) {
    const c = this.canvas = document.createElement("canvas");
    c.id = id;
    c.className = "title-canvas options-canvas gui-screen";
    c.hidden = true;
    c.tabIndex = -1;
    const anchor = document.getElementById("optionsCanvas");
    (anchor?.parentElement ?? document.body).insertBefore(c, anchor ?? null);
    const ev = (type: "down" | "up" | "move" | "wheel") => (e: PointerEvent | WheelEvent) => {
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      // the docked windows open beside each other (the Event Hub beside the uplink): a pointer
      // off this one's windows goes on to the window canvas beneath it
      if (this.forward(e, type, x, y)) { this.pointer = null; if (this.root && type === "move") dispatch(this.root, { type: "move", x: -1, y: -1 }); return; }
      this.pointer = { x, y };
      if (type === "down" || type === "up") this.pressed = { x, y };
      // a press keeps its window until the release (the side window or the main one)
      const target = type === "down" || !this.captured ? this.targetAt(x, y) : this.captured;
      if (!target) return;
      if (type === "down") this.captured = target;
      if (type === "up") this.captured = null;
      // the other window loses its hover
      if (type === "move") for (const o of [this.root, ...this.sides]) if (o && o !== target && !this.overlays.length) dispatch(o, { type: "move", x: -1, y: -1 });
      // an open popup menu takes the pointer: nothing under it is clicked
      const menu = !!target.overlay;
      dispatch(target, { type, x, y, button: (e as PointerEvent).button ?? 0, delta: type === "wheel" ? Math.sign((e as WheelEvent).deltaY) : 0 });
      if (type === "wheel") e.preventDefault();
      // components with nothing to press in Clyde (spacers drawn as sockets) take clicks here
      if (type === "down") this.pressedAt = menu ? null : this.clickable(target, x, y);
      if (type === "up") {
        const c = this.clickable(target, x, y);
        if (c && c === this.pressedAt && (e as PointerEvent).button === 0) this.clicks.get(c)?.();
        this.pressedAt = null;
      }
    };
    c.addEventListener("pointerdown", ev("down"));
    c.addEventListener("pointerup", ev("up"));
    c.addEventListener("pointermove", ev("move"));
    c.addEventListener("pointerleave", () => { this.pointer = null; });
    c.addEventListener("wheel", ev("wheel"), { passive: false });
    c.addEventListener("contextmenu", e => e.preventDefault());
    // a press passed on to the game's canvas may be captured there (its release never comes
    // back here): any release ends the passing on
    const done = () => { this.forwardTo = null; };
    if (typeof addEventListener === "function") { addEventListener("pointerup", done); addEventListener("pointercancel", done); }
  }

  get isOpen() { return !this.canvas.hidden; }

  /** The window canvas a press was passed on to, which keeps the pointer until the release. */
  private forwardTo: HTMLCanvasElement | null = null;

  /**
   * Passes a pointer event that lands off this window's interfaces (with nothing modal up)
   * to the open window canvas beneath, if there is one. True when it was passed on.
   */
  private forward(e: PointerEvent | WheelEvent, type: string, x: number, y: number): boolean {
    let to = this.forwardTo;
    if (!to) {
      if (type === "up" || this.captured || this.overlays.length || this.root?.overlay || this.sides.some(d => d.overlay)) return false;
      if ((this.root && hitTest(this.root, x, y)) || this.sides.some(d => hitTest(d, x, y))) return false;
      if (this.beside && this.besideShown && hitTest(this.beside, x, y)) return false;
      // the window canvas beneath, else the game's own canvas: the game goes on behind the
      // windows, and a click off them attacks or presses the HUD as it would with none open
      to = (document.elementsFromPoint?.(e.clientX, e.clientY) ?? []).find((el): el is HTMLCanvasElement =>
        el !== this.canvas && el instanceof HTMLCanvasElement && !el.hidden) ?? null;
      if (!to) return false;
    }
    if (type === "down") this.forwardTo = to;
    if (type === "up") this.forwardTo = null;
    const Ctor = (e instanceof WheelEvent ? WheelEvent : PointerEvent) as any;
    const copy = new Ctor(e.type, e);
    to.dispatchEvent(copy);
    if (copy.defaultPrevented) e.preventDefault();
    return true;
  }

  /** Builds the interface tree (once). */
  protected abstract build(): Promise<Component | null>;
  /** Puts the save data into the tree (each time the window opens or something changes). */
  protected abstract refresh(): void | Promise<void>;

  async open() {
    // the window opened last is drawn over the others (the mission board's arsenal toggle
    // opens the arsenal over the board)
    if (this.canvas.hidden) {
      const anchor = document.getElementById("optionsCanvas");
      if (anchor?.parentElement && this.canvas.nextElementSibling !== anchor) anchor.parentElement.insertBefore(this.canvas, anchor);
    }
    this.canvas.hidden = false;
    this.host.sound("sound/feedback/ui_open.ogg");
    if (!this.running) { this.running = true; requestAnimationFrame(this.frame); }
    if (!this.root) {
      this.building ??= this.build();
      this.root = await this.building;
    }
    if (this.root && this.isOpen) { resetInput(this.root); for (const d of this.sides) resetInput(d); this.captured = null; await this.refreshAll(); }
  }

  /**
   * Builds the window ahead of its first opening (in idle time), with the save's data put
   * in, so the first open shows it at once.
   */
  async prebuild() {
    if (this.root) return;
    this.building ??= this.build();
    const root = await this.building;
    this.root ??= root;
    if (this.root && !this.isOpen) await this.refresh();
  }

  close() {
    if (!this.isOpen) return;
    this.canvas.hidden = true;
    this.running = false;
    this.last = 0;
    this.overlays = [];
    if (this.root) resetInput(this.root);
    for (const d of this.sides) resetInput(d);
    // the docked windows close with it
    this.docks = [];
    this.captured = null;
    this.host.sound("sound/feedback/ui_dismiss.ogg");
    this.host.closed();
  }

  /**
   * Pops up a menu built in code (the client's item and sort menus, client/ui/E.bH) under the
   * pointer, over the topmost interface; a chosen item calls `choose` with its action.
   */
  async popupMenu(entries: PopupEntry[], title: string | undefined, choose: (action: string) => void): Promise<Component | null> {
    // the point and the window are those of the click that asked for the menu, taken before
    // anything is awaited (the pointer may move or leave the canvas while the menu is built)
    const at = this.pointer ?? this.pressed;
    const target = at ? this.targetAt(at.x, at.y) : this.overlays[this.overlays.length - 1] ?? this.root;
    if (!target || !entries.length || !this.isOpen) return null;
    try {
      // icons still loading are left out; each is put in when it arrives
      const menu = await buildMenu(this.ctx, entries.map(e => ({ ...e, icon: e.icon instanceof Promise ? null : e.icon ?? null })), title);
      if (!this.isOpen) return null;
      menu.onAction = (_c, a) => { this.host.sound("sound/feedback/ui_dropdown_select.ogg"); choose(a); };
      openMenu(target, menu, at?.x ?? this.canvas.clientWidth / 2, at?.y ?? this.canvas.clientHeight / 2, this.canvas.clientWidth, this.canvas.clientHeight);
      const first = title ? 1 : 0;
      entries.forEach((e, i) => {
        if (!(e.icon instanceof Promise)) return;
        e.icon.then(im => {
          const item = menu.children[first + i];
          if (!im || !item) return;
          item.icon = im;
          // the menu grows to fit (PopupMenu.packAndFit keeps it on screen when drawn)
          pack(menu);
        }, err => console.error("menu icon failed", err));
      });
      return menu;
    } catch (e) {
      console.error("popup menu failed", e);
      return null;
    }
  }

  /**
   * Windows docked at the screen's right edge beside the main one, centred vertically, each
   * with its own close button: the arsenal (item/client/f) at the edge and the loadouts
   * (client/bL, placed left of the arsenal) beside it, as the client docks them by the forge,
   * the crafting window and the character window. Each takes the pointer where it lies.
   */
  private docks: { key: string; order: number; panel: DockPanel; left?: boolean }[] = [];
  /** The docked windows, from the screen's edge inward. */
  protected get sides(): Component[] { return this.docks.map(d => d.panel.ui); }
  /**
   * Docks the main window at the screen's right edge instead of centring it (item/client/i, a
   * client/g list window): full height above the HUD from the top edge, against the edge (or
   * the windows docked at it).
   */
  protected dockRight = false;
  /**
   * Docks the main window at the screen's left edge. A function: full height above the HUD
   * (client/g with its left side) at the x it returns, past the windows docked there before
   * it (the event hub). True: at the edge, centred vertically (the forge, item/client/q.BH).
   */
  protected dockLeft: boolean | (() => number) = false;
  /** The left-docked window's width as last drawn (for the windows docked beside it). */
  dockedWidth = 0;
  /**
   * The docked windows stand full height above the HUD from the top edge, as every client/g
   * list window does (the arsenal, the loadouts, the shop's vendor), instead of centred at
   * their own height.
   */
  protected tallDocks = true;
  /**
   * The HUD's energy panel (hud/r: ui/energy/interface_collapse.dat holding the energy module
   * ui/energy/interface.dat), which the client's item lists show at the screen's bottom right,
   * 70 pixels up, while they are open (client/d.wasAdded with its list's Cd()): the knight's
   * energy, or null for a window that does not show it.
   */
  protected energy: (() => number) | null = null;
  private energyUi: Component | null = null;
  private energyBuilding = false;
  private captured: Component | null = null;

  /** Whether a docked window is shown. */
  docked(key: string): boolean { return this.docks.some(d => d.key === key); }

  /**
   * Shows a docked window (built once by `make`) or takes it away; `order` places it from the
   * edge inward (the arsenal 0, the loadouts 1).
   */
  async dock(key: string, on: boolean, order: number, make: (s: GuiScreen) => Promise<DockPanel | null>, left = false) {
    if (!on) { this.docks = this.docks.filter(d => d.key !== key); return; }
    if (this.docked(key)) return;
    let panel = this.panels.get(key);
    if (panel === undefined) { panel = await make(this); this.panels.set(key, panel); }
    if (!panel || this.docked(key)) return;
    this.docks = [...this.docks, { key, order, panel, left }].sort((a, b) => a.order - b.order);
    resetInput(panel.ui);
    await panel.refresh();
  }
  private panels = new Map<string, DockPanel | null>();

  /** Refreshes the window and its docked windows (after a change in any of them). */
  async refreshAll() {
    await this.refresh();
    for (const d of this.docks) await d.panel.refresh();
  }

  /** Plays a UI sound (for docked windows and dialogs). */
  sound(file: string) { this.host.sound(file); }
  /** Shows a modal interface over the window (a dialog). */
  pushOverlay(c: Component) { this.overlays.push(c); }
  /** Takes a modal interface away. */
  dropOverlay(c: Component) { this.overlays = this.overlays.filter(x => x !== c); }

  /** What a docked window builds against: this window's tooltips, clicks and popup menus. */
  get dockContext() { return { ctx: this.ctx, tips: this.tips, clicks: this.clicks, screen: this }; }

  /** A window docked at the main window's left (drawn when both fit), or null. */
  protected beside: Component | null = null;
  private besideShown = false;

  /** The window under a point: the top overlay, else a docked window, else the main one. */
  private targetAt(x: number, y: number): Component | null {
    const top = this.overlays[this.overlays.length - 1];
    if (top) return top;
    const sides = this.sides;
    for (const d of sides) if (d.overlay) return d;
    if (this.root?.overlay) return this.root;
    for (const d of sides) if (hitTest(d, x, y)) return d;
    if (this.beside && this.besideShown && (this.beside.overlay || hitTest(this.beside, x, y))) return this.beside;
    return this.root;
  }

  /** An icon config's image scaled to `size` pixels, once loaded (a menu item's icon). */
  async iconImage(cfg: any, size: number): Promise<GuiImage | null> {
    const im = await this.ctx.icon(cfg);
    return im ? scaleImage(im, size) : null;
  }

  /** A style's background image scaled to `size` pixels (an equipment slot's own icon). */
  async styleImage(name: string, args: Record<string, unknown>, size: number): Promise<GuiImage | null> {
    const st = await this.ctx.resolveStyle({ $class: CONFIG_REF, name, arguments: { $map: "com.threerings.config.ArgumentMap", entries: Object.entries(args) } }, new Map());
    const im = st?.background?.image;
    return im ? scaleImage(im, size) : null;
  }

  /** Escape: closes an open popup menu, then the topmost overlay, else the window. */
  escape() {
    for (const top of [this.overlays[this.overlays.length - 1] ?? this.root, ...this.sides]) if (top?.overlay) { top.overlay = null; return; }
    if (this.overlays.length) { this.overlays.pop(); return; }
    this.close();
  }

  /** Builds an interface by name with arguments. */
  protected ui(name: string, args: Record<string, unknown> = {}) {
    return buildUi(this.ctx, uiRef(name, args));
  }

  /** Sets an action handler on a tagged component. */
  protected on(root: Component, tag: string, fn: (c: Component, action: string) => void) {
    const c = root.find(tag);
    if (c) c.onAction = fn;
    return c;
  }

  /** An icon config's image scaled to fit `size` pixels (null until it has loaded). */
  protected icon(cfg: any, size: number): GuiImage | null {
    if (!cfg) return null;
    const key = JSON.stringify(cfg, (k, v) => (k === "$outer" ? undefined : v)) + size;
    if (!this.icons.has(key)) {
      this.icons.set(key, null);
      void this.ctx.icon(cfg).then(im => { if (im) this.icons.set(key, scaleImage(im, size)); });
    }
    return this.icons.get(key) ?? null;
  }

  /** The tooltip for the hovered component (or an ancestor), built once per reference. */
  private hoveredTip(): Component | null {
    if (!this.pointer || !this.root || this.overlays.length || this.root.overlay || this.sides.some(d => d.overlay)) return null;
    const win = this.targetAt(this.pointer.x, this.pointer.y) ?? this.root;
    const hit = hitTest(win, this.pointer.x, this.pointer.y);
    if (!hit) return null;
    let spec: TipSpec | null = null, owner: Component | null = null;
    for (const c of this.ancestors(win, hit) ?? []) { const t = this.tips.get(c); if (t) { spec = t; owner = c; } }
    if (!spec || !owner) return null;
    // an item pill's tooltip anchors at its icon (interface_itempill.dat's tip_anchor)
    const pillAnchor = owner.find("tip_anchor");
    this.tipAnchor = spec.text === undefined && (pillAnchor || spec.anchored !== undefined)
      ? { c: pillAnchor ?? owner, overlap: spec.anchored ?? 15 } : null;
    const key = JSON.stringify(spec, (k, v) => (k === "$outer" ? undefined : v));
    const t = this.tipCache.get(key);
    if (t === undefined) {
      if (this.tipCache.size > 200) this.tipCache.clear();
      const p = this.buildTip(spec).catch(e => { console.error("tooltip failed", e); return null; }).then(c => { this.tipCache.set(key, c); return c; });
      this.tipCache.set(key, p);
      return null;
    }
    return t instanceof Promise ? null : t;
  }

  private buildTip(spec: TipSpec): Promise<Component | null> { return buildTooltip(this.ctx, spec); }

  /** The tooltip on screen and how long it has been up (its 3D preview turns). */
  private shownTip: Component | null = null;
  private tipAge = 0;
  /** Where the hovered tooltip anchors (item/client/N), or null to follow the mouse. */
  private tipAnchor: { c: Component; overlap: number } | null = null;

  private clickable(root: Component, x: number, y: number): Component | null {
    if (!this.clicks.size) return null;
    const hit = hitTest(root, x, y);
    const path = hit ? this.ancestors(root, hit) ?? [] : [];
    for (let i = path.length - 1; i >= 0; i--) if (this.clicks.has(path[i])) return path[i];
    return null;
  }
  private ancestors(root: Component, c: Component): Component[] | null {
    if (root === c) return [root];
    for (const k of root.children) { const p = this.ancestors(k, c); if (p) return [root, ...p]; }
    return null;
  }

  private frame = () => {
    if (!this.running) return;
    // a failed draw is reported, not allowed to stop the window's loop
    try { this.draw(); } catch (e) { console.error("window draw failed", e); }
    requestAnimationFrame(this.frame);
  };

  private draw() {
    const c = this.canvas, dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.scale(dpr, dpr);
    const cw = w / dpr, ch = h / dpr;
    const now = performance.now(), dt = this.last ? Math.min(0.5, (now - this.last) / 1000) : 0;
    this.last = now;
    for (const r of this.runners.values()) r.tick(dt);
    this.tick();
    // docked windows from the right edge inward, then the main window: at the left edge, at
    // the docked windows' left, or centred where that leaves them clear
    let edge = cw, leftEdge = 0;
    const tall = Math.max(200, Math.round(ch - DOCK_BOTTOM));
    // the right edge's column (the arsenal, a right-docked window): the energy panel joins it
    // at its foot, the window shortened by the panel's height so the two stand as one column
    // whose bottom is the HUD's 145 pixels up
    let column: number | null = null, columnWidth = 0;
    const energyH = this.energyHeight();
    const columnTall = Math.max(100, tall - energyH);
    for (const d of this.docks) {
      const ui = d.panel.ui;
      const first = !d.left && edge === cw && this.tallDocks;
      if (this.tallDocks) ui.preferredSize = { width: -1, height: first ? columnTall : tall };
      const s = pack(ui);
      const bottom = this.tallDocks ? s.height : Math.round((ch + s.height) / 2);
      if (d.left) {
        // a window docked at the left edge (the shop's vendor), the next one beside it
        render(ui, g, leftEdge, bottom, this.hooks);
        leftEdge += s.width;
        continue;
      }
      if (first) { column = bottom; columnWidth = s.width; }
      edge -= s.width;
      render(ui, g, Math.max(0, edge), bottom, this.hooks);
    }
    if (this.root) {
      if (typeof this.dockLeft === "function") {
        // client/g.Ah: the screen's height less the HUD's 145 pixels, from the top edge
        this.root.preferredSize = { width: -1, height: Math.max(200, Math.round(ch - DOCK_BOTTOM)) };
        const s = pack(this.root);
        this.dockedWidth = s.width;
        render(this.root, g, Math.min(Math.max(0, cw - s.width), this.dockLeft()), s.height, this.hooks);
      } else {
        // a right-docked list window stands full height from the top, against the edge (less
        // the energy panel under it there)
        const right = this.docks.some(d => !d.left) ? edge - (this.dockRight ? 0 : DOCK_GAP) : cw;
        if (this.dockRight) this.root.preferredSize = { width: -1, height: right === cw ? columnTall : tall };
        const s = pack(this.root);
        if (this.dockRight && right === cw) { column = s.height; columnWidth = s.width; }
        let x = this.dockLeft ? 0 : this.dockRight ? right - s.width
          : Math.max(leftEdge + DOCK_GAP, Math.min(Math.round((cw - s.width) / 2), right - s.width));
        // a window docked to the main one's left (the mission board's Featured Items,
        // mission/client/r.Ah): the main window moves right by half its width when both fit,
        // and it sits at the main window's left, tops level; it is left off when they do not fit
        const left = this.beside;
        this.besideShown = false;
        if (left && !this.dockLeft && !this.dockRight && !this.sides.length) {
          const ls = pack(left);
          if (s.width + ls.width <= cw) {
            x = Math.round((cw - s.width + ls.width) / 2);
            const top = Math.round((ch - s.height) / 2);
            render(left, g, x - ls.width, Math.min(ch, top + ls.height), this.hooks);
            this.besideShown = true;
          }
        }
        render(this.root, g, Math.max(0, x), this.dockRight ? s.height : Math.round((ch + s.height) / 2), this.hooks);
      }
    }
    this.drawEnergy(g, cw, ch, column, columnWidth);
    for (const [i, o] of this.overlays.entries()) {
      // the client's modal shade behind the topmost modal window (a confirmation, the forging)
      if (i === this.overlays.length - 1) modalShade(g, cw, ch);
      const s = pack(o);
      render(o, g, Math.round((cw - s.width) / 2), Math.round((ch + s.height) / 2), this.hooks);
    }
    const tip = this.hoveredTip();
    if (tip !== this.shownTip) { this.shownTip = tip; this.tipAge = 0; }
    if (tip && this.pointer) {
      this.tipAge += dt;
      const s = pack(tip);
      let x = Math.max(4, Math.min(cw - s.width - 4, this.pointer.x + 18)), y = Math.max(s.height + 4, Math.min(ch - 4, this.pointer.y + 18 + s.height));
      const a = this.tipAnchor, r = a?.c.screen;
      if (a && r) {
        // item/client/N: the right edge `overlap` into the anchor; the bottom `overlap` below
        // its top, else the top `overlap` above its bottom, else against the screen's top
        const o = a.overlap;
        let top = r.y + o - s.height;
        if (top <= 0) { top = r.y + r.height - o; if (top + s.height > ch) top = 1; }
        let left = r.x - s.width + o;
        if (left < 0) left = r.x + r.width - o;
        x = Math.round(left);
        y = Math.round(top + s.height);
      }
      render(tip, g, x, y, { ...this.hooks, view: (v, gg, vx, vy, vw, vh) => {
        if (v.viewOwner !== "tooltip") { this.hooks.view?.(v, gg, vx, vy, vw, vh); return; }
        // client/ui/Q: after 0.2 s the camera orbits, speeding up to 3pi/8 radians a second over a second
        const base = (v.view.baseAzimuth ??= v.view.azimuth ?? 0), a = this.tipAge;
        const turned = a <= 0.2 ? 0 : a <= 1.2 ? (3 * Math.PI / 8) * (a - 0.2) ** 2 / 2 : (3 * Math.PI / 8) * (0.5 + (a - 1.2));
        v.view.azimuth = base + turned;
        this.host.view?.(v, gg, vx, vy, vw, vh, { ref: v.view.models?.[0]?.model ?? null, idle: null });
      } });
    }
  }

  /** The script runner for an interface (its scripts play while the window is open). */
  protected runner(ui: Component): ScriptRunner {
    let r = this.runners.get(ui);
    if (!r) { this.runners.set(ui, r = new ScriptRunner(ui)); r.onSound = f => this.host.sound(f); }
    return r;
  }

  /** Per-frame work before drawing (animations). */
  protected tick() {}

  /** The energy panel's height while this window shows it (0 until it is built, or without one). */
  private energyHeight(): number {
    if (!this.energy) return 0;
    if (!this.energyUi) {
      if (!this.energyBuilding) {
        this.energyBuilding = true;
        void energyPanel(this.ctx).then(c => { this.energyUi = c; }, e => console.error("energy panel failed", e));
      }
      return 0;
    }
    return pack(this.energyUi).height;
  }

  /**
   * The HUD's energy panel at the bottom right (hud/r, anchored right and bottom, 70 up), flush
   * against the screen's edge; under a column docked at the right edge it hangs from that
   * column's bottom (`top`), joined to it, the column shortened by its height (energyHeight).
   */
  private drawEnergy(g: CanvasRenderingContext2D, cw: number, ch: number, top: number | null = null, width = 0) {
    if (!this.energy || !this.energyUi) return;
    const n = this.energyUi.find("crystalenergy");
    if (n) n.text = this.energy().toLocaleString("en-US");
    // under a column it takes the column's width, so the two edges line up as one panel
    this.energyUi.preferredSize = top !== null && width > 0 ? { width, height: -1 } : null;
    const s = pack(this.energyUi);
    render(this.energyUi, g, Math.max(0, cw - s.width), top !== null ? top + s.height : Math.round(ch - ENERGY_BOTTOM), this.hooks);
  }
}

/** Builds a tooltip: its placeholder stat pills give way to the spec's bonus lines. */
export async function buildTooltip(ctx: GuiContext, spec: TipSpec): Promise<Component | null> {
  if (spec.text !== undefined) return textTip(ctx, spec.text);
  if (spec.compare) {
    const [sa, sb] = alignStats(spec.compare.stats, spec.stats);
    const [wrap, other, own] = await Promise.all([buildUi(ctx, uiRef(COMPARE)), buildTooltip(ctx, { ...spec.compare, compare: undefined, stats: sa }),
      buildTooltip(ctx, { ...spec, compare: undefined, stats: sb })]);
    const box = wrap?.find("tip_container");
    if (!wrap || !box || !other || !own) return own;
    box.children = [other, own];
    for (const k of box.children) k.constraints = null;
    return wrap;
  }
  const plain = spec.lines?.length ?? 0;
  const [c, stats, ...lines] = await Promise.all([buildUi(ctx, spec.ref), spec.stats ? buildStats(ctx, spec.stats) : [],
    ...(spec.lines ?? []).map(l => buildUi(ctx, uiRef(BONUS, { Description: l, "Toggle Icon": false }))),
    ...(spec.bonuses ?? []).map(b => buildUi(ctx, uiRef(BONUS, { Color: b.color ?? (b.bonus ? "Bonus" : "Penalty"), Description: b.text,
      "Bonus Icon": b.icon ?? null, "Toggle Icon": !!b.icon })))]);
  // our own lines (not the game's bonuses) leave out the bonus arrow
  lines.slice(0, plain).forEach(l => { const arrow = l?.children[0]?.children.at(-1); if (arrow && !arrow.tag) arrow.visible = false; });
  if (!c) return null;
  // the 3D item preview: the view shows the spec's model (drawn by the window's view hook)
  const view = c.find("renderview");
  if (view) {
    view.visible = !!spec.model;
    if (spec.model) { view.view = { ...(view.view ?? {}), models: [{ ...(view.view?.models?.[0] ?? {}), model: spec.model }] }; view.viewOwner = "tooltip"; }
  }
  for (const [tag, text] of Object.entries(spec.texts ?? {})) { const t = c.find(tag); if (t) t.text = text; }
  const pills = c.find("tooltip_pills");
  if (pills) {
    pills.children = [...stats, ...lines].filter((l): l is Component => !!l);
    for (const l of pills.children) l.constraints = null;
    pills.visible = pills.children.length > 0;
  }
  return c;
}

/** Component.createTooltipComponent: a text tooltip, a label in a Default/TooltipWindow window. */
export async function textTip(ctx: GuiContext, text: string): Promise<Component> {
  const win = await buildComponentConfig(ctx, { $class: COMPONENT + "Container", style: { $class: CONFIG_REF, name: "Default/TooltipWindow" },
    layout: { $class: "com.threerings.opengl.gui.config.LayoutConfig$Border", horizontalGap: 0, verticalGap: 0,
      children: [{ component: { $class: COMPONENT + "Label" }, location: { name: "CENTER" } }] } });
  const label = win.children[0];
  if (label) label.text = text;
  return win;
}

/**
 * hud/r: the HUD's collapsible panel (ui/energy/interface_collapse.dat, its title hidden) with
 * the energy module (client/af, ui/energy/interface.dat) in its "energywidget" place. Its fold
 * handles are hidden (hud/r.wasAdded: aTU hidden, b(false, false)); its crystal's view is not drawn.
 */
export async function energyPanel(ctx: GuiContext): Promise<Component | null> {
  const [box, module] = await Promise.all([buildUi(ctx, uiRef("ui/energy/interface_collapse.dat")),
    buildUi(ctx, uiRef("ui/energy/interface.dat", { "Crystal Energy": "On", "Get Energy Button": false }))]);
  if (!box || !module) return module;
  const swap = (c: Component): boolean => {
    const i = c.children.findIndex(k => k.tag === "energywidget" || k.tag === "content");
    if (i >= 0) { module.constraints = c.children[i].constraints; c.children[i] = module; return true; }
    return c.children.some(swap);
  };
  if (!swap(box)) return module;
  const hide = (c: Component) => { if (c.tag === "handle" || c.tag === "label_title") c.visible = false; c.children.forEach(hide); };
  hide(box);
  const level = module.find("level");
  if (level) level.visible = false;
  return box;
}
