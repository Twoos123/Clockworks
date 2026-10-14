// The in-dungeon HUD, built from the game's own interface files in rsrc/ui/hud_v2: the
// status panel (portrait, name plate, health and shield bars) and the quickbar (weapon and
// item slots). The game client fills these in from code that is not open source, so the
// bindings here (which tag shows what, and how health maps to pixels) are our own.

import { CONFIG_REF } from "../config/params";
import type { World } from "../game/world";
import { restyle, buildInterface, hitTest, loadPseudo, pack, render, type Component, type GuiContext, type RenderHooks } from "./gui";
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

/**
 * Text for the HUD's message keys. The game's message bundles are in its code jars, which
 * this project does not read, so the labels are written here.
 */
const LABELS: Record<string, string> = {
  button_haven: "Return to Haven", button_readyroom: "Ready Room", button_guildhall: "Guild Hall",
  button_furni: "Furniture", button_missions: "Missions", button_supplydepot: "Supply Depot",
};
/** Menu buttons and the keys shown on their badges. */
const MENU_KEYS: Record<string, string> = {
  button_menu: "esc", button_help: "H", button_social: "G", button_feed: "N", button_mail: "M", button_gear: "C", button_loadout: "I", button_forge: "K", button_arsenal: "B",
};
/** Parts with nothing behind them in single player (PvP, parties, trades, mail, news). */
const HIDDEN = ["button_spare", "button_visithalls", "container_pvp", "button_pvp_spectate", "container_partyfinder",
  "button_traderequest", "button_partyinvite", "button_partyfound", "panel_div", "notes_div"];

/** The monster the knight is fighting, for the target panel. */
export interface HudTarget { key: string; name: string; health: number; maxHealth: number; family: string; model: any; idle: any }
/** The low-health frame shows below this fraction of maximum health (our choice). */
const LOW_HEALTH_FRACTION = 0.25;
/** One health pip (12 px wide in the images) stands for this much health. */
/** A heart pip is 40 health (ItemValueKey HEALTH). */
const HEALTH_PER_PIP = 40;
const PIP_WIDTH = 12;

const ref = (name: string, args: Record<string, unknown> = {}) =>
  ({ $class: CONFIG_REF, name, arguments: { $map: "com.threerings.config.ArgumentMap", entries: Object.entries(args) } });

export interface HudState {
  name: string;
  /** The minimap's floor label. */
  floor: string;
  health: number;
  maxHealth: number;
  recentDamage: number;
  shield: number;
  shieldMax: number;
  shieldBroken: boolean;
  shielding: boolean;
  weapons: { icon: any; selected: boolean }[];
  /** Active conditions: HUD icon name and whole seconds left. */
  statuses: { icon: string; ui: string; seconds: number }[];
  pocket: { icon: any; count: number }[];
  /** The equipped vitapod's icon and capsule count. */
  vitapod: { icon: any; count: number } | null;
  /** The equipped weapon's level (the heat meter), or 0 outside the Clockworks. */
  heatLevel: number;
  /** Seconds until the knight can dash again. */
  dashCooldown: number;
  target: HudTarget | null;
  /** Lines for the objective panel. */
  objectives: string[];
  /** In a town (the activities panel opens; in dungeons it starts folded). */
  town: boolean;
  /** The battle sprite's skills (the sprite slots beside the quickbar), or absent. */
  sprite?: { icon: any; seconds: number; ready: boolean; locked: boolean; hotkey: string }[];
  /** The portrait's rank label ("RANK 1-1"). */
  rank?: string;
}

