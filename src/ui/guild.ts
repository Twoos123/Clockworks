// The guild window (the HUD's social button, G), in the game's guild console
// (rsrc/ui/guild/interface_console.dat): the title bar holds the guild's name, the message
// of the day row renames the guild, the portrait backing shows the emblem, the console's
// cards (ui/cards/parts/interface_card.dat with the art in ui/guild/images/cards) lead to the
// vault, the emblem, the hall and its furniture, and the funds part shows the treasury.
//
//  - The treasury and the member, veteran and officer storages are the client's
//    GuildBagWindow in its trade mode: the bag as an arsenal list
//    (ui/inventory/interface_combined.dat's ui/arsenal/interface.dat) with its pills backed red
//    (storage) or green (treasury), the trade cart (ui/trade/interface_tradecart.dat: five
//    lines, the bag's warning, the treasury's crowns slot, Empty and Confirm) and the knight's
//    own arsenal. A pill pressed in either list goes into the cart (Shift: ten of a stack), a
//    cart line pressed comes out; Confirm moves them. The treasury takes and never gives back.
//  - The emblem is edited in a creation window (ui/create/parts/interface_window-collapsed.dat)
//    with a symbol slider and a colour slider; the gate heraldry (ui/icon/gate/*.png) is
//    tinted in the emblem colour.
//
// The guild's members, ranks, upkeep and charter were kept on the game's servers and have
// nothing behind them in single player; those parts are hidden.

import type { GameData } from "../game/data";
import type { Economy } from "../game/economy";
import type { SaveData } from "../game/save";
import { bagGivesBack, bagStore, commitCart, EMBLEM_COLORS, EMBLEM_SYMBOLS, guildOf, type CartLine, type GuildBag } from "../game/guild";
import { isGear } from "../game/missions";
import { itemLabel } from "../game/items";
import { text } from "../i18n";
import type { Component, GuiContext, GuiImage } from "./gui";
import { ownedGroups } from "./equipment";
import { ItemList, type ListEntry, type ListGroup } from "./itemlist";
import { buildUi, GuiScreen, row, uiRef } from "./screen";

export interface GuildHooks {
  save(): SaveData;
  write(): void;
  sound(file: string): void;
  /** An item's IconConfig. */
  icon(item: string): any;
  data(): GameData;
  eco(): Promise<Economy>;
  goToHall(): void;
  openFurniture(): void;
  /** Places the cached hall's own furniture as the guild's (or clears the hall when false). */
  furnish(cached: boolean): void;
  /** In the guild hall now. */
  inHall(): boolean;
  onClose(): void;
}

type Tab = "guild" | "vault";

const CARD = "ui/cards/parts/interface_card.dat";
const CARDS = "ui/guild/images/cards/";
const COLOR_NAMES = ["Blue", "Red", "Green", "Gold", "Purple", "Orange", "Teal", "Grey", "Navy", "Rust", "White", "Rose"];
const ARSENAL = "ui/arsenal/interface.dat";
const CART = "ui/trade/interface_tradecart.dat";
const PILL = "ui/hud_v2/parts/interface_itempill.dat";
const CAT = "ui/icon/inventory/categories/";
/** The trade cart's lines (trade/a/s: five items at most). */
const CART_MAX = 5;
/** GuildBagWindow's bags: the window title (guild bundle), the pills' colour (GuildBagType.getColorArg). */
const BAGS: Record<GuildBag, { title: string; color: "Green" | "Red" }> = {
  treasury: { title: "t.treasury", color: "Green" }, member: { title: "t.member_storage", color: "Red" },
  veteran: { title: "t.veteran_storage", color: "Red" }, officer: { title: "t.officer_storage", color: "Red" },
};

/** An open bag window: the bag, its list, the cart, the knight's list and the cart's lines. */
interface BagWindow {
  bag: GuildBag;
  ui: Component;
  bagList: ItemList;
  mine: ItemList;
  cart: Component;
  lines: Map<string, CartLine>;
  status: string;
}

/** The emblem colour's name. */
const colorName = (c: string) => COLOR_NAMES[EMBLEM_COLORS.indexOf(c)] ?? c;

function parseColor(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [47, 111, 222];
}

const heraldry = new Map<string, GuiImage | null>();

