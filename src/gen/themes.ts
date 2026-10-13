// Generated-floor themes: one per tileset in config/tile.dat. Each theme's tiling comes from
// one of three places:
//   learned  from the cached levels that use the tileset (src/gen/autotile.ts)
//   mirror   another theme's tiling with every tile swapped for this tileset's piece of the
//            same name ("Sky Islands, Night/Edge/Edge, cliff 03" for the Day one), or the
//            nearest-named piece where the names differ
//   rules    pieces picked by name and placed by rule (src/gen/rules.ts), for tilesets no
//            cached level uses and no learned tileset resembles
// and its lighting, fog, sky and music from a cached level's globals, with the matching
// scene_global.dat presets ("Environment/Custom/Graveyard/Default/Fog"...) swapped in.
// See docs/research/tilesets.md.

import { learn, remapModel, remapName, type RemapRule, type TileFacts, type TileModel } from "./autotile";
import { ruleModel, type RuleSpec } from "./rules";

type Source =
  /** `scrub`: floor tiles replaced by the theme's most common floor (default: "Null"). */
  | { kind: "learned"; scenes: RegExp; scrub?: RegExp }
  | { kind: "mirror"; of: string; rules: RemapRule[] }
  | { kind: "rules"; spec: RuleSpec };

export interface ThemeDef {
  key: string;
  label: string;
  /** The tileset's name prefix in config/tile.dat. */
  tileset: string;
  source: Source;
  /** The cached level whose globals (camera, lights, fog, music) the floor starts from... */
  globalsFrom: RegExp;
  /** ...and scene_global.dat presets replacing its globals of the same kind. */
  globals?: Preset[];
  /** False for test themes left out of a run's random deeper floors. */
  inRuns?: boolean;
}

/** A scene_global.dat config by name, or a reference with arguments. */
export type Preset = string | { name: string; arguments?: any };
/** A background colour (for themes whose presets leave the source level's sky colour). */
const bg = (r: number, g: number, b: number): Preset => ({ name: "Environment/Background Color", arguments: { $map: "com.threerings.config.ArgumentMap",
  entries: [["Color", { $class: "com.threerings.opengl.renderer.Color4f", r, g, b, a: 1 }]] } });

const CT = "Environment/Custom/Clockwork Tunnels/";
const tunnels = (v: string) => [`${CT}${v}/Background Color`, `${CT}${v}/Fog`, `${CT}${v}/Light Set`, `${CT}${v}/Music Mix`, `${CT}${v}/Skybox - Clockworks, Tier1`];
const UNIVERSAL: Record<string, string[]> = {
  Fire: ["Environment/Custom/Universal/Fire/Embers"],
  Freeze: ["Environment/Custom/Universal/Freeze/Vision Snow"],
  Poison: ["Environment/Custom/Universal/Poison/Rain", "Environment/Custom/Universal/Poison/Sound - Rain"],
  Shock: ["Environment/Custom/Universal/Shock/Lightning"],
};

