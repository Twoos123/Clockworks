import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { arcadeGates, gateFloors, STYLES } from "../src/game/clockworks.ts";
import { BOSS_MUSIC, ELEMENT_MUSIC, floorMusic, levelMusic, mappedFiles, PLACES, sceneMusic, STYLE_MUSIC } from "../src/game/music.ts";

test("every floor of every gate plays music, bosses their level's track, element strata their element", () => {
  for (let day = 20000; day < 20030; day++) {
    for (const g of arcadeGates(day)) {
      for (const f of gateFloors(g)) {
        const t = floorMusic(f);
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
