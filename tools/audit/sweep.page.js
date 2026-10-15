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
  function frame(zoom = 0.35) {
    const v = window.__viewer;
    if (!v) return;
    // the Camera Distance option, applied the way the options screen applies it: close on the
    // knight, wider when the subject is a monster standing off to the side
    if (v.options_ && v.options_.zoom !== zoom) { v.options_.zoom = zoom; if (v.cam?.to) v.applyCamView(v.cam.to); }
    if (v.__sweepFramed) return;
    v.__sweepFramed = true;
    const e = v.environment;
    if (e && Array.isArray(e.ambient)) e.ambient = e.ambient.map((x, i) => (i < 3 ? Math.max(x, 0.6) : x));
    if (e && e.fog) e.fog = null;
  }

  async function shot(label, inst) {
    const knight = W()?.knight?.instance;
    frame(inst && knight && inst !== knight ? 0.62 : 0.35);
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
  /** How far the knight is from a spot, and what its attacks' impulses add up to (their forward units). */
  const travel = from => +Math.hypot(W().knight.x - from[0], W().knight.y - from[1]).toFixed(2);
  const impulseOf = attacks => +attacks.reduce((s, a) => s + (a?.impulse?.forward ?? 0), 0).toFixed(2);

  /**
   * The blocks the blocks sweep breaks: one of each sprite kind and family (plain breakables
   * with their destruction particles, the stone's cracking models, a mineral node's hit
   * animations, crystals, treasure, a hedgehog, an explosive), with the arguments their
   * placeables give them.
   */
  const BLOCKS = [
    { name: "Block/Breakable/Parts/Clockworks (base)", args: [["Texture", "world/dynamic/block/breakable/clockworks/base.png"]] },
    { name: "Block/Breakable/Graveyard" },
    { name: "Block/Breakable/Shrub" },
    { name: "Block/Stone" },
    { name: "Block/Mineral/Crimsonite Node" },
    { name: "Block/Crystal/Blue" },
    { name: "Block/Treasure" },
    { name: "Block/Barbed Hedgehog" },
    { name: "Block/Explosive" },
  ];

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
      Object.assign(rec, { kind: def.kind, rarity: def.rarity, chargeTime: def.chargeTime, attackNames: def.attacks.map(a => a.name), chargedName: def.chargedAttack?.name ?? null,
        incompleteName: def.incompleteChargedAttack?.name ?? null });
      const dist = def.kind === "Sword" ? 1.6 : def.kind === "Bomb" ? 1.2 : 4;
      let dummy = await placeDummy(dist);
      if (!dummy) { rec.error = "no dummy"; return rec; }
      const aim = () => [dummy.x, dummy.y];
      const home = [k.x, k.y];

      // the basic chain (a gun until its clip is spent and it reloads); a bomb has no basic
      // attacks, so its one click is a tap: an early release that fizzles (its incomplete
      // charged attack) and places nothing, which the judge expects of it
      const presses = def.kind === "Sword" ? def.attacks.length : Math.max(def.attacks.length, def.maxChain || 1);
      let tick = 0;
      const started = () => A().log().attacks.filter(a => a.who === "knight").length;
      // clicks every 3 ticks until that many attacks have started, across the steps below: the
      // client chains the next step only on a click at or after the swing's rearm (a click
      // earlier in the swing is dropped), so a fixed count of early clicks played one swing
      // the closest the knight came to the dummy, edge to edge: a step that ends against it
      // stops there (the client's mobile collision), and the range pins the dummy back to its
      // spot afterwards, so the gap at the end does not show it (a hunting blade's pulling
      // swings drag the dummy in, and the knight's next steps stop against it)
      let closest = Infinity;
      const near = () => { closest = Math.min(closest, Math.hypot(dummy.x - k.x, dummy.y - k.y) - dummy.radius - k.radius); };
      const drive = () => {
        near();
        const inp = { aim: aim() };
        if (tick++ % 3 === 0 && started() < presses) inp.attackDown = true;
        return inp;
      };
      if (await step(7, drive, () => k.attack?.phase === "fire")) rec.shots.push(await shot("chain 1", k.instance));
      if (presses > 1) await step(8, drive, () => started() >= presses && k.attack?.phase === "fire");
      else await step(0.15, drive);
      rec.shots.push(await shot("chain end", k.instance));
      await step(4, drive, () => started() >= presses && !k.attack && !knightProjectiles());
      await step(1, () => ({ aim: aim() }));
      await sleep(300);
      // the swings that played carry the knight; the dummy (pinned in place) stops it where they
      // meet, as the client's mobile collision stops a step against a monster
      const swings = Math.min(presses, started());
      near();
      rec.chain = { ...runLog("knight"), hits: R().hits().filter(h => h.from === "knight"), travel: travel(home),
        impulse: impulseOf(def.attacks.slice(0, swings)), swings: presses, blocked: closest < 0.1 };

      // a full charge and release
      if (def.chargedAttack) {
        fresh();
        dummy = await placeDummy(dist);
        if (!dummy) { rec.error = "no dummy"; return rec; }
        const start = [k.x, k.y];
        await step(DT, { attackDown: true, attackHeld: true, aim: aim() });
        let chargePose = null;
        const full = await step(def.chargeTime / 1000 + 4, () => ({ aim: aim() }), () => {
          if (k.charge !== null) chargePose ??= k.instance.overlay?.clip?.path ?? null;
          return k.charge !== null && k.charge * 1000 >= def.chargeTime + 150;
        });
        rec.shots.push(await shot("charged", k.instance));
        chargePose = k.instance.overlay?.clip?.path ?? chargePose;
        await step(DT, { attackHeld: false, aim: aim() });
        closest = Infinity;
        const aimNear = () => { near(); return { aim: aim() }; };
        await step(2, aimNear, () => k.attack?.phase === "fire");
        await step(0.1, aimNear);
        rec.shots.push(await shot("release", k.instance));
        await step(4, aimNear, () => !k.attack && !knightProjectiles());
        near();
        await step(1, () => ({ aim: aim() }));
        await sleep(300);
        rec.charge = { ...runLog("knight"), hits: R().hits().filter(h => h.from === "knight"), full, pose: chargePose, travel: travel(start), impulse: impulseOf([def.chargedAttack]),
          blocked: closest < 0.1 };
      }
      R().clearAll();
      return rec;
    },

    async monster(name) {
      const w = W(), k = w.knight;
      const rec = { name, shots: [], console: [], problems: [] };
      fresh();
      // only monster configs come into the world as monsters (World.createActor); the rest under
      // Character/NPC/Monster are a boss's parts: markers and debris (bombs), its flames
      // (orbitals) and bullets, switches, a shadow polyp's influence, scripted props
      const kind = R().actorKind(name);
      if (!/^(Monster|ZMonster|Agent)$/.test(kind ?? "")) { rec.part = kind ?? "no config"; return rec; }
      const [m] = await R().spawn(name, { hold: "frozen", undying: true, dist: 4.5, count: 1 });
      if (!m) {
        rec.error = `never appeared (${kind})`;
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
      // the first of its attacks that is a blow at the knight (data.ts attackHarms): a wolver's
      // bark, a devilite's dodge or a blastcore's weak spot strikes nothing by design; a monster
      // with none has its first made, and nothing is expected of it
      const atk = d.attacks.find(x => R().attackHarms(x)) ?? d.attacks[0] ?? null;
      if (atk && !m.passive) {
        const a = Math.atan2(k.y - m.y, k.x - m.x);
        // a compound region (Vanaduke's club slam) strikes ahead of it: the knight goes to the
        // middle of its nearest part
        const part = atk.shape?.parts ? atk.shape.parts.reduce((p, q) => (q.forward < p.forward ? q : p)) : null;
        if (part) {
          const c = Math.cos(a), sn = Math.sin(a);
          k.x = m.x + c * part.forward - sn * part.side; k.y = m.y + sn * part.forward + c * part.side;
        } else {
          const reach = atk.shape ? Math.max(0.6, atk.shape.forward + Math.max(atk.shape.halfLength, atk.shape.radius) * 0.5) : 4;
          k.x = m.x + Math.cos(a) * (reach + m.radius * 0.5); k.y = m.y + Math.sin(a) * (reach + m.radius * 0.5);
        }
        face();
        if (part) m.heading = a;
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
        rec.forced = { name: atk.name, harms: R().attackHarms(atk), hits: R().hits().filter(h => h.to === "knight"), projectiles: l.projectiles, effects: l.effects };
        // left to its own behaviour: does it come at the knight and attack?
        // the knight 3 units off, past the forced hit's knockback; slow walkers (the Green Giant
        // crawls at 1 unit a second) get time to close the gap
        const off = Math.hypot(k.x - m.x, k.y - m.y);
        const pull = Math.max(0, off - 3);
        k.x -= Math.cos(a) * pull; k.y -= Math.sin(a) * pull;
        const n0 = A().log().attacks.filter(x => x.who === "monster").length, x0 = m.x, y0 = m.y;
        // whether its behaviour aims a blow at the knight at all (healers, followers, a
        // tortodrone until provoked do not), and how long a script waits before the first
        const outlook = R().outlook(m) ?? { aims: true, delay: 0 };
        const window = 12 + Math.min(10, (outlook.delay || 0) / 1000);
        m.hold = "live";
        await step(window, () => ({}), () => A().log().attacks.filter(x => x.who === "monster").length > n0);
        rec.live = { attacked: A().log().attacks.filter(x => x.who === "monster").length > n0, moved: +Math.hypot(m.x - x0, m.y - y0).toFixed(2),
          aims: outlook.aims, delay: outlook.delay, window };
        m.hold = "frozen";
        m.attack = null;
        await step(0.5, () => ({}));
      }
      // a hard hit: it should flinch
      if (!m.passive) {
        face();
        R().clearHits();
        R().strike(m, 2, 1.5);
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

    /**
     * Each block of BLOCKS placed ahead of the knight and struck through the world's own prop
     * damage until it breaks: a shot after each hit and two of the break, with the effects each
     * spawned (hit transients, the destruction transient and what its script spawns).
     */
    async blocks() {
      const w = W();
      const rec = { blocks: [], shots: [], console: [], problems: [] };
      for (const b of BLOCKS) {
        fresh();
        const short = b.name.replace(/^Block\//, "");
        const p = await R().placeBlock(b.name, 1.6, b.args);
        if (!p) { rec.blocks.push({ name: b.name, error: "not placed" }); continue; }
        const sp = p.cfg.sprite ?? {};
        const one = { name: b.name, hits: p.health, broke: false, hasHitFx: !!sp.hitTransient, hasBreakFx: !!sp.destructionTransient, hitEffects: [], breakEffects: [], states: [] };
        rec.blocks.push(one);
        await step(0.5, () => ({}));
        await sleep(300);
        rec.shots.push(await shot(`${short}: before`, null));
        const fxOf = n0 => A().log().effects.slice(n0).map(e => `${e.ref}${e.loaded === false ? " (failed)" : ""}`);
        for (let i = 0; i < 6 && w.props.includes(p) && !p.entity.destroyed; i++) {
          const n0 = A().log().effects.length;
          w.damageProp(p, 1000, 2);
          if (p.entity.destroyed) {
            one.broke = true;
            await step(0.12, () => ({}));
            rec.shots.push(await shot(`${short}: break`, null));
            await step(0.25, () => ({}));
            rec.shots.push(await shot(`${short}: break +0.4`, null));
            await sleep(300);
            one.breakEffects = fxOf(n0);
          } else {
            await step(0.15, () => ({}));
            await sleep(200);
            one.hitEffects.push(fxOf(n0));
            one.states.push(p.instance ? `${p.instance.model.path}: ${playing(p.instance)}` : "no model");
            rec.shots.push(await shot(`${short}: hit ${i + 1}`, null));
            await step(0.3, () => ({}));
          }
        }
      }
      fresh();
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
