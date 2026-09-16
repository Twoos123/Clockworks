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
Calibur data (2026-09-14, read from the game's `attack.xml` / `item.xml`
dumps in `D:\Dev\Tools\ThreeRingsSharp\ThreeRingsSharp\ConfigRefs`): swing
timings, per-swing lunge delay/length and a `Data.Knockback` multiplier are
the C++ defaults. **Charge attack:** hold after a swing → `State.Charging`
(hold clip loops, full walk speed, aim free), ready after `ChargeSeconds`
(3, aura flash via `MulticastChargeReadyFlash`), release → release clip,
spin clip with four hit samples behind/left/front/right (a target can be
hit more than once), one-tile step, locked recovery. Release early loses
it. Attack phases play raw `UAnimSequence` clips fitted to the phase
length through `AClockworksCharacter::PlaySlotAnimation` (dynamic montage
in `DefaultSlot`, multicast from the server, owner predicts) so no montage
assets are needed; the knight export carries `charge_sword_hold`,
`charge_sword_release`, `charge_sword_spin`. `WeaponMesh` on
`bone_weapon_r` holds the Calibur (`Content/SK/Weapons/Calibur`).
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
Aggro is "am I on a player's screen": each owning client measures its real
view frustum from the projection matrix and sends it to the server
(`AClockworksPlayerController::ServerSetViewExtents`), so window shape
does not matter; the camera's FOV/aspect is only the fallback. If
pathfinding fails (navigation mesh still building or missing) the brain
walks straight at the target and logs one warning. The navigation mesh
must be built (Build → Build Paths) and the level saved, or it rebuilds
on every editor launch and enemies stand still until it finishes. Enemies carry `AttackRange`, `bAttackNeedsLineOfSight`,
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

**Gear (08, in progress, 2026-09-14):** `UClockworksWeaponDefinition`
(`Source/Clockworks/Gear/`, a `UPrimaryDataAsset`, assets `DA_Weapon_*`) is
one weapon: name, toolbar icon, hand mesh + socket + offset, draw clip, the
attack ability class granted while drawn, optional equip GameplayEffects, and
the attack/charge move-speed multipliers. `AClockworksPlayerState` owns the
loadout: `WeaponSlots` and `ActiveWeaponIndex` are replicated, the server
alone equips (`EquipWeaponSlot`: clears the old weapon's ability spec and
effects, grants the new), the owning client only sends `ServerSelectWeapon`;
a switch is refused while attacking, dodging or dead. `OnLoadoutChanged`
fires on every machine (server directly, clients via OnRep).
`AClockworksCharacter` carries `DefaultLoadout` (set in
`BP_ClockworksCharacter`; the first slot is drawn on first possession),
`SwitchWeaponAction` (Space / mouse wheel, Axis1D, sign = direction, mapping
rows need a Pressed trigger) and `RefreshWeaponVisuals` (swaps `WeaponMesh`,
plays the draw clip, cosmetic, all machines); a DefaultAbilities entry that
matches a loadout weapon's ability is skipped so the sword is not granted
twice. `UClockworksPistolAbility` is the handgun (Spiral Knights Proto Gun
data: 3-shot clip, 0.287 s first-shot windup, 0.252 s per shot, 1.417 s
reload with `State.Reloading`, 12-damage bolts at 1500 cm/s for 750 cm,
0.4 knockback; charge 3.5 s, 35-damage charged bolt, recoil two thirds of a
tile, 0.717 s locked recovery). `AClockworksProjectile::InitProjectile` took
a knockback multiplier and a range. `UClockworksWeaponToolbar`
(`Source/Clockworks/UI/`) builds its own bottom-right slot row in C++ from
the local PlayerState's loadout; `AClockworksPlayerController` creates it
for local players (`WeaponToolbarClass`, defaults to the C++ class). SK
clips for the pistol and shield were added to the knight export and the
Proto Gun model plus toolbar icons imported (see
`Docs/SpiralKnightsAssetPipeline.md`). Assets: `Content/TopDown/Gear/`
`DA_Weapon_Calibur` (Calibur mesh, ready_sword draw clip, BP_GA_SwordAttack,
attack speed 0.25) and `DA_Weapon_ProtoGun` (ProtoGun mesh, ready_pistol,
BP_GA_PistolAttack, attack speed 0.5); `BP_GA_PistolAttack` (clips wired:
attack_pistol_start/fire/end, handgun_reload, charge_pistol_hold/release,
charge_pistol_fire as the follow-through); `BP_PistolBolt` (sphere ×0.2,
M_Glow); `IA_SwitchWeapon` (Axis1D) mapped in `IMC_Default` to SpaceBar and
MouseWheelAxis with Pressed triggers; `BP_ClockworksCharacter` DefaultLoadout
[Calibur, ProtoGun], DefaultAbilities [BP_GA_Dodge] only. Verified in PIE:
the first body draws slot 0 ("Loadout: ... drew slot 0 (DA_Weapon_Calibur)")
and the sword still swings. **Untested:** switching, the toolbar on screen,
every pistol number, two players.

