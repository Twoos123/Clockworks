// The forge: the game's forge window beside its arsenal list (ui/forge/interface_forge.dat
// holding ui/arsenal/interface.dat and ui/forge/interface.dat). The list holds the recipes
// the knight can work toward (config/recipe.dat): green when everything is at hand, red
// when something is missing. The forge shows the chosen item, its base item's heat level
// against the level the recipe needs, the materials (ui/recipes/parts/material), the crowns
// and the chance of success; Forge crafts it and plays the forging animation
// (ui/forge/interface_forging.dat and its own interface scripts).

import type { GameData } from "../game/data";
import { availableRecipes, craftRecipe, craftShortfall, itemInfo, itemLabel, itemLevel, levelProgress, recipes, CATEGORIES, type Recipe } from "../game/items";
import type { SaveData } from "../game/save";
import type { Component } from "./gui";
import { itemTip, ItemList, type ListGroup } from "./itemlist";
import { buildUi, GuiScreen, uiRef, type ScreenHost } from "./screen";

export interface ForgeHost extends ScreenHost {
  save(): SaveData;
  data(): GameData;
  /** The save changed (crafting). */
  changed(): void;
}

const MATERIAL = "ui/recipes/parts/material/interface.dat";
const pad2 = (n: number) => String(n).padStart(2, "0");

export class ForgeScreen extends GuiScreen {
  private list: ItemList | null = null;
  private forge: Component | null = null;
  private all: Recipe[] = [];
  private chosen: Recipe | null = null;
  private forging: Component | null = null;
  /** The item the forging animation shows. */
  private forged: Recipe | null = null;
  private materialCache = new Map<string, Promise<Component | null>>();

  constructor(ctx: ConstructorParameters<typeof GuiScreen>[0], private readonly host_: ForgeHost) {
    super(ctx, host_, "forgeCanvas");
  }

  protected async build(): Promise<Component | null> {
    const [root, left, right, all] = await Promise.all([
      this.ui("ui/forge/interface_forge.dat"),
      this.ui("ui/arsenal/interface.dat", { Mode: "Contained" }),
      this.ui("ui/forge/interface.dat"),
      recipes(this.host_.data()),
    ]);
    if (!root || !left || !right) return null;
    this.all = all;
    place(root, "arsenal", left);
    place(root, "forge", right);
    this.forge = right;
    this.list = new ItemList(this.ctx, left, this.tips, f => this.host.sound(f));
    this.list.onPick = e => { this.chosen = this.all.find(r => r.name === e.key) ?? null; this.host.sound("sound/feedback/ui_dropdown_select.ogg"); void this.refresh(); };
    this.on(left, "dismiss", () => this.close());
    // crystals belong to the game's later forge; this one levels with heat and crafts from recipes
    for (const tag of ["min", "mid", "max", "buy_item_widget", "level_spacer", "levels"]) { const c = right.find(tag); if (c) c.visible = false; }
    hideText(right, "t.apply_crystals");
    this.on(right, "btn_forge", () => void this.craft());
    this.hooks = {
      tagged: {
        // the item the forge makes, and the base item it needs, drawn with their inventory icons
        renderview1: (c, g, x, y, w, h) => this.drawIcon(this.chosen?.icon, g, x, y, w, h, 128),
        required_icon: (c, g, x, y, w, h) => {
          const base = this.chosen?.consumes;
          this.drawIcon(base ? itemInfo(this.host_.data(), base)?.icon : null, g, x, y, w, h, 40);
        },
        icon: (c, g, x, y, w, h) => this.drawIcon(this.forged?.icon, g, x, y, w, h, 128),
      },
    };
    // the forge's idle glow
    this.runner(right).runScript({ name: "Forge Loop", arguments: { $map: "com.threerings.config.ArgumentMap", entries: [["Power", "1"]] } });
    return root;
  }

  private drawIcon(cfg: any, g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, size: number) {
    const im = cfg ? this.icon(cfg, size) : null;
    if (im) g.drawImage(im.source as CanvasImageSource, Math.round(x + (w - im.width) / 2), Math.round(y + (h - im.height) / 2), im.width, im.height);
  }

