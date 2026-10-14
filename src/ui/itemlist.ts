// The game's arsenal window (rsrc/ui/arsenal/interface.dat) as a list of items, laid out as
// the client's item list (client/d, item/client/j) does: a sort header
// (ui/social/parts/interface_header.dat, "Sort (Natural)"), category headers
// (ui/recipes/parts/pill_recipe/interface_header.dat: "Sword (3)", pressed while folded,
// disabled while empty) with a blank row after an open category's pills, item pills
// (ui/hud_v2/parts/interface_itempill.dat: icon, name, the backing coloured by the item's
// damage types, the star rank, variant pips, a stack count), a search field, the
// collapse-all toggle, the infobox and the crowns line. The arsenal, the forge and the shops
// fill it.

import { message, text as bundleText } from "../i18n";
import { messageText, type Component, type GuiContext } from "./gui";
import { styledLabel } from "./floating";
import { buildUi, uiRef, type TipSpec } from "./screen";
import { itemFlavor, itemType } from "../game/text";
import type { ItemStats } from "../game/itemstats";

export interface ListEntry {
  /** Unique within the list (an item config name). */
  key: string;
  label: string;
  /** -1 hides the stars. */
  rarity: number;
  /** The item's IconConfig. */
  icon: any;
  /** Worn (gold backing), or the pill's red (cannot) and green (ready) backings. */
  look?: "False" | "True" | "False - Red" | "False - Green";
  /** The damage types colouring the backing (pillDamage); "Default" twice for none. */
  damage?: [string, string];
  /** Unique variants (0 to 3 pips); -1 or unset hides the pips (items that cannot hold variants). */
  variants?: number;
  /** A levelled item (its lock state shows); others hide the lock. */
  levelled?: boolean;
  /** The price, for the vendor's price order. */
  price?: number;
  /** The item's level, for sorting. */
  level?: number;
  /** A count drawn over the icon (a stack of more than one). */
  count?: string;
  /** The tooltip shown while the pill is hovered. */
  tip?: TipSpec;
  /** Another pill interface in place of the item pill (a saved loadout's), with an entryselect button. */
  ui?: any;
}

export interface ListGroup {
  id: string; label: string; icon: string; entries: ListEntry[];
  /** Pills shown while the search field is empty (a long group is narrowed by searching). */
  limit?: number;
  /** Shown (disabled) with nothing in it, as the client's weapon, gear and material groups are. */
  showEmpty?: boolean;
}

/** The client's sort choices (the arsenal's; the recipe list leaves out level). */
export type SortKey = "natural" | "name" | "stars" | "level" | "price";

const PILL = "ui/hud_v2/parts/interface_itempill.dat";
const HEADER = "ui/recipes/parts/pill_recipe/interface_header.dat";
const BLANK = "ui/recipes/parts/pill_recipe/interface_blank.dat";
const SORT = "ui/social/parts/interface_header.dat";

/** The client's orders: natural is stars, then level, highest first; then the name; then more variants first. */
function compare(sort: SortKey, a: ListEntry, b: ListEntry): number {
  const natural = sort === "natural";
  let r = 0;
  if (sort === "price") r = (a.price ?? 0) - (b.price ?? 0);
  if (natural || sort === "stars") r = (b.rarity ?? 0) - (a.rarity ?? 0);
  if (!r && (natural || sort === "level")) r = (b.level ?? 0) - (a.level ?? 0);
  if (!r) r = a.label.localeCompare(b.label);
  if (!r) r = (b.variants ?? 0) - (a.variants ?? 0);
  return r;
}

