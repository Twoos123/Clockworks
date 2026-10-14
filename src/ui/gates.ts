// The Gate Map: the Arcade's gate board, opened at the Arcade's control panels and from the
// HUD's map button. It is built from the game's own interfaces in a titled window
// (ui/window/titled.dat, titled with the dungeon bundle's m.gate_map_title):
//
//  - to the left the adventure board's panel (ui/adventureboard/normal/panel.dat): the gates as
//    the list's gate tags (dungeontag/interface.dat), each with its emblem (the symbol's
//    ui/icon/gate icon in the gate's colours), name and date, today's four first, older gates
//    behind "Older Gates", then the Arena, and the Start button;
//  - in the middle the gate map (ui/adventureboard/parts/map_global_v2.dat: the strata
//    backdrops, the depth ruler), its rows filled as the client's map does it
//    (dungeon/client/u, client/h): Haven, then one row a depth, each level a map icon
//    (parts/map_levelicon.dat) coloured by its status and family, the rotation spacers
//    (images/mapicons/spacer_left, _right, _random) between them, the row turning with its
//    wheel, the path taken drawn in the client's dark red with the selected border, the level
//    the elevator leads to next in its pale red, and the knight's place marked "you are here";
//  - to the right the stratum totem: the six strata's theme icons (ui/icon/theme), which scroll
//    the map to their stratum;
//  - under the map the rotation timer: how long until the next depth's level changes, and to what.
//
// Level data and rotation come from src/game/gatemap.ts; generated gates (when the real ones
// cannot be had) show their lineup with one level a depth.

import type { Gate } from "../game/clockworks";
import { gateDate, gateEmblem, nextLevel, UNKNOWN_ICON, type GateEntry, type RealLevel } from "../game/gatemap";
import type { GateChoice } from "../game/gatesource";
import type { MissionProgress } from "../game/missions";
import { Component, messageText, type GuiContext } from "./gui";
import { GateMapView, hooked, ROW, type GateRun } from "./gatemapview";
import { buildUi, GuiScreen, row, uiRef, type ScreenHost } from "./screen";

export type { GateRun };

export interface GateBoardHost extends ScreenHost {
  /** The gates to list: today's four, then `older` older ones. */
  gates(older: number): Promise<GateChoice[]>;
  /** An older gate's data. */
  gate(e: GateEntry): Promise<Gate | null>;
  /** True when the real gates could not be had (the list shows generated ones). */
  offline(): boolean;
  /** The run in progress through a real gate, if any. */
  run(): GateRun | null;
  progress(): MissionProgress;
  /** Starts a run through a gate (the board has closed). */
  enter(g: Gate): void;
  /** Starts the Arena (the board has closed). */
  arena(): void;
  /** Opens the mission board (the board has closed). */
  missions(): void;
}

const TAG = "ui/adventureboard/dungeontag/interface.dat";
/** The board's chess-piece gate icons (ui/adventureboard/gate_icons), for generated gates. */
const PIECES = ["pawn", "rook", "knight", "bishop", "queen", "king"];
const IMAGE = "com.threerings.opengl.gui.config.IconConfig$Image";
const COLORIZED = "com.threerings.opengl.gui.config.IconConfig$ColorizedImage";
/** Older gates shown each time "Older Gates" is pressed. */
const OLDER = 16;

/** The board's icon for a generated gate: its own piece when its emblem is one, else a piece by its place. */
export function gatePiece(g: Gate, index: number): string {
  const piece = PIECES.includes(g.emblem) ? g.emblem : PIECES[index % 4];
  return `ui/adventureboard/gate_icons/icon_${piece}.png`;
}

/** Difficulty pips (of five): two, and one more for each boss stratum. */
export const gateDifficulty = (g: Gate) => Math.min(5, 2 + g.strata.filter(s => s.boss).length);

function parentOf(root: Component, c: Component): Component | null {
  for (const k of root.children) {
    if (k === c) return root;
    const p = parentOf(k, c);
    if (p) return p;
  }
  return null;
}

/** A synthetic container laying children out in a column. */
function column(kids: Component[], gap = 0): Component {
  const c = new Component("container", null);
  c.layout = { $class: "LayoutConfig$VerticalGroup", policy: { name: "NONE" }, justification: { name: "TOP" }, offAxisPolicy: { name: "NONE" },
    offAxisJustification: { name: "CENTER" }, gap };
  c.children = kids;
  for (const k of kids) k.constraints = { fixed: true };
  return c;
}

