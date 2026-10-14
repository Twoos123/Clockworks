// The mission board: the game's missions (src/game/missions.ts) in the game's own mission
// window (rsrc/ui/mission/interface.dat), drawn on its own canvas like the other windows.
// The category buttons pick rank, prestige or operations (expansion) missions; five cards
// (ui/mission/parts/interface_cards.dat) show at a time with the arrows paging; the chosen
// card's briefing and mission panes give its summary, status, needs, rewards (the prestige
// pill and item pills) and the action. A finished mission shows the game's mission complete
// window (ui/mission/parts/part_missioncomplete.dat) with the rank up line; a conversation
// mission shows its briefing in the game's confirmation prompt.

import { CONFIG_REF } from "../config/params";
import type { GameData } from "../game/data";
import type { Floor, Gate, StratumTheme } from "../game/clockworks";
import {
  canExchange, completeMission, crownReward, daysUntilActive, exchangeNeeds, freshProgress, hubMissions, isGear, missionRun, missionStatus,
  npcName, parseMissions, rankLabel, rankName, rewardItems, weeklyPrestige, withName, type Ingredient, type Mission, type MissionProgress,
  type MissionStatus,
} from "../game/missions";
import { knightName, type SaveData } from "../game/save";
import { loadConversation, type Conversation } from "../game/conversation";
import { SpawnTables } from "../game/spawntable";
import { logFeed } from "../game/feed";
import { itemName } from "../game/text";
import { message, text } from "../i18n";
import { buildComponentConfig, Component, restyle, type GuiContext, type GuiImage } from "./gui";
import { notice } from "./notice";
import { buildUi, GuiScreen, uiRef } from "./screen";

export { notice };

/** What the board needs from the game. */
export interface MissionHost {
  data: GameData;
  gui: GuiContext;
  save(): SaveData;
  write(): void;
  sound(file: string): void;
  /** Plays a looping stream over the music at a gain; the function returned fades it out. */
  stream?(file: string, gain: number): (fadeOut?: number) => void;
  /** The exchange pane's TOGGLE ARSENAL: opens or closes the arsenal over the board. */
  toggleArsenal?(): Promise<void> | void;
  /** True while the arsenal is open. */
  arsenalOpen?(): boolean;
  /** The crafting tutorial's Craft Items: the forge (the game's servers craft them for the knight). */
  openForge?(): void;
  /** Pauses the game while the board is open. */
  pause(on: boolean): void;
  /** Starts a mission's floors through the gate descent. */
  startRun(gate: Gate, floors: Floor[]): void;
  /** Opens the Arcade's gate board (prestige gate missions are played there). */
  openGates(): void;
  /** A mission was completed (sprite missions give the knight its battle sprite). */
  completed?(m: Mission): void;
}

const LIBS = ["config/mission.dat", "config/mission_property.dat", "config/recipe.dat", "config/spawn_table.dat", "config/item.dat"];
type Tab = "rank" | "prestige" | "operations";

const WINDOW = "ui/mission/interface.dat";
const CARD = "ui/mission/parts/interface_cards.dat";
const COMPLETE = "ui/mission/parts/part_missioncomplete.dat";
const RANKUP = "ui/mission/parts/interface_rankup.dat";
const PRESTIGE_PILL = "ui/mission/parts/interface_prestigepill.dat";
const PILL = "ui/recipes/parts/pill_recipe/interface.dat";
const MATERIAL = "ui/recipes/parts/material/interface.dat";
const PROMPT = "ui/window/confirm_prompt/interface.dat";
const EXCHANGE = "ui/mission/interface_exchange.dat";
const SPECIAL = "ui/recipes/parts/special/interface.dat";
const MUSIC = "sound/music/mission_ui.ogg";
/** ProjectXPrefs.ConfirmPrompt.MISSION_INTRO: show the intro page when the board opens (on by default). */
const INTRO_PREF = "clyde-web-pref-mission_intro";
/** MissionPanel.g: the categories other than rank, the mission that opens each, and its intro text's name. */
const UNLOCKS: [Tab | "arcade", string, string][] = [["prestige", "prestigious_opportunity", "prestige"], ["arcade", "reporting_duty", "arcade"], ["operations", "pioneers", "expansion"]];
/** The crafting tutorial, whose exchange button helps get the items (MissionPanel.d). */
const CRAFT_TUTORIAL = "time_to_crafty";
const EMPTY_CARD = "ui/mission/images/cards/empty.png";
const UNKNOWN_CARD = "ui/mission/images/cards/images/unknown.png";
const CROWN = "ui/icon/crown_32.png";
const BLANK = "ui/icon/inventory/blank.png";
const PER_PAGE = 5;
const TABS: [Tab, string][] = [["rank", "btn_rank"], ["prestige", "btn_prestige"], ["operations", "btn_expansion"]];
const COMPONENT = "com.threerings.opengl.gui.config.ComponentConfig$";
const ref = (name: string) => ({ $class: CONFIG_REF, name });

const label = (name: string) => itemName(name);
const KIND_LABEL: Record<Mission["kind"], string> = {
  dungeon: "Mission", conversation: "Briefing", exchange: "Exchange", gate: "Arcade gate", "gate-conversation": "Briefing",
};

/** The knight's mission progress in the save (created on first use). */
export function progressOf(save: SaveData): MissionProgress {
  const p = save.missions ??= freshProgress();
  p.cycles ??= {};
  p.completed ??= [];
  return p;
}

function introPref(): boolean {
  try { return localStorage.getItem(INTRO_PREF) !== "0"; } catch { return true; }
}
function setIntroPref(on: boolean) {
  try { localStorage.setItem(INTRO_PREF, on ? "1" : "0"); } catch { /* storage unavailable */ }
}

