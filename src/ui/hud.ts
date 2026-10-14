// The in-dungeon HUD, built from the game's own interface files in rsrc/ui/hud_v2: the
// status panel (portrait, name plate, health and shield bars, heat meter, debuffs), the
// quickbar (sprite skills, pocket items, vitapod), the minimap, the corner menus, the
// activities and objective panels, the target panel, the dash cooldown, the weapon switcher
// and the hit flash and low-health frames. What the client does with them in code (which
// parts show, their style switches and sizes, the trailing damage segment, the heat levels)
// follows its own HUD classes; docs/research/ui-audit-hud.md lists them.

import { CONFIG_REF } from "../config/params";
import { message, text } from "../i18n";
import type { World } from "../game/world";
import { restyle, buildInterface, buildComponentConfig, hitTest, pack, render, type Component, type GuiContext, type RenderHooks } from "./gui";
import { ScriptRunner } from "./script";
import { Minimap } from "./minimap";
import { buildUi, type TipSpec } from "./screen";
import { prestigeIcon } from "../game/missions";

const STATUS = "ui/hud_v2/interface_status.dat";
const QUICKBAR = "ui/hud_v2/interface_quickbar.dat";
const HIT_FLASH = "ui/hud_v2/interface_hitflash.dat";
const LOW_HEALTH = "ui/hud_v2/interface_lowhealth.dat";
const MINIMAP = "ui/hud_v2/interface_minimap.dat";
const MENU_LEFT = "ui/hud_v2/interface_menu-left.dat";
const MENU_RIGHT = "ui/hud_v2/interface_menu-right.dat";
const ACTIVITIES = "ui/hud_v2/interface_activities.dat";
const OBJECTIVE = "ui/hud_v2/interface_objective.dat";
const TARGET = "ui/hud_v2/interface_status-mini.dat";
const COOLDOWN = "ui/hud_v2/parts/interface_cooldown.dat";
const SPRITE_SLOT = "ui/hud_v2/parts/interface_spriteslot.dat";
const WEAPON_SWITCH = "ui/hud/parts/interface_weaponswitch.dat";

/** Activities whose text the client sets in code (the rest are message keys in the file). */
const LABELS: Record<string, [string, string]> = {
  button_readyroom: ["b.to_readyroom", "Ready Room"], button_guildhall: ["b.to_guildhall", "Go to Guild Hall"],
  button_furni: ["b.furni", "Furnishings"], button_missions: ["m.missions_item", "Missions"], button_supplydepot: ["m.supply_depot", "Supply Depot"],
};
/** The corner menus' buttons (client hud/y and hud/P), whose hotkey badges show their bound command. */
const MENU_BUTTONS = ["button_menu", "button_help", "button_social", "button_feed", "button_mail", "button_gear", "button_loadout", "button_arsenal", "button_forge"];
/**
 * Activities the client shows only for online features (hud/a.bv): the account button, other
 * guilds' halls, the Coliseum and its spectating, the party finder, and the trade, party
 * invite and party found notifications with their divider.
 */
const HIDDEN = ["button_spare", "button_visithalls", "container_pvp", "button_pvp_spectate", "container_partyfinder",
  "button_traderequest", "button_partyinvite", "button_partyfound", "notes_div"];

/** The monster the knight is fighting, for the target panel. */
export interface HudTarget {
  key: string; name: string; health: number; maxHealth: number; family: string; model: any; idle: any;
  /** The description's family icon, and the damage types it is weak to and deals (DescriptionConfig.Monster). */
  icon?: string | null; weakness?: string; attack?: string;
  /** A non-monster description (DescriptionConfig.Descriptive): its title and text instead of a health bar. */
  desc?: { title: string; info: string };
}

/** The low-health frame shows while the trailing health is under this fraction of the maximum (client status panel). */
const LOW_HEALTH_FRACTION = 0.3;
/** A heart pip is 40 health (ItemValueKey HEALTH), 12 pixels wide (the client's dA: health * 12 / 40). */
const pips = (v: number) => Math.trunc(Math.max(0, v) * 12 / 40);
/** One health row's width in pixels: 30 pips; more health stacks silver, then gold, rows over it. */
const ROW = 360;
/** Floor heat at or under each step lights the heat meter at that level (the client's thresholds). */
const HEAT_STEPS = [0, 20, 70, 140, 250, 500, 800, Infinity];

/** The heat meter's level for the heat collected on the floor: 0 for none, then 1 to 7. */
export function heatLevel(amount: number): number {
  if (!(amount > 0)) return 0;
  const i = HEAT_STEPS.findIndex(s => amount <= s);
  return i < 0 ? HEAT_STEPS.length : i;
}

const ref = (name: string, args: Record<string, unknown> = {}) =>
  ({ $class: CONFIG_REF, name, arguments: { $map: "com.threerings.config.ArgumentMap", entries: Object.entries(args) } });

export interface HudState {
  name: string;
  /** The minimap's floor label. */
  floor: string;
  health: number;
  maxHealth: number;
  shield: number;
  shieldMax: number;
  shieldBroken: boolean;
  shielding: boolean;
  /** The shield's star rating (the shield bar is 60 pixels a star, 0 to 5). */
  shieldRarity: number;
  weapons: { icon: any; name: string; selected: boolean }[];
  /** Active conditions: HUD icon name and whole seconds left. */
  statuses: { icon: string; ui: string; seconds: number }[];
  pocket: { icon: any; count: number }[];
  /** The keys bound to the four pocket slots. */
  pocketKeys?: string[];
  /** The equipped vitapod's icon and capsule count. */
  vitapod: { icon: any; count: number } | null;
  /** The heat collected on this floor (the heat meter). */
  heat: number;
  /** In a dungeon (the dungeon HUD: heat, quickbar, cooldown, weapon switcher, damage frames). */
  dungeon: boolean;
  /** Seconds until the knight can dash again. */
  dashCooldown: number;
  target: HudTarget | null;
  /** Lines for the objective panel. */
  objectives: string[];
  /** In a town (the activities panel opens; in dungeons it starts folded). */
  town: boolean;
  /** The battle sprite's skills (the sprite slots on the quickbar), or absent. */
  sprite?: { icon: any; seconds: number; ready: boolean; locked: boolean; hotkey: string }[];
  /** The portrait's rank label ("Rank 1-1"). */
  rank?: string;
  /** The knight's personal colour (a colorization id) for the portrait's backdrop. */
  color?: number;
  /** The key bound to each corner menu button's command, as the game names it ("" for none). */
  menuKeys?: Record<string, string>;
  /** Keys of the minimap buttons' commands for their tooltips (keyboard keys only). */
  commandKeys?: { zoom?: string; map?: string; hudLock?: string };
  /** An unread letter: the mail button's notice, and the left menu's handle notice while folded. */
  mailNews?: boolean;
  /** The scene's camera has a closer zoom (towns and the guild hall show the zoom button). */
  zoomable?: boolean;
  /** The camera is at its closer zoom (the zoom button selected). */
  zoomed?: boolean;
  /** The knight's prestige (from completed prestige missions): the rank icon. */
  prestige?: number;
  /** Activities visibility: in the guild hall (furnishings, no "Go to Guild Hall"), in the Ready Room. */
  place?: { guildHall: boolean; readyRoom: boolean; hall: boolean };
  /** What the knight can act on now: the action hint (helptips key) and its description for the target panel. */
  action?: { hint: string | null; desc: HudDescription | null } | null;
  /** A battle sprite is out (the status panel's pet portrait). */
  pet?: boolean;
  /** The pocket and vitapod items' tooltips (the quickbar slots' item tooltips). */
  pocketTips?: (TipSpec | null)[];
}

/** A DescriptionConfig shown in the target panel (a townsperson, shop or item the knight can act on). */
export interface HudDescription { key: string; name: string; title: string; info: string; icon: string | null }

/** What the status panel is built for: its heat meter's level, the portrait's colour and the prestige icon. */
const statusKey = (s: HudState) => `${heatLevel(s.heat)}|${s.color ?? ""}|${prestigeIcon(s.prestige ?? 0)}`;


/** An item gained, for its acquire icon: the icon image, colorizations, count and pocket slot. */
export interface AcquireEntry { icon: string; colorizations: unknown[]; count: number; slot: number | null }

const ACQUIRE = "ui/scripted/dynamic/item_acquire.dat";

