// The title screen: the game's own logon interface (rsrc/ui/logon/interface.dat) with its
// logo and buttons, drawn over the Haven scene. There is no account to log on to, so the
// credentials and terms-of-service parts are hidden and the log-on button starts the game.

import { CONFIG_REF } from "../config/params";
import { buildInterface, hitTest, pack, render, type Component, type GuiContext } from "./gui";

export interface TitleActions { play(): void; options(): void; viewer?: () => void }

export class TitleScreen {
  private ui: Component | null = null;
  private running = false;
  private hovered: Component | null = null;

  constructor(private readonly ctx: GuiContext, private readonly canvas: HTMLCanvasElement, private readonly actions: TitleActions) {
    canvas.addEventListener("pointermove", e => this.pointer(e, false));
    canvas.addEventListener("pointerdown", e => { if (e.button === 0) this.pointer(e, true); });
  }

  get visible() { return !this.canvas.hidden; }

  async show() {
    this.canvas.hidden = false;
    if (!this.ui) {
      const ui = await buildInterface(this.ctx, { $class: CONFIG_REF, name: "ui/logon/interface.dat" });
      if (ui) {
        // find() returns the first match only; hide every component with these tags
        const hide = new Set(["creds_cont", "steam_cont", "tos_cont", "status", "devtools", "TOS", "support", "forgot_password", "game_website"]);
        const walk = (c: Component) => { if (hide.has(c.tag)) c.visible = false; c.children.forEach(walk); };
        walk(ui);
        const set = (tag: string, text: string | null) => {
          const b = ui.find(tag);
          if (!b) return;
          if (text === null) b.visible = false; else b.text = text;
        };
        set("logon", "Play");
        set("options", "Options");
        set("quit", this.actions.viewer ? "Asset Viewer" : null);
        this.ui = ui;
      }
    }
    if (!this.running) { this.running = true; requestAnimationFrame(this.frame); }
  }

  hide() { this.canvas.hidden = true; this.running = false; }

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
    // a soft vignette over the town behind
    const grad = g.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.2, cw / 2, ch / 2, Math.max(cw, ch) * 0.7);
    grad.addColorStop(0, "rgba(4,10,18,0.25)");
    grad.addColorStop(1, "rgba(4,10,18,0.85)");
    g.fillStyle = grad;
    g.fillRect(0, 0, cw, ch);
    if (this.ui) {
      const s = pack(this.ui);
      render(this.ui, g, Math.round((cw - s.width) / 2), Math.round((ch + s.height) / 2), {});
    }
    requestAnimationFrame(this.frame);
  };

  private pointer(e: PointerEvent, click: boolean) {
    if (!this.ui) return;
    const r = this.canvas.getBoundingClientRect();
    const hit = hitTest(this.ui, e.clientX - r.left, e.clientY - r.top, c => c.kind === "button");
    if (this.hovered !== hit) {
      if (this.hovered) this.hovered.hover = false;
      if (hit) hit.hover = true;
      this.hovered = hit;
      this.canvas.style.cursor = hit ? "pointer" : "";
    }
    if (!click || !hit) return;
    if (hit.tag === "logon") this.actions.play();
    else if (hit.tag === "options") this.actions.options();
    else if (hit.tag === "quit") this.actions.viewer?.();
  }
}
