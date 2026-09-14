# CLAUDE.md — Clockworks

> If you named the project something other than `Clockworks`, find-and-replace
> that word in this file and delete this line.

## What this is

An isometric co-op action dungeon crawler in Unreal Engine 5.8, C++, built from
the Top Down template. Reference point: Spiral Knights — real-time melee combat,
procedurally assembled floors, two players online.

**Networking model: listen server.** One player hosts, one joins. There will be
no dedicated server build.

## Where the project actually is right now

Phases 03 and 04 done (2026-09-13).

**Controls (03):** `AClockworksCharacter` moves with WASD relative to a fixed
camera (pitch -45, yaw 0, arm 1500) and faces its control yaw, which
`AClockworksPlayerController::PlayerTick` sets from the cursor projected onto
the floor plane. Aim reaches the server inside the CharacterMovementComponent
move packet. The game runs `BP_ClockworksCharacter` / `BP_ClockworksController`
(thin children of the C++ classes, set in `BP_TopDownGameMode`); the template's
`BP_TopDown*` Blueprints derive from engine classes and are unused.

**Combat spine (04, GAS):** `AClockworksPlayerState` hosts the player's
AbilitySystemComponent and `UClockworksAttributeSet` (Health, MaxHealth, Shield,
MaxShield, AttackPower, DefensePower, MoveSpeed, meta Damage). Native tags in
`ClockworksGameplayTags`. Abilities under `Source/Clockworks/AbilitySystem/`:
sword attack (windup/active/recovery from tunables, server-only sphere hitbox,
faction-gated, optional montage) and dodge (Shift+RMB, root-motion burst,
i-frames tag, SetByCaller cooldown). `UClockworksDamageEffect` feeds the Damage
meta attribute; the target's attribute set applies defense and shield.
`AClockworksEnemyCharacter` (ASC on the pawn) is the enemy base: knockback,
multicast hit flash, death. Assets: `BP_GA_SwordAttack`, `BP_GA_Dodge` (tune
numbers there), `BP_TrainingDummy` (two placed in `Lvl_TopDown`), `IA_Attack`,
`IA_Dodge`, `IA_ShiftModifier` (chorded in `IMC_Default`), montage
`MM_Attack_01_Montage`. Verified in two-player listen-server PIE: both players
granted abilities, dummies at 50 health, hits/flash/knockback and dodge
confirmed by the user.

**Reference assets (2026-09-13):** Spiral Knights models extracted with
ThreeRingsSharp and imported through the `ImportAssets` commandlet into
`Content/SK/` (git-ignored, Grey Havens/SEGA property, placeholders only):
14 monsters with skeletons and animations, sword/helm/shield/armour, Clockworks
tiles and props. Pipeline and limits: `Docs/SpiralKnightsAssetPipeline.md`;
re-run with `python Tools/SKImport/stage_and_import.py --import`. In use:
`BP_TrainingDummy` shows the Wolver, `BP_ClockworksCharacter` the rigged
player knight (coat armour), mesh rotation roll -90 / yaw -90 (Clyde is Z-up,
glTF is Y-up). Decision: enemies and the knight use the Spiral Knights
animations directly. `ABP_Knight` and `ABP_Wolver` (Content/TopDown/Blueprints)
blend idle/run by speed and expose a `DefaultSlot` for montages; the graphs
were authored over MCP and the assets themselves must be created in the editor
(the tools cannot attach a skeleton).

