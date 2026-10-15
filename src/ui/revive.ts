// The knockout window: the game's own rsrc/ui/continue/interface_revive.dat. A knocked-out
// knight uses a Spark of Life to get up; with none left the window switches to its "Buy" mode
// (a spark for energy: the client's dungeonSparkOfLifeCost default, 50, src/game/energy.ts; a
// shortfall is bought with crowns at the exchange, as the client's Get Energy panel offered
// beside the button). The client's party HUD (dungeon/client/I.NY) also adds the game's
// leave-party panel (ui/continue/interface_leaveparty.dat) to its card list on the left, 150
// pixels down, the moment the knight is down (PartyObject.z: health 0), solo or in a party, with
// no delay; its red button gives up and rides back to Haven without the floor's loot.

import { CONFIG_REF } from "../config/params";
import { buildInterface, dispatch, pack, render, resetInput, type Component, type GuiContext, type RenderHooks } from "./gui";
import { hasMessage, message, text } from "../i18n";

/** The knight's home town (the client's OptionsDialog.n). */
const HOME = "Haven";

export interface ReviveActions {
  sparks(): number;
  /** Energy a spark costs here, and the energy the knight has. */
  price(): number;
  energy(): number;
  /** Whether the knight can pay, its crowns buying the shortfall at the exchange. */
  canBuy(): boolean;
  /** Uses a spark (returns false when there is none). */
  use(): boolean;
  /** Buys a spark with energy (returns false when the knight cannot afford it). */
  buy(): boolean;
  sound(file: string): void;
  /** Gives up: back to Haven, the floor's loot lost. */
  giveUp(): void;
}

export class ReviveScreen {
  private ui: Component | null = null;
  /** The give-up panel under the revive window. */
  private leave: Component | null = null;
  private mode: "Use" | "Buy" | null = null;
  private running = false;
  private building = false;

  constructor(private readonly ctx: GuiContext, private readonly canvas: HTMLCanvasElement, private readonly actions: ReviveActions,
    private readonly hooks: RenderHooks = {}) {
    const ev = (type: "down" | "up" | "move") => (e: PointerEvent) => {
      if (!this.ui) return;
      const r = this.canvas.getBoundingClientRect();
      const ev = { type, x: e.clientX - r.left, y: e.clientY - r.top, button: e.button };
      dispatch(this.ui, ev);
      if (this.leave) dispatch(this.leave, ev);
    };
    canvas.addEventListener("pointerdown", ev("down"));
    canvas.addEventListener("pointerup", ev("up"));
    canvas.addEventListener("pointermove", ev("move"));
  }

  get isOpen() { return !this.canvas.hidden; }

  /** When the window opened (the client holds the spark buttons off for 1.2 s, against a stray click). */
  private openedAt = 0;

  async open() {
    this.canvas.hidden = false;
    this.openedAt = performance.now();
    await this.refresh();
    if (!this.running) { this.running = true; requestAnimationFrame(this.frame); }
  }

  close() { this.canvas.hidden = true; this.running = false; }

  /** Rebuilds the window in the mode the knight's sparks call for. */
  private async refresh() {
    if (!this.leave) {
      const leave = await buildInterface(this.ctx, { $class: CONFIG_REF, name: "ui/continue/interface_leaveparty.dat" });
      if (leave && !this.leave) {
        const text = leave.find("town"), btn = leave.find("leaveparty");
        // the client's I.b: m.leaveparty_return and m.return_to_town with the home town's name
        if (text) text.text = hasMessage("dungeon", "m.leaveparty_return") ? message("dungeon", "m.leaveparty_return", HOME) : `Leave the party and return to ${HOME}.`;
        if (btn) { btn.text = hasMessage("dungeon", "m.return_to_town") ? message("dungeon", "m.return_to_town", HOME) : `Return to ${HOME}`; btn.onAction = () => { this.actions.sound("sound/feedback/ui_dismiss.ogg"); this.close(); this.actions.giveUp(); }; }
        resetInput(leave);
        this.leave = leave;
      }
    }
    const mode = this.actions.sparks() > 0 ? "Use" : "Buy";
    if (mode !== this.mode && !this.building) {
      this.building = true;
      try {
        const ui = await buildInterface(this.ctx, { $class: CONFIG_REF, name: "ui/continue/interface_revive.dat",
          arguments: { $map: "com.threerings.config.ArgumentMap", entries: [["Mode", mode]] } });
        if (ui) {
          const use = ui.find("use_spark"), buy = ui.find("buy_spark");
          if (use) use.onAction = () => { if (use.enabled && this.actions.use()) this.close(); };
          // the title's message key reads "Revivenow"; the spark's view model draws as a plain
          // quad here, so the frame shows without it
          const walk = (c: Component) => { if (c.kind === "label" && /^revive ?now$/i.test(c.text)) c.text = "Revive Now"; c.children.forEach(walk); };
          walk(ui);
          const view = ui.find("renderview");
          if (view) view.visible = false;
          if (buy) buy.onAction = () => { if (buy.enabled && this.actions.buy()) { this.actions.sound("sound/feedback/ui_merchant_trade_add.ogg"); void this.refresh(); } };
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
    const short = Math.max(0, this.actions.price() - this.actions.energy());
    set("description", this.mode === "Use" ? text("dungeon", "m.revive_desc", "Use a Spark of Life to regain full health and perform an ENERGY BLAST!")
      : `No sparks left. Buy one for ${this.actions.price()} energy (you have ${this.actions.energy()}${short ? "; the exchange trades crowns for the rest" : ""}).`);
    const ready = performance.now() - this.openedAt >= 1200;
    const use = ui.find("use_spark");
    if (use) use.enabled = ready && this.actions.sparks() > 0;
    const buy = ui.find("buy_spark");
    if (buy) buy.enabled = ready && this.actions.canBuy();
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
    // the client adds the revive panel to the HUD at its bottom centre (no dimming) and the
    // leave-party panel to the party list on the left, 150 pixels down
    if (this.ui) {
      this.bind();
      const s = pack(this.ui);
      render(this.ui, g, Math.round((cw - s.width) / 2), ch, this.hooks);
      if (this.leave) {
        const l = pack(this.leave);
        render(this.leave, g, 0, 150 + l.height, this.hooks);
      }
    }
    requestAnimationFrame(this.frame);
  };
}
