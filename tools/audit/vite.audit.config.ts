// The dev server for long audit runs: the project's own config without hot reload or file
// watching, so editing sources mid-run does not reload the pages being audited.
// npx vite --config tools/audit/vite.audit.config.ts --port 5183 --strictPort
import { mergeConfig } from "vite";
import base from "../../vite.config.ts";

export default mergeConfig(base, { server: { hmr: false, watch: { ignored: ["**/*"] } } });
