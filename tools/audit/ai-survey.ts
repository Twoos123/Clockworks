// Prints the AI-relevant data of every monster in config/actor.dat: speeds, turn rate, size,
// react settings, moveWhileAttacking, its attacks (melee reach or projectile, timings,
// lunges), any surviving behaviour script, and the behaviour src/game/monsterai.ts gives it
// (its target action and the attacks each part uses, by name).
// Usage: npx tsx tools/audit/ai-survey.ts [name filter] > out.txt
import { GameData } from "../../src/game/data.ts";
import { nodeLoader } from "./nodevfs.ts";
import { behaviorArgs, behaviorScript, monsterBehavior } from "../../src/game/monsterai.ts";

const filter = (process.argv[2] ?? "").toLowerCase();
const loader = nodeLoader();
const data = new GameData(loader);
await data.preload("config/actor.dat", "config/attack.dat", "config/fire_action.dat");
const lib = data.library_("config/actor.dat");
const f = (n: number) => +n.toFixed(2);

/** A behaviour in one line: kinds, with the attacks they use by short name. */
function describe(b: any, names: string[]): string {
  if (!b || typeof b !== "object") return String(b);
  if (Array.isArray(b)) return b.map(x => describe(x, names)).join(" | ");
  const short = (i: number) => (names[i] ?? `#${i}`).split("/").pop();
  switch (b.type) {
    case "Targeting": return `Targeting(r${b.acquireRadius ?? 10}${b.sight ? ",sight" : ""}${b.targets && b.targets !== "foes" ? "," + b.targets : ""}: ${describe(b.targetAction, names)})`;
    case "RandomAction": return `Random[${b.actions.map((x: any) => describe(x.action, names)).join("; ")}]`;
    case "Dodging": return `Dodging{${b.dodges.map((d: any) => short(d.attack)).join(",")} ${b.chance}}(${describe(b.behavior, names)})`;
    case "Cascading": return `Cascade[${b.cascades.map((c: any) => `${c.condition?.type ?? "Always"}->${describe(c.behavior, names)}`).join("; ")}]`;
    case "Combined": return `Combined(${describe(b.first, names)} + ${describe(b.second, names)})`;
    case "Scripted": return `Scripted(${b.steps.length} steps)`;
    case "Follow": return `Follow(${b.target?.kind ?? "allies"})`;
    case "Attack": return `Attack(${(b.attacks ?? [b.attack ?? 0]).map(short).join(",")})`;
    default: {
      const atk = b.attacks ? `[${b.attacks.map(short).join(",")}]` : b.chargeAttacks ? "" : "";
      const charge = b.chargeAttacks ? `>[${b.chargeAttacks.map(short).join(",")}]` : "";
      const range = b.maxAttackDistance !== undefined ? ` ${b.minAttackDistance ? f(b.minAttackDistance) + "-" : ""}${f(b.maxAttackDistance)}` : "";
      return `${b.type}${atk}${charge}${range}`;
    }
  }
}

for (const name of [...lib.keys()].sort()) {
  if (!name.startsWith("Character/NPC/Monster/") || /\/Parts\//.test(name)) continue;
  if (filter && !name.toLowerCase().includes(filter)) continue;
  const raw = data.resolveSync("config/actor.dat", { name }, "actor");
  if (!raw || !/Monster$/.test(String(raw.$class))) continue;
  const def = await data.monster({ name }).catch(() => null);
  if (!def) continue;
  const atk = def.slots.map(a => {
    if (!a) return "(unresolved)";
    const reach = a.shape ? `melee ${f(a.shape.forward + Math.max(a.shape.halfLength, a.shape.radius))}` : a.spawn ? `spawn ${a.spawn.actor?.name?.split("/").pop()}` : "none";
    const imp = a.impulse ? ` lunge ${f(a.impulse.forward)}/${a.impulse.duration}` : "";
    return `${a.name.split("/").slice(-2).join("/")} [${reach}; ${a.land}/${a.rearm}/${a.clear}${imp}${a.chainTo !== null ? ` chain>${a.chainTo}` : ""}]`;
  });
  const script = behaviorScript({ name }, (n: string) => lib.get(n));
  const args = behaviorArgs({ name }, (n: string) => lib.get(n));
  const names = def.slots.map(a => a?.name ?? "");
  const behavior = monsterBehavior({
    name, attacks: names, speed: def.speed, targetedSpeed: def.targetedSpeed,
    melee: def.slots.map(a => !!a?.shape && !a.spawn), reach: def.slots.map(a => (a?.shape ? a.shape.forward + a.shape.halfLength : 6)), script, args,
  });
  const shown = Object.entries(args).filter(([, v]) => v === null || typeof v !== "object");
  console.log([name.replace("Character/NPC/Monster/", ""),
    `speed ${f(def.speed)}/${f(def.targetedSpeed)} turn ${f(def.turnRate)} r ${f(def.radius)} react ${def.minReactPercent}/${def.reactTime} imp ${def.impulseLevel}`
    + `${def.moveWhileAttacking ? " mwa" : ""}${def.activateTime ? ` act ${def.activateTime}` : ""} ${def.size}`,
    ...atk.map(a => "  " + a), shown.length ? `  behaviour args: ${shown.map(([k, v]) => `${k}=${typeof v === "number" ? f(v) : v}`).join(", ")}` : "", script ? `  script: ${script.map(s => String(s.$class).split("$").pop() + (s.wait ?? s.attack ?? s.step ?? "")).join(", ")}` : "",
    `  => ${describe(behavior, names)}`].filter(Boolean).join("\n"));
}
