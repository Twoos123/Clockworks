// The guild window (the HUD's social button, G): the guild's name and emblem, the hall and its
// furniture, and the guild vault where materials and crowns are kept apart from the knight's
// own bank. The game's guild console (ui/guild/interface_console.dat) is filled in by closed
// code, so this window is HTML in the options menu's style.

import type { SaveData } from "../game/save";
import { EMBLEM_COLORS, EMBLEM_SYMBOLS, guildOf, transfer, type Emblem } from "../game/guild";
import { itemName } from "../game/text";
import { el, injectStyle } from "./panel";

export interface GuildHooks {
  save(): SaveData;
  write(): void;
  sound(file: string): void;
  /** An object URL for an image under rsrc/. */
  image(path: string): Promise<string | null>;
  goToHall(): void;
  openFurniture(): void;
  /** Places the cached hall's own furniture as the guild's (or clears the hall when false). */
  furnish(cached: boolean): void;
  /** In the guild hall now. */
  inHall(): boolean;
  onClose(): void;
}

type Tab = "guild" | "vault";

/**
 * A gate heraldry icon recoloured: the icons mark their colourisable parts in pure hues (red
 * for the field, magenta for the device), which the game tints; here the field takes the
 * emblem colour and the device a pale gold.
 */
export function heraldry(symbol: string, color: string, image: (path: string) => Promise<string | null>, size = 52): HTMLCanvasElement {
  const c = el("canvas");
  c.width = c.height = size;
  void image(`ui/icon/gate/${symbol}.png`).then(u => {
    if (!u) return;
    const im = new Image();
    im.onload = () => {
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(im, 0, 0, size, size);
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
    };
    im.src = u;
  });
  return c;
}

function parseColor(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [47, 111, 222];
}

/** Draws a guild emblem: the heraldry icon on a coloured shield. */
export function emblemElement(e: Emblem, image: (path: string) => Promise<string | null>): HTMLElement {
  const box = el("div", "guild-emblem");
  box.style.background = `radial-gradient(circle at 50% 35%, ${e.color}, color-mix(in srgb, ${e.color} 55%, #000))`;
  box.title = e.symbol;
  box.append(heraldry(e.symbol, e.color, image));
  return box;
}

export class GuildWindow {
  private readonly root: HTMLElement;
  private tab: Tab = "guild";
  private message = "";

  constructor(private readonly hooks: GuildHooks) {
    injectStyle();
    this.root = el("div", "sk-modal");
    this.root.hidden = true;
    this.root.addEventListener("pointerdown", e => { if (e.target === this.root) this.close(); });
    document.body.append(this.root);
  }

  get isOpen() { return !this.root.hidden; }

  open(tab?: Tab) {
    if (tab) this.tab = tab;
    if (!this.isOpen) this.hooks.sound("sound/feedback/ui_open.ogg");
    this.root.hidden = false;
    this.render();
  }

  close() {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.hooks.sound("sound/feedback/ui_dismiss.ogg");
    this.hooks.onClose();
  }

  private render() {
    const save = this.hooks.save(), g = guildOf(save);
    const card = el("div", "sk-card guild-card");
    const head = el("div", "guild-head");
    const close = el("button", "", "Close");
    close.onclick = () => this.close();
    head.append(emblemElement(g.emblem, this.hooks.image), el("h2", "", g.name || "Guild"), close);
    const tabs = el("div", "guild-tabs");
    for (const [t, label] of [["guild", "Guild"], ["vault", "Guild vault"]] as [Tab, string][]) {
      const b = el("button", t === this.tab ? "active" : "", label);
      b.onclick = () => { this.tab = t; this.message = ""; this.hooks.sound("sound/feedback/ui_dropdown_select.ogg"); this.render(); };
      tabs.append(b);
    }
    card.append(head, tabs);
    if (this.tab === "guild") this.guildTab(card); else this.vaultTab(card);
    if (this.message) card.append(el("p", "furni-status", this.message));
    this.root.replaceChildren(card);
  }

