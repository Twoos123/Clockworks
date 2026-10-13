// Settings kept in the browser (audio, graphics, interface, gameplay, key bindings, gamepad):
// their defaults, loading and saving. The game's own options window (src/ui/options.ts) shows
// and changes them; there is no HTML menu.


/** Rebindable actions and their default keys (KeyboardEvent.key, lower-cased). */
export const ACTIONS = {
  up: { label: "Move up", key: "w" },
  down: { label: "Move down", key: "s" },
  left: { label: "Move left", key: "a" },
  right: { label: "Move right", key: "d" },
  dash: { label: "Dash (also Shift + right click)", key: " " },
  interact: { label: "Pick up / use", key: "f" },
  weapon1: { label: "Weapon 1", key: "1" },
  weapon2: { label: "Weapon 2", key: "2" },
  weapon3: { label: "Weapon 3", key: "3" },
  item1: { label: "Pocket item 1", key: "4" },
  item2: { label: "Pocket item 2", key: "5" },
  item3: { label: "Pocket item 3", key: "6" },
  item4: { label: "Pocket item 4", key: "7" },
  sprite1: { label: "Sprite skill 1", key: "r" },
  sprite2: { label: "Sprite skill 2", key: "t" },
  sprite3: { label: "Sprite skill 3", key: "g" },
  cycle: { label: "Next weapon", key: "tab" },
  arsenal: { label: "Arsenal", key: "i" },
  forge: { label: "Forge (crafting)", key: "k" },
  backpack: { label: "Backpack", key: "b" },
  help: { label: "Controls help", key: "h" },
  turnLeft: { label: "Turn camera left", key: "q" },
  turnRight: { label: "Turn camera right", key: "e" },
} as const;
export type Action = keyof typeof ACTIONS;

export interface Settings {
  masterVolume: number;
  musicVolume: number;
  effectsVolume: number;
  uiVolume: number;
  muted: boolean;
  /** Render resolution relative to the screen's (0.5 to 1.5). */
  renderScale: number;
  fog: boolean;
  shadows: boolean;
  decals: boolean;
  particles: boolean;
  showFps: boolean;
  /** HUD size (0.75 to 1.5). */
  hudScale: number;
  damageNumbers: boolean;
  healthBars: boolean;
  minimap: boolean;
  controlsHint: boolean;
  /** Guns and bombs turn toward the nearest monster near the aim. */
  autoAim: boolean;
  /** Camera turn speed for Q and E, in radians per second. */
  cameraSpeed: number;
  /** Camera distance multiplier. */
  zoom: number;
  screenFlash: boolean;
  /** Gamepad stick dead zone. */
  deadZone: number;
  keys: Record<Action, string>;
}

const KEY = "clyde-web-settings";

export function defaultSettings(): Settings {
  return {
    masterVolume: 0.8, musicVolume: 0.45, effectsVolume: 1, uiVolume: 1, muted: false,
    renderScale: 1, fog: true, shadows: true, decals: true, particles: true, showFps: false,
    hudScale: 1, damageNumbers: true, healthBars: true, minimap: true, controlsHint: true,
    autoAim: true, cameraSpeed: 1.8, zoom: 1, screenFlash: true, deadZone: 0.2,
    keys: Object.fromEntries(Object.entries(ACTIONS).map(([k, v]) => [k, v.key])) as Record<Action, string>,
  };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw) as Partial<Settings>;
    return { ...d, ...s, keys: { ...d.keys, ...(s.keys ?? {}) } };
  } catch { return d; }
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

/** Shown on key buttons. */
export const keyName = (k: string) => k === " " ? "Space" : k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1);

/** The old settings menu's pages; each now lives in the game's options window (src/ui/options.ts). */
export type Tab = "game" | "audio" | "graphics" | "interface" | "controls" | "save";
