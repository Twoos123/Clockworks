// The arsenal: the game's arsenal window (ui/arsenal/interface.dat) listing what the knight
// can put on, beside the status window (ui/status/interface_v2.dat) and its tabs:
//
// - Equipment (panel_equipment_v2.dat): sockets for the helmet, armour, shield, two
//   trinkets, three weapons and the vitapod around the knight's preview. The list shows the
//   saved loadouts and the gear owned; clicking gear equips it (or takes it off), clicking
//   a socket empties it, Save Loadout names the current loadout.
// - Costume (panel_costume_v2.dat): the helmet, armour and shield costume sockets. The list
//   shows the costumes and the accessories by location (game/accessories.ts); they change
//   only how the knight looks.
// - Battle Sprite (panel_battlesprite_v2.dat): the sprite in the field and its three skills,
//   with the sprite feeding panel (interface_battlesprite-hunger.dat) or a skill's augments
//   (panel_battlesprite-skill.dat) beside the preview. The list shows the sprites the knight
//   has and its sprite food (game/sprites.ts through game/outfit.ts).
// - Character Options: the list shows the knight's name (ui/rename/interface.dat) and the
//   personal colours.
//
// - Achievements (panel_cheevos.dat): an icon per achievement (interface_cheevoicon.dat), its
//   own picture once earned and the lock before, retired ones in the lower table once earned;
//   tooltips give the name and description from the projectx bundle and the progress
//   (game/achievements.ts). The list shows the gear, as on the equipment page.

import { ACHIEVEMENTS, LOCKED_ICON, ONLINE_ONLY, progressText } from "../game/achievements";
import { ACCESSORY_SLOTS, accessoryDef, costumeSlot, loadAccessoryLibraries, type AccessorySlot, type CostumeSlot } from "../game/accessories";
import type { GameData } from "../game/data";
import { MAX_LEVEL, type Economy } from "../game/economy";
import { CATEGORIES, catalogue, isEquipped, itemLabel, toggleEquip, unequip, type ItemEntry, type Slot } from "../game/items";
import type { Outfit } from "../game/outfit";
import { knightName, MAX_LOADOUTS, saveLoadout, wearableLoadout, type Loadout, type SaveData, type SavedLoadout } from "../game/save";
import {
  foodStars, freePoints, heatToNext, MAX_LEVEL as SPRITE_MAX, MAX_RANK, rechargeOf, SKILL_LEVELS, spriteTier, ULTIMATE_LEVELS,
  unlockedSkills, type SpriteDef, type SpriteProgress,
} from "../game/sprites";
import { validName } from "./createknight";
import { messageText, type Component, type Style } from "./gui";
import { itemTip, ItemList, levelBonuses, type ListEntry, type ListGroup, type TipBonus } from "./itemlist";
import { itemStats, pillDamage, wornDefense } from "../game/itemstats";
import { styledLabel } from "./floating";
import { freshProgress, rankName } from "../game/missions";
import { text as bundleText } from "../i18n";
import { buildStats, GuiScreen, row, uiRef, type ScreenHost, type TipSpec, type ViewModel } from "./screen";

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
  /** The battle sprite, accessories and costumes. */
  outfit(): Outfit;
  /** Writes the save after a change (the knight's name, saved loadouts). */
  write(): void;
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

/** Costume sockets (panel_costume_v2.dat's Tag1 to Tag3). */
const COSTUME_SOCKETS: { tag: string; slot: CostumeSlot; label: string }[] = [
  { tag: "slot3", slot: "helmet", label: "Helmet Costume" },
  { tag: "slot4", slot: "armor", label: "Armor Costume" },
  { tag: "slot15", slot: "shield", label: "Shield Costume" },
];

/** Battle sprite sockets (panel_battlesprite_v2.dat): the sprite and its three skills. */
const SPRITE_SOCKETS = ["slot_sprite", "slot_attack0", "slot_attack1", "slot_attack2"];
/** Sockets whose items this port has no data for: sprite harnesses and perks, achievement artifacts. */
const UNUSED_SOCKETS = new Set(["", "slot_harness", "slot_perk", "slot_artifactcheevo1", "slot_artifactcheevo2"]);

const CAT = "ui/icon/inventory/categories/";
const COLOR_ICON = CAT + "icon_recolor.png";
const COSTUME_GROUPS: { slot: CostumeSlot; label: string; icon: string }[] = [
  { slot: "helmet", label: "Helmets", icon: CAT + "icon_helmet_nocore.png" },
  { slot: "armor", label: "Armor", icon: CAT + "icon_armor_nocore.png" },
  { slot: "shield", label: "Shields", icon: CAT + "icon_shield_nocore.png" },
];
/** Accessory locations: list headings and their category icons. */
const ACCESSORY_GROUPS: Record<AccessorySlot, { label: string; icon: string }> = {
  helm_top: { label: "Helmet Top", icon: CAT + "icon_accessory-htop.png" },
  helm_front: { label: "Helmet Front", icon: CAT + "icon_accessory-hfront.png" },
  helm_side: { label: "Helmet Side", icon: CAT + "icon_accessory-hside.png" },
  helm_back: { label: "Helmet Back", icon: CAT + "icon_accessory-hback.png" },
  helm_brow: { label: "Helmet Brow", icon: CAT + "icon_accessory-hbrow.png" },
  armor_front: { label: "Armor Front", icon: CAT + "icon_accessory-afront.png" },
  armor_back: { label: "Armor Back", icon: CAT + "icon_accessory-aback.png" },
  armor_arms: { label: "Armor Arms", icon: CAT + "icon_accessory-aarms.png" },
  armor_rear: { label: "Armor Rear", icon: CAT + "icon_accessory-arear.png" },
  armor_ankle: { label: "Armor Ankle", icon: CAT + "icon_accessory-aankle.png" },
  armor_aura: { label: "Armor Aura", icon: CAT + "icon_accessory-aaura.png" },
};
/** The arsenal's groups in the client's order (ItemCodes.Group), and their names in the item bundle. */
const ARSENAL_GROUPS = ["sword", "gun", "bomb", "helmet", "armor", "shield", "trinket", "vitapod"];
const GROUP_KEY: Record<string, string> = { sword: "m.sword", gun: "m.handgun", bomb: "m.bomb", helmet: "m.helm", armor: "m.armor", shield: "m.shield", trinket: "m.trinket" };
/** Pills a costume or accessory group shows before the search field narrows it. */
const WARDROBE_LIMIT = 40;

const LOADOUT_PILL = "ui/loadout/parts/interface_pill.dat";
const LOADOUT_TIP = "ui/loadout/parts/tooltip.dat";
const RENAME = "ui/rename/interface.dat";
const HUNGER = "ui/status/parts/interface_battlesprite-hunger.dat";
const SKILL = "ui/status/parts/panel_battlesprite-skill.dat";
const ULTIMATE = "ui/status/parts/interface_battlesprite-ultimate.dat";
const SPRITE_IDLE = "character/pet/animation/default/animation_idle-001.dat";

type Mode = "equipment" | "costume" | "sprite" | "achievements" | "options";
const TABS: Mode[] = ["equipment", "costume", "sprite", "achievements"];
/** An achievement's icon in the achievements page's tables. */
const CHEEVO = "ui/status/parts/interface_cheevoicon.dat";

