// A reimplementation of Clyde's GUI toolkit (com.threerings.opengl.gui) for user interface
// configs (UserInterfaceConfig .dat files), drawn on a 2D canvas. Layout follows Clyde's
// layout managers (GroupLayout, AnchorLayout, AbsoluteLayout, BorderLayout) and component
// sizing, in Clyde's coordinate system: y grows upward and positions are relative to the
// parent. Styles come from the interface's own config group, then config/style.dat.

import { applyArguments, CONFIG_REF } from "../config/params";
import { recolorPixels, type ColorPository } from "../colors";
import type { ModelLoader } from "../model";
import type { Vfs } from "../vfs";

const kind = (o: any) => { const c: string = o?.$class ?? ""; return c.substring(Math.max(c.lastIndexOf("."), c.lastIndexOf("$")) + 1); };
const enumName = (e: any, dflt: string) => (e?.name as string | undefined) ?? dflt;

export interface Insets { top: number; left: number; bottom: number; right: number }
const ZERO: Insets = { top: 0, left: 0, bottom: 0, right: 0 };
const insets = (c: any): Insets => c ? { top: c.top ?? 0, left: c.left ?? 0, bottom: c.bottom ?? 0, right: c.right ?? 0 } : ZERO;
const horiz = (i: Insets) => i.left + i.right, vert = (i: Insets) => i.top + i.bottom;

export interface GuiImage { source: CanvasImageSource; width: number; height: number }

export interface Background {
  kind: "image" | "solid";
  image?: GuiImage;
  mode: string;
  anchor: string;
  frame: Insets | null;
  color?: [number, number, number, number];
}

/** A resolved StyleConfig$Original. */
export interface Style {
  color: [number, number, number, number];
  font: string;
  fontStyle: string;
  fontSize: number;
  textEffect: string;
  effectSize: number;
  effectColor: [number, number, number, number];
  textAlignment: string;
  verticalAlignment: string;
  lineSpacing: number;
  padding: Insets;
  /** The padding grown by the border's thickness (Component._insets). */
  insets: Insets;
  background: Background | null;
  /** A BorderConfig: Solid draws a line around the component, Blank only pads. */
  border: { thickness: number; color: [number, number, number, number] | null } | null;
  icon: GuiImage | null;
  size: { width: number; height: number } | null;
}

const color4 = (c: any, d: [number, number, number, number]): [number, number, number, number] =>
  c ? [c.r ?? 1, c.g ?? 1, c.b ?? 1, c.a ?? 1] : d;

/** Shared resources: config libraries, fonts and decoded (optionally recolored) images. */
export class GuiContext {
  private styles: Promise<Map<string, any>>;
  private fonts: Promise<Map<string, string>>;
  private images = new Map<string, Promise<GuiImage | null>>();
  private loadedFonts = new Map<string, Promise<string>>();

  constructor(readonly loader: ModelLoader, readonly vfs: Vfs, readonly colors: Promise<ColorPository | null>) {
    const lib = (file: string) => loader.importFile(file).then(root => {
      const list: any[] = Array.isArray(root) ? root : (root as any)?.array ?? [];
      return new Map(list.map(c => [c.name as string, c]));
    });
    this.styles = lib("config/style.dat");
    this.fonts = lib("config/font.dat").then(m => new Map([...m].map(([k, v]) => [k, v.implementation?.file as string])));
  }

  /** CSS font family for a FontConfig name, loading its .ttf from the install once. */
  font(name: string): Promise<string> {
    let p = this.loadedFonts.get(name);
    if (!p) {
      p = (async () => {
        const file = (await this.fonts).get(name);
        const family = `sk-${name.replace(/\W+/g, "-")}`;
        if (!file) return "sans-serif";
        try {
          const bytes = await this.vfs.read(file);
          const face = new FontFace(family, bytes.slice().buffer);
          await face.load();
          (document.fonts as any).add(face);
          return `"${family}"`;
        } catch { return "sans-serif"; }
      })();
      this.loadedFonts.set(name, p);
    }
    return p;
  }

  image(file: string | null | undefined, colorizations?: any[]): Promise<GuiImage | null> {
    if (!file) return Promise.resolve(null);
    const zs = (colorizations ?? []).filter(Boolean);
    const key = zs.length ? file + "|" + JSON.stringify(zs, (k, v) => (k === "$outer" ? undefined : v)) : file;
    let p = this.images.get(key);
    if (!p) {
      p = (async () => {
        try {
          const bmp = await createImageBitmap(await this.vfs.blob(file), { premultiplyAlpha: "none" });
          const pos = zs.length ? await this.colors : null;
          if (!pos) return { source: bmp, width: bmp.width, height: bmp.height };
          const canvas = new OffscreenCanvas(bmp.width, bmp.height);
          const g = canvas.getContext("2d", { willReadFrequently: true })!;
          g.drawImage(bmp, 0, 0);
          const img = g.getImageData(0, 0, bmp.width, bmp.height);
          recolorPixels(img.data, zs.map(z => pos.resolve(z)));
          g.putImageData(img, 0, 0);
          return { source: canvas, width: bmp.width, height: bmp.height };
        } catch { return null; }
      })();
      this.images.set(key, p);
    }
    return p;
  }

  /** Finds a StyleConfig by name in the local groups, then the global library. */
  async styleConfig(name: string, local: Map<string, any>): Promise<any | null> {
    return local.get(name) ?? (await this.styles).get(name) ?? null;
  }

  /**
   * Resolves a style reference to its Original implementation with arguments applied,
   * following Derived styles. Returns null when the style does not exist.
   */
  async resolveStyle(ref: any, local: Map<string, any>, depth = 0): Promise<Style | null> {
    if (!ref?.name || depth > 10) return null;
    const base = await this.styleConfig(ref.name, local);
    if (!base) return null;
    const cfg = applyArguments(base, ref);
    const impl = cfg.implementation;
    // a derived style's reference resolves in the library that holds it
    if (kind(impl) === "Derived") return this.resolveStyle(impl.style, local.has(ref.name) ? local : new Map(), depth + 1);
    return this.makeStyle(impl ?? {});
  }

  private async makeStyle(o: any): Promise<Style> {
    const bg = o.background;
    let background: Background | null = null;
    if (bg) {
      const k = kind(bg);
      if (k === "Solid") background = { kind: "solid", mode: "", anchor: "", frame: null, color: color4(bg.color, [0, 0, 0, 1]) };
      else if (k === "Image" || k === "ColorizedImage") {
        const image = await this.image(bg.file, k === "ColorizedImage" ? bg.colorizations : undefined);
        if (image) {
          const mode = enumName(bg.mode, "SCALE_XY");
          let frame = mode.startsWith("FRAME") && bg.frame ? insets(bg.frame) : null;
          // ImageBackground: a frame mode without insets uses a third of the image per side
          if (mode.startsWith("FRAME") && !frame) {
            const tw = Math.floor(image.width / 3), th = Math.floor(image.height / 3);
            frame = { left: tw, right: tw, top: th, bottom: th };
          }
          background = { kind: "image", image, mode, anchor: enumName(bg.anchor, "LOWER_LEFT"), frame };
        }
      }
    }
    // Component.updateFromStyleConfig: a border's adjustInsets grows the padding on every side
    const padding = insets(o.padding);
    const bk = o.border ? kind(o.border) : "";
    const border = bk === "Solid" || bk === "Blank"
      ? { thickness: o.border.thickness ?? 1, color: bk === "Solid" ? color4(o.border.color, [0, 0, 0, 1]) : null } : null;
    const t = border?.thickness ?? 0;
    return {
      color: color4(o.color, [1, 1, 1, 1]),
      font: o.font ?? "Arial",
      fontStyle: enumName(o.fontStyle, "PLAIN"),
      fontSize: o.fontSize ?? 12,
      textEffect: enumName(o.textEffect, "NONE"),
      effectSize: o.effectSize ?? 1,
      effectColor: color4(o.effectColor, [1, 1, 1, 1]),
      textAlignment: enumName(o.textAlignment, "LEFT"),
      verticalAlignment: enumName(o.verticalAlignment, "CENTER"),
      lineSpacing: o.lineSpacing ?? 0,
      padding,
      insets: { top: padding.top + t, left: padding.left + t, bottom: padding.bottom + t, right: padding.right + t },
      background,
      border,
      icon: o.icon ? await this.icon(o.icon) : null,
      size: o.size ? { width: o.size.width ?? 0, height: o.size.height ?? 0 } : null,
    };
  }

  icon(cfg: any): Promise<GuiImage | null> {
    if (!cfg) return Promise.resolve(null);
    const k = kind(cfg);
    if (k === "Image" || k === "ColorizedImage") return this.image(cfg.file, k === "ColorizedImage" ? cfg.colorizations : undefined);
    return Promise.resolve(null);
  }
}

// ----------------------------------------------------------------------------- messages

// The game's message bundles (rsrc/i18n) are not in the install, so translation keys are shown
// as English made from the key itself: a few curated phrases and a humanizing fallback.
const MESSAGES: Record<string, string> = {
  ok: "OK", disp_apply: "Apply", disp_cancel: "Cancel", logoff: "Log Off", guildhall: "Guild Hall",
  allowfriends: "Allow Friends", allowguild: "Allow Guild", inviteonly: "Invite Only", opentoall: "Open to All",
  joinaparty: "Join a Party", startaparty: "Start a Party", unusedrecipes: "Unused Recipes",
  "eu-west": "EU West", "us-east": "US East", cs_custom: "Custom", ld_hud_arrows: "HUD Arrows",
  auto_target_default: "Auto-Target by Default", party_with_any: "Party with Anyone",
  some_options_restart: "Some options take effect after a restart.", report_bug: "Report a Bug",
  add_more_bonuses: "Add More Bonuses", add_more_success: "Add More Success", apply_crystals: "Apply Crystals",
  intro_pref: "Preferences", intro_type: "Type", intro_arcade: "Arcade", intro_expansion: "Expansion",
  intro_prestige: "Prestige", intro_rank: "Rank", edit_advanced: "Advanced", edit_beta: "Beta",
  characteroptions: "Character Options", feed_sprite: "Feed Sprite", pet_skillpoints: "Skill Points",
};
const ACRONYMS = new Set(["ui", "hud", "npc", "pvp", "pve", "eu", "us", "id", "fps", "fov", "xp", "hp", "aoe", "dps"]);
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);

/** True for text that looks like a MessageBundle key ("m.music_volume", "%town:m.border_bazaar"). */
export const isMessageKey = (text: string) => /^(%[\w./-]+:)?[mbtl]\.[\w.\-|]+$/.test(text);

/**
 * English for a message key: "m.music_volume" is "Music Volume", "b.disp_apply" "Apply",
 * "%town:m.border_guildhall" "Guild Hall", "m.party_found.1" "Party Found". A tainted string
 * ("~text") is returned as written, as MessageBundle.xlate does.
 */
export function messageText(key: string): string {
  if (key.startsWith("~")) return key.substring(1);
  // a compound key carries its arguments after "|"; a qualified key names its bundle after "%"
  let k = key.split("|")[0].replace(/^%[^:]*:/, "").replace(/^[mbtlx]\./, "");
  k = k.split(".").filter(s => !/^\d+$/.test(s)).join("_").replace(/^(border|disp)_(?=.)/, "");
  const known = MESSAGES[k] ?? MESSAGES[key.replace(/^%[^:]*:/, "").replace(/^[mbtlx]\./, "")];
  if (known) return known;
  return k.split(/[_\s]+/).filter(Boolean).map((w, i) => {
    const lw = w.toLowerCase();
    if (ACRONYMS.has(lw)) return lw.toUpperCase();
    if (i > 0 && SMALL_WORDS.has(lw)) return lw;
    return lw.charAt(0).toUpperCase() + lw.substring(1);
  }).join(" ");
}

