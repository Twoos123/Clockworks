// The elevator screen between floors: the game's rsrc/ui/elevator/nextlevel interfaces, the
// "Level Complete" stripe (interface_stripe.dat) and the next-level window
// (interface_mainwindow.dat: next level's name and theme, its depth, the knight in the dash
// pose, Advance and Quit buttons), with their appear scripts' slides and fades.
//
// main.ts shows it with a choice once the knight's elevator ride ends: Advance (on down, up to
// Haven past the last floor, or "Fight On" at an arena checkpoint) and, where the run can be
// left, Quit (back to Haven with the loot banked).

import { CONFIG_REF } from "../config/params";
import { buildInterface, pack, type Component, type GuiContext, type RenderHooks } from "./gui";
import { OverlayScreen } from "./overlay";

export interface NextLevel { title: string; zone: string; depth: string }

/** What the screen offers when a floor is done. */
export interface ElevatorChoice {
  /** The stripe's title ("Depth 3 cleared"). */
  title: string;
  /** The next floor's labels, or null when there is none. */
  next: NextLevel | null;
  /** A short tally of the floor (crowns and heat). */
  tally: string;
  /** The Advance button: its caption and what it does. */
  advance: { label: string; run(): void };
  /** The Quit button (Return to Haven), when the run can be left here. */
  quit?: { run(): void } | null;
}

type ViewHook = NonNullable<RenderHooks["view"]>;

const quadOut = (t: number) => 1 - (1 - t) * (1 - t);
const quadIn = (t: number) => t * t;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

export class ElevatorScreen extends OverlayScreen {
  private stripe: Component | null = null;
  private main: Component | null = null;
  private building: Promise<void> | null = null;
  private choice: ElevatorChoice | null = null;
  private view: ViewHook | null = null;
  /** Called when the screen comes up (the floor-clear stinger). */
  onShow: (() => void) | null = null;

  constructor(private readonly ctx: GuiContext, parent: HTMLElement,
    /** A drawer for the knight's view in the window (null for none). */
    private readonly makeView: () => ViewHook | null = () => null) {
    super(parent, 6, "elevator-canvas");
    this.fadeTime = 0.2;
    void this.build();
  }

  /** The choice on screen (null when hidden). */
  get current(): ElevatorChoice | null { return this.choice; }

  /** Shows the screen with a choice. */
  async show(c: ElevatorChoice) {
    this.choice = c;
    await this.build();
    if (this.choice !== c || !this.stripe || !this.main) return;
    this.fill(c);
    this.view = this.makeView();
    this.open();
    this.onShow?.();
  }

  /** Fades the screen out. */
  hide() {
    this.choice = null;
    this.close();
  }

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

  /** The choice's texts into the interfaces. */
  private fill(ch: ElevatorChoice) {
    const set = (ui: Component, tag: string, text: string, visible = true) => {
      const c = ui.find(tag);
      if (c) { c.text = text; c.visible = visible; }
    };
    const m = this.main!, s = this.stripe!, n = ch.next;
    set(s, "labelTitle", ch.title || "Level Complete!");
    set(m, "labelNextUp", n ? "Next up:" : "");
    set(m, "labelLevelType", n?.title ?? "");
    set(m, "labelLevelSubtype", n?.zone ?? "");
    set(m, "labelDepth", n?.depth ?? "", !!n?.depth);
    set(m, "labelAutoAdvance", ch.tally);
    set(m, "buttonAdvance", ch.advance.label);
    set(m, "buttonQuit", "Return to Haven", !!ch.quit);
    set(m, "labelQuit", ch.quit ? "Bank your loot and ride the elevator up to Haven." : "", !!ch.quit);
    set(m, "labelWaiting", "", false);
    const quit = m.find("containerQuit");
    if (quit) quit.visible = !!ch.quit;
    for (const t of ["player2Model", "player3Model", "player4Model"]) { const c = m.find(t); if (c) c.visible = false; }
    for (const t of ["buttonAdvance", "buttonQuit"]) { const c = m.find(t); if (c) c.enabled = true; }
  }

  protected clicked(c: Component) {
    const ch = this.choice;
    if (!ch) return;
    if (c.tag === "buttonAdvance") { this.hide(); ch.advance.run(); }
    else if (c.tag === "buttonQuit" && ch.quit) { this.hide(); ch.quit.run(); }
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
