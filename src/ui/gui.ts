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
  background: Background | null;
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
      padding: insets(o.padding),
      background,
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

// ----------------------------------------------------------------------------- components

/** Component._offset: a 2D transform about the component's centre, set by scripts. */
export interface Offset { tx: number; ty: number; rotation: number; scale: number }

type CompKind = "container" | "spacer" | "label" | "button" | "ui" | "view";
const STATES = ["", "Hover", "Disabled"] as const;

export class Component {
  x = 0; y = 0; width = 0; height = 0;
  children: Component[] = [];
  /** The child entry this component was added with (meaning depends on the parent layout). */
  constraints: any = null;
  /** A container's LayoutConfig. */
  layout: any = null;
  /** Styles for the default, hover and disabled states. */
  styles: (Style | null)[] = [null, null, null];
  /** Pseudo-class styles (Name:Empty, Name:Selected...) loaded with loadPseudo. */
  pseudo = new Map<string, Style | null>();
  /** A pseudo-class to render with instead of the state's style, e.g. "Empty". */
  pseudoClass: string | null = null;
  preferredSize: { width: number; height: number } | null = null;
  text = "";
  icon: GuiImage | null = null;
  iconTextGap = 3;
  orientation = "HORIZONTAL";
  fit = "WRAP";
  preferredWidth = 0;
  visible = true;
  enabled = true;
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
  constructor(readonly kind: CompKind, public config: any) {}

  get style(): Style | null {
    if (this.pseudoClass) {
      const s = this.pseudo.get(this.pseudoClass);
      if (s) return s;
    }
    return (!this.enabled ? this.styles[2] : this.hover ? this.styles[1] : null) ?? this.styles[0];
  }
  get insets(): Insets { return this.style?.padding ?? ZERO; }

  /** Sets alpha on this component and, as Clyde's Container does, every descendant. */
  setAlpha(a: number) { this.alpha = a; for (const c of this.children) c.setAlpha(a); }

