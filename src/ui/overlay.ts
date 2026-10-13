// A full-screen canvas over the game view that draws Clyde interfaces (gui.ts) every frame,
// fades in and out, and reports button clicks: the base of the loading and elevator screens.

import { hitTest, render, type Component, type RenderHooks } from "./gui";

export abstract class OverlayScreen {
  readonly canvas: HTMLCanvasElement;
  private running = false;
  private hovered: Component | null = null;
  private lastLayers: { ui: Component; x: number; y: number }[] = [];
  /** Opacity, eased toward `target`. */
  protected alpha = 0;
  protected target = 0;
  protected fadeTime = 0.25;
  private last = performance.now();
  /** Seconds since shown. */
  protected time = 0;
  private opened = performance.now();

  constructor(parent: HTMLElement, zIndex: number, className: string) {
    const c = document.createElement("canvas");
    c.className = "title-canvas " + className;
    c.style.zIndex = String(zIndex);
    c.hidden = true;
    parent.append(c);
    this.canvas = c;
    c.addEventListener("pointermove", e => this.pointer(e, false));
    c.addEventListener("pointerdown", e => { if (e.button === 0) this.pointer(e, true); });
  }

  get visible() { return !this.canvas.hidden && this.target > 0; }

  protected open() {
    if (this.canvas.hidden) { this.alpha = 0; this.time = 0; this.opened = performance.now(); }
    this.canvas.hidden = false;
    this.target = 1;
    if (!this.running) { this.running = true; this.last = performance.now(); requestAnimationFrame(this.frame); }
  }

  /** Fades out, then hides. */
  protected close(immediate = false) {
    this.target = 0;
    if (immediate) { this.alpha = 0; this.canvas.hidden = true; this.running = false; }
  }

  /** The interfaces to draw, back to front, laid out for a (width, height) screen in CSS pixels. */
  protected abstract layers(width: number, height: number): { ui: Component; x: number; y: number }[];
  protected hooks(): RenderHooks { return {}; }
  protected update(_dt: number) { /* animations */ }
  protected background(_g: CanvasRenderingContext2D, _w: number, _h: number) { /* behind the interfaces */ }
  protected clicked(_c: Component) { /* a button was clicked */ }

  private frame = () => {
    if (!this.running) return;
    const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    // wall-clock time, so the scripted slides finish on time even when frames are slow
    this.time = (now - this.opened) / 1000;
    const step = dt / Math.max(0.01, this.fadeTime);
    this.alpha = this.target > this.alpha ? Math.min(this.target, this.alpha + step) : Math.max(this.target, this.alpha - step);
    if (this.alpha <= 0 && this.target === 0) { this.canvas.hidden = true; this.running = false; return; }
    this.update(dt);
    const c = this.canvas, dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.globalAlpha = 1;
    c.style.opacity = String(this.alpha);
    g.scale(dpr, dpr);
    const cw = w / dpr, ch = h / dpr;
    this.background(g, cw, ch);
    this.lastLayers = this.layers(cw, ch);
    for (const l of this.lastLayers) render(l.ui, g, l.x, l.y, this.hooks());
    requestAnimationFrame(this.frame);
  };

  private pointer(e: PointerEvent, click: boolean) {
    if (!this.visible) return;
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let hit: Component | null = null;
    for (const l of [...this.lastLayers].reverse()) {
      hit = hitTest(l.ui, x, y, c => c.kind === "button" && c.enabled);
      if (hit) break;
    }
    if (this.hovered !== hit) {
      if (this.hovered) this.hovered.hover = false;
      if (hit) hit.hover = true;
      this.hovered = hit;
      this.canvas.style.cursor = hit ? "pointer" : "";
    }
    if (click && hit) this.clicked(hit);
  }
}
