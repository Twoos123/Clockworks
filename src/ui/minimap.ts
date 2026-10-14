// The minimap layer and the map overlay, as the client draws them (client/hud/Minimap and
// hud/z over map/client/a and Clyde's LargeSceneMap): the level's collision cells as a texture,
// walls in light teal (0.42, 0.69, 0.73), walkable floor in dark blue (0.082, 0.2, 0.29), so the
// explored level reads as an outline of its walls; cells come in as the knight explores, at full
// strength within 20 cells and fading out to 32. The minimap draws it at 3 pixels a unit inside
// the map mask, with entity icons from the data's MinimapIcon handlers (elevators, gold keys and
// gates) pinned to the edge, monsters as ui/minimap/monster.png inside it, and the knight as
// ui/minimap/player_local.png in its personal colour, turned to its heading at half strength.
// The overlay draws the same map over the whole screen at 4.5 pixels a unit at half strength.

import type { World } from "../game/world";
import type { GuiContext, GuiImage } from "./gui";

/** Map pixels per world unit: the minimap's (Minimap.a.Kf) and the overlay's (map/client/a.Kf). */
const SCALE = 3;
const OVERLAY_SCALE = 4.5;
/** Markers further than this many pixels from the centre are pinned to the edge (the client's radius). */
const EDGE = 69;
/** map/client/a.e: cells within 20 of the explorer show fully, fading to nothing at 32. */
const NEAR = 20, FAR = 32;

const WALL: [number, number, number] = [0.42, 0.69, 0.73];
const WALKABLE: [number, number, number] = [0.082, 0.2, 0.29];

export class Minimap {
  /** One canvas pixel per cell, premultiplied by each cell's reveal strength. */
  private canvas: OffscreenCanvas | null = null;
  private origin: [number, number] = [0, 0];
  /** Reveal strength per cell key. */
  private revealed = new Map<number, number>();
  private lastCell = "";
  private icons = new Map<string, GuiImage | null>();
  private world: World | null = null;

  constructor(private readonly gui: GuiContext) {}

  /** Starts mapping a new level. */
  setWorld(w: World) {
    if (w === this.world) return;
    this.world = w;
    this.revealed.clear();
    this.lastCell = "";
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
    this.canvas = new OffscreenCanvas(maxX - minX + 1, maxY - minY + 1);
  }

