// The options menu (Esc, or the wrench on the HUD's left menu): audio, graphics, interface,
// gameplay, key bindings, gamepad and save data, kept in the browser. The game's own options
// window is built from code we do not read, so this one is our own, in the HUD's colours.

import { loadSave, writeSave, type SaveData } from "../game/save";

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

export interface SettingsHooks {
  /** Settings changed (apply them). */
  changed(s: Settings): void;
  /** In a level (the game buttons show). */
  playing(): boolean;
  resume(): void;
  returnToHaven(): void;
  leave(): void;
  /** The save was replaced (imported or reset). */
  saveReplaced(d: SaveData): void;
  sound(file: string): void;
}

export type Tab = "game" | "audio" | "graphics" | "interface" | "controls" | "save";
const TABS: [Tab, string][] = [["game", "Game"], ["audio", "Audio"], ["graphics", "Graphics"], ["interface", "Interface"], ["controls", "Controls"], ["save", "Save data"]];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export class SettingsMenu {
  private tab: Tab = "game";
  /** The action waiting for a key press, while rebinding. */
  private binding: Action | null = null;

  constructor(private readonly root: HTMLElement, readonly settings: Settings, private readonly hooks: SettingsHooks) {
    addEventListener("keydown", e => {
      if (!this.binding || this.root.hidden) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key !== "Escape") {
        const key = e.key.toLowerCase();
        // a key belongs to one action: the old owner gets the action's previous key
        const old = this.settings.keys[this.binding];
        for (const a of Object.keys(this.settings.keys) as Action[]) if (this.settings.keys[a] === key) this.settings.keys[a] = old;
        this.settings.keys[this.binding] = key;
        this.commit();
      }
      this.binding = null;
      this.render();
    }, true);
  }

  get isOpen() { return !this.root.hidden; }

  open(tab?: Tab) {
    if (tab) this.tab = tab;
    if (!this.isOpen) this.hooks.sound("sound/feedback/ui_open.ogg");
    this.root.hidden = false;
    this.render();
  }

  close() {
    if (!this.isOpen) return;
    this.binding = null;
    this.root.hidden = true;
    this.hooks.sound("sound/feedback/ui_dismiss.ogg");
    this.hooks.resume();
  }

  private commit() {
    saveSettings(this.settings);
    this.hooks.changed(this.settings);
  }

  private render() {
    const r = this.root;
    r.replaceChildren();
    const card = el("div", "settings-card");
    const head = el("div", "settings-head");
    const close = el("button", "", "Close");
    close.onclick = () => this.close();
    head.append(el("h2", "", "Options"), close);
    const tabs = el("div", "arsenal-tabs");
    for (const [id, label] of TABS) {
      const b = el("button", id === this.tab ? "active" : "", label);
      b.onclick = () => { this.tab = id; this.hooks.sound("sound/feedback/ui_dropdown_select.ogg"); this.render(); };
      tabs.append(b);
    }
    const body = el("div", "settings-body");
    this.fill(body);
    card.append(head, tabs, body);
    r.append(card);
  }

  private slider(body: HTMLElement, label: string, key: keyof Settings, min: number, max: number, step: number, fmt = (v: number) => `${Math.round(v * 100)}%`) {
    const row = el("label", "settings-row");
    const input = document.createElement("input");
    input.type = "range"; input.min = String(min); input.max = String(max); input.step = String(step);
    input.value = String(this.settings[key]);
    const out = el("span", "settings-value", fmt(this.settings[key] as number));
    input.oninput = () => { (this.settings as any)[key] = Number(input.value); out.textContent = fmt(Number(input.value)); this.commit(); };
    row.append(el("span", "", label), input, out);
    body.append(row);
  }

  private toggle(body: HTMLElement, label: string, key: keyof Settings) {
    const row = el("label", "settings-row");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!this.settings[key];
    input.onchange = () => { (this.settings as any)[key] = input.checked; this.hooks.sound("sound/feedback/ui_confirm.ogg"); this.commit(); };
    row.append(el("span", "", label), input);
    body.append(row);
  }

  private button(body: HTMLElement, label: string, onclick: () => void, cls = "") {
    const b = el("button", cls, label);
    b.onclick = () => { this.hooks.sound("sound/feedback/button_press.ogg"); onclick(); };
    body.append(b);
    return b;
  }

  private fill(body: HTMLElement) {
    const s = this.settings;
    switch (this.tab) {
      case "game": {
        const col = el("div", "settings-buttons");
        this.button(col, "Resume", () => this.close(), "primary");
        if (this.hooks.playing()) {
          this.button(col, "Return to Haven", () => { this.root.hidden = true; this.hooks.returnToHaven(); });
          this.button(col, "Leave the game (back to the viewer)", () => { this.root.hidden = true; this.hooks.leave(); });
        }
        body.append(col);
        break;
      }
      case "audio":
        this.toggle(body, "Mute all sound", "muted");
        this.slider(body, "Master volume", "masterVolume", 0, 1, 0.01);
        this.slider(body, "Music", "musicVolume", 0, 1, 0.01);
        this.slider(body, "Sound effects", "effectsVolume", 0, 1, 0.01);
        this.slider(body, "Menu sounds", "uiVolume", 0, 1, 0.01);
        break;
      case "graphics":
        this.slider(body, "Render resolution", "renderScale", 0.5, 1.5, 0.05);
        this.toggle(body, "Fog", "fog");
        this.toggle(body, "Shadows under characters", "shadows");
        this.toggle(body, "Projected shade (roofs, trees)", "decals");
        this.toggle(body, "Particle effects", "particles");
        this.toggle(body, "Show frame rate", "showFps");
        break;
      case "interface":
        this.slider(body, "HUD size", "hudScale", 0.75, 1.5, 0.05);
        this.toggle(body, "Damage numbers", "damageNumbers");
        this.toggle(body, "Monster health bars", "healthBars");
        this.toggle(body, "Minimap", "minimap");
        this.toggle(body, "Red flash when hit", "screenFlash");
        this.toggle(body, "Controls hint while playing", "controlsHint");
        break;
      case "controls": {
        this.toggle(body, "Auto-aim guns and bombs", "autoAim");
        this.slider(body, "Camera turn speed (Q / E)", "cameraSpeed", 0.5, 4, 0.1, v => v.toFixed(1));
        this.slider(body, "Camera distance", "zoom", 0.7, 1.6, 0.05);
        this.slider(body, "Gamepad stick dead zone", "deadZone", 0.05, 0.5, 0.01);
        body.append(el("p", "settings-note", "Mouse: left click attacks (hold to charge), right click raises the shield, Shift + right click dashes. Click a key to change it."));
        const grid = el("div", "settings-keys");
        for (const a of Object.keys(ACTIONS) as Action[]) {
          const b = el("button", this.binding === a ? "active" : "", this.binding === a ? "Press a key..." : keyName(s.keys[a]));
          b.onclick = () => { this.binding = a; this.render(); };
          grid.append(el("span", "", ACTIONS[a].label), b);
        }
        body.append(grid);
        this.button(body, "Restore default keys", () => { s.keys = defaultSettings().keys; this.commit(); this.render(); });
        break;
      }
      case "save": {
        const d = loadSave();
        body.append(el("p", "settings-note", `Crowns ${d.crowns} · heat ${d.heat} · ${d.owned.length} items owned · deepest depth ${d.bestDepth} · ${d.runs} runs. The save lives in this browser only.`));
        const col = el("div", "settings-buttons");
        this.button(col, "Export save to a file", () => {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob([JSON.stringify(loadSave(), null, 1)], { type: "application/json" }));
          a.download = "clyde-web-save.json";
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        });
        this.button(col, "Import save from a file", () => {
          const input = document.createElement("input");
          input.type = "file"; input.accept = ".json,application/json";
          input.onchange = async () => {
            const f = input.files?.[0];
            if (!f) return;
            try {
              const data = JSON.parse(await f.text());
              if (!data || typeof data !== "object" || !data.loadout) throw new Error("not a save");
              writeSave(data);
              this.hooks.saveReplaced(loadSave());
              this.render();
            } catch { alert("That file is not a clyde-web save."); }
          };
          input.click();
        });
        this.button(col, "Reset save (start over)", () => {
          if (!confirm("Delete this browser's save and start over? This cannot be undone.")) return;
          try { localStorage.removeItem("clyde-web-save"); } catch { /* storage unavailable */ }
          this.hooks.saveReplaced(loadSave());
          this.render();
        }, "danger");
        body.append(col);
        break;
      }
    }
  }
}
