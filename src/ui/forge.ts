// The Forge (the HUD's U button, TOGGLE_FORGE: item/client/q on ui/forge/interface_forge.dat),
// docked at the screen's left, as the client lays it out:
//
// - FORGE (q.a, an ArsenalPanel on ui/arsenal/interface.dat titled t.forge): the search field,
//   the sort header and the Sword, Handgun, Bomb, Helmet, Armor and Shield groups, listing only
//   the items ready to level (LevelItem.N: a full heat bar below level 10).
// - The dial (item/client/n on ui/forge/interface.dat): the item's name, heat bar and level
//   (ui/status/parts/panel_name_heat.dat), "Required Item" with the fire crystal of its star
//   and how many the knight holds (m.crystals_available), the big crystal count (x48), APPLY
//   CRYSTALS with the minimal, medium and maximum buttons, the status line (red "Insufficient
//   crystals to forge this item.") and FORGE, enabled with at least the minimal crystals in
//   hand. Under it, when the crystals fall short, the Supply Depot's buy panel
//   (ui/supplydepot/interface_mini_buy_item.dat, exchange/client/F) offers a stack of them.
// - RESULTS: Chance for Forge Success (m.success_pct, m.guaranteed_success or
//   m.add_more_success), Enhancements (m.power_increase for the item's type, the next level's
//   charge time and health changes) and Possible Bonuses for the chosen amount
//   (ui/window/tooltip_parts/bonus.dat; none: m.add_more_bonuses).
// - Forging (item/client/r on ui/forge/interface_forging.dat with its Power argument): the
//   item's name and icon, then after three seconds the interface's Success or Failure script,
//   "Forging successful!" with what was gained, or "Forging failed!", and OK.
//
// The rules (src/game/forge.ts, Economy.forge): the crystals are spent either way, success
// raises the level (two with a skip), failure keeps the heat. The arsenal and loadouts dock at
// the right beside it (the HUD's I and L).

import type { GameData } from "../game/data";
import { MAX_LEVEL, type Economy, type ForgeResult } from "../game/economy";
import { bonusesAt, crystalBand, crystalFor, successChance, type ForgeBonus, type ForgeStep } from "../game/forge";
import { energyNow } from "../game/energy";
import { catalogue, itemLabel } from "../game/items";
import { energyOf, type SaveData } from "../game/save";
import { message, text } from "../i18n";
import { messageText, type Component } from "./gui";
import { gradeText, ItemList, pillRef, type ListEntry, type ListGroup } from "./itemlist";
import { ownedGroups } from "./equipment";
import { buildUi, GuiScreen, uiRef, type ScreenHost } from "./screen";

export interface ForgeHost extends ScreenHost {
  save(): SaveData;
  data(): GameData;
  eco(): Promise<Economy>;
  /** The save changed (a forging, crystals bought). */
  changed(): void;
}

const FORGE = "ui/forge/interface_forge.dat";
const PANEL = "ui/forge/interface.dat";
const FORGING = "ui/forge/interface_forging.dat";
const BUY = "ui/supplydepot/interface_mini_buy_item.dat";
const BONUS = "ui/window/tooltip_parts/bonus.dat";
/** item/client/r: the result shows no sooner than this. */
const RESULT_DELAY = 3000;
/** q.a.y: the forge list's groups, in ItemCodes.Group order. */
const GROUPS = ["sword", "gun", "bomb", "helmet", "armor", "shield"];
/** The item bundle's word for each group's type (m.power_increase's argument). */
const TYPE_KEY: Record<string, string> = { sword: "m.sword", gun: "m.handgun", bomb: "m.bomb", helmet: "m.helm", armor: "m.armor", shield: "m.shield" };
const BUTTONS = ["min", "mid", "max"];

const itemText = (key: string, fallback: string) => text("item", key, fallback);

/** Replaces a tagged placeholder in a tree with another component (UserInterface.replace). */
function replaceTag(root: Component, tag: string, by: Component): boolean {
  for (const c of [root, ...root.children]) {
    const i = c.children.findIndex(k => k.tag === tag);
    if (i >= 0) { by.constraints = c.children[i].constraints; c.children[i] = by; return true; }
  }
  return root.children.some(k => replaceTag(k, tag, by));
}