/** ComponentConfig.getMessage: keys become readable text, anything else stays as written. */
const message = (text: string | undefined | null) => !text ? "" : isMessageKey(text) ? messageText(text) : text;

// ----------------------------------------------------------------------------- components

/** Component._offset: a 2D transform about the component's centre, set by scripts. */
export interface Offset { tx: number; ty: number; rotation: number; scale: number }

type CompKind = "container" | "spacer" | "label" | "button" | "ui" | "view"
  | "scrollpane" | "viewport" | "scrollbar" | "tabbedpane" | "combo" | "slider" | "text" | "list" | "popup" | "menuitem";

/**
 * Style pseudo-classes by state: Component's three, Button's Down, then ToggleButton's four
 * selected states. A missing state style falls back to Selected (for the selected variants)
 * or to the default style, as getFallbackState does.
 */
const STATES = ["", "Hover", "Disabled", "Down", "Selected", "HoverSelected", "DownSelected", "DisabledSelected"] as const;
const fallbackState = (i: number) => i >= 5 ? 4 : 0;

/** BoundedRangeModel: min <= value <= value + extent <= max. */
export class RangeModel {
  /** BoundedSnappingRangeModel's step (0 when values do not snap). */
  snap = 0;
  constructor(public min = 0, public value = 0, public extent = 0, public max = 100) {}
  get range() { return this.max - this.min; }
  /** getScrollIncrement: half the extent, or the snap step. */
  get scrollIncrement() { return this.snap > 0 ? this.snap : Math.max(1, Math.trunc(this.extent / 2)); }
  /** Clamps to min <= value <= max - extent; returns true when the value changed. */
  setValue(value: number): boolean {
    if (this.snap > 0) value -= value % this.snap;
    const old = this.value;
    this.setRange(this.min, Math.min(this.max - this.extent, Math.max(this.min, value)), this.extent, this.max);
    return this.value !== old;
  }
  setRange(min: number, value: number, extent: number, max: number) {
    min = Math.min(min, max);
    max = Math.max(max, value);
    min = Math.min(min, value);
    extent = Math.max(Math.min(extent, max - value), 0);
    this.min = min; this.value = value; this.extent = extent; this.max = max;
  }
}

/** A BoundedRangeModelConfig (Snapping included), with the config's defaults. */
function rangeModel(cfg: any): RangeModel {
  const m = new RangeModel(cfg?.min ?? 0, cfg?.value ?? 0, cfg?.extent ?? 10, cfg?.max ?? 100);
  if (kind(cfg) === "Snapping") m.snap = cfg.snap ?? 0;
  return m;
}

export type ComponentValue = number | string | boolean;

export class Component {
  x = 0; y = 0; width = 0; height = 0;
  children: Component[] = [];
  /** The child entry this component was added with (meaning depends on the parent layout). */
  constraints: any = null;
  /** A container's LayoutConfig (synthesized for the widgets Clyde builds from containers). */
  layout: any = null;
  /** Styles by state (see STATES): the named style plus Name:Hover, Name:Disabled... */
  styles: (Style | null)[] = [null, null, null];
  /** How many of STATES this component has: 3, 4 for buttons, 8 for toggle buttons. */
  states = 3;
  /** Pseudo-class styles (Name:Empty, Name:Selected...) loaded with loadPseudo. */
  pseudo = new Map<string, Style | null>();
  /** A pseudo-class to render with instead of the state's style, e.g. "Empty". */
  pseudoClass: string | null = null;
  preferredSize: { width: number; height: number } | null = null;
  text = "";
  icon: GuiImage | null = null;
  /** The icon comes from the current state's style (CheckBox, and the Slider's frob). */
  stateIcons = false;
  iconTextGap = 3;
  orientation = "HORIZONTAL";
  fit = "WRAP";
  preferredWidth = 0;
  visible = true;
  enabled = true;
  /** Hit tests pass through a component that is not hoverable (ComponentConfig.hoverable). */
  hoverable = true;
  alpha = 1;
  tag = "";
  fontFamily = "sans-serif";
  /** The RenderableView config, for portrait cameras. */
  view: any = null;
  /** Local style configs of the interface this component came from. */
  local = new Map<string, any>();
  styleRef: any = null;
  offset: Offset | null = null;
  /** For an interface's host component: its InterfaceScriptConfigs by name. */
  scripts = new Map<string, any>();
  /** For an interface's host component: actions run when it is added to the screen. */
  addAction: any = null;
  /** The mouse is over this component (buttons draw their hover style). */
  hover = false;
  /** Where render() last drew this component, in canvas pixels (top-left origin). */
  screen: { x: number; y: number; width: number; height: number } | null = null;
  /** Which game view draws into this RenderableView (set by the HUD). */
  viewOwner = "";

  /** A button pressed with the pointer still over it (AbstractButton._armed). */
  armed = false;
  /** ToggleButton and CheckBox selection. */
  selected = false;
  /** ComponentConfig.Button.action, reported to onAction when the button is clicked. */
  action = "";
  /** Slider and ScrollBar model; a viewport's vertical and horizontal models. */
  model: RangeModel | null = null;
  vmodel: RangeModel | null = null;
  hmodel: RangeModel | null = null;
  /** ComboBox items and List values. */
  items: { text: string; icon: GuiImage | null }[] = [];
  /** The selected combo item, tab or list entry (-1 for none). */
  selectedIndex = -1;
  /** ComboBox popup rows and columns (ComboBox.setPreferredDimensions). */
  rows = 8; columns = 1;
  /** TabbedPane pages; only the selected one is a child. */
  tabs: Component[] = [];
  /** A child drawn after the others (the tab row draws the selected tab on top). */
  topChild = -1;
  /** ScrollPane.setShowScrollbarAlways. */
  showAlways = true;
  /** The widget that owns an internal part: a scroll bar's well, a tab button, a menu item. */
  owner: Component | null = null;
  /** Named internal parts: viewport, vbar, hbar, well, thumb, less, more, top, buttons. */
  parts: Partial<Record<string, Component>> = {};
  /** A ComboBox's popup menu, built with it. */
  popup: Component | null = null;
  /** On a root passed to dispatch(): the open popup menu, drawn over the tree. */
  overlay: Component | null = null;
  /** TextField: placeholder, maximum length, password display and keyboard focus. */
  placeholder = "";
  maxLength = 0;
  password = false;
  focused = false;
  /**
   * App hook: called with this component or a descendant and an action ("click" or the
   * button's action, "select" for combos and tabs, "change" for sliders and text, "enter").
   */
  onAction: ((c: Component, action: string) => void) | null = null;
  constructor(readonly kind: CompKind, public config: any) {}

  /** Component/Button/ToggleButton.getState: an index into STATES. */
  get state(): number {
    let s = this.enabled ? (this.hover ? 1 : 0) : 2;
    if (this.states >= 4 && this.armed && s !== 2) s = 3;
    if (this.states >= 8 && this.selected) s = s === 2 ? 7 : s === 1 ? 5 : this.armed ? 6 : 4;
    return s;
  }

  get style(): Style | null {
    if (this.pseudoClass) {
      const s = this.pseudo.get(this.pseudoClass);
      if (s) return s;
    }
    return this.styles[this.state] ?? this.styles[0];
  }
  get insets(): Insets { return this.style?.insets ?? ZERO; }

  /**
   * The value app code reads and sets: a slider's or scroll bar's model value, the selected
   * combo item, tab or list entry, a toggle button's or check box's selection, a text field's text.
   */
  get value(): ComponentValue {
    switch (this.kind) {
      case "slider": case "scrollbar": return this.model!.value;
      case "combo": case "tabbedpane": case "list": return this.selectedIndex;
      case "button": return this.selected;
      default: return this.text;
    }
  }
  set value(v: ComponentValue) {
    switch (this.kind) {
      case "slider": case "scrollbar": this.model!.setValue(Number(v)); break;
      case "combo": selectItem(this, Number(v)); break;
      case "tabbedpane": selectTab(this, Number(v)); break;
      case "list": selectEntry(this, Number(v)); break;
      case "button": this.selected = !!v; break;
      default: this.text = String(v);
    }
  }

  /** Sets alpha on this component and, as Clyde's Container does, every descendant. */
  setAlpha(a: number) { this.alpha = a; for (const c of this.children) c.setAlpha(a); }

  find(tag: string): Component | null {
    if (this.tag === tag) return this;
    for (const c of this.children) { const r = c.find(tag); if (r) return r; }
    // the pages of a tabbed pane that are not showing
    for (const c of this.tabs) if (!this.children.includes(c)) { const r = c.find(tag); if (r) return r; }
    return null;
  }
}

export interface BuildOptions {
  /** Extra arguments merged into the reference of a nested interface, keyed by its tag. */
  overrides?: Map<string, Record<string, unknown>>;
}

/** Builds a component tree from a UserInterfaceConfig reference. */
export async function buildInterface(ctx: GuiContext, ref: any, opts: BuildOptions = {}, depth = 0): Promise<Component | null> {
  if (!ref?.name || depth > 12) return null;
  let cfg: any;
  try { cfg = applyArguments(await ctx.loader.importFile(ref.name), ref); } catch { return null; }
  const impl = cfg.implementation;
  if (kind(impl) === "Derived") return buildInterface(ctx, impl.userInterface, opts, depth + 1);
  const local = new Map<string, any>();
  const scripts = new Map<string, any>();
  for (const g of cfg.configs?.groups ?? []) for (const c of g.configs ?? []) {
    if (kind(c) === "StyleConfig") local.set(c.name, c);
    else if (kind(c) === "InterfaceScriptConfig") scripts.set(c.name, c);
  }
  // a UserInterface component hosts its root in a BorderLayout's centre
  const host = new Component("ui", null);
  host.local = local;
  host.scripts = scripts;
  host.addAction = impl?.addAction ?? null;
  const root = impl?.root ? await buildComponent(ctx, impl.root, local, opts, depth) : null;
  if (root) host.children.push(root);
  return host;
}

const DEFAULT_STYLES: Record<CompKind, string> = {
  container: "Default/Container", spacer: "Default/Component", label: "Default/Label",
  button: "Default/Button", ui: "Default/Container", view: "Default/Component",
  scrollpane: "Default/Container", viewport: "Default/Viewport", scrollbar: "Default/ScrollBarV",
  tabbedpane: "Default/TabbedPane", combo: "Default/ComboBox", slider: "Default/HSlider", text: "Default/TextField",
  list: "Default/List", popup: "Default/PopupMenu", menuitem: "Default/MenuItem",
};

const ref = (name: string) => ({ $class: CONFIG_REF, name });

/**
 * Component.setStyleConfig: the named style and its state pseudo-classes, each missing state
 * falling back as getFallbackState says; with no style, the component's default.
 */
async function setStyle(ctx: GuiContext, c: Component, sref: any, local: Map<string, any>, dflt: string) {
  sref ??= ref(dflt);
  c.styleRef = sref;
  const res = await Promise.all(STATES.slice(0, c.states).map((st, i) =>
    ctx.resolveStyle(i === 0 ? sref : { ...sref, name: `${sref.name}:${st}` }, local)));
  res[0] ??= await ctx.resolveStyle(ref(dflt), local);
  for (let i = 1; i < res.length; i++) res[i] ??= res[fallbackState(i)];
  c.styles = res;
  // the style's size applies first; the component's own preferred size overrides it
  if (res[0]?.size) c.preferredSize = { ...res[0].size };
  if (res[0]) c.fontFamily = await ctx.font(res[0].font);
}

/** A part Clyde creates in code (a scroll bar's well, a tab button), styled by name. */
async function part(ctx: GuiContext, k: CompKind, style: any, local: Map<string, any>, owner: Component | null, states = 3, dflt = DEFAULT_STYLES[k]) {
  const c = new Component(k, null);
  c.local = local;
  c.states = states;
  c.owner = owner;
  await setStyle(ctx, c, typeof style === "string" ? ref(style) : style, local, dflt);
  return c;
}

