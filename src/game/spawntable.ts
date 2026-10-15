// Spawn tables (config/spawn_table.dat, SpawnTableConfig): what a spawner, loot drop or
// treasure box produces. A table is a tree of entries: weighted and simple random picks,
// optional entries with a probability, compounds, choices by depth, tier and difficulty,
// repeated tables, valued drops (crowns and heat, paid out in coin actors), and items.
// The semantics are read off the data; the game's own evaluator is closed code.

import { applyArguments } from "../config/params";
import type { Difficulty } from "./depth";
import { rewardScale } from "./difficulty";
import { vitapodBetter, vitapodPips } from "./droprates";

const kind = (o: any) => { const c: string = o?.$class ?? ""; return c.substring(c.lastIndexOf("$") + 1); };

export interface SpawnContext {
  depth: number; tier: number; difficulty: Difficulty;
  /** Tags of the source (the dropping monster's family, fam_slime): tag-gated drops and materials. */
  tags?: string[];
  /**
   * The vitapod the knight holds, in capsules (pips): an "Always Better" table gives its
   * fallback for a pod no better (the wiki's Vitapod page: such pods "don't drop").
   */
  pod?: number;
  /**
   * A weight for a pick among mineral nodes on this floor (the wiki's Minerals page: a stratum's
   * theme favours some colours), by the picked entry's actor or table name; even when unset.
   */
  pickWeight?: (name: string) => number;
}
export interface SpawnResult { actor?: any; item?: any; count: number }

/** Item lookups for item drops (AutoItem tables and rarity lists), from the economy. */
export interface ItemHooks {
  /** An item of an AutoSpawnType picked by depth weight, or null for the failsafe. */
  autoItem(type: string, depthWeight: string, ctx: SpawnContext): string | null;
  rarity(item: string): number;
  depthWeight(table: string, rarity: number, depth: number): number;
}

export class SpawnTables {
  /** Coin and ember actors and the value each is worth (from the valued tables). */
  private coins: Map<string, number> | null = null;

  constructor(private readonly lib: Map<string, any>, private readonly items: ItemHooks | null = null) {}

  /** Evaluates a spawn table reference. */
  evaluate(ref: any, ctx: SpawnContext, depth = 0): SpawnResult[] {
    const cfg = this.resolve(ref, depth);
    if (!cfg) return [];
    if (kind(cfg) === "AutoItem") return this.autoItem(cfg, ctx, depth);
    if (kind(cfg) === "AlwaysBetterDungeonItem") return this.alwaysBetter(cfg, ctx, depth);
    return this.entry(cfg.root, ctx, depth + 1);
  }

  /**
   * SpawnTableConfig$AlwaysBetterDungeonItem (the vitapod tables): the pod the depth gives when
   * it beats the one held, else the fallback table (hearts or pickups).
   */
  private alwaysBetter(cfg: any, ctx: SpawnContext, depth: number): SpawnResult[] {
    const got = this.entry(cfg.root, ctx, depth + 1);
    const pips = got.reduce((m, r) => Math.max(m, r.item?.name ? vitapodPips(String(r.item.name)) : 0), 0);
    if (got.length && (!pips || vitapodBetter(pips, ctx.pod ?? 0))) return got;
    return cfg.fallback ? this.evaluate(cfg.fallback, ctx, depth + 1) : [];
  }

  /**
   * The crowns or heat a coin or ember actor is worth (Copper Crown 1 ... Gold Crown 50,
   * Ember 1 ... Ember 5 at 50), read off the valued tables' denominations; 0 otherwise.
   */
  coinValue(actor: string): number {
    if (!this.coins) {
      this.coins = new Map();
      for (const cfg of this.lib.values()) {
        const root = cfg?.root;
        if (kind(root) !== "ValueDepthListEntry") continue;
        for (const a of root.actorEntries ?? []) if (a?.entry?.actor?.name) this.coins.set(a.entry.actor.name, a.value ?? 1);
      }
    }
    return this.coins.get(actor) ?? 0;
  }

  /** SpawnTableConfig$AutoItem: an item of its type by depth weight, else its failsafe table. */
  private autoItem(cfg: any, ctx: SpawnContext, depth: number): SpawnResult[] {
    const type = String(cfg.type?.name ?? cfg.type ?? "MATERIAL").split(".").pop()!;
    const name = this.items?.autoItem(type, cfg.depthWeight?.name ?? "Materials", ctx) ?? null;
    if (name) return [{ item: { name }, count: 1 }];
    return cfg.failsafeTable ? this.evaluate(cfg.failsafeTable, ctx, depth + 1) : [];
  }

