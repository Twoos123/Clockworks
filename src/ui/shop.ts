// A shop as the client's shop dialog lays it out (shop/client/m on ui/shop/interface.dat):
//
// - The vendor (shop/client/u, an item list on ui/arsenal/interface.dat titled "VENDOR"):
//   the goods by item group, each a price-tagged socket (ui/shop/slot_tag), sorted by price
//   or by name. A click puts one in the cart (ten with shift held).
// - The shopping cart with the keeper's portrait (ui/shop/shoppingcart_withportrait.dat):
//   bought goods in the Buy socket style with their cost, sold items in the Sell style with
//   their worth, a click taking one back out; the total, signed and red when the cart costs
//   crowns ("-1,000") or plain when it earns them ("+250"); the shop bundle's warnings
//   (already learned, cart full, cannot be sold); Empty Cart and Checkout, enabled while the
//   cart holds something.
// - The knight's arsenal beside them (shop/client/a's ArsenalPanel): its gear and materials;
//   a click puts one in the cart to sell, the pill counting down what is left.
//
// Stock, prices, buying and selling are the economy's (src/game/economy.ts).

import type { Economy } from "../game/economy";
import { catalogue, CATEGORIES, isEquipped, itemLabel } from "../game/items";
import { itemStats, pillDamage } from "../game/itemstats";
import type { SaveData } from "../game/save";
import { text } from "../i18n";
import { messageText, restyle, type Component } from "./gui";
import { itemPreview, itemTip, ItemList, type ListEntry, type ListGroup } from "./itemlist";
import { buildUi, GuiScreen, row, uiRef, type ScreenHost, type ViewModel } from "./screen";

export interface ShopHost extends ScreenHost {
  save(): SaveData;
  eco(): Promise<Economy>;
  /** The save changed (a trade). */
  changed(): void;
  data(): import("../game/data").GameData;
}

/** One thing a shop sells. */
export interface StockItem { name: string; price: number; rarity: number }

/** A cart line: goods bought, or the knight's things sold, and how many. */
interface Line { name: string; price: number; rarity: number; sell: boolean; count: number }

const TAG = "ui/shop/slot_tag/interface.dat";
const fmt = (n: number) => n.toLocaleString("en-US");
const shopText = (key: string, fallback: string) => text("shop", key, fallback);
/** ShopDialogInfo's ItemPreparer limits: lines in a cart, and of one good. */
const MAX_LINES = 100, MAX_QUANTITY = 500;
const CAT = "ui/icon/inventory/categories/";
/** Item groups in ItemCodes.Group order: our economy categories, the item bundle's names, icons. */
const GROUPS: { cats: string[]; key: string; icon: string }[] = [
  { cats: ["sword"], key: "m.sword", icon: CAT + "icon_sword.png" },
  { cats: ["handgun"], key: "m.handgun", icon: CAT + "icon_handgun.png" },
  { cats: ["bomb"], key: "m.bomb", icon: CAT + "icon_bomb.png" },
  { cats: ["helm"], key: "m.helm", icon: CAT + "icon_helmet.png" },
  { cats: ["armor"], key: "m.armor", icon: CAT + "icon_armor.png" },
  { cats: ["shield"], key: "m.shield", icon: CAT + "icon_shield.png" },
  { cats: ["trinket"], key: "m.trinket", icon: CAT + "icon_amulet.png" },
  { cats: ["mineral", "deposit"], key: "m.mineral", icon: CAT + "icon_mineral.png" },
  { cats: ["material"], key: "m.material", icon: CAT + "icon_puzzle.png" },
  { cats: ["recipe"], key: "m.recipe", icon: CAT + "icon_recipe.png" },
  { cats: ["vitapod", "pickup", "other"], key: "m.usable", icon: CAT + "icon_core.png" },
];

/**
 * shop/client/m.a(Dungeon): a vitapod goes in the cart one at a time (more is adjusted to
 * one); one already in the cart with as many capsules or more keeps the new one out, a
 * smaller one is taken out for it; and one worn with as many or more keeps it out too.
 * `adjusted` shows m.cart_vitapod_adjusted.
 */
