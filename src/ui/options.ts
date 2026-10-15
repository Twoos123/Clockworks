// The options window (Esc): the game's own rsrc/ui/options/interface.dat as OptionsDialog fills
// it, drawn over the whole screen: its root's Options Backing (the vertical stripes) fills the
// screen and the logo, the tabs (General, Video, Game, Chat, Controls, Prompts, Partner, About)
// and the bottom bar (Quit, Logoff, Return to Haven, OK) sit in the middle. Every control the
// client shows is shown; those bound to something here change it (volumes, quality, camera
// shake, UI scale, the display mode, the Game page's damage, health, damage effect and auto
// target boxes, the control scheme and custom keys), and those with nothing behind them in
// single player (region, party with any, the chat page, the confirmation prompts, Discord, full
// inspect, NPC names...) keep the player's choice without effect (Settings.prefs). Report a
// Bug is disabled. The Partner page's Steam box (hidden without Steam, as the client hides it)
// holds the browser's save instead. The Advanced buttons open the advanced video and game
// windows (ui/options/advanced_*.dat), with rows for this port's own settings; Custom (Click to
// Change) opens the custom controls page (key bindings, src/ui/keybinds.ts).

import type { LootLevel } from "../game/lootlog";
import { CONFIG_REF } from "../config/params";
import { LEGACY_KEY, loadSave, normalizeSave, reloadRoster, ROSTER_KEY, writeSave, type SaveData } from "../game/save";
import { checklist } from "../game/levels";
import { message, messages, text } from "../i18n";
import { buildComponentConfig, buildInterface, Component, dispatch, pack, render, resetInput, restyle, selectTab, setComboItems, type GuiContext, type GuiImage } from "./gui";
import { findParent, KeyBindings } from "./keybinds";
import { buildUi, modalShade, uiRef } from "./screen";
import { defaultSettings, UI_MIN_SCALE, uiMaxScale, uiScale, uiScaleLimit, type Settings, type Tab } from "./settings";

export interface OptionsActions {
  changed(): void;
  returnToHaven(): void;
  quit(): void;
  /** Logoff: back to choosing a knight. */
  logoff(): void;
  closed(): void;
  playing(): boolean;
  /** The home town's name while the knight is away from it (Return to Haven shows), else null. */
  awayFrom?(): string | null;
  sound(file: string): void;
  /** The save was replaced (imported or reset). */
  saveReplaced?(d: SaveData): void;
  /** Cheat: own every equippable item and add crowns; false when no game is running. */
  unlockAll?(): Promise<boolean>;
  /** Display names of the cached scenes (for the levels checklist). */
  sceneNames(): string[];
}

/** Parts the client shows only to its developers (edit_beta_game, resetprefs) or removes (aim_effect). */
const HIDDEN = ["resetprefs", "edit_beta_game", "aim_effect", "aim_effect_label"];
/** The same in the advanced video and game windows: parts with nothing behind them in this port. */
const HIDDEN_ADVANCED = ["vsync_enabled", "compatibility_mode", "cull_transients", "antialiasing", "fps_box",
  "auto_advance", "ping_gfx", "hide_ui", "lovegroup"];

/** OptionsDialog.Tab: the pages in order. */
const PAGES = ["general", "video", "game", "chat", "controls", "prompts", "partner", "about"] as const;

type Flag = "muted" | "fog" | "shadows" | "decals" | "particles" | "showFps" | "minimap" | "controlsHint";
type Range = "masterVolume" | "cameraSpeed" | "zoom" | "deadZone";
/** Slider ranges, and how the value label reads. */
const RANGES: Record<Range, { min: number; max: number; fmt: (v: number) => string }> = {
  masterVolume: { min: 0, max: 1, fmt: v => `${Math.round(v * 100)}%` },
  cameraSpeed: { min: 0.5, max: 4, fmt: v => v.toFixed(1) },
  zoom: { min: 0.7, max: 1.6, fmt: v => `${Math.round(v * 100)}%` },
  deadZone: { min: 0.05, max: 0.5, fmt: v => `${Math.round(v * 100)}%` },
};

/**
 * Check boxes kept in Settings.prefs, by tag, and their defaults (ProjectXPrefs'). The weapon
 * switcher and the charge meter boxes are read by the HUDs (main.ts applyOptions); the rest
 * have nothing behind them here.
 */
const PREF_BOXES: Record<string, boolean> = {
  party_with_any: false, full_inspect: true, npc_names: true, weapon_switcher: true, charge_bar: true, ld_hud_arrows: true,
  rank_mode: true, discord: false,
};

/**
 * The combo boxes with nothing behind them, by tag: their items (a bundle key and our text when
 * the bundles lack it) and the default. Region: m.from_ip, then the deployment's regions.
 */
const PREF_COMBOS: Record<string, { items: [string, string][]; dflt: number }> = {
  region: { items: [["m.from_ip", "From IP"], ["", "USA"], ["", "Europe"], ["", "South America"], ["", "Asia Pacific"]], dflt: 1 },
  // ProjectXPrefs.ChatSize, ChatFont, CurseFilter.Mode (less VERNACULAR), KnightLabel, LootReportLevel
  chat_size: { items: [["m.chat_size_default", "Default"], ["m.chat_size_large", "Large"], ["m.chat_size_xl", "Extra Large"]], dflt: 0 },
  chat_font: { items: [["m.font_small", "Small"], ["m.font_medium", "Medium"], ["m.font_large", "Large"], ["m.font_xlarge", "Extra Large"], ["m.font_huge", "Huge"]], dflt: 0 },
  filter_mode: { items: [["m.unfiltered", "None"], ["m.comic", "Comicify"], ["m.drop", "Drop"]], dflt: 1 },
  label_mode: { items: [["m.always", "Always"], ["m.speaking", "Speaking Distance"], ["m.hover", "Hover"]], dflt: 1 },
  loot_filter: { items: [["o.lf_all", "All"], ["o.lf_pro", "Filtered"], ["o.lf_none", "None"]], dflt: 0 },
};