// LayoutConfig objects for the layouts Clyde's widgets set up in code
const enm = (name: string) => ({ name });
const BORDER = { $class: "LayoutConfig$Border", horizontalGap: 0, verticalGap: 0 };
const at = (location: string) => ({ location: enm(location) });
const hgroup = (policy: string, just: string, off: string, gap = 5) =>
  ({ $class: "LayoutConfig$HorizontalGroup", policy: enm(policy), justification: enm(just), offAxisPolicy: enm(off), gap });
const vgroup = (policy: string, just: string, off: string, gap = 5) =>
  ({ $class: "LayoutConfig$VerticalGroup", policy: enm(policy), justification: enm(just), offAxisPolicy: enm(off), gap });
const FIXED = { fixed: true };

async function buildComponent(ctx: GuiContext, cfg: any, local: Map<string, any>, opts: BuildOptions, depth: number): Promise<Component> {
  const k = kind(cfg);
  const ck: CompKind = k === "Container" ? "container" : k === "Label" || k === "StatusLabel" || k === "FadeLabel" || k === "TextArea" ? "label"
    : k === "Button" || k === "ToggleButton" || k === "CheckBox" ? "button" : k === "UserInterface" ? "ui"
    : k === "RenderableView" ? "view" : k === "ScrollPane" ? "scrollpane" : k === "ScrollBar" ? "scrollbar"
    : k === "TabbedPane" ? "tabbedpane" : k === "ComboBox" ? "combo" : k === "Slider" ? "slider"
    : k === "TextField" || k === "PasswordField" || k === "TextEditor" ? "text" : k === "List" ? "list" : "spacer";
  let c: Component;
  if (ck === "ui") {
    let uref = cfg.userInterface;
    const extra = cfg.tag ? opts.overrides?.get(cfg.tag) : undefined;
    if (uref && extra) {
      const entries = [...((uref.arguments?.entries ?? []) as [string, unknown][]).filter(([kk]) => !(kk in extra)), ...Object.entries(extra)];
      uref = { ...uref, arguments: { $map: "com.threerings.config.ArgumentMap", entries } };
    }
    c = (await buildInterface(ctx, uref, opts, depth + 1)) ?? new Component("ui", cfg);
    c.config = cfg;
  } else {
    c = new Component(ck, cfg);
    c.local = local;
  }
  c.tag = cfg.tag ?? "";
  c.visible = cfg.visible ?? true;
  c.enabled = cfg.enabled ?? true;
  c.hoverable = cfg.hoverable ?? true;
  c.alpha = cfg.alpha ?? 1;
  if (ck === "button") c.states = k === "Button" ? 4 : 8;
  const horizontal = enumName(cfg.orientation, "HORIZONTAL") === "HORIZONTAL";
  // each widget's getDefaultStyleConfig
  const dflt = k === "CheckBox" ? "Default/CheckBox" : k === "TextArea" ? "Default/TextArea"
    : ck === "slider" ? (horizontal ? "Default/HSlider" : "Default/VSlider")
    : ck === "scrollbar" ? (horizontal ? "Default/ScrollBarH" : "Default/ScrollBarV") : DEFAULT_STYLES[ck];
  await setStyle(ctx, c, cfg.style, local, dflt);
  if (cfg.preferredSize) c.preferredSize = { width: cfg.preferredSize.width ?? 0, height: cfg.preferredSize.height ?? 0 };
  if (ck === "label" || ck === "button") {
    c.text = message(cfg.text);
    c.iconTextGap = cfg.iconTextGap ?? 3;
    c.orientation = enumName(cfg.orientation, "HORIZONTAL");
    c.fit = enumName(cfg.fit, "WRAP");
    c.preferredWidth = cfg.preferredWidth ?? 0;
    c.selected = !!cfg.selected;
    c.action = cfg.action ?? "";
    // a check box shows its state's style icon; a button whose default style supplies an icon
    // takes it; a plain label only its own (a status label's style icon is its alert, shown only
    // when a status flashes)
    c.stateIcons = k === "CheckBox";
    c.icon = c.stateIcons ? null : (ck === "button" && c.styles[0]?.icon) ? c.styles[0].icon
      : (await ctx.icon(cfg.icon)) ?? null;
  }
  if (ck === "view") c.view = cfg;
  if (ck === "container") {
    const lay = cfg.layout ?? { $class: "LayoutConfig$Absolute", children: [] };
    c.layout = lay;
    const kids: any[] = lay.children ?? [];
    c.children = await Promise.all(kids.map(async ch => {
      const comp = await buildComponent(ctx, ch.component ?? { $class: "ComponentConfig$Spacer" }, local, opts, depth);
      comp.constraints = ch;
      return comp;
    }));
  }
  if (ck === "slider") {
    // Slider: the style's icon is the frob, drawn over the background along the model
    c.orientation = horizontal ? "HORIZONTAL" : "VERTICAL";
    c.model = rangeModel(cfg.model);
    c.stateIcons = true;
  }
  if (ck === "scrollbar") await initScrollBar(ctx, c, !horizontal, cfg.style ?? null, rangeModel(cfg.model), local);
  if (ck === "scrollpane") {
    const child = await buildComponent(ctx, cfg.child ?? { $class: "ComponentConfig$Spacer" }, local, opts, depth);
    await initScrollPane(ctx, c, child, cfg.vertical ?? true, !!cfg.horizontal, cfg.snap ?? 0, cfg.viewportStyle, local);
    c.showAlways = cfg.showScrollbarAlways ?? true;
  }
  if (ck === "tabbedpane") {
    // TabbedPane: a tab row (_top holding _buttons) to the north, the selected page in the centre
    c.layout = BORDER;
    const top = await part(ctx, "container", null, local, c);
    top.layout = hgroup("STRETCH", "LEFT", "CONSTRAIN");
    const buttons = await part(ctx, "container", null, local, c);
    buttons.layout = hgroup("CONSTRAIN", enumName(cfg.tabAlignment, "LEFT"), "CONSTRAIN", cfg.gap ?? 5);
    top.children = [buttons];
    top.constraints = at("NORTH");
    c.parts = { top, buttons };
    const tabs: any[] = cfg.tabs ?? [];
    buttons.children = await Promise.all(tabs.map(async (tab, i) => {
      const b = await part(ctx, "button", tab.styleOverride ?? cfg.tabStyle ?? null, local, c, 8, "Default/Tab");
      b.text = message(tab.title);
      b.fit = "TRUNCATE";
      b.action = String(i);
      b.icon = b.styles[0]?.icon ?? null;
      return b;
    }));
    c.tabs = await Promise.all(tabs.map(async tab => {
      const page = await buildComponent(ctx, tab.component ?? { $class: "ComponentConfig$Spacer" }, local, opts, depth);
      page.constraints = at("CENTER");
      return page;
    }));
    c.children = [top];
    if (tabs.length) selectTab(c, Math.min(cfg.selected ?? 0, tabs.length - 1));
  }
  if (ck === "combo") {
    c.fit = "TRUNCATE";
    c.items = await Promise.all(((cfg.items ?? []) as any[]).map(async it => kind(it) === "IconItem"
      ? { text: "", icon: await ctx.icon(it.icon) } : { text: message(it.text), icon: null }));
    c.rows = cfg.rows ?? 8;
    c.columns = cfg.columns ?? 1;
    c.popup = await buildPopup(ctx, c, local);
    selectItem(c, cfg.selected ?? 0);
  }
  if (ck === "text") {
    c.text = message(cfg.text);
    c.placeholder = message(cfg.placeholder);
    c.maxLength = cfg.maxLength ?? 0;
    c.password = k === "PasswordField";
  }
  if (ck === "list") {
    // List: a column of ToggleButtons styled Default/ListEntry, one selected at a time
    c.layout = vgroup("NONE", "TOP", "STRETCH");
    const values: string[] = cfg.items ?? [];
    c.children = await Promise.all(values.map(async (v, i) => {
      const b = await part(ctx, "button", "Default/ListEntry", local, c, 8);
      b.text = message(v);
      b.action = String(i);
      return b;
    }));
    selectEntry(c, (cfg.selected ?? 0) < values.length ? cfg.selected ?? 0 : -1);
  }
  return c;
}

/** ScrollBar: a well with a thumb over it and less/more buttons at the ends, around a model. */
async function initScrollBar(ctx: GuiContext, bar: Component, vertical: boolean, sref: any, model: RangeModel, local: Map<string, any>) {
  bar.layout = BORDER;
  bar.model = model;
  bar.orientation = vertical ? "VERTICAL" : "HORIZONTAL";
  // ScrollBar.setStyleConfig: the parts take the bar's style name as a prefix
  const prefix: string = sref?.name ?? (vertical ? "Default/ScrollBarV" : "Default/ScrollBarH");
  const [well, thumb, less, more] = await Promise.all([
    part(ctx, "spacer", prefix + "Well", local, bar), part(ctx, "spacer", prefix + "Thumb", local, bar),
    part(ctx, "button", prefix + "Less", local, bar, 4), part(ctx, "button", prefix + "More", local, bar, 4)]);
  well.constraints = at("CENTER");
  thumb.constraints = at("IGNORE");
  less.constraints = at(vertical ? "NORTH" : "WEST");
  more.constraints = at(vertical ? "SOUTH" : "EAST");
  bar.children = [well, thumb, less, more];
  bar.parts = { well, thumb, less, more };
}

/** ScrollPane.init: a viewport onto the child in the centre, scroll bars east and south. */
async function initScrollPane(ctx: GuiContext, pane: Component, child: Component, vert: boolean, horiz: boolean, snap: number,
  viewportStyle: any, local: Map<string, any>) {
  pane.layout = BORDER;
  const vp = await part(ctx, "viewport", viewportStyle ?? null, local, pane);
  vp.constraints = at("CENTER");
  vp.children = [child];
  child.constraints = null;
  const model = () => { const m = new RangeModel(0, 0, 10, 10); if (snap > 0) m.snap = snap; return m; };
  pane.children = [vp];
  pane.parts = { viewport: vp };
  if (vert) {
    vp.vmodel = model();
    const bar = await part(ctx, "scrollbar", null, local, pane, 3, "Default/ScrollBarV");
    await initScrollBar(ctx, bar, true, null, vp.vmodel, local);
    bar.constraints = at("EAST");
    pane.children.push(bar);
    pane.parts.vbar = bar;
  }
  if (horiz) {
    vp.hmodel = model();
    const bar = await part(ctx, "scrollbar", null, local, pane, 3, "Default/ScrollBarH");
    await initScrollBar(ctx, bar, false, null, vp.hmodel, local);
    bar.constraints = at("SOUTH");
    pane.children.push(bar);
    pane.parts.hbar = bar;
  }
}

/**
 * ComboBox.ComboPopupMenu: a PopupMenu of MenuItems, in a scroll pane when rows is set (its
 * bars only when needed), one column in a stretched vertical group or several in a table.
 */
async function buildPopup(ctx: GuiContext, combo: Component, local: Map<string, any>): Promise<Component> {
  const menu = await part(ctx, "popup", null, local, combo);
  const cols = Math.max(1, combo.columns);
  const lay = cols === 1 ? vgroup("STRETCH", "CENTER", "STRETCH", 0)
    : { $class: "LayoutConfig$Table", columns: cols, rowGap: 0, columnGap: 5 };
  const items = await Promise.all(combo.items.map(async (it, i) => {
    const m = await part(ctx, "menuitem", null, local, combo);
    m.text = it.text;
    m.icon = it.icon;
    m.fit = "WRAP";
    m.action = String(i);
    m.constraints = FIXED;
    return m;
  }));
  if (combo.rows === 0) {
    menu.layout = lay;
    menu.children = items;
  } else {
    menu.layout = vgroup("STRETCH", "CENTER", "STRETCH");
    const cont = await part(ctx, "container", null, local, combo);
    cont.layout = lay;
    cont.children = items;
    const pane = await part(ctx, "scrollpane", null, local, combo);
    await initScrollPane(ctx, pane, cont, true, false, 0, null, local);
    pane.showAlways = false;
    menu.children = [pane];
  }
  return menu;
}

