// Summarises the Tudey scenes cached in the install's scenes/ folder (sent by the server
// when the player visited them). Reads only the user's own install.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { importBinary } from "../src/export/BinaryImport.ts";
import { nodeInflate, skDir } from "./common.ts";

const dir = join(skDir(), "scenes");
for (const f of readdirSync(dir)) {
  const r = await importBinary(new Uint8Array(readFileSync(join(dir, f))), nodeInflate);
  const s = r.root as any;
  const kinds = new Map<string, number>();
  const entries: any[] = s.entries ?? [];
  for (const e of entries) kinds.set(e.$class.split("$").pop(), (kinds.get(e.$class.split("$").pop()) ?? 0) + 1);
  const tiles = s.tiles ?? s.tileEntries;
  console.log(`${f}\t${s.$class?.split(".").pop()}\tname=${JSON.stringify(s.name ?? s.sceneName)}\ttrailing=${r.trailing}`);
  console.log(`\tfields: ${Object.keys(s).filter(k => k !== "$class").join(", ")}`);
  console.log(`\tentries: ${[...kinds].map(([k, n]) => `${k}=${n}`).join(", ")}`);
  if (tiles) console.log(`\ttiles: ${JSON.stringify(Object.keys(tiles)).slice(0, 200)}`);
}