**Shield and shield bash (08, code written 2026-09-14):** the shield is part
of the knight, not a toolbar weapon. `UClockworksShieldAbility` (hold RMB,
input ID Shield) owns `State.Shielding` while held; the attribute set routes
every hit into the Shield attribute while that tag is on the target (the
whole hit, even one that empties it; knockback still applies) and broadcasts
`OnBlocked` / `OnShieldBroken`. `AClockworksCharacter` carries the shield:
`ShieldMesh` on `bone_shield_away` (back) or `bone_shield` (arm) driven by the
replicated `bShieldRaised`, the raise / hold / hit clips (SK ready_shield,
blend_shield, shield_hit), half walk speed while up, server-side refill
(3 s after the last block, full in 6 s) and the break (`State.ShieldBroken`,
replicated, 8 s, cancels the shield ability; cleared on respawn).
**Demo gap list:** `Docs/DemoTodo.md` (2026-09-14) is the comprehensive list of
what a showable demo still needs, measured against
`Docs/SpiralKnightsReference.md`, and it carries the order of work.

**Demo scope, decided 2026-09-14.** Five questions answered, now settled:
bombs are being built as the third weapon class from the game's own data; the
Proto Gun gets the same accuracy pass the sword got; "multiple levels" means
the full Clockworks loop ending at the Core, compressed to one floor of each
kind (lobby, tunnels, terminal, themed stratum, boss, Core — eight depths, one
tileset); the demo gets both a main menu and an in-game gear overlay for
swapping weapons, armour and helmets; the game's own audio is used as
placeholder on the same terms as the models. **Single player for now** — phase
07 online sessions are deferred, not cut. The server-authoritative rule below
still applies to every new system; what is suspended is the two-player testing
gate. Keep a list of what was never two-player tested (today: the loadout
switch, the toolbar, the pistol numbers, the whole shield and bash kit).

**Audio (2026-09-14):** Spiral Knights sound effects and music imported to
`Content/SK/Audio` by the same script as the models (`SOUNDS` in
`Tools/SKImport/stage_and_import.py`). Sound is cosmetic, so it follows the
animation rule exactly: the server multicasts, the owning client plays its own
straight away to avoid a round trip. `AClockworksCharacter` has
`MulticastPlaySound` / `PlaySoundLocal`, hurt / death / charge-ready / shield
raise, lower, block and break sounds, a weapon-switch sound, a looping charge
hum (`SetChargeLoop` / `ShowChargeLoop`, an attached `UAudioComponent`), and
distance-driven footsteps (`TickFootsteps`, every machine, a step per
`FootstepDistance` of ground travel — the SK clips carry no animation notifies).
`AClockworksEnemyCharacter` has aggro, hurt and death sounds; the melee ability
plays its `AttackSound` at the *start of the windup* so it is a telegraph rather
than a report. Music is local and 2D on `AClockworksPlayerController`
(`MusicLoop`, stopped in `EndPlay`), never replicated.

**Enemy animations (2026-09-14):** enemies got the knight's raw-clip playback
(`AClockworksEnemyCharacter::PlaySlotAnimation` / `PlayPhaseAnimation` /
multicast) because montage assets cannot be created over MCP and the Spiral
Knights exports are plain sequences. `UClockworksEnemyMeleeAbility` now takes
`WindupAnim` / `AttackAnim` / `RecoveryAnim` and prefers them over the montages.
This fixed a real hole: the wolver's bite had **no windup animation at all**, so
the enemy the whole design asks you to read had no tell. Enemies also gained
`HurtAnim` (a flinch, skipped while attacking so it never wipes a telegraph) and
`AggroAnim`, played once by the AI controller when it takes a target after
having none. The charge-ready cue became a held aura (`SetChargeReady` /
`ShowChargeReady` / `MulticastSetChargeReady`, material `M_ChargeAura`) instead
of a quarter-second blink, matching Spiral Knights, and `ClearHitFlash` restores
it so being hit mid-charge does not lose it.

**Two animation slots (2026-09-14):** `ABP_Knight`'s locomotion goes into a
cached pose `Locomotion`, which feeds both a `LayeredBlendPerBone` base and an
`UpperBody` slot; the blend's branch filter is `Bip01-Spine1` depth 1 with mesh
space rotation, and the old full-body `DefaultSlot` sits after it feeding the
output. `AClockworksCharacter::PlaySlotAnimation` / `StopSlotAnimation` /
their multicasts now take a slot name (`FullBodySlotName` "DefaultSlot",
`UpperBodySlotName` "UpperBody"), and `ActiveSlotMontages` tracks one montage
per slot so the two never cancel each other. Full body: sword swings, the
dodge, the shield bash, death and hurt. Upper body: pistol shots, the reload,
the pistol charge, the shield raise/hold/hit and the weapon draw, so the legs
keep running while you shoot or block. Before this there was one slot and every
clip froze the legs; it also meant the shield's hold loop stomped the shield
bash's clips a moment after they started. The dodge now plays a raw clip
(`DodgeAnim`, SK dodge_fire) fitted to `DodgeSeconds` rather than a montage at
its own length, which was being cut off when the ability ended.

**Shield bubble (2026-09-14):** `ShieldBubbleMesh` on the capsule is the dome
Spiral Knights draws around a blocking knight, and its colour is the shield's
health: orange heavy damage, yellow moderate, green slight, blue full
(`ShieldBubbleColors`, blended across Shield/MaxShield; repeat an entry for a
hard step). A shattered shield collapses the dome to a flat red aura at the
feet for the whole eight seconds, and a cyan flash marks it coming back, both
from the wiki's description. The mesh is the engine sphere scaled from
`ShieldBubbleRadius` (the engine sphere is 100 cm across, so scale =
radius/50); the material is `M_ShieldBubble` (built over MCP: unlit,
translucent, two-sided, Fresnel × `BubbleColor` × `Brightness` into emissive,
Fresnel × `Opacity` into opacity), instanced once per body in BeginPlay so
only the colour parameter changes. `RefreshShieldBubble` runs on every machine
off replicated state (`bShieldRaised`, the Shield attribute, `State.ShieldBroken`),
so nothing is sent for it and other players see your dome too. No tick: it is
called from the raise, the attribute delegate and the tag event.