/** Where the corner menus' open or folded state is kept. */
const MENU_PREF = "clyde-web.menu_panels_out";
/** The objective panel's open or folded state (ProjectXPrefs show_objectives). */
const OBJECTIVES_PREF = "clyde-web.show_objectives";
/** The HUD lock (ProjectXPrefs hud_lock), and the map overlay (map_overlay). */
const LOCK_PREF = "clyde-web.hud_lock";
const MAP_PREF = "clyde-web.map_overlay";
const getPref = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const setPref = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? "1" : "0"); } catch { /* storage unavailable */ } };
/** Clyde's Easing CubicIn and CubicOutOvershoot (overshoot 1.70158, about 10 percent). */
const cubicIn = (t: number) => t * t * t;
const cubicOutOvershoot = (t: number) => { const o = 1.70158; t -= 1; return t * t * ((o + 1) * t + o) + 1; };

export function hudState(world: World, name: string, floor = ""): HudState {
  const k = world.knight;
  return {
    name, floor, health: k.health, maxHealth: k.maxHealth,
    shield: k.shieldHealth, shieldMax: k.shieldMax, shieldBroken: k.shieldBroken > 0, shielding: k.shielding,
    shieldRarity: k.shield ? k.shield.rarity ?? 0 : -1,
    weapons: k.weapons.map((w, i) => ({ icon: w.def.icon, name: world.economy?.displayName(w.def.name) ?? w.def.name.split("/").pop()!, selected: i === k.slot })),
    // the client counts a condition's seconds down by whole seconds left (integer division)
    statuses: k.statuses.map(s => ({ icon: s.def.icon, ui: s.def.iconUi, seconds: Math.max(0, Math.floor(s.remaining)) })),
    pocket: world.pocket.map(([n, c]) => ({ icon: world.pocketItem(n)?.icon ?? null, count: c })),
    vitapod: world.vitapod,
    heat: world.loot.heat,
    dungeon: world.depth > 0,
    dashCooldown: Math.max(0, k.dashCooldown),
    target: world.hudTarget(),
    objectives: [], town: false,
    sprite: world.companion?.hud(),
    color: world.color,
  };
}

/**
 * A bar's value and the value it trails behind (the client's status panel): a change leaves
 * the old value as a damage (or heal) segment that closes 10 points every 20 ms after half a second.
 */
class Trail {
  cur = -1;
  trail = 0;
  private wait = 0;
  private acc = 0;

  /** Sets the value; returns "down" or "up" when a segment opens. */
  set(v: number, reset = false): "down" | "up" | null {
    v = Math.max(0, Math.round(v));
    if (reset || this.cur < 0) { this.cur = this.trail = v; return null; }
    if (v === this.cur) return null;
    // moving the same way as the open segment keeps it; turning back closes it first
    if (Math.sign(this.cur - v) === Math.sign(this.cur - this.trail)) this.trail = this.cur;
    this.cur = v;
    if (this.trail === this.cur) return null;
    this.wait = 0.5; this.acc = 0;
    return this.cur < this.trail ? "down" : "up";
  }

  tick(dt: number) {
    if (this.trail === this.cur) return;
    if (this.wait > 0) { this.wait -= dt; if (this.wait > 0) return; this.acc = 0.02 - this.wait; }
    else this.acc += dt;
    while (this.acc >= 0.02 && this.trail !== this.cur) {
      this.acc -= 0.02;
      this.trail = this.trail > this.cur ? Math.max(this.cur, this.trail - 10) : Math.min(this.cur, this.trail + 10);
    }
  }
}

export class GameHud {
  private status: Component | null = null;
  private quickbar: Component | null = null;
  /**
   * Item-acquire icons (client hud/t): items gained wait in a queue, come up 300 ms apart as the
   * game's 3D icon (ui/scripted/dynamic/item_acquire.dat) and go after 2 s. Pocket items sit
   * beside their quickbar slot, other items by the lower-right corner.
   */
  private acquireQueue: AcquireEntry[] = [];
  private acquireShown: { ui: Component; left: number; slot: number | null }[] = [];
  private acquireWait = 0;
  private acquireBusy = false;
  private acquireSeq = 0;

  /** Queues an item gained for its acquire icon. */
  acquire(e: AcquireEntry) { this.acquireQueue.push(e); }

  private updateAcquire(dt: number) {
    this.acquireWait -= dt;
    for (const a of this.acquireShown) a.left -= dt;
    this.acquireShown = this.acquireShown.filter(a => a.left > 0);
    if (!this.acquireQueue.length || this.acquireWait > 0 || this.acquireBusy) return;
    const e = this.acquireQueue.shift()!;
    this.acquireBusy = true;
    this.acquireWait = 0.3;
    const count = e.count > 1 ? String(e.count) : "";
    void buildInterface(this.ctx, ref(ACQUIRE, { Icon: e.icon, Colorizations: e.colorizations, ItemCount: count, ItemCountVisible: e.count > 1 }))
      .then(ui => {
        if (!ui) return;
        const v = findKind(ui, "view");
        if (v) v.viewOwner = "acquire:" + (this.acquireSeq++);
        this.acquireShown.push({ ui, left: 2, slot: e.slot });
      })
      .catch(() => { /* the icon is skipped */ })
      .finally(() => { this.acquireBusy = false; });
  }
  /** The heat level and colour the status panel was built with (its heat meter's HeatPower). */
  private built: string | null = null;
  private building = false;
  private icons = new Map<string, Component["icon"]>();
  private hitFlash: Component | null = null;
  private lowHealth: Component | null = null;
  /** Whether the low-health frame is up, or fading out. */
  private low: "off" | "on" | "fading" = "off";
  private runners = new Map<Component, ScriptRunner>();
  private minimapUi: Component | null = null;
  readonly minimap: Minimap;
  /** Built debuff icons (ui/health/debuff.dat) by icon and seconds left. */
  private debuffs = new Map<string, Component | null>();
  private hp = new Trail();
  private sh = new Trail();
  private maxSeen = -1;
  /** Blocking: the shield bar large and the health bar half height (null until first applied). */
  private blocking: boolean | null = null;
  /** The difference segments' current style (colour and variant) per bar. */
  private diffStyle = new Map<string, string>();
  private heartVariant = "";
  private lastHeat = 0;

  constructor(private readonly ctx: GuiContext, readonly hooks: RenderHooks = {}) {
    this.minimap = new Minimap(ctx);
    // the map draws in the map layer (after the faceplate, under the hash marks and gloss), in
    // the mask's square at the layer's upper-right corner
    hooks.tagged = { ...(hooks.tagged ?? {}), maplayer: (_c, g, x, y, w, h) => this.minimap.draw(g, x, y, w, h) };
  }

  /** Starts loading the interfaces; draw() shows them once ready. */
  async init(state: HudState) {
    await Promise.all([this.rebuildStatus(state), this.buildQuickbar(), this.buildMenus(),
      buildInterface(this.ctx, ref(HIT_FLASH)).then(ui => { this.hitFlash = ui; }),
      buildInterface(this.ctx, ref(LOW_HEALTH)).then(ui => { this.lowHealth = ui; }),
      buildInterface(this.ctx, ref(MINIMAP)).then(ui => { this.minimapUi = ui; }),
      buildInterface(this.ctx, ref(WEAPON_SWITCH)).then(ui => { if (ui) ui.visible = false; this.switcher = ui; })]);
  }

  private async rebuildStatus(state: HudState) {
    const key = statusKey(state);
    if (this.building || this.built === key) return;
    this.building = true;
    try {
      // the portrait's backdrop wears the personal colour (the client restyles Backing/Backdrop
      // with it; the interface passes its Portrait Colorization there)
      const ui = await buildInterface(this.ctx, ref(STATUS, { Name: state.name, "Dungeon UI": true, HeatPower: `Level ${heatLevel(state.heat)}`,
        ...(state.color !== undefined ? { "Portrait Colorization": state.color } : {}) }));
      if (ui) {
        const blocking = this.blocking ?? false;
        await this.applyBlocking(ui, blocking);
        await this.bindPortrait(ui, state);
        this.lockApplied = null;
        this.status = ui; this.built = key; this.heartVariant = ""; this.diffStyle.clear(); this.blocking = blocking;
      }
    } finally { this.building = false; }
  }