export class ForgeScreen extends GuiScreen {
  private list: ItemList | null = null;
  private panel: Component | null = null;
  private buy: Component | null = null;
  private eco: Economy | null = null;
  /** The item on the dial. */
  private chosen: string | null = null;
  /** The crystals to apply (btX) and the step they apply to. */
  private crystals = 0;
  private step: ForgeStep | null = null;
  /** A forging is under way (n.btT): the dial keeps its item until the result is dismissed. */
  private forging = false;
  /** The item the forging overlay shows. */
  private shown: string | null = null;
  private buyMessage = "";

  constructor(ctx: ConstructorParameters<typeof GuiScreen>[0], private readonly host_: ForgeHost) {
    super(ctx, host_, "forgeCanvas");
    // q.BH: the forge sits at the screen's left, its list full height above the HUD from the
    // top (a client/g list window), with the HUD's energy panel at the bottom right
    this.dockLeft = () => 0;
    this.energy = () => energyNow(energyOf(this.host_.save()));
  }

  /** The forge's item list window (its height follows the screen's, as the arsenal's). */
  private listUi: Component | null = null;

  protected tick() {
    if (this.listUi) this.listUi.preferredSize = { width: -1, height: Math.max(200, Math.round(this.canvas.clientHeight - 145)) };
  }

  protected async build(): Promise<Component | null> {
    const [root, left, panel, buy, eco] = await Promise.all([this.ui(FORGE), this.ui("ui/arsenal/interface.dat", { Mode: "Window" }),
      this.ui(PANEL), this.ui(BUY), this.host_.eco()]);
    if (!root || !left || !panel) return null;
    this.eco = eco;
    this.panel = panel;
    if (!replaceTag(root, "arsenal", left) || !replaceTag(root, "forge", panel)) return null;
    this.listUi = left;
    this.list = new ItemList(this.ctx, left, this.tips, f => this.host.sound(f));
    this.list.showSelection = true;
    this.list.sorts = ["natural", "name", "stars", "level"];
    this.list.clicks = this.clicks;
    this.list.menu = (e, t, c) => void this.popupMenu(e, t, c);
    this.list.onPick = e => { this.choose(e.key); this.host.sound("sound/feedback/ui_dropdown_select.ogg"); void this.refresh(); };
    this.on(left, "dismiss", () => this.close());
    // the crystal amount buttons (n.btS, always one pressed)
    BUTTONS.forEach((tag, i) => {
      const b = panel.find(tag);
      if (!b) return;
      b.states = 8;
      b.onAction = () => { if (this.step) { this.crystals = this.step.crystals[i]; this.host.sound("sound/feedback/ui_dropdown_select.ogg"); void this.refresh(); } };
    });
    this.on(panel, "btn_forge", () => void this.forge());
    // the buy panel sits under the dial (the interface's own buy_item_widget placeholder)
    if (buy) {
      this.buy = buy;
      replaceTag(panel, "buy_item_widget", buy);
      this.on(buy, "get_item_button", () => this.buyCrystals());
    }
    if (panel.addAction) this.runner(panel).execute(panel.addAction);
    const draw = (name: string | null, size: number) => (_c: Component, g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
      const im = name ? this.icon(this.eco?.info(name)?.icon, size) : null;
      if (im) g.drawImage(im.source as CanvasImageSource, Math.round(x + (w - im.width) / 2), Math.round(y + (h - im.height) / 2), im.width, im.height);
    };
    // the forge's 3D frames (renderview1-3) are not drawn: the view hook is left out
    this.hooks = {
      tagged: {
        required_icon: (c, g, x, y, w, h) => draw(this.chosen ? crystalFor(this.eco?.info(this.chosen)?.rarity ?? 0) : null, 36)(c, g, x, y, w, h),
        icon: (c, g, x, y, w, h) => draw(this.shown, 128)(c, g, x, y, w, h),
      },
    };
    return root;
  }