/**
 * A gate heraldry icon recoloured: the icons mark their colourisable parts in pure hues (red
 * for the field, magenta for the device), which the game tints; here the field takes the
 * emblem colour and the device a pale gold. Null until the icon has loaded.
 */
export function heraldryImage(ctx: GuiContext, symbol: string, color: string, size: number): GuiImage | null {
  const key = `${symbol}|${color}|${size}`;
  if (!heraldry.has(key)) {
    heraldry.set(key, null);
    void ctx.image(`ui/icon/gate/${symbol}.png`).then(im => {
      if (!im) return;
      const c = new OffscreenCanvas(size, size);
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(im.source, 0, 0, size, size);
      const field = parseColor(color), device: [number, number, number] = [245, 226, 160];
      const d = g.getImageData(0, 0, size, size), px = d.data;
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i], gg = px[i + 1], b = px[i + 2];
        const max = Math.max(r, gg, b), min = Math.min(r, gg, b);
        if (max === 0 || (max - min) / max < 0.35) continue;
        // red field (blue low) or magenta device (blue high); brightness is the tint's shade
        const tint = b > r * 0.5 ? device : field, k = max / 255;
        px[i] = tint[0] * k; px[i + 1] = tint[1] * k; px[i + 2] = tint[2] * k;
      }
      g.putImageData(d, 0, 0);
      heraldry.set(key, { source: c, width: size, height: size });
    });
  }
  return heraldry.get(key) ?? null;
}

/** Draws the guild emblem centred in a rectangle: a coloured shield with the heraldry on it. */
export function drawEmblem(ctx: GuiContext, g: CanvasRenderingContext2D, symbol: string, color: string, x: number, y: number, w: number, h: number) {
  const r = Math.min(w, h) / 2 - 3, cx = x + w / 2, cy = y + h / 2;
  const [cr, cg, cb] = parseColor(color);
  const grad = g.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r);
  grad.addColorStop(0, `rgb(${cr},${cg},${cb})`);
  grad.addColorStop(1, `rgb(${cr * 0.5 | 0},${cg * 0.5 | 0},${cb * 0.5 | 0})`);
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = Math.max(2, r / 16);
  g.strokeStyle = "#f3d36b";
  g.stroke();
  const size = Math.round(r * 1.45), im = heraldryImage(ctx, symbol, color, size);
  if (im) {
    g.save();
    g.shadowColor = "rgba(0,0,0,0.6)";
    g.shadowOffsetY = 2;
    g.drawImage(im.source, Math.round(cx - size / 2), Math.round(cy - size / 2), size, size);
    g.restore();
  }
}

interface CardSpec { image: string; text: string; act: () => unknown }

export class GuildWindow extends GuiScreen {
  private message = "";
  private cards: { spec: CardSpec; ui: Component }[] = [];
  private page = 0;
  private emblem: Component | null = null;
  /** The bag window on show (GuildBagWindow), if any. */
  private bagWin: BagWindow | null = null;
  private eco: Economy | null = null;
  private shift = false;

  constructor(ctx: GuiContext, private readonly guild: GuildHooks) {
    super(ctx, { sound: f => guild.sound(f), closed: () => guild.onClose() }, "guildCanvas");
    this.canvas.addEventListener("pointerdown", e => { this.shift = e.shiftKey; }, true);
  }

  async open(tab?: Tab) {
    await super.open();
    if (tab === "vault") void this.showBag("treasury"); else if (tab === "guild") this.overlays = [];
    await this.refresh();
  }

