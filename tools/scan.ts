// Parses every .dat file under the install's rsrc/ folder and reports failures and the
// class histogram. Reads only the user's own install; nothing is copied anywhere.
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { importBinary, knownEnums, MAGIC } from "../src/export/BinaryImport.ts";
import { nodeInflate, skDir, walk } from "./common.ts";

const root = join(skDir(), process.argv[2] ?? "rsrc");
const classCount = new Map<string, number>();
const rootCount = new Map<string, number>();
const failures: string[] = [];
let ok = 0, notExport = 0;
const t0 = performance.now();
for (const file of walk(root, ".dat")) {
  const data = new Uint8Array(readFileSync(file));
  const rel = relative(root, file);
  if (data.length < 8 || new DataView(data.buffer, data.byteOffset).getInt32(0) !== MAGIC) { notExport++; continue; }
  try {
    const r = await importBinary(data, nodeInflate);
    if (r.trailing !== 0) { failures.push(`${rel}: ${r.trailing} trailing bytes`); continue; }
    ok++;
    for (const c of r.classes) classCount.set(c, (classCount.get(c) ?? 0) + 1);
    const rc = (r.root as any)?.$class ?? (r.root as any)?.$map ?? (r.root as any)?.$collection ?? (Array.isArray(r.root) ? "array" : typeof r.root);
    rootCount.set(rc, (rootCount.get(rc) ?? 0) + 1);
  } catch (e) {
    failures.push(`${rel}: ${(e as Error).message}`);
  }
}
const secs = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`parsed ok: ${ok}  failed: ${failures.length}  non-export .dat: ${notExport}  (${secs}s)`);
failures.slice(0, 25).forEach(f => console.log("  FAIL " + f));
console.log("\nroot classes:");
[...rootCount].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([c, n]) => console.log(`  ${n}\t${c}`));
writeFileSync("tools/.scan-classes.txt", [...classCount].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${n}\t${c}`).join("\n"));
writeFileSync("tools/.scan-enums.txt", [...knownEnums].sort().join("\n"));
console.log(`\n${classCount.size} distinct classes, ${knownEnums.size} enums (written to tools/.scan-*.txt)`);
