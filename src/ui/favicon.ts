// The browser tab's icon and title follow where the knight is, drawn at runtime from the
// install's own images (nothing of the game's ships with the page):
//  - log-on, knight select, the prologue and knight creation: the game's app icon
//    (ui/icon/icon_32.png and icon_16.png, the red knight emblem of the logo);
//  - towns: Haven's map icon as the gate map draws it (ui/icon/map/town.png in Haven's colours),
//    the Arcade's lobby icon, the Bazaar's market icon, the Ready Room's social icon, the guild's
//    own emblem in the guild hall;
//  - the Clockworks: the floor's level icon exactly as the gate map shows it (its themed
//    colours), the gate's emblem in its party lobby (the mission board's ARCADE gate cards),
//    a boss's lair icon on its floor, a Shadow Lair's stage icon, a mission's card art.
// The image is letterboxed into 32x32 and 16x16 canvases and set as <link rel="icon"> data URLs,
// cached per image. Any failure falls back to the app icon and never reaches the game.

import type { BossKey, Floor, Gate } from "../game/clockworks";
import { bossIcon, bossStageIcon, floorMapLevel, gateEmblem, specialIcon } from "../game/gatemap";
import type { GuiContext } from "./gui";
import { drawEmblem } from "./guild";

/** What the tab shows: the game's app icon, an install image (colourised), or the guild's emblem. */
export type IconSpec =
  | { kind: "logo" }
  | { kind: "image"; file: string; colorizations?: any[]; crop?: "card" }
  | { kind: "guild"; symbol: string; color: string };

export interface TabPlace { title: string; icon: IconSpec }

/** Where the player is, as the game knows it. */
export interface PlaceState {
  /** A full-screen interface (no scene): the log-on, knight select, prologue or test range. */
  screen?: "title" | "pick" | "prologue" | "creation" | "range" | null;
  sceneId?: string | null;
  sceneName?: string | null;
  /** The scene is a town (main.ts TOWN). */
  town?: boolean;
  /** The gate being played and the floor the knight is on (null in a mission's lobby). */
  gate?: Gate | null;
  floor?: Floor | null;
  /** The depth the floor is played at (its run depth, or a Shadow Lair's own). */
  depth?: number;
  /** A mission's card image (ui/mission/images/cards/images/...), for a mission:<id> gate. */
  missionCard?: string | null;
  guild?: { name?: string; symbol: string; color: string } | null;
  arena?: boolean;
}

export const GAME_TITLE = "Spiral Knights";
const LOGO: IconSpec = { kind: "logo" };
const img = (i: { file: string; colorizations?: any[] }): IconSpec => ({ kind: "image", file: i.file, colorizations: i.colorizations ?? [] });
const titled = (place: string) => place ? `${GAME_TITLE} – ${place}` : GAME_TITLE;
/** The scene ids main.ts gives the places of its own (src/game/places.ts). */
const GUILD_HALL = "guild:hall", READY_ROOM = "rsrc:world/readyroom/scene.dat", CREATE_KNIGHT = "rsrc:world/createknight/scene.dat";
const cap = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase());