  /**
   * The client's shield switch: while blocking, the health bar drops to half height (Pip Half)
   * and the shield bar grows (Bar); otherwise the reverse. Every row's style is recoloured for
   * its tier (silver and gold rows) with the bar's colorization (health 261, shield 275).
   */
  private async applyBlocking(ui: Component, blocking: boolean) {
    const healthVariant = blocking ? "Pip Half" : "Pip", shieldVariant = blocking ? "Bar" : "Bar Half";
    await Promise.all([this.recolor(ui.find("health_ui"), healthVariant, 261), this.recolor(ui.find("shield_ui"), shieldVariant, 275)]);
    const size = (tag: string, w: number, h: number, root: Component | null = ui) => { const c = root?.find(tag); if (c) c.preferredSize = { width: w, height: h }; };
    const big = blocking ? 20 : 32, small = blocking ? 32 : 20;
    size("vitapod", big, big);
    size("container_vitapod", 32, big);
    size("shield", small, small);
    // the shield icon's own container (the inner one of the two tagged container_shield)
    const inner = ui.find("container_shield")?.children.find(c => c.tag === "container_shield");
    if (inner) inner.preferredSize = { width: 32, height: small };
    for (const [part, h] of [["health_ui", big], ["shield_ui", small]] as const) {
      for (const tag of ["health", "health1", "health2", "health_difference", "health_difference1", "health_difference2", "health_backing"]) {
        const c = ui.find(part)?.find(tag);
        if (c) c.preferredSize = { width: c.preferredSize?.width ?? 0, height: h };
      }
    }
    this.diffStyle.clear();
  }

  /**
   * The portrait (hud/F.Km, Kn): the rank icon is the prestige rank's icon (none below 5000
   * prestige), in the personal colour; the elliptical rim is the personal menu's button.
   */
  private async bindPortrait(ui: Component, s: HudState) {
    const p = ui.find("portrait_player");
    const rim = p?.find("rim_button");
    if (rim) rim.tooltip = text("projectx", "m.personal_menu", "Personal Menu");
    const icon = p?.find("rank_icon");
    if (!icon) return;
    const file = prestigeIcon(s.prestige ?? 0);
    icon.icon = file ? await this.ctx.image(file, s.color !== undefined
      ? [{ $class: "com.threerings.opengl.renderer.config.ColorizationConfig$Normal", colorization: s.color }] : undefined) : null;
  }

  private async recolor(part: Component | null, variant: string, colorization: number) {
    if (!part) return;
    await Promise.all(["health", "health1", "health2", "health_difference", "health_difference1", "health_difference2", "health_backing"].map(tag => {
      const c = part.find(tag);
      const tier = tag === "health1" ? " Silver" : tag === "health2" ? " Gold" : "";
      return c ? restyle(this.ctx, c, "Health-Recolor", { Variant: variant + tier, Colorization: colorization }) : undefined;
    }));
    const back = part.find("health_backing");
    if (back) await restyle(this.ctx, back, "Backing", { Variant: variant });
  }

  private async buildQuickbar() {
    const ui = await buildInterface(this.ctx, ref(QUICKBAR));
    if (!ui) return;
    // the client puts the battle sprite's three skill slots where the file has bs0 to bs2
    const slots = await Promise.all([0, 1, 2].map(() => buildInterface(this.ctx, ref(SPRITE_SLOT, { Cooldown: "", Hotkey: "" }))));
    slots.forEach((s, i) => {
      const host = ui.find("bs" + i);
      if (!s || !host) return;
      s.constraints = host.constraints;
      replaceChild(ui, host, s);
      const slot = s.find("slot");
      if (slot) slot.visible = false;
    });
    this.spriteSlots = slots.filter((s): s is Component => !!s);
    // the vitapod slot's button takes no hover (dungeon/client/at): no tooltip
    const vr = ui.find("vitaslot")?.find("slot_ring");
    if (vr) vr.hoverable = false;
    this.quickbar = ui;
    this.lockApplied = null;
  }

  private menuLeft: Component | null = null;
  private menuRight: Component | null = null;
  private activities: Component | null = null;
  private objective: Component | null = null;
  private cooldown: Component | null = null;
  private target: Component | null = null;
  private targetKey = "";
  /** The target panel fading out after its target is gone (seconds left). */
  private targetFade = 0;
  private folded = new Map<Component, boolean>();
  /**
   * The HUD lock (dungeon HUD only, TOGGLE_HUD_LOCK and the minimap's lock button; kept as
   * ProjectXPrefs hud_lock): the menus and quickbar take no clicks and their buttons disable,
   * the activities and objectives fold, the minimap's zoom and map buttons and the portrait's
   * rim disable.
   */
  private lockPref = getPref(LOCK_PREF) === "1";
  get locked() { return this.dungeon && this.lockPref; }
  private lockApplied: boolean | null = null;

  toggleLock() {
    if (!this.dungeon) return;
    this.lockPref = !this.lockPref;
    setPref(LOCK_PREF, this.lockPref);
  }

  /** The map overlay (client hud/z in map/client/c's full-screen window), kept as ProjectXPrefs map_overlay. */
  mapOverlay = getPref(MAP_PREF) === "1";
  toggleMap() { this.mapOverlay = !this.mapOverlay; setPref(MAP_PREF, this.mapOverlay); }

  /** Applies the lock to the panels when it changes (dungeon/client/i.OU). */
  private applyLock() {
    const locked = this.locked;
    if (locked === this.lockApplied) return;
    this.lockApplied = locked;
    for (const ui of [this.menuLeft, this.menuRight, this.activities, this.objective]) {
      if (!ui) continue;
      const walk = (c: Component) => { if (c.kind === "button") c.enabled = !locked; c.children.forEach(walk); };
      walk(ui);
    }
    // the activities and objectives fold under the lock (hud/a.aC, hud/E.aC)
    if (locked) for (const ui of [this.activities, this.objective]) if (ui && !this.folded.get(ui)) this.fold(ui, true);
    const mm = this.minimapUi;
    for (const tag of ["button_zoom", "button_map"]) { const b = mm?.find(tag); if (b) { b.enabled = !locked; b.hoverable = !locked; } }
    const lock = mm?.find("button_lockhud");
    if (lock) { lock.selected = locked; lock.enabled = this.dungeon; lock.hoverable = this.dungeon; }
    const rim = this.status?.find("rim_button");
    if (rim) { rim.enabled = !locked; rim.hoverable = !locked; }
    // the quickbar's slots take the disabled button style (dungeon/client/ah and at)
    if (this.quickbar) {
      for (const tag of ["slot0", "slot1", "slot2", "slot3"]) {
        const ring = this.quickbar.find(tag)?.find("slot_ring");
        if (ring) void restyle(this.ctx, ring, "Hud/Quickbar/Button" + (locked ? ":Disabled" : ""));
      }
      const vr = this.quickbar.find("vitaslot")?.find("slot_ring");
      if (vr) void restyle(this.ctx, vr, "Hud/Quickbar/Vitaslot/Button" + (locked ? ":Disabled" : ""));
    }
  }
  private townBuilt: boolean | null = null;
  private hovered: Component | null = null;
  /** Display options: the minimap, and the damage effects (the red flash when hit and the low-health frame). */
  options = { minimap: true, screenFlash: true };
  /** Whether the HUD is drawn in dungeon mode (set from the last update). */
  private dungeon = false;

  /** The corner menus, the activities and objective panels and the dash cooldown. */
  private async buildMenus() {
    const [l, r, a, o, c] = await Promise.all([
      buildInterface(this.ctx, ref(MENU_LEFT)), buildInterface(this.ctx, ref(MENU_RIGHT)),
      buildInterface(this.ctx, ref(ACTIVITIES)), buildInterface(this.ctx, ref(OBJECTIVE)),
      buildInterface(this.ctx, ref(COOLDOWN, { Icon: "ui/icon/cooldown/cd_d.png", "Seconds Remaining": "" })),
    ]);
    for (const ui of [l, r, a]) {
      if (!ui) continue;
      for (const tag of HIDDEN) { const b = ui.find(tag); if (b) b.visible = false; }
    }
    if (a) {
      for (const [tag, [key, fallback]] of Object.entries(LABELS)) { const b = a.find(tag); if (b) b.text = text("projectx", key, fallback); }
      const t = a.find("label_title"); if (t) t.text = text("projectx", "t.activities", "Activities");
    }
    if (o) { const t = o.find("label_title"); if (t) t.text = text("projectx", "m.current_objective", "Current Objective"); }
    if (c) { const v = findKind(c, "view"); if (v) v.viewOwner = "cooldown"; }
    this.menuLeft = l; this.menuRight = r; this.activities = a; this.objective = o; this.cooldown = c;
    // the corner menus open or folded as the player left them (ProjectXPrefs menu_panels_out,
    // open by default); the objectives as show_objectives left them (open by default)
    for (const m of [l, r]) if (m) this.fold(m, getPref(MENU_PREF) === "0", false);
    if (o) this.fold(o, getPref(OBJECTIVES_PREF) === "0", false);
    // load the target panel's images and fonts now, so the first monster struck shows at once
    void buildInterface(this.ctx, ref(TARGET, { Name: "", "Dungeon UI": true, Model: null, Rank: "", Background: "Full" }));
  }

