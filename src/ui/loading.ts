// The loading screen: the game's own rsrc/ui/loading/interface.dat drawn full screen while a
// scene loads. Its parts: a picture of the destination (ui/loading/images), the letterbox bands,
// the spinning gear with the progress label, a gameplay tip (ui/tip/interface.dat) and the
// destination's title band (ui/report/parts/title_nextfloor.dat: name, zone and depth).
//
// The tips are the game's own, from the helptips bundle (t.loadingN the header, m.loadingN the
// text, i.loadingN the ui/tip icon), leaving out the ones about online features. Without the
// bundles the tips below stand in: two the install carries as interface defaults and the rest
// written for this port around the install's tip icons. Titles and zones come from the dungeon
// bundle's level names (src/game/clockworks.ts).

import { CONFIG_REF } from "../config/params";
import { hasMessage, message, messages } from "../i18n";
import { buildInterface, layout, type Component, type GuiContext } from "./gui";
import { OverlayScreen } from "./overlay";
import { bossName, type Floor } from "../game/clockworks";
import { depthText, levelText } from "../game/text";

export interface Tip { header: string; body: string; image: string }

export const OWN_TIPS: Tip[] = [
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

/** Tip icons of tips about online features (bug reports, parties), which this port leaves out. */
const ONLINE_TIPS = /tip_(f2|party)\.png$/;

/** The game's loading tips from the helptips bundle, in order; empty without the bundle. */
export function gameTips(): Tip[] {
  const b = messages.getBundle("helptips"), out: Tip[] = [];
  for (let i = 0; i < 100; i++) {
    const header = b.raw(`t.loading${i}`), body = b.raw(`m.loading${i}`), icon = b.raw(`i.loading${i}`);
    if (header === null || body === null) { if (i > 0) break; continue; }
    const image = "ui/tip/" + (icon?.trim() || "tip_exclamation.png");
    if (!ONLINE_TIPS.test(image)) out.push({ header, body, image });
  }
  return out;
}

let tips: Tip[] | null = null;
/** The tips shown: the game's, or ours without its bundles. */
export function loadingTips(): Tip[] {
  if (!tips || (tips === OWN_TIPS && messages.loaded)) { const g = gameTips(); tips = g.length ? g : OWN_TIPS; }
  return tips;
}

/** "Loading...42%", as the bundle's m.loading words it. */
function progressText(percent: number, bundle = "global"): string {
  const b = messages.getBundle(bundle);
  return b.exists("m.loading") ? b.get("m.loading", String(percent)) : `Loading...${percent}%`;
}

export interface LoadingInfo {
  /** The title band: the destination's name, its zone line and the depth (empty for towns). */
  title: string;
  zone: string;
  depth: string;
  /** A ui/loading/images picture. */
  image: string;
  /**
   * A Clockworks floor's title band (dungeon/client/O.EU): title_nextfloor.dat, or its
   * "-ubs" (shadow) or "-wht" (core) variant, replacing the interface's own; absent for towns.
   */
  band?: "" | "-ubs" | "-wht";
}

const IMAGES = "ui/loading/images/";

/** LevelPartyObject.ch for shadow, core and hidden-depth floors: m.depth with m.unk_depth ("DEPTH ???"). */
function unknownDepth(): string {
  const unk = hasMessage("dungeon", "m.unk_depth") ? message("dungeon", "m.unk_depth") : "???";
  return hasMessage("dungeon", "m.depth") ? message("dungeon", "m.depth", unk) : `DEPTH ${unk}`;
}

/** What the loading screen shows for a destination: a gate floor, or a cached scene by name. */
export function loadingInfo(name: string, floor: Floor | null, gateName?: string): LoadingInfo {
  if (floor) {
    const s = floor.stratum;
    const depth = depthText(floor.depth);
    const zone = floor.zone;
    const band = { band: "" as const };
    switch (floor.kind) {
      // the Core is LevelPartyObject's CORE floor type: the white band and an unknown depth ("DEPTH ???")
      case "core": return { title: floor.name, zone: zone ?? gateName ?? "The Clockworks", depth: unknownDepth(), image: IMAGES + "default.jpg", band: "-wht" };
      // the Arcade's lobby has no depth (NO_DEPTH)
      case "lobby": return { title: floor.name, zone: zone ?? gateName ?? "The Clockworks", depth: "", image: IMAGES + "default.jpg", ...band };
      case "terminal": return { title: floor.name, zone: zone ?? gateName ?? "The Clockworks", depth, image: IMAGES + "default.jpg", ...band };
      case "subtown": return { title: floor.name, zone: zone ?? (floor.depth === 8 ? "Tier 2 begins" : "Tier 3 begins"), depth,
        image: IMAGES + (floor.depth === 18 ? "emberlight.jpg" : "moorcroft.jpg"), ...band };
      case "boss": {
        const img = s?.boss === "snarbolax" ? "wildwoods.jpg" : s?.boss === "twins" ? "imf.jpg" : "default.jpg";
        return { title: floor.name, zone: zone ?? (s?.boss ? `Lair of ${bossName(s.boss)}` : "Boss"), depth, image: IMAGES + img, ...band };
      }
      default: return { title: floor.name, zone: zone ?? (s ? `${s.theme} Stratum ${s.index} - Tier ${s.tier}` : (gateName ?? "")), depth,
        image: IMAGES + "default.jpg", ...band };
    }
  }
  const n = name.toLowerCase();
  // the dungeon and town bundles' names for these places, else ours
  const real = (key: string, bundle: string, title: string, zone: string) => {
    const t = levelText(key, bundle);
    return t ? { title: t.title, zone: t.zone || zone } : { title, zone };
  };
  if (/haven|bazaar/.test(n)) return { ...real("m.haven_bazaar", "dungeon", "Haven", "Home sweet Home"), depth: "", image: IMAGES + "haven.jpg" };
  if (/^hall\b|guild/.test(n)) return { ...real("m.border_guildhall", "town", "Guild Hall", "Haven"), depth: "", image: IMAGES + "guildhall.jpg" };
  if (/emberlight/.test(n)) return { ...real("m.emberlight", "dungeon", "Emberlight", "The Clockworks"), depth: "", image: IMAGES + "emberlight.jpg" };
  if (/ready ?room/.test(n)) return { title: "Ready Room", zone: "Haven", depth: "", image: IMAGES + "readyroom.jpg" };
  if (/arena/.test(n)) return { ...real("m.battle_arena_1", "dungeon", "Arena", "Survive the waves"), depth: "", image: IMAGES + "default.jpg" };
  const title = name.replace(/\s*·.*$/, "").replace(/\b\w/g, c => c.toUpperCase());
  return { title, zone: "The Clockworks", depth: "", image: IMAGES + "default.jpg" };
}

export class LoadingScreen extends OverlayScreen {
  private ui: Component | null = null;
  private building: Promise<void> | null = null;
  private shown = 0;
  private progressValue = 0;
  private shownValue = 0;
  private tipIndex = -1;

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
    const all = loadingTips();
    this.tipIndex = this.tipIndex < 0 ? Math.floor(Math.random() * all.length) : (this.tipIndex + 1) % all.length;
    this.open();
    await this.build();
    const ui = this.ui;
    if (!ui) return;
    await this.band(ui, info);
    const set = (tag: string, text: string) => { const c = ui.find(tag); if (c) { c.text = text; c.visible = text !== "" || tag !== "depth"; } };
    set("gate", info.title);
    set("zonename", info.zone);
    set("depth", info.depth);
    const tip = all[this.tipIndex];
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

  /** The interface's own title band, kept for towns. */
  private ownBand: Component | null = null;
  private bands = new Map<string, Component | null>();

  /**
   * dungeon/client/O.EU: a Clockworks floor's band is title_nextfloor.dat (or its shadow or
   * core variant) with its own defaults, replacing the interface's "nextFloor"; towns keep it.
   */
  private async band(ui: Component, info: LoadingInfo) {
    const holder = findParent(ui, c => c.tag === "nextFloor");
    if (!holder) return;
    const i = holder.children.findIndex(c => c.tag === "nextFloor");
    const old = holder.children[i];
    this.ownBand ??= old;
    let next: Component | null = this.ownBand;
    if (info.band !== undefined) {
      if (!this.bands.has(info.band)) {
        const built = await buildInterface(this.ctx, { $class: CONFIG_REF, name: `ui/report/parts/title_nextfloor${info.band}.dat` }).catch(() => null);
        if (built) built.tag = "nextFloor";
        this.bands.set(info.band, built);
      }
      next = this.bands.get(info.band) ?? this.ownBand;
    }
    if (next && next !== old) { next.constraints = old.constraints; holder.children[i] = next; }
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
    if (p) p.text = progressText(Math.round(this.shownValue * 100), p.bundle);
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
      g.fillText(progressText(Math.round(this.shownValue * 100)), w / 2, h * 0.55);
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

/** The component whose children include one matching `test`. */
function findParent(c: Component, test: (c: Component) => boolean): Component | null {
  if (c.children.some(test)) return c;
  for (const k of c.children) { const r = findParent(k, test); if (r) return r; }
  return null;
}
