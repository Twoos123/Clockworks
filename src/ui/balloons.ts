// Help bubbles pinned in the world (the crash site's "Clear the Path / Attack using <Left
// Mouse>"...): the client's Balloon sprite (client sprite/a) puts a word balloon window,
// ui/wordballoon/help_interface.dat with its "Width", over the bubble's spot each frame
// (client ui/d: centred on the spot's screen point, its bottom edge there). The title and
// message are helptips keys, so "[[ACTION]]" reads as the bound key ("<Left Mouse>"); the title
// takes the bubble's colour. A balloon fades in over half a second to 75% opacity as the knight
// comes within its visible distance, and out again as the knight leaves or the level's "next"
// signal clears it.

import { CONFIG_REF } from "../config/params";
import { buildInterface, messageText, pack, render, type Component, type GuiContext } from "./gui";
import type { Balloon } from "../game/props";

/** The fade (client sprite/a: 500 ms to 0.75). */
const FADE_MS = 500;
const OPACITY = 0.75;

export interface BalloonSpot { key: object; balloon: Balloon; x: number; y: number; z: number; shown: boolean }

interface Shown { ui: Component | null; building: boolean; alpha: number; from: number; to: number; start: number }

export class Balloons {
  private shown = new Map<object, Shown>();

  constructor(private readonly ctx: GuiContext) {}

  /** Forgets every balloon (a new level). */
  clear() { this.shown.clear(); }

  private async build(b: Balloon): Promise<Component | null> {
    const ui = await buildInterface(this.ctx, { $class: CONFIG_REF, name: "ui/wordballoon/help_interface.dat",
      arguments: { $map: "com.threerings.config.ArgumentMap", entries: [["Width", b.width]] } }).catch(() => null);
    if (!ui) return null;
    const title = b.title ? messageText(b.title, "helptips") : "";
    const name = ui.find("name");
    if (name) {
      name.visible = !!title;
      name.text = title;
      const c = b.titleColor;
      if (c) name.styles = name.styles.map(st => (st ? { ...st, color: c } : st));
    }
    const msg = ui.find("message");
    if (msg) msg.text = b.message ? messageText(b.message, "helptips") : "";
    const icon = ui.find("icon");
    if (icon && !icon.icon) icon.visible = false;
    return ui;
  }

  /** Draws the balloons over the game view (CSS pixels), each at its spot's screen point. */
  draw(g: CanvasRenderingContext2D, spots: BalloonSpot[], project: (x: number, y: number, z: number) => [number, number] | null) {
    const now = performance.now();
    const seen = new Set<object>();
    for (const s of spots) {
      seen.add(s.key);
      let st = this.shown.get(s.key);
      if (!st) {
        if (!s.shown) continue;
        st = { ui: null, building: false, alpha: 0, from: 0, to: 0, start: now };
        this.shown.set(s.key, st);
      }
      // fade toward the target: in to 0.75, out to 0
      const target = s.shown ? OPACITY : 0;
      if (st.to !== target) { st.from = st.alpha; st.to = target; st.start = now; }
      const t = Math.min(1, (now - st.start) / FADE_MS);
      st.alpha = st.from + (st.to - st.from) * t;
      if (st.alpha <= 0 && st.to === 0) continue;
      if (!st.ui) {
        if (!st.building) { st.building = true; const entry = st; void this.build(s.balloon).then(ui => { entry.ui = ui; }); }
        continue;
      }
      const p = project(s.x, s.y, s.z);
      if (!p) continue;
      const size = pack(st.ui);
      st.ui.setAlpha(st.alpha);
      render(st.ui, g, Math.round(p[0] - size.width / 2), Math.round(p[1]), {});
    }
    for (const k of [...this.shown.keys()]) if (!seen.has(k)) this.shown.delete(k);
  }
}
