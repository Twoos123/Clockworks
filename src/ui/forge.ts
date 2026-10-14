// Crafting: the game's recipe window (ui/recipes/interface.dat, the client's craft/a/o), not
// the crystal forge (ui/forge, item/client/n, which levels finished gear with crystals and is
// not part of this port). As the client lays it out:
//
// - The recipe list (craft/a/x on ui/arsenal/interface.dat in Window mode, titled
//   "RECIPES"): the recipes the knight has learned, grouped by what they make, sorted
//   natural, by name or by stars, the picked pill staying pressed. With none learned it says
//   so; a notice offers the recipes the knight could still learn.
// - The ingredients (craft/a/s on ui/recipes/interface_ingredients.dat): the item's name,
//   the materials (ui/recipes/parts/material), the special ingredient (the base item,
//   ui/recipes/parts/special), "Items must be unequipped" when the base item is worn, the
//   crowns (dimmed when short) and Transmute, enabled when everything is at hand.
// - Transmuting (craft/a/G on ui/recipes/interface_success.dat): "You have created..." or
//   "Your X has become...", then after three seconds SUCCESS!, the new item's name and icon,
//   "Unique Variant Acquired!" when it rolled variants, where it went, and Equip and OK.

import { recordCraft } from "../game/achievements";
import type { GameData } from "../game/data";
import type { Economy, Recipe } from "../game/economy";
import { catalogue, CATEGORIES, isEquipped, itemLabel, toggleEquip } from "../game/items";
import { itemStats, pillDamage } from "../game/itemstats";
import type { SaveData } from "../game/save";
import { message, text } from "../i18n";
import type { Component } from "./gui";
import { itemTip, ItemList, type ListGroup } from "./itemlist";
import { buildUi, GuiScreen, uiRef, type ScreenHost } from "./screen";

export interface ForgeHost extends ScreenHost {
  save(): SaveData;
  data(): GameData;
  /** The save changed (crafting, equipping). */
  changed(): void;
  eco(): Promise<Economy>;
}

const MATERIAL = "ui/recipes/parts/material/interface.dat";
const SPECIAL = "ui/recipes/parts/special/interface.dat";
const SUCCESS = "ui/recipes/interface_success.dat";
/** craft/a/G: the server's reply is shown no sooner than this. */
const RESULT_DELAY = 3000;

/** The recipe list's groups (ItemCodes.Group order) and their names in the craft bundle. */
const GROUPS: { id: string; key: string }[] = [
  { id: "sword", key: "m.sword" }, { id: "gun", key: "m.handgun" }, { id: "bomb", key: "m.bomb" }, { id: "helmet", key: "m.helm" },
  { id: "armor", key: "m.armor" }, { id: "shield", key: "m.shield" }, { id: "trinket", key: "m.trinket" },
];
const CAT = "ui/icon/inventory/categories/";

const craftText = (key: string, fallback: string) => text("craft", key, fallback);

export class ForgeScreen extends GuiScreen {
  private list: ItemList | null = null;
  private ingredients: Component | null = null;
  private all: Recipe[] = [];
  private eco: Economy | null = null;
  private chosen: Recipe | null = null;
  private parts = new Map<string, Promise<Component | null>>();

  constructor(ctx: ConstructorParameters<typeof GuiScreen>[0], private readonly host_: ForgeHost) {
    super(ctx, host_, "forgeCanvas");
  }

  protected async build(): Promise<Component | null> {
    const [root, eco] = await Promise.all([this.ui("ui/recipes/interface.dat"), this.host_.eco()]);
    if (!root) return null;
    this.eco = eco;
    this.all = eco.recipes().filter(r => !!this.iconOf(r.output));
    const left = root.find("recipes"), right = root.find("ingredients");
    if (!left || !right) return null;
    this.ingredients = right;
    this.list = new ItemList(this.ctx, left, this.tips, f => this.host.sound(f));
    this.list.showSelection = true;
    this.list.sorts = ["natural", "name", "stars"];
    this.list.bundle = "craft";
    this.list.clicks = this.clicks;
    this.list.menu = (e, t, c) => void this.popupMenu(e, t, c);
    this.list.onPick = e => {
      this.chosen = this.all.find(r => r.name === e.key) ?? null;
      this.host.sound("sound/feedback/ui_dropdown_select.ogg");
      void this.refresh();
    };
    this.on(left, "dismiss", () => this.close());
    // the item preview on the knight, the market's buy widget, unbinding: not in this port
    for (const tag of ["buy_item_widget", "keep_variants", "result_bound"]) { const c = right.find(tag); if (c) c.visible = false; }
    this.on(right, "confirm", () => void this.transmute());
    this.hooks = {
      tagged: {
        // the new item's icon on the transmute result
        icon: (_c, g, x, y, w, h) => {
          const im = this.shown ? this.icon(this.iconOf(this.shown), 75) : null;
          if (im) g.drawImage(im.source as CanvasImageSource, Math.round(x + (w - im.width) / 2), Math.round(y + (h - im.height) / 2), im.width, im.height);
        },
      },
    };
    return root;
  }