export class MissionBoard {
  private readonly screen: MissionScreen;
  /** The board's music (MissionPanel: mission_ui.ogg at half volume while it is open). */
  private stopMusic: ((fadeOut?: number) => void) | null = null;
  private missions: Mission[] = [];
  private loading: Promise<void> | null = null;
  /** The dungeon mission being played, if any. */
  private active: Mission | null = null;

  constructor(private readonly host: MissionHost) {
    this.screen = new MissionScreen(host.gui, { sound: f => host.sound(f), closed: () => { host.pause(false); this.music(false); } }, this);
  }

  get list(): readonly Mission[] { return this.missions; }
  get progress(): MissionProgress { return progressOf(this.host.save()); }
  get isOpen() { return this.screen.isOpen; }
  /** @internal for the window. */
  get game() { return this.host; }

  load(): Promise<void> {
    this.loading ??= (async () => {
      await this.host.data.preload(...LIBS);
      this.missions = parseMissions([...this.host.data.library_("config/mission.dat").values()], this.host.data.library_("config/mission_property.dat"));
    })();
    return this.loading;
  }

  async open(tab?: Tab) {
    await this.load();
    const fresh = !this.screen.isOpen;
    // MissionPanel.wasAdded: the intro page while its preference is on, else the categories
    if (tab) this.screen.choose(tab, false);
    else if (fresh && introPref()) this.screen.intro();
    else if (fresh) this.screen.choose(this.screen.tab ?? "rank", false);
    await this.show();
  }

  /** Opens the window as it stands (pausing the game and starting the board's music). */
  private async show() {
    if (!this.screen.isOpen) this.music(true);
    this.host.pause(true);
    await this.screen.open();
  }

  /**
   * MissionPanel plays sound/music/mission_ui.ogg looping at half the music volume over the
   * music while it is open, fading in and out over two seconds. (It does not in two zones, the
   * ready room's and knight creation's, which the board is not opened from in this port.)
   */
  private music(on: boolean) {
    if (on && !this.stopMusic) this.stopMusic = this.host.stream?.(MUSIC, 0.5) ?? null;
    else if (!on && this.stopMusic) { this.stopMusic(2); this.stopMusic = null; }
  }

  /** @internal Whether a category is open (MissionPanel.g): by the mission that unlocks it. */
  unlocked(tab: Tab | "arcade"): boolean {
    const u = UNLOCKS.find(x => x[0] === tab);
    return !u || this.progress.completed.includes(u[1]);
  }

  /** @internal A mission by id. */
  byId(id: string): Mission | null { return this.missions.find(m => m.id === id) ?? null; }

  close() {
    if (this.screen.isOpen) this.screen.close();
    else this.host.pause(false);
  }

  toggle() { if (this.isOpen) this.close(); else void this.open(); }

  /** as.dW: the board opened on one mission (the Event Hub's INSPECT!), its card chosen. */
  async inspect(id: string) {
    await this.load();
    const m = this.byId(id);
    if (!m) { await this.open(); return; }
    this.screen.showMission(m);
    await this.show();
  }

  /** The Event Hub's missions (hubMissions), once the board's data has loaded. */
  async hubMissions(): Promise<Mission[]> {
    await this.load();
    return hubMissions(this.missions, this.progress);
  }

  /** Escape: closes the topmost dialog, else the board. True when the board took the key. */
  escape(): boolean {
    if (!this.isOpen) return false;
    this.screen.escape();
    return true;
  }

  // -------------------------------------------------------------------- game hooks

  /** The descent ran out of floors: when it was a mission's run, the mission is done. */
  runFinished(gateId: string | undefined) {
    const m = this.active;
    this.active = null;
    if (!m || gateId !== `mission:${m.id}`) return;
    this.finish(m);
  }

  /** @internal Development: a mission by its id. */
  missionById(id: string): Mission | null { return this.missions.find(m => m.id === id) ?? null; }

  /** A run started for this mission outside the board (development): its completion is reported by runFinished. */
  track(m: Mission) { this.active = m; }

  /** A run was abandoned (back to Haven before the last floor). */
  runAbandoned() { this.active = null; }

  /** An Arcade stratum was cleared: prestige gate missions of its theme are done. */
  stratumCleared(theme: StratumTheme) {
    if (!this.missions.length) return;
    const p = this.progress;
    for (const m of this.missions) {
      if (m.kind === "gate" && m.gateTheme === theme && missionStatus(m, p) === "available") {
        this.finish(m);
        return;
      }
    }
  }

  // -------------------------------------------------------------------- actions

  /** @internal The chosen card's action. */
  start(m: Mission) {
    this.host.sound("sound/feedback/ui_confirm.ogg");
    if (m.kind === "dungeon") {
      const { gate, floors } = missionRun(m, this.host.save().runs);
      this.active = m;
      this.close();
      this.host.startRun(gate, floors);
    } else if (m.kind === "gate") {
      this.close();
      this.host.openGates();
    } else if (m.kind === "exchange") {
      const needs = this.needs(m);
      const save = this.host.save();
      if (!canExchange(needs, save.materials, n => this.ownedLevel(n))) return;
      const l = save.loadout, equipped = [...l.weapons, l.shield, l.armor, l.helmet, ...l.trinkets, l.vitapod];
      const busy = needs.find(g => g.level === undefined && isGear(g.item) && equipped.includes(g.item));
      if (busy) { notice(`Unequip ${label(busy.item)} before turning it in.`); return; }
      for (const g of needs) {
        if (g.level !== undefined) continue; // levelled gear is shown, not taken
        if (isGear(g.item)) { save.owned = save.owned.filter(o => o !== g.item); delete save.gear[g.item]; }
        else save.materials[g.item] = (save.materials[g.item] ?? 0) - g.count;
      }
      this.finish(m);
    } else {
      void this.screen.briefing(m);
    }
  }