  protected async build(): Promise<Component | null> {
    const ui = await this.ui("ui/guild/interface_console.dat");
    if (!ui) return null;
    this.on(ui, "dismiss", () => this.close());
    // single player has no message of the day: the row renames the guild
    const motd = this.motdField(ui);
    const panel = ui.find("motd_panel");
    const caption = panel?.children.find(c => c.kind === "label" && c.visible && c !== motd);
    if (caption) caption.text = "Guild Name";
    if (motd) {
      motd.maxLength = 24;
      motd.placeholder = "Guild name";
      motd.onAction = (_c, a) => { if (a === "enter") this.rename(); };
    }
    this.on(ui, "motd_ok", () => this.rename());
    // the open-to-all check box: the guild has only you
    const open = ui.find("open");
    if (open) open.visible = false;
    for (const tag of ["upkeep"]) { const c = ui.find(tag); if (c) c.visible = false; }
    // the funds part's caption is a message key the game's bundle fills in
    const caption2 = ui.find("treasury")?.find("container_crowns")?.children[0];
    if (caption2?.kind === "label") caption2.text = "Treasury";
    // the cards
    const specs: CardSpec[] = [
      // guild/client/a's cards where this port has the same thing: the treasury, the three
      // storages (the knight leads its guild, so it holds every rank), design mode
      { image: "treasury.png", text: text("guild", "m.show_treasury", "Show Guild Treasury"), act: () => this.showBag("treasury") },
      { image: "memberstorage.png", text: text("guild", "b.member_storage", "Member Storage"), act: () => this.showBag("member") },
      { image: "veteranstorage.png", text: text("guild", "b.veteran_storage", "Veteran Storage"), act: () => this.showBag("veteran") },
      { image: "officerstorage.png", text: text("guild", "b.officer_storage", "Officer Storage"), act: () => this.showBag("officer") },
      { image: "charter.png", text: "Emblem", act: () => this.showEmblem() },
      { image: "environments.png", text: "Go to Guild Hall", act: () => { if (this.guild.inHall()) return; this.close(); this.guild.goToHall(); } },
      { image: "designmode.png", text: text("guild", "b.console_edit", "Design Mode"), act: () => { this.close(); this.guild.openFurniture(); } },
      { image: "themes.png", text: "Furnish Like Cached Hall", act: () => { this.guild.furnish(true); this.say("The cached hall's furniture now stands in your hall (it is yours)."); } },
      { image: "publish.png", text: "Store All Furniture", act: () => { this.guild.furnish(false); this.say("Every placed item went back to storage."); } },
    ];
    const built = await Promise.all(specs.map(s => this.ui(CARD, { "Card Image": CARDS + s.image, Text: s.text, Empty: false, Status: "Unlocked", Tooltip: "" })));
    const middle = ui.find("middle_container");
    const slots = [0, 1, 2, 3].map(i => ui.find(`ui_card_${i}`));
    built.forEach((c, i) => {
      if (!c) return;
      c.constraints = slots[0]?.constraints ?? { fixed: true };
      // the card's name and art lie over its button: presses go through them to the button
      const lay = (k: Component) => { if (k.tag !== "card") { k.hoverable = false; k.children.forEach(lay); } };
      c.children.forEach(lay);
      const b = c.find("card");
      if (b) b.onAction = () => { this.guild.sound("sound/feedback/ui_confirm.ogg"); void Promise.resolve(specs[i].act()).catch(e => console.error("guild card", e)); void this.refresh(); };
      this.cards.push({ spec: specs[i], ui: c });
    });
    if (middle) {
      this.on(ui, "btn_prev", () => this.turn(-1));
      this.on(ui, "btn_next", () => this.turn(1));
    }
    // the emblem window builds while the console is on show
    this.emblemBuilt ??= this.buildEmblem();
    this.hooks = {
      view: (c, g, x, y, w, h) => {
        if (c.tag !== "container_portrait") return;
        const e = guildOf(this.guild.save()).emblem;
        drawEmblem(this.ctx, g, e.symbol, e.color, x, y + 10, w, h - 20);
      },
      tagged: {
        icon1: (_c, g, x, y, w, h) => { const e = guildOf(this.guild.save()).emblem; drawEmblem(this.ctx, g, e.symbol, e.color, x, y, w, h); },
        icon2: (_c, g, x, y, w, h) => {
          const e = guildOf(this.guild.save()).emblem, r = Math.min(w, h) / 2 - 6;
          g.beginPath();
          g.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
          g.fillStyle = e.color;
          g.fill();
          g.lineWidth = 3;
          g.strokeStyle = "#f3d36b";
          g.stroke();
        },
      },
    };
    return ui;
  }

  /** The message of the day's text field (the tag also names a hidden label). */
  private motdField(ui: Component): Component | null {
    const walk = (c: Component): Component | null => {
      if (c.tag === "motd" && c.kind === "text") return c;
      for (const k of c.children) { const r = walk(k); if (r) return r; }
      return null;
    };
    return walk(ui);
  }