`UClockworksShieldBashAbility` (Shift+LMB, input ID ShieldBash): needs a full
shield, spends half, faces the movement direction (or the cursor), 0.5 s
windup, 500 cm launch over 0.6 s with a live hitbox, 6 damage, 1.5x knockback
and a 1.5 s stun (`UClockworksStunEffect`, `State.Stunned`, SetByCaller
`Data.Duration`), 0.4 s locked recovery. Enemies: the brain has a Stunned
state, melee and ranged attacks are blocked by the tag, the enemy character
cancels its abilities on stun and multicasts a frozen pose plus held flash.
The sword and pistol refuse to start while shielding. Assets (saved over
MCP): `IA_Shield` (RMB) and `IA_ShieldBash` (LMB chorded with
IA_ShiftModifier, Enhanced Input's implicit chord blocker keeps plain LMB /
RMB from firing while Shift is down) in `IMC_Default`; `BP_GA_Shield` and
`BP_GA_ShieldBash` (bash clips shieldbash_start/fire/end) in
`BP_ClockworksCharacter`'s DefaultAbilities next to the dodge; `ShieldMesh` =
the ShieldBuckler static mesh; `InitialMaxShield` / `InitialShield` 40; the
three shield clips on the character. Verified in PIE only that the knight
spawns with the loadout and the toolbar's two slots exist in the widget tree;
every input-driven part (raise, block, break, bash, stun) is untested. Known
limits: stunned enemies freeze mid-pose (no
reaction clip). The MCP Slate tools cannot give the play viewport keyboard
focus, so play testing is by hand. **Not built:** taking damage halving a
charge, a swing trail, equip effects on gear.

**Tools drive the editor headlessly (2026-09-14).** The editor's MCP automation
link is not always available, and it dropped mid-session once. Everything that
creates or edits assets in bulk is therefore an **editor Python script** run
through a commandlet, which needs no link and can be re-run at any time:

```
UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript -script="<abs path>"
```

`PythonScriptPlugin` is enabled in the uproject for this. Scripts live in
`Tools/SKImport/`: `mine_weapons.py` (reads the game's item.xml into
weapons.json), `generate_weapon_assets.py`, `verify_weapon_assets.py`,
`generate_monsters.py`, `verify_monsters.py`. Two gotchas worth knowing:
`unreal.log` at Display level is filtered out of commandlet output, so tools log
at warning level; and a commandlet's asset registry has not walked the project,
so `scan_paths_synchronous` comes first or every folder lists as empty.
Gameplay tags cannot be built from Python at all (the struct's name is read-only
and the tag library is not exposed), so classes that tools need to set a tag on
carry a `Set*ByName(FString)` UFUNCTION for the purpose.

**The weapon catalogue (2026-09-14).** All **351 weapons** of Spiral Knights
exist as `UClockworksWeaponDefinition` assets under
`Content/TopDown/Gear/Catalogue`, generated from the game's own `item.xml`
rather than authored. The weapon definition now carries the things that separate
two weapons in a line — `WeaponClass`, `DamageType`, `DamageMultiplier`,
`StatusEffect`/`Chance`/`Seconds`/`TickDamage` — and the attack abilities read
them off the drawn weapon (`ResolveDamageType`, `ResolveDamageMultiplier`,
`ApplyWeaponStatus`), so one ability serves a whole class. Per-line behaviour is
data too: `MaxBounces` is the Alchemer's ricochet, `BulletsPerShot` and
`SpreadAngleDegrees` the Autogun's cone, `ShotRecoilDistance` the Magnus's kick,
`ProjectileGrowthScale`/`Damage` the Pulsar's swelling pellet.

**Damage types and statuses (2026-09-14).** Four damage types resolved against
six monster families in `UClockworksAttributeSet::GetFamilyMultiplier` (weak
1.66, resistant 0.3). All **seven statuses** exist as
`UClockworksStatusEffects.h`: Fire burns through armour and cancels a charge,
Freeze plants the feet but leaves the target able to attack, Shock spasms and
interrupts, Poison cuts damage and blocks healing, Stun slows, Curse costs its
bearer health for each attack it uses, Sleep is unresponsive until woken. Their
own damage follows the original since 2026-09-15 (see "Knight weapon damage").
Break-on-hit and the no-knockback rule live in the attribute set. `UClockworksStatusDisplay` is one component on both the knight
and every monster that plays a status's sound and paints a coloured shell; it
deliberately does not use the mesh overlay, which the hit flash, the attack
telegraph and the stun pose already own.

**Monsters (2026-09-14).** Twelve, of which nine are generated:
`AClockworksEnemyCharacter` gained a **direct animation mode**
(`bUseDirectAnimation`) that drives the mesh in single-node playback and picks
its idle or movement loop from its own speed. A monster therefore needs no
Animation Blueprint, which is what made generating nine of them possible at all.
Snarbolax and Royal Jelly are the bosses. **None of them has been seen running:
the mesh rotation and offset are the knight's numbers applied to every monster.**

