// The minimap layer: the level's walkable cells drawn top-down and revealed as the knight
// explores, monsters as the game's monster marker, the knight as an arrow, and entity icons from the data's
// MinimapIcon handlers (elevators, gold keys and gates). Drawn over the "mapbackground" component
// of the game's own minimap interface.

import type { World } from "../game/world";
import type { GuiContext, GuiImage } from "./gui";

/** Pixels per tile in the cached map image. */
const PX = 4;
/** Map pixels per world unit (the client's minimap scale). */
const SCALE = 3;
/** Markers further than this many pixels from the centre are pinned to the edge (the client's radius). */
const EDGE = 69;
/** Radius in tiles the knight reveals around itself. */
const REVEAL = 9;

export class Minimap {
  private canvas: OffscreenCanvas | null = null;
  private origin: [number, number] = [0, 0];
  private revealed = new Set<number>();
  private icons = new Map<string, GuiImage | null>();
  private world: World | null = null;

  constructor(private readonly gui: GuiContext) {}

  /** Starts mapping a new level. */
  setWorld(w: World) {
    if (w === this.world) return;
    this.world = w;
    this.revealed.clear();
    this.canvas = null;
  }

  private build(w: World) {
    const cells = w.collisionMap.cells;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const k of cells.keys()) {
      const x = Math.floor(k / 65536) - 32768, y = (k % 65536) - 32768;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    if (!isFinite(minX)) return;
    this.origin = [minX, maxY];
    this.canvas = new OffscreenCanvas((maxX - minX + 1) * PX, (maxY - minY + 1) * PX);
  }

  /** Reveals cells near the knight and paints them into the map image. */
  private reveal(w: World) {
    const c = this.canvas!, g = c.getContext("2d")!;
    const k = w.knight, kx = Math.floor(k.x), ky = Math.floor(k.y);
    for (let dy = -REVEAL; dy <= REVEAL; dy++) for (let dx = -REVEAL; dx <= REVEAL; dx++) {
      if (dx * dx + dy * dy > REVEAL * REVEAL) continue;
      const x = kx + dx, y = ky + dy, key = (x + 32768) * 65536 + (y + 32768);
      if (this.revealed.has(key)) continue;
      this.revealed.add(key);
      const cell = w.collisionMap.cells.get(key);
      if (!cell) continue;
      const wall = (cell.flags & 1) !== 0, floor = cell.floor;
      g.fillStyle = wall ? "rgba(40,52,64,0.9)" : floor ? "rgba(190,214,226,0.85)" : "rgba(0,0,0,0)";
      g.fillRect((x - this.origin[0]) * PX, (this.origin[1] - y) * PX, PX, PX);
    }
  }

  private icon(file: string): GuiImage | null {
    if (!this.icons.has(file)) {
      this.icons.set(file, null);
      void this.gui.image(file).then(im => this.icons.set(file, im));
    }
    return this.icons.get(file) ?? null;
  }

  draw(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    const world = this.world;
    if (!world?.knight || w <= 0 || h <= 0) return;
    if (!this.canvas) this.build(world);
    if (!this.canvas) return;
    this.reveal(world);
    const k = world.knight;
    const scale = SCALE;
    const cx = x + w / 2, cy = y + h / 2;
    const toScreen = (wx: number, wy: number): [number, number] => [cx + (wx - k.x) * scale, cy - (wy - k.y) * scale];
    g.save();
    g.beginPath();
    g.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
    g.clip();
    // the map image: tile (x, y) sits at canvas pixel ((x - minX) * PX, (maxY - y) * PX)
    const [ox, oy] = toScreen(this.origin[0], this.origin[1] + 1);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.canvas, ox, oy, this.canvas.width / PX * scale, this.canvas.height / PX * scale);
    // entity icons from MinimapIcon handlers, and monsters (ui/minimap/monster.png); a marker
    // past the edge radius is pinned to the edge, shrinking from `near` to `far` of its size over
    // 690 pixels and gone beyond (the client draws entity icons at 0.75 to 0.25, monsters at 1 and
    // only inside the edge)
    const marker = (im: GuiImage, wx: number, wy: number, near: number, far: number, pin: boolean) => {
      let dx = (wx - k.x) * scale, dy = -(wy - k.y) * scale;
      const d = Math.hypot(dx, dy), size = Math.max(im.width, im.height);
      let s = size * near;
      if (d > EDGE) {
        if (!pin || d > EDGE + 690) return;
        s = size * (near + (far - near) * (d - EDGE) / 690);
        dx *= EDGE / d; dy *= EDGE / d;
      }
      g.drawImage(im.source, cx + dx - s / 2, cy + dy - s / 2, s, s);
    };
    g.restore();
    for (const e of [...world.logic.entries, ...world.logic.actors]) {
      const h2 = e.handlers.find(hh => hh.kind === "MinimapIcon");
      const file = h2?.cfg.icon?.file;
      if (!file || e.destroyed) continue;
      const im = this.icon(file);
      if (im) marker(im, e.x, e.y, 0.75, 0.25, true);
    }
    const mon = this.icon("ui/minimap/monster.png");
    for (const m of world.liveMonsters) {
      if (mon) marker(mon, m.x, m.y, 1, 1, false);
      else { const [sx, sy] = toScreen(m.x, m.y); g.fillStyle = "#ff4d4d"; g.beginPath(); g.arc(sx, sy, 2.6, 0, Math.PI * 2); g.fill(); }
    }
    // the knight, pointing where it faces
    g.save();
    g.translate(cx, cy);
    g.rotate(-k.heading);
    g.fillStyle = "#ffd84d";
    g.strokeStyle = "rgba(0,0,0,0.6)";
    g.beginPath(); g.moveTo(6, 0); g.lineTo(-4, 4); g.lineTo(-2, 0); g.lineTo(-4, -4); g.closePath();
    g.fill(); g.stroke();
    g.restore();
  }
}
