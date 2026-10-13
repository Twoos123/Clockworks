// The arsenal: pick the knight's weapons (up to three), shield, armour and helmet from every
// item in the game's item library, shown with the game's own inventory icons. The game's
// arsenal window is filled in by closed code (scroll lists, search), so this one is HTML.

import type { GameData } from "../game/data";
import { price, type Loadout } from "../game/save";
import type { GuiContext } from "./gui";

export type Tab = "weapons" | "shield" | "armor" | "helmet" | "trinket" | "vitapod" | "recipe" | "pickup" | "craft" | "sell";
const TABS: { id: Tab; label: string; test: RegExp }[] = [
  { id: "weapons", label: "Weapons", test: /^Weapon\/(Sword|Handgun|Bomb)\// },
  { id: "shield", label: "Shields", test: /^Gear\/Shield\// },
  { id: "armor", label: "Armour", test: /^Gear\/Armor\// },
  { id: "helmet", label: "Helmets", test: /^Gear\/Helm\// },
  { id: "trinket", label: "Trinkets", test: /^Gear\/Trinket\// },
  { id: "vitapod", label: "Vitapods", test: /^Gear\/Dungeon\/Vitapod\// },
  { id: "recipe", label: "Recipes", test: /^Recipe\// },
  { id: "pickup", label: "Supplies", test: /^Pickup\/(Capsule|Vial)\// },
  { id: "craft", label: "Craft", test: /^$/ },
  { id: "sell", label: "Sell", test: /^$/ },
];

/** A recipe as the forge shows it (from the economy: src/game/economy.ts). */
export interface CraftEntry { output: string; rarity: number; ok: boolean; lines: string[] }

/** What crafting needs from the game (the economy decides costs and requirements). */
export interface CraftHooks {
  /** Recipes the knight can work toward, with what each needs. */
  list(): CraftEntry[];
  /** Every item some recipe makes. */
  craftable(): Set<string>;
  /** Crafts the item; false if something was missing. */
  craft(output: string): boolean;
}

/** Selling back to a shop. */
export interface SellHooks { list(): { name: string; price: number; label: string }[]; sell(name: string): boolean }
const SKIP = /\/Parts\/|\/Dev\/|\(Dev\)|\bTEST\b|\/Test\/|PvP|\(Test\)|Tutorial|Promo/;

interface Entry { name: string; label: string; kind: string; rarity: number; icon: any }

/** What the window is showing: the knight's own gear, or a shop's stock. */
export interface ShopMode {
  title: string; tabs: Tab[]; maxRarity: number;
  /** The keeper's stock and prices; without it the shop sells every item of its tabs. */
  stock?: { name: string; price: number; rarity?: number }[];
}

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
  /** Set to enable a shop's Sell tab. */
  selling: SellHooks | null = null;
  /** An owned item's name as shown (with its level and unique variants). */
  describe: ((name: string) => string) | null = null;

  constructor(private readonly root: HTMLElement, private readonly data: GameData, private readonly gui: GuiContext,
    private readonly onChange: (l: Loadout) => void, private readonly bank: () => { crowns: number; heat: number },
    private readonly owned: () => Set<string>, private readonly buy: (name: string, cost: number) => boolean) {}

  /** Opens the arsenal (owned gear), or a shop when `shop` is given. */
  async open(loadout: Loadout, shop: ShopMode | null = null, tab?: Tab) {
    this.loadout = { ...loadout, weapons: [...loadout.weapons], trinkets: [...(loadout.trinkets ?? [])] };
    this.shop = shop;
    if (tab) this.tab = tab;
    if (shop && !shop.tabs.includes(this.tab)) this.tab = shop.tabs[0];
    if (!shop && ["sell", "recipe", "pickup"].includes(this.tab)) this.tab = "weapons";
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
      if (!impl?.icon || (!impl.model && tab !== "trinket" && tab !== "recipe" && tab !== "pickup")) continue;
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
    const t = this.tab;
    return t === "weapons" ? l.weapons.includes(e.name) : t === "trinket" ? l.trinkets.includes(e.name)
      : (t === "shield" || t === "armor" || t === "helmet" || t === "vitapod") && l[t] === e.name;
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
    } else if (this.tab === "shield" || this.tab === "armor" || this.tab === "helmet" || this.tab === "vitapod") {
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
    for (const t of TABS.filter(t => this.shop ? this.shop.tabs.includes(t.id) || (t.id === "sell" && !!this.selling)
      : t.id === "craft" ? !!this.crafting : t.id !== "sell" && t.id !== "recipe" && t.id !== "pickup")) {
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

  /** A tile's icon, drawn into a small canvas. */
  private iconCanvas(icon: any): HTMLCanvasElement {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 48;
    if (icon) void this.gui.icon(icon).then(im => {
      if (!im) return;
      const g = cv.getContext("2d")!, s = Math.min(48 / im.width, 48 / im.height);
      g.drawImage(im.source, (48 - im.width * s) / 2, (48 - im.height * s) / 2, im.width * s, im.height * s);
    });
    return cv;
  }

  private itemIcon(name: string): any { return this.data.resolveSync("config/item.dat", { name }, "item")?.icon ?? null; }

  private fillCraft(grid: HTMLElement) {
    const c = this.crafting;
    if (!c) return;
    const q = this.filter.toLowerCase();
    const list = c.list().filter(r => !q || r.output.toLowerCase().includes(q));
    grid.replaceChildren();
    if (!list.length) { grid.append(el("p", "arsenal-summary", "Nothing to craft yet: recipes upgrade gear you own, using materials from the Clockworks.")); return; }
    for (const r of list.slice(0, 200)) {
      const tile = el("button", "arsenal-item craft" + (r.ok ? " equipped" : ""));
      tile.title = r.output;
      tile.append(this.iconCanvas(this.itemIcon(r.output)), el("span", "arsenal-name", r.output.split("/").pop()!),
        el("span", "arsenal-stars", "★".repeat(r.rarity)), el("span", "craft-needs", r.lines.join("\n")));
      tile.onclick = () => { if (r.ok && c.craft(r.output)) { this.fb("ui_merchant_trade_add"); this.render(); } };
      grid.append(tile);
    }
  }

  private fillSell(grid: HTMLElement) {
    const s = this.selling;
    if (!s) return;
    const q = this.filter.toLowerCase();
    const list = s.list().filter(x => !q || x.label.toLowerCase().includes(q));
    if (!list.length) { grid.append(el("p", "arsenal-summary", "Nothing to sell: equipped gear stays with you.")); return; }
    for (const x of list.slice(0, 300)) {
      const tile = el("button", "arsenal-item");
      tile.title = x.name;
      tile.append(this.iconCanvas(this.itemIcon(x.name)), el("span", "arsenal-name", x.label), el("span", "arsenal-price", `sell ${x.price} cr`));
      tile.onclick = () => { if (s.sell(x.name)) { this.fb("ui_merchant_trade_remove"); this.render(); } };
      grid.append(tile);
    }
  }

  private summary(): string {
    if (this.tab === "craft") return "Recipes from the game's recipe library. Crafting needs the recipe (bought from a recipe shop or Basil), its materials and crowns, and the base item at the level the recipe asks.";
    if (this.tab === "sell") return "Sell unequipped gear and materials back for crowns.";
    if (this.shop) return `Stock up to ${this.shop.maxRarity}★. Bought gear goes to your arsenal, recipes to the forge, supplies to your pocket.`;
    const l = this.loadout, last = (n: string) => n ? n.split("/").pop() : "default";
    return `Equipped: ${l.weapons.map(last).join(", ")} · ${last(l.shield)} · ${last(l.armor)} · ${last(l.helmet)}${l.trinkets.length ? " · " + l.trinkets.map(last).join(", ") : ""}. Changes apply on the next floor.`;
  }

  private fillGrid(grid: HTMLElement) {
    grid.replaceChildren();
    if (this.showAll && !this.craftable && this.crafting) this.craftable = this.crafting.craftable();
    if (this.tab === "craft") { this.fillCraft(grid); return; }
    if (this.tab === "sell") { this.fillSell(grid); return; }
    const q = this.filter.toLowerCase();
    const owned = this.owned();
    const stock = this.shop?.stock ? new Map(this.shop.stock.map(s => [s.name, s.price])) : null;
    const stars = new Map((this.shop?.stock ?? []).map(s => [s.name, s.rarity ?? 0]));
    let shown = 0;
    for (const e of this.entries(this.tab)) {
      if (q && !e.label.toLowerCase().includes(q)) continue;
      // the arsenal holds what the knight owns; a shop sells its keeper's stock
      const locked = !this.shop && !owned.has(e.name);
      if (locked && !this.showAll) continue;
      if (this.shop && (stock ? !stock.has(e.name) : e.rarity > this.shop.maxRarity || e.rarity < 1)) continue;
      if (++shown > 400) break;
      const tile = el("button", "arsenal-item" + (this.equipped(e) ? " equipped" : ""));
      const label = !this.shop && this.describe && owned.has(e.name) ? this.describe(e.name) : e.label;
      tile.title = `${label} (${e.rarity}★)`;
      tile.append(this.iconCanvas(e.icon), el("span", "arsenal-name", label), el("span", "arsenal-stars", "★".repeat(Math.max(0, stars.get(e.name) ?? e.rarity)) || "–"));
      if (this.shop) {
        // supplies stack in the pocket; everything else is bought once
        const has = this.tab !== "pickup" && owned.has(e.name), cost = stock?.get(e.name) ?? price(e.rarity);
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


function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
