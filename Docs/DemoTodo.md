# Clockworks — the working list

Retitled 2026-09-16, when the scope changed from "a showable demo" to
**rebuilding as much of Spiral Knights as can be rebuilt** (the user's call; see
`CLAUDE.md`, "Scope"). The demo list below the line is kept: it is still the
detail on the knight, the weapons, the statuses and the HUD, and most of it is
done. What changed is that it is no longer the ceiling.

The measure is no longer "ten minutes of play". It is: the game's own floors,
its own monsters, its own numbers, playable end to end, single player first.

Everything here is measured against `Docs/SpiralKnightsReference.md` and against
the research under `D:\Dev\SKAssets\_research` and `_floors`, which is where the
original's own data lives.

---

## The order of work (the user's, 2026-09-16)

**1 → floors, 2 → monsters, 3 → run progression.** In that order, all three.
Alongside them, a census of which level spawns which monsters, with which
tileset, and where in the level.

---

## 1. Floors

- [x] 111 archived floors as `UClockworksFloorDefinition` assets (360 MB, tracked)
- [x] 360 world models imported (9,277 assets)
- [x] `AClockworksFloorBuilder`: instanced scenery, collision from the cell grid,
      navigation bounds, lighting from the scene's own ambient
- [x] `Lvl_Floor`, the calibration map; Mission Lobby verified standing and walkable
- [x] **Materials fixed** — every world surface was drawing Unreal's grey checker
      because the imported materials lacked the `InstancedStaticMeshes` usage flag.
      `fix_floor_materials.py` copies the importer's Substrate parent into the
      project and re-parents all 2,639 of them. A hand-authored master does *not*
      work: under Substrate it renders nothing at all.
- [x] Exposure pinned (`ExposureEV`, `Clockworks.Exposure`) — auto-exposure was
      metering a dim room and clipping the tileset to white
- [x] Floor objects written: gates, switches, blocks, the addressed signal bus
- [x] The wiring recovered from the archive (`_floors/interactive`, 111 sidecars):
      tags, emissions, verbs, and the correction that **the number in "Iron Gate/
      Trigger 3" is the gate's width, not a signal count**
- [ ] **Objects actually placed.** `ObjectRules` on the builder are unset, so a
      floor still builds 0 objects. Needs the rules generated from
      `_research/floor_objects/object_classes.json` (373 configs → 5 behaviours)
      and the markers filled from the sidecars.
- [ ] **156 of 371 models are missing some or all of their textures** — the
      exporter wrote `dummymtl` placeholders with no images. The walls are the
      visible case: 65 materials, none textured. The PNGs exist in `rsrc`; the
      mapping is being recovered.
- [ ] Hazards, lift objects (gold keys, statues), treasure contents, respawn pads
- [ ] Traps: the `Trap$Cycle` enum is recovered (A, B, QUICK, SLOW, UP, DOWN and
      their timings); `TOGGLE`/`RESET` are unresolved
- [ ] 7 of the 14 boss-region floors have no manifest yet; **Firestorm Citadel has
      none at all**, so the Vanaduke run has no floors
- [ ] Moorcroft Manor and the Sanctuary are not captured
- [ ] Navigation: a nav-mesh actor cannot be spawned from a script, so a generated
      level needs opening once in the editor
- [ ] 43 stale floor assets sit untracked in `Content/TopDown/Floors`;
      `delete_asset` reports success in a commandlet and leaves the file

## 2. Monsters

- [x] 12 built, on the original's per-depth health, defense and damage
- [x] Snarbolax (beast bell, guard, early stun break) and Royal Jelly (four stages,
      polyps, minis, rage) built
- [x] Roster mined: **862 monster actors on 163 models, 84 creature groups**; 74
      new `.glb` exported (`_monsters_full`)
- [ ] **Import every monster in the game.** The user's instruction, and the roster
      is ready for it.
- [ ] **Sounds are wrong on nearly all of them.** Nothing in an actor config names
      its death sound: it lives inside the animation `.dat` the engine plays.
      The Lichen is not silent (it uses the jelly set), the Zombie's death is
      `zombie_moan_02`, hurt should be each monster's own material impact, and
      there is no "aggro" event in the original at all.
- [ ] **The Mechaknight runs at half speed**: 200 cm/s wandering and **333 chasing**
      against the 150 it has. Its `move_anim_reference_speed` is 450, not its own.
- [ ] Missing clips: the Wolver has no dodge; the Mechaknight is missing most of
      its sword set. Both re-exported and waiting to be imported.
- [ ] Second attacks for every monster (only the main attack is carried)
- [ ] **Roarmulus Twins** — fully researched, nothing built. Two sealed turrets a
      knight cannot damage; only the *other* twin's rocket exposes one. Needs
      toggle-block columns and four switches.
- [ ] **Vanaduke** — fully researched, nothing built, and **blocked**: his mask is
      doused with a thrown water pot and there is no carry/throw system. Three
      options are in `_research/bosses2/report.json`. **Decide before coding.**
- [ ] His model is `character/npc/monster/baron/`, not `darkknight`. Health and
      defense are flat, not depth-scaled; stage 3 is deliberately Shadow-immune.
- [ ] The attention arrow (the Twins' key feedback) is a particle compound and
      **cannot be exported at all** — needs rebuilding in engine
- [ ] Monster spawn census: which level spawns what, with which tileset and where.
      Single and Class spawns name their monster in the archive; **Subset spawns
      (the majority) do not** and are being resolved.

## 3. The run

- [ ] Four elevators in the Mission Lobby, one per boss run
- [ ] Per-run depth tables — the runs keep the original's depths (Snarbolax 5–7,
      Royal Jelly 15–17, Roarmulus 15–17, Vanaduke 24–28) unless compressed, which
      would mean re-deriving every depth-scaled damage and defense table
- [ ] Floor-to-floor transitions and level loading
- [ ] `FloorKindForDepth` should become the original's own vocabulary:
      `LEVEL, TERMINAL, LOBBY, SUBTOWN, CORE, SPECIAL` with its
      `isLobby/isSafe/canEquip/isArsenal` predicates
- [ ] Shadow Lairs — filed under **"Ultimate"** in the game data, which is why
      searching for "Shadow Lair" looks empty. Ironclaw's lair scene does not exist
      in the archive; Firestorm's does (scene 271). No health or damage multiplier
      exists anywhere in the client data.

## 4. The wider game (scope change, 2026-09-16)

- [ ] The captured towns as real explorable levels: **Emberlight** (113×90),
      the **Clockworks Party Lobby**, the **Advanced Training Hall**, **The Lab**
- [ ] A title screen and loading screens faithful to the original, from `rsrc/ui`
      — **no login, no credential entry**, deliberately
- [ ] Haven **cannot be identical**: its models exist, its layout was never
      captured. It would be hand-built level design.
- [ ] Previously cut and now open, each to be costed before starting: missions,
      crafting, the economy, guilds, XP, more than one tileset
- [ ] Two players: still written server-authoritative throughout, still untested
      since the scope change. The longer it goes untested the more will be wrong.

## 5. Known bugs, found by looking

- [ ] The start menu's description lines overlap their titles (visible in any
      screenshot of it)
- [ ] Gear materials miss `SkeletalMesh` and `Nanite` usage flags — the same class
      of bug that made the world grey; `fix_floor_materials.py` now sets flags on
      the 420 base materials the project owns
- [ ] Nothing in the project has been played by a human. Every system is verified
      by data only. Expect a long tail of "looked fine, isn't".

## Tools that now exist for checking work

