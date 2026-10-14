// The options window: the game's own rsrc/ui/options/interface.dat (General, Video, Game,
// Controls... tabs) drawn full screen over the game, its controls bound to our settings. The
// parts the game drives from its servers or its desktop window (region, screen mode, chat,
// Steam, bug reports) are hidden; the language box picks the locale of the game's text (the
// locales the install has bundles for; it applies on the next start). The Advanced buttons open
// the game's advanced video and game windows (ui/options/advanced_*.dat) over it, Custom shows
// its custom controls page (key bindings, src/ui/keybinds.ts), and the Steam tab's page holds the
// save data. Settings the game's pages have no control for get rows copied from the same page's
// own label, check box and slider configs, so everything is drawn in the game's styles.

import { CONFIG_REF } from "../config/params";
import { loadSave, writeSave, type SaveData } from "../game/save";
import { checklist } from "../game/levels";
import { messages, text } from "../i18n";
import { buildComponentConfig, buildInterface, Component, dispatch, pack, render, resetInput, setComboItems, type GuiContext } from "./gui";
import { findParent, KeyBindings } from "./keybinds";
import { buildUi, uiRef } from "./screen";
import type { Settings, Tab } from "./settings";

export interface OptionsActions {
  changed(): void;
  /** @deprecated The advanced pages are the options window's own now; this is not called. */
  advanced?(tab: "graphics" | "controls" | "interface" | "save"): void;
  returnToHaven(): void;
  quit(): void;
  closed(): void;
  playing(): boolean;
  sound(file: string): void;
  /** The save was replaced (imported or reset). */
  saveReplaced?(d: SaveData): void;
  /** Cheat: own every equippable item and add crowns; false when no game is running. */
  unlockAll?(): Promise<boolean>;
  /** Display names of the cached scenes (for the Levels tab). */
  sceneNames(): string[];
}

/** Tags whose parts have nothing behind them in this port. */
const HIDDEN = ["party_with_any", "region_label", "region", "bugreport", "resetprefs", "screen_mode", "disp_cancel", "disp_apply",
  "full_inspect", "npc_names", "ld_hud_arrows", "discord", "edit_beta_game", "weapon_switcher"];
/** The same in the advanced video and game windows. */
const HIDDEN_ADVANCED = ["vsync_enabled", "compatibility_mode", "cull_transients", "antialiasing", "fps_box",
  "auto_advance", "ping_gfx", "hide_ui", "lovegroup"];

type Flag = "muted" | "fog" | "shadows" | "decals" | "particles" | "showFps" | "minimap" | "controlsHint" | "mouseMove";
type Range = "masterVolume" | "cameraSpeed" | "zoom" | "deadZone";
/** Slider ranges, and how the value label reads. */
const RANGES: Record<Range, { min: number; max: number; fmt: (v: number) => string }> = {
  masterVolume: { min: 0, max: 1, fmt: v => `${Math.round(v * 100)}%` },
  cameraSpeed: { min: 0.5, max: 4, fmt: v => v.toFixed(1) },
  zoom: { min: 0.7, max: 1.6, fmt: v => `${Math.round(v * 100)}%` },
  deadZone: { min: 0.05, max: 0.5, fmt: v => `${Math.round(v * 100)}%` },
};

