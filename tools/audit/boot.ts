// Boots the dev server's viewer into play mode on a cached level for the audit scripts.
import { chromium, type Browser, type Page } from "playwright";

export const URL = process.env.AUDIT_URL ?? "http://localhost:5183/#dev=1";
export const SCENE = process.env.AUDIT_SCENE ?? "370";

export async function launch(): Promise<Browser> {
  return chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
}

/** Opens a page in play mode on the audit level, with `script` (a plain JS string) evaluated in it. */
export async function boot(browser: Browser, script: string, save?: unknown): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  page.on("pageerror", e => console.warn("[page error]", e.message));
  if (save) await page.addInitScript(`localStorage.setItem("clyde-web-save", ${JSON.stringify(JSON.stringify(save))});`);
  const t0 = Date.now();
  const tick = (what: string) => console.log(`  [boot ${((Date.now() - t0) / 1000).toFixed(0)}s] ${what}`);
  await page.goto(URL);
  await page.waitForSelector("#scenesBox:not([hidden])", { timeout: 120000 });
  tick("scenes listed");
  await page.click(`#scenes li[data-scene*="${SCENE}"]`);
  await page.waitForSelector("#play:not([hidden])", { timeout: 180000 });
  tick("scene loaded");
  await page.click("#play");
  await page.waitForFunction("!!window.__viewer?.world?.knight", null, { timeout: 180000, polling: 500 });
  tick("playing");
  await page.evaluate(script);
  await page.evaluate("window.__audit.init()");
  return page;
}
