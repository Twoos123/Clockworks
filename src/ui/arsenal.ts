// The arsenal: pick the knight's weapons (up to three), shield, armour and helmet from every
// item in the game's item library, shown with the game's own inventory icons. The game's
// arsenal window is filled in by closed code (scroll lists, search), so this one is HTML.

import type { GameData } from "../game/data";
import { price, type Loadout } from "../game/save";
import type { GuiContext } from "./gui";

type Tab = "weapons" | "shield" | "armor" | "helmet" | "trinket" | "vitapod" | "craft";
const TABS: { id: Tab; label: string; test: RegExp }[] = [
  { id: "weapons", label: "Weapons", test: /^Weapon\/(Sword|Handgun|Bomb)\// },
  { id: "shield", label: "Shields", test: /^Gear\/Shield\// },
  { id: "armor", label: "Armour", test: /^Gear\/Armor\// },
  { id: "helmet", label: "Helmets", test: /^Gear\/Helm\// },
  { id: "trinket", label: "Trinkets", test: /^Gear\/Trinket\// },
  { id: "vitapod", label: "Vitapods", test: /^Gear\/Dungeon\/Vitapod\// },
  { id: "craft", label: "Craft", test: /^$/ },
];

/** What crafting needs from the player's save. */
export interface CraftHooks {
  materials(): Record<string, number>;
  /** An owned item's level (weapons level with heat), 0 when not owned. */
  level(name: string): number;
  crowns(): number;
  /** Spends the inputs and adds the output; returns false if something was missing. */
  craft(recipe: { output: string; materials: [string, number][]; consumes: string | null; cost: number }): boolean;
}
const SKIP = /\/Parts\/|\/Dev\/|\(Dev\)|\bTEST\b|\/Test\/|PvP|\(Test\)|Tutorial|Promo/;

interface Entry { name: string; label: string; kind: string; rarity: number; icon: any }

/** What the window is showing: the knight's own gear, or a shop's stock. */
export interface ShopMode { title: string; tabs: Tab[]; maxRarity: number }

export class Arsenal {
  private tab: Tab = "weapons";
  private catalogue = new Map<Tab, Entry[]>();
  private loadout!: Loadout;
  private filter = "";
  /** Show every item of the tab, the ones not owned greyed with where they come from. */
  private showAll = false;
  /** Items some recipe makes (filled once the recipe library is read). */
  private craftable: Set<string> | null = null;
  private shop: ShopMode | null = null;
  /** Personal colour swatches: print and RGB, and the chosen print. */
  colors: { print: number; name: string; rgb: [number, number, number] }[] = [];
  color = 257;
  onColor: ((print: number) => void) | null = null;

  /** Set to enable the Craft tab. */
  crafting: CraftHooks | null = null;

  constructor(private readonly root: HTMLElement, private readonly data: GameData, private readonly gui: GuiContext,
    private readonly onChange: (l: Loadout) => void, private readonly bank: () => { crowns: number; heat: number },
    private readonly owned: () => Set<string>, private readonly buy: (name: string, cost: number) => boolean) {}

  /** Opens the arsenal (owned gear), or a shop when `shop` is given. */
  async open(loadout: Loadout, shop: ShopMode | null = null, tab?: Tab) {
    this.loadout = { ...loadout, weapons: [...loadout.weapons], trinkets: [...(loadout.trinkets ?? [])] };
    this.shop = shop;
    if (tab) this.tab = tab;
    if (shop && !shop.tabs.includes(this.tab)) this.tab = shop.tabs[0];
    await this.data.preload("config/item.dat");
    this.root.hidden = false;
    this.fb("ui_open");
    this.render();
  }

  /** Redraws the window if it is open (after late data such as colour swatches arrives). */
  refresh() { if (this.isOpen) this.render(); }

  /** Called when the window closes. */
  onClose: (() => void) | null = null;
  /** Plays a UI feedback sound (the game's style feedback sounds). */
  sound: ((file: string) => void) | null = null;
  private fb(name: string) { this.sound?.(`sound/feedback/${name}.ogg`); }

  close() { this.root.hidden = true; this.fb("ui_dismiss"); this.onClose?.(); }
  get isOpen() { return !this.root.hidden; }

  private entries(tab: Tab): Entry[] {
    let list = this.catalogue.get(tab);
    if (list) return list;
    const lib = this.data.library_("config/item.dat");
    const t = TABS.find(x => x.id === tab)!;
    list = [];
    for (const name of lib.keys()) {
      if (!t.test.test(name) || SKIP.test(name)) continue;
      const impl = this.data.resolveSync("config/item.dat", { name }, "item");
      if (!impl?.icon || (!impl.model && tab !== "trinket")) continue;
      if (tab === "weapons" && !impl.attacks && !impl.chargedAttack) continue;
      const kind = String(impl.$class ?? "").split("$").pop() ?? "";
      list.push({ name, label: name.split("/").pop()!, kind: kind === "SwingingHandgun" ? "Handgun" : kind, rarity: impl.rarity ?? 0, icon: impl.icon });
    }
    list.sort((a, b) => a.kind.localeCompare(b.kind) || a.rarity - b.rarity || a.label.localeCompare(b.label));
    this.catalogue.set(tab, list);
    return list;
  }

  private equipped(e: Entry): boolean {
    const l = this.loadout;
    return this.tab === "weapons" ? l.weapons.includes(e.name) : this.tab === "trinket" ? l.trinkets.includes(e.name)
      : this.tab !== "craft" && l[this.tab] === e.name;
  }

  private toggle(e: Entry) {
    const l = this.loadout;
    if (this.tab === "weapons") {
      const i = l.weapons.indexOf(e.name);
      if (i >= 0) { if (l.weapons.length > 1) l.weapons.splice(i, 1); }
      else { if (l.weapons.length >= 3) l.weapons.shift(); l.weapons.push(e.name); }
    } else if (this.tab === "trinket") {
      const i = l.trinkets.indexOf(e.name);
      if (i >= 0) l.trinkets.splice(i, 1);
      else { if (l.trinkets.length >= 2) l.trinkets.shift(); l.trinkets.push(e.name); }
    } else if (this.tab !== "craft") {
      const slot = this.tab;
      l[slot] = l[slot] === e.name && slot !== "shield" ? "" : e.name;
    }
    this.onChange({ ...l, weapons: [...l.weapons], trinkets: [...l.trinkets] });
    this.render();
  }

  private render() {
    const r = this.root;
    r.replaceChildren();
    const card = el("div", "arsenal-card");
    const head = el("div", "arsenal-head");
    const title = el("h2", "", this.shop?.title ?? "Arsenal");
    const bank = this.bank();
    const money = el("span", "arsenal-bank", `${bank.crowns} crowns · ${bank.heat} heat`);
    const close = el("button", "", "Close");
    close.onclick = () => this.close();
    head.append(title, money, close);
    const tabs = el("div", "arsenal-tabs");
    for (const t of TABS.filter(t => this.shop ? this.shop.tabs.includes(t.id) : t.id !== "craft" || !!this.crafting)) {
      const b = el("button", t.id === this.tab ? "active" : "", t.label);
      b.onclick = () => { this.tab = t.id; this.fb("ui_dropdown_select"); this.render(); };
      tabs.append(b);
    }
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search items";
    search.value = this.filter;
    search.oninput = () => { this.filter = search.value; this.fillGrid(grid); };
    tabs.append(search);
    if (!this.shop && this.tab !== "craft") {
      const all = el("label", "arsenal-all");
      const box = document.createElement("input");
      box.type = "checkbox"; box.checked = this.showAll;
      box.onchange = () => { this.showAll = box.checked; this.fillGrid(grid); };
      all.append(box, document.createTextNode(" All gear"));
      tabs.append(all);
    }
    const summary = el("div", "arsenal-summary", this.summary());
    let colorRow: HTMLElement | null = null;
    if (!this.shop && this.colors.length && this.tab !== "craft") {
      const row = colorRow = el("div", "arsenal-colors");
      row.append(el("span", "", "Colour"));
      for (const c of this.colors) {
        const b = el("button", "swatch" + (c.print === this.color ? " active" : ""));
        b.title = c.name;
        b.style.background = `rgb(${c.rgb.join(",")})`;
        b.onclick = () => { this.color = c.print; this.onColor?.(c.print); this.fb("ui_confirm"); this.render(); };
        row.append(b);
      }
    }
    const grid = el("div", "arsenal-grid");
    card.append(head, tabs, summary, ...(colorRow ? [colorRow] : []), grid);
    r.append(card);
    this.fillGrid(grid);
  }

  /** The recipe library (config/recipe.dat): ingredients and the item each makes. */
  private async recipes(): Promise<Recipe[]> {
    await this.data.preload("config/recipe.dat");
    const lib = this.data.library_("config/recipe.dat");
    const cached = RECIPE_CACHE.get(lib);
    if (cached) return cached;
    const out: Recipe[] = [];
    for (const name of lib.keys()) {
      const r = this.data.resolveSync("config/recipe.dat", { name }, "recipe");
      const output = r?.item?.name;
      if (!output || SKIP.test(output)) continue;
      const item = this.data.resolveSync("config/item.dat", { name: output }, "item");
      if (!item?.icon) continue;
      const materials: [string, number][] = [];
      let consumes: string | null = null, level = 0;
      for (const ing of r.ingredients ?? []) {
        const k = String(ing?.$class ?? "").split("$").pop();
        if (k === "LevelItem" && ing.item?.name) { consumes = ing.item.name; level = ing.level ?? 0; }
        else if (ing?.item?.name) materials.push([ing.item.name, ing.count ?? 1]);
      }
      out.push({ name, output, label: output.split("/").pop()!, rarity: item.rarity ?? 0, icon: item.icon, materials, consumes, level,
        cost: Math.round(price(item.rarity ?? 0) / 2) });
    }
    out.sort((a, b) => a.rarity - b.rarity || a.label.localeCompare(b.label));
    RECIPE_CACHE.set(lib, out);
    return out;
  }

  private async fillCraft(grid: HTMLElement) {
    const c = this.crafting;
    if (!c) return;
    const owned = this.owned(), mats = c.materials(), q = this.filter.toLowerCase();
    const list = (await this.recipes()).filter(r => !owned.has(r.output) && (!q || r.label.toLowerCase().includes(q))
      // show recipes the knight could work toward: its base item owned, or no base item
      && (!r.consumes || owned.has(r.consumes)));
    grid.replaceChildren();
    if (!list.length) { grid.append(el("p", "arsenal-summary", "Nothing to craft yet: recipes upgrade gear you own, using materials from the Clockworks.")); return; }
    for (const r of list.slice(0, 200)) {
      const have = (n: string) => mats[n] ?? 0;
      const ok = r.materials.every(([n, k]) => have(n) >= k) && (!r.consumes || c.level(r.consumes) >= r.level) && c.crowns() >= r.cost;
      const tile = el("button", "arsenal-item craft" + (ok ? " equipped" : ""));
      const cv = document.createElement("canvas");
      cv.width = cv.height = 48;
      void this.gui.icon(r.icon).then(im => {
        if (!im) return;
        const g = cv.getContext("2d")!, s = Math.min(48 / im.width, 48 / im.height);
        g.drawImage(im.source, (48 - im.width * s) / 2, (48 - im.height * s) / 2, im.width * s, im.height * s);
      });
      const lines = [
        ...(r.consumes ? [`${r.consumes.split("/").pop()} lv ${c.level(r.consumes)}/${r.level}`] : []),
        ...r.materials.map(([n, k]) => `${n.split("/").pop()} ${have(n)}/${k}`),
        `${r.cost} cr`,
      ];
      tile.append(cv, el("span", "arsenal-name", r.label), el("span", "arsenal-stars", "★".repeat(r.rarity)), el("span", "craft-needs", lines.join("\n")));
      tile.onclick = () => { if (ok && c.craft({ output: r.output, materials: r.materials, consumes: r.consumes, cost: r.cost })) { this.fb("ui_merchant_trade_add"); this.render(); } };
      grid.append(tile);
    }
  }

  private summary(): string {
    if (this.tab === "craft") return "Recipes from the game's recipe library. Crafting uses the materials and the base item (which must be levelled with heat).";
    if (this.shop) return `Stock up to ${this.shop.maxRarity}★. Bought items go to your arsenal; owned items show a tick.`;
    const l = this.loadout, last = (n: string) => n ? n.split("/").pop() : "default";
    return `Equipped: ${l.weapons.map(last).join(", ")} · ${last(l.shield)} · ${last(l.armor)} · ${last(l.helmet)}${l.trinkets.length ? " · " + l.trinkets.map(last).join(", ") : ""}. Changes apply on the next floor.`;
  }

  private fillGrid(grid: HTMLElement) {
    grid.replaceChildren();
    if (this.showAll && !this.craftable) void this.recipes().then(list => { this.craftable = new Set(list.map(r => r.output)); this.fillGrid(grid); });
    if (this.tab === "craft") { void this.fillCraft(grid); return; }
    const q = this.filter.toLowerCase();
    const owned = this.owned();
    let shown = 0;
    for (const e of this.entries(this.tab)) {
      if (q && !e.label.toLowerCase().includes(q)) continue;
      // the arsenal holds what the knight owns; a shop sells what its tier allows
      const locked = !this.shop && !owned.has(e.name);
      if (locked && !this.showAll) continue;
      if (this.shop && (e.rarity > this.shop.maxRarity || e.rarity < 1)) continue;
      if (++shown > 400) break;
      const tile = el("button", "arsenal-item" + (this.equipped(e) ? " equipped" : ""));
      tile.title = `${e.name} (${e.rarity}★)`;
      const c = document.createElement("canvas");
      c.width = c.height = 48;
      void this.gui.icon(e.icon).then(im => {
        if (!im) return;
        const g = c.getContext("2d")!;
        const s = Math.min(48 / im.width, 48 / im.height);
        g.drawImage(im.source, (48 - im.width * s) / 2, (48 - im.height * s) / 2, im.width * s, im.height * s);
      });
      tile.append(c, el("span", "arsenal-name", e.label), el("span", "arsenal-stars", "★".repeat(Math.max(0, e.rarity)) || "–"));
      if (this.shop) {
        const has = owned.has(e.name), cost = price(e.rarity);
        tile.append(el("span", "arsenal-price", has ? "✓ owned" : `${cost} cr`));
        if (has) tile.classList.add("equipped");
        tile.onclick = () => { if (!has && this.buy(e.name, cost)) { this.fb("ui_merchant_trade_add"); this.render(); } };
      } else if (locked) {
        // not owned yet: where it comes from (a shop sells up to five stars; crafted gear needs its recipe)
        tile.classList.add("locked");
        const craft = this.craftable?.has(e.name);
        tile.append(el("span", "arsenal-price", craft ? "Craft" : e.rarity >= 1 && e.rarity <= 5 ? `Shop ${price(e.rarity)} cr` : "Not sold"));
        tile.title += craft ? " · made at the forge from a recipe" : " · bought from a Haven shop";
      } else tile.onclick = () => { this.fb("ui_confirm"); this.toggle(e); };
      grid.append(tile);
    }
  }
}

interface Recipe { name: string; output: string; label: string; rarity: number; icon: any;
  materials: [string, number][]; consumes: string | null; level: number; cost: number }

const RECIPE_CACHE = new WeakMap<object, Recipe[]>();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