interface WardrobeItem { name: string; label: string; icon: any; rarity: number }
interface Wardrobe { costumes: Map<CostumeSlot, WardrobeItem[]>; accessories: Map<AccessorySlot, WardrobeItem[]> }
const WARDROBES = new WeakMap<GameData, Promise<Wardrobe>>();
/** Parts, developer and removal items (as accessories.ts's costumeItems and accessoryItems leave out). */
const SKIP_COSTUME = /\/Parts\/|\(Dev\)|\/Dev\//;
const SKIP_ACCESSORY = /\/Parts\/|\/Dev\/|^Accessory\/(Remove|Recover)\//;

/** Every costume and accessory, by slot (read once per item library). */
function wardrobe(data: GameData): Promise<Wardrobe> {
  let p = WARDROBES.get(data);
  if (!p) {
    p = (async () => {
      await loadAccessoryLibraries(data);
      const t0 = performance.now();
      const item = (n: string) => data.resolveSync("config/item.dat", { name: n }, "item");
      const out: Wardrobe = { costumes: new Map(), accessories: new Map() };
      // thousands of items: read in slices, giving the frame back between them
      let n = 0;
      for (const name of [...data.library_("config/item.dat").keys()]) {
        if (++n % 200 === 0) await new Promise(r => setTimeout(r));
        const slot = costumeSlot(name);
        if (slot) {
          if (SKIP_COSTUME.test(name)) continue;
          const it = item(name);
          if (!it?.model) continue;
          const list = out.costumes.get(slot) ?? [];
          list.push({ name, label: itemLabel(name), icon: it.icon ?? null, rarity: it.rarity ?? -1 });
          out.costumes.set(slot, list);
        } else if (name.startsWith("Accessory/") && !SKIP_ACCESSORY.test(name)) {
          const d = accessoryDef(data, name);
          if (!d) continue;
          const list = out.accessories.get(d.slot) ?? [];
          list.push({ name, label: itemLabel(name), icon: d.icon, rarity: item(name)?.rarity ?? -1 });
          out.accessories.set(d.slot, list);
        }
      }
      const order = (x: WardrobeItem, y: WardrobeItem) => x.label.localeCompare(y.label);
      for (const l of [...out.costumes.values(), ...out.accessories.values()]) l.sort(order);
      if (import.meta.env.DEV) console.log(`wardrobe read in ${Math.round(performance.now() - t0)} ms`);
      return out;
    })();
    WARDROBES.set(data, p);
  }
  return p;
}

/** The tooltip for an owned item (ItemConfig.Level's): the power bars, the unique variants, the level's bonuses at depth 30. */
export function ownedTip(save: SaveData, data: GameData, eco: Economy, e: ItemEntry, worn: boolean) {
  const heatable = !!eco.info(e.name)?.heatable;
  const g = save.gear[e.name], lv = eco.level(save, e.name);
  const bonuses: TipBonus[] = (g?.variants ?? []).map(v => ({ text: eco.variantLabel(v), bonus: true, color: "Variant" }));
  if (heatable) bonuses.push(...levelBonuses(eco.levelStats(e.name, lv, 30)));
  const flavor = heatable
    ? `${g?.heat ?? 0} heat absorbed.${lv < MAX_LEVEL ? " Gear levels up with the heat it gathers in the Clockworks." : " Fully heated."}`
    : `${e.category.label.replace(/s$/, "")}.`;
  return itemTip({ label: eco.displayName(e.name, g), type: e.category.label.replace(/s$/, ""), rarity: e.rarity, item: e.name, kind: e.category.eco,
    flavor, level: heatable ? lv : undefined, noLevel: e.category.slot === "trinket",
    progress: eco.heatProgress(save, e.name), equipped: worn, bonuses, stats: itemStats(data, eco, e.name, Math.max(1, lv)) });
}

/**
 * ArsenalPanel's groups of what the knight owns: the client's item groups in ItemCodes.Group
 * order, named in the item bundle and shown even when empty (the vitapod group is this
 * port's own), then the minerals and materials.
 */
export function ownedGroups(save: SaveData, data: GameData, eco: Economy): ListGroup[] {
  const owned = new Set(save.owned), l = save.loadout, groups: ListGroup[] = [];
  const cats = ARSENAL_GROUPS.map(id => CATEGORIES.find(c => c.id === id)!).filter(Boolean);
  for (const cat of cats) {
    const entries = catalogue(data).filter(e => e.category === cat && owned.has(e.name)).map(e => {
      const worn = isEquipped(l, e), heatable = !!eco.info(e.name)?.heatable;
      const lv = heatable ? eco.level(save, e.name) : 0;
      return { key: e.name, label: e.label, rarity: e.rarity, icon: e.icon, look: worn ? "True" : "False",
        // weapons, armour, helmets and shields hold variants (pips shown, empty or not); trinkets do not
        variants: heatable ? save.gear[e.name]?.variants.length ?? 0 : -1, levelled: heatable, level: lv,
        damage: pillDamage(data, eco, e.name, Math.max(1, lv)), tip: ownedTip(save, data, eco, e, worn) } satisfies ListEntry;
    });
    const key = GROUP_KEY[cat.id];
    groups.push({ id: cat.id, label: key ? messageText(key, "item") : cat.label, icon: cat.icon, entries, showEmpty: !!key });
  }
  for (const g of [{ id: "mineral", key: "m.mineral", icon: CAT + "icon_mineral.png", cats: ["mineral", "deposit"] },
    { id: "material", key: "m.material", icon: CAT + "icon_puzzle.png", cats: ["material"] }]) {
    const names = Object.keys(save.materials).filter(n => (save.materials[n] ?? 0) > 0 && g.cats.includes(eco.info(n)?.category ?? ""));
    groups.push({ id: g.id, label: messageText(g.key, "item"), icon: g.icon, showEmpty: true, entries: names.map(n => {
      const it = eco.info(n), count = save.materials[n] ?? 0;
      return { key: `mat:${n}`, label: itemLabel(n), rarity: it?.rarity ?? 0, icon: it?.icon ?? null, count: count > 1 ? String(count) : "",
        tip: itemTip({ label: itemLabel(n), type: messageText(g.key, "item"), rarity: it?.rarity ?? 0, flavor: "", item: n, kind: it?.category, plain: true }) } satisfies ListEntry;
    }) });
  }
  return groups;
}

/** A skill or augment name from its message key ("m.extra_crispy" is "Extra Crispy"). */
const named = (key: string) => key ? messageText(key) : "";

export class ArsenalScreen extends GuiScreen {
  private list: ItemList | null = null;
  private status: Component | null = null;
  /** The status window's tab pages: equipment, costume, battle sprite. */
  private pages: Component[] = [];
  private eco: Economy | null = null;
  private tab = 0;
  /** The list shows the character options (Character Options pressed). */
  private options = false;
  private wardrobe: Wardrobe | null = null;
  /** The sprite page's selection: the sprite (feeding) or a skill (its augments). */
  private focus: "sprite" | 0 | 1 | 2 = "sprite";
  /** Augment points placed but not confirmed, for the focused skill. */
  private pending = [0, 0, 0];
  /** The sprite food chosen for feeding. */
  private food = "";
  private spriteMessage = "";
  private defs: ReadonlyMap<string, SpriteDef> = new Map();
  private hunger: Component | null = null;
  private skill: Component | null = null;
  private spritePane: Component | null = null;
  private restyled = new Map<string, Promise<Style | null>>();
  private hiddenGroups = false;
  /** Achievement icons built, by type, with the state they show ("1" earned, "0" locked). */
  private cheevos = new Map<string, { state: string; c: Component }>();

