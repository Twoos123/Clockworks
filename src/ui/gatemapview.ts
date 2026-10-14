// The gate map (dungeon/client/u, client/h), shared by the Arcade's gate board (src/ui/gates.ts)
// and the mission board's Arcade tab (its "Gate Map" tab, ui/party_configuration/
// materials_display.dat): ui/adventureboard/parts/map_global_v2.dat with its rows filled,
// Haven, then one row a depth, each level a map icon (parts/map_levelicon.dat) coloured by its
// status and family, the rotation spacers between them, the row turning with its wheel, the
// path taken drawn in the client's dark red with the selected border, the level the elevator
// leads to next in its pale red, and the knight's place marked "you are here".

import { BOSSES, floorIcon, gateFloors, type Floor, type Gate } from "../game/clockworks";
import { displayOrder, predictedPath, themeColours, fixedLevel, type RealLevel } from "../game/gatemap";
import { tierLock, type MissionProgress } from "../game/missions";
import { levelText } from "../game/text";
import { Component, type GuiContext, type GuiImage, type RenderHooks } from "./gui";
import { buildUi, row, uiRef, type TipSpec } from "./screen";

/** A run in progress through a real gate: the wedge (level) taken at each depth so far. */
export interface GateRun { gate: Gate; depth: number; wedges: number[] }

const MAP_ICON = "ui/adventureboard/parts/map_levelicon.dat";
const TIP = "ui/adventureboard/parts/tooltip.dat";
const MAPICONS = "ui/adventureboard/images/mapicons/";
const IMAGE = "com.threerings.opengl.gui.config.IconConfig$Image";
/** The client's line colours (client/h): the path taken, and the levels it leads to. */
const PATH = "rgb(163, 28, 0)", NEXT = "rgb(209, 140, 128)";
/** A map row's height with its gap (map_icons.dat: 44 and 44), one a depth. */
export const ROW = 88;

/** One map icon: its component, level and depth. */
interface Cell { ui: Component; level: RealLevel; depth: number; wedge: number }

/** A gate's built map: its rows and icons. */
export interface MapRows { rows: Component[]; cells: Cell[][]; haven: Cell | null; spacers: Component[][] }

/** A spacer drawn by a render hook. */
export function hooked(tag: string, width: number, height: number): Component {
  const c = new Component("spacer", null);
  c.tag = tag;
  c.preferredSize = { width, height };
  return c;
}

export interface GateMapHost {
  /** The window's tooltips (the icons' level tooltips go in). */
  tips: Map<Component, TipSpec>;
  /** An icon config's image at a size, null until loaded (the window's icon cache). */
  icon(cfg: any, size: number): GuiImage | null;
  progress(): MissionProgress;
  run(): GateRun | null;
}

export class GateMapView {
  /** The map interface (map_global_v2.dat). */
  map: Component | null = null;
  /** The gate shown, and its rows. */
  shown: Gate | null = null;
  built: MapRows | null = null;
  /** The map's current path (wedge per depth, -1 for "any") and how far it is the run's. */
  path: number[] = [];
  visited = -1;
  private signature = "";
  private builds = new Map<string, Promise<MapRows>>();
  private drawn = new Map<Component, { cfg: any; size: number }>();
  private borders: { idle: GuiImage | null; selected: GuiImage | null } = { idle: null, selected: null };

  constructor(private readonly ctx: GuiContext, private readonly host: GateMapHost) {}

  /** Builds the map interface (once). */
  async build(): Promise<Component | null> {
    if (this.map) return this.map;
    const [map, idle, sel] = await Promise.all([
      buildUi(this.ctx, uiRef("ui/adventureboard/parts/map_global_v2.dat")),
      this.ctx.image(MAPICONS + "border_idle.png"), this.ctx.image(MAPICONS + "border_selected.png"),
    ]);
    this.borders = { idle, selected: sel };
    const gatemap = map?.find("gatemap");
    if (gatemap) gatemap.visible = false;
    this.map = map;
    return map;
  }

