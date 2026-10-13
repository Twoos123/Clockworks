// A read-only Vfs over the local install for node-side audit scripts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ModelLoader } from "../../src/model.ts";
import { skDir } from "../common.ts";
import type { Vfs } from "../../src/vfs.ts";

export function nodeLoader(): ModelLoader {
  const root = join(skDir(), "rsrc");
  const vfs: Vfs = {
    label: "node", list: async () => [],
    read: async p => new Uint8Array(readFileSync(join(root, p))),
    blob: async p => new Blob([readFileSync(join(root, p))]),
    scenes: async () => [], readScene: async () => new Uint8Array(), colorDefs: async () => null,
  };
  return new ModelLoader(vfs);
}
