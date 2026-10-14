// The game's item windows, opened from the HUD and the keyboard: the arsenal (equipment), the
// forge (crafting and levelling), the shops and the backpack. Each is the install's own
// interface on its own canvas; the game pauses while one is open. This keeps main.ts's
// hooks small: it hands over the save and a few callbacks.

import type { ColorPository } from "../colors";
import type { GameData } from "../game/data";
import type { Economy } from "../game/economy";
import type { Outfit } from "../game/outfit";
import type { Loadout, SaveData } from "../game/save";
import { ArsenalScreen } from "./equipment";
import { ForgeScreen } from "./forge";
import { ShopScreen, type StockItem } from "./shop";
import { BackpackScreen } from "./backpack";
import type { Component, GuiContext } from "./gui";
import type { GuiScreen, ViewModel } from "./screen";

export interface ScreensHost {
  gui: GuiContext;
  data(): GameData;
  /** The economy (prices, levels, recipes, buying and selling). */
  eco(): Promise<Economy>;
  save(): SaveData;
  /** Writes the save after a change. */
  write(): void;
  sound(file: string): void;
  /** A window opened (pause) or every window closed (resume). */
  paused(on: boolean): void;
  colors: Promise<ColorPository | null>;
  /** Draws the knight preview into a RenderableView. */
  view?(c: Component, g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, model?: ViewModel): void;
  /** The arsenal closed (the Ready Room dresses the knight). */
  arsenalClosed?(): void;
  /** The battle sprite, accessories and costumes. */
  outfit(): Outfit;
}

export class GameScreens {
  private arsenal_: ArsenalScreen | null = null;
  private forge_: ForgeScreen | null = null;
  private shop_: ShopScreen | null = null;
  private backpack_: BackpackScreen | null = null;
  private colorList: { print: number; name: string }[] = [];

  constructor(private readonly host: ScreensHost) {
    void host.colors.then(pos => {
      const cls = pos?.classes.get(host.save().color >> 8);
      // the personal colours (the team colours belong to PvP)
      if (cls) this.colorList = [...cls.colors.values()].filter(c => !/^team/i.test(c.name))
        .map(c => ({ print: (cls.classId << 8) | c.colorId, name: c.name.replace(/(^|[\s_])\w/g, m => m.toUpperCase()).replace(/_/g, " ") }));
    });
  }

  private all(): GuiScreen[] { return ([this.arsenal_, this.forge_, this.shop_, this.backpack_] as (GuiScreen | null)[]).filter((s): s is GuiScreen => !!s); }

  /** True while any window is open. */
  get isOpen() { return this.all().some(s => s.isOpen); }

  /** Escape: closes the open window's overlay or the window; false when none is open. */
  escape(): boolean {
    const s = this.all().find(x => x.isOpen);
    if (!s) return false;
    s.escape();
    return true;
  }

  closeAll() { for (const s of this.all()) s.close(); }

  private closed = () => { if (!this.isOpen) this.host.paused(false); };

  private base() {
    const h = this.host;
    return { sound: h.sound, closed: this.closed, view: h.view, data: h.data, save: h.save, eco: h.eco };
  }

  get arsenal() {
    const h = this.host;
    return this.arsenal_ ??= new ArsenalScreen(h.gui, {
      ...this.base(),
      closed: () => { this.closed(); h.arsenalClosed?.(); },
      equipped: (l: Loadout) => { h.save().loadout = l; h.write(); },
      colors: () => this.colorList,
      setColor: print => { h.save().color = print; h.write(); },
      outfit: h.outfit,
      write: h.write,
    });
  }

  get forge() {
    return this.forge_ ??= new ForgeScreen(this.host.gui, { ...this.base(), changed: () => this.host.write() });
  }

  get backpack() {
    return this.backpack_ ??= new BackpackScreen(this.host.gui, { ...this.base(), write: () => this.host.write(), outfit: this.host.outfit });
  }

  get shop() {
    return this.shop_ ??= new ShopScreen(this.host.gui, { ...this.base(), changed: () => this.host.write() });
  }

  /** Opens a shopkeeper's shop with its stock. */
  async openShop(title: string, stock: StockItem[], maxRarity: number, portrait: any = null, subtitle = "") {
    for (const o of this.all()) if (o !== this.shop) o.close();
    this.host.paused(true);
    await this.shop.openFor(title, stock, maxRarity, portrait, subtitle);
  }

  /** Opens a window (closing any other), or closes it when it is open. */
  async toggle(s: GuiScreen) {
    if (s.isOpen) { s.close(); return; }
    for (const o of this.all()) if (o !== s) o.close();
    this.host.paused(true);
    await s.open();
  }

  toggleArsenal() { return this.toggle(this.arsenal); }
  toggleForge() { return this.toggle(this.forge); }
  toggleBackpack() { return this.toggle(this.backpack); }

  /** Builds the arsenal, backpack and forge ahead of their first opening, one after another. */
  async prebuild(idle: () => Promise<void>) {
    for (const s of [() => this.arsenal, () => this.backpack, () => this.forge]) {
      await idle();
      try { await s().prebuild(); } catch (e) { console.warn("window prebuild failed", e); }
    }
  }
}