  private rename() {
    const ui = this.root, f = ui && this.motdField(ui);
    if (!f) return;
    const g = guildOf(this.guild.save());
    const name = String(f.text).trim().slice(0, 24) || "Guild";
    if (name === g.name) return;
    g.name = name;
    this.guild.write();
    this.guild.sound("sound/feedback/ui_confirm.ogg");
    this.say("Renamed. The hall's sign changes on your next visit.");
  }

  private say(text: string) {
    this.message = text;
    void this.refresh();
  }

  private turn(d: number) {
    const max = Math.max(0, this.cards.length - 4);
    const p = Math.max(0, Math.min(max, this.page + d));
    if (p === this.page) return;
    this.page = p;
    this.guild.sound("sound/feedback/ui_dropdown_select.ogg");
    void this.refresh();
  }

  // ------------------------------------------------------------ the bag windows

  /**
   * GuildBagWindow.a(..., Mode.TRADE): the bag's list, the trade cart and the knight's arsenal,
   * side by side. Opening a bag replaces the one on show.
   */
  private async showBag(bag: GuildBag) {
    this.eco ??= await this.guild.eco();
    const color = BAGS[bag].color, back = bagGivesBack(bag);
    const [bagUi, cart, mineUi] = await Promise.all([this.ui(ARSENAL, { Mode: "Window" }),
      this.ui(CART, { Direction: back ? "Both" : "Give", "Color, Take": color }), this.ui(ARSENAL, { Mode: "Window" })]);
    if (!bagUi || !cart || !mineUi) return;
    const sound = (f: string) => this.guild.sound(f);
    const bagList = new ItemList(this.ctx, bagUi, this.tips, sound), mine = new ItemList(this.ctx, mineUi, this.tips, sound);
    // G.BW: the treasury sorts naturally or by name; the storages as the arsenal does
    bagList.sorts = bag === "treasury" ? ["natural", "name"] : ["natural", "name", "stars", "level"];
    mine.sorts = ["natural", "name", "stars", "level"];
    bagList.clicks = mine.clicks = this.clicks;
    const w: BagWindow = { bag, ui: row([bagUi, cart, mineUi], 8, "CENTER"), bagList, mine, cart, lines: new Map(), status: "" };
    bagList.onPick = e => { if (back) this.addLine(w, e, false); };
    mine.onPick = e => this.addLine(w, e, true);
    // any of the three dismissed closes the others (GuildBagWindow and trade/a/s dismiss together)
    for (const c of [bagUi, cart, mineUi]) this.on(c, "dismiss", () => this.back());
    const energy = cart.find("slot_energy"), crowns = cart.find("slot_crowns");
    if (energy) energy.visible = false;
    if (crowns) crowns.visible = bag === "treasury";
    const field = cart.find("crowns");
    if (field) { field.text = "0"; field.maxLength = 9; field.onAction = () => this.showLines(w); }
    this.on(cart, "empty_cart", () => { w.lines.clear(); if (field) field.text = "0"; this.guild.sound("sound/feedback/ui_dismiss.ogg"); void this.fillBag(); });
    this.on(cart, "confirm_cart", () => this.confirmCart(w));
    // the bag's warning (GuildBagType.getTradeWarning) until something else is said
    w.status = text("guild", bag === "treasury" ? "m.treasury_warning" : "m.storage_warning", "");
    this.bagWin = w;
    this.overlays = [w.ui];
    this.message = "";
    await this.refresh();
  }

  /** The crowns in the treasury's crowns slot. */
  private cartCrowns(w: BagWindow): number {
    const f = w.cart.find("crowns");
    return w.bag === "treasury" ? Number(String(f?.text ?? "").replace(/[^\d]/g, "")) || 0 : 0;
  }

