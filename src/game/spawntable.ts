// Spawn tables (config/spawn_table.dat, SpawnTableConfig): what a spawner, loot drop or
// treasure box produces. A table is a tree of entries: weighted and simple random picks,
// optional entries with a probability, compounds, choices by depth, tier and difficulty,
// repeated tables, valued drops (crowns and heat, paid out in coin actors), and items.
// The semantics are read off the data; the game's own evaluator is closed code.

import { applyArguments } from "../config/params";
import type { Difficulty } from "./depth";

const kind = (o: any) => { const c: string = o?.$class ?? ""; return c.substring(c.lastIndexOf("$") + 1); };

export interface SpawnContext { depth: number; tier: number; difficulty: Difficulty }
export interface SpawnResult { actor?: any; item?: any; count: number }

export class SpawnTables {
  constructor(private readonly lib: Map<string, any>) {}

  /** Evaluates a spawn table reference. */
  evaluate(ref: any, ctx: SpawnContext, depth = 0): SpawnResult[] {
    const cfg = this.resolve(ref, depth);
    return cfg ? this.entry(cfg.root, ctx, depth + 1) : [];
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
        return list.length ? sub(list[Math.floor(Math.random() * list.length)]) : e.spawnTable ? this.evaluate(e.spawnTable, ctx, depth + 1) : [];
      }
      case "OptionalEntry": return Math.random() < (e.probability ?? 0.5) ? sub(e.entry) : [];
      case "OptionalElseEntry": return Math.random() < (e.probability ?? 0.5) ? sub(e.entry) : sub(e.elseEntry);
      case "CompoundEntry": return ((e.entries ?? []) as any[]).flatMap(sub);
      case "FirstResultEntry": {
        for (const x of e.entries ?? []) { const r = sub(x); if (r.length) return r; }
        return [];
      }
      case "DepthListEntry": {
        // the deepest entry whose start depth the current depth has reached
        const list: any[] = e.entries ?? [];
        let pick: any = null;
        for (const x of list) if ((x?.depth ?? 0) <= ctx.depth && (!pick || (x.depth ?? 0) >= (pick.depth ?? 0))) pick = x;
        return sub(pick ?? list[0]);
      }
      case "TierSwitchEntry": return sub(e[`tier${ctx.tier}`] ?? e.tier1);
      case "DifficultySwitchEntry": return sub(e[ctx.difficulty] ?? e.medium);
      case "MultiTableEntry": {
        const out: SpawnResult[] = [];
        for (let i = 0; i < (e.count ?? 1); i++) out.push(...this.evaluate(e.spawnTable, ctx, depth + 1));
        return out;
      }
      case "ItemEntry": case "LockedItemEntry": case "VariantItemEntry":
        return e.item?.name ? [{ item: e.item, count: 1 }] : [];
      case "MultiItemEntry": return e.item?.name ? [{ item: e.item, count: e.count ?? 1 }] : [];
      case "ItemRarityListEntry": {
        const items: any[] = e.items ?? [];
        const it = items[Math.floor(Math.random() * items.length)]?.ref;
        return it?.name ? [{ item: it, count: 1 }] : [];
      }
      case "ValueDepthListEntry": return this.valued(e, ctx);
      // events, tag-gated drops and automatic gear are not modelled
      default: return [];
    }
  }

  /**
   * A valued drop: a value is rolled from the depth table (the "Depth Entries" argument) and
   * paid out in the actor entries' denominations, largest first (copper to gold crowns).
   */
  private valued(e: any, ctx: SpawnContext): SpawnResult[] {
    const depthEntries: any[] = e.entries ?? [];
    let pick: any = null;
    for (const d of depthEntries) if ((d?.depth ?? 0) <= ctx.depth && (!pick || (d.depth ?? 0) >= (pick.depth ?? 0))) pick = d;
    const lo = pick?.minValue ?? 1, hi = Math.max(lo, pick?.maxValue ?? lo);
    let value = Math.round(lo + Math.random() * (hi - lo)) + (e.valueOffset ?? 0);
    const coins = ((e.actorEntries ?? []) as any[]).filter(a => a?.entry?.actor?.name).sort((a, b) => (b.value ?? 1) - (a.value ?? 1));
    const out: SpawnResult[] = [];
    for (const c of coins) {
      const v = c.value ?? 1;
      while (value >= v && out.length < 12) { out.push({ actor: c.entry.actor, count: 1 }); value -= v; }
    }
    return out;
  }
}
