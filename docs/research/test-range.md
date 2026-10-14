# Test Range and sweep

A developer-only hall for trying any gear and any monster, and a headless sweep that puts
every weapon, every monster and the knight's core actions through it and flags what looks
broken. Like everything else, it reads the player's own install at runtime; nothing of the
game is shipped, and the sweep's output (screenshots, sheets, reports) stays in the git-ignored
`.scratch/` folder.

## The Test Range

**Reaching it.** Only from the asset viewer: open `#viewer` (or `#dev=1` on the dev server) and
press **Test Range** in the sidebar, under "← Back to the game". `#viewer&range` and
`#dev=1&range` open it directly. The game app (the plain address) never shows the button, and
the code is a separate chunk (`src/dev/testrange.ts`, loaded on first use).

**The hall** (`src/dev/rangescene.ts`): a 32 × 24 floor ringed by wall, painted with the
level generator's rule-based tiling from the `000_Dev` "Test Chamber" tileset (falling back
to Whitespace, then the Clockwork tunnels). No spawners, treasure or elevators. Its lights
and sky come from a cached Clockworks terminal when one is cached. The knight starts in the
middle, armed. The panel's **Depth** box restarts the range at another depth (damage, health
and defence scale with it).

**The panel** (right of the stage), four tabs and a hit readout under them:

- **Arsenal**: every weapon, shield, armour, helmet and trinket in `config/item.dat` (the
  game's own catalogue, `src/game/items.ts`), searchable, filtered by class and stars. A
  click equips it at once (`World.equip`: no ownership, rank or level checks). Shift+click
  on a weapon adds it as another slot (up to three); trinkets toggle (up to two).
- **Dummy**: places an invulnerable target in front of the knight: a real monster (a Jelly
  Cube by default, any actor name works) frozen in place with endless health. It still
  flinches and is knocked back; "Keep it in place" puts it back once the knockback has
  played. Every hit shows: damage dealt and raw, the damage type split, each status rolled
  (its chance and whether it took), knockback distance, duration and level (and whether it
  moved the target), the interrupt (flinch, knockdown), and the attack's timing (startup,
  active window, rearm, follow-through, and the charge time for a charged attack).
- **Pens**: spawn any monster by family, species and tier (`config/actor.dat`), or through a
  spawn table at a tier, one or a group of up to 12, as **Frozen** (no AI), **Passive**
  (moves, never attacks) or **Live**, optionally undying. Buttons make the pen's monsters
  start any of their attacks now. A table shows what the monsters dealt to the knight, per
  attack (hits, last damage, split, knockback, status, timing). "Knight cannot fall" keeps the
  knight up; "Revive knight" stands it back up when it has fallen.
- **Animations**: pick the knight or any monster or NPC and press Load: its model stands
  beside the knight as a puppet, and any of its animations (the model's named ones, and the
  animation files in its folder; for the knight all of `character/pc/`) play on it with their
  frame actions (sounds and effects), looping or once, at 0.05× to 2×, or stepped frame by
  frame.

**How it hooks in** (`src/game/world.ts`, all inert in the game):

- `World.probe` (`WorldProbe`): told when an attack starts, when a monster or the knight is
  hit (`ProbeHit`: amounts before defence, dealt, knockback, reaction, kill) and when a status
  is rolled. Null unless the range is up.
- `Monster.hold`: `"live"` (default), `"passive"` (the behaviour may not start attacks),
  `"frozen"` (no behaviour, idle; an attack started by hand plays out), `"pose"` (frozen and
  keeps whatever animation was put on it). `Actor.undying` keeps health from running out.
- `World.equip(loadout)`: dresses the knight in a loadout where it stands.
- `World.puppets`: models drawn and played outside the game's rules (the animation browser).

In development builds the range installs `window.__range` (equip, placeDummy, spawn, kill,
strike, hits, …), which the sweep drives.

## The sweep

`tools/audit/sweep.ts` (with `sweep.page.js`, `sheet.page.js` and the pure rules in
`sweep-judge.ts`) runs the Test Range in headless Chromium with
`--use-angle=swiftshader --enable-unsafe-swiftshader --mute-audio`. It reuses the play audit's
page harness (`play-audit.page.js`: the game loop paused, the world stepped at 30 Hz with
scripted input, frames drawn only for screenshots).