  /** @internal Awards a mission's rewards and prestige, ranks up, and shows what it gave. */
  finish(m: Mission) {
    const save = this.host.save(), p = progressOf(save);
    const before = rankLabel(p), beforeRank = p.rank;
    const got = new Map<string, number>();
    const tables = new SpawnTables(this.host.data.library_("config/spawn_table.dat"));
    const depth = m.setting?.depth ?? Math.max(1, m.rank * 3);
    const ctx = { depth, tier: depth >= 18 ? 3 : depth >= 8 ? 2 : 1, difficulty: "medium" as const };
    for (const t of m.rewards) {
      for (const r of tables.evaluate({ name: t }, ctx)) {
        const name = r.item?.name;
        if (!name) continue;
        if (isGear(name)) { if (!save.owned.includes(name)) { save.owned.push(name); save.gear[name] = { heat: 0, level: 1, variants: [] }; } }
        else save.materials[name] = (save.materials[name] ?? 0) + Math.max(1, r.count);
        got.set(name, (got.get(name) ?? 0) + Math.max(1, r.count));
      }
    }
    const crowns = crownReward(m);
    save.crowns += crowns;
    completeMission(this.missions, m, p);
    // the Event Hub's rank line (FeedEvent.RankEarned): a new rank title, not a subrank
    for (let r = beforeRank + 1; r <= p.rank; r++) logFeed(save, { kind: "rank", rank: r, at: Date.now() });
    this.host.completed?.(m);
    this.host.write();
    const after = rankLabel(p);
    this.host.sound("sound/feedback/ui_merchant_trade_add.ogg");
    void (async () => {
      if (!this.screen.isOpen) await this.show();
      await this.screen.completed(m, crowns, [...got].map(([item, count]) => ({ item, count })), after !== before ? `${p.rank}-${p.subrank} ${rankName(p.rank)}` : null);
    })();
  }

  /** @internal */
  needs(m: Mission): Ingredient[] { return exchangeNeeds(m, this.host.data.library_("config/recipe.dat")); }

  /**
   * @internal The crafting tutorial's button (MissionPanel.d), from the items it asks for:
   * all owned but worn -> Unequip Items; some not owned: with no recipe for one, known or held,
   * Get Recipes; else with a recipe item held for one, Learn Recipes; else Craft Items. Null
   * (the button hidden) when every item is owned and free.
   */
  craftHelp(m: Mission): "unequip_items" | "craft_items" | "learn_recipes" | "get_recipes" | null {
    const save = this.host.save(), data = this.host.data;
    const l = save.loadout, worn = new Set([...l.weapons, l.shield, l.armor, l.helmet, ...l.trinkets, l.vitapod]);
    const recipeOutput = (recipe: string) => data.resolveSync("config/recipe.dat", { name: recipe }, "recipe")?.item?.name ?? null;
    const heldRecipes = Object.keys(save.materials).filter(k => (save.materials[k] ?? 0) > 0 && /^Recipe\//.test(k))
      .map(k => data.resolveSync("config/item.dat", { name: k }, "item")?.recipe?.name).filter((r): r is string => !!r);
    let unequip = false, missing = false, learn = false, none = false;
    for (const g of this.needs(m)) {
      const gear = g.level !== undefined || isGear(g.item);
      const owned = gear ? save.owned.includes(g.item) : (save.materials[g.item] ?? 0) > 0;
      if (owned) { if (gear && worn.has(g.item)) unequip = true; continue; }
      missing = true;
      if (save.recipes.some(r => recipeOutput(r) === g.item)) continue;
      if (heldRecipes.some(r => recipeOutput(r) === g.item)) learn = true;
      else none = true;
    }
    if (!missing) return unequip ? "unequip_items" : null;
    return none ? "get_recipes" : learn ? "learn_recipes" : "craft_items";
  }

  /** @internal */
  ownedLevel(name: string): number {
    const s = this.host.save();
    if (!s.owned.includes(name)) return 0;
    return s.gear[name]?.level ?? 1;
  }

  /** @internal The missions of a tab, in board order. */
  tabMissions(tab: Tab): Mission[] {
    const p = this.progress;
    if (tab === "rank") return this.missions.filter(m => m.cls === "Rank").sort((a, b) => a.rank - b.rank || a.subrank - b.subrank);
    if (tab === "operations") return this.missions.filter(m => m.cls === "Expansion");
    const now = Date.now();
    return weeklyPrestige(this.missions, p, now).sort((a, b) =>
      (a.schedule ? daysUntilActive(a.schedule, now) : 0) - (b.schedule ? daysUntilActive(b.schedule, now) : 0) || a.path.localeCompare(b.path));
  }

  /** @internal What a tab says when it has nothing to show. */
  tabNote(tab: Tab): string {
    const p = this.progress;
    if (tab === "rank") return "Complete every mission of your subrank to rank up. Tier 2 of the Clockworks needs rank 4 (Knight), tier 3 rank 6 (Defender).";
    if (tab === "operations") return "Operations from the game's expansion pack, one per Clockworks tier (tier 2 needs rank 4, tier 3 rank 6).";
    return p.rank < 3
      ? "Prestige missions open at rank 3. Each runs on its own day of a schedule from the game's data; done missions open again on their next day."
      : `This week's prestige missions for rank ${p.rank}, from the game's schedules: each is open on its day. The game's event missions (Dark Harvest, Winterfest, the Anniversary and the rest) are always on here.`;
  }

  /** @internal The reward items a mission's tables can give. */
  rewardsOf(m: Mission) { return m.rewards.flatMap(t => rewardItems(t, this.host.data.library_("config/spawn_table.dat"))); }

  /** @internal An item's inventory IconConfig. */
  iconOf(item: string): any { return this.host.data.resolveSync("config/item.dat", { name: item }, "item")?.icon ?? null; }

  /** @internal The knight's name, for the {0} in the game's mission text. */
  knight(): string { return knightName(this.host.save()); }

  /** @internal A mission's briefing with the knight's name in it. */
  briefingOf(m: Mission): string { return withName(m.summary, this.knight()); }

  /** @internal A conversation mission's dialogue (config/conversation.dat), or null. */
  conversationOf(m: Mission): Promise<Conversation | null> {
    return m.conversation ? loadConversation(this.host.data, m.conversation, this.knight()) : Promise.resolve(null);
  }
}

/** The mission window on its canvas. */
class MissionScreen extends GuiScreen {
  /** The category shown; null on the intro page, before one is picked. */
  tab: Tab | null = "rank";
  /** MissionPanel's intro page (top_intro) is up: no category picked yet. */
  private introTop = false;
  /**
   * The intro's hint mode: a category's cards show with none chosen and the bottom reads the
   * intro's m.intro_reward_<category> hint, until a card is picked.
   */
  private introHint = false;
  /** The intro's "Show mission introduction" check box (moved under the hint after the intro). */
  private introBox: Component | null = null;
  /** Exchanges whose items the knight confirmed (the m.verify_exchange check box), by mission id. */
  private verified = new Set<string>();
  private page = 0;
  private chosen: Mission | null = null;
  private shown: Mission[] = [];
  private cards = new Map<string, Promise<Component | null>>();
  private parts = new Map<string, Promise<Component | null>>();
  private images = new Map<string, GuiImage | null>();
  private generation = 0;
  /** The card picture the briefing prompt shows. */
  private briefed: Mission | null = null;

