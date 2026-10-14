import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bagStore, buyFurniture, cachedPlacements, commitCart, furniEntry, furnitureCatalogue, guildOf, hallRoot, nextRotation, place, snap, transfer, unplace,
} from "../src/game/guild.ts";
import { loadSave } from "../src/game/save.ts";
import { starterGear, validName } from "../src/ui/createknight.ts";

const fresh = () => { const s = loadSave(); s.crowns = 1000; return s; };

test("furniture snaps to tiles: half-tile centres for odd sizes, quarter turns swap the footprint", () => {
  assert.deepEqual(snap(3.2, 7.9, 1, 1, 0), { x: 3.5, y: 7.5, cells: [[3, 7]] });
  const bed = snap(10.1, 20.2, 2, 3, 0);
  assert.deepEqual([bed.x, bed.y, bed.cells.length], [10, 20.5, 6]);
  const turned = snap(10.1, 20.2, 2, 3, 2);
  assert.deepEqual([turned.x, turned.y], [10.5, 20]);
  assert.equal(nextRotation(1, 1, 7), 0);
  assert.equal(nextRotation(2, 3, 0), 2);
  assert.equal(nextRotation(2, 3, 0, true), 6);
});

test("buying, placing and storing furniture keeps the counts", () => {
  const s = fresh(), g = guildOf(s);
  assert.ok(buyFurniture(s, "Furni/Chair/X", 1));
  assert.equal(s.crowns, 600);
  assert.ok(!buyFurniture(s, "Furni/Trophy/Y", 5));
  const p = { item: "Furni/Chair/X", x: 0.5, y: 0.5, z: 3, rot: 0 };
  assert.ok(place(g, p));
  assert.equal(g.furni["Furni/Chair/X"], undefined);
  assert.ok(!place(g, { ...p }));
  unplace(g, p);
  assert.equal(g.furni["Furni/Chair/X"], 1);
  assert.equal(g.placements.length, 0);
});

test("the vault moves materials and crowns both ways", () => {
  const s = fresh();
  s.materials = { "Material/A": 5 };
  assert.ok(transfer(s, "Material/A", 3, true));
  assert.deepEqual([s.materials["Material/A"], s.guild!.vault["Material/A"]], [2, 3]);
  assert.ok(!transfer(s, "Material/A", 4, false));
  assert.ok(transfer(s, "crowns", 250, true));
  assert.deepEqual([s.crowns, s.guild!.treasury], [750, 250]);
});

test("guild bags: storages move gear and materials both ways, the treasury only takes", () => {
  const s = fresh();
  s.materials = { "Material/A": 5 };
  s.owned = [...s.owned, "Weapon/Sword/Spare"];
  s.gear["Weapon/Sword/Spare"] = { heat: 40, level: 3, variants: [] };
  const worn = s.loadout.weapons[0];
  // worn gear cannot be given; a refused line moves nothing
  assert.ok(!commitCart(s, "member", [{ item: worn, count: 1, give: true, gear: true }, { item: "Material/A", count: 2, give: true, gear: false }]));
  assert.equal(s.materials["Material/A"], 5);
  assert.ok(commitCart(s, "member", [{ item: "Weapon/Sword/Spare", count: 1, give: true, gear: true }, { item: "Material/A", count: 2, give: true, gear: false }]));
  assert.ok(!s.owned.includes("Weapon/Sword/Spare"));
  assert.deepEqual(bagStore(guildOf(s), "member").gear["Weapon/Sword/Spare"], { heat: 40, level: 3, variants: [] });
  assert.ok(commitCart(s, "member", [{ item: "Weapon/Sword/Spare", count: 1, give: false, gear: true }]));
  assert.equal(s.gear["Weapon/Sword/Spare"].level, 3);
  // the treasury: materials and crowns in, nothing out, no gear
  assert.ok(commitCart(s, "treasury", [{ item: "Material/A", count: 3, give: true, gear: false }], 100));
  assert.deepEqual([s.materials["Material/A"], guildOf(s).vault["Material/A"], s.crowns, guildOf(s).treasury], [undefined, 3, 900, 100]);
  assert.ok(!commitCart(s, "treasury", [{ item: "Material/A", count: 1, give: false, gear: false }]));
  assert.ok(!commitCart(s, "veteran", [], 10));
});

test("the hall drops the cached furniture and round-trips the player's as Furni Placers", () => {
  const p = { item: "Furni/Bed/Z", x: 4, y: 56.5, z: 3, rot: 3 };
  const cached = { name: "%guild:m.hall|~Them", entries: [furniEntry(7, p), { $class: "X$PlaceableEntry", id: 8, placeable: { name: "Prop/Wall" } }] };
  const back = cachedPlacements(cached);
  assert.equal(back.length, 1);
  assert.deepEqual({ ...back[0], x: back[0].x, rot: back[0].rot }, p);
  const g = guildOf(fresh());
  g.name = "Mine";
  const root = hallRoot(cached, g);
  assert.equal(root.entries.length, 1);
  assert.equal(root.name, "%guild:m.hall|~Mine");
  g.placements.push(p);
  assert.equal(hallRoot(cached, g, true).entries.length, 2);
});

test("the catalogue keeps FurniConfig items and skips their parts", () => {
  const impls: Record<string, any> = {
    "Furni/Chair/A": { $class: "x.FurniConfig$Prop", model: {}, rarity: 2, footprintWidth: 1 },
    "Furni/Chair/Parts/Base": { $class: "x.FurniConfig$Prop", model: {} },
    "Gear/Helm/B": { $class: "x.ItemConfig$Helm", model: {} },
  };
  const list = furnitureCatalogue(Object.keys(impls), n => impls[n]);
  assert.deepEqual(list.map(e => [e.name, e.category, e.rarity]), [["Furni/Chair/A", "Chair", 2]]);
});

test("knight creation offers the Spiral starter styles and checks names", () => {
  const g = starterGear(["Gear/Helm/Spiral Hood (Blue)", "Gear/Helm/Spiral Hood (Red)", "Gear/Armor/Spiral Cloak (Red)", "Gear/Helm/Plate Helm"], () => 0);
  assert.deepEqual([...g.helmets.keys()], ["Spiral Hood"]);
  assert.deepEqual(g.trims, ["Blue", "Red"]);
  assert.equal(validName("Sir Lancelight"), null);
  assert.ok(validName("x"));
  assert.ok(validName("<script>"));
});
