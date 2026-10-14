// The Test Range (development only): a flat hall (src/dev/rangescene.ts) where the knight
// plays with any gear, a training dummy that shows what each hit did, pens for any monster,
// and an animation browser. Reached from the asset viewer (#viewer, its sidebar's "Test
// Range"), never from the game. The panel is plain DOM over the stage; the world reports hits
// through its probe (src/game/world.ts WorldProbe). In development builds it also installs
// window.__range, which the sweep (tools/audit/sweep.ts) drives.

import { loadAnimation, type AnimationClip, type LoadedModel, type ModelLoader } from "../model";
import type { Renderer } from "../render/renderer";
import { Knight, Monster, type MonsterHold, type ProbeHit, type Puppet, type World } from "../game/world";
import type { Prop } from "../game/props";
import type { AttackDef } from "../game/data";
import { catalogue, CATEGORIES, type ItemEntry } from "../game/items";
import type { Loadout } from "../game/save";
import { attackTiming, damageSplit, hitLines, monsterTree, statusText, summarize, timingText, type HitRecord, type StatusRoll } from "./readout";

export interface RangeHost {
  world(): World | null;
  readonly loader: ModelLoader;
  readonly renderer: Renderer;
  /** Every .dat file of the install (animation files for the browser). */
  readonly datFiles: string[];
  /** The depth monsters and gear scale at; changing it restarts the range. */
  depth: number;
  restart(depth: number): Promise<void>;
  /** Gives the keyboard back to the game. */
  focus(): void;
}

/** The dummy: an inert jelly that never dies. */
export const DUMMY = "Character/NPC/Monster/Slime/Jelly/Jelly Cube/Jelly Cube 1";
/** Animation files that are not animations (as the viewer's list leaves out). */
const NOT_ANIMATION = /(^|\/)(model|fx_|particle|ambient_|bullet_|bomb_|aoe_|meta_|compound_|conditional_|modelset)[^/]*\.dat$/;
const MONSTER = /^Character\/NPC\/Monster\//;
const SKIP_MONSTER = /\/Parts\/|\/Dev\/|Test/;

export interface SpawnOptions {
  hold?: MonsterHold;
  undying?: boolean;
  /** How many (1 to 12), in an arc in front of the knight, `dist` units out. */
  count?: number;
  dist?: number;
  /** Counted among the pens' monsters (false for the dummy). */
  pen?: boolean;
}

