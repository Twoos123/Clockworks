// Summarises the meshes and material mappings in one model file.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importBinary } from "../src/export/BinaryImport.ts";
import { nodeInflate, skDir } from "./common.ts";
const r = await importBinary(new Uint8Array(readFileSync(join(skDir(), "rsrc", process.argv[2]))), nodeInflate);
const impl = (r.root as any).implementation;
console.log("impl:", impl.$class, "source:", impl.source, "scale:", impl.scale);
const arr = (a: any) => a ? `${a.$class.split(".").pop()} size=${a.size} type=${a.type?.name} stride=${a.stride} off=${a.offset} floats=${a.floatArray?.length}` : "-";
function mesh(where: string, m: any) {
  const g = m.geometry;
  console.log(`\n[${where}] texture=${JSON.stringify(m.texture)} tag=${JSON.stringify(m.tag)} geom=${g.$class.split(".").pop()} mode=${g.mode?.name} start=${g.start} end=${g.end} idx=${g.indices?.length} bones=${g.bones?.length}`);
  console.log("   vertex:", arr(g.vertexArray)); console.log("   normal:", arr(g.normalArray));
  (g.texCoordArrays ?? []).forEach((t: any, i: number) => console.log(`   tc${i}:`, arr(t)));
  if (g.colorArray) console.log("   color:", arr(g.colorArray));
  (g.vertexAttribArrays ?? []).forEach((t: any) => console.log(`   attr ${t.name}:`, arr(t)));
}
(impl.skin?.visible ?? []).forEach((m: any) => mesh("skin", m));
(impl.meshes?.visible ?? []).forEach((m: any) => mesh("static", m));
function walkNodes(n: any) { if (!n) return; if (n.visible) n.visible.forEach((m: any) => mesh("node " + n.name, m)); (n.children ?? []).forEach(walkNodes); }
walkNodes(impl.root);
const flat = (v: any, d = 0): string => v == null ? "null" : typeof v !== "object" ? JSON.stringify(v) : v.$map ? "{" + v.entries.map(([k, x]: any) => `${k}: ${flat(x, d + 1)}`).join(", ") + "}" : v.$enum ? v.name : v.$class === "com.threerings.config.ConfigReference" ? `ref(${v.name}${v.arguments ? " " + flat(v.arguments, d + 1) : ""})` : v.$class ? v.$class.split(".").pop() : String(v);
console.log("\nmaterialMappings:");
(impl.materialMappings ?? []).forEach((mm: any) => console.log(`  texture=${JSON.stringify(mm.texture)} tag=${JSON.stringify(mm.tag)} -> ${flat(mm.material)}`));
