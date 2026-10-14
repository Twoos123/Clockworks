// The Loadouts window (the HUD's L button, TOGGLE_LOADOUT: client/bL around client/aX): the
// arsenal list (ui/arsenal/interface.dat in Window mode) titled LOADOUTS, with the "Lock 'n
// Load!" infobox (t.infobox_loadout, m.infobox_loadout), one LOADOUTS group of loadout pills
// (ui/loadout/parts/interface_pill.dat: the name, the PvE and PvP tiers with their meters, the
// equipped backing) and "PvP Tier N" under the list. It docks at the screen's right, left of
// the arsenal when that is open (bL.Cj). The client's first loadout is the knight's current
// equipment (m.current_loadout, "<Current Equipment>"); the others are the saved loadouts.
//
// A press on a pill pops up its menu (client/bH): "Equipped" when worn, else Equip Loadout;
// Save As... on the current equipment; Remove Loadout on a saved one (with the client's
// confirm prompt, m.remove_loadout_prompt). PvP marking needs PvP and is left out.
//
// The tiers are item/b/b's: the PvE tier is the lower of the best weapon's star and the
// weakest of the helmet, armour and shield, halved, plus one; the meter adds 0.2 for each of
// those three pieces and the two best weapons at the tier's top star (halving per star short).
// The PvP meter weighs the armour pieces and weapons at 0.25 (shield left out); single play
// keeps no separate PvP rating, so its tier is the PvE one.

import type { GameData } from "../game/data";
import type { Economy } from "../game/economy";
import { ACCESSORY_SLOTS } from "../game/accessories";
import { itemLabel } from "../game/items";
import type { Outfit } from "../game/outfit";
import { MAX_LOADOUTS, saveLoadout, wearableLoadout, type Loadout, type SaveData, type SavedLoadout } from "../game/save";
import { message, text } from "../i18n";
import type { Component } from "./gui";
import { ItemList, type ListEntry } from "./itemlist";
import { buildUi, GuiScreen, uiRef, type DockPanel, type ScreenHost, type TipSpec } from "./screen";

export interface LoadoutsHost extends ScreenHost {
  save(): SaveData;
  data(): GameData;
  eco(): Promise<Economy>;
  outfit(): Outfit;
  /** The loadout changed (written to the save). */
  equipped(l: Loadout): void;
  /** Writes the save (a loadout saved or removed). */
  write(): void;
}

const PILL = "ui/loadout/parts/interface_pill.dat";
const TIP = "ui/loadout/parts/tooltip.dat";
const RENAME = "ui/rename/interface.dat";
const CONFIRM = "ui/window/confirm_prompt/interface.dat";
const CAT = "ui/icon/inventory/categories/";
const COSTUMES = ["helmet", "armor", "shield"] as const;

const t = (key: string, fallback: string) => text("projectx", key, fallback);

/** item/b/b.a: a loadout's PvE tier (1-3) from its gear's stars. */
export function loadoutTier(l: Loadout, stars: (n: string) => number): number {
  const armour = Math.min(...[l.helmet, l.armor, l.shield].map(n => (n ? stars(n) : 0)));
  const weapon = Math.max(0, ...l.weapons.filter(Boolean).map(stars));
  return Math.floor(Math.min(weapon, armour) / 2) + 1;
}

/**
 * item/b/b.a and .b: a loadout's meter toward a tier (0 to 1): each counted piece adds its
 * share at the tier's top star, halved for each star short; the two best weapons count.
 */
export function loadoutMeter(l: Loadout, stars: (n: string) => number, tier: number, pvp = false): number {
  const top = tier * 2 - 1, share = pvp ? 0.25 : 0.2;
  const part = (n: string) => share * (n && stars(n) >= top ? 1 : 1 / 2 ** (top - (n ? stars(n) : 0)));
  const armour = (pvp ? [l.helmet, l.armor] : [l.helmet, l.armor, l.shield]).reduce((a, n) => a + part(n), 0);
  const weapons = l.weapons.filter(Boolean).map(part).sort((a, b) => b - a).slice(0, 2);
  return Math.min(1, armour + weapons.reduce((a, b) => a + b, 0));
}

