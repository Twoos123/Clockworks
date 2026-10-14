// The HUD's Arsenal button: the client's inventory window (item/client/f on
// ui/inventory/interface_combined.dat), which is an arsenal list (ArsenalPanel on
// ui/arsenal/interface.dat in Window mode) of everything the knight owns: its gear by item
// group, then its minerals and materials, with the sort header, the search field and the
// crowns line. The old sixteen-socket bag (ui/inventory/interface.dat) is the part the client
// takes out ("inv_panel"). Pocket capsules and vials live on the quickbar, not here
// (ArsenalPanel drops those groups). A click on gear equips or removes it.

import type { GameData } from "../game/data";
import type { Economy } from "../game/economy";
import { catalogue, type ItemEntry } from "../game/items";
import type { Outfit } from "../game/outfit";
import { applyItemAction, COMPARE, itemMenu, SLOT_ICON } from "./itemmenu";
import type { SaveData } from "../game/save";
import { text } from "../i18n";
import type { Component } from "./gui";
import { ownedGroups } from "./equipment";
import { ItemList } from "./itemlist";
import { GuiScreen, type ScreenHost } from "./screen";

export interface BackpackHost extends ScreenHost {
  save(): SaveData;
  eco(): Promise<Economy>;
  data(): GameData;
  /** Writes the save after a change (equipping). */
  write?(): void;
  /** The costumes (the item menu's costume slots). */
  outfit(): Outfit;
}

export class BackpackScreen extends GuiScreen {
  private eco: Economy | null = null;
  private list: ItemList | null = null;

  constructor(ctx: ConstructorParameters<typeof GuiScreen>[0], private readonly pack: BackpackHost) {
    super(ctx, pack, "backpackCanvas");
  }

  protected async build(): Promise<Component | null> {
    this.eco = await this.pack.eco();
    const ui = await this.ui("ui/arsenal/interface.dat", { Mode: "Window" });
    if (!ui) return null;
    this.on(ui, "dismiss", () => this.close());
    const list = this.list = new ItemList(this.ctx, ui, this.tips, f => this.host.sound(f));
    list.sorts = ["natural", "name", "stars", "level"];
    list.clicks = this.clicks;
    list.menu = (e, t, c) => void this.popupMenu(e, t, c);
    list.onPick = e => {
      const item = catalogue(this.pack.data()).find(x => x.name === e.key);
      if (item) void this.gearMenu(item);
    };
    return ui;
  }

  /** ArsenalPanel.a: a press on gear pops up its item menu (src/ui/itemmenu.ts). */
  private async gearMenu(item: ItemEntry) {
    const save = this.pack.save(), costume = this.pack.outfit().appearance.costume;
    const icon = (n: string) => this.eco?.info(n)?.icon ?? this.pack.data().resolveSync("config/item.dat", { name: n }, "item")?.icon ?? null;
    const entries = await Promise.all(itemMenu(save, costume, item).map(async m => ({ action: m.action, text: m.text, enabled: m.enabled,
      icon: m.slot === undefined ? null : m.item ? await this.iconImage(icon(m.item), 25)
        : await this.styleImage("Status/Equip Socket/Backing, Icon", { File: "ui/icon/inventory/categories/" + SLOT_ICON[m.slot] }, 25) })));
    await this.popupMenu(entries, this.eco?.displayName(item.name, save.gear[item.name]) ?? item.label, async a => {
      const r = applyItemAction(save, item, a);
      if (r?.loadout) { save.loadout = r.loadout; this.pack.write?.(); }
      if (r?.costume) await this.pack.outfit().equipCostume(r.costume[0], r.costume[1]);
      if (r) this.host.sound("sound/feedback/ui_equip.ogg");
      void this.refresh();
    });
  }

  /** The compare choices last while the window is open (item/client/f clears M.buL). */
  close() { COMPARE.clear(); super.close(); }

  protected async refresh() {
    if (!this.list || !this.eco) return;
    const save = this.pack.save();
    // g.b: the arsenal's title and crowns line, no infobox
    this.list.setInfo(text("item", "t.arsenal", "ARSENAL"), "", "", save.crowns);
    await this.list.setGroups(ownedGroups(save, this.pack.data(), this.eco));
  }
}
