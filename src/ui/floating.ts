// A window drawn from the game's interface configs that floats over the play view without
// covering it: the guild hall's furniture panel, knight creation. Unlike the modal GuiScreen
// windows it does not dim the game or take every click: its canvas lets the pointer through
// (pointer-events: none) and a press reaches the window only where the window is drawn;
// elsewhere the press goes on to the game canvas below (furniture placement clicks the hall's
// floor). The window sits under the modal windows (the arsenal can open over it) and over the
// game canvas and HUD.

import { buildComponentConfig, dispatch, hitTest, layout, pack, render, resetInput, type Component, type GuiContext, type GuiImage, type RenderHooks } from "./gui";
import { buildTooltip, buildUi, uiRef, type TipSpec } from "./screen";
import { CONFIG_REF } from "../config/params";

const COMPONENT = "com.threerings.opengl.gui.config.ComponentConfig$";

/** Elements under the floating windows: presses on these may be the window's. */
const UNDER = new Set(["canvas", "hudCanvas"]);

/** Whether a component is drawn (not an empty layout box): only these take presses from the game. */
const solid = (c: Component) => !!c.style?.background || !["container", "ui", "spacer"].includes(c.kind);

/** Where a floating window's root goes on the canvas: its top-left corner, or "fill" to size it to the canvas. */
export type Placement = { x: number; y: number } | "fill";

/** A game style button (Default/Button unless given) built from an inline config. */
export async function styledButton(ctx: GuiContext, text: string, fn: () => void, local: Map<string, any> = new Map(), style = "Default/Button"): Promise<Component> {
  const b = await buildComponentConfig(ctx, { $class: COMPONENT + "Button", text, style: { $class: CONFIG_REF, name: style } }, local);
  b.onAction = () => fn();
  return b;
}

/** A game style label built from an inline config. */
export function styledLabel(ctx: GuiContext, text: string, style: string, local: Map<string, any> = new Map()): Promise<Component> {
  return buildComponentConfig(ctx, { $class: COMPONENT + "Label", text, style: { $class: CONFIG_REF, name: style } }, local);
}

export abstract class FloatScreen {
  protected root: Component | null = null;
  protected readonly canvas: HTMLCanvasElement;
  /** Tooltips by component (as GuiScreen's). */
  protected tips = new Map<Component, TipSpec>();
  /** Click handlers for components Clyde's dispatch does not press (spacers, sockets). */
  protected clicks = new Map<Component, () => void>();
  protected hooks: RenderHooks = {};
  private shown = false;
  private building: Promise<Component | null> | null = null;
  protected pointer: { x: number; y: number } | null = null;
  /** A press began on the window: moves and the release are the window's too. */
  private capturing = false;
  private pressedAt: Component | null = null;
  private tipCache = new Map<string, Promise<Component | null> | Component | null>();
  private icons = new Map<string, GuiImage | null>();
  /** Shift was held at the last press (for shift-clicks). */
  protected shift = false;

  constructor(protected readonly ctx: GuiContext, id: string) {
    const c = this.canvas = document.createElement("canvas");
    c.id = id;
    c.className = "floating-canvas";
    c.hidden = true;
    c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;z-index:3;pointer-events:none";
    const anchor = document.getElementById("hudCanvas");
    if (anchor?.parentElement) anchor.parentElement.insertBefore(c, anchor.nextSibling);
    else document.body.append(c);
  }

  get isOpen() { return this.shown; }

  /** Builds the interface tree (once). */
  protected abstract build(): Promise<Component | null>;
  /** Puts the state into the tree. */
  protected abstract refresh(): void | Promise<void>;
  /** Where the root goes on a canvas of cw x ch pixels for a root of w x h. */
  protected abstract place(cw: number, ch: number, w: number, h: number): Placement;

  async show() {
    if (!this.shown) {
      this.shown = true;
      this.canvas.hidden = false;
      addEventListener("pointerdown", this.down, true);
      addEventListener("pointermove", this.move, true);
      addEventListener("pointerup", this.up, true);
      addEventListener("wheel", this.wheel, { capture: true, passive: false });
      addEventListener("contextmenu", this.menu, true);
      requestAnimationFrame(this.frame);
    }
    if (!this.root) {
      this.building ??= this.build();
      this.root = await this.building;
    }
    if (this.root && this.shown) await this.refresh();
  }