/** The tab's title and icon for a place. */
export function choosePlace(s: PlaceState): TabPlace {
  switch (s.screen) {
    case "title": return { title: GAME_TITLE, icon: LOGO };
    case "pick": return { title: titled("Knight Select"), icon: LOGO };
    case "prologue": return { title: titled("Prologue"), icon: LOGO };
    case "creation": return { title: titled("Create a Knight"), icon: LOGO };
    case "range": return { title: titled("Test Range"), icon: LOGO };
  }
  const id = s.sceneId ?? "", name = (s.sceneName ?? "").toLowerCase();
  if (id === CREATE_KNIGHT) return { title: titled("Create a Knight"), icon: LOGO };
  if (id === READY_ROOM) return { title: titled("Ready Room"), icon: img({ file: "ui/icon/social/readyroom.png" }) };
  if (id === GUILD_HALL || (s.town && /^hall\b/.test(name))) {
    const g = s.guild;
    return { title: titled(g?.name ? `${g.name} Guild Hall` : "Guild Hall"),
      icon: g ? { kind: "guild", symbol: g.symbol, color: g.color } : img({ file: "ui/icon/social/guild.png" }) };
  }
  const gate = s.gate ?? null, f = s.floor ?? null;
  if (gate && !s.town) {
    const lair = (/^lair:(.+)$/.exec(gate.id)?.[1] ?? null) as BossKey | null;
    const boss = f?.kind === "boss" ? f.level?.boss ?? f.stratum?.boss ?? lair : null;
    // a Shadow Lair: the boss's lair icon on its floor, its stages' icon before
    if (lair) {
      const where = f ? `${gate.name} · ${f.name}` : gate.name;
      return { title: titled(where), icon: img(boss ? bossIcon(boss) : bossStageIcon(lair)) };
    }
    // a mission: its card art (the boss's icon on a boss floor)
    if (/^mission:/.test(gate.id)) {
      const where = f && f.kind !== "lobby" && f.name !== gate.name ? `${gate.name} · ${f.name}` : gate.name;
      const icon = boss ? img(bossIcon(boss)) : s.missionCard ? { kind: "image" as const, file: s.missionCard, crop: "card" as const }
        : f ? img(mapIcon(f)) : img(specialIcon("lobby", "brown"));
      return { title: titled(where), icon };
    }
    // an Arcade gate's party lobby: the gate's emblem
    if (!f || f.kind === "lobby") {
      const icon = gate.real ? gateEmblem(gate.real.entry.colour, gate.real.entry.symbol)
        : { file: `ui/adventureboard/gate_icons/icon_${PIECES.includes(gate.emblem) ? gate.emblem : "pawn"}.png`, colorizations: [] };
      return { title: titled(gate.name), icon: img(icon) };
    }
    // a floor: its level icon as the gate map shows it (a boss's lair: the map's boss icon)
    const depth = s.depth ?? f.depth;
    const label = f.kind === "core" ? f.name : `Depth ${depth}: ${f.name}`;
    return { title: titled(label), icon: img(mapIcon(f)) };
  }
  if (s.arena && !s.town) return { title: titled("Arena"), icon: img({ file: "ui/icon/map/shield.png" }) };
  // towns by their scene's name
  if (/ready room/.test(name)) return { title: titled("Ready Room"), icon: img({ file: "ui/icon/social/readyroom.png" }) };
  if (/arcade/.test(name)) return { title: titled("Arcade"), icon: img(specialIcon("lobby", "brown")) };
  if (/bazaar/.test(name)) return { title: titled("Bazaar"), icon: img({ file: "ui/icon/market_32.png" }) };
  if (/rescue camp/.test(name)) return { title: titled("Rescue Camp"), icon: img(specialIcon("town", "brown")) };
  if (/crash site/.test(name)) return { title: titled("Crash Site"), icon: LOGO };
  if (/haven/.test(name)) return { title: titled("Haven"), icon: img(specialIcon("town", "haven")) };
  if (/moorcroft/.test(name)) return { title: titled("Moorcroft Manor"), icon: img(specialIcon("town", "moorcroft")) };
  if (/emberlight/.test(name)) return { title: titled("Emberlight"), icon: img(specialIcon("town", "emberlight")) };
  if (/terminal core|\bcore\b/.test(name)) return { title: titled(cap(name)), icon: img(specialIcon("core", "brown")) };
  if (/terminal/.test(name)) return { title: titled(cap(name)), icon: img(specialIcon("terminal", "brown")) };
  if (!name) return { title: GAME_TITLE, icon: LOGO };
  return { title: titled(cap(name)), icon: s.town ? img(specialIcon("town", "haven")) : img(specialIcon("clockwork", "brown")) };
}

/** The mission board's gate pieces (src/ui/gates.ts gatePiece) for a generated gate's card. */
const PIECES = ["pawn", "rook", "knight", "bishop", "queen", "king"];

/** A floor's gate map icon: ui/icon/map/<icon>.png in its level's colours. */
function mapIcon(f: Floor): { file: string; colorizations: any[] } {
  const l = floorMapLevel(f);
  return { file: `ui/icon/map/${l.icon}.png`, colorizations: l.colorizations };
}

/** A cache key for an icon spec. */
export function iconKey(i: IconSpec): string {
  if (i.kind === "logo") return "logo";
  if (i.kind === "guild") return `guild|${i.symbol}|${i.color}`;
  return `${i.file}|${i.crop ?? ""}|${JSON.stringify(i.colorizations ?? [], (k, v) => (k === "$outer" ? undefined : v))}`;
}

/**
 * Where a source image lands in a square of `size`: letterboxed (the whole image, centred, its
 * aspect kept), or for a mission card a square cut from its upper middle (the card's subject).
 */
