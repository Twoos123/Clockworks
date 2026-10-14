// The elevator screen between floors: the game's rsrc/ui/elevator/nextlevel interfaces, the
// "Level Complete" stripe (interface_stripe.dat) and the next-level window
// (interface_mainwindow.dat: next level's name and theme, its depth, the knight in the dash
// pose, Advance and Quit buttons), with their appear scripts' slides and fades.
//
// main.ts shows it with a choice once the knight's elevator ride ends: Advance (on down, up to
// Haven past the last floor, or "Fight On" at an arena checkpoint) and, where the run can be
// left, Quit (back to Haven with the loot banked).

import { CONFIG_REF } from "../config/params";
import { hasMessage, message } from "../i18n";
import { buildInterface, pack, type Component, type GuiContext, type RenderHooks } from "./gui";
import { OverlayScreen } from "./overlay";
import { ScriptRunner } from "./script";

export interface NextLevel { title: string; zone: string; depth: string }

/** Seconds the next-level window waits before advancing on its own (the client's elevator window). */
const AUTO_ADVANCE = 10;
/** When the window has slid in (its appear script), the countdown starts. */
const WINDOW_IN = 0.7;

/** The dungeon bundle's text with an argument, or the fallback without the bundle. */
const say = (key: string, arg: string, fallback: string) => hasMessage("dungeon", key) ? message("dungeon", key, arg) : fallback;

/** One heated item's row in the heat report. */
export interface HeatRow {
  name: string;
  /** The item's icon image and colorizations (its IconConfig). */
  icon: string;
  colorizations: unknown[];
  level: number;
  /** Progress toward the next level before the floor's heat, and after it (1 when it levels up). */
  before: number;
  after: number;
  levelUp: boolean;
}

/** The end-of-floor heat report (client EndOfLevelWindow): the floor's heat shared between the items. */
export interface HeatReport { total: number; rows: HeatRow[] }

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
  /** The floor's heat report, when the floor gave heat to items that can take it. */
  heat?: HeatReport | null;
  /**
   * A safe level's elevator (a lobby, a terminal: LevelType.isSafe): the stripe shows without
   * its "Level Complete" title (EndOfLevelWindow.a).
   */
  safe?: boolean;
}

