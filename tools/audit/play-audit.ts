// Play-mode audit of every monster and every weapon, driven through Playwright against the
// dev server (npx vite --port 5183). The page script (play-audit.page.js) pauses the game
// loop and steps the World with scripted input; this side farms names out to a few pages,
// judges each record and writes docs/research/actor-audit.{json,md}.
//
// Usage: tsx tools/audit/play-audit.ts [monsters|weapons|knight|all] [--workers 3] [--only regex] [--out name]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { boot, launch } from "./boot.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = readFileSync(join(here, "play-audit.page.js"), "utf8");
const args = process.argv.slice(2);
const mode = args[0] && !args[0].startsWith("--") ? args[0] : "all";
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const WORKERS = Number(opt("workers", "3"));
const ONLY = opt("only", "");
const OUT = opt("out", "actor-audit");
const LIMIT = Number(opt("limit", "0"));
const docs = join(here, "..", "..", "docs", "research");
const jsonPath = join(docs, `${OUT}.json`);

type Rec = Record<string, any> & { name: string; problems: string[] };

async function farm(kind: "monsters" | "weapons", fn: string): Promise<Rec[]> {
  const browser = await launch();
  const first = await boot(browser, SCRIPT);
  let names: string[] = await first.evaluate(`window.__audit.names(${JSON.stringify(kind)})`);
  if (ONLY) names = names.filter(n => new RegExp(ONLY, "i").test(n));
  if (LIMIT) names = names.slice(0, LIMIT);
  console.log(`${kind}: ${names.length}`);
  const queue = [...names];
  const out: Rec[] = [];
  const pages: Page[] = [first];
  for (let i = 1; i < WORKERS; i++) pages.push(await boot(browser, SCRIPT));
  let done = 0;
  await Promise.all(pages.map(async (p0, wi) => {
    let page = p0;
    while (queue.length) {
      const name = queue.shift()!;
      let rec: Rec;
      try {
        rec = await Promise.race([
          page.evaluate(`window.__audit.${fn}(${JSON.stringify(name)})`) as Promise<Rec>,
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 90000)),
        ]);
      } catch (e) {
        rec = { name, problems: [`audit error: ${String((e as Error).message).slice(0, 200)}`] };
        try { await page.close(); } catch { /* gone */ }
        page = await boot(browser, SCRIPT);
      }
      out.push(rec);
      done++;
      if (done % 10 === 0) console.log(`  ${done}/${names.length} (worker ${wi}) ${name}`);
    }
  }));
  await browser.close();
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------ judging

// (animation/common/blank.dat is the game's deliberate "no animation", on a placeholder node)
const clipBad = (c: any) => c && (!c.loaded ? `${c.ref} does not load` : c.matched === 0 && c.targets > 0 && !/common\/blank\.dat$/.test(c.ref) ? `${c.ref} targets none of the model's nodes` : null);

