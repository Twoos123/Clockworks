// Page script for the play-mode audits (tools/audit/play-audit.ts). Evaluated as a plain
// string in the viewer page once play mode is running; it installs window.__audit, which
// pauses the viewer's own loop and steps the World by hand with scripted input, recording
// what the actors and weapons do. It reads the world's private members on purpose: this is
// a test harness, not game code.
(() => {
  const DT = 1 / 30;
  const W = () => window.__viewer.world;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const refName = r => (typeof r === "string" ? r : r?.name ?? null);
  const blank = () => ({ move: [0, 0], attackDown: false, attackHeld: false, shield: false, aim: null, weaponSlot: null, interact: false, dash: false });
  const clipKey = p => (typeof p === "string" ? p : p.name + JSON.stringify(p.arguments?.entries ?? [], (k, v) => (k === "$outer" ? undefined : v)));
  const DUMMY = "Character/NPC/Monster/Slime/Jelly/Jelly Cube/Jelly Cube 1";

  let log = null;
  const resetLog = () => { log = { effects: [], sounds: [], animate: [], attacks: [], damage: [], projectiles: [], detonations: [], actions: [], deaths: [], t: 0 }; };
  resetLog();
  let input = blank();
  let home = [0, 0];
  let dummy = null;

  function nodeNames(inst, out = new Set()) {
    const walk = n => { out.add(n.name); n.children.forEach(walk); };
    if (inst.model.root) walk(inst.model.root);
    for (const c of inst.children) nodeNames(c.instance, out);
    return out;
  }

  /** Loads a clip through the world's cache and describes it against an instance's skeleton. */
  async function clipInfo(ref, inst) {
    if (!ref) return null;
    const w = W();
    w.clip(ref);
    const c = await w.clips.get(clipKey(ref));
    if (!c) return { ref: refName(ref), loaded: false };
    const names = inst ? nodeNames(inst) : new Set();
    const matched = c.targets.filter(t => names.has(t)).length;
    return { ref: refName(ref), loaded: true, targets: c.targets.length, matched, frames: c.frames.length, loop: c.loop, actions: c.actions.length };
  }

  async function projectileInfo(actor) {
    const w = W();
    const l = await w.projectileDef(actor);
    if (!l) return { actor: refName(actor), loaded: false };
    const d = l.def;
    const fx = async r => (r ? { ref: refName(r), loaded: !!(await w.loader.loadRef(r).catch(() => null)) } : null);
    return { actor: refName(actor), loaded: true, kind: d.kind, model: refName(d.model), modelLoaded: !!l.model, speed: d.speed, fuse: d.fuse,
      radius: d.regionRadius, hitFx: await fx(d.hitFx), fizzleFx: await fx(d.fizzleFx) };
  }

  async function attackInfo(a, inst) {
    if (!a) return null;
    return { name: a.name, start: await clipInfo(a.start, inst), fire: await clipInfo(a.fire, inst), end: await clipInfo(a.end, inst),
      melee: !!a.shape, spawn: a.spawn ? await projectileInfo(a.spawn.actor) : null, swing: refName(a.swing), damage: !!a.damage, impulse: !!a.impulse };
  }

  function hook(obj, name, wrap) {
    const orig = obj[name];
    obj[name] = function (...args) { return wrap.call(this, orig, args); };
  }

  function install() {
    const w = W();
    hook(w, "spawnEffect", function (orig, args) {
      const rec = { ref: refName(args[0]), t: log.t, loaded: null };
      log.effects.push(rec);
      void w.loader.loadRef(args[0]).catch(() => null).then(m => { rec.loaded = !!m; });
      return orig.apply(this, args);
    });
    if (w.audio) hook(w.audio, "play", function (orig, args) {
      if (!args[0]) return orig.apply(this, args); // a "Sound" argument left empty: nothing to play
      const rec = { ref: refName(args[0]), t: log.t, resolved: null };
      log.sounds.push(rec);
      void w.audio.resolve(args[0]).then(c => { rec.resolved = !!c; rec.kind = String(c?.$class ?? "").split("$").pop(); });
      return orig.apply(this, args);
    });
    hook(w, "animate", function (orig, args) {
      const [a, path] = args;
      const r = orig.apply(this, args);
      log.animate.push({ who: a === w.knight ? "knight" : "monster", attack: a.attack?.def.name, phase: a.attack?.phase, ref: refName(path),
        overlay: !!a.attack?.overlay, clip: !!w.clip(path), t: log.t });
      return r;
    });
    hook(w, "startAttack", function (orig, args) {
      const [a, def, overlay] = args;
      log.attacks.push({ who: a === w.knight ? "knight" : "monster", name: def.name, overlay: !!overlay, t: log.t });
      return orig.apply(this, args);
    });
    hook(w, "damageMonster", function (orig, args) {
      const m = args[0];
      if (m === dummy || m.__keepAlive) {
        const before = 1e9;
        m.health = before;
        const r = orig.apply(this, args);
        log.damage.push({ dmg: before - m.health, kx: m.kx, ky: m.ky, reacting: m.reacting, statuses: m.statuses.map(s => s.def.kind), t: log.t });
        m.health = m.maxHealth;
        if (m.state === "dying") m.state = "chase";
        return r;
      }
      return orig.apply(this, args);
    });
    hook(w, "startDying", function (orig, args) {
      log.deaths.push({ name: args[0].entity?.name, t: log.t, stack: new Error().stack.split("\n").slice(2, 9).map(s => s.trim()).join(" < ") });
      return orig.apply(this, args);
    });
    hook(w, "detonate", function (orig, args) {
      const p = args[0];
      log.detonations.push({ name: p.def.name, team: p.team, hitFx: refName(p.def.hitFx), t: log.t });
      return orig.apply(this, args);
    });
    hook(w, "modelAction", function (orig, args) {
      const a = args[0];
      if (args[3] === undefined) log.actions.push({ kind: String(a?.$class ?? "").split("$").pop(), model: refName(a?.model), sounder: refName(a?.sounder), t: log.t });
      return orig.apply(this, args);
    });
  }

  const seenProj = new WeakSet();
  async function step(seconds, each) {
    const w = W();
    const n = Math.max(1, Math.round(seconds / DT));
    for (let i = 0; i < n; i++) {
      w.update(DT, { ...input });
      window.__viewer.renderer.time += DT; // particles and effects keep time with the world
      input.attackDown = false; input.dash = false; input.weaponSlot = null; input.interact = false;
      log.t += DT;
      w.knight.instance.update();
      for (const m of w.monsters) m.instance.update();
      for (const p of w.projectiles) {
        if (seenProj.has(p)) continue;
        seenProj.add(p);
        log.projectiles.push({ name: p.def.name, kind: p.def.kind, team: p.team, model: refName(p.def.model), instance: !!p.instance || !p.def.model, t: log.t });
      }
      if (each && each(i) === false) break;
      if (i % 2 === 0) await sleep(0);
    }
  }

  function removeMonster(m) {
    const w = W();
    const i = w.monsters.indexOf(m);
    if (i >= 0) w.monsters.splice(i, 1);
    if (m.entity) w.logic.vanish(m.entity);
  }

  function clearAll(keepDummy) {
    const w = W();
    for (const m of [...w.monsters]) if (!(keepDummy && m === dummy)) removeMonster(m);
    // every actor the tests left (minions, markers, bullets as actors), with their timers
    for (const e of [...w.logic.actors]) if (e.isActor && e !== w.knightEntity && !e.fixedShape && !(e.game && e.game.constructor?.name === "Prop") && !(keepDummy && dummy && e === dummy.entity)) w.logic.vanish(e);
    w.logic.tick(0);
    w.delayed.length = 0;
    w.projectiles.length = 0;
    w.effects.length = 0;
    w.knight.statuses.length = 0;
  }

  function resetKnight() {
    const w = W(), k = w.knight;
    k.maxHealth = k.health = 1e7;
    k.dead = false; w.defeated = false;
    k.x = home[0]; k.y = home[1]; k.z = w.collision.groundZ(k.x, k.y);
    k.heading = 0; k.kx = k.ky = 0; k.lunge = { vx: 0, vy: 0, t: 0 };
    k.attack = null; k.charge = null; k.chain = 0; k.chainUsed = 0; k.buffered = false; k.rearm = 0; k.dashing = false;
    k.invulnerable = 0; k.hurtTime = 0; k.stagger = 0; k.shielding = false; k.dashCooldown = 0; k.sinceAttack = 10;
    k.instance.overlay = null;
    input = blank();
  }

  async function waitFor(fn, ms = 20000) {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100); }
    return null;
  }

  async function spawnMonster(name, dx, dy) {
    const w = W(), k = w.knight;
    const spot = w.collision.findSpawn(k.x + dx, k.y + dy, 0.6, 1 | 2 | 8 | 32) ?? [k.x + dx, k.y + dy];
    const before = new Set(w.logic.actors);
    w.spawnAt({ name }, spot[0], spot[1], Math.atan2(-dy, -dx));
    const ent = w.logic.actors.find(e => !before.has(e) && e.name === name) ?? null;
    return { ent, spot };
  }

  const summary = def => ({
    model: refName(def.model), scale: def.scale, radius: def.radius, speed: def.targetedSpeed, turnRate: def.turnRate,
    idle: refName(def.idle), move: refName(def.move), activation: refName(def.activation), attacks: def.attacks.map(a => a.name),
    hitFx: refName(def.hitFx), deathFx: refName(def.deathFx), react: refName(def.react), dying: refName(def.dying), deathTime: def.deathTime,
    minReact: def.minReactPercent,
  });

  window.__audit = {
    async init() {
      const v = window.__viewer, w = W();
      // drawing under SwiftShader costs far more than the simulation; frames wait while the
      // audit runs and resume for screenshots (__audit.render(true))
      if (!window.__auditRaf) {
        const raf = window.requestAnimationFrame.bind(window);
        window.__auditRaf = raf;
        window.__auditDraw = false;
        window.requestAnimationFrame = cb => raf(t => {
          if (!window.__auditDraw) { setTimeout(() => window.requestAnimationFrame(cb), 30); return; }
          cb(t);
          // a screenshot straight from the canvas, read in the frame that drew it
          if (window.__auditGrab && --window.__auditGrab.frames <= 0) {
            const g = window.__auditGrab; window.__auditGrab = null;
            g.resolve(window.__viewer.canvas.toDataURL("image/png"));
          }
        });
      }
      v.paused = true;
      install();
      // an open stretch of floor near the start, so monsters have room to come at the knight
      home = w.collision.findSpawn(w.knight.x, w.knight.y, 3, 43) ?? [w.knight.x, w.knight.y];
      // a level with no monsters left over, and a knight that cannot fall
      clearAll(false);
      if (w.arena) w.arena = null;
      resetKnight();
      return true;
    },

    names(kind) {
      const w = W();
      if (kind === "monsters") return [...w.data.library_("config/actor.dat").keys()].filter(n => n.startsWith("Character/NPC/Monster/") && !/\/Parts\/|\/Dev\/|Test/.test(n));
      return [...w.data.library_("config/item.dat").keys()].filter(n => /^Weapon\/(Sword|Handgun|Bomb)\//.test(n) && !/\/Parts\/|\/Dev\/|Test/.test(n));
    },

    /** Spawns one monster next to the knight and puts it through its paces. */
    async monster(name) {
      const w = W(), k = w.knight;
      clearAll(false); dummy = null;
      resetKnight(); resetLog();
      const rec = { name, problems: [] };
      const cfg = w.data.resolveSync("config/actor.dat", { name }, "actor");
      rec.class = String(cfg?.$class ?? "").split("$").pop();
      const { ent } = await spawnMonster(name, 4, 0);
      if (!ent) { rec.problems.push("no logic actor"); return rec; }
      const m = await waitFor(() => w.monsters.find(x => x.entity === ent), 20000);
      if (!m) {
        if (ent.game && ent.game.constructor?.name === "Prop") { rec.prop = true; rec.problems.push(`spawned as a prop (${rec.class})`); return rec; }
        const def = await w.data.monster({ name });
        if (!def) rec.problems.push(`no monster def (class ${rec.class})`);
        else {
          const model = await w.loader.loadRef(def.model);
          rec.def = summary(def);
          rec.problems.push(model ? "model loaded but monster never appeared" : `model failed: ${refName(def.model)}`);
        }
        return rec;
      }
      m.__keepAlive = false;
      const inst = m.instance;
      rec.def = summary(m.def);
      rec.compound = !inst.model.root;
      rec.nodes = nodeNames(inst).size;
      rec.mappings = Object.keys(inst.model.animations ?? {});
      rec.clips = {
        idle: await clipInfo(m.def.idle, inst), move: await clipInfo(m.def.move, inst), activation: await clipInfo(m.def.activation, inst),
        react: await clipInfo(m.def.react, inst), dying: await clipInfo(m.def.dying, inst),
      };
      rec.attackDefs = [];
      for (const a of m.def.attacks) rec.attackDefs.push(await attackInfo(a, inst));
      const clipsSeen = {};
      const note = () => { const p = inst.clip?.path ?? (inst.children.find(c => c.instance.clip)?.instance.clip?.path) ?? null; (clipsSeen[m.state] ??= new Set()).add(p); };
      // spawn, then let it come at the knight
      await step(1.5, note);
      rec.stateAfterSpawn = m.state;
      if (log.deaths.length) rec.earlyDeath = log.deaths[0];
      const d0 = Math.hypot(m.x - k.x, m.y - k.y);
      let minD = d0, attacked = false, hurt = false;
      const hp = k.health;
      await step(8, () => {
        note();
        minD = Math.min(minD, Math.hypot(m.x - k.x, m.y - k.y));
        if (m.attack) attacked = true;
        if (k.health < hp) hurt = true;
        if (m.state === "dying" || !w.monsters.includes(m)) return false;
      });
      // a monster that stays put (a polyp, a turret) may only strike up close: step in
      if (!attacked && m.state !== "dying" && w.monsters.includes(m)) {
        rec.closeIn = true;
        const a = Math.atan2(k.y - m.y, k.x - m.x), d = m.radius + k.radius + 0.5;
        k.x = m.x + Math.cos(a) * d; k.y = m.y + Math.sin(a) * d;
        await step(5, () => {
          note();
          if (m.attack) attacked = true;
          if (k.health < hp) hurt = true;
          if (attacked || m.state === "dying" || !w.monsters.includes(m)) return false;
        });
      }
      rec.startDist = +d0.toFixed(2); rec.minDist = +minD.toFixed(2);
      rec.moved = d0 - minD > 0.5;
      rec.attacked = attacked; rec.hitKnight = hurt;
      rec.monsterAttacks = log.attacks.filter(a => a.who === "monster").map(a => a.name);
      rec.monsterAnims = log.animate.filter(a => a.who === "monster").map(a => `${a.phase}:${a.ref}${a.clip ? "" : " (no clip)"}`);
      rec.projectiles = log.projectiles.filter(p => p.team === "monster").map(p => `${p.name}${p.instance ? "" : " (no model)"}`);
      // a big hit: it should flinch
      m.attack = null; m.__keepAlive = true;
      const fxBefore = log.effects.length;
      w.damageMonster(m, { NORMAL: m.maxHealth * 3, PIERCING: 0, ELEMENTAL: 0, SHADOW: 0 }, 1, k.x, k.y);
      rec.reacted = m.reacting > 0;
      await step(0.25, note);
      rec.reactClip = inst.clip?.path ?? null;
      rec.hitEffects = log.effects.slice(fxBefore).map(e => e.ref);
      // and a killing blow
      m.__keepAlive = false;
      await step(0.6);
      const fxKill = log.effects.length;
      w.damageMonster(m, { NORMAL: 1e9, PIERCING: 0, ELEMENTAL: 0, SHADOW: 0 }, 1, k.x, k.y);
      rec.dying = m.state === "dying";
      let gone = null;
      await step(0.2);
      rec.dyingClip = inst.clip?.path ?? null;
      await step(4, () => { if (!w.monsters.includes(m)) { gone = log.t; return false; } });
      rec.removedAfter = gone;
      await sleep(300);
      rec.deathEffects = log.effects.slice(fxKill).map(e => `${e.ref}${e.loaded === false ? " (failed)" : ""}`);
      rec.clipsSeen = Object.fromEntries(Object.entries(clipsSeen).map(([k2, v]) => [k2, [...v]]));
      rec.sounds = log.sounds.map(s => `${s.ref}${s.resolved === false ? " (unresolved)" : ""}`).filter((s, i, a) => a.indexOf(s) === i);
      clearAll(false);
      return rec;
    },

    /** Gives the knight one weapon (as World.start does for each loadout entry). */
    async equip(name) {
      const w = W(), k = w.knight;
      const def = await w.data.weapon(name);
      if (!def) return null;
      const inst = await w.knightInstance(def, k.shield, k.armor);
      await w.preloadAttacks([...def.attacks, def.chargedAttack, def.incompleteChargedAttack, def.cooldownAttack]);
      inst.time = 0;
      k.weapons = [{ def, instance: inst }];
      k.slot = 0;
      k.instance = inst;
      k.upperBody = inst.subtree("Bip01 Spine");
      w.play(k, "character/pc/idle.dat");
      return def;
    },

    /** An inert jelly in front of the knight to take the hits. */
    async placeDummy(dist) {
      const w = W(), k = w.knight;
      if (!dummy || !w.monsters.includes(dummy)) {
        const { ent } = await spawnMonster(DUMMY, dist, 0);
        dummy = await waitFor(() => w.monsters.find(x => x.entity === ent), 20000);
        if (!dummy) return false;
        await step(1.5);
      }
      dummy.def = { ...dummy.def, targetedSpeed: 0, speed: 0 };
      dummy.cooldown = 1e9; dummy.attack = null; dummy.reacting = 0; dummy.statuses.length = 0;
      dummy.kx = dummy.ky = 0;
      dummy.state = "chase";
      dummy.x = k.x + dist; dummy.y = k.y; dummy.z = w.collision.groundZ(dummy.x, dummy.y);
      input.aim = [dummy.x, dummy.y];
      k.heading = 0;
      return true;
    },

    async weapon(name, opts = {}) {
      const w = W(), k = w.knight;
      clearAll(true);
      resetKnight(); resetLog();
      const rec = { name, problems: [] };
      const def = await this.equip(name);
      if (!def) { rec.problems.push("no weapon def"); return rec; }
      const inst = k.instance;
      rec.kind = def.kind; rec.maxChain = def.maxChain; rec.chargeTime = def.chargeTime; rec.overlayAttacks = def.attackingSpeed != null;
      rec.model = refName(def.model);
      rec.chain = [];
      for (const a of def.attacks) rec.chain.push(await attackInfo(a, inst));
      rec.charged = await attackInfo(def.chargedAttack, inst);
      rec.incomplete = await attackInfo(def.incompleteChargedAttack, inst);
      rec.cooldown = await attackInfo(def.cooldownAttack, inst);
      const dist = def.kind === "Sword" ? 1.4 : def.kind === "Bomb" ? 0.9 : 3.5;
      if (!(await this.placeDummy(dist))) rec.problems.push("no dummy monster");
      const keep = () => { if (dummy) { dummy.cooldown = 1e9; dummy.x = k.x + Math.cos(k.heading) * dist; dummy.y = k.y + Math.sin(k.heading) * dist; dummy.kx *= 0.5; } };
      const run = async (label, fn) => {
        resetLog();
        resetKnight();
        if (dummy) await this.placeDummy(dist);
        await fn();
        await sleep(400);
        return {
          label,
          attacks: log.attacks.filter(a => a.who === "knight").map(a => `${a.name}${a.overlay ? " [upper]" : ""}`),
          anims: log.animate.filter(a => a.who === "knight").map(a => `${a.phase}:${a.ref}${a.clip ? "" : " (no clip)"}${a.overlay ? " [upper]" : ""}`),
          projectiles: log.projectiles.filter(p => p.team === "knight").map(p => `${p.name}${p.instance ? "" : " (no model)"}`),
          detonations: log.detonations.filter(p => p.team === "knight").map(p => `${p.name} -> ${p.hitFx}`),
          effects: log.effects.map(e => `${e.ref}${e.loaded === false ? " (failed)" : ""}`),
          sounds: log.sounds.map(s => `${s.ref}${s.resolved === false ? " (unresolved)" : ""}`),
          actions: log.actions.map(a => `${a.kind}:${a.model ?? a.sounder ?? ""}`),
          damage: log.damage.map(d => ({ dmg: Math.round(d.dmg), knock: +Math.hypot(d.kx, d.ky).toFixed(1), reacting: d.reacting > 0, statuses: d.statuses })),
        };
      };
      // the basic chain (a gun until its clip is spent and it reloads)
      const presses = def.kind === "Sword" ? def.attacks.length : Math.max(def.attacks.length, def.maxChain || 1);
      rec.basic = def.attacks.length ? await run("chain", async () => {
        let pressed = 0;
        await step(6, i => {
          keep();
          if (i % 5 === 0 && pressed < presses) { input.attackDown = true; pressed++; }
          if (pressed >= presses && i > 10 && !k.attack && k.charge === null) return false;
        });
        await step(1.5, keep);
        await step(4, () => { keep(); if (!w.projectiles.some(p => p.team === "knight" && !p.done)) return false; });
        await step(1, keep); // the blast's scripted effects and sounds
      }) : null;
      // the charge attack
      rec.charge = def.chargedAttack ? await run("charge", async () => {
        input.attackDown = true; input.attackHeld = true;
        let chargeClip = null, held = 0;
        // a gun's first press fires a shot; the charge builds once it is done
        await step(def.chargeTime / 1000 + 4, () => {
          keep();
          if (k.charge !== null) { chargeClip ??= k.instance.overlay?.clip?.path ?? null; held++; }
          if (k.charge !== null && k.charge * 1000 > def.chargeTime + 200) return false;
        });
        rec.chargeOverlay = k.instance.overlay?.clip?.path ?? chargeClip;
        input.attackHeld = false;
        await step(3, i => { keep(); if (i > 10 && !k.attack) return false; });
        await step(0.5, keep);
        // bombs on their fuse, bullets in flight
        await step(4, () => { keep(); if (!w.projectiles.some(p => p.team === "knight" && !p.done)) return false; });
        await step(1, keep); // the blast's scripted effects and sounds
      }) : null;
      return rec;
    },

    /** The knight's own animations: idles, movement, shield, dash, hurt, death and revive. */
    async knight() {
      const w = W(), k = w.knight;
      clearAll(false); dummy = null;
      resetKnight(); resetLog();
      const inst = k.instance;
      const out = { clips: {}, played: {} };
      const paths = ["character/pc/idle.dat", ...["001", "002", "003", "004", "005"].map(n => `character/pc/idle/default/${n}.dat`),
        ...["forward", "backward", "left", "right"].flatMap(d => [`character/pc/walk_${d}.dat`, `character/pc/run_${d}.dat`]),
        "character/pc/blend_shield.dat", "character/pc/shield_hit.dat", "character/pc/dodge/dodge_fire.dat", "character/pc/dodge/dodge_end.dat",
        "character/pc/hurt_soft.dat", "character/pc/hurt_hard.dat", "character/pc/dead.dat", "character/pc/death.dat",
        "character/pc/charge_sword_hold.dat", "character/pc/charge_pistol_hold.dat", "character/pc/charge_bomb_hold.dat"];
      for (const p of paths) out.clips[p] = await clipInfo(p, inst);
      const cur = () => [inst.clip?.path ?? null, inst.overlay?.clip?.path ?? null].filter(Boolean).join(" + ");
      await step(1); out.played.idle = cur();
      const seen = new Set();
      inst.time = 8;
      for (let i = 0; i < 15 && seen.size < 2; i++) { await step(1, () => { seen.add(inst.clip?.path); }); }
      out.played.idleVariants = [...seen];
      // the knight turns to where it runs; it strafes (walks) only with the shield up
      for (const [label, mv, shield] of [["run", [1, 0], false], ["walk forward (shield)", [1, 0], true], ["walk backward (shield)", [-1, 0], true],
        ["walk left (shield)", [0, 1], true], ["walk right (shield)", [0, -1], true]]) {
        resetKnight();
        input.aim = [k.x + 5, k.y];
        input.shield = shield;
        input.move = mv;
        await step(0.5);
        out.played[label] = cur();
      }
      resetKnight();
      input.shield = true; input.aim = [k.x + 5, k.y];
      await step(0.5); out.played.shield = cur();
      w.damageKnight({ NORMAL: 5, PIERCING: 0, ELEMENTAL: 0, SHADOW: 0 }, 0.5, k.x + 1, k.y);
      await step(0.1); out.played.shieldHit = cur();
      resetKnight();
      input.dash = true; input.move = [1, 0];
      await step(0.15); out.played.dash = cur();
      input.move = [0, 0];
      await step(0.3); out.played.dashEnd = cur();
      out.dashEffects = log.effects.map(e => e.ref);
      resetKnight(); await step(0.5);
      w.damageKnight({ NORMAL: 5, PIERCING: 0, ELEMENTAL: 0, SHADOW: 0 }, 0.5, k.x + 1, k.y);
      await step(0.1); out.played.hurt = cur();
      resetKnight(); await step(0.3);
      w.damageKnight({ NORMAL: 5, PIERCING: 0, ELEMENTAL: 0, SHADOW: 0, major: true }, 0.5, k.x + 1, k.y);
      await step(0.1); out.played["hurt (major hit)"] = cur();
      resetKnight(); await step(0.5);
      k.health = 1;
      w.damageKnight({ NORMAL: 50, PIERCING: 0, ELEMENTAL: 0, SHADOW: 0 }, 0.5, k.x + 1, k.y);
      await step(0.5); out.played.dead = cur(); out.deadState = k.dead;
      w.revive();
      await step(0.5); out.played.revive = cur();
      resetKnight();
      return out;
    },

    /**
     * Lichens: two side by side fuse once into a bigger colony; one killed alone just dies.
     */
    async lichens() {
      const w = W(), k = w.knight;
      clearAll(false); dummy = null; resetKnight(); resetLog();
      const out = {};
      const name = "Character/NPC/Monster/Slime/Lichen Colony";
      const all = () => w.monsters.filter(m => /Lichen Colony$/.test(m.entity?.name ?? ""));
      // fusing: two lichens close together, away from the knight so they do not go for it
      k.x = home[0] - 6; k.y = home[1];
      const a = await spawnMonster(name, 6, 0.4), b = await spawnMonster(name, 6, -0.4);
      const ms = await waitFor(() => { const l = all(); return l.length >= 2 ? l : null; }, 20000);
      if (!ms) return { error: "lichens did not appear" };
      for (const m of ms) { m.x = home[0]; m.y = home[1] + (m === ms[0] ? 0.45 : -0.45); }
      out.before = ms.map(m => ({ size: m.size, scale: m.def.scale, health: m.maxHealth }));
      let merged = null, sizes = [];
      const sawMerge = [];
      await step(10, () => {
        for (const m of all()) if (m.attack && /Merge$/.test(m.attack.def.name)) sawMerge.push(m.attack.phase);
        const l = all();
        if (!l.includes(ms[0]) && !l.includes(ms[1]) && l.length) { merged = l; return false; }
      });
      if (merged) await step(1.5);
      const after = all();
      out.mergeAnimation = [...new Set(sawMerge)];
      out.after = after.map(m => ({ name: m.entity?.name, size: m.size, scale: m.def.scale, health: m.maxHealth }));
      out.mergedOnce = !!merged && after.length === 1 && after[0].size === 2;
      out.projectiles = log.projectiles.map(p => p.name);
      // killing one alone: nothing spawns
      clearAll(false); resetLog(); resetKnight();
      await spawnMonster(name, 3, 0);
      const one = await waitFor(() => all()[0] ?? null, 20000);
      await step(1.2);
      const before = w.logic.actors.length;
      w.damageMonster(one, { NORMAL: 1e9, PIERCING: 0, ELEMENTAL: 0, SHADOW: 0 }, 1, k.x, k.y);
      await step(2);
      out.killAlone = { lichensLeft: all().filter(m => m.state !== "dying").length, projectiles: log.projectiles.map(p => p.name) };
      out.killAloneOk = out.killAlone.lichensLeft === 0 && !out.killAlone.projectiles.some(p => /Lichen/.test(p));
      clearAll(false); resetKnight();
      return out;
    },

    // primitives for screenshots
    render: on => { window.__auditDraw = !!on; },
    /** Draws a few frames and returns the last as a PNG data URL. */
    grab: (frames = 3) => new Promise(resolve => { window.__auditDraw = true; window.__auditGrab = { frames, resolve }; })
      .then(url => { window.__auditDraw = false; return url; }),
    step: (s, inp) => { if (inp) Object.assign(input, inp); return step(s); },
    input: () => input,
    reset: () => { clearAll(true); resetKnight(); resetLog(); },
    log: () => log,
  };
})();