export function hudState(world: World, name: string, floor = ""): HudState {
  const k = world.knight;
  return {
    name, floor, health: k.health, maxHealth: k.maxHealth, recentDamage: k.recentDamage,
    shield: k.shieldHealth, shieldMax: k.shieldMax, shieldBroken: k.shieldBroken > 0, shielding: k.shielding,
    weapons: k.weapons.map((w, i) => ({ icon: w.def.icon, selected: i === k.slot })),
    statuses: k.statuses.map(s => ({ icon: s.def.icon, ui: s.def.iconUi, seconds: Math.ceil(s.remaining) })),
    pocket: world.pocket.map(([n, c]) => ({ icon: world.pocketItem(n)?.icon ?? null, count: c })),
    vitapod: world.vitapod,
    heatLevel: world.depth > 0 ? world.weaponLevels.get(k.weapon?.name ?? "") ?? 1 : 0,
    dashCooldown: Math.max(0, k.dashCooldown),
    target: world.hudTarget(),
    objectives: [], town: false,
    sprite: world.companion?.hud(),
  };
}

export class GameHud {
  private status: Component | null = null;
  private quickbar: Component | null = null;
  /** The shield choice ("Idle" or "Blocking") the status panel was built with. */
  private built: string | null = null;
  private building = false;
  private icons = new Map<string, Component["icon"]>();
  private hitFlash: Component | null = null;
  private lowHealth: Component | null = null;
  /** Whether the low-health frame is up, or fading out. */
  private low: "off" | "on" | "fading" = "off";
  private runners = new Map<Component, ScriptRunner>();
  private lastHealth = -1;
  private minimapUi: Component | null = null;
  readonly minimap: Minimap;
  /** Built debuff icons (ui/health/debuff.dat) by icon and seconds left. */
  private debuffs = new Map<string, Component | null>();

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
      buildInterface(this.ctx, ref(MINIMAP)).then(ui => { this.minimapUi = ui; })]);
  }

  private async rebuildStatus(state: HudState) {
    const choice = state.shielding ? "Blocking" : "Idle";
    const built = choice + "|" + state.heatLevel;
    if (this.building || this.built === built) return;
    this.building = true;
    try {
      // the interface's Variant choices are named after its health part's options
      const big = { Variant: "Pip" }, small = { Variant: "Pip Half" };
      const overrides = new Map<string, Record<string, unknown>>([
        ["health_ui", choice === "Idle" ? big : small],
        ["shield_ui", choice === "Idle" ? small : big],
      ]);
      const ui = await buildInterface(this.ctx, ref(STATUS, { Name: state.name, "Dungeon UI": true, Shield: choice,
        HeatPower: `Level ${Math.max(1, state.heatLevel)}` }), { overrides });
      if (ui) {
        await this.stackRows(ui, choice === "Idle" ? "Pip" : "Pip Half");
        this.status = ui; this.built = built; this.heartVariant = "";
      }
    } finally { this.building = false; }
  }

  /**
   * The health part's three stacked rows (the client's status panel): red pips to 30, then
   * silver pips drawn over them, then gold, each row's style recoloured for its tier.
   */
  private async stackRows(ui: Component, variant: string) {
    const part = ui.find("health_ui");
    if (!part) return;
    await Promise.all(["health", "health1", "health2", "health_difference", "health_difference1", "health_difference2"].map(tag => {
      const c = part.find(tag);
      const tier = tag.endsWith("1") ? " Silver" : tag.endsWith("2") ? " Gold" : "";
      return c ? restyle(this.ctx, c, "Health-Recolor", { Variant: variant + tier, Colorization: 261 }) : undefined;
    }));
    const back = part.find("health_backing");
    if (back) await restyle(this.ctx, back, "Backing", { Variant: variant });
    await Promise.all(["health_difference", "health_difference1", "health_difference2"].map(tag => {
      const c = part.find(tag);
      return c ? restyle(this.ctx, c, "Health", { Color: "Damage", Variant: variant }) : undefined;
    }));
  }

  /** The vitapod heart's tier: silver past 30 pips of maximum health, gold past 60. */
  private heartVariant = "";

  private async buildQuickbar() {
    const ui = await buildInterface(this.ctx, ref(QUICKBAR));
    if (!ui) return;
    for (const tag of ["bs0", "bs1", "bs2"]) {
      const ring = ui.find(tag)?.find("slot_ring");
      if (ring) await loadPseudo(this.ctx, ring, "Selected");
    }
    this.quickbar = ui;
  }

  private menuLeft: Component | null = null;
  private menuRight: Component | null = null;
  private activities: Component | null = null;
  private objective: Component | null = null;
  private cooldown: Component | null = null;
  private target: Component | null = null;
  private targetKey = "";
  private folded = new Map<Component, boolean>();
  /** Panels the player folded or unfolded by hand (left alone by the automatic folding). */
  private manual = new Set<Component>();
  private townBuilt: boolean | null = null;
  private hovered: Component | null = null;
  /** Display options: the minimap and the red flash when hit. */
  options = { minimap: true, screenFlash: true };

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
      for (const [tag, text] of Object.entries(LABELS)) { const b = a.find(tag); if (b) b.text = text; }
      const t = a.find("label_title"); if (t) t.text = "Activities";
    }
    if (o) { const t = o.find("label_title"); if (t) t.text = "Current Objective"; }
    if (c) { const v = findKind(c, "view"); if (v) v.viewOwner = "cooldown"; }
    this.menuLeft = l; this.menuRight = r; this.activities = a; this.objective = o; this.cooldown = c;
    // load the target panel's images and fonts now, so the first monster struck shows at once
    void buildInterface(this.ctx, ref(TARGET, { Name: "", "Dungeon UI": true, Background: "Half" }));
  }

  private async rebuildTarget(t: HudTarget) {
    this.targetKey = t.key;
    const ui = await buildInterface(this.ctx, ref(TARGET, { Name: t.name, "Dungeon UI": true,
      "Family Icon": t.family ? `ui/icon/theme/${t.family}.png` : null, "Health Max": 100, "Health Current": 100,
      Background: "Half", Model: t.model }));
    if (ui && this.targetKey === t.key) {
      const p = ui.find("portrait");
      const v = p ? findKind(p, "view") : null;
      if (v) v.viewOwner = "target";
      this.target = ui;
    }
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

  /** The sprite slots (ui/hud_v2/parts/interface_spriteslot.dat), one per skill. */
  private spriteSlots: Component[] = [];
  private spriteBuilding = false;

  private bindSprite(skills: NonNullable<HudState["sprite"]>) {
    if (this.spriteSlots.length !== skills.length && !this.spriteBuilding) {
      this.spriteBuilding = true;
      void Promise.all(skills.map(s => buildInterface(this.ctx, ref(SPRITE_SLOT, { Cooldown: "", Hotkey: s.hotkey }))))
        .then(uis => { this.spriteSlots = uis.filter((u): u is Component => !!u); }).finally(() => { this.spriteBuilding = false; });
    }
    skills.forEach((s, i) => {
      const ui = this.spriteSlots[i];
      if (!ui) return;
      // the slot's root is dimmed (alpha 1/3) in the file: lit when the skill is ready
      ui.setAlpha(s.locked ? 0.25 : s.ready ? 1 : 0.6);
      const icon = ui.find("icon");
      if (icon) icon.icon = s.icon && !s.locked ? this.icon(s.icon, 40) : null;
      const cd = ui.find("cooldown");
      if (cd) cd.text = !s.locked && s.seconds > 0 ? String(s.seconds) : "";
      const hk = ui.find("slot_label");
      if (hk) hk.text = s.hotkey;
    });
  }

  update(state: HudState, dt: number) {
    if (state.sprite) this.bindSprite(state.sprite); else this.spriteSlots = [];
    if (this.built !== (state.shielding ? "Blocking" : "Idle") + "|" + state.heatLevel) void this.rebuildStatus(state);
    if (this.status) this.bindStatus(this.status, state);
    if (this.quickbar) this.bindQuickbar(this.quickbar, state);
    const label = this.minimapUi?.find("floorlabel");
    if (label) label.text = state.floor;
    // the activities panel is open in towns and folded in the Clockworks
    if (this.activities && this.townBuilt !== state.town) {
      this.townBuilt = state.town;
      this.fold(this.activities, !state.town);
      const b = this.activities.find("button_haven");
      if (b) b.text = state.town ? "The Arcade" : "Return to Haven";
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
      this.cooldown.visible = state.dashCooldown > 0.05;
      const s = this.cooldown.find("secondsleft");
      if (s) s.text = String(Math.ceil(state.dashCooldown));
    }
    // the target panel: the monster most recently struck, with its health
    const t = state.target;
    if (!t) { this.target = null; this.targetKey = ""; }
    else {
      if (t.key !== this.targetKey) { this.target = null; void this.rebuildTarget(t); }
      const hb = this.target?.find("health_ui") ?? null;
      bar(hb, 180, 180 * Math.max(0, t.health) / Math.max(1, t.maxHealth), 0);
    }
    // damage: the red screen flash and the health bar's shake, both scripted in the interfaces
    if (this.lastHealth >= 0 && state.health < this.lastHealth) {
      if (this.hitFlash && this.options.screenFlash) this.runner(this.hitFlash).runScript(ref("Red Pulse"));
      const bar = this.status?.find("health_ui");
      if (bar) this.runner(bar).runScript(ref("Shake"));
    }
    this.lastHealth = state.health;
    // the low-health frame: its add action starts the pulse; "Fade Out" removes it
    const lowNow = state.health > 0 && state.health < state.maxHealth * LOW_HEALTH_FRACTION;
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
      } else if (this.low === "fading" && !r.busy) this.low = "off";
    }
    for (const [ui, r] of this.runners) {
      r.tick(dt);
      if (!r.busy && ui !== this.hitFlash && ui !== this.lowHealth) this.runners.delete(ui);
    }
  }

  private bindStatus(ui: Component, s: HudState) {
    const px = (v: number) => Math.round(Math.max(0, v) / HEALTH_PER_PIP * PIP_WIDTH);
    stackedBar(ui.find("health_ui"), px(s.maxHealth), px(s.health), px(s.health + s.recentDamage));
    const heartTier = px(s.maxHealth) > 2 * ROW ? "Gold" : px(s.maxHealth) > ROW ? "Silver" : "Default";
    const heartC = ui.find("vitapod");
    if (heartC && heartTier !== this.heartVariant) {
      this.heartVariant = heartTier;
      void restyle(this.ctx, heartC, "Hud/Status/Health/Heart/Heart", { Variant: heartTier });
    }
    bar(ui.find("shield_ui"), px(s.shieldMax), s.shieldBroken ? 0 : px(s.shield), 0);
    const rank = s.rank ? ui.find("rank_label") : null;
    if (rank) rank.text = s.rank!;
    // the heat meter shows the equipped weapon's level in the Clockworks
    const heat = ui.find("heat");
    if (heat) heat.visible = s.heatLevel > 0;
    const row = ui.find("container_debuffs");
    if (row) {
      const kids: Component[] = [];
      for (const st of s.statuses) {
        const key = st.ui + "|" + st.icon + "|" + st.seconds;
        if (!this.debuffs.has(key)) {
          this.debuffs.set(key, null);
          void buildInterface(this.ctx, ref(st.ui, { Icon: st.icon, "Seconds Remaining": String(st.seconds).padStart(2, "0"), Size: "Default" }))
            .then(c => { if (c) { c.constraints = { fixed: true }; this.debuffs.set(key, c); } });
        }
        const c = this.debuffs.get(key);
        if (c) kids.push(c);
      }
      row.children = kids;
      row.visible = kids.length > 0;
      if (this.debuffs.size > 200) this.debuffs.clear();
    }
    const heart = ui.find("vitapod");
    if (heart) heart.text = `${Math.ceil(100 * s.health / Math.max(1, s.maxHealth))}%`;
    const shield = ui.find("shield");
    if (shield) shield.enabled = !s.shieldBroken;
  }

  private bindQuickbar(ui: Component, s: HudState) {
    ["bs0", "bs1", "bs2"].forEach((tag, i) => {
      const slot = ui.find(tag);
      if (!slot) return;
      const w = s.weapons[i];
      const inner = slot.find("slot");
      if (inner) inner.visible = !!w;
      const ring = slot.find("slot_ring");
      if (ring) ring.pseudoClass = w?.selected ? "Selected" : null;
      const icon = slot.find("icon");
      // inventory icons are larger than the slot; the label is 40 px square
      if (icon && w?.icon) icon.icon = this.icon(w.icon, 40);
    });
    // pocket slots: the carried consumables and their counts (keys 4 to 7 use them)
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
    const mapHeight = this.minimapUi?.height ?? 0;
    if (this.quickbar) {
      const size = pack(this.quickbar);
      render(this.quickbar, g, Math.round((cw - size.width) / 2), ch - 8, this.hooks);
      // the sprite slots sit above the quickbar's right end (the corner menu takes its sides)
      const sizes = this.spriteSlots.map(slot => pack(slot));
      let sx = Math.round((cw + size.width) / 2) - sizes.reduce((t, ss) => t + ss.width + 2, 0);
      this.spriteSlots.forEach((slot, i) => { render(slot, g, sx, ch - 8 - size.height - 2, this.hooks); sx += sizes[i].width + 2; });
      // the dash cooldown sits 60 pixels above the quickbar (the HUD mockup's anchor)
      if (this.cooldown?.visible) {
        const cs = pack(this.cooldown);
        render(this.cooldown, g, Math.round((cw - cs.width) / 2), ch - 8 - size.height - 60 + cs.height, this.hooks);
      }
    }
    // corner menus fold to their handles when the window is too narrow for them beside the
    // quickbar (unless the player has opened or folded them by hand)
    if (this.quickbar && this.menuLeft && this.menuRight) {
      const qb = this.quickbar.width, wide = (m: Component) => { const was = this.folded.get(m); this.fold(m, false); const w = pack(m).width; this.fold(m, !!was); return w; };
      const needed = qb + 2 * Math.max(wide(this.menuLeft), wide(this.menuRight)) + 16;
      const auto = cw < needed;
      for (const m of [this.menuLeft, this.menuRight]) if (!this.manual.has(m) && !!this.folded.get(m) !== auto) this.fold(m, auto);
    }
    // corner menus: the left one in the lower-left corner, the right one in the lower-right
    if (this.menuLeft) { pack(this.menuLeft); render(this.menuLeft, g, 0, ch, this.hooks); }
    if (this.menuRight) { const s = pack(this.menuRight); render(this.menuRight, g, cw - s.width, ch, this.hooks); }
    // the objective and activities panels hang down the right side under the minimap
    let y = mapHeight + 8;
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

/** One health row's width in pixels: 30 pips; more health stacks silver, then gold, rows over it. */
const ROW = 360;

/** Sizes the knight's stacked health rows (client status panel): each row holds at most ROW pixels. */
function stackedBar(part: Component | null, max: number, current: number, withDamage: number) {
  if (!part) return;
  const set = (tag: string, w: number) => {
    const c = part.find(tag);
    if (c?.preferredSize) c.preferredSize.width = Math.max(0, Math.min(ROW, w));
  };
  const lo = Math.min(current, withDamage), hi = Math.max(current, withDamage);
  ["", "1", "2"].forEach((n, i) => {
    set("health" + n, lo - i * ROW);
    set("health_difference" + n, hi - i * ROW);
  });
  set("health_backing", max);
}

/** Sizes a health part (ui/hud_v2/parts/interface_health.dat): its backing, fill and damage segment. */
function bar(part: Component | null, max: number, current: number, damage: number) {
  if (!part) return;
  const set = (tag: string, w: number) => {
    const c = part.find(tag);
    if (c?.preferredSize) c.preferredSize.width = w;
  };
  set("health_backing", max);
  set("health", Math.min(max, current));
  set("health_difference", Math.min(max, current + damage));
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
