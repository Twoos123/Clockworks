// Page script for the Test Range sweep (tools/audit/sweep.ts). Evaluated as a plain string
// in the viewer page once the Test Range is playing (#dev=1&range) and after the play audit's
// page script (play-audit.page.js, whose window.__audit pauses the game loop, steps the world
// by hand and grabs frames); it installs window.__sweep, which puts one weapon, one monster or
// the knight through its paces and returns what happened with screenshots at fixed moments.
// It reads the world's private members on purpose: this is a test harness, not game code.
(() => {
  const DT = 1 / 30;
  const W = () => window.__viewer.world;
  const A = () => window.__audit;
  const R = () => window.__range;
  const DUMMY = "Character/NPC/Monster/Slime/Jelly/Jelly Cube/Jelly Cube 1";
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const refName = r => (typeof r === "string" ? r : r?.name ?? null);
  const zero = { NORMAL: 0, PIERCING: 0, ELEMENTAL: 0, SHADOW: 0 };

  function nodeNames(inst, out = new Set()) {
    const walk = n => { out.add(n.name); n.children.forEach(walk); };
    if (inst.model.root) walk(inst.model.root);
    for (const c of inst.children) nodeNames(c.instance, out);
    return out;
  }

  /** What a model is playing and whether its clips move its nodes (a bind pose otherwise). */
  function pose(inst) {
    // a compound model (no skeleton of its own) plays on its parts
    const body = inst.model.root ? inst : (inst.children.find(c => c.instance.clip)?.instance ?? inst);
    const names = nodeNames(inst);
    const c = body.clip, o = inst.overlay?.clip ?? null;
    return {
      clip: c?.path ?? null, targets: c?.targets.length ?? 0, matched: c ? c.targets.filter(t => names.has(t)).length : 0,
      overlay: o?.path ?? null, overlayTargets: o?.targets.length ?? 0, overlayMatched: o ? o.targets.filter(t => names.has(t)).length : 0,
    };
  }
  const playing = inst => { const p = pose(inst); return [p.clip, p.overlay].filter(Boolean).join(" + ") || "nothing"; };

  async function thumb(url, w = 320, h = 213) {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.85);
  }

  /** A screenshot of the stage now, a thumbnail for the contact sheet, and the subject's pose. */
  /** The sweep's own framing: the camera close on the stage and the hall lit, so a contact sheet shows the subject. */
  function frame() {
    const v = window.__viewer;
    if (!v || v.__sweepFramed) return;
    v.__sweepFramed = true;
    // the Camera Distance option, applied the way the options screen applies it
    if (v.options_) { v.options_.zoom = 0.35; if (v.cam?.to) v.applyCamView(v.cam.to); }
    const e = v.environment;
    if (e && Array.isArray(e.ambient)) e.ambient = e.ambient.map((x, i) => (i < 3 ? Math.max(x, 0.6) : x));
    if (e && e.fog) e.fog = null;
  }

  async function shot(label, inst) {
    frame();
    const full = await A().grab(2);
    return { label, full, thumb: await thumb(full), pose: inst ? pose(inst) : null, t: +A().log().t.toFixed(2) };
  }

  async function step(seconds, inp, until) {
    const n = Math.max(1, Math.round(seconds / DT));
    for (let i = 0; i < n; i++) {
      await A().step(DT, typeof inp === "function" ? inp(i) : inp);
      if (until && until(i)) return true;
    }
    return false;
  }

  /** The range's dummy in front of the knight, once its appearance has played (a spawning monster takes no hits). */
  async function placeDummy(dist) {
    const d = await R().placeDummy(DUMMY, dist);
    if (!d) return null;
    if (d.state === "spawning") await step(3, () => ({}), () => d.state !== "spawning");
    return R().placeDummy(DUMMY, dist);
  }

  const knightProjectiles = () => W().projectiles.some(p => p.team === "knight" && !p.done);

  /** What the audit's log saw since it was reset, for one run. */
  function runLog(who) {
    const log = A().log();
    return {
      attacks: log.attacks.filter(a => a.who === who).map(a => a.name),
      projectiles: log.projectiles.filter(p => (who === "knight" ? p.team === "knight" : p.team !== "knight")).map(p => `${p.name}${p.instance ? "" : " (no model)"}`),
      effects: log.effects.map(e => `${e.ref}${e.loaded === false ? " (failed)" : ""}`),
      sounds: log.sounds.map(s => `${s.ref}${s.resolved === false ? " (unresolved)" : ""}`),
    };
  }

  /** A fresh start: the audit's reset (no monsters, the knight home), the range's pens empty. */
  function fresh() {
    R().clearAll();
    A().reset();
    R().clearHits();
    const k = W().knight;
    k.undying = true;
    k.heading = 0;
  }

  window.__sweep = {
    weapons: () => R().weapons(),
    monsters: () => R().monsters(),

    async weapon(name) {
      const w = W(), k = w.knight;
      const rec = { name, shots: [], console: [], problems: [] };
      fresh();
      await R().equip({ weapons: [name] });
      const def = k.weapon;
      if (!def || def.name !== name) { rec.error = "did not equip"; return rec; }
      Object.assign(rec, { kind: def.kind, rarity: def.rarity, chargeTime: def.chargeTime, attackNames: def.attacks.map(a => a.name), chargedName: def.chargedAttack?.name ?? null });
      const dist = def.kind === "Sword" ? 1.6 : def.kind === "Bomb" ? 1.2 : 4;
      let dummy = await placeDummy(dist);
      if (!dummy) { rec.error = "no dummy"; return rec; }
      const aim = () => [dummy.x, dummy.y];

      // the basic chain (a gun until its clip is spent and it reloads)
      const presses = def.kind === "Sword" ? def.attacks.length : Math.max(def.attacks.length, def.maxChain || 1);
      let pressed = 0, tick = 0;
      // a press every 5 ticks until the chain is done, across the steps below
      const drive = () => {
        const inp = { aim: aim() };
        if (tick++ % 5 === 0 && pressed < presses) { inp.attackDown = true; pressed++; }
        return inp;
      };
      const started = () => A().log().attacks.filter(a => a.who === "knight").length;
      if (await step(7, drive, () => k.attack?.phase === "fire")) rec.shots.push(await shot("chain 1", k.instance));
      if (presses > 1) await step(8, drive, () => pressed >= presses && started() > 1 && k.attack?.phase === "fire");
      else await step(0.15, drive);
      rec.shots.push(await shot("chain end", k.instance));
      await step(4, drive, () => pressed >= presses && !k.attack && !knightProjectiles());
      await step(1, () => ({ aim: aim() }));
      await sleep(300);
      rec.chain = { ...runLog("knight"), hits: R().hits().filter(h => h.from === "knight") };

      // a full charge and release
      if (def.chargedAttack) {
        fresh();
        dummy = await placeDummy(dist);
        if (!dummy) { rec.error = "no dummy"; return rec; }
        await step(DT, { attackDown: true, attackHeld: true, aim: aim() });
        let chargePose = null;
        const full = await step(def.chargeTime / 1000 + 4, () => ({ aim: aim() }), () => {
          if (k.charge !== null) chargePose ??= k.instance.overlay?.clip?.path ?? null;
          return k.charge !== null && k.charge * 1000 >= def.chargeTime + 150;
        });
        rec.shots.push(await shot("charged", k.instance));
        chargePose = k.instance.overlay?.clip?.path ?? chargePose;
        await step(DT, { attackHeld: false, aim: aim() });
        await step(2, () => ({ aim: aim() }), () => k.attack?.phase === "fire");
        await step(0.1, () => ({ aim: aim() }));
        rec.shots.push(await shot("release", k.instance));
        await step(4, () => ({ aim: aim() }), () => !k.attack && !knightProjectiles());
        await step(1, () => ({ aim: aim() }));
        await sleep(300);
        rec.charge = { ...runLog("knight"), hits: R().hits().filter(h => h.from === "knight"), full, pose: chargePose };
      }
      R().clearAll();
      return rec;
    },

    async monster(name) {
      const w = W(), k = w.knight;
      const rec = { name, shots: [], console: [], problems: [] };
      fresh();
      const [m] = await R().spawn(name, { hold: "frozen", undying: true, dist: 4.5, count: 1 });
      if (!m) {
        const cfg = w.data.resolveSync("config/actor.dat", { name }, "actor");
        rec.error = `never appeared (${String(cfg?.$class ?? "no config").split("$").pop()})`;
        return rec;
      }
      const d = m.def;
      Object.assign(rec, { passive: m.passive, speed: d.targetedSpeed || d.speed, attackNames: d.attacks.map(a => a.name), idle: refName(d.idle), move: refName(d.move),
        react: refName(d.react), dying: refName(d.dying), reactTime: d.reactTime, minReact: d.minReactPercent });
      const face = () => { m.heading = Math.atan2(k.y - m.y, k.x - m.x); k.heading = Math.atan2(m.y - k.y, m.x - k.x); };
      face();
      // idle (after its activation)
      await step(1.6, () => ({ aim: [m.x, m.y] }));
      rec.shots.push(await shot("idle", m.instance));
      // its movement animation, posed in place
      if (d.move) {
        m.hold = "pose";
        w.playOn(m, d.move, true);
        await sleep(100);
        await step(0.6, () => ({ aim: [m.x, m.y] }));
        rec.shots.push(await shot("move", m.instance));
        m.hold = "frozen";
      }
      // its first attack, made by hand with the knight in reach
      const atk = d.attacks[0] ?? null;
      if (atk && !m.passive) {
        const reach = atk.shape ? Math.max(0.6, atk.shape.forward + Math.max(atk.shape.halfLength, atk.shape.radius) * 0.5) : 4;
        const a = Math.atan2(k.y - m.y, k.x - m.x);
        k.x = m.x + Math.cos(a) * (reach + m.radius * 0.5); k.y = m.y + Math.sin(a) * (reach + m.radius * 0.5);
        face();
        A().log().projectiles.length = 0; A().log().effects.length = 0;
        R().clearHits();
        w.monsterAttack(m, atk);
        const t = R().attackTiming(atk);
        await step(Math.max(DT, t.startup / 2000), () => ({ aim: [m.x, m.y] }));
        rec.shots.push(await shot("wind-up", m.instance));
        await step(2, () => ({ aim: [m.x, m.y] }), () => m.attack?.phase !== "start");
        await step(0.1, () => ({ aim: [m.x, m.y] }));
        rec.shots.push(await shot("attack", m.instance));
        await step(3, () => ({ aim: [m.x, m.y] }), () => !m.attack && !w.projectiles.some(p => p.team !== "knight" && !p.done));
        await step(0.5, () => ({ aim: [m.x, m.y] }));
        await sleep(200);
        const l = runLog("monster");
        rec.forced = { name: atk.name, hits: R().hits().filter(h => h.to === "knight"), projectiles: l.projectiles, effects: l.effects };
        // left to its own behaviour: does it come at the knight and attack?
        k.x += Math.cos(a) * 3; k.y += Math.sin(a) * 3;
        const n0 = A().log().attacks.filter(x => x.who === "monster").length, x0 = m.x, y0 = m.y;
        m.hold = "live";
        await step(6, () => ({}), () => A().log().attacks.filter(x => x.who === "monster").length > n0);
        rec.live = { attacked: A().log().attacks.filter(x => x.who === "monster").length > n0, moved: +Math.hypot(m.x - x0, m.y - y0).toFixed(2) };
        m.hold = "frozen";
        m.attack = null;
        await step(0.5, () => ({}));
      }
      // a hard hit: it should flinch
      if (!m.passive) {
        face();
        R().clearHits();
        R().strike(m, 0.6, 1.5);
        rec.reacted = m.reacting > 0;
        await step(0.12, () => ({}));
        rec.shots.push(await shot("hit", m.instance));
        await step(0.6, () => ({}));
        // and a killing blow
        const fx0 = A().log().effects.length;
        R().kill(m);
        await step(0.35, () => ({}));
        rec.died = m.state === "dying";
        rec.shots.push(await shot("death", m.instance));
        let gone = null;
        await step(4, () => ({}), () => { if (!w.monsters.includes(m)) { gone = +A().log().t.toFixed(2); return true; } return false; });
        rec.removedAfter = gone;
        await sleep(300);
        rec.deathEffects = A().log().effects.slice(fx0).map(e => `${e.ref}${e.loaded === false ? " (failed)" : ""}`);
      }
      R().clearAll();
      return rec;
    },

    /** The knight's core actions, each held a moment and shot. */
    async knight() {
      const w = W();
      const rec = { actions: [], shots: [], console: [], problems: [] };
      fresh();
      await R().equip({ weapons: ["Weapon/Sword/Proto Sword"], shield: "" });
      const k = () => W().knight;
      const act = async (label, run) => {
        fresh();
        await run();
        rec.actions.push({ label, playing: playing(k().instance), dead: k().dead });
        rec.shots.push(await shot(label, k().instance));
      };
      const ahead = () => [k().x + 5, k().y];
      await act("idle", () => step(1, () => ({})));
      await act("walk", () => step(0.6, () => ({ move: [1, 0], aim: ahead() })));
      await act("run", () => step(0.6, () => ({ move: [1, 0] })));
      await act("dash", async () => { await step(DT, { dash: true, move: [1, 0] }); await step(0.15, () => ({ move: [1, 0] })); });
      await act("shield up", () => step(0.5, () => ({ shield: true, aim: ahead() })));
      await act("shield hit", async () => {
        await step(0.5, () => ({ shield: true, aim: ahead() }));
        w.damageKnight({ ...zero, NORMAL: 5 }, 0.5, k().x + 1, k().y);
        await step(0.1, () => ({ shield: true, aim: ahead() }));
      });
      await act("hurt", async () => { await step(0.4, () => ({})); k().undying = true; w.damageKnight({ ...zero, NORMAL: 5 }, 0.5, k().x + 1, k().y); await step(0.1, () => ({})); });
      await act("knockdown", async () => { await step(0.3, () => ({})); w.damageKnight({ ...zero, NORMAL: 5, major: true }, 1, k().x + 1, k().y); await step(0.2, () => ({})); });
      await act("death", async () => {
        await step(0.4, () => ({}));
        k().undying = false; k().health = 1;
        w.damageKnight({ ...zero, NORMAL: 50 }, 0.5, k().x + 1, k().y);
        await step(0.9, () => ({}));
      });
      // revive from where it fell (fresh() would stand it up)
      w.revive();
      await step(0.6, () => ({}));
      rec.actions.push({ label: "revive", playing: playing(k().instance), dead: k().dead });
      rec.shots.push(await shot("revive", k().instance));
      fresh();
      return rec;
    },
  };
})();
