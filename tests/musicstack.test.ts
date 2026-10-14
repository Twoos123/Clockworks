import assert from "node:assert/strict";
import { test } from "node:test";
import { applyArguments } from "../src/config/params.ts";
import { Entity, Logic, type LogicHost } from "../src/game/logic.ts";
import { MusicPlayer, type MusicAudio } from "../src/game/musicplayer.ts";
import { MusicStacks, scriptedMusic } from "../src/game/musicstack.ts";
import { assemble, assembledRoot, type LibPiece } from "../src/gen/assemble.ts";

const T = "com.threerings.tudey.config.";
const REF = "com.threerings.config.ConfigReference";
const P = (name: string, path: string) => ({ $class: "com.threerings.config.Parameter$Direct", name, paths: [path] });
const argMap = (entries: [string, unknown][]) => ({ $map: "com.threerings.config.ArgumentMap", entries });
/** config/actor.dat's "Environment/Music", as the install has it. */
const MUSIC_ACTOR = {
  name: "Environment/Music",
  implementation: {
    $class: "com.threerings.projectx.dungeon.config.DungeonActorConfig$Block",
    tags: { tags: [""] },
    sprite: {
      $class: "com.threerings.tudey.config.ActorSpriteConfig$Default",
      destructionTransient: { $class: REF, name: "model/scripted/play_sound_clip.dat", arguments: argMap([["File", null], ["Gain", 1], ["Pitch", 1], ["Range", "Medium"]]) },
      model: { $class: REF, name: "world/environment/global_music_stack.dat", arguments: argMap([["Fade In", 0], ["Fade Out", 0], ["File", null], ["Gain", 1], ["Override", false], ["Stack", "default"]]) },
    },
  },
  parameters: [
    P("File", 'implementation.sprite.model["File"]'), P("Stack", 'implementation.sprite.model["Stack"]'),
    P("Override", 'implementation.sprite.model["Override"]'), P("Gain", 'implementation.sprite.model["Gain"]'),
    P("Fade In", 'implementation.sprite.model["Fade In"]'), P("Fade Out", 'implementation.sprite.model["Fade Out"]'),
    P("Tag", "implementation.tags.tags[0]"), P("Destruction Transient", "implementation.sprite.destruction_transient"),
  ],
};
const fanfare = { $class: REF, name: "model/scripted/play_sound_clip.dat", arguments: argMap([["File", "sound/music/fanfare_victory_1.ogg"], ["Gain", 1], ["Pitch", 1], ["Range", "Medium"]]) };
const musicRef = (file: string, tag: string, o: { override?: boolean; fadeIn?: number; fadeOut?: number; transient?: boolean } = {}) => ({
  $class: REF, name: "Environment/Music", arguments: argMap([
    ["Destruction Transient", o.transient ? fanfare : null], ["Fade In", o.fadeIn ?? 0], ["Fade Out", o.fadeOut ?? 3],
    ["File", `sound/music/${file}.ogg`], ["Override", o.override ?? true], ["Stack", "default"], ["Tag", tag]]),
});
const spawn = (actor: any) => ({ $class: T + "ActionConfig$SpawnActor", actor });
const destroy = (tag: string) => ({ $class: T + "ActionConfig$DestroyActor", target: { $class: T + "TargetConfig$Tagged", tag } });

test("an Environment/Music actor's arguments give its stream and its transient", () => {
  const cfg = applyArguments(MUSIC_ACTOR, musicRef("battle_1", "music 1c", { transient: true })).implementation;
  assert.deepEqual(scriptedMusic(cfg), { file: "sound/music/battle_1.ogg", gain: 1, fadeIn: 0, fadeOut: 3, override: true, stack: "default",
    transient: { file: "sound/music/fanfare_victory_1.ogg", gain: 1, pitch: 1 } });
  assert.equal(cfg.tags.tags[0], "music 1c");
  assert.equal(scriptedMusic(applyArguments(MUSIC_ACTOR, musicRef("main_theme", "music 1g")).implementation)?.transient, null);
  assert.equal(scriptedMusic({ sprite: { model: { name: "world/prop/crate.dat" } } }), null);
});

