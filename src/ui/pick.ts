// The knight select window, as the client shows it after logging on to an account that has
// knights (client cB, rsrc/ui/pick/interface.dat over the same Cradle backdrop as the log-on
// screen, with title.ogg still playing):
//  - "SELECT A CHARACTER" over three cards (ui/pick/card.dat), one per knight slot. A card shows
//    the knight's name, the knight itself (a RenderableView of character/pc/model_level.dat in
//    the knight's gear and colour, lit by ui/status/parts/ambient_spotlight.dat), its rank,
//    guild and time played (days:hours:minutes:seconds), and a Delete button.
//  - The knights are drawn greyed (colour state 0.5) until the pointer is over their card,
//    which lights the card's backing (CardBackingHover) and has the knight draw its weapon
//    (client cB.a: the model gains its Weapon and plays draw_weapon into the weapon's ready
//    pose at 0.667 speed; leaving puts the weapon away and the idle back).
//  - Pressing a knight's card plays as that knight; pressing an empty card (its "Create New
//    Knight" banner) starts a new one; Delete asks first (m.confirm_delete).
//  - "◄ Log off" (m.back_logoff) returns to the log-on screen.
//  - The energy meter (ui/energy/interface.dat, client af) at the bottom right: Crystal
//    Energy, at least five digits ("00038"). Energy belongs to each knight here, so it shows the
//    knight under the pointer's, else the first knight's.
// The control-scheme panel is left out.

import { CONFIG_REF } from "../config/params";
import { VIEWER_ENVIRONMENT, type Environment } from "../environment";
import { energyOf, MAX_KNIGHTS, playedText, type SaveData } from "../game/save";
import { loadAnimation } from "../model";
import { buildInterface, hitTest, messageText, restyle, type Component } from "./gui";
import { GlScreen, walk } from "./glscreen";

/** A knight in a slot, as its card shows it. */
export interface KnightCard {
  slot: number;
  save: SaveData;
  name: string;
  rank: string;
  guild: string;
  /** The knight's model arguments (Colorization, Armor, Helmet, Shield, accessories). */
  look: [string, any][];
  /** The weapon raised on hover: its model and ready pose ("ready_sword"), or null. */
  weapon?: { model: any; idle: string } | null;
}

export interface PickActions {
  choose(slot: number): void;
  create(): void;
  remove(slot: number): void;
  back(): void;
}

const DIM: Environment = {
  ...VIEWER_ENVIRONMENT,
  ambient: VIEWER_ENVIRONMENT.ambient.map(v => v * 0.5) as [number, number, number],
  lights: VIEWER_ENVIRONMENT.lights.map(l => ({ ...l, color: l.color.map(v => v * 0.5) as [number, number, number] })),
};

export class PickScreen extends GlScreen {
  actions: PickActions | null = null;
  private cards: (KnightCard | null)[] = [];
  private cardUis: Component[] = [];
  private hovered = -1;
  /** A choice is under way (the client's aKq): the cards take no more presses. */
  private busy = false;

  protected async build(): Promise<Component | null> {
    const ui = await buildInterface(this.ctx, { $class: CONFIG_REF, name: "ui/pick/interface.dat" });
    if (!ui) return null;
    { const c = ui.find("ui_controlscheme"); if (c) c.visible = false; }
    const back = ui.find("back");
    if (back) back.onAction = () => { if (!this.busy) this.actions?.back(); };
    this.cardUis = [];
    for (let i = 0; i < MAX_KNIGHTS; i++) {
      const card = ui.find("card" + i);
      if (!card) continue;
      this.cardUis[i] = card;
      const del = card.find("delete");
      if (del) del.onAction = () => this.askDelete(i);
      walk(card, c => { if (c.tag === "mailnotice") c.visible = false; });
    }
    return ui;
  }

  /** Shows the knights (a card each, the rest empty). */
  async setKnights(cards: KnightCard[]) {
    this.cards = Array.from({ length: MAX_KNIGHTS }, (_, i) => cards[i] ?? null);
    this.busy = false;
    await this.show();
  }

  protected async refresh() {
    const set = (c: Component, tag: string, text: string) => { const t = c.find(tag); if (t) t.text = text; };
    this.cardUis.forEach((card, i) => {
      const k = this.cards[i];
      if (k) {
        set(card, "label", k.name);
        set(card, "rank", k.rank || "---");
        set(card, "guild", k.guild || "---");
        set(card, "played", playedText(k.save.played ?? 0));
      } else {
        set(card, "label", messageText("m.empty", "projectx"));
        set(card, "rank", "---");
        set(card, "guild", "---");
        set(card, "played", "--:--:--:--");
      }
      const del = card.find("delete"), banner = card.find("createbanner");
      if (del) del.visible = !!k;
      if (banner) banner.visible = !k;
      const view = card.find("preview");
      if (view) this.reloadView(view);
    });
    const s = this.root?.find("status");
    if (s) s.text = " ";
    this.showEnergy();
  }