  /**
   * The target panel (the client's description panel): the mini status interface with no
   * model, the monster's family icon in the ring, its name, a 200 x 12 health bar, its
   * weakness and the damage type it deals.
   */
  private async rebuildTarget(t: HudTarget) {
    this.targetKey = t.key;
    const ui = await buildInterface(this.ctx, ref(TARGET, { Name: t.name, "Dungeon UI": true, Model: null, Rank: "", Background: "Full" }));
    if (!ui || this.targetKey !== t.key) return;
    for (const tag of ["health_difference", "model", "status_icon", "container_debuffs", "label_title", "label_information"]) {
      const c = ui.find(tag); if (c) c.visible = false;
    }
    // a description that is not a monster's shows its title and text, and no health (hud/q.JV)
    if (t.desc) {
      const set = (tag: string, v: string) => { const c = ui.find(tag); if (c) { c.text = v; c.visible = true; } };
      set("label_title", t.desc.title);
      set("label_information", t.desc.info);
      const hb = ui.find("health_ui"); if (hb) hb.visible = false;
    }
    const backdrop = ui.find("backdrop");
    if (backdrop) backdrop.styles = [null, null, null];
    const size = (tag: string, w: number, h: number) => { const c = ui.find(tag); if (c) c.preferredSize = { width: w, height: h }; };
    size("health_backing", 200, 12);
    size("health", 200, 12);
    size("container_name", 200, 22);
    const info = ui.find("info_container");
    if (info) info.preferredSize = { width: 200, height: info.preferredSize?.height ?? -1 };
    const jobs: Promise<unknown>[] = [];
    const fam = ui.find("family_icon");
    const icon = t.icon ?? (t.family ? `ui/icon/theme/${t.family}.png` : null);
    if (fam && icon) jobs.push(restyle(this.ctx, fam, "Family_Icon", { File: icon }));
    const weak = (t.weakness ?? "NORMAL").toUpperCase();
    const wbox = ui.find("container_weakness"), wlabel = ui.find("label_weakness");
    if (wbox) wbox.visible = !t.desc && weak !== "NORMAL" && weak !== "UNBLOCKABLE";
    if (wlabel && wbox?.visible) {
      wlabel.text = text("item", "m." + weak.toLowerCase(), weak.charAt(0) + weak.slice(1).toLowerCase());
      jobs.push(restyle(this.ctx, wlabel, "Hud/Status/Mini/Weakness Label", { Color: weak.toLowerCase() }));
    }
    const atk = ui.find("icon_attack");
    if (atk && t.desc) atk.visible = false;
    else if (atk) {
      atk.visible = true;
      jobs.push(restyle(this.ctx, atk, "Hud/Status/Mini/Debuff_Icon", { File: `ui/icon/stats/attack_${(t.attack ?? "NORMAL").toLowerCase()}.png` }));
    }
    await Promise.all(jobs);
    if (this.targetKey === t.key) { this.target = ui; this.target.setAlpha(1); this.targetFade = 0; }
  }

  /** Panels sliding to or from their folded place: the x offset now, and the slide in progress. */
  private offsets = new Map<Component, number>();
  private slides = new Map<Component, { from: number; to: number; t: number; ease: (t: number) => number }>();

  /**
   * Folds or unfolds a panel (client hud/M): the whole panel slides toward its screen edge over
   * 0.2 s until only its handle shows, easing in (CubicIn) as it folds and overshooting
   * (CubicOutOvershoot) as it opens. The corner menus fold together, and their state is kept.
   */
  private fold(ui: Component, folded: boolean, animate = true) {
    this.folded.set(ui, folded);
    // where it rests (hud/M.b): open, 40 pixels out past its corner (the backing's outer edge
    // goes off screen, so the panel sits flush with the edge); folded, its width less its
    // handle's further out, so only the handle shows, against the edge
    const width = pack(ui).width, handle = this.handle(ui);
    const sign = ui === this.menuLeft ? -1 : 1;
    const to = folded ? sign * (width - (handle?.visible ? handle.width : 0)) : sign * 40;
    const from = this.dx(ui);
    if (!animate) { this.offsets.set(ui, to); this.slides.delete(ui); return; }
    this.slides.set(ui, { from, to, t: 0, ease: folded ? cubicIn : cubicOutOvershoot });
  }

  /** Advances the panels' slides. */
  private updateSlides(dt: number) {
    for (const [ui, sl] of this.slides) {
      sl.t = Math.min(1, sl.t + dt / 0.2);
      this.offsets.set(ui, Math.round(sl.from + (sl.to - sl.from) * sl.ease(sl.t)));
      if (sl.t >= 1) this.slides.delete(ui);
    }
  }

  /** The panel's x offset while it slides or sits folded. */
  /** A panel's x offset; one never folded rests open, 40 pixels out (hud/M). */
  private dx(ui: Component) { return this.offsets.get(ui) ?? (ui === this.menuLeft ? -40 : 40); }

  /** The panels taking the pointer, top first: the status panel (its rim button), the minimap, the menus, the quickbar. */
  private panels() {
    return [this.status, this.options.minimap ? this.minimapUi : null, this.menuLeft, this.menuRight, this.activities,
      this.objective?.visible ? this.objective : null, this.dungeon ? this.quickbar : null].filter((x): x is Component => !!x);
  }

  /** The button under (x, y) and the panel it is in, as the client's hit testing finds it. */
  private hitAt(x: number, y: number): { hit: Component; owner: Component } | null {
    for (const ui of this.panels()) {
      // a locked HUD's menus take no pointer at all (hud/M.getHitComponent); the quickbar neither
      if (this.locked && ui !== this.minimapUi && ui !== this.status) continue;
      const h = hitTest(ui, x, y, c => c.kind === "button" && (ui !== this.status || c.tag === "rim_button") && c.visible && c.hoverable && (c.enabled || c.tag === "button_lockhud"));
      if (!h) continue;
      // the portrait's rim is an ellipse (hud/K.contains)
      if (h.tag === "rim_button" && h.screen) {
        const r = h.screen, dx = (x - r.x - r.width / 2) / (r.width / 2), dy = (y - r.y - r.height / 2) / (r.height / 2);
        if (dx * dx + dy * dy >= 1) continue;
      }
      return { hit: h, owner: ui };
    }
    return null;
  }

  /**
   * The mouse at canvas point (x, y): lights the button under it, and on `click` returns that
   * button's tag ("button_loadout", "button_missions"...). Panel handles fold their panel.
   */
  pointer(x: number, y: number, click: boolean): string | null {
    this.mouse = { x, y };
    if (this.popupPointer(x, y, click)) return click ? "menu" : null;
    const found = this.hitAt(x, y);
    const hit = found?.hit ?? null, owner = found?.owner ?? null;
    this.mouse = { x, y };
    if (this.hovered !== hit) {
      if (this.hovered) this.hovered.hover = false;
      if (hit) hit.hover = true;
      this.hovered = hit;
      this.hoverStart = performance.now();
    }
    if (!click || !hit || !owner) return null;
    this.hoverStart = Infinity;
    if (owner === this.quickbar) return null;
    if (hit.tag === "handle") {
      const open = !!this.folded.get(owner);
      const menus = owner === this.menuLeft || owner === this.menuRight ? [this.menuLeft, this.menuRight] : [owner];
      for (const m of menus) if (m) this.fold(m, !open);
      if (menus.length > 1) setPref(MENU_PREF, open);
      if (owner === this.objective) setPref(OBJECTIVES_PREF, open);
      return "handle";
    }
    if (hit.tag === "rim_button") return this.status?.find("portrait_pet")?.find("rim_button") === hit ? "pet_portrait" : "personal_menu";
    // a menu item's tag sits on its interface host; the clickable part is the inner button
    if (hit.tag === "button") return findHost(owner, hit)?.tag ?? null;
    return hit.tag || null;
  }