/** ComboBox.selectItem: the label shows the selected item's text and icon. */
function selectItem(c: Component, index: number) {
  if (index < 0 || index >= c.items.length) index = -1;
  c.selectedIndex = index;
  const it = index === -1 ? null : c.items[index];
  c.text = it?.text ?? "";
  c.icon = it?.icon ?? null;
}

/** TabbedPane.selectTab: selects the tab's button and shows its page in the centre. */
function selectTab(p: Component, index: number) {
  if (index === p.selectedIndex || !p.tabs.length) return;
  index = Math.max(0, Math.min(p.tabs.length - 1, index));
  const buttons = p.parts.buttons!;
  buttons.children.forEach((b, i) => { b.selected = i === index; });
  buttons.topChild = index;
  p.children = [p.parts.top!, p.tabs[index]];
  p.selectedIndex = index;
  // the pane keeps its bounds; its new page is laid out within them
  if (p.width > 0 && p.height > 0) layout(p);
}

/** List.setSelectedIndex: one entry selected. */
function selectEntry(l: Component, index: number) {
  l.selectedIndex = index;
  l.children.forEach((b, i) => { b.selected = i === index; });
}

/** Loads a pseudo-class style (e.g. "Empty" for Name:Empty) so pseudoClass can select it. */
export async function loadPseudo(ctx: GuiContext, c: Component, pseudo: string) {
  if (c.pseudo.has(pseudo) || !c.styleRef) return;
  c.pseudo.set(pseudo, await ctx.resolveStyle({ ...c.styleRef, name: `${c.styleRef.name}:${pseudo}` }, c.local));
}

// ------------------------------------------------------------------------------------- layout

const measureCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1).getContext("2d")! : null;

function cssFont(c: Component, s: Style) {
  const st = s.fontStyle === "BOLD" ? "bold " : s.fontStyle === "ITALIC" ? "italic " : s.fontStyle === "BOLD_ITALIC" ? "italic bold " : "";
  return `${st}${s.fontSize}px ${c.fontFamily}`;
}

interface TextLines { lines: string[]; width: number; height: number; lineHeight: number; ascent: number; grow: number }

/** CharacterTextFactory-like metrics; outlines grow each glyph by half the effect size. */
function fontMetrics(c: Component, s: Style, g: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) {
  g.font = cssFont(c, s);
  const m = g.measureText("Hg");
  const ascent = Math.ceil(m.fontBoundingBoxAscent ?? s.fontSize * 0.9);
  const lineHeight = ascent + Math.ceil(m.fontBoundingBoxDescent ?? s.fontSize * 0.25);
  const grow = s.textEffect === "OUTLINE" ? 1 + Math.ceil(s.effectSize / 2) : s.textEffect === "SHADOW" ? s.effectSize : 0;
  return { ascent, lineHeight, grow };
}

function layoutText(c: Component, maxWidth: number, str = c.text): TextLines | null {
  const s = c.style;
  if (!str || !s || !measureCanvas) return null;
  const g = measureCanvas;
  const { ascent, lineHeight, grow } = fontMetrics(c, s, g);
  const lines: string[] = [];
  for (const para of str.split("\n")) {
    if (c.fit !== "WRAP" || maxWidth <= 0) { lines.push(para); continue; }
    let line = "";
    for (const word of para.split(" ")) {
      const t = line ? line + " " + word : word;
      if (line && g.measureText(t).width + grow * 2 > maxWidth) { lines.push(line); line = word; } else line = t;
    }
    lines.push(line);
  }
  const width = Math.ceil(Math.max(...lines.map(l => g.measureText(l).width))) + grow * 2;
  const height = lines.length * (lineHeight + grow * 2) + (lines.length - 1) * s.lineSpacing;
  return { lines, width, height, lineHeight, ascent, grow };
}

/** The icon a label draws: its own, or its state style's for check boxes and slider frobs. */
const labelIcon = (c: Component) => c.stateIcons ? c.style?.icon ?? c.styles[0]?.icon ?? null : c.icon;

function labelSize(c: Component, whint: number): { width: number; height: number; text: TextLines | null } {
  const icon = labelIcon(c);
  let hint = c.preferredWidth > 0 ? c.preferredWidth : whint > 0 ? whint : 32766;
  if (c.text && icon && c.orientation === "HORIZONTAL") hint -= c.iconTextGap + icon.width;
  const text = layoutText(c, hint);
  const iw = icon?.width ?? 0, ih = icon?.height ?? 0;
  const tw = text?.width ?? 0, th = text?.height ?? 0, gap = icon && text ? c.iconTextGap : 0;
  if (c.orientation === "VERTICAL") return { width: Math.max(iw, tw), height: ih + gap + th, text };
  return { width: iw + gap + tw, height: Math.max(ih, th), text };
}

/** Component.getPreferredSize. */
export function preferredSize(c: Component, whint: number, hhint: number): { width: number; height: number } {
  const ps0 = c.preferredSize;
  let w: number, h: number;
  if (ps0 && ps0.width !== -1 && ps0.height !== -1) { w = ps0.width; h = ps0.height; }
  else {
    if (ps0) { if (ps0.width > 0) whint = ps0.width; if (ps0.height > 0) hhint = ps0.height; }
    const ins = c.insets;
    if (whint > 0) whint -= horiz(ins);
    if (hhint > 0) hhint -= vert(ins);
    const ps = computePreferred(c, whint, hhint);
    w = ps.width + horiz(ins); h = ps.height + vert(ins);
    if (ps0) { if (ps0.width !== -1) w = ps0.width; if (ps0.height !== -1) h = ps0.height; }
  }
  const bg = c.style?.background;
  if (bg?.kind === "image" && bg.image) {
    const mode = bg.mode, f = bg.frame;
    const minW = mode === "TILE_X" || mode === "TILE_XY" ? 0 : (mode === "FRAME_XY" || mode === "FRAME_X") ? f!.left + f!.right : bg.image.width;
    const minH = mode === "TILE_Y" || mode === "TILE_XY" ? 0 : (mode === "FRAME_XY" || mode === "FRAME_Y") ? f!.top + f!.bottom : bg.image.height;
    w = Math.max(w, minW); h = Math.max(h, minH);
  }
  return { width: w, height: h };
}

function computePreferred(c: Component, whint: number, hhint: number): { width: number; height: number } {
  if (c.kind === "label" || c.kind === "button" || c.kind === "menuitem") { const s = labelSize(c, whint); return { width: s.width, height: s.height }; }
  if (c.kind === "ui") {
    const root = c.children[0];
    return root && root.visible ? preferredSize(root, whint, hhint) : { width: 0, height: 0 };
  }
  if (c.kind === "combo") {
    // ComboBox.computePreferredSize: room for the largest item
    const text = c.text, icon = c.icon;
    let w = 0, h = 0;
    for (const it of c.items) {
      c.text = it.text; c.icon = it.icon;
      const s = labelSize(c, -1);
      w = Math.max(w, s.width); h = Math.max(h, s.height);
    }
    c.text = text; c.icon = icon;
    return { width: w, height: h };
  }
  if (c.kind === "slider") {
    // Slider.computePreferredSize: twice the frob along the slider's axis
    const f = labelIcon(c);
    const w = f?.width ?? 0, h = f?.height ?? 0;
    return c.orientation === "HORIZONTAL" ? { width: w * 2, height: h } : { width: w, height: h * 2 };
  }
  if (c.kind === "text") {
    // TextField.computePreferredSize: the text's glyphs, or one line's height when empty
    const s = c.style;
    const t = layoutText(c, -1, displayText(c));
    if (t) return { width: t.width, height: t.height };
    return { width: 0, height: s && measureCanvas ? fontMetrics(c, s, measureCanvas).lineHeight : 0 };
  }
  if (c.kind === "viewport") {
    // Viewport.computePreferredSize: the target's, no larger than the hints
    const t = c.children[0];
    const d = t ? preferredSize(t, whint, hhint) : { width: 0, height: 0 };
    return { width: whint !== -1 && d.width > whint ? whint : d.width, height: hhint !== -1 && d.height > hhint ? hhint : d.height };
  }
  if (!c.layout) return { width: 0, height: 0 };
  if (c.kind === "popup" && c.owner) {
    // ComboPopupMenu.computePreferredSize: at least as wide as the combo box
    const d = layoutPreferred(c, whint, hhint);
    return { width: Math.max(d.width, c.owner.width - horiz(c.insets)), height: d.height };
  }
  return layoutPreferred(c, whint, hhint);
}

/** A container's preferred size from its layout manager. */
function layoutPreferred(c: Component, whint: number, hhint: number): { width: number; height: number } {
  const lk = kind(c.layout);
  if (lk === "Absolute") {
    let w = 0, h = 0;
    for (const k of c.children) {
      if (!k.visible) continue;
      const cons = k.constraints ?? {};
      const d = kind(cons) === "SizedChild" ? { width: cons.width ?? 0, height: cons.height ?? 0 } : preferredSize(k, -1, -1);
      w = Math.max(w, (cons.x ?? 0) + d.width); h = Math.max(h, (cons.y ?? 0) + d.height);
    }
    return { width: w, height: h };
  }
  if (lk === "Anchor") {
    for (const k of c.children) {
      const s = preferredSize(k, whint, hhint);
      whint = Math.max(whint, s.width); hhint = Math.max(hhint, s.height);
    }
    return { width: Math.max(0, whint), height: Math.max(0, hhint) };
  }
  if (lk === "Table") {
    const m = tableMetrics(c, whint);
    const rows = m.rows.length;
    return { width: sum(m.cols) + (m.cols.length - 1) * (c.layout.columnGap ?? 0), height: sum(m.rows) + Math.max(0, rows - 1) * (c.layout.rowGap ?? 0) };
  }
  if (lk === "Border") {
    // BorderLayout.computePreferredSize
    const hgap = c.layout.horizontalGap ?? 0, vgap = c.layout.verticalGap ?? 0, at = borderParts(c);
    let w = 0, h = 0, horiz = 0, vert = 0;
    for (const k of [at.SOUTH, at.NORTH]) {
      if (!k?.visible) continue;
      const s = preferredSize(k, whint, -1);
      w = Math.max(w, s.width); h += s.height; vert++;
      if (hhint > 0) hhint -= s.height + vgap;
    }
    let cw = 0, ch = 0;
    for (const k of [at.EAST, at.WEST]) {
      if (!k?.visible) continue;
      const s = preferredSize(k, -1, hhint);
      cw += s.width; ch = Math.max(ch, s.height); horiz++;
      if (whint > 0) whint -= s.width + hgap;
    }
    if (at.CENTER?.visible) { const s = preferredSize(at.CENTER, whint, hhint); cw += s.width; ch = Math.max(ch, s.height); horiz++; }
    cw += Math.max(horiz - 1, 0) * hgap;
    if (ch > 0) vert++;
    return { width: Math.max(w, cw), height: h + ch + Math.max(vert - 1, 0) * vgap };
  }
  if (lk === "HorizontalGroup" || lk === "VerticalGroup") {
    const g = group(c.layout), hz = lk === "HorizontalGroup";
    const info = dimens(c, g, hz, whint, hhint);
    if (hz) {
      let w = g.policy === "STRETCH" ? info.maxfreewid * (info.count - info.numfix) + info.fixwid
        : g.policy === "EQUALIZE" ? info.maxwid * info.count : info.totwid;
      w += (info.count - 1) * g.gap;
      return { width: w, height: info.maxhei };
    }
    let h = g.policy === "STRETCH" ? info.maxfreehei * (info.count - info.numfix) + info.fixhei
      : g.policy === "EQUALIZE" ? info.maxhei * info.count : info.tothei;
    h += (info.count - 1) * g.gap;
    return { width: info.maxwid, height: h };
  }
  return { width: 0, height: 0 };
}

