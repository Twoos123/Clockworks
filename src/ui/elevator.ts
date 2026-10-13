// The elevator screen between floors: the game's rsrc/ui/elevator/nextlevel interfaces, the
// "Level Complete" stripe (interface_stripe.dat) and the next-level window
// (interface_mainwindow.dat: next level's name and theme, its depth, the knight in the dash
// pose, Advance and Quit buttons), with their appear scripts' slides and fades.
//
// It fronts the page's #floorDone dialog rather than replacing it: whenever main.ts shows that
// dialog the screen appears with the dialog's texts, and its two buttons click the dialog's
// buttons, so every flow (descend, return to Haven, the arena's checkpoint) keeps its logic.

import { CONFIG_REF } from "../config/params";
import { buildInterface, pack, type Component, type GuiContext, type RenderHooks } from "./gui";
import { OverlayScreen } from "./overlay";

export interface NextLevel { title: string; zone: string; depth: string }

type ViewHook = NonNullable<RenderHooks["view"]>;

const quadOut = (t: number) => 1 - (1 - t) * (1 - t);
const quadIn = (t: number) => t * t;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

export class ElevatorScreen extends OverlayScreen {
  private stripe: Component | null = null;
  private main: Component | null = null;
  private building: Promise<void> | null = null;
  private next: NextLevel | null = null;
  private view: ViewHook | null = null;
  /** The dialog buttons the screen's Advance and Quit stand for. */
  private advanceBtn: HTMLButtonElement | null = null;
  private quitBtn: HTMLButtonElement | null = null;
  /** Called when the screen comes up (the floor-clear stinger). */
  onShow: (() => void) | null = null;

  constructor(private readonly ctx: GuiContext, parent: HTMLElement, private readonly dialog: HTMLElement,
    /** A drawer for the knight's view in the window (null for none). */
    private readonly makeView: () => ViewHook | null = () => null) {
    super(parent, 6, "elevator-canvas");
    this.fadeTime = 0.2;
    new MutationObserver(() => this.sync()).observe(dialog, { attributes: true, attributeFilter: ["hidden"] });
    void this.build();
  }

  /** What the next floor is, for the window's labels (set before the dialog shows). */
  setNext(n: NextLevel | null) { this.next = n; }

  private build() {
    this.building ??= (async () => {
      const [stripe, main] = await Promise.all([
        buildInterface(this.ctx, { $class: CONFIG_REF, name: "ui/elevator/nextlevel/interface_stripe.dat" }),
        buildInterface(this.ctx, { $class: CONFIG_REF, name: "ui/elevator/nextlevel/interface_mainwindow.dat" }),
      ]);
      this.stripe = stripe;
      this.main = main;
    })().catch(() => { this.stripe = this.main = null; });
    return this.building;
  }

  private async sync() {
    if (this.dialog.hidden) {
      this.dialog.classList.remove("gui-elevator");
      this.close();
      return;
    }
    await this.build();
    if (!this.stripe || !this.main || this.dialog.hidden) return;
    this.fill();
    this.dialog.classList.add("gui-elevator");
    this.view = this.makeView();
    this.open();
    this.onShow?.();
  }

