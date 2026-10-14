// Where the Arcade's gates come from: the real ones (src/game/gatemap.ts), through the local
// server's cache of the community Gate Map (server/gates.ts); when neither the site nor the cache
// can be had (the folder-input mode has no server), the gates are generated as before
// (clockworks.ts arcadeGates).

import { arcadeGates, realGate, type Gate } from "./clockworks";
import { activeGates, gateFileName, gateOpens, parseGateFile, parseGateList, readGate, type GateEntry } from "./gatemap";

/** A gate on the board's list: real ones carry their list entry. */
export interface GateChoice { gate: Gate | null; entry: GateEntry | null; active: boolean }

const LIST_TTL = 10 * 60 * 1000;

export class GateSource {
  private list: GateEntry[] | null = null;
  private listAt = 0;
  private listing: Promise<GateEntry[] | null> | null = null;
  private gates = new Map<string, Promise<Gate | null>>();
  /** True once the real gates could not be had (the board shows generated ones). */
  offline = false;

  constructor(private readonly base = "/__sk/gates") {}

  private async fetchText(path: string): Promise<string | null> {
    try {
      const r = await fetch(this.base + path);
      return r.ok ? await r.text() : null;
    } catch { return null; }
  }

  /** The gate list (refetched every ten minutes, and when a new gate is due). */
  entries(): Promise<GateEntry[] | null> {
    const due = this.list && this.list.length && gateOpens({ ...this.list[this.list.length - 1], date: nextDate(this.list[this.list.length - 1].date) }) <= Date.now();
    if (this.list && Date.now() - this.listAt < LIST_TTL && !due) return Promise.resolve(this.list);
    this.listing ??= (async () => {
      const text = await this.fetchText("/list");
      let list: GateEntry[] | null = null;
      try { list = text ? parseGateList(text) : null; } catch { list = null; }
      if (list?.length) { this.list = list; this.listAt = Date.now(); }
      this.offline = !this.list;
      return this.list;
    })().finally(() => { this.listing = null; });
    return this.listing;
  }

  /** One real gate, read from its data file (null when it cannot be had). */
  gate(e: GateEntry): Promise<Gate | null> {
    const name = gateFileName(e);
    let p = this.gates.get(name);
    if (!p) {
      p = this.fetchText(`/data/${name}.txt`).then(t => {
        const f = t ? parseGateFile(t) : null;
        return f ? realGate(readGate(e, f)) : null;
      });
      this.gates.set(name, p);
      void p.then(g => { if (!g) this.gates.delete(name); });
    }
    return p;
  }

  /**
   * The board's gates: today's four (newest first), then `older` gates before them; the
   * generated gates when the real ones cannot be had.
   */
  async choices(older = 0, now = Date.now()): Promise<GateChoice[]> {
    const list = await this.entries();
    if (list?.length) {
      const active = activeGates(list, now);
      const gates = await Promise.all(active.map(e => this.gate(e)));
      if (gates.some(g => g)) {
        const oldest = active.at(-1)?.date ?? "";
        const rest = list.filter(e => e.date < oldest).sort((a, b) => b.date.localeCompare(a.date)).slice(0, older);
        return [...active.map((entry, i) => ({ gate: gates[i], entry, active: true })),
          ...rest.map(entry => ({ gate: null, entry, active: false }))];
      }
    }
    this.offline = true;
    return arcadeGates().map(gate => ({ gate, entry: null, active: true }));
  }
}

/** The date two days after a gate's (the next gate's). */
function nextDate(date: string): string {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8) + 2));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}