/** The loadout pill's arguments (aX.a). */
export function loadoutPill(name: string, l: Loadout, stars: (n: string) => number, equipped: boolean) {
  const tier = loadoutTier(l, stars);
  return uiRef(PILL, {
    Name: name, Mode: "pve", Hoverable: true, Equipped: equipped ? "True" : "False",
    "PvE Tier": message("projectx", "m.pve_tier", tier) || `PvE T${tier}`,
    "PvP Tier": message("projectx", "m.pvp_tier", tier) || `PvP T${tier}`,
    "PvE Meter": Math.round(70 * loadoutMeter(l, stars, tier)),
    "PvP Meter": Math.round(70 * loadoutMeter(l, stars, tier, true)),
  });
}

/** Puts on a saved loadout: its gear (what is still owned), costumes, accessories and battle sprite. */
export async function wearLoadout(save: SaveData, outfit: Outfit, l: SavedLoadout, equipped: (l: Loadout) => void) {
  equipped(wearableLoadout(save, l));
  for (const s of COSTUMES) if (outfit.appearance.costume[s] !== l.appearance.costume[s]) await outfit.equipCostume(s, l.appearance.costume[s]);
  for (const s of ACCESSORY_SLOTS) if (outfit.appearance.accessories[s] && !l.appearance.accessories[s]) await outfit.removeAccessory(s);
  for (const s of ACCESSORY_SLOTS) { const n = l.appearance.accessories[s]; if (n && outfit.appearance.accessories[s] !== n) await outfit.equipAccessory(n); }
  if (l.sprite !== (save.sprites?.active ?? "") && (!l.sprite || outfit.ownedSprites().includes(l.sprite))) outfit.setSprite(l.sprite);
}

/** Whether a saved loadout is what the knight wears now. */
export const wearing = (save: SaveData, l: SavedLoadout) => JSON.stringify(wearableLoadout(save, l)) === JSON.stringify(save.loadout);

/** The loadout tooltip (ui/loadout/parts/tooltip.dat): every slot's item and the battle sprite. */
export function loadoutTip(save: SaveData, eco: Economy | null, icon: (n: string) => any, name: string, g: Loadout, costume: Record<string, string>, sprite: string): TipSpec {
  const label = (n: string) => n ? (eco?.displayName(n, save.gear[n]) ?? itemLabel(n)) : "Empty";
  const slots: [string, string, string][] = [
    ["0", g.helmet, "icon_helmet.png"], ["1", g.armor, "icon_armor.png"], ["2", g.shield, "icon_shield.png"],
    ["3", costume.helmet ?? "", "icon_helmet_nocore.png"], ["4", costume.armor ?? "", "icon_armor_nocore.png"], ["15", costume.shield ?? "", "icon_shield_nocore.png"],
    ["6", g.weapons[0] ?? "", "icon_gauntlet.png"], ["7", g.weapons[1] ?? "", "icon_gauntlet.png"], ["8", g.weapons[2] ?? "", "icon_gauntlet.png"],
    ["9", g.vitapod, "icon_capsule.png"], ["10", g.trinkets[0] ?? "", "icon_core.png"], ["11", g.trinkets[1] ?? "", "icon_core.png"],
  ];
  const args: Record<string, unknown> = { Type: t("t.loadout", "LOADOUT"), Name: name.toUpperCase(), "Visible Harness": false, "Visible Perk": false,
    "Name Sprite": sprite || "No battle sprite", "Icon Sprite": CAT + "icon_battlesprite.png" };
  for (const [i, n, fb] of slots) { args[`Name ${i}`] = label(n); args[`Icon ${i}`] = n ? icon(n)?.file ?? CAT + fb : CAT + fb; }
  return { ref: uiRef(TIP, args) };
}

/**
 * A name entry window over a window (ui/rename/interface.dat): the title, up to three lines,
 * the field and Accept; `accept` returns an error to show, or null to close.
 */