  /** The dialog's texts into the interfaces. */
  private fill() {
    const d = this.dialog, q = (id: string) => d.querySelector<HTMLElement>("#" + id);
    const buttons = [q("descend"), q("deeper")].filter((b): b is HTMLButtonElement => !!b && !b.hidden) as HTMLButtonElement[];
    // the button that leaves for Haven is Quit; the other goes on (in the arena that is "Fight on")
    const home = buttons.find(b => /haven/i.test(b.textContent ?? "") && buttons.length > 1) ?? null;
    this.advanceBtn = buttons.find(b => b !== home) ?? null;
    this.quitBtn = home;
    const set = (ui: Component, tag: string, text: string, visible = true) => {
      const c = ui.find(tag);
      if (c) { c.text = text; c.visible = visible; }
    };
    const m = this.main!, s = this.stripe!;
    set(s, "labelTitle", q("floorTitle")?.textContent || "Level Complete!");
    const n = this.next;
    const adv = this.advanceBtn?.textContent ?? "";
    set(m, "labelNextUp", n ? "Next up:" : "");
    set(m, "labelLevelType", n?.title ?? adv);
    set(m, "labelLevelSubtype", n?.zone ?? "");
    set(m, "labelDepth", n?.depth ?? "", !!n?.depth);
    // the floor's tally, kept short for the countdown's slot
    const info = q("floorInfo")?.textContent ?? "";
    const tally = /(\d+) monsters defeated, (\d+) crowns, (\d+) heat/.exec(info);
    set(m, "labelAutoAdvance", tally ? `${tally[2]} crowns, ${tally[3]} heat` : info.length > 40 ? "" : info);
    const toHaven = /haven/i.test(adv);
    set(m, "buttonAdvance", toHaven ? "Ride Up" : /fight/i.test(adv) ? "Fight On" : "Advance");
    set(m, "buttonQuit", "Return to Haven", !!this.quitBtn);
    set(m, "labelQuit", this.quitBtn ? "Bank your loot and ride the elevator up to Haven." : "", !!this.quitBtn);
    set(m, "labelWaiting", "", false);
    const quit = m.find("containerQuit");
    if (quit) quit.visible = !!this.quitBtn;
    for (const t of ["player2Model", "player3Model", "player4Model"]) { const c = m.find(t); if (c) c.visible = false; }
    for (const t of ["buttonAdvance", "buttonQuit"]) { const c = m.find(t); if (c) c.enabled = true; }
  }

  protected clicked(c: Component) {
    if (c.tag === "buttonAdvance") this.advanceBtn?.click();
    else if (c.tag === "buttonQuit") this.quitBtn?.click();
  }

  protected hooks(): RenderHooks {
    const v = this.view;
    return v ? { view: (c, g, x, y, w, h) => { if (c.tag === "player1Model") v(c, g, x, y, w, h); } } : {};
  }

  /** The appear scripts: the stripe slides in thin and opens, the title follows, the window slides in. */
  protected update() {
    const t = this.time;
    const stripe = this.stripe?.find("containerStripe");
    if (stripe) {
      const slide = clamp01(t / 0.4), open = quadIn(clamp01((t - 0.4) / 0.4));
      stripe.offset = { tx: -4000 * (1 - slide), ty: 0, rotation: 0, scale: 0.1 + 0.9 * open };
    }
    const title = this.stripe?.find("labelTitle");
    if (title) {
      const k = quadOut(clamp01((t - 0.6) / 0.4));
      title.offset = { tx: -2200 + 2100 * k + Math.max(0, t - 1) * 8, ty: 0, rotation: 0, scale: 1 };
    }
    const main = this.main?.find("containerMain");
    if (main) main.offset = { tx: -4000 * (1 - quadOut(clamp01((t - 0.5) / 0.2))), ty: 0, rotation: 0, scale: 1 };
    const fades: [string, number][] = [["labelNextUp", 0.9], ["labelLevelType", 1.1], ["labelLevelSubtype", 1.3], ["labelDepth", 1.4], ["labelAutoAdvance", 1.5], ["containerQuit", 1.2]];
    for (const [tag, at] of fades) {
      const c = this.main?.find(tag);
      if (c) c.setAlpha(clamp01((t - at) / 0.3));
    }
  }

  protected background(g: CanvasRenderingContext2D, w: number, h: number) {
    g.fillStyle = `rgba(4, 10, 18, ${0.55 * clamp01(this.time / 0.3)})`;
    g.fillRect(0, 0, w, h);
  }

  protected layers(w: number, h: number) {
    if (!this.stripe || !this.main) return [];
    const ss = pack(this.stripe), ms = pack(this.main);
    const cx = Math.round(w / 2), cy = Math.round(h / 2);
    return [
      // the stripe across the screen's middle, the window over it (offset right of centre, as the game sits it)
      { ui: this.stripe, x: cx - Math.round(ss.width / 2), y: cy + Math.round(ss.height / 2) },
      { ui: this.main, x: cx - Math.round(ms.width / 2), y: cy + Math.round(ms.height / 2) },
    ];
  }
}
