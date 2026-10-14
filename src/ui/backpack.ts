// The HUD's Arsenal button: the client's inventory window (item/client/f on
// ui/inventory/interface_combined.dat), which is an arsenal list (ArsenalPanel on
// ui/arsenal/interface.dat in Window mode) of everything the knight owns: its gear by item
// group, then its minerals and materials, with the sort header, the search field and the
// crowns line. The old sixteen-socket bag (ui/inventory/interface.dat) is the part the client
// takes out ("inv_panel"). Pocket capsules and vials live on the quickbar, not here
// (ArsenalPanel drops those groups). A click on gear pops up its item menu (itemmenu.ts).
// The window docks at the screen's right edge (item/client/i), and the crafting window opens
// the same panel beside its recipes (craft/a/o.LW).

import type { GameData } from "../game/data";
import type { Economy } from "../game/economy";
import { catalogue, type ItemEntry } from "../game/items";
import type { Outfit } from "../game/outfit";
import type { SaveData } from "../game/save";
import { text } from "../i18n";
import type { Component } from "./gui";
import { ownedGroups } from "./equipment";
import { applyItemAction, COMPARE, itemMenu, SLOT_ICON } from "./itemmenu";
import { ItemList } from "./itemlist";
import { buildUi, GuiScreen, uiRef, type ScreenHost, type TipSpec } from "./screen";

export interface BackpackHost extends ScreenHost {
  save(): SaveData;
  eco(): Promise<Economy>;
  data(): GameData;
  /** Writes the save after a change (equipping). */
  write?(): void;
  /** The costumes (the item menu's costume slots). */
  outfit(): Outfit;
}

/** The inventory window's arsenal list, in whichever window shows it. */
export class InventoryPanel {
  private constructor(readonly ui: Component, private readonly list: ItemList, private readonly screen: GuiScreen,
    private readonly pack: BackpackHost, private readonly eco: Economy, private readonly changed: () => void) {}

  /** Builds the panel; `close` is its dismiss button, `changed` runs after equipping. */
  static async create(screen: GuiScreen, ctx: ConstructorParameters<typeof GuiScreen>[0], pack: BackpackHost, eco: Economy,
    tips: Map<Component, TipSpec>, clicks: Map<Component, () => void>, close: () => void, changed: () => void): Promise<InventoryPanel | null> {
    const ui = await buildUi(ctx, uiRef("ui/arsenal/interface.dat", { Mode: "Window" }));
    if (!ui) return null;
    const dismiss = ui.find("dismiss");
    if (dismiss) dismiss.onAction = () => close();
    const list = new ItemList(ctx, ui, tips, f => pack.sound(f));
    list.sorts = ["natural", "name", "stars", "level"];
    list.clicks = clicks;
    list.menu = (e, t, c) => void screen.popupMenu(e, t, c);
    const panel = new InventoryPanel(ui, list, screen, pack, eco, changed);
    list.onPick = e => {
      const item = catalogue(pack.data()).find(x => x.name === e.key);
      if (item) void panel.gearMenu(item);
    };
    return panel;
  }

  /** ArsenalPanel.a: a press on gear pops up its item menu (src/ui/itemmenu.ts). */
  private async gearMenu(item: ItemEntry) {
    const save = this.pack.save(), costume = this.pack.outfit().appearance.costume;
    const icon = (n: string) => this.eco.info(n)?.icon ?? this.pack.data().resolveSync("config/item.dat", { name: n }, "item")?.icon ?? null;
    const entries = await Promise.all(itemMenu(save, costume, item).map(async m => ({ action: m.action, text: m.text, enabled: m.enabled,
      icon: m.slot === undefined ? null : m.item ? await this.screen.iconImage(icon(m.item), 25)
        : await this.screen.styleImage("Status/Equip Socket/Backing, Icon", { File: "ui/icon/inventory/categories/" + SLOT_ICON[m.slot] }, 25) })));
    await this.screen.popupMenu(entries, this.eco.displayName(item.name, save.gear[item.name]), async a => {
      const r = applyItemAction(save, item, a);
      if (r?.loadout) { save.loadout = r.loadout; this.pack.write?.(); }
      if (r?.costume) await this.pack.outfit().equipCostume(r.costume[0], r.costume[1]);
      if (r) this.pack.sound("sound/feedback/ui_equip.ogg");
      this.changed();
    });
  }

  async refresh() {
    const save = this.pack.save();
    // g.b: the arsenal's title and crowns line, no infobox
    this.list.setInfo(text("item", "t.arsenal", "ARSENAL"), "", "", save.crowns);
    await this.list.setGroups(ownedGroups(save, this.pack.data(), this.eco));
  }
}

export class BackpackScreen extends GuiScreen {
  private panel: InventoryPanel | null = null;

  constructor(ctx: ConstructorParameters<typeof GuiScreen>[0], private readonly pack: BackpackHost) {
    super(ctx, pack, "backpackCanvas");
    // item/client/i: the inventory window sits at the screen's right
    this.dockRight = true;
  }

  protected async build(): Promise<Component | null> {
    const eco = await this.pack.eco();
    this.panel = await InventoryPanel.create(this, this.ctx, this.pack, eco, this.tips, this.clicks, () => this.close(), () => void this.refresh());
    return this.panel?.ui ?? null;
  }

  protected async refresh() { await this.panel?.refresh(); }

  /** The compare choices last while the window is open (item/client/f clears M.buL). */
  close() { COMPARE.clear(); super.close(); }
}
