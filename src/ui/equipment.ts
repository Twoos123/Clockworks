// The character window (LoadoutPanel): the status window (ui/status/interface_v2.dat) with
// its tabs, and the game's arsenal (ui/arsenal/interface.dat) docked full height at the
// screen's right edge listing what the knight can put on, the HUD's energy panel under it.
// Item pills' tooltips sit left of the pill (item/client/N), the worn item's beside them.
//
// - Equipment (panel_equipment_v2.dat): the socket column (helmet, armour, shield, two
//   trinkets, four weapons; the fourth weapon slot locked, with its padlock), the gear stats
//   column it folds, and the knight with its rank title, name and prestige. The list shows
//   the saved loadouts and the gear owned; clicking gear opens its item menu, clicking a
//   socket empties it, Save Loadout names what is worn.
// - Costume (panel_costume_v2.dat): the helmet, armour and shield costume sockets. The list
//   shows the costumes and the accessories by location (game/accessories.ts); they change
//   only how the knight looks.
// - Battle Sprite (panel_battlesprite_v2.dat): sockets for the sprite, its harness, its perk
//   and its three skills, each opening its page in the left column: the feeding and level-up
//   panel (interface_battlesprite-hunger.dat), the harnesses, the perks, or a skill's
//   augments (panel_battlesprite-skill.dat). The view shows the sprite with "Level N" and its
//   name, and the notice above it ("Ready to level up!", "Skill points available!"). The list
//   shows the sprites, their food and the evo catalysts (game/sprites.ts through game/outfit.ts).
// - Character Options pops up a menu titled with the knight's name: its name
//   (ui/rename/interface.dat) and the personal colours.
//
// - Achievements (panel_cheevos.dat): an icon per achievement (interface_cheevoicon.dat), its
//   own picture once earned and the lock before, retired ones in the lower table once earned;
//   tooltips give the name and description from the projectx bundle and the progress
//   (game/achievements.ts). The list shows the gear, as on the equipment page.

import { ACHIEVEMENTS, LOCKED_ICON, ONLINE_ONLY, progressText } from "../game/achievements";
import { ACCESSORY_SLOTS, accessoryDef, costumeSlot, loadAccessoryLibraries, type AccessorySlot, type CostumeSlot } from "../game/accessories";
import type { GameData } from "../game/data";
import { MAX_LEVEL, type Economy } from "../game/economy";
import { CATEGORIES, catalogue, isEquipped, itemLabel, unequip, type ItemEntry, type Slot } from "../game/items";
import type { Outfit } from "../game/outfit";
import { energyNow } from "../game/energy";
import { energyOf, knightName, MAX_LOADOUTS, saveLoadout, wearableLoadout, type Loadout, type SaveData, type SavedLoadout } from "../game/save";
import {
  appetite, canEat, foodStars, foodTier, freePoints, MAX_RANK, newProgress, nextLevelRarity, readyToLevel, rechargeOf, requiredItem, spriteTier,
  ultimateReady, unlockedSkills, type SpriteDef, type SpriteProgress,
} from "../game/sprites";
import { validName } from "./createknight";
import { loadoutPill, loadoutTip, wearLoadout } from "./loadouts";
import { messageText, type Component, type Style } from "./gui";
import { itemPreview, itemTip, ItemList, type ListEntry, type ListGroup, type TipBonus } from "./itemlist";
import { applyItemAction, COMPARE, compareTarget, itemMenu, RANK_LIMIT, rankAllows, rankLimitText, SLOT_ICON } from "./itemmenu";
import { itemStats, pillDamage, wornDefense } from "../game/itemstats";
import { styledLabel } from "./floating";
import { freshProgress, rankName } from "../game/missions";
import { message, text as bundleText, xlate } from "../i18n";
import { levelLines, statusLines } from "../game/itemlines";
import { itemFlavor } from "../game/text";
import { buildStats, GuiScreen, row, uiRef, type ScreenHost, type TipSpec, type ViewModel } from "./screen";

const TIP_PLAIN = "ui/window/tooltip.dat";

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

/**
 * Equipment sockets by tag (panel_equipment_v2.dat's Tag1 to Tag9, the client's slot
 * numbers): helmet, armour, shield, two trinkets, four weapons. Each empty socket's tooltip is
 * ItemCodes.bwu's text in the item bundle ("Weapon Slot"); a locked one (LoadoutPanel.e) shows
 * the padlock and the "_locked" text. This port gives three weapon slots and both trinket
 * slots, so the fourth weapon socket stays locked; the vitapod (the client's dungeon gear
 * slot 12, not on this page) is put on from its item menu.
 */
const SOCKETS: { tag: string; slot: Slot; index: number; label: string; tip: string; locked?: boolean }[] = [
  { tag: "slot0", slot: "helmet", index: 0, label: "Helmet", tip: "m.helm_tip" },
  { tag: "slot1", slot: "armor", index: 0, label: "Armor", tip: "m.armor_tip" },
  { tag: "slot2", slot: "shield", index: 0, label: "Shield", tip: "m.shield_tip" },
  { tag: "slot10", slot: "trinket", index: 0, label: "Trinket", tip: "m.trinket_tip" },
  { tag: "slot11", slot: "trinket", index: 1, label: "Trinket", tip: "m.trinket_tip" },
  { tag: "slot6", slot: "weapon", index: 0, label: "Weapon", tip: "m.weapon_tip" },
  { tag: "slot7", slot: "weapon", index: 1, label: "Weapon", tip: "m.weapon_tip" },
  { tag: "slot8", slot: "weapon", index: 2, label: "Weapon", tip: "m.weapon_tip" },
  { tag: "slot9", slot: "weapon", index: 3, label: "Weapon", tip: "m.weapon_tip", locked: true },
];
const LOCK_ICON = "ui/icon/inventory/icon_locked.png";
/** The arsenal docked beside the window (the screens' arsenal key: its HUD button shows pressed). */
const ARSENAL_DOCK = "inventory";
/** Harness.bGJ: the harness every sprite wears until another is installed. */
const DEFAULT_HARNESS = "Iron Harness";

/** Costume sockets (panel_costume_v2.dat's Tag1 to Tag3). */
const COSTUME_SOCKETS: { tag: string; slot: CostumeSlot; label: string }[] = [
  { tag: "slot3", slot: "helmet", label: "Helmet Costume" },
  { tag: "slot4", slot: "armor", label: "Armor Costume" },
  { tag: "slot15", slot: "shield", label: "Shield Costume" },
];

