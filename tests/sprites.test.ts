import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addHeat, appetite, autoSpend, canEat, chooseUltimate, eat, foodHeat, foodStars, foodTier, freePoints, heatToNext, levelUp, MAX_LEVEL,
  newProgress, normalizeDamage, normalizeSpriteSave, readSpriteDef, readyToLevel, rechargeOf, requiredItem, skillAttackRef, skillPoints,
  spendPoint, spriteTier, SpriteRoster, ultimateReady, unlockedSkills,
} from "../src/game/sprites.ts";

const ref = (name: string, entries: [string, unknown][] = []) => ({ $class: "com.threerings.config.ConfigReference", name, arguments: { $map: "x", entries } });
const DRAKON = readSpriteDef({
  name: "Drakon", spriteName: "m.drakon",
  tier1: ref("character/pet/dragon/t1/model.dat"), tier2: ref("character/pet/dragon/t2/model.dat"), tier3: ref("character/pet/dragon/t3/model.dat"),
  preferredFood: [{ ref: ref("Food/Power Mote") }, { ref: ref("Food/Power Star") }],
  skills: [0, 1, 2].map(i => ({
    skill: ref(`Sprite/Drakon/Skill ${i}`, [["Power1", "0"], ["Power2", "0"], ["Sound", "Drakon"]]),
    uSkillA: ref(`Sprite/Drakon/Skill ${i}, Ultimate A`), uSkillB: ref(`Sprite/Drakon/Skill ${i}, Ultimate B`),
    rechargeSeconds: new Int32Array([20, 18, 16, 14]), followKnight: i === 1,
    name: { name: `m.skill${i}`, icon: { file: `skill${i}.png` } }, powerNames: [{ name: "m.focus" }, { name: "m.a" }, { name: "m.b" }],
  })),
});

test("a battle sprite config reads as models by tier, favoured food and three skills", () => {
  assert.equal(DRAKON.models[2].name, "character/pet/dragon/t3/model.dat");
  assert.deepEqual(DRAKON.food, ["Food/Power Mote", "Food/Power Star"]);
  assert.equal(DRAKON.skills.length, 3);
  assert.deepEqual(DRAKON.skills[0].recharge, [20, 18, 16, 14]);
  assert.equal(DRAKON.skills[1].followKnight, true);
});

