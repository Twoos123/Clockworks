// Settings kept in the browser (audio, graphics, interface, gameplay, key bindings, gamepad):
// their defaults, loading and saving. The game's own options window (src/ui/options.ts) shows
// and changes them; there is no HTML menu.

import { hasMessage, message } from "../i18n";
import type { LootLevel } from "../game/lootlog";

/** Rebindable actions and their default keys (KeyboardEvent.key, lower-cased). */
export const ACTIONS = {
  up: { label: "Move up", key: "w" },
  down: { label: "Move down", key: "s" },
  left: { label: "Move left", key: "a" },
  right: { label: "Move right", key: "d" },
  // the client binds DASH to Shift + right click only (the mouse handler); a key is optional
  dash: { label: "Dash (also Shift + right click)", key: "" },
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
  // the client binds NEXT_WEAPON to Space (Command: key 32)
  cycle: { label: "Next weapon", key: " " },
  // the HUD's menu commands on the client's default keys (Command.COMMON_KEYS); the corner
  // menus' hotkey badges show what is bound here
  arsenal: { label: "Arsenal", key: "i" },
  character: { label: "Equipment", key: "p" },
  loadout: { label: "Loadouts", key: "l" },
  forge: { label: "Forge (crafting)", key: "u" },
  mission: { label: "Missions", key: "m" },
  social: { label: "Social", key: "f6" },
  feed: { label: "Event Hub", key: "f7" },
  uplink: { label: "Mail", key: "" },
  map: { label: "Map overlay", key: "b" },
  hudLock: { label: "Lock HUD", key: "`" },
  zoom: { label: "Camera zoom", key: "=" },
  help: { label: "Controls help", key: "f1" },
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
  /** The interface scale (OptionsDialog's UI scale: 0.7 up to the screen's largest, uiScaleLimit). */
  hudScale: number;
  /** The UI scale's Max! toggle: the interface follows the screen's largest scale (uiMaxScale). */
  hudScaleMax: boolean;
  damageNumbers: boolean;
  healthBars: boolean;
  minimap: boolean;
  controlsHint: boolean;
  /** Guns and bombs turn toward the nearest monster near the aim. */
  autoAim: boolean;
  /**
   * The game's mouse-move control scheme (Command.ControlScheme MOUSE_MOVE): holding the left
   * button runs toward the pointer; Z or the right button attacks, X shields, Shift + Z bashes
   * and Shift + X dodges. Off: the WASD scheme (left button attacks, right shields).
   */
  mouseMove: boolean;
  /** Camera turn speed for Q and E, in radians per second. */
  cameraSpeed: number;
  /** Camera distance multiplier. */
  zoom: number;
  screenFlash: boolean;
  /**
   * Camera shake off: kept the client's way, as the inverse preference (ProjectXPrefs "noShake",
   * false by default); the options' camera_shake check box shows its opposite.
   */
  noShake: boolean;
  /** Gamepad stick dead zone. */
  deadZone: number;
  keys: Record<Action, string>;
  /** Options > Chat > Loot Messages (LootReportLevel: All, Filtered, None). */
  lootMessages: LootLevel;
  /** The game text's locale: "" for the base (English) bundles, or one the install has ("de"). */
  locale: string;
}

const KEY = "clyde-web-settings";

/** The smallest UI scale (ProjectXPrefs: 0.7). */
export const UI_MIN_SCALE = 0.7;

/**
 * The screen's largest UI scale, as ProjectXPrefs works it out for a display mode: the share of
 * 1280 x 1024 the screen holds, or when that is under 1, of 1024 x 600 (never under 1).
 */
export function uiMaxScale(w = innerWidth, h = innerHeight): number {
  const s = Math.min(w / 1280, h / 1024);
  return s >= 1 ? s : uiScaleLimit(w, h);
}

/** The slider's top when the largest scale is under the scale chosen: the 1024 x 600 share. */
export function uiScaleLimit(w = innerWidth, h = innerHeight): number {
  return Math.max(1, Math.min(w / 1024, h / 600));
}

/** The interface scale in use: the largest the screen allows with Max! on, else the one chosen. */
export function uiScale(s: Pick<Settings, "hudScale" | "hudScaleMax">): number {
  return s.hudScaleMax ? uiMaxScale() : s.hudScale;
}