interface Group { policy: string; offPolicy: string; gap: number; just: string; offJust: string }
const group = (l: any): Group => ({
  policy: enumName(l.policy, "NONE"), offPolicy: enumName(l.offAxisPolicy, "CONSTRAIN"), gap: l.gap ?? 5,
  just: enumName(l.justification, "CENTER"), offJust: enumName(l.offAxisJustification, "CENTER"),
});

/** GroupLayout.computeDimens. */
function dimens(c: Component, g: Group, hz: boolean, whint: number, hhint: number) {
  const info = { count: 0, numfix: 0, fixwid: 0, fixhei: 0, totwid: 0, tothei: 0, maxwid: 0, maxhei: 0, maxfreewid: 0, maxfreehei: 0,
    dimens: [] as ({ width: number; height: number } | null)[] };
  const fixed = (k: Component) => !!k.constraints?.fixed;
  const add = (k: Component, wh: number, hh: number) => {
    const s = preferredSize(k, wh, hh);
    info.totwid += s.width; info.tothei += s.height;
    info.maxwid = Math.max(info.maxwid, s.width); info.maxhei = Math.max(info.maxhei, s.height);
    return s;
  };
  c.children.forEach((k, i) => {
    info.dimens[i] = null;
    if (!k.visible) return;
    info.count++;
    if (!fixed(k)) return;
    const s = add(k, whint, hhint);
    info.fixwid += s.width; info.fixhei += s.height; info.numfix++;
    info.dimens[i] = s;
  });
  if (info.numfix === info.count) return info;
  if (g.policy === "STRETCH") {
    const free = info.count - info.numfix;
    if (hz && whint > 0) whint = Math.trunc((whint - (info.fixwid + g.gap * (info.count - 1))) / free);
    if (!hz && hhint > 0) hhint = Math.trunc((hhint - (info.fixhei + g.gap * (info.count - 1))) / free);
  }
  c.children.forEach((k, i) => {
    if (!k.visible || fixed(k)) return;
    const s = add(k, whint, hhint);
    info.maxfreewid = Math.max(info.maxfreewid, s.width); info.maxfreehei = Math.max(info.maxfreehei, s.height);
    info.dimens[i] = s;
  });
  return info;
}

type Setter = (k: Component, x: number, y: number, w: number, h: number) => void;

/** Lays out c's children within c's current bounds, recursively. */
export function layout(c: Component) {
  if (c.kind === "scrollpane" && !c.showAlways) {
    // ScrollPane.layout: lay out without the bars, then add each bar whose model overflows
    const { hbar, vbar } = c.parts;
    for (const b of [hbar, vbar]) if (b) b.visible = false;
    layoutOnce(c);
    for (const b of [hbar, vbar, hbar]) {
      if (b && !b.visible && b.model!.extent !== b.model!.range) { b.visible = true; layoutOnce(c); }
    }
    return;
  }
  layoutOnce(c);
}

function layoutOnce(c: Component) {
  const ins = c.insets;
  const bw = c.width - horiz(ins), bh = c.height - vert(ins);
  const set: Setter = (k, x, y, w, h) => { k.x = x; k.y = y; k.width = w; k.height = h; };
  if (c.kind === "ui") {
    const root = c.children[0];
    if (root) set(root, ins.left, ins.bottom, bw, bh);
  } else if (c.kind === "viewport") {
    // Viewport.layout: the target at its preferred size, at least the viewport's along an
    // axis that does not scroll; the models' extents are the visible part
    const t = c.children[0];
    if (t) {
      const d = preferredSize(t, bw, bh);
      const w = c.hmodel ? Math.max(d.width, bw) : bw, h = c.vmodel ? Math.max(d.height, bh) : bh;
      set(t, ins.left, ins.bottom, w, h);
      layout(t);
      if (c.vmodel) c.vmodel.setRange(0, Math.max(0, Math.min(c.vmodel.value, h - bh)), bh, h);
      if (c.hmodel) c.hmodel.setRange(0, Math.max(0, Math.min(c.hmodel.value, w - bw)), bw, w);
    }
    return;
  } else if (c.layout) {
    const lk = kind(c.layout);
    if (lk === "Absolute") {
      const flipped = !!c.layout.flipped;
      for (const k of c.children) {
        if (!k.visible) continue;
        const cons = k.constraints ?? {};
        const d = kind(cons) === "SizedChild" ? { width: cons.width ?? 0, height: cons.height ?? 0 } : preferredSize(k, -1, -1);
        const px = cons.x ?? 0, py = cons.y ?? 0;
        set(k, ins.left + px, flipped ? c.height - d.height - ins.top - py : ins.bottom + py, d.width, d.height);
      }
    } else if (lk === "Anchor") {
      for (const k of c.children) {
        if (!k.visible) continue;
        const a = k.constraints ?? {};
        if (a.fill) { set(k, 0, 0, c.width, c.height); continue; }
        const px = Math.round(c.width * (a.parentX ?? 0.5)), py = Math.round(c.height * (a.parentY ?? 0.5));
        const s = a.fitToContainer ? preferredSize(k, c.width, c.height) : preferredSize(k, -1, -1);
        const cx = Math.round(s.width * (a.childX ?? 0.5)), cy = Math.round(s.height * (a.childY ?? 0.5));
        set(k, px - cx + (a.offsetX ?? 0), py - cy + (a.offsetY ?? 0), s.width, s.height);
      }
    } else if (lk === "HorizontalGroup" || lk === "VerticalGroup") {
      layoutGroup(c, group(c.layout), lk === "HorizontalGroup", ins, bw, bh, set);
    } else if (lk === "Table") {
      layoutTable(c, ins, bw, set);
    } else if (lk === "Border") {
      // BorderLayout.layoutContainer
      const hgap = c.layout.horizontalGap ?? 0, vgap = c.layout.verticalGap ?? 0, at = borderParts(c);
      let x = ins.left, y = ins.bottom, w = bw, h = bh;
      if (at.SOUTH?.visible) { const s = preferredSize(at.SOUTH, w, -1); set(at.SOUTH, x, y, w, s.height); y += s.height + vgap; h -= s.height + vgap; }
      if (at.NORTH?.visible) { const s = preferredSize(at.NORTH, w, -1); set(at.NORTH, x, c.height - ins.top - s.height, w, s.height); h -= s.height + vgap; }
      if (at.WEST?.visible) { const s = preferredSize(at.WEST, -1, -1); set(at.WEST, x, y, s.width, h); x += s.width + hgap; w -= s.width + hgap; }
      if (at.EAST?.visible) { const s = preferredSize(at.EAST, -1, -1); set(at.EAST, c.width - ins.right - s.width, y, s.width, h); w -= s.width + hgap; }
      if (at.CENTER?.visible) set(at.CENTER, x, y, w, h);
    }
  }
  for (const k of c.children) if (k.visible) layout(k);
}

/** HGroupLayout and VGroupLayout.layoutContainer. */
function layoutGroup(c: Component, g: Group, hz: boolean, ins: Insets, bw: number, bh: number, set: Setter) {
  const info = dimens(c, g, hz, bw, bh);
  const totgap = g.gap * (info.count - 1), freecount = info.count - info.numfix;
  let freefrac = 0, def = 0, conscale = 1, tot: number;
  const fixed = (k: Component) => !!k.constraints?.fixed;
  const along = hz ? bw : bh, fixAlong = hz ? info.fixwid : info.fixhei, totAlong = hz ? info.totwid : info.tothei;
  if (g.policy === "STRETCH") {
    if (freecount > 0) { const free = along - fixAlong - totgap; def = Math.trunc(free / freecount); freefrac = free % freecount; tot = along; }
    else tot = fixAlong + totgap;
  } else if (g.policy === "EQUALIZE") { def = hz ? info.maxwid : info.maxhei; tot = fixAlong + def * freecount + totgap; }
  else if (g.policy === "CONSTRAIN" && hz) {
    tot = totAlong + totgap;
    if (tot > along) { conscale = (along - totgap) / totAlong; tot = along; }
  } else tot = totAlong + totgap;
  const defOff = g.offPolicy === "STRETCH" ? (hz ? bh : bw) : g.offPolicy === "EQUALIZE" ? (hz ? info.maxhei : info.maxwid) : 0;
  const sized = (k: Component) => g.policy === "NONE" || fixed(k) || (hz && g.policy === "CONSTRAIN");
  if (hz) {
    let sx = g.just === "LEFT" || g.just === "TOP" ? ins.left : g.just === "CENTER" ? ins.left + Math.trunc((bw - tot) / 2) : ins.left + bw - tot;
    c.children.forEach((k, i) => {
      const d = info.dimens[i];
      if (!d) return;
      let w: number;
      if (g.policy === "NONE" || fixed(k)) w = d.width;
      else if (g.policy === "CONSTRAIN") w = Math.max(1, Math.trunc(conscale * d.width));
      else { w = def + freefrac; freefrac = 0; }
      const h = g.offPolicy === "NONE" ? d.height : g.offPolicy === "CONSTRAIN" ? Math.min(d.height, bh) : defOff;
      const sy = g.offJust === "RIGHT" || g.offJust === "TOP" ? ins.bottom + bh - h
        : g.offJust === "LEFT" || g.offJust === "BOTTOM" ? ins.bottom : ins.bottom + Math.trunc((bh - h) / 2);
      set(k, sx, sy, w, h);
      sx += w + g.gap;
    });
  } else {
    let sy = g.just === "LEFT" || g.just === "BOTTOM" ? ins.bottom + tot : g.just === "CENTER" ? ins.bottom + bh - Math.trunc((bh - tot) / 2) : ins.bottom + bh;
    c.children.forEach((k, i) => {
      const d = info.dimens[i];
      if (!d) return;
      let h: number;
      if (sized(k)) h = d.height;
      else { h = def + freefrac; freefrac = 0; }
      const w = g.offPolicy === "NONE" ? d.width : g.offPolicy === "CONSTRAIN" ? Math.min(d.width, bw) : defOff;
      const sx = g.offJust === "LEFT" || g.offJust === "TOP" ? ins.left
        : g.offJust === "RIGHT" || g.offJust === "BOTTOM" ? ins.left + (bw - w) : ins.left + Math.trunc((bw - w) / 2);
      set(k, sx, sy - h, w, h);
      sy -= h + g.gap;
    });
  }
}

/** Sizes a root component to its preferred size and lays it out. */
export function pack(c: Component) {
  const s = preferredSize(c, -1, -1);
  c.x = 0; c.y = 0; c.width = s.width; c.height = s.height;
  layout(c);
  return s;
}

// ------------------------------------------------------------------------------------ render

