// The guild window (the HUD's social button, G), in the game's guild console
// (rsrc/ui/guild/interface_console.dat): the title bar holds the guild's name, the message
// of the day row renames the guild, the portrait backing shows the emblem, the console's
// cards (ui/cards/parts/interface_card.dat with the art in ui/guild/images/cards) lead to the
// vault, the emblem, the hall and its furniture, and the funds part shows the treasury.
//
//  - The vault is the game's trade window (ui/trade/tradewindow.dat): the guild's materials
//    on the left, the knight's on the right; clicking a socket moves one across (Shift moves
//    them all), the wheel scrolls; crowns go in with Deposit and come out with Withdraw.
//  - The emblem is edited in a creation window (ui/create/parts/interface_window-collapsed.dat)
//    with a symbol slider and a colour slider; the gate heraldry (ui/icon/gate/*.png) is
//    tinted in the emblem colour.
//
// The guild's members, ranks, upkeep and charter were kept on the game's servers and have
// nothing behind them in single player; those parts are hidden.

import type { SaveData } from "../game/save";
import { EMBLEM_COLORS, EMBLEM_SYMBOLS, guildOf, transfer } from "../game/guild";
import { itemLabel } from "../game/items";
import { hitTest, type Component, type GuiContext, type GuiImage } from "./gui";
import { styledButton, styledLabel } from "./floating";
import { itemTip } from "./itemlist";
import { GuiScreen } from "./screen";

export interface GuildHooks {
  save(): SaveData;
  write(): void;
  sound(file: string): void;
  /** A material's IconConfig (for the vault's sockets). */
  icon(item: string): any;
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
const SLOTS = 15;

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
  private vault: Component | null = null;
  private emblem: Component | null = null;
  /** The vault's sockets: side, socket component, the item shown. */
  private sockets: { left: boolean; slot: Component; item: string | null }[] = [];
  private icons_ = new Map<Component, any>();
  private scroll = { left: 0, right: 0 };
  private shift = false;

  constructor(ctx: GuiContext, private readonly guild: GuildHooks) {
    super(ctx, { sound: f => guild.sound(f), closed: () => guild.onClose() }, "guildCanvas");
    // the canvas would take the focus from the name field's hidden input on the press
    this.canvas.addEventListener("pointerdown", e => { this.shift = e.shiftKey; e.preventDefault(); }, true);
    this.canvas.addEventListener("wheel", e => this.wheel(e), { passive: true });
  }