// Castle, Light (the Dark Halls) names its edge pieces "Rail/..."; the other castle-style
// tilesets call them "Floor Edge/...", and floor where the Dark Halls have ice
const castleRules = (to: string, floor: string): RemapRule[] => [
  { from: "Castle, Light", to, alias: [[/^Rail\//, "Floor Edge/"], [/^Floor Edge\/Back, flat 0\d$/, "Floor Edge/Back, flat"]] },
  { from: "Water/Ice/Walkable", to, alias: [[/^0?(\d+)$/, floor]] },
];
const same = (from: string, to: string): RemapRule[] => [{ from, to }];
// the tunnels' sources also use a few Clockworks Shock pieces (same names in every variant)
const tunnelRules = (to: string): RemapRule[] => [{ from: "Clockworks", to }, { from: "Clockworks Shock", to }];

export const THEMES: ThemeDef[] = [
  // --- Sky Islands: learned from Jigsaw Valley, the other seasons mirror it
  { key: "valley", label: "Jigsaw Valley", tileset: "Sky Islands, Day", source: { kind: "learned", scenes: /^jigsaw valley/i }, globalsFrom: /^jigsaw valley/i },
  { key: "sky-night", label: "Sky Islands by Night", tileset: "Sky Islands, Night",
    source: { kind: "mirror", of: "valley", rules: same("Sky Islands, Day", "Sky Islands, Night") }, globalsFrom: /^jigsaw valley/i,
    globals: ["Environment/Custom/Lichenous Lair/Default/Fog", "Environment/Custom/Lichenous Lair/Default/Light Set",
      "Environment/Custom/Lichenous Lair/Fire/Skybox - Skydome Night", "Environment/Custom/Lichenous Lair/Music Mix", bg(0.114, 0.094, 0.302)] },
  { key: "sky-autumn", label: "Autumn Islands", tileset: "Sky Islands, Autumn",
    source: { kind: "mirror", of: "valley", rules: same("Sky Islands, Day", "Sky Islands, Autumn") }, globalsFrom: /^jigsaw valley/i,
    globals: ["Environment/Custom/Wolver's Den/Default/Fog", "Environment/Custom/Wolver's Den/Default/Light Set",
      "Environment/Custom/Wolver's Den/Default/Background Color", "Environment/Custom/Wolver's Den/Music Mix"] },
  { key: "sky-winter", label: "Winter Islands", tileset: "Sky Islands, Winter",
    source: { kind: "mirror", of: "valley", rules: same("Sky Islands, Day", "Sky Islands, Winter") }, globalsFrom: /^jigsaw valley/i,
    globals: ["Environment/Custom/Wolver's Den/Freeze/Fog", "Environment/Custom/Wolver's Den/Freeze/Light Set",
      "Environment/Custom/Wolver's Den/Freeze/Background Color", "Environment/Custom/Universal/Freeze/Music (Freeze)", ...UNIVERSAL.Freeze] },

  // --- Clockworks: learned from the tunnels, the status variants mirror them
  { key: "clockworks", label: "Clockwork Tunnels", tileset: "Clockworks", source: { kind: "learned", scenes: /^(terminal 1|emberlight|terminal core)/i },
    globalsFrom: /^(terminal 1|emberlight|terminal core)/i },
  ...(["Fire", "Freeze", "Poison", "Shock"] as const).map((v): ThemeDef => ({
    key: "clockworks-" + v.toLowerCase(), label: `Clockwork Tunnels, ${v}`, tileset: `Clockworks ${v}`,
    source: { kind: "mirror", of: "clockworks", rules: tunnelRules(`Clockworks ${v}`) }, globalsFrom: /^(terminal 1|emberlight|terminal core)/i,
    globals: [...tunnels(v), `Environment/Custom/Universal/${v}/Music (${v})`, ...UNIVERSAL[v]],
  })),
  { key: "clockworks-white", label: "Clockwork Tunnels, White", tileset: "Clockworks White",
    source: { kind: "mirror", of: "clockworks", rules: tunnelRules("Clockworks White") }, globalsFrom: /^(terminal 1|emberlight|terminal core)/i,
    globals: ["Environment/Custom/Town/Guild Hall/White/Background Color", "Environment/Custom/Town/Guild Hall/White/Fog",
      "Environment/Custom/Town/Guild Hall/White/Light Set", "Environment/Custom/Town/Guild Hall/White/Skybox - Clockworks, Tier1"] },
  { key: "prize-vault", label: "Prize Vault", tileset: "Prize Vault",
    source: { kind: "mirror", of: "clockworks", rules: tunnelRules("Prize Vault") }, globalsFrom: /^(terminal 1|emberlight|terminal core)/i,
    globals: ["Environment/Custom/Town/Guild Hall/Default/Background Color", "Environment/Custom/Town/Guild Hall/Default/Fog",
      "Environment/Custom/Town/Guild Hall/Default/Light Set", "Environment/Custom/Town/Guild Hall/Default/Skybox - Clockworks, Tier1"] },

  // --- castles: Castle, Light learned from the Dark Halls; the rest mirror its pieces
  { key: "castle-light", label: "Dark Halls", tileset: "Castle, Light", source: { kind: "learned", scenes: /^dark halls/i }, globalsFrom: /^dark halls/i },
  { key: "castle", label: "Castle", tileset: "Castle", source: { kind: "mirror", of: "castle-light", rules: castleRules("Castle", "Floor/Cobblestone 0$1") },
    globalsFrom: /^dark halls/i, globals: ["Environment/Custom/Castle/Skybox - Skydome"] },
  { key: "castle-fire", label: "Castle, Fire", tileset: "Castle, Fire",
    source: { kind: "mirror", of: "castle-light", rules: castleRules("Castle, Fire", "Floor/Cobblestone 0$1") },
    globalsFrom: /^dark halls/i, globals: ["Environment/Custom/Universal/Fire/Music (Fire)", ...UNIVERSAL.Fire] },
  { key: "graveyard", label: "Graveyard", tileset: "Graveyard",
    source: { kind: "mirror", of: "castle-light", rules: castleRules("Graveyard", "Floor/Grass 0$1") }, globalsFrom: /^dark halls/i,
    globals: ["Environment/Custom/Graveyard/Camera", "Environment/Custom/Graveyard/Default/Fog", "Environment/Custom/Graveyard/Default/Light Set",
      "Environment/Custom/Graveyard/Music Mix", bg(0.075, 0.086, 0.149)] },

  // --- Haven's own tiles (world/tileset/outershell), learned from the town
  { key: "haven", label: "Outer Shell", tileset: "Haven", source: { kind: "learned", scenes: /haven/i,
    scrub: /^Null$|Roof|Cube|Field (edge|out|in)|Cobblestone\/Edge/ }, globalsFrom: /haven town square|haven/i },

  // --- rule-based: no cached level and no close relative
  { key: "city", label: "Ruined City", tileset: "City, Base", source: { kind: "rules", spec: {
    prefix: "City, Base", floor: /^Floor, Sidewalk\/Sidewalk 0\d[a-c]$/, wall: /^Floor, Sidewalk\/Edge break 0\d$/,
    cornerIn: /^Floor, Sidewalk\/Edge break IN/, cornerOut: /^Floor, Sidewalk\/Edge break OUT/ } },
    globalsFrom: /^(terminal 1|emberlight|terminal core)/i,
    globals: ["Environment/Custom/Battle Arena/Default/Background Color", "Environment/Custom/Battle Arena/Default/Fog",
      "Environment/Custom/Battle Arena/Default/Light Set", "Environment/Custom/Battle Arena/Default/Music Mix"] },
  { key: "whitespace", label: "Whitespace", tileset: "Whitespace", source: { kind: "rules", spec: {
    prefix: "Whitespace", floor: /^Floor\/(Base 1 unit - 01|Tile - 1 unit, (dark|light|small tiles 0\d))$/, wall: /^Rail\/Featureless/,
    cornerIn: /^Rail\/Corner - In, base/, cornerOut: /^Rail\/Corner - Out, base/ } },
    globalsFrom: /^(terminal 1|emberlight|terminal core)/i,
    globals: ["Environment/Custom/Town/Guild Hall/White/Fog", "Environment/Custom/Town/Guild Hall/White/Light Set", bg(0.85, 0.87, 0.9)] },
  { key: "ice", label: "Frozen Pools", tileset: "Water", source: { kind: "rules", spec: {
    prefix: "Water", floor: /^Ice\/Walkable\/0\d$/, wall: /^Ice\/edge [NSEW]$/, sided: { edge: "Ice/edge $", out: "Ice/out $", in: "Ice/in $" } } },
    globalsFrom: /^dark halls/i,
    globals: ["Environment/Custom/Missions/Prestige/Heart of Ice/Fog", "Environment/Custom/Missions/Prestige/Heart of Ice/Light Set",
      "Environment/Custom/Universal/Freeze/Music (Freeze)", ...UNIVERSAL.Freeze] },
  { key: "dev", label: "Test Chamber", tileset: "000_Dev", inRuns: false, source: { kind: "rules", spec: {
    prefix: "000_Dev", floor: /^Floor\/Floor, gray$/, wall: /^Wall, Volumetric\/Wall x1$/,
    cornerIn: /^Wall, Volumetric\/Corner In x1$/, cornerOut: /^Wall, Volumetric\/Corner Out x1$/ } },
    globalsFrom: /^(terminal 1|emberlight|terminal core)/i },
  { key: "generic", label: "Plank Cellar", tileset: "Generic", inRuns: false, source: { kind: "rules", spec: {
    prefix: "Generic", floor: /^Plank x1/, wall: /^Interior, Walls\/Haven whitewash, 0\d$/, front: "Null, no-walk", wallRot: 1 } },
    globalsFrom: /haven/i },
];

export const themeByKey = (key: string) => THEMES.find(t => t.key === key) ?? null;

/** What a theme needs from the game data. */
export interface ThemeContext {
  /** The cached levels (id and display name). */
  scenes: { id: string; name: string }[];
  readRoot(id: string): Promise<any>;
  /** Every config name in config/tile.dat. */
  tileNames(): Promise<string[]>;
  tileInfo(ref: any): Promise<TileFacts>;
}

/** Everything generateLevel needs for a theme. */
export interface ThemeLevel {
  def: ThemeDef;
  /** Cached levels whose spawners, treasure and elevators the floor reuses (may be empty). */
  sources: { id: string; root: any }[];
  model: TileModel;
  /** GlobalEntry records: camera, lights, fog, sky, music. */
  globals: any[];
}

const refKey = (r: any) => JSON.stringify(r, (k, v) => (k === "$outer" ? undefined : v));
const CLS = "com.threerings.tudey.data.TudeySceneModel$GlobalEntry";

/** What kind of global a scene_global reference is, so a preset replaces its counterpart. */
export function globalKind(name: string): string {
  if (/Camera/.test(name)) return "camera";
  if (/Skybox/.test(name)) return "sky";
  if (/Music/.test(name)) return "music";
  if (/Light|Ambient/.test(name)) return "light";
  if (/Fog$/.test(name)) return "fog";
  if (/Background Color/.test(name)) return "background";
  if (/Shadow Color/.test(name)) return "shadow";
  return "extra:" + name;
}

/** A level's globals with presets swapped in: each preset replaces the globals of its kind. */
export function mergeGlobals(base: any[], presets: Preset[]): any[] {
  const refs = presets.map(p => typeof p === "string" ? { name: p } : p);
  const kinds = new Set(refs.map(r => globalKind(r.name)));
  // a skybox preset also replaces the level's sky models ("Environment/Model" with a skybox)
  const sky = (e: any) => e.sceneGlobal?.name === "Environment/Model" && /skybox/.test(refKey(e.sceneGlobal));
  const kept = base.filter(e => !kinds.has(globalKind(e.sceneGlobal?.name ?? "")) && !(kinds.has("sky") && sky(e)));
  const added = refs.map(r => ({ $class: CLS, sceneGlobal: { $class: "com.threerings.config.ConfigReference", ...r } }));
  return [...kept, ...added].map((e, i) => ({ ...e, id: i + 1 }));
}

const models = new Map<string, Promise<{ model: TileModel; sources: { id: string; root: any }[] }>>();

/** The tiling model and source levels of a theme (cached per theme). */
function themeModel(def: ThemeDef, ctx: ThemeContext): Promise<{ model: TileModel; sources: { id: string; root: any }[] }> {
  let p = models.get(def.key);
  if (!p) {
    p = buildModel(def, ctx);
    p.catch(() => models.delete(def.key));
    models.set(def.key, p);
  }
  return p;
}

async function tileFacts(ctx: ThemeContext, prefixes: string[]): Promise<Map<string, TileFacts>> {
  const out = new Map<string, TileFacts>();
  for (const n of await ctx.tileNames()) {
    if (prefixes.some(p => n.startsWith(p + "/"))) out.set(n, await ctx.tileInfo({ name: n }));
  }
  return out;
}

async function buildModel(def: ThemeDef, ctx: ThemeContext): Promise<{ model: TileModel; sources: { id: string; root: any }[] }> {
  const src = def.source;
  if (src.kind === "learned") {
    const ids = ctx.scenes.filter(s => src.scenes.test(s.name)).map(s => s.id);
    if (!ids.length) throw new Error(`no cached levels for ${def.label}`);
    const sources = await Promise.all(ids.map(async id => ({ id, root: await ctx.readRoot(id) })));
    // resolve every tile the sources use first; learning asks synchronously
    const infos = new Map<string, TileFacts>();
    for (const s of sources) for (const m of (s.root.tileConfigs?.items ?? s.root.tileConfigs ?? []) as any[]) {
      const k = refKey(m?.tile);
      if (m?.tile && !infos.has(k)) infos.set(k, await ctx.tileInfo(m.tile));
    }
    const info = (r: any) => infos.get(refKey(r)) ?? { width: 1, height: 1, walkable: false };
    const model = learn(sources.map(s => s.root), r => { const t = info(r); return [t.width, t.height]; }, r => info(r).walkable);
    // floor pieces that make no sense on their own (the invisible walkable "Null" tile under
    // the town's props, rooftops, path trims) become the theme's most common floor
    const scrub = src.scrub ?? /^Null$/;
    const weight = new Map<number, number>();
    for (const [k, list] of model.cases) if (k[0] === "1") for (const o of list) weight.set(o.tile, (weight.get(o.tile) ?? 0) + o.weight);
    const top = [...weight].filter(([t]) => !scrub.test(model.tiles[t]?.name ?? "")).sort((a, b) => b[1] - a[1])[0];
    const floor = top ? model.tiles[top[0]].name : null;
    const walkable = new Set([...weight.keys()].map(t => model.tiles[t]?.name));
    return { model: floor ? remapModel(model, n => walkable.has(n) && scrub.test(n) ? floor : null) : model, sources };
  }
  if (src.kind === "mirror") {
    const base = themeByKey(src.of)!;
    const { model, sources } = await themeModel(base, ctx);
    const target = await tileFacts(ctx, [def.tileset]);
    const facts = new Map<string, TileFacts>();
    for (const r of model.tiles) if (r?.name && !facts.has(r.name)) facts.set(r.name, await ctx.tileInfo(r));
    return { model: remapModel(model, name => remapName(name, src.rules, target, facts.get(name))), sources };
  }
  return { model: ruleModel(src.spec, await tileFacts(ctx, [src.spec.prefix])), sources: [] };
}

/**
 * Everything generateLevel needs for a theme: the tiling, the levels to borrow wiring from,
 * and the globals. Throws when the theme's source levels are not cached.
 */
export async function themeLevel(key: string, ctx: ThemeContext): Promise<ThemeLevel> {
  const def = themeByKey(key);
  if (!def) throw new Error("unknown theme " + key);
  const { model, sources } = await themeModel(def, ctx);
  const from = ctx.scenes.find(s => def.globalsFrom.test(s.name));
  const root = sources.find(s => s.id === from?.id)?.root ?? (from ? await ctx.readRoot(from.id) : null);
  const base = ((root?.entries ?? []) as any[]).filter(e => e.$class.endsWith("GlobalEntry"));
  return { def, sources, model, globals: mergeGlobals(base, def.globals ?? []) };
}

/** Whether a theme can be generated with the levels in the cache (and is meant for runs). */
export function themeAvailable(key: string, scenes: { name: string }[]): boolean {
  let def = themeByKey(key);
  if (def?.inRuns === false) return false;
  while (def?.source.kind === "mirror") def = themeByKey(def.source.of);
  if (!def) return false;
  return def.source.kind === "rules" || scenes.some(s => (def!.source as { scenes: RegExp }).scenes.test(s.name));
}
