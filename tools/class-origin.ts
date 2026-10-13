// For each config library, counts which classes come from the open-source engine
// (com.threerings.* outside projectx) and which from the proprietary game (projectx).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importBinary } from "../src/export/BinaryImport.ts";
import { nodeInflate, skDir } from "./common.ts";

const files = process.argv.slice(2);
for (const f of files) {
  const r = await importBinary(new Uint8Array(readFileSync(join(skDir(), "rsrc", f))), nodeInflate);
  let open = 0, prop = 0;
  const propClasses = new Map<string, number>();
  for (const c of r.classes) {
    if (c.includes("projectx")) { prop++; propClasses.set(c.replace("com.threerings.projectx.", ""), 1); } else if (c.startsWith("com.threerings")) open++;
  }
  const root: any = r.root;
  const list: any[] = Array.isArray(root) ? root : root?.array ?? [];
  const implOpen = list.filter(c => c.implementation?.$class && !c.implementation.$class.includes("projectx")).length;
  console.log(`${f}: ${list.length} configs, ${implOpen} with engine implementation classes; classes used: ${open} engine, ${prop} game-specific`);
  console.log("   game-specific: " + [...propClasses.keys()].slice(0, 30).join(", "));
}