  /** Puts an item on the dial with the minimal crystals (n.Fk: btR.doClick). */
  private choose(name: string | null) {
    this.chosen = name;
    const save = this.host_.save(), lv = name ? this.eco!.level(save, name) : 0;
    this.step = name ? this.eco!.forgeStep(name, lv) : null;
    this.crystals = this.step?.crystals[0] ?? 0;
    this.buyMessage = "";
  }

  protected async refresh() {
    const list = this.list, eco = this.eco, panel = this.panel;
    if (!list || !eco || !panel) return;
    const save = this.host_.save(), data = this.host_.data();
    const ready = new Set(eco.forgeable(save));
    // n.Fk: an item no longer ready leaves the dial; q.a.b: the next ready item takes its place
    if (!this.forging && (!this.chosen || !ready.has(this.chosen))) this.choose(this.firstReady(save, ready));
    list.selected = this.chosen;
    list.setInfo(itemText("t.forge", "FORGE"), "", "", null);
    const groups: ListGroup[] = ownedGroups(save, data, eco).filter(g => GROUPS.includes(g.id))
      .sort((a, b) => GROUPS.indexOf(a.id) - GROUPS.indexOf(b.id))
      .map(g => ({ ...g, showEmpty: true, entries: g.entries.filter(e => ready.has(e.key)) }));
    await list.setGroups(groups);
    await this.fillDial(save);
  }

  /** The first ready item in the list's order. */
  private firstReady(save: SaveData, ready: Set<string>): string | null {
    const order = catalogue(this.host_.data()).filter(e => ready.has(e.name) && GROUPS.includes(e.category.id))
      .sort((a, b) => GROUPS.indexOf(a.category.id) - GROUPS.indexOf(b.category.id));
    return order[0]?.name ?? (save.owned.find(n => ready.has(n)) ?? null);
  }

  private async fillDial(save: SaveData) {
    const panel = this.panel!, eco = this.eco!, name = this.chosen, step = this.step;
    // n.b: the dial shows only with an item on it
    panel.visible = !!name && !!step;
    if (!name || !step) return;
    const set = (tag: string, s: string) => { const c = panel.find(tag); if (c) c.text = s; return c; };
    const g = save.gear[name], lv = eco.level(save, name), info = eco.info(name);
    set("type", eco.displayName(name, g).toUpperCase());
    const bar = panel.find("tooltip_heat");
    if (bar) bar.preferredSize = { width: Math.max(1, Math.round(120 * eco.heatProgress(save, name))), height: bar.preferredSize?.height ?? -1 };
    set("tooltip_level", String(lv).padStart(2, "0"));
    const crystal = crystalFor(info?.rarity ?? 0), held = save.materials[crystal] ?? 0;
    set("required_name", message("item", "m.crystals_available", itemLabel(crystal), held) || `${itemLabel(crystal)}\n(${held} Available)`);
    set("crystal_count", message("item", "m.crystal_count", String(this.crystals)) || `x${this.crystals}`);
    BUTTONS.forEach((tag, i) => { const b = panel.find(tag); if (b) b.selected = this.crystals === step.crystals[i]; });
    // n.Pe: the status line and FORGE
    const enough = this.crystals >= step.crystals[0] && held >= this.crystals;
    const status = set("status", this.forging ? "" : enough ? "" : itemText("m.insufficient_crystals", "Insufficient crystals to forge this item."));
    if (status) status.visible = !!status.text;
    const btn = panel.find("btn_forge");
    if (btn) btn.enabled = enough && !this.forging;
    const pct = Math.min(100, Math.round(successChance(step, this.crystals) * 100));
    set("success_chance", message("item", "m.success_pct", String(pct)) || `${pct}%`);
    set("success_msg", pct === 100 ? itemText("m.guaranteed_success", "Guaranteed chance of forge success!")
      : itemText("m.add_more_success", "Add more fire crystals to increase chance of forge success and bonuses!"));
    await this.fillEnhancements(name, lv);
    await this.fillBonuses(step, lv);
    await this.fillBuy(save, info?.rarity ?? 0, !enough);
  }

