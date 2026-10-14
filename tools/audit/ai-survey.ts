// Prints the AI-relevant data of every monster in config/actor.dat: speeds, turn rate, size,
// react settings, moveWhileAttacking, its attacks (melee reach or projectile, timings,
// lunges) and any surviving behaviour script. Used to build src/game/monsterai.ts.
// Usage: npx tsx tools/audit/ai-survey.ts [name filter] > out.txt
import { GameData } from "../../src/game/data.ts";
import { nodeLoader } from "./nodevfs.ts";
import { behaviorScript } from "../../src/game/monsterai.ts";

const filter = (process.argv[2] ?? "").toLowerCase();
const loader = nodeLoader();
const data = new GameData(loader);
await data.preload("config/actor.dat", "config/attack.dat", "config/fire_action.dat");
const lib = data.library_("config/actor.dat");
for (const name of [...lib.keys()].sort()) {
  if (!name.startsWith("Character/NPC/Monster/") || /\/Parts\//.test(name)) continue;
  if (filter && !name.toLowerCase().includes(filter)) continue;
  const raw = data.resolveSync("config/actor.dat", { name }, "actor");
  if (!raw || !/Monster$/.test(String(raw.$class))) continue;
  const def = await data.monster({ name }).catch(() => null);
  if (!def) continue;
  const f = (n: number) => +n.toFixed(2);
  const atk = def.attacks.map(a => {
    const reach = a.shape ? `melee ${f(a.shape.forward + Math.max(a.shape.halfLength, a.shape.radius))}` : a.spawn ? `spawn ${a.spawn.actor?.name?.split("/").pop()}` : "none";
    const imp = a.impulse ? ` lunge ${f(a.impulse.forward)}/${a.impulse.duration}` : "";
    return `${a.name.split("/").slice(-2).join("/")} [${reach}; ${a.land}/${a.rearm}/${a.clear}${imp}${a.chainTo !== null ? ` chain>${a.chainTo}` : ""}]`;
  });
  const script = behaviorScript({ name }, (n: string) => lib.get(n));
  console.log([name.replace("Character/NPC/Monster/", ""),
    `speed ${f(def.speed)}/${f(def.targetedSpeed)} turn ${f(def.turnRate)} r ${f(def.radius)} react ${def.minReactPercent}/${def.reactTime} imp ${def.impulseLevel}`
    + `${raw.moveWhileAttacking ? " mwa" : ""}${raw.activateTime ? ` act ${raw.activateTime}` : ""}${raw.size?.name ? ` ${raw.size.name}` : ""}`,
    ...atk.map(a => "  " + a), script ? `  script: ${script.map(s => String(s.$class).split("$").pop() + (s.wait ?? s.attack ?? s.step ?? "")).join(", ")}` : ""].filter(Boolean).join("\n"));
}
