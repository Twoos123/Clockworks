// The loading screen: the game's own rsrc/ui/loading/interface.dat drawn full screen while a
// scene loads. Its parts: a picture of the destination (ui/loading/images), the letterbox bands,
// the spinning gear with the progress label, a gameplay tip (ui/tip/interface.dat) and the
// destination's title band (ui/report/parts/title_nextfloor.dat: name, zone and depth).
//
// The game's tips live in its message bundles (inside the code jars, not read here); the
// install carries two tips as interface defaults (the loading screen's LMB tip and the tip
// interface's own), and the rest below are written for this port around the install's tip icons.

import { CONFIG_REF } from "../config/params";
import { buildInterface, layout, type Component, type GuiContext } from "./gui";
import { OverlayScreen } from "./overlay";
import { BOSSES, type Floor } from "../game/clockworks";

export interface Tip { header: string; body: string; image: string }

export const TIPS: Tip[] = [
  { header: "Press LMB to Run", image: "ui/tip/tip_lmb.png",
    body: "While holding the Left Mouse Button, your knight will run in the direction of your in-world cursor. (Note that your knight can't move if any of menus are open.)" },
  { header: "The world is always changing...", image: "ui/tip/tip_world.png",
    body: "The Clockworks below the surface cycle levels in real time. You will never see all the levels a world has to offer in a single trip. Only a true adventurer will discover all the secrets!" },
  { header: "Raise your shield", image: "ui/tip/tip_rmb.png",
    body: "Hold the Right Mouse Button to raise your shield. It soaks up hits until it breaks, then needs a moment to recover. Click while shielding to bash." },
  { header: "Burning!", image: "ui/tip/tip_fire.png",
    body: "Fire burns away your health over time. Keep fighting or step clear of the flames; gear with fire resistance shortens the burn." },
  { header: "Frozen solid", image: "ui/tip/tip_freeze.png",
    body: "A frozen knight cannot move or attack until the ice breaks. Mash the movement keys to struggle free faster." },
  { header: "Shocked", image: "ui/tip/tip_shock.png",
    body: "Shock jolts you at random, interrupting your attacks and your stride. Shock resistance keeps you on your feet." },
  { header: "Poisoned", image: "ui/tip/tip_poison.png",
    body: "Poison weakens your attacks and stops hearts from healing you. A Remedy Capsule cures it at once." },
  { header: "Cursed", image: "ui/tip/tip_curse.png",
    body: "A curse locks your weapons and items. Dodge until it wears off, or cure it with a Remedy Capsule." },
  { header: "Stunned", image: "ui/tip/tip_stun.png",
    body: "A stunned knight staggers and acts slowly. Back away until your head clears before pressing the attack." },
  { header: "Back on your feet", image: "ui/tip/tip_rez.png",
    body: "Knocked out? Revive on the spot for crowns, or ride back to Haven. Loot is banked at every elevator, so nothing already banked is lost." },
  { header: "Deeper is deadlier", image: "ui/tip/tip_dangerlevel.png",
    body: "Monsters grow stronger with every depth. Terminals at depths 4, 13 and 23 let you heal and resupply before the next stratum." },
  { header: "Rare monsters", image: "ui/tip/tip_raremonster.png",
    body: "Tougher variants of familiar monsters lurk in the deeper strata, and they drop richer loot." },
  { header: "Dress for the occasion", image: "ui/tip/tip_armor.png",
    body: "Armour and helmets defend against different damage types. Check a gate's strata in the Arcade and suit up for its monsters." },
  { header: "Heat", image: "ui/tip/tip_exclamation.png",
    body: "Monsters drop heat. Your equipped weapons absorb it and level up, growing stronger as they do." },
];

export interface LoadingInfo {
  /** The title band: the destination's name, its zone line and the depth (empty for towns). */
  title: string;
  zone: string;
  depth: string;
  /** A ui/loading/images picture. */
  image: string;
}

const IMAGES = "ui/loading/images/";

