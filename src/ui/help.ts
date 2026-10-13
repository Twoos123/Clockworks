// The help window (the HUD's ? button, H): the game's rsrc/ui/help/interface.dat. Its tabs
// were filled in by the game's code; here they hold the controls, keyboard keys as bound in the
// options, in the window's own text styles. The forum and wiki links are hidden (this port
// opens no web pages).

import { CONFIG_REF } from "../config/params";
import { buildComponentConfig, type Component } from "./gui";
import { GuiScreen, type ScreenHost } from "./screen";

export interface HelpHost extends ScreenHost {
  /** The keyboard controls as [what it does, key name], in the options' order. */
  keys(): [string, string][];
}

const MOUSE: [string, string][] = [
  ["Attack (click again to combo)", "Left click"],
  ["Charge an attack", "Hold left click, release when full"],
  ["Raise the shield", "Right click"],
  ["Shield bash", "Left click while shielding"],
  ["Dash", "Shift + right click"],
  ["Options", "Esc"],
];

const style = (name: string) => ({ $class: CONFIG_REF, name });
const label = (text: string, s: string) => ({ $class: "ComponentConfig$Label", text, style: style(s) });

/** A two-column table of [action, key] rows under a header line. */
function page(header: string, rows: [string, string][]) {
  return {
    $class: "ComponentConfig$Container",
    layout: {
      $class: "LayoutConfig$VerticalGroup", policy: { name: "NONE" }, justification: { name: "TOP" }, offAxisPolicy: { name: "STRETCH" }, gap: 8,
      children: [
        { component: label(header, "Text/Header Text"), fixed: true },
        { component: {
          $class: "ComponentConfig$Container",
          layout: { $class: "LayoutConfig$Table", columns: 2, rowGap: 4, columnGap: 24,
            children: rows.flatMap(([what, key]) => [{ component: label(what, "Text/Body Text") }, { component: label(key, "Text/Header Text") }]) },
        } },
      ],
    },
  };
}

export class HelpScreen extends GuiScreen {
  constructor(ctx: ConstructorParameters<typeof GuiScreen>[0], private readonly help: HelpHost) {
    super(ctx, help, "helpCanvas");
  }

  toggle() { if (this.isOpen) this.close(); else void this.open(); }

  protected async build(): Promise<Component | null> {
    const ui = await this.ui("ui/help/interface.dat");
    if (!ui) return null;
    this.on(ui, "dismiss", () => this.close());
    for (const tag of ["gotoforums", "gotowiki"]) { const b = ui.find(tag); if (b) b.visible = false; }
    return ui;
  }

  /** Rebuilds the tabs with the current key bindings. */
  protected async refresh() {
    const ui = this.root;
    const old = ui?.find("tabs");
    if (!ui || !old) return;
    const keys = this.help.keys();
    const half = Math.ceil(keys.length / 2);
    const tabs = await buildComponentConfig(this.ctx, { ...old.config, tabs: [
      { title: "Keyboard", component: page("Keys (change them in Options, Controls)", keys.slice(0, half)) },
      { title: "More keys", component: page("Items, sprites, windows and the camera", keys.slice(half)) },
      { title: "Mouse", component: page("The mouse", MOUSE) },
    ] }, old.local);
    tabs.tag = "tabs";
    const swap = (c: Component): boolean => {
      const i = c.children.indexOf(old);
      if (i >= 0) { tabs.constraints = old.constraints; c.children[i] = tabs; return true; }
      return c.children.some(swap);
    };
    swap(ui);
  }
}
