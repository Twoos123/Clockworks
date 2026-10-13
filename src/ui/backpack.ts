// The backpack: the game's inventory window (ui/inventory/interface.dat), sixteen sockets a
// bag and two bag tabs, with the crowns line. It holds what the knight carries besides gear:
// the pocket's capsules and vials first, then the crafting materials, each with its icon and
// count and the game's item tooltip.

import type { GameData } from "../game/data";
import { itemInfo, itemLabel } from "../game/items";
import type { SaveData } from "../game/save";
import type { Component } from "./gui";
import { itemTip } from "./itemlist";
import { GuiScreen, type ScreenHost } from "./screen";

export interface BackpackHost extends ScreenHost {
  save(): SaveData;
  data(): GameData;
}

const SLOTS = 16;

export class BackpackScreen extends GuiScreen {
  private bag = 0;
  private icons_ = new Map<Component, any>();

  constructor(ctx: ConstructorParameters<typeof GuiScreen>[0], private readonly pack: BackpackHost) {
    super(ctx, pack, "backpackCanvas");
  }

  protected async build(): Promise<Component | null> {
    await this.pack.data().preload("config/item.dat");
    const ui = await this.ui("ui/inventory/interface.dat");
    if (!ui) return null;
    this.on(ui, "dismiss", () => this.close());
    for (const [i, tag] of ["tab_bag1", "tab_bag2"].entries()) {
      this.on(ui, tag, () => { this.bag = i; this.host.sound("sound/feedback/ui_dropdown_select.ogg"); void this.refresh(); });
    }
    this.hooks = {
      tagged: {
        slot_ring: (c, g, x, y, w, h) => {
          const cfg = this.icons_.get(c);
          const im = cfg ? this.icon(cfg, Math.min(w, h) - 6) : null;
          if (im) g.drawImage(im.source as CanvasImageSource, Math.round(x + (w - im.width) / 2), Math.round(y + (h - im.height) / 2), im.width, im.height);
        },
      },
    };
    return ui;
  }

  /** What the knight carries: pocket consumables, then materials, as [name, count]. */
  private contents(): [string, number][] {
    const s = this.pack.save();
    const mats = Object.entries(s.materials).filter(([, n]) => n > 0).sort((a, b) => itemLabel(a[0]).localeCompare(itemLabel(b[0])));
    return [...s.pocket.filter(([, n]) => n > 0), ...mats];
  }

  protected async refresh() {
    const ui = this.root;
    if (!ui) return;
    const save = this.pack.save(), all = this.contents(), data = this.pack.data();
    const crowns = ui.find("crowns");
    if (crowns) crowns.text = save.crowns.toLocaleString("en-US");
    ["tab_bag1", "tab_bag2"].forEach((t, i) => { const c = ui.find(t); if (c) c.selected = i === this.bag; });
    const pocket = new Set(save.pocket.map(p => p[0]));
    for (let i = 0; i < SLOTS; i++) {
      const slot = ui.find(`slot${i + 1}`);
      if (!slot) continue;
      const item = all[this.bag * SLOTS + i];
      const ring = slot.find("slot_ring"), count = slot.find("itemcount");
      if (count) count.text = item && item[1] > 1 ? String(item[1]) : "";
      if (!ring) continue;
      if (!item) { this.icons_.delete(ring); this.tips.delete(slot); continue; }
      const info = itemInfo(data, item[0]);
      this.icons_.set(ring, info?.icon ?? null);
      const kind = pocket.has(item[0]) ? (/Vial/.test(info?.kind ?? "") ? "Vial" : "Capsule") : "Material";
      this.tips.set(slot, itemTip({ label: itemLabel(item[0]), type: kind, rarity: info?.rarity ?? 0,
        flavor: kind === "Material" ? "A crafting material: the forge's recipes call for it." : "Carried in the pocket: use it from the quickbar.",
        lines: [`${item[1]} carried`] }));
    }
  }
}
