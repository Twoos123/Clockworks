// The Arcade's gate board: the game's adventure board interfaces in a titled window
// (ui/window/titled.dat). To the left the gate map (ui/adventureboard/parts/map_global_v2.dat):
// the stratum backdrops, the depth ruler and one level icon a depth
// (parts/map_levelicon.dat, locked where the knight's rank does not reach), with the map's
// level tooltip (parts/tooltip.dat). To the right the board's panel
// (ui/adventureboard/normal/panel.dat): today's gates as the list's gate tags
// (dungeontag/interface.dat: chess icon, name, floors, difficulty pips) plus the Arena, and
// the Start button. The party options under "Advanced Options" are multiplayer and hidden; the
// Mission tab leads to the mission board.
//
// The game fills these interfaces from closed code and server data; the lineups, names and
// locks come from src/game/clockworks.ts and src/game/missions.ts.

import { BOSSES, floorIcon, gateFloors, type Floor, type Gate } from "../game/clockworks";
import { tierLock, type MissionProgress } from "../game/missions";
import { Component, type GuiContext } from "./gui";
import { buildUi, GuiScreen, row, uiRef, type ScreenHost } from "./screen";

export interface GateBoardHost extends ScreenHost {
  /** Today's gates. */
  gates(): Gate[];
  progress(): MissionProgress;
  /** Starts a run through a gate (the board has closed). */
  enter(g: Gate): void;
  /** Starts the Arena (the board has closed). */
  arena(): void;
  /** Opens the mission board (the board has closed). */
  missions(): void;
}

const MAP_ICON = "ui/adventureboard/parts/map_levelicon.dat";
const TAG = "ui/adventureboard/dungeontag/interface.dat";
const TIP = "ui/adventureboard/parts/tooltip.dat";
/** The board's chess-piece gate icons (ui/adventureboard/gate_icons). */
const PIECES = ["pawn", "rook", "knight", "bishop", "queen", "king"];
const IMAGE = "com.threerings.opengl.gui.config.IconConfig$Image";

/** The board's icon for a gate: its own piece when its emblem is one, else a piece by its place. */
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

/** The board's entries: the gates, then the Arena. */
type Entry = { gate: Gate } | { arena: true };

export class GateBoard extends GuiScreen {
  private panel: Component | null = null;
  private map: Component | null = null;
  private entries: Entry[] = [];
  private tags: Component[] = [];
  private selected = 0;
  /** Built map rows by gate id (and lock state). */
  private rows = new Map<string, Promise<Component[]>>();
  private themeIcons = new Map<Component, string>();

  constructor(ctx: GuiContext, private readonly board: GateBoardHost) {
    super(ctx, board, "gatesCanvas");
  }

  /** The entry being shown (for tests): its gate, or null for the Arena. */
  get selection(): Gate | null { const e = this.entries[this.selected]; return e && "gate" in e ? e.gate : null; }

  protected async build(): Promise<Component | null> {
    const [win, panel, map] = await Promise.all([
      this.ui("ui/window/titled.dat", { Title: "The Arcade" }),
      this.ui("ui/adventureboard/normal/panel.dat"),
      this.ui("ui/adventureboard/parts/map_global_v2.dat"),
    ]);
    if (!win || !panel || !map) return null;
    this.panel = panel;
    this.map = map;
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
    const gatemap = map.find("gatemap");
    if (gatemap) gatemap.visible = false;
    // the window's content: the map and the panel side by side
    const content = win.find("content");
    const body = row([map, panel], 8, "TOP");
    const parent = content ? parentOf(win, content) : null;
    if (!content || !parent) return null;
    body.constraints = content.constraints;
    parent.children[parent.children.indexOf(content)] = body;
    this.hooks = {
      tagged: {
        themeicon: (c, g, x, y, w, h) => {
          const file = this.themeIcons.get(c);
          const im = file ? this.icon({ $class: IMAGE, file }, Math.min(w, h)) : null;
          if (im) g.drawImage(im.source as CanvasImageSource, Math.round(x + (w - im.width) / 2), Math.round(y + (h - im.height) / 2), im.width, im.height);
        },
      },
    };
    return win;
  }

  protected async refresh() {
    const panel = this.panel;
    if (!panel) return;
    const gates = this.board.gates();
    this.entries = [...gates.map(gate => ({ gate })), { arena: true as const }];
    this.selected = Math.min(this.selected, this.entries.length - 1);
    const tags = await Promise.all(this.entries.map((e, i) => "gate" in e
      ? buildUi(this.ctx, uiRef(TAG, { Entry1: e.gate.name, Entry2: "29 Floors", Entry3: "",
        Icon: gatePiece(e.gate, i), "Energy Cost": "" }))
      : buildUi(this.ctx, uiRef(TAG, { Entry1: "Arena", Entry2: "Endless Waves", Entry3: "", Icon: "ui/adventureboard/gate_icons/icon_king_extended.png", "Energy Cost": "" }))));
    this.tags = tags.filter((t): t is Component => !!t);
    this.tags.forEach((t, i) => {
      t.constraints = null;
      const e = this.entries[i];
      // pips: the gate's difficulty
      const pips = t.find("difficulty")?.children ?? [];
      const n = "gate" in e ? gateDifficulty(e.gate) : 5;
      pips.forEach((c, k) => { c.enabled = k < n; });
      // energy is a server currency; the run costs nothing here
      const cost = t.find("energycost"), box = cost ? parentOf(t, cost) : null;
      box?.children.forEach(c => { if (c === cost || (c.kind === "spacer" && !c.tag)) c.visible = false; });
      const sel = t.find("entryselect");
      if (sel) sel.onAction = () => this.select(i);
    });
    const list = panel.find("gatelist");
    if (list) list.children = this.tags;
    await this.select(this.selected, false);
  }

