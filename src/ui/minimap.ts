// The minimap and the full map overlay, drawn as the game's map components draw them
// (client/hud/Minimap, its dungeon subclasses, client/hud/z and the map overlay window):
// - the level map (src/game/levelmap.ts) is a texture of one texel per cell: reached floor dark
//   blue, other floor grey-blue, walls and edges light blue, so the level reads as a light outline;
// - the minimap shows it at 3 pixels a unit inside the 160-pixel round mask, centred on the
//   knight, under the hash marks and gloss. Markers follow: the knight (ui/minimap/player_local.png
//   in its personal colour, half transparent, turned to its heading), the MinimapIcon entities
//   (0.75 size; past 69 pixels pinned to the edge, shrinking to 0.25 over 690 pixels, then gone)
//   and the monsters (ui/minimap/monster.png, only within 69 pixels);
// - the overlay (the map button; the HUD keeps the map_overlay preference) draws the same map over the whole
//   screen at 4.5 pixels a unit and half opacity, with the knight and the entity icons at full size;
// - Clockworks levels reveal the map in discs around where the knight has been; other places show
//   the map around every reached cell.

import type { World } from "../game/world";
import type { LoadedScene } from "../scene";
import { Exploration, LevelMap } from "../game/levelmap";
import type { GuiContext, GuiImage } from "./gui";

/** Minimap pixels per world unit (Minimap.a.Kf). */
const SCALE = 3;
/** Overlay pixels per world unit, and its opacity (map component defaults Kf, Kg). */
const OVERLAY_SCALE = 4.5, OVERLAY_ALPHA = 0.5;
/** Markers further than this many pixels from the centre are pinned to the edge (the client's radius). */
const EDGE = 69;
/** How far past the edge pinned icons shrink before they vanish. */
const FADE = 690;
/** The map mask (ui/hud_v2/images/minimap/mask.png) and its size before it loads. */
const MASK = "ui/hud_v2/images/minimap/mask.png", MASK_SIZE = 160;
/** The self marker's colour print in towns (AbstractMapComponent: 264); dungeons use the knight's colour. */
const TOWN_SELF_COLOR = 264;

/** Map colours (the map component's colour set: floor, blocked, reached). */
const FLOOR = [74, 112, 120], BLOCKED = [107, 176, 186], REACHED = [21, 51, 74];

export interface MinimapPlace {
  /** Clockworks levels reveal the map as the knight explores (MapType.DISCOVER). */
  discover: boolean;
  /** Dungeon markers: the knight in its personal colour, and monsters. */
  dungeon: boolean;
}

export class Minimap {
  private world: World | null = null;
  private map: LevelMap | null = null;
  private explored: Exploration | null = null;
  private visited = new Set<string>();
  private texture: OffscreenCanvas | null = null;
  private dirty = true;
  private layer: OffscreenCanvas | null = null;
  private icons = new Map<string, GuiImage | null>();
  private place: MinimapPlace = { discover: false, dungeon: false };

  constructor(private readonly gui: GuiContext) {}

  /** Starts mapping a level (the scene's level map, seeded at the knight's spawn). */
  setWorld(w: World, scene: LoadedScene | null, place: MinimapPlace) {
    if (w === this.world) return;
    this.world = w;
    this.place = place;
    this.map = scene?.levelMap ?? null;
    this.visited.clear();
    this.texture = null;
    this.dirty = true;
    const map = this.map;
    if (!map) { this.explored = null; return; }
    if (w.knight) map.entrance(w.knight.x, w.knight.y);
    map.flood();
    const b = map.bounds();
    this.explored = !b ? null : place.discover ? new Exploration(b.minX, b.minY, b.maxX, b.maxY) : Exploration.around(map);
  }

  private icon(file: string, colorization?: number): GuiImage | null {
    const key = colorization === undefined ? file : `${file}|${colorization}`;
    if (!this.icons.has(key)) {
      this.icons.set(key, null);
      const zs = colorization === undefined ? undefined : [{ $class: "com.threerings.media.image.ColorizationConfig$Normal", colorization }];
      void this.gui.image(file, zs).then(im => this.icons.set(key, im));
    }
    return this.icons.get(key) ?? null;
  }

  /** Explores around the knight (the dungeon marks the two-unit square it stands in). */
  private explore(w: World) {
    const e = this.explored;
    if (!this.place.discover || !e || !w.knight) return;
    const vx = Math.round(w.knight.x / 2), vy = Math.round(w.knight.y / 2);
    const id = `${vx},${vy}`;
    if (this.visited.has(id)) return;
    this.visited.add(id);
    if (e.stamp(Math.round((vx + 0.5) * 2), Math.round((vy + 0.5) * 2))) this.dirty = true;
  }

  /** The map texture: one texel per cell, row 0 at the top (the highest y). */
  private paint(): OffscreenCanvas | null {
    const map = this.map, e = this.explored;
    if (!map || !e) return null;
    if (this.texture && !this.dirty) return this.texture;
    const tex = this.texture ??= new OffscreenCanvas(e.width, e.height);
    const g = tex.getContext("2d")!;
    const img = g.createImageData(e.width, e.height);
    const d = img.data;
    for (const [x, y, v, reached] of map.cells()) {
      const a = e.at(x, y);
      if (a <= 0) continue;
      const c = reached ? REACHED : v === 0 ? FLOOR : BLOCKED;
      const n = ((e.height - 1 - (y - e.minY)) * e.width + (x - e.minX)) * 4;
      d[n] = c[0]; d[n + 1] = c[1]; d[n + 2] = c[2]; d[n + 3] = Math.round(a * 255);
    }
    g.putImageData(img, 0, 0);
    this.dirty = false;
    return tex;
  }

