// The expedition's REPORT (dungeon/client/e: ui/report/parts/cardholder_fresh.dat), as the
// client shows it when the knight quits an expedition at the elevator (EndOfLevelWindow's END
// state after QUIT EXPEDITION): "REPORT" over the party's knights (character_container.dat,
// one knight here: its name in its colour and its model), each knight's card of the loot
// taken (playercard_fresh.dat: the crowns spill, then the items, best first; the "Marks"
// list is hidden), and ADVANCE NOW. The exit timer is hidden (e.ON). Dismissing it goes on to
// the loading screen back to Haven.

import type { Component, GuiContext, RenderHooks } from "./gui";
import { buildUi, GuiScreen, uiRef, type ScreenHost } from "./screen";

const WINDOW = "ui/report/parts/cardholder_fresh.dat";
const CROWNS = "ui/report/parts/interface_crownspill.dat";
const PILL = "ui/recipes/parts/pill_recipe/interface.dat";

export interface ReportLoot { name: string; label: string; count: number; rarity: number; icon: { file?: string; colorizations?: unknown[] } | null }

export interface Report {
  knight: string;
  crowns: number;
  loot: ReportLoot[];
  /** After ADVANCE NOW (or the close button). */
  done(): void;
}

export class ReportScreen extends GuiScreen {
  private report: Report | null = null;

  constructor(ctx: GuiContext, host: ScreenHost, private readonly knightView: NonNullable<RenderHooks["view"]> | null) {
    super(ctx, host, "reportCanvas");
  }

  async show(r: Report) {
    this.report = r;
    await this.open();
  }

  protected async build(): Promise<Component | null> {
    const ui = await this.ui(WINDOW, { "Party Size": "1" });
    if (!ui) return null;
    // both dismiss buttons (the title bar's and ADVANCE NOW) go on
    const walk = (c: Component) => { if (c.tag === "dismiss") c.onAction = () => this.finish(); c.children.forEach(walk); };
    walk(ui);
    for (const tag of ["exitin", "boottimer", "uiPlayer2Loot", "uiPlayer3Loot", "uiPlayer4Loot", "labelPlayerName2", "labelPlayerName3", "labelPlayerName4",
      "container2Players", "container3Players", "container4Players"]) { const c = ui.find(tag); if (c) c.visible = false; }
    const one = ui.find("container1Player");
    if (one) one.visible = true;
    const view = this.knightView;
    if (view) this.hooks = { view: (c, g, x, y, w, h) => { if (c.tag === "player1Model") view(c, g, x, y, w, h); } };
    return ui;
  }

  private finish() {
    const r = this.report;
    this.report = null;
    this.close();
    r?.done();
  }

  protected async refresh() {
    const ui = this.root, r = this.report;
    if (!ui || !r) return;
    const name = ui.find("labelPlayerName1");
    if (name) name.text = r.knight;
    const card = ui.find("uiPlayer1Loot");
    const marks = card?.find("marks");
    if (marks) marks.visible = false;
    const loots = card?.find("loots");
    if (!loots) return;
    // the loot heading stays; the sample pills give way to the run's loot
    const [crowns, ...pills] = await Promise.all([
      r.crowns > 0 ? buildUi(this.ctx, uiRef(CROWNS, { Crowns: r.crowns.toLocaleString("en-US"), Hoverable: false })) : null,
      ...[...r.loot].sort((a, b) => b.rarity - a.rarity || a.label.localeCompare(b.label)).slice(0, 24).map(l => buildUi(this.ctx, uiRef(PILL, {
        Name: l.count > 1 ? `${l.count} ${l.label}` : l.label, Rarity: String(l.rarity > 0 ? l.rarity : -1), Equipped: "False", Hoverable: false,
        Icon: l.icon?.file ?? "ui/icon/inventory/blank.png", Colorization: l.icon?.colorizations ?? [], Variants: "0", Accessory: false }))),
    ]);
    const head = loots.children[0];
    const list = loots.children[1];
    const kids = [crowns, ...pills].filter((c): c is Component => !!c);
    for (const k of kids) k.constraints = null;
    if (list) list.children = kids;
    loots.visible = kids.length > 0;
    if (head) head.visible = kids.length > 0;
    const scroll = card?.find("scroll");
    if (scroll) scroll.visible = kids.length > 0;
  }
}