`Clockworks.After`, `Clockworks.CloseMenus`, `Clockworks.Teleport`,
`Clockworks.Press`, `Clockworks.Spawn`, `Clockworks.Camera`,
`Clockworks.Exposure`, `Clockworks.Report`, and `-game -RenderOffScreen` with
`Shot`: the game runs headless, drives itself and photographs the result. The
recipe and its traps are in the `headless-game-screenshots` memory. Use it.

---

# The demo list, from 2026-09-14 (still the detail on the knight, weapons and HUD)

## Where the demo actually stands

Working: screen-relative movement with cursor aim, the Calibur three-hit combo
and its Round House charge, the Proto Gun with clip and reload, the shield with
its dome and the shield bash, a dodge, three enemies with a shared C++ brain and
screen-based aggro, player death and respawn, and a bottom-right weapon toolbar.

That is a good vertical slice of **combat**. What it is missing is almost
everything that makes combat *readable*, everything around the combat, and the
shell that turns a level into a demo.

**The single biggest gap: there is no HUD and no audio.** You cannot see your
own health, your shield, or an enemy's health, and nothing makes a sound. Those
two alone will dominate a stranger's first impression more than any amount of
extra content.

*Update 2026-09-15: no longer true. The whole HUD from the reference screenshots
(section A2, `UClockworksPlayerHUD`) and the audio (section A, 91 sounds, plus each
weapon's own in A3) are built in code, and the weapon wheel replaced the bottom-right
toolbar. None of the HUD has been seen in play yet.*

---

## A. Readability and feel — do these first

These are cheap relative to their effect. This is the "it feels like a game"
tier.

- [x] **Player HUD**: health pips and the shield meter, top-left as in the
      original. `UClockworksPlayerHUD`, built in C++, created by the player
      controller for local players only. Pips rather than a bar because a pip
      going out is easier to catch mid-fight; the part-spent pip is drawn in a
      darker red so the last sliver of health still reads. The shield meter
      turns red while the shield is shattered. *Not yet done: the silver > 30
      and gold > 60 pip tiers, which in the original track gear progression we
      do not have, and the death/revive indicator.* [5.3, 2.2]
      *Update 2026-09-15: the silver and gold tiers are built (section A2), and gear
      now gives real health. Still not done: the death/revive indicator.*

### A2. The full HUD, from the user's reference screenshots

The user sent screenshots of the real Spiral Knights HUD as the reference for the
whole on-screen layout. Only the top-left panel was built from them. This is
the whole layout, piece by piece, so it is not lost again.

**Built 2026-09-14, all of it, in code.** It compiles; nobody has seen it on
screen yet. The art is the game's own `rsrc/ui/hud_v2` set, imported as group
`HUD` by `stage_and_import.py` and then marked as UI textures by
`fix_hud_textures.py`. Every piece falls back to flat colours when the art is
missing. `UClockworksPlayerHUD` hosts it all; `ClockworksHUDArt` is the shared
palette, font and loader.

- [x] **Top-left: health pips, shield bar, percentage badge**, rebuilt on the
      game's pip art. The heart badge with the percentage sits *left* of the pips,
      as in the screenshots. Lost pips flash purple then white; regained pips
      flash cyan; the row flickers during the dodge's i-frames; past 30 pips they
      turn silver, past 60 gold. The shield badge greys out while shattered.
- [x] **Top-left: circular portrait** with the name banner along the top edge.
      The bust is the closest helm icon the game has (the wolver cap).
      **Decision: the rim shows the depth** ("Depth 3") in place of the rank, and
      **the heat orb glows with the charge meter**, because rank and heat are cut.
      Status icons sit in a row beside the orb.
- [x] **Top-right: circular minimap**, as a radar: monsters as pink dots, the
      elevator always shown (on the rim when out of range, dimmed while shut), the
      knight turned the way it faces, "DEPTH N" on the rim. No floor plan: floors
      are one arena for now. Zoom and lock sockets are pictures.
- [x] **Under the minimap: current objective** from the floor kind and whether the
      elevator is open, and **the Activities panel** (Go to Haven, Go to Ready Room,
      Missions, Supply Depot) as pictures.
- [x] **Bottom-centre: the belt.** **Decision: empty slots now.** Four slots on
      keys 4 to 7 and a red vitapod slot, drawn empty until consumables exist.
- [x] **Weapon wheel.** **Decision: it replaces the bottom-right toolbar.** Three
      circles pop up beside the knight on a switch, with the weapon's name, then
      fade. The toolbar is no longer created; `UClockworksWeaponToolbar`'s files
      are still in `Source/Clockworks/UI/`, unused, for the user to delete.
- [x] **Bottom-right: character (P), loadouts (L), forge (U), arsenal (I).**
      Loadouts opens the gear screen. The other three are pictures.
- [x] **Bottom-left: main menu, help (F1), social (F6), event hub (F7), uplink.**
      The wrench opens the pause menu; the question mark and F1 open How to Play.
      Social, event hub and uplink are pictures.
- [x] **Targeting readout**, top-centre (not in the screenshots; described on the
      wiki): the monster nearest the cursor, its health, the damage type it attacks
      with, and what it is weak and resistant to, read from the same chart the
      attribute set applies.

> **Decided 2026-09-14: dead buttons for looks.** Social, forge and the energy
> widget are on the cut list, and event hub, uplink and arsenal have nothing
> behind them in a demo. The user chose to draw them anyway so the HUD matches
> the screenshots. They are pictures, not buttons, so a stray click on one is
> still an attack. The energy widget is not drawn at all: the original only shows
> it when energy is being spent.
>
> **Not done:** party portraits, the revive light, minimap floor plans, the
> minimap's zoom and lock, the weakness stars on damage numbers, and the "halves
> a charge" rule the orb would want to show.

### A3. Controls, weapon looks and the armoury — 2026-09-14

From the user's play test: controls felt delayed, gun clicks went missing, bombs had no textures,
there was no in-game cursor, and the loadout screen was not usable.

- [x] **Input buffer.** A press that finds the knight busy is kept 0.25 s and retried, instead of
      being dropped (the user's number). This was most of "every control feels late".
- [x] **Dodge cancels an attack's recovery**, never its windup, live hit or a held charge. The shield
      still waits. User's decision.
- [x] **Gun clicks.** Clicks during the follow-through and the reload now count; the 0.287 s raise
      is only paid after the gun has been idle for `ShotContinueSeconds` (0.5 s). User's decision to
      keep the raise.
- [x] **Spiral Knights' cursor** (default, hand, text) as Unreal hardware cursors.
- [x] **Weapon skins.** 199 weapons given their real skin, 113 already right, 17 unmatched because
      their variant names do not match any file (Cold Snap, Static Flash, the Orange tools, Faust,
      Winmillion, Sweet Dreams and a few guns). Re-run late on 2026-09-14 with the fixed scoring and
      the guns' traced skins (`gun_models_textures.json`): 229 applied, 108 already right, 14
      unresolved (12 swords, 2 bombs; report in the run's `weapon_material_fix.json`).
- [x] **The right mesh per tier.** A model set (chemical bombs, Brandishes, Pulsars) used to give
      every tier the biggest body; the generator now matches the tier.
- [x] **Dropped bombs look like their weapon**, replicated as the weapon asset.
- [x] **Armoury by line and tier.** Class tabs, a chip per line, and the open line as a tree of
      tiers from the game's own upgrade recipes (197 weapons linked). Picking any tier is free:
      nothing is upgraded, on the user's decision.
- [x] **Per-line animations and combos** (user asked for every line). The knight was re-exported
      with the 60 clips the attack configs name; every weapon definition carries an attack profile
      (its chain, charge, dud and reload moves, clips at the original's speeds, rearms, lunges and
      hit regions) and the three attack abilities play it. *Unseen in play.*
- [x] **Every weapon's model.** The 12 Tortofist, Buster and Cannon guns and the two mugs import
      from the part that holds the mesh; the rigged Electron and Graviton bombs, Pollinator,
      Diskgun, Celestial Vortex, Humbug Hazer and Virulent Seedling import as static meshes; a
      weapon now shows every solid piece of its model (a Needle's spheres, a Cutlass's tassel) and
      the set member it really wears, with glow cards left out. *Known gap:* the Diskgun's body
      mesh never comes through the exporter, only its glow skin and spinner cards.
- [x] **Bullets that look and move like the original's.** Speed, range and hit radius per weapon;
      the fire pattern (the Proto Gun's wobble, an Autogun's stream, a charged Autogun's fan); a
      look rebuilt from the bullet's particle data (pulsing core and glow, streak, the Magnus
      shell's spinning model), a muzzle flash in the weapon's colour and an impact. Throwing
      swords fire their bullets. The Mixer line's orbiting pellets are built too. *Not built:*
      particle sparkles and auras on weapons, homing. (Special bullet behaviours: below.)
- [x] **Charged attacks as the original's** (user: "a lot of the charge attacks are wrong"). Researched for
      all 352 weapons from the attack configs: each has one charged move, and what was lost was inside
      it. Now carried: each hit's own damage (Calibur 2.0x, Proto Gun 2.4x a bullet), rectangle hit
      areas, full clip runs at their own speeds (Sixshot's six hammer fans, Flourish's thrusts, Rocket
      Hammer's double slam), backsteps and second surges, slam aftershocks and ghost swings as blasts,
      and the gun's charged fire clips before its follow-through. *Unseen in play.*
- [x] **Per-hit statuses and sideways knockback** (user: "also do this"). 345 charged hits carry their own
      status (the Gram's aftershock shocks, the Faust's swipe curses) and 40 knock sideways (the Cutter's
      combo strike alternates about 79 degrees left and right). Bombs no longer all stun: each takes its
      own or its weapon's status. Status-only fire actions (Faust's and Gran Faust's 25% curse, Fang of
      Vog's fire) now reach the move's hits too. *In the editor; unseen in play.*
- [x] **Special bullets that burst, split and linger** (user: "also do this"; then "the Brandish line
      still doesn't have the correct charge attack … you most likely missed a lot more too"). An audit of
      all 352 weapons against the research found 193 whose charged attack or special shot was not built:
      the charged pass had carried every move but not what a spawned bullet does afterwards. Built
      2026-09-14 for 184 weapons: split on hit (26), charged bursts (31), Brandish-line explosion trails
      (33, an invisible carrier, explosions shoving along the line), status clouds (31, radius and
      lifespan read per bomb), shard bombs (25), piercing shots (19 + 4 Avenger/Faust), Pulsar waves and
      charged blasts (13), Tortofist missiles and crystals (12), vortex pulls (8), Catalyzer
      attach-and-detonate (8); 45 invisible bullets no longer drawn as balls. The client ships with the
      server's numbers stripped, so the user chose: Alchemer splits bounce off what they hit; Pulsar waves
      every 1 s; Brandish explosions 1 tile apart, one every 0.1 s (replacing "evenly along the 2 s
      flight"); shards fan evenly round 360 degrees; Tortofist drops 3 missiles within 2 tiles; Catalyzer
      pellets stick and burst when your charged shot hits; shards lie on the floor and burst on touch or
      after 10 s. Other gaps are INFERRED in `distill_bullet_behaviours.py`. *In the editor; unseen in
      play and in two-player.* **Not built:** Sealed Sword's 25% seal break, Wrench Wand's missing fire clip. Research:
      `D:\Dev\SKAssets\_research` (`bullet_behaviours.json`).
- [x] **Guns held up while firing**, the input log, and orbiting pellets for the Mixer line.
- [x] **Each weapon's own sounds**: 112 recordings, with the original's gains and pitch ranges,
      per swing, shot, charge, reload, impact, bomb drop, blast and dud. A weapon the game leaves
      silent (the Pulsar's shot) stays silent. *Not in the game's data at all:* charge-up sounds,
      so the knight's shared charge hum stays.

- [x] **Enemy health bars** over each enemy. `UClockworksEnemyHealthBar` on a
      screen-space widget component, so it always faces the isometric camera at
      a fixed size. Hidden while an enemy is untouched so a room does not read
      as a wall of bars, and the fill blends red to amber as it drains.
      *Not yet done: the targeting readout with attack types and weaknesses,
      which needs the damage-type work in section C.* [5.3]
      *Update 2026-09-15: the targeting readout is built (`UClockworksTargetReadout`,
      section A2).*
- [x] **Damage numbers**: grey resisted, blue neutral, gold and larger for a
      weakness. `AClockworksDamageNumber`, a text render actor spawned off a
      cosmetic multicast from the server, which alone knows what a hit came to
      after defence and the family chart. It needs no assets, so
      `DamageNumberClass` defaults to the C++ class on the knight and every
      monster and there is no Blueprint to assign. Uses the engine's
      translucent text material so it fades rather than pops.
      *Not done: the stars on a weakness hit.* **Unseen in play.** [3.8]
- [x] **Hitstop.** Both the attacker and the victim freeze for 60 ms on a landed
      hit. It scales the *mesh's* animation clock rather than the actor's, so
      movement, ability timers and replication are untouched and it cannot
      desynchronise a listen host from its client.
- [x] **Hit sparks and a swing trail.** Both are `AClockworksHitSpark`, a C++
      actor that expands and fades an emissive shell, rather than Niagara: the
      Niagara toolsets exposed to the editor automation are read-only, so a
      Niagara system cannot be authored this way. `BP_HitSpark` is the impact,
      `BP_SwingTrail` is a smaller, paler, shorter one dropped from the blade
      every 20 ms while a swing is live, which reads as a smear. Both are local
      on every machine, spawned off the hit flash that already replicates, so
      neither costs anything on the wire.
      *Replace with a Niagara ribbon later if the smear does not hold up.*
- [x] **Audio, the whole first pass.** 39 sounds imported to `Content/SK/Audio`
      through the same script as the models. Wired and assigned: three sword
      swings (one per combo step) and their hits, the charge hum, the charge-
      ready cue and the charged swing and hit, the pistol's shot, reload and
      charged shot, the shield's raise, lower, block and break, the bash's
      shove and impact, the knight's hurt and death, distance-driven footsteps,
      a weapon-switch click, each enemy's aggro bark, hurt and death, the
      Mechaknight's attack cue, the Gunpuppy's shot, and the Clockworks ambient
      music loop. *Placeholder to replace on the next import run: the blocked
      hit currently uses the bash impact; `S_ShieldBlock` is queued in the
      import script.* *Not done: UI click sounds, which belong with the menus
      in section F, and per-surface footsteps.*
      **Untested:** every one of these needs a play session to confirm it fires
      at the right moment and sits at the right volume.
- [x] **Enemy telegraph aura.** The enemy is tinted for the whole attack windup
      and the tint comes off the instant the hitbox opens, so it marks the
      window you still have to get out of the way rather than the attack. One
      `RefreshOverlay` now resolves the three things that want the overlay
      material, in priority order: a stun outranks a telegraph, which outranks
      a hit flash. Before this they cleared one another. *Still one colour for
      every enemy; it becomes damage-coloured with section C.* [2.9]
- [x] **Screen damage flash** when the knight is hit. [5.3]
      Built 2026-09-14: a red elliptical edge glow on every health loss, drawn by
      `UClockworksPlayerHUD` (`TickScreenGlow`) from a texture made in code
      (`MakeEdgeGlowTexture`). *Unseen in play.*
- [x] **Health pip colours on damage and heal**: purple then white for damage,
      cyan for recovery, flicker during i-frames. [3.8]
      Built 2026-09-14 in `UClockworksPlayerHUD` (damage and heal flashes per pip,
      flicker while `State.Invulnerable` is on), with the silver and gold tiers.
      *Unseen in play.*

## B. The player's kit

- [x] **Bombs**, the third weapon class. **Built.** `UClockworksBombAbility` +
      `AClockworksBomb` + `BP_GA_BombAttack` + `BP_Bomb` + `DA_Weapon_ProtoBomb`,
      in the loadout as the third slot. Numbers read straight out of the game's
      own config dumps: 2.0 s arm (the Proto Bomb's "Charge Time" 2000 ms),
      1.5 s fuse ("Fuse" 1500 ms), 2.5 tile radius = 500 cm ("Radius" 2.5),
      0.2 s place and 0.2 s rearm ("land"/"rearm" 200 ms), and a 0.767 s lockout
      for letting go early ("Base Interupt" rearm 767 ms, which drops a dud).
      Charge-only, as the original's Proto Bomb is: its item entry has no
      uncharged attack at all. Damage falls from full at the centre to a third
      at the rim, never hurts the knight who dropped it, and never hurts a
      knight of the same faction. The one invented number is the 45 damage; the
      original's is depth-scaled and means nothing without its curve.
      Animation uses the knight's own `lift` / `hold` / `throw` clips, because
      `charge_bomb_hold` and `attack_bomb_blend` are not in the export yet.
      *Not done: the blast's Stun status, which waits on section C.* [2.4]
- [x] **Reworked the Proto Gun to match the sword's accuracy.** Every phase now has
      an explicit play rate taken from the original's own animation speeds
      (windup 1.75, follow-through 0.667, reload 1.5, charge release 3.5) instead
      of being squeezed into its gameplay phase, and the follow-through plays
      whether or not there is a recovery to play it in. Numbers re-read from the
      config dumps and corrected: the charge is **2.5 s**, not 3.5 — the 3.5 was
      the release animation's "Release Time" float, not the gameplay
      "chargeTime" of 2500 ms; the charge windup is 1.0 s ("land" 1000 ms); the
      charged bolt travels 12 tiles a second rather than 15, for 780 cm; and its
      shove is 3 tiles against a normal bolt's 0.4.
      Also settled a scale bug this uncovered: **a tile is 100 cm**, which is
      what the sword's lunges already assume. The bomb had been built at 200 cm
      to the tile, so its blast was twice the radius the original's is; it is now
      250 cm.
      **Original note:** It was built
      before the animation-timing correction in section H, so its clips are
      squeezed into gameplay phases instead of playing at their own speed, and
      its numbers were taken once rather than checked against the dumps. Same
      pass as the sword: measure each clip, give every phase an explicit play
      rate, always play the follow-through, and re-read the Proto Gun's real
      windup, shot interval, reload, charge and recoil values.
- [x] **Superseded by the full catalogue:** 143 swords and 124 handguns now
      exist (section W), so this is done many times over. Original note:
      **A second sword and a second gun** so the toolbar means something.
      Brandish (3-hit, explosive charge) and Blaster (3 shots, detonating
      charge) are the obvious pair, and both are in the config dumps with their
      real numbers. [4.2]
- [ ] **Consumable belt on 4–7**: health capsules (3/6/12 bars), remedy, and at
      least one vial type. Vials destroy projectiles in flight, which is a great
      demo moment. [2.7]
      *Partly built: the belt itself, slots 4–7 and a vitapod slot drawn empty by
      `UClockworksConsumableBelt` (section A2). Still missing: every consumable and
      using one on a key press (researched in `Docs/KnightChecklist.md` section 10).*
- [ ] **Hearts and pickups dropping from enemies and breakables**, per-player
      copies. [2.7, 3.4]
- [ ] **Vitapods**: temporary max-health boost for the run. Cheap, and it makes
      a floor feel like a run. [2.7]
- [x] **Weapon switch wheel** (the original's radial), or keep the current
      toolbar and add number keys.
      Built 2026-09-14 as `UClockworksWeaponWheel`, hosted by `UClockworksPlayerHUD`;
      it replaced the toolbar (section A2). Number keys are still not bound.
      *Unseen in play.*

## C. Damage model and status effects

None of this exists yet; right now every hit is one flat number.

*Update 2026-09-15: no longer true. Damage types, the family chart and all seven
statuses are built (below), and knights now defend per damage type with their gear
(`Docs/KnightChecklist.md`). Still open here: a hit halving a charge.*

- [x] **Four damage types** — Normal, Piercing, Elemental, Shadow — resolved
      independently and summed. [2.5]
      Built: the `Data.Damage.*` SetByCaller parts are each resolved against the
      target's family and summed in `UClockworksAttributeSet`, untyped damage counting
      as Normal. A dual-type weapon still carries only its first type.
- [x] **Family weakness chart**: Beast weak to Piercing, Construct weak to
      Elemental, and so on. Our three enemies are Beast (wolver), Construct
      (mechaknight, gunpuppy), so the chart is immediately demonstrable.
      Resistance ≈ 30% damage, weakness ≈ 166%. [2.5]
      Built: `UClockworksAttributeSet::GetFamilyMultiplier`, six families (Beast,
      Construct, Slime, Gremlin, Undead, Fiend) at 1.66 weak and 0.3 resistant; the
      targeting readout (`UClockworksTargetReadout`) reads the same chart.
- [x] **Status effects: all seven.** Fire, Freeze, Shock, Poison, Stun, Curse and
      Sleep, each built to the original's own rules rather than as reskins of one
      another: Fire burns through armour and cancels a charge; Freeze plants the
      feet but leaves the target able to attack, and breaks on any hit; Shock
      spasms for damage and interrupts; Poison cuts damage dealt by 45%, defense
      by 10% and blocks healing entirely; Stun cuts movement to a third rather
      than stopping it; Curse makes attacking cost the attacker health; Sleep
      makes a target unresponsive until something wakes it, for double damage.
      Freeze and Sleep both also stop knockback. The break-on-hit, the curse
      backfire and the no-knockback rule live in the attribute set, which is the
      one place a hit becomes a hit.
      *Not done: minor/moderate/strong tiers, and the status-resistance stat.* [2.6]
- [x] **Status icons on the HUD** and tints on the affected character. [5.3]
      Built: an icon per status beside the orb (`UClockworksPlayerHUD::TickStatusIcons`)
      and a coloured shell round the affected body (`UClockworksStatusDisplay`,
      section S). *Unseen in play.*
- [ ] **Taking damage halves a charge; fire halves it; shock cancels it.**
      Already listed as a known gap in `CLAUDE.md`. [2.6]

## D. Enemies

- [ ] **More enemy types.** Six reads as a game where three reads as a test
      level. Jellycube, Lichen, Zombie, Spookat, Chromalisk and Devilite are
      *already imported* under `Content/SK/Monsters` with their animations, so
      each new enemy is a Blueprint plus tuning, not an art task.
      Built 2026-09-14: all six, plus Gremlin Artillery and the two bosses, as
      Blueprints and attack abilities written by `Tools/SKImport/generate_monsters.py`
      (section M). *Unseen in play* (see "Look at the bestiary" in section M).
- [x] **The bosses and the plain originals** (2026-09-15): the chromalisk licks with a box hitbox, the devilite throws
      its office supplies, the beast bell stuns wolvers and the Snarbolax (which cannot be hurt until it is stunned and
      wakes early after a third of its health), and the Royal Jelly is four chained stages with polyps, Royal Minis and
      its absorb heal. Built and compiled; **none of it has been seen in play**, and the boss floor still spawns the
      Snarbolax alone.
- [ ] **Second attacks for the enemies we have.** The wolver's export carries a
      six-clip `Tripple_Attack` set and the mechaknight carries
      `attack_sword_2_fire` and `attack_sword_3_fire` — a full combo. Both are
      currently unused, and a monster with two attacks is far more interesting
      to fight than one with a single lunge.
- [x] **A miniboss.** Snarbolax and RoyalJelly are imported. One boss room ends a
      demo properly.
      Built: both generated as bosses by `generate_monsters.py`, and
      `AClockworksFloorDirector` spawns Snarbolax (`BossMonster`) alone on depth 7
      (section E2). *Unseen in play.*
- [ ] **Enemy knockdown and recovery**: the wolver has `knockdown` and `recover`
      clips for heavy hits.
- [ ] **Spawners**: burrows for wolvers, monster cages, grave mounds. Cheap
      drama, and they are how the original paces a room. [3.4]

## E. Levels and the world

- [ ] **Real Spiral Knights floors** (user: "check how Spiral Knights loads its levels, and build the
      environment out"). *In progress.* Research, 2026-09-14:
      - The original stitches tunnel floors **on its server** from hand-made room prefabs (rooms,
        halls, arenas with LINK/ENTRANCE/EXIT/BRANCH connectors, depth and rarity tags) along a
        floor template, then sends the finished floor to the client. Terminals, lobbies and bosses
        are hand-built whole maps. Neither the prefabs nor the stitcher ship with the game.
      - **Decision (user):** use real floors, one picked at random per depth like a gate's pool,
        from the community SpiralKnightsSceneArchive's captures (7.5 MB downloaded to
        `D:\Dev\SKAssets\_scenes`, git-ignored, placeholder terms like every other extracted asset).
      - **Decision (user):** the cached mission lobby (50x30 tiles) is the depth-0 lobby, and the
        test case for calibrating tile placement.
      - Done: `Tools/SKImport/mine_scenes.py` converts and decodes every scene (tiles with footprint,
        elevation, rotation and model; props with transforms; areas; globals) into
        `scene_index.json`. About 45 procedural Clockworks-family floors decoded: Clockwork Tunnels,
        Cooling Chamber, Blast Furnace, Power Complex, Wasteworks, Deconstruction Zone, Ice Maul /
        Iron Edge / Venom Fang arenas, plus terminals and the Core terminal. Floors run 70 to 300
        tiles a side, 4,000 to 8,000 tiles and 400 to 1,300 props each.
      - Running: exporting every tile and prop model those floors use, and working out the exact
        tile and prop transforms from the Clyde engine source, with the gameplay markers (entrance,
        elevator, spawn tables, doors, blocks) mapped to our actors.
      - Still to do: import the meshes; a floor data asset per scene; a floor builder that lays out
        instanced meshes with collision on every machine from the server's replicated pick;
        runtime navigation; markers wired into `AClockworksFloorDirector`; the lobby.
- [ ] **An elevator** at the end of each floor, with a depth counter and the
      prize-wheel moment. [5.3]
      *Partly built: `AClockworksElevator` with its depth sign, and the depth on the
      HUD and the minimap (section E2). Still missing: the prize-wheel moment.*
- [ ] **Level objects** so rooms have verbs: buttons, monster doors, breakable
      blocks, treasure boxes, spike traps and status grates. [3.4]
- [ ] **Party button and a danger room** — gather, the doors lock, three waves.
      This is the single best-value encounter type to copy. [3.4, 5.4]
- [x] **Minimap**, top-right, with the exit marked. [5.3]
      Built 2026-09-14: `UClockworksMinimapPanel`, a radar with the elevator always
      marked (section A2). No floor plan yet. *Unseen in play.*
- [ ] **The Clockworks tileset dressed properly.** The floor, wall, gear and
      prop meshes are imported but the test level is engine boxes.

### E2. The full Clockworks loop — confirmed scope

You asked for "a full loop of the Clockworks with the Core". Taken literally
that is 30 depths, four bosses and two subtowns, which is a year of work. The
shape is what matters, not the length, so the demo builds **every kind of floor
the real loop has, once each**, in one continuous descent:

| Depth | Floor | What it demonstrates |
|---|---|---|
| 0 | **Mission lobby** (the real one, decided 2026-09-14) | a safe start, the loadout terminal |
| 1–3 | **Clockwork Tunnels**, a real archived floor picked at random | the core combat loop, level objects, a party button danger room |
| 4 | **Clockwork Terminal** | the safe floor: change gear, heal, choose to go deeper |
| 5–6 | a **themed stratum** of tunnels | a status theme and a monster family, so the two strata read differently |
| 7 | **boss floor** | Snarbolax or the Royal Jelly, both already imported |
| 8 | **The Core** | the terminal overlooking the world's heart, as the ending |

That is eight floors, one tileset, and it hits the lobby, the tunnel, the
terminal, the themed stratum, the boss and the Core. It stays inside the cut
list: one tileset, no economy, no meta-progression, no missions.

- [x] **Depth counter and the run as a unit.** `AClockworksGameState` owns a
      replicated depth and decides what kind of floor each one is; the whole
      shape of the demo is one function, `FloorKindForDepth`. The HUD shows the
      depth and the floor's name under the shield meter.
- [x] **The elevator.** `AClockworksElevator` opens when the last monster on the
      floor falls, needs *every* living knight standing on it, counts down two
      seconds, then advances the depth and shuts behind them. Its pad is red
      shut, blue open and green boarding, and its sign reads the depth you are
      about to reach. The "everyone goes together" rule is the original's and is
      kept even though the demo is single-player, because it is the rule that
      will matter when there are two knights.
- [x] **Floors get built.** `AClockworksFloorDirector` listens to the depth, wipes
      the last floor's monsters, puts the knights at the entrance and populates
      the new floor from a weighted table gated by depth: wolvers and lichens on
      the first floor, the mechaknight from four, the gremlin from five. Count
      grows with depth. Terminals and the Core spawn nothing and open at once.
- [x] **Boss floor.** Snarbolax spawns alone on depth 7.
- [x] **The Core** is the last depth and has no way down, which is how the run
      ends.
- [x] **A playable run level**, `Lvl_Run`: a walled arena, an entrance at one
      end, the elevator at the other, navigation bounds, and the director wired
      to every monster in the project.
      **Build Paths once in the editor** — the navigation could not be built
      headlessly, and until it is the monsters walk straight at you rather than
      around the walls.
- [x] **Real floors instead of one arena.** Superseded by "Real Spiral Knights floors" at the top of
      this section: archived real floors, not our own room modules. The director is still what they
      plug into.
- [ ] **A terminal station** on the terminal floor that opens the gear screen,
      and heart generators. [3.2]

## F. The demo shell — menus

This is the part you asked for most directly and none of it exists.

**Confirmed: both a main menu and an in-game overlay.** The menu is where a run
starts; the overlay is how you change your kit without leaving the level, the
way the original's Arsenal Station works at a terminal.

- [x] **Main menu**: title, the controls, and Play / Loadout / Quit, over the
      paused level rather than a black screen. `UClockworksMainMenu` on
      `UClockworksMenuScreen`, which carries the shared backdrop, title and
      button style for all three menus. *It opens over the level rather than on
      a map of its own, because the editor automation cannot author a new map.
      A separate menu map is the refinement.*
      *Not done: an Options screen.*
- [x] **Loadout screen**: `UClockworksGearScreen`. Three toolbar slots across
      the top, every weapon in the project listed underneath, click a slot then
      click a weapon. The catalogue comes from an asset registry scan, so a new
      `DA_Weapon_*` appears in the menu without anyone wiring it up; a weapon
      already carried is tinted, and picking one that is already in another slot
      swaps them rather than duplicating. It decides nothing: the chosen toolbar
      goes to the PlayerState as intent and the server replaces the loadout
      (`RequestSetLoadout` / `ServerSetLoadout` / `SetLoadout`), refused in the
      same cases a single weapon switch is refused.
      *Not done: armour and helmets, which need an equipment definition of their
      own, and shields, which are still fixed on the character.*
      **Superseded 2026-09-15:** the screen was rebuilt as the original's Character
      window, item card and Arsenal, with four weapon slots, helmet, armour, shield and
      two trinkets, all 623 gear pieces and saved loadouts. Tracked in
      `Docs/KnightChecklist.md` section 7.
      **Original note:** pick a sword, a gun, a bomb and a shield before you
      drop in. The data side is already built — `UClockworksWeaponDefinition`
      assets and a server-owned loadout on the PlayerState — so this is a widget
      over existing state, not new systems. Shields need to become definitions
      too; today the shield is fixed on the character.
- [x] **In-game gear overlay** (partly): L opens the loadout screen from play,
      which covers weapons and, since 2026-09-15, helmets, armour, shields and
      trinkets. Still to do is the terminal station that gates it. Original note:
      opened with a key and at a terminal station.
      Swap weapons between toolbar slots and change armour and helmet. Armour
      and helmet do not exist as data yet: they need an equipment definition
      like the weapon one, carrying a mesh, a defense value and the attribute
      effects it grants. The knight export already has several armour and helm
      pieces imported under `Content/SK/Knights`.
- [ ] **Depth / level select** so you can jump straight to the fight you want to
      show. Reads as the original's gate map.
- [x] **Pause menu**: Escape, then Resume / Loadout / Quit.
      `UClockworksPauseMenu`. The controller ticks while paused so Escape can
      always get you back out. L opens the loadout straight from play.
      *Multiplayer caveat: it pauses the whole world, which is right for the
      single-player demo and will have to become a per-player menu for co-op.*
- [ ] **Options**: resolution, quality, volume sliders, and rebindable keys.
      [5.9]
- [ ] **Death and run-end screens**, with a retry that does not need a restart.
- [ ] **Host / join buttons** in the menu, which needs phase 07 below.

## G. Two players over the internet — deferred

**Confirmed: single player for now; the online part comes after.** This whole
section moves to the end of the order. What does *not* change: every new system
is still written server-authoritative, because that is a design rule rather than
a testing one and retrofitting it later is a rewrite.

- [ ] **Phase 07, Epic Online Services sessions**: create, find, join by invite.
- [ ] **Play the whole slice at `Net PktLag=150`** before calling the online
      part done.
- [ ] **Re-test everything built during the single-player stretch in two-player
      PIE** once sessions exist. Keep a note of what was never tested with two
      players: currently the loadout switch, the toolbar, every pistol number,
      and the whole shield and bash kit.

## H. Animation timing — corrected 2026-09-14

The first pass squeezed every clip into its gameplay phase, which distorted
anything whose clip was longer than its phase. Measured against the real clip
lengths:

| Clip | Length | Was played over | Was |
|---|---|---|---|
| `dodge_fire` | 0.97 s | 0.30 s | 3.2× blur |
| `attack_sword_1_end` | 0.65 s | never | swing 1 snapped to idle |
| `attack_sword_2_end` | 0.65 s | 0.23 s | 2.8× too fast |
| `charge_sword_release` | 0.90 s | 0.33 s | 2.75×, which is the original's own speed |
| `charge_sword_spin` | 0.33 s | 0.33 s | 1×, correct all along |

The fix is that follow-through clips now play at their own speed and run past
the end of the gameplay phase, getting cut off by whatever you do next, rather
than being crushed into it. A swing with no gameplay recovery still plays its
follow-through, which is what stopped swing one snapping. Every phase gained an
explicit play-rate knob, with zero meaning "fit to the phase" as before.

- [ ] **Re-tune by feel once seen in motion.** The rates above are the
      original's numbers, not judgements about how it plays here.

## H2. Animation gaps still open after today

Today's pass wired the enemy telegraphs, enemy flinches and aggro barks, the
pistol charge follow-through, the persistent charge aura, and split the knight's
clips across a full-body and an upper-body slot. Still unused:

- [ ] Knight `hurt_hard` (a heavier flinch for big hits; only `hurt_soft` is
      wired) and `hurt_recover`.
- [ ] Knight `dodge_end` — the dodge has no recovery phase to play it in.
- [ ] Knight `walk_*` clips — only the run set is used, so there is no slow walk.
- [ ] Knight `sidestep_left` / `sidestep_right`.
- [ ] Knight idle variations `idle_001`–`005` (the original cycles them).
- [ ] Knight `lift` / `hold` / `throw` — needed when bombs and carried objects
      exist.
      *Partly built: `lift` is every bomb's draw clip (`generate_weapon_assets.py`) and
      `throw` the Proto Bomb's dud clip (`generate_attack_profiles.py`), which gave the
      hold to the real `charge_bomb_hold`. Still missing: carried objects.*
- [ ] Wolver `knockdown`, `recover`, `turn_left`, `turn_right`, `gounder`,
      `standing_idle`, and the whole `Tripple_Attack` set.
- [ ] Mechaknight `Run` (only `Walk` is used), `Jitters`, `death` (as distinct
      from `dying`), and the second and third sword swings.
- [ ] Gunpuppy `spawn`, `walking`, `walking_idle`.

---

## Expanded scope, requested 2026-09-14

> "i need all of the weapons added, all of the status effects added, i need
> everything in there related to combat at least... you will also take care of
> all the animations of all the mobs in the game... make sure the audios are
> also being done for this, and the effects"

That is the full combat surface of Spiral Knights rather than a representative
slice, so it gets its own tracked sections. The order below still holds; these
are worked through inside it.

### W. Every weapon

The install carries roughly 28 sword models, 17 handgun models and 16 bomb
models. Doing this by hand is not realistic and would get the numbers wrong, so
it is done by mining `item.xml` for each weapon's real damage type, status,
charge time and speeds, then generating the data assets from that table.

- [x] The three starter weapons, with their real numbers.
- [x] A first pass of eleven more, one from each major line, covering all four
      damage types across all three classes.
- [x] **Mined `item.xml` into a table of every weapon.**
      `Tools/SKImport/mine_weapons.py` writes `weapons.json`: **352 weapons**
      (143 swords, 124 handguns, 85 bombs), every one with its damage types,
      status and chance, charge time, speeds, model and icon. Nothing came out
      guessed: 351 of 352 got their damage types from the authoritative
      `Attack Values` array.
- [x] **Bulk exported and imported** every model and icon that table names:
      162 of 176 distinct models (14 fail in the exporter on a variant that will
      not apply) and all 307 icons.
- [x] **Generated a data asset per weapon.**
      `Tools/SKImport/generate_weapon_assets.py` writes **351 weapon
      definitions** under `Content/TopDown/Gear/Catalogue`, verified by
      `verify_weapon_assets.py`: 329 with a mesh, 351 with an icon, 351 with an
      attack ability, 177 with a status. By damage type: 182 Normal, 86
      Elemental, 45 Piercing, 38 Shadow.
      Attack values are normalised against the starter weapons rather than
      copied raw, so a five-star weapon hits harder than a Calibur without
      hitting thirty times as hard.
      *Known limits: 22 weapons have no mesh; a dual-type weapon carries only
      its first damage type, because this project resolves one type per hit.*
- [x] **Class tabs on the loadout screen.** 351 weapons in one list is not a
      list anyone can read, so the screen now filters to one class at a time and
      says how many are available. The class is stored on the weapon definition
      rather than guessed from its ability's name.
- [x] **Per-line attack behaviour, the mechanical half.** Four of the five are
      built and are data on the weapon rather than new classes:
      the **Alchemer's ricochet** (`MaxBounces`, with damage retained per
      bounce, so a corridor is a weapon but not a free multiplier);
      the **Autogun's burst** (`BulletsPerShot` spread evenly across
      `SpreadAngleDegrees`, so six pellets cover a predictable arc);
      the **Magnus's kick** (`ShotRecoilDistance`, applied once per shot rather
      than once per bullet); and the **Pulsar's swelling pellet**
      (`ProjectileGrowthScale` and `ProjectileGrowthDamage`, so the gun is
      better the further away you stand).
      *Not done: the Catalyzer's tag-and-detonate, which needs a tag actor and a
      second ability rather than a knob.*
- [ ] **Known blocker:** the Shard Bomb model imports as a skeletal mesh, which
      the weapon definition cannot take. Either convert it or skip that line.

### S. Every status  — **done**

All seven built. See section C.

- [x] **Audio and a visual for every status.** `UClockworksStatusDisplay` is one
      component carried by both the knight and every monster: it listens for all
      seven status tags, plays the status's own sound the moment one lands,
      loops a second sound while it runs, and paints a coloured shell around the
      body for whichever status currently outranks the rest.
      The shell is deliberately not an overlay material on the mesh: the hit
      flash, the attack telegraph and the stun pose already own that slot, and a
      status has to be able to show at the same time as any of them.
- [x] **91 sounds imported**, covering all seven statuses plus a full aggro,
      attack, hurt and death set for every monster in the import list.

### M. Every mob: animations, audio and effects

Fourteen monsters are already imported with their skeletons and animation sets.
Each one needs the same treatment the wolver got.

- [x] **Answered, and sidestepped.** An Animation Blueprint still cannot be
      authored without the editor. It turned out not to matter: a monster needs
      an idle loop, a movement loop and some one-off clips, none of which needs
      a blend tree. `AClockworksEnemyCharacter` gained a **direct animation
      mode** that drives the mesh in single-node playback and picks the loop
      from its own speed, so a monster needs no Animation Blueprint at all.
      The cost is that clip changes do not blend; at this camera distance that
      reads as snappy, and any monster that deserves better can be given a real
      Animation Blueprint by turning the mode off.
- [x] **Nine monsters built**, bringing the roster to twelve.
      `Tools/SKImport/generate_monsters.py` writes a Blueprint and an attack
      ability for each: Jellycube, Lichen, Zombie, Spookat, Chromalisk,
      Devilite, Gremlin Artillery, and two bosses, Snarbolax and Royal Jelly.
      Verified by `verify_monsters.py`: every one has its mesh, idle, movement
      and death clips, its family, its health, its ability and its aggro sound.
- [x] Per mob: idle, move, attack, hurt, death and aggro clips wired.
- [x] Per mob: a family tag, so the damage chart applies to it. The roster now
      covers five of the six families.
- [x] Per mob: an attack ability, melee or ranged as suits it.
- [x] Per mob: aggro, hurt, death and attack sounds.
- [x] Per mob: telegraph tint, hit spark, hitstop and the status aura, all of
      which come free from the base class.
- [x] **A bestiary level to check them in.** `Lvl_Bestiary` holds all twelve
      monsters in a row with name plates, built by
      `generate_bestiary_level.py`. Deliberately a new level rather than the
      test arena, so nothing hand-placed was touched.
- [ ] **Look at the bestiary and fix what is wrong.** Nothing here has been seen
      running: the mesh rotation and vertical offset are the knight's numbers
      applied to every skeleton, so some monsters will be lying down, sunk into
      the floor or facing the wrong way. The row is the fastest way to find out
      which, and the numbers are two lines in `generate_monsters.py`.
- [ ] Tune each monster's attack timings; they are on the ability defaults.
- [ ] Second attacks for mobs whose exports carry them: the wolver's
      `Tripple_Attack` set, the mechaknight's second and third sword swings.

---

## Order of work — revised 2026-09-14 after the scope decisions

1. **HUD and audio.** *In progress.* Health pips, shield meter and enemy health
   bars are done. Audio is imported and wired in code; the remaining piece is
   assigning the assets and hearing it in play.
   *Update 2026-09-15: built in code.* The whole HUD (section A2) and the audio
   (91 sounds, plus each weapon's own) exist; nobody has seen the HUD or heard
   the sounds in play yet.
2. **Hitstop, hit sparks, swing trail, telegraph aura.** Combat starts to feel
   like a game rather than a test. **Done** (section A: `AClockworksHitSpark`,
   the telegraph in `RefreshOverlay`).
3. **The player's kit**: bombs, and the Proto Gun rework. **Done.**
4. **The menu shell**: main menu map, loadout screen, pause menu, and the
   in-game gear overlay. *The equipment definition exists since 2026-09-15 and the
   overlay is the original's Equipment screen (item 7c).*
   *Partly built: main menu, loadout screen, pause menu and the L overlay exist
   (section F). Still missing: a menu map of its own (the menu opens over the
   level) and the terminal station that gates the overlay.*
5. **Damage types and status effects. Done** — and all seven statuses rather
   than three, per the expanded scope below.
6. **Three more enemies and second attacks for the current three**, plus the
   boss for the boss floor.
   *Partly built: nine monsters including both bosses (`generate_monsters.py`),
   Snarbolax on the boss floor; unseen in play. Still missing: second attacks
   for any monster.*
7. **The Clockworks loop.** *Mostly done:* the depth, the elevator, floor
   population, the boss floor and the Core all work, in `Lvl_Run`. *In progress
   (2026-09-14):* real archived Spiral Knights floors in place of the arena (see
   section E). After that, level objects, which give the floors their verbs.
7b. **Special bullets** (bursts, splits, clouds, shards, vortexes, Catalyzer). *Built
   2026-09-14*, with the user's stand-ins for the numbers the client does not ship;
   unseen in play. The Mixer line's and the Warmaster bombs' orbitals deal damage since 2026-09-15.
7c. **The knight: every piece of gear.** *Built 2026-09-15* (623 pieces, stats, looks,
   the Equipment screen; `Docs/KnightChecklist.md`), compiled, first seen in play by the
   user 2026-09-15. **In progress (user: "do this", 2026-09-15).** Built, compiled and applied
   headlessly unless marked; none of it seen in play yet:
   - [x] **Equipment screen cut off the Arsenal** in a narrow play window. Fixed by shrinking the
         windows to fit, then the Arsenal was redesigned (user's choices): category tabs, name
         search, sort menu, damage type / resistance filter, star toggles, rows under star
         headings, the item card as a hover tooltip, click to select, double-click or Equip to put
         on. Logs `Arsenal: ... helmets N` so a missing category shows in the Output Log.
   - [ ] **Preview knight drawn grey-checkered** in the user's first look (probably shaders
         still compiling; to confirm).
   - [ ] **Monsters retuned from the original's curves**: health, damage per attack and type,
         defense per type, by depth (`D:\Dev\SKAssets\_research\monsters`). *In progress:* all 12
         carry health, per-type defense and their main attack's damage (`apply_monster_numbers.py`);
         the family chart gives way to their defense numbers. Still to build: extra attacks, and the
         user's decisions, a beast bell for Snarbolax, Royal Jelly in stages, Chromalisk a melee
         licker and Devilite a thrower like the plain originals. *Models and clips imported
         2026-09-15* (`D:\Dev\SKAssets\_exports_2026_09_15`):
         - Devilite is now the plain model, with its throw clips.
         - Snarbolax gains its bites, knockdown, burrow and tail whip.
         - Royal Jelly gains its roundhouse and spins.
         - Chromalisk gains knockdown and dodges.
         - New: the Royal Mini and Royal Polyp, and the beast bell (`/Game/SK/World/Props/BeastBell`).

         The Royal Polyp is purple through `M_MonsterTint`, the user's choice. Its skirt and shell
         import as static meshes beside the skinned body (as Royal Jelly's second skin copy does), so
         they will not animate with it until that is fixed.
   - [x] **Knight weapon damage from the original's curves** by star and depth (`apply_weapon_damage.py`:
         351 weapons, 2410 tables). Every swing, region, blast, bullet, burst and sub-bullet now carries its own
         damage by depth. Built with it, all the user's choices:
         - bomb falloff removed;
         - the original's status chances, and Fire and Shock ticking every 0.5 s for depth-scaled damage;
         - piercing charged shots bursting where they end (19 weapons);
         - Mixer and Diskgun pellets dealing the damage (4 weapons);
         - letting go of a sword charge early swings its incomplete-charge move.
   - [x] **Second pass, same day** (user: "do this"), with the research in `_research/weapon_gaps` and
         `_research/status_damage`:
         - dual-type weapons split 50/50 (INFERRED);
         - the Avenger, Divine Avenger, Faust and Gran Faust charges fire their piercing bolts;
         - Warmaster bomb orbital rings, and the Mixer pellets at their real speed;
         - Catalyzer orbs blast with each weapon's own damage and last 20 s.

         Statuses, the user's choices:
         - Fire burns every 2 s;
         - Shock arcs on each spasm (every 1–4 s) to everything on the victim's side within 2 tiles;
         - thaw damage by the wiki's rules;
         - curse costs up to 40 per attack used;
         - Sleep's wake damage is added to the waking hit.
   - [x] **Colorized gear tinted**: 558 skins baked from the original's colour tables
         (`bake_gear_skins.py`), imported, `M_GearSkin` shifts the personal-colour magenta (blue
         by default, user's decision), applied per imported material (`SkinSwaps`) on 191 armours,
         210 helmets and 33 shields.
   - [x] **Attack speed bonus** (every attack phase, `ResolveAttackSeconds`) and **damage bonus
         against a monster family** (pooled with the relative bonus, applied per hit in the
         attribute set). Bonuses now use the original's fixed steps and caps.
   - [x] **Shield bash by rank**: each shield's bash kind, rank and damage curve (Tortodrone ring,
         Targe), the original's timings and a depth-scaled stun; **push-back** on raising the
         shield by its Knock-Back Power (research found it is not a reaction to blocking).
   - [x] **Face hidden** under the three hunting caps (the original's only `showEyes` false helms).
   - [x] **Loose armour pieces**: 9 pieces imported, on 26 armours, tassels and Merc glows turning
         to face the camera (user's choice; setup INFERRED).
   - [x] **Targe and the 12 Tortafists placed right**: the axis conversion was checked against the
         exporter and importer source and a vertex-by-vertex test (exact). Also found and fixed: the
         knight's own shield placement on each bone had never been applied.
   - [x] **Defense rule corrected** to the original's code: a hit above the defense loses half of it.
8. **Phase 07 sessions**, deferred by decision until the single-player demo is
   whole.

Items 1–4 give you something worth showing. Item 7 is the largest single piece
of work on this list and the one that turns a level into a game.

## Decisions made (2026-09-14)

All five open questions were answered. These are settled scope now, not
proposals.

- **Bombs: build them.** Third weapon class, built from the game's own assets
  the same way the sword and the gun were — real numbers out of the config
  dumps, real clips out of the knight export. See section B.
- **The gun gets the same treatment as the sword.** The Proto Gun was built
  before the animation-timing work, so its clips are fitted to gameplay phases
  rather than played at their own speed. It needs the section H correction
  applied to it. Added to section B.
- **Multiple levels: the full Clockworks loop, ending at the Core.** See
  section E for what that means concretely and where it is compressed.
- **Superseded 2026-09-15: four runs, one per boss.** The compressed eight-depth
  run gives way to four full-length runs (Snarbolax, Royal Jelly, Roarmulus
  Twins, Vanaduke) at the original's own depths, chosen from four elevators in
  the Mission Lobby, with every monster those depths need. Their Shadow Lair
  versions come after all four work. Research: `_research/runs`,
  `_research/bosses2`.
- **Menus: both.** A main menu map *and* an in-game overlay for swapping
  weapons and changing gear and armour. See section F.
- **Sound: use the game's own audio**, on the same terms as the models —
  `Content/SK` is git-ignored, placeholder only, never ships.
- **Floors (later on 2026-09-14): real archived Spiral Knights floors, picked at
  random per depth**, rather than our own room modules and a stitcher. The
  cached mission lobby is depth 0.
- **Special bullets (later on 2026-09-14): the stand-ins listed in section A3**
  for the numbers the game's client does not ship. Brandish-line explosions were
  then changed to 1 tile apart, one every 0.1 s.
- **Debug auto-fight stays off.** It was left on in `BP_ClockworksCharacter` and
  read as phantom input; switched off 2026-09-14.
- **Knight before monsters (later on 2026-09-14).** Import everything that belongs
  to the knight and get its core mechanics down before the monster pass. This pass
  is **gear first**: every shield, helmet, armour and trinket with its real stats and
  look, equipped from the gear screen. **Cosmetics after** (costumes, accessories,
  recolour sets, personal colour, eyes, height). The knight checklist also covers
  **battle sprites** and **consumables**. The checklist itself, audited item by item,
  is `Docs/KnightChecklist.md`.
- **Gear numbers (2026-09-15).** Gear stats follow depth (the demo's 8 depths map onto
  the original's curve); gear is fully heated (level 10, its extra defense and health
  included, no levelling system); the 93 bonus values the data only labels LOW / MEDIUM /
  HIGH use the most common real number for that label; the 26 unreleased `_` trinkets are
  in.
- **Gear screen (2026-09-15).** Rebuilt like Spiral Knights' Arsenal and Character windows
  from the user's screenshots, other tabs drawn but inert, Save Loadout included; 4 weapon
  slots, helmet, armour, shield, 2 trinkets; gear shows level 10, no rank. Details in
  `Docs/KnightChecklist.md`.
- **Combat numbers (2026-09-15).** The original's scale throughout: knight health 40 per pip
  with 5 pips base, monsters retuned from the depth curves, defense subtracted per damage
  type at the full config values; the demo's depths spread evenly over the original's
  (1→4 … 8→29); status resistance reduces duration, damage and chance.
- **Single player for now.** Phase 07 online sessions are deferred, not cut.
  The server-authoritative rule in `CLAUDE.md` still holds for every new
  system, because retrofitting it later is a rewrite; what is deferred is the
  two-player testing gate and Epic Online Services.
