// The game's item windows, opened from the HUD's corner menu and the keyboard as the client's
// toggle commands open them (client/as.a(dt), hud/P):
//
//   P  TOGGLE_CHARACTER  the character window (client/m: equipment, costume, sprite, achievements)
//   L  TOGGLE_LOADOUT    the Loadouts window (client/bL), docked at the right
//   U  TOGGLE_FORGE      the Forge (item/client/q), docked at the left
//   I  TOGGLE_ARSENAL    the arsenal (item/client/f), docked at the right edge
//   F5 TOGGLE_RECIPES    crafting (craft/a/o), with the arsenal beside it
//
// The client's windows stand side by side: the arsenal at the screen's right edge, the loadouts
// left of it (bL.Cj), the forge at the left. Here each window is the install's own interface on
// its own canvas, and the arsenal and loadouts dock into the window already open (the forge,
// crafting, the loadouts, the character window) instead of replacing it. The game goes on behind
// them, as the online client's does. This keeps main.ts's hooks small: it hands over the save and a few callbacks.

import type { ColorPository } from "../colors";
import type { GameData } from "../game/data";
import type { Economy } from "../game/economy";
import type { Outfit } from "../game/outfit";
import type { Loadout, SaveData } from "../game/save";
import { ArsenalScreen } from "./equipment";
import { ForgeScreen } from "./forge";
import { RecipesScreen } from "./recipes";
import { LoadoutsPanel, LoadoutsScreen } from "./loadouts";
import { ShopScreen, type StockItem } from "./shop";
import { BackpackScreen, InventoryPanel } from "./backpack";
import type { Component, GuiContext } from "./gui";
import type { DockPanel, GuiScreen, ViewModel } from "./screen";

export interface ScreensHost {
  gui: GuiContext;
  data(): GameData;
  /** The economy (prices, levels, recipes, buying and selling). */
  eco(): Promise<Economy>;
  save(): SaveData;
  /** Writes the save after a change. */
  write(): void;
  sound(file: string): void;
  /** Every window closed (the game canvas takes the keys back). */
  allClosed(): void;
  colors: Promise<ColorPository | null>;
  /** Draws the knight preview into a RenderableView. */
  view?(c: Component, g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, model?: ViewModel): void;
  /** The arsenal closed (the Ready Room dresses the knight). */
  arsenalClosed?(): void;
  /** The battle sprite, accessories and costumes. */
  outfit(): Outfit;
  /** The knight with an item tried on (the vendor's Preview), or null. */
  previewModel?(item: string): Promise<ViewModel | null>;
}

/** Dock keys and their places from the right edge inward. */
const INVENTORY = "inventory", LOADOUTS = "loadouts";

export class GameScreens {
  private arsenal_: ArsenalScreen | null = null;
  private forge_: ForgeScreen | null = null;
  private recipes_: RecipesScreen | null = null;
  private loadouts_: LoadoutsScreen | null = null;
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

  private all(): GuiScreen[] {
    return ([this.arsenal_, this.forge_, this.recipes_, this.loadouts_, this.shop_, this.backpack_] as (GuiScreen | null)[]).filter((s): s is GuiScreen => !!s);
  }

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

  private closed = () => { if (!this.isOpen) this.host.allClosed(); };

  private base() {
    const h = this.host;
    return { sound: h.sound, closed: this.closed, view: h.view, data: h.data, save: h.save, eco: h.eco };
  }

  private equipped = (l: Loadout) => { this.host.save().loadout = l; this.host.write(); };

  get arsenal() {
    const h = this.host;
    return this.arsenal_ ??= new ArsenalScreen(h.gui, {
      ...this.base(),
      closed: () => { this.closed(); h.arsenalClosed?.(); },
      equipped: this.equipped,
      colors: () => this.colorList,
      setColor: print => { h.save().color = print; h.write(); },
      outfit: h.outfit,
      write: h.write,
    });
  }

  get forge() {
    return this.forge_ ??= new ForgeScreen(this.host.gui, { ...this.base(), changed: () => this.host.write() });
  }

  get recipes() {
    return this.recipes_ ??= new RecipesScreen(this.host.gui, { ...this.base(), changed: () => this.host.write(), outfit: this.host.outfit, inventory: this.inventoryDock });
  }

  get loadouts() {
    return this.loadouts_ ??= new LoadoutsScreen(this.host.gui, this.loadoutsHost());
  }

  get backpack() {
    return this.backpack_ ??= new BackpackScreen(this.host.gui, { ...this.base(), write: () => this.host.write(), outfit: this.host.outfit });
  }

  get shop() {
    return this.shop_ ??= new ShopScreen(this.host.gui, { ...this.base(), changed: () => this.host.write(), previewModel: this.host.previewModel });
  }

  private loadoutsHost() {
    return { ...this.base(), outfit: this.host.outfit, equipped: this.equipped, write: () => this.host.write() };
  }

  /** The arsenal docked by another window (item/client/f beside it); its dismiss closes only it. */
  private inventoryDock = async (s: GuiScreen): Promise<DockPanel | null> => {
    const { ctx, tips, clicks } = s.dockContext;
    return InventoryPanel.create(s, ctx, { ...this.base(), write: () => this.host.write(), outfit: this.host.outfit }, await this.host.eco(), tips, clicks,
      () => { this.host.sound("sound/feedback/ui_dismiss.ogg"); void s.dock(INVENTORY, false, 0, this.inventoryDock); }, () => void s.refreshAll());
  };