  /** trade/a/s.a: adds `n` (ten with Shift) of a pill's item to the cart's give or take side. */
  private addLine(w: BagWindow, e: ListEntry, give: boolean) {
    const item = e.key.replace(/^mat:/, ""), gear = !e.key.startsWith("mat:");
    const save = this.guild.save(), g = guildOf(save);
    const have = gear ? 1 : give ? save.materials[item] ?? 0
      : w.bag === "treasury" ? g.vault[item] ?? 0 : bagStore(g, w.bag).materials[item] ?? 0;
    if (give) {
      // GuildBagType.canAdd and getTradeableGroups: worn gear cannot go; the treasury takes materials only
      const l = save.loadout;
      if (gear && [...l.weapons, l.shield, l.armor, l.helmet, ...l.trinkets, l.vitapod].includes(item)) { this.say_(w, text("item", "e.untradeable", "That item is not tradeable.")); return; }
      if (w.bag === "treasury" && gear) return;
      if (!gear && !isMaterial(this.eco, item)) return;
    }
    const key = `${give ? "give" : "take"}:${item}`, line = w.lines.get(key);
    if (!line && w.lines.size >= CART_MAX) { this.say_(w, text("trade", "e.cart_full", "The cart is full.")); return; }
    const count = Math.max(0, Math.min(have, (line?.count ?? 0) + (this.shift ? 10 : 1)));
    if (count === (line?.count ?? 0)) return;
    w.lines.set(key, { item, count, give, gear: gear && isGear(item) });
    this.guild.sound("sound/feedback/ui_merchant_trade_add.ogg");
    void this.fillBag();
  }

  private say_(w: BagWindow, s: string) {
    w.status = s;
    this.guild.sound("sound/feedback/ui_dismiss.ogg");
    void this.fillBag();
  }

  /** The cart's Confirm: the treasury asks first (ConfirmPrompt.DEPOSIT_GUILD_TREASURY), then the lines move. */
  private confirmCart(w: BagWindow) {
    const go = () => {
      if (commitCart(this.guild.save(), w.bag, [...w.lines.values()], this.cartCrowns(w))) {
        this.guild.write();
        this.guild.sound("sound/feedback/ui_merchant_trade_add.ogg");
        w.lines.clear();
        const f = w.cart.find("crowns");
        if (f) f.text = "0";
        w.status = "";
      } else this.say_(w, "Not enough to move.");
      void this.fillBag();
    };
    if (w.bag !== "treasury") { go(); return; }
    void this.prompt(text("guild", "t.treasury", "TREASURY"), text("guild", "m.confirm_deposit_treasury", "Deposit into the guild's treasury?"), go);
  }

  /** The game's confirmation window over the bag window: OK runs `accept`. */
  private async prompt(title: string, body: string, accept: () => void) {
    const o = await buildUi(this.ctx, uiRef("ui/window/confirm_prompt/interface.dat"));
    if (!o) return;
    const set = (tag: string, v: string) => { const c = o.find(tag); if (c) c.text = v; };
    set("title", title);
    set("prompt", body);
    const confirm = o.find("confirm");
    if (confirm) confirm.visible = false;
    const shut = () => { this.overlays = this.overlays.filter(x => x !== o); };
    this.on(o, "cancel", shut);
    this.on(o, "dismiss", shut);
    this.on(o, "accept", () => { shut(); accept(); });
    this.overlays.push(o);
  }

  /** The bag's own pills: the bag's look (red or green), counts less what the cart takes. */
  private bagGroups(w: BagWindow): ListGroup[] {
    const save = this.guild.save(), g = guildOf(save), data = this.guild.data(), eco = this.eco!;
    const look = `False - ${BAGS[w.bag].color}` as const;
    const taking = (key: string) => w.lines.get(`take:${key.replace(/^mat:/, "")}`)?.count ?? 0;
    const restyle = (groups: ListGroup[]) => groups.map(gr => ({ ...gr, entries: gr.entries.map(e => ({ ...e, look, count: countLeft(e, taking(e.key)) })) }));
    const empty = { weapons: [], shield: "", armor: "", helmet: "", trinkets: [], vitapod: "" };
    if (w.bag === "treasury") {
      // G.y: the treasury's groups are guild upgrades, furniture and materials
      const mats = ownedGroups({ ...save, owned: [], gear: {}, materials: g.vault, loadout: empty }, data, eco).filter(gr => gr.id === "material" || gr.id === "mineral");
      const furni: ListEntry[] = Object.entries(g.furni).filter(([, n]) => n > 0).map(([n, c]) => ({
        key: `furni:${n}`, label: itemLabel(n), rarity: eco.info(n)?.rarity ?? 0, icon: this.guild.icon(n), count: c > 1 ? String(c) : "" }));
      return [{ id: "guild_upgrade", label: text("item", "m.guild_upgrade", "Guild Upgrades"), icon: CAT + "icon_guildupgrade.png", entries: [] },
        { id: "furni", label: text("item", "m.furni", "Furnishing"), icon: CAT + "icon_furni.png", entries: furni },
        ...restyle(mats)];
    }
    const store = bagStore(g, w.bag);
    return restyle(ownedGroups({ ...save, owned: Object.keys(store.gear), gear: store.gear, materials: store.materials, loadout: empty }, data, eco));
  }