  /** n.Uf: the type's power increase, then what the next level changes. */
  private async fillEnhancements(name: string, lv: number) {
    const pills = this.panel!.find("pills"), eco = this.eco!;
    if (!pills) return;
    const cat = catalogue(this.host_.data()).find(e => e.name === name)?.category.id ?? "sword";
    const type = messageText(TYPE_KEY[cat] ?? "m.sword", "item");
    const lines = [message("item", "m.power_increase", type) || `${type} Power Increase`];
    const cur = eco.levelStats(name, lv, 30), next = eco.levelStats(name, Math.min(MAX_LEVEL, lv + 1), 30);
    if (next.charge !== cur.charge && next.charge) lines.push(message("item", next.charge > 0 ? "m.charge_reduction" : "m.charge_increase", gradeText(0.08, next.charge)) || "Charge Time Reduction");
    if (next.health !== cur.health) lines.push(message("item", "m.start_health", Math.trunc(next.health / 40)) || `Maximum Health: ${Math.trunc(next.health / 40)}`);
    pills.children = (await Promise.all(lines.map(l => buildUi(this.ctx, uiRef(BONUS, { Color: "Bonus", Description: l, "Bonus Icon": null, "Toggle Icon": false })))))
      .filter((c): c is Component => !!c);
    pills.children.forEach(c => { c.constraints = null; });
  }

  /** n.Ug: the bonuses the chosen amount opens (ForgeProps.fk). */
  private async fillBonuses(step: ForgeStep, lv: number) {
    const box = this.panel!.find("bonuses");
    if (!box) return;
    const offered = bonusesAt(step, crystalBand(step, this.crystals));
    const lines = offered.length ? offered.map(b => this.bonusText(b, lv)) : [itemText("m.add_more_bonuses", "Add more fire crystals to unlock chances for bonuses!")];
    box.children = (await Promise.all(lines.map(l => buildUi(this.ctx, uiRef(BONUS, { Color: "Variant", Description: l, "Toggle Icon": false })))))
      .filter((c): c is Component => !!c);
    box.children.forEach(c => { c.constraints = null; });
  }

  /** ForgePropertyConfig.Bonus.d: a bonus's line. */
  private bonusText(b: ForgeBonus, lv: number): string {
    if (b.kind === "heat") return itemText("m.bonus_heat_bonus", "Heat Bonus: +25%");
    if (b.kind === "skip") return message("item", "m.bonus_skip_level", lv + 2) || `Instantly Skip to Level ${lv + 2}!`;
    const box = itemText("m.bonus_prize_box", "Forge Prize Box!");
    return b.locked ? message("item", "l.locked", box) || `${box} (Locked)` : box;
  }

  /** exchange/client/F: the crystal stack the depot sells, shown while the crystals fall short. */
  private async fillBuy(save: SaveData, rarity: number, short: boolean) {
    const buy = this.buy, eco = this.eco!;
    if (!buy) return;
    const offer = eco.crystalOffer(rarity);
    buy.visible = short && !!offer && !this.forging;
    if (!offer || !buy.visible) return;
    const entry: ListEntry = { key: offer.name, label: itemLabel(offer.name), rarity, icon: eco.info(offer.name)?.icon ?? null, count: String(offer.count) };
    const pill = await buildUi(this.ctx, pillRef(entry));
    const count = pill?.find("itemcount");
    if (count) count.text = String(offer.count);
    const slot = buy.find("item")?.children[0];
    if (pill && slot && slot !== pill) { pill.constraints = slot.constraints; pill.tag = "item_display"; buy.find("item")!.children[0] = pill; }
    const cost = offer.energy ? `${offer.count} for ${offer.energy.toLocaleString("en-US")} energy (you have ${energyNow(energyOf(save)).toLocaleString("en-US")})`
      : `${offer.count} for ${offer.crowns.toLocaleString("en-US")} crowns (you have ${save.crowns.toLocaleString("en-US")})`;
    const status = buy.find("status");
    if (status) { status.text = this.buyMessage || cost; status.visible = true; }
  }

