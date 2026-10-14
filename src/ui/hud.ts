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
import { restyle, buildInterface, hitTest, pack, render, type Component, type GuiContext, type RenderHooks } from "./gui";
import { ScriptRunner } from "./script";
import { Minimap } from "./minimap";

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
/** Menu buttons and the keys shown on their badges. */
const MENU_KEYS: Record<string, string> = {
  button_menu: "esc", button_help: "H", button_social: "G", button_feed: "N", button_mail: "M", button_gear: "C", button_loadout: "I", button_forge: "K", button_arsenal: "B",
};
/** Parts with nothing behind them in single player (PvP, parties, trades, mail, news). */
const HIDDEN = ["button_spare", "button_visithalls", "container_pvp", "button_pvp_spectate", "container_partyfinder",
  "button_traderequest", "button_partyinvite", "button_partyfound", "panel_div", "notes_div"];

/** The monster the knight is fighting, for the target panel. */
export interface HudTarget {
  key: string; name: string; health: number; maxHealth: number; family: string; model: any; idle: any;
  /** The description's family icon, and the damage types it is weak to and deals (DescriptionConfig.Monster). */
  icon?: string | null; weakness?: string; attack?: string;
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
}

/** What the status panel is built for: its heat meter's level and the portrait's colour. */
const statusKey = (s: HudState) => `${heatLevel(s.heat)}|${s.color ?? ""}`;

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
    // the map draws over the map background, under the hash marks and gloss (the map layer
    // spacer has no size of its own)
    hooks.tagged = { ...(hooks.tagged ?? {}), mapbackground: (_c, g, x, y, w, h) => this.minimap.draw(g, x, y, w, h) };
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
    this.quickbar = ui;
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
  /** Panels the player folded or unfolded by hand (left alone by the automatic folding). */
  private manual = new Set<Component>();
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
      for (const [tag, key] of Object.entries(MENU_KEYS)) {
        const hk = ui.find(tag)?.find("hotkey");
        if (hk) { hk.text = key; hk.visible = key !== "esc"; }
      }
      for (const tag of HIDDEN) { const b = ui.find(tag); if (b) b.visible = false; }
    }
    if (a) {
      for (const [tag, [key, fallback]] of Object.entries(LABELS)) { const b = a.find(tag); if (b) b.text = text("projectx", key, fallback); }
      const t = a.find("label_title"); if (t) t.text = text("projectx", "t.activities", "Activities");
    }
    if (o) { const t = o.find("label_title"); if (t) t.text = text("projectx", "m.current_objective", "Current Objective"); }
    if (c) { const v = findKind(c, "view"); if (v) v.viewOwner = "cooldown"; }
    this.menuLeft = l; this.menuRight = r; this.activities = a; this.objective = o; this.cooldown = c;
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
    if (wbox) wbox.visible = weak !== "NORMAL" && weak !== "UNBLOCKABLE";
    if (wlabel && wbox?.visible) {
      wlabel.text = text("item", "m." + weak.toLowerCase(), weak.charAt(0) + weak.slice(1).toLowerCase());
      jobs.push(restyle(this.ctx, wlabel, "Hud/Status/Mini/Weakness Label", { Color: weak.toLowerCase() }));
    }
    const atk = ui.find("icon_attack");
    if (atk) {
      atk.visible = true;
      jobs.push(restyle(this.ctx, atk, "Hud/Status/Mini/Debuff_Icon", { File: `ui/icon/stats/attack_${(t.attack ?? "NORMAL").toLowerCase()}.png` }));
    }
    await Promise.all(jobs);
    if (this.targetKey === t.key) { this.target = ui; this.target.setAlpha(1); this.targetFade = 0; }
  }

  /** Folds or unfolds a panel (its handle was clicked): the middle hides, the handle stays. */
  private fold(ui: Component, folded: boolean) {
    this.folded.set(ui, folded);
    for (const tag of ["middle", "left"]) { const m = ui.find(tag); if (m) m.visible = !folded; }
  }

  private panels() { return [this.menuLeft, this.menuRight, this.activities, this.objective].filter((x): x is Component => !!x); }

  /**
   * The mouse at canvas point (x, y): lights the button under it, and on `click` returns that
   * button's tag ("button_loadout", "button_missions"...). Panel handles fold their panel.
   */
  pointer(x: number, y: number, click: boolean): string | null {
    const isButton = (c: Component) => c.kind === "button";
    let hit: Component | null = null, owner: Component | null = null;
    for (const ui of this.panels()) {
      const h = hitTest(ui, x, y, isButton);
      if (h) { hit = h; owner = ui; break; }
    }
    if (this.hovered !== hit) {
      if (this.hovered) this.hovered.hover = false;
      if (hit) hit.hover = true;
      this.hovered = hit;
    }
    if (!click || !hit || !owner) return null;
    if (hit.tag === "handle") { this.manual.add(owner); this.fold(owner, !this.folded.get(owner)); return "handle"; }
    // a menu item's tag sits on its interface host; the clickable part is the inner button
    if (hit.tag === "button") return findHost(owner, hit)?.tag ?? null;
    return hit.tag || null;
  }

  /** True when (x, y) is over a HUD button (clicks there do not attack). */
  covers(x: number, y: number): boolean {
    return this.panels().some(ui => !!hitTest(ui, x, y, c => c.kind === "button"));
  }

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
    this.bindSprite(state.sprite);
    if (this.built !== statusKey(state)) void this.rebuildStatus(state);
    if (this.status) this.bindStatus(this.status, state, dt);
    if (this.quickbar) this.bindQuickbar(this.quickbar, state);
    const label = this.minimapUi?.find("floorlabel");
    if (label) label.text = state.floor;
    // the activities panel is open in towns and folded in the Clockworks
    if (this.activities && this.townBuilt !== state.town) {
      this.townBuilt = state.town;
      this.fold(this.activities, !state.town);
      const b = this.activities.find("button_haven");
      if (b) b.text = state.town ? "The Arcade" : message("projectx", "b.to_town", "Haven");
    }
    if (this.objective) {
      const list = this.objective.find("objectives");
      if (list) {
        state.objectives.forEach((line, i) => { const row = list.children[i]; if (row) { row.text = "- " + line; row.visible = true; } });
        for (let i = state.objectives.length; i < list.children.length; i++) list.children[i].visible = false;
      }
      this.objective.visible = state.objectives.length > 0;
    }
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
    // the target panel: the monster most recently struck, with its health
    const t = state.target;
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
      const hb = this.target?.find("health_ui") ?? null;
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
    // corner menus fold to their handles when the window is too narrow for them beside the
    // quickbar (unless the player has opened or folded them by hand)
    if (this.menuLeft && this.menuRight) {
      const qw = qb?.width ?? 0, wide = (m: Component) => { const was = this.folded.get(m); this.fold(m, false); const w = pack(m).width; this.fold(m, !!was); return w; };
      const needed = qw + 2 * Math.max(wide(this.menuLeft), wide(this.menuRight)) + 16;
      const auto = cw < needed;
      for (const m of [this.menuLeft, this.menuRight]) if (!this.manual.has(m) && !!this.folded.get(m) !== auto) this.fold(m, auto);
    }
    // corner menus: the left one in the lower-left corner, the right one in the lower-right
    if (this.menuLeft) { pack(this.menuLeft); render(this.menuLeft, g, 0, ch, this.hooks); }
    if (this.menuRight) { const s = pack(this.menuRight); render(this.menuRight, g, cw - s.width, ch, this.hooks); }
    // the objective panel hangs 166 pixels down the right edge, the activities 6 pixels under it
    let y = 166;
    for (const ui of [this.objective, this.activities]) {
      if (!ui?.visible) continue;
      const s = pack(ui);
      y += s.height;
      render(ui, g, cw - s.width, y, this.hooks);
      y += 6;
    }
    // the target panel hangs from the top, 200 pixels in from the right edge
    if (this.target) { const s = pack(this.target); render(this.target, g, cw - 200 - s.width, s.height, this.hooks); }
  }
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