/** The board's entries: gates (loaded or to load), the older-gates switch, the Arena. */
type Entry = { choice: GateChoice } | { older: true } | { arena: true };

export class GateBoard extends GuiScreen {
  private panel: Component | null = null;
  /** The gate map (shared with the mission board's Arcade tab). */
  private readonly view: GateMapView;
  private entries: Entry[] = [];
  private tags: Component[] = [];
  private selected = 0;
  private olderShown = 0;
  /** Per-component drawings: the gate emblems. */
  private drawn = new Map<Component, { cfg: any; size: number }>();
  private lastTick = 0;
  private totem: Component[] = [];
  /** The window title's font, for the text drawn on canvas. */
  private font = "sans-serif";

  constructor(ctx: GuiContext, private readonly board: GateBoardHost) {
    super(ctx, board, "gatesCanvas");
    this.view = new GateMapView(ctx, { tips: this.tips, icon: (cfg, size) => this.icon(cfg, size), progress: () => board.progress(), run: () => board.run() });
  }

  private get shown(): Gate | null { return this.view.shown; }
  private get built() { return this.view.built; }
  private get path(): number[] { return this.view.path; }

  /** The entry being shown (for tests): its gate, or null for the Arena. */
  get selection(): Gate | null { const e = this.entries[this.selected]; return e && "choice" in e ? e.choice.gate : null; }

  /** Shows a gate (the run's, when the HUD opens the map) once the list is up. */
  private want: string | null = null;
  async openOn(g: Gate | null) {
    this.want = g?.id ?? null;
    await this.open();
  }

  protected async build(): Promise<Component | null> {
    const [win, panel, map] = await Promise.all([
      this.ui("ui/window/titled.dat", { Title: messageText("m.gate_map_title", "dungeon") }),
      this.ui("ui/adventureboard/normal/panel.dat"),
      this.view.build(),
    ]);
    if (!win || !panel || !map) return null;
    this.panel = panel;
    this.font = win.find("title")?.fontFamily ?? "sans-serif";
    this.on(win, "dismiss", () => this.close());
    this.on(panel, "start", () => this.start());
    // party options are multiplayer
    for (const t of ["advancedopen", "advancedoptions"]) { const c = panel.find(t); if (c) c.visible = false; }
    this.on(panel, "listtabs", c => {
      if (c.selectedIndex !== 1) return;
      c.value = 0;
      this.close();
      this.board.missions();
    });
    // the stratum totem: six theme icons beside the map
    this.totem = [0, 1, 2, 3, 4, 5].map(i => {
      const c = hooked("totem", 56, 64);
      this.clicks.set(c, () => this.scrollToStratum(i));
      return c;
    });
    const totem = column([hooked("totemhead", 56, 24), ...this.totem], 6);
    const middle = column([map, hooked("gatetimer", 397, 46)], 4);
    // the window's content: the list, the map and the totem side by side
    const content = win.find("content");
    const body = row([panel, middle, totem], 8, "TOP");
    const parent = content ? parentOf(win, content) : null;
    if (!content || !parent) return null;
    body.constraints = content.constraints;
    parent.children[parent.children.indexOf(content)] = body;
    this.hooks = {
      tagged: {
        ...this.view.hooks(),
        totem: (c, g, x, y, w, h) => this.drawTotem(c, g, x, y, w, h),
        totemhead: (_c, g, x, y, w, h) => this.text(g, "Strata", x + w / 2, y + h - 6, "center", 13, "#f3e7c4"),
        gatetimer: (_c, g, x, y, w, h) => this.drawTimer(g, x, y, w, h),
      },
    };
    return win;
  }

  protected async refresh() {
    const panel = this.panel;
    if (!panel) return;
    const choices = await this.board.gates(this.olderShown);
    const real = choices.some(c => c.entry);
    this.entries = [...choices.map(choice => ({ choice })), ...(real ? [{ older: true as const }] : []), { arena: true as const }];
    const run = this.board.run();
    const want = this.want ?? run?.gate.id ?? null;
    this.want = null;
    const at = want ? this.entries.findIndex(e => "choice" in e && e.choice.gate?.id === want) : -1;
    if (at >= 0) this.selected = at;
    this.selected = Math.min(this.selected, this.entries.length - 1);
    if ("older" in this.entries[this.selected]) this.selected = 0;
    const tags = await Promise.all(this.entries.map((e, i) => this.tag(e, i)));
    this.tags = tags.filter((t): t is Component => !!t);
    const list = panel.find("gatelist");
    if (list) list.children = this.tags;
    await this.select(this.selected, false);
  }