  /** True when (x, y) is over a HUD button (clicks there do not attack). */
  covers(x: number, y: number): boolean {
    if (this.popup) return true;
    const h = this.hitAt(x, y);
    return !!h && h.owner !== this.quickbar;
  }

  /** The pointer over the HUD and how long the hovered button has been under it (for tooltips). */
  private mouse: { x: number; y: number } | null = null;
  private hoverStart = 0;

  private runner(ui: Component) {
    let r = this.runners.get(ui);
    if (!r) this.runners.set(ui, r = new ScriptRunner(ui));
    return r;
  }

  /** The sprite skill slots on the quickbar (ui/hud_v2/parts/interface_spriteslot.dat). */
  private spriteSlots: Component[] = [];

  /** The client's sprite slot: icon while the skill is available, cooldown seconds, enabled when ready. */
  private bindSprite(skills: HudState["sprite"]) {
    this.spriteSlots.forEach((ui, i) => {
      const s = skills?.[i];
      const has = !!s && !s.locked;
      const slot = ui.find("slot");
      if (slot) slot.visible = has;
      // the slot's root is dimmed (alpha 1/3) in the file: lit when the skill is ready
      ui.setAlpha(has && s!.ready ? 1 : has ? 0.6 : 1);
      const icon = ui.find("icon");
      if (icon) icon.icon = has && s!.icon ? this.icon(s!.icon, 40) : null;
      const cd = ui.find("cooldown");
      if (cd) { cd.visible = has && s!.seconds > 0; cd.text = cd.visible ? String(s!.seconds) : ""; }
      const hk = ui.find("slot_label");
      if (hk) { hk.text = s?.hotkey ?? ""; hk.visible = !!s?.hotkey; }
    });
  }

  /** The weapon switcher (ui/hud/parts/interface_weaponswitch.dat): shown at the centre for 0.9 s on a switch. */
  private switcher: Component | null = null;
  private switcherTime = 0;
  private lastWeapon = -1;

  /** The switcher's icons: the new weapon large, the ones before it above and after it below. */
  private bindSwitch(weapons: HudState["weapons"], now: number) {
    const ui = this.switcher, n = weapons.length;
    if (!ui || !n) return;
    const at = (i: number) => weapons[((i % n) + n) % n];
    const set = (tag: string, w: HudState["weapons"][number], size: number) => { const c = ui.find(tag); if (c) c.icon = w?.icon ? this.icon(w.icon, size) : null; };
    set("icon_rolloff_top", at(now - 2), 30);
    set("icon_next", at(now - 1), 40);
    set("icon_current", at(now), 60);
    set("icon_prev", at(now + 1), 40);
    set("icon_rolloff_bottom", at(now + 2), 30);
    const name = ui.find("weapon_name");
    if (name) name.text = at(now).name;
  }

  private showSwitch(weapons: HudState["weapons"], now: number, was: number) {
    const ui = this.switcher;
    const n = weapons.length;
    if (!ui || n < 2) return;
    this.bindSwitch(weapons, now);
    const r = this.runner(ui);
    r.stop();
    // stepping back (the old weapon is the one below) scrolls down, forward scrolls up
    r.runScript(ref(((was % n) + n) % n === ((now + 1) % n) ? "Scroll Down" : "Scroll Up"));
    ui.visible = true;
    this.switcherTime = 0.9;
  }

  update(state: HudState, dt: number) {
    this.dungeon = state.dungeon;
    this.updateSlides(dt);
    this.updateAcquire(dt);
    this.bindSprite(state.sprite);
    if (this.built !== statusKey(state)) void this.rebuildStatus(state);
    if (this.status) this.bindStatus(this.status, state, dt);
    if (this.quickbar) this.bindQuickbar(this.quickbar, state);
    const label = this.minimapUi?.find("floorlabel");
    if (label) label.text = state.floor;
    // the activities panel opens in towns and folds in the Clockworks (hud/a.wasAdded: as the
    // player left it in the same kind of place, else open outside dungeons)
    if (this.activities && this.townBuilt !== state.town) {
      this.townBuilt = state.town;
      this.fold(this.activities, !state.town);
    }
    if (this.activities) this.bindActivities(this.activities, state);
    if (this.objective) this.bindObjectives(this.objective, state.objectives);
    this.bindMenus(state);
    this.bindMinimap(state);
    this.applyLock();
    if (this.cooldown) {
      // the client shows the dodge cooldown's seconds rounded, while any is left
      this.cooldown.visible = state.dungeon && state.dashCooldown > 0;
      const s = this.cooldown.find("secondsleft");
      if (s) s.text = String(Math.round(state.dashCooldown));
    }
    // the weapon switcher
    const sel = state.weapons.findIndex(w => w.selected);
    if (sel !== this.lastWeapon) {
      // the switcher's icons load ahead of the first switch
      for (const w of state.weapons) for (const size of [30, 40, 60]) if (w.icon) this.icon(w.icon, size);
      if (this.lastWeapon >= 0 && sel >= 0 && state.dungeon) this.showSwitch(state.weapons, sel, this.lastWeapon);
      this.lastWeapon = sel;
    }
    if (this.switcher?.visible) {
      // (icons load in the background: bound again while showing)
      this.bindSwitch(state.weapons, sel);
      if ((this.switcherTime -= dt) <= 0) this.switcher.visible = false;
    }
    // the help notice's text (helptips)
    const hint = state.action?.hint ?? null;
    this.hintText = hint ? message("helptips", hint) || null : null;
    // the target panel (dungeon/client/g): what the knight can act on (a townsperson, shop or
    // item's description) before the knight's target monster with its health
    const d = state.action?.desc ?? null;
    const t: HudTarget | null = d ? { key: "desc:" + d.key, name: d.name, health: 0, maxHealth: 0, family: "", model: null, idle: null,
      icon: d.icon, desc: { title: d.title, info: d.info } } : state.target;
    if (!t) {
      if (this.target && this.targetKey) { this.targetKey = ""; this.targetFade = 0.3; }
      if (this.target && this.targetFade > 0) {
        this.targetFade -= dt;
        this.target.setAlpha(Math.max(0, this.targetFade / 0.3));
        if (this.targetFade <= 0) this.target = null;
      }
    } else {
      if (t.key !== this.targetKey) { this.target = null; void this.rebuildTarget(t); }
      const frac = Math.max(0, t.health) / Math.max(1, t.maxHealth);
      const hb = t.desc ? null : this.target?.find("health_ui") ?? null;
      if (hb) {
        hb.visible = frac > 0;
        const fill = hb.find("health");
        if (fill && frac > 0) fill.preferredSize = { width: Math.trunc(frac * 200), height: 12 };
      }
    }
    // the low-health frame: its add action starts the pulse; "Fade Out" removes it over 0.75 s
    const lowNow = state.dungeon && this.options.screenFlash && this.hp.cur > 0 && this.hp.trail < state.maxHealth * LOW_HEALTH_FRACTION;
    if (this.lowHealth) {
      const r = this.runner(this.lowHealth);
      if (lowNow && this.low !== "on") {
        r.stop();
        this.lowHealth.setAlpha(1);
        if (this.lowHealth.addAction) r.execute(this.lowHealth.addAction);
        this.low = "on";
      } else if (!lowNow && this.low === "on") {
        r.stop();
        r.runScript(ref("Fade Out"));
        this.low = "fading";
        this.lowFade = 0.75;
      } else if (this.low === "fading" && (this.lowFade -= dt) <= 0) { r.stop(); this.low = "off"; }
    }
    for (const [ui, r] of this.runners) {
      r.tick(dt);
      if (!r.busy && ui !== this.hitFlash && ui !== this.lowHealth && ui !== this.switcher) this.runners.delete(ui);
    }
  }

  private lowFade = 0;

  /** The notice icon (ui/icon/notice.png) for folded handles with news. */
  private noticeIcon: Component["icon"] = null;
  private noticeLoading = false;
  private notice() {
    if (!this.noticeIcon && !this.noticeLoading) {
      this.noticeLoading = true;
      void this.ctx.image("ui/icon/notice.png").then(im => { this.noticeIcon = im; });
    }
    return this.noticeIcon;
  }

  /** A panel's handle (hud/M: the first handle whose parent shows). */
  private handle(ui: Component): Component | null {
    let found: Component | null = null;
    const walk = (c: Component, parentVisible: boolean) => {
      if (found) return;
      if (c.tag === "handle" && parentVisible) { found = c; return; }
      for (const k of c.children) walk(k, c.visible);
    };
    walk(ui, true);
    return found;
  }