function judgeMonster(r: Rec) {
  const p = r.problems;
  if (!r.def) return;
  for (const k of ["idle", "move", "activation", "react", "dying"]) { const b = clipBad(r.clips?.[k]); if (b) p.push(`${k}: ${b}`); }
  if (!r.def.idle) p.push("no idle animation");
  if (r.def.speed > 0 && !r.def.move) p.push("moves but has no movement animation");
  const passive = !r.def.attacks.length;
  r.passive = passive;
  for (const a of r.attackDefs ?? []) {
    for (const ph of ["start", "fire", "end"]) { const b = clipBad(a?.[ph]); if (b) p.push(`attack ${a.name} ${ph}: ${b}`); }
    if (a?.spawn && !a.spawn.loaded) p.push(`attack ${a.name}: projectile ${a.spawn.actor} does not load`);
    else if (a?.spawn && a.spawn.model && !a.spawn.modelLoaded) p.push(`attack ${a.name}: projectile model ${a.spawn.model} does not load`);
    if (a && !a.start && !a.fire && !a.end) p.push(`attack ${a.name} has no animations`);
  }
  if (!passive) {
    if (r.def.speed > 0 && !r.moved && !r.attacked) p.push("never moved toward the knight");
    if (!r.attacked) p.push("never attacked");
    // DungeonActorConfig Monster: a reactTime of 0, or a minReactPercent of 1, never reacts
    const reacts = (r.def.reactTime ?? 567) > 0 && (r.def.minReact ?? 0) < 1;
    if (!r.reacted && reacts) p.push("did not react to a big hit");
  }
  if (r.mappings?.includes("reacting") && !r.def.react) p.push("model has a reacting animation that is not used");
  if (r.mappings?.includes("dying") && !r.def.dying) p.push("model has a dying animation that is not used");
  if (!passive && !r.dying) p.push("did not die");
  if (!passive && !(r.deathEffects ?? []).length) p.push("no death effects");
  for (const e of r.deathEffects ?? []) if (/\(failed\)/.test(e)) p.push(`death effect ${e}`);
  for (const s of r.sounds ?? []) if (/unresolved/.test(s) && !/^null/.test(s)) p.push(`sound ${s}`);
  for (const a of r.monsterAnims ?? []) if (/no clip/.test(a)) p.push(`played ${a}`);
  for (const pr of r.projectiles ?? []) if (/no model/.test(pr)) p.push(`projectile ${pr}`);
  if (r.compound) p.push("compound model (animations play on the parts)");
  r.problems = [...new Set(p)];
}

function judgeWeapon(r: Rec) {
  const p = r.problems;
  if (!r.kind) return;
  const atk = (a: any, label: string) => {
    if (!a) return;
    for (const ph of ["start", "fire", "end"]) { const b = clipBad(a[ph]); if (b) p.push(`${label} ${ph}: ${b}`); }
    if (a.spawn && !a.spawn.loaded) p.push(`${label}: projectile ${a.spawn.actor} does not load`);
    if (a.spawn?.model && !a.spawn.modelLoaded) p.push(`${label}: projectile model ${a.spawn.model} does not load`);
    if (a.spawn?.hitFx && !a.spawn.hitFx.loaded) p.push(`${label}: detonation effect ${a.spawn.hitFx.ref} does not load`);
    if (!a.melee && !a.spawn) p.push(`${label}: neither hits nor spawns`);
  };
  (r.chain ?? []).forEach((a: any, i: number) => atk(a, `attack ${i + 1}`));
  atk(r.charged, "charge"); atk(r.incomplete, "incomplete charge"); atk(r.cooldown, "cooldown");
  for (const run of [r.basic, r.charge]) {
    if (!run) continue;
    const L = run.label;
    if (!run.attacks.length) p.push(`${L}: no attack started`);
    for (const a of run.anims) if (/no clip/.test(a)) p.push(`${L}: played ${a}`);
    if (!run.damage.length) p.push(`${L}: no damage to the test monster`);
    else if (run.damage.every((d: any) => d.knock < 0.5)) p.push(`${L}: no knockback on the test monster`);
    if (r.kind !== "Sword" && !run.projectiles.length) p.push(`${L}: nothing fired`);
    for (const x of run.projectiles) if (/no model/.test(x)) p.push(`${L}: projectile ${x}`);
    for (const e of run.effects) if (/failed/.test(e)) p.push(`${L}: effect ${e}`);
    for (const s of run.sounds) if (/unresolved/.test(s) && !/^null/.test(s)) p.push(`${L}: sound ${s}`);
    if (!run.sounds.length) p.push(`${L}: no sound`);
  }
  if (r.basic && r.kind === "Handgun" && r.cooldown && r.maxChain > 0 && !r.basic.attacks.some((a: string) => a.startsWith(r.cooldown.name))) p.push("chain: the clip was spent but no reload played");
  if (r.charged && !r.chargeOverlay) p.push("charge: no charging pose");
  if (r.charged && r.charge && !r.charge.attacks.some((a: string) => a.startsWith(r.charged.name))) p.push("charge: the charged attack never fired");
  r.problems = [...new Set(p)];
}

