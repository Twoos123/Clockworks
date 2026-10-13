// The game's arsenal window (rsrc/ui/arsenal/interface.dat) as a list of items: category
// headers (ui/recipes/parts/pill_recipe/interface_header.dat) that fold open and closed, item
// pills (pill_recipe/interface.dat) with the item's icon, name and star rating, a search
// field, the infobox and the crowns line. The arsenal, the forge and the shops fill it.

import type { Component, GuiContext } from "./gui";
import { buildUi, uiRef, type TipSpec } from "./screen";
import { itemFlavor, itemType } from "../game/text";

export interface ListEntry {
  /** Unique within the list (an item config name). */
  key: string;
  label: string;
  /** -1 hides the stars. */
  rarity: number;
  /** The item's IconConfig. */
  icon: any;
  /** The pill's backing: worn (gold), red (cannot), green (ready). */
  look?: "False" | "True" | "False - Red" | "False - Green";
  /** Unique variants (0 to 3 pips). */
  variants?: number;
  /** A count drawn over the icon. */
  count?: string;
  /** The tooltip shown while the pill is hovered. */
  tip?: TipSpec;
}

export interface ListGroup { id: string; label: string; icon: string; entries: ListEntry[] }

const PILL = "ui/recipes/parts/pill_recipe/interface.dat";
const HEADER = "ui/recipes/parts/pill_recipe/interface_header.dat";

export class ItemList {
  /** Folded categories. */
  readonly collapsed = new Set<string>();
  filter = "";
  /** The entry shown selected. */
  selected: string | null = null;
  onPick: ((e: ListEntry) => void) | null = null;
  private list: Component | null;
  private groups: ListGroup[] = [];
  private cache = new Map<string, Promise<Component | null>>();
  private generation = 0;

  constructor(private readonly ctx: GuiContext, readonly root: Component, private readonly tips: Map<Component, TipSpec>,
    private readonly sound: (file: string) => void) {
    this.list = root.find("recipe_list");
    if (this.list) this.list.children = [];
    const field = root.find("searchfield");
    if (field) field.onAction = (c, a) => { if (a === "change" || a === "enter") { this.filter = String(c.text); void this.fill(); } };
    const clear = root.find("clearbutton");
    if (clear) clear.onAction = () => { this.filter = ""; if (field) field.text = ""; this.sound("sound/feedback/ui_dropdown_select.ogg"); void this.fill(); };
    // the collapse toggle beside the search field folds or opens every category
    const all = root.find("searchbutton");
    if (all) all.onAction = c => {
      if (c.selected) for (const g of this.groups) this.collapsed.add(g.id); else this.collapsed.clear();
      void this.fill();
    };
    for (const tag of ["energywidget", "preview", "pvp_tier"]) { const c = root.find(tag); if (c) c.visible = false; }
  }

  /** Sets the window title, the infobox and the crowns line. */
  setInfo(title: string, heading: string, text: string, crowns: number | null) {
    const t = this.root.find("title");
    if (t) t.text = title;
    const box = this.root.find("infobox");
    if (box) box.visible = !!(heading || text);
    const h = this.root.find("text_header"), b = this.root.find("text_contents");
    if (h) h.text = heading;
    if (b) b.text = text;
    const cr = this.root.find("crown_container"), n = this.root.find("crowns");
    if (cr) cr.visible = crowns !== null;
    if (n && crowns !== null) n.text = crowns.toLocaleString("en-US");
  }

  /** A notice under the list (the alert line), or none. */
  setNotice(text: string) {
    const n = this.root.find("notice");
    if (!n) return;
    n.visible = !!text;
    n.text = text;
  }

  /** Replaces the list's contents. */
  async setGroups(groups: ListGroup[]) {
    this.groups = groups;
    await this.fill();
  }

