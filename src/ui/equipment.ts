// The arsenal: the game's arsenal window (ui/arsenal/interface.dat) listing the gear the
// knight owns, beside the equipment window (ui/status/interface_v2.dat with its paper doll
// panel): sockets for the helmet, armour, shield, two trinkets, three weapons and the
// vitapod, and the knight's preview. Clicking an item in the list equips it (or takes it
// off); clicking a socket empties it. Hovering shows the game's item tooltip with the star
// rating and, for weapons, the heat level.

import type { GameData } from "../game/data";
import { MAX_LEVEL, type Economy } from "../game/economy";
import { CATEGORIES, catalogue, isEquipped, itemLabel, toggleEquip, unequip, type ItemEntry, type Slot } from "../game/items";
import type { Loadout, SaveData } from "../game/save";
import type { Component } from "./gui";
import { itemTip, ItemList, type ListEntry, type ListGroup } from "./itemlist";
import { GuiScreen, row, type ScreenHost } from "./screen";

export interface ArsenalHost extends ScreenHost {
  save(): SaveData;
  data(): GameData;
  /** The economy: levels, heat and unique variants. */
  eco(): Promise<Economy>;
  /** The loadout changed (written to the save; worn from the next floor). */
  equipped(l: Loadout): void;
  /** Personal colour swatches and the chosen one's setter. */
  colors(): { print: number; name: string }[];
  setColor(print: number): void;
}

/** Equipment sockets by tag (panel_equipment_v2.dat's Tag1 to Tag9). */
const SOCKETS: { tag: string; slot: Slot; index: number; label: string }[] = [
  { tag: "slot0", slot: "helmet", index: 0, label: "Helmet" },
  { tag: "slot1", slot: "armor", index: 0, label: "Armor" },
  { tag: "slot2", slot: "shield", index: 0, label: "Shield" },
  { tag: "slot10", slot: "trinket", index: 0, label: "Trinket" },
  { tag: "slot11", slot: "trinket", index: 1, label: "Trinket" },
  { tag: "slot6", slot: "weapon", index: 0, label: "Weapon" },
  { tag: "slot7", slot: "weapon", index: 1, label: "Weapon" },
  { tag: "slot8", slot: "weapon", index: 2, label: "Weapon" },
  { tag: "slot9", slot: "vitapod", index: 0, label: "Vitapod" },
];

const COLOR_ICON = "ui/icon/inventory/categories/icon_recolor.png";

export class ArsenalScreen extends GuiScreen {
  private list: ItemList | null = null;
  private status: Component | null = null;
  private eco: Economy | null = null;

  constructor(ctx: ConstructorParameters<typeof GuiScreen>[0], private readonly arsenal: ArsenalHost) {
    super(ctx, arsenal, "arsenalCanvas");
  }

  protected async build(): Promise<Component | null> {
    this.eco = await this.arsenal.eco();
    const [left, right] = await Promise.all([
      this.ui("ui/arsenal/interface.dat", { Mode: "Contained" }),
      this.ui("ui/status/interface_v2.dat"),
    ]);
    if (!left || !right) return null;
    this.status = right;
    this.list = new ItemList(this.ctx, left, this.tips, f => this.host.sound(f));
    this.list.onPick = e => this.pick(e);
    this.on(left, "dismiss", () => this.close());
    this.on(right, "handle", () => this.close());
    for (const tag of ["button_saveloadout", "characteroptions", "turnleft", "turnright"]) { const c = right.find(tag); if (c) c.visible = false; }
    // the knight preview fills the paper doll's backing (its size is -1 by -1 in the config)
    const preview = right.find("preview_render");
    if (preview) preview.constraints = { ...(preview.constraints ?? {}), fill: true };
    // single player has only the equipment page
    const pane = right.find("tabbed");
    pane?.parts.buttons?.children.forEach((b, i) => { b.visible = i === 0; });
    // the ninth socket holds the vitapod: its backing shows the capsule category icon
    const backing = right.find("slot9") && this.socketBacking(right, "slot9");
    if (backing?.styleRef) {
      const st = await this.ctx.resolveStyle({ ...backing.styleRef, arguments: { $map: "com.threerings.config.ArgumentMap",
        entries: [["File", "ui/icon/inventory/categories/icon_capsule.png"]] } }, backing.local);
      if (st) backing.styles = backing.styles.map(() => st);
    }
    for (const s of SOCKETS) {
      const c = right.find(s.tag);
      if (c) this.clicks.set(c, () => this.emptySocket(s));
    }
    this.hooks = {
      view: (c, g, x, y, w, h) => this.host.view?.(c, g, x, y, w, h),
      tagged: Object.fromEntries(SOCKETS.map(s => [s.tag, (c: Component, g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
        const name = this.socketItem(s);
        const e = name ? this.entry(name) : null;
        const im = e ? this.icon(e.icon, 36) : null;
        if (im) g.drawImage(im.source as CanvasImageSource, Math.round(x + (w - im.width) / 2), Math.round(y + (h - im.height) / 2), im.width, im.height);
      }])),
    };
    return row([left, right], 6);
  }

  /** The category-icon spacer drawn under a socket. */
  private socketBacking(root: Component, tag: string): Component | null {
    const walk = (c: Component): Component | null => {
      if (c.children.some(k => k.tag === tag)) return c.children.find(k => k.tag !== tag) ?? null;
      for (const k of c.children) { const r = walk(k); if (r) return r; }
      return null;
    };
    return walk(root);
  }

