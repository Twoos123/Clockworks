// Prints a compact, depth-limited view of one .dat file's object graph.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importBinary } from "../src/export/BinaryImport.ts";
import { nodeInflate, skDir } from "./common.ts";

const [file, depthArg] = process.argv.slice(2);
const maxDepth = Number(depthArg ?? 6);
const r = await importBinary(new Uint8Array(readFileSync(join(skDir(), "rsrc", file))), nodeInflate);
const seen = new Set<unknown>();
function show(v: unknown, d: number, ind: string): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (ArrayBuffer.isView(v)) { const a = v as unknown as ArrayLike<number>; return `${v.constructor.name}[${a.length}] ${Array.from(a).slice(0, 6).map(x => +x.toFixed?.(3) || x).join(",")}…`; }
  if (seen.has(v)) return "<ref>";
  seen.add(v);
  if (d >= maxDepth) return "…";
  const o = v as any;
  if (o.$enum) return `${o.$enum.split(".").pop()}.${o.name}`;
  if (Array.isArray(v)) return v.length === 0 ? "[]" : `[${v.length}]\n` + v.slice(0, 4).map((x, i) => `${ind}  [${i}] ${show(x, d + 1, ind + "  ")}`).join("\n") + (v.length > 4 ? `\n${ind}  …` : "");
  if (o.$collection) return `${o.$collection.split(".").pop()} ` + show(o.items, d, ind);
  if (o.$map) return `${o.$map.split(".").pop()}{${o.entries.length}}\n` + o.entries.slice(0, 6).map(([k, x]: any) => `${ind}  ${show(k, d + 1, ind + "  ")} => ${show(x, d + 1, ind + "  ")}`).join("\n");
  const keys = Object.keys(o).filter(k => k !== "$class");
  if (["x", "r", "m00", "nx", "azimuth"].includes(keys[0])) return `${o.$class.split(".").pop()}(${keys.map(k => +(+o[k]).toFixed(3)).join(",")})`;
  return `${o.$class.replace("com.threerings.", "")}\n` + keys.map(k => `${ind}  ${k}: ${show(o[k], d + 1, ind + "  ")}`).join("\n");
}
console.log(show(r.root, 0, ""));