  /** The render hooks the map needs (its spacers and connecting lines). */
  hooks(): NonNullable<RenderHooks["tagged"]> {
    return {
      mapspacer: (c, g, x, y, w, h) => {
        const d = this.drawn.get(c);
        const im = d ? this.host.icon(d.cfg, d.size) : null;
        if (im) g.drawImage(im.source as CanvasImageSource, Math.round(x + (w - im.width) / 2), Math.round(y + (h - im.height) / 2), im.width, im.height);
      },
      rows: (c, g, x, y, w, h) => this.drawLines(c, g, x, y, w, h),
    };
  }

  /** Shows a gate on the map (null: the Arena's), scrolled to the run's depth or the top. */
  async show(gate: Gate | null) {
    const map = this.map;
    if (!map) return;
    const title = map.find("title");
    if (title) title.text = gate ? gate.name : "Arena";
    const rows = map.find("rows");
    if (!rows) return;
    this.shown = gate;
    this.signature = "";
    const built = gate ? await this.rowsFor(gate) : await this.arenaRows();
    if (this.shown !== gate) return;
    this.built = built;
    rows.tag = "rows";
    rows.children = built.rows;
    this.update(true);
    const run = this.host.run();
    this.scroll()?.setValue(run && gate && run.gate.id === gate.id ? Math.max(0, (run.depth - 1) * ROW) : 0);
  }

  /** The map's vertical scroll model (on the scroll pane's viewport). */
  scroll() { return this.map?.find("scrollpane")?.parts.viewport?.vmodel ?? null; }

  /** The map rows of a gate: Haven, then a row a depth (built once a gate). */
  private rowsFor(g: Gate): Promise<MapRows> {
    const p = this.host.progress();
    const locks = [1, 2, 3].map(t => tierLock(t, p) !== null);
    const key = g.id + locks.join();
    let rows = this.builds.get(key);
    if (!rows) {
      rows = this.buildRows(g, locks);
      this.builds.set(key, rows);
    }
    return rows;
  }

  private async buildRows(g: Gate, locks: boolean[]): Promise<MapRows> {
    const levels: RealLevel[][] = g.real ? g.real.wheels.map(w => w.options) : gateFloors(g).map(f => [this.floorLevel(f)]);
    const tierOf = (d: number) => (d >= 18 ? 3 : d >= 8 ? 2 : 1);
    const haven = await this.cell(fixedLevel(-1), -1, 0, false, g);
    const cells = await Promise.all(levels.map((opts, d) => Promise.all(opts.map((l, w) => this.cell(l, d, w, locks[tierOf(d) - 1], g)))));
    const spacers = levels.map((opts, d) => {
      if (opts.length < 2) return [];
      const w = g.real?.wheels[d];
      const kind = !w || w.random ? "random" : w.velocity < 0 || (w.velocity === 0 && w.dir === "l") ? "left" : "right";
      return Array.from({ length: opts.length + 1 }, () => {
        const c = hooked("mapspacer", 17, 34);
        this.drawn.set(c, { cfg: { $class: IMAGE, file: `${MAPICONS}spacer_${kind}.png` }, size: 34 });
        return c;
      });
    });
    const rows = [row([haven!.ui], 0, "CENTER"), ...cells.map(r => row(r.map(c => c.ui), 0, "CENTER"))];
    return { rows, cells, haven, spacers };
  }

  /** A generated gate's floor as a map level. */
  private floorLevel(f: Floor): RealLevel {
    const s = f.stratum;
    const fam = s && ["Beast", "Construct", "Fiend", "Gremlin", "Slime", "Undead"].includes(s.theme) ? s.theme as any : null;
    const el = s && ["Fire", "Freeze", "Poison", "Shock"].includes(s.theme) ? s.theme as any : null;
    const kind = f.kind === "subtown" ? "town" : f.kind;
    if (kind === "lobby" || kind === "terminal" || kind === "town" || kind === "core") return fixedLevel(f.depth);
    return { code: "", key: f.levelKey ?? "", title: f.name, subtitle: f.zone ?? "", icon: floorIcon(f), colorizations: themeColours(el, fam),
      kind: kind === "boss" ? "boss" : "level", style: s?.style.key ?? null, family: fam, element: el, ...(kind === "boss" && s?.boss ? { boss: s.boss } : {}) };
  }