/**
 * ProjectXPrefs.ConfirmPrompt: the Prompts page's check boxes (m.<name>), all on by default.
 * The Steam offers show only with Steam (OFFER_STEAM_INVITES, OFFER_STEAM_CONVERSION).
 */
const PROMPTS = ["register_recipe", "use_upgrade", "auto_create", "offer_end_survey", "unbind_heat", "replace_variants", "remove_loadout",
  "unlock_box", "change_color", "change_eye", "change_height", "use_style_kit", "mission_intro", "deposit_guild_treasury", "install_room",
  "install_door", "install_theme", "install_environment", "design_mode_hint", "install_harness", "hatch_sprite_egg", "abandon_party"];

/** Command.ControlScheme's visible schemes: the Controls page's tiles. */
const SCHEMES = ["mouse_move", "wasd_move", "gamepad"] as const;
type Scheme = (typeof SCHEMES)[number] | "custom";

/** OptionsDialog's fixed UI scale buttons. */
const SCALES: [string, number][] = [["scale100", 1], ["scale150", 1.5], ["scale200", 2], ["scale250", 2.5]];
const COMPONENT = "com.threerings.opengl.gui.config.ComponentConfig$";

const t = (key: string, fallback: string) => text("projectx", key, fallback);

export class OptionsScreen {
  private ui: Component | null = null;
  private running = false;
  /** Modal windows over the options (advanced pages, confirmations), topmost last. */
  private overlays: Component[] = [];
  private advancedVideo: Component | null = null;
  private advancedGame: Component | null = null;
  private keys: KeyBindings | null = null;
  /** The Controls tab's host and its two pages. */
  private controls: { host: Component; scheme: Component; custom: Component | null } | null = null;
  /** The control scheme tiles and the Custom button. */
  private schemeButtons = new Map<Scheme, Component>();
  /** Check boxes and sliders bound to settings the game's own controls do not cover. */
  private flags = new Map<Flag, Component[]>();
  private ranges = new Map<Range, { slider: Component; label: Component | null }>();
  private summary = new Map<string, Component>();
  /** The UI scale buttons' mark (ui/icon/check.png). */
  private check: GuiImage | null = null;
  /** The scale the slider is held at, applied when the button is let go. */
  private pendingScale: number | null = null;
  private scaleUp = false;
  /** The display modes offered: the browser's window, and the whole screen. */
  private modes: { full: boolean; label: string }[] = [];

