// The run summary shown back in Haven after a gate run, in the game's results window
// (rsrc/ui/mission/parts/part_missioncomplete.dat): the title, the gate's name and a checked
// line per figure, with the window's own Accept button. Its rewards table and prestige bar
// belong to missions and are hidden.

import { buildComponentConfig, type Component } from "./gui";
import { GuiScreen } from "./screen";

export class SummaryScreen extends GuiScreen {
  private content: { title: string; name: string; lines: string[] } = { title: "", name: "", lines: [] };

  constructor(ctx: ConstructorParameters<typeof GuiScreen>[0], host: ConstructorParameters<typeof GuiScreen>[1]) {
    super(ctx, host, "summaryCanvas");
  }

  /** Shows a summary: a title, a name line and one line per figure. */
  async show(title: string, name: string, lines: string[]) {
    this.content = { title, name, lines };
    await this.open();
  }

  protected async build(): Promise<Component | null> {
    const ui = await this.ui("ui/mission/parts/part_missioncomplete.dat");
    if (!ui) return null;
    this.on(ui, "dismiss", () => this.close());
    for (const tag of ["rewards_window", "prestigebar"]) { const c = ui.find(tag); if (c) c.visible = false; }
    return ui;
  }

  protected async refresh() {
    const ui = this.root;
    if (!ui) return;
    const t = ui.find("title"), n = ui.find("name"), list = ui.find("objectives");
    if (t) t.text = this.content.title;
    if (n) n.text = this.content.name;
    const proto = list?.children[0];
    if (!list || !proto) return;
    list.children = await Promise.all(this.content.lines.map(async line => {
      const c = await buildComponentConfig(this.ctx, { ...proto.config, tag: "objective", text: line }, proto.local);
      c.constraints = proto.constraints;
      return c;
    }));
  }
}