  find(tag: string): Component | null {
    if (this.tag === tag) return this;
    for (const c of this.children) { const r = c.find(tag); if (r) return r; }
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
};

async function buildComponent(ctx: GuiContext, cfg: any, local: Map<string, any>, opts: BuildOptions, depth: number): Promise<Component> {
  const k = kind(cfg);
  const ck: CompKind = k === "Container" ? "container" : k === "Label" || k === "StatusLabel" || k === "FadeLabel" ? "label"
    : k === "Button" || k === "ToggleButton" || k === "CheckBox" ? "button" : k === "UserInterface" ? "ui"
    : k === "RenderableView" ? "view" : "spacer";
  let c: Component;
  if (ck === "ui") {
    let ref = cfg.userInterface;
    const extra = cfg.tag ? opts.overrides?.get(cfg.tag) : undefined;
    if (ref && extra) {
      const entries = [...((ref.arguments?.entries ?? []) as [string, unknown][]).filter(([kk]) => !(kk in extra)), ...Object.entries(extra)];
      ref = { ...ref, arguments: { $map: "com.threerings.config.ArgumentMap", entries } };
    }
    c = (await buildInterface(ctx, ref, opts, depth + 1)) ?? new Component("ui", cfg);
    c.config = cfg;
  } else {
    c = new Component(ck, cfg);
    c.local = local;
  }
  c.tag = cfg.tag ?? "";
  c.visible = cfg.visible ?? true;
  c.enabled = cfg.enabled ?? true;
  c.alpha = cfg.alpha ?? 1;
  // Component.setStyleConfig: the named style plus Name:Hover and Name:Disabled
  const sref = cfg.style ?? { $class: CONFIG_REF, name: DEFAULT_STYLES[ck] };
  c.styleRef = sref;
  const [s0, s1, s2] = await Promise.all(STATES.map((st, i) => i === 0 ? ctx.resolveStyle(sref, local)
    : ctx.resolveStyle({ ...sref, name: `${sref.name}:${st}` }, local)));
  c.styles = [s0 ?? (await ctx.resolveStyle({ $class: CONFIG_REF, name: DEFAULT_STYLES[ck] }, local)), s1, s2];
  // the style's size applies first; the component's own preferred size overrides it
  if (c.styles[0]?.size) c.preferredSize = { ...c.styles[0].size };
  if (cfg.preferredSize) c.preferredSize = { width: cfg.preferredSize.width ?? 0, height: cfg.preferredSize.height ?? 0 };
  if (ck === "label" || ck === "button") {
    c.text = cfg.text ?? "";
    c.iconTextGap = cfg.iconTextGap ?? 3;
    c.orientation = enumName(cfg.orientation, "HORIZONTAL");
    c.fit = enumName(cfg.fit, "WRAP");
    c.preferredWidth = cfg.preferredWidth ?? 0;
    // a button whose style supplies an icon keeps the style's icon
    c.icon = (ck === "button" && c.styles[0]?.icon) ? c.styles[0].icon : (await ctx.icon(cfg.icon)) ?? c.styles[0]?.icon ?? null;
    if (c.styles[0]) c.fontFamily = await ctx.font(c.styles[0].font);
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
  return c;
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
function layoutText(c: Component, maxWidth: number): TextLines | null {
  const s = c.style;
  if (!c.text || !s || !measureCanvas) return null;
  const g = measureCanvas;
  g.font = cssFont(c, s);
  const m = g.measureText("Hg");
  const ascent = Math.ceil(m.fontBoundingBoxAscent ?? s.fontSize * 0.9);
  const lineHeight = ascent + Math.ceil(m.fontBoundingBoxDescent ?? s.fontSize * 0.25);
  const grow = s.textEffect === "OUTLINE" ? 1 + Math.ceil(s.effectSize / 2) : s.textEffect === "SHADOW" ? s.effectSize : 0;
  const lines: string[] = [];
  for (const para of c.text.split("\n")) {
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

function labelSize(c: Component, whint: number): { width: number; height: number; text: TextLines | null } {
  let hint = c.preferredWidth > 0 ? c.preferredWidth : whint > 0 ? whint : 32766;
  if (c.text && c.icon && c.orientation === "HORIZONTAL") hint -= c.iconTextGap + c.icon.width;
  const text = layoutText(c, hint);
  const iw = c.icon?.width ?? 0, ih = c.icon?.height ?? 0;
  const tw = text?.width ?? 0, th = text?.height ?? 0, gap = c.icon && text ? c.iconTextGap : 0;
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
  if (c.kind === "label" || c.kind === "button") { const s = labelSize(c, whint); return { width: s.width, height: s.height }; }
  if (c.kind === "ui") {
    const root = c.children[0];
    return root && root.visible ? preferredSize(root, whint, hhint) : { width: 0, height: 0 };
  }
  if (c.kind !== "container" || !c.layout) return { width: 0, height: 0 };
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
  const ins = c.insets;
  const bw = c.width - horiz(ins), bh = c.height - vert(ins);
  const set: Setter = (k, x, y, w, h) => { k.x = x; k.y = y; k.width = w; k.height = h; };
  if (c.kind === "ui") {
    const root = c.children[0];
    if (root) set(root, ins.left, ins.bottom, bw, bh);
  } else if (c.kind === "container" && c.layout) {
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
 * Draws a laid-out tree. (ox, oy) is the parent's lower-left corner in canvas coordinates
 * (y down), so a Clyde position (x, y) maps to (ox + x, oy - y).
 */
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
    return;
  }
  renderSelf(c, g, x, y, hooks);
}

function renderSelf(c: Component, g: CanvasRenderingContext2D, x: number, y: number, hooks: RenderHooks) {
  c.screen = { x, y: y - c.height, width: c.width, height: c.height };
  const s = c.style;
  if (s?.background) drawBackground(g, s.background, x, y, c.width, c.height, c.alpha);
  if (c.kind === "view" && hooks.view) hooks.view(c, g, x, y - c.height, c.width, c.height);
  const tagHook = c.tag ? hooks.tagged?.[c.tag] : undefined;
  if (tagHook) tagHook(c, g, x, y - c.height, c.width, c.height);
  if ((c.kind === "label" || c.kind === "button") && s) drawLabel(c, s, g, x, y);
  for (const k of c.children) render(k, g, x, y, hooks);
}

/** Image.render(sx, sy, sw, sh, tx, ty, tw, th) with Clyde's bottom-up source and target y. */
function blit(g: CanvasRenderingContext2D, im: GuiImage, sx: number, sy: number, sw: number, sh: number,
  bx: number, by: number, tx: number, ty: number, tw: number, th: number) {
  if (sw <= 0 || sh <= 0 || tw <= 0 || th <= 0) return;
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
  const ins = s.padding;
  const size = labelSize(c, c.width - horiz(ins));
  const xoff = (w: number) => s.textAlignment === "RIGHT" ? c.width - w - ins.right
    : s.textAlignment === "CENTER" ? Math.trunc((c.width - horiz(ins) - w) / 2) + ins.left : ins.left;
  const yoff = (h: number) => s.verticalAlignment === "TOP" ? c.height - h - ins.top
    : s.verticalAlignment === "BOTTOM" ? ins.bottom : Math.trunc((c.height - vert(ins) - h) / 2) + ins.bottom;
  let ix = 0, iy = 0, tx = 0, ty = 0;
  const text = size.text;
  if (c.orientation === "VERTICAL") {
    if (text) { tx = xoff(text.width); ty = yoff(size.height); }
    if (c.icon) { ix = xoff(c.icon.width); iy = yoff(size.height) + (text ? text.height + c.iconTextGap : 0); }
  } else {
    if (c.icon) { ix = xoff(size.width); iy = yoff(c.icon.height); }
    if (text) { tx = xoff(size.width) + (c.icon ? c.icon.width + c.iconTextGap : 0); ty = yoff(text.height); }
  }
  if (c.icon && c.alpha > 0) {
    g.globalAlpha = c.alpha;
    blit(g, c.icon, 0, 0, c.icon.width, c.icon.height, bx, by, ix, iy, c.icon.width, c.icon.height);
    g.globalAlpha = 1;
  }
  if (!text || c.alpha <= 0 || s.color[3] <= 0) return;
  g.font = cssFont(c, s);
  g.textBaseline = "alphabetic";
  g.lineJoin = "round";
  // lines run downward from the top of the text block
  let top = by - ty - text.height;
  for (const line of text.lines) {
    const lw = g.measureText(line).width + text.grow * 2;
    const lx = bx + tx + (s.textAlignment === "RIGHT" ? text.width - lw : s.textAlignment === "CENTER" ? (text.width - lw) / 2 : 0) + text.grow;
    const base = top + text.grow + text.ascent;
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
    top += text.lineHeight + text.grow * 2 + s.lineSpacing;
  }
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
