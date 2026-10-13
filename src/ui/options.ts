// The options window: the game's own rsrc/ui/options/interface.dat (General, Video, Game,
// Controls... tabs) drawn full screen over the game, its controls bound to our settings. The
// parts the game drives from its servers or its desktop window (language, region, screen mode,
// chat, Steam, bug reports) are hidden; the advanced pages open our detailed settings menu.

import { CONFIG_REF } from "../config/params";
import { buildInterface, dispatch, pack, render, resetInput, type Component, type GuiContext } from "./gui";
import type { Settings } from "./settings";

export interface OptionsActions {
  changed(): void;
  /** Our detailed settings menu (key bindings, graphics, save data). */
  advanced(tab: "graphics" | "controls" | "interface" | "save"): void;
  returnToHaven(): void;
  quit(): void;
  closed(): void;
  playing(): boolean;
  sound(file: string): void;
}

/** Tags whose parts have nothing behind them in this port. */
const HIDDEN = ["party_with_any", "region_label", "region", "bugreport", "resetprefs", "screen_mode", "disp_cancel", "disp_apply",
  "full_inspect", "npc_names", "ld_hud_arrows", "discord", "edit_beta_game"];

export class OptionsScreen {
  private ui: Component | null = null;
  private running = false;

  constructor(private readonly ctx: GuiContext, private readonly canvas: HTMLCanvasElement, private readonly settings: Settings,
    private readonly actions: OptionsActions) {
    const ev = (type: "down" | "up" | "move" | "wheel") => (e: PointerEvent | WheelEvent) => {
      if (!this.ui) return;
      const r = this.canvas.getBoundingClientRect();
      dispatch(this.ui, { type, x: e.clientX - r.left, y: e.clientY - r.top, button: (e as PointerEvent).button ?? 0,
        delta: type === "wheel" ? Math.sign((e as WheelEvent).deltaY) : 0 });
      if (type === "wheel") e.preventDefault();
    };
    canvas.addEventListener("pointerdown", ev("down"));
    canvas.addEventListener("pointerup", ev("up"));
    canvas.addEventListener("pointermove", ev("move"));
    canvas.addEventListener("wheel", ev("wheel"), { passive: false });
  }

  get isOpen() { return !this.canvas.hidden; }

  async open() {
    this.canvas.hidden = false;
    this.actions.sound("sound/feedback/ui_open.ogg");
    if (!this.ui) this.ui = await this.build();
    if (this.ui) { this.load(this.ui); resetInput(this.ui); }
    const ret = this.ui?.find("return"), quit = this.ui?.find("quit"), logoff = this.ui?.find("logoff");
    if (ret) ret.visible = this.actions.playing();
    if (quit) quit.visible = this.actions.playing();
    if (logoff) logoff.visible = false;
    if (!this.running) { this.running = true; requestAnimationFrame(this.frame); }
  }

  close() {
    if (!this.isOpen) return;
    this.canvas.hidden = true;
    this.running = false;
    this.actions.sound("sound/feedback/ui_dismiss.ogg");
    this.actions.closed();
  }

