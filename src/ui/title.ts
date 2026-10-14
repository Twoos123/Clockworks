// The log-on screen, as the client opens it (ProjectXApp.aQ shows LogonWindow, client bN, with
// sound/music/title.ogg): the game's own rsrc/ui/logon/interface.dat over the whole screen.
//  - Its "skybox" part (ui/logon/parts/skybox.dat) is a full-screen RenderableView of the
//    Cradle skybox (world/skybox/cradle/parts/model_base.dat: the planet, its golden ring, the
//    moon and the drifting debris) inside a rounded dark frame (ui/logon/border.png).
//  - The SPIRAL KNIGHTS logo drops in (script "Logo": 0.2 s, then a 0.3 s overshooting move
//    from 3x size, 200 px up), and the log-on panel fades in after a second ("Logon Info").
//  - The Grey Havens footer sits at the bottom.
// There is no account here: the name and password fields, the Steam and guest boxes, the terms
// line and the web links are hidden; the Log On button plays (to the knight select window, or
// a new knight's prologue), and Quit and Options stay.

import { CONFIG_REF } from "../config/params";
import { buildInterface, type Component } from "./gui";
import { GlScreen, walk } from "./glscreen";

export interface TitleActions {
  play(): void;
  options(): void;
  quit(): void;
  /** The asset viewer (development builds). */
  viewer?: () => void;
}

/** Log-on panel parts that belong to accounts, servers and the web. */
const ACCOUNT_PARTS = new Set(["creds_cont", "steam_cont", "tos_cont", "devtools", "TOS", "support", "forgot_password", "game_website"]);

export class TitleScreen extends GlScreen {
  actions: TitleActions | null = null;
  /** The status line under the panel (e.g. how many knights are saved). */
  status = "";

  protected async build(): Promise<Component | null> {
    const ui = await buildInterface(this.ctx, { $class: CONFIG_REF, name: "ui/logon/interface.dat" });
    if (!ui) return null;
    walk(ui, c => { if (ACCOUNT_PARTS.has(c.tag)) c.visible = false; });
    // the web links' row under the panel
    const links = ui.find("support");
    if (links) for (const c of ui.find("logon_info")?.children ?? []) if (c.children.includes(links)) c.visible = false;
    const on = (tag: string, fn: () => void, text?: string) => {
      const b = ui.find(tag);
      if (!b) return;
      b.onAction = () => fn();
      if (text) b.text = text;
    };
    on("logon", () => this.actions?.play(), "Play");
    on("options", () => this.actions?.options());
    on("quit", () => this.actions?.quit());
    // the panel's hidden third button (the client's external log-on) opens the asset viewer in
    // development builds
    const ext = ui.find("ext_logon");
    if (ext && this.actions?.viewer) { ext.visible = true; ext.text = "Asset Viewer"; ext.onAction = () => this.actions?.viewer?.(); }
    return ui;
  }

  protected refresh() {
    const s = this.root?.find("status");
    if (s) s.text = this.status || " ";
  }

  /** Replays the logo and panel entrances (on coming back to the screen). */
  replay() {
    if (this.root?.addAction) this.runner(this.root).execute(this.root.addAction);
  }

  setStatus(text: string) {
    this.status = text;
    void this.refresh();
  }
}