/** What the sprite page's left column shows (LoadoutPanel.SpriteTab): feeding, harnesses, perks or a skill. */
type SpriteFocus = "sprite" | "harness" | "perk" | 0 | 1 | 2;
/** Battle sprite sockets (panel_battlesprite_v2.dat): the sprite, its harness and perk, its three skills. */
const SPRITE_SOCKETS: [string, SpriteFocus][] = [["slot_sprite", "sprite"], ["slot_harness", "harness"], ["slot_perk", "perk"],
  ["slot_attack0", 0], ["slot_attack1", 1], ["slot_attack2", 2]];
/** Sockets whose items this port has no data for: the achievement artifacts. */
const UNUSED_SOCKETS = new Set(["slot_artifactcheevo1", "slot_artifactcheevo2"]);

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
export function ownedTip(save: SaveData, data: GameData, eco: Economy, e: ItemEntry, worn: boolean, compare = true): TipSpec {
  const tip = ownTip(save, data, eco, e, worn);
  // item/client/k: beside the item compared with (chosen, or what is worn of its group)
  const other = compare ? compareTarget(save.loadout, e) : null;
  const oe = other ? catalogue(data).find(x => x.name === other) : null;
  if (oe) tip.compare = ownTip(save, data, eco, oe, isEquipped(save.loadout, oe));
  return tip;
}