  hide() {
    if (!this.shown) return;
    this.shown = false;
    this.canvas.hidden = true;
    this.capturing = false;
    this.pointer = null;
    removeEventListener("pointerdown", this.down, true);
    removeEventListener("pointermove", this.move, true);
    removeEventListener("pointerup", this.up, true);
    removeEventListener("wheel", this.wheel, true);
    removeEventListener("contextmenu", this.menu, true);
    if (this.root) resetInput(this.root);
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

  // ------------------------------------------------------------ input

  private local(e: { clientX: number; clientY: number }) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Whether a point is on the window (or an open popup menu). */
  protected over(x: number, y: number): boolean {
    const r = this.root;
    if (!r) return false;
    return !!r.overlay || !!hitTest(r, x, y, solid);
  }

  /** Whether an event's target lies under this window (not a modal window above it). */
  private beneath(e: Event) {
    const t = e.target as Element | null;
    return !!t && (UNDER.has(t.id) || t === document.body || t === document.documentElement);
  }

  private down = (e: PointerEvent) => {
    const p = this.local(e);
    this.pointer = p;
    if (!this.root || !this.beneath(e) || !this.over(p.x, p.y)) return;
    e.stopPropagation();
    e.preventDefault();
    this.shift = e.shiftKey;
    this.capturing = true;
    dispatch(this.root, { type: "down", x: p.x, y: p.y, button: e.button });
    this.pressedAt = e.button === 0 ? this.clickable(p.x, p.y) : null;
  };

  private move = (e: PointerEvent) => {
    const p = this.local(e);
    this.pointer = p;
    if (!this.root) return;
    if (this.capturing) e.stopPropagation();
    // hovering only where the pointer is over the game (not over a modal window above)
    if (this.capturing || this.beneath(e)) dispatch(this.root, { type: "move", x: p.x, y: p.y });
  };

  private up = (e: PointerEvent) => {
    if (!this.capturing || !this.root) return;
    const p = this.local(e);
    this.capturing = false;
    e.stopPropagation();
    dispatch(this.root, { type: "up", x: p.x, y: p.y, button: e.button });
    const c = this.clickable(p.x, p.y);
    if (c && c === this.pressedAt && e.button === 0) this.clicks.get(c)?.();
    this.pressedAt = null;
  };

  private wheel = (e: WheelEvent) => {
    const p = this.local(e);
    if (!this.root || !this.beneath(e) || !this.over(p.x, p.y)) return;
    e.stopPropagation();
    e.preventDefault();
    dispatch(this.root, { type: "wheel", x: p.x, y: p.y, delta: Math.sign(e.deltaY) });
    this.wheeled(p.x, p.y, Math.sign(e.deltaY));
  };

  private menu = (e: Event) => {
    const p = this.local(e as MouseEvent);
    if (this.beneath(e) && this.over(p.x, p.y)) { e.preventDefault(); e.stopPropagation(); }
  };

  /** A wheel notch over the window (after Clyde's dispatch): for lists that page themselves. */
  protected wheeled(_x: number, _y: number, _delta: number) {}

  private clickable(x: number, y: number): Component | null {
    if (!this.clicks.size || !this.root) return null;
    const hit = hitTest(this.root, x, y);
    const path = hit ? this.ancestors(this.root, hit) ?? [] : [];
    for (let i = path.length - 1; i >= 0; i--) if (this.clicks.has(path[i])) return path[i];
    return null;
  }

  private ancestors(root: Component, c: Component): Component[] | null {
    if (root === c) return [root];
    for (const k of root.children) { const p = this.ancestors(k, c); if (p) return [root, ...p]; }
    return null;
  }

  // ------------------------------------------------------------ tooltips

  private hoveredTip(): Component | null {
    if (!this.pointer || !this.root || this.capturing) return null;
    const hit = hitTest(this.root, this.pointer.x, this.pointer.y);
    if (!hit) return null;
    let spec: TipSpec | null = null;
    for (const c of this.ancestors(this.root, hit) ?? []) spec = this.tips.get(c) ?? spec;
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

  // ------------------------------------------------------------ drawing

  /** Per-frame work before drawing. */
  protected tick() {}

  private frame = () => {
    if (!this.shown) return;
    const c = this.canvas, dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.scale(dpr, dpr);
    const cw = w / dpr, ch = h / dpr;
    this.tick();
    const root = this.root;
    if (root && cw > 0 && ch > 0) {
      const s = pack(root);
      const at = this.place(cw, ch, s.width, s.height);
      if (at === "fill") {
        root.x = 0; root.y = 0; root.width = cw; root.height = ch;
        layout(root);
        render(root, g, 0, ch, this.hooks);
      } else render(root, g, Math.round(at.x), Math.round(at.y + s.height), this.hooks);
      const tip = this.hoveredTip();
      if (tip && this.pointer) {
        const t = pack(tip);
        const x = Math.min(cw - t.width - 4, this.pointer.x + 18), y = Math.min(ch - 4, this.pointer.y + 18 + t.height);
        render(tip, g, Math.max(4, x), Math.max(t.height + 4, y), this.hooks);
      }
    }
    requestAnimationFrame(this.frame);
  };
}
