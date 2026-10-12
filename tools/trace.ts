import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importBody, readBody } from "../src/export/BinaryImport.ts";
import { nodeInflate, skDir } from "./common.ts";
const { body, version } = await readBody(new Uint8Array(readFileSync(join(skDir(), "rsrc", process.argv[2]))), nodeInflate);
const trace: string[] = [];
try { importBody(body, version, true, trace); console.log("OK"); } catch (e) { console.log("ERR", (e as Error).message); }
console.log(trace.slice(-Number(process.argv[3] ?? 40)).join("\n"));