  constructor(private readonly ctx: GuiContext, private readonly canvas: HTMLCanvasElement, private readonly settings: Settings,
    private readonly actions: OptionsActions) {
    const ev = (type: "down" | "up" | "move" | "wheel") => (e: PointerEvent | WheelEvent) => {
      const target = this.overlays[this.overlays.length - 1] ?? this.ui;
      if (!target) return;
      const r = this.canvas.getBoundingClientRect();
      dispatch(target, { type, x: e.clientX - r.left, y: e.clientY - r.top, button: (e as PointerEvent).button ?? 0,
        delta: type === "wheel" ? Math.sign((e as WheelEvent).deltaY) : 0 });
      if (type === "wheel") e.preventDefault();
    };
    canvas.addEventListener("pointerdown", ev("down"));
    canvas.addEventListener("pointerup", e => { ev("up")(e); this.releaseScale(); });
    canvas.addEventListener("pointermove", ev("move"));
    canvas.addEventListener("wheel", ev("wheel"), { passive: false });
    canvas.addEventListener("contextmenu", e => e.preventDefault());
    // ahead of the game's keys: a key being bound, and Escape closing the topmost window
    addEventListener("keydown", e => {
      if (!this.isOpen) return;
      if (this.keys?.binding) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.keys.key(e);
        return;
      }
      if (e.key === "Escape" && this.overlays.length) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.popOverlay();
      }
    }, true);
    addEventListener("fullscreenchange", () => { if (this.ui) void this.fillModes(this.ui); });
  }

  get isOpen() { return !this.canvas.hidden; }

  private building: Promise<Component | null> | null = null;

  /** Builds the window ahead of its first opening (in idle time). */
  async prebuild() {
    this.ui ??= await (this.building ??= this.build());
  }

  async open(page?: Tab) {
    const wasOpen = this.isOpen;
    this.canvas.hidden = false;
    if (!wasOpen) this.actions.sound("sound/feedback/ui_open.ogg");
    if (!this.ui) this.ui = await (this.building ??= this.build());
    if (this.ui && !wasOpen) {
      this.overlays = [];
      this.showScheme();
      this.load(this.ui);
      void this.fillModes(this.ui);
      resetInput(this.ui);
    }
    // OptionsDialog.wasAdded: Logoff and the Chat page while logged on (playing); Return to
    // <home town> while away from it; Quit always
    const playing = this.actions.playing();
    const ret = this.ui?.find("return"), logoff = this.ui?.find("logoff");
    const away = playing ? this.actions.awayFrom?.() ?? null : null;
    if (ret) { ret.visible = !!away; if (away) ret.text = message("projectx", "m.return_to", away) || `Return to ${away}`; }
    if (logoff) logoff.visible = playing;
    const chat = this.ui?.find("pane")?.parts.buttons?.children[PAGES.indexOf("chat")];
    if (chat) chat.visible = playing;
    // a knight's own options (full inspect, loot messages, party with any) show once one plays
    if (this.ui) for (const tag of ["full_inspect", "loot_filter", "party_with_any"]) showPart(this.ui, tag, playing);
    if (!this.running) { this.running = true; requestAnimationFrame(this.frame); }
    if (page) await this.showPage(page);
  }

  close() {
    if (!this.isOpen) return;
    this.keys?.cancel();
    this.overlays = [];
    this.canvas.hidden = true;
    this.running = false;
    this.actions.sound("sound/feedback/ui_dismiss.ogg");
    this.actions.closed();
  }

  /** Shows one of the old settings menu's pages: its tab, and the advanced window it lived in. */
  async showPage(page: Tab) {
    const ui = this.ui;
    if (!ui) return;
    const tab = ({ game: "general", audio: "general", graphics: "video", interface: "game", controls: "controls", save: "partner" } as const)[page];
    this.selectTab(tab);
    if (page === "graphics" && this.advancedVideo) this.pushOverlay(this.advancedVideo);
    if (page === "interface" && this.advancedGame) this.pushOverlay(this.advancedGame);
  }

  private selectTab(page: (typeof PAGES)[number]) {
    const pane = this.ui?.find("pane");
    if (pane) selectTab(pane, PAGES.indexOf(page));
  }

  private pushOverlay(o: Component) {
    if (this.overlays.includes(o)) return;
    this.load(o);
    resetInput(o);
    this.overlays.push(o);
  }

  private popOverlay(o = this.overlays[this.overlays.length - 1]) {
    this.overlays = this.overlays.filter(x => x !== o);
    this.actions.sound("sound/feedback/ui_dismiss.ogg");
  }

  private async build(): Promise<Component | null> {
    const ui = await buildInterface(this.ctx, { $class: CONFIG_REF, name: "ui/options/interface.dat" });
    if (!ui) return null;
    hideParts(ui, HIDDEN);
    for (const p of ui.find("pane")?.tabs ?? []) hideParts(p, HIDDEN);
    const s = this.settings, act = this.actions;
    const on = (tag: string, fn: (c: Component, action: string) => void) => { const c = ui.find(tag); if (c) c.onAction = fn; };
    const slider = (tag: string, key: "musicVolume" | "effectsVolume" | "uiVolume") =>
      on(tag, c => { s[key] = this.fraction(c); act.changed(); });
    slider("music_volume", "musicVolume");
    slider("effect_volume", "effectsVolume");
    slider("interface_volume", "uiVolume");
    on("render_quality", c => { s.renderScale = 0.5 + this.fraction(c); this.setQualityLabel(ui); act.changed(); });
    // OptionsDialog: the check box shows camera shake on; the preference kept is its inverse
    on("camera_shake", c => { s.noShake = !c.value; act.changed(); });
    // the UI scale: the fixed scales, Max! (the screen's largest, toggled), and the slider,
    // whose label reads the dragged scale in display_label_up until the button is let go
    this.check = await this.ctx.image("ui/icon/check.png");
    for (const [tag, v] of SCALES) on(tag, () => { s.hudScale = v; this.showScale(ui); act.changed(); });
    on("scalemax", () => { s.hudScaleMax = !s.hudScaleMax; this.showScale(ui); act.changed(); });
    on("ui_scale", c => { this.pendingScale = Number(c.value) / 100; this.scaleLabel(ui, Math.round(Number(c.value)), true); });
    const check = (tag: string, key: "damageNumbers" | "healthBars" | "autoAim" | "screenFlash") =>
      on(tag, c => { s[key] = !!c.value; act.sound("sound/feedback/ui_confirm.ogg"); act.changed(); });
    check("show_damage", "damageNumbers");
    check("monster_health", "healthBars");
    check("auto_target", "autoAim");
    check("show_damage_effects", "screenFlash");
    for (const tag of Object.keys(PREF_BOXES)) on(tag, c => { s.prefs[tag] = !!c.value; act.sound("sound/feedback/ui_confirm.ogg"); act.changed(); });
    await Promise.all([this.languages(ui), this.prefCombos(ui), this.buildPrompts(ui)]);
    // the display mode: Apply and Cancel enable while another mode is picked
    on("screen_mode", () => this.modePicked(ui));
    on("disp_cancel", () => { void this.fillModes(ui); act.sound("sound/feedback/ui_dismiss.ogg"); });
    on("disp_apply", () => void this.applyMode(ui));
    // a bug report goes to the game's servers: there is none to send it to
    const bug = ui.find("bugreport");
    if (bug) bug.enabled = false;
    // About: the client's version line (this port's name in the version's place) and release name
    const version = ui.find("client_version"), release = ui.find("version_name");
    if (version) version.text = message("projectx", "m.client_version", "clyde-web") || "Client version clyde-web";
    if (release) release.text = "How Bizarre";
    on("dismiss", () => this.close());
    on("return", () => {
      const away = this.actions.awayFrom?.() ?? "Haven";
      this.confirm(message("projectx", "m.confirm_return", away) || `Are you sure you want to return to ${away}?`, t("b.return", "Return"),
        () => { this.close(); act.returnToHaven(); });
    });
    on("quit", () => this.confirm(t("m.confirm_quit", "Are you sure you want to quit?"), t("m.quit", "Quit"), () => { this.close(); act.quit(); }));
    on("logoff", () => this.confirm(t("m.confirm_logoff", "Are you sure you want to logoff?"), t("m.logoff", "Logoff"), () => { this.close(); act.logoff(); }));

    const [video, game, keys] = await Promise.all([this.ui_("ui/options/advanced_video.dat"), this.ui_("ui/options/advanced_game.dat"),
      KeyBindings.build(this.ctx, s, { changed: () => act.changed(), sound: f => act.sound(f), back: () => this.showScheme() })]);
    this.keys = keys;
    await Promise.all([this.buildControls(ui), this.buildSaveBox(ui),
      video && this.buildAdvanced(video, "render_effects", [["fog", "Fog"], ["shadows", "Character Shadows"],
        ["decals", "Projected Shade (Roofs, Trees)"], ["showFps", "Show Frame Rate"]]),
      game && this.buildAdvanced(game, "auto_advance", [["minimap", "Show Minimap"], ["controlsHint", "Show Controls Hint"], ["muted", "Mute All Sound"]])]);
    if (video) {
      const fx = video.find("render_effects");
      if (fx) this.bindFlag(fx, "particles");
      const l = findLabelOf(video, "render_effects");
      if (l) l.text = "Particle Effects";
    }
    // the advanced game window takes this port's sliders: master volume, the camera and the gamepad
    const table = game && findParent(game, c => c.children.some(k => k.tag === "auto_advance"));
    if (table) {
      const rows = await Promise.all([this.sliderRow(ui, "masterVolume", "Master Volume"), 
        this.sliderRow(ui, "zoom", "Camera Distance"), this.sliderRow(ui, "deadZone", "Stick Dead Zone")]);
      table.children.push(...rows.flat());
    }
    this.advancedVideo = video;
    this.advancedGame = game;
    on("edit_advanced", () => { act.sound("sound/feedback/ui_open.ogg"); if (video) this.pushOverlay(video); });
    on("edit_advanced_game", () => { act.sound("sound/feedback/ui_open.ogg"); if (game) this.pushOverlay(game); });
    return ui;
  }

  private ui_(name: string) { return buildUi(this.ctx, uiRef(name)); }

  /** An advanced window: the parts with nothing behind them hidden, rows added for our flags. */
  private async buildAdvanced(win: Component, template: string, rows: [Flag, string][]) {
    hideParts(win, HIDDEN_ADVANCED);
    // the frame rate limit's box goes with its slider and label, the antialiasing box with its label
    for (const tag of ["fps_box", "antialiasing"]) {
      const p = findParent(win, c => c.children.some(k => k.tag === tag));
      if (p) p.visible = false;
    }
    const dismiss = win.find("dismiss");
    if (dismiss) dismiss.onAction = () => this.popOverlay(win);
    const table = findParent(win, c => c.children.some(k => k.tag === template));
    if (!table) return;
    await this.addRows(table, template, rows.map(([key, text]) => ({ key, text })));
  }

  /** Adds check box rows to a label + control table, copied from its row for `template`. */
  private async addRows(table: Component, template: string, rows: { key: Flag; text: string }[], at = table.children.length) {
    const i = table.children.findIndex(k => k.tag === template);
    const label = table.children[i - 1], box = table.children[i];
    if (!label || !box) return;
    const built = await Promise.all(rows.map(async r => {
      const [l, b] = await Promise.all([buildComponentConfig(this.ctx, { ...label.config, text: r.text }, label.local),
        buildComponentConfig(this.ctx, { ...box.config, tag: r.key }, box.local)]);
      l.constraints = label.constraints;
      b.constraints = box.constraints;
      this.bindFlag(b, r.key);
      return [l, b];
    }));
    table.children.splice(at, 0, ...built.flat());
  }

  private bindFlag(c: Component, key: Flag) {
    const list = this.flags.get(key) ?? [];
    list.push(c);
    this.flags.set(key, list);
    c.onAction = () => {
      this.settings[key] = !!c.value;
      for (const o of this.flags.get(key) ?? []) o.value = this.settings[key];
      this.actions.sound("sound/feedback/ui_confirm.ogg");
      this.actions.changed();
    };
  }

  /** OptionsDialog's language box: the base text and each locale the install has, by its own name. */
  private async languages(ui: Component) {
    const combo = ui.find("language");
    if (!combo) return;
    const codes = ["", ...messages.available];
    const own = (code: string) => {
      const tag = code || "en";
      try { const n = new Intl.DisplayNames([tag], { type: "language" }).of(tag) ?? tag; return n[0].toUpperCase() + n.slice(1); } catch { return tag; }
    };
    await setComboItems(this.ctx, combo, codes.map(own), Math.max(0, codes.indexOf(this.settings.locale)));
    combo.onAction = c => {
      const code = codes[c.selectedIndex] ?? "";
      if (code === this.settings.locale) return;
      this.settings.locale = code;
      this.actions.sound("sound/feedback/ui_confirm.ogg");
      this.actions.changed();
    };
  }

  /** The combo boxes with nothing behind them: their items, the player's last choice kept. */
  private async prefCombos(ui: Component) {
    await Promise.all(Object.entries(PREF_COMBOS).map(async ([tag, { items, dflt }]) => {
      const combo = ui.find(tag);
      if (!combo) return;
      // Loot Messages is a real setting here (the loot lines, src/game/lootlog.ts)
      const LOOT: LootLevel[] = ["all", "pro", "none"];
      const saved = tag === "loot_filter" ? LOOT.indexOf(this.settings.lootMessages) : this.settings.prefs[tag];
      await setComboItems(this.ctx, combo, items.map(([k, f]) => (k ? t(k, f) : f)), typeof saved === "number" && saved >= 0 ? saved : dflt);
      combo.onAction = c => {
        if (c.selectedIndex < 0 || this.settings.prefs[tag] === c.selectedIndex) return;
        this.settings.prefs[tag] = c.selectedIndex;
        if (tag === "loot_filter") this.settings.lootMessages = LOOT[c.selectedIndex] ?? "all";
        this.actions.sound("sound/feedback/ui_confirm.ogg");
        this.actions.changed();
      };
    }));
  }

  /** OptionsDialog: a check box per visible ConfirmPrompt in confirm_prompts, labelled m.<prompt>. */
  private async buildPrompts(ui: Component) {
    const list = ui.find("confirm_prompts");
    if (!list) return;
    const boxes = await Promise.all(PROMPTS.map(async p => {
      const label = t("m." + p, p.replace(/_/g, " "));
      const b = await buildComponentConfig(this.ctx, { $class: COMPONENT + "CheckBox", tag: "prompt_" + p, text: "~" + label }, list.local);
      b.constraints = null;
      b.onAction = c => { this.settings.prefs["prompt_" + p] = !!c.value; this.actions.sound("sound/feedback/ui_confirm.ogg"); this.actions.changed(); };
      return b;
    }));
    list.children = boxes;
  }

  /**
   * ProjectXPrefs.d's display modes as the screen-mode box lists them ("1280x800 windowed"):
   * the browser's window and the whole screen, the one in use picked.
   */
  private async fillModes(ui: Component) {
    const combo = ui.find("screen_mode");
    if (!combo) return;
    const fmt = (w: number, h: number, full: boolean) => {
      const res = message("projectx", "m.resolution", String(w), String(h)) || `${w}x${h}`;
      return (message("projectx", "m.disp_fmt", res, "", full ? t("x.fullscreen", "fullscreen") : t("x.windowed", "")) || res).replace(/\s+/g, " ").trim();
    };
    const full = !!document.fullscreenElement;
    this.modes = [{ full: false, label: fmt(innerWidth, innerHeight, false) }, { full: true, label: fmt(screen.width, screen.height, true) }];
    await setComboItems(this.ctx, combo, this.modes.map(m => m.label), full ? 1 : 0);
    this.modePicked(ui);
  }

  /** OptionsDialog.FM: Apply and Cancel are enabled while a mode other than the current one is picked. */
  private modePicked(ui: Component) {
    const combo = ui.find("screen_mode");
    const picked = this.modes[combo?.selectedIndex ?? -1];
    const changed = !!picked && picked.full !== !!document.fullscreenElement;
    for (const tag of ["disp_apply", "disp_cancel"]) { const b = ui.find(tag); if (b) b.enabled = changed; }
  }

  /** Apply: the whole screen, or back to the window. */
  private async applyMode(ui: Component) {
    const picked = this.modes[ui.find("screen_mode")?.selectedIndex ?? -1];
    if (!picked) return;
    this.actions.sound("sound/feedback/ui_confirm.ogg");
    try {
      if (picked.full) await document.documentElement.requestFullscreen();
      else if (document.fullscreenElement) await document.exitFullscreen();
    } catch { /* the browser refused */ }
    await this.fillModes(ui);
  }

  /**
   * A slider row in the Video page's render quality style: its label, then the slider with its
   * value label, copied and re-tagged.
   */
  private async sliderRow(ui: Component, key: Range, text: string): Promise<Component[]> {
    const quality = ui.find("render_quality"), value = ui.find("render_quality_label");
    const group = quality && findParent(ui, c => c.children.includes(quality));
    const table = group && findParent(ui, c => c.children.includes(group));
    const label = table?.children[table.children.indexOf(group!) - 1];
    if (!quality || !group || !label || !value) return [];
    const kids = (group.config.layout.children as any[]).map(ch => ({
      ...ch, component: ch.component.tag === "render_quality" ? { ...ch.component, tag: key }
        : ch.component.tag === "render_quality_label" ? { ...ch.component, tag: `${key}_label`, text: "" } : ch.component,
    }));
    const [l, g] = await Promise.all([buildComponentConfig(this.ctx, { ...label.config, text }, label.local),
      buildComponentConfig(this.ctx, { ...group.config, layout: { ...group.config.layout, children: kids } }, group.local)]);
    l.constraints = label.constraints;
    g.constraints = group.constraints;
    const slider = g.find(key), out = g.find(`${key}_label`);
    if (slider) {
      this.ranges.set(key, { slider, label: out });
      slider.onAction = () => {
        const r = RANGES[key];
        this.settings[key] = r.min + this.fraction(slider) * (r.max - r.min);
        if (out) out.text = r.fmt(this.settings[key]);
        this.actions.changed();
      };
    }
    return [l, g];
  }

  /** The scheme in use: the custom keys, mouse movement, or WASD (or the gamepad, which plays as WASD). */
  private get scheme(): Scheme {
    const p = this.settings.prefs.controlScheme;
    if (this.settings.mouseMove) return "mouse_move";
    return p === "gamepad" || p === "custom" ? p : "wasd_move";
  }

  /**
   * Controls (client/u on ui/options/controlscheme.dat): a 148 x 120 tile per visible
   * Command.ControlScheme (m.cs_<scheme>, styled Button (Blue Control Scheme)/<scheme>), the
   * scheme in use pressed; a press asks to switch (client/ad). Custom (Click to Change) opens
   * the custom controls page.
   */
  private async buildControls(ui: Component) {
    const host = ui.find("controls");
    const scheme = host?.children[0];
    if (!host || !scheme) return;
    this.controls = { host, scheme, custom: this.keys?.root ?? null };
    if (this.keys) this.keys.root.constraints = scheme.constraints;
    const row = scheme.find("controlSchemes"), proto = row?.children[0];
    if (row && proto) {
      const tiles = await Promise.all(SCHEMES.map(async id => {
        const b = await buildComponentConfig(this.ctx, { ...proto.config, tag: "scheme_" + id, text: "~" + t("m.cs_" + id, id),
          style: { ...proto.config.style, name: `Button (Blue Control Scheme)/${id}/Button, Blue` }, preferredSize: { width: 148, height: 120 } }, proto.local);
        b.constraints = proto.constraints;
        b.onAction = () => { this.actions.sound("sound/feedback/ui_confirm.ogg"); void this.askScheme(id); };
        this.schemeButtons.set(id, b);
        return b;
      }));
      row.children = tiles;
    }
    const custom = scheme.find("custom");
    if (custom) {
      this.schemeButtons.set("custom", custom);
      custom.onAction = () => {
        this.actions.sound("sound/feedback/ui_confirm.ogg");
        if (this.scheme !== "custom") { this.settings.prefs.controlScheme = "custom"; this.settings.mouseMove = false; this.actions.changed(); }
        this.showSchemes();
        this.showCustom();
      };
    }
    this.showSchemes();
  }

  /** The tiles' and Custom's pressed state: the scheme in use. */
  private showSchemes() {
    for (const [id, b] of this.schemeButtons) b.selected = id === this.scheme;
  }

  /**
   * client/ad on ui/controlselect/interface.dat: the scheme's diagram and summary
   * (t.cs_desc_<scheme>, m.cs_desc_<scheme>_1..3) with Back and Accept. Accepting switches to it
   * with its default keys (Command.resetControlScheme).
   */
  private async askScheme(id: (typeof SCHEMES)[number]) {
    const [o, diagram] = await Promise.all([this.ui_("ui/controlselect/interface.dat"), this.ui_(`ui/controlselect/part_diagram_${id}.dat`)]);
    if (!o) { this.setScheme(id); return; }
    const row = o.find("controlSchemes");
    if (row) row.visible = false;
    const host = o.find("uiDiagram");
    const parent = host && findParent(o, c => c.children.includes(host));
    if (host && parent && diagram) { diagram.constraints = host.constraints; parent.children[parent.children.indexOf(host)] = diagram; }
    const desc = "cs_desc_" + id;
    const title = o.find("labelTitle");
    if (title) title.text = t("t." + desc, id);
    for (let i = 1; i <= 3; i++) {
      const l = o.find("labelText" + i);
      if (!l) continue;
      const k = `m.${desc}_${i}`;
      l.visible = !!message("projectx", k) && message("projectx", k) !== k;
      l.text = l.visible ? t(k, "") : "";
    }
    const back = o.find("buttonBack"), accept = o.find("buttonAccept");
    if (back) back.onAction = () => { this.popOverlay(o); this.showSchemes(); };
    if (accept) accept.onAction = () => { this.overlays = this.overlays.filter(x => x !== o); this.actions.sound("sound/feedback/ui_confirm.ogg"); this.setScheme(id); };
    resetInput(o);
    this.actions.sound("sound/feedback/ui_open.ogg");
    this.overlays.push(o);
  }

  private setScheme(id: (typeof SCHEMES)[number]) {
    this.settings.prefs.controlScheme = id;
    this.settings.mouseMove = id === "mouse_move";
    this.settings.keys = defaultSettings().keys;
    this.keys?.refresh();
    this.actions.changed();
    this.showSchemes();
  }

  private showCustom() {
    const c = this.controls;
    if (!c?.custom) return;
    this.selectTab("controls");
    c.host.children = [c.custom];
    this.keys?.refresh();
  }

  private showScheme() {
    const c = this.controls;
    if (!c) return;
    this.keys?.cancel();
    c.host.children = [c.scheme];
    this.showSchemes();
  }

  /**
   * The Partner page's Steam box (hidden without Steam) holds the browser's save: what it
   * holds, the levels collected from the scene cache, and Export, Import, Reset, Unlock All
   * Gear and the levels checklist, in the box's own label and the window's button styles.
   */
  private async buildSaveBox(ui: Component) {
    const box = ui.find("steam_container");
    const title = box?.children.find(k => k.kind === "label");
    const table = box?.children.find(k => k.children.some(x => x.tag === "enable_voice_chat"));
    const label = table?.children[0], cell = table?.find("enable_voice_chat");
    const blue = ui.find("edit_advanced"), orange = ui.find("scalemax");
    if (!box || !title || !table || !label || !cell || !blue || !orange) return;
    title.text = "Save Data";
    const valueCfg = { ...label.config, text: "", style: { $class: CONFIG_REF, name: "Default/Label" } };
    const rows: [string, string][] = [["crowns", "Crowns"], ["heat", "Heat"], ["owned", "Items Owned"], ["depth", "Deepest Depth"], ["runs", "Runs"], ["levels", "Levels"]];
    const summary = await Promise.all(rows.map(async ([tag, text]) => {
      const [l, v] = await Promise.all([buildComponentConfig(this.ctx, { ...label.config, text }, label.local),
        buildComponentConfig(this.ctx, { ...valueCfg, tag: `save_${tag}` }, label.local)]);
      l.constraints = label.constraints;
      v.constraints = cell.constraints;
      this.summary.set(tag, v);
      return [l, v];
    }));
    table.children = summary.flat();
    const note = await buildComponentConfig(this.ctx, { ...valueCfg, text: "The save lives in this browser only." }, label.local);
    note.constraints = table.constraints;
    const button = async (cfg: any, local: Map<string, any>, tag: string, text: string, fn: () => void) => {
      const b = await buildComponentConfig(this.ctx, { ...cfg, tag, text }, local);
      b.constraints = { fixed: true };
      b.onAction = () => { this.actions.sound("sound/feedback/button_press.ogg"); fn(); };
      return b;
    };
    const rowOf = async (kids: Component[]) => {
      const r = await buildComponentConfig(this.ctx, { ...table.config, tag: "",
        layout: { $class: "LayoutConfig$HorizontalGroup", policy: { name: "NONE" }, justification: { name: "LEFT" }, offAxisPolicy: { name: "NONE" }, gap: 8, children: [] } },
      table.local);
      r.children = kids;
      r.constraints = table.constraints;
      return r;
    };
    const [a, b] = await Promise.all([
      Promise.all([button(blue.config, blue.local, "save_export", "Export", () => this.exportSave()),
        button(blue.config, blue.local, "save_import", "Import", () => this.importSave()),
        button(blue.config, blue.local, "save_levels", "Levels", () => void this.showLevels())]),
      Promise.all([button(orange.config, orange.local, "save_reset", "Reset Save", () => this.confirmReset()),
        button(orange.config, orange.local, "save_unlock", "Unlock All Gear", () => this.confirmUnlock())]),
    ]);
    box.children = [title, table, note, await rowOf(a), await rowOf(b)];
  }

  private refreshSummary() {
    const d = loadSave();
    const set = (tag: string, v: string | number) => { const c = this.summary.get(tag); if (c) c.text = String(v); };
    set("crowns", d.crowns.toLocaleString("en-US"));
    set("heat", d.heat.toLocaleString("en-US"));
    set("owned", d.owned.length);
    set("depth", d.bestDepth);
    set("runs", d.runs);
    const list = checklist(this.actions.sceneNames());
    set("levels", `${list.have} / ${list.total}`);
  }

  /**
   * The levels checklist (src/game/levels.ts): how many of the game's server-side levels the
   * install's scene cache holds, by group, in a window like the advanced ones.
   */
  private async showLevels() {
    const o = await this.ui_("ui/options/advanced_game.dat");
    const table = o && findParent(o, c => c.children.some(k => k.tag === "auto_advance"));
    const label = table?.children[0];
    if (!o || !table || !label) return;
    hideParts(o, ["lovegroup"]);
    const title = o.children[0]?.kind === "label" ? o.children[0] : o.find("title") ?? findTitle(o);
    if (title) title.text = "Levels Collected";
    const list = checklist(this.actions.sceneNames());
    const valueCfg = { ...label.config, text: "", style: { $class: CONFIG_REF, name: "Default/Label" } };
    const rows: [string, string][] = [...list.groups.map(g => [g.title, `${g.have.length} / ${g.have.length + g.missing.length}`] as [string, string]),
      ["All levels", `${list.have} / ${list.total}`], ...(list.guildHalls ? [["Guild halls archived", String(list.guildHalls)] as [string, string]] : [])];
    const built = await Promise.all(rows.map(async ([name, value]) => {
      const [l, v] = await Promise.all([buildComponentConfig(this.ctx, { ...label.config, text: "~" + name }, label.local),
        buildComponentConfig(this.ctx, { ...valueCfg, text: "~" + value }, label.local)]);
      l.constraints = label.constraints;
      v.constraints = table.children[1]?.constraints ?? null;
      return [l, v];
    }));
    table.children = built.flat();
    const dismiss = o.find("dismiss");
    if (dismiss) dismiss.onAction = () => this.popOverlay(o);
    resetInput(o);
    this.actions.sound("sound/feedback/ui_open.ogg");
    this.overlays.push(o);
  }

  private exportSave() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(loadSave(), null, 1)], { type: "application/json" }));
    a.download = "clyde-web-save.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private importSave() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!data || typeof data !== "object" || !data.loadout) throw new Error("not a save");
        void this.prompt("Import Save", "Replace this browser's save with the one in the file?", () => {
          writeSave(normalizeSave(data));
          this.replaced();
          void this.prompt("Save Imported", "The save was imported.", null);
        });
      } catch {
        void this.prompt("Import Save", "That file is not a clyde-web save.", null);
      }
    };
    input.click();
  }

  private confirmUnlock() {
    void this.prompt("Unlock All Gear", "Cheat: own every weapon, shield, armour and trinket in the game, and add 1,000,000 crowns?", async () => {
      const ok = await this.actions.unlockAll?.();
      this.refreshSummary();
      void this.prompt("Unlock All Gear", ok ? "Everything is in your arsenal (I)." : "Start playing first, then try again.", null);
    });
  }

  private confirmReset() {
    void this.prompt("Reset Save", "Delete every knight saved in this browser and start over? This cannot be undone.", () => {
      try { localStorage.removeItem(ROSTER_KEY); localStorage.removeItem(LEGACY_KEY); } catch { /* storage unavailable */ }
      reloadRoster();
      this.replaced();
    });
  }

  private replaced() {
    const d = loadSave();
    this.actions.saveReplaced?.(d);
    this.refreshSummary();
  }

  /** The client's confirmation (cc, cf, bY): a question with Cancel and the action's own button. */
  private confirm(question: string, acceptText: string, accept: () => void) {
    this.actions.sound("sound/feedback/ui_dropdown_activate.ogg");
    void this.prompt("", question, accept, acceptText);
  }

  /**
   * The game's confirmation window (ui/window/confirm_prompt): OK (or `acceptText`) runs
   * `accept`; with no `accept` it is a notice with OK alone.
   */
  private async prompt(title: string, text: string, accept: (() => void) | null, acceptText?: string) {
    const o = await buildUi(this.ctx, uiRef("ui/window/confirm_prompt/interface.dat"));
    if (!o) return;
    const set = (tag: string, v: string) => { const c = o.find(tag); if (c) c.text = v; };
    set("title", title);
    set("prompt", text);
    const confirm = o.find("confirm"), cancel = o.find("cancel"), ok = o.find("accept"), dismiss = o.find("dismiss");
    if (confirm) confirm.visible = false;
    if (cancel) { cancel.visible = !!accept; cancel.onAction = () => this.popOverlay(o); }
    if (dismiss) dismiss.onAction = () => this.popOverlay(o);
    if (ok) {
      if (acceptText) ok.text = acceptText;
      ok.onAction = () => { this.overlays = this.overlays.filter(x => x !== o); this.actions.sound("sound/feedback/ui_confirm.ogg"); accept?.(); };
    }
    resetInput(o);
    this.actions.sound("sound/feedback/ui_open.ogg");
    this.overlays.push(o);
  }

  /** Puts the current settings into the controls. */
  private load(ui: Component) {
    const s = this.settings;
    const set = (tag: string, v: number | boolean) => { const c = ui.find(tag); if (c) c.value = v; };
    const toSlider = (c: Component | null | undefined, f: number) => {
      if (c?.model) c.value = c.model.min + f * (c.model.max - c.model.extent - c.model.min);
    };
    toSlider(ui.find("music_volume"), s.musicVolume);
    toSlider(ui.find("effect_volume"), s.effectsVolume);
    toSlider(ui.find("interface_volume"), s.uiVolume);
    toSlider(ui.find("render_quality"), Math.max(0, Math.min(1, s.renderScale - 0.5)));
    for (const [key, { slider, label }] of this.ranges) {
      const r = RANGES[key];
      toSlider(slider, Math.max(0, Math.min(1, (s[key] - r.min) / (r.max - r.min))));
      if (label) label.text = r.fmt(s[key]);
    }
    for (const [key, list] of this.flags) for (const c of list) c.value = s[key];
    set("camera_shake", !s.noShake);
    set("show_damage", s.damageNumbers);
    set("monster_health", s.healthBars);
    set("auto_target", s.autoAim);
    set("show_damage_effects", s.screenFlash);
    for (const [tag, dflt] of Object.entries(PREF_BOXES)) set(tag, typeof s.prefs[tag] === "boolean" ? s.prefs[tag] as boolean : dflt);
    for (const p of PROMPTS) set("prompt_" + p, s.prefs["prompt_" + p] !== false);
    if (ui === this.ui) {
      this.setQualityLabel(ui);
      this.showScale(ui);
      this.refreshSummary();
      this.showSchemes();
      this.keys?.refresh();
    }
  }

  private fraction(c: Component) {
    const m = c.model;
    if (!m) return 0;
    const span = m.max - m.extent - m.min;
    return span > 0 ? Math.max(0, Math.min(1, (Number(c.value) - m.min) / span)) : 0;
  }

  private setQualityLabel(ui: Component) {
    const l = ui.find("render_quality_label"), r = this.settings.renderScale;
    // ProjectXPrefs.RenderQuality: three steps, named m.low, m.medium and m.high
    const q = r < 5 / 6 ? "low" : r < 7 / 6 ? "medium" : "high";
    if (l) l.text = text("projectx", `m.${q}`, q[0].toUpperCase() + q.slice(1));
  }

  /**
   * OptionsDialog's UI scale state: the slider runs from 70% to the screen's largest scale (or
   * the 1024 x 600 share when that is under the scale in use); 150%, 200% and 250% show when
   * the screen reaches them; Max! on disables the slider and the fixed scales; the scale in use
   * is marked with the check icon (Max! while it is on); the label reads the scale.
   */
  private showScale(ui: Component) {
    const s = this.settings, cur = uiScale(s);
    let max = uiMaxScale();
    const curPct = Math.round(100 * cur);
    if (Math.round(100 * max) < curPct) max = uiScaleLimit();
    const slider = ui.find("ui_scale");
    if (slider?.model) {
      const m = slider.model;
      m.min = Math.round(100 * UI_MIN_SCALE); m.extent = 0; m.max = Math.round(100 * max); m.snap = 0;
      m.value = Math.max(m.min, Math.min(m.max, curPct));
    }
    for (const [tag, v] of SCALES) {
      const b = ui.find(tag);
      if (!b) continue;
      if (v > 1) b.visible = max >= v;
      b.enabled = !s.hudScaleMax;
      b.icon = !s.hudScaleMax && cur === v ? this.check : null;
    }
    if (slider) slider.enabled = !s.hudScaleMax;
    const maxButton = ui.find("scalemax");
    if (maxButton) maxButton.icon = s.hudScaleMax ? this.check : null;
    this.pendingScale = null;
    this.scaleLabel(ui, curPct, false);
  }

  /** The scale label: "N%", styled display_label_up while the slider is held, else display_label. */
  private scaleLabel(ui: Component, pct: number, up: boolean) {
    const l = ui.find("ui_scale_label");
    if (!l) return;
    l.text = `${pct}%`;
    if (this.scaleUp !== up) {
      this.scaleUp = up;
      void restyle(this.ctx, l, up ? "display_label_up" : "display_label").catch(() => undefined);
    }
  }

  /** The slider was let go: its scale applies (OptionsDialog applies it on the mouse release). */
  private releaseScale() {
    const v = this.pendingScale;
    if (v == null || !this.ui) return;
    this.settings.hudScale = v;
    this.showScale(this.ui);
    this.actions.changed();
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
    // the options window leaves the game undimmed behind it; its dialogs are modal (the shade
    // behind the topmost)
    for (const ui of [this.ui, ...this.overlays]) {
      if (!ui) continue;
      if (ui === this.ui) {
        // the window covers the screen: its Options Backing (vertical stripes) fills it, and the
        // anchored logo, tabs and buttons sit in the middle
        ui.preferredSize = { width: Math.round(cw), height: Math.round(ch) };
        pack(ui);
        render(ui, g, 0, Math.round(ch), {});
        continue;
      }
      if (ui === this.overlays[this.overlays.length - 1]) modalShade(g, cw, ch);
      const s = pack(ui);
      render(ui, g, Math.round((cw - s.width) / 2), Math.round((ch + s.height) / 2), {});
    }
    requestAnimationFrame(this.frame);
  };
}