  async open(tab?: Tab) {
    await super.open();
    if (tab === "vault") this.showVault(); else if (tab === "guild") this.overlays = [];
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
      { image: "treasury.png", text: "Guild Vault", act: () => this.showVault() },
      { image: "charter.png", text: "Emblem", act: () => this.showEmblem() },
      { image: "environments.png", text: "Go to Guild Hall", act: () => { if (this.guild.inHall()) return; this.close(); this.guild.goToHall(); } },
      { image: "designmode.png", text: "Furniture Mode", act: () => { this.close(); this.guild.openFurniture(); } },
      { image: "themes.png", text: "Furnish Like Cached Hall", act: () => { this.guild.furnish(true); this.say("The cached hall's furniture now stands in your hall (it is yours)."); } },
      { image: "memberstorage.png", text: "Store All Furniture", act: () => { this.guild.furnish(false); this.say("Every placed item went back to storage."); } },
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
    // the vault and emblem windows build while the console is on show
    this.vaultBuilt ??= this.buildVault();
    this.emblemBuilt ??= this.buildEmblem();
    this.hooks = {
      view: (c, g, x, y, w, h) => {
        if (c.tag !== "container_portrait") return;
        const e = guildOf(this.guild.save()).emblem;
        drawEmblem(this.ctx, g, e.symbol, e.color, x, y + 10, w, h - 20);
      },
      tagged: {
        slot_ring: (c, g, x, y, w, h) => {
          const cfg = this.icons_.get(c);
          const im = cfg ? this.icon(cfg, Math.min(w, h) - 6) : null;
          if (im) g.drawImage(im.source as CanvasImageSource, Math.round(x + (w - im.width) / 2), Math.round(y + (h - im.height) / 2), im.width, im.height);
        },
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

  // ------------------------------------------------------------ the vault

  private async buildVault() {
    {
      const win = await this.ui("ui/trade/tradewindow.dat");
      if (!win) return;
      this.vault = win;
      const box = win.children[0]?.children[0];
      this.on(win, "dismiss", () => this.back());
      const crownsR = win.find("crowns_right"), energyR = win.find("energy_right"), energyL = win.find("energy_left");
      for (const c of [energyR, energyL, win.find("ready_left"), win.find("ready_right")]) if (c) c.visible = false;
      // the right column: the knight's crowns, and under them the amount to move
      if (box && crownsR && energyR) {
        const mine = await styledLabel(this.ctx, "0", "Currency/Crowns", win.local);
        mine.tag = "crowns_mine";
        mine.preferredSize = { width: 120, height: -1 };
        mine.constraints = crownsR.constraints;
        crownsR.constraints = energyR.constraints;
        crownsR.text = "100";
        crownsR.maxLength = 9;
        box.children.push(mine);
        const withdraw = await styledButton(this.ctx, "Withdraw", () => this.moveCrowns(false), win.local, "Default/Button (Yellow)/Button");
        const confirm = win.find("confirm");
        withdraw.preferredSize = confirm?.preferredSize ?? { width: 136, height: 40 };
        withdraw.constraints = { ...(confirm?.constraints ?? {}), x: 14 };
        box.children.push(withdraw);
      }
      const confirm = this.on(win, "confirm", () => this.moveCrowns(true));
      if (confirm) confirm.text = "Deposit";
      for (const [side, left] of [["slots_left", true], ["slots_right", false]] as const) {
        const part = win.find(side);
        for (let i = 1; i <= SLOTS; i++) {
          const slot = part?.find(`slot${i}`);
          if (!slot) continue;
          const s = { left, slot, item: null as string | null };
          this.sockets.push(s);
          this.clicks.set(slot, () => { if (s.item) this.moveItem(s.item, !left, this.shift); });
        }
      }
    }
  }

  private vaultBuilt: Promise<void> | null = null;

  private async showVault() {
    await (this.vaultBuilt ??= this.buildVault());
    if (!this.vault) return;
    this.scroll = { left: 0, right: 0 };
    if (!this.overlays.includes(this.vault)) this.overlays = [this.vault];
    this.message = "";
    await this.refresh();
  }

  private moveItem(item: string, toVault: boolean, all: boolean) {
    const save = this.guild.save(), g = guildOf(save);
    const have = (toVault ? save.materials[item] : g.vault[item]) ?? 0;
    this.move(item, all ? have : 1, toVault);
  }

  private moveCrowns(toVault: boolean) {
    const f = this.vault?.find("crowns_right");
    this.move("crowns", Number(String(f?.text ?? "").replace(/[^\d]/g, "")), toVault);
  }

  private move(what: string, n: number, toVault: boolean) {
    if (transfer(this.guild.save(), what, n, toVault)) {
      this.guild.write();
      this.guild.sound("sound/feedback/ui_merchant_trade_add.ogg");
      this.message = "";
    } else {
      this.guild.sound("sound/feedback/ui_dismiss.ogg");
      this.message = "Not enough to move.";
    }
    void this.refresh();
  }

  /** The wheel over a column of sockets scrolls it by a row. */
  private wheel(e: WheelEvent) {
    const v = this.vault;
    if (!v || this.overlays[this.overlays.length - 1] !== v) return;
    const r = this.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    for (const [tag, key] of [["slots_left", "left"], ["slots_right", "right"]] as const) {
      const part = v.find(tag);
      if (part && hitTest(part, x, y)) {
        const n = this.contents(key === "left").length;
        const max = Math.max(0, Math.ceil((n - SLOTS) / 3) * 3);
        this.scroll[key] = Math.max(0, Math.min(max, this.scroll[key] + Math.sign(e.deltaY) * 3));
        void this.refresh();
      }
    }
  }

  private contents(vault: boolean): [string, number][] {
    const save = this.guild.save(), items = vault ? guildOf(save).vault : save.materials;
    return Object.entries(items).filter(([, n]) => n > 0).sort((a, b) => itemLabel(a[0]).localeCompare(itemLabel(b[0])));
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

  /** Closes the vault or emblem window back to the console. */
  private back() {
    this.overlays = [];
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
    if (this.vault) this.fillVault(save);
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

  private fillVault(save: SaveData) {
    const v = this.vault!, g = guildOf(save);
    const set = (tag: string, text: string) => { const c = v.find(tag); if (c) c.text = text; };
    set("their_name", g.name || "Guild");
    set("my_name", save.knight?.name ?? "You");
    set("crowns_left", g.treasury.toLocaleString("en-US"));
    set("crowns_mine", save.crowns.toLocaleString("en-US"));
    const alert = v.find("alert");
    if (alert) { alert.text = this.message; alert.visible = !!this.message; }
    const lists = { left: this.contents(true), right: this.contents(false) };
    const index = { left: 0, right: 0 };
    for (const s of this.sockets) {
      const key = s.left ? "left" : "right";
      const item = lists[key][this.scroll[key] + index[key]++];
      const ring = s.slot.find("slot_ring"), count = s.slot.find("itemcount");
      s.item = item?.[0] ?? null;
      if (count) count.text = item && item[1] > 1 ? String(item[1]) : "";
      if (ring) { if (item) this.icons_.set(ring, this.guild.icon(item[0])); else this.icons_.delete(ring); }
      if (!item) { this.tips.delete(s.slot); continue; }
      this.tips.set(s.slot, itemTip({ label: itemLabel(item[0]), type: s.left ? "Guild vault" : "Material", rarity: 0,
        flavor: s.left ? "Kept in the guild vault. Crafting uses the materials you carry: withdraw it first." : "A crafting material you carry.",
        lines: [`${item[1]} ${s.left ? "in the vault" : "carried"}`, s.left ? "Click: take one, Shift+click: take all" : "Click: store one, Shift+click: store all"] }));
    }
  }
}