  constructor(ctx: ConstructorParameters<typeof GuiScreen>[0], private readonly arsenal: ArsenalHost) {
    super(ctx, arsenal, "arsenalCanvas");
  }

  private get mode(): Mode { return this.options ? "options" : TABS[this.tab] ?? "equipment"; }

  protected async build(): Promise<Component | null> {
    this.eco = await this.arsenal.eco();
    const [left, right, hunger, skill, defs] = await Promise.all([
      this.ui("ui/arsenal/interface.dat", { Mode: "Contained" }),
      this.ui("ui/status/interface_v2.dat"),
      this.ui(HUNGER), this.ui(SKILL),
      this.arsenal.outfit().spriteDefs().catch(() => new Map<string, SpriteDef>()),
    ]);
    if (!left || !right) return null;
    // the costume and accessory catalogue is read in the background (it is long)
    void wardrobe(this.arsenal.data()).then(w => { this.wardrobe = w; });
    this.status = right;
    this.hunger = hunger;
    this.skill = skill;
    this.defs = defs;
    this.list = new ItemList(this.ctx, left, this.tips, f => this.host.sound(f));
    this.list.onPick = e => this.pick(e);
    this.list.clicks = this.clicks;
    this.on(left, "dismiss", () => this.close());
    this.on(right, "handle", () => this.close());
    this.on(right, "button_saveloadout", () => this.openSaveLoadout());
    const opts = this.on(right, "characteroptions", c => {
      this.options = !this.options;
      c.selected = this.options;
      this.host.sound("sound/feedback/ui_dropdown_select.ogg");
      void this.refresh();
    });
    if (opts) opts.states = 8;
    // the tabs: equipment, costume, battle sprite and achievements
    const pane = right.find("tabbed");
    if (pane) {
      this.pages = pane.tabs.slice(0, TABS.length);
      pane.parts.buttons?.children.forEach((b, i) => { b.visible = i < TABS.length; });
      pane.onAction = (_c, a) => {
        if (a !== "select") return;
        this.tab = Math.max(0, pane.selectedIndex);
        this.options = false;
        if (opts) opts.selected = false;
        this.host.sound("sound/feedback/ui_dropdown_select.ogg");
        void this.refresh();
      };
    }
    for (const [i, page] of this.pages.entries()) await this.preparePage(page, i);
    // the ninth socket holds the vitapod: its backing shows the capsule category icon
    const backing = this.pages[0] && this.socketBacking(this.pages[0], "slot9");
    if (backing?.styleRef) {
      const st = await this.restyle(backing, { File: CAT + "icon_capsule.png" });
      if (st) backing.styles = backing.styles.map(() => st);
    }
    for (const s of SOCKETS) { const c = right.find(s.tag); if (c) this.clicks.set(c, () => this.emptySocket(s)); }
    for (const s of COSTUME_SOCKETS) { const c = right.find(s.tag); if (c) this.clicks.set(c, () => void this.takeOffCostume(s.slot)); }
    for (const [i, tag] of SPRITE_SOCKETS.entries()) {
      const c = right.find(tag);
      if (c) this.clicks.set(c, () => this.focusOn(i === 0 ? "sprite" : (i - 1) as 0 | 1 | 2));
    }
    this.prepareSpritePanels();
    const draw = (im: { source: unknown; width: number; height: number } | null, g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
      if (im) g.drawImage(im.source as CanvasImageSource, Math.round(x + (w - im.width) / 2), Math.round(y + (h - im.height) / 2), im.width, im.height);
    };
    const tagged: Record<string, (c: Component, g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void> = {};
    for (const s of SOCKETS) tagged[s.tag] = (_c, g, x, y, w, h) => {
      const name = this.socketItem(s), e = name ? this.entry(name) : null;
      draw(e ? this.icon(e.icon, 36) : null, g, x, y, w, h);
    };
    for (const s of COSTUME_SOCKETS) tagged[s.tag] = (_c, g, x, y, w, h) => {
      const name = this.arsenal.outfit().appearance.costume[s.slot];
      draw(name ? this.icon(this.itemIcon(name), 36) : null, g, x, y, w, h);
    };
    tagged.slot_sprite = (_c, g, x, y, w, h) => {
      const { def, p } = this.activeSprite();
      draw(def && p ? this.icon(def.icons[spriteTier(p.level) - 1], 36) : null, g, x, y, w, h);
    };
    for (let i = 0; i < 3; i++) tagged[`slot_attack${i}`] = (_c, g, x, y, w, h) => {
      const { def, p } = this.activeSprite();
      if (def && p && i < unlockedSkills(p.level)) draw(this.icon(this.skillLabel(def, p, i).icon, 36), g, x, y, w, h);
    };
    tagged.slot_feed = (_c, g, x, y, w, h) => draw(this.food ? this.icon(this.itemIcon(this.food), 36) : null, g, x, y, w, h);
    tagged.favored_icon = (_c, g, x, y, w, h) => {
      const { def } = this.activeSprite();
      const fav = def?.food.find(f => (this.arsenal.save().materials[f] ?? 0) > 0) ?? def?.food[0];
      draw(fav ? this.icon(this.itemIcon(fav), 36) : null, g, x, y, w, h);
    };
    this.hooks = {
      view: (c, g, x, y, w, h) => this.host.view?.(c, g, x, y, w, h, this.viewModel(c)),
      tagged,
    };
    return row([left, right], 6);
  }

  /** Readies one tab page: names, the turnable preview, the sockets it uses. */
  private async preparePage(page: Component, index: number) {
    const preview = page.find("preview_render");
    if (preview) {
      // the knight preview fills the paper doll's backing (its size is -1 by -1 in the config)
      preview.constraints = { ...(preview.constraints ?? {}), fill: true };
      preview.view = { ...(preview.view ?? {}) };
      if (index === 2) preview.viewOwner = "sprite";
      for (const [tag, step] of [["turnleft", -1], ["turnright", 1]] as const) {
        const b = page.find(tag);
        if (b) b.onAction = () => { preview.view.azimuth = (preview.view.azimuth ?? 0) + step * Math.PI / 8; };
      }
    }
    // sockets with nothing to hold here
    const walk = (c: Component) => {
      if (String(c.styleRef?.name ?? "") === "Status/Equip Socket/Inactive" && c.children.length === 2 && UNUSED_SOCKETS.has(c.children[1].tag)) c.visible = false;
      c.children.forEach(walk);
    };
    walk(page);
    // the locked-in-town notice never applies: windows open only where gear can change
    const notice = page.find("notice");
    if (notice) notice.visible = false;
  }

  /** The battle sprite page's right column: the feeding panel or a skill's augments. */
  private prepareSpritePanels() {
    const page = this.pages[2];
    if (!page) return;
    const panes: Component[] = [];
    const walk = (c: Component) => { if (c.kind === "scrollpane" && c.tag !== "scroll_pane") panes.push(c); c.children.forEach(walk); };
    walk(page);
    const pane = this.spritePane = panes.at(-1) ?? null;
    // the right column starts hidden in the base panel; this page fills it
    const column = pane && this.parentOf(page, pane);
    if (column) column.visible = true;
    const h = this.hunger, s = this.skill;
    if (h) {
      // appetite is the server's (sprites are fed whenever the knight likes here)
      const app = h.find("appetite");
      if (app) { const box = this.parentOf(h, app); if (box) box.visible = false; }
      const req = h.find("required");
      if (req) req.visible = false;
      const flame = h.find("tooltip_heat")?.children[0];
      if (flame) flame.visible = false;
      const feed = h.find("button_feed");
      if (feed) feed.onAction = () => this.feed();
    }
    if (s) {
      for (let j = 0; j < 3; j++) {
        const bar = s.find(`skill${j}`), up = bar?.find("button_upgrade");
        if (up) up.onAction = () => this.addPoint(j);
      }
      const cancel = s.find("button_cancel"), confirm = s.find("button_confirm"), ult = s.find("button_selectultimate");
      if (cancel) cancel.onAction = () => { this.pending = [0, 0, 0]; this.host.sound("sound/feedback/ui_dismiss.ogg"); void this.refresh(); };
      if (confirm) confirm.onAction = () => this.confirmPoints();
      if (ult) ult.onAction = () => void this.openUltimate();
      for (const tag of ["ult_divider", "ult_header", "ult_description"]) { const c = s.find(tag); if (c) c.visible = false; }
    }
  }

  private parentOf(root: Component, c: Component): Component | null {
    if (root.children.includes(c)) return root;
    for (const k of root.children) { const r = this.parentOf(k, c); if (r) return r; }
    return null;
  }

  /** A component's style config with other arguments (a socket's icon, a pip's colour), resolved once. */
  private restyle(c: Component, args: Record<string, unknown>): Promise<Style | null> {
    const ref = c.styleRef;
    const entries: [string, unknown][] = [...(ref?.arguments?.entries ?? []).filter(([k]: [string]) => !(k in args)), ...Object.entries(args)];
    const key = (ref?.name ?? "") + JSON.stringify(entries);
    let p = this.restyled.get(key);
    if (!p) {
      p = ref ? this.ctx.resolveStyle({ ...ref, arguments: { $map: "com.threerings.config.ArgumentMap", entries } }, c.local) : Promise.resolve(null);
      this.restyled.set(key, p);
    }
    return p;
  }

  /** What a RenderableView shows: the knight, or the battle sprite on its page. */
  private viewModel(c: Component): ViewModel | undefined {
    if (c.viewOwner !== "sprite") return undefined;
    const { def, p } = this.activeSprite();
    return { ref: def && p ? def.models[spriteTier(p.level) - 1] : null, idle: SPRITE_IDLE };
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

  /** An item's IconConfig (costumes, food). */
  private itemIcon(name: string): any {
    return this.eco?.info(name)?.icon ?? this.arsenal.data().resolveSync("config/item.dat", { name }, "item")?.icon ?? null;
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

  private async takeOffCostume(slot: CostumeSlot) {
    const outfit = this.arsenal.outfit();
    if (!outfit.appearance.costume[slot]) return;
    this.host.sound("sound/feedback/ui_dropdown_select.ogg");
    await outfit.equipCostume(slot, "");
    void this.refresh();
  }

  private pick(e: ListEntry) {
    const [kind, ...rest] = e.key.split(":"), value = rest.join(":");
    switch (kind) {
      case "color":
        this.arsenal.setColor(Number(value));
        this.host.sound("sound/feedback/ui_confirm.ogg");
        void this.refresh();
        return;
      case "rename": this.openRename(); return;
      case "loadout": this.wearLoadout(Number(value)); return;
      case "costume": void this.toggleCostume(value); return;
      case "accessory": void this.toggleAccessory(value); return;
      case "sprite": this.chooseSprite(value); return;
      // materials are listed to look at (the client's context menu offers nothing more here)
      case "mat": return;
      case "food":
        this.food = this.food === value ? "" : value;
        this.focus = "sprite";
        this.host.sound("sound/feedback/ui_dropdown_select.ogg");
        void this.refresh();
        return;
    }
    const item = this.entry(e.key);
    if (!item) return;
    this.host.sound("sound/feedback/ui_equip.ogg");
    this.arsenal.equipped(toggleEquip(this.arsenal.save().loadout, item));
    void this.refresh();
  }

  // ------------------------------------------------------------------ costumes and accessories

  private async toggleCostume(name: string) {
    const outfit = this.arsenal.outfit(), slot = COSTUME_GROUPS.find(g => this.wardrobe?.costumes.get(g.slot)?.some(c => c.name === name))?.slot;
    if (!slot) return;
    this.host.sound("sound/feedback/ui_equip.ogg");
    await outfit.equipCostume(slot, outfit.appearance.costume[slot] === name ? "" : name);
    void this.refresh();
  }

  private async toggleAccessory(name: string) {
    const outfit = this.arsenal.outfit();
    const worn = ACCESSORY_SLOTS.find(s => outfit.appearance.accessories[s] === name);
    this.host.sound("sound/feedback/ui_equip.ogg");
    if (worn) await outfit.removeAccessory(worn);
    else await outfit.equipAccessory(name);
    void this.refresh();
  }

  // ------------------------------------------------------------------ loadouts

  private loadoutTip(l: SavedLoadout): TipSpec {
    const label = (n: string) => n ? (this.eco?.displayName(n, this.arsenal.save().gear[n]) ?? itemLabel(n)) : "Empty";
    const icon = (n: string, fallback: string) => this.itemIcon(n)?.file ?? fallback;
    const g = l.loadout, c = l.appearance.costume;
    const slots: [string, string, string][] = [
      ["0", g.helmet, CAT + "icon_helmet.png"], ["1", g.armor, CAT + "icon_armor.png"], ["2", g.shield, CAT + "icon_shield.png"],
      ["3", c.helmet, CAT + "icon_helmet_nocore.png"], ["4", c.armor, CAT + "icon_armor_nocore.png"], ["15", c.shield, CAT + "icon_shield_nocore.png"],
      ["6", g.weapons[0] ?? "", CAT + "icon_gauntlet.png"], ["7", g.weapons[1] ?? "", CAT + "icon_gauntlet.png"], ["8", g.weapons[2] ?? "", CAT + "icon_gauntlet.png"],
      ["9", g.vitapod, CAT + "icon_capsule.png"], ["10", g.trinkets[0] ?? "", CAT + "icon_core.png"], ["11", g.trinkets[1] ?? "", CAT + "icon_core.png"],
    ];
    const args: Record<string, unknown> = { Name: l.name.toUpperCase(), "Visible Harness": false, "Visible Perk": false,
      "Name Sprite": l.sprite || "No battle sprite", "Icon Sprite": CAT + "icon_battlesprite.png" };
    for (const [i, n, fb] of slots) { args[`Name ${i}`] = label(n); args[`Icon ${i}`] = n ? icon(n, fb) : fb; }
    return { ref: uiRef(LOADOUT_TIP, args), texts: { tooltip_type: "Click to wear this loadout" } };
  }

  private wearLoadout(i: number) {
    const save = this.arsenal.save(), l = save.loadouts?.[i];
    if (!l) return;
    this.host.sound("sound/feedback/ui_equip.ogg");
    this.arsenal.equipped(wearableLoadout(save, l));
    const outfit = this.arsenal.outfit();
    void (async () => {
      for (const s of COSTUME_GROUPS) if (outfit.appearance.costume[s.slot] !== l.appearance.costume[s.slot]) await outfit.equipCostume(s.slot, l.appearance.costume[s.slot]);
      for (const s of ACCESSORY_SLOTS) if (outfit.appearance.accessories[s] && !l.appearance.accessories[s]) await outfit.removeAccessory(s);
      for (const s of ACCESSORY_SLOTS) { const n = l.appearance.accessories[s]; if (n && outfit.appearance.accessories[s] !== n) await outfit.equipAccessory(n); }
      if (l.sprite !== (save.sprites?.active ?? "") && (!l.sprite || outfit.ownedSprites().includes(l.sprite))) outfit.setSprite(l.sprite);
      void this.refresh();
    })();
  }

  /** A name entry window over the status window (ui/rename/interface.dat). */
  private async nameWindow(o: { title: string; lines: string[]; value: string; accept: (name: string) => string | null }) {
    const w = await this.ui(RENAME);
    if (!w) return;
    const set = (tag: string, text: string) => { const c = w.find(tag); if (c) { c.text = text; c.visible = !!text; } };
    set("label_title", o.title);
    o.lines.forEach((l, i) => set(`label_desc${i + 1}`, l));
    for (let i = o.lines.length; i < 3; i++) set(`label_desc${i + 1}`, "");
    const alert = w.find("alert");
    if (alert) { alert.visible = false; alert.icon = null; }
    const field = w.find("namefield");
    if (field) { field.text = o.value; field.maxLength = 20; }
    const close = () => { this.overlays = this.overlays.filter(x => x !== w); };
    const accept = () => {
      const err = o.accept(String(field?.text ?? ""));
      if (err && alert) { alert.text = err; alert.visible = true; this.host.sound("sound/feedback/ui_dismiss.ogg"); return; }
      this.host.sound("sound/feedback/ui_confirm.ogg");
      close();
      void this.refresh();
    };
    const ok = w.find("buttonAccept");
    if (ok) ok.onAction = accept;
    if (field) field.onAction = (_c, a) => { if (a === "enter") accept(); };
    const dismiss = w.find("dismiss");
    if (dismiss) dismiss.onAction = () => { this.host.sound("sound/feedback/ui_dismiss.ogg"); close(); };
    this.overlays.push(w);
  }

  private openSaveLoadout() {
    const save = this.arsenal.save(), n = save.loadouts?.length ?? 0;
    void this.nameWindow({
      title: "Save Loadout", value: `Loadout ${Math.min(MAX_LOADOUTS, n + 1)}`,
      lines: ["Name the gear, costumes and battle sprite you have on.", "Saving under a loadout's name replaces it.", `${n} of ${MAX_LOADOUTS} loadouts saved.`],
      accept: name => {
        const t = name.trim();
        if (!t) return "Give the loadout a name.";
        if (!saveLoadout(save, t, save.sprites?.active ?? "")) return `You have ${MAX_LOADOUTS} loadouts: save over one of their names.`;
        this.arsenal.write();
        return null;
      },
    });
  }

  private openRename() {
    const save = this.arsenal.save();
    void this.nameWindow({
      title: "Change Name", value: knightName(save),
      lines: ["Choose a new name for your knight.", "2 to 20 letters, digits, spaces, apostrophes or hyphens."],
      accept: name => {
        const err = validName(name);
        if (err) return err;
        save.knight = { ...(save.knight ?? { helmet: "", armor: "" }), name: name.trim().replace(/\s+/g, " ") };
        this.arsenal.write();
        return null;
      },
    });
  }

  // ------------------------------------------------------------------ battle sprites

  private activeSprite(): { def: SpriteDef | null; p: SpriteProgress | null } {
    const p = this.arsenal.outfit().sprites.active();
    return { def: p ? this.defs.get(p.name) ?? null : null, p };
  }

  /** A skill's name and icon: its ultimate's once chosen. */
  private skillLabel(def: SpriteDef, p: SpriteProgress, i: number) {
    const s = def.skills[i], u = p.ultimates[i];
    return (u === "A" ? s?.ultimateLabels[0] : u === "B" ? s?.ultimateLabels[1] : null) ?? s?.label ?? { name: "", icon: null, desc: "" };
  }

  private chooseSprite(name: string) {
    const outfit = this.arsenal.outfit();
    const cur = outfit.sprites.active()?.name ?? "";
    outfit.setSprite(cur === name ? "" : name);
    this.pending = [0, 0, 0];
    this.spriteMessage = "";
    this.host.sound("sound/feedback/ui_equip.ogg");
    void this.refresh();
  }

  private focusOn(f: "sprite" | 0 | 1 | 2) {
    if (f === this.focus) return;
    this.focus = f;
    this.pending = [0, 0, 0];
    this.spriteMessage = "";
    this.host.sound("sound/feedback/ui_dropdown_select.ogg");
    void this.refresh();
  }

  private feed() {
    const { def, p } = this.activeSprite();
    if (!def || !p || !this.food) return;
    const before = p.level;
    const gained = this.arsenal.outfit().sprites.feed(this.food);
    if (gained < 0) { this.host.sound("sound/feedback/ui_dismiss.ogg"); return; }
    const after = this.arsenal.outfit().sprites.active();
    const unlocked = SKILL_LEVELS.filter(l => l > before && l <= (after?.level ?? before)).length;
    this.spriteMessage = gained ? `${def.name} reached level ${after?.level}!${unlocked ? " A new skill is ready." : ""}` : `${def.name} ate the ${itemLabel(this.food)}.`;
    if ((this.arsenal.save().materials[this.food] ?? 0) <= 0) this.food = "";
    this.host.sound(gained ? "sound/feedback/ui_confirm.ogg" : "sound/feedback/ui_equip.ogg");
    void this.refresh();
  }

  private addPoint(power: number) {
    const { p } = this.activeSprite(), i = this.focus;
    if (!p || i === "sprite") return;
    const left = freePoints(p) - this.pending.reduce((a, b) => a + b, 0);
    if (i >= unlockedSkills(p.level) || left <= 0 || p.ranks[i][power] + this.pending[power] >= MAX_RANK) { this.host.sound("sound/feedback/ui_dismiss.ogg"); return; }
    this.pending[power]++;
    this.host.sound("sound/feedback/ui_dropdown_select.ogg");
    void this.refresh();
  }

  private confirmPoints() {
    const i = this.focus;
    if (i === "sprite") return;
    const roster = this.arsenal.outfit().sprites;
    for (let j = 0; j < 3; j++) for (let k = 0; k < this.pending[j]; k++) roster.spend(i, j);
    this.pending = [0, 0, 0];
    this.host.sound("sound/feedback/ui_confirm.ogg");
    void this.refresh();
  }

  /** The ultimate choice (interface_battlesprite-ultimate.dat) for the focused skill. */
  private async openUltimate() {
    const { def, p } = this.activeSprite(), i = this.focus;
    if (!def || !p || i === "sprite" || p.level < ULTIMATE_LEVELS[i]) return;
    const o = await this.ui(ULTIMATE);
    if (!o) return;
    const s = def.skills[i];
    for (const [k, label] of [["a", s.ultimateLabels[0]], ["b", s.ultimateLabels[1]]] as const) {
      const set = (tag: string, text: string) => { const c = o.find(tag); if (c) c.text = text; };
      set(`label_ult_${k}_name`, named(label?.name ?? "") || `Ultimate ${k.toUpperCase()}`);
      set(`label_ult_${k}_description`, `Replaces ${named(s.label.name)} with its ultimate form ${k.toUpperCase()}.`
        + (p.ultimates[i] === k.toUpperCase() ? " Chosen." : ""));
      const icon = o.find(`icon_ult_${k}`);
      if (icon && label?.icon?.file) { const st = await this.restyle(icon, { File: label.icon.file }); if (st) icon.styles = icon.styles.map(() => st); }
      const b = o.find(`button_ult_${k}`);
      if (b) {
        b.text = p.ultimates[i] === k.toUpperCase() ? "Keep the normal skill" : `Upgrade to ${named(label?.name ?? "") || "Ultimate " + k.toUpperCase()}`;
        b.onAction = () => {
          const u = p.ultimates[i] === k.toUpperCase() ? "" : k.toUpperCase() as "A" | "B";
          this.arsenal.outfit().sprites.ultimate(i, u);
          this.host.sound("sound/feedback/ui_confirm.ogg");
          this.overlays = this.overlays.filter(x => x !== o);
          void this.refresh();
        };
      }
    }
    const status = o.find("status");
    if (status) status.visible = false;
    const view = o.find("preview_render");
    if (view) view.viewOwner = "sprite";
    const dismiss = o.find("dismiss");
    if (dismiss) dismiss.onAction = () => { this.overlays = this.overlays.filter(x => x !== o); this.host.sound("sound/feedback/ui_dismiss.ogg"); };
    this.overlays.push(o);
  }

  /** Fills the sprite page's right column. */
  private async fillSprite() {
    const pane = this.spritePane, h = this.hunger, s = this.skill;
    if (!pane?.parts.viewport || !h || !s) return;
    const { def, p } = this.activeSprite();
    if (!def || !p) this.focus = "sprite";
    const panel = this.focus === "sprite" ? h : s;
    if (pane.parts.viewport.children[0] !== panel) { panel.constraints = null; pane.parts.viewport.children = [panel]; }
    const set = (root: Component, tag: string, text: string) => { const c = root.find(tag); if (c) c.text = text; return c; };
    const save = this.arsenal.save();
    if (this.focus === "sprite") {
      set(h, "type", def ? def.name.toUpperCase() : "NO BATTLE SPRITE");
      set(h, "tooltip_level", p ? String(p.level).padStart(2, "0") : "00");
      const bar = h.find("tooltip_heat");
      if (bar) bar.preferredSize = { width: Math.max(1, Math.round(120 * (p && p.level < SPRITE_MAX ? p.heat / heatToNext(p.level) : p ? 1 : 0))), height: bar.preferredSize?.height ?? -1 };
      const fav = h.find("favored");
      if (fav) fav.visible = !!def;
      if (def) set(h, "favored_name", def.food.map(itemLabel).filter((n, i, a) => a.indexOf(n) === i).slice(0, 2).join(", ") + (def.food.length > 2 ? "..." : ""));
      const count = this.food ? save.materials[this.food] ?? 0 : 0;
      set(h, "status", this.spriteMessage || (!def ? "Battle sprites join you through the sprite missions."
        : this.food ? `${itemLabel(this.food)} (${count} left)${def.food.includes(this.food) ? ": a favourite!" : ""}`
        : p!.level >= SPRITE_MAX ? `${def.name} is fully grown.` : "Pick sprite food from the list to feed it."));
      const feed = h.find("button_feed");
      if (feed) feed.enabled = !!def && !!this.food && count > 0 && p!.level < SPRITE_MAX;
      return;
    }
    const i = this.focus;
    if (!def || !p) return;
    const sk = def.skills[i], label = this.skillLabel(def, p, i), unlocked = i < unlockedSkills(p.level);
    set(s, "label_skillname", named(label.name));
    const icon = s.find("spacer_icon");
    if (icon && label.icon?.file) { const st = await this.restyle(icon, { File: label.icon.file }); if (st) icon.styles = icon.styles.map(() => st); }
    const left = freePoints(p) - this.pending.reduce((a, b) => a + b, 0);
    set(s, "label_availableskillpoints", unlocked ? `${left} skill point${left === 1 ? "" : "s"} to spend` : `Unlocks at level ${SKILL_LEVELS[i]}`);
    for (let j = 0; j < 3; j++) {
      const bar = s.find(`skill${j}`);
      if (!bar) continue;
      const power = sk?.powers[j], rank = p.ranks[i][j], add = this.pending[j];
      set(bar, "title", `${named(power?.name ?? "") || ["Focus", "Power", "Power"][j]} +${rank + add}`);
      const ic = bar.find("spacer_icon");
      if (ic && power?.icon?.file) { const st = await this.restyle(ic, { Icon: power.icon.file }); if (st) ic.styles = ic.styles.map(() => st); }
      for (let k = 1; k <= 3; k++) {
        const pip = bar.find(`spacer_pip${k}`);
        if (!pip) continue;
        const st = await this.restyle(pip, { Color: k > rank ? "New" : "Normal" });
        if (st) pip.styles = pip.styles.map(() => st);
        pip.alpha = k <= rank + add ? 1 : 0;
      }
      const up = bar.find("button_upgrade");
      if (up) up.enabled = unlocked && left > 0 && rank + add < MAX_RANK;
    }
    const pend = this.pending.some(n => n > 0);
    for (const tag of ["button_cancel", "button_confirm"]) { const c = s.find(tag); if (c) c.enabled = pend; }
    const ult = s.find("button_selectultimate");
    if (ult) {
      ult.enabled = p.level >= ULTIMATE_LEVELS[i] && !!(sk?.ultimateA || sk?.ultimateB);
      ult.text = p.level >= ULTIMATE_LEVELS[i] ? "Select Ultimate" : `Ultimate at level ${ULTIMATE_LEVELS[i]}`;
    }
    const focus = { ...p, ranks: p.ranks.map((r, k) => k === i ? r.map((v, j) => v + this.pending[j]) : r) };
    set(s, "label_cooldown", `Recharge: ${rechargeOf(def, focus, i)} seconds`);
    const powers = (sk?.powers ?? []).map(x => named(x.name)).filter(Boolean);
    set(s, "label_description", `${named(label.name)}${powers.length ? `: ${powers.join(", ")}` : ""}. Each augment takes up to ${MAX_RANK} points.`);
  }

  // ------------------------------------------------------------------ the lists

  /** The tooltip for an owned item: its level and heat, what the level gives, its variants. */
  private tip(e: ItemEntry, worn: boolean) { return ownedTip(this.arsenal.save(), this.arsenal.data(), this.eco!, e, worn); }

  private gearGroups(): ListGroup[] {
    const save = this.arsenal.save(), l = save.loadout;
    const groups: ListGroup[] = [];
    const saved = save.loadouts ?? [];
    if (saved.length) groups.push({ id: "loadouts", label: "Loadouts", icon: CAT + "icon_equippable.png", entries: saved.map((s, i) => {
      const worn = JSON.stringify(wearableLoadout(save, s)) === JSON.stringify(l);
      return { key: `loadout:${i}`, label: s.name, rarity: -1, icon: null, look: worn ? "True" : "False", tip: this.loadoutTip(s),
        ui: uiRef(LOADOUT_PILL, { Name: s.name, Equipped: worn ? "True" : "False", Hoverable: true }) } satisfies ListEntry;
    }) });
    return [...groups, ...ownedGroups(save, this.arsenal.data(), this.eco!)];
  }

  private async costumeGroups(): Promise<ListGroup[]> {
    const w = this.wardrobe ??= await wardrobe(this.arsenal.data());
    const app = this.arsenal.outfit().appearance;
    const groups: ListGroup[] = [];
    for (const g of COSTUME_GROUPS) {
      const items = w.costumes.get(g.slot) ?? [];
      if (items.length) groups.push({ id: `costume-${g.slot}`, label: g.label, icon: g.icon, limit: WARDROBE_LIMIT, entries: items.map(c => {
        const worn = app.costume[g.slot] === c.name;
        return { key: `costume:${c.name}`, label: c.label, rarity: c.rarity, icon: c.icon, look: worn ? "True" : "False",
          tip: itemTip({ label: c.label, type: g.label.replace(/s$/, ""), rarity: Math.max(0, c.rarity),
            flavor: `Worn over your ${g.slot === "helmet" ? "helmet" : g.slot === "armor" ? "armor" : "shield"}: it changes the look, not the stats.${worn ? " Worn." : " Click to wear it."}`, equipped: worn }) };
      }) });
    }
    for (const slot of ACCESSORY_SLOTS) {
      const items = w.accessories.get(slot) ?? [], meta = ACCESSORY_GROUPS[slot];
      if (items.length) groups.push({ id: `acc-${slot}`, label: meta.label, icon: meta.icon, limit: WARDROBE_LIMIT, entries: items.map(a => {
        const worn = app.accessories[slot] === a.name;
        return { key: `accessory:${a.name}`, label: a.label, rarity: a.rarity, icon: a.icon, look: worn ? "True" : "False",
          tip: itemTip({ label: a.label, type: `Accessory: ${meta.label}`, rarity: Math.max(0, a.rarity), flavor: worn ? "Worn. Click to take it off." : "Click to wear it.", equipped: worn }) };
      }) });
    }
    // the wardrobe is long: its groups start folded
    if (!this.hiddenGroups && this.list) { this.hiddenGroups = true; for (const g of groups) this.list.collapsed.add(g.id); }
    return groups;
  }

  private spriteGroups(): ListGroup[] {
    const outfit = this.arsenal.outfit(), save = this.arsenal.save(), active = outfit.sprites.active()?.name ?? "";
    const groups: ListGroup[] = [];
    const owned = outfit.ownedSprites().filter(n => this.defs.has(n));
    if (owned.length) groups.push({ id: "sprites", label: "Battle Sprites", icon: CAT + "icon_battlesprite.png", entries: owned.map(n => {
      const def = this.defs.get(n)!, p = save.sprites?.sprites[n], lv = p?.level ?? 0, worn = n === active;
      return { key: `sprite:${n}`, label: n, rarity: lv, icon: def.icons[spriteTier(lv) - 1], look: worn ? "True" : "False",
        tip: itemTip({ label: n, type: "Battle Sprite", rarity: 0, flavor: `Level ${lv}. ${worn ? "In the field. Click to leave it home." : "Click to take it along."}`, equipped: worn }) };
    }) });
    const foods = Object.keys(save.materials).filter(n => /^Food\//.test(n) && foodStars(n) > 0 && (save.materials[n] ?? 0) > 0).sort();
    const fav = this.activeSprite().def?.food ?? [];
    if (foods.length) groups.push({ id: "food", label: "Sprite Food", icon: CAT + "icon_sprite.png", entries: foods.map(n => ({
      key: `food:${n}`, label: itemLabel(n), rarity: foodStars(n) - 1, icon: this.itemIcon(n), look: this.food === n ? "True" : "False",
      count: String(save.materials[n]),
      tip: itemTip({ label: itemLabel(n), type: "Sprite Food", rarity: foodStars(n) - 1, flavor: `${fav.includes(n) ? "Your sprite's favourite. " : ""}Click to feed it to your battle sprite.` }),
    })) });
    return groups;
  }

  private optionGroups(): ListGroup[] {
    const save = this.arsenal.save();
    const groups: ListGroup[] = [{ id: "name", label: "Knight", icon: CAT + "icon_facemod.png", entries: [{
      key: "rename:", label: `Name: ${knightName(save)}`, rarity: -1, icon: { file: CAT + "icon_facemod.png" },
      tip: itemTip({ label: knightName(save), type: "Knight", rarity: 0, flavor: "Click to change your knight's name." }),
    }] }];
    const colors = this.arsenal.colors();
    if (colors.length) groups.push({ id: "color", label: "Personal Color", icon: COLOR_ICON, entries: colors.map(c => ({
      key: `color:${c.print}`, label: c.name, rarity: -1, look: c.print === save.color ? "True" : "False",
      icon: { file: COLOR_ICON, colorizations: [{ $class: "com.threerings.opengl.renderer.config.ColorizationConfig$Normal", colorization: c.print }] },
    })) });
    return groups;
  }

  protected async refresh() {
    if (!this.list || !this.status) return;
    const save = this.arsenal.save(), mode = this.mode;
    const info: Record<Mode, [string, string]> = {
      equipment: ["Equipment", "Click gear to equip or remove it; click a socket to empty it. Changes are worn from the next floor."],
      costume: ["Costumes", "Costumes and accessories change how your knight looks, not its stats. Search for one by name."],
      sprite: ["Battle Sprite", "Pick the sprite to take along and feed it sprite food. Click a skill socket to spend its points."],
      achievements: ["Achievements", "Achievements earned on this machine. Point at one to see what it asks and how far along you are."],
      options: ["Character Options", "Change your knight's name or personal color."],
    };
    this.list.setNotice("");
    this.list.setInfo("ARSENAL", info[mode][0], info[mode][1], save.crowns);
    const groups = mode === "equipment" || mode === "achievements" ? this.gearGroups() : mode === "costume" ? await this.costumeGroups()
      : mode === "sprite" ? this.spriteGroups() : this.optionGroups();
    // LoadoutPanel takes the battle sprite tab away while the knight has no sprite
    const spriteTab = this.status.find("tabbed")?.parts.buttons?.children[2];
    if (spriteTab) spriteTab.visible = this.arsenal.outfit().ownedSprites().length > 0;
    // the gear list sorts as the client's arsenal does; the other pages keep their own order
    this.list.sorts = mode === "equipment" || mode === "achievements" ? ["natural", "name", "stars", "level"] : [];
    await this.list.setGroups(groups);
    // the status window: names on every page, then each page's sockets
    for (const page of this.pages) {
      const set = (tag: string, text: string) => { const c = page.find(tag); if (c) c.text = text; };
      set("label_playername", knightName(save));
      // LoadoutPanel: the mission rank's title with the rank, and the prestige
      const m = save.missions ?? freshProgress();
      set("label_playerrank", `${rankName(m.rank)}(${m.rank}-${m.subrank})`);
      set("label_prestige", m.prestige.toLocaleString("en-US"));
    }
    const st = this.status;
    for (const s of SOCKETS) {
      const c = st.find(s.tag);
      if (!c) continue;
      const name = this.socketItem(s), e = name ? this.entry(name) : null;
      if (e) this.tips.set(c, this.tip(e, true));
      else this.tips.set(c, itemTip({ label: s.label, type: "Empty socket", rarity: 0, flavor: name ? itemLabel(name) : "Pick gear from the arsenal to fill it." }));
    }
    const app = this.arsenal.outfit().appearance;
    const worn = ACCESSORY_SLOTS.filter(s => app.accessories[s]);
    for (const s of COSTUME_SOCKETS) {
      const c = st.find(s.tag);
      if (!c) continue;
      const name = app.costume[s.slot];
      const acc = worn.filter(a => a.startsWith(s.slot === "helmet" ? "helm" : s.slot === "armor" ? "armor" : "-"))
        .map(a => `${ACCESSORY_GROUPS[a].label}: ${itemLabel(app.accessories[a]!)}`);
      this.tips.set(c, itemTip({ label: name ? itemLabel(name) : s.label, type: name ? s.label : "Empty socket", rarity: 0, equipped: !!name, lines: acc,
        flavor: name ? "Click to take it off." : "Pick a costume from the list to wear it." }));
    }
    const { def, p } = this.activeSprite();
    const spriteSocket = st.find("slot_sprite");
    if (spriteSocket) this.tips.set(spriteSocket, itemTip({ label: def?.name ?? "Battle Sprite", type: def ? `Level ${p!.level}` : "Empty socket", rarity: 0,
      flavor: def ? "Click to feed your sprite." : "Pick a battle sprite from the list." }));
    for (let i = 0; i < 3; i++) {
      const c = st.find(`slot_attack${i}`);
      if (!c) continue;
      const unlocked = !!p && i < unlockedSkills(p.level);
      const backing = this.socketBacking(this.pages[2] ?? st, `slot_attack${i}`);
      if (backing) backing.alpha = unlocked ? 0 : 1;
      this.tips.set(c, itemTip({ label: def && p ? named(this.skillLabel(def, p, i).name) : "Skill", type: "Sprite skill", rarity: 0,
        flavor: !def ? "No battle sprite." : unlocked ? "Click to see its augments." : `Unlocks at level ${SKILL_LEVELS[i]}.` }));
    }
    await this.fillSprite();
    await this.fillAchievements();
    await this.fillGearStats();
  }

  /** Whether the equipment page's gear stats column is folded away (the client starts it folded). */
  private statsFolded = true;
  private statsBuilt = "";

  /**
   * The equipment page's gear stats column (LoadoutPanel's equipment tab, client/l): "GEAR
   * STATS" with the worn armour's defence power, then each weapon's name, attack power and
   * level bonuses; the toggle beside the sockets folds it.
   */
  private async fillGearStats() {
    const page = this.pages[0];
    const toggle = page?.find("toggle_collapseleft"), left = page?.find("left_cont"), cont = page?.find("scroll_cont");
    if (!page || !toggle || !left || !cont || !this.eco) return;
    toggle.visible = true;
    toggle.selected = this.statsFolded;
    toggle.onAction = c => { this.statsFolded = !!c.selected; left.visible = !this.statsFolded; this.host.sound("sound/feedback/ui_dropdown_select.ogg"); };
    left.visible = !this.statsFolded;
    const save = this.arsenal.save(), eco = this.eco, data = this.arsenal.data(), l = save.loadout;
    const lv = (n: string) => Math.max(1, eco.level(save, n));
    const key = JSON.stringify([l, save.gear]);
    if (key === this.statsBuilt) return;
    this.statsBuilt = key;
    const title = (t: string) => styledLabel(this.ctx, t.toUpperCase(), "Status/Gear Stats/Title", page.local);
    const parts: (Component | null)[] = [await title(bundleText("projectx", "t.gear_stats", "Gear Stats"))];
    const def = wornDefense(data, eco, [l.helmet, l.armor].filter(Boolean).map(n => ({ name: n, level: lv(n) })));
    if (def) parts.push(await buildStats(this.ctx, def));
    for (const w of l.weapons.filter(Boolean)) {
      parts.push(await title(eco.displayName(w, save.gear[w])));
      const st = itemStats(data, eco, w, lv(w));
      if (st) parts.push(await buildStats(this.ctx, st));
    }
    cont.children = parts.filter((c): c is Component => !!c);
    for (const c of cont.children) { c.constraints = null; if (c.kind === "label") c.preferredSize = { width: 180, height: -1 }; }
  }

  /** The achievements page: earned icons, locks, and the tooltips. */
  private async fillAchievements() {
    const page = this.pages[3];
    const table = page?.find("icontable"), retired = page?.find("obsoletetable");
    if (!table || !retired) return;
    const save = this.arsenal.save(), look = (n: string) => this.eco?.info(n) ?? null;
    const cells = await Promise.all(ACHIEVEMENTS.map(async d => {
      const at = save.achievements?.unlocked[d.type];
      // secret and retired achievements show once earned
      if (d.hidden && !at) return null;
      const state = at ? "1" : "0";
      let cell = this.cheevos.get(d.type);
      if (!cell || cell.state !== state) {
        const c = await this.ui(CHEEVO, { Icon: at ? d.icon : LOCKED_ICON, Unlocked: true });
        if (!c) return null;
        cell = { state, c };
        this.cheevos.set(d.type, cell);
      }
      const prog = at ? null : progressText(save, d.type, look);
      const lines = [at ? `Earned ${new Date(at).toLocaleDateString()}` : prog ? `Progress: ${prog}` : "",
        !at && ONLINE_ONLY.has(d.type) ? "Needs other players or the game's servers" : ""].filter(Boolean);
      this.tips.set(cell.c, itemTip({ label: messageText(d.nameKey, "projectx"), type: at ? "Achievement" : "Locked achievement", rarity: 0,
        flavor: messageText(d.descKey, "projectx"), lines }));
      return { d, c: cell.c };
    }));
    const shown = cells.filter((x): x is NonNullable<typeof x> => !!x);
    table.children = shown.filter(x => !x.d.obsolete).map(x => x.c);
    retired.children = shown.filter(x => x.d.obsolete).map(x => x.c);
    retired.visible = retired.children.length > 0;
    for (const c of [...table.children, ...retired.children]) c.constraints = null;
  }
}
