// The mission board: the game's missions (src/game/missions.ts) in the game's own mission
// window (rsrc/ui/mission/interface.dat), drawn on its own canvas like the other windows.
// The category buttons pick rank, prestige or operations (expansion) missions; five cards
// (ui/mission/parts/interface_cards.dat) show at a time with the arrows paging; the chosen
// card's briefing and mission panes give its summary, status, needs, rewards (the prestige
// pill and item pills) and the action. A finished mission shows the game's mission complete
// window (ui/mission/parts/part_missioncomplete.dat) with the rank up line. A conversation
// mission's START (attempt_mission) closes the board and plays its conversation as the client
// does, through the conversation dialog (src/ui/conversation.ts: Kora's comlink call, its
// interface_comlink.dat, her model and the comlink music); talked through, the mission is
// done; left with Escape, it is not.
//
// As MissionPanel lays it out: a gate mission (MissionConfig.Gate: the dungeon missions, the
// prestige stratum missions, the gate conversations) gets the party configuration
// (ui/party_configuration/interface_partyconfig.dat, board/a/b) in its mission pane: the
// party mode buttons, the difficulty selector and the Gate START; other missions a Comlink
// START, exchanges their materials. The ARCADE tab lists the Arcade's gates as cards (the
// gate's emblem), the gate's map and its strata's materials in materials_display.dat's tabs,
// and the party configuration with the tier buttons. The Featured Items (src/game/featured.ts)
// dock at the board's left from rank 2.
//
// Single player has no parties: Create Public Party, Create Private Party and Play Solo all
// start alone; Join Party finds none and asks, as the client does when the server finds no
// party (m.auto_create_party), whether to start one (its "Don't ask again" box keeps
// ConfirmPrompt.AUTO_CREATE).

import { CONFIG_REF } from "../config/params";
import type { GameData } from "../game/data";
import type { Floor, Gate, StratumTheme } from "../game/clockworks";
import type { Difficulty } from "../game/depth";
import { autoCreatePrompt, DIFFICULTIES, difficultyPref, partyModePref, setAutoCreatePrompt, setDifficultyPref, setPartyModePref, type PartyMode } from "../game/difficulty";
import { featuredGoods, promoCountdown, type FeaturedGood, type FeaturedSource } from "../game/featured";
import { gateEmblem } from "../game/gatemap";
import type { GateChoice } from "../game/gatesource";
import {
  canExchange, completedIcon, completeMission, daysUntilActive, exchangeNeeds, freshProgress, hubMissions, isGateMission, isGear, missionDifficulty, missionRun,
  missionStatus, parseMissions, rankLabel, rankName, rewardItems, rewardTables, weeklyPrestige, withName, type Ingredient, type Mission,
  type MissionProgress, type MissionStatus,
} from "../game/missions";
import { knightName, type SaveData } from "../game/save";
import { SpawnTables } from "../game/spawntable";
import { logFeed } from "../game/feed";
import { itemName } from "../game/text";
import { message, text } from "../i18n";
import { GateMapView, type GateRun } from "./gatemapview";
import { gatePiece } from "./gates";
import { buildComponentConfig, Component, pack, restyle, type GuiContext } from "./gui";
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
  /** The board closed (the game canvas takes the keys back). */
  closed?(): void;
  /** Starts a mission's floors through the gate descent, at a difficulty. */
  startRun(gate: Gate, floors: Floor[], difficulty: Difficulty): void;
  /** Opens the Arcade's gate board (when the board cannot list the gates itself). */
  openGates(): void;
  /** The Arcade's gates for the ARCADE tab (today's first). */
  gates?(): Promise<GateChoice[]>;
  /** The run in progress through a real gate, if any (the gate map marks it). */
  gateRun?(): GateRun | null;
  /** Enters an Arcade gate at a tier (1 to 3) and difficulty (the board has closed). */
  enterGate?(g: Gate, tier: number, difficulty: Difficulty): void;
  /** The Featured Items beside the board, when the game can sell them. */
  featured?: FeaturedHost;
  /**
   * Plays a conversation mission's conversation (its StartConversation) through the
   * conversation interface; true when the knight talked it through, false when it was left
   * (Escape) or could not be played.
   */
  converse?(m: Mission): Promise<boolean>;
  /** A mission was completed (sprite missions give the knight its battle sprite). */
  completed?(m: Mission): void;
}

/** What the Featured Items panel needs: the depot's goods, the knight's energy, buying, the full depot. */
export interface FeaturedHost {
  /** Item stars and depot prices (the economy); the item names come from the board's data. */
  source(): Omit<FeaturedSource, "names"> | null;
  energy(): number;
  /** Buys an item for energy; false when the energy does not cover it or it cannot be had. */
  buy(name: string, price: number): boolean;
  /** Opens the full Supply Depot (the board has closed). */
  openDepot(): void;
}

