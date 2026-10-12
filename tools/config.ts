// Prints one named config from a config-library file (e.g. config/material.dat) as JSON.
// Usage: tsx tools/config.ts config/material.dat "Model/Tinted/Translucent"
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importBinary } from "../src/export/BinaryImport.ts";
import { nodeInflate, skDir } from "./common.ts";

const [file, name] = process.argv.slice(2);
const r = await importBinary(new Uint8Array(readFileSync(join(skDir(), "rsrc", file))), nodeInflate);
const list = (Array.isArray(r.root) ? r.root : (r.root as any).configs ?? []) as any[];
if (!name) { console.log(list.map(c => c.name).join("\n")); process.exit(0); }
const cfg = list.find(c => c.name === name);
const seen = new Set();
console.log(JSON.stringify(cfg, (k, v) => {
  if (k === "$outer") return undefined;
  if (v && typeof v === "object") {
    if (ArrayBuffer.isView(v)) return `<${(v as any).length} values>`;
    if (seen.has(v)) return "<ref>";
    seen.add(v);
  }
  return v;
}, 1).replace(/\n\s*/g, " ").replace(/"\$class": "com\.threerings\./g, '"$class": "'));
