// The HUD's Arsenal button: the client's inventory window (item/client/f on
// ui/inventory/interface_combined.dat), which is an arsenal list (ArsenalPanel on
// ui/arsenal/interface.dat in Window mode) of everything the knight owns: its gear by item
// group, then its minerals and materials, with the sort header, the search field and the
// crowns line. The old sixteen-socket bag (ui/inventory/interface.dat) is the part the client
// takes out ("inv_panel"). Pocket capsules and vials live on the quickbar, not here
// (ArsenalPanel drops those groups). A click on gear equips or removes it.

import type { GameData } from "../game/data";
import type { Economy } from "../game/economy";
import { catalogue, toggleEquip } from "../game/items";
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
    list.onPick = e => {
      const save = this.pack.save(), item = catalogue(this.pack.data()).find(x => x.name === e.key);
      if (!item) return;
      save.loadout = toggleEquip(save.loadout, item);
      this.pack.write?.();
      this.host.sound("sound/feedback/ui_equip.ogg");
      void this.refresh();
    };
    return ui;
  }

  protected async refresh() {
    if (!this.list || !this.eco) return;
    const save = this.pack.save();
    // g.b: the arsenal's title and crowns line, no infobox
    this.list.setInfo(text("item", "t.arsenal", "ARSENAL"), "", "", save.crowns);
    await this.list.setGroups(ownedGroups(save, this.pack.data(), this.eco));
  }
}
