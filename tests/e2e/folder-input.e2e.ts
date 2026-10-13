// End-to-end check of the folder-input path (what Firefox and Safari users get, and the
// fallback in Chromium), run in real Chromium, Firefox and WebKit through Playwright.
//
// Needs the dev server (npm run dev) and a mock install folder:
//   tsx tests/e2e/folder-input.e2e.ts <path to install folder>
// The folder must contain the jelly cube model, the config libraries and a cached scene.
import { chromium, firefox, webkit, type BrowserType } from "playwright";
import { resolve } from "node:path";

const dir = resolve(process.argv[2] ?? ".scratch/mock-install");
const url = process.env.VIEWER_URL ?? "http://localhost:5174/";
let failures = 0;

async function run(name: string, type: BrowserType, hidePicker: boolean) {
  const browser = await type.launch();
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  if (hidePicker) await page.addInitScript(() => { delete (window as any).showDirectoryPicker; });
  await page.goto(url);
  const check = (label: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} [${name}] ${label}${detail ? ": " + detail : ""}`);
    if (!ok) failures++;
  };
  check("fallback folder button shown", await page.isVisible("#fallback"));
  await page.setInputFiles("#dirInput", dir);
  await page.waitForSelector("#app:not([hidden])", { timeout: 20000 });
  check("viewer opened", true, await page.textContent("#sourceLabel") ?? "");
  await page.fill("#search", "jellycube/model");
  await page.click("#list li:first-child");
  await page.waitForFunction(() => /loaded in/.test(document.getElementById("status")!.textContent ?? ""), null, { timeout: 20000 });
  const info = await page.innerText("#info");
  check("jelly cube loaded with library materials", info.includes("Model/Skinned/Masked (Hard)") && !info.includes("fallback"));
  await page.waitForSelector("#scenesBox:not([hidden])", { timeout: 10000 });
  const scenes = await page.innerText("#scenes");
  check("cached scene listed", scenes.includes("mission lobby"), scenes.replace(/\n/g, ", "));
  const colours = await page.evaluate(async () => (await (window as any).__viewer.renderer.colors)?.classes.size ?? 0);
  check("colour definitions loaded", colours > 0, `${colours} classes`);
  const readCode = await page.evaluate(async () => {
    // the dummy proprietary jar holds the text "dummy"; prove nothing read it into the vfs
    const v = (window as any).__viewer.vfs;
    const files: string[] = await v.list();
    return files.filter((f: string) => f.includes("code/") || f.endsWith(".jar") && !f.includes("bundle"));
  });
  check("no code/ files exposed", readCode.length === 0, readCode.join(", "));
  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
}

await run("chromium, picker hidden", chromium, true);
await run("firefox", firefox, false);
await run("webkit (Safari engine)", webkit, false);
console.log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exit(failures ? 1 : 0);