  private material(name: string, have: number, need: number): Promise<Component | null> {
    const info = itemInfo(this.host_.data(), name);
    const args = { Name: itemLabel(name), "Amount Have": String(have), "Amount Needed": String(need), Ready: have >= need,
      Icon: info?.icon?.file ?? "ui/icon/inventory/blank.png", Colorization: info?.icon?.colorizations ?? [] };
    const key = JSON.stringify(args, (k, v) => (k === "$outer" ? undefined : v));
    let p = this.materialCache.get(key);
    if (!p) {
      p = buildUi(this.ctx, uiRef(MATERIAL, args)).then(c => {
        // "find materials" opens the game's market, which this port does not have
        const find = c?.find("find_materials");
        if (find) find.visible = false;
        return c;
      });
      this.materialCache.set(key, p);
    }
    return p;
  }

  private line(text: string): Promise<Component | null> {
    const key = "line:" + text;
    let p = this.materialCache.get(key);
    if (!p) { p = buildUi(this.ctx, uiRef("ui/window/tooltip_parts/bonus.dat", { Description: text, "Toggle Icon": false })); this.materialCache.set(key, p); }
    return p;
  }

  protected async refresh() {
    if (!this.list || !this.forge) return;
    const save = this.host_.save();
    const open = availableRecipes(save, this.all);
    if (this.chosen && !open.includes(this.chosen)) this.chosen = null;
    this.chosen ??= open.find(r => craftShortfall(save, r).ok) ?? open[0] ?? null;
    this.list.selected = this.chosen?.name ?? null;
    const cats = [...CATEGORIES.map(c => ({ id: c.id, label: c.label, icon: c.icon })), { id: "other", label: "Other", icon: "ui/icon/inventory/categories/icon_recipe.png" }];
    const groups: ListGroup[] = cats.map(cat => ({
      ...cat,
      entries: open.filter(r => (r.category?.id ?? "other") === cat.id).map(r => {
        const ok = craftShortfall(save, r).ok;
        return { key: r.name, label: r.label, rarity: r.rarity, icon: r.icon, look: ok ? "False - Green" as const : "False - Red" as const,
          tip: itemTip({ label: r.label, type: r.category?.label.replace(/s$/, "") ?? "Item", rarity: r.rarity,
            flavor: ok ? "Everything is at hand: forge it." : "Gather the missing materials, crowns or heat.",
            lines: this.needs(save, r) }) };
      }),
    })).filter(g => g.entries.length);
    this.list.setInfo("FORGE", "Recipes", open.length ? "Pick a recipe. Upgrades need their base item levelled with heat in the Clockworks."
      : "Nothing to forge yet: recipes upgrade gear you own, using materials from the Clockworks.", save.crowns);
    this.list.setNotice("");
    await this.list.setGroups(groups);
    await this.fillForge(save);
  }

  /** The recipe's needs as tooltip lines. */
  private needs(save: SaveData, r: Recipe): string[] {
    return [
      ...(r.consumes ? [`${itemLabel(r.consumes)} level ${itemLevel(save, r.consumes)}/${r.level}`] : []),
      ...r.materials.map(([n, k]) => `${itemLabel(n)} ${save.materials[n] ?? 0}/${k}`),
      `${r.cost.toLocaleString("en-US")} crowns`,
    ];
  }