  /**
   * hud/M.JR: a folded panel's handle carries the notice icon while there is news, and the
   * activities and objectives handles their tooltips (m.activities_tip, m.objectives_tip) while folded.
   */
  private bindHandle(ui: Component, news: boolean, tipKey: string | null) {
    const h = this.handle(ui);
    if (!h) return;
    const folded = !!this.folded.get(ui);
    h.selected = !folded;
    h.icon = news && folded ? this.notice() : null;
    h.tooltip = tipKey && folded ? text("projectx", tipKey, tipKey === "m.activities_tip" ? "Activities" : "Objectives") : "";
  }

  /** Corner menus (hud/L.b and hud/y, hud/P): bound keys on the badges, cut to 3 characters; the mail notice. */
  private bindMenus(s: HudState) {
    for (const ui of [this.menuLeft, this.menuRight]) {
      if (!ui) continue;
      for (const tag of MENU_BUTTONS) {
        const host = ui.find(tag);
        if (!host) continue;
        const hk = host.find("hotkey");
        const key = tag === "button_menu" ? "" : (s.menuKeys?.[tag] ?? "").slice(0, 3);
        if (hk) { hk.text = key; hk.visible = key !== ""; }
        const n = host.find("notice");
        if (n) n.visible = tag === "button_mail" && !!s.mailNews;
      }
    }
    if (this.menuLeft) this.bindHandle(this.menuLeft, !!s.mailNews, null);
    if (this.menuRight) this.bindHandle(this.menuRight, false, null);
  }

  /** The activities' visibility rules (hud/a.bv) for single play. */
  private bindActivities(a: Component, s: HudState) {
    const show = (tag: string, on: boolean) => { const c = a.find(tag); if (c) c.visible = on; return on; };
    const p = s.place ?? { guildHall: false, readyRoom: false, hall: false };
    const haven = a.find("button_haven");
    if (haven) haven.text = message("projectx", "b.to_town", "Haven");
    // "Go to Haven" outside the home town; the Ready Room outside it; the guild's hall outside it
    const go = [show("button_haven", !s.town), show("button_readyroom", !p.readyRoom), show("button_guildhall", p.hall && !p.guildHall)];
    show("go_div", go.some(Boolean));
    // furnishings only where the hall's design mode runs; missions always (MissionPanel.isEnabled)
    const furni = show("button_furni", p.guildHall);
    const missions = show("button_missions", true);
    show("panel_div", furni || missions);
    this.bindHandle(a, false, "m.activities_tip");
  }

  /** The objective panel (hud/E.by): a "- text" line per objective, hidden without any, unfolding when new ones arrive. */
  private lastObjectives: string | null = null;
  private bindObjectives(o: Component, lines: string[]) {
    const key = lines.join("\n");
    if (key !== this.lastObjectives) {
      const fresh = lines.some(l => !(this.lastObjectives ?? "").split("\n").includes(l));
      this.lastObjectives = key;
      const list = o.find("objectives");
      if (list) {
        lines.forEach((line, i) => { const row = list.children[i]; if (row) { row.text = "- " + line; row.visible = true; } });
        for (let i = lines.length; i < list.children.length; i++) list.children[i].visible = false;
      }
      o.visible = lines.length > 0;
      if (fresh && lines.length) {
        if (this.locked) this.objectiveNews = true;
        else if (this.folded.get(o)) this.fold(o, false);
      }
    }
    if (!this.folded.get(o)) this.objectiveNews = false;
    this.bindHandle(o, this.objectiveNews, "m.objectives_tip");
  }
  private objectiveNews = false;

  /** The minimap's buttons (hud/Minimap and the dungeon's W): zoom where the camera has one, the map overlay, the lock. */
  private bindMinimap(s: HudState) {
    const mm = this.minimapUi;
    if (!mm) return;
    const tip = (name: string, fallback: string, key?: string) => {
      const t = text("projectx", name, fallback);
      return key ? message("projectx", "i.hotkey", t, key) || `${t} (${key})` : t;
    };
    const zoomBox = mm.find("spacer_zoom");
    if (zoomBox) zoomBox.visible = !!s.zoomable;
    const zoom = mm.find("button_zoom");
    if (zoom) { zoom.selected = !!s.zoomed; zoom.tooltip = tip("m.toggle_zoom", "Toggle Zoom", s.commandKeys?.zoom); }
    const map = mm.find("button_map");
    if (map) { map.selected = this.mapOverlay; map.tooltip = tip("m.toggle_map", "Toggle Map", s.commandKeys?.map); }
    const lock = mm.find("button_lockhud");
    if (lock) lock.tooltip = this.dungeon ? tip("m.toggle_hud_lock", "Toggle Hud Lock", s.commandKeys?.hudLock) : "";
  }

  private bindStatus(ui: Component, s: HudState, dt: number) {
    // the bars trail their values: a hit leaves a damage segment, a heal a heal segment
    const reset = s.maxHealth !== this.maxSeen;
    this.maxSeen = s.maxHealth;
    const moved = this.hp.set(s.health, reset);
    this.hp.tick(dt);
    if (moved === "down") {
      if (this.hitFlash && this.options.screenFlash && s.dungeon) this.runner(this.hitFlash).runScript(ref("Red Pulse"));
      const bar = ui.find("health_ui");
      if (bar) this.runner(bar).runScript(ref("Shake"));
    }
    const shield = s.shieldBroken ? 0 : s.shield;
    const smoved = this.sh.set(shield, s.shieldRarity < 0);
    this.sh.tick(dt);
    if (smoved === "down") { const bar = ui.find("shield_ui"); if (bar) this.runner(bar).runScript(ref("Shake")); }
    // blocking swaps the bars' sizes (the client's shield switch)
    const blocking = s.shielding && shield > 0;
    if (blocking !== this.blocking && !this.building) { this.blocking = blocking; void this.applyBlocking(ui, blocking); }
    const variant = blocking ? "Pip Half" : "Pip";
    stackedBar(ui.find("health_ui"), pips(s.maxHealth), pips(this.hp.cur), pips(this.hp.trail));
    this.diff(ui.find("health_ui"), "health", this.hp.cur > this.hp.trail ? "Heal" : "Damage", variant);
    const heartTier = pips(s.maxHealth) > 2 * ROW ? "Gold" : pips(s.maxHealth) > ROW ? "Silver" : "Default";
    const heart = ui.find("vitapod");
    if (heart && heartTier !== this.heartVariant) {
      this.heartVariant = heartTier;
      void restyle(this.ctx, heart, "Hud/Status/Health/Heart/Heart", { Variant: heartTier });
    }
    if (heart) {
      heart.text = blocking ? "" : vitapodText(this.hp.cur, this.hp.trail, s.maxHealth);
      heart.enabled = this.hp.trail > 0;
    }
    // the shield bar: 60 pixels a star, the shield's health a fraction of it
    const row = ui.find("container_shield");
    if (row) row.visible = s.shieldRarity >= 0 && s.shieldMax > 0;
    if (s.shieldRarity >= 0 && s.shieldMax > 0) {
      const width = (s.shieldRarity + 1) * 360 / 6;
      const px = (v: number) => Math.trunc(v * width / s.shieldMax);
      stackedBar(ui.find("shield_ui"), width, px(this.sh.cur), px(this.sh.trail));
      this.diff(ui.find("shield_ui"), "shield", this.sh.cur > this.sh.trail ? "Heal" : "Damage", blocking ? "Bar" : "Bar Half");
      const icon = ui.find("shield");
      if (icon) icon.enabled = this.sh.trail > 0;
    }
    // the pet portrait shows the battle sprite while one is out (hud/F.Ko)
    const pet = ui.find("portrait_pet");
    if (pet) { pet.visible = !!s.pet; const v = pet.find("model"); if (v) v.viewOwner = "pet"; }
    const rank = s.rank ? ui.find("rank_label") : null;
    if (rank) rank.text = s.rank!;
    // the heat meter: the floor's heat, in the dungeon HUD; it pulses as heat comes in
    const heat = ui.find("heat");
    if (heat) {
      heat.visible = s.dungeon;
      if (s.heat > this.lastHeat && s.dungeon) this.runner(heat).runScript(ref("Get Heat, Pulse"));
    }
    this.lastHeat = s.heat;
    const debuffs = ui.find("container_debuffs");
    if (debuffs) {
      const kids: Component[] = [];
      for (const st of s.statuses) {
        const key = st.ui + "|" + st.icon + "|" + st.seconds;
        if (!this.debuffs.has(key)) {
          this.debuffs.set(key, null);
          void buildInterface(this.ctx, ref(st.ui, { Icon: st.icon, "Seconds Remaining": String(st.seconds), Size: "Default" }))
            .then(c => { if (c) { c.constraints = { fixed: true }; this.debuffs.set(key, c); } });
        }
        const c = this.debuffs.get(key);
        if (c) kids.push(c);
      }
      debuffs.children = kids;
      debuffs.visible = s.dungeon && kids.length > 0;
      if (this.debuffs.size > 200) this.debuffs.clear();
    }
  }

