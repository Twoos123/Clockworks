// Checks that every weapon in config/item.dat fires something: each of its attacks (the
// chain, the charge, the incomplete charge) resolves, and each fire action either strikes (a
// hit shape), runs an action, or spawns an actor the game can fly (a bullet, bomb, disk,
// mixer core or satellite, through GameData.projectile). No browser: the same data path the
// game uses, run on the install from node.
// Usage: npx tsx tools/audit/weapon-fire.ts [name filter] [--all]
import { GameData, type AttackDef } from "../../src/game/data.ts";
import { nodeLoader } from "./nodevfs.ts";

const args = process.argv.slice(2);
const all = args.includes("--all");
const filter = (args.find(a => !a.startsWith("--")) ?? "").toLowerCase();
const data = new GameData(nodeLoader());
await data.preload("config/item.dat", "config/actor.dat", "config/attack.dat", "config/fire_action.dat");
const items = data.library_("config/item.dat");

const kinds = new Map<string, number>();
let ok = 0, bad = 0;
for (const name of [...items.keys()].sort()) {
  if (!name.startsWith("Weapon/") || name.includes("/Parts/")) continue;
  if (filter && !name.toLowerCase().includes(filter)) continue;
  const w = await data.weapon(name).catch(() => null);
  if (!w || (!w.attacks.length && !w.chargedAttack)) continue;
  const problems: string[] = [], seen: string[] = [];
  const check = async (label: string, a: AttackDef | null) => {
    if (!a) return;
    let does = false;
    for (const f of a.fires) {
      if (f.shape || f.action || /Merge$/.test(f.name ?? "")) { does = true; continue; }
      if (!f.spawn) continue;
      const p = await data.projectile(f.spawn.actor).catch(() => null);
      if (!p) { problems.push(`${label}: ${f.spawn.actor?.name} does not load`); continue; }
      does = true;
      const k = p.orbit?.bullet ? "disk" : p.kind === "Orbital" ? "satellite" : p.kind === "Agent" ? `core (+${p.children.length} satellites)` : p.kind.toLowerCase();
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
      if (!seen.includes(k)) seen.push(k);
      if (p.kind === "Agent") {
        for (const c of p.children) if (!(await data.projectile(c).catch(() => null))) problems.push(`${label}: satellite ${c.name} does not load`);
      } else if (p.harmless && !p.actions.length && !p.trail && !p.spawns) problems.push(`${label}: ${p.name} deals no damage`);
      // what it throws as it goes off (a shard bomb's shards, a Tortafist's missile) must fly too
      for (const s of p.spawns ?? []) {
        const c = await data.projectile(s).catch(() => null);
        if (!c) problems.push(`${label}: ${p.name}'s spawn ${s.name} does not load`);
        else if (c.kind === "Orbital" || c.kind === "Agent") problems.push(`${label}: ${p.name}'s spawn ${s.name} is an orbital (not flown from a detonation)`);
      }
    }
    if (!does) problems.push(`${label}: fires nothing`);
  };
  for (let i = 0; i < w.attacks.length; i++) await check(`attack ${i + 1}`, w.attacks[i]);
  await check("charge", w.chargedAttack);
  await check("incomplete charge", w.incompleteChargedAttack);
  if (problems.length) { bad++; console.log(`PROBLEM ${name}: ${problems.join("; ")}`); }
  else { ok++; if (all || /disk|mix|orbit|slicer|mandolin/i.test(name)) console.log(`ok ${name}: ${seen.join(", ")}`); }
}
console.log(`\n${ok} weapons fire, ${bad} with problems`);
console.log([...kinds].map(([k, n]) => `${n} × ${k}`).join(", "));