// The client's end-of-level states: TITLE 1 s, HEAT_TITLE 1 s, HEAT_COUNT 3 s, then the choice.
const HEAT_TITLE_AT = 1, HEAT_COUNT_AT = 2, HEAT_COUNT_TIME = 3;
/** Sliding panels move in a straight line over 0.2 s (client ui/SlidingPanel). */
const SLIDE = 0.2;

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
  /** Plays a sound effect (the heat count's heat_score.ogg). */
  onSound: ((file: string) => void) | null = null;
  /** The heat report's title and list (ui/report/parts), and its rows while they count. */
  private heatTitle: Component | null = null;
  private heatList: Component | null = null;
  private heatRows: { ui: Component; row: HeatRow; done: boolean; runner: ScriptRunner }[] = [];
  private heatTotal: Component | null = null;
  private heatSounded = false;
  /** Seconds the choice window waits for the heat report (0 without one). */
  private delay = 0;
  private lastTick = 0;

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
    this.chosen = null;
    await this.build();
    if (this.choice !== c || !this.stripe || !this.main) return;
    await this.buildHeat(c.heat ?? null);
    if (this.choice !== c) return;
    this.lastTick = 0;
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

  /** The heat report's panels for a floor (none when no item took heat). */
  private async buildHeat(r: HeatReport | null) {
    this.heatTitle = this.heatList = this.heatTotal = null;
    this.heatRows = [];
    this.heatSounded = false;
    this.delay = 0;
    if (!r || !r.rows.length) return;
    const ref = (name: string, args: [string, unknown][] = []) =>
      ({ $class: CONFIG_REF, name, arguments: { $map: "com.threerings.config.ArgumentMap", entries: args } });
    const [title, list, total, ...rows] = await Promise.all([
      buildInterface(this.ctx, ref("ui/report/parts/title_heat.dat")),
      buildInterface(this.ctx, ref("ui/report/parts/heat_list.dat")),
      buildInterface(this.ctx, ref("ui/report/parts/itemheat_total.dat")),
      ...r.rows.map(row => buildInterface(this.ctx, ref("ui/report/parts/itemheat.dat", [
        ["Name", row.name.toUpperCase()], ["Level", String(row.level).padStart(2, "0")],
        ["Heat", 16 + Math.round(104 * row.before)], ["Heat Gained", 16 + Math.round(104 * row.before)],
        ["Icon", row.icon], ["Colorization", row.colorizations], ["Max Level", row.before >= 1 && !row.levelUp]]))),
    ]);
    if (!title || !list) return;
    const listBox = list.find("list"), totalBox = list.find("total");
    if (listBox) listBox.children = [];
    if (totalBox) totalBox.children = total ? [total] : [];
    r.rows.forEach((row, i) => {
      const ui = rows[i];
      if (!ui || !listBox) return;
      for (const tag of ["fxWarmup", "fxExplode", "complete"]) { const c = ui.find(tag); if (c) c.visible = false; }
      listBox.children.push(ui);
      this.heatRows.push({ ui, row, done: false, runner: new ScriptRunner(ui) });
    });
    // the total's flame view has nothing to draw here; its backing stays
    const view = total?.find("heat_view");
    if (view) view.visible = false;
    this.heatTitle = title;
    this.heatList = list;
    this.heatTotal = total;
    this.delay = HEAT_COUNT_AT + HEAT_COUNT_TIME - 0.5;
  }

  /** The heat count: bars fill, the total drains, levels pop (client dungeon/client y and z). */
  private updateHeat(t: number, dt: number) {
    if (!this.heatList) return;
    const p = clamp01((t - HEAT_COUNT_AT) / HEAT_COUNT_TIME);
    if (p > 0 && !this.heatSounded) { this.heatSounded = true; this.onSound?.("sound/feedback/heat_score.ogg"); }
    const bar = this.heatTotal?.find("tooltip_heat");
    if (bar?.preferredSize) bar.preferredSize.width = Math.round(108 * (1 - p)) + 12;
    for (const h of this.heatRows) {
      h.runner.tick(dt);
      if (h.done) continue;
      const k = Math.min(1, h.row.before + (h.row.after - h.row.before) * p);
      const gained = h.ui.find("tooltip_heatgained");
      if (gained?.preferredSize) gained.preferredSize.width = 16 + Math.round(104 * k);
      if (h.row.levelUp && k >= 1) {
        // a level gained: the next level's number, "Complete", and the row's level-up script
        h.done = true;
        const lvl = h.ui.find("tooltip_level");
        if (lvl) lvl.text = String(h.row.level + 1).padStart(2, "0");
        const done = h.ui.find("complete"), label = h.ui.find("heat");
        if (done) done.visible = true;
        if (label) label.visible = false;
        try { h.runner.runScript({ $class: CONFIG_REF, name: "levelUpStyles" }); } catch { /* no such script */ }
      }
    }
  }

  /** The choice's texts into the interfaces. */
  private fill(ch: ElevatorChoice) {
    const set = (ui: Component, tag: string, text: string, visible = true) => {
      const c = ui.find(tag);
      if (c) { c.text = text; c.visible = visible; }
    };
    const m = this.main!, s = this.stripe!, n = ch.next;
    set(s, "labelTitle", ch.title || "Level Complete!", !ch.safe);
    set(m, "labelNextUp", n ? (hasMessage("dungeon", "m.nextup") ? message("dungeon", "m.nextup") : "Advancing to:") : "");
    set(m, "labelLevelType", n?.title ?? "");
    set(m, "labelLevelSubtype", n?.zone ?? "");
    set(m, "labelDepth", n?.depth ?? "", !!n?.depth);
    // the client counts down to the automatic advance here; the floor's tally (ours) takes the
    // window's spare "waiting" line
    set(m, "labelAutoAdvance", this.countdownText(AUTO_ADVANCE));
    // the window's own ADVANCE NOW and QUIT EXPEDITION (b.advance_newline, b.quit_expedition)
    const own = (key: string, fallback: string) => hasMessage("dungeon", key) ? message("dungeon", key) : fallback;
    set(m, "buttonAdvance", ch.advance.label === "Advance" ? own("b.advance_newline", "ADVANCE\nNOW") : ch.advance.label);
    set(m, "buttonQuit", own("b.quit_expedition", "QUIT EXPEDITION"), !!ch.quit);
    set(m, "labelQuit", ch.quit ? say("m.leaveparty_return", "Haven", "Bank your loot and ride the elevator up to Haven.") : "", !!ch.quit);
    set(m, "labelWaiting", ch.tally, !!ch.tally);
    this.shown = -1;
    const quit = m.find("containerQuit");
    if (quit) quit.visible = !!ch.quit;
    for (const t of ["player2Model", "player3Model", "player4Model"]) { const c = m.find(t); if (c) c.visible = false; }
    for (const t of ["buttonAdvance", "buttonQuit"]) { const c = m.find(t); if (c) c.enabled = true; }
  }

  /** The countdown's last whole second on screen. */
  private shown = -1;

  private countdownText(seconds: number) {
    return say("m.countdown", String(seconds).padStart(2, "0"), `Advancing in ${seconds} seconds...`);
  }

  protected clicked(c: Component) {
    const ch = this.choice;
    if (!ch || this.chosen) return;
    if (c.tag === "buttonAdvance") this.choose(true);
    else if (c.tag === "buttonQuit" && ch.quit) this.choose(false);
  }

  /**
   * The choice made (EndOfLevelWindow.bX, then its BOTTOM state): the countdown goes, the
   * window runs Clicked-Advance with HideQuit-Solo, or Clicked-Quit; the stripe runs FadeOut;
   * a second later (END) the run goes on.
   */
  private chosen: { advance: boolean; at: number; main: ScriptRunner; stripe: ScriptRunner } | null = null;

  private choose(advance: boolean) {
    const ch = this.choice;
    if (!ch || !this.main || !this.stripe || this.chosen) return;
    const ref = (name: string) => ({ $class: CONFIG_REF, name });
    const main = new ScriptRunner(this.main), stripe = new ScriptRunner(this.stripe);
    const timer = this.main.find("labelAutoAdvance");
    if (timer) timer.setAlpha(0);
    for (const t of ["buttonAdvance", "buttonQuit"]) { const b = this.main.find(t); if (b) b.enabled = false; }
    if (advance) { main.runScript(ref("Clicked-Advance")); main.runScript(ref("HideQuit-Solo")); }
    else main.runScript(ref("Clicked-Quit"));
    stripe.runScript(ref("FadeOut"));
    this.chosen = { advance, at: this.time, main, stripe };
  }

  protected hooks(): RenderHooks {
    const v = this.view;
    return v ? { view: (c, g, x, y, w, h) => { if (c.tag === "player1Model") v(c, g, x, y, w, h); } } : {};
  }

  /** The appear scripts: the stripe slides in thin and opens, the title follows, the window slides in. */
  protected update() {
    const t = this.time;
    const dt = Math.max(0, Math.min(0.1, t - this.lastTick));
    this.lastTick = t;
    this.updateHeat(t, dt);
    const ch = this.choice;
    // after the choice: its scripts play, and a second later the run goes on
    if (this.chosen) {
      const c = this.chosen;
      c.main.tick(dt);
      c.stripe.tick(dt);
      if (ch && t - c.at >= 1) {
        this.chosen = null;
        this.hide();
        if (c.advance) ch.advance.run(); else ch.quit?.run();
      }
      return;
    }
    // the countdown, and the advance when it runs out
    if (ch && this.main) {
      const left = AUTO_ADVANCE - Math.max(0, t - this.delay - WINDOW_IN);
      if (left <= 0) { this.choose(true); return; }
      const whole = Math.round(left);
      if (whole !== this.shown) {
        this.shown = whole;
        const label = this.main.find("labelAutoAdvance");
        if (label) label.text = this.countdownText(whole);
      }
    }
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
    const tm = t - this.delay;
    if (main) main.offset = { tx: -4000 * (1 - quadOut(clamp01((tm - 0.5) / 0.2))), ty: 0, rotation: 0, scale: 1 };
    const fades: [string, number][] = [["labelNextUp", 0.9], ["labelLevelType", 1.1], ["labelLevelSubtype", 1.3], ["labelDepth", 1.4], ["labelAutoAdvance", 1.5], ["containerQuit", 1.2]];
    for (const [tag, at] of fades) {
      const c = this.main?.find(tag);
      if (c) c.setAlpha(clamp01((tm - at) / 0.3));
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
    const out = [
      // the stripe across the screen's middle, the window over it (offset right of centre, as the game sits it)
      { ui: this.stripe, x: cx - Math.round(ss.width / 2), y: cy + Math.round(ss.height / 2) },
      { ui: this.main, x: cx - Math.round(ms.width / 2), y: cy + Math.round(ms.height / 2) },
    ];
    // the heat report slides in from the right edge: its title near the top, the list below it
    const slideX = (at: number, width: number) => w - Math.round(width * clamp01((this.time - at) / SLIDE));
    if (this.heatTitle && this.time >= HEAT_TITLE_AT) {
      const ts = pack(this.heatTitle);
      out.push({ ui: this.heatTitle, x: slideX(HEAT_TITLE_AT, ts.width), y: 63 });
    }
    if (this.heatList && this.time >= HEAT_COUNT_AT) {
      const ls = pack(this.heatList);
      const height = Math.min(ls.height, h - 80);
      out.push({ ui: this.heatList, x: slideX(HEAT_COUNT_AT, ls.width), y: 80 + height });
    }
    return out;
  }
}
