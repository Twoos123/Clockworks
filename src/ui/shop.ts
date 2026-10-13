// A shop: the game's vendor window (ui/shop/vendor_withportrait.dat: the shopkeeper's name,
// eight price-tagged sockets a page, sorting and paging) beside its shopping cart
// (ui/shop/shoppingcart.dat). Clicking a socket puts the item in the cart, clicking a cart
// row takes it out, Checkout trades everything in the cart. The vendor's Buyback tab is the
// knight's own sellable gear and materials, which go in the cart as sales. Stock, prices,
// buying and selling are the economy's (src/game/economy.ts).

import type { Economy } from "../game/economy";
import { itemLabel } from "../game/items";
import type { SaveData } from "../game/save";
import type { Component } from "./gui";
import { itemTip } from "./itemlist";
import { buildUi, GuiScreen, row, uiRef, type ScreenHost, type ViewModel } from "./screen";

export interface ShopHost extends ScreenHost {
  save(): SaveData;
  eco(): Promise<Economy>;
  /** The save changed (a trade). */
  changed(): void;
}

/** One thing a shop sells. */
export interface StockItem { name: string; price: number; rarity: number }

interface Line { name: string; price: number; rarity: number; sell: boolean }

const TAG = "ui/shop/slot_tag/interface.dat";
const PER_PAGE = 8;
const fmt = (n: number) => n.toLocaleString("en-US");
const TYPES: Record<string, string> = { sword: "Sword", handgun: "Gun", bomb: "Bomb", shield: "Shield", armor: "Armor", helm: "Helmet",
  trinket: "Trinket", vitapod: "Vitapod", pickup: "Supply", recipe: "Recipe", material: "Material", mineral: "Mineral" };

export class ShopScreen extends GuiScreen {
  private vendor: Component | null = null;
  private cartUi: Component | null = null;
  private eco: Economy | null = null;
  private keeper = "Shop";
  private maxRarity = 2;
  /** The keeper's title line (the shop bundle's, from its description), or "" for ours. */
  private subtitle = "";
  private stock: StockItem[] = [];
  private cart: Line[] = [];
  private page = 0;
  private sort: "price" | "name" = "price";
  /** Showing the knight's own things to sell. */
  private selling = false;
  private tagCache = new Map<string, Promise<Component | null>>();
  /** The item icon each socket button draws. */
  private socketIcons = new Map<Component, any>();
  private vendorTable: Component | null = null;
  private message = "";
  /** The shopkeeper's model and animation for the portrait, or null (a shop with no keeper). */
  private portrait: ViewModel | null = null;

  constructor(ctx: ConstructorParameters<typeof GuiScreen>[0], private readonly shop: ShopHost) {
    super(ctx, shop, "shopCanvas");
  }

  /** Opens a keeper's shop with its stock. */
  async openFor(title: string, stock: StockItem[], maxRarity: number, portrait: ViewModel | null = null, subtitle = "") {
    if (title !== this.keeper) { this.cart = []; this.page = 0; this.selling = false; }
    this.keeper = title;
    this.subtitle = subtitle;
    this.portrait = portrait;
    this.maxRarity = maxRarity;
    this.stock = stock;
    this.message = "";
    this.eco = await this.shop.eco();
    await this.open();
  }

  protected async build(): Promise<Component | null> {
    const [left, right] = await Promise.all([this.ui("ui/shop/vendor_withportrait.dat"), this.ui("ui/shop/shoppingcart.dat")]);
    if (!left || !right) return null;
    this.vendor = left;
    this.cartUi = right;
    this.on(right, "dismiss", () => this.close());
    this.on(left, "handle", () => this.close());
    this.on(left, "sort_buyback", () => { this.selling = !this.selling; this.page = 0; this.click(); void this.refresh(); });
    this.on(left, "sort_price", () => { this.sort = "price"; this.selling = false; this.page = 0; this.click(); void this.refresh(); });
    this.on(left, "sort_name", () => { this.sort = "name"; this.selling = false; this.page = 0; this.click(); void this.refresh(); });
    this.on(left, "prevbag_vendor", () => { this.page = Math.max(0, this.page - 1); this.click(); void this.refresh(); });
    this.on(left, "nextbag_vendor", () => { this.page = Math.min(this.pages() - 1, this.page + 1); this.click(); void this.refresh(); });
    this.on(right, "empty_cart", () => { this.cart = []; this.message = ""; this.host.sound("sound/feedback/ui_merchant_trade_remove.ogg"); void this.refresh(); });
    this.on(right, "confirm_cart", () => this.checkout());
    // buying crowns or energy is the game's store
    for (const tag of ["mini_getcrowns", "mini_getenergy"]) { const c = right.find(tag); if (c) c.visible = false; }
    // the panel handle's caption is drawn rotated by the game; here the handle only closes
    const handle = left.find("handle");
    if (handle) handle.text = "";
    const buyback = left.find("sort_buyback");
    if (buyback) buyback.text = "Sell";
    // the keeper's portrait: its own model in the portrait's RenderableView
    const view = left.find("portrait_vendor");
    if (view) view.view = { ...(view.view ?? {}) };
    this.hooks = {
      view: (c, g, x, y, w, h) => { if (this.portrait) this.host.view?.(c, g, x, y, w, h, this.portrait); },
      tagged: {
        slot_ring: (c, g, x, y, w, h) => {
          // the price tag's socket is the square at its left end
          const im = this.socketIcons.has(c) ? this.icon(this.socketIcons.get(c), h - 8) : null;
          if (im) g.drawImage(im.source as CanvasImageSource, Math.round(x + (h - im.width) / 2), Math.round(y + (h - im.height) / 2), im.width, im.height);
        },
      },
    };
    return row([left, right], 6, "BOTTOM");
  }