  /** The item the transmute result shows. */
  private shown: string | null = null;

  private iconOf(name: string | null | undefined) { return name ? this.eco?.info(name)?.icon ?? null : null; }
  private catOf(r: Recipe) { const c = this.eco?.info(r.output)?.category; return CATEGORIES.find(k => k.eco === c) ?? null; }

  private part(key: string, ref: any): Promise<Component | null> {
    let p = this.parts.get(key);
    if (!p) { p = buildUi(this.ctx, ref); this.parts.set(key, p); }
    return p;
  }

  protected async refresh() {
    if (!this.list || !this.ingredients) return;
    const save = this.host_.save(), eco = this.eco!, data = this.host_.data();
    // craft/a/x lists the recipes the knight has learned
    const known = this.all.filter(r => save.recipes.includes(r.name));
    if (this.chosen && !known.includes(this.chosen)) this.chosen = null;
    this.list.selected = this.chosen?.name ?? null;
    const groups: ListGroup[] = GROUPS.map(g => {
      const cat = CATEGORIES.find(c => c.id === g.id)!;
      return {
        id: g.id, label: craftText(g.key, cat.label), icon: cat.icon, showEmpty: true,
        entries: known.filter(r => this.catOf(r)?.id === g.id).map(r => ({
          key: r.name, label: itemLabel(r.output), rarity: r.rarity, icon: this.iconOf(r.output),
          damage: pillDamage(data, eco, r.output),
          tip: itemTip({ label: itemLabel(r.output), type: cat.label.replace(/s$/, ""), rarity: r.rarity, item: r.output, kind: cat.eco,
            flavor: "", level: eco.info(r.output)?.heatable ? 1 : undefined, noLevel: g.id === "trinket", stats: itemStats(data, eco, r.output, 1) }),
        })),
      };
    });
    const other = known.filter(r => !GROUPS.some(g => g.id === this.catOf(r)?.id));
    if (other.length) groups.push({ id: "other", label: craftText("m.item", "Item"), icon: CAT + "icon_recipe.png", entries: other.map(r => ({
      key: r.name, label: itemLabel(r.output), rarity: r.rarity, icon: this.iconOf(r.output),
      tip: itemTip({ label: itemLabel(r.output), type: "Item", rarity: r.rarity, item: r.output, flavor: "", plain: true }) })) });
    this.list.setInfo(craftText("t.recipes", "RECIPES"), "", "", null);
    // the client's "You have new Recipes" notice points at recipe items not yet learned; recipes
    // bought here are learned at once, so it never shows
    this.list.setNotice("");
    await this.list.setGroups(groups);
    await this.fillIngredients(save);
  }

  private async fillIngredients(save: SaveData) {
    const f = this.ingredients!, r = this.chosen, eco = this.eco!;
    // craft/a/s: hidden until a recipe is picked
    f.visible = !!r;
    if (!r) return;
    const set = (tag: string, t: string) => { const c = f.find(tag); if (c) c.text = t; return c; };
    set("titlebar_itemname", itemLabel(r.output).toUpperCase());
    const crowns = set("cost_crowns", r.crowns.toLocaleString("en-US"));
    if (crowns) crowns.enabled = save.crowns >= r.crowns;
    // the materials
    const mats = await Promise.all(r.materials.map(([n, k]) => {
      const have = save.materials[n] ?? 0, info = eco.info(n);
      const args = { Name: itemLabel(n), "Amount Have": String(have), "Amount Needed": String(k), Ready: have >= k,
        Icon: info?.icon?.file ?? "ui/icon/inventory/blank.png", Colorization: info?.icon?.colorizations ?? [] };
      return this.part(JSON.stringify(args, (kk, v) => (kk === "$outer" ? undefined : v)), uiRef(MATERIAL, args)).then(c => {
        // "find this material" opens the gates that drop it (a market of gates this port lacks): a blank of its size
        const find = c?.find("find_materials");
        if (find) find.alpha = 0;
        if (find) find.enabled = false;
        return c;
      });
    }));
    const basic = f.find("list_basic");
    if (basic) { basic.children = mats.filter((c): c is Component => !!c); basic.children.forEach(c => { c.constraints = null; }); }
    // the special ingredient: the base item, ready when owned at its level and not worn
    const special = f.find("list_special");
    const unequip = f.find("unequip_label");
    let worn = false, baseReady = true;
    if (special) {
      const kids: Component[] = [];
      if (r.base) {
        const entry = catalogue(this.host_.data()).find(e => e.name === r.base);
        worn = !!entry && isEquipped(save.loadout, entry);
        baseReady = save.owned.includes(r.base) && eco.level(save, r.base) >= r.baseLevel && !worn;
        const info = eco.info(r.base);
        const name = r.baseLevel > 1 ? message("craft", "m.level_item_name", r.baseLevel, itemLabel(r.base)) || `${itemLabel(r.base)} (Lv ${r.baseLevel})` : itemLabel(r.base);
        const args = { Name: name, Ready: baseReady, Icon: info?.icon?.file ?? "ui/icon/inventory/blank.png", Colorization: info?.icon?.colorizations ?? [] };
        const c = await this.part("special" + JSON.stringify(args, (kk, v) => (kk === "$outer" ? undefined : v)), uiRef(SPECIAL, args));
        if (c) kids.push(c);
      }
      if (unequip) { unequip.visible = worn; if (worn) kids.push(unequip); }
      special.children = kids;
      kids.forEach(c => { c.constraints = null; });
    }
    const ready = eco.missing(save, r).length === 0 && baseReady;
    const confirm = f.find("confirm");
    if (confirm) confirm.enabled = ready;
  }

