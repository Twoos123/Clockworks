import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { arcadeGates, gateFloors, STYLES } from "../src/game/clockworks.ts";
import { BOSS_MUSIC, ELEMENT_MUSIC, floorMusic, levelMusic, mappedFiles, MISSION_MUSIC, PLACES, sceneMusic, STYLE_MUSIC } from "../src/game/music.ts";
import { MusicPlayer, type MusicAudio } from "../src/game/musicplayer.ts";
import { spawnsMusic } from "../src/game/musicstack.ts";

test("every floor of every gate plays music (but the Core's silent terminal), bosses their level's track, element strata their element", () => {
  for (let day = 20000; day < 20030; day++) {
    for (const g of arcadeGates(day)) {
      for (const f of gateFloors(g)) {
        const t = floorMusic(f);
        // terminal core names no music global: the client plays none there
        if (f.kind === "core") { assert.equal(t, PLACES.core); assert.equal(t.files.length, 0); continue; }
        assert.ok(t.files.length > 0 && t.gain > 0, `depth ${f.depth} of ${g.name}`);
        if (f.kind === "boss") assert.equal(t, BOSS_MUSIC[f.stratum!.boss!].level);
        else if (f.kind === "level" && ELEMENT_MUSIC[f.stratum!.theme]) assert.equal(t, ELEMENT_MUSIC[f.stratum!.theme]);
        else if (f.kind === "terminal") assert.equal(t, PLACES.terminal);
      }
    }
  }
});

test("every level style has its own music, and unknown tilesets still find some", () => {
  for (const s of STYLES) assert.ok(STYLE_MUSIC[s.key], `style ${s.key}`);
  assert.equal(levelMusic("Undead", "tunnels", "clockworks").files[0].file, "sound/music/undead.ogg");
  assert.equal(levelMusic("Beast", null, "valley-night").files[0].file, "sound/music/beast.ogg");
  assert.equal(levelMusic(null, null, "ice-caves").files[0].file, "sound/music/freeze.ogg");
  assert.ok(levelMusic(null, null, "something-new").files.length);
  // missions: the family's track, or the element's
  assert.equal(levelMusic("Undead", "mission", "castle").files[0].file, "sound/music/undead.ogg");
  assert.equal(levelMusic("Beast", "mission", "clockworks-freeze").files[0].file, "sound/music/freeze.ogg");
  assert.equal(levelMusic(null, null, "prize-vault").files[0].file, "sound/music/treasure_vault.ogg");
  assert.equal(sceneMusic("haven town square"), PLACES.haven);
  assert.equal(sceneMusic("terminal core"), PLACES.core);
});

test("every mapped file is in the install's music (when the install is present)", () => {
  const dir = join(process.env.SK_DIR ?? "C:/Program Files (x86)/Steam/steamapps/common/Spiral Knights", "rsrc", "sound", "music");
  if (!existsSync(dir)) return;
  const have = new Set(readdirSync(dir).map(f => "sound/music/" + f));
  const mapped = mappedFiles();
  for (const f of mapped) assert.ok(have.has(f), f);
  // and every track the install has is placed somewhere
  for (const f of have) if (f.endsWith(".ogg")) assert.ok(mapped.has(f), `unmapped ${f}`);
});

test("every table entry cites its data, and the few the data leaves open say GUESS", () => {
  const all = [...Object.values(PLACES), ...Object.values(MISSION_MUSIC), ...Object.values(STYLE_MUSIC),
    ...Object.values(BOSS_MUSIC).flatMap(b => [b.level, b.fight])];
  for (const t of all) assert.ok(!/^ours\b/.test(t.source), t.source);
  const guesses = all.filter(t => /^GUESS:/.test(t.source));
  assert.deepEqual(new Set(guesses), new Set([PLACES.arenaBoss, STYLE_MUSIC.compound, STYLE_MUSIC.pools]));
});

