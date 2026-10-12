// Surveys every ModelConfig: implementation class, mesh counts, geometry classes.
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { importBinary } from "../src/export/BinaryImport.ts";
import { nodeInflate, skDir, walk } from "./common.ts";

const root = join(skDir(), "rsrc");
const impls = new Map<string, number>();
const geoms = new Map<string, number>();
const rows: string[] = [];
function count(n: any): number {
  if (!n) return 0;
  return (n.visible?.length ?? 0) + (n.children ?? []).reduce((s: number, c: any) => s + count(c), 0);
}
for (const file of walk(root, ".dat")) {
  const r = await importBinary(new Uint8Array(readFileSync(file)), nodeInflate);
  const m = r.root as any;
  if (m?.$class !== "com.threerings.opengl.model.config.ModelConfig") continue;
  const impl = m.implementation;
  const cls = impl?.$class ?? "none";
  impls.set(cls, (impls.get(cls) ?? 0) + 1);
  const skin = impl?.skin?.visible ?? [];
  const stat = impl?.meshes?.visible ?? [];
  const nodes = count(impl?.root);
  for (const v of [...skin, ...stat]) geoms.set(v.geometry?.$class, (geoms.get(v.geometry?.$class) ?? 0) + 1);
  let verts = 0;
  for (const v of [...skin, ...stat]) verts += (v.geometry?.vertexArray?.floatArray?.length ?? 0) / 3;
  rows.push(`${relative(root, file).replace(/\\/g, "/")}\t${cls.split(".").pop()}\tskin=${skin.length}\tstatic=${stat.length}\tnode=${nodes}\tverts~${Math.round(verts)}`);
}
console.log("implementations:");
[...impls].sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`  ${n}\t${c}`));
console.log("geometry classes:");
[...geoms].sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`  ${n}\t${c}`));
writeFileSync("tools/.scan-models.txt", rows.join("\n"));