export function defaultSettings(): Settings {
  return {
    masterVolume: 0.8, musicVolume: 0.45, effectsVolume: 1, uiVolume: 1, muted: false,
    renderScale: 1, fog: true, shadows: true, decals: true, particles: true, showFps: false,
    hudScale: 1, hudScaleMax: false, damageNumbers: true, healthBars: true, minimap: true, controlsHint: true,
    autoAim: true, mouseMove: false, cameraSpeed: 1.8, zoom: 1, screenFlash: true, noShake: false, deadZone: 0.2, locale: "", lootMessages: "all",
    keys: Object.fromEntries(Object.entries(ACTIONS).map(([k, v]) => [k, v.key])) as Record<Action, string>,
  };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw) as Partial<Settings>;
    return { ...d, ...s, keys: migrateKeys(d.keys, s.keys ?? {}) };
  } catch { return d; }
}

/**
 * Saved keys over the defaults. Keys still on this port's old defaults (Forge K, Help H, Dash
 * Space, Next weapon Tab) move to the client's (U, F1, Shift + right click only, Space), and actions that are gone (the
 * old Backpack on B) are dropped.
 */
export function migrateKeys(defaults: Record<Action, string>, saved: Record<string, string>): Record<Action, string> {
  const OLD: Partial<Record<Action, string>> = { forge: "k", help: "h", dash: " ", cycle: "tab" };
  const keys = { ...defaults };
  for (const [a, k] of Object.entries(saved)) {
    if (!(a in defaults)) continue;
    keys[a as Action] = OLD[a as Action] === k ? defaults[a as Action] : k;
  }
  return keys;
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

/** Shown on key buttons. */
export const keyName = (k: string) => !k ? "" : k === " " ? "Space" : k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1);

/** Browser key names to the game's key descriptions ("k.space" in the projectx bundle). */
const GAME_KEYS: Record<string, string> = {
  " ": "space", tab: "tab", shift: "lshift", control: "lcontrol", alt: "lmenu", meta: "lmeta", enter: "return", escape: "escape",
  arrowup: "up", arrowdown: "down", arrowleft: "left", arrowright: "right", delete: "delete", insert: "insert",
  home: "home", end: "end", pageup: "prior", pagedown: "next", ",": "comma", ".": "period", "/": "slash", ";": "semicolon",
  "'": "apostrophe", "[": "lbracket", "]": "rbracket", "\\": "backslash", "-": "minus", "=": "equals", "`": "grave",
};

/** A key's label in the game's words when the bundles have it, else ours. */
export function gameKeyName(k: string): string {
  const mouse = /^mouse(\d)$/.exec(k);
  const desc = mouse ? "k.button" + mouse[1] : GAME_KEYS[k] ? "k." + GAME_KEYS[k] : null;
  if (desc && hasMessage("projectx", desc)) return message("projectx", desc);
  return mouse ? ["Left Mouse", "Right Mouse", "Middle Mouse"][Number(mouse[1]) - 1] ?? k : keyName(k);
}

/** The game's control commands (as its help text names them) to our actions and mouse buttons. */
const COMMANDS: Record<string, (Action | "mouse1" | "mouse2")[]> = {
  ACTION: ["mouse1"], DEFEND: ["mouse2"], DODGE: ["dash"],
  MOVE_NORTH: ["up"], MOVE_SOUTH: ["down"], MOVE_WEST: ["left"], MOVE_EAST: ["right"],
  NEXT_WEAPON: ["cycle"], TOGGLE_HELP: ["help"], SPRITE_ACTION_1: ["sprite1"], SPRITE_ACTION_2: ["sprite2"], SPRITE_ACTION_3: ["sprite3"],
};

/** Labels of the keys bound to one of the game's commands, for help text with "[[ACTION]]" in it. */
export function commandKeys(s: Settings, command: string): string[] {
  return (COMMANDS[command] ?? []).map(a => gameKeyName(a === "mouse1" || a === "mouse2" ? a : s.keys[a]));
}

/** The old settings menu's pages; each now lives in the game's options window (src/ui/options.ts). */
export type Tab = "game" | "audio" | "graphics" | "interface" | "controls" | "save";
