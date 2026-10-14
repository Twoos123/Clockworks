// The shield bubble: the knight's raised shield shows its item's effect (the Proto Shield's
// particle/shield/omni_w_sound.dat: particle/shield/omni.dat plus a sounder), with the
// effect's "Power" choice set to the shield's health in quarters ("100", "75", "50", "25",
// "0"; omni.dat's options colour the rings blue, green, yellow, red, and "0" swaps the
// ambient layers for the broken ones). The knight sprite remakes it when the quarter changes.

const ARGUMENT_MAP = "com.threerings.config.ArgumentMap";

/** The shield's health in quarters (0 to 4); a knight without a shield reads as full. */
export function shieldPowerLevel(health: number, max: number, hasShield = true): number {
  if (!hasShield) return 4;
  return Math.max(0, Math.min(4, Math.round(4 * Math.max(0, health) / Math.max(1, max))));
}

/** The shield's effect reference with its "Power" argument set for a level (0 to 4). */
export function shieldEffectRef(base: any, level: number): any {
  const entries = ((base?.arguments?.entries ?? []) as [string, unknown][]).filter(([n]) => n !== "Power");
  return { ...base, arguments: { $map: ARGUMENT_MAP, entries: [...entries, ["Power", String(level * 25)]] } };
}

/** What the bubble needs from the world. */
export interface BubbleHost<E> {
  /** Loads and instantiates the effect (not yet shown); null when it cannot be loaded. */
  load(ref: any): Promise<E | null>;
  /** Shows a loaded effect (adds it to the world's effects). */
  attach(e: E): void;
  /** Ends a shown effect. */
  detach(e: E): void;
  /** Whether the world still holds a shown effect (its effects can be cleared under it). */
  holds(e: E): boolean;
}

/**
 * The bubble's state: shown while wanted, remade at a new strength, dropped when not wanted.
 * A load that finishes after the bubble stopped being wanted (or after the owner or the
 * strength changed) is discarded rather than shown.
 */
export class ShieldBubble<E> {
  effect: E | null = null;
  /** The level the shown (or loading) effect was made for. */
  power = -1;
  wanted = false;
  loading: Promise<void> | null = null;
  private owner: unknown = null;

  constructor(private readonly host: BubbleHost<E>) {}

  /** Sets whether the bubble is up, for an owner (the knight), its shield's effect and level. */
  set(on: boolean, owner: unknown, base: any | null, level: number) {
    this.wanted = on;
    if (this.effect && (!this.host.holds(this.effect) || owner !== this.owner)) {
      if (this.host.holds(this.effect)) this.host.detach(this.effect);
      this.effect = null;
    }
    this.owner = owner;
    if (!on || !base) {
      if (this.effect) { this.host.detach(this.effect); this.effect = null; }
      return;
    }
    if (this.effect && level !== this.power) { this.host.detach(this.effect); this.effect = null; }
    if (this.effect || this.loading) return;
    this.power = level;
    this.loading = this.host.load(shieldEffectRef(base, level)).then(e => {
      if (!e) return;
      if (!this.wanted || this.effect || this.owner !== owner || this.power !== level) return;
      this.effect = e;
      this.host.attach(e);
    }).catch(() => {}).finally(() => { this.loading = null; });
  }
}