**Sword combo (04b):** `UClockworksSwordAttackAbility` runs `ComboSteps`
(montage, windup/active/recovery, recovery lock, lunge, damage multiplier per
swing). A press during a swing queues the next step through the ability
system's replicated input (`EClockworksAbilityInputID`, abilities granted
with an input ID, `AbilityLocalInputPressed`). Swing 1 has no recovery;
swings 2 and 3 plant the feet via `State.MovementLocked`. The dodge plays
`DodgeMontage`. Montages are the knight's `*_fire` clips under `Content/SK`.
Play-In-Editor is set to one player for now (user's performance); switch back
to two players / listen server for any networking work.

**Enemies (05, in progress):** `AClockworksEnemyAIController`
(`Source/Clockworks/AI/`) is every enemy's brain: a C++ state machine
(Idle / Chase / Attack) over AI Perception sight, nearest visible player wins,
`MoveToActor` for pathing, attacks by activating `Ability.Attack.Melee`. It is
C++ rather than a Behavior Tree because the MCP tree toolsets are read-only
and the logic stays diffable; swap to a tree later if the visual editor is
wanted. `UClockworksEnemyMeleeAbility` (server-only) is the telegraphed lunge:
face the target once, windup, root-motion lunge with a live hitbox, recovery
with `State.MovementLocked`, then `Cooldown.Attack` via
`UClockworksAttackCooldownEffect`. `AClockworksEnemyCharacter` grants
`DefaultAbilities`, orients to movement and auto-possesses the AI controller.
Aggro is "am I on a player's screen" (the fixed camera lets the server
rebuild each view). Enemies carry `AttackRange`, `bAttackNeedsLineOfSight`,
`InitialAttackPower/DefensePower`; stationary ones (MoveSpeed 0) turn to track.
`UClockworksEnemyRangedAbility` + `AClockworksProjectile` (replicated bolt,
server-only hits, faction-gated, blocked by walls) are the shooter. Attack
abilities take windup / attack / recovery montages. The three enemies:
Wolver (`BP_Wolver`, bite lunge), Mechaknight (`BP_Mechaknight`, defense 6,
slow, borrows the knight's sword clips via a re-exported config), Gunpuppy
(`BP_Gunpuppy`, turret, line of sight, `BP_GunpuppyBolt`). All have idle,
move, attack and dying clips through `ABP_*`; `BP_TrainingDummy` has
AutoPossessAI disabled. Player side: hit flash + `HurtMontage`, death with
`DeathMontage` and respawn after `DeathRespawnSeconds`, directional run clips
in `ABP_Knight`. Verified: wolver two-player; Mechaknight and Gunpuppy in
single-player (defense applied, bolt fired and hit).
Heads: Spiral Knights heads are rigid pieces on `bone_helmet`, not part of
the skin, so `AClockworksCharacter` has `HelmetMesh` + `FaceMesh` and
`AClockworksEnemyCharacter` has `HeadMesh` (static-mesh components attached
to that bone; Blueprints assign the meshes and an override material).
Interchange bakes a rigid piece's rest position into the static mesh, so the
pieces inside a character export float a head-height too high when attached
to the bone; `Tools/SKImport/extract_rigid_nodes.py` re-exports them in
bone space instead (`_fixed\PlayerKnightHelmet.glb`, `PlayerKnightFace.glb`,
`MechaknightHead.glb`, imported under `Content/SK` with those names).
Player respawn uses `AdjustIfPossibleButAlwaysSpawn` so a body or another
player on the PlayerStart cannot block it.

**Keep this section current.** When a system exists, describe it here in a line
or two. This is the first thing you should read and the last thing you should
update.

---

## Hard rules

1. **Never create, edit, move, or delete anything under `Content/`.** Those are
   binary `.uasset` / `.umap` files — you can't read them and git can't merge
   them. Use the Unreal MCP editor tools, or tell me what to click.
2. **Never touch `Binaries/`, `Intermediate/`, `Saved/`, `DerivedDataCache/`.**
   All generated, all disposable.
3. **Never run `git add -A` or `git add .`.** Stage explicit paths only.
4. **Never commit, push, rebase, reset, stash, or checkout** unless I ask for it
   in that message.
5. **One thing per session.** No refactors, renames, or cleanups I didn't ask
   for, however obviously improvable the code is. Tell me instead.
6. **If a decision hasn't been made, ask me.** Don't pick a sensible default and
   carry on.
7. **I am new to Unreal.** Before telling me to do something in the editor, say
   what the thing is and where in the UI to find it. Assume I don't know the
   menus yet. Don't assume I know an acronym — expand it the first time.

---

## Multiplayer — read this before writing any gameplay

This is a co-op game. There's no networking code yet, but every gameplay system
must be **server-authoritative from the first line**. Retrofitting authority
onto a finished single-player game is a rewrite, not a refactor.

- The client never decides anything. It sends intent. The server decides. The
  server replicates the result.
- **State which machine runs a function** in a comment before you write its
  body. If you can't state it, the design isn't ready — stop and ask me.
- Guard state changes with `if (!HasAuthority()) return;`. Don't assume the
  caller checked.
- Server RPC for intent. Replicated property for state. Multicast RPC only for
  cosmetic things — a hit flash, a sound, a montage. Never gameplay consequences.
- Camera, input feel, UI, VFX and audio are **local**. Never replicate them.

**Definition of done:** a feature that works in single-player is not done. It's
done when it works in **two-player PIE** — Play → Number of Players `2`, Net
Mode `Play As Listen Server` — tested as both host and client. If you can't run
that yourself, say the change is untested in multiplayer rather than calling it
finished.

---

## Conventions

**C++ owns** gameplay logic, anything replicated, anything I'd want to read a
diff of.

**Blueprint owns** materials, Niagara, sounds, widgets, and thin child classes
whose only job is to assign assets and tuning values to a C++ parent.
Replication logic never lives in a Blueprint graph.

Asset prefixes: `BP_` blueprint · `SM_` static mesh · `SK_` skeletal mesh ·
`M_` material · `MI_` material instance · `T_` texture · `S_` sound ·
`BT_` behavior tree · `BB_` blackboard · `WBP_` widget · `DA_` data asset ·
`DT_` data table

C++ follows Epic conventions: `A` actors, `U` objects and components, `F`
structs, `E` enums, `I` interfaces. One class per file.

Units: **1 uu = 1 cm**.

---

## Working with the editor over MCP

The editor exposes MCP through the `ModelContextProtocol` and `AllToolsets`
plugins, started with `ModelContextProtocol.StartServer` in the editor console.

- `ModelContextProtocol.StartServer` must be run in the editor console **every
  time the editor is reopened**. The server does not persist across restarts;
  until it's run, there is no connection and every MCP call will fail.
- Launching the editor from a shell with
  `UnrealEditor.exe Clockworks.uproject -ExecCmds=ModelContextProtocol.StartServer`
  starts the server automatically; the endpoint answers while the level is
  still loading, so wait for `SceneTools.get_current_level` before using it.
  The MCP client session dies with the editor process; reconnect after a
  restart. Editor tools can create assets, Blueprints, set class defaults
  (instanced sub-objects: pass `{"refPath": "<class path>"}` to create one),
  place actors and close the editor window gracefully. They cannot trigger
  Live Coding or create AnimMontages; close, rebuild, relaunch instead.
- Before any MCP call that modifies a level or an asset, check with me that the
  editor is saved and the repo is committed. The plugin is experimental.
- After modifying anything, save the affected packages and **list what changed
  by asset path**, so I can review it even though the diff is binary.
- To save a newly spawned actor, use `AssetTools.save_assets` with an empty
  list (save all dirty packages). `SceneTools.save_actor` fails on an actor
  that has never been saved: this map uses One File Per Actor, so each placed
  actor is its own package under `Content/__ExternalActors__/`, and the tool
  can't find a package that isn't on disk yet. Check nothing unrelated is
  dirty first, then confirm the save with `git status`. The map file itself
  won't change.
- If an MCP call fails, stop and report it. Don't retry variations more than
  once — a half-applied editor change is worse than none.
- Live Coding doesn't cover header changes, new `UCLASS`/`USTRUCT` members, or
  new files. Say up front if a change needs a full rebuild; I'll close the
  editor first.

## Build commands

Run from the repo root in **cmd** (not PowerShell — `%CD%` is a cmd variable).
Adjust the engine path if Unreal is installed elsewhere.

**Regenerate project files** — after adding or removing any `.cpp` / `.h`:

```
"C:\Program Files\Epic Games\UE_5.8\Engine\Build\BatchFiles\Build.bat" -projectfiles -project="%CD%\Clockworks.uproject" -game -rocket -progress
```

**Build the editor target** — use this to check that code compiles:

```
"C:\Program Files\Epic Games\UE_5.8\Engine\Build\BatchFiles\Build.bat" ClockworksEditor Win64 Development -Project="%CD%\Clockworks.uproject" -WaitMutex
```

After any C++ change, run this and report the result. Don't call a change done
until it compiles.

**Useful console commands while testing:**

```
Net PktLag=150     simulate 150ms latency in PIE
Net PktLoss=2      simulate packet loss
stat net           replication bandwidth
stat fps           frame rate
```

---

## Not in scope

Don't build these, and don't suggest them unprompted:

Economy or currency · crafting · PvP · guilds, chat, friends lists · accounts,
login, or backend persistence · matchmaking beyond invite-only · more than one
tileset · anti-cheat beyond server authority · more than two players ·
levels, XP, or meta-progression · a dedicated server target.

If one of these seems genuinely necessary to solve something I've asked for, say
so and explain why — don't build it.

## What's mine, not yours

You may implement these. Don't redesign them: combat timing and game feel,
enemy tuning and difficulty, level layout and readability, art direction.

These are judgement calls I make by playing. If you think one is wrong, say so
once, in a sentence, then do what I asked.
