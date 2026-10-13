// Lists the placeable config kinds and names in a cached scene, to see spawners and actors.
// Usage: tsx tools/scene-placeables.ts <scene id> [filter]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importBinary } from "../src/export/BinaryImport.ts";
import { applyArguments } from "../src/config/params.ts";
import { nodeInflate, skDir } from "./common.ts";

const [id, filter = ""] = process.argv.slice(2);
const load = async (p: string) => (await importBinary(new Uint8Array(readFileSync(join(skDir(), p))), nodeInflate)).root as any;
const lib = new Map<string, any>((await load("rsrc/config/placeable.dat")).map((c: any) => [c.name, c]));
const scene = await load(`scenes/${id}`);
const resolve = (ref: any): any => {
  for (let i = 0; i < 8; i++) {
    const b = lib.get(ref?.name); if (!b) return null;
    const impl = applyArguments(b, ref).implementation;
    if (impl?.$class?.endsWith("$Derived")) { ref = impl.placeable; continue; }
    return impl;
  }
  return null;
};
const counts = new Map<string, number>();
for (const e of scene.entries) {
  if (!e.$class.endsWith("PlaceableEntry")) continue;
  const impl = resolve(e.placeable);
  const kind = impl?.$class?.split(".").pop() ?? "?";
  const key = `${kind}  ${e.placeable?.name}`;
  if (filter && !key.toLowerCase().includes(filter.toLowerCase())) continue;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 60)) console.log(n, k);
const other = new Map<string, number>();
for (const e of scene.entries) if (!e.$class.endsWith("PlaceableEntry") && !e.$class.endsWith("GlobalEntry")) other.set(e.$class.split("$").pop(), (other.get(e.$class.split("$").pop()) ?? 0) + 1);
console.log("other entries:", [...other]);