  constructor(ctx: GuiContext, host: ConstructorParameters<typeof GuiScreen>[1], private readonly board: MissionBoard) {
    super(ctx, host, "missionsCanvas");
  }

  /**
   * Picks a tab and pages to the knight's current missions, choosing the first one there
   * unless the intro's hint is showing. `hint` false ends the intro (a tab picked from code,
   * as MissionPanel.b does); a locked tab shows the mission that opens it instead (MissionPanel.b).
   */
  choose(tab: Tab, hint = this.introHint) {
    this.introTop = false;
    this.introHint = hint;
    if (!this.board.unlocked(tab)) {
      const key = UNLOCKS.find(u => u[0] === tab)?.[1];
      const m = key ? this.board.byId(key) : null;
      if (m) { this.showMission(m); return; }
      tab = "rank";
    }
    this.tab = tab;
    const ms = this.board.tabMissions(tab), p = this.board.progress;
    const at = Math.max(0, ms.findIndex(m => missionStatus(m, p) === "available"));
    const cur = tab === "rank" ? ms.findIndex(m => m.rank === p.rank) : -1;
    const i = ms[at] && missionStatus(ms[at], p) === "available" ? at : Math.max(0, cur);
    this.page = Math.floor(i / PER_PAGE);
    this.chosen = hint ? null : ms[i] ?? null;
  }

  /** MissionPanel.wasAdded with the intro preference on: the intro page, no category picked. */
  intro() {
    this.tab = null;
    this.introTop = true;
    this.introHint = true;
    this.chosen = null;
    this.page = 0;
  }

  /** Shows one mission's card and briefing (MissionPanel.fA): its category, its page, it chosen. */
  showMission(m: Mission) {
    const tab: Tab = m.cls === "Prestige" ? "prestige" : m.cls === "Expansion" ? "operations" : "rank";
    this.introTop = false;
    this.introHint = false;
    this.tab = tab;
    const i = Math.max(0, this.board.tabMissions(tab).indexOf(m));
    this.page = Math.floor(i / PER_PAGE);
    this.chosen = m;
  }

  protected async build(): Promise<Component | null> {
    const ui = await this.ui(WINDOW);
    if (!ui) return null;
    this.on(ui, "dismiss", () => this.close());
    for (const [tab, tag] of TABS) {
      this.on(ui, tag, () => { this.choose(tab); this.host.sound("sound/feedback/ui_dropdown_select.ogg"); void this.refresh(); });
    }
    // the Arcade's gates are a board of their own
    this.on(ui, "btn_arcade", () => { this.close(); this.board.game.openGates(); });
    this.on(ui, "btn_prev", () => this.turn(-1));
    this.on(ui, "btn_next", () => this.turn(1));
    // the intro's check box keeps ConfirmPrompt.MISSION_INTRO
    this.introBox = this.on(ui, "intro_pref", c => setIntroPref(!!c.value));
    if (this.introBox) this.introBox.selected = introPref();
    const arc = ui.find("ui_mission_arc");
    if (arc) arc.visible = false;
    for (const t of ["rank", "prestige", "expansion", "arcade"]) {
      const n = ui.find(`new_${t}`); if (n) n.visible = false;
    }
    // the briefing and mission panes keep their height and scroll what does not fit
    for (const pane of ui.find("bottom_container")?.children ?? []) if (pane.kind === "scrollpane") pane.preferredSize = { width: -1, height: 236 };
    this.hooks = {
      tagged: {
        brief_image: (c, g, x, y, w, h) => this.drawImage(this.briefed?.cardImage ?? null, g, x, y, w, h, true),
      },
    };
    return ui;
  }

  private turn(d: number) {
    const pages = Math.max(1, Math.ceil(this.shown.length / PER_PAGE));
    const page = Math.max(0, Math.min(pages - 1, this.page + d));
    if (page === this.page) return;
    this.page = page;
    this.chosen = this.introHint ? null : this.shown[page * PER_PAGE] ?? null;
    this.host.sound("sound/feedback/ui_dropdown_select.ogg");
    void this.refresh();
  }

