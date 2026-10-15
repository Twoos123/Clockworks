// Plays the real game with level capture: starts the player's own Spiral Knights client the way
// its launcher does (getdown.txt's classpath and JVM arguments, the bundled Java), with
// SceneCapture (tools/capture/SceneCapture.java) wrapped around it, so every instanced floor the
// servers send (mission and Arcade floors, which the client never caches) is saved to
// %LOCALAPPDATA%\clyde-web\captured. clyde-web's archive sync imports them (server/install.ts).
//
//   npm run capture
//
// Builds SceneCapture with any JDK 21+ on the PATH (or JAVA_HOME) the first time. The game's own
// files are not modified; it is the same client, logging in and playing as usual.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { archiveDir, detectInstall } from "../../server/install";

const here = dirname(fileURLToPath(import.meta.url));
const install = detectInstall();
if (!install) { console.log("No Spiral Knights install found (set SK_DIR to its folder)."); process.exit(1); }

const captured = join(dirname(archiveDir()), "captured");
const build = join(dirname(archiveDir()), "capture-build");
mkdirSync(captured, { recursive: true });
if (!existsSync(join(build, "CapturingRepository.class"))) {
  const bin = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin") : "";
  const javac = bin ? join(bin, "javac") : "javac";
  console.log("Building SceneCapture...");
  // the client stand-ins are compiled aside and only put on the compile classpath
  const stubs = join(dirname(build), "capture-stubs");
  const stubSrc = ["com/threerings/whirled/a/a/a.java", "com/threerings/whirled/data/SceneModel.java"].map(f => join(here, "stubs", f));
  execFileSync(javac, ["--release", "21", "-d", stubs, ...stubSrc], { stdio: "inherit" });
  execFileSync(javac, ["--release", "21", "-cp", stubs, "-d", build, join(here, "SceneCapture.java"), join(here, "CapturingRepository.java")], { stdio: "inherit" });
}

// getdown.txt: the code jars (no platform tag, or this platform's) and the JVM arguments
const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac os x" : "linux";
const code: string[] = [], jvm: string[] = [];
let main = "com.threerings.projectx.client.ProjectXApp";
for (const raw of readFileSync(join(install, "getdown.txt"), "utf8").split(/\r?\n/)) {
  const m = /^\s*(code|jvmarg|class)\s*=\s*(?:\[([^\]]+)\]\s*)?(.+?)\s*$/.exec(raw);
  if (!m || (m[2] && !m[2].includes(platform))) continue;
  const value = m[3].replace(/%APPDIR%/g, install);
  if (m[1] === "code") code.push(join(install, value));
  else if (m[1] === "jvmarg") jvm.push(value);
  else main = value;
}
const java = join(install, "java_vm", "bin", process.platform === "win32" ? "java.exe" : "java");
const args = ["-classpath", [build, ...code].join(process.platform === "win32" ? ";" : ":"),
  "-Dcom.threerings.getdown=true", ...jvm, `-Dcapture.dir=${captured}`, "SceneCapture"];
if (main !== "com.threerings.projectx.client.ProjectXApp") console.log(`Note: getdown.txt names ${main} as the main class.`);

console.log(`Starting Spiral Knights with level capture; floors are saved to ${captured}`);
// Steam: the client logs on through Steam when the Steam API starts, which needs the game's app id
// (Spiral Knights is 99900). Steam sets these when it launches the game; Steam must be running.
const env = { ...process.env, SteamAppId: "99900", SteamGameId: "99900" };
const child = spawn(java, args, { cwd: install, stdio: "inherit", env });
child.on("exit", code => {
  console.log(`The game closed (${code}). Open clyde-web (or run npm run levels) to import the captured floors.`);
});