  private async transmute() {
    const save = this.host_.save(), r = this.chosen, eco = this.eco!;
    if (!r || !this.ingredients?.find("confirm")?.enabled) return;
    const made = eco.craft(save, r);
    if (!made) { this.host.sound("sound/feedback/ui_dismiss.ogg"); return; }
    recordCraft(save, r.rarity);
    this.host_.changed();
    this.host.sound("sound/feedback/transmute.ogg");
    await this.showResult(r, made.variants);
    this.chosen = null;
    await this.refresh();
  }

  /** craft/a/G: "TRANSMUTING" and the summary, then the result after three seconds. */
  private async showResult(r: Recipe, variants: string[]) {
    const o = await buildUi(this.ctx, uiRef(SUCCESS, { "Unique Variant": variants.length > 0 }));
    if (!o) return;
    const set = (tag: string, t: string) => { const c = o.find(tag); if (c) c.text = t; return c; };
    const dismiss = o.find("dismiss");
    if (dismiss) dismiss.visible = false;
    set("title", craftText("t.transmuting", "TRANSMUTING"));
    set("summary", r.base ? message("craft", "m.summary_upgrade", itemLabel(r.base)) || `Your ${itemLabel(r.base)} has become...` : craftText("m.summary", "You have created..."));
    set("itemname", "");
    const status = set("status", "");
    for (const tag of ["icon", "unique_text", "buttongroup", "unique_effect"]) { const c = o.find(tag); if (c) c.visible = false; }
    this.shown = null;
    const close = () => { this.overlays = this.overlays.filter(x => x !== o); this.runner(o).stop(); };
    const ok = o.find("confirm");
    if (ok) ok.onAction = () => { this.host.sound("sound/feedback/ui_dismiss.ogg"); close(); };
    const go = o.find("gotoitem");
    if (go) go.visible = false;
    this.overlays.push(o);
    setTimeout(() => {
      if (!this.overlays.includes(o)) return;
      set("title", craftText("t.success", "SUCCESS!"));
      this.shown = r.output;
      const icon = o.find("icon");
      if (icon) { icon.visible = true; icon.styles = icon.styles.map(() => null); }
      set("itemname", this.eco!.displayName(r.output, this.host_.save().gear[r.output]));
      if (status) status.text = craftText("m.moved_arsenal", "Item moved to your Arsenal");
      const unique = o.find("unique_text");
      if (unique) unique.visible = variants.length > 0;
      // Equip: shown for gear the knight can wear, disabled when it already is
      const save = this.host_.save(), entry = catalogue(this.host_.data()).find(e => e.name === r.output);
      const equip = o.find("equipitem");
      if (equip) {
        equip.visible = !!entry;
        equip.enabled = !!entry && !isEquipped(save.loadout, entry);
        equip.onAction = () => {
          if (!entry) return;
          save.loadout = toggleEquip(save.loadout, entry);
          this.host_.changed();
          this.host.sound("sound/feedback/ui_equip.ogg");
          close();
        };
      }
      const group = o.find("buttongroup");
      if (group) group.visible = true;
      this.runner(o).runScript({ name: "Transmute Success", arguments: { $map: "com.threerings.config.ArgumentMap", entries: [] } });
    }, RESULT_DELAY);
  }
}
