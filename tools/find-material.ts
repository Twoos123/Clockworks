// Lists material mappings that use a given material, with their arguments.
// Usage: tsx tools/find-material.ts "Model/Scrolling/Additive" [max]
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { importBinary } from "../src/export/BinaryImport.ts";
import { nodeInflate, skDir, walk } from "./common.ts";

const [name, maxArg] = process.argv.slice(2);
const max = Number(maxArg ?? 5);
const root = join(skDir(), "rsrc");
let found = 0;
const strip = (k: string, v: any) => (k === "$outer" ? undefined : v);
for (const file of walk(root, ".dat")) {
  if (found >= max) break;
  const r: any = (await importBinary(new Uint8Array(readFileSync(file)), nodeInflate)).root;
  for (const mm of r?.implementation?.materialMappings ?? []) {
    if (mm.material?.name !== name) continue;
    console.log(relative(root, file), "texture=" + mm.texture, JSON.stringify(mm.material.arguments, strip)
      .replace(/"\$class":"com\.threerings\.[a-z.]*\.?/g, '"').slice(0, 600));
    if (++found >= max) break;
  }
}