  /** Restyles a bar's difference segments when their colour (Damage or Heal) or variant changes. */
  private diff(part: Component | null, key: string, color: string, variant: string) {
    if (!part || this.diffStyle.get(key) === color + variant) return;
    this.diffStyle.set(key, color + variant);
    for (const tag of ["health_difference", "health_difference1", "health_difference2"]) {
      const c = part.find(tag);
      if (c) void restyle(this.ctx, c, "Health", { Color: color, Variant: variant });
    }
  }

  private bindQuickbar(ui: Component, s: HudState) {
    // the event slot (dungeon/client/t) shows only while the floor has an event item; there are none here
    const ev = ui.find("eventslot");
    if (ev) ev.visible = false;
    this.pocketTips = s.pocketTips ?? [];
    // pocket slots: the carried consumables, their counts and their keys
    for (const [i, tag] of ["slot0", "slot1", "slot2", "slot3", "vitaslot", "eventslot"].entries()) {
      const slot = ui.find(tag);
      if (!slot) continue;
      const it = i < 4 ? s.pocket[i] : tag === "vitaslot" ? s.vitapod ?? undefined : undefined;
      const inner = slot.find("slot");
      if (inner) inner.visible = !!it;
      const icon = slot.find("icon");
      if (icon) icon.icon = it?.icon ? this.icon(it.icon, 40) : null;
      const count = slot.find("itemcount");
      if (count) count.text = it && it.count > 1 ? String(it.count) : "";
      const key = i < 4 ? s.pocketKeys?.[i] : undefined;
      const hk = key !== undefined ? slot.find("slot_label") : null;
      if (hk) hk.text = key!.slice(0, 3);
    }
  }

  /** An icon config's image, scaled to fit `size` pixels. */
  private icon(cfg: any, size: number) {
    const key = size + JSON.stringify(cfg, (k, v) => (k === "$outer" ? undefined : v));
    if (!this.icons.has(key)) {
      this.icons.set(key, null);
      void this.ctx.icon(cfg).then(im => {
        if (!im) return;
        const scale = Math.min(1, size / Math.max(im.width, im.height));
        const w = Math.round(im.width * scale), h = Math.round(im.height * scale);
        const canvas = new OffscreenCanvas(w, h);
        const g = canvas.getContext("2d")!;
        g.imageSmoothingQuality = "high";
        g.drawImage(im.source, 0, 0, w, h);
        this.icons.set(key, { source: canvas, width: w, height: h });
      });
    }
    return this.icons.get(key) ?? null;
  }

  /** Draws the HUD into a canvas sized cw x ch CSS pixels. */
  draw(g: CanvasRenderingContext2D, cw: number, ch: number) {
    // full-screen frames sit under the panels
    const fullScreen = (ui: Component | null, tags: string[]) => {
      if (!ui) return;
      for (const tag of tags) { const c = ui.find(tag); if (c) c.preferredSize = { width: cw, height: ch }; }
      pack(ui);
      render(ui, g, 0, ch, this.hooks);
    };
    // the map overlay (ProjectXPrefs map_overlay) under the HUD
    if (this.mapOverlay) this.minimap.drawOverlay(g, cw, ch);
    if (this.low !== "off") fullScreen(this.lowHealth, ["frame_red", "frame_border"]);
    if (this.hitFlash && this.runners.get(this.hitFlash)?.busy) fullScreen(this.hitFlash, ["frame_red"]);
    if (this.status) {
      // the status panel's backing is anchored to the upper-left corner of the screen
      const size = pack(this.status);
      render(this.status, g, 0, size.height, this.hooks);
    }
    if (this.minimapUi && this.options.minimap) {
      // the minimap sits in the upper-right corner
      const size = pack(this.minimapUi);
      render(this.minimapUi, g, cw - size.width, size.height, this.hooks);
    }
    // the quickbar is the dungeon HUD's (towns have none), at the bottom centre
    const qb = this.dungeon ? this.quickbar : null;
    if (qb) {
      const size = pack(qb);
      render(qb, g, Math.round((cw - size.width) / 2), ch, this.hooks);
    }
    // the dash cooldown sits 60 pixels up from the bottom centre
    if (this.cooldown?.visible) {
      const cs = pack(this.cooldown);
      render(this.cooldown, g, Math.round((cw - cs.width) / 2), ch - 60, this.hooks);
    }
    // the weapon switcher at the screen's centre
    if (this.switcher?.visible) {
      const ss = pack(this.switcher);
      render(this.switcher, g, Math.round((cw - ss.width) / 2), Math.round((ch + ss.height) / 2), this.hooks);
    }
    // corner menus: the left one in the lower-left corner, the right one in the lower-right
    if (this.menuLeft) { pack(this.menuLeft); render(this.menuLeft, g, this.dx(this.menuLeft), ch, this.hooks); }
    if (this.menuRight) { const s = pack(this.menuRight); render(this.menuRight, g, cw - s.width + this.dx(this.menuRight), ch, this.hooks); }
    // the objective panel hangs 166 pixels down the right edge, the activities 6 pixels under it
    // (hud/E.Kk: under a folded objective panel the activities hang 6 pixels below its handle)
    let y = 166;
    for (const ui of [this.objective, this.activities]) {
      if (!ui?.visible) continue;
      const s = pack(ui);
      render(ui, g, cw - s.width + this.dx(ui), y + s.height, this.hooks);
      const h = this.folded.get(ui) ? this.handle(ui)?.height ?? s.height : s.height;
      y += h + 6;
    }
    // item-acquire icons: beside their quickbar slot, or in from the lower-right corner
    for (const a of this.acquireShown) {
      pack(a.ui);
      const slot = a.slot !== null && qb ? qb.find(a.slot < 4 ? "slot" + a.slot : "vitaslot")?.screen ?? null : null;
      if (slot) render(a.ui, g, Math.round(slot.x - 1.5 * slot.width), Math.round(slot.y + slot.height), this.hooks);
      else render(a.ui, g, cw - 125, ch - 15, this.hooks);
    }
    // the target panel hangs from the top, 200 pixels in from the right edge
    if (this.target) { const s = pack(this.target); render(this.target, g, cw - 200 - s.width, s.height, this.hooks); }
    this.drawHint(g, cw);
    this.drawPopup(g, cw, ch);
    if (!this.popup) this.drawTooltip(g, cw, ch);
  }

  // ------------------------------------------------------------------ personal menu

  /** The open popup menu (client cr, a PopupMenu at the mouse) and where it hangs. */
  private popup: { ui: Component; x: number; y: number; run: (action: string) => void } | null = null;

  /**
   * Opens a popup menu at (x, y) (client ui/E): a Menu/PlayerTitle title, Menu/SubTitle
   * section labels and Default/MenuItem items in a Default/PopupMenu.
   */
  async openMenu(x: number, y: number, title: string, entries: ({ label: string; action: string } | { header: string })[], run: (action: string) => void) {
    const style = (name: string) => ({ $class: CONFIG_REF, name });
    const kids = [{ component: { $class: COMPONENT + "Label", text: "~" + title, style: style("Menu/PlayerTitle") } },
      ...entries.map(e => "header" in e
        ? { component: { $class: COMPONENT + "Label", text: "~" + e.header, style: style("Menu/SubTitle") } }
        : { component: { $class: COMPONENT + "Button", text: "~" + e.label, action: e.action, style: style("Default/MenuItem") } })];
    const ui = await buildComponentConfig(this.ctx, { $class: COMPONENT + "Container", style: style("Default/PopupMenu"),
      layout: { $class: "LayoutConfig$VerticalGroup", policy: { name: "STRETCH" }, justification: { name: "TOP" }, offAxisPolicy: { name: "STRETCH" }, gap: 0, children: kids } });
    this.popup = { ui, x, y, run };
  }

  get menuOpen() { return !!this.popup; }

