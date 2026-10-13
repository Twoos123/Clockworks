// Prints one .dat file's object graph as compact JSON (class names shortened).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importBinary } from "../src/export/BinaryImport.ts";
import { nodeInflate, skDir } from "./common.ts";
const r = await importBinary(new Uint8Array(readFileSync(join(skDir(), "rsrc", process.argv[2]))), nodeInflate);
const seen = new Set<unknown>();
const conv = (v: any): any => {
  if (v === null || typeof v !== "object") return v;
  if (ArrayBuffer.isView(v)) return `<${v.constructor.name}>`;
  if (seen.has(v)) return "<ref>";
  seen.add(v);
  if (v.$enum) return `${v.$enum.split(".").pop()}.${v.name}`;
  if (Array.isArray(v)) return v.map(conv);
  if (v.$collection) return v.items.map(conv);
  if (v.$map) return Object.fromEntries(v.entries.map(([k, x]: any) => [typeof k === "object" ? JSON.stringify(conv(k)) : k, conv(x)]));
  const o: any = {};
  for (const k of Object.keys(v)) {
    if (k === "$outer") continue;
    o[k] = k === "$class" ? v[k].replace(/^com\.threerings\.(opengl\.gui\.config\.|config\.)?/, "") : conv(v[k]);
  }
  return o;
};
console.log(JSON.stringify(conv(r.root), null, process.argv[3] === "pretty" ? 1 : 0));