/**
 * Hides the tagged parts; in a table of label + control pairs, a hidden control takes its label
 * with it so the rows stay paired.
 */
function hideParts(root: Component, tags: string[]) {
  const hide = new Set(tags);
  const walk = (c: Component) => {
    c.children.forEach((k, i) => {
      if (!hide.has(k.tag)) return;
      k.visible = false;
      const prev = c.children[i - 1];
      if (c.layout?.$class?.endsWith("Table") && prev?.kind === "label" && !prev.tag?.startsWith("ui_")) prev.visible = false;
    });
    c.children.forEach(walk);
    c.tabs.forEach(walk);
  };
  walk(root);
}

/** Shows or hides a tagged control and, in a label + control table, its label. */
function showPart(root: Component, tag: string, on: boolean) {
  const c = root.find(tag);
  if (!c) return;
  c.visible = on;
  const p = findParent(root, x => x.children.includes(c));
  const prev = p?.children[p.children.indexOf(c) - 1];
  if (p?.layout?.$class?.endsWith("Table") && prev?.kind === "label") prev.visible = on;
}

/** The label before a tagged control in its table. */
function findLabelOf(root: Component, tag: string): Component | null {
  const c = root.find(tag), t = c && findParent(root, p => p.children.includes(c));
  const l = t?.children[t.children.indexOf(c!) - 1];
  return l?.kind === "label" ? l : null;
}

/** A window's title: its first label. */
function findTitle(c: Component): Component | null {
  if (c.kind === "label") return c;
  for (const k of c.children) { const r = findTitle(k); if (r) return r; }
  return null;
}
