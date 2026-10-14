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
import { buildInterface, layout, pack, type Component, type GuiContext, type GuiImage, type RenderHooks } from "./gui";
import { reelPosition, SPIN_TIME } from "../game/prizewheel";
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

/** One slot of the prize wheel's reel: its item's name, icon (an IconConfig) and whether it shines. */
export interface ReelSlot { name: string; icon: any; shine: boolean }

/**
 * The prize wheel (client dungeon/client/c over casino/a/a): the reel, its first slot the
 * prize it lands on; `landed` gives the prize (called once, when the reel stops, or when the
 * screen goes before it has).
 */
export interface PrizeWheel { reel: ReelSlot[]; golden?: boolean; landed(): void }

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
  /** The prize wheel, after a floor with monsters. */
  prize?: PrizeWheel | null;
}

// The client's end-of-level states: TITLE 1 s, HEAT_TITLE 1 s, HEAT_COUNT 3 s, then the choice.
const HEAT_TITLE_AT = 1, HEAT_COUNT_AT = 2, HEAT_COUNT_TIME = 3;
/** Sliding panels move in a straight line over 0.2 s (client ui/SlidingPanel). */
const SLIDE = 0.2;
/**
 * After the choice the centre card and stripe go (their scripts, then END a second later), and
 * the prize wheel and heat panel stay over the next view a moment (the recording: over the
 * elevator ride and into the black before the next floor loads).
 */