  /** A press while the menu is open: an item runs its action, anywhere else closes the menu. True when taken. */
  private popupPointer(x: number, y: number, click: boolean): boolean {
    const p = this.popup;
    if (!p) return false;
    const hit = hitTest(p.ui, x, y, c => c.kind === "button");
    if (this.hovered !== hit) { if (this.hovered) this.hovered.hover = false; if (hit) hit.hover = true; this.hovered = hit; }
    if (click) {
      this.popup = null;
      if (hit?.action) p.run(hit.action);
    }
    return true;
  }

  private drawPopup(g: CanvasRenderingContext2D, cw: number, ch: number) {
    const p = this.popup;
    if (!p) return;
    const s = pack(p.ui);
    // PopupMenu.popup: at the mouse, kept on the screen
    const x = Math.max(0, Math.min(cw - s.width, p.x)), top = Math.max(0, Math.min(ch - s.height, p.y));
    render(p.ui, g, Math.round(x), Math.round(top + s.height), this.hooks);
  }

  // ------------------------------------------------------------------ help notice

  /**
   * The help notice (client ar, dungeon/client/h): a 600 pixel Default/TooltipWindow label at
   * the top centre, 120 pixels down, with the knight's action hint from the helptips bundle
   * (m.talk, m.shop, m.interact...), and in dungeons m.elevator while the knight waits on the
   * elevator. Hidden while a window is open over the game.
   */
  private hintLabel: Component | null = null;
  private hintBuilding = false;
  hintText: string | null = null;

  private drawHint(g: CanvasRenderingContext2D, cw: number) {
    if (!this.hintText) return;
    if (!this.hintLabel) {
      if (!this.hintBuilding) {
        this.hintBuilding = true;
        void buildComponentConfig(this.ctx, { $class: COMPONENT + "Label", text: "", preferredWidth: 600, style: { $class: CONFIG_REF, name: "Default/TooltipWindow" } })
          .then(c => { this.hintLabel = c; });
      }
      return;
    }
    const l = this.hintLabel;
    l.text = this.hintText;
    l.preferredWidth = 600;
    const s = pack(l);
    render(l, g, Math.round((cw - s.width) / 2), 120 + s.height, this.hooks);
  }

  // ------------------------------------------------------------------ tooltips

  /** Built tooltip windows by text (Default/TooltipWindow around a label) or item tooltip spec. */
  private tips = new Map<string, Component | null>();
  private tipFor(key: string, build: () => Promise<Component | null>): Component | null {
    if (!this.tips.has(key)) {
      if (this.tips.size > 100) this.tips.clear();
      this.tips.set(key, null);
      void build().then(c => { this.tips.set(key, c); }).catch(() => undefined);
    }
    return this.tips.get(key) ?? null;
  }

  /** Clyde's Root tooltip: after the pointer rests 1 s (0.1 s on item slots), above the component or by the mouse. */
  private drawTooltip(g: CanvasRenderingContext2D, cw: number, ch: number) {
    const c = this.hovered, m = this.mouse;
    if (!c || !m || !c.screen) return;
    const slot = this.slotTip(c);
    if ((performance.now() - this.hoverStart) / 1000 < (slot !== undefined ? 0.1 : 1)) return;
    let tip: Component | null = null;
    if (slot) {
      // ItemConfig's tooltip in a Default/Window (item/client/M.a)
      const key = "item:" + JSON.stringify(slot, (k, v) => (k === "$outer" ? undefined : v));
      tip = this.tipFor(key, () => buildItemTip(this.ctx, slot));
    } else if (slot === undefined && c.tooltip) {
      const text = c.tooltip, style = c.tooltipStyle;
      tip = this.tipFor("text:" + text + "|" + (style?.name ?? ""), () => buildTextTip(this.ctx, text, style));
    }
    if (!tip) return;
    const s = pack(tip);
    let x: number, bottom: number;
    if (c.tooltipMouse) { x = m.x - s.width / 2; bottom = m.y - 10; }
    else { x = c.screen.x + (c.screen.width - s.width) / 2; bottom = c.screen.y - 10; }
    x = Math.max(5, Math.min(x, cw - s.width - 5));
    bottom = Math.max(s.height + 5, Math.min(bottom, ch));
    render(tip, g, Math.round(x), Math.round(bottom), this.hooks);
  }

  /** The item tooltip for a quickbar slot's button (null when the slot is empty), or undefined for other components. */
  private slotTip(c: Component): TipSpec | null | undefined {
    if (c.tag !== "slot_ring" || !this.quickbar) return undefined;
    for (let i = 0; i < 4; i++) if (this.quickbar.find("slot" + i)?.find("slot_ring") === c) return this.pocketTips[i] ?? null;
    return null;
  }
  private pocketTips: (TipSpec | null)[] = [];
}

const COMPONENT = "com.threerings.opengl.gui.config.ComponentConfig$";
const vgroupLayout = { $class: "LayoutConfig$Border", horizontalGap: 0, verticalGap: 0, children: [] as any[] };

/** Clyde's default tooltip: a label (with the component's tooltip style) in a Default/TooltipWindow window. */
async function buildTextTip(ctx: GuiContext, text: string, style: any): Promise<Component | null> {
  const label = { $class: COMPONENT + "Label", text: "~" + text, ...(style ? { style } : {}) };
  return buildComponentConfig(ctx, { $class: COMPONENT + "Container", style: { $class: CONFIG_REF, name: "Default/TooltipWindow" },
    layout: { ...vgroupLayout, children: [{ component: label }] } });
}

/** An item tooltip (the game's tooltip interface for the item) in a Default/Window, as the quickbar's slots show it. */
async function buildItemTip(ctx: GuiContext, spec: TipSpec): Promise<Component | null> {
  const ui = await buildUi(ctx, spec.ref);
  if (!ui) return null;
  const view = ui.find("renderview");
  if (view) view.visible = false;
  for (const [tag, t] of Object.entries(spec.texts ?? {})) { const c = ui.find(tag); if (c) c.text = t; }
  const pills = ui.find("tooltip_pills");
  if (pills) pills.visible = false;
  const win = await buildComponentConfig(ctx, { $class: COMPONENT + "Container", style: { $class: CONFIG_REF, name: "Default/Window" },
    layout: { ...vgroupLayout, children: [] } });
  ui.constraints = {};
  win.children = [ui];
  return win;
}

/** The vitapod's percentage (the client's): the lower of current and trailing health, at least 1% while alive. */
export function vitapodText(current: number, trail: number, max: number): string {
  if (max <= 0) return "0%";
  const v = Math.min(current, trail);
  const p = Math.floor(v * 100 / max);
  return p === 0 && v > 0 ? "1%" : p + "%";
}

/**
 * Sizes a bar's stacked rows (the client's status panel): the fill to the lower of current and
 * trailing values, the difference segment to the higher, each row holding at most ROW pixels.
 */
function stackedBar(part: Component | null, max: number, current: number, trail: number) {
  if (!part) return;
  const set = (tag: string, w: number) => {
    const c = part.find(tag);
    if (c?.preferredSize) c.preferredSize.width = Math.max(0, Math.min(ROW, w));
  };
  const lo = Math.min(current, trail), hi = Math.max(current, trail);
  ["", "1", "2"].forEach((n, i) => {
    set("health" + n, lo - i * ROW);
    set("health_difference" + n, hi - i * ROW);
  });
  set("health_backing", max);
}

/** Swaps a component for another under `root` (the client's Container.replace). */
function replaceChild(root: Component, old: Component, by: Component): boolean {
  const i = root.children.indexOf(old);
  if (i >= 0) { root.children[i] = by; return true; }
  return root.children.some(c => replaceChild(c, old, by));
}

/** The first descendant of a kind (e.g. a panel's RenderableView). */
function findKind(c: Component, kind: string): Component | null {
  if (c.kind === kind) return c;
  for (const k of c.children) { const r = findKind(k, kind); if (r) return r; }
  return null;
}

/** The nearest tagged ancestor of `target` under `root` (a menu item's interface host). */
function findHost(root: Component, target: Component): Component | null {
  const path: Component[] = [];
  const walk = (c: Component): boolean => {
    path.push(c);
    if (c === target) return true;
    for (const k of c.children) if (walk(k)) return true;
    path.pop();
    return false;
  };
  if (!walk(root)) return null;
  for (let i = path.length - 2; i >= 0; i--) if (path[i].tag && path[i].tag !== "button" && path[i].tag !== "menuitem") return path[i];
  return null;
}