export function vitapodRule(want: number, count: number, inCart: number | null, worn: number | null): { qty: number; removeCart: boolean; adjusted: boolean } {
  let adjusted = want > 1, qty = Math.min(want, 1), removeCart = false;
  if (inCart !== null) {
    adjusted = true;
    if (inCart >= count) qty = 0; else removeCart = true;
  }
  if (qty > 0 && worn !== null && worn >= count) { adjusted = true; qty = 0; }
  return { qty, removeCart, adjusted };
}

export class ShopScreen extends GuiScreen {
  private vendor: ItemList | null = null;
  private arsenal: ItemList | null = null;
  private cartUi: Component | null = null;
  private eco: Economy | null = null;
  private keeper = "Shop";
  /** The keeper's title line (the shop bundle's, from its description). */
  private subtitle = "";
  private stock: StockItem[] = [];
  private cart: Line[] = [];
  private tagCache = new Map<string, Promise<Component | null>>();
  /** The item icon each socket button draws. */
  private socketIcons = new Map<Component, any>();
  private message = "";
  /** The shopkeeper's model and animation for the portrait, or null (a shop with no keeper). */
  private portrait: ViewModel | null = null;
  private shift = false;

  constructor(ctx: ConstructorParameters<typeof GuiScreen>[0], private readonly shop: ShopHost) {
    super(ctx, shop, "shopCanvas");
    // GoodSlot: a click with shift (or control) moves ten
    const key = (e: KeyboardEvent) => { this.shift = e.shiftKey || e.ctrlKey; };
    addEventListener("keydown", key);
    addEventListener("keyup", key);
  }

  /** Opens a keeper's shop with its stock. */
  async openFor(title: string, stock: StockItem[], _maxRarity: number, portrait: ViewModel | null = null, subtitle = "") {
    if (title !== this.keeper) this.cart = [];
    this.keeper = title;
    this.subtitle = subtitle;
    this.portrait = portrait;
    this.stock = stock;
    this.message = "";
    this.eco = await this.shop.eco();
    await this.open();
  }

  protected async build(): Promise<Component | null> {
    const [left, cart, right] = await Promise.all([this.ui("ui/arsenal/interface.dat", { Mode: "Window" }),
      this.ui("ui/shop/shoppingcart_withportrait.dat"), this.ui("ui/arsenal/interface.dat", { Mode: "Window" })]);
    if (!left || !cart || !right) return null;
    this.cartUi = cart;
    const sound = (f: string) => this.host.sound(f);
    const v = this.vendor = new ItemList(this.ctx, left, this.tips, sound);
    v.sorts = ["price", "name"];
    v.sort = "price";
    v.clicks = this.clicks;
    v.menu = (e, t, c) => void this.popupMenu(e, t, c);
    v.onRow = (e, c) => { const ring = c.find("slot_ring"); if (ring) this.socketIcons.set(ring, this.eco?.info(e.key)?.icon ?? null); };
    v.onPick = e => this.add(e.key, false);
    const a = this.arsenal = new ItemList(this.ctx, right, this.tips, sound);
    a.clicks = this.clicks;
    a.sorts = ["natural", "name", "stars", "level"];
    a.menu = (e, t, c) => void this.popupMenu(e, t, c);
    a.onPick = e => this.add(e.key, true);
    for (const root of [left, right]) this.on(root, "dismiss", () => this.close());
    this.on(cart, "dismiss", () => this.close());
    this.on(cart, "empty_cart", () => { this.cart = []; this.message = ""; this.host.sound("sound/feedback/ui_merchant_trade_remove.ogg"); void this.refresh(); });
    this.on(cart, "confirm_cart", () => this.checkout());
    // buying crowns or energy is the game's store
    for (const tag of ["mini_getcrowns", "mini_getenergy"]) { const c = cart.find(tag); if (c) c.visible = false; }
    // the keeper's portrait: its own model in the portrait's RenderableView
    const view = cart.find("portrait_vendor");
    if (view) view.view = { ...(view.view ?? {}) };
    this.hooks = {
      view: (c, g, x, y, w, h) => { if (this.portrait) this.host.view?.(c, g, x, y, w, h, this.portrait); },
      tagged: {
        slot_ring: (c, g, x, y, w, h) => {
          // GoodSlot sets the good's icon on its socket button: the square at the tag's left end
          const im = this.socketIcons.has(c) ? this.icon(this.socketIcons.get(c), h - 8) : null;
          if (im) g.drawImage(im.source as CanvasImageSource, Math.round(x + (h - im.width) / 2), Math.round(y + (h - im.height) / 2), im.width, im.height);
        },
      },
    };
    return row([left, cart, right], 6, "BOTTOM");
  }

