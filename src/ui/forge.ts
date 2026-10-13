// The forge: the game's forge window beside its arsenal list (ui/forge/interface_forge.dat
// holding ui/arsenal/interface.dat and ui/forge/interface.dat). The list holds the recipes
// the knight can work toward (the economy's, from config/recipe.dat): green when everything
// is at hand, red when something is missing (a recipe is learned by buying it from a shop). The forge shows the chosen item, its base item's heat level
// against the level the recipe needs, the materials (ui/recipes/parts/material), the crowns
// and the chance of success; Forge crafts it and plays the forging animation
// (ui/forge/interface_forging.dat and its own interface scripts).

import type { GameData } from "../game/data";
import type { Economy, Recipe } from "../game/economy";
import { CATEGORIES, itemLabel } from "../game/items";
import type { SaveData } from "../game/save";
import type { Component } from "./gui";
import { itemTip, ItemList, type ListGroup } from "./itemlist";
import { buildUi, GuiScreen, uiRef, type ScreenHost } from "./screen";

export interface ForgeHost extends ScreenHost {
  save(): SaveData;
  data(): GameData;
  /** The save changed (crafting). */
  changed(): void;
  eco(): Promise<Economy>;
}

const MATERIAL = "ui/recipes/parts/material/interface.dat";
const pad2 = (n: number) => String(n).padStart(2, "0");

export class ForgeScreen extends GuiScreen {
  private list: ItemList | null = null;
  private forge: Component | null = null;
  private all: Recipe[] = [];
  private eco: Economy | null = null;
  private chosen: Recipe | null = null;
  private forging: Component | null = null;
  /** The item the forging animation shows. */
  private forged: Recipe | null = null;
  private materialCache = new Map<string, Promise<Component | null>>();

  constructor(ctx: ConstructorParameters<typeof GuiScreen>[0], private readonly host_: ForgeHost) {
    super(ctx, host_, "forgeCanvas");
  }