const LINGER = 1.6;
/** The reel's view: the slot model 1.96 from the camera (interface_bonus.dat's renderview) at a 60 degree view shows this many units. */
const REEL_VIEW_UNITS = 2 * 1.96 * Math.tan(Math.PI / 6);

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
  /** Seconds the choice window waits for the heat report (TITLE, 1 s, without one). */
  private delay = 0;
  /** The prize wheel on screen: its window, reel icons, slot skin, and whether it has landed. */
  private wheel: { ui: Component; prize: PrizeWheel; icons: (GuiImage | null)[]; skin: GuiImage | null; landed: boolean; sounded: boolean } | null = null;
  /** The interfaces' own texts (the advance and quit buttons', "Advancing to:"), kept as built. */
  private defaults = new Map<string, string>();
  /** When the run went on (the choice's END): the wheel and heat panel linger, then the screen goes. */
  private lingerAt: number | null = null;
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
    this.settleWheel();
    this.choice = c;
    this.chosen = null;
    this.lingerAt = null;
    this.canvas.style.zIndex = "6";
    await this.build();
    if (this.choice !== c || !this.stripe || !this.main) return;
    await Promise.all([this.buildHeat(c.heat ?? null), this.buildWheel(c.prize ?? null)]);
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
    this.lingerAt = null;
    this.settleWheel();
    this.close();
  }

  /** The wheel's prize given if it has not been yet (the screen went before the reel stopped). */
  private settleWheel() {
    const w = this.wheel;
    if (w && !w.landed) { w.landed = true; w.prize.landed(); }
  }

  /** The prize wheel's window (interface_bonus.dat, Standard or Golden) and its reel's icons. */
  private async buildWheel(p: PrizeWheel | null) {
    this.wheel = null;
    if (!p || !p.reel.length) return;
    const variant = p.golden ? "Golden" : "Standard";
    const [ui, skin, ...icons] = await Promise.all([
      buildInterface(this.ctx, { $class: CONFIG_REF, name: "ui/report/parts/bonus/interface_bonus.dat",
        arguments: { $map: "com.threerings.config.ArgumentMap", entries: [["Variant", variant]] } }).catch(() => null),
      this.ctx.image(p.golden ? "ui/report/parts/bonus/skin_bonusslot_gold.png" : "ui/report/parts/bonus/skin_bonusslot.png"),
      ...p.reel.map(s => this.ctx.icon(s.icon).catch(() => null)),
    ]);
    if (!ui) { p.landed(); return; }
    this.wheel = { ui, prize: p, icons, skin, landed: false, sounded: false };
  }

  /**
   * The reel (casino/a/a): slots 2 units apart sliding down past the window on the client's
   * ease, drawn flat from the slot model's skin (ui/report/parts/bonus/skin_bonusslot.png: the
   * teal housing, the chamber with its white rails, the gold name ribbon) with each prize's icon
   * in its chamber and its name on the ribbon (component_itemname.dat's style); the prize
   * shines once it has landed and opened.
   */
  private drawReel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    const wh = this.wheel;
    if (!wh || w <= 0 || h <= 0) return;
    const n = wh.prize.reel.length, t = this.time;
    const pos = reelPosition(t, n);
    const ppu = h / REEL_VIEW_UNITS, slotH = 2 * ppu, cx = x + w / 2, cy = y + h / 2;
    const skin = wh.skin;
    const part = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) => {
      if (skin) g.drawImage(skin.source, sx * skin.width / 256, sy * skin.height / 256, sw * skin.width / 256, sh * skin.height / 256, dx, dy, dw, dh);
    };
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.fillStyle = "rgb(16,24,30)";
    g.fillRect(x, y, w, h);
    const speed = t < SPIN_TIME ? Math.abs(reelPosition(t + 0.02, n) - pos) / 0.02 : 0;
    for (let k = Math.floor(pos) - 1; k <= Math.ceil(pos) + 1; k++) {
      if (k < 0 || k >= n) continue;
      const slot = wh.prize.reel[n - 1 - k], icon = wh.icons[n - 1 - k];
      const sy = cy - (k - pos) * slotH - slotH / 2;
      // the housing, then the chamber with its rails, then the ribbon across its top
      part(0, 0, 128, 128, x, sy, w, slotH);
      const chW = w * 0.86, chH = slotH * 0.78, chX = cx - chW / 2, chY = sy + slotH * 0.12;
      part(0, 128, 128, 128, chX, chY, chW, chH);
      const landed = k === n - 1 && t >= SPIN_TIME;
      if (icon) {
        const size = Math.min(chW, chH) * 0.55, ix = cx - size / 2, iy = chY + chH * 0.58 - size / 2;
        if (landed && slot.shine) {
          const glow = g.createRadialGradient(cx, iy + size / 2, size * 0.1, cx, iy + size / 2, size * 0.9);
          const pulse = 0.75 + 0.25 * Math.sin((t - SPIN_TIME) * 4);
          glow.addColorStop(0, `rgba(255,255,255,${0.9 * pulse})`);
          glow.addColorStop(0.5, `rgba(200,240,255,${0.35 * pulse})`);
          glow.addColorStop(1, "rgba(200,240,255,0)");
          g.fillStyle = glow;
          g.fillRect(cx - size, iy - size / 2, size * 2, size * 2);
        }
        // a blur along the reel while it runs fast
        const smear = Math.min(slotH * 0.25, speed * slotH * 0.015);
        if (smear > 1) {
          g.globalAlpha = 0.35;
          g.drawImage(icon.source, ix, iy - smear, size, size);
          g.drawImage(icon.source, ix, iy + smear, size, size);
          g.globalAlpha = 1;
        }
        g.drawImage(icon.source, ix, iy, size, size);
      }
      const rbH = slotH * 0.16, rbY = chY + slotH * 0.02;
      part(128, 130, 108, 36, x + w * 0.04, rbY, w * 0.92, rbH);
      g.font = `${Math.max(9, Math.round(rbH * 0.42))}px "Arial Black", "Arial", sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineJoin = "round";
      g.lineWidth = 3;
      g.strokeStyle = "rgb(158,122,49)";
      g.strokeText(slot.name, cx, rbY + rbH / 2, w * 0.8);
      g.fillStyle = "rgb(40,49,56)";
      g.fillText(slot.name, cx, rbY + rbH / 2, w * 0.8);
    }
    // the window's depth: shade toward the top and bottom edges
    const shade = g.createLinearGradient(0, y, 0, y + h);
    shade.addColorStop(0, "rgba(0,0,0,0.55)");
    shade.addColorStop(0.18, "rgba(0,0,0,0)");
    shade.addColorStop(0.82, "rgba(0,0,0,0)");
    shade.addColorStop(1, "rgba(0,0,0,0.55)");
    g.fillStyle = shade;
    g.fillRect(x, y, w, h);
    g.restore();
  }

  /** The wheel's sounds and its landing: the spin's start, then the prize (casino/a/a, dungeon/client/d). */
  private updateWheel(t: number) {
    const w = this.wheel;
    if (!w) return;
    if (!w.sounded) { w.sounded = true; this.onSound?.("sound/feedback/prizewheel_spin_open.ogg"); }
    if (!w.landed && t >= SPIN_TIME) {
      w.landed = true;
      this.onSound?.("sound/feedback/prizewheel_prize.ogg");
      w.prize.landed();
    }
  }

  private build() {
    this.building ??= (async () => {
      const [stripe, main] = await Promise.all([
        buildInterface(this.ctx, { $class: CONFIG_REF, name: "ui/elevator/nextlevel/interface_stripe.dat" }),
        buildInterface(this.ctx, { $class: CONFIG_REF, name: "ui/elevator/nextlevel/interface_mainwindow.dat" }),
      ]);
      this.stripe = stripe;
      this.main = main;
      for (const tag of ["labelNextUp", "buttonAdvance", "buttonQuit", "labelTitle"]) {
        const c = main?.find(tag) ?? stripe?.find(tag);
        if (c) this.defaults.set(tag, c.text);
      }
    })().catch(() => { this.stripe = this.main = null; });
    return this.building;
  }

  /** The heat report's panels for a floor (none when no item took heat). */
  private async buildHeat(r: HeatReport | null) {
    this.heatTitle = this.heatList = this.heatTotal = null;
    this.heatRows = [];
    this.heatSounded = false;
    // without heat the choice follows the TITLE state (1 s; the window slides in from 0.5 in)
    this.delay = 0.5;
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
    const own = (tag: string, fallback: string) => this.defaults.get(tag) || fallback;
    set(s, "labelTitle", ch.title || say("m.levelcomplete", "", own("labelTitle", "Level Complete!")));
    set(m, "labelNextUp", n ? own("labelNextUp", "Advancing to:") : "");
    set(m, "labelLevelType", n?.title ?? "");
    set(m, "labelLevelSubtype", n?.zone ?? "");
    set(m, "labelDepth", n?.depth ?? "", !!n?.depth);
    // the client counts down to the automatic advance here; the floor's tally (ours) takes the
    // window's spare "waiting" line
    set(m, "labelAutoAdvance", this.countdownText(AUTO_ADVANCE));
    // ADVANCE NOW and QUIT EXPEDITION as the interface has them; other choices (Ride Up, Fight
    // On) put their own words on the button
    set(m, "buttonAdvance", ch.advance.label === "Advance" ? own("buttonAdvance", "ADVANCE\nNOW") : ch.advance.label);
    set(m, "buttonQuit", own("buttonQuit", "QUIT EXPEDITION"), !!ch.quit);
    set(m, "labelQuit", ch.quit ? say("m.leaveparty_return", "Haven", "Leave the party and return to Haven.") : "", !!ch.quit);
    // the party's "Waiting on all players" line: never in single player
    set(m, "labelWaiting", "", false);
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
    return { view: (c, g, x, y, w, h) => {
      if (c.tag === "player1Model") v?.(c, g, x, y, w, h);
      else if (c.tag === "renderview") this.drawReel(g, x, y, w, h);
    } };
  }

  /** The appear scripts: the stripe slides in thin and opens, the title follows, the window slides in. */
  protected update() {
    const t = this.time;
    const dt = Math.max(0, Math.min(0.1, t - this.lastTick));
    this.lastTick = t;
    this.updateHeat(t, dt);
    this.updateWheel(t);
    const ch = this.choice;
    // the run has gone on: the wheel and heat panel stay a moment over what comes next
    if (this.lingerAt !== null) {
      if (t - this.lingerAt >= LINGER) { this.lingerAt = null; this.close(); }
      return;
    }
    // after the choice: its scripts play, and a second later (END, once the wheel has stopped:
    // EndOfLevelWindow.Pa) the run goes on
    if (this.chosen) {
      const c = this.chosen;
      c.main.tick(dt);
      c.stripe.tick(dt);
      if (ch && t - c.at >= 1 && (!this.wheel || this.wheel.landed)) {
        this.chosen = null;
        this.choice = null;
        this.lingerAt = t;
        // over the loading screen while it lingers, as the client's windows sit over the next view
        this.canvas.style.zIndex = "8";
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
    // the view darkens under the stripe and card, and clears again once the choice is made
    const gone = this.lingerAt !== null ? 1 : this.chosen ? clamp01((this.time - this.chosen.at) / 0.6) : 0;
    g.fillStyle = `rgba(4, 10, 18, ${0.55 * clamp01(this.time / 0.3) * (1 - gone)})`;
    g.fillRect(0, 0, w, h);
  }

  protected layers(w: number, h: number) {
    if (!this.stripe || !this.main) return [];
    const ss = pack(this.stripe), ms = pack(this.main);
    const cx = Math.round(w / 2), cy = Math.round(h / 2);
    const out: { ui: Component; x: number; y: number }[] = [];
    // the prize wheel's window: anchored at the screen's left edge (a tenth of its width in),
    // centred down the screen; it comes up with the screen and stays to the end
    const wheel = this.wheel?.ui;
    if (wheel) {
      wheel.x = 0; wheel.y = 0; wheel.width = Math.round(w); wheel.height = Math.round(h);
      layout(wheel);
      out.push({ ui: wheel, x: 0, y: Math.round(h) });
    }
    // the stripe across the screen's middle, the window over it; both gone once the run goes on
    if (this.lingerAt === null) {
      out.push({ ui: this.stripe, x: cx - Math.round(ss.width / 2), y: cy + Math.round(ss.height / 2) },
        { ui: this.main, x: cx - Math.round(ms.width / 2), y: cy + Math.round(ms.height / 2) });
    }
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
