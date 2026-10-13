// Gamepad controls (standard mapping): left stick moves, right stick aims, A attacks (hold to
// charge), B or the left trigger shields, X dashes, Y uses or picks up, the bumpers switch
// weapons, and the right stick's horizontal axis turns the camera when not aiming.

export interface PadState {
  move: [number, number];
  /** Aim direction in camera space (x right, y up) or null. */
  aim: [number, number] | null;
  attackDown: boolean;
  attackHeld: boolean;
  shield: boolean;
  dash: boolean;
  interact: boolean;
  /** -1 or +1 when a bumper went down this frame. */
  cycle: number;
  /** A pocket slot (d-pad up, right, down, left) used this frame, or -1. */
  item: number;
}

/** Stick dead zone (the options menu sets it). */
export const pad = { deadZone: 0.2 };
const dz = (x: number, y: number): [number, number] => (Math.hypot(x, y) < pad.deadZone ? [0, 0] : [x, y]);

export class Gamepads {
  private prev = new Map<number, boolean>();

  /** Reads the first connected pad, or null when there is none. */
  poll(): PadState | null {
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    const p = [...pads].find(x => x && x.connected);
    if (!p) return null;
    const b = (i: number) => !!p.buttons[i]?.pressed || (p.buttons[i]?.value ?? 0) > 0.5;
    const edge = (i: number) => { const now = b(i), was = this.prev.get(i) ?? false; this.prev.set(i, now); return now && !was; };
    const [lx, ly] = dz(p.axes[0] ?? 0, p.axes[1] ?? 0);
    const [rx, ry] = dz(p.axes[2] ?? 0, p.axes[3] ?? 0);
    const cyc = edge(5) ? 1 : edge(4) ? -1 : 0;
    return {
      move: [lx, -ly],
      aim: rx || ry ? [rx, -ry] : null,
      attackDown: edge(0), attackHeld: b(0),
      shield: b(1) || b(6),
      dash: edge(2), interact: edge(3),
      cycle: cyc,
      item: [12, 15, 13, 14].findIndex(i => edge(i)),
    };
  }
}