  /** A gate tag for the list. */
  private async tag(e: Entry, i: number): Promise<Component | null> {
    let args: Record<string, unknown>, emblem: any = null, pips = 5;
    if ("choice" in e) {
      const { gate, entry, active } = e.choice;
      if (entry) {
        const em = gateEmblem(entry.colour, entry.symbol);
        emblem = { $class: COLORIZED, file: em.file, colorizations: em.colorizations };
        args = { Entry1: gate?.name ?? `${entry.colour[0].toUpperCase()}${entry.colour.slice(1)} ${entry.symbol[0].toUpperCase()}${entry.symbol.slice(1)}`,
          Entry2: gateDate(entry), Entry3: active ? "Open" : "", Icon: "ui/adventureboard/gate_icons/icon_pawn.png", "Energy Cost": "" };
      } else args = { Entry1: gate!.name, Entry2: "29 Floors", Entry3: "", Icon: gatePiece(gate!, i), "Energy Cost": "" };
      pips = gate ? gateDifficulty(gate) : 0;
    } else if ("older" in e) {
      args = { Entry1: this.olderShown ? "More Older Gates" : "Older Gates", Entry2: "Gates since 2019", Entry3: "", Icon: "ui/icon/map/unknown.png", "Energy Cost": "" };
      pips = 0;
    } else args = { Entry1: "Arena", Entry2: "Endless Waves", Entry3: "", Icon: "ui/adventureboard/gate_icons/icon_king_extended.png", "Energy Cost": "" };
    const t = await buildUi(this.ctx, uiRef(TAG, args));
    if (!t) return null;
    t.constraints = null;
    t.find("difficulty")?.children.forEach((c, k) => { c.enabled = k < pips; });
    const diff = t.find("difficulty");
    if (diff && !pips) diff.visible = false;
    // energy is a server currency; the run costs nothing here
    const cost = t.find("energycost"), box = cost ? parentOf(t, cost) : null;
    box?.children.forEach(c => { if (c === cost || (c.kind === "spacer" && !c.tag)) c.visible = false; });
    const icon = t.find("dungeonicon");
    if (icon && emblem) {
      // the emblem: the symbol in the gate's colours, at the board's icon size
      icon.icon = null;
      icon.tag = "gateemblem";
      icon.preferredSize = { width: 66, height: 66 };
      this.drawn.set(icon, { cfg: emblem, size: 60 });
      this.hooks.tagged!.gateemblem ??= (c, g, x, y, w, h) => {
        const d = this.drawn.get(c), im = d ? this.icon(d.cfg, d.size) : null;
        if (im) g.drawImage(im.source as CanvasImageSource, Math.round(x + (w - im.width) / 2), Math.round(y + (h - im.height) / 2), im.width, im.height);
      };
    }
    const sel = t.find("entryselect");
    if (sel) sel.onAction = () => void this.select(i);
    return t;
  }

  /** Shows an entry: its tag selected, its gate on the map. */
  async select(i: number, sound = true) {
    if (i < 0 || i >= this.entries.length) return;
    const e = this.entries[i];
    if (sound) this.host.sound("sound/feedback/ui_dropdown_select.ogg");
    if ("older" in e) {
      // more of the list's older gates
      this.olderShown += OLDER;
      this.tags.forEach((t, k) => { const s = t.find("entryselect"); if (s) s.selected = k === this.selected; });
      await this.refresh();
      return;
    }
    if ("choice" in e && !e.choice.gate && e.choice.entry) {
      e.choice.gate = await this.board.gate(e.choice.entry);
      if (!e.choice.gate) { this.host.sound("sound/feedback/ui_error.ogg"); return; }
    }
    this.selected = i;
    this.tags.forEach((t, k) => { const s = t.find("entryselect"); if (s) s.selected = k === i; });
    // the gate on the map, scrolled to the knight's depth in a run, else the top
    await this.view.show("choice" in e ? e.choice.gate : null);
  }

  /** Enters the selected gate (or the Arena). */
  start() {
    const e = this.entries[this.selected];
    if (!e || "older" in e) return;
    if ("choice" in e && !e.choice.gate) return;
    this.host.sound("sound/feedback/ui_confirm.ogg");
    this.close();
    if ("choice" in e) this.board.enter(e.choice.gate!); else this.board.arena();
  }

