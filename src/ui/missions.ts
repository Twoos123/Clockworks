// The mission board: the game's missions (src/game/missions.ts) grouped by rank, with their
// card images from the install, status, rewards and prestige. The game's mission window is
// filled in by closed code, so this one is HTML in the style of the options menu and the
// Arcade's gate board.

import type { GameData } from "../game/data";
import type { Floor, Gate, StratumTheme } from "../game/clockworks";
import {
  canExchange, completeMission, crownReward, daysUntilActive, exchangeNeeds, freshProgress, isGear, missionRun, missionStatus,
  npcName, parseMissions, rankLabel, rankName, rewardItems, weeklyPrestige, type Ingredient, type Mission, type MissionProgress,
} from "../game/missions";
import { weaponLevel, type SaveData } from "../game/save";
import { SpawnTables } from "../game/spawntable";
import type { GuiContext, GuiImage } from "./gui";

/** What the board needs from the game. */
export interface MissionHost {
  data: GameData;
  gui: GuiContext;
  save(): SaveData;
  write(): void;
  sound(file: string): void;
  /** Pauses the game while the board is open. */
  pause(on: boolean): void;
  /** Starts a mission's floors through the gate descent. */
  startRun(gate: Gate, floors: Floor[]): void;
  /** Opens the Arcade's gate board (prestige gate missions are played there). */
  openGates(): void;
}

const LIBS = ["config/mission.dat", "config/mission_property.dat", "config/recipe.dat", "config/spawn_table.dat", "config/item.dat"];
type Tab = "rank" | "prestige" | "operations";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const label = (name: string) => name.split("/").pop() ?? name;
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

export class MissionBoard {
  private readonly root: HTMLElement;
  private missions: Mission[] = [];
  private loading: Promise<void> | null = null;
  private tab: Tab = "rank";
  /** The dungeon mission being played, if any. */
  private active: Mission | null = null;

  constructor(private readonly host: MissionHost) {
    this.root = el("div", "arsenal");
    this.root.id = "missions";
    this.root.hidden = true;
    const gates = document.getElementById("gates");
    (gates?.parentElement ?? document.body).append(this.root);
  }

  get list(): readonly Mission[] { return this.missions; }
  get progress(): MissionProgress { return progressOf(this.host.save()); }
  get isOpen() { return !this.root.hidden; }

  load(): Promise<void> {
    this.loading ??= (async () => {
      await this.host.data.preload(...LIBS);
      this.missions = parseMissions([...this.host.data.library_("config/mission.dat").values()], this.host.data.library_("config/mission_property.dat"));
    })();
    return this.loading;
  }

  async open(tab?: Tab) {
    if (tab) this.tab = tab;
    await this.load();
    this.render();
    this.root.hidden = false;
    this.host.pause(true);
    this.host.sound("sound/feedback/ui_open.ogg");
  }

  close() {
    this.root.hidden = true;
    this.host.pause(false);
  }

  toggle() { if (this.isOpen) this.close(); else void this.open(); }

  // -------------------------------------------------------------------- game hooks

  /** The descent ran out of floors: when it was a mission's run, the mission is done. */
  runFinished(gateId: string | undefined) {
    const m = this.active;
    this.active = null;
    if (!m || gateId !== `mission:${m.id}`) return;
    this.finish(m);
  }

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

