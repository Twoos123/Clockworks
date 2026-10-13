// The run summary on the way back to Haven: the game's mission-complete window
// (ui/mission/parts/part_missioncomplete.dat). Its title and name give the gate, its checked
// objective lines the run's tally and what the knight found or levelled up, and its rewards
// window the crowns and heat brought home as reward pills (ui/recipes/parts/pill_recipe).
// The prestige bar belongs to missions and is hidden; Accept closes the window.

import type { Component, GuiContext } from "./gui";
import { buildUi, GuiScreen, uiRef, type ScreenHost } from "./screen";

const PART = "ui/mission/parts/part_missioncomplete.dat";
const PILL = "ui/recipes/parts/pill_recipe/interface.dat";

export interface RunSummary {
  title: string;
  name: string;
  /** Checked lines (the tally, then found items and level-ups). */
  lines: string[];
  crowns: number;
  heat: number;
}

const fmt = (n: number) => n.toLocaleString("en-US");

export class RunSummaryScreen extends GuiScreen {
  private summary: RunSummary | null = null;

  constructor(ctx: GuiContext, host: ScreenHost) {
    super(ctx, host, "summaryCanvas");
  }

  /** Shows a run's summary. */
  async show(s: RunSummary) {
    this.summary = s;
    await this.open();
  }

  protected async build(): Promise<Component | null> {
    const ui = await this.ui(PART);
    if (!ui) return null;
    this.on(ui, "dismiss", () => this.close());
    const bar = ui.find("prestigebar");
    if (bar) bar.visible = false;
    return ui;
  }

  protected async refresh() {
    const ui = this.root, s = this.summary;
    if (!ui || !s) return;
    const set = (tag: string, text: string) => { const c = ui.find(tag); if (c) c.text = text; };
    set("title", s.title);
    set("name", s.name);
    set("dismiss", "Accept");
    // one objective line each: the part's own line, copied from fresh builds of the part
    const box = ui.find("objectives");
    if (box) {
      const lines = s.lines.slice(0, 9);
      const built = await Promise.all(lines.map(() => buildUi(this.ctx, uiRef(PART))));
      box.children = built.map((b, i) => {
        const l = b?.find("objective") ?? null;
        if (l) { l.text = lines[i]; l.constraints = null; }
        return l;
      }).filter((c): c is Component => !!c);
    }
    const rewards = ui.find("rewards");
    if (rewards) {
      const pill = (icon: string, name: string) => buildUi(this.ctx, uiRef(PILL, {
        Name: name, Rarity: "-1", Equipped: "False", Hoverable: false, Icon: icon, Colorization: [], Variants: "0", Accessory: false }));
      const pills = await Promise.all([pill("ui/icon/crown_32.png", `${fmt(s.crowns)} Crowns`), pill("ui/icon/skill/pet/bonus/high_heat.png", `${fmt(s.heat)} Heat`)]);
      rewards.children = pills.filter((c): c is Component => !!c);
      rewards.children.forEach(c => { c.constraints = null; });
    }
  }
}
