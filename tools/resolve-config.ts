// Resolves a named config through Derived chains (arguments applied) and prints it.
// Usage: tsx tools/resolve-config.ts config/actor.dat "Name" [derivedField=actor] [maxChars]
//        tsx tools/resolve-config.ts config/actor.dat --find "jelly" (lists matching names)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importBinary } from "../src/export/BinaryImport.ts";
import { applyArguments } from "../src/config/params.ts";
import { nodeInflate, skDir } from "./common.ts";

const [file, name, field = "actor", maxArg] = process.argv.slice(2);
const r: any = (await importBinary(new Uint8Array(readFileSync(join(skDir(), "rsrc", file))), nodeInflate)).root;
const list: any[] = Array.isArray(r) ? r : r.array ?? [];
if (name === "--find") {
  const q = field.toLowerCase();
  console.log(list.filter(c => c.name?.toLowerCase().includes(q)).map(c => `${c.name}  [${c.implementation?.$class?.split(".").pop()}]`).slice(0, 60).join("\n"));
  process.exit(0);
}
const by = new Map(list.map(c => [c.name, c]));
const strip = (k: string, v: any) => k === "$outer" || k === "parameters" ? undefined
  : ArrayBuffer.isView(v) ? Array.from(v as any) : v;
let ref: any = { name };
for (let i = 0; i < 10; i++) {
  const base = by.get(ref?.name);
  if (!base) { console.log("missing", ref?.name); break; }
  const impl = applyArguments(base, ref).implementation;
  if (impl?.$class?.endsWith("$Derived") && impl[field]) { console.log(`${i}: ${ref.name} -> derived`); ref = impl[field]; continue; }
  console.log(`${i}: ${ref.name} [${impl?.$class}]`);
  console.log(JSON.stringify(impl, strip, 1).replace(/"\$class": "com\.threerings\.[a-z.]*\.?/g, '"$class": "').replace(/\n\s*/g, " ").slice(0, Number(maxArg ?? 6000)));
  break;
}