export interface RenderHooks {
  /** Draws a RenderableView (e.g. the knight portrait) into a rectangle in canvas pixels. */
  view?: (c: Component, g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void;
  /** Draws game content into components with these tags (e.g. the minimap's map layer). */
  tagged?: Record<string, (c: Component, g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void>;
}

/**
 * The deepest visible component under a canvas point, as last rendered (null if none). Only
 * components passing `accept` are returned; the search prefers later (topmost) children.
 */
export function hitTest(c: Component, px: number, py: number, accept: (c: Component) => boolean = () => true): Component | null {
  if (!c.visible || !c.screen) return null;
  for (let i = c.children.length - 1; i >= 0; i--) {
    const r = hitTest(c.children[i], px, py, accept);
    if (r) return r;
  }
  const r = c.screen;
  return px >= r.x && px < r.x + r.width && py >= r.y && py < r.y + r.height && accept(c) ? c : null;
}

/**
 * Draws a laid-out tree. (ox, oy) is the parent's lower-left corner in canvas coordinates
 * (y down), so a Clyde position (x, y) maps to (ox + x, oy - y).
 */
export function render(c: Component, g: CanvasRenderingContext2D, ox: number, oy: number, hooks: RenderHooks = {}) {
  if (!c.visible) { c.screen = null; return; }
  const x = ox + c.x, y = oy - c.y; // y is this component's bottom edge on the canvas
  const o = c.offset;
  if (o && (o.tx || o.ty || o.rotation || o.scale !== 1)) {
    // Component.applyTransform: offset about the centre (Clyde's y and rotation run upward)
    const cx = x + c.width / 2, cy = y - c.height / 2;
    g.save();
    g.translate(cx + o.tx, cy - o.ty);
    g.rotate(-o.rotation);
    g.scale(o.scale, o.scale);
    g.translate(-cx, -cy);
    renderSelf(c, g, x, y, hooks);
    g.restore();
  } else renderSelf(c, g, x, y, hooks);
  // an open popup menu (a ComboBox's) is a window over the root that opened it
  if (c.overlay) renderPopup(c.overlay, g, hooks);
}

const LABEL_KINDS = new Set<CompKind>(["label", "button", "combo", "menuitem"]);

function renderSelf(c: Component, g: CanvasRenderingContext2D, x: number, y: number, hooks: RenderHooks) {
  c.screen = { x, y: y - c.height, width: c.width, height: c.height };
  const s = c.style;
  if (s?.background) drawBackground(g, s.background, x, y, c.width, c.height, c.alpha);
  if (c.kind === "view" && hooks.view) hooks.view(c, g, x, y - c.height, c.width, c.height);
  const tagHook = c.tag ? hooks.tagged?.[c.tag] : undefined;
  if (tagHook) tagHook(c, g, x, y - c.height, c.width, c.height);
  if (LABEL_KINDS.has(c.kind) && s) drawLabel(c, s, g, x, y);
  else if (c.kind === "text" && s) drawTextField(c, s, g, x, y);
  else if (c.kind === "slider") drawFrob(c, g, x, y);
  if (c.kind === "scrollbar") updateThumb(c);
  if (c.kind === "viewport") renderViewport(c, g, x, y, hooks);
  else {
    c.children.forEach((k, i) => { if (i !== c.topChild) render(k, g, x, y, hooks); });
    const top = c.children[c.topChild];
    if (top) render(top, g, x, y, hooks);
  }
  const b = s?.border;
  if (b?.color && b.thickness > 0 && c.alpha > 0) {
    // LineBorder.render: a line of the border's width just inside the bounds
    g.strokeStyle = rgba(b.color, c.alpha);
    g.lineWidth = b.thickness;
    g.strokeRect(x + b.thickness / 2, y - c.height + b.thickness / 2, c.width - b.thickness, c.height - b.thickness);
  }
}

/** Viewport.renderComponent: the target shifted by the scroll models, clipped to the insets. */
function renderViewport(c: Component, g: CanvasRenderingContext2D, x: number, y: number, hooks: RenderHooks) {
  const t = c.children[0];
  if (!t) return;
  const ins = c.insets;
  // getYOffset is zero when scrolled to the bottom and negative above it
  const yoff = c.vmodel ? c.vmodel.value - (c.vmodel.max - c.vmodel.extent) : 0;
  const xoff = c.hmodel ? -c.hmodel.value : 0;
  g.save();
  g.beginPath();
  g.rect(x + ins.left, y - c.height + ins.top, c.width - horiz(ins), c.height - vert(ins));
  g.clip();
  render(t, g, x + xoff, y - yoff, hooks);
  g.restore();
}

/** ScrollBar.update: sizes and places the thumb over the well from the model. */
function updateThumb(bar: Component) {
  const m = bar.model!, { well, thumb, less, more } = bar.parts;
  if (!well || !thumb || !less || !more) return;
  less.enabled = bar.enabled && m.value > m.min;
  more.enabled = bar.enabled && m.value + m.extent < m.max;
  thumb.enabled = bar.enabled && m.range > m.extent;
  const wi = well.insets, range = Math.max(1, m.range); // avoid div0
  let tx = 0, ty = 0, tw = well.width - horiz(wi), th = well.height - vert(wi);
  // the thumb is never shorter than THUMB_RATIO (2) times its breadth
  if (bar.orientation === "HORIZONTAL") {
    let size = tw;
    tw = Math.trunc(m.extent * size / range);
    if (tw < 2 * th) { size -= 2 * th - tw; tw = 2 * th; }
    tx = Math.trunc(m.value * size / range);
  } else {
    let size = th;
    th = Math.trunc(m.extent * size / range);
    if (th < 2 * tw) { size -= 2 * tw - th; th = 2 * tw; }
    ty = Math.trunc((range - m.extent - m.value) * size / range);
  }
  thumb.x = well.x + wi.left + tx; thumb.y = well.y + wi.bottom + ty;
  thumb.width = tw; thumb.height = th;
}

/** Slider.renderComponent: the frob (its state's style icon) placed along the model's range. */
function drawFrob(c: Component, g: CanvasRenderingContext2D, bx: number, by: number) {
  const f = labelIcon(c), m = c.model;
  if (!f || !m || c.alpha <= 0) return;
  const ins = c.insets, range = m.range, offset = m.value - m.min;
  const along = (len: number) => range > 0 ? Math.trunc(len * offset / range) : 0;
  let x: number, y: number;
  if (c.orientation === "HORIZONTAL") { y = Math.trunc((c.height - f.height) / 2); x = ins.left + along(c.width - horiz(ins) - f.width); }
  else { x = Math.trunc((c.width - f.width) / 2); y = ins.bottom + along(c.height - vert(ins) - f.height); }
  g.globalAlpha = c.alpha;
  blit(g, f, 0, 0, f.width, f.height, bx, by, x, y, f.width, f.height);
  g.globalAlpha = 1;
}

/** PopupMenu.packAndFit: the menu hangs below its combo box and stays on the canvas. */
function renderPopup(menu: Component, g: CanvasRenderingContext2D, hooks: RenderHooks) {
  const r = menu.owner?.screen;
  if (!r) return;
  const x = Math.max(0, Math.min(g.canvas.width - menu.width, r.x));
  const top = Math.max(0, Math.min(g.canvas.height - menu.height, r.y + r.height));
  render(menu, g, x - menu.x, top + menu.height + menu.y, hooks);
}

/** EditableTextComponent.getDisplayText: the placeholder while empty and unfocused; stars for passwords. */
function displayText(c: Component): string {
  if (!c.focused && !c.text) return c.placeholder;
  return c.password ? "*".repeat(c.text.length) : c.text;
}

/**
 * TextField.renderComponent: one line on the bottom inset, clipped to the insets and scrolled
 * left to keep the cursor in view; a cursor line while focused.
 */
function drawTextField(c: Component, s: Style, g: CanvasRenderingContext2D, bx: number, by: number) {
  const str = displayText(c);
  if (c.alpha <= 0) return;
  const ins = c.insets;
  const { ascent, lineHeight, grow } = fontMetrics(c, s, g);
  const avail = c.width - horiz(ins);
  const cursx = c.focused ? g.measureText(str.substring(0, textCursor(c))).width + grow : 0;
  const txoff = Math.max(0, cursx - avail + 1);
  g.save();
  g.beginPath();
  g.rect(bx + ins.left, by - c.height + ins.top, avail, c.height - vert(ins));
  g.clip();
  const top = by - ins.bottom - lineHeight - grow * 2;
  if (str) { g.textBaseline = "alphabetic"; g.lineJoin = "round"; drawLine(c, s, g, str, bx + ins.left - txoff + grow, top + grow + ascent); }
  if (c.focused) {
    g.fillStyle = rgba(s.color, c.alpha);
    g.fillRect(Math.round(bx + ins.left - txoff + cursx), top, 1, lineHeight + grow * 2);
  }
  g.restore();
}

/** Image.render(sx, sy, sw, sh, tx, ty, tw, th) with Clyde's bottom-up source and target y. */
function blit(g: CanvasRenderingContext2D, im: GuiImage, sx: number, sy: number, sw: number, sh: number,
  bx: number, by: number, tx: number, ty: number, tw: number, th: number) {
  if (tw <= 0 || th <= 0) return;
  // a zero-size source (a frame whose insets cover the whole image) still fills its target in
  // the game: GL stretches the single texel line at the seam, so sample that line
  if (sw <= 0) { if (sx >= im.width) sx = im.width - 1; sw = 1; }
  if (sh <= 0) { if (sy >= im.height) sy = im.height - 1; sy = Math.max(0, sy - (sy > 0 ? 1 : 0)); sh = 1; }
  // a source running past the image's edge (a frame inset wider than the image) repeats the
  // edge texels, as GL's clamp-to-edge does; a canvas would clip it and leave a gap
  if (sx < 0 && sx + sw > 0) {
    const outside = -sx, tout = Math.round(tw * outside / sw);
    blit(g, im, 0, sy, 1, sh, bx, by, tx, ty, tout, th);
    blit(g, im, 0, sy, sw - outside, sh, bx, by, tx + tout, ty, tw - tout, th);
    return;
  }
  if (sy < 0 && sy + sh > 0) {
    const outside = -sy, tout = Math.round(th * outside / sh);
    blit(g, im, sx, 0, sw, 1, bx, by, tx, ty, tw, tout);
    blit(g, im, sx, 0, sw, sh - outside, bx, by, tx, ty + tout, tw, th - tout);
    return;
  }
  if (sx + sw > im.width && sx < im.width && sw > 1) {
    const inside = im.width - sx, tin = Math.round(tw * inside / sw);
    blit(g, im, sx, sy, inside, sh, bx, by, tx, ty, tin, th);
    blit(g, im, im.width - 1, sy, 1, sh, bx, by, tx + tin, ty, tw - tin, th);
    return;
  }
  if (sy + sh > im.height && sy < im.height && sh > 1) {
    const inside = im.height - sy, tin = Math.round(th * inside / sh);
    blit(g, im, sx, sy, sw, inside, bx, by, tx, ty, tw, tin);
    blit(g, im, sx, im.height - 1, sw, 1, bx, by, tx, ty + tin, tw, th - tin);
    return;
  }
  g.drawImage(im.source, sx, im.height - sy - sh, sw, sh, bx + tx, by - ty - th, tw, th);
}

/** ImageBackground.render; (bx, by) is the component's lower-left corner on the canvas. */
function drawBackground(g: CanvasRenderingContext2D, bg: Background, bx: number, by: number, width: number, height: number, alpha: number) {
  if (alpha <= 0) return;
  if (bg.kind === "solid") {
    const [r, gg, b, a] = bg.color!;
    if (a <= 0) return;
    g.fillStyle = `rgba(${r * 255},${gg * 255},${b * 255},${a * alpha})`;
    g.fillRect(bx, by - height, width, height);
    return;
  }
  const im = bg.image!;
  g.globalAlpha = alpha;
  const iw = im.width, ih = im.height, mode = bg.mode, anchor = bg.anchor;
  const r = (sx: number, sy: number, sw: number, sh: number, tx: number, ty: number, tw = sw, th = sh) => blit(g, im, sx, sy, sw, sh, bx, by, tx, ty, tw, th);
  if (mode.startsWith("CENTER")) {
    const x = mode === "CENTER_X" || mode === "CENTER_XY" ? Math.trunc((width - iw) / 2) : 0;
    const y = mode === "CENTER_Y" || mode === "CENTER_XY" ? Math.trunc((height - ih) / 2) : 0;
    r(0, 0, iw, ih, x, y);
  } else if (mode.startsWith("SCALE")) {
    let x = 0, y = 0, w = width, h = height;
    if (mode === "SCALE_X") { y = Math.trunc((height - ih) / 2); h = ih; }
    if (mode === "SCALE_Y") { x = Math.trunc((width - iw) / 2); w = iw; }
    r(0, 0, iw, ih, x, y, w, h);
  } else if (mode.startsWith("TILE")) {
    const row = (y: number, rh: number, sy: number) => {
      const across = Math.trunc(width / iw), remain = width % iw;
      let offset = 0;
      if (remain > 0 && (anchor === "LOWER_RIGHT" || anchor === "UPPER_RIGHT")) { r(iw - remain, sy, remain, rh, 0, y); offset = remain; }
      for (let xx = 0; xx < across; xx++) r(0, sy, iw, rh, offset + xx * iw, y);
      if (remain > 0 && (anchor === "LOWER_LEFT" || anchor === "UPPER_LEFT")) r(0, sy, remain, rh, across * iw, y);
    };
    if (mode === "TILE_X") row(0, Math.min(height, ih), 0);
    else {
      const up = Math.trunc(height / ih), remain = height % ih;
      const tileY = mode === "TILE_Y", w = tileY ? Math.min(width, iw) : width;
      const line = (y: number, rh: number, sy: number) => tileY ? r(0, sy, w, rh, 0, y) : row(y, rh, sy);
      let offset = 0;
      if (remain > 0 && (anchor === "UPPER_LEFT" || anchor === "UPPER_RIGHT")) { line(0, remain, ih - remain); offset = remain; }
      for (let yy = 0; yy < up; yy++) line(offset + yy * ih, ih, 0);
      if (remain > 0 && (anchor === "LOWER_LEFT" || anchor === "LOWER_RIGHT")) line(up * ih, remain, 0);
    }
  } else if (mode.startsWith("FRAME")) {
    const f = bg.frame!;
    r(0, 0, f.left, f.bottom, 0, 0);
    r(iw - f.right, 0, f.right, f.bottom, width - f.right, 0);
    r(0, ih - f.top, f.left, f.top, 0, height - f.top);
    r(iw - f.right, ih - f.top, f.right, f.top, width - f.right, height - f.top);
    const wm = iw - horiz(f), hm = ih - vert(f), gw = width - horiz(f), gh = height - vert(f);
    r(f.left, 0, wm, f.bottom, f.left, 0, gw, f.bottom);
    r(f.left, ih - f.top, wm, f.top, f.left, height - f.top, gw, f.top);
    r(0, f.bottom, f.left, hm, 0, f.bottom, f.left, gh);
    r(iw - f.right, f.bottom, f.right, hm, width - f.right, f.bottom, f.right, gh);
    r(f.left, f.bottom, wm, hm, f.left, f.bottom, gw, gh);
  } else if (mode.startsWith("ASPECT")) {
    let sx = 0, sy = 0, sw = iw, sh = ih, x = 0, y = 0, w = width, h = height;
    const xa = width / iw, ya = height / ih;
    if (mode === "ASPECT_INNER") {
      if (xa > ya) { sh = Math.trunc(height * iw / width); sy = Math.trunc((ih - sh) / 2); }
      else if (ya > xa) { sw = Math.trunc(width * ih / height); sx = Math.trunc((iw - sw) / 2); }
    } else if (xa < ya) { const nh = Math.trunc(ih * xa); y = Math.trunc((height - nh) / 2); h = nh; }
    else if (ya < xa) { const nw = Math.trunc(iw * ya); x = Math.trunc((width - nw) / 2); w = nw; }
    r(sx, sy, sw, sh, x, y, w, h);
  }
  g.globalAlpha = 1;
}

const rgba = (c: [number, number, number, number], alpha: number) =>
  `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${c[3] * alpha})`;

/** LabelRenderer.layout and render: icon beside (or above) the text, aligned in the insets. */
function drawLabel(c: Component, s: Style, g: CanvasRenderingContext2D, bx: number, by: number) {
  const ins = s.insets, icon = labelIcon(c);
  const size = labelSize(c, c.width - horiz(ins));
  const xoff = (w: number) => s.textAlignment === "RIGHT" ? c.width - w - ins.right
    : s.textAlignment === "CENTER" ? Math.trunc((c.width - horiz(ins) - w) / 2) + ins.left : ins.left;
  const yoff = (h: number) => s.verticalAlignment === "TOP" ? c.height - h - ins.top
    : s.verticalAlignment === "BOTTOM" ? ins.bottom : Math.trunc((c.height - vert(ins) - h) / 2) + ins.bottom;
  let ix = 0, iy = 0, tx = 0, ty = 0;
  const text = size.text;
  if (c.orientation === "VERTICAL") {
    if (text) { tx = xoff(text.width); ty = yoff(size.height); }
    if (icon) { ix = xoff(icon.width); iy = yoff(size.height) + (text ? text.height + c.iconTextGap : 0); }
  } else {
    if (icon) { ix = xoff(size.width); iy = yoff(icon.height); }
    if (text) { tx = xoff(size.width) + (icon ? icon.width + c.iconTextGap : 0); ty = yoff(text.height); }
  }
  if (icon && c.alpha > 0) {
    g.globalAlpha = c.alpha;
    blit(g, icon, 0, 0, icon.width, icon.height, bx, by, ix, iy, icon.width, icon.height);
    g.globalAlpha = 1;
  }
  if (!text || c.alpha <= 0 || s.color[3] <= 0) return;
  g.font = cssFont(c, s);
  g.textBaseline = "alphabetic";
  g.lineJoin = "round";
  // LabelRenderer.renderText: a truncated label's text is clipped to its insets
  const clip = c.fit === "TRUNCATE";
  if (clip) {
    g.save();
    g.beginPath();
    g.rect(bx + ins.left, by - c.height + ins.top, c.width - horiz(ins), c.height - vert(ins));
    g.clip();
  }
  // lines run downward from the top of the text block
  let top = by - ty - text.height;
  for (const line of text.lines) {
    const lw = g.measureText(line).width + text.grow * 2;
    const lx = bx + tx + (s.textAlignment === "RIGHT" ? text.width - lw : s.textAlignment === "CENTER" ? (text.width - lw) / 2 : 0) + text.grow;
    drawLine(c, s, g, line, lx, top + text.grow + text.ascent);
    top += text.lineHeight + text.grow * 2 + s.lineSpacing;
  }
  if (clip) g.restore();
}

/** One line of text with the style's effect (outline, shadow or glow) under it. */
function drawLine(c: Component, s: Style, g: CanvasRenderingContext2D, line: string, lx: number, base: number) {
  if (s.textEffect === "OUTLINE") {
    g.strokeStyle = rgba(s.effectColor, c.alpha);
    g.lineWidth = s.effectSize;
    g.strokeText(line, lx, base);
  } else if (s.textEffect === "SHADOW") {
    g.fillStyle = rgba(s.effectColor, c.alpha);
    g.fillText(line, lx + s.effectSize, base + s.effectSize);
  } else if (s.textEffect === "GLOW") {
    g.shadowColor = rgba(s.effectColor, c.alpha);
    g.shadowBlur = s.effectSize;
  }
  g.fillStyle = rgba(s.color, c.alpha);
  g.fillText(line, lx, base);
  g.shadowBlur = 0;
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/** A BorderLayout's components by location (LayoutConfig.Border.Child.location, CENTER by default). */
function borderParts(c: Component): Partial<Record<"NORTH" | "SOUTH" | "EAST" | "WEST" | "CENTER", Component>> {
  const out: Partial<Record<string, Component>> = {};
  for (const k of c.children) {
    const loc = enumName(k.constraints?.location, "CENTER");
    if (loc !== "IGNORE") out[loc] = k;
  }
  return out;
}

/** TableLayout.computeMetrics: column widths and row heights from the children's preferred sizes. */
function tableMetrics(c: Component, whint: number) {
  const ncols = Math.max(1, c.layout.columns ?? 1);
  const kids = c.children.filter(k => k.visible);
  const nrows = Math.ceil(kids.length / ncols);
  const cols = new Array(ncols).fill(0), rows = new Array(nrows).fill(0);
  const sizes = new Map<Component, { width: number; height: number }>();
  let maxrh = 0;
  kids.forEach((k, i) => {
    const s = preferredSize(k, whint, -1);
    sizes.set(k, s);
    const r = Math.floor(i / ncols), col = i % ncols;
    rows[r] = Math.max(rows[r], s.height); maxrh = Math.max(maxrh, s.height);
    cols[col] = Math.max(cols[col], s.width);
  });
  if (c.layout.equalRows) rows.fill(maxrh);
  return { cols, rows, sizes, kids };
}

/** TableLayout.layoutContainer (Clyde's coordinates run upward from the bottom). */
function layoutTable(c: Component, ins: Insets, availwid: number, set: Setter) {
  const L = c.layout, rowgap = L.rowGap ?? 0, colgap = L.columnGap ?? 0;
  const m = tableMetrics(c, availwid);
  const halign = enumName(L.horizontalAlignment, "LEFT"), valign = enumName(L.verticalAlignment, "TOP");
  if (halign === "STRETCH" && sum(m.cols) > 0) {
    // every column grows in proportion to its natural width
    const natural = sum(m.cols), avail = c.width - horiz(ins) - natural - colgap * (m.cols.length - 1);
    let used = 0;
    m.cols.forEach((w, i) => { const adj = Math.trunc(w * avail / natural); m.cols[i] += adj; used += adj; });
    m.cols[0] += avail - used;
  }
  const totw = sum(m.cols) + (m.cols.length - 1) * colgap, toth = sum(m.rows) + Math.max(0, m.rows.length - 1) * rowgap;
  let sx = ins.left;
  if (halign === "RIGHT") sx += c.width - horiz(ins) - totw;
  else if (halign === "CENTER") sx += Math.trunc((c.width - horiz(ins) - totw) / 2);
  let y = ins.bottom + toth;
  if (valign === "CENTER") y += Math.trunc((c.height - vert(ins) - toth) / 2);
  else if (valign === "TOP") y = c.height - ins.top;
  let row = 0, col = 0, x = sx;
  for (const k of m.kids) {
    const width = Math.min(m.cols[col], availwid), height = m.rows[row];
    let xo = 0, yo = 0, cw = width, ch = height;
    if (L.centerChildren) {
      const d = m.sizes.get(k)!;
      if (d.width < width) { xo = Math.trunc((width - d.width) / 2); cw = d.width; }
      if (d.height < height) { yo = Math.trunc((height - d.height) / 2); ch = d.height; }
    }
    set(k, x + xo, y - height + yo, cw, ch);
    x += m.cols[col] + colgap;
    if (++col === m.cols.length) { y -= height + rowgap; row++; col = 0; x = sx; }
  }
}

// ------------------------------------------------------------------------------------- input

/**
 * A pointer event at canvas coordinates (as passed to render). `button` is the DOM button
 * (0 left); `delta` a wheel's DOM deltaY (positive scrolls down); `ctrl` doubles wheel steps.
 */
export interface GuiEvent { type: "down" | "up" | "move" | "wheel"; x: number; y: number; button?: number; delta?: number; ctrl?: boolean }

/** Root's input state per root: the hovered and pressed components, a thumb drag, the focus. */
interface Input { hover: Component | null; pressed: Component | null; drag: { sv: number; sx: number; sy: number } | null; focus: Component | null }
const inputs = new WeakMap<Component, Input>();

/**
 * Container.getHitComponent: children are searched topmost first and only within their
 * parent's bounds (a viewport's within its insets); a component that is not hoverable lets
 * the pointer through. Returns the path from c down to the hit component.
 */
function hitPath(c: Component, px: number, py: number): Component[] | null {
  if (!c.visible || !c.screen) return null;
  const r = c.screen, ins = c.kind === "viewport" ? c.insets : ZERO;
  if (px < r.x + ins.left || py < r.y + ins.top || px >= r.x + r.width - ins.right || py >= r.y + r.height - ins.bottom) return null;
  const top = c.children[c.topChild];
  if (top) { const p = hitPath(top, px, py); if (p) return [c, ...p]; }
  for (let i = c.children.length - 1; i >= 0; i--) {
    if (i === c.topChild) continue;
    const p = hitPath(c.children[i], px, py);
    if (p) return [c, ...p];
  }
  return c.hoverable ? [c] : null;
}

/** The path from root down to c, or null when c is not in root's tree. */
function pathTo(root: Component, c: Component): Component[] | null {
  if (root === c) return [root];
  for (const k of root.children) { const p = pathTo(k, c); if (p) return [root, ...p]; }
  return null;
}

/** Reports an action to the nearest onAction hook at or above c. */
function emit(root: Component, c: Component, action: string) {
  const path = pathTo(root, c) ?? [c, root];
  for (let i = path.length - 1; i >= 0; i--) {
    const h = path[i].onAction;
    if (h) { h(c, action); return; }
  }
}

/**
 * Delivers a pointer event to an interface laid out and rendered from `root`, as Clyde's Root
 * does: the press goes to the deepest component under the pointer that handles it (bubbling
 * up past those that do not), drags and the release go to that component, the wheel bubbles
 * until something scrolls. An open popup menu is modal. Returns true when the pointer is
 * over the interface (or it consumed the event), so the game can ignore it.
 */
export function dispatch(root: Component, ev: GuiEvent): boolean {
  let st = inputs.get(root);
  if (!st) inputs.set(root, st = { hover: null, pressed: null, drag: null, focus: null });
  const popup = root.overlay;
  const path = hitPath(popup ?? root, ev.x, ev.y);
  const target = path?.[path.length - 1] ?? null;
  switch (ev.type) {
    case "move":
      if (st.pressed) { drag(root, st, st.pressed, ev); return true; }
      setHover(st, target);
      return !!target || !!popup;
    case "down":
      // PopupMenu.dispatchEvent: a press outside the menu dismisses it
      if (popup && !path) { root.overlay = null; setHover(st, null); return true; }
      if (!path) { blur(st); return false; }
      for (let i = path.length - 1; i >= 0; i--) {
        if (press(root, st, path[i], ev)) { st.pressed = path[i]; break; }
      }
      if (st.focus && st.focus !== st.pressed) blur(st);
      return true;
    case "up": {
      const p = st.pressed;
      st.pressed = null;
      st.drag = null;
      if (p) { release(root, p); setHover(st, target); return true; }
      return !!target || !!popup;
    }
    case "wheel":
      if (!path) return !!popup;
      for (let i = path.length - 1; i >= 0; i--) if (wheel(root, path[i], ev)) break;
      return true;
  }
  return false;
}

/** Clears the hover, press and focus state of a root (e.g. when its interface is hidden). */
export function resetInput(root: Component) {
  const st = inputs.get(root);
  if (!st) return;
  if (st.hover) st.hover.hover = false;
  if (st.pressed) st.pressed.armed = false;
  blur(st);
  inputs.delete(root);
  root.overlay = null;
}

function setHover(st: Input, c: Component | null) {
  if (st.hover === c) return;
  if (st.hover) st.hover.hover = false;
  if (c) c.hover = true;
  st.hover = c;
}

/** MOUSE_PRESSED: returns true when c consumes the press. */
function press(root: Component, st: Input, c: Component, ev: GuiEvent): boolean {
  if (!c.enabled) return false;
  const left = (ev.button ?? 0) === 0;
  switch (c.kind) {
    // AbstractButton: the left button arms it; the action fires on release over it
    case "button": case "menuitem": c.armed = left; return true;
    case "combo": openPopup(root, c); return true;
    case "slider": if (left) slide(root, c, ev); return true;
    case "text": focusText(root, st, c); return true;
  }
  const bar = c.owner;
  if (bar?.kind === "scrollbar" && bar.model) {
    const m = bar.model, thumb = bar.parts.thumb!;
    if (c === thumb) { st.drag = { sv: m.value, sx: ev.x, sy: ev.y }; return true; }
    if (c === bar.parts.well && thumb.screen) {
      // ScrollBar._wellListener: a press beside the thumb pages towards the pointer
      const t = thumb.screen;
      const dv = bar.orientation === "HORIZONTAL" ? (ev.x < t.x ? -1 : ev.x > t.x + t.width ? 1 : 0)
        : (ev.y > t.y + t.height ? 1 : ev.y < t.y ? -1 : 0);
      if (dv) m.setValue(m.value + dv * Math.max(m.extent, m.scrollIncrement));
      return true;
    }
  }
  return false;
}

/** MOUSE_DRAGGED, delivered to the pressed component. */
function drag(root: Component, st: Input, c: Component, ev: GuiEvent) {
  if (c.kind === "button" || c.kind === "menuitem") {
    // disarm while the pointer is outside the button; rearm when it comes back
    const r = c.screen;
    c.armed = !!r && ev.x >= r.x && ev.y >= r.y && ev.x < r.x + r.width && ev.y < r.y + r.height;
  } else if (c.kind === "slider") slide(root, c, ev);
  else if (st.drag && c.owner?.kind === "scrollbar") {
    // ScrollBar._thumbListener: the value moves by the drag's share of the well
    const bar = c.owner, m = bar.model!, well = bar.parts.well!, wi = well.insets;
    const dv = bar.orientation === "HORIZONTAL"
      ? Math.trunc((ev.x - st.drag.sx) * m.range / Math.max(1, well.width - horiz(wi)))
      : Math.trunc((ev.y - st.drag.sy) * m.range / Math.max(1, well.height - vert(wi)));
    m.setValue(st.drag.sv + dv);
  }
}

/** MOUSE_RELEASED: an armed button fires. */
function release(root: Component, c: Component) {
  if ((c.kind === "button" || c.kind === "menuitem") && c.armed) { c.armed = false; fire(root, c); }
  c.armed = false;
}

/** AbstractButton.fireAction and the listeners Clyde's widgets put on their own buttons. */
function fire(root: Component, c: Component) {
  const o = c.owner;
  if (c.kind === "menuitem" && o?.kind === "combo") {
    // ComboPopupMenu.itemSelected: select the item and dismiss the menu
    root.overlay = null;
    const old = o.selectedIndex;
    selectItem(o, Number(c.action));
    if (o.selectedIndex !== old) emit(root, o, "select");
    return;
  }
  if (o?.kind === "tabbedpane" || o?.kind === "list") {
    // the tab and list buttons ignore clicks while selected
    if (c.selected) return;
    if (o.kind === "tabbedpane") selectTab(o, Number(c.action)); else selectEntry(o, Number(c.action));
    emit(root, o, "select");
    return;
  }
  if (o?.kind === "scrollbar" && o.model) {
    // ScrollBar._buttoner: less and more step by the scroll increment
    o.model.setValue(o.model.value + (c === o.parts.less ? -1 : 1) * o.model.scrollIncrement);
    return;
  }
  // ToggleButton.fireAction: a click flips the selection
  if (c.states >= 8) c.selected = !c.selected;
  emit(root, c, c.action || "click");
}

/** MOUSE_WHEELED: returns true when c scrolls. */
function wheel(root: Component, c: Component, ev: GuiEvent): boolean {
  const up = (ev.delta ?? 0) < 0; // Clyde's wheel delta is positive upward
  if (c.kind === "slider") {
    if (!c.enabled) return false;
    // Slider: a tenth of the range per notch
    const m = c.model!, d = Math.trunc(m.range / 10);
    if (m.setValue(up ? m.value + d : m.value - d)) emit(root, c, "change");
    return true;
  }
  // BoundedRangeModel.createWheelListener, on viewports and scroll bars
  const m = c.kind === "viewport" ? c.vmodel ?? c.hmodel : c.kind === "scrollbar" ? c.model : null;
  if (!m) return false;
  m.setValue(m.value + (up ? -1 : 1) * m.scrollIncrement * (ev.ctrl ? 2 : 1));
  return true;
}

/** Slider.updateValue: the frob's centre follows the pointer. */
function slide(root: Component, c: Component, ev: GuiEvent) {
  const f = labelIcon(c), r = c.screen, m = c.model;
  if (!f || !r || !m) return;
  const ins = c.insets;
  const mx = ev.x - r.x, my = r.y + r.height - ev.y;
  const span = c.orientation === "HORIZONTAL" ? c.width - horiz(ins) - f.width : c.height - vert(ins) - f.height;
  if (span <= 0) return;
  const v = m.min + Math.round(((c.orientation === "HORIZONTAL" ? mx - f.width * 0.5 : my - f.height * 0.5) * m.range) / span);
  if (m.setValue(v)) emit(root, c, "change");
}

/**
 * ComboBox's press: pops up its menu below it (PopupMenu.packAndFit), at most `rows` items
 * tall with the selected one scrolled into view.
 */
function openPopup(root: Component, combo: Component) {
  const menu = combo.popup;
  if (!menu || !combo.items.length) return;
  const pane = combo.rows ? menu.children[0] : null;
  const cont = pane?.parts.viewport?.children[0];
  if (pane && cont && cont.children.length > combo.rows) {
    const height = sum(cont.children.slice(0, combo.rows).map(k => preferredSize(k, -1, -1).height));
    pane.preferredSize = { width: -1, height };
  }
  pack(menu);
  pack(menu);
  const vm = pane?.parts.viewport?.vmodel;
  if (vm && cont) {
    const height = sum(cont.children.slice(0, Math.max(0, combo.selectedIndex)).map(k => preferredSize(k, -1, -1).height));
    vm.setRange(vm.min, Math.min(height, vm.max - vm.extent), vm.extent, vm.max);
  }
  root.overlay = menu;
}

// TextField editing is done by the browser: a hidden input holds the text while a field has focus
let hiddenInput: HTMLInputElement | null = null;

/** The text cursor's index while a field has focus. */
function textCursor(c: Component): number {
  const el = hiddenInput;
  return el && c.focused && document.activeElement === el ? el.selectionStart ?? c.text.length : c.text.length;
}

function focusText(root: Component, st: Input, c: Component) {
  if (st.focus === c) return;
  blur(st);
  st.focus = c;
  c.focused = true;
  if (typeof document === "undefined") return;
  if (!hiddenInput) {
    hiddenInput = document.createElement("input");
    hiddenInput.autocomplete = "off";
    hiddenInput.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0";
  }
  const el = hiddenInput;
  if (!el.isConnected) document.body.append(el);
  el.type = c.password ? "password" : "text";
  if (c.maxLength > 0) el.maxLength = c.maxLength; else el.removeAttribute("maxlength");
  el.value = c.text;
  el.oninput = () => { c.text = el.value; emit(root, c, "change"); };
  // keys typed into the field do not reach the game's own handlers
  el.onkeydown = e => {
    e.stopPropagation();
    if (e.key === "Enter") emit(root, c, "enter");
    else if (e.key === "Escape") el.blur();
  };
  el.onkeyup = e => e.stopPropagation();
  el.onblur = () => { if (st.focus === c) { st.focus = null; c.focused = false; } };
  const focus = () => { if (st.focus === c) { el.focus({ preventScroll: true }); el.setSelectionRange(el.value.length, el.value.length); } };
  // the canvas's own pointer-down default may take the focus back, so focus again afterwards
  focus();
  setTimeout(focus, 0);
}

function blur(st: Input) {
  const c = st.focus;
  if (!c) return;
  st.focus = null;
  c.focused = false;
  if (hiddenInput && typeof document !== "undefined" && document.activeElement === hiddenInput) hiddenInput.blur();
}