export async function nameWindow(screen: GuiScreen, o: { title: string; lines: string[]; value: string; accept: (name: string) => string | null; done: () => void }) {
  const w = await buildUi(screen.dockContext.ctx, uiRef(RENAME));
  if (!w) return;
  const set = (tag: string, s: string) => { const c = w.find(tag); if (c) { c.text = s; c.visible = !!s; } };
  set("label_title", o.title);
  for (let i = 0; i < 3; i++) set(`label_desc${i + 1}`, o.lines[i] ?? "");
  const alert = w.find("alert");
  if (alert) { alert.visible = false; alert.icon = null; }
  const field = w.find("namefield");
  if (field) { field.text = o.value; field.maxLength = 20; }
  const accept = () => {
    const err = o.accept(String(field?.text ?? ""));
    if (err && alert) { alert.text = err; alert.visible = true; screen.sound("sound/feedback/ui_dismiss.ogg"); return; }
    screen.sound("sound/feedback/ui_confirm.ogg");
    screen.dropOverlay(w);
    o.done();
  };
  const ok = w.find("buttonAccept");
  if (ok) ok.onAction = accept;
  if (field) field.onAction = (_c, a) => { if (a === "enter") accept(); };
  const dismiss = w.find("dismiss");
  if (dismiss) dismiss.onAction = () => { screen.sound("sound/feedback/ui_dismiss.ogg"); screen.dropOverlay(w); };
  screen.pushOverlay(w);
}

/** The client's confirm prompt (client/ui/k on ui/window/confirm_prompt/interface.dat). */
export async function confirmPrompt(screen: GuiScreen, title: string, prompt: string, ok: () => void) {
  const w = await buildUi(screen.dockContext.ctx, uiRef(CONFIRM));
  if (!w) return;
  const set = (tag: string, s: string) => { const c = w.find(tag); if (c) c.text = s; };
  set("title", title);
  set("prompt", prompt);
  const box = w.find("confirm");
  if (box) box.visible = false;
  const close = () => screen.dropOverlay(w);
  for (const tag of ["cancel", "dismiss"]) { const c = w.find(tag); if (c) c.onAction = () => { screen.sound("sound/feedback/ui_dismiss.ogg"); close(); }; }
  const accept = w.find("accept");
  if (accept) accept.onAction = () => { screen.sound("sound/feedback/ui_confirm.ogg"); close(); ok(); };
  screen.pushOverlay(w);
}

/** The Loadouts list, in whichever window shows it (its own, or docked by the forge). */
export class LoadoutsPanel implements DockPanel {
  private constructor(readonly ui: Component, private readonly list: ItemList, private readonly screen: GuiScreen,
    private readonly host: LoadoutsHost, private readonly eco: Economy) {}

  /** Builds the panel; `close` is its dismiss button. */
  static async create(screen: GuiScreen, host: LoadoutsHost, close: () => void): Promise<LoadoutsPanel | null> {
    const { ctx, tips, clicks } = screen.dockContext;
    const [ui, eco] = await Promise.all([buildUi(ctx, uiRef("ui/arsenal/interface.dat", {
      Mode: "Window", "Infobox Heading": t("t.infobox_loadout", "Lock 'n Load!"),
      "Infobox Text": t("m.infobox_loadout", "Loadouts are configurations of equipment that you design!"), "Infobox Visible": true, "Infobox Open": "Open",
    })), host.eco()]);
    if (!ui) return null;
    const dismiss = ui.find("dismiss");
    if (dismiss) dismiss.onAction = () => close();
    const list = new ItemList(ctx, ui, tips, f => host.sound(f));
    list.bundle = "projectx";
    list.clicks = clicks;
    list.menu = (e, ti, c) => void screen.popupMenu(e, ti, c);
    const panel = new LoadoutsPanel(ui, list, screen, host, eco);
    list.onPick = e => void panel.menu(e);
    return panel;
  }

  private stars = (n: string) => Math.max(0, this.eco.info(n)?.rarity ?? 0);
  private icon = (n: string) => this.eco.info(n)?.icon ?? null;