  private image(file: string | null): GuiImage | null {
    if (!file) return null;
    if (!this.images.has(file)) {
      this.images.set(file, null);
      void this.ctx.image(file).then(im => this.images.set(file, im));
    }
    return this.images.get(file) ?? null;
  }

  private drawImage(file: string | null, g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fit: boolean) {
    const im = this.image(file);
    if (!im) return;
    const s = fit ? Math.min(w / im.width, h / im.height) : 1, iw = im.width * s, ih = im.height * s;
    g.drawImage(im.source, Math.round(x + (w - iw) / 2), Math.round(y + (h - ih) / 2), Math.round(iw), Math.round(ih));
  }

  /** Builds (once per arguments) a nested interface. */
  private part(name: string, args: Record<string, unknown>, key = ""): Promise<Component | null> {
    const k = name + key + JSON.stringify(args, (kk, v) => (kk === "$outer" ? undefined : v));
    let p = this.parts.get(k);
    if (!p) { p = buildUi(this.ctx, uiRef(name, args)); this.parts.set(k, p); }
    return p;
  }

  private text(text: string, style = "Briefing Styles/Body"): Promise<Component> {
    return buildComponentConfig(this.ctx, { $class: COMPONENT + "Label", text, style: ref(style) }, this.root?.local ?? new Map());
  }

  /** Pills two to a row. */
  private async table(parts: Promise<Component | null>[]): Promise<Component> {
    const [t, ...kids] = await Promise.all([buildComponentConfig(this.ctx, { $class: COMPONENT + "Container",
      layout: { $class: "com.threerings.opengl.gui.config.LayoutConfig$Table", columns: 2, rowGap: 2, columnGap: 4, children: [] } }), ...parts]);
    t.children = kids.filter((c): c is Component => !!c);
    for (const c of t.children) c.constraints = null;
    return t;
  }

  private async button(text: string, fn: () => void, enabled = true, style = "Default/Button (Yellow)/Button"): Promise<Component> {
    const b = await buildComponentConfig(this.ctx, { $class: COMPONENT + "Button", text, style: ref(style) }, this.root?.local ?? new Map());
    b.enabled = enabled;
    b.onAction = () => fn();
    return b;
  }

  /** An item pill: the item's icon and name (and count). */
  private itemPill(item: string, count: number, key = "") {
    const icon = this.board.iconOf(item);
    return this.part(PILL, { Name: `${count > 1 ? count + " " : ""}${label(item)}`, Rarity: "-1", Equipped: "False", Hoverable: true,
      Icon: icon?.file ?? BLANK, Colorization: icon?.colorizations ?? [], Variants: "0", Accessory: false }, key);
  }

  private crownPill(crowns: number, key = "") {
    return this.part(PILL, { Name: `${crowns.toLocaleString("en-US")} Crowns`, Rarity: "-1", Equipped: "False", Hoverable: true,
      Icon: CROWN, Colorization: [], Variants: "0", Accessory: false }, key);
  }

  private async prestigePill(prestige: number, key = "") {
    const c = await this.part(PRESTIGE_PILL, { Hoverable: true, Prestige: String(prestige) }, key);
    // the pill's name is a message key the game fills in
    const n = c?.find("entryselect");
    if (n) n.text = "Prestige";
    return c;
  }

  private statusLine(m: Mission, st: MissionStatus): string {
    if (st === "upcoming") {
      const days = m.schedule ? daysUntilActive(m.schedule, Date.now()) : 0;
      return `${KIND_LABEL[m.kind]} · opens in ${days} day${days === 1 ? "" : "s"}`;
    }
    return `${KIND_LABEL[m.kind]} · ${st[0].toUpperCase() + st.slice(1)}`;
  }