  /** The energy meter: the hovered knight's Crystal Energy, else the first knight's (client af.Dg). */
  private showEnergy() {
    const k = this.cards[this.hovered] ?? this.cards.find(c => !!c) ?? null;
    const n = k ? Math.max(0, Math.floor(energyOf(k.save).crystal)) : 0;
    const digits = Math.max(5, 1 + Math.ceil(Math.log10(n + 1)));
    const label = this.root?.find("crystalenergy");
    if (label) label.text = String(n).padStart(digits, "0");
  }

  protected viewModel(c: Component, vm: any, index: number): any {
    if (index !== 0) return vm?.model ?? null;
    const i = this.cardUis.findIndex(card => card.find("preview") === c);
    const k = this.cards[i];
    if (!k) return null;
    // the card's own knight model, wearing this knight's look; the weapon only while hovered
    const base = vm.model;
    const look: [string, any][] = [...k.look];
    if (i === this.armed && k.weapon) look.push(["Weapon", k.weapon.model]);
    const keys = new Set(look.map(([n]) => n));
    const entries = [...((base.arguments?.entries ?? []) as [string, any][]).filter(([n]) => !keys.has(n) && n !== "Weapon"), ...look];
    return { ...base, arguments: { $map: "com.threerings.config.ArgumentMap", entries } };
  }

  protected viewIdle(c: Component): string | null {
    const i = this.cardUis.findIndex(card => card.find("preview") === c);
    return i === this.armed && this.cards[i]?.weapon ? null : "character/pc/idle.dat";
  }

  /** The card whose knight holds its weapon up (the hovered one). */
  private armed = -1;

  /** cB.a.H: the hovered card's knight draws its weapon; the others put theirs away. */
  private arm(i: number) {
    const was = this.armed;
    this.armed = i;
    for (const j of [was, i]) {
      const view = this.cardUis[j]?.find("preview");
      if (view && this.cards[j]) this.reloadView(view);
    }
    const k = this.cards[i], view = this.cardUis[i]?.find("preview");
    if (!k?.weapon || !view) return;
    // hands closed and the draw, then the weapon's ready pose looping at 0.667 speed
    const ready = `character/pc/${k.weapon.idle}.dat`;
    void this.playAnimation(view, "character/pc/draw_weapon.dat");
    this.pendingReady = { view, ready, card: i };
  }
  private pendingReady: { view: Component; ready: string; card: number } | null = null;

  protected tick(_dt: number) {
    const p = this.pendingReady;
    if (!p) return;
    if (this.armed !== p.card) { this.pendingReady = null; return; }
    const inst = this.viewInstance(p.view);
    if (!inst || !inst.finished) return;
    this.pendingReady = null;
    void loadAnimation(this.loader, p.ready).then(clip => {
      if (clip && this.armed === p.card) this.viewInstance(p.view)?.play(clip, { loop: true, speed: 0.667, blend: 0.2 });
    }).catch(() => undefined);
  }

  protected viewEnv(c: Component): Environment {
    const i = this.cardUis.findIndex(card => card.find("preview") === c);
    // the backdrop (the Cradle) draws as any view does; the knights are lit, the hovered one brighter
    if (i < 0) return super.viewEnv(c);
    return i === this.hovered ? VIEWER_ENVIRONMENT : DIM;
  }

  private cardAt(x: number, y: number): number {
    return this.cardUis.findIndex(card => !!hitTest(card, x, y));
  }

  protected pointerEvent(type: "down" | "up" | "move", x: number, y: number, button: number) {
    if (this.busy) return;
    const i = this.cardAt(x, y);
    if (type === "move" && i !== this.hovered) {
      const prev = this.hovered;
      this.hovered = i;
      for (const j of [prev, i]) {
        const card = this.cardUis[j];
        if (!card) continue;
        const backing = card.find("backing"), banner = card.find("createbanner");
        if (backing) void restyle(this.ctx, backing, j === i ? "CardBackingHover" : "CardBacking");
        if (banner) void restyle(this.ctx, banner, j === i ? "CreateBannerHover" : "CreateBanner");
      }
      this.el.style.cursor = i >= 0 ? "pointer" : "";
      this.arm(i);
      this.showEnergy();
    }
    if (type !== "down" || button !== 0 || i < 0) return;
    // the delete button answers for itself
    const del = this.cardUis[i].find("delete");
    if (del?.visible && del.screen && x >= del.screen.x && x < del.screen.x + del.screen.width && y >= del.screen.y && y < del.screen.y + del.screen.height) return;
    const k = this.cards[i];
    this.busy = true;
    const s = this.root?.find("status");
    if (k) {
      // (the client's m.choosing reads "Entering Ready Room..."; the knight goes to Haven here)
      if (s) s.text = "Entering Haven...";
      this.actions?.choose(k.slot);
    } else {
      if (s) s.text = messageText("m.creating", "projectx");
      this.actions?.create();
    }
  }

  private askDelete(i: number) {
    const k = this.cards[i];
    if (!k || this.busy) return;
    // (the client has the name typed in to confirm, m.confirm_delete; here the prompt asks)
    void this.prompt(messageText("m.delete", "projectx"), `Delete ${k.name}? Everything this knight has (arsenal, crowns, missions) goes with it. This cannot be undone.`,
      messageText("m.delete", "projectx"), () => this.actions?.remove(k.slot));
  }

  /** The cards take presses again (after a choice that did not go ahead). */
  ready() { this.busy = false; }
}
