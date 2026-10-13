// A shop: the game's vendor window (ui/shop/vendor_withportrait.dat: the shopkeeper's name,
// eight price-tagged sockets a page, sorting and paging) beside its shopping cart
// (ui/shop/shoppingcart.dat). Clicking a socket puts the item in the cart, clicking a cart
// row takes it out, Checkout buys everything in the cart with crowns. Stock comes from the
// item library by the keeper's trade and the shop's star tier; prices are tuning numbers
// (the real catalogues and prices are server data).

import type { GameData } from "../game/data";
import { buyItem, itemLabel, keeperCategories, price, shopStock, type ItemEntry } from "../game/items";
import type { SaveData } from "../game/save";
import type { Component } from "./gui";
import { itemTip } from "./itemlist";
import { buildUi, GuiScreen, row, uiRef, type ScreenHost } from "./screen";

export interface ShopHost extends ScreenHost {
  save(): SaveData;
  data(): GameData;
  changed(): void;
}

const TAG = "ui/shop/slot_tag/interface.dat";
const PER_PAGE = 8;

export class ShopScreen extends GuiScreen {
  private vendor: Component | null = null;
  private cartUi: Component | null = null;
  private keeper = "Shop";
  private maxRarity = 2;
  private stock: ItemEntry[] = [];
  private cart: ItemEntry[] = [];
  private page = 0;
  private sort: "price" | "name" = "price";
  private tagCache = new Map<string, Promise<Component | null>>();
  /** The item icon each socket button draws. */
  private socketIcons = new Map<Component, any>();
  private message = "";

  constructor(ctx: ConstructorParameters<typeof GuiScreen>[0], private readonly shop: ShopHost) {
    super(ctx, shop, "shopCanvas");
  }

  /** Opens the shop of a keeper (its config name) selling up to `maxRarity` stars. */
  async openFor(keeper: string, maxRarity: number) {
    const name = itemLabel(keeper);
    if (name !== this.keeper || maxRarity !== this.maxRarity) { this.cart = []; this.page = 0; }
    this.keeper = name;
    this.maxRarity = maxRarity;
    this.message = "";
    await this.shop.data().preload("config/item.dat");
    this.stock = shopStock(this.shop.data(), keeperCategories(keeper), maxRarity);
    await this.open();
  }

  protected async build(): Promise<Component | null> {
    const [left, right] = await Promise.all([this.ui("ui/shop/vendor_withportrait.dat"), this.ui("ui/shop/shoppingcart.dat")]);
    if (!left || !right) return null;
    this.vendor = left;
    this.cartUi = right;
    this.on(right, "dismiss", () => this.close());
    this.on(left, "handle", () => this.close());
    const sortBuyback = left.find("sort_buyback");
    if (sortBuyback) sortBuyback.visible = false;
    this.on(left, "sort_price", () => { this.sort = "price"; this.page = 0; this.click(); void this.refresh(); });
    this.on(left, "sort_name", () => { this.sort = "name"; this.page = 0; this.click(); void this.refresh(); });
    this.on(left, "prevbag_vendor", () => { this.page = Math.max(0, this.page - 1); this.click(); void this.refresh(); });
    this.on(left, "nextbag_vendor", () => { this.page = Math.min(this.pages() - 1, this.page + 1); this.click(); void this.refresh(); });
    this.on(right, "empty_cart", () => { this.cart = []; this.host.sound("sound/feedback/ui_merchant_trade_remove.ogg"); void this.refresh(); });
    this.on(right, "confirm_cart", () => this.checkout());
    // the energy, crown purchase and portrait parts belong to the game's servers
    for (const tag of ["mini_getcrowns", "mini_getenergy"]) { const c = right.find(tag); if (c) c.visible = false; }
    this.hooks = {
      tagged: {
        slot_ring: (c, g, x, y, w, h) => {
          // the price tag's socket is the square at its left end
          const im = this.socketIcons.has(c) ? this.icon(this.socketIcons.get(c), h - 8) : null;
          if (im) g.drawImage(im.source as CanvasImageSource, Math.round(x + (h - im.width) / 2), Math.round(y + (h - im.height) / 2), im.width, im.height);
        },
      },
    };
    // the panel handle's caption is drawn rotated by the game; here the handle only closes
    const handle = left.find("handle");
    if (handle) handle.text = "";
    return row([left, right], 6, "BOTTOM");
  }

  private click() { this.host.sound("sound/feedback/ui_dropdown_select.ogg"); }

  private pages() { return Math.max(1, Math.ceil(this.sorted().length / PER_PAGE)); }

  private sorted(): ItemEntry[] {
    const list = [...this.stock];
    if (this.sort === "name") list.sort((a, b) => a.label.localeCompare(b.label));
    else list.sort((a, b) => a.rarity - b.rarity || a.label.localeCompare(b.label));
    return list;
  }

  /** A price-tagged socket (built once per look). */
  private tag(key: string, args: Record<string, unknown>): Promise<Component | null> {
    const k = key + JSON.stringify(args);
    let p = this.tagCache.get(k);
    if (!p) { p = buildUi(this.ctx, uiRef(TAG, args)); this.tagCache.set(k, p); }
    return p;
  }

  private total() { return this.cart.reduce((n, e) => n + price(e.rarity), 0); }

