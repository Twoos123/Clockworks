// Prints the positions (and arguments) of a cached scene's placeables whose name matches a filter.
// Usage: tsx tools/scene-positions.ts <scene id> <regex>
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { importBinary } from "../src/export/BinaryImport.ts";
import { nodeInflate, skDir } from "./common.ts";

const [id, filter = "."] = process.argv.slice(2);
const scene = (await importBinary(new Uint8Array(readFileSync([join(skDir(), `scenes/${id}`), join(process.env.LOCALAPPDATA ?? "", "clyde-web", "scenes", id)].find(p => existsSync(p))!)), nodeInflate)).root as any;
const re = new RegExp(filter, "i");
const short = (v: any): string => JSON.stringify(v, (k, x) => (k === "$outer" ? undefined : x))?.slice(0, 400) ?? "";
for (const e of scene.entries) {
  const name = e.placeable?.name ?? e.area?.name ?? "";
  if (!re.test(name)) continue;
  const t = e.transform?.translation ?? {};
  const r = e.transform?.rotation;
  const rot = r ? (2 * Math.atan2(r.z ?? 0, r.w ?? 1)).toFixed(2) : "0";
  console.log(`${(t.x ?? 0).toFixed(1)},${(t.y ?? 0).toFixed(1)} r${rot} ${name} ${e.placeable?.arguments ? short(e.placeable.arguments.entries) : ""}`);
}