  private click() { this.host.sound("sound/feedback/ui_dropdown_select.ogg"); }

  /** What the knight could sell: gear not worn, and each material (one at a time). */
  private sellable(): StockItem[] {
    const eco = this.eco!, save = this.shop.save();
    const gear = save.owned.filter(n => eco.canSell(save, n));
    const mats = Object.keys(save.materials).filter(n => (save.materials[n] ?? 0) > 0 && eco.sellPrice(n) > 0);
    return [...gear, ...mats].map(name => ({ name, price: eco.sellPrice(name), rarity: eco.info(name)?.rarity ?? 0 }));
  }

  private shown(): StockItem[] {
    const list = this.selling ? this.sellable() : [...this.stock];
    if (this.sort === "name") list.sort((a, b) => itemLabel(a.name).localeCompare(itemLabel(b.name)));
    else list.sort((a, b) => a.price - b.price || itemLabel(a.name).localeCompare(itemLabel(b.name)));
    return list;
  }

  private pages() { return Math.max(1, Math.ceil(this.shown().length / PER_PAGE)); }

  /** A price-tagged socket (built once per look). */
  private tag(key: string, args: Record<string, unknown>): Promise<Component | null> {
    const k = key + JSON.stringify(args);
    let p = this.tagCache.get(k);
    if (!p) { p = buildUi(this.ctx, uiRef(TAG, args)); this.tagCache.set(k, p); }
    return p;
  }

  /** Crowns the cart costs (sales count against it). */
  private total() { return this.cart.reduce((n, e) => n + (e.sell ? -e.price : e.price), 0); }

  private checkout() {
    const save = this.shop.save(), eco = this.eco!;
    if (!this.cart.length) return;
    if (save.crowns < this.total()) { this.message = "Not enough crowns for everything in the cart."; this.host.sound("sound/feedback/ui_dismiss.ogg"); void this.refresh(); return; }
    // sales first, so their crowns pay for the purchases
    let sold = 0, bought = 0;
    for (const e of this.cart.filter(x => x.sell)) if (eco.sell(save, e.name) > 0) sold++;
    const failed: string[] = [];
    for (const e of this.cart.filter(x => !x.sell)) { if (eco.buy(save, e.name, e.price)) bought++; else failed.push(itemLabel(e.name)); }
    this.cart = [];
    this.shop.changed();
    this.message = [bought ? `Bought ${bought}.` : "", sold ? `Sold ${sold}.` : "", failed.length ? `Could not take ${failed.join(", ")}.` : ""].filter(Boolean).join(" ");
    this.host.sound("sound/feedback/merchant_transaction.ogg");
    void this.refresh();
  }

  private args(e: StockItem, mode: "Normal" | "Buy" | "Sell", price: string) {
    return { Occupied: "True", "Item Name": itemLabel(e.name), "Item Price": price, Mode: mode, Currency: "Crowns", Sale: false, Locked: "Hidden", "Item Count": "" };
  }

  private tip(e: StockItem, flavor: string) {
    const it = this.eco!.info(e.name);
    return itemTip({ label: itemLabel(e.name), type: TYPES[it?.category ?? ""] ?? "Item", rarity: e.rarity, flavor, item: e.name, kind: it?.category ?? "item", lines: [`${fmt(e.price)} crowns`] });
  }