  private buyCrystals() {
    const save = this.host_.save(), eco = this.eco!, name = this.chosen;
    if (!name) return;
    const offer = eco.crystalOffer(eco.info(name)?.rarity ?? 0);
    if (!offer) return;
    if (!eco.buyCrystals(save, offer)) {
      this.buyMessage = offer.energy ? "Not enough energy. Get Energy trades crowns for it." : "Not enough crowns.";
      this.host.sound("sound/feedback/ui_dismiss.ogg");
    } else {
      this.buyMessage = "";
      this.host_.changed();
      this.host.sound("sound/feedback/merchant_transaction.ogg");
    }
    void this.refreshAll();
  }

  /** n.Ub: forges with the chosen crystals, then shows item/client/r. */
  private async forge() {
    const save = this.host_.save(), eco = this.eco!, name = this.chosen, step = this.step;
    if (!name || !step || this.forging) return;
    const band = crystalBand(step, this.crystals);
    const label = eco.displayName(name, save.gear[name]);
    const result = eco.forge(save, name, this.crystals);
    if (!result) { this.host.sound("sound/feedback/ui_dismiss.ogg"); return; }
    this.host_.changed();
    this.forging = true;
    this.host.sound("sound/feedback/ui_confirm.ogg");
    await this.refreshAll();
    await this.showForging(name, label, band + 1, result);
  }

  /** item/client/r: FORGING with the item, then Success or Failure after three seconds. */
  private async showForging(name: string, label: string, power: number, r: ForgeResult) {
    const o = await buildUi(this.ctx, uiRef(FORGING, { Power: String(power) }));
    if (!o) { this.done(); return; }
    const set = (tag: string, s: string) => { const c = o.find(tag); if (c) c.text = s; return c; };
    set("itemname", label.toUpperCase());
    this.shown = name;
    const dismiss = o.find("dismiss");
    if (dismiss) dismiss.visible = false;
    const ok = o.find("confirm");
    const close = () => { this.dropOverlay(o); this.runner(o).stop(); this.done(); };
    if (ok) ok.onAction = () => { this.host.sound("sound/feedback/ui_dismiss.ogg"); close(); };
    this.pushOverlay(o);
    const run = this.runner(o);
    if (o.addAction) run.execute(o.addAction);
    setTimeout(() => {
      if (!this.isOpen || !this.overlays.includes(o)) { this.done(); return; }
      if (r.success) {
        // the server's message (t.br): the level reached and any bonus won
        const lines = [message("item", "m.forge_new_level", label, r.level) || `Achieved Level ${r.level}!`];
        if (r.bonus?.kind === "heat") lines.push(itemText("m.forge_heat_bonus", "Heat Bonus: +25% Acquired!"));
        if (r.bonus?.kind === "skip") lines.push(itemText("m.forge_skip", "Double Level Up Acquired!"));
        if (r.bonus?.kind === "prize") lines.push(itemText("m.forge_prize_box", "Forge Prize Box Acquired!"), r.prize ? `${r.prize.count} ${itemLabel(r.prize.name)}` : "");
        set("bonus_text", lines.filter(Boolean).join("\n"));
        set("label_success", itemText("m.forge_success", "Forging successful!"));
        run.runScript({ name: "Success" });
        this.host.sound("sound/feedback/transmute.ogg");
      } else {
        set("status", itemText("m.fail_to_level", "Forging failed!"));
        run.runScript({ name: "Failure" });
      }
      if (ok) ok.enabled = true;
    }, RESULT_DELAY);
  }

  /** Escape takes the forging window away as OK does. */
  escape() {
    const was = this.forging && this.overlays.length > 0;
    super.escape();
    if (was && !this.overlays.length) this.done();
  }

  /** The window closed mid-forging: nothing waits on the result. */
  close() {
    this.forging = false;
    this.shown = null;
    super.close();
  }

  /** r.wasRemoved: the forging is over; the dial moves on. */
  private done() {
    if (!this.forging) return;
    this.forging = false;
    this.shown = null;
    void this.refreshAll();
  }
}