  private async fillForge(save: SaveData) {
    const f = this.forge!, r = this.chosen;
    const set = (tag: string, text: string) => { const c = f.find(tag); if (c) c.text = text; };
    const base = r?.consumes ?? null;
    set("type", r ? r.label.toUpperCase() : "NOTHING TO FORGE");
    // the heat panel shows the base item's level (an item made from scratch needs none)
    set("tooltip_level", pad2(base ? itemLevel(save, base) : 0));
    const heat = f.find("tooltip_heat");
    if (heat) heat.preferredSize = { width: Math.max(12, Math.round(120 * (base ? levelProgress(save, base) : 0))), height: heat.preferredSize?.height ?? -1 };
    set("required_name", base ? `${itemLabel(base)}, level ${r!.level} needed` : r ? "No base item needed" : "");
    set("crystal_count", r ? `${r.cost.toLocaleString("en-US")} crowns` : "");
    const short = r ? craftShortfall(save, r) : null;
    set("success_chance", short?.ok ? "100%" : "0%");
    set("success_msg", !r ? "Pick a recipe." : short!.ok ? "Everything is at hand." : short!.levelShort ? "Level the base item with heat first."
      : short!.missing.length ? "Gather the missing materials." : "Not enough crowns.");
    // the materials, then what the forge gives
    const pills = f.find("pills"), bonuses = f.find("bonuses");
    const mats = r ? await Promise.all(r.materials.map(([n, k]) => this.material(n, save.materials[n] ?? 0, k))) : [];
    const gives = await Promise.all([
      ...(r ? [this.line(`${"★".repeat(Math.max(0, r.rarity))} ${r.label}`)] : []),
      ...(base ? [this.line(`Replaces your ${itemLabel(base)}`)] : []),
      ...(r?.category?.slot === "weapon" ? [this.line("Starts again at level 1")] : []),
    ]);
    if (pills) { pills.children = mats.filter((c): c is Component => !!c); pills.children.forEach(c => { c.constraints = null; }); }
    if (bonuses) { bonuses.children = gives.filter((c): c is Component => !!c); bonuses.children.forEach(c => { c.constraints = null; }); }
    const btn = f.find("btn_forge");
    if (btn) btn.enabled = !!short?.ok;
    const status = f.find("status");
    if (status) status.text = "";
  }

  private async craft() {
    const save = this.host_.save(), r = this.chosen;
    if (!r || !craftRecipe(save, r)) { this.host.sound("sound/feedback/ui_dismiss.ogg"); return; }
    this.host_.changed();
    this.host.sound("sound/feedback/transmute.ogg");
    await this.playForging(r);
    this.chosen = null;
    await this.refresh();
  }

  /** The forging animation over the window: the forge powers up, then the new item appears. */
  private async playForging(r: Recipe) {
    this.forging ??= await this.ui("ui/forge/interface_forging.dat");
    const o = this.forging;
    if (!o) return;
    this.forged = r;
    // the icon socket's placeholder picture gives way to the forged item's icon
    const icon = o.find("icon");
    if (icon) icon.styles = icon.styles.map(() => null);
    const set = (tag: string, text: string) => { const c = o.find(tag); if (c) c.text = text; };
    set("itemname", r.label.toUpperCase());
    set("bonus_text", r.consumes ? `Your ${itemLabel(r.consumes)} became ${r.label}.` : `${r.label} joins your arsenal.`);
    for (const tag of ["status", "label_success", "itemname", "bonus_text", "confirm"]) o.find(tag)?.setAlpha(0);
    const confirm = o.find("confirm");
    if (confirm) { confirm.enabled = false; confirm.onAction = () => { this.overlays = this.overlays.filter(x => x !== o); this.runner(o).stop(); }; }
    const ref = (name: string, args: [string, unknown][] = []) => ({ name, arguments: { $map: "com.threerings.config.ArgumentMap", entries: args } });
    const run = this.runner(o);
    run.stop();
    run.runScript(ref("Startup", [["Power", "2"]]));
    run.runScript(ref("Results", [["Results", "Success"]]));
    this.overlays.push(o);
  }
}

/** Puts a built interface in place of the empty UserInterface component with the tag. */
function place(root: Component, tag: string, ui: Component) {
  const walk = (c: Component): boolean => {
    const i = c.children.findIndex(k => k.tag === tag);
    if (i >= 0) { ui.constraints = c.children[i].constraints; ui.tag = tag; c.children[i] = ui; return true; }
    return c.children.some(walk);
  };
  walk(root);
}

/** Hides the labels showing a message key's text. */
function hideText(root: Component, key: string) {
  const want = key.replace(/^[a-z]\./, "").split("_").map(w => w[0].toUpperCase() + w.substring(1)).join(" ").toLowerCase();
  const walk = (c: Component) => { if (c.kind === "label" && c.text.toLowerCase() === want) c.visible = false; c.children.forEach(walk); };
  walk(root);
}