  private entry(name: string): ItemEntry | null {
    return catalogue(this.arsenal.data()).find(e => e.name === name) ?? null;
  }

  private socketItem(s: (typeof SOCKETS)[number]): string {
    const l = this.arsenal.save().loadout;
    return s.slot === "weapon" ? l.weapons[s.index] ?? "" : s.slot === "trinket" ? l.trinkets[s.index] ?? "" : l[s.slot] ?? "";
  }

  private emptySocket(s: (typeof SOCKETS)[number]) {
    const save = this.arsenal.save();
    if (!this.socketItem(s)) return;
    const l = unequip(save.loadout, s.slot, s.index);
    if (JSON.stringify(l) === JSON.stringify(save.loadout)) { this.host.sound("sound/feedback/ui_dismiss.ogg"); return; }
    this.host.sound("sound/feedback/ui_dropdown_select.ogg");
    this.arsenal.equipped(l);
    void this.refresh();
  }

  private pick(e: ListEntry) {
    if (e.key.startsWith("color:")) {
      this.arsenal.setColor(Number(e.key.substring(6)));
      this.host.sound("sound/feedback/ui_confirm.ogg");
      void this.refresh();
      return;
    }
    const item = this.entry(e.key);
    if (!item) return;
    this.host.sound("sound/feedback/ui_equip.ogg");
    this.arsenal.equipped(toggleEquip(this.arsenal.save().loadout, item));
    void this.refresh();
  }

  /** The tooltip for an owned item. */
  /** The tooltip for an owned item: its level and heat, what the level gives, its variants. */
  private tip(e: ItemEntry, worn: boolean) {
    const save = this.arsenal.save(), eco = this.eco!, heatable = !!eco.info(e.name)?.heatable;
    const g = save.gear[e.name], lv = eco.level(save, e.name);
    const lines: string[] = [];
    if (heatable) {
      const st = eco.levelStats(e.name, lv, Math.max(1, save.bestDepth));
      if (st.damage) lines.push(`Damage +${Math.round(st.damage * 100)}%`);
      if (st.charge) lines.push(`Charge time -${Math.round(st.charge * 100)}%`);
      if (st.defense) lines.push(`Defense +${Math.round(st.defense)}`);
      if (st.health) lines.push(`Health +${Math.round(st.health / 40 * 10) / 10} pips`);
    }
    for (const v of g?.variants ?? []) lines.push(eco.variantLabel(v));
    const flavor = heatable
      ? `${g?.heat ?? 0} heat absorbed.${lv < MAX_LEVEL ? " Gear levels up with the heat it gathers in the Clockworks." : " Fully heated."}`
      : `${e.category.label.replace(/s$/, "")}.`;
    return itemTip({ label: eco.displayName(e.name, g), type: e.category.label.replace(/s$/, ""), rarity: e.rarity,
      flavor: flavor + (worn ? " Equipped." : " Click to equip."), level: heatable ? lv : undefined,
      progress: eco.heatProgress(save, e.name), equipped: worn, lines });
  }

  protected async refresh() {
    if (!this.list || !this.status) return;
    const save = this.arsenal.save(), owned = new Set(save.owned), l = save.loadout;
    const groups: ListGroup[] = CATEGORIES.map(cat => ({
      id: cat.id, label: cat.label, icon: cat.icon,
      entries: catalogue(this.arsenal.data()).filter(e => e.category === cat && owned.has(e.name)).map(e => {
        const worn = isEquipped(l, e);
        const lv = this.eco?.info(e.name)?.heatable ? this.eco.level(save, e.name) : 0;
        return { key: e.name, label: e.label, variants: save.gear[e.name]?.variants.length ?? 0, rarity: e.rarity, icon: e.icon, look: worn ? "True" : "False", count: lv ? String(lv) : "",
          tip: this.tip(e, worn) } satisfies ListEntry;
      }),
    })).filter(g => g.entries.length);
    const colors = this.arsenal.colors();
    if (colors.length) groups.push({ id: "color", label: "Personal Color", icon: COLOR_ICON, entries: colors.map(c => ({
      key: `color:${c.print}`, label: c.name, rarity: -1, look: c.print === save.color ? "True" : "False",
      icon: { file: COLOR_ICON, colorizations: [{ $class: "com.threerings.opengl.renderer.config.ColorizationConfig$Normal", colorization: c.print }] },
    })) });
    this.list.setNotice("");
    this.list.setInfo("ARSENAL", "Equipment", "Click gear to equip or remove it; click a socket to empty it. Changes are worn from the next floor.", save.crowns);
    await this.list.setGroups(groups);
    // the equipment window: names, sockets and their tooltips
    const st = this.status;
    const set = (tag: string, text: string) => { const c = st.find(tag); if (c) c.text = text; };
    set("label_playername", "Knight");
    set("label_playerrank", save.bestDepth ? `Deepest Depth ${save.bestDepth}` : "Recruit");
    set("label_prestige", `${save.runs} runs`);
    const notice = st.find("notice");
    if (notice) notice.visible = false;
    for (const s of SOCKETS) {
      const c = st.find(s.tag);
      if (!c) continue;
      const name = this.socketItem(s), e = name ? this.entry(name) : null;
      if (e) this.tips.set(c, this.tip(e, true));
      else this.tips.set(c, itemTip({ label: s.label, type: "Empty socket", rarity: 0, flavor: name ? itemLabel(name) : "Pick gear from the arsenal to fill it." }));
    }
  }
}