  /** Draws the map texture with the point (cx, cy) on screen at the world point (tx, ty). */
  private drawMap(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, tex: OffscreenCanvas, scale: number, cx: number, cy: number, tx: number, ty: number) {
    const e = this.explored!;
    g.imageSmoothingEnabled = false;
    g.drawImage(tex, cx + (e.minX - tx) * scale, cy - (e.minY + e.height - ty) * scale, e.width * scale, e.height * scale);
  }

  /** The knight's marker: player_local.png in its colour, half transparent, turned to its heading. */
  private self(g: CanvasRenderingContext2D, w: World, x: number, y: number) {
    const k = w.knight;
    const im = this.icon("ui/minimap/player_local.png", this.place.dungeon ? w.color : TOWN_SELF_COLOR);
    if (!im) return;
    g.save();
    g.globalAlpha *= 0.5;
    g.translate(Math.round(x), Math.round(y));
    g.rotate(-k.heading);
    g.drawImage(im.source, -Math.trunc(im.width / 2), -Math.trunc(im.height / 2), im.width, im.height);
    g.restore();
  }

  private entities(w: World) {
    const out: { im: GuiImage; x: number; y: number }[] = [];
    for (const e of [...w.logic.entries, ...w.logic.actors]) {
      const h = e.handlers.find(hh => hh.kind === "MinimapIcon");
      const file = h?.cfg.icon?.file;
      if (!file || e.destroyed) continue;
      const im = this.icon(file);
      if (im) out.push({ im, x: e.x, y: e.y });
    }
    return out;
  }

  /**
   * The minimap, drawn by the map layer spacer at (x, y) (its top-left corner, w x h). The map
   * fills the mask's square at the layer's upper-right corner, as the client's map layer does.
   */
  draw(g: CanvasRenderingContext2D, x: number, y: number, w: number, _h: number) {
    const world = this.world;
    if (!world?.knight) return;
    this.explore(world);
    const k = world.knight;
    const mask = this.icon(MASK);
    const mw = mask?.width ?? MASK_SIZE, mh = mask?.height ?? MASK_SIZE;
    const left = x + w - mw, top = y;
    const cx = left + mw * 0.5, cy = top + mh * 0.5;
    const tex = this.paint();
    if (tex && mask) {
      // the map texture modulated by the round mask
      const layer = this.layer ??= new OffscreenCanvas(mw, mh);
      if (layer.width !== mw || layer.height !== mh) { layer.width = mw; layer.height = mh; }
      const lg = layer.getContext("2d")!;
      lg.globalCompositeOperation = "source-over";
      lg.clearRect(0, 0, mw, mh);
      this.drawMap(lg, tex, SCALE, mw * 0.5, mh * 0.5, k.x, k.y);
      lg.globalCompositeOperation = "destination-in";
      lg.drawImage(mask.source, 0, 0, mw, mh);
      g.drawImage(layer, left, top);
    }
    // the knight, then the entity icons, then the monsters; a marker past the edge radius is
    // pinned to the edge (entity icons, shrinking from 0.75 to 0.25 of their size over 690
    // pixels and gone beyond) or hidden (monsters)
    this.self(g, world, cx, cy);
    const marker = (im: GuiImage, wx: number, wy: number, near: number, far: number, pin: boolean) => {
      let dx = (wx - k.x) * SCALE, dy = -(wy - k.y) * SCALE;
      const d = Math.hypot(dx, dy);
      let s = near;
      if (d > EDGE) {
        if (!pin || d > EDGE + FADE) return;
        s = near + (far - near) * (d - EDGE) / FADE;
        dx *= EDGE / d; dy *= EDGE / d;
      }
      const iw = Math.round(im.width * s), ih = Math.round(im.height * s);
      g.drawImage(im.source, Math.round(cx + dx) - Math.trunc(iw / 2), Math.round(cy + dy) - Math.trunc(ih / 2), iw, ih);
    };
    for (const e of this.entities(world)) marker(e.im, e.x, e.y, 0.75, 0.25, true);
    if (this.place.dungeon) {
      const mon = this.icon("ui/minimap/monster.png");
      if (mon) for (const m of world.liveMonsters) marker(mon, m.x, m.y, 1, 1, false);
    }
  }

  /** The map overlay over the whole screen (cw x ch), under the HUD. */
  drawOverlay(g: CanvasRenderingContext2D, cw: number, ch: number) {
    const world = this.world;
    if (!world?.knight) return;
    this.explore(world);
    const k = world.knight, cx = cw / 2, cy = ch / 2;
    const tex = this.paint();
    g.save();
    g.globalAlpha = OVERLAY_ALPHA;
    if (tex) this.drawMap(g, tex, OVERLAY_SCALE, cx, cy, k.x, k.y);
    g.restore();
    this.self(g, world, cx, cy);
    for (const e of this.entities(world)) {
      g.drawImage(e.im.source, Math.round(cx + (e.x - k.x) * OVERLAY_SCALE) - Math.trunc(e.im.width / 2),
        Math.round(cy - (e.y - k.y) * OVERLAY_SCALE) - Math.trunc(e.im.height / 2), e.im.width, e.im.height);
    }
  }
}

