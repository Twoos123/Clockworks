// The Test Range sweep: every weapon, every monster and the knight's core actions, played in
// the Test Range (src/dev/testrange.ts) through headless, muted Chromium (SwiftShader), with
// screenshots at fixed moments, the range's hit readouts, contact sheets per weapon class and
// monster family, and a JSON and Markdown report that flags anomalies. See
// docs/research/test-range.md for how to run it.
//
// The dev server must be up first (or pass --serve):
//   npx vite --config tools/audit/vite.audit.config.ts --port 5183 --strictPort
// then:
//   npx tsx tools/audit/sweep.ts                       everything (long: split it)
//   npx tsx tools/audit/sweep.ts --weapons sword       swords only
//   npx tsx tools/audit/sweep.ts --monsters jelly      monsters whose name matches /jelly/i
//   npx tsx tools/audit/sweep.ts --knight              the knight's actions
//   npx tsx tools/audit/sweep.ts --blocks              blocks broken hit by hit (their hit and break effects)
//   npx tsx tools/audit/sweep.ts --report-only         rebuild the sheets and report
// Options: --out .scratch/sweep  --url http://localhost:5183/  --workers 1  --limit N
//          --redo (sweep items already on disk again)  --redo-errors  --timeout 150  --serve
//
// Resumable: each item's record is written as it finishes (<out>/<kind>/<slug>.json, its
// shots beside it) and skipped on the next run; the sheets and the report are rebuilt from
// every record on disk, so split runs add up.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright";
import { CHROMIUM_ARGS } from "./boot.ts";
import {
  groupOf, judgeBlocks, judgeKnight, judgeMonster, judgeWeapon, parseArgs, reportMarkdown, slug,
  type BlocksRecord, type KnightRecord, type MonsterRecord, type Shot, type WeaponRecord,
} from "./sweep-judge.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const AUDIT_SCRIPT = readFileSync(join(here, "play-audit.page.js"), "utf8");
const SWEEP_SCRIPT = readFileSync(join(here, "sweep.page.js"), "utf8");
const SHEET_SCRIPT = readFileSync(join(here, "sheet.page.js"), "utf8");
const args = parseArgs(process.argv.slice(2));
const OUT = resolve(root, args.out);
const base = args.url.replace(/#.*$/, "");
const RANGE_URL = base + "#dev=1&range";

type Kind = "weapons" | "monsters";
type Rec = WeaponRecord | MonsterRecord;

// ------------------------------------------------------------------ the page

interface RangePage { page: Page; errors: string[] }

async function bootRange(browser: Browser): Promise<RangePage> {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const errors: string[] = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push(`page error: ${e.message}`));
  const t0 = Date.now();
  await page.goto(RANGE_URL);
  await page.waitForFunction("!!window.__range?.ready && !!window.__viewer?.world?.knight", null, { timeout: 300000, polling: 500 });
  console.log(`  [boot ${((Date.now() - t0) / 1000).toFixed(0)}s] the Test Range is up`);
  await page.evaluate(AUDIT_SCRIPT);
  await page.evaluate("window.__audit.init()");
  await page.evaluate(SWEEP_SCRIPT);
  errors.length = 0;
  return { page, errors };
}

function withTimeout<T>(p: Promise<T>, s: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([p, new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`timed out after ${s} s`)), s * 1000); })])
    .finally(() => clearTimeout(timer));
}

// ------------------------------------------------------------------ records on disk

const dirOf = (kind: Kind | "knight" | "blocks") => join(OUT, kind);
const recPath = (kind: Kind, name: string) => join(dirOf(kind), `${slug(name)}.json`);

