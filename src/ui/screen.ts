// A full-screen window drawn from the game's own user interface configs on its own canvas
// over the game, as the options window does: the interface is laid out, centred and drawn
// each frame, pointer input goes to Clyde-style dispatch, hovering a component can show a
// tooltip interface, and a modal overlay (a confirmation, the forging animation) can sit on
// top. Subclasses build the tree and bind it to the save data.

import { CONFIG_REF } from "../config/params";
import { ScriptRunner } from "./script";
import { text as bundleText } from "../i18n";
import type { ItemStats } from "../game/itemstats";
import { buildInterface, Component, dispatch, hitTest, pack, render, resetInput, type GuiContext, type GuiImage, type RenderHooks } from "./gui";

const BONUS = "ui/window/tooltip_parts/bonus.dat";
const STATS = "ui/window/tooltip_parts/container_stats.dat";
const BAR = "ui/window/tooltip_parts/stat_bar.dat";

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
  ref: any; lines?: string[]; /** Texts set on tagged labels after the build. */ texts?: Record<string, string>;
  /** An item's attack or defence power bars (tooltip_parts/container_stats.dat), before the lines. */
  stats?: ItemStats;
  /** Bonus and penalty lines (green or red, with an icon), after the lines. */
  bonuses?: { text: string; bonus: boolean; icon?: string | null; /** "Variant" for a unique variant's line. */ color?: string }[];
}

/**
 * A tooltip's stat container as ItemConfig builds it: the title and a bar per damage type
 * (the placeholder bar removed), each with its icon, label and the bars' widths.
 */
export async function buildStats(ctx: GuiContext, st: ItemStats): Promise<Component | null> {
  const t = (k: string) => bundleText("item", k, k.replace(/^t\./, "").replace(/_/g, " ").toUpperCase());
  const [box, ...bars] = await Promise.all([buildUi(ctx, uiRef(STATS, { "Stat Title": t(st.title) })),
    ...st.bars.map(b => buildUi(ctx, uiRef(BAR, { Icon: `ui/icon/stats/${b.icon}.png`, "Stat Label": t(b.label), Alignment: "Left",
      "Bonus Width": b.now, "Bonus Potential Width": b.potential, "Bar Type": "Bonus" })))]);
  const list = box?.find("stats") ?? box;
  if (!box || !list) return null;
  list.children = [list.children[0], ...bars.filter((b): b is Component => !!b)].filter(Boolean);
  for (const b of list.children.slice(1)) b.constraints = null;
  return box;
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
      this.pointer = { x, y };
      const target = this.overlays[this.overlays.length - 1] ?? this.root;
      if (!target) return;
      dispatch(target, { type, x, y, button: (e as PointerEvent).button ?? 0, delta: type === "wheel" ? Math.sign((e as WheelEvent).deltaY) : 0 });
      if (type === "wheel") e.preventDefault();
      // components with nothing to press in Clyde (spacers drawn as sockets) take clicks here
      if (type === "down") this.pressedAt = this.clickable(target, x, y);
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
    if (this.root && this.isOpen) { resetInput(this.root); await this.refresh(); }
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
    this.host.sound("sound/feedback/ui_dismiss.ogg");
    this.host.closed();
  }

  /** Escape: closes the topmost overlay, else the window. */
  escape() {
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
      void this.ctx.icon(cfg).then(im => {
        if (!im) return;
        const s = Math.min(size / im.width, size / im.height), w = Math.round(im.width * s), h = Math.round(im.height * s);
        const canvas = new OffscreenCanvas(w, h);
        const g = canvas.getContext("2d")!;
        g.imageSmoothingQuality = "high";
        g.drawImage(im.source, 0, 0, w, h);
        this.icons.set(key, { source: canvas, width: w, height: h });
      });
    }
    return this.icons.get(key) ?? null;
  }

  /** The tooltip for the hovered component (or an ancestor), built once per reference. */
  private hoveredTip(): Component | null {
    if (!this.pointer || !this.root || this.overlays.length) return null;
    const hit = hitTest(this.root, this.pointer.x, this.pointer.y);
    if (!hit) return null;
    let spec: TipSpec | null = null;
    for (const c of this.ancestors(this.root, hit) ?? []) spec = this.tips.get(c) ?? spec;
    if (!spec) return null;
    const key = JSON.stringify(spec, (k, v) => (k === "$outer" ? undefined : v));
    const t = this.tipCache.get(key);
    if (t === undefined) {
      if (this.tipCache.size > 200) this.tipCache.clear();
      const p = this.buildTip(spec).then(c => { this.tipCache.set(key, c); return c; });
      this.tipCache.set(key, p);
      return null;
    }
    return t instanceof Promise ? null : t;
  }

  /** Builds a tooltip: its placeholder stat pills give way to the spec's bonus lines. */
  private async buildTip(spec: TipSpec): Promise<Component | null> {
    const plain = spec.lines?.length ?? 0;
    const [c, stats, ...lines] = await Promise.all([buildUi(this.ctx, spec.ref), spec.stats ? buildStats(this.ctx, spec.stats) : null,
      ...(spec.lines ?? []).map(l => buildUi(this.ctx, uiRef(BONUS, { Description: l, "Toggle Icon": false }))),
      ...(spec.bonuses ?? []).map(b => buildUi(this.ctx, uiRef(BONUS, { Color: b.color ?? (b.bonus ? "Bonus" : "Penalty"), Description: b.text,
        "Bonus Icon": b.icon ?? null, "Toggle Icon": !!b.icon })))]);
    // our own lines (not the game's bonuses) leave out the bonus arrow
    lines.slice(0, plain).forEach(l => { const arrow = l?.children[0]?.children.at(-1); if (arrow && !arrow.tag) arrow.visible = false; });
    if (!c) return null;
    // the tooltips' 3D item previews are drawn by the game's item renderer; not here
    const view = c.find("renderview");
    if (view) view.visible = false;
    for (const [tag, text] of Object.entries(spec.texts ?? {})) { const t = c.find(tag); if (t) t.text = text; }
    const pills = c.find("tooltip_pills");
    if (pills) {
      pills.children = [stats, ...lines].filter((l): l is Component => !!l);
      for (const l of pills.children) l.constraints = null;
      pills.visible = pills.children.length > 0;
    }
    return c;
  }

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
      render(this.root, g, Math.round((cw - s.width) / 2), Math.round((ch + s.height) / 2), this.hooks);
    }
    for (const o of this.overlays) {
      g.fillStyle = "rgba(4,10,18,0.45)";
      g.fillRect(0, 0, cw, ch);
      const s = pack(o);
      render(o, g, Math.round((cw - s.width) / 2), Math.round((ch + s.height) / 2), this.hooks);
    }
    const tip = this.hoveredTip();
    if (tip && this.pointer) {
      const s = pack(tip);
      const x = Math.min(cw - s.width - 4, this.pointer.x + 18), y = Math.min(ch - 4, this.pointer.y + 18 + s.height);
      render(tip, g, Math.max(4, x), Math.max(s.height + 4, y), this.hooks);
    }
    requestAnimationFrame(this.frame);
  };

  /** The script runner for an interface (its scripts play while the window is open). */
  protected runner(ui: Component): ScriptRunner {
    let r = this.runners.get(ui);
    if (!r) { this.runners.set(ui, r = new ScriptRunner(ui)); r.onSound = f => this.host.sound(f); }
    return r;
  }

  /** Per-frame work before drawing (animations). */
  protected tick() {}
}
