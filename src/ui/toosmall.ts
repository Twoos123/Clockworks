// The window-too-small warning (client hud/n, from ProjectXApp.updateFrame): after a resize that
// leaves the window under 1024 x 600, ui/hud_v2/interface_toosmall.dat (MinWidth 1024,
// MinHeight 600, Fade 20) shows the 1024 x 600 area the game is laid out for, from the lower
// left corner, with the projectx bundle's m.display_small, its backing fading out over 20
// seconds; it goes after 20 seconds or when the window is large enough again. It takes no clicks.

import { CONFIG_REF } from "../config/params";
import { buildInterface, pack, render, type Component, type GuiContext } from "./gui";
import { ScriptRunner } from "./script";

const MIN_W = 1024, MIN_H = 600, SHOW = 20;

/** Whether a window of w x h is under the size the client asks for. */
export const tooSmall = (w: number, h: number) => w < MIN_W || h < MIN_H;

export class TooSmallWarning {
  private canvas: HTMLCanvasElement | null = null;
  private ui: Component | null = null;
  private runner: ScriptRunner | null = null;
  private until = 0;
  private last = 0;
  private running = false;
  private small = false;

  constructor(private readonly ctx: GuiContext) {
    addEventListener("resize", () => this.check());
    this.check();
  }

  /** ProjectXApp.updateFrame: a change across the limit adds or removes the warning. */
  private check() {
    const small = tooSmall(innerWidth, innerHeight);
    if (small === this.small) return;
    this.small = small;
    if (small) void this.show(); else this.until = 0;
  }

  private async show() {
    const ui = await buildInterface(this.ctx, { $class: CONFIG_REF, name: "ui/hud_v2/interface_toosmall.dat",
      arguments: { $map: "com.threerings.config.ArgumentMap", entries: [["MinWidth", MIN_W], ["MinHeight", MIN_H], ["Fade", SHOW]] } }).catch(() => null);
    if (!ui || !this.small) return;
    this.ui = ui;
    this.runner = new ScriptRunner(ui);
    if (ui.addAction) this.runner.execute(ui.addAction);
    this.until = performance.now() + SHOW * 1000;
    if (!this.canvas) {
      const c = this.canvas = document.createElement("canvas");
      c.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:70";
      document.body.append(c);
    }
    this.canvas.hidden = false;
    this.last = performance.now();
    if (!this.running) { this.running = true; requestAnimationFrame(this.frame); }
  }

  private frame = () => {
    const c = this.canvas!, now = performance.now();
    if (!this.ui || now > this.until) { c.hidden = true; this.running = false; return; }
    this.runner?.tick(Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.scale(dpr, dpr);
    pack(this.ui);
    // anchored to the lower-left corner
    render(this.ui, g, 0, h / dpr, {});
    requestAnimationFrame(this.frame);
  };
}