  protected tick() {
    const now = performance.now();
    if (now - this.lastTick < 500) return;
    this.lastTick = now;
    this.view.update();
  }

  /** The totem: a stratum's theme icon and number, lit while the map shows it. */
  private drawTotem(c: Component, g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    const i = this.totem.indexOf(c), gate = this.shown;
    const s = gate?.strata[i];
    if (!s) return;
    const theme = gate?.real?.themes[i]?.toLowerCase() ?? s.theme.toLowerCase();
    const top = this.scroll()?.value ?? 0;
    const active = top + 2 * ROW >= s.first * ROW && top + 2 * ROW < (s.last + 2) * ROW;
    g.fillStyle = active ? "rgba(243, 231, 196, 0.22)" : "rgba(10, 22, 34, 0.55)";
    g.fillRect(x + 2, y, w - 4, h);
    const im = this.icon({ $class: IMAGE, file: `ui/icon/theme/${theme}.png` }, 40);
    if (im) g.drawImage(im.source as CanvasImageSource, Math.round(x + (w - im.width) / 2), y + 2, im.width, im.height);
    this.text(g, `S${i + 1}`, x + w / 2, y + h - 5, "center", 12, active ? "#ffe9a8" : "#c9d7e0");
  }

  /** The map's vertical scroll model (on the scroll pane's viewport). */
  scroll() { return this.view.scroll(); }

  private scrollToStratum(i: number) {
    const s = this.shown?.strata[i];
    const m = this.scroll();
    if (!s || !m) return;
    this.host.sound("sound/feedback/ui_dropdown_select.ogg");
    m.setValue(Math.max(0, (s.first - 1) * ROW));
  }

  /** The rotation timer: "04:12 to" the level the next depth turns to (as the site's bar shows it). */
  private drawTimer(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    g.fillStyle = "rgba(10, 22, 34, 0.75)";
    g.fillRect(x, y, w, h);
    g.strokeStyle = "rgba(150, 180, 200, 0.45)";
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    const gate = this.shown, b = this.built;
    if (!gate?.real || !b?.cells.length) {
      this.text(g, gate ? "One level a depth" : "", x + w / 2, y + h / 2 + 5, "center", 13, "#c9d7e0");
      return;
    }
    const run = this.board.run(), mine = run && run.gate.id === gate.id ? run : null;
    const d = mine ? mine.depth : 0;
    if (d >= 29) { this.text(g, "The end of the gate", x + w / 2, y + h / 2 + 5, "center", 13, "#c9d7e0"); return; }
    const wheel = gate.real.wheels[d + 1];
    const n = nextLevel(gate.real, d, Math.max(0, this.path[d] ?? 0), Date.now());
    let clock = "--:--", level: RealLevel | null = null, icon: any = UNKNOWN_ICON;
    if (n && isFinite(n.seconds) && wheel.options.length > 1) {
      const s = Math.ceil(n.seconds);
      clock = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      level = wheel.options[(n.wedge + (n.after ?? 1) + wheel.options.length) % wheel.options.length];
    } else if (n) level = wheel.options[n.wedge];
    if (level) icon = { file: `ui/icon/map/${level.icon}.png`, colorizations: level.colorizations };
    this.text(g, `${clock} to`, x + 92, y + h / 2 + 5, "right", 15, "#ffe9a8");
    const im = this.icon({ $class: COLORIZED, file: icon.file, colorizations: icon.colorizations }, 34);
    if (im) g.drawImage(im.source as CanvasImageSource, x + 100, Math.round(y + (h - im.height) / 2), im.width, im.height);
    this.text(g, level ? level.title : "?", x + 142, y + 19, "left", 13, "#f3e7c4");
    this.text(g, level ? level.subtitle : "Randomised", x + 142, y + 36, "left", 12, "#a9c3d3");
  }

  private text(g: CanvasRenderingContext2D, s: string, x: number, y: number, align: CanvasTextAlign, size: number, colour: string) {
    g.font = `bold ${size}px ${this.font}`;
    g.textAlign = align;
    g.lineWidth = 3;
    g.strokeStyle = "rgba(0, 0, 0, 0.8)";
    g.strokeText(s, x, y);
    g.fillStyle = colour;
    g.fillText(s, x, y);
    g.textAlign = "left";
  }
}