  private async build(): Promise<Component | null> {
    const ui = await buildInterface(this.ctx, { $class: CONFIG_REF, name: "ui/options/interface.dat" });
    if (!ui) return null;
    const hide = new Set(HIDDEN);
    // in a table of label + control pairs, a hidden control takes its label with it so the
    // rows stay paired
    const walk = (c: Component) => {
      c.children.forEach((k, i) => {
        if (!hide.has(k.tag)) return;
        k.visible = false;
        const prev = c.children[i - 1];
        if (c.layout?.$class?.endsWith("Table") && prev?.kind === "label" && !prev.tag?.startsWith("ui_")) prev.visible = false;
      });
      c.children.forEach(walk);
    };
    walk(ui);
    for (const t of ui.find("pane")?.tabs ?? []) walk(t);
    // tabs with nothing behind them in single player
    this.hideTabs(ui, ["Chat", "Prompts", "Steam"]);
    const s = this.settings, act = this.actions;
    const on = (tag: string, fn: (c: Component, action: string) => void) => { const c = ui.find(tag); if (c) c.onAction = fn; };
    const slider = (tag: string, key: "musicVolume" | "effectsVolume" | "uiVolume") =>
      on(tag, c => { s[key] = this.fraction(c); act.changed(); });
    slider("music_volume", "musicVolume");
    slider("effect_volume", "effectsVolume");
    slider("interface_volume", "uiVolume");
    on("render_quality", c => { s.renderScale = 0.5 + this.fraction(c); this.setQualityLabel(ui); act.changed(); });
    on("camera_shake", c => { s.screenFlash = !!c.value; act.changed(); });
    const scales: [string, number][] = [["scale100", 1], ["scale150", 1.25], ["scale200", 1.5], ["scale250", 1.5], ["scalemax", 1.5]];
    for (const [tag, v] of scales) on(tag, () => { s.hudScale = v; this.setScaleLabel(ui); act.changed(); });
    on("ui_scale", c => { s.hudScale = 0.75 + 0.75 * this.fraction(c); this.setScaleLabel(ui); act.changed(); });
    const check = (tag: string, key: "damageNumbers" | "healthBars" | "autoAim" | "screenFlash" | "controlsHint") =>
      on(tag, c => { s[key] = !!c.value; act.sound("sound/feedback/ui_confirm.ogg"); act.changed(); });
    check("show_damage", "damageNumbers");
    check("monster_health", "healthBars");
    check("auto_target", "autoAim");
    check("show_damage_effects", "screenFlash");
    check("weapon_switcher", "controlsHint");
    on("edit_advanced", () => act.advanced("graphics"));
    on("edit_advanced_game", () => act.advanced("interface"));
    on("custom", () => act.advanced("controls"));
    on("keyboard_mouse", () => act.sound("sound/feedback/ui_confirm.ogg"));
    on("keyboard_only", () => act.sound("sound/feedback/ui_confirm.ogg"));
    on("dismiss", () => this.close());
    on("return", () => { this.close(); act.returnToHaven(); });
    on("quit", () => { this.close(); act.quit(); });
    return ui;
  }

  /** Puts the current settings into the controls. */
  private load(ui: Component) {
    const s = this.settings;
    const set = (tag: string, v: number | boolean) => { const c = ui.find(tag); if (c) c.value = v; };
    const toSlider = (tag: string, f: number) => {
      const c = ui.find(tag);
      if (c?.model) c.value = c.model.min + f * (c.model.max - c.model.extent - c.model.min);
    };
    toSlider("music_volume", s.musicVolume);
    toSlider("effect_volume", s.effectsVolume);
    toSlider("interface_volume", s.uiVolume);
    toSlider("render_quality", Math.max(0, Math.min(1, s.renderScale - 0.5)));
    toSlider("ui_scale", Math.max(0, Math.min(1, (s.hudScale - 0.75) / 0.75)));
    set("camera_shake", s.screenFlash);
    set("show_damage", s.damageNumbers);
    set("monster_health", s.healthBars);
    set("auto_target", s.autoAim);
    set("show_damage_effects", s.screenFlash);
    set("weapon_switcher", s.controlsHint);
    set("keyboard_mouse", true);
    this.setQualityLabel(ui);
    this.setScaleLabel(ui);
  }

  private fraction(c: Component) {
    const m = c.model;
    if (!m) return 0;
    const span = m.max - m.extent - m.min;
    return span > 0 ? Math.max(0, Math.min(1, (Number(c.value) - m.min) / span)) : 0;
  }

  private setQualityLabel(ui: Component) {
    const l = ui.find("render_quality_label"), r = this.settings.renderScale;
    if (l) l.text = r < 0.75 ? "Low" : r < 1 ? "Medium" : r < 1.25 ? "High" : "Very High";
  }

  private setScaleLabel(ui: Component) {
    const l = ui.find("ui_scale_label");
    if (l) l.text = `${Math.round(this.settings.hudScale * 100)}%`;
  }

  private hideTabs(ui: Component, titles: string[]) {
    const pane = ui.find("pane");
    if (!pane) return;
    const walk = (c: Component) => { if (c.kind === "button" && titles.includes(c.text)) c.visible = false; c.children.forEach(walk); };
    walk(pane);
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
    g.fillStyle = "rgba(4,10,18,0.6)";
    g.fillRect(0, 0, cw, ch);
    if (this.ui) {
      const s = pack(this.ui);
      render(this.ui, g, Math.round((cw - s.width) / 2), Math.round((ch + s.height) / 2), {});
    }
    requestAnimationFrame(this.frame);
  };
}