  private resolve(ref: any, depth: number): any | null {
    if (!ref?.name || depth > 16) return null;
    const base = this.lib.get(ref.name);
    if (!base) return null;
    const cfg = applyArguments(base, ref);
    if (cfg.$class?.endsWith("DerivedConfig")) return this.resolve(cfg.base, depth + 1);
    return cfg;
  }

  private entry(e: any, ctx: SpawnContext, depth: number): SpawnResult[] {
    if (!e || depth > 24) return [];
    const sub = (x: any) => this.entry(x, ctx, depth + 1);
    // parameters fill fields of default entries the export left out, which carry no class
    const k = e.$class ? kind(e) : e.actor ? "ActorEntry" : e.spawnTable ? "TableEntry" : e.item ? "ItemEntry" : "";
    switch (k) {
      case "TableEntry": return this.evaluate(e.spawnTable, ctx, depth + 1);
      case "ActorEntry": return e.actor?.name ? [{ actor: e.actor, count: 1 }] : [];
      case "WeightedEntry": case "DepthEntry": case "MissionEntry": case "MultiplyEntry": case "MultiplyByVariableEntry":
        return sub(e.entry);
      case "RandomEntry": {
        const list: any[] = e.entries ?? [];
        const total = list.reduce((s, w) => s + (w?.weight ?? 1), 0);
        let r = Math.random() * total;
        for (const w of list) { r -= w?.weight ?? 1; if (r < 0) return sub(w); }
        return list.length ? sub(list[list.length - 1]) : [];
      }
      case "SimpleRandomEntry": case "SpawnTypeListEntry": {
        const list: any[] = e.entries ?? [];
        if (!list.length) return e.spawnTable ? this.evaluate(e.spawnTable, ctx, depth + 1) : [];
        // an even pick, unless the floor weights the choices (mineral colours by stratum theme)
        const ws = ctx.pickWeight ? list.map(x => Math.max(0, ctx.pickWeight!(String(x?.actor?.name ?? x?.spawnTable?.name ?? "")))) : null;
        const total = ws ? ws.reduce((a, b) => a + b, 0) : 0;
        if (!ws || total <= 0) return sub(list[Math.floor(Math.random() * list.length)]);
        let r = Math.random() * total;
        for (let i = 0; i < list.length; i++) { r -= ws[i]; if (r < 0) return sub(list[i]); }
        return sub(list[list.length - 1]);
      }
      // (modifyForDifficulty: the chance times the difficulty's reward scale, OptionalEntry.a)
      case "OptionalEntry": return Math.random() < chance(e, ctx) ? sub(e.entry) : [];
      case "OptionalElseEntry": return Math.random() < chance(e, ctx) ? sub(e.entry) : sub(e.elseEntry);
      case "CompoundEntry": return ((e.entries ?? []) as any[]).flatMap(sub);
      case "FirstResultEntry": {
        for (const x of e.entries ?? []) { const r = sub(x); if (r.length) return r; }
        return [];
      }
      case "DepthListEntry": {
        // the deepest entry whose start depth the current depth has reached
        // (offset: a deeper pick, the Vitapod table's "Depth Offset")
        const list: any[] = e.entries ?? [], at = ctx.depth + (e.offset ?? 0);
        let pick: any = null;
        for (const x of list) if ((x?.depth ?? 0) <= at && (!pick || (x.depth ?? 0) >= (pick.depth ?? 0))) pick = x;
        // the offset carries down: what the pick holds is chosen at the offset depth too
        return at === ctx.depth ? sub(pick ?? list[0]) : this.entry(pick ?? list[0], { ...ctx, depth: at }, depth + 1);
      }
      case "TierSwitchEntry": return sub(e[`tier${ctx.tier}`] ?? e.tier1);
      case "DifficultySwitchEntry": return sub(e[ctx.difficulty] ?? e.medium);
      case "MultiTableEntry": {
        const out: SpawnResult[] = [];
        for (let i = 0; i < (e.count ?? 1); i++) out.push(...this.evaluate(e.spawnTable, ctx, depth + 1));
        return out;
      }
      // a locked entry's stack comes whole (the treasure tables' fire crystals: three Warm)
      case "LockedItemEntry": return e.item?.name ? [{ item: e.item, count: Math.max(1, Number(e.count ?? 1)) }] : [];
      case "ItemEntry": case "VariantItemEntry":
        return e.item?.name ? [{ item: e.item, count: 1 }] : [];
      case "MultiItemEntry": return e.item?.name ? [{ item: e.item, count: e.count ?? 1 }] : [];
      case "ItemRarityListEntry": {
        // items weighted by their star rating's depth weight (mineral deposits: bigger ones deeper)
        const items: any[] = (e.items ?? []).filter((x: any) => x?.ref?.name);
        const dw = e.depthWeight?.name;
        const ws = items.map(x => (dw && this.items ? this.items.depthWeight(dw, this.items.rarity(x.ref.name), ctx.depth) : 1));
        const total = ws.reduce((a, b) => a + b, 0);
        let r = Math.random() * (total || items.length);
        for (let i = 0; i < items.length; i++) { r -= total ? ws[i] : 1; if (r < 0) return [{ item: items[i].ref, count: 1 }]; }
        return items.length ? [{ item: items[items.length - 1].ref, count: 1 }] : [];
      }
      case "TagsRequiredEntry": {
        const need: string[] = ((e.tags?.tags ?? []) as any[]).filter(t => typeof t === "string");
        return need.every(t => ctx.tags?.includes(t)) ? sub(e.entry) : [];
      }
      case "ValueDepthListEntry": return this.valued(e, ctx);
      // events, tag-gated drops and automatic gear are not modelled
      default: return [];
    }
  }

