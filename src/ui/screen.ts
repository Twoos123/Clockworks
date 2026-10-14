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
/** Pixels between a docked window and the screen's edge. */
const DOCK_MARGIN = 8;
const COMPONENT = "com.threerings.opengl.gui.config.ComponentConfig$";

export interface ScreenHost {
  /** Plays a UI feedback sound. */
  sound(file: string): void;
  /** Called when the window closes (the game resumes). */
  closed(): void;
  /**
   * Draws a RenderableView, when the game can: the knight preview, or another model (a
   * battle sprite, a shopkeeper) in the view's place.
   */
  view?(c: Component, g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, model?: ViewModel): void;
}

/** A model shown in a RenderableView instead of the knight: its reference (null for none) and idle animation. */
export interface ViewModel { ref: any; idle: string | null }

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

/** Every window made; the left-docked ones among them lay out side by side. */
const SCREENS: GuiScreen[] = [];

export abstract class GuiScreen {
  protected root: Component | null = null;
  /** Modal interfaces over the root, topmost last. */
  protected overlays: Component[] = [];
  protected readonly canvas: HTMLCanvasElement;
  private running = false;
  private building: Promise<Component | null> | null = null;
  private pointer: { x: number; y: number } | null = null;
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
    SCREENS.push(this);
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
      this.pointer = { x, y };
      // a press keeps its window until the release (the side window or the main one)
      const target = type === "down" || !this.captured ? this.targetAt(x, y) : this.captured;
      if (!target) return;
      if (type === "down") this.captured = target;
      if (type === "up") this.captured = null;
      // the other window loses its hover
      if (type === "move") for (const o of [this.root, this.side]) if (o && o !== target && !this.overlays.length) dispatch(o, { type: "move", x: -1, y: -1 });
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
  }

  get isOpen() { return !this.canvas.hidden; }

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
    if (this.root && this.isOpen) { resetInput(this.root); if (this.side) resetInput(this.side); this.captured = null; await this.refresh(); }
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
    if (this.side) resetInput(this.side);
    this.captured = null;
    this.host.sound("sound/feedback/ui_dismiss.ogg");
    this.host.closed();
  }

  /**
   * Pops up a menu built in code (the client's item and sort menus, client/ui/E.bH) under the
   * pointer, over the topmost interface; a chosen item calls `choose` with its action.
   */
  async popupMenu(entries: MenuEntry[], title: string | undefined, choose: (action: string) => void) {
    const at = this.pointer;
    const target = at ? this.targetAt(at.x, at.y) : this.overlays[this.overlays.length - 1] ?? this.root;
    if (!target || !entries.length) return;
    const menu = await buildMenu(this.ctx, entries, title);
    menu.onAction = (_c, a) => { this.host.sound("sound/feedback/ui_dropdown_select.ogg"); choose(a); };
    openMenu(target, menu, at?.x ?? this.canvas.clientWidth / 2, at?.y ?? this.canvas.clientHeight / 2, this.canvas.clientWidth, this.canvas.clientHeight);
  }

  /**
   * A second window docked at the screen's right edge, centred vertically (the inventory
   * window the client opens beside the crafting window, item/client/f); it takes the pointer
   * where it lies.
   */
  protected side: Component | null = null;
  /** Docks the main window at the screen's right edge instead of centring it (item/client/i). */
  protected dockRight = false;
  /**
   * Docks the main window at the screen's top left (client/g with its right flag off: x 0, at
   * the top), beside the other left-docked windows that are open and come before it in
   * `dockOrder`: the social window (0) first, then the event hub (1).
   */
  protected dockLeft = false;
  protected dockOrder = 0;
  /** The width the window was last drawn at (the next left-docked window starts after it). */
  private drawnWidth = 0;
  private captured: Component | null = null;

  /** The window under a point: the top overlay, else the side window, else the main one. */
  private targetAt(x: number, y: number): Component | null {
    const top = this.overlays[this.overlays.length - 1];
    if (top) return top;
    if (this.side?.overlay) return this.side;
    if (this.root?.overlay) return this.root;
    if (this.side && hitTest(this.side, x, y)) return this.side;
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
    for (const top of [this.overlays[this.overlays.length - 1] ?? this.root, this.side]) if (top?.overlay) { top.overlay = null; return; }
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
    if (!this.pointer || !this.root || this.overlays.length || this.root.overlay || this.side?.overlay) return null;
    const win = this.targetAt(this.pointer.x, this.pointer.y) ?? this.root;
    const hit = hitTest(win, this.pointer.x, this.pointer.y);
    if (!hit) return null;
    let spec: TipSpec | null = null;
    for (const c of this.ancestors(win, hit) ?? []) spec = this.tips.get(c) ?? spec;
    if (!spec) return null;
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
    g.fillStyle = "rgba(4,10,18,0.6)";
    g.fillRect(0, 0, cw, ch);
    const now = performance.now(), dt = this.last ? Math.min(0.5, (now - this.last) / 1000) : 0;
    this.last = now;
    for (const r of this.runners.values()) r.tick(dt);
    this.tick();
    if (this.root) {
      const s = pack(this.root);
      this.drawnWidth = s.width;
      if (this.dockLeft) {
        const x = SCREENS.filter(o => o !== this && o.dockLeft && o.isOpen && o.dockOrder < this.dockOrder).reduce((a, o) => a + o.drawnWidth, 0);
        render(this.root, g, x, s.height, this.hooks);
      } else render(this.root, g, this.dockRight ? Math.max(0, cw - s.width - DOCK_MARGIN) : Math.round((cw - s.width) / 2), Math.round((ch + s.height) / 2), this.hooks);
    }
    if (this.side) {
      const s = pack(this.side);
      render(this.side, g, Math.max(0, cw - s.width - DOCK_MARGIN), Math.round((ch + s.height) / 2), this.hooks);
    }
    for (const o of this.overlays) {
      g.fillStyle = "rgba(4,10,18,0.45)";
      g.fillRect(0, 0, cw, ch);
      const s = pack(o);
      render(o, g, Math.round((cw - s.width) / 2), Math.round((ch + s.height) / 2), this.hooks);
    }
    const tip = this.hoveredTip();
    if (tip !== this.shownTip) { this.shownTip = tip; this.tipAge = 0; }
    if (tip && this.pointer) {
      this.tipAge += dt;
      const s = pack(tip);
      const x = Math.min(cw - s.width - 4, this.pointer.x + 18), y = Math.min(ch - 4, this.pointer.y + 18 + s.height);
      render(tip, g, Math.max(4, x), Math.max(s.height + 4, y), { ...this.hooks, view: (v, gg, vx, vy, vw, vh) => {
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