**The run (07, 2026-09-14).** `AClockworksGameState` owns a replicated `Depth`
and `FloorKindForDepth` decides what each one is: depth 0 a lobby, 4 a terminal,
7 the boss, 8 the Core, everything else tunnels. That one function is the shape
of the whole demo, compressed from Spiral Knights' thirty depths so that every
*kind* of floor appears once. `AClockworksElevator` opens when the last monster
falls, needs every living knight aboard for two seconds, then advances the depth
and shuts. `AClockworksFloorDirector` listens to the depth, wipes the old
monsters, moves the knights to the entrance and repopulates from a weighted
table gated by depth. `Lvl_Run` is the playable version; `Lvl_Bestiary` is every
monster in a row for checking them. **Build Paths once in `Lvl_Run`:** the
navigation could not be built headlessly.

**The HUD (2026-09-14, compiled, unseen).** Rebuilt from the user's Spiral Knights
screenshots; decisions and gaps in `Docs/DemoTodo.md` section A2.
`UClockworksPlayerHUD` draws the top-left (portrait with the depth on its rim,
name banner, heart badge and pips that flash purple/white on damage and cyan on
heal, flicker in i-frames and turn silver/gold past 30, shield row, an orb that
glows while charging, status icons) and the red edge glow on a hit, and hosts
the other corners as child widgets: `UClockworksMinimapPanel` (radar minimap,
objective from floor kind and elevator, activities as pictures),
`UClockworksSystemButtons` (wrench = pause menu, ? and F1 = How to Play,
loadouts = gear screen; the rest are pictures by decision),
`UClockworksConsumableBelt` (empty slots 4–7 and a vitapod slot),
`UClockworksWeaponWheel` (pops beside the knight on a switch; it replaced the
toolbar, which is no longer created) and `UClockworksTargetReadout` (the monster
nearest the cursor: health, attack type, weak and resistant). `ClockworksHUDArt`
holds the palette, font and a texture loader that falls back to flat colours.
Art: import group `HUD` in `stage_and_import.py`, then `fix_hud_textures.py`.

**Combo continuation (2026-09-14):** a press during a swing's recovery queues the
next swing, and a press within `ComboContinueSeconds` (0.566 s: the game's rearm
233 ms + 667 ms / End Speed 2.0) after a mid-combo swing ends carries on to the
next swing. Before this, clicking steadily a little slower than 0.35 s repeated
swing 1 forever. Untested in play and in two-player.

**Controls and weapons pass (2026-09-14, compiled and applied, unseen).** Ability buttons go
through `AClockworksCharacter::PressAbilityInput`: a press refused because the knight is busy is
kept for `InputBufferSeconds` (0.25 s) and retried every frame. The dodge may cut an attack's
recovery short (`UClockworksDodgeAbility::CanActivateAbility` refuses only while the attack holds
`State.RotationLocked` or `State.Charging`, and it cancels `Ability.Attack`); the shield still waits.
The gun keeps clicks made during its follow-through and reload, and pays the 0.287 s raise only when
idle (`ShotContinueSeconds`, 0.5 s). Spiral Knights' cursors are hardware cursors
(`Config/DefaultEngine.ini`, image files copied to `Content/SK/Cursors` by `install_cursors.py`).
Weapon definitions gained `StarRating`, `UpgradesFrom` (the game's `recipe.xml`, mined by
`mine_weapons.py`) and `MeshMaterial`. The generator picks each tier's own mesh out of a model set;
`fix_weapon_materials.py` gives 199 weapons their skin (17 unmatched); a dropped bomb shows its
weapon's model. The loadout screen is class, then line, then a tree of tiers.