/** Writes a record's shots as files (full PNG and thumbnail) and the record without the pixels. */
function saveRecord(kind: Kind | "knight" | "blocks", id: string, rec: { shots: (Shot & { full?: string })[] }) {
  const dir = join(dirOf(kind), id);
  mkdirSync(dir, { recursive: true });
  rec.shots.forEach((s, i) => {
    const stem = `${String(i + 1).padStart(2, "0")}-${s.label.replace(/[^a-z0-9]+/gi, "-")}`;
    if (s.full) { writeFileSync(join(dir, `${stem}.png`), Buffer.from(s.full.split(",")[1], "base64")); s.file = `${kind}/${id}/${stem}.png`; }
    if (s.thumb?.startsWith("data:")) { writeFileSync(join(dir, `${stem}.jpg`), Buffer.from(s.thumb.split(",")[1], "base64")); s.thumb = `${kind}/${id}/${stem}.jpg`; }
    delete s.full;
  });
  writeFileSync(join(dirOf(kind), `${id}.json`), JSON.stringify(rec, null, 1));
}

/** The records on disk, judged again (the rules may have changed since they were swept). */
function loadRecords<T>(kind: Kind | "knight" | "blocks"): T[] {
  const dir = dirOf(kind);
  if (!existsSync(dir)) return [];
  const judge = kind === "weapons" ? judgeWeapon : kind === "monsters" ? judgeMonster : kind === "blocks" ? judgeBlocks : judgeKnight;
  return readdirSync(dir).filter(f => f.endsWith(".json")).map(f => {
    const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
    r.problems = (judge as (x: any) => string[])(r);
    return r as T;
  });
}

// ------------------------------------------------------------------ sweeping

async function sweepKind(browser: Browser, kind: Kind, filter: RegExp) {
  const first = await bootRange(browser);
  let names: string[] = await first.page.evaluate(`window.__sweep.${kind}()`);
  names = names.filter(n => filter.test(n)).sort();
  if (args.limit) names = names.slice(0, args.limit);
  const todo = names.filter(n => {
    if (args.redo || !existsSync(recPath(kind, n))) return true;
    if (!args.redoErrors) return false;
    try { return !!JSON.parse(readFileSync(recPath(kind, n), "utf8")).error; } catch { return true; }
  });
  console.log(`${kind}: ${names.length} match, ${todo.length} to sweep (${names.length - todo.length} already on disk)`);
  if (!todo.length) { await first.page.close(); return; }
  mkdirSync(dirOf(kind), { recursive: true });
  const queue = [...todo];
  const pages: RangePage[] = [first];
  for (let i = 1; i < Math.min(args.workers, todo.length); i++) pages.push(await bootRange(browser));
  let done = 0;
  await Promise.all(pages.map(async (p0, wi) => {
    let rp = p0;
    while (queue.length && !stopping) {
      const name = queue.shift()!;
      rp.errors.length = 0;
      let rec: Rec, errors: string[];
      try {
        rec = await withTimeout(rp.page.evaluate(`window.__sweep.${kind === "weapons" ? "weapon" : "monster"}(${JSON.stringify(name)})`) as Promise<Rec>, args.timeout);
        errors = [...rp.errors];
      } catch (e) {
        rec = { name, shots: [], console: [], problems: [], error: String((e as Error).message).slice(0, 300) };
        errors = [...rp.errors];
        // a page that failed mid-item is not trusted for the next: a fresh one
        try { await rp.page.close(); } catch { /* gone */ }
        if (!stopping) rp = await bootRange(browser);
      }
      rec.console = errors;
      rec.problems = kind === "weapons" ? judgeWeapon(rec as WeaponRecord) : judgeMonster(rec as MonsterRecord);
      saveRecord(kind, slug(name), rec);
      done++;
      console.log(`  ${done}/${todo.length} (worker ${wi}) ${name}${rec.problems.length ? ` — ${rec.problems.length} flag(s)` : ""}`);
    }
    try { await rp.page.close(); } catch { /* gone */ }
  }));
}

async function sweepKnight(browser: Browser) {
  if (existsSync(join(dirOf("knight"), "knight.json")) && !args.redo) { console.log("knight: already on disk"); return; }
  const rp = await bootRange(browser);
  let rec: KnightRecord;
  try { rec = await withTimeout(rp.page.evaluate("window.__sweep.knight()") as Promise<KnightRecord>, args.timeout); }
  catch (e) { rec = { actions: [], shots: [], console: [], problems: [], error: String((e as Error).message).slice(0, 300) }; }
  rec.console = [...rp.errors];
  rec.problems = judgeKnight(rec);
  mkdirSync(dirOf("knight"), { recursive: true });
  saveRecord("knight", "knight", rec);
  console.log(`knight: ${rec.problems.length ? rec.problems.join("; ") : "no flags"}`);
  try { await rp.page.close(); } catch { /* gone */ }
}