  private guildTab(card: HTMLElement) {
    const save = this.hooks.save(), g = guildOf(save);
    const name = document.createElement("input");
    name.type = "text"; name.maxLength = 24; name.value = g.name;
    name.onchange = () => { g.name = name.value.trim().slice(0, 24) || "Guild"; this.hooks.write(); this.message = "Renamed. The hall's sign changes on your next visit."; this.render(); };
    const nameRow = el("label", "guild-row");
    nameRow.append(el("span", "", "Guild name"), name);
    const symbols = el("div", "guild-symbols");
    for (const s of EMBLEM_SYMBOLS) {
      const b = el("button", s === g.emblem.symbol ? "active" : "");
      b.title = s;
      b.append(heraldry(s, g.emblem.color, this.hooks.image, 32));
      b.onclick = () => { g.emblem = { ...g.emblem, symbol: s }; this.hooks.write(); this.hooks.sound("sound/feedback/ui_confirm.ogg"); this.render(); };
      symbols.append(b);
    }
    const colors = el("div", "swatches");
    for (const c of EMBLEM_COLORS) {
      const b = el("button", c === g.emblem.color ? "active" : "");
      b.style.background = c;
      b.title = c;
      b.onclick = () => { g.emblem = { ...g.emblem, color: c }; this.hooks.write(); this.hooks.sound("sound/feedback/ui_confirm.ogg"); this.render(); };
      colors.append(b);
    }
    const hall = el("div", "guild-row");
    const go = el("button", "", this.hooks.inHall() ? "In the guild hall" : "Go to the guild hall");
    go.disabled = this.hooks.inHall();
    go.onclick = () => { this.close(); this.hooks.goToHall(); };
    const furni = el("button", "", "Furniture mode");
    furni.onclick = () => { this.close(); this.hooks.openFurniture(); };
    const copy = el("button", "", "Furnish like the cached hall");
    copy.title = "Places the furniture the cached hall's guild had (it becomes yours)";
    copy.onclick = () => { this.hooks.furnish(true); this.message = "The cached hall's furniture now stands in your hall."; this.render(); };
    const clear = el("button", "danger", "Store all furniture");
    clear.onclick = () => { this.hooks.furnish(false); this.message = "Every placed item went back to storage."; this.render(); };
    hall.append(go, furni, copy, clear);
    card.append(nameRow, el("p", "sk-note", "Emblem"), symbols, colors, el("p", "sk-note", `Hall: ${g.placements.length} items placed, ${Object.values(g.furni).reduce((a, b) => a + b, 0)} in storage.`), hall,
      el("p", "sk-note", "Hall layouts (expansions, rooms, themes) were kept on the game's servers; your hall uses the one hall layout in the scenes cache."));
  }

  private vaultTab(card: HTMLElement) {
    const save = this.hooks.save(), g = guildOf(save);
    const move = (what: string, n: number, toVault: boolean) => {
      if (transfer(save, what, n, toVault)) { this.hooks.write(); this.hooks.sound("sound/feedback/ui_merchant_trade_add.ogg"); this.message = ""; }
      else { this.hooks.sound("sound/feedback/ui_dismiss.ogg"); this.message = "Not enough to move."; }
      this.render();
    };
    // crowns: the guild treasury
    const crowns = el("div", "guild-row");
    const amount = document.createElement("input");
    amount.type = "number"; amount.min = "1"; amount.value = "100"; amount.style.width = "90px";
    const dep = el("button", "", "Deposit"), wd = el("button", "", "Withdraw");
    dep.onclick = () => move("crowns", Number(amount.value), true);
    wd.onclick = () => move("crowns", Number(amount.value), false);
    crowns.append(el("span", "", `Crowns: you ${save.crowns} · treasury ${g.treasury}`), amount, dep, wd);
    const side = (title: string, items: Record<string, number>, toVault: boolean) => {
      const col = el("div");
      col.append(el("h3", "", title));
      const list = el("div", "vault-list");
      const names = Object.keys(items).filter(n => items[n] > 0).sort();
      if (!names.length) list.append(el("p", "sk-note", toVault ? "No materials. Monsters drop them in the Clockworks." : "The vault is empty."));
      for (const n of names) {
        const row = el("div", "vault-row");
        const one = el("button", "", toVault ? "1 →" : "← 1"), all = el("button", "", toVault ? "All →" : "← All");
        one.onclick = () => move(n, 1, toVault);
        all.onclick = () => move(n, items[n], toVault);
        row.append(el("span", "", itemName(n)), el("span", "", String(items[n])), one, all);
        row.title = n;
        list.append(row);
      }
      col.append(list);
      return col;
    };
    const vault = el("div", "vault");
    vault.append(side("Your materials", save.materials, true), side("Guild vault", g.vault, false));
    card.append(crowns, vault, el("p", "sk-note", "Crafting uses the materials you carry; withdraw from the vault first."));
  }
}
