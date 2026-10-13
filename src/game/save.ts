// The player's saved state, kept in the browser (localStorage): the equipped loadout, crowns
// and materials banked between runs, and the deepest floor reached. Nothing leaves the
// machine.

export interface Loadout {
  /** Item config names, e.g. "Weapon/Sword/Proto Sword"; up to three weapons. */
  weapons: string[];
  shield: string;
  /** Empty for the knight model's default armour and helmet. */
  armor: string;
  helmet: string;
}

export interface SaveData {
  version: 1;
  loadout: Loadout;
  crowns: number;
  heat: number;
  materials: Record<string, number>;
  bestDepth: number;
  runs: number;
}

const KEY = "clyde-web-save";

export const DEFAULT_LOADOUT: Loadout = {
  weapons: ["Weapon/Sword/Proto Sword", "Weapon/Handgun/Proto Gun", "Weapon/Bomb/Proto Bomb"],
  shield: "Gear/Shield/Proto Shield",
  armor: "",
  helmet: "",
};

export function loadSave(): SaveData {
  const fresh: SaveData = { version: 1, loadout: { ...DEFAULT_LOADOUT, weapons: [...DEFAULT_LOADOUT.weapons] }, crowns: 0, heat: 0, materials: {}, bestDepth: 0, runs: 0 };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const d = JSON.parse(raw) as Partial<SaveData>;
    return {
      ...fresh, ...d,
      loadout: { ...fresh.loadout, ...(d.loadout ?? {}), weapons: (d.loadout?.weapons ?? fresh.loadout.weapons).slice(0, 3) },
      materials: { ...(d.materials ?? {}) },
    };
  } catch { return fresh; }
}

export function writeSave(d: SaveData) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* storage unavailable */ }
}