async function sweepBlocks(browser: Browser) {
  if (existsSync(join(dirOf("blocks"), "blocks.json")) && !args.redo) { console.log("blocks: already on disk"); return; }
  const rp = await bootRange(browser);
  let rec: BlocksRecord;
  try { rec = await withTimeout(rp.page.evaluate("window.__sweep.blocks()") as Promise<BlocksRecord>, args.timeout * 2); }
  catch (e) { rec = { blocks: [], shots: [], console: [], problems: [], error: String((e as Error).message).slice(0, 300) }; }
  rec.console = [...rp.errors];
  rec.problems = judgeBlocks(rec);
  mkdirSync(dirOf("blocks"), { recursive: true });
  saveRecord("blocks", "blocks", rec);
  console.log(`blocks: ${rec.problems.length ? rec.problems.join("; ") : "no flags"}`);
  try { await rp.page.close(); } catch { /* gone */ }
}

// ------------------------------------------------------------------ contact sheets

interface SheetRow { name: string; flags: string[]; tiles: { label: string; src: string | null }[] }

/** The contact sheets from the records on disk (a browser is launched only when there are some). */
async function buildSheets(getBrowser: () => Promise<Browser>): Promise<string[]> {
  const sheetsDir = join(OUT, "sheets");
  mkdirSync(sheetsDir, { recursive: true });
  const groups = new Map<string, { title: string; rows: SheetRow[]; cols: number }>();
  const thumb = (s: Shot) => (s.thumb && existsSync(join(OUT, s.thumb)) ? `data:image/jpeg;base64,${readFileSync(join(OUT, s.thumb)).toString("base64")}` : null);
  const add = (key: string, title: string, cols: number, row: SheetRow) => {
    let g = groups.get(key);
    if (!g) groups.set(key, g = { title, rows: [], cols });
    g.cols = Math.max(g.cols, cols);
    g.rows.push(row);
  };
  for (const kind of ["weapons", "monsters"] as const) {
    for (const r of loadRecords<Rec>(kind).sort((a, b) => a.name.localeCompare(b.name))) {
      const grp = groupOf(kind, r.name);
      add(`${kind}-${grp}`, `${kind === "weapons" ? "Weapons" : "Monsters"}: ${grp}`, kind === "weapons" ? 4 : 6,
        { name: r.name.replace(/^Weapon\//, "").replace(/^Character\/NPC\/Monster\//, ""), flags: r.problems, tiles: r.shots.map(s => ({ label: s.label, src: thumb(s) })) });
    }
  }
  const knight = loadRecords<KnightRecord>("knight")[0];
  if (knight) knight.shots.forEach((s, i) => {
    // the knight's actions, five to a row
    const rowIndex = Math.floor(i / 5);
    const g = groups.get("knight") ?? (groups.set("knight", { title: "Knight", rows: [], cols: 5 }), groups.get("knight")!);
    g.rows[rowIndex] ??= { name: rowIndex ? "" : "Knight", flags: rowIndex ? [] : knight.problems, tiles: [] };
    g.rows[rowIndex].tiles.push({ label: s.label, src: thumb(s) });
  });
  const blocks = loadRecords<BlocksRecord>("blocks")[0];
  if (blocks) {
    // a row per block: its shots are labelled "<block>: <moment>"
    const g = groups.get("blocks") ?? (groups.set("blocks", { title: "Blocks", rows: [], cols: 5 }), groups.get("blocks")!);
    for (const s of blocks.shots) {
      const [name, moment] = s.label.split(": ");
      let row = g.rows.find(r => r.name === name);
      if (!row) g.rows.push(row = { name, flags: blocks.problems.filter(p => p.startsWith(`${name}:`)), tiles: [] });
      row.tiles.push({ label: moment ?? s.label, src: thumb(s) });
      g.cols = Math.max(g.cols, row.tiles.length);
    }
  }
  if (!groups.size) return [];
  const page = await (await getBrowser()).newPage();
  const written: string[] = [];
  try {
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.evaluate(SHEET_SCRIPT);
    for (const [key, g] of groups) {
      // pages of 20 rows (a canvas has a size limit, and so has an image viewer)
      for (let i = 0, n = 1; i < g.rows.length; i += 20, n++) {
        const pages = Math.ceil(g.rows.length / 20);
        const file = `${key}${pages > 1 ? `-${n}` : ""}.png`;
        const sheet = { title: `${g.title}${pages > 1 ? ` (${n} of ${pages})` : ""}`, cols: g.cols, rows: g.rows.slice(i, i + 20) };
        const url = await page.evaluate(`window.drawSheet(${JSON.stringify(sheet)})`) as string;
        writeFileSync(join(sheetsDir, file), Buffer.from(url.split(",")[1], "base64"));
        written.push(file);
      }
    }
  } finally { await page.close(); }
  return written;
}

function writeReport(sheets: string[]) {
  const weapons = loadRecords<WeaponRecord>("weapons").sort((a, b) => a.name.localeCompare(b.name));
  const monsters = loadRecords<MonsterRecord>("monsters").sort((a, b) => a.name.localeCompare(b.name));
  const knight = loadRecords<KnightRecord>("knight")[0] ?? null;
  const blocks = loadRecords<BlocksRecord>("blocks")[0] ?? null;
  const generated = new Date().toISOString();
  writeFileSync(join(OUT, "report.json"), JSON.stringify({ generated, weapons, monsters, knight, blocks, sheets }, null, 1));
  writeFileSync(join(OUT, "report.md"), reportMarkdown({ weapons, monsters, knight, blocks, sheets, generated }));
  const flagged = (l: { problems: string[] }[]) => l.filter(r => r.problems.length).length;
  console.log(`report: ${join(OUT, "report.md")} — weapons ${weapons.length} (${flagged(weapons)} flagged), monsters ${monsters.length} (${flagged(monsters)} flagged)` +
    (knight ? `, knight ${knight.problems.length} flag(s)` : ""));
}

// ------------------------------------------------------------------ the dev server

let server: ChildProcess | null = null;

async function startServer() {
  const port = new URL(base).port || "5183";
  server = spawn("npx", ["vite", "--config", "tools/audit/vite.audit.config.ts", "--port", port, "--strictPort"],
    { cwd: root, shell: true, stdio: ["ignore", "inherit", "inherit"], detached: process.platform !== "win32" });
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    try { if ((await fetch(base)).ok) return; } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`the dev server did not answer at ${base}`);
}

function stopServer() {
  const s = server;
  server = null;
  if (!s?.pid) return;
  // npx runs vite as a child: the whole tree goes
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(s.pid), "/T", "/F"], { stdio: "ignore" });
  else { try { process.kill(-s.pid, "SIGTERM"); } catch { s.kill("SIGTERM"); } }
}

// ------------------------------------------------------------------ main

let stopping = false;
let browser = null as Browser | null;
const shutdown = async (code: number) => {
  stopping = true;
  try { await browser?.close(); } catch { /* gone */ }
  stopServer();
  process.exit(code);
};
process.on("SIGINT", () => void shutdown(130));
process.on("SIGTERM", () => void shutdown(143));

mkdirSync(OUT, { recursive: true });
try {
  if (args.serve && !args.reportOnly) await startServer();
  const getBrowser = async () => (browser ??= await chromium.launch({ args: CHROMIUM_ARGS }));
  if (!args.reportOnly) {
    if (args.knight) await sweepKnight(await getBrowser());
    if (args.blocks) await sweepBlocks(await getBrowser());
    if (args.weapons) await sweepKind(await getBrowser(), "weapons", args.weapons);
    if (args.monsters) await sweepKind(await getBrowser(), "monsters", args.monsters);
  }
  const sheets = await buildSheets(getBrowser);
  writeReport(sheets);
} finally {
  try { await browser?.close(); } catch { /* gone */ }
  browser = null;
  stopServer();
}