const LIBS = ["config/mission.dat", "config/mission_property.dat", "config/recipe.dat", "config/spawn_table.dat", "config/item.dat"];
type Tab = "rank" | "prestige" | "operations" | "arcade";

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
const UNLOCKS: [Tab, string, string][] = [["prestige", "prestigious_opportunity", "prestige"], ["arcade", "reporting_duty", "arcade"], ["operations", "pioneers", "expansion"]];
/** The crafting tutorial, whose exchange button helps get the items (MissionPanel.d). */
const CRAFT_TUTORIAL = "time_to_crafty";
const EMPTY_CARD = "ui/mission/images/cards/empty.png";
const UNKNOWN_CARD = "ui/mission/images/cards/images/unknown.png";
const BLANK = "ui/icon/inventory/blank.png";
const PER_PAGE = 5;
const TABS: [Tab, string][] = [["rank", "btn_rank"], ["prestige", "btn_prestige"], ["operations", "btn_expansion"], ["arcade", "btn_arcade"]];
/** The party configuration (board/a/b) and the Arcade tab's map and materials (MissionPanel.fx). */
const PARTY = "ui/party_configuration/interface_partyconfig.dat";
const MATERIALS = "ui/party_configuration/materials_display.dat";
/** The Featured Items panel (exchange/client/p) and its cards (exchange/client/i). */
const MINI_DEPOT = "ui/supplydepot/interface_mini.dat";
const PREVIEW = "ui/supplydepot/parts/preview_maker.dat";
const PROMO = "ui/supplydepot/parts/promo_frame.dat";
const PURCHASE = "ui/mission/parts/interface_purchase_2.dat";
/** The party configuration's mode buttons and the modes they choose (board/a/b). */
const MODES: [string, PartyMode, string][] = [["button_joinparty", "join", "b.joinparty"], ["button_formparty", "create", "b.formparty"],
  ["button_playprivate", "private", "b.playprivate"], ["button_playsolo", "solo", "b.playsolo"]];
/** The tiers' first depths (GateSummary.eu) and the rank each needs (the board bundle's i.tier_2, i.tier_3). */
const TIER_DEPTHS = [0, 8, 18];
const TIER_RANKS: [number, number][] = [[1, 1], [4, 2], [7, 1]];
/** DungeonCodes.bkB by stratum pair: the most stars of material each tier's strata drop. */
const TIER_STARS = [2, 2, 4, 4, 5, 5];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const COMPONENT = "com.threerings.opengl.gui.config.ComponentConfig$";
const ref = (name: string) => ({ $class: CONFIG_REF, name });