  protected async refresh() {
    const ui = this.root;
    if (!ui) return;
    const gen = ++this.generation;
    const b = this.board, p = b.progress;
    // header: prestige and rank sockets, the rank bar
    const set = (root: Component, tag: string, text: string) => { const c = root.find(tag); if (c) c.text = text; };
    set(ui, "prestige", message("mission", "m.prestige_header", p.prestige.toLocaleString("en-US")) || `Prestige: ${p.prestige.toLocaleString("en-US")}`);
    set(ui, "rank", message("mission", "m.rank_header", p.rank, p.subrank) || `Rank: ${p.rank}-${p.subrank}`);
    const rankUi = ui.find("rank_ui");
    if (rankUi) this.fillBar(rankUi, p);
    for (const [tab, tag] of TABS) { const c = ui.find(tag); if (c) c.selected = tab === this.tab; }
    const arcade = ui.find("btn_arcade");
    if (arcade) arcade.selected = false;
    // MissionPanel.g: a category opens with the mission that unlocks it (rank is always open);
    // a closed one is disabled with its lock shown, and its intro text is the _locked one
    const lockRank = ui.find("locked_rank");
    if (lockRank) lockRank.visible = false;
    for (const [tab, , name] of UNLOCKS) {
      const open = b.unlocked(tab), btn = ui.find(`btn_${name}`), lock = ui.find(`locked_${name}`), intro = ui.find(`intro_${name}`);
      if (btn) btn.enabled = open;
      if (lock) lock.visible = !open;
      if (intro) intro.text = text("mission", `m.intro_${name}${open ? "" : "_locked"}`, intro.text);
    }

    // the intro page (top_intro) in the cards' place until a category is picked; the bottom
    // stays empty (bottom_empty) until a card is, with the hint and the check box under it
    // after the intro
    const top = ui.find("top_intro"), middle = ui.find("middle_container");
    if (top) top.visible = this.introTop;
    if (middle) middle.visible = !this.introTop;
    const bottom = ui.find("bottom_container"), empty = ui.find("bottom_empty"), hint = ui.find("bottom_intro");
    if (bottom) bottom.visible = !!this.chosen && !this.introTop;
    if (empty) empty.visible = !this.chosen || this.introTop;
    const box = this.introBox;
    if (box && top && !this.introTop) {
      const holder = findHolder(top, box);
      if (holder) holder.children = holder.children.filter(k => k !== box);
    }
    if (hint) {
      hint.children = [];
      if (box && this.introHint && !this.introTop && this.tab) {
        const name = this.tab === "operations" ? "expansion" : this.tab;
        const line = await buildComponentConfig(this.ctx, { $class: COMPONENT + "Label", text: text("mission", `m.intro_reward_${name}`, "") }, this.root?.local ?? new Map());
        if (gen !== this.generation) return;
        line.constraints = null;
        box.constraints = null;
        hint.children = [line, box];
      }
    }
    if (!this.tab || this.introTop) return;

    // the cards of this page
    const ms = this.shown = b.tabMissions(this.tab);
    const pages = Math.max(1, Math.ceil(ms.length / PER_PAGE));
    this.page = Math.min(this.page, pages - 1);
    if (this.chosen && !ms.includes(this.chosen)) this.chosen = null;
    if (!this.introHint) this.chosen ??= ms[this.page * PER_PAGE] ?? null;
    if (bottom) bottom.visible = !!this.chosen;
    if (empty) empty.visible = !this.chosen;
    const prev = ui.find("btn_prev"), next = ui.find("btn_next");
    if (prev) prev.enabled = this.page > 0;
    if (next) next.enabled = this.page < pages - 1;
    const row = ui.find("middle_container");
    const slice = ms.slice(this.page * PER_PAGE, this.page * PER_PAGE + PER_PAGE);
    const built = await Promise.all(Array.from({ length: PER_PAGE }, (_, i) => this.card(slice[i] ?? null, i, p)));
    if (gen !== this.generation) return;
    if (row) {
      built.forEach((c, i) => {
        const at = row.children.findIndex(k => k.tag === `ui_mission_${i}`);
        if (!c || at < 0) return;
        c.constraints = row.children[at].constraints;
        c.tag = `ui_mission_${i}`;
        row.children[at] = c;
        const m = slice[i];
        const btn = c.find(`btn_mission_${i}`);
        if (btn) {
          btn.selected = !!m && m === this.chosen;
          btn.onAction = () => {
            if (!m) return;
            this.chosen = m;
            this.introHint = false;
            this.host.sound("sound/feedback/ui_dropdown_select.ogg");
            void this.refresh();
          };
        }
      });
    }

    // the briefing and mission panes
    const m = this.chosen;
    const brief = ui.find("briefing_container"), mission = ui.find("mission_container");
    if (brief) {
      // MissionPanel's briefing: the name (Header), the briefing (Body), the objective
      // (Summary), "once per day" for once-only prestige missions, then REWARDS and the
      // reward pills
      set(brief, "briefing", m ? m.title.toUpperCase() : "BRIEFING");
      const body = brief.children.find(k => k.kind === "label" && k.tag !== "briefing");
      if (body) body.text = m ? b.briefingOf(m) + (npcName(m) ? `\n\nWith ${npcName(m)}.` : "") : "";
      const fixed = brief.children.filter(k => !k.tag?.startsWith("brief_extra"));
      brief.children = fixed;
      if (m) {
        const extra = (await Promise.all([
          m.objective ? this.text(withName(m.objective, b.knight()), "Briefing Styles/Summary") : null,
          m.cls === "Prestige" && m.onceOnly ? this.text(text("mission", "m.once_only", "This mission can only be played once per day."), "Briefing Styles/Summary") : null,
          this.text(text("mission", "t.rewards", "REWARDS"), "Briefing Styles/Header"),
          this.table([this.prestigePill(m.prestige), this.crownPill(crownReward(m)), ...b.rewardsOf(m).slice(0, 8).map(it => this.itemPill(it.item, it.count))]),
        ])).filter((c): c is Component => !!c);
        if (gen !== this.generation) return;
        extra.forEach((c, i) => { c.tag = `brief_extra${i}`; c.constraints = null; });
        brief.children = [...fixed, ...extra];
      }
    }
    if (mission) {
      const head = mission.children[0];
      // the old card's details (and its action) go at once; the new ones follow when built
      mission.children = [head];
      const kids: Promise<Component | null>[] = [];
      if (m) {
        const st = missionStatus(m, p);
        if (m.kind === "exchange") kids.push(...this.exchangePane(m, st));
        else {
          // the START button (Comlink style), enabled while the mission can start
          kids.push(this.button(text("mission", "m.start", "START"), () => b.start(m), st === "available", "Adventure Board/Start Button/Comlink/Start"));
          kids.push(this.text(this.statusLine(m, st)));
          if (m.cls === "Rank") kids.push(this.text(`Rank ${m.rank}-${m.subrank}: ${rankName(m.rank)}`));
          if (m.needs.length && st === "locked") kids.push(this.text("After: " + m.needs.map(id => b.list.find(x => x.id === id)?.title ?? id).join(", ")));
        }
      }
      const done = (await Promise.all(kids)).filter((c): c is Component => !!c);
      if (gen !== this.generation) return;
      for (const c of done) c.constraints = null;
      mission.children = [head, ...done];
    }
  }