const SAVE_KEY = "clyde-web-save";

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
  /** Check boxes and sliders bound to settings the game's own controls do not cover. */
  private flags = new Map<Flag, Component[]>();
  private ranges = new Map<Range, { slider: Component; label: Component | null }>();
  private summary = new Map<string, Component>();

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
    canvas.addEventListener("pointerup", ev("up"));
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
  }

  get isOpen() { return !this.canvas.hidden; }

  private building: Promise<Component | null> | null = null;
  /** The Levels tab's page and a label of the window to take its text style from. */
  private levels: { page: Component; proto: Component } | null = null;

  /** Builds the window ahead of its first opening (in idle time). */
  async prebuild() {
    this.ui ??= await (this.building ??= this.build());
  }

  async open(page?: Tab) {
    const wasOpen = this.isOpen;
    this.canvas.hidden = false;
    if (!wasOpen) this.actions.sound("sound/feedback/ui_open.ogg");
    if (!this.ui) this.ui = await (this.building ??= this.build());
    if (this.ui) this.fillLevels();
    if (this.ui && !wasOpen) {
      this.overlays = [];
      this.showScheme();
      this.load(this.ui);
      resetInput(this.ui);
    }
    const ret = this.ui?.find("return"), quit = this.ui?.find("quit"), logoff = this.ui?.find("logoff");
    if (ret) ret.visible = this.actions.playing();
    if (quit) quit.visible = this.actions.playing();
    if (logoff) logoff.visible = false;
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
    const tab = { game: "General", audio: "General", graphics: "Video", interface: "Game", controls: "Controls", save: "Save Data" }[page];
    this.selectTab(tab);
    if (page === "graphics" && this.advancedVideo) this.pushOverlay(this.advancedVideo);
    if (page === "interface" && this.advancedGame) this.pushOverlay(this.advancedGame);
    if (page === "controls") this.showCustom();
  }

  private selectTab(title: string) {
    const pane = this.ui?.find("pane");
    const i = pane?.parts.buttons?.children.findIndex(b => b.text === title) ?? -1;
    if (pane && i >= 0) pane.value = i;
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
    for (const t of ui.find("pane")?.tabs ?? []) hideParts(t, HIDDEN);
    // tabs with nothing behind them in single player; the Steam tab's page holds the save data
    // and the Prompts tab's the Levels checklist
    this.hideTabs(ui, ["Chat"]);
    this.levelsTab(ui);
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
    const check = (tag: string, key: "damageNumbers" | "healthBars" | "autoAim" | "screenFlash") =>
      on(tag, c => { s[key] = !!c.value; act.sound("sound/feedback/ui_confirm.ogg"); act.changed(); });
    check("show_damage", "damageNumbers");
    check("monster_health", "healthBars");
    check("auto_target", "autoAim");
    check("show_damage_effects", "screenFlash");
    await this.languages(ui);
    on("keyboard_mouse", () => act.sound("sound/feedback/ui_confirm.ogg"));
    on("keyboard_only", () => act.sound("sound/feedback/ui_confirm.ogg"));
    on("dismiss", () => this.close());
    on("return", () => { this.close(); act.returnToHaven(); });
    on("quit", () => { this.close(); act.quit(); });

    const [video, game, keys] = await Promise.all([this.ui_("ui/options/advanced_video.dat"), this.ui_("ui/options/advanced_game.dat"),
      KeyBindings.build(this.ctx, s, { changed: () => act.changed(), sound: f => act.sound(f), back: () => this.showScheme() })]);
    this.keys = keys;
    await Promise.all([this.buildGeneral(ui), this.buildControls(ui), this.buildSaveTab(ui),
      video && this.buildAdvanced(video, "render_effects", [["fog", "Fog"], ["shadows", "Character Shadows"],
        ["decals", "Projected Shade (Roofs, Trees)"], ["showFps", "Show Frame Rate"]]),
      game && this.buildAdvanced(game, "auto_advance", [["minimap", "Show Minimap"], ["controlsHint", "Show Controls Hint"], ["mouseMove", "Hold Left Button to Move"]])]);
    if (video) {
      const fx = video.find("render_effects");
      if (fx) this.bindFlag(fx, "particles");
      const l = findLabelOf(video, "render_effects");
      if (l) l.text = "Particle Effects";
    }
    this.advancedVideo = video;
    this.advancedGame = game;
    on("edit_advanced", () => { act.sound("sound/feedback/ui_open.ogg"); if (video) this.pushOverlay(video); });
    on("edit_advanced_game", () => { act.sound("sound/feedback/ui_open.ogg"); if (game) this.pushOverlay(game); });
    on("custom", () => { act.sound("sound/feedback/ui_confirm.ogg"); this.showCustom(); });
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
    if (codes.length === 1) { const box = ui.find("language_container"); if (box) box.visible = false; return; }
    await setComboItems(this.ctx, combo, codes.map(own), Math.max(0, codes.indexOf(this.settings.locale)));
    combo.onAction = c => {
      const code = codes[c.selectedIndex] ?? "";
      if (code === this.settings.locale) return;
      this.settings.locale = code;
      this.actions.sound("sound/feedback/ui_confirm.ogg");
      this.actions.changed();
    };
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

  /** General: master volume over the game's three, and a mute check box under them. */
  private async buildGeneral(ui: Component) {
    const music = ui.find("music_volume");
    const table = music && findParent(ui, c => c.children.includes(music));
    if (!table) return;
    table.children.unshift(...await this.sliderRow(ui, "masterVolume", "Master Volume"));
    const box = ui.find("show_damage"), boxTable = box && findParent(ui, c => c.children.includes(box));
    const label = boxTable?.children[boxTable.children.indexOf(box!) - 1];
    if (!box || !label) return;
    const [l, b] = await Promise.all([buildComponentConfig(this.ctx, { ...label.config, text: "Mute All Sound" }, label.local),
      buildComponentConfig(this.ctx, { ...box.config, tag: "muted" }, box.local)]);
    l.constraints = table.children[0]?.constraints ?? null;
    b.constraints = table.children[1]?.constraints ?? null;
    this.bindFlag(b, "muted");
    table.children.push(l, b);
  }

  /** Controls: the camera and gamepad sliders under the scheme buttons, and the custom page. */
  private async buildControls(ui: Component) {
    const host = ui.find("controls");
    const scheme = host?.children[0];
    if (!host || !scheme) return;
    this.controls = { host, scheme, custom: this.keys?.root ?? null };
    if (this.keys) this.keys.root.constraints = scheme.constraints;
    const music = ui.find("music_volume");
    const table = music && findParent(ui, c => c.children.includes(music));
    if (!table) return;
    const rows = (await Promise.all([this.sliderRow(ui, "cameraSpeed", "Camera Turn Speed"), this.sliderRow(ui, "zoom", "Camera Distance"),
      this.sliderRow(ui, "deadZone", "Stick Dead Zone")])).flat();
    const sub = await buildComponentConfig(this.ctx, { ...table.config, layout: { ...table.config.layout, children: [] } }, table.local);
    sub.children = rows;
    sub.constraints = scheme.children.find(k => k.tag === "custom")?.constraints ?? null;
    const note = scheme.children.findIndex(k => k.kind === "label");
    scheme.children.splice(note < 0 ? scheme.children.length : note, 0, sub);
  }

  private showCustom() {
    const c = this.controls;
    if (!c?.custom) return;
    this.selectTab("Controls");
    c.host.children = [c.custom];
    this.keys?.refresh();
    const custom = this.ui?.find("custom");
    if (custom) custom.value = false;
  }

  private showScheme() {
    const c = this.controls;
    if (!c) return;
    this.keys?.cancel();
    c.host.children = [c.scheme];
  }

  /**
   * The Prompts tab (hidden: nothing behind it here) becomes the Levels tab: how many of the
   * game's server-side levels the player has collected, by group (src/game/levels.ts).
   */
  private levelsTab(ui: Component) {
    const pane = ui.find("pane"), buttons = pane?.parts.buttons;
    if (!pane || !buttons) return;
    const i = buttons.children.findIndex(b => b.text === "Prompts");
    const proto = findTextLabel(pane.tabs[0] ?? pane);
    if (i < 0 || !pane.tabs[i] || !proto) return;
    buttons.children[i].text = "Levels";
    buttons.children[i].visible = true;
    const page = new Component("container", null);
    page.layout = column("CENTER", 10);
    page.constraints = pane.tabs[i].constraints;
    pane.tabs[i] = page;
    if (pane.selectedIndex === i) pane.children = [pane.parts.top!, page];
    this.levels = { page, proto };
  }

  /** Collected / total per group, from the cached scenes' names. */
  private fillLevels() {
    if (!this.levels) return;
    const { page, proto } = this.levels;
    const list = checklist(this.actions.sceneNames());
    const label = (text: string) => {
      const c = new Component("label", null);
      c.styles = proto.styles; c.local = proto.local; c.fontFamily = proto.fontFamily; c.states = proto.states;
      c.text = text;
      c.constraints = { fixed: true };
      return c;
    };
    const names = new Component("container", null), counts = new Component("container", null);
    names.layout = column("LEFT", 4);
    counts.layout = column("RIGHT", 4);
    names.children = [...list.groups.map(g => label(g.title)), label("All levels")];
    counts.children = [...list.groups.map(g => label(`${g.have.length} / ${g.have.length + g.missing.length}`)), label(`${list.have} / ${list.total}`)];
    const table = new Component("container", null);
    table.layout = { $class: "LayoutConfig$HorizontalGroup", policy: { name: "NONE" }, justification: { name: "CENTER" },
      offAxisPolicy: { name: "NONE" }, offAxisJustification: { name: "TOP" }, gap: 24 };
    table.children = [names, counts];
    for (const k of table.children) k.constraints = { fixed: true };
    table.constraints = { fixed: true };
    page.children = [label("Levels collected from the game's scene cache"), table,
      ...(list.guildHalls ? [label(`Guild halls: ${list.guildHalls} archived`)] : []), label("npm run levels lists where to find each one")];
  }

  /** Save Data (in the Steam tab's place): what the save holds, export, import and reset. */
  private async buildSaveTab(ui: Component) {
    const pane = ui.find("pane");
    const tabButton = pane?.parts.buttons?.children.find(b => b.text === "Steam");
    const page = tabButton && pane!.tabs[pane!.parts.buttons!.children.indexOf(tabButton)];
    const root = page?.children[0];
    const table = root?.children[0];
    const box = page?.find("enable_voice_chat");
    const label = table?.children[0];
    const blue = ui.find("edit_advanced"), orange = ui.find("scalemax");
    if (!tabButton || !root || !table || !label || !box || !blue || !orange) return;
    tabButton.text = "Save Data";
    const valueCfg = { ...label.config, text: "", style: { $class: CONFIG_REF, name: "Default/Label" } };
    const rows: [string, string][] = [["crowns", "Crowns"], ["heat", "Heat"], ["owned", "Items Owned"], ["depth", "Deepest Depth"], ["runs", "Runs"]];
    const summary = await Promise.all(rows.map(async ([tag, text]) => {
      const [l, v] = await Promise.all([buildComponentConfig(this.ctx, { ...label.config, text }, label.local),
        buildComponentConfig(this.ctx, { ...valueCfg, tag: `save_${tag}` }, label.local)]);
      l.constraints = label.constraints;
      v.constraints = box.constraints;
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
    const buttons = await Promise.all([button(blue.config, blue.local, "save_export", "Export Save", () => this.exportSave()),
      button(blue.config, blue.local, "save_import", "Import Save", () => this.importSave()),
      button(orange.config, orange.local, "save_reset", "Reset Save", () => this.confirmReset()),
      button(orange.config, orange.local, "save_unlock", "Unlock All Gear", () => this.confirmUnlock())]);
    const row = await buildComponentConfig(this.ctx, { ...table.config, tag: "save_buttons",
      layout: { $class: "LayoutConfig$HorizontalGroup", policy: { name: "NONE" }, justification: { name: "LEFT" }, offAxisPolicy: { name: "NONE" }, gap: 10, children: [] } },
    table.local);
    row.children = buttons;
    row.constraints = table.constraints;
    root.children = [table, note, row];
    // the page's second table (voice volume) is gone with the rest of Steam's page
  }

  private refreshSummary() {
    const d = loadSave();
    const set = (tag: string, v: string | number) => { const c = this.summary.get(tag); if (c) c.text = String(v); };
    set("crowns", d.crowns.toLocaleString("en-US"));
    set("heat", d.heat.toLocaleString("en-US"));
    set("owned", d.owned.length);
    set("depth", d.bestDepth);
    set("runs", d.runs);
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
          writeSave(data);
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
    void this.prompt("Reset Save", "Delete this browser's save and start over? This cannot be undone.", () => {
      try { localStorage.removeItem(SAVE_KEY); } catch { /* storage unavailable */ }
      this.replaced();
    });
  }

  private replaced() {
    const d = loadSave();
    this.actions.saveReplaced?.(d);
    this.refreshSummary();
  }

  /**
   * The game's confirmation window (ui/window/confirm_prompt): OK runs `accept`; with no
   * `accept` it is a notice with OK alone.
   */
  private async prompt(title: string, text: string, accept: (() => void) | null) {
    const o = await buildUi(this.ctx, uiRef("ui/window/confirm_prompt/interface.dat"));
    if (!o) return;
    const set = (tag: string, v: string) => { const c = o.find(tag); if (c) c.text = v; };
    set("title", title);
    set("prompt", text);
    const confirm = o.find("confirm"), cancel = o.find("cancel"), ok = o.find("accept"), dismiss = o.find("dismiss");
    if (confirm) confirm.visible = false;
    if (cancel) { cancel.visible = !!accept; cancel.onAction = () => this.popOverlay(o); }
    if (dismiss) dismiss.onAction = () => this.popOverlay(o);
    if (ok) ok.onAction = () => { this.overlays = this.overlays.filter(x => x !== o); this.actions.sound("sound/feedback/ui_confirm.ogg"); accept?.(); };
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
    toSlider(ui.find("ui_scale"), Math.max(0, Math.min(1, (s.hudScale - 0.75) / 0.75)));
    for (const [key, { slider, label }] of this.ranges) {
      const r = RANGES[key];
      toSlider(slider, Math.max(0, Math.min(1, (s[key] - r.min) / (r.max - r.min))));
      if (label) label.text = r.fmt(s[key]);
    }
    for (const [key, list] of this.flags) for (const c of list) c.value = s[key];
    set("camera_shake", s.screenFlash);
    set("show_damage", s.damageNumbers);
    set("monster_health", s.healthBars);
    set("auto_target", s.autoAim);
    set("show_damage_effects", s.screenFlash);
    set("keyboard_mouse", true);
    if (ui === this.ui) {
      this.setQualityLabel(ui);
      this.setScaleLabel(ui);
      this.refreshSummary();
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
    for (const ui of [this.ui, ...this.overlays]) {
      if (!ui) continue;
      if (ui !== this.ui) { g.fillStyle = "rgba(4,10,18,0.45)"; g.fillRect(0, 0, cw, ch); }
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

/** The label before a tagged control in its table. */
function findLabelOf(root: Component, tag: string): Component | null {
  const c = root.find(tag), t = c && findParent(root, p => p.children.includes(c));
  const l = t?.children[t.children.indexOf(c!) - 1];
  return l?.kind === "label" ? l : null;
}

/** A vertical group with its children at their preferred sizes. */
const column = (align: string, gap: number) => ({ $class: "LayoutConfig$VerticalGroup", policy: { name: "NONE" },
  justification: { name: "CENTER" }, offAxisPolicy: { name: "NONE" }, offAxisJustification: { name: align }, gap });

/** The first visible label with text: its style is the window's text style. */
function findTextLabel(c: Component): Component | null {
  if (c.kind === "label" && c.visible && c.text && c.styles[0]) return c;
  for (const k of c.children) { const r = findTextLabel(k); if (r) return r; }
  return null;
}