  /** One map icon (map_levelicon.dat) with its level's colours and tooltip. */
  private async cell(l: RealLevel, depth: number, wedge: number, locked: boolean, g: Gate): Promise<Cell> {
    const file = `ui/icon/map/${l.icon}.png`;
    const ui = (await buildUi(this.ctx, uiRef(MAP_ICON, { Icon: file, Locked: !locked, "You are Here": false, "Friend Here": false })))!;
    // the client colours the icon with the level's colourisations (client/h.Cm)
    const icon = ui.find("icon");
    const im = await this.ctx.image(file, l.colorizations);
    if (icon && im && icon.styles[0]?.background) {
      const bg = icon.styles[0].background;
      icon.styles[0] = { ...icon.styles[0], background: { ...bg, image: im } };
    }
    this.host.tips.set(ui, { ref: uiRef(TIP, { Name: l.subtitle ? `${l.title}\n${l.subtitle}` : l.title, Description: this.describe(l, depth, locked, g) }) });
    return { ui, level: l, depth, wedge };
  }

  private describe(l: RealLevel, depth: number, locked: boolean, g: Gate): string {
    const tier = depth >= 18 ? 3 : depth >= 8 ? 2 : 1;
    const s = g.strata.find(x => depth >= x.first && depth <= x.last);
    const desc = levelText(l.key + "_desc")?.title;
    const where = depth < 0 ? "Home of the Strangers." : depth === 0 ? "The gate's lobby." : `Depth ${depth}, tier ${tier}${s ? `, stratum ${s.index} (${s.theme})` : ""}.`;
    const what = l.kind === "boss" && l.boss ? `${BOSSES[l.boss].name} waits here.`
      : l.kind === "vault" ? "A treasure vault." : l.kind === "miniboss" ? "A fearsome foe guards this level."
      : l.family || l.element ? [l.family, l.element].filter(Boolean).join(", ") + "." : "";
    const w = g.real?.wheels[depth];
    const rot = !w || w.options.length < 2 ? "" : w.random ? " Randomised: the level is picked as the elevator is taken."
      : ` One of ${w.options.length} levels turning ${w.velocity < 0 ? "left" : "right"}.`;
    const lock = locked ? ` Locked: tier ${tier} needs a higher rank.` : "";
    return `${desc ? desc + " " : ""}${where} ${what}${rot}${lock}`.replace(/\s+/g, " ").trim();
  }

  /** The Arena's map: Haven, the lobby, then waves. */
  private async arenaRows(): Promise<MapRows> {
    const mk = async (file: string, name: string, desc: string, here: boolean) => {
      const c = await buildUi(this.ctx, uiRef(MAP_ICON, { Icon: file, Locked: true, "You are Here": here, "Friend Here": false }));
      if (c) this.host.tips.set(c, { ref: uiRef(TIP, { Name: name, Description: desc }) });
      return c;
    };
    const a = await mk("ui/icon/map/lobby.png", "Arcade", "The gate's lobby.", true);
    const b = await mk("ui/icon/map/shield.png", "Arena", "Waves of monsters from the game's spawn tables on a cached level, deeper each wave. Every fifth wave banks the loot; every tenth brings a boss.", false);
    return { rows: [a, b].filter((c): c is Component => !!c).map(c => row([c], 0, "CENTER")), cells: [], haven: null, spacers: [] };
  }

