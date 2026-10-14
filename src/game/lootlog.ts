// Loot messages in the chat area (the client's chat overlay, client/chat/l and k over Clyde's
// ChatOverlay): the server sends each find as a system message, dungeon bundle
// m.item_awarded "You have obtained {0} ({1})." with the item's group ({0}: ItemCodes.Group's
// key, "Material", "Rarity", "Mineral"...) and its name, at the grey attention level
// (k.aRw[3], 0.42 grey, outlined black). Options > Chat > Loot Messages filters them
// (LootReportLevel: All, Filtered, None; All by default).
//
// The chat overlay sits at the bottom left (l.JQ: at 0, 64 from the bottom, the display 5 in
// and 30 up inside it, 200 high by default) in Arial Black at the chat font's size (SMALL,
// 14); lines stack at the bottom and stay (the recordings show them for over a minute).

export type LootLevel = "all" | "pro" | "none";

/** LootReportLevel.PRO (Filtered): few at a time, and only items rare enough for the depth. */
export function shouldReportLoot(level: LootLevel, rarity: number, count: number, depth: number): boolean {
  if (level === "all") return true;
  if (level === "none") return false;
  if (count > 5) return false;
  switch (rarity) {
    case 0: return false;
    case 1: return depth < 5;
    case 2: return depth < 9;
    case 3: return depth < 14;
    case 4: return depth < 19;
    case 5: return depth < 24;
    default: return true;
  }
}

/** The system message colour of a loot line (ChatOverlay k.aRw[3]). */
export const LOOT_COLOR = "rgb(107,107,107)";

export interface ChatLine { text: string; color: string; at: number }

/** The chat overlay's lines (newest last). */
export class ChatLog {
  readonly lines: ChatLine[] = [];
  constructor(private readonly keep = 60) {}
  add(text: string, color = LOOT_COLOR, at = performance.now()) {
    this.lines.push({ text, color, at });
    if (this.lines.length > this.keep) this.lines.splice(0, this.lines.length - this.keep);
  }
  clear() { this.lines.length = 0; }
}

/** Splits text into lines no wider than `width` (by a measure), at spaces where it can. */
export function wrapText(text: string, width: number, measure: (s: string) => number): string[] {
  const words = text.split(" "), out: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? line + " " + w : w;
    if (line && measure(next) > width) { out.push(line); line = w; } else line = next;
  }
  if (line) out.push(line);
  return out;
}