  /** A price-tagged socket (built once per look). */
  private tag(key: string, args: Record<string, unknown>): Promise<Component | null> {
    const k = key + JSON.stringify(args);
    let p = this.tagCache.get(k);
    if (!p) { p = buildUi(this.ctx, uiRef(TAG, args)); this.tagCache.set(k, p); }
    return p;
  }

  private slotArgs(name: string, mode: "Normal" | "Buy" | "Sell", price: number, count = 1) {
    return { Occupied: "True", "Item Name": itemLabel(name), "Item Price": fmt(price), Mode: mode, Currency: "Crowns", Sale: false,
      Locked: "Hidden", "Item Count": count > 1 ? String(count) : "" };
  }

  /** The cart's worth: sales add, purchases take away (shop/client/m). */
  private total() { return this.cart.reduce((n, e) => n + (e.sell ? 1 : -1) * e.price * e.count, 0); }

  /** What the knight holds of an item, and what is still free to sell. */
  private held(name: string): number {
    const save = this.shop.save();
    return (save.materials[name] ?? 0) || (save.owned.includes(name) ? 1 : 0);
  }

  private status(key: string, fallback: string) {
    this.message = shopText(key, fallback);
    this.host.sound("sound/feedback/ui_dismiss.ogg");
  }

  /** Puts one (ten with shift) in the cart: a good to buy, or something of the knight's to sell. */
  private add(name: string, sell: boolean) {
    const save = this.shop.save(), eco = this.eco!;
    this.message = "";
    const qty = this.shift ? 10 : 1;
    let line = this.cart.find(c => c.name === name && c.sell === sell);
    if (!line && this.cart.length >= MAX_LINES) { this.status("m.cart_full", "Your cart is full."); void this.refresh(); return; }
    if (sell) {
      // a.f: worn things and worthless ones cannot be sold
      if (!eco.canSell(save, name) && !((save.materials[name] ?? 0) > 0 && eco.sellPrice(name) > 0)) { this.status("m.unsellable", "That item cannot be sold."); void this.refresh(); return; }
      const free = this.held(name) - (line?.count ?? 0);
      if (free <= 0) { void this.refresh(); return; }
      line ??= this.push({ name, price: eco.sellPrice(name), rarity: eco.info(name)?.rarity ?? 0, sell, count: 0 });
      line.count += Math.min(qty, free);
    } else {
      const it = eco.info(name), stock = this.stock.find(s => s.name === name);
      if (!stock) return;
      // m.b: a recipe learned or held is not bought again, and one is enough; gear is one of a kind here
      const r = it?.category === "recipe" ? eco.recipeOfItem(name) : null;
      if (r && save.recipes.includes(r.name)) { this.status("m.cart_recipe_learned", "You have already learned this recipe!"); void this.refresh(); return; }
      if (it?.category === "vitapod") {
        // m.a(Dungeon): one vitapod, and only one better than the cart's and the one worn
        const count = (n: string) => Number(this.shop.data().resolveSync("config/item.dat", { name: n }, "item")?.count ?? 0);
        const other = this.cart.find(c => !c.sell && this.eco!.info(c.name)?.category === "vitapod");
        const v = vitapodRule(qty, count(name), other ? count(other.name) : null, save.loadout.vitapod ? count(save.loadout.vitapod) : null);
        if (v.removeCart && other) this.cart.splice(this.cart.indexOf(other), 1);
        if (v.adjusted) this.status("m.cart_vitapod_adjusted", "You may only equip one best vitapod: cart adjusted.");
        if (v.qty > 0) this.push({ name, price: stock.price, rarity: stock.rarity, sell, count: 1 });
        if (v.qty > 0) this.host.sound("sound/feedback/ui_merchant_trade_add.ogg");
        void this.refresh();
        return;
      }
      const single = !!r || (it?.category !== "pickup" && it?.category !== "material" && it?.category !== "mineral");
      if (single && save.owned.includes(name)) { this.message = `${itemLabel(name)} is already in your arsenal.`; this.host.sound("sound/feedback/ui_dismiss.ogg"); void this.refresh(); return; }
      if (single && line) { if (r) this.status("m.cart_recipe_adjusted", "You will only need one of these recipes!"); void this.refresh(); return; }
      line ??= this.push({ name, price: stock.price, rarity: stock.rarity, sell, count: 0 });
      line.count = Math.min(MAX_QUANTITY, line.count + (single ? 1 : qty));
    }
    this.host.sound("sound/feedback/ui_merchant_trade_add.ogg");
    void this.refresh();
  }