type El = HTMLElement;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { cls?: string } = {}, ...kids: (El | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  const { cls, ...rest } = props as any;
  if (cls) e.className = cls;
  Object.assign(e, rest);
  for (const k of kids) e.append(k);
  return e;
}
const options = (sel: HTMLSelectElement, list: [string, string][]) => sel.replaceChildren(...list.map(([v, t]) => new Option(t, v)));
const shortName = (n: string) => n.replace(/^Character\/NPC\/Monster\//, "").replace(/^Character\/NPC\//, "");

export class TestRange {
  readonly root: HTMLDivElement;
  private world: World | null = null;
  private tab = "arsenal";
  private readonly panes = new Map<string, HTMLDivElement>();
  private loadout: Loadout = { weapons: ["Weapon/Sword/Proto Sword"], shield: "", armor: "", helmet: "", trinkets: [], vitapod: "" };
  /** Every hit seen since the range started (or was cleared), newest last. */
  readonly hits: HitRecord[] = [];
  private lastAttack = new Map<Knight | Monster, { def: AttackDef; t: number }>();
  private pendingStatus = new Map<Knight | Monster, StatusRoll[]>();
  dummy: Monster | null = null;
  private dummyAt: [number, number] | null = null;
  readonly penned: Monster[] = [];
  /** Blocks placed with placeBlock (the sweep breaks them). */
  readonly blocks: Prop[] = [];
  private puppet: Puppet | null = null;
  private puppetClip: AnimationClip | null = null;
  private readonly readout: HTMLPreElement;
  private readonly knightTable: HTMLTableElement;
  private refreshTimer = 0;
  /** Fills the pens' family, species and tier lists (once the world's configs are loaded). */
  private fillPens: () => void = () => {};

  constructor(private readonly host: RangeHost, stage: HTMLElement) {
    this.root = el("div", { cls: "test-range" });
    const tabs = el("div", { cls: "tr-tabs" });
    for (const [id, label] of [["arsenal", "Arsenal"], ["dummy", "Dummy"], ["pens", "Pens"], ["anim", "Animations"]] as const) {
      const b = el("button", { textContent: label });
      b.dataset.tab = id;
      b.onclick = () => this.show(id);
      tabs.append(b);
    }
    const close = el("button", { textContent: "Hide", title: "Hide the panel (the Test Range button brings it back)", cls: "tr-close" });
    close.onclick = () => this.hide();
    tabs.append(close);
    this.readout = el("pre", { cls: "tr-readout", textContent: "Hit the dummy (Dummy tab) to see a readout." });
    this.knightTable = el("table", { cls: "tr-table" });
    this.root.append(el("div", { cls: "tr-head" }, el("strong", { textContent: "Test Range" }), this.depthControl()), tabs);
    for (const id of ["arsenal", "dummy", "pens", "anim"]) {
      const p = el("div", { cls: "tr-pane" });
      this.panes.set(id, p);
      this.root.append(p);
    }
    this.root.append(this.readout);
    stage.append(this.root);
    this.buildDummy();
    this.buildPens();
    this.show("arsenal");
    if (import.meta.env.DEV) (window as any).__range = this.api();
  }

  // ---------------------------------------------------------------- lifecycle

  /** A new world in the range (play started): the probe, the loadout, the lists. */
  async attach(world: World) {
    this.world = world;
    this.hits.length = 0;
    this.lastAttack.clear();
    this.pendingStatus.clear();
    this.dummy = null;
    this.penned.length = 0;
    this.puppet = null;
    world.knight.undying = (this.panes.get("pens")!.querySelector("#trKnightUndying") as HTMLInputElement | null)?.checked ?? true;
    world.probe = {
      attack: (who, def) => this.lastAttack.set(who, { def, t: world.time }),
      status: (target, roll) => { const l = this.pendingStatus.get(target) ?? []; l.push(roll); this.pendingStatus.set(target, l); },
      hitMonster: (m, hit) => this.record(this.world!.knight, m, hit),
      hitKnight: (hit, from) => this.record(this.attackerNear(from), this.world!.knight, hit),
    };
    await world.equip(this.loadout).catch(e => console.warn("test range: equip failed", e));
    this.buildArsenal();
    this.buildAnimations();
    this.fillPens();
    this.root.hidden = false;
    clearInterval(this.refreshTimer);
    this.refreshTimer = window.setInterval(() => this.tick(), 250);
  }

  detach() {
    if (this.world) this.world.probe = null;
    this.world = null;
    clearInterval(this.refreshTimer);
  }

  hide() { this.root.hidden = true; this.host.focus(); }
  showPanel() { this.root.hidden = false; }

  private show(id: string) {
    this.tab = id;
    for (const [k, p] of this.panes) p.hidden = k !== id;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>(".tr-tabs button[data-tab]")) b.classList.toggle("active", b.dataset.tab === id);
  }

  private depthControl(): El {
    const input = el("input", { type: "number", min: "1", max: "50", value: String(this.host.depth), title: "Depth: scales damage, health and defence" });
    input.style.width = "4em";
    const go = el("button", { textContent: "Set" });
    go.onclick = () => { const d = Math.max(1, Math.min(50, Math.round(Number(input.value) || 1))); void this.host.restart(d); };
    return el("label", { cls: "tr-depth" }, "Depth ", input, go);
  }

  /** Keeps the dummy where it was put and the tables current. */
  private tick() {
    const w = this.world;
    if (!w) return;
    const d = this.dummy;
    const pinned = (this.root.querySelector("#trPin") as HTMLInputElement | null)?.checked;
    // (once its knockback has played out, so the push can be seen)
    if (d && this.dummyAt && pinned && w.monsters.includes(d) && !d.impulse && !d.attack) { d.x = this.dummyAt[0]; d.y = this.dummyAt[1]; }
    if (this.tab === "pens") this.renderKnightTable();
    if (this.tab === "anim") this.renderFrame();
  }

  // ---------------------------------------------------------------- hits

  /** The monster nearest a hit's source point that attacked lately (who struck the knight). */
  private attackerNear(from: { x: number; y: number }): Monster | null {
    const w = this.world!;
    let best: Monster | null = null, bd = Infinity;
    for (const m of w.monsters) {
      const la = this.lastAttack.get(m);
      if (!la || w.time - la.t > 6) continue;
      const d = Math.hypot(m.x - from.x, m.y - from.y);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  private record(from: Knight | Monster | null, to: Knight | Monster, hit: ProbeHit) {
    const w = this.world!;
    const name = (a: Knight | Monster | null) => (a instanceof Knight ? "knight" : a ? shortName(a.entity?.name ?? a.def.name) : "?");
    const def = hit.attack ?? (from ? this.lastAttack.get(from)?.def ?? null : null);
    const weapon = from instanceof Knight ? from.weapon : null;
    const charged = !!def && !!weapon && def === weapon.chargedAttack;
    const statuses = this.pendingStatus.get(to) ?? [];
    this.pendingStatus.delete(to);
    const rec: HitRecord = {
      t: w.time, from: name(from), to: name(to), attack: def?.name ?? null, amounts: hit.amounts, dealt: hit.dealt,
      knock: hit.knock?.distance ?? 0, knockMs: hit.knock?.duration ?? 0, knockLevel: hit.knock?.level ?? 0, moved: hit.moved,
      reacted: hit.reacted, knockdown: hit.knockdown, shielded: hit.shielded, killed: hit.killed, statuses,
      timing: def ? attackTiming(def) : null, charged, chargeTime: charged ? weapon!.chargeTime : undefined,
    };
    this.hits.push(rec);
    if (this.hits.length > 2000) this.hits.splice(0, this.hits.length - 2000);
    if (to === this.dummy || from instanceof Knight) this.showHit(rec);
  }

  private showHit(h: HitRecord) {
    const recent = this.hits.filter(x => x.from === "knight").slice(-8);
    const s = summarize(recent);
    this.readout.textContent = [...hitLines(h), "", `last ${s.hits} hits: ${s.dealt} damage, biggest knockback ${s.maxKnock} u, ${s.reacted} interrupted` +
      (s.statuses.length ? `, statuses ${s.statuses.join(", ")}` : "")].join("\n");
  }

  clearHits() { this.hits.length = 0; this.readout.textContent = "Cleared."; }

  // ---------------------------------------------------------------- arsenal

  private buildArsenal() {
    const pane = this.panes.get("arsenal")!;
    const w = this.world;
    if (!w) return;
    const items = catalogue(w.data);
    const search = el("input", { type: "search", placeholder: "Search gear", spellcheck: false });
    const cls = el("select");
    options(cls, [["", "Every class"], ...CATEGORIES.filter(c => c.slot !== "vitapod").map(c => [c.id, c.label] as [string, string])]);
    const star = el("select");
    options(star, [["", "Any stars"], ...[0, 1, 2, 3, 4, 5].map(n => [String(n), `${n}★`] as [string, string])]);
    const list = el("ul", { cls: "list tr-list" });
    const count = el("div", { cls: "muted" });
    const worn = el("div", { cls: "tr-worn" });
    const render = () => {
      const q = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const hits = items.filter(i => i.category.slot !== "vitapod" && (!cls.value || i.category.id === cls.value) && (!star.value || i.rarity === Number(star.value))
        && q.every(t => i.label.toLowerCase().includes(t) || i.name.toLowerCase().includes(t)));
      list.replaceChildren(...hits.slice(0, 300).map(i => {
        const li = el("li", { textContent: `${"★".repeat(i.rarity)} ${i.label}`, title: `${i.name}\nClick: equip. Shift+click (weapons): add as another slot.` });
        li.classList.toggle("active", this.isWorn(i));
        li.onclick = e => void this.equipItem(i, e.shiftKey).then(render);
        return li;
      }));
      count.textContent = hits.length > 300 ? `Showing 300 of ${hits.length}` : `${hits.length} items`;
      const l = this.loadout;
      worn.textContent = `Weapons: ${l.weapons.map(n => n.split("/").pop()).join(", ") || "-"} · Shield: ${l.shield.split("/").pop() || "Proto"} · ` +
        `Armor: ${l.armor.split("/").pop() || "default"} · Helmet: ${l.helmet.split("/").pop() || "default"} · Trinkets: ${l.trinkets.map(n => n.split("/").pop()).join(", ") || "-"}`;
    };
    search.oninput = render; cls.onchange = render; star.onchange = render;
    pane.replaceChildren(el("div", { cls: "tr-row" }, search, cls, star), count, list, worn);
    render();
  }

  private isWorn(i: ItemEntry): boolean {
    const l = this.loadout;
    return l.weapons.includes(i.name) || l.shield === i.name || l.armor === i.name || l.helmet === i.name || l.trinkets.includes(i.name);
  }

  /** Puts an item on the knight at once (no ownership or rank checks). */
  async equipItem(i: ItemEntry | string, add = false) {
    const w = this.world;
    if (!w) return;
    const entry = typeof i === "string" ? catalogue(w.data).find(x => x.name === i) ?? null : i;
    const name = typeof i === "string" ? i : i.name;
    const slot = entry?.category.slot ?? (name.startsWith("Weapon/") ? "weapon" : null);
    const l = { ...this.loadout, weapons: [...this.loadout.weapons], trinkets: [...this.loadout.trinkets] };
    if (slot === "weapon") l.weapons = add ? [...l.weapons.filter(n => n !== name), name].slice(-3) : [name];
    else if (slot === "shield") l.shield = name;
    else if (slot === "armor") l.armor = name;
    else if (slot === "helmet") l.helmet = name;
    else if (slot === "trinket") l.trinkets = l.trinkets.includes(name) ? l.trinkets.filter(n => n !== name) : [...l.trinkets, name].slice(-2);
    else return;
    this.loadout = l;
    await w.equip(l);
  }

  // ---------------------------------------------------------------- dummy

  private monsterNames(): string[] {
    const w = this.world;
    return w ? [...w.data.library_("config/actor.dat").keys()].filter(n => MONSTER.test(n) && !SKIP_MONSTER.test(n)).sort() : [];
  }

  private buildDummy() {
    const pane = this.panes.get("dummy")!;
    const who = el("input", { value: DUMMY, spellcheck: false, title: "The monster that stands as the dummy (frozen and undying)" });
    who.style.width = "100%";
    const dist = el("select");
    options(dist, [["1.6", "1.6 u (sword)"], ["3.5", "3.5 u (gun)"], ["6", "6 u (long)"], ["1", "1 u (bomb)"]]);
    const place = el("button", { textContent: "Place dummy", cls: "primary" });
    place.onclick = () => void this.placeDummy(who.value.trim() || DUMMY, Number(dist.value));
    const pin = el("label", { cls: "toggle" }, el("input", { type: "checkbox", id: "trPin", checked: true }), " Keep it in place after knockback");
    const clear = el("button", { textContent: "Clear log" });
    clear.onclick = () => this.clearHits();
    pane.replaceChildren(el("p", { cls: "muted", textContent: "An invulnerable target: a real monster frozen in place with endless health. Each hit's damage, type split, status rolls, knockback, interrupt and the attack's timing show below." }),
      who, el("div", { cls: "tr-row" }, dist, place, clear), pin);
  }

  /** Puts the dummy in front of the knight (making it when there is none). */
  async placeDummy(name = DUMMY, dist = 1.6): Promise<Monster | null> {
    const w = this.world;
    if (!w) return null;
    const k = w.knight;
    if (!this.dummy || !w.monsters.includes(this.dummy) || (this.dummy.entity?.name ?? "") !== name) {
      if (this.dummy) this.remove(this.dummy);
      const [m] = await this.spawn(name, { hold: "frozen", undying: true, dist, count: 1, pen: false });
      this.dummy = m ?? null;
    }
    const d = this.dummy;
    if (!d) return null;
    d.hold = "frozen"; d.undying = true; d.attack = null; d.reacting = 0; d.statuses.length = 0; d.impulse = null;
    d.x = k.x + Math.cos(k.heading) * dist; d.y = k.y + Math.sin(k.heading) * dist; d.z = w.collisionMap.groundZ(d.x, d.y);
    d.heading = k.heading + Math.PI;
    this.dummyAt = [d.x, d.y];
    return d;
  }

  // ---------------------------------------------------------------- pens

  private buildPens() {
    const pane = this.panes.get("pens")!;
    const fam = el("select"), species = el("select"), tier = el("select");
    const table = el("select");
    const count = el("input", { type: "number", min: "1", max: "12", value: "1", title: "How many" });
    count.style.width = "4em";
    const hold = el("select");
    options(hold, [["frozen", "Frozen (AI off)"], ["passive", "Passive (moves, never attacks)"], ["live", "Live"]]);
    const undying = el("label", { cls: "toggle" }, el("input", { type: "checkbox", id: "trMonUndying" }), " Undying");
    const kUndying = el("label", { cls: "toggle" }, el("input", { type: "checkbox", id: "trKnightUndying", checked: true }), " Knight cannot fall");
    (kUndying.firstChild as HTMLInputElement).onchange = e => { if (this.world) this.world.knight.undying = (e.target as HTMLInputElement).checked; };
    const spawn = el("button", { textContent: "Spawn", cls: "primary" });
    const spawnTable = el("button", { textContent: "Spawn from table" });
    const clear = el("button", { textContent: "Clear pens" });
    const kill = el("button", { textContent: "Kill all" });
    const revive = el("button", { textContent: "Revive knight" });
    const attacks = el("div", { cls: "tr-row tr-attacks" });
    let tree: ReturnType<typeof monsterTree> | null = null;
    const fill = () => {
      if (!this.world) return;
      tree ??= monsterTree(this.monsterNames());
      if (!fam.options.length) options(fam, [...tree.keys()].map(k => [k, k] as [string, string]));
      const sp = tree.get(fam.value);
      const keepS = species.value;
      options(species, [...(sp?.keys() ?? [])].map(k => [k, k] as [string, string]));
      if (sp?.has(keepS)) species.value = keepS;
      const tiers = sp?.get(species.value) ?? [];
      options(tier, tiers.map(t => [t.name, t.tier || "-"] as [string, string]));
      if (!table.options.length) {
        const tables = [...this.world.data.library_("config/spawn_table.dat").keys()].filter(n => /^Monster\//.test(n) && !/\/Parts\//.test(n)).sort();
        options(table, tables.map(n => [n, n.replace(/^Monster\//, "")] as [string, string]));
      }
    };
    fam.onchange = fill; species.onchange = fill;
    this.fillPens = fill;
    const opts = () => ({ hold: hold.value as MonsterHold, undying: (undying.firstChild as HTMLInputElement).checked, count: Number(count.value) || 1, dist: 5 });
    const after = (ms: Monster[]) => {
      attacks.replaceChildren(...(ms[0]?.def.slots ?? []).map((a, i) => {
        if (!a) return el("span");
        const b = el("button", { textContent: `${i + 1}. ${a.name}`, title: `Make the pen's monsters start this attack now\n${timingText(attackTiming(a))}` });
        b.onclick = () => { for (const m of this.penned) if (this.world?.monsters.includes(m)) this.world.monsterAttack(m, m.def.slots[i] ?? a); };
        return b;
      }));
    };
    spawn.onclick = () => { fill(); if (tier.value) void this.spawn(tier.value, opts()).then(after); };
    spawnTable.onclick = () => {
      fill();
      const w = this.world;
      const t = Number(tier.selectedOptions[0]?.textContent) || 1;
      const ref = w && table.value ? w.data.spawnActorSync({ name: table.value }, Math.max(1, Math.min(3, t))) : null;
      if (ref?.name) void this.spawn(ref.name, opts()).then(after);
    };
    clear.onclick = () => { for (const m of [...this.penned]) this.remove(m); this.penned.length = 0; attacks.replaceChildren(); };
    kill.onclick = () => { for (const m of this.penned) { m.undying = false; this.kill(m); } };
    revive.onclick = () => { this.world?.revive(); this.host.focus(); };
    hold.onchange = () => { for (const m of this.penned) m.hold = hold.value as MonsterHold; };
    pane.replaceChildren(
      el("div", { cls: "tr-row" }, fam, species, tier),
      el("div", { cls: "tr-row" }, el("span", { textContent: "or table" }), table),
      el("div", { cls: "tr-row" }, count, hold, undying),
      el("div", { cls: "tr-row" }, spawn, spawnTable, clear, kill),
      el("div", { cls: "tr-row" }, kUndying, revive),
      el("div", { cls: "muted", textContent: "Attacks of the last spawned (click to make them attack):" }), attacks,
      el("div", { cls: "muted", textContent: "What the monsters dealt to the knight, per attack:" }), this.knightTable);
  }

  /**
   * Spawns `count` of a monster in a ring in front of the knight, through the level logic as
   * a spawner would, and resolves once they have loaded (or after 20 s).
   */
  async spawn(name: string, o: SpawnOptions = {}): Promise<Monster[]> {
    const w = this.world;
    if (!w) return [];
    const k = w.knight, n = Math.max(1, Math.min(12, o.count ?? 1)), dist = o.dist ?? 5;
    const ents: NonNullable<Monster["entity"]>[] = [];
    for (let i = 0; i < n; i++) {
      const a = k.heading + (n === 1 ? 0 : (i / n - 0.5) * Math.PI * 0.9);
      const x = k.x + Math.cos(a) * dist, y = k.y + Math.sin(a) * dist;
      const spot = w.collisionMap.findSpawn(x, y, 0.6, 1 | 2 | 8 | 32) ?? [x, y];
      const e = w.logic.spawn({ name }, spot[0], spot[1], a + Math.PI, w.knightEntity, w.knightEntity);
      if (e) ents.push(e);
    }
    const t0 = performance.now();
    let found: Monster[] = [];
    while (performance.now() - t0 < 20000) {
      found = w.monsters.filter(m => m.entity && ents.includes(m.entity));
      if (found.length === ents.length || ents.every(e => e.destroyed || found.some(m => m.entity === e))) break;
      await new Promise(r => setTimeout(r, 100));
    }
    for (const m of found) { m.hold = o.hold ?? "live"; m.undying = !!o.undying; }
    if (o.pen !== false) this.penned.push(...found);
    return found;
  }

  /**
   * Places a block actor (config/actor.dat Block/..., spawned as its placeable's Startup
   * spawns it) `dist` ahead of the knight, and resolves once its model shows (or after 10 s).
   */
  async placeBlock(name: string, dist = 1.5, args?: [string, unknown][]): Promise<Prop | null> {
    const w = this.world;
    if (!w) return null;
    const k = w.knight;
    const x = k.x + Math.cos(k.heading) * dist, y = k.y + Math.sin(k.heading) * dist;
    const ref = args ? { $class: "com.threerings.config.ConfigReference", name, arguments: { $map: "com.threerings.config.ArgumentMap", entries: args } } : { name };
    const e = w.logic.spawn(ref, x, y, 0, w.knightEntity, w.knightEntity);
    const p = e ? w.props.find(q => q.entity === e) ?? null : null;
    if (!p) return null;
    this.blocks.push(p);
    const t0 = performance.now();
    while (!p.instance && w.props.includes(p) && performance.now() - t0 < 10000) await new Promise(r => setTimeout(r, 100));
    return p;
  }

  /** Takes the placed blocks away (faded, not broken). */
  clearBlocks() {
    for (const p of this.blocks.splice(0)) if (this.world?.props.includes(p)) this.world.vanishProp(p, false);
  }

  /** Takes a monster off the field without its death (no loot, no effects). */
  remove(m: Monster) {
    const w = this.world;
    if (!w) return;
    const i = w.monsters.indexOf(m);
    if (i >= 0) w.monsters.splice(i, 1);
    if (m.entity) w.logic.vanish(m.entity);
    const j = this.penned.indexOf(m);
    if (j >= 0) this.penned.splice(j, 1);
    if (m === this.dummy) this.dummy = null;
  }

  /** A killing blow, through the world's own damage (death animation, effects, loot). */
  kill(m: Monster) {
    const w = this.world as any;
    if (!w || m.state === "dying") return;
    m.undying = false;
    w.damageMonster(m, { NORMAL: 1e9, PIERCING: 0, ELEMENTAL: 0, SHADOW: 0 }, 0, w.knight.x, w.knight.y);
  }

  /** Strikes a monster with plain damage (a share of its health) from the knight's side. */
  strike(m: Monster, share = 0.5, knock = 1) {
    const w = this.world as any;
    if (!w) return;
    w.damageMonster(m, { NORMAL: Math.max(1, m.maxHealth * share), PIERCING: 0, ELEMENTAL: 0, SHADOW: 0 }, knock, w.knight.x, w.knight.y);
  }

  private renderKnightTable() {
    const rows = new Map<string, HitRecord[]>();
    for (const h of this.hits) if (h.to === "knight") {
      const k = `${h.from} · ${h.attack ?? "?"}`;
      const l = rows.get(k) ?? [];
      l.push(h);
      rows.set(k, l);
    }
    const head = el("tr", {}, ...["Monster · attack", "Hits", "Last", "Split", "Knock", "Status", "Timing"].map(t => el("th", { textContent: t })));
    this.knightTable.replaceChildren(head, ...[...rows].map(([k, l]) => {
      const last = l[l.length - 1];
      return el("tr", {}, ...[k, String(l.length), `${last.dealt}${last.shielded ? " (shield)" : ""}${last.knockdown ? " KD" : ""}`, damageSplit(last.amounts),
        `${last.knock.toFixed(1)}`, last.statuses.map(statusText).join("; ") || "-", timingText(last.timing)].map(t => el("td", { textContent: t })));
    }));
  }

  // ---------------------------------------------------------------- animation browser

  private buildAnimations() {
    const pane = this.panes.get("anim")!;
    const w = this.world;
    if (!w) return;
    const subjects = ["Knight", ...[...w.data.library_("config/actor.dat").keys()].filter(n => /^Character\/NPC\//.test(n) && !SKIP_MONSTER.test(n)).sort()];
    const search = el("input", { type: "search", placeholder: "Search monsters and NPCs", spellcheck: false });
    const who = el("select");
    const fillWho = () => {
      const q = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      options(who, subjects.filter(s => q.every(t => s.toLowerCase().includes(t))).slice(0, 200).map(s => [s, shortName(s)] as [string, string]));
    };
    search.oninput = fillWho;
    fillWho();
    const load = el("button", { textContent: "Load", cls: "primary" });
    const anims = el("ul", { cls: "list tr-list" });
    const loop = el("label", { cls: "toggle" }, el("input", { type: "checkbox", checked: true }), " Loop");
    const speed = el("input", { type: "range", min: "0.05", max: "2", step: "0.05", value: "1", title: "Play speed" });
    const speedText = el("span", { textContent: "1.00x" });
    const pause = el("button", { textContent: "Pause" });
    const back = el("button", { textContent: "◀ Frame" });
    const step = el("button", { textContent: "Frame ▶" });
    const clear = el("button", { textContent: "Remove" });
    const frame = el("div", { cls: "muted", id: "trFrame" });
    let playing = true;
    const loopBox = loop.firstChild as HTMLInputElement;
    speed.oninput = () => { speedText.textContent = `${Number(speed.value).toFixed(2)}x`; if (this.puppet && playing) this.puppet.rate = Number(speed.value); };
    pause.onclick = () => { playing = !playing; pause.textContent = playing ? "Pause" : "Play"; if (this.puppet) this.puppet.rate = playing ? Number(speed.value) : 0; };
    const stepBy = (n: number) => {
      const p = this.puppet, c = this.puppetClip;
      if (!p || !c) return;
      playing = false; pause.textContent = "Play"; p.rate = 0;
      const len = Math.max(1, c.frames.length - 1) / c.rate;
      p.instance.time = Math.max(0, p.instance.time + n / c.rate);
      if (c.loop && p.instance.time > len) p.instance.time -= len;
    };
    back.onclick = () => stepBy(-1);
    step.onclick = () => stepBy(1);
    clear.onclick = () => this.removePuppet();
    load.onclick = () => void this.loadPuppet(who.value).then(list => {
      anims.replaceChildren(...list.map(([label, ref]) => {
        const li = el("li", { textContent: label, title: typeof ref === "string" ? ref : ref?.name ?? "" });
        li.onclick = () => {
          for (const x of anims.children) x.classList.toggle("active", x === li);
          void this.playPuppet(ref, loopBox.checked, playing ? Number(speed.value) : 0);
        };
        return li;
      }));
    });
    pane.replaceChildren(el("p", { cls: "muted", textContent: "Puts a model beside the knight and plays any of its animations, with their sounds and effects." }),
      search, el("div", { cls: "tr-row" }, who, load, clear), el("div", { cls: "tr-row" }, loop, speed, speedText),
      el("div", { cls: "tr-row" }, pause, back, step), frame, anims);
  }

  /** Puts a subject's model beside the knight; returns its animations (label, reference). */
  async loadPuppet(subject: string): Promise<[string, any][]> {
    const w = this.world;
    if (!w) return [];
    this.removePuppet();
    let model: LoadedModel | null = null, scale = 1;
    if (subject === "Knight") model = w.knight.instance.model;
    else {
      const def = MONSTER.test(subject) ? await w.data.monster({ name: subject }).catch(() => null) : null;
      if (def) { model = await this.host.loader.loadRef(def.model).catch(() => null); scale = def.scale; }
      else {
        const cfg = w.data.resolveSync("config/actor.dat", { name: subject }, "actor");
        const ref = cfg?.sprite?.model ?? cfg?.model;
        if (ref) { model = await this.host.loader.loadRef(ref).catch(() => null); scale = cfg?.sprite?.scale ?? 1; }
      }
    }
    if (!model) return [];
    const inst = await this.host.renderer.instantiate(model);
    const k = w.knight, x = k.x + Math.cos(k.heading) * 3, y = k.y + Math.sin(k.heading) * 3;
    this.puppet = { instance: inst, x, y, z: w.collisionMap.groundZ(x, y), heading: k.heading + Math.PI, scale, rate: 1 };
    w.puppets.push(this.puppet);
    const named = Object.entries(model.animations ?? {}).map(([k2, v]) => [`${k2}`, v] as [string, any]);
    const dir = subject === "Knight" ? "character/pc/" : model.path.substring(0, model.path.lastIndexOf("/") + 1);
    const files = this.host.datFiles.filter(f => f.startsWith(dir) && f !== model!.path && !NOT_ANIMATION.test(f))
      .map(f => [f.substring(dir.length), f] as [string, any]);
    return [...named, ...files];
  }

  async playPuppet(ref: any, loop = true, rate = 1): Promise<boolean> {
    const p = this.puppet;
    if (!p) return false;
    const clip = await loadAnimation(this.host.loader, ref).catch(() => null);
    if (!clip || this.puppet !== p) return false;
    this.puppetClip = clip;
    p.instance.play(clip, { loop, blend: 0 });
    p.rate = rate;
    return true;
  }

  removePuppet() {
    const w = this.world, p = this.puppet;
    if (w && p) { const i = w.puppets.indexOf(p); if (i >= 0) w.puppets.splice(i, 1); }
    this.puppet = null;
    this.puppetClip = null;
  }

  private renderFrame() {
    const f = this.root.querySelector("#trFrame");
    const p = this.puppet, c = this.puppetClip;
    if (!f) return;
    if (!p || !c) { f.textContent = p ? "Bind pose" : "No model loaded."; return; }
    const n = Math.max(1, c.frames.length);
    const at = p.instance.time * p.instance.speed * c.rate;
    f.textContent = `${c.path.split("/").pop()} · frame ${Math.min(n - 1, Math.floor(c.loop ? at % n : at))} / ${n - 1} · ${c.rate} fps · ${c.actions.length} frame actions`;
  }

  // ---------------------------------------------------------------- the sweep's handle

  /** window.__range (development builds): what tools/audit/sweep.ts drives. */
  private api() {
    return {
      range: this,
      get ready() { return !!this.range.world; },
      world: () => this.world,
      equip: (gear: string | Partial<Loadout>) => {
        if (typeof gear === "string") return this.equipItem(gear);
        this.loadout = { ...this.loadout, ...gear, weapons: gear.weapons ?? this.loadout.weapons, trinkets: gear.trinkets ?? this.loadout.trinkets };
        return this.world?.equip(this.loadout);
      },
      weapons: () => (this.world ? catalogue(this.world.data).filter(i => i.category.slot === "weapon").map(i => i.name) : []),
      monsters: () => this.monsterNames(),
      placeDummy: (name?: string, dist?: number) => this.placeDummy(name, dist),
      spawn: (name: string, o?: SpawnOptions) => this.spawn(name, o),
      remove: (m: Monster) => this.remove(m),
      kill: (m: Monster) => this.kill(m),
      strike: (m: Monster, share?: number, knock?: number) => this.strike(m, share, knock),
      placeBlock: (name: string, dist?: number, args?: [string, unknown][]) => this.placeBlock(name, dist, args),
      clearAll: () => { for (const m of [...this.penned]) this.remove(m); if (this.dummy) this.remove(this.dummy); this.removePuppet(); this.clearBlocks(); },
      hits: () => this.hits,
      clearHits: () => this.clearHits(),
      attackTiming,
    };
  }
}
