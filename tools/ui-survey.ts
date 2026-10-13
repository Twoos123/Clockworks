// Counts the GUI classes (components, layouts, backgrounds, borders) used by UI configs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importBinary } from "../src/export/BinaryImport.ts";
import { nodeInflate, skDir, walk } from "./common.ts";
const dir = join(skDir(), "rsrc", process.argv[2] ?? "ui/hud_v2");
const counts = new Map<string, number>();
for (const f of walk(dir, ".dat")) {
  const r = await importBinary(new Uint8Array(readFileSync(f)), nodeInflate);
  for (const c of r.classes) if (c.includes(".gui.")) counts.set(c.replace("com.threerings.opengl.gui.", ""), (counts.get(c.replace("com.threerings.opengl.gui.", "")) ?? 0) + 1);
}
for (const [c, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(n, c);