  /** The run's place and the path on the map: (re)orders rows as the wheels turn, marks borders. */
  update(force = false) {
    const g = this.shown, b = this.built;
    if (!g || !b || !b.cells.length) return;
    const now = Date.now();
    const run = this.host.run();
    const mine = run && run.gate.id === g.id ? run : null;
    // the path: the run's wedges to its depth, then where the elevators lead now
    let path: number[];
    if (g.real) {
      const from = mine ? mine.depth : 0;
      path = predictedPath(g.real, from, mine ? mine.wedges[from] ?? 0 : 0, now);
      if (mine) for (let d = 0; d <= mine.depth; d++) path[d] = mine.wedges[d] ?? 0;
    } else path = b.cells.map(() => 0);
    const orders = g.real ? g.real.wheels.map(w => displayOrder(w, now)) : b.cells.map(() => [0]);
    const visited = mine ? mine.depth : 0;
    const sig = path.join() + "|" + orders.map(o => o.join("")).join() + "|" + visited;
    if (!force && sig === this.signature) return;
    this.signature = sig;
    this.path = path;
    this.visited = visited;
    b.cells.forEach((cells, d) => {
      const r = b.rows[d + 1];
      const order = orders[d] ?? [0];
      const sp = b.spacers[d] ?? [];
      // the row turns with its wheel (dungeon/client/u.Pg), spacers between and at both ends
      r.children = sp.length ? order.flatMap((w, k) => k === 0 ? [sp[0], cells[w].ui, sp[1]] : [cells[w].ui, sp[k + 1]]) : order.map(w => cells[w].ui);
      for (const k of r.children) k.constraints = { fixed: true };
      for (const c of cells) {
        const onPath = d <= visited && path[d] === c.wedge;
        this.border(c.ui, onPath);
        const here = c.ui.find("youarehere");
        if (here) here.visible = !!mine && d === mine.depth && path[d] === c.wedge;
      }
    });
    if (b.haven) {
      const here = b.haven.ui.find("youarehere");
      if (here) here.visible = !mine;
      this.border(b.haven.ui, true);
    }
  }

  /** The selected border (images/mapicons/border_selected.png) on the path taken. */
  private border(ui: Component, on: boolean) {
    const btn = ui.find("button"), im = on ? this.borders.selected : this.borders.idle;
    if (!btn || !im) return;
    btn.styles = btn.styles.map(s => s?.background ? { ...s, background: { ...s.background, image: im } } : s);
  }

  /** The client's connecting lines (client/h.a): down from an icon, across, down to the next. */
  private drawLines(_rows: Component, g: CanvasRenderingContext2D, x: number, y: number, _w: number, h: number) {
    const b = this.built, gate = this.shown;
    if (!b || !gate || !b.cells.length) return;
    const bottom = y + h;
    const box = (c: Component, r: Component) => {
      const left = x + r.x + c.x, top = bottom - r.y - c.y - c.height;
      return { cx: Math.round(left + c.width / 2), top, bot: top + c.height };
    };
    const seg = (a: { cx: number; bot: number }, z: { cx: number; top: number }, colour: string) => {
      const y1 = a.bot - 3, y2 = z.top + 3, mid = Math.round((y1 + y2) / 2);
      g.fillStyle = colour;
      g.fillRect(a.cx - 2, y1, 3, mid - y1 + 1);
      g.fillRect(z.cx - 2, mid, 3, y2 - mid);
      if (a.cx !== z.cx) g.fillRect(Math.min(a.cx, z.cx) - 2, mid - 2, Math.abs(a.cx - z.cx) + 3, 3);
    };
    // Haven to the lobby
    if (b.haven) seg(box(b.haven.ui, b.rows[0]), box(b.cells[0][0].ui, b.rows[1]), PATH);
    for (let d = 0; d + 1 < b.cells.length; d++) {
      const from = this.path[d] >= 0 ? [b.cells[d][this.path[d]]] : b.cells[d];
      const to = this.path[d + 1] >= 0 ? [b.cells[d + 1][this.path[d + 1]]] : b.cells[d + 1];
      const colour = d + 1 <= this.visited ? PATH : NEXT;
      for (const a of from) for (const z of to) if (a && z) seg(box(a.ui, b.rows[d + 1]), box(z.ui, b.rows[d + 2]), colour);
    }
  }
}