**Every weapon moves, looks and sounds like itself (2026-09-14, compiled, unseen in play).**
`FClockworksAttackProfile` on the weapon definition (`Gear/ClockworksAttackProfile.h`) holds the
original's moves: per move the start/fire/end clips at their speeds, rearm, clear, lunge or recoil,
the moments that hit or spawn (with a bullet's heading and wobble), the move's sounds
(`FClockworksWeaponSound`: variants, gain, pitch range) and its bullet (`FClockworksBulletSpec`:
speed, range, hit radius and `FClockworksBulletLook`). The sword, pistol and bomb abilities copy it
over their Blueprint defaults each activation (`ApplyWeaponProfile`); a weapon with a profile plays
exactly its own sounds, silence included, and only a weapon without one falls back to the
Blueprint's. Bullets: the original draws them as particles, which do not export, so
`AClockworksProjectile` rebuilds each weapon's look from the particle data (core and additive glow
spheres pulsing at the particles' lifespan, a streak, a spinning model for the Magnus shell and a
few others, a muzzle flash, and a reliable-multicast impact with its sound); the look replicates
once with the bolt (`COND_InitialOnly`). Materials `M_BulletCore` / `M_BulletGlow`
(`make_bullet_materials.py`, which also sets `BP_PistolBolt`'s materials and spark and
`BP_GA_SwordAttack`'s `ProjectileClass`). Throwing swords (Winmillion, Spur, Brandish bursts,
Avenger...) spawn bullets on their swings and charges. Bombs play their weapon's drop, blast and dud
sounds (`DropSound`, `ImpactSound` / `ImpactExtraSound`). Character: `PlayWeaponSound` /
`PlayMoveSounds` / `MulticastPlaySoundPitched` (skips the predicting owner). Weapons show every
solid piece of their model (`ExtraMeshes`, `UClockworksWeaponDefinition::ShowModel`), with the set
member each weapon wears (`weapon_model_members.json`) and effect cards left out
(`weapon_model_pieces.json`, classified from the game's material configs). Rigged weapon models
import as static meshes in their rest pose (`fix_glb` `static_only`). Data pipeline:
`generate_attack_profiles.py` reads `weapon_base_attacks.json` (moves) and `weapon_fx.json`
(sounds, bullets, fire patterns), which `distill_weapon_fx.py` writes from the projectile and sound
research dumps; `stage_and_import.py` imports the sounds (`Audio/Weapons`, `S_W_*`) and bullet
models (`Projectiles`) that file names. The Mixer line (Celestial Orbitgun, Mixmaster, Diskguns)
fires an invisible core with pellets circling it (`OrbitCount` / `OrbitRadiusCm` /
`OrbitDegreesPerSecond` on the look; its hit radius reaches the ring). **Not built:** the
original's particle effects on weapons (sparkles, auras), Pulsar stage-two waves, Alchemer and
Driver split shots, homing, a Burst Bullet's ground trail.

**Charged attacks from the research (2026-09-14, compiled, unseen).** Every weapon has one charged
move; `distill_charged_attacks.py` boils `D:\Dev\SKAssets\_research\charged_attacks.json` (resolved
from item.xml and the attack configs for all 352 weapons) into `weapon_charged_attacks.json`, which
`generate_attack_profiles.py` uses for the charged move instead of the base's. It carries each hit's
own damage multiplier (`FClockworksAttackHit::DamageMultiplier`: Calibur 2.0, Proto Gun 2.4 per
bullet), rectangles (`bRectangle`, `BoxSizeCm`, swept as a box turned with the knight), blasts
(`bBlast`: a Troika slam's aftershock, a combo sword's ghost swings, spawned as a hidden-body
`AClockworksBomb` from `BP_GA_SwordAttack`'s `BlastClass`, silent below a 50 ms fuse), clip runs
(`FireSequence` of `FClockworksClipSegment`, played by `AClockworksCharacter::PlaySlotSequence`, each
clip holding its last frame) at the original's speed times the clip's import speed, and every lunge
(`Lunges`: backsteps, sideways, second surges). The pistol plays the charged fire clips before the
follow-through. Hits carry their own status (`StatusEffect`/`Chance`/`Seconds`/`TickDamage` on
`FClockworksAttackHit`, used by sword sweeps through `ActiveHitData`, bullets and blasts; the
weapon's status is the fallback, and bombs no longer all inherit the Blueprint's stun) and a sideways
shove (`KnockbackAngleDegrees`, sent as SetByCaller `Data.KnockbackAngle`, which turns the attribute
set's attacker-to-target knockback direction). **Not carried:** the normal combo's end clip over clear
rather than rearm, Sealed Sword's 25% seal-break spawn table. Status-only fire actions (a Faust's curse,
a Fang of Vog's fire) are folded into the move's hits.

**Special bullets (2026-09-14, compiled, unseen in play).** The charged-attack pass had carried every
move but not what a spawned bullet does after it leaves, so 193 weapons were wrong (the Brandish line fired
a glowing ball instead of its line of explosions). `FClockworksBulletSpec` now carries behaviour:
`ContactDamageMultiplier`, `bPassesThrough` (pierce, each monster once), `bAttachOnHit` /
`bDetonateAttachedOnHit` (Catalyzers), `LifeSeconds` (stationary bullets), a `Detonation` and a timed
`Pulse` (`FClockworksBulletBurst`: damage region, damage, knockback with negative = pull,
`bShoveAlongFlight`, status chance, `FClockworksBulletChild` children naming the profile's `SubBullets`
with count, fan, ricochet, scatter and damage), `bEndsAfterPulses`; the look gained `bHideBody` and a burst
column (`BurstColor` / width / height / seconds / sound, drawn by the hit spark stretched with
`SetSparkShape`). `AClockworksProjectile` runs it on the server (`InitProjectileSpec`, detonates on a
monster, a wall, range or life end via `LifeSpanExpired`, `OnPulse`, `ApplyAreaHit`, static
`SpawnChildren` capped at 6 generations, `MulticastBurst`); bombs pull and spawn children from their
weapon's `ChargedAttack.Bullet.Detonation` (`ChildBulletClass` = BP_PistolBolt). `Data.ShoveOnly` makes
a zero-damage shove. Data: `distill_bullet_behaviours.py` → `weapon_bullet_behaviours.json` (184
weapons), applied by `generate_attack_profiles.py`. Numbers not in the game files are the user's
(splits ricochet, Pulsar waves every 1 s, shards fan 360° and mine for 10 s, Tortofist 3 missiles within
2 tiles, Catalyzer stick-and-detonate, Brandish explosions 1 tile / 0.1 s apart) or marked INFERRED in
the script. The Mixer line's and the Warmaster bombs' damaging orbitals were built 2026-09-15 (below).

**Debug auto-fight.** `AClockworksCharacter::bDebugAutoFight` drives the knight through a 16-step test
loop every `DebugAutoFightStepSeconds`, and `bDebugInvulnerable` stops it taking damage. Both were left on
in `BP_ClockworksCharacter` and looked like phantom input; switched off 2026-09-14. Never leave them on.

**Knight before monsters (decided 2026-09-14).** Everything that belongs to the knight is imported
and working before the monster pass: gear first (shields, helmets, armour, trinkets), cosmetics after,
plus battle sprites and consumables. `Docs/KnightChecklist.md` is the audited checklist. Data so far:
`mine_gear.py` → `gear.json` (623 items); sample exports and the colour table in
`D:\Dev\SKAssets\_gear_samples`. Nothing of it is in the game yet.

**Gun poses hold (2026-09-14).** `AClockworksCharacter::PlaySlotAnimation` takes `bHoldLastFrame`
(the dynamic montage's auto blend-out is switched off) plus `MulticastPlaySlotAnimationHeld` and
`ReleaseHeldSlotAnimation` / `MulticastReleaseHeldSlotAnimation`. The pistol holds its windup and
fire clips: the fire clip is 0.067 s against a 0.252 s rearm, so without the hold the arms fell back
to the run between shots and the gun only came up after the last one. Released by the follow-
through, the reload, the charge or the end of the ability.

**Input log (2026-09-14).** `Source/Clockworks/Debug/ClockworksInputLog` writes every key and mouse
button (a Slate input preprocessor, registered by the local player controller, that only watches)
with what was under the cursor, then what the knight did with it (`PressAbilityInput` and the input
buffer: started, taken as the next move, refused with the knight's states, dropped) and menu keys.
Output Log lines start `Input:`. Console `Clockworks.LogInput` 0 off, 1 log and screen, 2 log only
(default since 2026-09-14: on screen it covered the play area).

**Single clicks were swallowed (fixed 2026-09-14, compiled pending).** Closing any menu (the start
screen included, so every run) set `FInputModeGameOnly`, whose default capture mode spends the first
mouse press on taking capture; with the cursor visible the viewport releases capture on every mouse up,
so no single click ever reached the game and only double-clicks attacked. `UClockworksMenuScreen::CloseMenu`
now returns to `FInputModeGameAndUI` (no lock, cursor kept visible while a button is held). Keyboard was
never affected.

**Knight gear (2026-09-15, compiled, unseen in play).** Every shield, helmet, armour and trinket of
the original (623) is a `UClockworksGearDefinition` (`DA_Gear_*` under `Content/TopDown/Gear/Knight`,
from `gear.json` by `generate_gear_assets.py`), with its model (60 armours imported onto the knight's
skeleton, one headless run each), icon, depth-scaled defense per damage type, level-10 heat numbers,
resistances, bonuses and shield numbers. `AClockworksPlayerState` owns the replicated gear slots (helmet,
armour, shield, two trinkets; server sets them, `RequestSetGear` is the intent) and
`RefreshGearStats` (server) turns them into MaxHealth (200 base + gear) and MaxShield at the party's depth.
The rules live in `Gear/ClockworksGearStats`: demo depth → original depth (1→4 … 8→29), per-type
defense with the players' log curve (knights only; monsters not yet), status resistance scaling chance,
duration and damage, damage and charge-time bonuses by weapon class (`ResolveDamageMultiplier`,
`ResolveChargeSeconds`), walk speed. The character shows the armour, helmet and shield on every machine and
takes its shield timings and blocking speed from the worn shield. `UClockworksGearScreen` is now the
original's Character window + Arsenal (user's layout choices): 4 weapon slots, 5 gear slots, a turning preview
knight (`AClockworksKnightPreview`, local scene capture), 5 session-only saved loadouts; the Arsenal shows one
category tab at a time with name search, sort menu, type/resistance filter and star toggles, the item card as a
hover tooltip, click to select, double-click or Equip to put on. HUD pips are 40 health. Full list, decisions and
gaps: `Docs/KnightChecklist.md`.

**Knight rules from the original's code (2026-09-15, compiled, unseen in play).** Research in
`D:\Dev\SKAssets\_research` (shield_bonus, face_hiding, rigid_armor, monsters). Defense: a hit above the defense
loses half of it, below it keeps a log share (`ClockworksGearStats::NetDamage`, config-value defense). Bonuses are
the original's fixed steps with its caps: damage and a bonus against the target's family pooled at ±48% (applied
per hit in the attribute set, weapon read off the hit's context, which bullets and bombs now carry), charge ±48%,
attack speed ±24% on every attack phase (`ResolveAttackSeconds`), walk speed ±24%. Each shield has its own bash
(kind, rank, damage curve; Tortodrone ring) and pushes touching monsters back when raised (`ImpulseLevel` on
monsters). The knight's own shield placement per bone is applied. Three hunting caps hide the face. Loose armour
pieces (pylon, tassels and glows that face the camera, scarves) ride their bones (`ArmorPieces`). Colorized gear
wears tinted skins (`SkinSwaps`, 558 textures baked by `bake_gear_skins.py`) through `M_GearSkin`, which shifts the
personal-colour magenta to blue by default.

**Monster retune (2026-09-15, in progress, unseen in play).** All 12 monsters carry the original's numbers by
the demo's depth (`HealthByDepth`, per-type `*DefenseByDepth` on `AClockworksEnemyCharacter`; per-type
`*DamageByDepth` on the attack, typed bolts through `InitProjectileDamageParts`), written by
`apply_monster_numbers.py` from `_research/monsters/monster_numbers.json`. Such a monster's family lives in its
defense numbers, so the attribute set skips the family chart for it and the targeting readout reads weak/resist
from its defense. Only the main attack is carried. Knight weapons were rescaled to match the same day (below).
**Bosses and the plain originals (2026-09-15, compiled, unseen in play).** Research:
`_research/bosses/boss_mechanics.md`.
- **Chromalisk:** a melee licker. Its lick is a box (`HitBoxSizeCm`, 3 x 0.75 tiles reaching 3.1) that opens 0.56 s
  into the strike (`HitDelaySeconds`), shoves nothing and pulls the lizard back as it licks (`RecoilDistance`).
- **Devilite:** a thrower. The ranged ability gained raw clips per phase, a projectile range and a recoil, so it
  throws its office supplies at 875 cm/s for 7 tiles with the real throw clips.
- **Beast bell** (`AClockworksBeastBell`, `BP_BeastBell`, `generate_beast_bell.py`): an ability-system prop a knight's
  hit rings. One hit stuns every wolver and the Snarbolax within 4.5 tiles (the user's choice), 3.5 s for a wolver and
  8 s for the boss, then 8 s of cooldown.
- **The Snarbolax** carries `State.Guarded` until something stuns it (`bGuardedUntilStunned`), so the bell is the whole
  fight, and shakes the stun off early once a third of its maximum health is dealt during it
  (`StunBreakHealthFraction`).
- **The Royal Jelly** is four Blueprints chained by `NextStageClass`, each handing over where it fell: stages 1 and 2 at
  full health, an untouchable 10 s transition with no attack, then a stage that rages 5 s on and 5 s off
  (`StageSeconds`, `RageGuardSeconds`/`RageOpenSeconds`; the user's numbers). Every fighting stage stands polyps around
  itself (3, 4 and 6, respawning from stage 2) and absorbs Royal Minis to heal; polyps keep producing minis
  (`MinionClass`, `AbsorbMinionClass`). The polyp and the mini are monsters in their own right, at half and an eighth
  of the jelly's health curve.

**Real floors are in the game (2026-09-15).** `D:\Dev\SKAssets\_floors` holds a manifest per archived Spiral Knights
floor (111 of them, 545,000 tiles) with every mesh instance in Unreal coordinates, per-cell walkability, prop collision
and classified markers; the placement rules were read out of the game's own classes and reproduce its transforms
exactly. All **111 are now `UClockworksFloorDefinition` assets** under `Content/TopDown/Floors` (360 MB, tracked), built
from **360 imported models** (`Content/SK/World/Floors`, 9,277 assets).

`AClockworksFloorBuilder` (`World/`) builds one: scenery as one instanced mesh per model (collision off), and what
actually stops anything as invisible boxes from the **cell grid**, exactly as the original works — the models are
dressing over a 100 cm grid, and a wall blocks because its cell says "wall". Three kinds of blocker by the game's own
masks: solid (wall cells and floors), feet-only (an `edge`, which shots fly over) and shots-only. It also stretches the
level's navigation bounds over the floor and lights it from the scene's own recorded ambient. Verified headlessly:
Mission Lobby, 351 models, 1,295 copies, 659 cells, 380 walkable, entrance where the original puts it, 0 problems.

Tools (`Tools/SKImport/`): `floor_model_names.py` is the one rule both other tools read for where a model lands;
`generate_floor_assets.py` turns manifests into assets (`SK_FLOORS=all`, self-pruning); `verify_floor_assets.py` checks
each against its manifest; `make_floor_level.py` builds `Lvl_Floor`, the calibration map. `stage_and_import.py --groups
World/Floors` imports what the manifests name. **Gotcha:** two captures of one level (`scenesmain` and
`scenesmainarcade`) share a scene id and are *different layouts* — the folder is part of the asset name, or the
Snarbolax lair and all three Royal Jelly Palace floors overwrite each other.

**Known gaps:** the look is washed out (auto-exposure normalises whatever the lighting does; pinning it needs a
post-process volume and is an art-direction call). A navigation-mesh actor cannot be spawned from a script, so
`Lvl_Floor` needs opening once in the editor or monsters walk straight at their target. `EditorAssetLibrary.delete_asset`
reports success in a commandlet but leaves the file on disk.

**Interactive floor objects (2026-09-15, compiled, unplaced).** The floors carry 22,000 blocks, 15,000 breakables,
3,600 triggers, 1,200 gates, 692 switches, 1,700 respawn pads and 100 lift objects, and without them an imported floor
is a room with nothing to do in it. The user's decision: build them now, and to **the original's own signal system**
rather than hand-wired rules. `AClockworksFloorObject` is the base; the builder owns the signal bus (`RaiseSignal` /
`LowerSignal` / `SignalCount` / `OnSignal`, server only) and spawns objects from markers through `ObjectRules`
(category + a piece of the config name -> class, most particular rule wins). `AClockworksFloorDoor` is the iron gate
(counts signals, or waits for the room to clear; blocks feet and shots while shut). `AClockworksFloorSwitch` is the
button, lever, pressure plate and party platform (one-time, toggle, timed; a lever is struck, the rest are stood on).
`AClockworksFloorBlock` is solid, breakable, explosive (reusing `AClockworksProjectile::ApplyAreaHit`, now public),
treasure or phase. Each reads its behaviour out of the config name the original gives it. **Not done:** no `ObjectRules`
are set yet, so nothing is placed; the wiring itself (which trigger feeds which gate) is *not* in the manifests and
needs extracting from the scene archive.

**Testing without a person at the keyboard (2026-09-15).** `Source/Clockworks/Debug/ClockworksAutomation.cpp` adds
console commands that drive the game headlessly: `Clockworks.After <seconds> <command>` (because `-ExecCmds` runs
everything at startup at once), `Clockworks.CloseMenus`, `Clockworks.Teleport`, `Clockworks.Press`, `Clockworks.Spawn`
and `Clockworks.Report` (one greppable line). With `-game -RenderOffScreen` and `Shot`, the game photographs itself, so
the long "compiled, unseen in play" list can finally be looked at. `Clockworks.Press` goes through the real input path,
so no OS-level input is involved. Full recipe and its traps: the `headless-game-screenshots` memory.

**Knight weapon damage from the original (2026-09-15, compiled and applied, unseen in play).** Every hit, bullet,
burst and sub-bullet of the 351 weapons carries its own damage by the demo's depth (`DamageByDepth` on
`FClockworksAttackHit`, `FClockworksBulletSpec` and `FClockworksBulletBurst`, read with `ClockworksAttackDepth::Read`
at `UClockworksGameplayAbility::CurrentDemoDepth`). Where it is set it replaces BaseDamage, every multiplier and
AttackPower; gear bonuses still apply in the attribute set. Written by `apply_weapon_damage.py`, which must run after
`generate_attack_profiles.py` (that rebuilds the profiles and clears it), from `_research/weapon_damage/weapon_damage.json`.
The user's decisions: bombs deal full damage across the whole blast (falloff removed); statuses use the original's
chance enum (5/10/25/50/65%), and Fire and Shock tick every 0.5 s for depth-scaled damage (`StatusTickDamageByDepth`
on hits and weapons, `StatusTickAt`). Piercing charged shots burst again where they end: an added `Detonation`,
its radius INFERRED. The Mixer line's orbiting pellets deal its damage (`OrbitDamageByDepth`,
`AClockworksProjectile::TickOrbitDamage`, a monster at most every 0.5 s, INFERRED) while its core passes monsters.
Letting go of a sword's charge early swings the weapon's `IncompleteCharge` move, as an opener with no rearm.

**Second weapon and status pass, same day.** Research in `_research/weapon_gaps` and `_research/status_damage`.
- **Dual-type weapons** (27) split each hit 50/50 between their two types. The share is INFERRED: no knight weapon
  names one. It travels as `FClockworksDamageTypes` on hits, bullets and bursts, resolved by
  `ResolveDamageTypes`/`SetSplitDamageMagnitudes`; bullets and bombs carry the split to their bursts and children.
- **Swords' charged bolts:** the Avenger, Divine Avenger, Faust and Gran Faust charges fire their real piercing bolt.
  `distill_weapon_fx.py` takes it from the research when a charge names only a marker.
- **Orbitals:**
  - The Mixer line's pellets turn at their real speed (the game's orbit speed is revolutions a second).
  - The Warmaster bombs' blast leaves rings of pellets, stationary sub-bullets, each pellet striking once
    (`bOrbitPelletHitsOnce`). The strike rate is INFERRED.
  - Catalyzer orbs blast with each weapon's own damage and last 20 s. That lifetime is INFERRED from the wiki.
- **Statuses** (the user's decisions). Each status stores its own depth-scaled damage in `Data.Damage`, with the
  tables on weapons and hits:
  - Fire burns every 2 s.
  - Shock has no tick. Each spasm, every 1–4 s, arcs elemental damage onto the victim and everything on its side
    within 2 tiles (`TryApplyStatus` schedules it).
  - A monster whose ice melts on its own takes the thaw damage; a hit breaks the ice for nothing. A knight pays the
    thaw only when a monster breaks it.
  - Curse costs its bearer the curse damage, at most 40, for each attack it uses
    (`UClockworksAttributeSet::HandleAbilityActivated`, bound by the monster and the player state).
  - The waking hit adds Sleep's wake damage; the old doubling is gone.
  - Not carried: a frozen knight's ice health, sleep regeneration, and the monster freeze lasting 3.5x.

**Four runs, one per boss (decided 2026-09-15).** The demo's single compressed eight-depth run is superseded. The
game gets **four separate runs**, one for each of the original's bosses, and later their Shadow Lair versions:
- the Snarbolax, the Royal Jelly, the Roarmulus Twins and Vanaduke;
- **at the original's own depths**, not compressed: each run covers its gate's full depth range;
- **chosen from the lobby**: four elevators in the Mission Lobby, rather than a menu;
- with **every monster those depths need**, not only the twelve already built;
- **Shadow Lairs after all four runs work**, as a harder pass over the same floors and bosses.

This is a large undertaking: two bosses (the Twins and Vanaduke) have no assets or numbers yet, most of the Construct
and Undead rosters are missing, and the runs need far more floors than the 111 already prepared. Research in
`_research/runs` (the four runs' depths, floors and monsters) and `_research/bosses2` (the two new bosses).

**A tile is 100 cm.** The sword's lunges already assumed it; the bomb had been
built at 200 and its blast was twice the radius the original's is.

**Starting a new session?** Read `Docs/Handoff.md` first. It carries the
immediate state, the two jobs waiting on the user, the tool scripts, and the
Unreal Python traps that cost real time to find.

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