  /** Reveals the cells around the knight and paints those that grew stronger. */
  private reveal(w: World) {
    const k = w.knight, kx = Math.floor(k.x), ky = Math.floor(k.y);
    const at = kx + "," + ky;
    if (at === this.lastCell) return;
    this.lastCell = at;
    const g = this.canvas!.getContext("2d")!;
    for (let dy = -FAR; dy <= FAR; dy++) for (let dx = -FAR; dx <= FAR; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > FAR * FAR) continue;
      const a = d2 <= NEAR * NEAR ? 1 : 1 - (d2 - NEAR * NEAR) / (FAR * FAR - NEAR * NEAR);
      const x = kx + dx, y = ky + dy, key = (x + 32768) * 65536 + (y + 32768);
      if ((this.revealed.get(key) ?? 0) >= a) continue;
      this.revealed.set(key, a);
      const cell = w.collisionMap.cells.get(key);
      if (!cell) continue;
      const c = (cell.flags & 1) !== 0 ? WALL : cell.floor ? WALKABLE : null;
      if (!c) continue;
      const px = x - this.origin[0], py = this.origin[1] - y;
      g.clearRect(px, py, 1, 1);
      g.fillStyle = `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
      g.fillRect(px, py, 1, 1);
    }
  }

  private icon(file: string, color?: number): GuiImage | null {
    const key = file + "|" + (color ?? "");
    if (!this.icons.has(key)) {
      this.icons.set(key, null);
      const zs = color !== undefined ? [{ $class: "com.threerings.opengl.renderer.config.ColorizationConfig$Normal", colorization: color }] : undefined;
      void this.gui.image(file, zs).then(im => this.icons.set(key, im));
    }
    return this.icons.get(key) ?? null;
  }

  /** Prepares the map texture; false when there is nothing to draw. */
  private ready(): World | null {
    const world = this.world;
    if (!world?.knight) return null;
    if (!this.canvas) this.build(world);
    if (!this.canvas) return null;
    this.reveal(world);
    return world;
  }

  /** The map texture drawn centred on the knight at `scale` pixels a unit. */
  private drawMap(g: CanvasRenderingContext2D, world: World, cx: number, cy: number, scale: number, alpha: number) {
    const k = world.knight;
    const ox = cx + (this.origin[0] - k.x) * scale, oy = cy - (this.origin[1] + 1 - k.y) * scale;
    g.save();
    g.globalAlpha = alpha;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.canvas!, ox, oy, this.canvas!.width * scale, this.canvas!.height * scale);
    g.restore();
  }

  /** The knight's marker: player_local.png in the personal colour, turned to its heading, at half strength. */
  private drawSelf(g: CanvasRenderingContext2D, world: World, cx: number, cy: number) {
    const k = world.knight;
    const im = this.icon("ui/minimap/player_local.png", world.color);
    if (!im) return;
    g.save();
    g.globalAlpha = 0.5;
    g.translate(Math.round(cx), Math.round(cy));
    g.rotate(-k.heading);
    g.drawImage(im.source, -im.width / 2, -im.height / 2, im.width, im.height);
    g.restore();
  }

  /** Entities with MinimapIcon handlers, alive and placed. */
  private *entityIcons(world: World) {
    for (const e of [...world.logic.entries, ...world.logic.actors]) {
      const h2 = e.handlers.find(hh => hh.kind === "MinimapIcon");
      const file = h2?.cfg.icon?.file;
      if (!file || e.destroyed) continue;
      const im = this.icon(file);
      if (im) yield { im, x: e.x, y: e.y };
    }
  }

  /** The minimap inside the map background component at (x, y, w, h). */
  draw(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    if (w <= 0 || h <= 0) return;
    const world = this.ready();
    if (!world) return;
    const k = world.knight;
    const cx = x + w / 2, cy = y + h / 2;
    g.save();
    g.beginPath();
    g.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
    g.clip();
    this.drawMap(g, world, cx, cy, SCALE, 1);
    g.restore();
    // a marker past the edge radius is pinned to the edge, shrinking from `near` to `far` of its
    // size over 690 pixels and gone beyond (the client draws entity icons at 0.75 to 0.25,
    // monsters at 1 and only inside the edge)
    const marker = (im: GuiImage, wx: number, wy: number, near: number, far: number, pin: boolean) => {
      let dx = (wx - k.x) * SCALE, dy = -(wy - k.y) * SCALE;
      const d = Math.hypot(dx, dy);
      let s = near;
      if (d > EDGE) {
        if (!pin || d > EDGE + 690) return;
        s = near + (far - near) * (d - EDGE) / 690;
        dx *= EDGE / d; dy *= EDGE / d;
      }
      const iw = Math.round(im.width * s), ih = Math.round(im.height * s);
      g.drawImage(im.source, Math.round(cx + dx) - (iw >> 1), Math.round(cy + dy) - (ih >> 1), iw, ih);
    };
    for (const e of this.entityIcons(world)) marker(e.im, e.x, e.y, 0.75, 0.25, true);
    const mon = this.icon("ui/minimap/monster.png");
    if (mon) for (const m of world.liveMonsters) marker(mon, m.x, m.y, 1, 1, false);
    this.drawSelf(g, world, cx, cy);
  }

  /**
   * The map overlay (hud/z): the map over the whole screen centred on the knight at 4.5 pixels
   * a unit and half strength, the entity icons and monsters at full size wherever they are.
   */
  drawOverlay(g: CanvasRenderingContext2D, cw: number, ch: number) {
    const world = this.ready();
    if (!world) return;
    const k = world.knight;
    const cx = cw / 2, cy = ch / 2;
    this.drawMap(g, world, cx, cy, OVERLAY_SCALE, 0.5);
    const at = (im: GuiImage, wx: number, wy: number) =>
      g.drawImage(im.source, Math.round(cx + (wx - k.x) * OVERLAY_SCALE) - (im.width >> 1), Math.round(cy - (wy - k.y) * OVERLAY_SCALE) - (im.height >> 1));
    for (const e of this.entityIcons(world)) at(e.im, e.x, e.y);
    const mon = this.icon("ui/minimap/monster.png");
    if (mon) for (const m of world.liveMonsters) at(mon, m.x, m.y);
    this.drawSelf(g, world, cx, cy);
  }
}