const floorOf = (kind: string) => {
  for (let day = 20000; day < 20030; day++) for (const g of arcadeGates(day)) for (const f of gateFloors(g)) if (f.kind === kind) return f;
  throw new Error("no " + kind);
};
const own = { files: [{ file: "sound/music/royal_jelly.ogg", weight: 1 }], gain: 0.45, crossFade: 0 };

test("a gate floor on an archived level plays that level's own music global; a generated one the table's", () => {
  const level = floorOf("level"), boss = floorOf("boss");
  for (const f of [level, boss]) {
    const t = MusicPlayer.choose({ scene: "royal jelly lair", sceneMusic: own, archived: true, floor: f })!;
    assert.deepEqual(t.files, own.files);
    assert.equal(t.gain, 0.45);
    // generated floors' globals are their source level's, so the table decides
    assert.deepEqual(MusicPlayer.choose({ scene: "gen", sceneMusic: own, archived: false, floor: f }), floorMusic(f));
    // an archived level naming no music falls back to the table
    assert.deepEqual(MusicPlayer.choose({ scene: "x", sceneMusic: null, archived: true, floor: f }), floorMusic(f));
  }
  // outside a gate: the scene's own, else by name
  assert.deepEqual(MusicPlayer.choose({ scene: "haven town square", sceneMusic: own })!.files, own.files);
  assert.equal(MusicPlayer.choose({ scene: "hall of heroes star1", sceneMusic: null }), PLACES.hallOfHeroes);
});

test("spawnsMusic finds a level's Environment/Music spawns in its entries' handlers", () => {
  const spawn = { $class: "com.threerings.tudey.config.ActionConfig$SpawnActor", actor: { name: "Environment/Music" } };
  assert.ok(spawnsMusic([{ handlers: [{ action: { actions: [{ $class: "x$Signal" }, spawn] } }] }]));
  assert.ok(!spawnsMusic([{ handlers: [{ action: { ...spawn, actor: { name: "Character/Npc/Monster/Gremlin" } } }] }, { handlers: [] }]));
});

/** A knight beside a roused boss. */
const bossWorld = () => ({
  musicActors: [], onMusic: null, defeated: false, knight: { x: 0, y: 0 }, arena: null, liveMonsters: [],
  monsters: [{ entity: { name: "Character/Npc/Monster/Boss/Royal Jelly" }, x: 1, y: 0, state: "attack" }],
  logic: { actors: [] },
}) as any;
function recorder() {
  const log: string[] = [];
  const audio: MusicAudio = {
    playMix: files => { log.push(files.map(f => f.file.replace(/^.*\//, "")).join("+")); },
    playMusic: async () => {}, stinger: async f => { log.push("stinger " + f.replace(/^.*\//, "")); },
    transient: () => {}, layer: () => () => {}, stopMusic: () => { log.push("stop"); }, unlock: () => {},
  };
  return { audio, log };
}

test("a boss lair that scripts its fight keeps our fight track out; a generated arena plays it", async () => {
  for (const scripted of [true, false]) {
    const { audio, log } = recorder();
    const player = new MusicPlayer(() => audio);
    player.enter({ scene: "royal jelly lair", sceneMusic: own, archived: scripted, scriptsMusic: scripted, boss: "jelly", world: bossWorld() });
    await new Promise(r => setTimeout(r, 400));
    player.leave();
    assert.equal(log[0], "royal_jelly.ogg");
    assert.equal(log.includes("boss_1.ogg"), !scripted, scripted ? "the lair's own boss_1 actor plays it" : "the arena's fallback");
  }
});

test("the Core's terminal is silent", () => {
  const { audio, log } = recorder();
  const player = new MusicPlayer(() => audio);
  player.enter({ scene: "terminal core", sceneMusic: null, archived: true, floor: floorOf("core"), world: bossWorld() });
  player.leave();
  assert.deepEqual(log, ["stop"]);
});
