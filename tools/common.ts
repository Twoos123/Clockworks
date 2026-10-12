import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

export const DEFAULT_SK_DIR = "C:/Program Files (x86)/Steam/steamapps/common/Spiral Knights";
export const skDir = () => process.env.SK_DIR ?? DEFAULT_SK_DIR;
export const nodeInflate = (d: Uint8Array) => new Uint8Array(inflateSync(d));

export function* walk(dir: string, ext: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p, ext);
    else if (name.endsWith(ext)) yield p;
  }
}