export function fitRect(w: number, h: number, size: number, crop?: "card"): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } {
  if (crop === "card" && w > 0 && h > 0) {
    const side = Math.min(w, h);
    return { sx: Math.round((w - side) / 2), sy: Math.round((h - side) * 0.35), sw: side, sh: side, dx: 0, dy: 0, dw: size, dh: size };
  }
  const k = size / Math.max(w, h, 1);
  const dw = Math.max(1, Math.round(w * k)), dh = Math.max(1, Math.round(h * k));
  return { sx: 0, sy: 0, sw: w, sh: h, dx: Math.floor((size - dw) / 2), dy: Math.floor((size - dh) / 2), dw, dh };
}

// ------------------------------------------------------------------ the tab

type Rendered = { s32: string; s16: string };

export class TabIcon {
  private readonly cache = new Map<string, Promise<Rendered | null>>();
  private token = 0;
  private lastKey = "";

  constructor(private readonly ctx: () => GuiContext | null) {}

  /** Shows a place: the title now, the icon once drawn (the app icon if it cannot be). */
  show(place: TabPlace) {
    try { document.title = place.title; } catch { /* no document */ }
    const key = iconKey(place.icon);
    if (key === this.lastKey) return;
    this.lastKey = key;
    const t = ++this.token;
    void (async () => {
      let r = await this.render(place.icon).catch(() => null);
      if (!r && place.icon.kind !== "logo") r = await this.render(LOGO).catch(() => null);
      if (r && t === this.token) setLinks(r);
    })().catch(() => undefined);
  }

  private render(icon: IconSpec): Promise<Rendered | null> {
    const key = iconKey(icon);
    let p = this.cache.get(key);
    if (!p) {
      p = this.draw(icon).catch(() => null);
      this.cache.set(key, p);
      // a failure is retried next time (the install may have been slow, not missing the file)
      void p.then(r => { if (!r) this.cache.delete(key); });
    }
    return p;
  }

  private async draw(icon: IconSpec): Promise<Rendered | null> {
    const ctx = this.ctx();
    if (!ctx) return null;
    if (icon.kind === "logo") {
      // the app icon in its own sizes, else the large one scaled
      const [a, b, big] = await Promise.all([ctx.image("ui/icon/icon_32.png"), ctx.image("ui/icon/icon_16.png"), ctx.image("ui/icon/icon_128.png")]);
      const s32 = a ?? big, s16 = b ?? a ?? big;
      if (!s32 || !s16) return null;
      return { s32: paint(32, g => blit(g, s32.source, s32.width, s32.height, 32)), s16: paint(16, g => blit(g, s16.source, s16.width, s16.height, 16)) };
    }
    if (icon.kind === "guild") {
      // the heraldry loads first so the emblem draws with its device
      await ctx.image(`ui/icon/gate/${icon.symbol}.png`);
      const draw = (size: number) => paint(size, g => drawEmblem(ctx, g as unknown as CanvasRenderingContext2D, icon.symbol, icon.color, 0, 0, size, size));
      draw(32); draw(16);
      // heraldryImage recolours on a microtask after the image: let it land
      await new Promise(r => setTimeout(r, 0));
      return { s32: draw(32), s16: draw(16) };
    }
    const im = await ctx.image(icon.file, icon.colorizations);
    if (!im) return null;
    return {
      s32: paint(32, g => blit(g, im.source, im.width, im.height, 32, icon.crop)),
      s16: paint(16, g => blit(g, im.source, im.width, im.height, 16, icon.crop)),
    };
  }
}

function paint(size: number, draw: (g: CanvasRenderingContext2D) => void): string {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  draw(g);
  return c.toDataURL("image/png");
}

function blit(g: CanvasRenderingContext2D, src: CanvasImageSource, w: number, h: number, size: number, crop?: "card") {
  const r = fitRect(w, h, size, crop);
  // downscaling smooths (a 128-pixel map icon to 16); scaling up stays pixel-crisp
  g.imageSmoothingEnabled = r.dw < r.sw;
  g.imageSmoothingQuality = "high";
  g.drawImage(src, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
}

/** Points the page's icon links (index.html's #favicon, and a 16-pixel one) at the drawn icon. */
function setLinks(r: Rendered) {
  const link = (id: string, size: string) => {
    let l = document.getElementById(id) as HTMLLinkElement | null;
    if (!l) {
      l = document.createElement("link");
      l.id = id;
      l.rel = "icon";
      document.head.appendChild(l);
    }
    l.type = "image/png";
    l.setAttribute("sizes", size);
    return l;
  };
  link("favicon16", "16x16").href = r.s16;
  link("favicon", "32x32").href = r.s32;
}
