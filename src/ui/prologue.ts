// The new knight's prologue, as the client plays it before knight creation (client dK, opened
// when an account has no knights or an empty knight card is pressed): rsrc/ui/prolgue/
// interface.dat (derived from ui/prolgue/parts/interface_cradle.dat) over the whole screen,
// with sound/music/prologue_audio_only.ogg at 0.45 (a 0.5 s fade, not looping).
//
// The interface plays itself through its scripts, about 100 seconds in all:
//  - 0_intro: black, fading out over 3 s from 4 s; the Cradle skybox (render_cradle, a view
//    through the model's animated camera_intro node) in its warp idle; the preface captions
//    (ui/prolgue/parts/interface_preface.dat, prologue bundle m.preface1-3).
//  - 1_exitwarp (11 s): the warp-exit animation; 2_zoomtocradle (13.5 s): the camera's zoom to
//    Cradle, the captions cleared at 9 s.
//  - 3_playcomic (33.5 s): the comic (ui/prolgue/parts/interface_comic.dat: fifteen 3D panels
//    in comic wrappers, the Skylark's approach, its crew, the attack, the evacuation, the pod's
//    fall and the SPIRAL KNIGHTS title card).
//  - 4_crash (91.5 s): the crash animation, the falling panel, a fade to white, the crash
//    image (ui/prolgue/images/015_crash.jpg) and a fade to black whose end emits
//    "end_prologue".
// A SKIP button (btn_skip, bottom right) shows for a second whenever the pointer moves; it, the
// end of the prologue and Escape all go on to knight creation.

import { CONFIG_REF } from "../config/params";
import { buildInterface, type Component } from "./gui";
import { GlScreen } from "./glscreen";

export class PrologueScreen extends GlScreen {
  /** The prologue ended or was skipped (once per showing). */
  onDone: (() => void) | null = null;
  private skipTimer: ReturnType<typeof setTimeout> | null = null;
  private done = false;

  protected async build(): Promise<Component | null> {
    const ui = await buildInterface(this.ctx, { $class: CONFIG_REF, name: "ui/prolgue/interface.dat" });
    if (!ui) return null;
    const skip = ui.find("btn_skip");
    if (skip) {
      skip.visible = false;
      skip.onAction = () => this.finish();
    }
    return ui;
  }

  /** Plays the prologue from the start. */
  async play() {
    this.reset();
    this.done = false;
    await this.show();
  }

  protected onEvent(action: string) {
    if (action === "end_prologue") this.finish();
  }

  protected pointerEvent(type: "down" | "up" | "move") {
    if (type !== "move") return;
    // dO/dM: moving the pointer shows the skip button, which hides a second after it stops
    const skip = this.root?.find("btn_skip");
    if (!skip || this.done) return;
    skip.visible = true;
    if (this.skipTimer) clearTimeout(this.skipTimer);
    this.skipTimer = setTimeout(() => { skip.visible = false; }, 1000);
  }

  /** Ends the prologue (dK.Jr): once, then knight creation. */
  finish() {
    if (this.done) return;
    this.done = true;
    if (this.skipTimer) clearTimeout(this.skipTimer);
    this.hide();
    this.reset();
    this.onDone?.();
  }

  /** Escape skips, as the client's dismiss does. */
  escape(): boolean {
    if (!this.visible) return false;
    this.finish();
    return true;
  }
}