  protected async build(): Promise<Component | null> {
    const [root, left, right, eco] = await Promise.all([
      this.ui("ui/forge/interface_forge.dat"),
      this.ui("ui/arsenal/interface.dat", { Mode: "Contained" }),
      this.ui("ui/forge/interface.dat"),
      this.host_.eco(),
    ]);
    if (!root || !left || !right) return null;
    this.eco = eco;
    this.all = eco.recipes().filter(r => !!this.iconOf(r.output));
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
        renderview1: (c, g, x, y, w, h) => this.drawIcon(this.iconOf(this.chosen?.output), g, x, y, w, h, 128),
        required_icon: (c, g, x, y, w, h) => this.drawIcon(this.iconOf(this.chosen?.base), g, x, y, w, h, 40),
        icon: (c, g, x, y, w, h) => this.drawIcon(this.iconOf(this.forged?.output), g, x, y, w, h, 128),
      },
    };
    // the forge's idle glow
    this.runner(right).runScript({ name: "Forge Loop", arguments: { $map: "com.threerings.config.ArgumentMap", entries: [["Power", "1"]] } });
    return root;
  }

  private iconOf(name: string | null | undefined) { return name ? this.eco?.info(name)?.icon ?? null : null; }
  private catOf(r: Recipe) { const c = this.eco?.info(r.output)?.category; return CATEGORIES.find(k => k.eco === c) ?? null; }

  private drawIcon(cfg: any, g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, size: number) {
    const im = cfg ? this.icon(cfg, size) : null;
    if (im) g.drawImage(im.source as CanvasImageSource, Math.round(x + (w - im.width) / 2), Math.round(y + (h - im.height) / 2), im.width, im.height);
  }

  private material(name: string, have: number, need: number): Promise<Component | null> {
    const info = this.eco?.info(name);
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
    const save = this.host_.save(), eco = this.eco!, owned = new Set(save.owned);
    // what the knight can work toward: not made yet, its base item owned (or none needed)
    const open = this.all.filter(r => !owned.has(r.output) && (!r.base || owned.has(r.base)));
    if (this.chosen && !open.includes(this.chosen)) this.chosen = null;
    this.chosen ??= open.find(r => eco.canCraft(save, r)) ?? open.find(r => save.recipes.includes(r.name)) ?? open[0] ?? null;
    this.list.selected = this.chosen?.name ?? null;
    const cats = [...CATEGORIES.map(c => ({ id: c.id, label: c.label, icon: c.icon })), { id: "other", label: "Other", icon: "ui/icon/inventory/categories/icon_recipe.png" }];
    const groups: ListGroup[] = cats.map(cat => ({
      ...cat,
      entries: open.filter(r => (this.catOf(r)?.id ?? "other") === cat.id).map(r => {
        const ok = eco.canCraft(save, r), known = save.recipes.includes(r.name);
        return { key: r.name, label: itemLabel(r.output), rarity: r.rarity, icon: this.iconOf(r.output),
          look: ok ? "False - Green" as const : known ? "False" as const : "False - Red" as const,
          tip: itemTip({ label: itemLabel(r.output), type: this.catOf(r)?.label.replace(/s$/, "") ?? "Item", rarity: r.rarity,
            item: r.output, kind: this.catOf(r)?.eco ?? "item",
            flavor: ok ? "Everything is at hand: forge it." : known ? "Gather what is missing." : "Buy the recipe from a shop first.",
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
    const eco = this.eco!;
    return [
      save.recipes.includes(r.name) ? "Recipe known" : `Recipe needed${r.item ? ` (${eco.price(r.item).toLocaleString("en-US")} crowns)` : ""}`,
      ...(r.base ? [`${itemLabel(r.base)} level ${eco.level(save, r.base)}/${r.baseLevel}`] : []),
      ...r.materials.map(([n, k]) => `${itemLabel(n)} ${save.materials[n] ?? 0}/${k}`),
      `${r.crowns.toLocaleString("en-US")} crowns`,
    ];
  }

  private async fillForge(save: SaveData) {
    const f = this.forge!, r = this.chosen, eco = this.eco!;
    const set = (tag: string, text: string) => { const c = f.find(tag); if (c) c.text = text; };
    const base = r?.base ?? null;
    set("type", r ? itemLabel(r.output).toUpperCase() : "NOTHING TO FORGE");
    // the heat panel shows the base item's level (an item made from scratch needs none)
    set("tooltip_level", pad2(base ? eco.level(save, base) : 0));
    const heat = f.find("tooltip_heat");
    if (heat) heat.preferredSize = { width: Math.max(12, Math.round(120 * (base ? eco.heatProgress(save, base) : 0))), height: heat.preferredSize?.height ?? -1 };
    set("required_name", base ? `${itemLabel(base)}, level ${r!.baseLevel} needed` : r ? "No base item needed" : "");
    set("crystal_count", r ? `${r.crowns.toLocaleString("en-US")} crowns` : "");
    const missing = r ? eco.missing(save, r) : [];
    const ok = !!r && !missing.length;
    set("success_chance", ok ? "100%" : "0%");
    set("success_msg", !r ? "Pick a recipe." : ok ? "Everything is at hand." : `Missing: ${missing.join(", ")}.`);
    // the materials, then what the forge gives
    const pills = f.find("pills"), bonuses = f.find("bonuses");
    const mats = r ? await Promise.all(r.materials.map(([n, k]) => this.material(n, save.materials[n] ?? 0, k))) : [];
    const gives = await Promise.all([
      ...(r ? [this.line(`${"★".repeat(Math.max(0, r.rarity))} ${itemLabel(r.output)}`)] : []),
      ...(base ? [this.line(`Replaces your ${itemLabel(base)}`)] : []),
      ...(r && eco.info(r.output)?.heatable ? [this.line("Starts at level 1")] : []),
      ...(r?.variantTable ? [this.line("May roll unique variants")] : []),
    ]);
    if (pills) { pills.children = mats.filter((c): c is Component => !!c); pills.children.forEach(c => { c.constraints = null; }); }
    if (bonuses) { bonuses.children = gives.filter((c): c is Component => !!c); bonuses.children.forEach(c => { c.constraints = null; }); }
    const btn = f.find("btn_forge");
    if (btn) btn.enabled = ok;
    const status = f.find("status");
    if (status) status.text = "";
  }

  private async craft() {
    const save = this.host_.save(), r = this.chosen;
    const made = r ? this.eco!.craft(save, r) : null;
    if (!r || !made) { this.host.sound("sound/feedback/ui_dismiss.ogg"); return; }
    this.host_.changed();
    this.host.sound("sound/feedback/transmute.ogg");
    await this.playForging(r, made.variants);
    this.chosen = null;
    await this.refresh();
  }

  /** The forging animation over the window: the forge powers up, then the new item appears. */
  private async playForging(r: Recipe, variants: string[]) {
    this.forging ??= await this.ui("ui/forge/interface_forging.dat");
    const o = this.forging;
    if (!o) return;
    this.forged = r;
    // the icon socket's placeholder picture gives way to the forged item's icon
    const icon = o.find("icon");
    if (icon) icon.styles = icon.styles.map(() => null);
    const set = (tag: string, text: string) => { const c = o.find(tag); if (c) c.text = text; };
    const label = itemLabel(r.output);
    set("itemname", label.toUpperCase());
    set("bonus_text", (r.base ? `Your ${itemLabel(r.base)} became ${label}.` : `${label} joins your arsenal.`)
      + (variants.length ? ` Unique: ${variants.map(v => this.eco!.variantLabel(v)).join(", ")}.` : ""));
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