### Running it

The audit dev server first (no hot reload, so editing sources mid-run does not reload pages):

```
npx vite --config tools/audit/vite.audit.config.ts --port 5183 --strictPort
```

then, in another terminal:

```
npx tsx tools/audit/sweep.ts --knight                 # the knight's actions (a minute or two)
npx tsx tools/audit/sweep.ts --weapons sword          # 149 swords
npx tsx tools/audit/sweep.ts --weapons handgun        # 144 guns
npx tsx tools/audit/sweep.ts --weapons bomb           # 88 bombs
npx tsx tools/audit/sweep.ts --monsters "^Character/NPC/Monster/Slime/"   # one family (100)
npx tsx tools/audit/sweep.ts --monsters jelly         # any name matching /jelly/i
npx tsx tools/audit/sweep.ts --report-only            # rebuild sheets and report from disk
```

With no `--weapons`, `--monsters` or `--knight` it sweeps everything (381 weapons, 723
monsters: hours under SwiftShader; split it). `--serve` starts the audit dev server itself and
stops it at the end. Other options: `--out .scratch/sweep`, `--url http://localhost:5183/`,
`--workers 1` (pages in parallel; each is a full game instance, so mind the RAM), `--limit N`,
`--timeout 150` (seconds per item), `--redo` (sweep items already on disk again),
`--redo-errors` (only those that ended in an error).

The browser always closes (try/finally, and on Ctrl+C); so does a server started by `--serve`.

**Resumable**: each item's record is written as soon as it finishes, as
`<out>/<weapons|monsters|knight>/<slug>.json` with its screenshots in `<slug>/` (full PNG and
a JPEG thumbnail), and is skipped on later runs. The sheets and the report are rebuilt from
every record on disk, so split runs add up.

### What it does

- **Each weapon**: equipped alone; the dummy placed at the weapon's range (sword 1.6, bomb
  1.2, gun 4 units) and given time to appear; the basic chain pressed through (a gun until its
  clip is spent and it reloads), shots at the first attack's landing and at the last one's;
  then a full charge held past the charge time (shot) and released (shot at the landing).
  The range's readouts for every hit and the audit log's attacks, projectiles, effects and
  sounds are kept for each run.
- **Each monster**: spawned frozen and undying 4.5 units out; shots of its idle, its movement
  animation posed in place, its first attack's wind-up and landing (made by hand, with the
  knight put in its reach), its hit reaction (a hit of 60% of its health) and its death. Then
  left to its own behaviour for 6 seconds to see whether it attacks on its own.
- **The knight**: idle, walk (shield up), run, dash, shield up, shield hit, hurt, knockdown
  (a major hit), death and revive, each shot.

### Output (`.scratch/sweep/`)

- `report.md` and `report.json`: counts, flags tallied by kind, and a table per section
  (a weapon's chain and charge damage, biggest knockback and statuses; a monster's forced
  attack on the knight, whether it attacked on its own, reacted and died).
- `sheets/`: contact sheets, one per weapon class (`weapons-sword.png`, …) and monster family
  (`monsters-slime.png`, …) plus `knight.png`, 20 items to a page, each row the item's name,
  its flags in red, and its labelled thumbnails.
- `weapons/`, `monsters/`, `knight/`: the records and full-size screenshots.

### Flags

From `sweep-judge.ts` (covered by `tests/testrange.test.ts`):

- **Bind pose**: a shot whose model plays nothing, or a clip that moves none of its nodes
  (the game's `animation/common/blank.dat` is exempt), or an upper-body clip that does not fit.
- **Weapons**: no attack started; no projectile (anything but a sword); no hit on the dummy;
  zero damage; an effect that did not load; the charge never full, no charging pose, or the
  charged attack never fired.
- **Monsters**: never appeared (the actor's class is named); no idle animation; moves without
  a movement animation; its attack neither hit the knight nor fired anything; zero damage;
  never attacks on its own; no hit reaction (only for monsters whose config reacts); never
  dies, or its body stays; no death effect; effects that did not load.
- **Knight**: did not fall at death, stayed down after revive.
- **Console**: any console error or page error during the item.

A flag is a lead, not a verdict: a ranged monster's shot can miss a knight standing still,
and some monsters (turrets, drones) are meant not to move or react. Read the sheet next to it.
