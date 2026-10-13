// The in-dungeon HUD, built from the game's own interface files in rsrc/ui/hud_v2: the
// status panel (portrait, name plate, health and shield bars) and the quickbar (weapon and
// item slots). The game client fills these in from code that is not open source, so the
// bindings here (which tag shows what, and how health maps to pixels) are our own.

import { CONFIG_REF } from "../config/params";
import type { World } from "../game/world";
import { buildInterface, loadPseudo, pack, render, type Component, type GuiContext, type RenderHooks } from "./gui";
import { ScriptRunner } from "./script";

const STATUS = "ui/hud_v2/interface_status.dat";
const QUICKBAR = "ui/hud_v2/interface_quickbar.dat";
const HIT_FLASH = "ui/hud_v2/interface_hitflash.dat";
const LOW_HEALTH = "ui/hud_v2/interface_lowhealth.dat";
/** The low-health frame shows below this fraction of maximum health (our choice). */
const LOW_HEALTH_FRACTION = 0.25;
/** One health pip (12 px wide in the images) stands for this much health. */
const HEALTH_PER_PIP = 10;
const PIP_WIDTH = 12;

const ref = (name: string, args: Record<string, unknown> = {}) =>
  ({ $class: CONFIG_REF, name, arguments: { $map: "com.threerings.config.ArgumentMap", entries: Object.entries(args) } });

export interface HudState {
  name: string;
  health: number;
  maxHealth: number;
  recentDamage: number;
  shield: number;
  shieldMax: number;
  shieldBroken: boolean;
  shielding: boolean;
  weapons: { icon: any; selected: boolean }[];
}

export function hudState(world: World, name: string): HudState {
  const k = world.knight;
  return {
    name, health: k.health, maxHealth: k.maxHealth, recentDamage: k.recentDamage,
    shield: k.shieldHealth, shieldMax: k.shieldMax, shieldBroken: k.shieldBroken > 0, shielding: k.shielding,
    weapons: k.weapon ? [{ icon: k.weapon.icon, selected: true }] : [],
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

  constructor(private readonly ctx: GuiContext, readonly hooks: RenderHooks = {}) {}

  /** Starts loading the interfaces; draw() shows them once ready. */
  async init(state: HudState) {
    await Promise.all([this.rebuildStatus(state), this.buildQuickbar(),
      buildInterface(this.ctx, ref(HIT_FLASH)).then(ui => { this.hitFlash = ui; }),
      buildInterface(this.ctx, ref(LOW_HEALTH)).then(ui => { this.lowHealth = ui; })]);
  }

  private async rebuildStatus(state: HudState) {
    const choice = state.shielding ? "Blocking" : "Idle";
    if (this.building || this.built === choice) return;
    this.building = true;
    try {
      // the interface's Variant choices are named after its health part's options
      const big = { Variant: "Pip" }, small = { Variant: "Pip Half" };
      const overrides = new Map<string, Record<string, unknown>>([
        ["health_ui", choice === "Idle" ? big : small],
        ["shield_ui", choice === "Idle" ? small : big],
      ]);
      const ui = await buildInterface(this.ctx, ref(STATUS, { Name: state.name, "Dungeon UI": true, Shield: choice }), { overrides });
      if (ui) { this.status = ui; this.built = choice; }
    } finally { this.building = false; }
  }

  private async buildQuickbar() {
    const ui = await buildInterface(this.ctx, ref(QUICKBAR));
    if (!ui) return;
    for (const tag of ["bs0", "bs1", "bs2"]) {
      const ring = ui.find(tag)?.find("slot_ring");
      if (ring) await loadPseudo(this.ctx, ring, "Selected");
    }
    this.quickbar = ui;
  }

  private runner(ui: Component) {
    let r = this.runners.get(ui);
    if (!r) this.runners.set(ui, r = new ScriptRunner(ui));
    return r;
  }

  update(state: HudState, dt: number) {
    if (this.built !== (state.shielding ? "Blocking" : "Idle")) void this.rebuildStatus(state);
    if (this.status) this.bindStatus(this.status, state);
    if (this.quickbar) this.bindQuickbar(this.quickbar, state);
    // damage: the red screen flash and the health bar's shake, both scripted in the interfaces
    if (this.lastHealth >= 0 && state.health < this.lastHealth) {
      if (this.hitFlash) this.runner(this.hitFlash).runScript(ref("Red Pulse"));
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
    bar(ui.find("health_ui"), px(s.maxHealth), px(s.health), px(s.recentDamage));
    bar(ui.find("shield_ui"), px(s.shieldMax), s.shieldBroken ? 0 : px(s.shield), 0);
    // no status effects or heat yet: hide the panel's placeholder debuffs and heat meter
    for (const tag of ["container_debuffs", "heat"]) { const c = ui.find(tag); if (c) c.visible = false; }
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
    // consumable slots stay empty until there are items to carry
    for (const tag of ["slot0", "slot1", "slot2", "slot3", "vitaslot", "eventslot"]) {
      const slot = ui.find(tag);
      if (!slot) continue;
      const inner = slot.find("slot");
      if (inner) inner.visible = false;
      const count = slot.find("itemcount");
      if (count) count.text = "";
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
    if (this.quickbar) {
      const size = pack(this.quickbar);
      render(this.quickbar, g, Math.round((cw - size.width) / 2), ch - 8, this.hooks);
    }
  }
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