  /**
   * MissionPanel.c: an exchange's mission pane. The exchange's materials window
   * (ui/mission/interface_exchange.dat: stacked materials under t.materials, single items under
   * t.special), the TOGGLE ARSENAL button (the crafting tutorial's: Unequip Items, Craft Items,
   * Learn Recipes or Get Recipes, hidden when nothing is needed), the m.verify_exchange check
   * box once everything is there, and START, enabled when that box is checked.
   */
  private exchangePane(m: Mission, st: MissionStatus): Promise<Component | null>[] {
    const b = this.board, save = b.game.save(), needs = b.needs(m);
    const ready = st === "available" && canExchange(needs, save.materials, n => b.ownedLevel(n));
    if (!ready) this.verified.delete(m.id);
    const kids: Promise<Component | null>[] = [];
    kids.push((async () => {
      const ui = await this.part(EXCHANGE, {}, m.id);
      if (!ui) return null;
      const rows = await Promise.all(needs.map(g => {
        const icon = b.iconOf(g.item), name = `${label(g.item)}${g.level ? ` (level ${g.level})` : ""}`;
        if (g.level !== undefined || isGear(g.item)) {
          const have = b.ownedLevel(g.item) > 0 && b.ownedLevel(g.item) >= (g.level ?? 0);
          return this.part(SPECIAL, { Name: name, Ready: have, Icon: icon?.file ?? BLANK, Colorization: icon?.colorizations ?? [] })
            .then(c => ({ special: true, c }));
        }
        const have = save.materials[g.item] ?? 0;
        return this.part(MATERIAL, { Name: name, "Amount Have": String(have), "Amount Needed": String(g.count), Ready: have >= g.count,
          Icon: icon?.file ?? BLANK, Colorization: icon?.colorizations ?? [] }).then(c => {
          const find = c?.find("find_materials");
          if (find) find.visible = false;
          return { special: false, c };
        });
      }));
      const fill = (tag: string, title: string, special: boolean) => {
        const list = ui.find(tag), t = ui.find(title);
        const kidsOf = rows.filter(r => r.special === special && r.c).map(r => r.c!);
        for (const c of kidsOf) c.constraints = null;
        if (list) list.children = kidsOf;
        if (t) t.visible = kidsOf.length > 0;
      };
      fill("list_basic", "title_basic", false);
      fill("list_special", "title_special", true);
      return ui;
    })());
    // the arsenal toggle; the crafting tutorial's becomes the step the knight needs next
    const help = m.id === CRAFT_TUTORIAL ? b.craftHelp(m) : undefined;
    if (help !== null) {
      kids.push(buildComponentConfig(this.ctx, { $class: COMPONENT + "ToggleButton", text: text("mission", `b.${help ?? "toggle_arsenal"}`, "") },
        this.root?.local ?? new Map()).then(t => {
        t.selected = !!b.game.arsenalOpen?.();
        t.onAction = () => {
          if (help === "craft_items") { this.close(); b.game.openForge?.(); return; }
          if (help === "get_recipes") {
            const how = b.byId("alchemy_beginners");
            if (how) { this.showMission(how); this.host.sound("sound/feedback/ui_dropdown_select.ogg"); void this.refresh(); }
            return;
          }
          void Promise.resolve(b.game.toggleArsenal?.()).then(() => this.refresh());
        };
        return t;
      }));
    }
    if (ready) {
      kids.push(buildComponentConfig(this.ctx, { $class: COMPONENT + "CheckBox", text: text("mission", "m.verify_exchange", "") },
        this.root?.local ?? new Map()).then(c => {
        c.selected = this.verified.has(m.id);
        c.onAction = () => {
          if (c.selected) this.verified.add(m.id); else this.verified.delete(m.id);
          void this.refresh();
        };
        return c;
      }));
    }
    kids.push(this.button(text("mission", "m.start", "START"), () => { this.verified.delete(m.id); b.start(m); },
      ready && this.verified.has(m.id), "Adventure Board/Start Button/Exchange/Start"));
    return kids;
  }

  /** A card for a mission (or an empty slot). */
  private card(m: Mission | null, i: number, p: MissionProgress): Promise<Component | null> {
    const st = m ? missionStatus(m, p) : "locked";
    // MissionPanel: a rank mission above the knight's rank is unknown ("???" on the unknown
    // card); a known one that cannot start yet shows its card locked with the lock icon; a
    // completed one keeps its card and shows the difficulty it was done at
    const unknown = !!m && m.cls === "Rank" && (m.rank > p.rank || (m.rank === p.rank && m.subrank > p.subrank));
    const locked = st === "locked" || st === "upcoming";
    const args = m
      ? { "Card Image": unknown ? UNKNOWN_CARD : m.cardImage ?? EMPTY_CARD, Empty: "False", Status: locked ? "Locked" : "Unlocked", "Button Tag": `btn_mission_${i}` }
      : { "Card Image": EMPTY_CARD, Empty: "True", Status: "Unlocked", "Button Tag": `btn_mission_${i}` };
    const key = `${m?.id ?? ""}|${st}|${unknown}|` + JSON.stringify(args);
    let c = this.cards.get(key);
    if (!c) {
      c = buildUi(this.ctx, uiRef(CARD, args)).then(async ui => {
        if (!ui) return null;
        if (m) {
          const set = (tag: string, text: string) => { const x = ui.find(tag); if (x) x.text = text; };
          set("name", unknown ? text("mission", "m.unknown", "???") : m.title);
          // the card's label: RANK and the rank; prestige missions TODAY, TOMORROW or REPLAYABLE
          set("card_label", m.cls === "Rank" ? text("mission", "t.rank", "RANK")
            : m.cls === "Prestige" ? text("mission", st === "upcoming" ? "t.tomorrow" : m.daily ? "t.today" : "t.replayable", "")
            : String(m.rank));
          set("rank", m.cls === "Rank" ? `${m.rank}-${m.subrank}` : "");
          const done = ui.find("mission_completed");
          if (done) done.visible = false;
          const icon = ui.find("icon");
          if (icon) {
            icon.visible = st === "complete" || locked;
            const file = st === "complete" ? `ui/icon/difficulty/${m.kind === "gate" ? "medium" : "hard"}.png` : "ui/icon/inventory/icon_locked.png";
            if (icon.visible) await restyle(this.ctx, icon, "Icon", { File: file }).catch(() => undefined);
          }
          const btn = ui.find(`btn_mission_${i}`);
          if (btn) btn.enabled = !unknown;
        } else {
          const rc = ui.find("rank_cont");
          if (rc) rc.visible = false;
        }
        return ui;
      });
      this.cards.set(key, c);
    }
    return c;
  }