test("skills and forms unlock at levels 15 and 50 (shown); 27 points come by level 86", () => {
  assert.deepEqual([0, 13, 14, 48, 49, 99].map(unlockedSkills), [1, 1, 2, 2, 3, 3]);
  assert.deepEqual([0, 14, 49].map(spriteTier), [1, 2, 3]);
  assert.equal(skillPoints(MAX_LEVEL), 27);
  assert.equal(skillPoints(0), 0);
  assert.equal(skillPoints(1), 1);
  assert.equal(skillPoints(84), 26);
  assert.equal(skillPoints(85), 27);
  assert.deepEqual([0, 3, 4, 13, 14, 28, 29, 48, 49, 73, 74, 99].map(foodTier), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.equal(heatToNext(0), 3000);
  assert.equal(heatToNext(99), 15000);
});

test("feeding fills the bar a fifth at most; a full bar levels up with the required item", () => {
  assert.equal(foodHeat(5, true), foodHeat(5, false) * 5);
  assert.deepEqual(["Food/Power Mote", "Food/Wild Dust", "Food/Shadow Stone", "Food/Divine Orb", "Food/Cosmic Star", "Material/Gel Drop"].map(foodStars), [1, 2, 3, 4, 5, 0]);
  const p = newProgress("Drakon");
  addHeat(p, 1e9);
  assert.equal(p.heat, 0.2);
  for (let i = 0; i < 10; i++) addHeat(p, 1e9);
  assert.equal(p.heat, 1);
  assert.equal(p.level, 0, "a full bar waits");
  assert.ok(readyToLevel(p));
  assert.equal(requiredItem(DRAKON, p), "Food/Power Mote");
  assert.equal(levelUp(DRAKON, p, "Food/Power Star"), false);
  assert.equal(levelUp(DRAKON, p, "Food/Power Mote"), true);
  assert.equal(p.level, 1);
  assert.equal(p.heat, 0);
  p.level = 13;
  p.heat = 1;
  assert.equal(requiredItem(DRAKON, p), "Rarity/Evo Catalyst/Evo Catalyst", "level 15 takes an evo catalyst");
  p.level = 74;
  p.heat = 0;
  assert.equal(requiredItem(DRAKON, p), "Food/Power Star", "the tier's favoured food (the last listed)");
});

test("appetite: a feeding takes a fifth; it refills over an hour", () => {
  const p = newProgress("Drakon"), t = 1_000_000_000;
  assert.equal(appetite(p, t), 1);
  for (let i = 0; i < 5; i++) { assert.ok(canEat(p, t)); eat(p, t); }
  assert.equal(canEat(p, t), false);
  assert.equal(Math.floor(appetite(p, t + 12 * 60_000 + 1) * 5), 1);
  assert.ok(canEat(p, t + 12 * 60_000 + 1));
});

test("points go into unlocked skills only, three ranks each; focus shortens the recharge", () => {
  const p = newProgress("Drakon");
  p.level = 13;
  assert.equal(freePoints(p), 6);
  assert.equal(spendPoint(p, 1, 0), false, "second skill locked before 15");
  assert.ok(spendPoint(p, 0, 0) && spendPoint(p, 0, 0) && spendPoint(p, 0, 0));
  assert.equal(spendPoint(p, 0, 0), false, "rank 3 is the top");
  assert.equal(rechargeOf(DRAKON, p, 0), 14);
  p.level = MAX_LEVEL;
  autoSpend(p);
  assert.equal(freePoints(p), 0);
  assert.ok(p.ranks.every(r => r.every(x => x === 3)));
  assert.ok(ultimateReady(p, 0) && ultimateReady(p, 2));
});

test("the skill's attack carries its perk ranks, or becomes an ultimate", () => {
  const p = newProgress("Drakon");
  p.level = MAX_LEVEL;
  p.ranks[0] = [0, 2, 3];
  const r = skillAttackRef(DRAKON, p, 0);
  const args = Object.fromEntries(r.arguments.entries);
  assert.equal(args.Power1, "2");
  assert.equal(args.Power2, "3");
  assert.equal(args.Sound, "Drakon");
  assert.equal(chooseUltimate(p, 1, "B"), true);
  assert.equal(skillAttackRef(DRAKON, p, 1).name, "Sprite/Drakon/Skill 1, Ultimate B");
  p.level = 93;
  assert.equal(chooseUltimate(p, 1, "A"), false, "the second ultimate waits for level 95");
});

test("the roster chooses, feeds from the materials and saves", () => {
  const save: any = { materials: { "Food/Power Star": 2, "Food/Wild Star": 1, "Food/Power Mote": 1 } };
  let writes = 0, changes = 0;
  const roster = new SpriteRoster(() => save, () => { writes++; }, () => new Map([["Drakon", DRAKON], ["Seraphynx", DRAKON]]));
  roster.onChange = () => { changes++; };
  assert.equal(roster.active(), null, "no sprite until one is chosen");
  assert.equal(roster.setSprite("Nope"), false);
  assert.equal(roster.setSprite("Seraphynx"), true);
  assert.equal(save.sprites.active, "Seraphynx");
  assert.equal(save.sprites.chosen, true);
  assert.equal(roster.feed("Food/Power Star", 1e12), "", "a sprite with appetite eats");
  assert.equal(save.materials["Food/Power Star"], 1);
  assert.ok(save.sprites.sprites.Seraphynx.heat > 0);
  assert.notEqual(roster.feed("Food/Nothing", 1e12), "");
  save.sprites.sprites.Seraphynx.heat = 1;
  assert.equal(roster.levelUp("Food/Power Mote"), true);
  assert.equal(save.sprites.sprites.Seraphynx.level, 1);
  assert.equal(save.materials["Food/Power Mote"], undefined);
  assert.ok(writes >= 2 && changes >= 2);
  // the save survives a round trip
  const back = normalizeSpriteSave(JSON.parse(JSON.stringify(save.sprites)));
  assert.equal(back.sprites.Seraphynx.level, save.sprites.sprites.Seraphynx.level);
  assert.equal(back.sprites.Seraphynx.fullAt, save.sprites.sprites.Seraphynx.fullAt);
});

test("class-less damage from parameter paths is named by what it holds", () => {
  const d = normalizeDamage({ damages: [{ depthScale: ref("PC/Damage/Handgun/Handgun Base -20") }, { statusCondition: ref("Fire") }] });
  assert.match(d.$class, /Compound$/);
  assert.match(d.damages[0].$class, /DepthScale$/);
  assert.match(d.damages[1].$class, /Status$/);
});