test("stacks follow Clyde's StackedStream: override displaces the top level, else joins it", () => {
  const s = new MusicStacks<string>();
  s.push("floor", "default", false);
  assert.deepEqual(s.playing("default"), ["floor"]);
  assert.deepEqual(s.push("battle", "default", true), ["floor"]);
  assert.deepEqual(s.playing("default"), ["battle"]);
  assert.deepEqual(s.push("drums", "default", false), []);
  assert.deepEqual(s.playing("default"), ["battle", "drums"]);
  // the level below comes back only once its top level empties
  assert.deepEqual(s.pop("battle"), []);
  assert.deepEqual(s.pop("drums"), ["floor"]);
  assert.deepEqual(s.playing("other"), []);
});

/** An audio system that records what it is asked. */
function fakeAudio() {
  const log: string[] = [];
  const layers = new Set<string>();
  const audio: MusicAudio = {
    playMix: (files, gain, _cf, fadeIn, fadeOut) => { log.push(`main ${files[0].file.replace(/^.*\//, "")} gain=${gain} in=${fadeIn} out=${fadeOut}`); },
    stinger: async f => { log.push("stinger " + f.replace(/^.*\//, "")); },
    transient: f => { log.push("transient " + f.replace(/^.*\//, "")); },
    layer: f => { const n = f.replace(/^.*\//, ""); layers.add(n); log.push("layer " + n); return () => { layers.delete(n); log.push("unlayer " + n); }; },
    stopMusic: () => { log.push("stop"); },
    unlock: () => {},
  };
  return { audio, log, layers };
}

test("level logic spawning and destroying music actors drives the music stack", () => {
  const { audio, log, layers } = fakeAudio();
  const player = new MusicPlayer(() => audio);
  // a world whose logic host creates music actors the way World.createActor does
  const world: any = { musicActors: [], onMusic: null, defeated: false, knight: null, monsters: [], arena: null, liveMonsters: [] };
  const host: LogicHost = {
    createActor(ref, x, y) {
      const cfg = applyArguments(MUSIC_ACTOR, ref).implementation;
      const e = new Entity(true, ref.name);
      e.x = x; e.y = y;
      e.tags = cfg.tags.tags.filter(Boolean);
      const music = scriptedMusic(cfg);
      if (music) { const m = { entity: e, music }; e.game = { music: m }; world.musicActors.push(m); world.onMusic?.("spawn", m); }
      return e;
    },
    actorDestroyed(e) {
      const m = e.game?.music, i = world.musicActors.indexOf(m);
      if (i >= 0) { world.musicActors.splice(i, 1); world.onMusic?.("destroy", m); }
    },
    fireEffect() {}, gameAction() { return undefined; },
  };
  const logic = new Logic(host);
  world.logic = logic;
  const platform = new Entity(false, "Dynamic/Switch/Party Platform/Base");
  logic.addEntry(platform, []);
  logic.startEntries();
  // the court's arena spawned its main theme while the logic started, before the music player listened
  logic.execute(spawn(musicRef("main_theme", "music 1g")), platform, null);
  player.enter({ scene: "royal jelly court", sceneMusic: { files: [{ file: "sound/music/royal_jelly.ogg", weight: 1 }], gain: 0.45, crossFade: 0 } as any, world });
  try {
    assert.equal(player.playing?.files[0].file, "sound/music/main_theme.ogg");
    assert.ok(player.scriptedOnTop);
    // a wave room's battle music overrides it...
    logic.execute(spawn(musicRef("battle_1", "music 1c", { transient: true })), platform, null);
    assert.equal(player.playing?.files[0].file, "sound/music/battle_1.ogg");
    assert.equal(log.at(-1), "main battle_1.ogg gain=1 in=0 out=0");
    // ...and the last wave's fall destroys it: the fanfare, and the main theme back over Fade Out
    logic.execute(destroy("music 1c"), platform, null);
    assert.deepEqual(log.slice(-2), ["transient fanfare_victory_1.ogg", "main main_theme.ogg gain=1 in=3 out=3"]);
    // music without Override plays alongside the top level, and goes with it when that is displaced
    logic.execute(spawn(musicRef("fiend", "music 2", { override: false, fadeIn: 3, fadeOut: 2 })), platform, null);
    assert.ok(layers.has("fiend.ogg"));
    logic.execute(spawn(musicRef("battle_2", "music 3", { transient: true })), platform, null);
    assert.ok(!layers.has("fiend.ogg"));
    assert.equal(player.playing?.files[0].file, "sound/music/battle_2.ogg");
    logic.execute(destroy("music 3"), platform, null);
    assert.ok(layers.has("fiend.ogg"));
    assert.equal(player.playing?.files[0].file, "sound/music/main_theme.ogg");
    // with every scripted stream gone, the floor's own track
    logic.execute(destroy("music 2"), platform, null);
    logic.execute(destroy("music 1g"), platform, null);
    assert.equal(player.playing?.files[0].file, "sound/music/royal_jelly.ogg");
    assert.ok(!player.scriptedOnTop);
    assert.equal(world.musicActors.length, 0);
  } finally {
    player.leave();
  }
  assert.equal(world.onMusic, null);
});

test("an assembled floor keeps a room's music spawn and its destroying trigger on one tag", () => {
  const entry = (name: string, args: [string, unknown][], x: number) => ({
    $class: "com.threerings.tudey.data.TudeySceneModel$PlaceableEntry",
    placeable: { $class: REF, name, arguments: argMap(args) }, transform: { translation: { x, y: 1, z: 0 } },
  });
  // a battle room as the cut leaves it: its platform spawns the music, its trigger ends it when the wave falls
  const room = (label: string, kind: LibPiece["kind"], x0: number, openings: LibPiece["openings"], num: string): LibPiece => ({
    label, file: label, kind, source: "1", base: 0,
    tiles: [], cells: ["0,0", "1,0", "2,0"].map(k => k), walk: ["0,0", "1,0", "2,0"], openings,
    entries: [
      entry("Dynamic/Switch/Party Platform/Base", [["Music", spawn(musicRef("battle_1", `${num}_auto_music 1`, { transient: true }))]], x0),
      entry("Trigger/Actor Removed", [["Actor Tag", `${num}_auto_wave 1`], ["Action", destroy(`${num}_auto_music 1`)]], x0 + 1),
    ],
  });
  const lib: LibPiece[] = [
    { ...room("elevator_start_E_3w_01", "start", 0, [{ side: "E", x: 2, y: 0, width: 1 }], "5"), entries: [] },
    room("room_general_EW_3w_01", "room", 0, [{ side: "W", x: 0, y: 0, width: 1 }, { side: "E", x: 2, y: 0, width: 1 }], "7"),
    room("room_general_EW_3w_02", "room", 0, [{ side: "W", x: 0, y: 0, width: 1 }, { side: "E", x: 2, y: 0, width: 1 }], "7"),
    { ...room("elevator_next_W_3w_01", "exit", 0, [{ side: "W", x: 0, y: 0, width: 1 }], "9"), entries: [] },
  ];
  const a = assemble(lib, 3, { before: 2, after: 0, attempts: 10 });
  assert.ok(a, "assembled");
  const out = assembledRoot(a!, [], "test");
  const json = (e: any) => JSON.stringify(e);
  const spawned = out.entries.filter((e: any) => /Party Platform/.test(json(e))).map((e: any) => /"(\d+_auto_music 1)"/.exec(json(e))![1]);
  const ended = out.entries.filter((e: any) => /Actor Removed/.test(json(e))).map((e: any) => /"(\d+_auto_music 1)"/.exec(json(e))![1]);
  // the two rooms (both numbered 7 where they were captured) get tags of their own, each pair kept together
  assert.equal(spawned.length, 2);
  assert.deepEqual(spawned, ended);
  assert.notEqual(spawned[0], spawned[1]);
});