  private push(l: Line) { this.cart.push(l); return l; }

  /** A cart line clicked: one (ten with shift) comes back out. */
  private takeOut(i: number) {
    const l = this.cart[i];
    if (!l) return;
    l.count -= this.shift ? 10 : 1;
    if (l.count <= 0) this.cart.splice(i, 1);
    this.message = "";
    this.host.sound("sound/feedback/ui_merchant_trade_remove.ogg");
    void this.refresh();
  }

  private checkout() {
    const save = this.shop.save(), eco = this.eco!;
    if (!this.cart.length) return;
    if (save.crowns + this.total() < 0) { this.message = "Not enough crowns for everything in the cart."; this.host.sound("sound/feedback/ui_dismiss.ogg"); void this.refresh(); return; }
    // sales first, so their crowns pay for the purchases
    for (const e of this.cart.filter(x => x.sell)) eco.sell(save, e.name, e.count);
    const failed: string[] = [];
    for (const e of this.cart.filter(x => !x.sell)) for (let k = 0; k < e.count; k++) if (!eco.buy(save, e.name, e.price)) { failed.push(itemLabel(e.name)); break; }
    this.cart = [];
    this.shop.changed();
    this.message = failed.length ? `Could not take ${failed.join(", ")}.` : "";
    this.host.sound("sound/feedback/merchant_transaction.ogg");
    void this.refresh();
  }

  private groupOf(name: string) {
    const c = this.eco!.info(name)?.category ?? "other";
    return GROUPS.find(g => g.cats.includes(c)) ?? GROUPS[GROUPS.length - 1];
  }

  private tip(name: string, rarity: number) {
    const it = this.eco!.info(name), cat = CATEGORIES.find(k => k.eco === it?.category);
    return itemTip({ label: itemLabel(name), type: cat?.label.replace(/s$/, "") ?? messageText(this.groupOf(name).key, "item"), rarity, flavor: "",
      item: name, kind: it?.category ?? "item", plain: !it?.heatable, level: it?.heatable ? 1 : undefined,
      stats: itemStats(this.shop.data(), this.eco!, name, 1), model: itemPreview(this.shop.data(), name, this.shop.save().color) });
  }

