// Play-mode HUD drawn on a 2D canvas over the WebGL view: the knight's health, monster
// health bars, floating damage numbers and a defeated screen.

import { multiply, type Mat4 } from "../math";
import type { World } from "./world";

export class Hud {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(world: World, proj: Mat4, view: Mat4) {
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
    for (const m of world.liveMonsters) {
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

    // knight health, bottom centre
    const k = world.knight;
    const bw = Math.min(360, cw - 40), bx = (cw - bw) / 2, by = ch - 48;
    g.fillStyle = "rgba(10,12,18,0.75)";
    roundRect(g, bx - 8, by - 22, bw + 16, 46, 8);
    g.fill();
    g.fillStyle = "#3a1f24";
    g.fillRect(bx, by, bw, 14);
    const frac = Math.max(0, k.health / k.maxHealth);
    const grad = g.createLinearGradient(bx, by, bx, by + 14);
    grad.addColorStop(0, "#ff7a7a");
    grad.addColorStop(1, "#c93a3a");
    g.fillStyle = grad;
    g.fillRect(bx, by, bw * frac, 14);
    g.fillStyle = "#fff";
    g.font = "600 12px system-ui, sans-serif";
    g.textAlign = "left";
    g.fillText(`Health ${Math.ceil(k.health)} / ${k.maxHealth}`, bx, by - 6);
    g.textAlign = "right";
    g.fillText(`Monsters defeated: ${world.killCount}   Nearby: ${world.liveMonsters.length}`, bx + bw, by - 6);
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
