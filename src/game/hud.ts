// Play-mode HUD drawn on a 2D canvas over the WebGL view: the knight's health, monster
// health bars, floating damage numbers and a defeated screen.

import { multiply, type Mat4 } from "../math";
import type { Floater, World } from "./world";
import { labelPose, NUMBER_FONTS, numberPose } from "./feedback";
import { wrapText, type ChatLog } from "./lootlog";

/** character/label.dat's ComponentBillboardConfig scale: world units a GUI pixel. */
const NAME_SCALE = 0.008;
/** sprite/g's label colour: ColorPository print 514 (item_1 grey_lite), its colorized root. */
const NAME_COLOR = "rgb(191,191,191)";

export class Hud {
  private readonly ctx: CanvasRenderingContext2D;
  /** Display options from the options menu. */
  options = { healthBars: true, damageNumbers: true, hudScale: 1, fps: false };
  private fpsTimes: number[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  /**
   * A damage or heal number as the game draws it (fx_damagenumber.dat's billboarded labels):
   * the style's font and outline, popping in and falling on the layer's path, drawn over
   * everything (its depth test is ALWAYS).
   */
  private drawNumber(g: CanvasRenderingContext2D, f: Floater, project: (x: number, y: number, z: number) => [number, number] | null) {
    const pose = numberPose(f.style!, f.age, f.seed);
    if (!pose || pose.scale <= 0.01) return;
    const x = f.x + pose.dx, y = f.y + pose.dy, z = f.z + pose.dz;
    const p = project(x, y, z);
    if (!p) return;
    const st = NUMBER_FONTS[f.style!];
    // the label's billboard: 0.01 world units a GUI pixel (ComponentBillboardConfig's scale)
    // times the particle's size
    const px = this.unitPx(x, y, z) * 0.01 * st.size * pose.scale;
    if (px < 2) return;
    g.save();
    g.translate(p[0], p[1]);
    if (pose.turn) g.rotate(-pose.turn);
    g.font = `${st.italic ? "italic " : ""}${st.bold ? "bold " : ""}${px.toFixed(1)}px "Arial Black", "Arial", sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    g.lineWidth = px * (st.outlineSize / st.size);
    g.strokeStyle = st.outline;
    g.strokeText(f.text, 0, 0);
    g.fillStyle = st.color;
    g.fillText(f.text, 0, 0);
    g.restore();
  }

  /**
   * character/label.dat, the NameLabel billboard (0.008 world units a GUI pixel): the name in
   * its Label style (Arial Black 26, a 4 pixel black outline) with the description's name icon
   * before it, and the title under it in its Sublabel style (Arial Black 20), both in the
   * colour sprite/g gives them: colour print 514 (item_1 grey_lite, 191 grey).
   */
  private drawNameplates(g: CanvasRenderingContext2D, world: World, project: (x: number, y: number, z: number) => [number, number] | null,
    unitPx: (x: number, y: number, z: number) => number) {
    const plates = world.nameplates();
    if (!plates.length) return;
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    for (const n of plates) {
      const p = project(n.x, n.y, n.z), k = unitPx(n.x, n.y, n.z) * NAME_SCALE;
      if (!p || k * 26 < 6) continue;
      const nameH = 26 * k, subH = n.title ? 20 * k : 0;
      // the label's vertical group is centred on its root
      let y = p[1] - (nameH + subH) / 2 + nameH / 2;
      const line = (text: string, size: number, yy: number) => {
        g.font = `${(size * k).toFixed(1)}px "Arial Black", "Arial", sans-serif`;
        g.lineWidth = 2 * 4 * k;
        g.strokeStyle = "#000";
        g.strokeText(text, p[0] + (size === 26 && icon ? (icon.width * (size * k / icon.height) + 2 * k) / 2 : 0), yy);
        g.fillStyle = NAME_COLOR;
        g.fillText(text, p[0] + (size === 26 && icon ? (icon.width * (size * k / icon.height) + 2 * k) / 2 : 0), yy);
        return g.measureText(text).width;
      };
      const icon = n.icon ? this.img(n.icon) : null;
      const w = line(n.name, 26, y);
      if (icon) {
        const ih = 26 * k, iw = icon.width * (ih / icon.height);
        g.drawImage(icon.source, p[0] - (w + iw + 2 * k) / 2, y - ih / 2, iw, ih);
      }
      y += nameH / 2 + subH / 2;
      if (n.title) line(n.title, 20, y);
    }
    g.restore();
  }

  /**
   * A particle label (status names, "Health At Max!"): billboarded Arial Black at 0.01 world
   * units a GUI pixel, outlined, wrapped to the billboard's width, drifting on its path.
   */
  private drawLabel(g: CanvasRenderingContext2D, f: Floater, project: (x: number, y: number, z: number) => [number, number] | null) {
    const l = f.label!, pose = labelPose(l, f.age);
    if (!pose || pose.scale <= 0.01) return;
    const z = f.z + pose.dz, p = project(f.x, f.y, z);
    if (!p) return;
    const k = this.unitPx(f.x, f.y, z) * 0.01 * pose.scale;
    const px = k * l.size;
    if (px < 2) return;
    g.save();
    g.font = `${px.toFixed(1)}px "Arial Black", "Arial", sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    g.lineWidth = k * l.outlineSize;
    g.strokeStyle = l.outline;
    g.fillStyle = l.color;
    const lines = wrapText(f.text, k * l.width, s => g.measureText(s).width);
    const lh = px * 1.05;
    lines.forEach((s, i) => {
      const y = p[1] + (i - (lines.length - 1) / 2) * lh;
      g.strokeText(s, p[0], y);
      g.fillText(s, p[0], y);
    });
    g.restore();
  }

  /** The chat overlay's lines (loot messages), drawn at the bottom left. */
  chat: ChatLog | null = null;
  /** The chat font's size (ProjectXPrefs ChatFont SMALL, 14). */
  chatFont = 14;

  /**
   * The chat overlay (hud/default/chatoverlay.dat, placed by client/chat/l.JQ): the window at
   * 0, 64 from the bottom left, its display 5 in and 30 up, 290 by 200; the lines sit at the
   * display's bottom in Arial Black, outlined black 2 (ChatOverlayText), newest last.
   */
  private drawChat(g: CanvasRenderingContext2D, ch: number) {
    const lines = this.chat?.lines;
    if (!lines?.length) return;
    const size = this.chatFont, lh = Math.round(size * 1.3), width = 290, height = 200;
    const left = 5 + 8, bottom = ch - 64 - 30 - 4;
    g.save();
    g.font = `${size}px "Arial Black", "Arial", sans-serif`;
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.lineJoin = "round";
    g.lineWidth = 3;
    g.strokeStyle = "#000";
    const rows: { text: string; color: string }[] = [];
    for (let i = lines.length - 1; i >= 0 && rows.length * lh < height; i--) {
      const wrapped = wrapText(lines[i].text, width - 16, s => g.measureText(s).width);
      for (let j = wrapped.length - 1; j >= 0; j--) rows.unshift({ text: wrapped[j], color: lines[i].color });
    }
    const max = Math.floor(height / lh);
    const shown = rows.slice(Math.max(0, rows.length - max));
    shown.forEach((r, i) => {
      const y = bottom - (shown.length - 1 - i) * lh;
      g.strokeText(r.text, left, y);
      g.fillStyle = r.color;
      g.fillText(r.text, left, y);
    });
    g.restore();
  }

  private unitPx: (x: number, y: number, z: number) => number = () => 0;
  /** Loads a game image for the HUD's billboards (set by the app). */
  image: ((file: string) => Promise<{ source: CanvasImageSource; width: number; height: number } | null>) | null = null;
  private images = new Map<string, { source: CanvasImageSource; width: number; height: number } | null>();
  private img(file: string) {
    if (!this.images.has(file)) {
      this.images.set(file, null);
      void this.image?.(file).then(i => this.images.set(file, i));
    }
    return this.images.get(file) ?? null;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Draws world-space HUD bits, then `under` (help bubbles), then `overlay` (the game's own HUD panels) on top. */
  draw(world: World, proj: Mat4, view: Mat4, overlay?: (g: CanvasRenderingContext2D, cw: number, ch: number) => void,
    under?: (g: CanvasRenderingContext2D, project: (x: number, y: number, z: number) => [number, number] | null) => void) {
    const c = this.canvas, dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.scale(dpr, dpr);
    const cw = w / dpr, ch = h / dpr;
    const pv = multiply(proj, view);
    const project = (x: number, y: number, z: number): [number, number] | null => {
      const cx = pv[0] * x + pv[4] * y + pv[8] * z + pv[12], cy = pv[1] * x + pv[5] * y + pv[9] * z + pv[13];
      const cwv = pv[3] * x + pv[7] * y + pv[11] * z + pv[15];
      if (cwv <= 0.01) return null;
      return [(cx / cwv * 0.5 + 0.5) * cw, (1 - (cy / cwv * 0.5 + 0.5)) * ch];
    };
    // screen pixels per world unit for a billboard at a point (one unit along the camera's right)
    const unitPx = (x: number, y: number, z: number) => {
      const a = project(x, y, z), b = project(x + view[0], y + view[4], z + view[8]);
      return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
    };
    this.unitPx = unitPx;

    // the names over townsfolk and machines (client/sprite/g on character/label.dat)
    this.drawNameplates(g, world, project, unitPx);

    // monster health bars
    for (const m of this.options.healthBars ? world.liveMonsters : []) {
      if (m.health >= m.maxHealth) continue;
      const p = project(m.x, m.y, m.z + 1.3 * m.scale + 0.3);
      if (!p) continue;
      const bw = 42, frac = Math.max(0, m.health / m.maxHealth);
      g.fillStyle = "rgba(0,0,0,0.6)";
      g.fillRect(p[0] - bw / 2 - 1, p[1] - 1, bw + 2, 7);
      g.fillStyle = frac > 0.5 ? "#7bd88f" : frac > 0.25 ? "#f5c542" : "#ef5b5b";
      g.fillRect(p[0] - bw / 2, p[1], bw * frac, 5);
    }

    // floating damage numbers
    g.textAlign = "center";
    g.font = "bold 18px system-ui, sans-serif";
    for (const f of world.floaters) {
      // particle labels (status names) are effects, not damage numbers: they show either way
      if (f.label) { this.drawLabel(g, f, project); continue; }
      if (!this.options.damageNumbers) continue;
      if (f.style) { this.drawNumber(g, f, project); continue; }
      const p = project(f.x, f.y, f.z + f.age * 1.2);
      if (!p) continue;
      g.globalAlpha = Math.max(0, 1 - f.age / 1.2);
      g.lineWidth = 3;
      g.strokeStyle = "rgba(0,0,0,0.8)";
      g.strokeText(f.text, p[0], p[1]);
      g.fillStyle = f.color;
      g.fillText(f.text, p[0], p[1]);
    }
    g.globalAlpha = 1;

    const k = world.knight;

    // the charge bar (character/charge_transformed.dat): a 100 x 20 billboard at 0.015 units a
    // pixel, 0.667 below the knight's root, at half opacity, filling with the charge; it gives
    // way to the charge-complete effect once full
    const progress = world.chargeProgress();
    if (progress !== null && progress <= 1) {
      const p = project(k.x, k.y, k.z - 0.667), u = unitPx(k.x, k.y, k.z - 0.667);
      if (p && u > 0) {
        const bw = 100 * 0.015 * u, bh = 20 * 0.015 * u, x0 = p[0] - bw / 2, y0 = p[1] - bh / 2;
        g.save();
        g.globalAlpha = 0.5;
        const back = this.img("ui/health/chargemeter_empty.png"), fill = this.img("ui/health/chargemeter.png");
        if (back) g.drawImage(back.source, x0, y0, bw, bh); else { g.fillStyle = "rgb(41,50,57)"; g.fillRect(x0, y0, bw, bh); }
        const fw = Math.max(0, Math.min(1, progress));
        if (fill && fw > 0) g.drawImage(fill.source, 0, 0, fill.width * fw, fill.height, x0, y0, bw * fw, bh);
        else if (fw > 0) { g.fillStyle = "rgb(250,183,61)"; g.fillRect(x0, y0, bw * fw, bh); }
        g.restore();
      }
    }
    g.textAlign = "left";
    // windows pinned in the world (help bubbles), under the HUD
    under?.(g, project);
    // the game's HUD panels, at the chosen size
    const s = this.options.hudScale;
    g.save();
    g.scale(s, s);
    overlay?.(g, cw / s, ch / s);
    this.drawChat(g, ch / s);
    g.restore();
    if (this.options.fps) {
      const now = performance.now();
      this.fpsTimes.push(now);
      while (this.fpsTimes.length && this.fpsTimes[0] < now - 1000) this.fpsTimes.shift();
      g.font = "bold 12px system-ui, sans-serif";
      g.fillStyle = "#e6f2ff";
      g.fillText(`${this.fpsTimes.length} fps`, cw / 2 - 20, 14);
    }
  }
}