  protected async refresh() {
    const cartUi = this.cartUi, eco = this.eco, v = this.vendor, a = this.arsenal;
    if (!cartUi || !eco || !v || !a) return;
    const save = this.shop.save(), data = this.shop.data();
    const set = (root: Component, tag: string, t: string) => { const c = root.find(tag); if (c) c.text = t; };
    set(cartUi, "name_vendor", this.keeper);
    set(cartUi, "title_vendor", this.subtitle);
    // the vendor: goods by group; u shows only the groups that have something
    v.setInfo(shopText("t.vendor", "VENDOR"), "", "", null);
    const inCart = (n: string, sell: boolean) => this.cart.find(c => c.name === n && c.sell === sell)?.count ?? 0;
    const groups: ListGroup[] = GROUPS.map(g => ({ id: g.key, label: messageText(g.key, "item"), icon: g.icon, entries: this.stock
      .filter(s => this.groupOf(s.name) === g)
      .map(s => ({ key: s.name, label: itemLabel(s.name), rarity: s.rarity, price: s.price, icon: eco.info(s.name)?.icon ?? null,
        ui: uiRef(TAG, this.slotArgs(s.name, "Normal", s.price)), tip: this.tip(s.name, s.rarity) } satisfies ListEntry)) }));
    await v.setGroups(groups);
    // the knight's arsenal: gear not worn and materials, counting down what the cart takes
    a.setInfo(text("craft", "m.arsenal", "ARSENAL"), "", "", save.crowns);
    const entries = (cats: string[]) => [
      ...save.owned.filter(n => cats.includes(eco.info(n)?.category ?? "")),
      ...Object.keys(save.materials).filter(n => (save.materials[n] ?? 0) > 0 && cats.includes(eco.info(n)?.category ?? "")),
    ];
    const worn = (n: string) => { const e = catalogue(data).find(x => x.name === n); return !!e && isEquipped(save.loadout, e); };
    a.setGroups(GROUPS.slice(0, 9).map(g => ({ id: g.key, label: messageText(g.key, "item"), icon: g.icon, showEmpty: true, entries: entries(g.cats).map(n => {
      const it = eco.info(n), left = this.held(n) - inCart(n, true);
      return { key: n, label: eco.displayName(n, save.gear[n]), rarity: it?.rarity ?? 0, icon: it?.icon ?? null, look: worn(n) ? "True" : "False",
        damage: it?.heatable ? pillDamage(data, eco, n, Math.max(1, eco.level(save, n))) : undefined,
        variants: it?.heatable ? save.gear[n]?.variants.length ?? 0 : -1, levelled: !!it?.heatable, level: eco.level(save, n),
        count: (save.materials[n] ?? 0) > 1 || inCart(n, true) ? String(left) : "", tip: this.tip(n, it?.rarity ?? 0) } satisfies ListEntry;
    }) })));
    // the cart
    const list = cartUi.find("list_cart");
    if (list) {
      const rows = await Promise.all(this.cart.map((e, i) => this.tag(`cart${i}:${e.sell}:${e.name}`, this.slotArgs(e.name, e.sell ? "Sell" : "Buy", e.price * e.count, e.count))));
      list.children = rows.filter((r): r is Component => !!r).map((r, i) => {
        r.constraints = null;
        const ring = r.find("slot_ring"), e = this.cart[i];
        if (ring) { this.socketIcons.set(ring, eco.info(e.name)?.icon ?? null); ring.onAction = () => this.takeOut(i); }
        this.tips.set(r, this.tip(e.name, e.rarity));
        return r;
      });
    }
    // the total: signed, red while the cart costs crowns; the energy row belongs to energy shops
    const totals = cartUi.find("total_cont_cart");
    const total = this.total();
    for (const [i, rowc] of (totals?.children ?? []).entries()) {
      if (i > 0) { rowc.visible = false; continue; }
      const t = rowc.find("total_cart");
      if (!t) continue;
      t.text = (total > 0 ? "+" : "") + fmt(total);
      const style = total < 0 ? "TotalLabel_money_neg" : "TotalLabel_money";
      if (t.styleRef?.name !== style) {
        // the style is shoppingcart.dat's own, the scope around total_row.dat's
        const outer = cartUi.find("list_cart")?.local;
        if (outer?.has(style) && !t.local.has(style)) t.local = new Map([...outer, ...t.local]);
        if (t.local.has(style)) await restyle(this.ctx, t, style).catch(() => undefined);
      }
    }
    const status = cartUi.find("status");
    if (status) status.text = this.message;
    for (const tag of ["confirm_cart", "empty_cart"]) { const b = cartUi.find(tag); if (b) b.enabled = this.cart.length > 0; }
  }
}