  private pill(e: ListEntry): Promise<Component | null> {
    const args: Record<string, unknown> = {
      Name: e.label, Rarity: String(Math.max(-1, Math.min(5, e.rarity))), Equipped: e.look ?? "False", Hoverable: true,
      Icon: e.icon?.file ?? "ui/icon/inventory/blank.png", Colorization: e.icon?.colorizations ?? [], Variants: String(Math.min(3, e.variants ?? 0)), Accessory: false,
    };
    const key = e.key + "|" + JSON.stringify(args, (k, v) => (k === "$outer" ? undefined : v));
    let p = this.cache.get(key);
    if (!p) { p = buildUi(this.ctx, uiRef(PILL, args)); this.cache.set(key, p); }
    return p;
  }

  private header(g: ListGroup, count: number, open: boolean): Promise<Component | null> {
    const args = { Name: `${g.label} (${count})`, Icon: g.icon, Selected: open, Enabled: true };
    const key = "h" + JSON.stringify(args);
    let p = this.cache.get(key);
    if (!p) { p = buildUi(this.ctx, uiRef(HEADER, args)); this.cache.set(key, p); }
    return p;
  }

  /** Rebuilds the visible rows from the groups, the search filter and the folds. */
  async fill() {
    if (!this.list) return;
    const gen = ++this.generation;
    const q = this.filter.trim().toLowerCase();
    const rows: Component[] = [];
    for (const g of this.groups) {
      const entries = q ? g.entries.filter(e => e.label.toLowerCase().includes(q)) : g.entries;
      if (!entries.length && q) continue;
      const open = !this.collapsed.has(g.id) || !!q;
      const h = await this.header(g, entries.length, open);
      if (gen !== this.generation) return;
      if (h) {
        const b = h.find("categoryname");
        if (b) { b.selected = open; b.onAction = () => this.toggle(g.id); }
        rows.push(h);
      }
      if (!open) continue;
      const pills = await Promise.all(entries.map(e => this.pill(e)));
      if (gen !== this.generation) return;
      pills.forEach((p, i) => {
        if (!p) return;
        const e = entries[i];
        const sel = p.find("entryselect");
        if (sel) { sel.selected = this.selected === e.key; sel.onAction = () => this.pick(e); }
        const count = p.find("itemcount");
        if (count) count.text = e.count ?? "";
        if (e.tip) this.tips.set(p, e.tip); else this.tips.delete(p);
        rows.push(p);
      });
    }
    for (const r of rows) r.constraints = null;
    this.list.children = rows;
  }

  private toggle(id: string) {
    if (this.collapsed.has(id)) this.collapsed.delete(id); else this.collapsed.add(id);
    this.sound("sound/feedback/ui_dropdown_select.ogg");
    void this.fill();
  }

  private pick(e: ListEntry) {
    this.selected = e.key;
    this.onPick?.(e);
  }
}

const TIP = "ui/window/tooltip_level.dat";

/**
 * An item tooltip (ui/window/tooltip_level.dat): name, type, star rating, a description and,
 * for weapons, the heat level and the heat bar toward the next level. With the item's config
 * name, the description is the game's own flavor text; with its kind, the type is the game's
 * word for it (our own text stands in for either when the bundles lack it).
 */
export function itemTip(o: { label: string; type: string; rarity: number; flavor: string; level?: number; progress?: number; equipped?: boolean;
  lines?: string[]; item?: string; kind?: string }): TipSpec {
  const levelled = o.level !== undefined;
  const flavor = (o.item && itemFlavor(o.item)) || o.flavor, type = o.kind ? itemType(o.kind, o.type) : o.type;
  const look = (o.equipped ? "True" : "False") + (levelled ? "" : " No Level");
  return { lines: o.lines, ref: uiRef(TIP, {
    Name: o.label.toUpperCase(), Type: type.toUpperCase(), Flavor: flavor, Rarity: String(Math.max(0, Math.min(5, o.rarity))),
    Equipped: look, Level: String(o.level ?? 0).padStart(2, "0"), Heat: Math.round(120 * (o.progress ?? 0)),
    "Max Level": (o.level ?? 0) >= 10 ? "True" : "False",
  }) };
}
