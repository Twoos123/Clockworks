// Damage against defence. The game's own formula lives in closed code, so this one is ours:
// each damage type is reduced by the matching defence with diminishing returns, so equal
// attack and defence takes off a third, and no defence takes off nothing.

import { DAMAGE_TYPES, type Amounts } from "./depth";

/** Damage dealt by `attack` amounts against `defense` amounts. */
export function dealt(attack: Amounts, defense: Amounts | null): number {
  let total = 0;
  for (const t of DAMAGE_TYPES) {
    const a = attack[t];
    if (a <= 0) continue;
    const d = Math.max(0, defense?.[t] ?? 0);
    total += (a * a) / (a + 0.5 * d);
  }
  return total;
}

/** The largest damage type in an amount set, for colouring damage numbers. */
export function mainType(a: Amounts) {
  let best: (typeof DAMAGE_TYPES)[number] = "NORMAL";
  for (const t of DAMAGE_TYPES) if (a[t] > a[best]) best = t;
  return best;
}

export const TYPE_COLORS: Record<(typeof DAMAGE_TYPES)[number], string> = {
  NORMAL: "#ffe066", PIERCING: "#7fd6ff", ELEMENTAL: "#ff9a4d", SHADOW: "#c58cff",
};