function ownTip(save: SaveData, data: GameData, eco: Economy, e: ItemEntry, worn: boolean): TipSpec {
  const heatable = !!eco.info(e.name)?.heatable;
  const g = save.gear[e.name], lv = eco.level(save, e.name);
  // ItemConfig.Level's pills: the weapon's status rows, the unique variants, the level's rows
  const bonuses: TipBonus[] = heatable ? statusLines(data, e.name) : [];
  bonuses.push(...(g?.variants ?? []).map(v => ({ text: eco.variantLabel(v), bonus: true, color: "Variant" })));
  if (heatable) bonuses.push(...levelLines(data, eco, e.name, lv));
  const description = itemFlavor(e.name) || (heatable
    ? `${Math.floor(g?.heat ?? 0)} heat absorbed.${lv >= MAX_LEVEL ? " Fully heated." : eco.forgeReady(save, e.name)
      ? " Ready to level up at the Forge with fire crystals." : " Its heat bar fills in the Clockworks; a full bar levels up at the Forge."}`
    : `${e.category.label.replace(/s$/, "")}.`);
  // ItemConfig.Level.a: gear that binds on equip (lockOnEquip) and is owned says it is bound
  // (m.item_locked), joined to the description by m.compound
  let impl: any = null;
  try { impl = data.resolveSync("config/item.dat", { name: e.name }, "item"); } catch { impl = null; }
  const bound = heatable && impl?.lockOnEquip !== false ? bundleText("item", "m.item_locked", "This item is bound to you.\n") : "";
  const flavor = bound ? (message("item", "m.compound", bound, description) || `${bound}\n${description}`) : description;
  return { ...itemTip({ label: eco.displayName(e.name, g), type: e.category.label.replace(/s$/, ""), rarity: e.rarity, item: undefined, kind: e.category.eco,
    flavor, level: heatable ? lv : undefined, noLevel: e.category.slot === "trinket",
    progress: eco.heatProgress(save, e.name), equipped: worn, bonuses, stats: itemStats(data, eco, e.name, Math.max(1, lv), g?.variants),
    model: itemPreview(data, e.name, save.color), wearable: worn || rankAllows(save, e.rarity), rankText: rankLimitText(e.rarity) }), anchored: 15 };
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
        damage: pillDamage(data, eco, e.name, Math.max(1, lv)), tip: ownedTip(save, data, eco, e, worn), equippable: worn || rankAllows(save, e.rarity) } satisfies ListEntry;
    });
    const key = GROUP_KEY[cat.id];
    groups.push({ id: cat.id, label: key ? messageText(key, "item") : cat.label, icon: cat.icon, entries, showEmpty: !!key });
  }
  // ItemCodes.Group RARITY: fire crystals, orbs of alchemy and the like (Rarity/ tickets)
  for (const g of [{ id: "mineral", key: "m.mineral", icon: CAT + "icon_mineral.png", cats: ["mineral", "deposit"] },
    { id: "material", key: "m.material", icon: CAT + "icon_puzzle.png", cats: ["material"] },
    { id: "rarity", key: "m.rarity", icon: CAT + "icon_rarity.png", cats: [] as string[] }]) {
    const names = Object.keys(save.materials).filter(n => (save.materials[n] ?? 0) > 0
      && (g.id === "rarity" ? /^Rarity\//.test(n) && !!eco.info(n) : g.cats.includes(eco.info(n)?.category ?? "")));
    groups.push({ id: g.id, label: messageText(g.key, "item"), icon: g.icon, showEmpty: true, entries: names.map(n => {
      const it = eco.info(n), count = save.materials[n] ?? 0;
      return { key: `mat:${n}`, label: itemLabel(n), rarity: it?.rarity ?? 0, icon: it?.icon ?? null, count: count > 1 ? String(count) : "",
        tip: itemTip({ label: itemLabel(n), type: messageText(g.key, "item"), rarity: it?.rarity ?? 0, flavor: "", item: n, kind: it?.category, plain: true }) } satisfies ListEntry;
    }) });
  }
  return groups;
}

/** A sprites bundle text from its key ("m.extra_crispy" is "Extra Crispy"; compound keys too). */
const named = (key: string) => { if (!key) return ""; const t = xlate("sprites", key); return t && t !== key ? t : messageText(key, "sprites"); };

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
  /** The sprite page's selection: the sprite (feeding), its harnesses or perks, or a skill (its augments). */
  private focus: SpriteFocus = "sprite";
  /** The sprite page's left column is folded away (its collapse toggle). */
  private spriteFolded = false;
  /** Where the sprite page's notice leads when pressed. */
  private noticeAction: SpriteFocus | null = null;
  /** The arsenal list, docked at the right edge. */
  private arsenalList: Component | null = null;
  /** The harness config every sprite wears here (config/harness.dat's Iron Harness). */
  private harnessCfg: any = null;
  /** The harness and perk pages' contents (built on first showing). */
  private harnessPage: Component | null = null;
  private perkPage: Component | null = null;
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

  /** The tab showing ("achievements" while that page is up). */
  get page(): Mode { return this.mode; }

  /** Turns to a tab (as.Ep: TOGGLE_PROGRESS opens the window on its achievements). */
  async showPage(mode: Mode) {
    const i = TABS.indexOf(mode);
    if (i < 0) return;
    await this.prebuild();
    this.tab = i;
    this.options = false;
    const pane = this.status?.find("tabbed"), opts = this.status?.find("characteroptions");
    if (pane) pane.value = i;
    if (opts) opts.selected = false;
    await this.refresh();
  }

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
    this.list.menu = (e, t, c) => void this.popupMenu(e, t, c);
    // the arsenal docks at the screen's right edge beside the character window; its close
    // button takes only it away
    this.arsenalList = left;
    this.on(left, "dismiss", () => { this.host.sound("sound/feedback/ui_dismiss.ogg"); void this.dock(ARSENAL_DOCK, false, 0, async () => null); });
    this.on(right, "handle", () => this.close());
    this.on(right, "button_saveloadout", () => this.openSaveLoadout());
    // LoadoutPanel (bh): Character Options pops up a menu under the button, titled with the knight's name
    const opts = this.on(right, "characteroptions", () => void this.characterMenu());
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
    for (const s of SOCKETS) { const c = right.find(s.tag); if (c) this.clicks.set(c, () => this.emptySocket(s)); }
    for (const s of COSTUME_SOCKETS) { const c = right.find(s.tag); if (c) this.clicks.set(c, () => void this.takeOffCostume(s.slot)); }
    for (const [tag, f] of SPRITE_SOCKETS) {
      const c = right.find(tag);
      if (c) this.clicks.set(c, () => this.focusOn(f));
    }
    // the sprite page's notice: "Ready to level up!" opens the feeding, "Skill points
    // available!" the first skill with room (LoadoutPanel.n.Fa)
    const notice = this.pages[2]?.find("notice");
    if (notice) this.clicks.set(notice, () => { if (this.noticeAction) this.focusOn(this.noticeAction); });
    const data = this.arsenal.data();
    this.harnessCfg = await data.preload("config/harness.dat").then(() => data.config("config/harness.dat", DEFAULT_HARNESS)).catch(() => null);
    this.prepareSpritePanels();
    const draw = (im: { source: unknown; width: number; height: number } | null, g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
      if (im) g.drawImage(im.source as CanvasImageSource, Math.round(x + (w - im.width) / 2), Math.round(y + (h - im.height) / 2), im.width, im.height);
    };
    const tagged: Record<string, (c: Component, g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void> = {};
    for (const s of SOCKETS) tagged[s.tag] = (_c, g, x, y, w, h) => {
      // LoadoutPanel.e.Fn: a locked slot shows the padlock at 38 pixels
      if (s.locked) { draw(this.icon({ file: LOCK_ICON }, 38), g, x, y, w, h); return; }
      const name = this.socketItem(s), e = name ? this.entry(name) : null;
      draw(e ? this.icon(e.icon, 36) : null, g, x, y, w, h);
    };
    tagged.slot_harness = (_c, g, x, y, w, h) => {
      if (this.activeSprite().def && this.harnessCfg?.icon) draw(this.icon(this.harnessCfg.icon, 38), g, x, y, w, h);
    };
    tagged.required_icon = (_c, g, x, y, w, h) => {
      const { def, p } = this.activeSprite(), req = def && p ? requiredItem(def, p) : null;
      draw(req ? this.icon(this.itemIcon(req), 36) : null, g, x, y, w, h);
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
      const { def, p } = this.activeSprite(), fav = def && p ? requiredItem(def, p) : null;
      draw(fav ? this.icon(this.itemIcon(fav), 36) : null, g, x, y, w, h);
    };
    this.hooks = {
      view: (c, g, x, y, w, h) => { if (c.viewOwner !== "icon") this.host.view?.(c, g, x, y, w, h, this.viewModel(c)); },
      tagged,
    };
    // the arsenal stands full height at the right edge with the energy panel under it, as by
    // the forge and the shops (client/g)
    this.tallDocks = true;
    this.energy = () => energyNow(energyOf(this.arsenal.save()));
    return right;
  }

  async open() {
    await super.open();
    const list = this.arsenalList;
    if (list && this.isOpen) await this.dock(ARSENAL_DOCK, true, 0, async () => ({ ui: list, refresh: () => {} }));
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
    // a locked socket's padlock stands in for its category icon
    for (const s of SOCKETS) if (s.locked) { const b = this.socketBacking(page, s.tag); if (b) b.alpha = 0; }
    // the notice (a FadeLabel): the locked-in-town notice never applies here (windows open
    // only where gear can change); the sprite page shows its own (LoadoutPanel.n.Fa)
    const notice = page.find("notice");
    if (notice) { notice.visible = index === 2; notice.alpha = 0; }
  }

  /**
   * The battle sprite page's left column (LoadoutPanel.a.b: left_cont's scroll_cont, folded
   * by the toggle beside the sockets): the feeding panel, the harnesses, the perks or a
   * skill's augments, as the sockets choose.
   */
  private prepareSpritePanels() {
    const page = this.pages[2];
    if (!page) return;
    this.spritePane = page.find("scroll_cont");
    const toggle = page.find("toggle_collapseleft"), left = page.find("left_cont");
    if (toggle && left) toggle.onAction = c => {
      this.spriteFolded = !!c.selected;
      left.visible = !this.spriteFolded;
      this.host.sound("sound/feedback/ui_dropdown_select.ogg");
    };
    const h = this.hunger, s = this.skill;
    if (h) {
      const req = h.find("required_icon");
      // drawn as an icon by the tagged hook, not as a 3D view
      if (req) req.viewOwner = "icon";
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
    }
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
    if (s.locked) return "";
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
    if (item) this.gearMenu(item).catch(err => console.error("item menu failed", err));
  }

  /** ArsenalPanel.a: a press on gear pops up its item menu (src/ui/itemmenu.ts). */
  private async gearMenu(item: ItemEntry) {
    const save = this.arsenal.save(), outfit = this.arsenal.outfit();
    // the menu opens at once; the slot icons are put in as they load
    const entries = itemMenu(save, outfit.appearance.costume, item).map(m => ({ action: m.action, text: m.text, enabled: m.enabled,
      icon: m.slot === undefined ? null : m.item ? this.iconImage(this.itemIcon(m.item), 25)
        : this.styleImage("Status/Equip Socket/Backing, Icon", { File: CAT + SLOT_ICON[m.slot] }, 25) }));
    await this.popupMenu(entries, this.eco?.displayName(item.name, save.gear[item.name]) ?? item.label, a => void this.gearAction(item, a));
  }

  private async gearAction(item: ItemEntry, action: string) {
    const r = applyItemAction(this.arsenal.save(), item, action);
    if (r?.loadout) { this.host.sound("sound/feedback/ui_equip.ogg"); this.arsenal.equipped(r.loadout); }
    if (r?.costume) { this.host.sound("sound/feedback/ui_equip.ogg"); await this.arsenal.outfit().equipCostume(r.costume[0], r.costume[1]); }
    void this.refresh();
  }

  /** The windows' compare choices last while they are open (item/client/f clears M.buL). */
  close() { COMPARE.clear(); super.close(); }

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
    const tip = loadoutTip(this.arsenal.save(), this.eco, n => this.itemIcon(n), l.name, l.loadout, l.appearance.costume, l.sprite);
    return { ...tip, texts: { tooltip_type: "Click to wear this loadout" } };
  }

  private wearLoadout(i: number) {
    const save = this.arsenal.save(), l = save.loadouts?.[i];
    if (!l) return;
    this.host.sound("sound/feedback/ui_equip.ogg");
    void wearLoadout(save, this.arsenal.outfit(), l, x => this.arsenal.equipped(x)).then(() => this.refresh());
  }

  /** A name entry window over the status window (ui/rename/interface.dat). */
  private async nameWindow(o: { title: string; lines: string[]; value: string; button?: string; accept: (name: string) => string | null }) {
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
    if (ok) { ok.onAction = accept; if (o.button) ok.text = o.button; }
    if (field) field.onAction = (_c, a) => { if (a === "enter") accept(); };
    const dismiss = w.find("dismiss");
    if (dismiss) dismiss.onAction = () => { this.host.sound("sound/feedback/ui_dismiss.ogg"); close(); };
    this.overlays.push(w);
  }

  /**
   * bH.k: Save Loadout asks for a name (client/ui/z: "Save Loadout", an empty 20-letter field,
   * Cancel and Save) and saves what is worn under it.
   */
  private openSaveLoadout() {
    const save = this.arsenal.save();
    void this.nameWindow({
      title: bundleText("projectx", "m.save_loadout", "Save Loadout"), value: "", lines: [],
      button: bundleText("projectx", "m.save", "Save"),
      accept: name => {
        const t = name.trim();
        if (!t) return "Give the loadout a name.";
        if (!saveLoadout(save, t, save.sprites?.active ?? "")) return `You have ${MAX_LOADOUTS} loadouts: save over one of their names.`;
        this.arsenal.write();
        return null;
      },
    });
  }

  /**
   * bh, client/cr: Character Options pops up a menu under the button titled with the knight's
   * name. The client's own list is empty in this build; this port puts its name and personal
   * colour choices there (the colours open in the arsenal list).
   */
  private async characterMenu() {
    this.host.sound("sound/feedback/ui_dropdown_select.ogg");
    await this.popupMenu([
      { action: "rename", text: "Change Name", enabled: true },
      { action: "color", text: "Personal Color", enabled: this.arsenal.colors().length > 0 },
    ], knightName(this.arsenal.save()), a => {
      if (a === "rename") this.openRename();
      if (a === "color") { this.options = true; void this.refresh(); }
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

  /** BattleSprite.ac: the sprite family's name ("Drakon"). */
  private spriteFamily(def: SpriteDef): string { return (def.spriteName && named(def.spriteName)) || def.name; }

  /** A skill's name, icon and text: its ultimate's once chosen (BattleSprite.h). */
  private skillLabel(def: SpriteDef, p: SpriteProgress, i: number) {
    const s = def.skills[i], u = p.ultimates[i];
    return (u === "A" ? s?.ultimateLabels[0] : u === "B" ? s?.ultimateLabels[1] : null) ?? s?.label ?? { name: "", icon: null, desc: "" };
  }

  /** The harness's recharge modifier (HarnessConfig.rechargeModifier). */
  private get harnessModifier(): number { return Number(this.harnessCfg?.rechargeModifier ?? 1) || 1; }

  /** LoadoutPanel.a(ctx, sprite, skill, anchor) (bf): a skill socket's tooltip. */
  private skillTip(def: SpriteDef, p: SpriteProgress, i: number): TipSpec {
    const l = this.skillLabel(def, p, i);
    return { anchored: 15, ref: uiRef(TIP_PLAIN, { Name: named(l.name), Type: bundleText("sprites", "m.skill", "Skill").toUpperCase(), Body: named(l.desc),
      Flavor: message("projectx", "m.pet_skillcooldown", rechargeOf(def, p, i, this.harnessModifier)) || `Cooldown: ${rechargeOf(def, p, i, this.harnessModifier)} seconds`,
      Rarity: "-1" }) };
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

  /** A socket press (LoadoutPanel.h.Fs): its page in the left column, which unfolds. */
  private focusOn(f: SpriteFocus) {
    const { def, p } = this.activeSprite();
    if (!def || !p) return;
    if (typeof f === "number" && f >= unlockedSkills(p.level)) { this.host.sound("sound/feedback/ui_dismiss.ogg"); return; }
    const left = this.pages[2]?.find("left_cont"), toggle = this.pages[2]?.find("toggle_collapseleft");
    this.spriteFolded = false;
    if (left) left.visible = true;
    if (toggle) toggle.selected = false;
    if (f === this.focus) return;
    this.focus = f;
    this.pending = [0, 0, 0];
    this.spriteMessage = "";
    this.host.sound("sound/feedback/ui_dropdown_select.ogg");
    void this.refresh();
  }

  /** FEED SPRITE or LEVEL UP! (LoadoutPanel.f, br): the chosen item goes to the sprite. */
  private feed() {
    const { def, p } = this.activeSprite();
    if (!def || !p || !this.food) return;
    const roster = this.arsenal.outfit().sprites;
    if (readyToLevel(p)) {
      if (!roster.levelUp(this.food)) {
        this.spriteMessage = bundleText("projectx", "e.wrong_level_item", "Must use required item to level up!");
        this.host.sound("sound/feedback/ui_dismiss.ogg");
        void this.refresh();
        return;
      }
      const after = roster.active();
      this.spriteMessage = message("sprites", "m.leveled_up") ? `${bundleText("sprites", "m.leveled_up", "Leveled Up")}: ${message("sprites", "m.level", (after?.level ?? 0) + 1)}` : "";
      this.host.sound("sound/feedback/ui_confirm.ogg");
    } else {
      const err = roster.feed(this.food);
      if (err) {
        this.spriteMessage = bundleText("projectx", err, err === "e.not_enough_appetite" ? "Not enough appetite to consume this item." : "");
        this.host.sound("sound/feedback/ui_dismiss.ogg");
        void this.refresh();
        return;
      }
      this.spriteMessage = "";
      this.host.sound("sound/feedback/ui_equip.ogg");
    }
    // LoadoutPanel.f (bp): the slot empties once the sprite has eaten
    this.food = "";
    void this.refresh();
  }

  private addPoint(power: number) {
    const { p } = this.activeSprite(), i = this.focus;
    if (!p || typeof i !== "number") return;
    const left = freePoints(p) - this.pending.reduce((a, b) => a + b, 0);
    if (i >= unlockedSkills(p.level) || left <= 0 || p.ranks[i][power] + this.pending[power] >= MAX_RANK) { this.host.sound("sound/feedback/ui_dismiss.ogg"); return; }
    this.pending[power]++;
    this.host.sound("sound/feedback/ui_dropdown_select.ogg");
    void this.refresh();
  }

  private confirmPoints() {
    const i = this.focus;
    if (typeof i !== "number") return;
    const roster = this.arsenal.outfit().sprites;
    for (let j = 0; j < 3; j++) for (let k = 0; k < this.pending[j]; k++) roster.spend(i, j);
    this.pending = [0, 0, 0];
    this.host.sound("sound/feedback/ui_confirm.ogg");
    void this.refresh();
  }

  /** The ultimate choice (interface_battlesprite-ultimate.dat) for the focused skill, once BattleSprite.fI allows it. */
  private async openUltimate() {
    const { def, p } = this.activeSprite(), i = this.focus;
    if (!def || !p || typeof i !== "number" || !ultimateReady(p, i)) return;
    const o = await this.ui(ULTIMATE);
    if (!o) return;
    const s = def.skills[i];
    for (const [k, label] of [["a", s.ultimateLabels[0]], ["b", s.ultimateLabels[1]]] as const) {
      const set = (tag: string, text: string) => { const c = o.find(tag); if (c) c.text = text; };
      set(`label_ult_${k}_name`, named(label?.name ?? "") || `Ultimate ${k.toUpperCase()}`);
      set(`label_ult_${k}_description`, named(label?.desc ?? ""));
      const icon = o.find(`icon_ult_${k}`);
      if (icon && label?.icon?.file) { const st = await this.restyle(icon, { File: label.icon.file }); if (st) icon.styles = icon.styles.map(() => st); }
      const b = o.find(`button_ult_${k}`);
      if (b) b.onAction = () => {
        this.arsenal.outfit().sprites.ultimate(i, k.toUpperCase() as "A" | "B");
        this.host.sound("sound/feedback/ui_confirm.ogg");
        this.overlays = this.overlays.filter(x => x !== o);
        void this.refresh();
      };
    }
    const status = o.find("status");
    if (status) status.visible = false;
    const view = o.find("preview_render");
    if (view) view.viewOwner = "sprite";
    const dismiss = o.find("dismiss");
    if (dismiss) dismiss.onAction = () => { this.overlays = this.overlays.filter(x => x !== o); this.host.sound("sound/feedback/ui_dismiss.ogg"); };
    this.overlays.push(o);
  }

  /** LoadoutPanel.dZ: a title in the left column ("HARNESSES", "PERKS"). */
  private async columnTitle(text: string, page: Component): Promise<Component | null> {
    const t = await styledLabel(this.ctx, text.toUpperCase(), "Status/Gear Stats/Title", page.local);
    if (t) { t.constraints = null; t.preferredSize = { width: 180, height: -1 }; }
    return t;
  }

  /** LoadoutPanel.i: the harnesses (only the Iron Harness here, worn). */
  private async buildHarnessPage(page: Component): Promise<Component> {
    const box = row([], 0);
    box.layout = { $class: "LayoutConfig$VerticalGroup", policy: { name: "NONE" }, justification: { name: "TOP" }, offAxisPolicy: { name: "STRETCH" }, offAxisJustification: { name: "LEFT" }, gap: 0 };
    const kids: Component[] = [];
    const title = await this.columnTitle(bundleText("projectx", "t.harnesses", "HARNESSES"), page);
    if (title) kids.push(title);
    const h = this.harnessCfg;
    if (h) {
      const pill = await this.ui("ui/hud_v2/parts/interface_itempill.dat", { Name: messageText(String(h.harnessName ?? ""), "sprites") || DEFAULT_HARNESS,
        Icon: h.icon?.file ?? null, Colorization: h.icon?.colorizations ?? [], Damage: "Default", "Damage (Secondary)": "Default", "Rank Visible": false,
        Variants: "-1", Accessory: false, Equipped: "False", Locked: "Hidden" });
      if (pill) {
        const sel = pill.find("entryselect");
        if (sel) sel.selected = true;
        this.tips.set(pill, this.harnessTip());
        pill.constraints = null;
        kids.push(pill);
      }
    }
    box.children = kids;
    for (const k of kids) k.constraints = null;
    return box;
  }

  /** bd: the harness tooltip (tooltip.dat: its name, "HARNESS", its text). */
  private harnessTip(): TipSpec {
    const h = this.harnessCfg;
    return { anchored: 15, ref: uiRef(TIP_PLAIN, { Name: messageText(String(h?.harnessName ?? ""), "sprites") || DEFAULT_HARNESS,
      Type: bundleText("sprites", "m.harness", "Harness"), Body: "", Flavor: messageText(String(h?.desc ?? ""), "sprites"), Rarity: "-1" }) };
  }

  /** LoadoutPanel.k: the perks (a sprite earns them past level 100, which this port does not model). */
  private async buildPerkPage(page: Component): Promise<Component> {
    const box = row([], 0);
    box.layout = { $class: "LayoutConfig$VerticalGroup", policy: { name: "NONE" }, justification: { name: "TOP" }, offAxisPolicy: { name: "STRETCH" }, offAxisJustification: { name: "LEFT" }, gap: 0 };
    const title = await this.columnTitle(bundleText("projectx", "t.perks", "PERKS"), page);
    box.children = title ? [title] : [];
    return box;
  }

  /** Fills the sprite page: names, notice, sockets' tooltips and the left column. */
  private async fillSprite() {
    const page = this.pages[2], pane = this.spritePane, h = this.hunger, s = this.skill;
    if (!page || !pane || !h || !s) return;
    const { def, p } = this.activeSprite();
    if (!def || !p) this.focus = "sprite";
    const save = this.arsenal.save(), now = Date.now();
    const set = (root: Component, tag: string, text: string) => { const c = root.find(tag); if (c) c.text = text; return c; };
    // LoadoutPanel.n.Fb: the view names the sprite and its level; no prestige
    set(page, "label_playername", def ? this.spriteFamily(def) : "");
    set(page, "label_playerrank", p ? message("sprites", "m.level", p.level + 1) || `Level ${p.level + 1}` : "");
    const prestige = page.find("label_prestige");
    if (prestige) prestige.visible = false;
    // LoadoutPanel.n.Fa: the notice
    const notice = page.find("notice");
    this.noticeAction = null;
    if (notice) {
      let text = "";
      if (def && p && readyToLevel(p)) { text = bundleText("projectx", "m.can_level_up", "Ready to level up!"); this.noticeAction = "sprite"; }
      else if (def && p && freePoints(p) > 0) {
        text = bundleText("projectx", "m.available_skill_points", "Skill points available!");
        const i = [0, 1, 2].find(k => k < unlockedSkills(p.level) && !p.ultimates[k] && p.ranks[k].reduce((a, b) => a + b, 0) < 3 * MAX_RANK);
        this.noticeAction = (i ?? 0) as 0 | 1 | 2;
      }
      notice.text = text;
      notice.alpha = text ? 1 : 0;
    }
    // the sockets' tooltips
    const sock = (tag: string, tip: TipSpec | null) => { const c = page.find(tag); if (c) { if (tip) this.tips.set(c, tip); else this.tips.delete(c); } };
    sock("slot_sprite", def && p ? this.spriteTip(def, p) : null);
    sock("slot_harness", def && this.harnessCfg ? this.harnessTip() : null);
    sock("slot_perk", null);
    for (let i = 0; i < 3; i++) {
      const unlocked = !!def && !!p && i < unlockedSkills(p.level);
      const backing = this.socketBacking(page, `slot_attack${i}`);
      // a locked skill's socket shows the padlock backing (panel_battlesprite_v2's Icon7 to 9)
      if (backing) backing.alpha = unlocked ? 0 : 1;
      sock(`slot_attack${i}`, unlocked ? this.skillTip(def!, p!, i) : null);
    }
    // the left column
    const left = page.find("left_cont"), toggle = page.find("toggle_collapseleft");
    if (toggle) { toggle.visible = !!def; toggle.selected = this.spriteFolded || !def; }
    if (left) left.visible = !!def && !this.spriteFolded;
    let panel: Component | null = this.focus === "sprite" ? h : typeof this.focus === "number" ? s : null;
    if (this.focus === "harness") panel = this.harnessPage ??= await this.buildHarnessPage(page);
    if (this.focus === "perk") panel = this.perkPage ??= await this.buildPerkPage(page);
    if (panel && pane.children[0] !== panel) { panel.constraints = null; pane.children = [panel]; }
    if (!def || !p) return;
    if (this.focus === "sprite") this.fillHunger(h, def, p, save, now);
    else if (typeof this.focus === "number") await this.fillSkill(s, def, p, this.focus);
  }

  /** item/client/a: the sprite socket's tooltip (tooltip_level.dat with its level, heat and form). */
  private spriteTip(def: SpriteDef, p: SpriteProgress, worn = true): TipSpec {
    const family = this.spriteFamily(def);
    const type = worn ? message("item", "m.equipped", family) || `Equipped ${family}` : family;
    const model = def.models[spriteTier(p.level) - 1];
    return { anchored: 15, model: model ? uiRef("item/preview/model_pet.dat", { Model: model }) : undefined,
      ref: uiRef("ui/window/tooltip_level.dat", { Type: type.toUpperCase(), Name: family.toUpperCase(), Flavor: def.desc ? messageText(def.desc, "sprites") : "",
        Level: String(p.level + 1).padStart(2, "0"), Heat: 16 + Math.trunc(p.heat * 104), Rarity: String(foodTier(p.level)), Equipped: worn ? "True" : "False" }) };
  }

  /** LoadoutPanel.f.Fb: the feeding panel. */
  private fillHunger(h: Component, def: SpriteDef, p: SpriteProgress, save: SaveData, now: number) {
    const set = (tag: string, text: string) => { const c = h.find(tag); if (c) c.text = text; return c; };
    set("type", this.spriteFamily(def).toUpperCase());
    set("tooltip_level", String(p.level + 1).padStart(2, "0"));
    const bar = h.find("tooltip_heat");
    if (bar) bar.preferredSize = { width: Math.max(1, Math.round(120 * p.heat)), height: bar.preferredSize?.height ?? -1 };
    // ArsenalPanel.a: the appetite's five pips
    const pips = Math.floor(appetite(p, now) * 5);
    for (let k = 0; k < 5; k++) { const pip = h.find(`spacer_pip${k}`); if (pip) pip.visible = k < pips; }
    const ready = readyToLevel(p), req = requiredItem(def, p), reqName = req ? itemLabel(req) : "";
    const fav = h.find("favored"), required = h.find("required");
    if (fav) fav.visible = !ready && p.heat < 1 && !!req;
    if (required) required.visible = ready && !!req;
    set("favored_name", reqName);
    set("required_name", reqName);
    const feed = h.find("button_feed");
    const count = this.food ? save.materials[this.food] ?? 0 : 0;
    const rankOk = rankAllows(save, nextLevelRarity(p));
    // the status: what went wrong last, else what to do
    let status = this.spriteMessage;
    if (!status) {
      if (ready && !rankOk) {
        const need = RANK_LIMIT[nextLevelRarity(p)];
        status = message("projectx", "e.need_higher_rank", need ? `${need[0]}-${need[1]}` : "") || "Must be a higher rank to level up!";
      } else if (ready && this.food && this.food !== req) status = bundleText("projectx", "e.wrong_level_item", "Must use required item to level up!");
      else if (!ready && this.food && !canEat(p, now)) status = bundleText("projectx", "e.not_enough_appetite", "Not enough appetite to consume this item.");
      else if (ready && reqName) status = message("projectx", "m.required_description", reqName) || `Select a ${reqName} to level up.`;
      else status = bundleText("projectx", "m.petfood_description", "Select any material from your Arsenal to feed your Sprite.");
    }
    set("status", status);
    if (feed) {
      feed.text = ready ? bundleText("projectx", "m.level_up", "LEVEL UP!") : bundleText("projectx", "m.feed_sprite", "FEED SPRITE");
      feed.enabled = !!this.food && count > 0 && (ready ? this.food === req && rankOk : p.heat < 1 && canEat(p, now));
    }
  }

  /** LoadoutPanel.m.Fb: a skill's page. */
  private async fillSkill(s: Component, def: SpriteDef, p: SpriteProgress, i: number) {
    const set = (root: Component, tag: string, text: string) => { const c = root.find(tag); if (c) c.text = text; return c; };
    const show = (tag: string, on: boolean) => { const c = s.find(tag); if (c) c.visible = on; };
    const sk = def.skills[i], label = this.skillLabel(def, p, i), ult = !!p.ultimates[i];
    show("top_divider", !ult);
    show("label_availableskillpoints", !ult);
    show("container_skillstats", !ult);
    show("ult_divider", ult);
    show("ult_header", ult);
    show("ult_description", ult);
    show("status", false);
    set(s, "label_skillname", named(label.name));
    const icon = s.find("spacer_icon");
    if (icon && label.icon?.file) { const st = await this.restyle(icon, { File: label.icon.file }); if (st) icon.styles = icon.styles.map(() => st); }
    // BattleSprite.g: the cooldown of what is confirmed, harness included
    const secs = rechargeOf(def, p, i, this.harnessModifier);
    set(s, "label_cooldown", message("projectx", "m.pet_skillcooldown", secs) || `Cooldown: ${secs} seconds`);
    const ultButton = s.find("button_selectultimate");
    if (ult) {
      for (const tag of ["button_cancel", "button_confirm"]) show(tag, false);
      if (ultButton) ultButton.visible = false;
      set(s, "ult_description", named(label.desc));
      set(s, "label_description", named(sk?.label.desc ?? ""));
      return;
    }
    set(s, "label_description", named(label.desc));
    const pendingSum = this.pending.reduce((a, b) => a + b, 0), left = freePoints(p) - pendingSum;
    set(s, "label_availableskillpoints", message("projectx", "m.pet_skillpoints", left) || `Skill Points: ${left}`);
    for (let j = 0; j < 3; j++) {
      const bar = s.find(`skill${j}`);
      if (!bar) continue;
      const power = sk?.powers[j], rank = p.ranks[i][j], add = this.pending[j];
      set(bar, "title", named(power?.name ?? ""));
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
      if (up) up.enabled = rank + add < MAX_RANK && left > 0;
      // bg: the power's tooltip on the bar and its button (by the mouse, after half a second)
      const tip: TipSpec = { ref: uiRef(TIP_PLAIN, { Name: named(power?.name ?? ""), Type: bundleText("sprites", "m.skill_power", "Skill Power").toUpperCase(),
        Body: named(power?.desc ?? ""), Flavor: "", Rarity: "-1" }) };
      this.tips.set(bar, tip);
      if (up) this.tips.set(up, tip);
    }
    const full = p.ranks[i].reduce((a, b) => a + b, 0) >= 3 * MAX_RANK;
    for (const tag of ["button_cancel", "button_confirm"]) { const c = s.find(tag); if (c) { c.visible = !full; c.enabled = pendingSum > 0; } }
    if (ultButton) { ultButton.visible = ultimateReady(p, i) && !!(sk?.ultimateA || sk?.ultimateB); ultButton.enabled = true; }
  }

  // ------------------------------------------------------------------ the lists

  private gearGroups(): ListGroup[] {
    const save = this.arsenal.save(), l = save.loadout;
    const groups: ListGroup[] = [];
    const saved = save.loadouts ?? [];
    if (saved.length) groups.push({ id: "loadouts", label: "Loadouts", icon: CAT + "icon_equippable.png", entries: saved.map((s, i) => {
      const worn = JSON.stringify(wearableLoadout(save, s)) === JSON.stringify(l);
      return { key: `loadout:${i}`, label: s.name, rarity: -1, icon: null, look: worn ? "True" : "False", tip: this.loadoutTip(s),
        ui: loadoutPill(s.name, wearableLoadout(save, s), n => Math.max(0, this.eco?.info(n)?.rarity ?? 0), worn) } satisfies ListEntry;
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
      const def = this.defs.get(n)!, p = save.sprites?.sprites[n] ?? newProgress(n), worn = n === active;
      return { key: `sprite:${n}`, label: this.spriteFamily(def), rarity: foodTier(p.level), icon: def.icons[spriteTier(p.level) - 1], look: worn ? "True" : "False",
        tip: this.spriteTip(def, p, worn) };
    }) });
    const { def: active_, p: ap } = this.activeSprite(), req = active_ && ap ? requiredItem(active_, ap) : null;
    const foods = Object.keys(save.materials).filter(n => /^Food\//.test(n) && foodStars(n) > 0 && (save.materials[n] ?? 0) > 0).sort();
    const fav = active_?.food ?? [];
    if (foods.length) groups.push({ id: "food", label: "Sprite Food", icon: CAT + "icon_sprite.png", entries: foods.map(n => ({
      key: `food:${n}`, label: itemLabel(n), rarity: foodStars(n) - 1, icon: this.itemIcon(n), look: this.food === n ? "True" : "False",
      count: String(save.materials[n]),
      tip: itemTip({ label: itemLabel(n), type: "Sprite Food", rarity: foodStars(n) - 1, flavor: `${n === req ? "Your sprite's favored item. " : fav.includes(n) ? "Your sprite's favourite. " : ""}Click to put it in the feeding slot.` }),
    })) });
    // the evo catalysts a sprite needs to reach levels 15, 50, 90, 95 and 100
    const catalysts = Object.keys(save.materials).filter(n => /^Rarity\/Evo Catalyst\//.test(n) && (save.materials[n] ?? 0) > 0).sort();
    if (catalysts.length) groups.push({ id: "catalyst", label: messageText("m.rarity", "item"), icon: CAT + "icon_rarity.png", entries: catalysts.map(n => ({
      key: `food:${n}`, label: itemLabel(n), rarity: Math.max(0, this.eco?.info(n)?.rarity ?? 0), icon: this.itemIcon(n), look: this.food === n ? "True" : "False",
      count: String(save.materials[n]),
      tip: itemTip({ label: itemLabel(n), type: messageText("m.rarity", "item"), rarity: Math.max(0, this.eco?.info(n)?.rarity ?? 0), flavor: "", item: n }),
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
      equipment: ["Equipment", "Click gear for its menu: equip it to a slot or compare it; click a socket to empty it. Changes are worn from the next floor."],
      costume: ["Costumes", "Costumes and accessories change how your knight looks, not its stats. Search for one by name."],
      sprite: ["Battle Sprite", "Pick the sprite to take along and feed it sprite food. Click a skill socket to spend its points."],
      achievements: ["Achievements", "Achievements earned on this machine. Point at one to see what it asks and how far along you are."],
      options: ["Character Options", "Change your knight's name or personal color."],
    };
    this.list.setNotice("");
    this.list.setInfo("ARSENAL", info[mode][0], info[mode][1], save.crowns);
    // the energy shows in the HUD's energy panel under the docked arsenal (this.energy)
    this.list.setEnergy(null);
    const groups = mode === "equipment" || mode === "achievements" ? this.gearGroups() : mode === "costume" ? await this.costumeGroups()
      : mode === "sprite" ? this.spriteGroups() : this.optionGroups();
    // LoadoutPanel takes the battle sprite tab away while the knight has no sprite
    const spriteTab = this.status.find("tabbed")?.parts.buttons?.children[2];
    if (spriteTab) spriteTab.visible = this.arsenal.outfit().ownedSprites().length > 0;
    // the gear list sorts as the client's arsenal does; the other pages keep their own order
    this.list.sorts = mode === "equipment" || mode === "achievements" ? ["natural", "name", "stars", "level"] : [];
    await this.list.setGroups(groups);
    // the status window: names on every page, then each page's sockets
    for (const [i, page] of this.pages.entries()) {
      // the battle sprite page names the sprite instead (fillSprite)
      if (i === 2) continue;
      const set = (tag: string, text: string) => { const c = page.find(tag); if (c) c.text = text; };
      set("label_playername", knightName(save));
      // LoadoutPanel.j: the mission bundle's rank title with the rank ("Vanguard(10-3)"), and the prestige
      const m = save.missions ?? freshProgress();
      set("label_playerrank", `${rankName(m.rank)}(${m.rank}-${m.subrank})`);
      set("label_prestige", m.prestige.toLocaleString("en-US"));
    }
    const st = this.status;
    // LoadoutPanel.EZ: the title names the saved loadout the knight is wearing (the last that
    // matches, as the loadout pills mark it), else the config's "<Current Equipment>"; Save
    // Loadout is enabled only while what is worn is not a saved loadout
    const title = st.find("label_currentloadout");
    const wearing = (save.loadouts ?? []).filter(x => JSON.stringify(wearableLoadout(save, x)) === JSON.stringify(save.loadout)).at(-1);
    if (title) { this.currentTitle ??= title.text; title.text = wearing ? wearing.name : this.currentTitle; }
    const saveButton = st.find("button_saveloadout");
    if (saveButton) saveButton.enabled = !wearing;
    for (const s of SOCKETS) {
      const c = st.find(s.tag);
      if (!c) continue;
      const name = this.socketItem(s), e = name ? this.entry(name) : null;
      // LoadoutPanel.e: a worn item's tooltip beside the socket; an empty socket names its slot
      // (Fm: ItemCodes.bwu's text, "_locked" for a locked one)
      if (e) this.tips.set(c, { ...ownedTip(save, this.arsenal.data(), this.eco!, e, true, false), anchored: 15 });
      else this.tips.set(c, { ref: null, text: bundleText("item", s.tip + (s.locked ? "_locked" : ""), `${s.label} Slot${s.locked ? " (Locked)" : ""}`) });
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
    await this.fillSprite();
    await this.fillAchievements();
    await this.fillGearStats();
  }

  /** The status window title's own text ("<Current Equipment>"). */
  private currentTitle: string | null = null;

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
    const def = wornDefense(data, eco, [l.helmet, l.armor, ...l.trinkets, l.vitapod].filter(Boolean).map(n => ({ name: n, level: lv(n), variants: save.gear[n]?.variants })));
    if (def) parts.push(...await buildStats(this.ctx, def));
    for (const w of l.weapons.filter(Boolean)) {
      parts.push(await title(eco.displayName(w, save.gear[w])));
      const st = itemStats(data, eco, w, lv(w), save.gear[w]?.variants);
      if (st) parts.push(...await buildStats(this.ctx, st));
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
      // client/a.a.update: hidden (retired) achievements show once earned
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
      // client/c: tooltip.dat with the name and description (the type only for hidden ones),
      // no stars, beside the icon 24 pixels in; the progress lines are this port's
      this.tips.set(cell.c, { anchored: 24, lines, ref: uiRef(TIP_PLAIN, { Type: d.hidden ? bundleText("projectx", "s.hidden", "Hidden") : "",
        Name: messageText(d.nameKey, "projectx"), Body: messageText(d.descKey, "projectx"), Flavor: "", Rarity: "-1" }) });
      return { d, c: cell.c };
    }));
    const shown = cells.filter((x): x is NonNullable<typeof x> => !!x);
    table.children = shown.filter(x => !x.d.obsolete).map(x => x.c);
    retired.children = shown.filter(x => x.d.obsolete).map(x => x.c);
    retired.visible = retired.children.length > 0;
    for (const c of [...table.children, ...retired.children]) c.constraints = null;
  }
}