  /**
   * A valued drop: a value is rolled from the depth table (the "Depth Entries" argument) and
   * paid out in the actor entries' denominations, largest first (copper to gold crowns).
   * The entries are points on a curve: the range is interpolated between the entries around
   * the depth, and starts over at each tier (a new entry the depth after a tier's last), so
   * crowns and heat grow through a tier and drop back as gear stars step up. Floor entries
   * multiply the value (treasure boxes pay double or triple).
   */
  private valued(e: any, ctx: SpawnContext): SpawnResult[] {
    const [lo, hi] = valueRange(e.entries ?? [], ctx.depth + (e.offset ?? 0));
    const floor: any = (e.floorEntries ?? [])[0];
    const mult = floor ? (floor.minValue ?? 1) + Math.random() * Math.max(0, (floor.maxValue ?? floor.minValue ?? 1) - (floor.minValue ?? 1)) : 1;
    // modifyForDifficulty: the range times the difficulty's reward scale (ValueDepthListEntry.b)
    const k = e.modifyForDifficulty ? rewardScale(ctx.difficulty) : 1;
    let value = Math.round((lo + Math.random() * (hi - lo)) * mult * k) + (e.valueOffset ?? 0);
    const coins = ((e.actorEntries ?? []) as any[]).filter(a => a?.entry?.actor?.name).sort((a, b) => (b.value ?? 1) - (a.value ?? 1));
    const out: SpawnResult[] = [];
    for (const c of coins) {
      const v = c.value ?? 1;
      while (value >= v && out.length < 12) { out.push({ actor: c.entry.actor, count: 1 }); value -= v; }
    }
    return out;
  }
}

/** An optional entry's chance, scaled by the difficulty's reward scale when the entry asks for it. */
const chance = (e: any, ctx: SpawnContext) => (e.probability ?? 0.5) * (e.modifyForDifficulty ? rewardScale(ctx.difficulty) : 1);

/** The [min, max] value of a ValueDepthEntry curve at a depth (linear between entries). */
export function valueRange(entries: any[], depth: number): [number, number] {
  const pts = entries.map(d => ({ depth: d?.depth ?? 0, min: d?.minValue ?? 0, max: d?.maxValue ?? d?.minValue ?? 0 }))
    .sort((a, b) => a.depth - b.depth);
  if (!pts.length) return [1, 1];
  let i = 0;
  while (i + 1 < pts.length && pts[i + 1].depth <= depth) i++;
  const a = pts[i], b = pts[i + 1];
  if (!b || depth <= a.depth) return [a.min, Math.max(a.min, a.max)];
  const t = (depth - a.depth) / (b.depth - a.depth);
  const min = a.min + (b.min - a.min) * t, max = a.max + (b.max - a.max) * t;
  return [min, Math.max(min, max)];
}
