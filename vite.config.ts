import { defineConfig, type Plugin } from "vite";
import { detectInstall, installMiddleware } from "./server/install";

// Serves the player's own install, found automatically (Steam libraries, the standalone
// installer's folders, or SK_DIR), on localhost only. The launcher (server/play.ts) does the
// same for the built game.
function localInstall(): Plugin {
  const dir = detectInstall();
  return {
    name: "local-install",
    apply: "serve",
    configureServer(server) {
      console.log(dir ? `Spiral Knights found at ${dir}` : "Spiral Knights was not found: set SK_DIR to the install folder.");
      server.middlewares.use("/__sk", installMiddleware(() => dir));
    },
  };
}

export default defineConfig({
  plugins: [localInstall()],
  server: { host: "localhost", port: 5174 },
  build: { target: "es2022" },
});