const label = (name: string) => itemName(name);

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
  /** The dungeon mission being played, if any, and the difficulty it is played at. */
  private active: Mission | null = null;
  private activeDifficulty: Difficulty = "easy";

  constructor(private readonly host: MissionHost) {
    this.screen = new MissionScreen(host.gui, { sound: f => host.sound(f), closed: () => { host.closed?.(); this.music(false); } }, this);
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

  /**
   * Opens the window as it stands, starting the board's music. The game goes on behind it, as
   * the online client's does.
   */
  private async show() {
    if (!this.screen.isOpen) this.music(true);
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
  unlocked(tab: Tab): boolean {
    const u = UNLOCKS.find(x => x[0] === tab);
    return !u || this.progress.completed.includes(u[1]);
  }

  /** @internal A mission by id. */
  byId(id: string): Mission | null { return this.missions.find(m => m.id === id) ?? null; }

  close() {
    if (this.screen.isOpen) this.screen.close();
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
    this.finish(m, this.activeDifficulty);
  }

  /** @internal Development: a mission by its id. */
  missionById(id: string): Mission | null { return this.missions.find(m => m.id === id) ?? null; }

  /** A run started for this mission outside the board (development): its completion is reported by runFinished. */
  track(m: Mission, difficulty: Difficulty = difficultyPref()) { this.active = m; this.activeDifficulty = difficulty; }

  /** A run was abandoned (back to Haven before the last floor). */
  runAbandoned() { this.active = null; }

  /** An Arcade stratum was cleared (at a difficulty): prestige gate missions of its theme are done. */
  stratumCleared(theme: StratumTheme, difficulty: Difficulty = difficultyPref()) {
    if (!this.missions.length) return;
    const p = this.progress;
    for (const m of this.missions) {
      if (m.kind === "gate" && m.gateTheme === theme && missionStatus(m, p) === "available") {
        this.finish(m, difficulty);
        return;
      }
    }
  }

  // -------------------------------------------------------------------- actions

  /** @internal The chosen card's action (a gate mission's at the party configuration's difficulty). */
  start(m: Mission, difficulty: Difficulty = difficultyPref()) {
    this.host.sound("sound/feedback/ui_confirm.ogg");
    if (m.kind === "dungeon") {
      const { gate, floors } = missionRun(m, this.host.save().runs);
      this.active = m;
      this.activeDifficulty = difficulty;
      this.close();
      this.host.startRun(gate, floors, difficulty);
    } else if (m.kind === "gate") {
      // a stratum of the mission's theme in any Arcade gate: the ARCADE tab's gates
      if (this.host.gates && this.unlocked("arcade")) { this.screen.choose("arcade", false); void this.screen.update(); return; }
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
      this.finish(m, difficulty);
    } else {
      // a conversation (the client's attempt_mission: the knight goes to the comlink and the
      // conversation dialog plays; its end action completes the mission)
      if (!this.host.converse) { this.finish(m, difficulty); return; }
      this.close();
      void this.host.converse(m).then(done => { if (done) this.finish(m, difficulty); });
    }
  }

  /**
   * @internal Awards a mission's rewards and prestige, ranks up, and shows what it gave. The
   * rewards are the reward tiers up to the difficulty it was played at (MissionConfig.Reward;
   * HARD, every tier, for missions that are not played through a gate). The client's
   * missions pay no crowns of their own.
   */
  finish(m: Mission, played: Difficulty = difficultyPref()) {
    const save = this.host.save(), p = progressOf(save);
    const before = rankLabel(p), beforeRank = p.rank;
    const got = new Map<string, number>();
    const tables = new SpawnTables(this.host.data.library_("config/spawn_table.dat"));
    const depth = m.setting?.depth ?? Math.max(1, m.rank * 3);
    const difficulty = missionDifficulty(m, played);
    const ctx = { depth, tier: depth >= 18 ? 3 : depth >= 8 ? 2 : 1, difficulty };
    for (const t of rewardTables(m, null, difficulty)) {
      for (const r of tables.evaluate({ name: t }, ctx)) {
        const name = r.item?.name;
        if (!name) continue;
        if (isGear(name)) { if (!save.owned.includes(name)) { save.owned.push(name); save.gear[name] = { heat: 0, level: 1, variants: [] }; } }
        else save.materials[name] = (save.materials[name] ?? 0) + Math.max(1, r.count);
        got.set(name, (got.get(name) ?? 0) + Math.max(1, r.count));
      }
    }
    completeMission(this.missions, m, p, Date.now(), difficulty);
    // the Event Hub's rank line (FeedEvent.RankEarned): a new rank title, not a subrank
    for (let r = beforeRank + 1; r <= p.rank; r++) logFeed(save, { kind: "rank", rank: r, at: Date.now() });
    this.host.completed?.(m);
    this.host.write();
    const after = rankLabel(p);
    this.host.sound("sound/feedback/ui_merchant_trade_add.ogg");
    void (async () => {
      if (!this.screen.isOpen) await this.show();
      await this.screen.completed(m, [...got].map(([item, count]) => ({ item, count })), after !== before ? `${p.rank}-${p.subrank} ${rankName(p.rank)}` : null);
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
    if (tab === "arcade") return [];
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

  /**
   * @internal The reward items a mission's tables can give at a difficulty (MissionPanel.Wt:
   * a gate mission's tiers up to the chosen difficulty, every tier for the rest).
   */
  rewardsOf(m: Mission, difficulty: Difficulty = difficultyPref()) {
    const lib = this.host.data.library_("config/spawn_table.dat");
    return rewardTables(m, null, missionDifficulty(m, difficulty)).flatMap(t => rewardItems(t, lib));
  }

  /** @internal An item's stars (0 when unknown). */
  rarityOf(item: string): number { return Number(this.host.data.resolveSync("config/item.dat", { name: item }, "item")?.rarity ?? 0); }

  /**
   * @internal The materials each of a gate's six strata drops (MissionPanel.R and Wp): the
   * creatable Material items tagged with the stratum's theme (fam_<family> or sc_<status>),
   * up to the stratum's tier's stars, the most stars first, then by name.
   */
  stratumMaterials(themes: string[]): string[][] {
    const lib = this.host.data.library_("config/item.dat");
    const byTag = new Map<string, { name: string; rarity: number; label: string }[]>();
    for (const [name, cfg] of lib) {
      if (!name.startsWith("Material/") || cfg?.creatable === false) continue;
      const impl = this.host.data.resolveSync("config/item.dat", { name }, "item");
      const tags: string[] = ((impl?.tags?.tags ?? []) as any[]).filter(t => typeof t === "string");
      for (const t of tags) {
        const l = byTag.get(t) ?? [];
        l.push({ name, rarity: Number(impl?.rarity ?? 0), label: label(name) });
        byTag.set(t, l);
      }
    }
    const tagOf = (theme: string) => {
      const k = theme.toLowerCase();
      return ["fire", "freeze", "shock", "poison"].includes(k) ? `sc_${k}` : `fam_${k}`;
    };
    return TIER_STARS.map((stars, i) => {
      const theme = themes[i];
      if (!theme) return [];
      return (byTag.get(tagOf(theme)) ?? []).filter(x => x.rarity <= stars)
        .sort((a, b) => b.rarity - a.rarity || a.label.localeCompare(b.label)).map(x => x.name);
    });
  }

  /** @internal An item's inventory IconConfig. */
  iconOf(item: string): any { return this.host.data.resolveSync("config/item.dat", { name: item }, "item")?.icon ?? null; }

  /** @internal The knight's name, for the {0} in the game's mission text. */
  knight(): string { return knightName(this.host.save()); }

  /** @internal A mission's briefing with the knight's name in it. */
  briefingOf(m: Mission): string { return withName(m.summary, this.knight()); }

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
  private generation = 0;
  /** The party configuration (built once), and its tier chosen (0 to 2) on the ARCADE tab. */
  private party: Component | null = null;
  private tier = 0;
  /** A start is waiting on the "no party to join" prompt (START is disabled meanwhile). */
  private starting = false;
  /** The ARCADE tab: today's gates, the one chosen, the map and materials tabs, and the briefing pane they replace. */
  private gates: GateChoice[] = [];
  private gate = 0;
  private materials: Component | null = null;
  private briefingPane: Component | null = null;
  private readonly mapView: GateMapView;
  /** The Featured Items panel and its countdown labels. */
  private featured: Component | null = null;
  private countdowns: { label: Component; endsAt: number }[] = [];
  private featuredKey = "";
  private lastCountdown = 0;

  constructor(ctx: GuiContext, host: ConstructorParameters<typeof GuiScreen>[1], private readonly board: MissionBoard) {
    super(ctx, host, "missionsCanvas");
    this.mapView = new GateMapView(ctx, { tips: this.tips, icon: (cfg, size) => this.icon(cfg, size), progress: () => board.progress,
      run: () => board.game.gateRun?.() ?? null });
  }

  /** Puts the save's data in again (after a change made from outside the window). */
  update() { return this.refresh(); }

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
    // the Arcade's gates: the first one chosen (MissionPanel.Wo)
    if (tab === "arcade") { this.gate = 0; this.page = 0; this.chosen = null; this.introHint = false; return; }
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
    // without the gate list here, the Arcade's gates are the gate board's
    if (!this.board.game.gates) this.on(ui, "btn_arcade", () => { this.close(); this.board.game.openGates(); });
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
    this.briefingPane = ui.find("briefing_scroll");
    const [party, mats, map, mini] = await Promise.all([this.ui(PARTY), this.board.game.gates ? this.ui(MATERIALS) : null,
      this.board.game.gates ? this.mapView.build() : null, this.board.game.featured ? this.ui(MINI_DEPOT) : null]);
    this.party = party;
    if (party) this.bindParty(party);
    if (mats) {
      // the Gate Map tab: the gate map (MissionPanel.fx replaces the tab's page with dungeon/client/u)
      const tabs = mats.find("tabs");
      if (tabs && map && tabs.tabs.length) {
        map.constraints = tabs.tabs[0].constraints;
        map.preferredSize = { width: -1, height: 200 };
        tabs.tabs[0] = map;
        if (tabs.selectedIndex === 0) tabs.children = [tabs.children[0], map];
      }
      mats.preferredSize = { width: -1, height: 236 };
      this.materials = mats;
    }
    if (mini) this.bindFeatured(mini);
    this.hooks = {
      tagged: {
        ...this.mapView.hooks(),
      },
    };
    return ui;
  }

  // ------------------------------------------------------------------ the party configuration

  /** board/a/b: the mode buttons (a radio group kept in ProjectXPrefs), the difficulty arrows, the tiers. */
  private bindParty(ui: Component) {
    const t = (k: string, f: string) => text("board", k, f);
    const title = ui.children[0]?.children.find(c => c.kind === "label");
    if (title) title.text = t("l.config_title", "CONFIGURE YOUR PARTY");
    for (const [tag, mode, key] of MODES) {
      const b = ui.find(tag);
      if (!b) continue;
      b.text = t(key, b.text);
      this.tips.set(b, { ref: null, text: t(key.replace(/^b\./, "i."), "") });
      b.onAction = () => {
        setPartyModePref(mode);
        this.host.sound("sound/feedback/ui_dropdown_select.ogg");
        this.bindPartyState();
      };
    }
    const step = (d: number) => {
      const i = DIFFICULTIES.indexOf(difficultyPref());
      const next = DIFFICULTIES[Math.max(0, Math.min(DIFFICULTIES.length - 1, i + d))];
      if (next === difficultyPref()) return;
      setDifficultyPref(next);
      this.host.sound("sound/feedback/ui_dropdown_select.ogg");
      // the rewards shown follow the difficulty (j.Bq: MissionPanel.Wt)
      void this.refresh();
    };
    this.on(ui, "diff_less", () => step(-1));
    this.on(ui, "diff_more", () => step(1));
    for (let i = 0; i < 3; i++) {
      this.on(ui, `button_tier${i + 1}`, () => { this.tier = i; this.host.sound("sound/feedback/ui_dropdown_select.ogg"); this.bindPartyState(); });
    }
    this.on(ui, "start", () => this.partyStart());
  }

  /** The party configuration's state: the mode chosen, the difficulty (board/a/b.Bq), the tiers. */
  private bindPartyState() {
    const ui = this.party;
    if (!ui) return;
    const mode = partyModePref();
    for (const [tag, m] of MODES) { const b = ui.find(tag); if (b) b.selected = m === mode; }
    const d = difficultyPref(), i = DIFFICULTIES.indexOf(d);
    const less = ui.find("diff_less"), more = ui.find("diff_more"), label = ui.find("label_difficulty");
    if (less) less.enabled = i > 0;
    if (more) more.enabled = i < DIFFICULTIES.length - 1;
    if (label) {
      label.text = text("dungeon", `m.difficulty_${d}`, cap(d));
      this.tips.set(label, { ref: null, text: text("dungeon", `i.difficulty_${d}`, "") });
      const style = `Difficulty/${cap(d)}`;
      if (label.styleRef?.name !== style) void restyle(this.ctx, label, style).catch(() => undefined);
    }
    // the tier buttons: the Arcade's gates (three tiers each); a tier the knight's rank has not
    // opened is disabled with its i.tier_<n> tooltip
    const depth = ui.find("buttonsDepth");
    const arcade = this.tab === "arcade";
    if (depth) depth.visible = arcade;
    if (arcade) {
      const p = this.board.progress;
      if (!this.tierOpen(this.tier, p)) this.tier = 0;
      for (let k = 0; k < 3; k++) {
        const b = ui.find(`button_tier${k + 1}`);
        if (!b) continue;
        b.text = message("board", "m.tier", String(k + 1), String(TIER_DEPTHS[k])) || `TIER ${k + 1} (Depth ${TIER_DEPTHS[k]})`;
        const open = this.tierOpen(k, p);
        b.enabled = open;
        b.selected = k === this.tier;
        if (open) this.tips.delete(b); else this.tips.set(b, { ref: null, text: text("board", `i.tier_${k + 1}`, "") });
      }
    }
  }

  private tierOpen(k: number, p: MissionProgress): boolean {
    const [r, s] = TIER_RANKS[k] ?? [1, 1];
    return p.rank > r || (p.rank === r && p.subrank >= s);
  }

  /**
   * The party configuration's START (MissionPanel.fC, board/a/b.a): Join Party looks for a
   * party, finds none in single player and asks to start one (unless its "Don't ask again" was
   * ticked); the other modes start at once, alone.
   */
  private partyStart() {
    if (this.starting) return;
    const go = () => {
      this.starting = false;
      if (this.tab === "arcade") {
        const g = this.gates[this.gate]?.gate;
        if (!g) return;
        this.host.sound("sound/feedback/ui_confirm.ogg");
        this.close();
        this.board.game.enterGate?.(g, this.tier + 1, difficultyPref());
      } else if (this.chosen) this.board.start(this.chosen, difficultyPref());
    };
    if (partyModePref() !== "join" || !autoCreatePrompt()) { go(); return; }
    this.starting = true;
    void this.noParty(go);
  }

  /** The client's m.auto_create_party prompt (mission/client/l): Cancel, or Create Public Party. */
  private async noParty(go: () => void) {
    const o = await buildUi(this.ctx, uiRef(PROMPT));
    if (!o) { go(); return; }
    const set = (tag: string, s: string) => { const c = o.find(tag); if (c) c.text = s; };
    set("title", "");
    set("prompt", text("board", "m.auto_create_party", "Sorry, we could not find you an available party. Do you want to start your own party?"));
    const hide = (c: Component) => { if (c.kind === "spacer" && c.preferredSize?.width === 80 && c.preferredSize?.height === 140) c.visible = false; c.children.forEach(hide); };
    hide(o);
    const box = o.find("confirm");
    if (box) box.selected = false;
    const shut = () => { this.overlays = this.overlays.filter(x => x !== o); this.starting = false; };
    this.on(o, "dismiss", shut);
    const cancel = this.on(o, "cancel", shut);
    if (cancel) cancel.text = text("global", "m.cancel", "Cancel");
    const ok = this.on(o, "accept", () => {
      if (box?.selected) setAutoCreatePrompt(false);
      this.overlays = this.overlays.filter(x => x !== o);
      go();
    });
    if (ok) ok.text = text("board", "b.formparty", "Create Public Party");
    this.overlays.push(o);
  }

  // ------------------------------------------------------------------ the Featured Items

  /** exchange/client/p: the energy widget, the full depot button; the cards come with refresh. */
  private bindFeatured(ui: Component) {
    const host = this.board.game.featured!;
    this.on(ui, "button_showdepot", () => { this.close(); host.openDepot(); });
    const get = ui.find("button_getenergy"); if (get) get.visible = false;
    const level = ui.find("level"); if (level) level.visible = false;
    this.featured = ui;
  }

  /** The Featured Items for the knight's rank, shown from rank 2 (mission/client/r.wasAdded). */
  private async refreshFeatured() {
    const ui = this.featured, host = this.board.game.featured;
    const p = this.board.progress;
    if (!ui || !host || p.rank <= 1) { this.beside = null; return; }
    const energy = ui.find("crystalenergy");
    if (energy) energy.text = String(Math.max(0, Math.floor(host.energy()))).padStart(5, "0");
    const src = host.source();
    const goods = src ? featuredGoods({ ...src, names: () => this.board.game.data.library_("config/item.dat").keys() }, p.rank) : [];
    const key = goods.map(g => g.name).join("|") + this.canvas.clientHeight;
    this.beside = ui;
    if (key === this.featuredKey) return;
    this.featuredKey = key;
    const list = ui.find("featureditems_list");
    if (!list) return;
    const cards = (await Promise.all(goods.map(g => this.featuredCard(g)))).filter((c): c is { ui: Component; label: Component | null; good: FeaturedGood } => !!c);
    // as many cards as the screen's height holds (at least one; exchange/client/p.a)
    list.children = [];
    this.countdowns = [];
    for (const c of cards) {
      c.ui.constraints = null;
      list.children.push(c.ui);
      if (list.children.length > 1 && pack(ui).height > this.canvas.clientHeight - 25) { list.children.pop(); break; }
      if (c.label) this.countdowns.push({ label: c.label, endsAt: c.good.endsAt });
    }
    this.tickCountdowns(true);
  }

  /** A featured card (preview_maker.dat) in its promo frame, the countdown under it. */
  private async featuredCard(g: FeaturedGood): Promise<{ ui: Component; label: Component | null; good: FeaturedGood } | null> {
    const fmt = (n: number) => n.toLocaleString("en-US");
    const [card, frame, icon] = await Promise.all([
      this.part(PREVIEW, { "Item Name": label(g.name), Promo: "true", Price: fmt(g.price), "Original Price": fmt(g.original), "Item Count": "",
        "Rank Visible": g.rarity >= 0, Rank: String(g.rarity), Locked: "Hidden", Equippable: "True" }, g.name),
      this.part(PROMO, {}, g.name),
      this.iconImage(this.board.iconOf(g.name), 128),
    ]);
    if (!card) return null;
    // the item's icon at 128 pixels in the icon's place (exchange/client/i.AK)
    const spot = card.find("icon");
    if (spot && icon) { spot.icon = icon; spot.styles = spot.styles.map(s => s ? { ...s, background: null } : s); }
    const view = card.children.find(c => c.kind === "view");
    if (view) view.visible = false;
    const btn = card.find("button");
    if (btn) btn.onAction = () => void this.purchase(g);
    if (!frame) return { ui: card, label: null, good: g };
    const top = frame.find("top"), bottom = frame.find("bottom"), content = frame.find("content");
    if (top) top.visible = false;
    if (content) {
      const at = frame.children.indexOf(content);
      card.constraints = content.constraints;
      if (at >= 0) frame.children[at] = card;
    }
    return { ui: frame, label: bottom, good: g };
  }

  /** The countdowns under the cards (RankGood.PromoType.formatCountdown), every half minute. */
  private tickCountdowns(force = false) {
    const now = Date.now();
    if (!force && now - this.lastCountdown < 30_000) return;
    this.lastCountdown = now;
    for (const c of this.countdowns) {
      const { key, n } = promoCountdown(c.endsAt - now);
      c.label.text = message("mission", key, n) || `${n} hours left`;
    }
    if (this.countdowns.some(c => c.endsAt <= now)) { this.featuredKey = ""; void this.refreshFeatured(); }
  }

  /** exchange/client/j: the purchase window (interface_purchase_2.dat): the cost, the item, Confirm. */
  private async purchase(g: FeaturedGood) {
    const host = this.board.game.featured;
    const [o, pill] = await Promise.all([buildUi(this.ctx, uiRef(PURCHASE)), this.itemPill(g.name, 1, "buy")]);
    if (!o || !host) return;
    this.host.sound("sound/feedback/ui_open.ogg");
    const set = (tag: string, s: string) => { const c = o.find(tag); if (c) c.text = s; };
    set("cost", g.price.toLocaleString("en-US"));
    for (const tag of ["quantityContainer", "preview", "status", "ad_widget"]) { const c = o.find(tag); if (c) c.visible = false; }
    const item = o.find("item");
    if (item && pill) {
      const holder = findHolder(o, item);
      pill.constraints = item.constraints;
      if (holder) holder.children[holder.children.indexOf(item)] = pill;
    }
    const shut = () => { this.overlays = this.overlays.filter(x => x !== o); };
    this.on(o, "dismiss", shut);
    const ok = this.on(o, "confirm", () => {
      if (!host.buy(g.name, g.price)) { this.host.sound("sound/feedback/ui_error.ogg"); notice(host.energy() < g.price ? `Not enough energy for ${label(g.name)}.` : `You already have ${label(g.name)}.`); return; }
      this.host.sound("sound/feedback/ui_merchant_trade_add.ogg");
      notice(`You have obtained ${label(g.name)}.`);
      shut();
      this.featuredKey = "";
      void this.refresh();
    });
    if (ok) ok.enabled = host.energy() >= g.price;
    this.overlays.push(o);
  }

  // ------------------------------------------------------------------ the ARCADE tab

  /** MissionPanel.Wo: a card per gate (its emblem and name), up to five, the chosen one's map, materials and party configuration. */
  private async refreshArcade(ui: Component, gen: number) {
    const host = this.board.game;
    const all = host.gates ? await host.gates() : [];
    if (gen !== this.generation) return;
    this.gates = all.filter(c => c.active && c.gate).slice(0, PER_PAGE);
    this.gate = Math.min(this.gate, Math.max(0, this.gates.length - 1));
    const prev = ui.find("btn_prev"), next = ui.find("btn_next");
    if (prev) prev.enabled = false;
    if (next) next.enabled = false;
    const row = ui.find("middle_container");
    const built = await Promise.all(Array.from({ length: PER_PAGE }, (_, i) => this.gateCard(this.gates[i] ?? null, i)));
    if (gen !== this.generation) return;
    if (row) built.forEach((c, i) => {
      const at = row.children.findIndex(k => k.tag === `ui_mission_${i}`);
      if (!c || at < 0) return;
      c.constraints = row.children[at].constraints;
      c.tag = `ui_mission_${i}`;
      row.children[at] = c;
      const btn = c.find(`btn_mission_${i}`);
      if (btn) {
        btn.selected = i === this.gate && !!this.gates[i];
        btn.onAction = () => {
          if (!this.gates[i]) return;
          this.gate = i;
          this.host.sound("sound/feedback/ui_dropdown_select.ogg");
          void this.refresh();
        };
      }
    });
    const bottom = ui.find("bottom_container"), empty = ui.find("bottom_empty");
    const g = this.gates[this.gate]?.gate ?? null;
    if (bottom) bottom.visible = !!g;
    if (empty) empty.visible = !g;
    if (!g) return;
    // the briefing pane gives way to the map and materials tabs
    this.swapBriefing(true);
    await this.mapView.show(g);
    const mats = this.materials;
    if (mats) {
      const lists = this.board.stratumMaterials(g.real?.themes?.length ? g.real.themes : g.strata.map(s => s.theme));
      await Promise.all(lists.map(async (names, i) => {
        const box = mats.find(`subtier${i + 1}`);
        if (!box) return;
        const pills = await Promise.all(names.map(n => this.itemPill(n, 1, "mat", this.board.rarityOf(n))));
        box.children = pills.filter((c): c is Component => !!c);
        for (const c of box.children) c.constraints = null;
      }));
    }
    if (gen !== this.generation) return;
    const mission = ui.find("mission_container");
    if (mission && this.party) {
      this.party.constraints = null;
      mission.children = [this.party];
      const start = this.party.find("start");
      if (start) start.enabled = !this.starting;
      this.bindPartyState();
    }
  }

  /** A gate's card: the gate image (its emblem in its colours) and name, no rank (MissionPanel.Wo). */
  private gateCard(c: GateChoice | null, i: number): Promise<Component | null> {
    const g = c?.gate ?? null;
    const key = `gate|${g?.id ?? ""}|${i}`;
    let p = this.cards.get(key);
    if (!p) {
      const args = g ? { "Card Image": EMPTY_CARD, Empty: "False", Status: "Unlocked", "Button Tag": `btn_mission_${i}` }
        : { "Card Image": EMPTY_CARD, Empty: "True", Status: "Unlocked", "Button Tag": `btn_mission_${i}` };
      p = buildUi(this.ctx, uiRef(CARD, args)).then(async ui => {
        if (!ui) return null;
        for (const tag of ["icon", "rank_cont", "mission_completed"]) { const x = ui.find(tag); if (x) x.visible = false; }
        const btn = ui.find(`btn_mission_${i}`);
        if (btn) btn.enabled = !!g;
        if (!g) return ui;
        const name = ui.find("name");
        if (name) name.text = g.name;
        const image = ui.find("image"), gi = ui.find("gate_image");
        if (image) image.visible = false;
        if (gi) {
          gi.visible = true;
          const em = c?.entry ? gateEmblem(c.entry.colour, c.entry.symbol) : { file: gatePiece(g, i), colorizations: [] };
          await restyle(this.ctx, gi, "Card Gate Image", { File: em.file, Colorizations: em.colorizations }).catch(() => undefined);
        }
        return ui;
      });
      this.cards.set(key, p);
    }
    return p;
  }

  /** Puts the map and materials tabs in the briefing pane's place, or the briefing pane back. */
  private swapBriefing(materials: boolean) {
    const bottom = this.root?.find("bottom_container"), brief = this.briefingPane, mats = this.materials;
    if (!bottom || !brief || !mats) return;
    const [from, to] = materials ? [brief, mats] : [mats, brief];
    const at = bottom.children.indexOf(from);
    if (at < 0) return;
    to.constraints = from.constraints;
    bottom.children[at] = to;
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

  /** An item pill (item/client/j.a): the item's icon, name (and count) and its stars when it has any. */
  private itemPill(item: string, count: number, key = "", rarity = -1) {
    const icon = this.board.iconOf(item);
    return this.part(PILL, { Name: `${count > 1 ? count + " " : ""}${label(item)}`, Rarity: String(rarity > 0 ? rarity : -1), Equipped: "False", Hoverable: true,
      Icon: icon?.file ?? BLANK, Colorization: icon?.colorizations ?? [], Variants: "0", Accessory: false }, key);
  }

  private async prestigePill(prestige: number, key = "") {
    const c = await this.part(PRESTIGE_PILL, { Hoverable: true, Prestige: String(prestige) }, key);
    // the pill's name is a message key the game fills in
    const n = c?.find("entryselect");
    if (n) n.text = "Prestige";
    return c;
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
    for (const [tab, tag] of TABS) { const c = ui.find(tag); if (c) c.selected = tab === this.tab && (tab !== "arcade" || !!b.game.gates); }
    void this.refreshFeatured();
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
    if (this.tab === "arcade") { await this.refreshArcade(ui, gen); return; }
    this.swapBriefing(false);

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
      if (body) body.text = m ? b.briefingOf(m) : "";
      const fixed = brief.children.filter(k => !k.tag?.startsWith("brief_extra"));
      brief.children = fixed;
      if (m) {
        // (MissionPanel.Ws: REWARDS and its table only when there is something to give; the
        // items those of the reward tiers up to the chosen difficulty, a pill an item with its count)
        const items = new Map<string, number>();
        for (const it of b.rewardsOf(m)) items.set(it.item, (items.get(it.item) ?? 0) + it.count);
        const any = items.size > 0 || m.prestige > 0;
        const extra = (await Promise.all([
          m.objective ? this.text(withName(m.objective, b.knight()), "Briefing Styles/Summary") : null,
          m.cls === "Prestige" && m.onceOnly ? this.text(text("mission", "m.once_only", "This mission can only be played once per day."), "Briefing Styles/Summary") : null,
          any ? this.text(text("mission", "t.rewards", "REWARDS"), "Briefing Styles/Header") : null,
          any ? this.table([...(m.prestige > 0 ? [this.prestigePill(m.prestige)] : []),
            ...[...items].slice(0, 8).map(([item, count]) => this.itemPill(item, count, "", this.board.rarityOf(item)))]) : null,
        ])).filter((c): c is Component => !!c);
        if (gen !== this.generation) return;
        extra.forEach((c, i) => { c.tag = `brief_extra${i}`; c.constraints = null; });
        brief.children = [...fixed, ...extra];
      }
    }
    if (mission) {
      // (MissionPanel.Ww empties the pane, its MISSION placeholder with it); the old card's
      // action goes at once, the new one follows when built
      mission.children = [];
      const kids: Promise<Component | null>[] = [];
      if (m) {
        const st = missionStatus(m, p);
        if (m.kind === "exchange") kids.push(...this.exchangePane(m, st));
        else if (isGateMission(m) && this.party) {
          // a gate mission: the party configuration (MissionPanel.e), its START enabled while the mission can start
          const start = this.party.find("start");
          if (start) start.enabled = st === "available" && !this.starting;
          this.bindPartyState();
          kids.push(Promise.resolve(this.party));
        } else {
          // the Comlink START, enabled while the mission can start
          kids.push(this.button(text("mission", "m.start", "START"), () => b.start(m), st === "available", "Adventure Board/Start Button/Comlink/Start"));
        }
      }
      const done = (await Promise.all(kids)).filter((c): c is Component => !!c);
      if (gen !== this.generation) return;
      for (const c of done) c.constraints = null;
      mission.children = done;
    }
  }

  private lastMapTick = 0;
  protected tick() {
    this.tickBars();
    const now = performance.now();
    if (this.tab === "arcade" && now - this.lastMapTick > 500) { this.lastMapTick = now; this.mapView.update(); }
    this.tickCountdowns();
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
    const key = `${m?.id ?? ""}|${st}|${unknown}|${m ? p.difficulty?.[m.id] ?? "" : ""}|` + JSON.stringify(args);
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
            : text("mission", `t.tier_${m.rank >= 6 ? 3 : m.rank >= 4 ? 2 : 1}`, `TIER ${m.rank >= 6 ? 3 : m.rank >= 4 ? 2 : 1}`));
          set("rank", m.cls === "Rank" ? `${m.rank}-${m.subrank}` : "");
          const done = ui.find("mission_completed");
          if (done) done.visible = false;
          const icon = ui.find("icon");
          if (icon) {
            icon.visible = st === "complete" || locked;
            const file = st === "complete" ? completedIcon(m, p) : "ui/icon/inventory/icon_locked.png";
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

  private tickBars() {
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
  async completed(m: Mission, items: { item: string; count: number }[], rankUp: string | null) {
    const [win, up] = await Promise.all([buildUi(this.ctx, uiRef(COMPLETE)), rankUp ? buildUi(this.ctx, uiRef(RANKUP)) : null]);
    if (!win) return;
    const set = (tag: string, text: string) => { const c = win.find(tag); if (c) c.text = text; };
    set("title", text("mission", "t.missioncomplete", "Mission Complete"));
    set("name", m.title.toUpperCase());
    set("objective", withName(m.objective || m.summary, this.board.knight()));
    const rewards = win.find("rewards");
    if (rewards) {
      const pills = await Promise.all([...(m.prestige > 0 ? [this.prestigePill(m.prestige, "done")] : []),
        ...items.slice(0, 8).map(it => this.itemPill(it.item, it.count, "done", this.board.rarityOf(it.item)))]);
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
}

/** The container directly holding `c` under `root`. */
function findHolder(root: Component, c: Component): Component | null {
  if (root.children.includes(c)) return root;
  for (const k of root.children) { const r = findHolder(k, c); if (r) return r; }
  return null;
}
