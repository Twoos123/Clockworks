// The arsenal: pick the knight's weapons (up to three), shield, armour and helmet from every
// item in the game's item library, shown with the game's own inventory icons. The game's
// arsenal window is filled in by closed code (scroll lists, search), so this one is HTML.

import type { GameData } from "../game/data";
import { price, type Loadout } from "../game/save";
import type { GuiContext } from "./gui";

type Tab = "weapons" | "shield" | "armor" | "helmet";
const TABS: { id: Tab; label: string; test: RegExp }[] = [
  { id: "weapons", label: "Weapons", test: /^Weapon\/(Sword|Handgun|Bomb)\// },
  { id: "shield", label: "Shields", test: /^Gear\/Shield\// },
  { id: "armor", label: "Armour", test: /^Gear\/Armor\// },
  { id: "helmet", label: "Helmets", test: /^Gear\/Helm\// },
];
const SKIP = /\/Parts\/|\/Dev\/|\(Dev\)|\bTEST\b|\/Test\/|PvP|\(Test\)|Tutorial|Promo/;

interface Entry { name: string; label: string; kind: string; rarity: number; icon: any }

/** What the window is showing: the knight's own gear, or a shop's stock. */
export interface ShopMode { title: string; tabs: Tab[]; maxRarity: number }

export class Arsenal {
  private tab: Tab = "weapons";
  private catalogue = new Map<Tab, Entry[]>();
  private loadout!: Loadout;
  private filter = "";
  private shop: ShopMode | null = null;
  /** Personal colour swatches: print and RGB, and the chosen print. */
  colors: { print: number; name: string; rgb: [number, number, number] }[] = [];
  color = 257;
  onColor: ((print: number) => void) | null = null;

  constructor(private readonly root: HTMLElement, private readonly data: GameData, private readonly gui: GuiContext,
    private readonly onChange: (l: Loadout) => void, private readonly bank: () => { crowns: number; heat: number },
    private readonly owned: () => Set<string>, private readonly buy: (name: string, cost: number) => boolean) {}

  /** Opens the arsenal (owned gear), or a shop when `shop` is given. */
  async open(loadout: Loadout, shop: ShopMode | null = null) {
    this.loadout = { ...loadout, weapons: [...loadout.weapons] };
    this.shop = shop;
    if (shop && !shop.tabs.includes(this.tab)) this.tab = shop.tabs[0];
    await this.data.preload("config/item.dat");
    this.root.hidden = false;
    this.render();
  }

  /** Redraws the window if it is open (after late data such as colour swatches arrives). */
  refresh() { if (this.isOpen) this.render(); }

  /** Called when the window closes. */
  onClose: (() => void) | null = null;

  close() { this.root.hidden = true; this.onClose?.(); }
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
      if (!impl?.model || !impl.icon) continue;
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
    return this.tab === "weapons" ? l.weapons.includes(e.name) : l[this.tab] === e.name;
  }

  private toggle(e: Entry) {
    const l = this.loadout;
    if (this.tab === "weapons") {
      const i = l.weapons.indexOf(e.name);
      if (i >= 0) { if (l.weapons.length > 1) l.weapons.splice(i, 1); }
      else { if (l.weapons.length >= 3) l.weapons.shift(); l.weapons.push(e.name); }
    } else {
      l[this.tab] = l[this.tab] === e.name && this.tab !== "shield" ? "" : e.name;
    }
    this.onChange({ ...l, weapons: [...l.weapons] });
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
    for (const t of TABS.filter(t => !this.shop || this.shop.tabs.includes(t.id))) {
      const b = el("button", t.id === this.tab ? "active" : "", t.label);
      b.onclick = () => { this.tab = t.id; this.render(); };
      tabs.append(b);
    }
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search items";
    search.value = this.filter;
    search.oninput = () => { this.filter = search.value; this.fillGrid(grid); };
    tabs.append(search);
    const summary = el("div", "arsenal-summary", this.summary());
    if (!this.shop && this.colors.length) {
      const row = el("div", "arsenal-colors");
      row.append(el("span", "", "Colour"));
      for (const c of this.colors) {
        const b = el("button", "swatch" + (c.print === this.color ? " active" : ""));
        b.title = c.name;
        b.style.background = `rgb(${c.rgb.join(",")})`;
        b.onclick = () => { this.color = c.print; this.onColor?.(c.print); this.render(); };
        row.append(b);
      }
      card.append(row);
    }
    const grid = el("div", "arsenal-grid");
    card.append(head, tabs, summary, grid);
    r.append(card);
    this.fillGrid(grid);
  }

  private summary(): string {
    if (this.shop) return `Stock up to ${this.shop.maxRarity}★. Bought items go to your arsenal; owned items show a tick.`;
    const l = this.loadout, last = (n: string) => n ? n.split("/").pop() : "default";
    return `Equipped: ${l.weapons.map(last).join(", ")} · ${last(l.shield)} · ${last(l.armor)} · ${last(l.helmet)}. Changes apply on the next floor.`;
  }

  private fillGrid(grid: HTMLElement) {
    grid.replaceChildren();
    const q = this.filter.toLowerCase();
    const owned = this.owned();
    let shown = 0;
    for (const e of this.entries(this.tab)) {
      if (q && !e.label.toLowerCase().includes(q)) continue;
      // the arsenal holds what the knight owns; a shop sells what its tier allows
      if (!this.shop && !owned.has(e.name)) continue;
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
        tile.onclick = () => { if (!has && this.buy(e.name, cost)) this.render(); };
      } else tile.onclick = () => this.toggle(e);
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
