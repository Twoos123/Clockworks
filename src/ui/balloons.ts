// Help bubbles pinned in the world (the crash site's "Clear the Path / Attack using <Left
// Mouse>"...): the client's Balloon sprite (client sprite/a) puts a word balloon window,
// ui/wordballoon/help_interface.dat with its "Width", over the bubble's spot each frame
// (client ui/d: centred on the spot's screen point, its bottom edge there). The title and
// message are helptips keys, so "[[ACTION]]" reads as the bound key ("<Left Mouse>"); the title
// keeps the interface's own pink, drawn over the box's top edge (see build). A balloon fades in over half a second to 75% opacity as the knight
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

/** The component holding a child (null for the root or one not under it). */
function findParent(root: Component, child: Component): Component | null {
  if (root.children.includes(child)) return root;
  for (const k of root.children) { const p = findParent(k, child); if (p) return p; }
  return null;
}

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
      // client ui/d restyles the title with setStyleConfig("name", "Color", titleColor), but the
      // interface's "name" style names its parameter "color" and Clyde's argument names are
      // case-sensitive, so the bubble's colour binds nothing: the title keeps the style's pink
      // (0.824, 0.431, 0.671) with its dark outline. Its container (client ui/e) draws the
      // title after the rest, over the top of the text box it overlaps by the -10 spacer.
      const parent = findParent(ui, name);
      if (parent) parent.topChild = parent.children.indexOf(name);
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
