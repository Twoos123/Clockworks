// The knockout window: the game's own rsrc/ui/continue/interface_revive.dat. A knocked-out
// knight uses a Spark of Life to get up; with none left the window switches to its "Buy" mode
// (the game sold sparks for energy, a server currency; here they cost crowns).

import { CONFIG_REF } from "../config/params";
import { buildInterface, dispatch, pack, render, resetInput, type Component, type GuiContext, type RenderHooks } from "./gui";

export interface ReviveActions {
  sparks(): number;
  /** Crowns a spark costs here, and the crowns the knight has. */
  price(): number;
  crowns(): number;
  /** Uses a spark (returns false when there is none). */
  use(): boolean;
  /** Buys a spark with crowns (returns false when the knight cannot afford it). */
  buy(): boolean;
  sound(file: string): void;
}

export class ReviveScreen {
  private ui: Component | null = null;
  private mode: "Use" | "Buy" | null = null;
  private running = false;
  private building = false;

  constructor(private readonly ctx: GuiContext, private readonly canvas: HTMLCanvasElement, private readonly actions: ReviveActions,
    private readonly hooks: RenderHooks = {}) {
    const ev = (type: "down" | "up" | "move") => (e: PointerEvent) => {
      if (!this.ui) return;
      const r = this.canvas.getBoundingClientRect();
      dispatch(this.ui, { type, x: e.clientX - r.left, y: e.clientY - r.top, button: e.button });
    };
    canvas.addEventListener("pointerdown", ev("down"));
    canvas.addEventListener("pointerup", ev("up"));
    canvas.addEventListener("pointermove", ev("move"));
  }

  get isOpen() { return !this.canvas.hidden; }

  async open() {
    this.canvas.hidden = false;
    await this.refresh();
    if (!this.running) { this.running = true; requestAnimationFrame(this.frame); }
  }

  close() { this.canvas.hidden = true; this.running = false; }

  /** Rebuilds the window in the mode the knight's sparks call for. */
  private async refresh() {
    const mode = this.actions.sparks() > 0 ? "Use" : "Buy";
    if (mode !== this.mode && !this.building) {
      this.building = true;
      try {
        const ui = await buildInterface(this.ctx, { $class: CONFIG_REF, name: "ui/continue/interface_revive.dat",
          arguments: { $map: "com.threerings.config.ArgumentMap", entries: [["Mode", mode]] } });
        if (ui) {
          const use = ui.find("use_spark"), buy = ui.find("buy_spark");
          if (use) use.onAction = () => { if (this.actions.use()) this.close(); };
          // the title's message key reads "Revivenow"; the spark's view model draws as a plain
          // quad here, so the frame shows without it
          const walk = (c: Component) => { if (c.kind === "label" && /^revive ?now$/i.test(c.text)) c.text = "Revive Now"; c.children.forEach(walk); };
          walk(ui);
          const view = ui.find("renderview");
          if (view) view.visible = false;
          if (buy) buy.onAction = () => { if (this.actions.buy()) { this.actions.sound("sound/feedback/ui_merchant_trade_add.ogg"); void this.refresh(); } };
          resetInput(ui);
          this.ui = ui;
          this.mode = mode;
        }
      } finally { this.building = false; }
    }
    this.bind();
  }

  private bind() {
    const ui = this.ui;
    if (!ui) return;
    const set = (tag: string, text: string) => { const c = ui.find(tag); if (c) c.text = text; };
    set("spark_count", String(this.actions.sparks()));
    set("spark_cost", String(this.actions.price()));
    set("description", this.mode === "Use" ? "Use a Spark of Life to get back up." : `No sparks left. Buy one for ${this.actions.price()} crowns (you have ${this.actions.crowns()}).`);
    const buy = ui.find("buy_spark");
    if (buy) buy.enabled = this.actions.crowns() >= this.actions.price();
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
    g.fillStyle = "rgba(40,0,0,0.35)";
    g.fillRect(0, 0, cw, ch);
    if (this.ui) {
      this.bind();
      const s = pack(this.ui);
      render(this.ui, g, Math.round((cw - s.width) / 2), Math.round((ch + s.height) / 2), this.hooks);
    }
    requestAnimationFrame(this.frame);
  };
}