  /** The loadouts docked by another window (left of the arsenal). */
  private loadoutsDock = (s: GuiScreen): Promise<DockPanel | null> =>
    LoadoutsPanel.create(s, this.loadoutsHost(), () => { this.host.sound("sound/feedback/ui_dismiss.ogg"); void s.dock(LOADOUTS, false, 1, this.loadoutsDock); });

  /** Whether the arsenal or the loadouts show, on their own or docked by the open window. */
  private shows(key: string) {
    const own = key === INVENTORY ? this.backpack_ : this.loadouts_;
    return !!own?.isOpen || this.all().some(s => s.isOpen && s.docked(key));
  }

  /** The corner menu's pressed buttons (hud/P.ao, as, a, aA): which windows are open. */
  openWindows(): Record<string, boolean> {
    return { button_gear: !!this.arsenal_?.isOpen, button_loadout: this.shows(LOADOUTS), button_arsenal: this.shows(INVENTORY), button_forge: !!this.forge_?.isOpen };
  }

  /** Opens a shopkeeper's shop with its stock. */
  async openShop(title: string, stock: StockItem[], maxRarity: number, portrait: any = null, subtitle = "") {
    for (const o of this.all()) if (o !== this.shop) o.close();
    await this.shop.openFor(title, stock, maxRarity, portrait, subtitle);
  }

  /** Opens a window, closing any other. */
  private async open(s: GuiScreen) {
    for (const o of this.all()) if (o !== s) o.close();
    await s.open();
  }

  /** Opens a window (closing any other), or closes it when it is open. */
  async toggle(s: GuiScreen) {
    if (s.isOpen) { s.close(); return; }
    await this.open(s);
  }

  /** Opens a window the arsenal and loadouts dock by, keeping the ones showing. */
  private async toggleHost(s: GuiScreen, keep: string[] = [INVENTORY, LOADOUTS]) {
    if (s.isOpen) { s.close(); return; }
    const showing = keep.filter(k => this.shows(k));
    await this.open(s);
    if (showing.includes(INVENTORY)) await s.dock(INVENTORY, true, 0, this.inventoryDock);
    if (showing.includes(LOADOUTS)) await s.dock(LOADOUTS, true, 1, this.loadoutsDock);
  }

  /** P: the character window (the loadouts may dock beside it). */
  toggleArsenal() { return this.toggleHost(this.arsenal, [LOADOUTS]); }
  /** O: the character window on its achievements (as.DE: closes it when that page is up). */
  async toggleAchievements() {
    if (this.arsenal.isOpen && this.arsenal.page === "achievements") { this.arsenal.close(); return; }
    await this.showCharacter("achievements");
  }

  /** The character window on a page (as.DI equipment, as.DJ the battle sprite, as.Ep achievements). */
  async showCharacter(page: "equipment" | "sprite" | "achievements") {
    if (!this.arsenal.isOpen) await this.toggleArsenal();
    await this.arsenal.showPage(page);
  }
  /** U: the forge. */
  toggleForge() { return this.toggleHost(this.forge); }
  /** F5: crafting (the arsenal opens beside it whatever). */
  toggleRecipes() { return this.toggleHost(this.recipes, [LOADOUTS]); }
  /**
   * An alchemy machine (CraftActionConfig$OpenCrafter): the crafting window with the arsenal
   * beside it; using the machine again while it is up leaves it open (it does not toggle).
   */
  async openCrafter() { if (!this.recipes.isOpen) await this.toggleRecipes(); }

  /** L: the loadouts, docked into the open forge, crafting or character window, else on their own. */
  async toggleLoadouts() {
    const own = this.loadouts_;
    if (own?.isOpen) {
      // the arsenal docked by it stays open on its own
      const inv = own.docked(INVENTORY);
      own.close();
      if (inv) await this.open(this.backpack);
      return;
    }
    const host = [this.forge_, this.recipes_, this.arsenal_].find(s => s?.isOpen);
    if (host) { await host.dock(LOADOUTS, !host.docked(LOADOUTS), 1, this.loadoutsDock); return; }
    const inv = !!this.backpack_?.isOpen;
    await this.open(this.loadouts);
    if (inv) await this.loadouts.dock(INVENTORY, true, 0, this.inventoryDock);
  }

  /** I: the arsenal, docked into the open forge, crafting or loadouts window, else on its own. */
  async toggleBackpack() {
    if (this.backpack_?.isOpen) { this.backpack_.close(); return; }
    const host = [this.forge_, this.recipes_, this.loadouts_].find(s => s?.isOpen);
    if (host) { await host.dock(INVENTORY, !host.docked(INVENTORY), 0, this.inventoryDock); return; }
    await this.open(this.backpack);
  }

  /** Builds the arsenal, backpack, forge and crafting windows ahead of their first opening, one after another. */
  async prebuild(idle: () => Promise<void>) {
    for (const s of [() => this.arsenal, () => this.backpack, () => this.forge, () => this.recipes]) {
      await idle();
      try { await s().prebuild(); } catch (e) { console.warn("window prebuild failed", e); }
    }
  }
}