/** What the loading screen shows for a destination: a gate floor, or a cached scene by name. */
export function loadingInfo(name: string, floor: Floor | null, gateName?: string): LoadingInfo {
  if (floor) {
    const s = floor.stratum;
    const depth = `DEPTH ${floor.depth}`;
    switch (floor.kind) {
      case "terminal": case "core": return { title: floor.name, zone: gateName ?? "The Clockworks", depth, image: IMAGES + "default.jpg" };
      case "subtown": return { title: floor.name, zone: floor.depth === 8 ? "Tier 2 begins" : "Tier 3 begins", depth,
        image: IMAGES + (floor.depth === 18 ? "emberlight.jpg" : "moorcroft.jpg") };
      case "boss": {
        const b = s?.boss ? BOSSES[s.boss] : null;
        const img = s?.boss === "snarbolax" ? "wildwoods.jpg" : s?.boss === "twins" ? "imf.jpg" : "default.jpg";
        return { title: floor.name, zone: b ? `Lair of ${b.name}` : "Boss", depth, image: IMAGES + img };
      }
      default: return { title: floor.name, zone: s ? `${s.theme} Stratum ${s.index} - Tier ${s.tier}` : (gateName ?? ""), depth,
        image: IMAGES + "default.jpg" };
    }
  }
  const n = name.toLowerCase();
  if (/haven|bazaar/.test(n)) return { title: "Haven", zone: "Home sweet Home", depth: "", image: IMAGES + "haven.jpg" };
  if (/^hall\b|guild/.test(n)) return { title: "Guild Hall", zone: "Haven", depth: "", image: IMAGES + "guildhall.jpg" };
  if (/emberlight/.test(n)) return { title: "Emberlight", zone: "The Clockworks", depth: "", image: IMAGES + "emberlight.jpg" };
  if (/ready ?room/.test(n)) return { title: "Ready Room", zone: "Haven", depth: "", image: IMAGES + "readyroom.jpg" };
  if (/arena/.test(n)) return { title: "Arena", zone: "Survive the waves", depth: "", image: IMAGES + "default.jpg" };
  const title = name.replace(/\s*·.*$/, "").replace(/\b\w/g, c => c.toUpperCase());
  return { title, zone: "The Clockworks", depth: "", image: IMAGES + "default.jpg" };
}

export class LoadingScreen extends OverlayScreen {
  private ui: Component | null = null;
  private building: Promise<void> | null = null;
  private shown = 0;
  private progressValue = 0;
  private shownValue = 0;
  private tipIndex = Math.floor(Math.random() * TIPS.length);

  constructor(private readonly ctx: GuiContext, parent: HTMLElement) {
    super(parent, 7, "loading-canvas");
    this.fadeTime = 0.3;
    void this.build();
  }

  private build() {
    this.building ??= (async () => {
      this.ui = await buildInterface(this.ctx, { $class: CONFIG_REF, name: "ui/loading/interface.dat" });
    })();
    return this.building;
  }

  /** Shows the screen for a destination, with the next tip. */
  async show(info: LoadingInfo) {
    this.progressValue = 0;
    this.shownValue = 0;
    this.shown = performance.now();
    this.tipIndex = (this.tipIndex + 1) % TIPS.length;
    this.open();
    await this.build();
    const ui = this.ui;
    if (!ui) return;
    const set = (tag: string, text: string) => { const c = ui.find(tag); if (c) { c.text = text; c.visible = text !== "" || tag !== "depth"; } };
    set("gate", info.title);
    set("zonename", info.zone);
    set("depth", info.depth);
    const tip = TIPS[this.tipIndex];
    set("tipheader", tip.header);
    set("tipbody", tip.body);
    const [icon, picture] = await Promise.all([this.ctx.image(tip.image), this.ctx.image(info.image)]);
    const im = ui.find("image");
    if (im && icon) im.icon = icon;
    // the root container's "imagebacking" style takes the picture as its Background argument
    const root = ui.children[0];
    const s = root?.styles[0];
    if (s?.background && picture) root.styles[0] = { ...s, background: { ...s.background, image: picture } };
  }

  /** Loading progress, 0 to 1. */
  progress(f: number) { this.progressValue = Math.max(this.progressValue, Math.min(1, f)); }

  /** Loading finished: fill the bar and fade out (after a short minimum so the tip can be read). */
  done() {
    this.progressValue = 1;
    const wait = Math.max(0, 600 - (performance.now() - this.shown));
    setTimeout(() => { if (this.progressValue === 1) this.close(); }, wait);
  }

  hide() { this.close(true); }

  protected update(dt: number) {
    this.shownValue += (this.progressValue - this.shownValue) * Math.min(1, dt * 8);
    const ui = this.ui;
    if (!ui) return;
    const p = ui.find("progress");
    if (p) p.text = `Loading...${Math.round(this.shownValue * 100)}%`;
    // the interface's add action: AnimateOffset on the gear, rotation clock() * -0.8
    const gear = ui.find("loadingGear");
    if (gear) gear.offset = { tx: 0, ty: 0, rotation: this.time * -0.8, scale: 1 };
  }

  protected background(g: CanvasRenderingContext2D, w: number, h: number) {
    g.fillStyle = "#000";
    g.fillRect(0, 0, w, h);
    if (!this.ui) {
      // the interface is still loading its styles and fonts
      g.fillStyle = "#d0dcf2";
      g.font = "italic 22px 'Arial Black', sans-serif";
      g.textAlign = "center";
      g.fillText(`Loading...${Math.round(this.shownValue * 100)}%`, w / 2, h * 0.55);
      g.textAlign = "start";
    }
  }

  protected layers(w: number, h: number) {
    const ui = this.ui;
    if (!ui) return [];
    ui.x = 0; ui.y = 0; ui.width = Math.round(w); ui.height = Math.round(h);
    layout(ui);
    return [{ ui, x: 0, y: Math.round(h) }];
  }
}
