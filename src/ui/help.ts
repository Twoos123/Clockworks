// The help window (the HUD's help button, F1): the game's rsrc/ui/help/interface.dat filled in
// as the client's HelpWindow (on client/ui/r) does. Each enabled HelpWindow.Tab is a scrolling
// page of the help bundle's entries in order: "t." keys are headings (Text/Header Text), "m."
// keys paragraphs (Text/Body Text; the bundle is control-aware, so "[[ACTION]]" shows the bound
// key, "[[?NEXT_WEAPON]]" every key of the command), and "l." and "u." keys links
// ("LABEL | URL | address" or "LABEL | action | command") drawn as Text/Text Link Button/Link
// buttons. The Forums and Wiki buttons open the game's forums and wiki in a new tab, as do the
// pages' URL links; the action links open the options' controls page and the energy depot.

import { CONFIG_REF } from "../config/params";
import { messages, taint } from "../i18n";
import { buildComponentConfig, selectTab, type Component } from "./gui";
import { GuiScreen, type ScreenHost } from "./screen";

/** HelpWindow's tabs (HelpWindow.Tab), in order. */
export type HelpTab = "support" | "controls" | "energy" | "clockworks" | "monsters";

export interface HelpHost extends ScreenHost {
  /** An action link: "controls" (the options' controls page) or "exchange" (the energy depot). */
  link(action: string): void;
  /** The account name for the account page's link (u.account's {0}). */
  username(): string;
}

/** The deployment's forum_url and wiki_url (code/config.jar deployment.properties). */
export const FORUM_URL = "https://forums.spiralknights.com/";
export const WIKI_URL = "https://wiki.spiralknights.com/";

/** HelpWindow.Tab: each tab's entries in the help bundle. */
const TABS: [HelpTab, string[]][] = [
  ["support", ["t.support_1", "m.support_1", "u.account", "t.support_2", "m.support_2", "l.support_request", "t.support_3", "m.support_3",
    "m.support_4", "m.support_5", "l.support_wiki"]],
  ["controls", ["t.controls_move", "m.controls_move", "t.controls_attack", "m.controls_attack", "t.controls_weapon", "m.controls_weapon",
    "t.controls_inventory", "m.controls_inventory", "t.controls_defend", "m.controls_defend", "t.controls_chat", "m.controls_chat",
    "m.controls_options", "l.options"]],
  ["energy", ["t.energy_1", "m.energy_1", "m.energy_depot", "l.energy_depot"]],
  ["clockworks", ["t.clockworks_1", "m.clockworks_1", "m.clockworks_2", "t.tier_1", "m.tier_1_equip", "m.tier_1_monster",
    "t.tier_2", "m.tier_2_equip", "m.tier_2_monster", "t.tier_3", "m.tier_3_equip", "m.tier_3_monster"]],
  ["monsters", ["t.monster_1", "m.monster_1", "t.monster_slime", "m.monster_slime", "t.monster_beast", "m.monster_beast",
    "t.monster_gremlin", "m.monster_gremlin", "t.monster_construct", "m.monster_construct", "t.monster_fiend", "m.monster_fiend",
    "t.monster_undead", "m.monster_undead", "u.monster_wiki"]],
];

const style = (name: string) => ({ $class: CONFIG_REF, name });
const COMPONENT = "com.threerings.opengl.gui.config.ComponentConfig$";

/** Opens an address in a new tab, away from the game. */
export function openUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export class HelpScreen extends GuiScreen {
  /** The tab to show on opening. */
  private tab: HelpTab = "controls";
  /** What each link button does, by its tag. */
  private links = new Map<string, () => void>();

  constructor(ctx: ConstructorParameters<typeof GuiScreen>[0], private readonly help: HelpHost) {
    super(ctx, help, "helpCanvas");
  }

  /** Opens on a tab (as.b(Tab): the controls, or the support page from the main menu), or closes. */
  toggle(tab: HelpTab = "controls") {
    if (this.isOpen && tab === this.tab) { this.close(); return; }
    this.tab = tab;
    if (this.isOpen) void this.refresh(); else void this.open();
  }

  protected async build(): Promise<Component | null> {
    const ui = await this.ui("ui/help/interface.dat");
    if (!ui) return null;
    this.on(ui, "dismiss", () => this.close());
    // client/ui/r: the forums and wiki buttons are URL buttons (ProjectXApp opens them in the browser)
    this.on(ui, "gotoforums", () => { this.host.sound("sound/feedback/button_press.ogg"); openUrl(FORUM_URL); });
    this.on(ui, "gotowiki", () => { this.host.sound("sound/feedback/button_press.ogg"); openUrl(WIKI_URL); });
    return ui;
  }

  /** client/ui/r.eO: an entry's component config, by its key's kind. */
  private entry(key: string, i: number): any | null {
    const help = messages.getBundle("help");
    if (!help.exists(key)) return null;
    const kind = key[0];
    const msg = kind === "u" ? help.get(key, this.help.username()) : help.get(key);
    if (kind !== "u" && kind !== "l") {
      return { $class: COMPONENT + "Label", text: taint(msg), style: style(kind === "t" ? "Text/Header Text" : "Text/Body Text"), preferredSize: { width: 520, height: -1 } };
    }
    const [label, type, arg] = msg.split(/\s*\|\s*/);
    if (!type || arg === undefined) return { $class: COMPONENT + "Label", text: taint(label ?? msg), style: style("Text/Body Text") };
    const tag = `link${i}`;
    this.links.set(tag, type === "URL" ? () => openUrl(arg) : () => this.help.link(arg));
    return { $class: COMPONENT + "Button", tag, text: taint(label), style: style("Text/Text Link Button/Link") };
  }

  /** Rebuilds the tabs (the controls page follows the key bindings) and shows the chosen one. */
  protected async refresh() {
    const ui = this.root;
    const old = ui?.find("tabs");
    if (!ui || !old) return;
    const help = messages.getBundle("help");
    this.links.clear();
    let n = 0;
    const tabs = TABS.map(([id, keys]) => ({
      title: taint(help.exists("t." + id) ? help.get("t." + id) : id[0].toUpperCase() + id.slice(1)),
      component: {
        $class: COMPONENT + "ScrollPane", showScrollbarAlways: false,
        child: { $class: COMPONENT + "Container",
          layout: { $class: "LayoutConfig$VerticalGroup", policy: { name: "NONE" }, justification: { name: "TOP" }, offAxisPolicy: { name: "NONE" },
            offAxisJustification: { name: "LEFT" }, gap: 8,
            children: keys.map(k => this.entry(k, n++)).filter(Boolean).map(component => ({ component })) } },
      },
    }));
    const pane = await buildComponentConfig(this.ctx, { ...old.config, tabs }, old.local);
    pane.tag = "tabs";
    for (const [tag, run] of this.links) {
      const b = pane.find(tag);
      if (b) b.onAction = () => { this.host.sound("sound/feedback/button_press.ogg"); run(); };
    }
    const swap = (c: Component): boolean => {
      const i = c.children.indexOf(old);
      if (i >= 0) { pane.constraints = old.constraints; c.children[i] = pane; return true; }
      return c.children.some(swap);
    };
    swap(ui);
    const i = TABS.findIndex(([id]) => id === this.tab);
    if (pane.parts.buttons && i >= 0 && pane.tabs[i]) selectTab(pane, i);
  }
}