  /** The knight's arsenal: what it owns, counts less what the cart gives (trade/a/q.e). */
  private mineGroups(w: BagWindow): ListGroup[] {
    const giving = (key: string) => w.lines.get(`give:${key.replace(/^mat:/, "")}`)?.count ?? 0;
    return ownedGroups(this.guild.save(), this.guild.data(), this.eco!).map(gr => ({ ...gr, entries: gr.entries.map(e => ({ ...e, count: countLeft(e, giving(e.key)) })) }));
  }

  /** The cart's lines as item pills (look "False" for the knight's, the bag's colour for the bag's); a press takes one (ten with Shift) out. */
  private async showLines(w: BagWindow) {
    const list = w.cart.find("list_cart");
    const status = w.cart.find("status");
    if (status) status.text = w.status;
    const crowns = this.cartCrowns(w);
    const any = w.lines.size > 0 || crowns > 0;
    const empty = w.cart.find("empty_cart"), confirm = w.cart.find("confirm_cart");
    if (empty) empty.enabled = any;
    if (confirm) confirm.enabled = any;
    if (!list) return;
    const pills = await Promise.all([...w.lines.entries()].map(async ([key, l]) => {
      const it = this.eco?.info(l.item), icon = this.guild.icon(l.item);
      const p = await buildUi(this.ctx, uiRef(PILL, { Name: itemLabel(l.item), Damage: l.give ? "Default" : BAGS[w.bag].color, "Damage (Secondary)": l.give ? "Default" : BAGS[w.bag].color,
        "Rank Visible": (it?.rarity ?? -1) >= 0, "Rank Mode": "Star", Rank: String(Math.max(0, it?.rarity ?? 0)), Variants: "-1", Accessory: false,
        Locked: "Hidden", Equipped: "False", Equippable: "True", Hoverable: true, Icon: icon?.file ?? "ui/icon/inventory/blank.png", Colorization: icon?.colorizations ?? [] }));
      if (!p) return null;
      const count = p.find("itemcount");
      if (count) count.text = String(l.count);
      const sel = p.find("entryselect");
      if (sel) sel.onAction = () => {
        const n = l.count - (this.shift ? 10 : 1);
        if (n > 0) w.lines.set(key, { ...l, count: n }); else w.lines.delete(key);
        this.guild.sound("sound/feedback/ui_dismiss.ogg");
        void this.fillBag();
      };
      p.constraints = null;
      return p;
    }));
    if (this.bagWin === w) list.children = pills.filter((c): c is Component => !!c);
  }

  /** Fills the bag window's three parts. */
  private async fillBag() {
    const w = this.bagWin;
    if (!w || !this.eco) return;
    const save = this.guild.save(), g = guildOf(save);
    w.bagList.setInfo(text("guild", BAGS[w.bag].title, w.bag.toUpperCase()), "", "", w.bag === "treasury" ? g.treasury : null);
    w.mine.setInfo(text("item", "t.arsenal", "ARSENAL"), "", "", save.crowns);
    await Promise.all([w.bagList.setGroups(this.bagGroups(w)), w.mine.setGroups(this.mineGroups(w)), this.showLines(w)]);
  }

  // ------------------------------------------------------------ the emblem

  private emblemBuilt: Promise<void> | null = null;

  private async showEmblem() {
    await (this.emblemBuilt ??= this.buildEmblem());
    if (!this.emblem) return;
    if (!this.overlays.includes(this.emblem)) this.overlays = [this.emblem];
    await this.refresh();
  }