// ------------------------------------------------------------------ report

function table(rows: Rec[], cols: [string, (r: Rec) => string][]) {
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  return [`| ${cols.map(c => c[0]).join(" | ")} |`, `|${cols.map(() => "---").join("|")}|`,
    ...rows.map(r => `| ${cols.map(c => esc(c[1](r))).join(" | ")} |`)].join("\n");
}

function counts(recs: Rec[]) {
  const ok = recs.filter(r => !r.problems.length).length;
  return `${ok} OK, ${recs.length - ok} with problems (of ${recs.length})`;
}

function tally(recs: Rec[]) {
  const t = new Map<string, number>();
  for (const r of recs) for (const p of r.problems) {
    const k = p.replace(/[A-Za-z]:?[^ ]*\/[^ ]*(\.dat)?/g, "…").replace(/attack [^:]+:/, "attack …:").replace(/\d+/g, "#");
    t.set(k, (t.get(k) ?? 0) + 1);
  }
  return [...t].sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${n} × ${k}`).join("\n");
}

function writeReport(data: { monsters?: Rec[]; weapons?: Rec[]; knight?: any; lichens?: any; before?: any }) {
  const L: string[] = ["# Actor and weapon audit", "",
    "Generated by `tools/audit/play-audit.ts` (Playwright, SwiftShader) on cached level 370 in play mode. Each monster is spawned",
    "beside a knight that cannot fall, watched for 8 seconds, struck hard once (it should flinch) and then killed. Each weapon is",
    "equipped and fired through its basic chain (a gun until it reloads) and its charge attack against an inert jelly cube.", ""];
  if (data.before) L.push("## Before and after", "", data.before, "");
  if (data.knight) {
    L.push("## Knight", "", "| Action | Playing |", "|---|---|", ...Object.entries(data.knight.played).map(([k, v]) => `| ${k} | ${Array.isArray(v) ? v.join(", ") : v} |`), "");
    const bad = Object.entries(data.knight.clips).filter(([, c]: any) => !c?.loaded || c.matched === 0).map(([k]) => k);
    L.push(bad.length ? `Clips that do not load or do not fit: ${bad.join(", ")}` : "Every knight clip loads and drives the knight's skeleton.", "");
  }
  if (data.lichens) {
    const l = data.lichens;
    L.push("## Lichens", "", "Two Lichen Colony monsters side by side, away from the knight, then one killed alone.", "",
      `- merge attack phases seen: ${(l.mergeAnimation ?? []).join(", ") || "none"}`,
      `- before: ${JSON.stringify(l.before)}`, `- after: ${JSON.stringify(l.after)}`,
      `- fused once into a size 2 colony: ${l.mergedOnce ? "yes" : "no"}`,
      `- killed alone: ${l.killAloneOk ? "it just dies (nothing spawns)" : JSON.stringify(l.killAlone)}`, "");
  }
  if (data.monsters) {
    const m = data.monsters;
    L.push("## Monsters", "", counts(m), "", "Problems by kind:", "", tally(m), "",
      table(m, [["Monster", r => r.name.replace("Character/NPC/Monster/", "")],
        ["Idle / move", r => [r.clipsSeen?.idle?.[0] ?? r.def?.idle, r.def?.move].map(x => (x ?? "-").split("/").slice(-2).join("/")).join(" · ")],
        ["Moves", r => (r.def ? (r.moved ? "yes" : r.def.speed > 0 ? "no" : "turret") : "")],
        ["Attacks", r => (r.def ? (r.passive ? "passive" : r.attacked ? `yes (${[...new Set(r.monsterAttacks)].length})` : "no") : "")],
        ["Reacts", r => (r.def && !r.passive ? (r.reacted ? (r.reactClip ? "yes, anim" : "yes") : "no") : "")],
        ["Dies", r => (r.def && !r.passive ? (r.dying ? `${r.dyingClip && r.def.dying ? "anim" : "no anim"}, ${(r.deathEffects ?? []).length} fx` : "no") : "")],
        ["Problems", r => r.problems.join("; ") || "OK"]]), "");
  }
  if (data.weapons) {
    const w = data.weapons;
    L.push("## Weapons", "", counts(w), "", "Problems by kind:", "", tally(w), "",
      table(w, [["Weapon", r => r.name.replace("Weapon/", "")],
        ["Chain", r => (r.basic?.attacks ?? []).length ? `${r.basic.attacks.length} attacks` : "-"],
        ["Fired", r => [...new Set([...(r.basic?.projectiles ?? []), ...(r.charge?.projectiles ?? [])].map((x: string) => x.split("/").pop()))].join(", ") || "-"],
        ["Damage", r => [r.basic, r.charge].filter(Boolean).map((x: any) => x.damage.length ? `${x.label} ${x.damage.map((d: any) => d.dmg).join("/")}` : `${x.label} none`).join("; ")],
        ["Charge pose", r => (r.chargeOverlay ?? "-").split("/").pop()],
        ["Problems", r => r.problems.join("; ") || "OK"]]), "");
  }
  writeFileSync(join(docs, `${OUT}.md`), L.join("\n"));
}

// ------------------------------------------------------------------ main

const prev = existsSync(jsonPath) ? JSON.parse(readFileSync(jsonPath, "utf8")) : {};
const data: any = { ...prev };
if (mode === "knight" || mode === "all") {
  const browser = await launch();
  const page = await boot(browser, SCRIPT);
  data.knight = await page.evaluate("window.__audit.knight()");
  data.lichens = await page.evaluate("window.__audit.lichens()");
  await browser.close();
}
if (mode === "lichens") {
  const browser = await launch();
  const page = await boot(browser, SCRIPT);
  data.lichens = await page.evaluate("window.__audit.lichens()");
  console.log(JSON.stringify(data.lichens, null, 1));
  await browser.close();
}
if (mode === "monsters" || mode === "all") {
  const recs = await farm("monsters", "monster");
  recs.forEach(judgeMonster);
  data.monsters = ONLY && prev.monsters ? [...prev.monsters.filter((r: Rec) => !recs.some(x => x.name === r.name)), ...recs].sort((a, b) => a.name.localeCompare(b.name)) : recs;
}
if (mode === "weapons" || mode === "all") {
  const recs = await farm("weapons", "weapon");
  recs.forEach(judgeWeapon);
  data.weapons = ONLY && prev.weapons ? [...prev.weapons.filter((r: Rec) => !recs.some(x => x.name === r.name)), ...recs].sort((a, b) => a.name.localeCompare(b.name)) : recs;
}
if (mode === "rejudge") { data.monsters?.forEach((r: Rec) => { r.problems = r.problems.filter(p => /^(no |spawned|model|audit)/.test(p)); judgeMonster(r); }); data.weapons?.forEach((r: Rec) => { r.problems = r.problems.filter(p => /^(no weapon|audit|no dummy)/.test(p)); judgeWeapon(r); }); }
const bi = args.indexOf("--before");
if (bi >= 0) data.before = readFileSync(args[bi + 1], "utf8");
// compact: animation references lose their argument blobs, and event lists keep each entry once
const slim = (k: string, v: any) => typeof v === "string" && v.includes("|{") ? v.slice(0, v.indexOf("|{")) + " (with arguments)"
  : Array.isArray(v) && v.every(x => typeof x === "string") ? [...new Set(v.map(x => x.includes("|{") ? x.slice(0, x.indexOf("|{")) + " (with arguments)" : x))] : v;
writeFileSync(jsonPath, JSON.stringify(data, slim));
writeReport(data);
for (const k of ["monsters", "weapons"]) if (data[k]) console.log(k, counts(data[k]));