  /** Shows an entry: its tag selected, its lineup on the map. */
  async select(i: number, sound = true) {
    if (i < 0 || i >= this.entries.length) return;
    this.selected = i;
    if (sound) this.host.sound("sound/feedback/ui_dropdown_select.ogg");
    this.tags.forEach((t, k) => { const s = t.find("entryselect"); if (s) s.selected = k === i; });
    const e = this.entries[i];
    const map = this.map;
    if (!map) return;
    const title = map.find("title");
    if (title) title.text = "gate" in e ? e.gate.name : "Arena";
    const rows = map.find("rows");
    if (!rows) return;
    rows.children = "gate" in e ? await this.lineup(e.gate) : await this.arenaRows();
    const pane = map.find("scrollpane");
    // scrolled to the top: the Arcade and the first strata
    if (pane?.vmodel) pane.vmodel.setValue(0);
  }

  /** Enters the selected gate (or the Arena). */
  start() {
    const e = this.entries[this.selected];
    if (!e) return;
    this.host.sound("sound/feedback/ui_confirm.ogg");
    this.close();
    if ("gate" in e) this.board.enter(e.gate); else this.board.arena();
  }

  /** The gate's floors as map rows, one a depth. */
  private lineup(g: Gate): Promise<Component[]> {
    const p = this.board.progress();
    const locks = [1, 2, 3].map(t => tierLock(t, p) !== null);
    const key = g.id + locks.join();
    let rows = this.rows.get(key);
    if (!rows) {
      rows = Promise.all(gateFloors(g).map(f => this.floorRow(f, locks[f.tier - 1], f.depth === 0)));
      this.rows.set(key, rows);
    }
    return rows;
  }

  private async floorRow(f: Floor, locked: boolean, here: boolean): Promise<Component> {
    const icon = await buildUi(this.ctx, uiRef(MAP_ICON, { Icon: `ui/icon/map/${floorIcon(f)}.png`, Locked: !locked, "You are Here": here, "Friend Here": false }));
    const s = f.stratum;
    // the stratum's theme beside its first depth
    const theme = new Component("spacer", null);
    theme.tag = "themeicon";
    theme.preferredSize = { width: 40, height: 40 };
    if (s && f.depth === s.first) this.themeIcons.set(theme, `ui/icon/theme/${s.theme.toLowerCase()}.png`);
    const pad = new Component("spacer", null);
    pad.preferredSize = { width: 40, height: 40 };
    const kids = icon ? [theme, icon, pad] : [theme, pad];
    const r = row(kids, 6, "CENTER");
    if (icon) this.tips.set(icon, { ref: uiRef(TIP, { Name: f.name, Description: this.describe(f, locked) }) });
    return r;
  }

  private describe(f: Floor, locked: boolean): string {
    const s = f.stratum;
    const where = f.depth === 0 ? "The Arcade: the gate's lobby." : `Depth ${f.depth}, tier ${f.tier}.`;
    const what = f.kind === "terminal" ? "A Clockwork Terminal: rest and resupply."
      : f.kind === "subtown" ? "A town in the Clockworks: rest and resupply."
      : f.kind === "core" ? "The terminal above the Core: the end of the gate."
      : f.kind === "boss" && s?.boss ? `${BOSSES[s.boss].name} waits here.`
      : s ? `${s.theme} stratum.` : "";
    const special = f.special === "vault" ? " A treasure vault." : f.special === "danger" ? " Holds a danger room." : f.special === "arena" ? " An arena floor." : "";
    const lock = locked ? ` Locked: tier ${f.tier} needs a higher rank.` : "";
    return `${where} ${what}${special}${lock}`.trim();
  }

  /** The Arena's map: the Arcade, then waves. */
  private async arenaRows(): Promise<Component[]> {
    const a = await buildUi(this.ctx, uiRef(MAP_ICON, { Icon: "ui/icon/map/lobby.png", Locked: true, "You are Here": true, "Friend Here": false }));
    const b = await buildUi(this.ctx, uiRef(MAP_ICON, { Icon: "ui/icon/map/monsters.png", Locked: true, "You are Here": false, "Friend Here": false }));
    if (a) this.tips.set(a, { ref: uiRef(TIP, { Name: "Arcade", Description: "The gate's lobby." }) });
    if (b) this.tips.set(b, { ref: uiRef(TIP, { Name: "Arena", Description: "Waves of monsters from the game's spawn tables on a cached level, deeper each wave. Every fifth wave banks the loot; every tenth brings a boss." }) });
    return [a, b].filter((c): c is Component => !!c).map(c => row([c], 0));
  }
}