  private start(m: Mission) {
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
      for (const g of needs) if (g.level === undefined) save.materials[g.item] = (save.materials[g.item] ?? 0) - g.count;
      this.finish(m);
    } else {
      this.briefing(m);
    }
  }

  /** Awards a mission's rewards and prestige, ranks up, and shows what it gave. */
  private finish(m: Mission) {
    const save = this.host.save(), p = progressOf(save);
    const before = rankLabel(p);
    const got = new Map<string, number>();
    const tables = new SpawnTables(this.host.data.library_("config/spawn_table.dat"));
    const depth = m.setting?.depth ?? Math.max(1, m.rank * 3);
    const ctx = { depth, tier: depth >= 18 ? 3 : depth >= 8 ? 2 : 1, difficulty: "medium" as const };
    for (const t of m.rewards) {
      for (const r of tables.evaluate({ name: t }, ctx)) {
        const name = r.item?.name;
        if (!name) continue;
        if (isGear(name)) { if (!save.owned.includes(name)) save.owned.push(name); }
        else save.materials[name] = (save.materials[name] ?? 0) + Math.max(1, r.count);
        got.set(name, (got.get(name) ?? 0) + Math.max(1, r.count));
      }
    }
    const crowns = crownReward(m);
    save.crowns += crowns;
    completeMission(this.missions, m, p);
    this.host.write();
    const after = rankLabel(p);
    this.host.sound("sound/feedback/ui_merchant_trade_add.ogg");
    this.dialog(`${m.title}: complete`, card => {
      card.append(el("p", "settings-note", `+${crowns} crowns · +${m.prestige} prestige${got.size ? "" : " · no items"}`));
      if (got.size) card.append(this.itemRow([...got].map(([item, count]) => ({ item, count }))));
      if (after !== before) card.append(el("p", "mission-rankup", `Rank up! ${after}: ${rankName(p.rank)}`));
    });
  }

  // -------------------------------------------------------------------- rendering

  private needs(m: Mission): Ingredient[] { return exchangeNeeds(m, this.host.data.library_("config/recipe.dat")); }

  private ownedLevel(name: string): number {
    const s = this.host.save();
    if (!s.owned.includes(name)) return 0;
    return /^Weapon\//.test(name) ? weaponLevel(s.weaponHeat[name] ?? 0) : 10;
  }

  private render() {
    const p = this.progress, save = this.host.save();
    this.root.replaceChildren();
    const card = el("div", "settings-card gates-card missions-card");
    const head = el("div", "settings-head");
    const h = el("h2", "", "Missions");
    const close = el("button", "", "Close");
    close.onclick = () => this.close();
    head.append(h, close);
    const status = el("p", "settings-note", `${rankLabel(p)} · ${rankName(p.rank)} · ${p.prestige} prestige · ${save.crowns} crowns`);
    const tabs = el("div", "arsenal-tabs");
    for (const [id, text, icon] of [["rank", "Rank missions", "rank"], ["prestige", "Prestige (this week)", "prestige"], ["operations", "Operations", "expansion"]] as const) {
      const b = el("button", this.tab === id ? "active" : "");
      const cv = this.canvasImage(`ui/mission/images/catagories/${icon}.png`, 76, 28);
      b.append(cv, document.createTextNode(" " + text));
      b.onclick = () => { this.tab = id; this.host.sound("sound/feedback/ui_confirm.ogg"); this.render(); };
      tabs.append(b);
    }
    card.append(head, status, tabs);
    if (this.tab === "rank") this.renderRank(card, p);
    else if (this.tab === "prestige") this.renderPrestige(card, p);
    else this.renderGrid(card, this.missions.filter(m => m.cls === "Expansion"), p,
      "Operations from the game's expansion pack, one per Clockworks tier (tier 2 needs rank 4, tier 3 rank 6).");
    this.root.append(card);
  }

  private renderRank(card: HTMLElement, p: MissionProgress) {
    card.append(el("p", "settings-note", "Complete every mission of your subrank to rank up. Tier 2 of the Clockworks needs rank 4 (Knight), tier 3 rank 6 (Defender)."));
    const rank = this.missions.filter(m => m.cls === "Rank");
    for (let r = 1; r <= 10; r++) {
      const ms = rank.filter(m => m.rank === r);
      if (!ms.length) continue;
      const done = ms.filter(m => missionStatus(m, p) === "complete").length;
      const sec = el("details", "mission-rank");
      sec.open = r === p.rank;
      sec.append(el("summary", "", `Rank ${r}: ${rankName(r)} (${done}/${ms.length})`));
      const subs = [...new Set(ms.map(m => m.subrank))].sort((a, b) => a - b);
      for (const s of subs) {
        sec.append(el("h4", "mission-sub", `${r}-${s}`));
        this.renderGrid(sec, ms.filter(m => m.subrank === s), p);
      }
      card.append(sec);
    }
  }

  private renderPrestige(card: HTMLElement, p: MissionProgress) {
    const now = Date.now();
    const week = weeklyPrestige(this.missions, p, now).sort((a, b) =>
      (a.schedule ? daysUntilActive(a.schedule, now) : 0) - (b.schedule ? daysUntilActive(b.schedule, now) : 0) || a.path.localeCompare(b.path));
    const events = this.missions.filter(m => m.cls === "Prestige" && m.event).length;
    card.append(el("p", "settings-note", p.rank < 3
      ? "Prestige missions open at rank 3. Each runs on its own day of a schedule from the game's data; done missions open again on their next day."
      : `This week's prestige missions for rank ${p.rank}, from the game's schedules: each is open on its day. ${events} event missions are left out (events are run by the game's servers).`));
    this.renderGrid(card, week, p);
  }

  private renderGrid(parent: HTMLElement, ms: Mission[], p: MissionProgress, note?: string) {
    if (note) parent.append(el("p", "settings-note", note));
    const grid = el("div", "mission-grid");
    if (!ms.length) grid.append(el("p", "settings-note", "No missions here yet."));
    for (const m of ms) grid.append(this.missionCard(m, p));
    parent.append(grid);
  }

  private missionCard(m: Mission, p: MissionProgress): HTMLElement {
    const now = Date.now();
    const st = missionStatus(m, p, now);
    const box = el("div", `mission ${st}`);
    box.dataset.mission = m.id;
    const art = el("div", "mission-art");
    art.append(this.canvasImage(m.cardImage, 120, 170), this.canvasImage("ui/mission/images/cards/frame_up.png", 120, 170, "mission-frame"));
    const body = el("div", "mission-body");
    body.append(el("h3", "", m.title));
    const when = st === "upcoming" && m.schedule ? `opens in ${daysUntilActive(m.schedule, now)} day(s)` : st;
    body.append(el("span", "mission-tag", `${KIND_LABEL[m.kind]} · ${when}`));
    body.append(el("p", "mission-summary", m.summary));
    if (m.kind === "exchange") {
      const save = this.host.save();
      body.append(el("p", "mission-needs", "Needs: " + this.needs(m).map(g => g.level !== undefined
        ? `${label(g.item)} (owned ${this.ownedLevel(g.item) ? "yes" : "no"})` : `${g.count} ${label(g.item)} (${save.materials[g.item] ?? 0})`).join(", ")));
    }
    if (m.needs.length && st === "locked") body.append(el("p", "mission-needs", "After: " + m.needs.map(id => this.missions.find(x => x.id === id)?.title ?? id).join(", ")));
    const items = m.rewards.flatMap(t => rewardItems(t, this.host.data.library_("config/spawn_table.dat")));
    body.append(el("p", "mission-reward", `Reward: ${crownReward(m)} crowns · ${m.prestige} prestige`));
    if (items.length) body.append(this.itemRow(items));
    if (st === "available") {
      const go = el("button", "primary", m.kind === "dungeon" ? "Start" : m.kind === "exchange" ? "Turn in" : m.kind === "gate" ? "To the Arcade" : "Read briefing");
      go.dataset.action = "start";
      if (m.kind === "exchange") (go as HTMLButtonElement).disabled = !canExchange(this.needs(m), this.host.save().materials, n => this.ownedLevel(n));
      go.onclick = () => this.start(m);
      body.append(go);
    }
    box.append(art, body);
    return box;
  }

  /** Reward items with their inventory icons. */
  private itemRow(items: { item: string; count: number }[]): HTMLElement {
    const row = el("div", "mission-items");
    for (const { item, count } of items.slice(0, 8)) {
      const cell = el("span", "mission-item");
      cell.title = item;
      const cfg = this.host.data.resolveSync("config/item.dat", { name: item }, "item");
      const cv = document.createElement("canvas");
      cv.width = cv.height = 32;
      if (cfg?.icon) void this.host.gui.icon(cfg.icon).then(im => this.draw(cv, im));
      cell.append(cv, el("span", "", `${count > 1 ? count + "× " : ""}${label(item)}`));
      row.append(cell);
    }
    return row;
  }

  private canvasImage(file: string | null, w: number, h: number, cls = ""): HTMLCanvasElement {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    if (cls) cv.className = cls;
    if (file) void this.host.gui.image(file).then(im => this.draw(cv, im));
    return cv;
  }

  private draw(cv: HTMLCanvasElement, im: GuiImage | null) {
    if (!im) return;
    const g = cv.getContext("2d")!, s = Math.min(cv.width / im.width, cv.height / im.height);
    g.drawImage(im.source as CanvasImageSource, (cv.width - im.width * s) / 2, (cv.height - im.height * s) / 2, im.width * s, im.height * s);
  }

  /** A conversation mission: the card, who it is with, and our summary. */
  private briefing(m: Mission) {
    this.dialog(m.title, card => {
      const row = el("div", "mission-brief");
      row.append(this.canvasImage(m.cardImage, 120, 170));
      const text = el("div", "");
      const npc = npcName(m);
      if (npc) text.append(el("h3", "", npc));
      text.append(el("p", "", m.summary));
      if (m.npcModel) text.append(el("p", "settings-note", `Model: ${m.npcModel}${m.npcVariant ? ` (${m.npcVariant})` : ""}`));
      text.append(el("p", "settings-note", `The game's dialogue${m.conversation ? ` (${m.conversation})` : ""} lives in its message bundles, which this port does not read; the summary above is ours.`));
      row.append(text);
      card.append(row);
    }, () => this.finish(m), "Done");
  }

  /** A small card over the board (results and briefings). */
  private dialog(title: string, fill: (card: HTMLElement) => void, onOk?: () => void, ok = "OK") {
    this.root.replaceChildren();
    const card = el("div", "settings-card mission-dialog");
    const head = el("div", "settings-head");
    head.append(el("h2", "", title));
    card.append(head);
    fill(card);
    const b = el("button", "primary", ok);
    b.dataset.action = "ok";
    b.onclick = () => { if (onOk) onOk(); else this.render(); };
    card.append(b);
    this.root.append(card);
    this.root.hidden = false;
    this.host.pause(true);
  }
}

/** A short notice over the game (rank locks, mission results), gone after a few seconds. */
export function notice(text: string, seconds = 6) {
  let n = document.getElementById("notice");
  if (!n) {
    n = el("div", "game-notice");
    n.id = "notice";
    (document.getElementById("gates")?.parentElement ?? document.body).append(n);
  }
  n.textContent = text;
  n.hidden = false;
  clearTimeout((n as any)._t);
  (n as any)._t = setTimeout(() => { n!.hidden = true; }, seconds * 1000);
}
