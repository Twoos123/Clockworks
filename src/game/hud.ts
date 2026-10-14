// Play-mode HUD drawn on a 2D canvas over the WebGL view: the knight's health, monster
// health bars, floating damage numbers and a defeated screen.

import { multiply, type Mat4 } from "../math";
import type { Floater, World } from "./world";
import { NUMBER_FONTS, numberPose } from "./feedback";

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
    const p = project(x, y, z), q = project(x, y, z + 1);
    if (!p || !q) return;
    const st = NUMBER_FONTS[f.style!];
    // a label about half a unit tall at size 1 (ours: the billboard's scale is not in the data)
    const unit = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const px = unit * 0.55 * pose.scale * (st.size / 32);
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

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Draws world-space HUD bits, then `overlay` (the game's own HUD panels) on top. */
  draw(world: World, proj: Mat4, view: Mat4, overlay?: (g: CanvasRenderingContext2D, cw: number, ch: number) => void) {
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
    for (const f of this.options.damageNumbers ? world.floaters : []) {
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

    // charge meter above the knight
    if (k.charge !== null && k.weapon) {
      const p = project(k.x, k.y, k.z + 2.1);
      if (p) {
        const frac = Math.min(1, (k.charge * 1000) / k.weapon.chargeTime);
        g.fillStyle = "rgba(0,0,0,0.6)";
        g.fillRect(p[0] - 31, p[1] - 1, 62, 9);
        g.fillStyle = frac >= 1 ? (Math.floor(performance.now() / 120) % 2 ? "#ffe066" : "#fff6c2") : "#8ec5ff";
        g.fillRect(p[0] - 30, p[1], 60 * frac, 7);
      }
    }
    g.textAlign = "left";
    // the game's HUD panels, at the chosen size
    const s = this.options.hudScale;
    g.save();
    g.scale(s, s);
    overlay?.(g, cw / s, ch / s);
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
