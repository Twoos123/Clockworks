# Clockworks — handoff for a new session

Written 2026-09-14, at the end of a long session. Read `CLAUDE.md` first for the
project's rules; this file is only "where things stand and what to do next".

---

## Read these three files, in this order

1. **`CLAUDE.md`** — the rules and the running status of every system. Its
   "Where the project actually is right now" section is the source of truth.
2. **`Docs/DemoTodo.md`** — the full gap list with an ordered plan. Ticked items
   say what was built and what was deliberately left out.
3. **This file** — the immediate state, the traps, and what to pick up.

---

## Do these first, before writing any code

### 1. The editor automation link may be down

The MCP link to the editor (`mcp__unreal-mcp__*`) dropped mid-session and could
not be recovered. **A fresh Claude Code session should get it back.** Check by
calling `SceneTools.get_current_level`.

If it is down, it is not a blocker. Everything that creates or edits assets is
now an **editor Python script** run headless, which needs no link:

```
"C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" ^
  "D:\Dev\Clockworks\Clockworks.uproject" -run=pythonscript ^
  -script="D:/Dev/Clockworks/Tools/SKImport/<script>.py" -unattended -nopause -stdout
```

### 2. The user has two jobs waiting

- **Open `Lvl_Run`, Build → Build Paths, save.** The navigation could not be
  built headlessly. Until it is, monsters walk straight at the player instead of
  around walls.
- **Open `Lvl_Bestiary`** and say which of the twelve monsters look wrong.

### 3. Nothing is committed

The working tree has ~95 changed files and is uncommitted since `4b08ed9`.
**Do not commit unless asked** (`CLAUDE.md` rule 4).

---

## What exists now

| System | State |
|---|---|
| HUD, audio | Done. 91 sounds; health pips, shield meter, enemy bars, depth readout |
| Hitstop, hit sparks, swing trail, telegraph aura | Done |
| Sword, gun, bomb | Done, numbers from the game's own config dumps |
| Menus: start, pause, loadout, how-to-play | Done |
| Damage types, monster families | Done, 4 types against 6 families |
| All seven statuses | Done, with audio and a coloured aura |
| Weapon catalogue | **351 weapons** generated from `item.xml` |
| Monsters | **12**, nine of them generated, two bosses |
| The run: depth, elevator, floor director | Done, playable in `Lvl_Run` |
| Room modules, level objects | **Not started** |
| Two-player sessions | Deferred by the user's decision |

---

## In flight: the section A and B leftovers

The user asked why these were not done. The honest answer: they live in sections
A and B of `Docs/DemoTodo.md`, *outside* the numbered order, and working the
order missed them. **This is the current task.**

- [x] **Damage numbers** — `AClockworksDamageNumber` is built and wired. Grey
      resisted, blue neutral, gold and larger for a weakness, read off a new
      sixth parameter on `OnDamaged` that carries the family multiplier.
      No Blueprint needed after all: the class has no asset references, so
      `DamageNumberClass` now defaults to the C++ class in both character
      constructors, and it loads the engine's translucent text material so the
      fade works. Game target compiles; **not yet seen in play**, and the
      editor needs a close, editor-target rebuild and relaunch to pick it up.