  protected async refresh() {
    const v = this.vendor, cartUi = this.cartUi, eco = this.eco;
    if (!v || !cartUi || !eco) return;
    const save = this.shop.save(), owned = new Set(save.owned);
    const set = (root: Component, tag: string, text: string) => { const c = root.find(tag); if (c) c.text = text; };
    set(v, "name_vendor", this.keeper);
    set(v, "title_vendor", this.selling ? "Selling" : this.subtitle || `${"★".repeat(Math.max(1, this.maxRarity))} goods`);
    set(v, "vendorlevel", String(this.maxRarity));
    const bar = v.find("expbar");
    if (bar) bar.preferredSize = { width: Math.round(128 * this.maxRarity / 5), height: bar.preferredSize?.height ?? 10 };
    this.page = Math.min(this.page, this.pages() - 1);
    set(v, "currentbag_vendor", `${this.page + 1} / ${this.pages()}`);
    const sb = v.find("sort_buyback"), sp = v.find("sort_price"), sn = v.find("sort_name");
    if (sb) sb.selected = this.selling;
    if (sp) sp.selected = !this.selling && this.sort === "price";
    if (sn) sn.selected = !this.selling && this.sort === "name";
    // the eight sockets of the page
    const items = this.shown().slice(this.page * PER_PAGE, this.page * PER_PAGE + PER_PAGE);
    const learned = (n: string) => { const r = eco.recipeOfItem(n); return !!r && save.recipes.includes(r.name); };
    const sockets = await Promise.all(Array.from({ length: PER_PAGE }, (_, i) => {
      const e = items[i];
      if (!e) return this.tag(`empty${i}`, { Occupied: "False" });
      const has = !this.selling && (owned.has(e.name) || learned(e.name));
      const inCart = this.cart.some(c => c.name === e.name && c.sell === this.selling);
      return this.tag((this.selling ? "sell:" : "") + e.name, this.args(e, inCart ? (this.selling ? "Sell" : "Buy") : "Normal", has ? "Owned" : fmt(e.price)));
    }));
    const table = this.vendorTable ??= parentOf(v, "slot1_vendor");
    if (table) {
      table.children = sockets.map((s, i) => {
        const c = s!, e = items[i], ring = c.find("slot_ring");
        c.constraints = null;
        if (ring) {
          if (e) this.socketIcons.set(ring, eco.info(e.name)?.icon ?? null); else this.socketIcons.delete(ring);
          ring.onAction = () => e && this.toggleCart(e, this.selling);
        }
        if (e) this.tips.set(c, this.tip(e, this.selling ? "Click to put it in the cart to sell." : owned.has(e.name) ? "Already in your arsenal."
          : learned(e.name) ? "You know this recipe." : "Click to put it in the cart."));
        else this.tips.delete(c);
        return c;
      });
    }
    // the cart
    const list = cartUi.find("list_cart");
    if (list) {
      const rows = await Promise.all(this.cart.map((e, i) => this.tag(`cart${i}:${e.sell}:${e.name}`, this.args(e, e.sell ? "Sell" : "Buy", fmt(e.price)))));
      list.children = rows.filter((r): r is Component => !!r).map((r, i) => {
        r.constraints = null;
        const ring = r.find("slot_ring"), e = this.cart[i];
        if (ring) { this.socketIcons.set(ring, eco.info(e.name)?.icon ?? null); ring.onAction = () => this.removeLine(i); }
        this.tips.set(r, this.tip(e, e.sell ? "To sell: click to take it out." : "To buy: click to take it out."));
        return r;
      });
    }
    const totals = cartUi.find("total_cont_cart");
    totals?.children.forEach((row, i) => {
      if (i > 0) { row.visible = false; return; }
      const t = row.find("total_cart");
      if (t) t.text = fmt(this.total());
    });
    const status = cartUi.find("status");
    if (status) status.text = this.message || `You have ${fmt(save.crowns)} crowns.`;
    const checkout = cartUi.find("confirm_cart");
    if (checkout) checkout.enabled = this.cart.length > 0;
  }

  private removeLine(i: number) {
    this.cart.splice(i, 1);
    this.message = "";
    this.host.sound("sound/feedback/ui_merchant_trade_remove.ogg");
    void this.refresh();
  }

  private toggleCart(e: StockItem, sell: boolean) {
    const save = this.shop.save(), eco = this.eco!;
    const i = this.cart.findIndex(c => c.name === e.name && c.sell === sell);
    this.message = "";
    const it = eco.info(e.name);
    // supplies and materials stack: each click adds one more; gear and recipes go in once
    const stacks = sell ? (save.materials[e.name] ?? 0) > 0 : it?.category === "pickup";
    if (i >= 0 && !stacks) { this.removeLine(i); return; }
    if (stacks && sell && this.cart.filter(c => c.name === e.name && c.sell).length >= (save.materials[e.name] ?? 0)) {
      this.message = `You have no more ${itemLabel(e.name)} to sell.`; this.host.sound("sound/feedback/ui_dismiss.ogg");
    } else if (!sell && save.owned.includes(e.name)) {
      this.message = `${itemLabel(e.name)} is already in your arsenal.`; this.host.sound("sound/feedback/ui_dismiss.ogg");
    } else {
      this.cart.push({ name: e.name, price: e.price, rarity: e.rarity, sell });
      this.host.sound("sound/feedback/ui_merchant_trade_add.ogg");
    }
    void this.refresh();
  }
}

function parentOf(root: Component, tag: string): Component | null {
  if (root.children.some(k => k.tag === tag)) return root;
  for (const k of root.children) { const r = parentOf(k, tag); if (r) return r; }
  return null;
}