  /** client/bH: the loadout's menu. */
  private async menu(e: ListEntry) {
    const save = this.host.save(), i = e.key === "current" ? -1 : Number(e.key.split(":")[1]);
    const saved = i >= 0 ? save.loadouts?.[i] ?? null : null;
    if (i >= 0 && !saved) return;
    const worn = saved ? wearing(save, saved) : true;
    const entries = [
      worn ? { text: t("l.equipped", "Equipped"), enabled: false } : { action: "equip", text: t("m.equip", "Equip Loadout") },
      saved ? { action: "remove", text: t("m.remove", "Remove Loadout") } : { action: "save_as", text: t("m.save_as", "Save As...") },
    ];
    await this.screen.popupMenu(entries, saved?.name ?? t("m.current_loadout", "<Current Equipment>"), a => {
      if (a === "equip" && saved) void wearLoadout(save, this.host.outfit(), saved, l => this.host.equipped(l)).then(() => this.changed("sound/feedback/ui_equip.ogg"));
      else if (a === "save_as") this.saveAs();
      else if (a === "remove" && saved) void confirmPrompt(this.screen, t("m.remove_loadout", "Removing a loadout"),
        message("projectx", "m.remove_loadout_prompt", saved.name) || `Are you sure you want to remove ${saved.name}?`, () => {
          save.loadouts = (save.loadouts ?? []).filter(x => x !== saved);
          this.host.write();
          this.changed();
        });
    });
  }

  /** bH.k: names the current equipment as a loadout (m.save_loadout). */
  private saveAs() {
    const save = this.host.save(), n = save.loadouts?.length ?? 0;
    void nameWindow(this.screen, {
      title: t("m.save_loadout", "Save Loadout"), value: `Loadout ${Math.min(MAX_LOADOUTS, n + 1)}`,
      lines: ["Name the gear, costumes and battle sprite you have on.", "Saving under a loadout's name replaces it.", `${n} of ${MAX_LOADOUTS} loadouts saved.`],
      accept: name => {
        const s = name.trim();
        if (!s) return "Give the loadout a name.";
        if (!saveLoadout(save, s, save.sprites?.active ?? "")) return `You have ${MAX_LOADOUTS} loadouts: save over one of their names.`;
        this.host.write();
        return null;
      },
      done: () => this.changed(),
    });
  }

  private changed(sound?: string) {
    if (sound) this.host.sound(sound);
    void this.screen.refreshAll();
  }

  async refresh() {
    const save = this.host.save(), outfit = this.host.outfit();
    this.list.setInfo(t("t.loadouts", "LOADOUTS"), t("t.infobox_loadout", "Lock 'n Load!"),
      t("m.infobox_loadout", "Loadouts are configurations of equipment that you design!"), null);
    // aX.EV: the PvP tier under the list (the current equipment's, as single play keeps no rating)
    const pvp = this.ui.find("pvp_tier");
    if (pvp) { pvp.visible = true; pvp.text = message("projectx", "n.pvp_tier", loadoutTier(save.loadout, this.stars)) || `PvP Tier ${loadoutTier(save.loadout, this.stars)}`; }
    const saved = save.loadouts ?? [];
    const anyWorn = saved.some(l => wearing(save, l));
    const current = t("m.current_loadout", "<Current Equipment>");
    const entries: ListEntry[] = [
      { key: "current", label: current, rarity: -1, icon: null, ui: loadoutPill(current, save.loadout, this.stars, !anyWorn),
        tip: loadoutTip(save, this.eco, this.icon, current, save.loadout, outfit.appearance.costume, save.sprites?.active ?? "") },
      ...saved.map((l, i) => ({ key: `loadout:${i}`, label: l.name, rarity: -1, icon: null, ui: loadoutPill(l.name, wearableLoadout(save, l), this.stars, wearing(save, l)),
        tip: loadoutTip(save, this.eco, this.icon, l.name, l.loadout, l.appearance.costume, l.sprite) })),
    ];
    // aX.y: one open group, its entries in name order
    entries.splice(1, entries.length - 1, ...entries.slice(1).sort((a, b) => a.label.localeCompare(b.label)));
    await this.list.setGroups([{ id: "loadouts", label: t("t.loadouts", "LOADOUTS"), icon: CAT + "icon_equippable.png", entries, showEmpty: true }]);
  }
}

/** The Loadouts window on its own, docked at the screen's right (the arsenal may dock beside it). */
export class LoadoutsScreen extends GuiScreen {
  private panel: LoadoutsPanel | null = null;

  constructor(ctx: ConstructorParameters<typeof GuiScreen>[0], private readonly host_: LoadoutsHost) {
    super(ctx, host_, "loadoutsCanvas");
    this.dockRight = true;
  }

  protected async build(): Promise<Component | null> {
    this.panel = await LoadoutsPanel.create(this, this.host_, () => this.close());
    return this.panel?.ui ?? null;
  }

  protected async refresh() { await this.panel?.refresh(); }
}