- [x] **Screen damage flash**: a red elliptical edge glow, drawn from a texture
      made in code, on every health loss (user's choice over a full-screen tint).
- [x] **Health pip colours**: purple then white on damage, cyan on heal,
      flicker during i-frames, silver and gold tiers.
- [ ] **Consumable belt on 4–7**: health capsules, remedy, a vial type. The
      *slots* are drawn, empty, by `UClockworksConsumableBelt`.
- [ ] **Hearts and pickups** dropping from enemies, per-player copies.
- [ ] **Vitapods**: temporary max health for the run.
- [x] **A switch wheel** for weapons: `UClockworksWeaponWheel`, which replaces
      the toolbar (user's decision). Number keys are still not bound.
- [x] **The full Spiral Knights HUD from the user's screenshots.** Every piece in
      section A2 of `Docs/DemoTodo.md`, with the user's decisions recorded there:
      dead buttons for the cut screens, depth on the portrait rim, the heat orb as
      a charge meter, empty belt slots.
- [x] **Sword combo reset when spamming.** A click that landed just after
      swing 1's 0.35 s ended started swing 1 again, and a click during a recovery
      was queued and thrown away. Now a recovery press queues the next swing, and
      `ComboContinueSeconds` (0.566 s, the game's rearm 233 ms + 667 ms / End
      Speed 2.0) lets a press after a mid-combo swing continue the chain.

**Applied to the editor (2026-09-14):** built, HUD art imported and marked as UI
textures, weapons regenerated, skins applied. Not yet seen in play by Claude.

**Second pass the same evening** (see `Docs/DemoTodo.md` section A3): input buffer,
dodge cancels attack recovery, gun click fixes, Spiral Knights cursor, weapon skins,
per-tier meshes, bombs showing their own model, and the armoury as line and tier
trees. Also applied.

**Third pass (2026-09-14, late): every weapon's animations, models, bullets and sounds.**
See `CLAUDE.md` "Every weapon moves, looks and sounds like itself" and `Docs/DemoTodo.md`
A3. Built, imported and generated headlessly; **nothing of it has been seen in play**.
The first thing to do is equip a few very different weapons in the armoury and fire them:
Proto Gun, Autogun (stream and charged fan), Magnus (spinning shell), Winmillion (thrown
wheels), a Needle gun (all its pieces), a Shard Bomb (its blast sound), a Tortofist.

The research dumps behind `weapon_fx.json` and `weapon_model_pieces.json` are too big for
the repo and live in `D:\Dev\SKAssets\_research\` (`projectile_visuals.json`,
`weapon_sounds.json`, and the full `weapon_model_pieces.json` with evidence). Re-distil with
`python Tools/SKImport/distill_weapon_fx.py D:\Dev\SKAssets\_research\projectile_visuals.json D:\Dev\SKAssets\_research\weapon_sounds.json`.
- [x] ~~A second sword and a second gun~~ — superseded. The catalogue has 143
      swords and 124 handguns. The checkbox in section B is stale.

---

## Traps that cost time this session

**Unreal Python.**
- `unreal.log` at Display level is filtered out of commandlet output. **Log at
  warning level** or you will see nothing.
- A commandlet's asset registry has not walked the project.
  `registry.scan_paths_synchronous([path], True)` first, or every folder lists
  as empty.
- **Gameplay tags cannot be built from Python.** The struct's name is read-only
  and `GameplayTagLibrary` is not exposed. Classes a tool must set a tag on
  carry a `Set*ByName(FString)` UFUNCTION for it. Two exist already:
  `UClockworksWeaponDefinition::SetDamageTypeByName` and
  `AClockworksEnemyCharacter::SetFamilyTagByName`.
- Boolean properties **drop the Hungarian `b`**: `bUseDirectAnimation` is
  `use_direct_animation` to Python. Avoid a bool whose name without the `b` is a
  common word (`bSet` would become `set`); the bullet look's flag is `bEnabled`.
- UE 5.8 checks `FString::Printf` formats at compile time: the format must be a literal.
  `Printf(bFlag ? TEXT("a %s") : TEXT("b %s"), ...)` does not compile; put the ternary in
  an argument instead.
- The ImportAssets commandlet always logs "Invalid Destination Path ()" before it reads
  the groups and then exits 1. The imports themselves succeed; check the folders on disk.
- `does_asset_exist` is false for a `_C` class path. Load the **Blueprint**
  asset and call `.generated_class()`. Getting this wrong silently left all 351
  weapons with no attack ability.
- Components use `get_editor_property("relative_location")`, not
  `get_relative_location()`.

**The editor.**
- **Live Coding blocks builds.** Close the editor before building, or the build
  fails with "Unable to build while Live Coding is active".
- `SceneTools.load_level` is a no-op when that level is already open. A CDO
  change does not reach actors already in memory; restart the editor.
- Placed actors serialise their own values. An `EditDefaultsOnly` property
  cannot be written on an instance at all, which is why the enemy sound
  properties had to become `EditAnywhere`.

**Never use OS-level input or screen capture.** The user plays games full-screen
on their primary monitor with the editor on a second. Use the Slate inspector
tools and `EditorAppToolset.CaptureViewport` only.

---

## The tools

All in `Tools/SKImport/`. Each is re-runnable and idempotent.

| Script | What it does |
|---|---|
| `stage_and_import.py` | Stages SK assets and runs the ImportAssets commandlet. Reads `weapons.json` to derive the weapon models and icons automatically. `--groups` picks categories, `--names` picks single assets (re-import a few monsters without the rest of their group). Staging numbers the parts of the game's three-part animations that share one name (`spin`, `spin1`, `spin2`) and drops exact duplicates; before 2026-09-15 Interchange renamed some of those clashes itself and parts overwrote each other. |
| `mine_weapons.py` | Reads the game's `item.xml` into `weapons.json`: 352 weapons with real damage types, statuses and timings. |
| `generate_weapon_assets.py` | 351 weapon data assets under `Content/TopDown/Gear/Catalogue`, each with every solid piece of its model. |
| `generate_attack_profiles.py` | Each weapon's attack profile: moves from `weapon_base_attacks.json`, sounds, bullets and fire patterns from `weapon_fx.json`. Run after the one above. |
| `distill_weapon_fx.py` | Plain Python. Writes `weapon_fx.json` from the projectile and sound research dumps. |
| `make_bullet_materials.py` | `M_BulletCore`, `M_BulletGlow`; points `BP_PistolBolt` at them and `BP_GA_SwordAttack` at the bolt and `BP_Bomb` (bullets and blasts). |
| `distill_charged_attacks.py` | Plain Python. Writes `weapon_charged_attacks.json` from `D:\Dev\SKAssets\_research\charged_attacks.json` (made by `resolve_charged.py` beside it). |
| `import_armor_test.py` | Headless editor script. Imports armour glbs from `D:\Dev\SKAssets\_gear_export\armor` onto the player knight's existing skeleton through the Interchange manager (`ARMOR_TESTS="file.glb:Name,..."` picks them), staging each with `fix_armor_glb` from `stage_and_import.py`. Only the first import of a run completes; run it once per armour. |
| `mine_gear.py` | Plain Python. Writes `gear.json` (623 shields, helmets, armours and trinkets, the 26 unreleased trinkets tagged, with defense curves, resistances, bonuses, shield numbers, models, icons, lines; cosmetics counted) and `gear_models.txt` (the 178 model files). The knight pass is tracked in `Docs/KnightChecklist.md`. |
| `import_armor.py` / `run_armor_imports.py` | Every armour (60) onto the knight's skeleton under `/Game/SK/Gear/Armor/<SK_Armor...>`, one headless run each (plain Python driver; the editor must be closed). Results in `D:\Dev\SKAssets\_staging\GearArmor\armor_import_results.json`; `--redo` re-imports. |
| `fix_gear_textures.py` | Marks the gear icons and gear-screen art (`/Game/SK/GearIcons`, `/Game/SK/GearUI`) as UI textures. Run after importing those groups. |
| `generate_gear_assets.py` | 623 `DA_Gear_*` under `Content/TopDown/Gear/Knight/<slot>` from `gear.json`: defense curves, level-10 defense and health steps, resistances, bonuses, shield numbers, icon, model pieces, skin, compound-shield placement. Sets `BP_ClockworksCharacter`'s starting gear and 200 base health. Every looks guess goes to `gear_assets_report.json`. |
| `verify_gear_assets.py` | Per-slot counts of what landed (icons, models, curves, heat, shield health, tinted skins, loose pieces, face-hiding helmets, bash data) and the starting gear; flags any bonus above one step. |
| `bake_gear_skins.py` | Plain Python. Bakes the original's run-time gear colours into `D:\Dev\SKAssets\_gear_tinted\T_GearSkin_*.png` (558) with `gear_tinted.json` naming each item's textures and the imported material each replaces. Imported as group `GearSkins`. |
| `make_gear_skin_materials.py` | `M_GearSkin` (masked, two-sided, shifts the personal-colour magenta by `PlayerHueShift`, blue by default) and one `MI_GearSkin_*` per tinted texture. Run after importing `GearSkins`, before `generate_gear_assets.py`. |
| `apply_monster_numbers.py` | Writes the original's health, per-type defense and main-attack damage by depth onto the 12 monster Blueprints and their attack abilities, from `D:\Dev\SKAssets\_research\monsters\monster_numbers.json`. |
| `apply_weapon_damage.py` | Writes every weapon's damage by depth (hits, bullets, bursts, sub-bullets), the piercing shots' end bursts, the Mixer line's and Warmaster bombs' orbit damage, the Catalyzer orbs' blast, dual-type splits, the original's status chances and every status's own damage table (burn, arc, thaw, curse, wake), from `D:\Dev\SKAssets\_research\weapon_damage\weapon_damage.json`, `weapon_gaps\weapon_gaps.json` and `status_damage\status_damage.json`. **Run after `generate_attack_profiles.py`**, which clears all of it. Problems go to `apply_report.json` in that folder. |
| `make_monster_tint.py` | `M_MonsterTint` (the original's run-time colorization as a material: hue, saturation and value shift in sRGB) and the Royal Polyp's purple (`MI_RoyalPolyp_Skin` on the body and skirt, additive `MI_RoyalPolyp_Gloss` on the shell), from `D:\Dev\SKAssets\_research\polyp_tint`. Re-run after re-importing `RoyalPolyp`. |
| `distill_bullet_behaviours.py` | Plain Python. Writes `weapon_bullet_behaviours.json` (splits, bursts, pulses, clouds, shards, vortexes, sticking, piercing, sub-bullets) from `bullet_behaviours.json` in the research folder. `generate_attack_profiles.py` applies it; `make_bullet_materials.py` sets `BP_Bomb`'s `ChildBulletClass`. |
| `fix_weapon_materials.py` | Each weapon's skin. Run last. |
| `verify_weapon_assets.py` | Counts and prints what actually landed. |
| `generate_monsters.py` | Nine monster Blueprints plus their attack abilities. Measures each mesh to size its capsule. |
| `verify_monsters.py` | Per-monster report: mesh, clips, family, capsule, offset. |
| `generate_bestiary_level.py` | `Lvl_Bestiary`: every monster in a row with name plates. |
| `generate_run_level.py` | `Lvl_Run`: the playable arena, elevator, floor director and monster table. |

The Spiral Knights config dumps are at
`D:\Dev\Tools\ThreeRingsSharp\ThreeRingsSharp\ConfigRefs` — `item.xml`,
`attack.xml`, `actor.xml`. **Mine them rather than inventing numbers.** Every
weapon and monster number in the project came from there.

---

## Design decisions worth not re-litigating

- **A tile is 100 cm.** The sword's lunges already assumed it.
- **Monsters use direct animation mode**, not Animation Blueprints, because an
  AnimBlueprint cannot be authored headlessly and a monster needs no blend tree.
  `bUseDirectAnimation` on `AClockworksEnemyCharacter`.
- **One attack ability per weapon class.** What separates two swords is data on
  the weapon definition, read through `ResolveDamageType`,
  `ResolveDamageMultiplier` and `ApplyWeaponStatus`.
- **Statuses paint their own shell**, not the mesh overlay, which the hit flash,
  the attack telegraph and the stun pose already own.
- **Everything stays server-authoritative** even though the demo is
  single-player. The user deferred online play, not the design rule.
- The user has a **debug auto-fight driver** (`bDebugAutoFight` on
  `BP_ClockworksCharacter`) that presses the real ability inputs on a timer, for
  testing without a keyboard. `bDebugInvulnerable` goes with it. **Both were left
  on** and the user took the scripted presses for phantom input; switched off
  2026-09-14. Turn them off again whenever you are done testing with them.

---

## Known broken or unverified

- **The nine generated monsters have never been seen running.** Their clip
  choices are guesses from file names.
- **Damage numbers have never been seen in play.** They need no Blueprint, but
  the editor must be closed, rebuilt and relaunched before they exist.
- **The 351 catalogue weapons have never been equipped**, and none of their attack
  profiles, bullets or sounds has been seen or heard.
- The Diskgun's body mesh does not come through the exporter (only its glow skin and
  spinner cards), so the two Diskguns have no solid body.
- Bullet sounds, looks and sword bullets are untested in two-player.
- Nothing has been tested in two-player PIE since the loadout work landed.
- **The knight gear pass (2026-09-15) has never been seen in play**: the equipment screen, the preview
  knight, any armour on the knight, per-type defense, gear health, shield numbers, status resistance
  and the damage and charge bonuses. Progress and open items: `Docs/KnightChecklist.md`.
- **The original's monster and weapon numbers (2026-09-15) have never been seen in play.** That covers:
  - monster health, defense and main attacks;
  - every weapon's damage by depth;
  - status chances and ticks;
  - piercing end bursts;
  - Mixer pellets;
  - the sword's early-release swing.
- **The second weapon and status pass (2026-09-15) has never been seen in play** either. It covers:
  - dual-type splits;
  - the four swords' bolts;
  - Warmaster rings;
  - Catalyzer orbs;
  - Fire every 2 s;
  - shock arcs;
  - thaw damage;
  - curse per attack;
  - wake damage.

  Its INFERRED numbers are listed in `_research/weapon_gaps/findings.md` and `_research/status_damage/findings.md`.