  /** Fills a rank progress bar (interface_progressbar.dat) with the knight's rank. */
  private fillBar(bar: Component, p: MissionProgress) {
    const set = (tag: string, text: string) => { const c = bar.find(tag); if (c) c.text = text; };
    set("rank_current", String(p.rank));
    set("rank_next", p.rank < 10 ? String(p.rank + 1) : "");
    // MissionPanel.zJ: the rank's title alone (the rank sits in the header)
    set("rank_title", rankName(p.rank).toUpperCase());
    const ofRank = this.board.list.filter(m => m.cls === "Rank" && m.rank === p.rank);
    const done = ofRank.filter(m => p.completed.includes(m.id)).length;
    (bar as any).__fraction = ofRank.length ? done / ofRank.length : 1;
  }

  protected tick() {
    // the rank bars fill their backing by the share of the rank's missions done
    const bars = [this.root?.find("rank_ui"), ...this.overlays.map(o => o.find("prestigebar"))];
    for (const bar of bars) {
      const fill = bar?.find("rank_progressbar"), back = bar?.find("progress_backing");
      if (!fill || !back) continue;
      const f = (bar as any).__fraction ?? 0, max = Math.max(16, back.width - 8);
      fill.preferredSize = { width: Math.max(16, Math.round(max * f)), height: fill.preferredSize?.height ?? 26 };
    }
  }

  /** The mission complete window: the mission, its rewards, the rank bar and any rank up. */
  async completed(m: Mission, crowns: number, items: { item: string; count: number }[], rankUp: string | null) {
    const [win, up] = await Promise.all([buildUi(this.ctx, uiRef(COMPLETE)), rankUp ? buildUi(this.ctx, uiRef(RANKUP)) : null]);
    if (!win) return;
    const set = (tag: string, text: string) => { const c = win.find(tag); if (c) c.text = text; };
    set("title", text("mission", "t.missioncomplete", "Mission Complete"));
    set("name", m.title.toUpperCase());
    set("objective", withName(m.objective || m.summary, this.board.knight()));
    const rewards = win.find("rewards");
    if (rewards) {
      const pills = await Promise.all([this.prestigePill(m.prestige, "done"), this.crownPill(crowns, "done"), ...items.slice(0, 8).map(it => this.itemPill(it.item, it.count, "done"))]);
      rewards.children = pills.filter((c): c is Component => !!c);
      for (const c of rewards.children) c.constraints = null;
    }
    const bar = win.find("prestigebar");
    if (bar) this.fillBar(bar, this.board.progress);
    const line = up?.find("rankup");
    const box = win.find("window");
    if (line && box) {
      line.text = `${text("mission", "m.rank_up", "Rank up!")} ${rankUp}`;
      line.constraints = null;
      box.children.splice(1, 0, line);
    }
    const dismiss = win.find("dismiss");
    if (dismiss) dismiss.onAction = () => { this.overlays = this.overlays.filter(o => o !== win); this.host.sound("sound/feedback/ui_confirm.ogg"); void this.refresh(); };
    // the window's effects are drawn by the game's particle renderer; not here
    this.overlays.push(win);
    await this.refresh();
  }

  /**
   * A conversation mission's briefing in the game's confirmation prompt. With the game's
   * dialogue (config/conversation.dat and the mission bundle), each line in turn, the knight's
   * reply on the button; without it, the briefing text. The last button completes it.
   */
  async briefing(m: Mission) {
    const [o, talk] = await Promise.all([buildUi(this.ctx, uiRef(PROMPT)), this.board.conversationOf(m).catch(() => null)]);
    if (!o) return;
    this.briefed = m;
    const set = (tag: string, text: string) => { const c = o.find(tag); if (c) c.text = text; };
    set("title", m.title);
    const npc = talk?.speaker ?? npcName(m);
    const steps = talk?.steps ?? [];
    let at = 0;
    const show = () => {
      set("prompt", (npc ? `${npc}:\n` : "") + (steps[at]?.message ?? this.board.briefingOf(m)));
      const ok = o.find("accept");
      if (ok) ok.text = steps[at]?.responses[0] ?? text("uplink", "m.done", "Done");
    };
    show();
    const check = o.find("confirm");
    if (check) check.visible = false;
    const walk = (c: Component) => {
      if (c.kind === "spacer" && c.preferredSize?.width === 80 && c.preferredSize?.height === 140) { c.tag = "brief_image"; c.styles = c.styles.map(() => null); }
      c.children.forEach(walk);
    };
    walk(o);
    const shut = () => { this.overlays = this.overlays.filter(x => x !== o); };
    this.on(o, "dismiss", shut);
    const cancel = this.on(o, "cancel", shut);
    if (cancel) cancel.text = text("global", "m.cancel", "Cancel");
    this.on(o, "accept", () => {
      if (at < steps.length - 1) { at++; show(); this.host.sound("sound/feedback/button_press.ogg"); return; }
      shut(); this.board.finish(m);
    });
    show();
    this.overlays.push(o);
  }
}

/** The container directly holding `c` under `root`. */
function findHolder(root: Component, c: Component): Component | null {
  if (root.children.includes(c)) return root;
  for (const k of root.children) { const r = findHolder(k, c); if (r) return r; }
  return null;
}