  private checkout() {
    const save = this.shop.save();
    if (!this.cart.length) return;
    if (save.crowns < this.total()) { this.message = "Not enough crowns for everything in the cart."; this.host.sound("sound/feedback/ui_dismiss.ogg"); void this.refresh(); return; }
    const bought = this.cart.filter(e => buyItem(save, e.name, price(e.rarity)));
    this.cart = [];
    this.shop.changed();
    this.message = bought.length ? `Bought ${bought.map(e => e.label).join(", ")}. It is in your arsenal.` : "";
    this.host.sound("sound/feedback/merchant_transaction.ogg");
    void this.refresh();
  }

  protected async refresh() {
    const v = this.vendor, cartUi = this.cartUi;
    if (!v || !cartUi) return;
    const save = this.shop.save(), owned = new Set(save.owned);
    const set = (root: Component, tag: string, text: string) => { const c = root.find(tag); if (c) c.text = text; };
    set(v, "name_vendor", this.keeper);
    set(v, "title_vendor", `${"★".repeat(this.maxRarity)} goods`);
    set(v, "vendorlevel", String(this.maxRarity));
    const bar = v.find("expbar");
    if (bar) bar.preferredSize = { width: Math.round(128 * this.maxRarity / 5), height: bar.preferredSize?.height ?? 10 };
    this.page = Math.min(this.page, this.pages() - 1);
    set(v, "currentbag_vendor", `${this.page + 1} / ${this.pages()}`);
    const sp = v.find("sort_price"), sn = v.find("sort_name");
    if (sp) sp.selected = this.sort === "price";
    if (sn) sn.selected = this.sort === "name";
    // the eight sockets of the page
    const items = this.sorted().slice(this.page * PER_PAGE, this.page * PER_PAGE + PER_PAGE);
    const sockets = await Promise.all(Array.from({ length: PER_PAGE }, (_, i) => {
      const e = items[i];
      if (!e) return this.tag(`empty${i}`, { Occupied: "False" });
      const has = owned.has(e.name), inCart = this.cart.includes(e);
      return this.tag(e.name, { Occupied: "True", "Item Name": e.label, "Item Price": has ? "Owned" : price(e.rarity).toLocaleString("en-US"),
        Mode: inCart ? "Buy" : "Normal", Currency: "Crowns", Sale: false, Locked: "Hidden", "Item Count": "" });
    }));
    const table = v.find("slot1_vendor") ? parentOf(v, "slot1_vendor") : this.vendorTable;
    this.vendorTable = table;
    if (table) {
      table.children = sockets.map((s, i) => {
        const c = s!;
        c.tag = `slot${i + 1}_vendor`;
        const e = items[i], ring = c.find("slot_ring");
        if (ring) {
          if (e) this.socketIcons.set(ring, e.icon); else this.socketIcons.delete(ring);
          ring.onAction = () => e && this.toggleCart(e);
        }
        if (e) this.tips.set(c, itemTip({ label: e.label, type: e.category.label.replace(/s$/, ""), rarity: e.rarity,
          flavor: owned.has(e.name) ? "Already in your arsenal." : this.cart.includes(e) ? "In the cart: click to take it out." : "Click to put it in the cart.",
          lines: [`${price(e.rarity).toLocaleString("en-US")} crowns`] }));
        else this.tips.delete(c);
        return c;
      });
    }
    // the cart
    const list = cartUi.find("list_cart");
    if (list) {
      const rows = await Promise.all(this.cart.map(e => this.tag("cart:" + e.name, { Occupied: "True", "Item Name": e.label,
        "Item Price": price(e.rarity).toLocaleString("en-US"), Mode: "Buy", Currency: "Crowns", Sale: false, Locked: "Hidden", "Item Count": "" })));
      list.children = rows.filter((r): r is Component => !!r).map((r, i) => {
        r.constraints = null;
        const ring = r.find("slot_ring"), e = this.cart[i];
        if (ring) { this.socketIcons.set(ring, e.icon); ring.onAction = () => this.toggleCart(e); }
        return r;
      });
    }
    const totals = cartUi.find("total_cont_cart");
    totals?.children.forEach((row, i) => {
      if (i > 0) { row.visible = false; return; }
      const t = row.find("total_cart");
      if (t) t.text = this.total().toLocaleString("en-US");
    });
    const status = cartUi.find("status");
    if (status) status.text = this.message || `You have ${save.crowns.toLocaleString("en-US")} crowns.`;
    const checkout = cartUi.find("confirm_cart");
    if (checkout) checkout.enabled = this.cart.length > 0;
  }
  private vendorTable: Component | null = null;

  private toggleCart(e: ItemEntry) {
    const save = this.shop.save();
    const i = this.cart.indexOf(e);
    this.message = "";
    if (i >= 0) { this.cart.splice(i, 1); this.host.sound("sound/feedback/ui_merchant_trade_remove.ogg"); }
    else if (save.owned.includes(e.name)) { this.message = `${e.label} is already in your arsenal.`; this.host.sound("sound/feedback/ui_dismiss.ogg"); }
    else { this.cart.push(e); this.host.sound("sound/feedback/ui_merchant_trade_add.ogg"); }
    void this.refresh();
  }
}

function parentOf(root: Component, tag: string): Component | null {
  if (root.children.some(k => k.tag === tag)) return root;
  for (const k of root.children) { const r = parentOf(k, tag); if (r) return r; }
  return null;
}
