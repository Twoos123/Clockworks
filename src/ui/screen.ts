// A full-screen window drawn from the game's own user interface configs on its own canvas
// over the game, as the options window does: the interface is laid out, centred and drawn
// each frame, pointer input goes to Clyde-style dispatch, hovering a component can show a
// tooltip interface, and a modal overlay (a confirmation, the forging animation) can sit on
// top. Subclasses build the tree and bind it to the save data.

import { CONFIG_REF } from "../config/params";
import { ScriptRunner } from "./script";
import { buildInterface, Component, dispatch, hitTest, pack, render, resetInput, type GuiContext, type GuiImage, type RenderHooks } from "./gui";

const BONUS = "ui/window/tooltip_parts/bonus.dat";

export interface ScreenHost {
  /** Plays a UI feedback sound. */
  sound(file: string): void;
  /** Called when the window closes (the game resumes). */
  closed(): void;
  /** Draws a RenderableView (the knight preview), when the game can. */
  view?(c: Component, g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void;
}

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
export interface TipSpec { ref: any; lines?: string[] }

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
    this.canvas.hidden = false;
    this.host.sound("sound/feedback/ui_open.ogg");
    if (!this.running) { this.running = true; requestAnimationFrame(this.frame); }
    if (!this.root) {
      this.building ??= this.build();
      this.root = await this.building;
    }
    if (this.root && this.isOpen) { resetInput(this.root); await this.refresh(); }
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
    const [c, ...lines] = await Promise.all([buildUi(this.ctx, spec.ref),
      ...(spec.lines ?? []).map(l => buildUi(this.ctx, uiRef(BONUS, { Description: l, "Toggle Icon": false })))]);
    if (!c) return null;
    // the tooltips' 3D item previews are drawn by the game's item renderer; not here
    const view = c.find("renderview");
    if (view) view.visible = false;
    const pills = c.find("tooltip_pills");
    if (pills) {
      pills.children = lines.filter((l): l is Component => !!l);
      for (const l of pills.children) { l.constraints = null; const arrow = l.children[0]?.children.at(-1); if (arrow && !arrow.tag) arrow.visible = false; }
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