export class ItemList {
  /** Folded categories. */
  readonly collapsed = new Set<string>();
  filter = "";
  /** The entry shown selected (lists whose pills keep a selection: the recipe list). */
  selected: string | null = null;
  /** Whether a picked pill stays pressed (the client's recipe list); the arsenal's do not. */
  showSelection = false;
  /** The sort choices offered by the sort header (none: no header, entries in the given order). */
  sorts: SortKey[] = [];
  sort: SortKey = "natural";
  /** The message bundle of the sort names and the empty list's text (the client's list bundle). */
  bundle = "item";
  onPick: ((e: ListEntry) => void) | null = null;
  /** Called with each pill as it is shown (a window drawing icons of its own). */
  onRow: ((e: ListEntry, c: Component) => void) | null = null;
  private list: Component | null;
  private groups: ListGroup[] = [];
  private cache = new Map<string, Promise<Component | null>>();
  private generation = 0;

  constructor(private readonly ctx: GuiContext, readonly root: Component, private readonly tips: Map<Component, TipSpec>,
    private readonly sound: (file: string) => void) {
    this.list = root.find("recipe_list");
    if (this.list) this.list.children = [];
    const field = root.find("searchfield");
    // the config's "Enter item name..." is the field's text, which the game's code clears; here
    // it shows as the placeholder while the field is empty, so it is never searched for
    if (field && field.text && !field.placeholder) { field.placeholder = field.text; field.text = ""; }
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
    // the notice is hidden until a list has something to say (the recipe list's new recipes)
    this.setNotice("");
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

  /** A notice under the list (the alert line), or none; a press on it calls `onClick`. */
  setNotice(text: string, onClick?: () => void) {
    const n = this.root.find("notice");
    if (!n) return;
    n.visible = !!text;
    n.text = text;
    n.onAction = onClick ? () => onClick() : null;
  }

  /** Replaces the list's contents. */
  async setGroups(groups: ListGroup[]) {
    this.groups = groups;
    await this.fill();
  }

  private build(key: string, ref: any): Promise<Component | null> {
    let p = this.cache.get(key);
    if (!p) { p = buildUi(this.ctx, ref); this.cache.set(key, p); }
    return p;
  }

  private pill(e: ListEntry): Promise<Component | null> {
    if (e.ui) {
      const key = e.key + "|" + JSON.stringify(e.ui, (k, v) => (k === "$outer" ? undefined : v));
      let p = this.cache.get(key);
      if (!p) {
        p = buildUi(this.ctx, e.ui).then(c => {
          // a loadout pill's PvE and PvP tier meters: single player has no tiers
          const walk = (k: Component) => { if (k.children.some(x => x.tag === "label_pve")) k.visible = false; k.children.forEach(walk); };
          if (c) walk(c);
          return c;
        });
        this.cache.set(key, p);
      }
      return p;
    }
    // item/client/j: a red or green backing replaces the damage colours
    const look = e.look ?? "False";
    const damage = look === "False - Green" ? ["Green", "Green"] : look === "False - Red" ? ["Red", "Red"] : e.damage ?? ["Default", "Default"];
    const args: Record<string, unknown> = {
      Name: e.label, Damage: damage[0], "Damage (Secondary)": damage[1],
      "Rank Visible": e.rarity >= 0, "Rank Mode": "Star", Rank: String(Math.max(0, e.rarity)),
      Variants: String(Math.min(3, e.variants ?? -1)), Accessory: false,
      Locked: e.levelled ? "False" : "Hidden", Equipped: look === "True" ? "True" : "False", Equippable: "True", Hoverable: true,
      Icon: e.icon?.file ?? "ui/icon/inventory/blank.png", Colorization: e.icon?.colorizations ?? [],
    };
    return this.build(e.key + "|" + JSON.stringify(args, (k, v) => (k === "$outer" ? undefined : v)), uiRef(PILL, args));
  }

  /** A category header: "Sword (3)", pressed while folded, disabled while empty. */
  private header(g: ListGroup, count: number, open: boolean): Promise<Component | null> {
    const name = message("item", "m.group_count", g.label, count) || `${g.label} (${count})`;
    const args = { Name: name, Icon: g.icon, Selected: !open && count > 0, Enabled: count > 0 };
    return this.build("h" + JSON.stringify(args), uiRef(HEADER, args));
  }

  private sortHeader(): Promise<Component | null> {
    const sort = messageText("m." + this.sort, this.bundle);
    const label = message("projectx", "m.sort_type", sort) || `Sort (${sort})`;
    return this.build("s" + label, uiRef(SORT, { "Options Label": label, "Show Information": false }));
  }

  /** Rebuilds the visible rows from the groups, the search filter and the folds. */
  async fill() {
    if (!this.list) return;
    const gen = ++this.generation;
    const q = this.filter.trim().toLowerCase();
    const rows: Component[] = [];
    if (this.sorts.length) {
      const s = await this.sortHeader();
      if (gen !== this.generation) return;
      if (s) {
        // the client opens a menu of the sorts; a press here steps to the next one
        this.clicks.set(s, () => this.nextSort());
        rows.push(s);
      }
    }
    let shownGroups = 0;
    for (const g of this.groups) {
      let entries = q ? g.entries.filter(e => e.label.toLowerCase().includes(q)) : g.entries;
      if (!entries.length && !g.showEmpty) continue;
      if (this.sorts.length) entries = [...entries].sort((a, b) => compare(this.sort, a, b));
      shownGroups++;
      const open = (!this.collapsed.has(g.id) || !!q) && entries.length > 0;
      const h = await this.header(g, entries.length, open);
      if (gen !== this.generation) return;
      if (h) {
        const b = h.find("categoryname");
        if (b) { b.selected = !open && entries.length > 0; b.enabled = entries.length > 0; b.onAction = () => this.toggle(g.id); }
        rows.push(h);
      }
      if (!open) continue;
      const shown = !q && g.limit && entries.length > g.limit ? entries.slice(0, g.limit) : entries;
      const pills = await Promise.all(shown.map(e => this.pill(e)));
      if (gen !== this.generation) return;
      pills.forEach((p, i) => {
        if (!p) return;
        const e = shown[i];
        const sel = p.find("entryselect") ?? p.find("slot_ring");
        const pressed = () => this.showSelection && this.selected === e.key;
        if (sel) { sel.selected = pressed(); sel.onAction = () => { this.pick(e); sel.selected = pressed(); }; }
        const count = p.find("itemcount");
        if (count) count.text = e.count ?? "";
        if (e.tip) this.tips.set(p, e.tip); else this.tips.delete(p);
        this.onRow?.(e, p);
        rows.push(p);
      });
      // a blank row closes an open category (shared: it draws nothing)
      if (shown.length) {
        const blank = await this.build(`blank${rows.length}`, uiRef(BLANK));
        if (gen !== this.generation) return;
        if (blank) rows.push(blank);
      }
    }
    if (!shownGroups) {
      const empty = await this.emptyLabel();
      if (gen !== this.generation) return;
      if (empty) rows.push(empty);
    }
    for (const r of rows) r.constraints = null;
    this.list.children = rows;
  }

  /** Clicks on rows Clyde's dispatch does not press (the sort header), set by the window. */
  clicks = new Map<Component, () => void>();

  private emptyLabel(): Promise<Component | null> {
    const key = "empty:" + this.bundle;
    let p = this.cache.get(key);
    if (!p) { p = styledLabel(this.ctx, bundleText(this.bundle, "m.empty", "- Empty -"), "Default/Label"); this.cache.set(key, p); }
    return p;
  }

  private nextSort() {
    const i = this.sorts.indexOf(this.sort);
    this.sort = this.sorts[(i + 1) % this.sorts.length];
    this.sound("sound/feedback/ui_dropdown_select.ogg");
    void this.fill();
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
const TIP_PLAIN = "ui/window/tooltip.dat";

/** A bonus line of a tooltip (ui/window/tooltip_parts/bonus.dat): green or red, with a weapon class icon. */
export interface TipBonus { text: string; bonus: boolean; icon?: string | null; color?: string }

/** ItemCodes.ItemValueKey.key: the grade word for a bonus amount in steps of `step` ("Medium"). */
export function gradeText(step: number, amount: number): string {
  const names = ["low", "medium", "high", "very_high", "ultra"];
  const a = Math.abs(amount);
  const k = names.find((_, i) => a <= step * (i + 1) + 1e-6) ?? "maximum";
  return bundleText("item", "m." + k, k.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase()));
}

/**
 * The bonus lines ItemConfig.Level gives an item's level at depth 30: health, damage and
 * charge time, each in the item bundle's words with its grade.
 */
export function levelBonuses(st: { damage: number; uncapped: number; charge: number; health: number }): TipBonus[] {
  const out: TipBonus[] = [];
  const line = (key: string, fallback: string, ...args: (string | number)[]) => message("item", key, ...args) || fallback;
  if (st.health) out.push({ bonus: st.health > 0, text: line(st.health > 0 ? "m.health_bonus" : "m.health_penalty", `Health +${st.health / 40}`, Math.trunc(st.health / 40)) });
  if (st.charge) out.push({ bonus: st.charge > 0, text: line(st.charge > 0 ? "m.charge_reduction" : "m.charge_increase", "Charge Time Reduction", gradeText(0.08, st.charge)) });
  const dmg = st.damage + st.uncapped;
  if (dmg) out.push({ bonus: dmg > 0, text: line(dmg > 0 ? "m.damage_bonus" : "m.damage_penalty", "Damage Bonus", gradeText(0.08, dmg)) });
  return out;
}

/**
 * An item tooltip as the client's ItemConfig.Level builds it (ui/window/tooltip_level.dat):
 * name, type ("Equipped Sword" when worn), star rating, the flavor text, the level and the
 * heat bar (16 + 104 pixels of progress), then the pills: the attack or defence power bars,
 * the unique variants and the level's bonuses, green or red. Trinkets show no level. With the
 * item's config name the flavor is the game's own text; with its kind, the type is the game's
 * word for it (our own text stands in for either when the bundles lack it). Items without a
 * level (materials, food, costumes without heat) use the plain ui/window/tooltip.dat.
 */
export function itemTip(o: { label: string; type: string; rarity: number; flavor: string; level?: number; progress?: number; equipped?: boolean;
  lines?: string[]; item?: string; kind?: string; stats?: ItemStats | null; bonuses?: TipBonus[]; noLevel?: boolean; plain?: boolean }): TipSpec {
  const levelled = o.level !== undefined;
  const flavor = (o.item && itemFlavor(o.item)) || o.flavor;
  let type = o.kind ? itemType(o.kind, o.type) : o.type;
  if (o.equipped) type = message("item", "m.equipped", type) || `Equipped ${type}`;
  const extra = { stats: o.stats ?? undefined, bonuses: o.bonuses };
  if (o.plain) return { lines: o.lines, ...extra, ref: uiRef(TIP_PLAIN, {
    Name: o.label.toUpperCase(), Type: type.toUpperCase(), Body: "", Flavor: flavor, Rarity: String(Math.max(0, Math.min(5, o.rarity))) }) };
  const look = (o.equipped ? "True" : "False") + (levelled && !o.noLevel ? "" : " No Level");
  return { lines: o.lines, ...extra, ref: uiRef(TIP, {
    Name: o.label.toUpperCase(), Type: o.noLevel ? type : type.toUpperCase(), Flavor: flavor, Rarity: String(Math.max(0, Math.min(5, o.rarity))),
    Equipped: look, Level: String(o.level ?? 0).padStart(2, "0"), Heat: 16 + Math.trunc(104 * (o.progress ?? 0)),
    "Max Level": (o.level ?? 0) >= 10 ? "True" : "False",
  }) };
}