  private async buildEmblem() {
    {
      const win = await this.ui("ui/create/parts/interface_window-collapsed.dat", { Title: "Emblem" });
      if (!win) return;
      this.emblem = win;
      const s3 = win.find("slider3"), i3 = win.find("icon3");
      if (s3) s3.visible = false;
      if (i3) i3.visible = false;
      const next = this.on(win, "nextbutton", () => this.back());
      if (next) next.text = "Done";
      const set = (slider: string, name: string, list: string[], key: "symbol" | "color") => {
        const part = win.find(slider);
        if (!part) return;
        const label = part.find("label_name");
        if (label) label.text = name;
        const pick = (i: number) => {
          const g = guildOf(this.guild.save());
          const v = list[(i + list.length) % list.length];
          if (g.emblem[key] === v) return;
          g.emblem = { ...g.emblem, [key]: v };
          this.guild.write();
          this.guild.sound("sound/feedback/ui_confirm.ogg");
          void this.refresh();
        };
        const at = () => Math.max(0, list.indexOf(guildOf(this.guild.save()).emblem[key]));
        this.on(part, "buttonprev", () => pick(at() - 1));
        this.on(part, "buttonnext", () => pick(at() + 1));
        const s = part.find("slider");
        if (s) s.onAction = (c, a) => { if (a === "change" && c.model) pick(c.model.value); };
      };
      set("slider1", "Symbol", EMBLEM_SYMBOLS, "symbol");
      set("slider2", "Colour", EMBLEM_COLORS, "color");
    }
  }

  /** Closes the bag or emblem window back to the console. */
  private back() {
    this.overlays = [];
    this.bagWin = null;
    this.guild.sound("sound/feedback/ui_dismiss.ogg");
    void this.refresh();
  }

  // ------------------------------------------------------------ filling in

  protected async refresh() {
    const ui = this.root;
    if (!ui) return;
    const save = this.guild.save(), g = guildOf(save);
    const title = ui.find("title");
    if (title) title.text = g.name || "Guild";
    const motd = this.motdField(ui);
    if (motd && !motd.focused) motd.text = g.name;
    const crowns = ui.find("treasury")?.find("crowns");
    if (crowns) crowns.text = g.treasury.toLocaleString("en-US");
    const stored = Object.values(g.furni).reduce((a, b) => a + b, 0);
    const note = ui.find("options_panel")?.children.find(c => c.kind === "label");
    if (note) note.text = this.message || `Hall: ${g.placements.length} items placed, ${stored} in storage.`;
    // the cards on show
    const middle = ui.find("middle_container");
    if (middle && this.cards.length) {
      const prev = ui.find("btn_prev"), next = ui.find("btn_next");
      const shown = this.cards.slice(this.page, this.page + 4).map(c => c.ui);
      middle.children = [prev, ...shown, next].filter((c): c is Component => !!c);
      if (prev) prev.enabled = this.page > 0;
      if (next) next.enabled = this.page + 4 < this.cards.length;
      const hall = this.cards.find(c => c.spec.image === "environments.png");
      const label = hall?.ui.find("name");
      if (label) label.text = this.guild.inHall() ? "In the Guild Hall" : "Go to Guild Hall";
      const b = hall?.ui.find("card");
      if (b) b.enabled = !this.guild.inHall();
    }
    if (this.bagWin) void this.fillBag();
    if (this.emblem) {
      const e = g.emblem;
      for (const [slider, list, v, label] of [["slider1", EMBLEM_SYMBOLS, e.symbol, e.symbol[0].toUpperCase() + e.symbol.slice(1)],
        ["slider2", EMBLEM_COLORS, e.color, colorName(e.color)]] as const) {
        const part = this.emblem.find(slider);
        const s = part?.find("slider"), o = part?.find("label_option");
        s?.model?.setRange(0, Math.max(0, (list as readonly string[]).indexOf(v)), 0, list.length - 1);
        if (o) o.text = label;
      }
    }
  }
}

/** A pill's count with `n` of it in the cart (trade/a/F.e: a single item reads 0 once in the cart). */
function countLeft(e: ListEntry, n: number): string | undefined {
  if (!n) return e.count;
  const c = Number(e.count) || 1, left = c - n;
  return c === 1 && left === 1 ? "" : String(left);
}

/** Materials (the item groups' CRAFT) are what a bag takes besides gear. */
const isMaterial = (eco: Economy | null, item: string) => eco?.info(item)?.category === "material";
