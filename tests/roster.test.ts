import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addKnight, deleteKnight, LEGACY_KEY, loadRoster, MAX_KNIGHTS, namedKnights, parseRoster, playedText, ROSTER_KEY, selectKnight, storeKnight,
  writeRoster, type SaveStore,
} from "../src/game/save.ts";

class MemoryStore implements SaveStore {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}

const legacy = { version: 2, crowns: 4321, runs: 3, bestDepth: 12, color: 1031, owned: ["Weapon/Sword/Calibur"],
  loadout: { weapons: ["Weapon/Sword/Calibur"], shield: "Gear/Shield/Proto Shield", armor: "", helmet: "", trinkets: [], vitapod: "" },
  knight: { name: "Twoos", helmet: "", armor: "" }, missions: { rank: 2, completed: ["a"], cycles: {} } };

test("the old single save moves into the first slot with its progress, and the old key goes", () => {
  const s = new MemoryStore();
  s.setItem(LEGACY_KEY, JSON.stringify(legacy));
  const r = loadRoster(s);
  assert.equal(r.knights.length, 1);
  assert.equal(r.current, 0);
  const k = r.knights[0];
  assert.equal(k.knight?.name, "Twoos");
  assert.equal(k.crowns, 4321);
  assert.equal(k.runs, 3);
  assert.equal(k.color, 1031);
  assert.ok(k.owned.includes("Weapon/Sword/Calibur"));
  assert.ok(k.owned.includes("Weapon/Sword/Proto Sword"), "the starting gear is still owned");
  assert.deepEqual((k.missions as any).completed, ["a"]);
  assert.equal(s.getItem(LEGACY_KEY), null);
  assert.ok(s.getItem(ROSTER_KEY));
  // read again: the same knight, from the roster this time
  const again = loadRoster(s);
  assert.equal(again.knights[0].knight?.name, "Twoos");
  assert.equal(again.knights[0].crowns, 4321);
});

test("an old save whose knight was never made still moves, and creation reuses its slot", () => {
  const r = parseRoster(null, JSON.stringify({ ...legacy, knight: undefined }));
  assert.equal(r.knights.length, 1);
  assert.equal(namedKnights(r).length, 0);
  assert.equal(addKnight(r), 0, "the unfinished slot is reused");
  assert.equal(r.knights[0].crowns, 4321, "keeping its progress");
});

test("a stored roster wins over an old save", () => {
  const s = new MemoryStore();
  s.setItem(ROSTER_KEY, JSON.stringify({ version: 1, knights: [{ ...legacy, knight: { name: "A", helmet: "", armor: "" } }], current: 0 }));
  s.setItem(LEGACY_KEY, JSON.stringify({ ...legacy, knight: { name: "Old", helmet: "", armor: "" } }));
  const r = loadRoster(s);
  assert.deepEqual(r.knights.map(k => k.knight?.name), ["A"]);
});

test("broken storage gives an empty roster", () => {
  assert.deepEqual(parseRoster("{oops", "nope"), { version: 1, knights: [], current: -1 });
  assert.deepEqual(parseRoster(null, null), { version: 1, knights: [], current: -1 });
});

test("knights keep separate progress; each write lands in its own slot", () => {
  const s = new MemoryStore();
  const r = parseRoster(null, null);
  const a = addKnight(r);
  r.knights[a].knight = { name: "Alpha", helmet: "", armor: "" };
  r.knights[a].crowns = 100;
  const b = addKnight(r);
  assert.notEqual(a, b);
  r.knights[b].knight = { name: "Beta", helmet: "", armor: "" };
  r.knights[b].crowns = 7;
  r.knights[b].owned.push("Weapon/Handgun/Blaster");
  writeRoster(r, s);
  const back = loadRoster(s);
  assert.deepEqual(namedKnights(back).map(k => [k.save.knight?.name, k.save.crowns]), [["Alpha", 100], ["Beta", 7]]);
  assert.ok(!back.knights[a].owned.includes("Weapon/Handgun/Blaster"), "the arsenals are separate");
  assert.equal(back.current, b);
  // playing Alpha: its save is the current one; a changed copy is stored back in its slot
  const alpha = selectKnight(back, a)!;
  const changed = { ...alpha, crowns: 250 };
  storeKnight(back, changed);
  assert.equal(back.knights[a].crowns, 250);
  assert.equal(back.knights[b].crowns, 7);
});

test("time played reads days:hours:minutes:seconds, as the card shows it", () => {
  assert.equal(playedText(0), "00:00:00:00");
  assert.equal(playedText(17 * 86400 + 5 * 3600 + 23 * 60 + 35.9), "17:05:23:35");
});

test("time played is kept with each knight's save", () => {
  const r = parseRoster(JSON.stringify({ version: 1, knights: [{ ...legacy, played: 125.5 }, { ...legacy, played: "junk" }], current: 0 }), null);
  assert.equal(r.knights[0].played, 125.5);
  assert.equal(r.knights[1].played, 0);
});

test("three knights at most; deleting one frees its slot and keeps the current knight", () => {
  const r = parseRoster(null, null);
  for (let i = 0; i < MAX_KNIGHTS; i++) { addKnight(r); r.knights[i].knight = { name: "K" + i, helmet: "", armor: "" }; }
  assert.equal(addKnight(r), -1);
  selectKnight(r, 2);
  assert.ok(deleteKnight(r, 0));
  assert.deepEqual(r.knights.map(k => k.knight?.name), ["K1", "K2"]);
  assert.equal(r.current, 1, "still K2");
  assert.ok(deleteKnight(r, 1));
  assert.equal(r.current, -1, "the current knight was deleted");
  assert.equal(addKnight(r), 1);
});
