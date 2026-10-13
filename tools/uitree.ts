// Prints a user interface config's component tree compactly: kind, tag, text, style, layout
// and constraints, one component per line (nested interfaces by reference).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importBinary } from "../src/export/BinaryImport.ts";
import { nodeInflate, skDir } from "./common.ts";
const r: any = (await importBinary(new Uint8Array(readFileSync(join(skDir(), "rsrc", process.argv[2]))), nodeInflate)).root;
const short = (c: any) => String(c?.$class ?? "").replace(/^.*[.$]/, "");
const en = (e: any) => e?.name ?? "";
const args = (ref: any) => (ref?.arguments?.entries ?? []).map(([k, v]: any) => `${k}=${typeof v === "object" ? JSON.stringify(v, (kk, vv) => kk === "$outer" ? undefined : vv).slice(0, 80) : v}`).join(",");
function cons(ch: any) {
  if (!ch) return "";
  const o: string[] = [];
  if (ch.location) o.push(en(ch.location));
  if (ch.point) o.push(`@${ch.point.x ?? 0},${ch.point.y ?? 0}`);
  if (ch.bounds) o.push(`@${ch.bounds.x ?? 0},${ch.bounds.y ?? 0} ${ch.bounds.width ?? 0}x${ch.bounds.height ?? 0}`);
  if (ch.anchor) o.push(`anchor`);
  if (ch.fixed) o.push("fixed");
  if (ch.weight) o.push(`w${ch.weight}`);
  return o.join(" ");
}
function walk(c: any, d: number, ch?: any) {
  if (!c) return;
  const k = short(c);
  const p = [" ".repeat(d * 2) + k];
  if (c.tag) p.push(`#${c.tag}`);
  if (c.text) p.push(JSON.stringify(c.text));
  if (c.action) p.push(`!${c.action}`);
  if (c.style?.name) p.push(`[${c.style.name}]`);
  if (c.preferredSize) p.push(`${c.preferredSize.width ?? 0}x${c.preferredSize.height ?? 0}`);
  if (c.visible === false) p.push("HIDDEN");
  if (c.enabled === false) p.push("disabled");
  if (c.userInterface) p.push(`=> ${c.userInterface.name} ${args(c.userInterface)}`);
  if (c.icon) p.push(`icon:${c.icon.file ?? short(c.icon)}`);
  const lay = c.layout;
  if (lay) p.push(`{${short(lay)}${lay.columns ? " cols=" + lay.columns : ""}${lay.policy ? " " + en(lay.policy) : ""}${lay.justification ? " " + en(lay.justification) : ""}${lay.gap != null ? " gap" + lay.gap : ""}}`);
  const cc = cons(ch);
  if (cc) p.push(`(${cc})`);
  console.log(p.join(" "));
  for (const kid of lay?.children ?? []) walk(kid.component, d + 1, kid);
  if (c.child) walk(c.child, d + 1);
  for (const t of c.tabs ?? []) { console.log(" ".repeat(d * 2 + 2) + `tab ${JSON.stringify(t.title)}`); walk(t.component, d + 2); }
}
const impl = r.implementation;
if (short(impl) === "Derived") console.log("Derived =>", impl.userInterface?.name, args(impl.userInterface));
console.log("params:", (r.parameters ?? []).map((p: any) => `${p.name}:${(p.paths ?? []).join("|")}`).join(" ; "));
console.log("styles:", (r.configs?.groups ?? []).flatMap((g: any) => (g.configs ?? []).map((x: any) => x.name)).filter((n: string) => !n.includes(":")).join(", "));
walk(impl?.root, 0);
