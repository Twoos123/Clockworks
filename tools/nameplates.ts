// Lists every name label the client would hang in a scene (client/sprite/g): the named
// placeables (ProjectXPlaceableConfig Named) and every actor the scene's entries can spawn
// (placeable actors, SpawnActor actions anywhere in their handlers) whose sprite is a named
// kind with a description, with the translated name and title.
// A static survey: scripted spawns that wait on signals are listed as if spawned. Compare its
// list with World.nameplates() in the running game.
// Usage: tsx tools/nameplates.ts <scene id> [--all]   (--all also lists unnamed actors)
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { importBinary } from "../src/export/BinaryImport.ts";
import { applyArguments } from "../src/config/params.ts";
import { JarReader } from "../src/java/jar.ts";
import { parseProperties } from "../src/i18n.ts";
import { descriptionBundle } from "../src/game/action.ts";
import { namedHolder } from "../src/game/world.ts";
import { resolveRef } from "../src/game/logic.ts";
import { nodeInflate, skDir } from "./common.ts";
import { archiveDir } from "../server/install.ts";

const [id, flag] = process.argv.slice(2);
const load = async (p: string) => (await importBinary(new Uint8Array(readFileSync(join(skDir(), p))), nodeInflate)).root as any;
const lib = async (f: string) => new Map<string, any>(((r: any) => Array.isArray(r) ? r : r.array ?? [])(await load(`rsrc/config/${f}`)).map((c: any) => [c.name, c]));
const [placeables, actors, descs] = [await lib("placeable.dat"), await lib("actor.dat"), await lib("description.dat")];
const jar = await JarReader.open(new Blob([readFileSync(join(skDir(), "code/projectx-config.jar"))]));
const bundles = new Map<string, Map<string, string>>();
const tr = async (bundle: string, key: string) => {
  if (!key) return "";
  if (key.startsWith("~")) return key.slice(1);
  if (!bundles.has(bundle)) {
    const b = await jar.read(`rsrc/i18n/${bundle}.properties`);
    bundles.set(bundle, parseProperties(b ? new TextDecoder("latin1").decode(b) : ""));
  }
  return bundles.get(bundle)!.get(key) ?? `?${key}`;
};
const describe = async (ref: any) => {
  let cfg: any = null, r = ref;
  for (let i = 0; i < 10 && r?.name; i++) {
    const base = descs.get(r.name);
    if (!base) return `(missing description ${r.name})`;
    cfg = applyArguments(base, r);
    if (!String(cfg.$class ?? "").endsWith("DerivedConfig")) break;
    r = cfg.base;
  }
  if (!cfg) return "(none)";
  const b = descriptionBundle(cfg.$class);
  return `${await tr(b, cfg.dname ?? "")} / ${await tr(b, cfg.title ?? "")}${cfg.nameIcon?.file ? `  [${cfg.nameIcon.file}]` : ""}  <${ref.name}>`;
};

// every actor reference under a config tree (SpawnActor actions, StatefulProp actors...)
const actorRefs = (o: any, out: any[] = [], seen = new Set<any>()): any[] => {
  if (!o || typeof o !== "object" || seen.has(o)) return out;
  seen.add(o);
  if (Array.isArray(o)) { for (const v of o) actorRefs(v, out, seen); return out; }
  for (const [k, v] of Object.entries(o)) {
    if (k === "$outer") continue;
    if (k === "actor" && (v as any)?.name && actors.has((v as any).name)) out.push(v);
    else actorRefs(v, out, seen);
  }
  return out;
};

// the install's cached scene, else the scene archive's
const own = join(skDir(), "scenes", id);
const scene = (await importBinary(new Uint8Array(readFileSync(existsSync(own) ? own : join(archiveDir(), id))), nodeInflate)).root as any;
const rows: string[] = [];
for (const e of scene.entries ?? []) {
  if (!e.$class.endsWith("PlaceableEntry") && !e.$class.endsWith("AreaEntry")) continue;
  const ref = e.placeable ?? e.area;
  const impl = e.placeable ? resolveRef(placeables, e.placeable, "placeable") : null;
  const t = e.transform?.translation ?? e.transform?.matrix ?? {};
  const at = e.vertices?.[0] ? `(${(e.vertices[0].x ?? 0).toFixed(1)},${(e.vertices[0].y ?? 0).toFixed(1)})`
    : `(${(t.x ?? 0).toFixed?.(1)},${(t.y ?? 0).toFixed?.(1)})`;
  if (impl && /ProjectXPlaceableConfig\$Named$/.test(impl.$class)) {
    if (impl.description) rows.push(`PLACEABLE ${at} ${ref.name}: ${await describe(impl.description)}`);
    else if (flag === "--all") rows.push(`  unnamed placeable ${at} ${ref.name} (no description)`);
  }
  // the actors it spawns, and those spawn (scripted spawners), each actor config once
  const queue = actorRefs(impl ?? ref).map(a => [a, ref.name] as [any, string]), done = new Set<string>();
  while (queue.length) {
    const [a, via] = queue.shift()!;
    const cfg = resolveRef(actors, a, "actor");
    const k = JSON.stringify(a, (k, v) => k === "$outer" ? undefined : v);
    if (done.has(k)) continue;
    done.add(k);
    for (const b of actorRefs(cfg)) queue.push([b, a.name]);
    const h = namedHolder(cfg);
    const kind = String(cfg?.sprite?.$class ?? cfg?.$class ?? "?").split(".").pop();
    if (h) rows.push(`ACTOR ${at} ${a.name} [${kind}] via ${via}: ${await describe(h.description)}`);
    else if (flag === "--all") rows.push(`  unnamed ${at} ${a.name} [${kind}] via ${via}${cfg?.sprite?.description ? " (has description)" : ""}`);
  }
}
console.log(rows.join("\n"));
console.log(`${scene.name}: ${rows.filter(r => !r.startsWith("  ")).length} labels`);
