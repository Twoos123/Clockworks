# Client map: which obfuscated class does what

A guide to the decompiled Spiral Knights client (`projectx-pcode.jar`, ProGuard names), for
finding the game's own rules. Descriptions are ours; no client code is reproduced. Paths are
relative to `com/threerings/projectx/` unless they start with `tudey/` (`com/threerings/tudey/`).
Studied under Grey Havens' permission (docs/permissions/grey-havens.md); the decompiled
output stays in `.decompiled/` outside the repository.

## Read this first

- **The client has almost no game logic.** Monster AI, behaviours, damage application, status
  rolls and ticks, boss scripts, drops and heat awards run on the server, which is not in the
  jar. The only server package is `dungeon/server/random` (prefab records and the trap enums,
  used by editor tools). Behaviour configs survive as data classes only; the methods that
  named their logic classes were stripped.
- **What the client does have:** the config classes with their field defaults (the export
  drops default-valued fields, so these defaults matter), the shared damage maths
  (`DamageSummary`), bonus tables (`ItemCodes`, `StatusCodes`, `DungeonCodes`), depth scales,
  and client-side prediction for the local knight and its projectiles.
- **Case collisions.** `.decompiled/pcode` was extracted on a case-insensitive file system, so
  for about 716 class pairs that differ only in case (`I`/`i`, `Y`/`y`) one file overwrote the
  other (for example `dungeon/client/a.java` holds class `A`). The full set is in
  `.decompiled/projectx-full.zip` (Vineflower straight from the jar to an archive); read
  entries with `unzip -p` (or extract with case-colliding names renamed). The archive holds
  only `com/threerings/projectx`; the obfuscated Clyde packages (`tudey`, `opengl`, `math`)
  come from running Vineflower on `projectx-pcode.jar` with `-only=com/threerings/tudey` and
  the like, into a scratch folder outside the repository.
- **Anchors.** Config class names (`$class` values in the .dat exports) and their field names
  survive obfuscation; so do enum constants, message keys (`m.*`), resource paths and the
  Clyde base classes (compare `clyde-web-upstream`).

## Damage, defence and bonuses

| Class | What it does |
|---|---|
| `dungeon/util/DamageSummary` | The damage maths, shared with the server. Static `t` (fraction a defence takes off), `u` (damage after defence), `v` (apply a damage factor), `w` (increase), `x` (decrease by bisection, cached). Instance: damage per flag group and type, defence per type, a general bonus pool (`aG`), tag bonuses (`f`), `a(tags, ...)` merges groups, applies the capped bonus, then the defences. Enums `DamageType` (with UNBLOCKABLE), `DamageLimiter` (SHARD 3/1000 ms, TORTOFIST 3/5000, RAY_OF_LIGHT 5/1000), `Performance` (hit-effect sizes) |
| `dungeon/util/g` | Gear totals for tooltips: an item's defence per type (config, then level, then variants), resists, health bonuses; evaluates at depth 30 |
| `dungeon/util/d`, `e`, `f`, `h` | Composite visitors that apply level and variant configs to a damage summary (`f`) or to defence values (`h`) |
| `dungeon/config/DamageConfig` | Damage config classes: Normal, Piercing, Elemental, Shadow, Unblockable, Depth*, DepthScale(Multi), TaggedBonus, Status, Compound, Optional (0.5), Action |
| `dungeon/config/DefenseConfig` | Defence config classes; `a(cm, type, depth, rarity)` evaluates one type, `ei(mask)` a status resist |
| `dungeon/config/DepthScaleConfig` | Depth scale tree: Linear (default root), Power (2), Segmented, Constant, Multiplier, Adder, Offset, DepthCap (30), MinValue, Difficulty, ModifyDamage (the game's damage factor, default 2), Rarity |
| `item/data/ItemCodes` | `ItemValueKey`: bonus step sizes (DAMAGE 0.08, SPEED 0.04, CHARGE 0.08, HEALTH 40, TAGGED 0.1), `value` (named level = steps) and `capped` (six steps); `ItemBonus` levels; item groups and slots |
| `item/config/LevelConfig` | Per-level and global gear modifiers: RelativeDamageBonus (capped into the pool, or uncapped), TaggedDamageBonus, DefenseIncrease (flat add to defended types), HealthBonus (40, minDepth), ChargeTimeReduction, AttackSpeedChange, SpeedChange, WeaponClass, Compound |
| `item/config/VariantConfig` | Unique variants: TaggedDamage, DefenseTypeBonus (depth scale, rounded up), StatusResist (named levels shrink with resist held), HealthBonus, speed and charge variants, WeaponClass |
| `item/config/ItemConfig` | Item classes; `Weapon` (chargeTime 2000, chargingSpeed 1, attackingSpeed 1, targeting 3 units / 90 degrees, maxChain, chainCooldown), `Shield` (regenTime 5000, hitTime 2000, breakTime 7000, defendingSpeed 0, bash), `Gear` (defence), tooltip bar maths |
| `client/L` | Loadout panel: totals and the starting health (200 + gear bonuses, 40 a pip) |

## Actors and prediction

| Class | What it does |
|---|---|
| `dungeon/config/DungeonActorConfig` | Every dungeon actor config with defaults: Dungeoneer (dodgeCooldown, impulseLevel 1), Monster (speed and targetedSpeed 6, reactTime 567, deathTime 2467, minReactPercent 0, impulseLevel 1, health 0 / healthScale), Bullet (fuse 1100), Bomb (2000), Orbital family, Laser, Trap (cycle table), ShadowPolyp timings, blocks, doors, generators, elevators, pickups |
| `dungeon/data/actor/Dungeoneer` | The knight's data: shield regeneration formula, attack speed `QG`, charge time `Rr`, move speed, dodge cooldown, impulse |
| `dungeon/data/actor/Monster`, `ZMonster` | Monster data: flags (targeted, camo), speed, impulse, shield health |
| `dungeon/data/actor/Impulse` | Knockback and dodge motion: `T * (2u - u^2)` over the duration; merging |
| `dungeon/data/actor/Bullet`, `Bomb`, `Orbital*`, `Laser`, `Trap`, `Block`, `Door`, `Pickup` | Projectile and object data; orbital angle maths |
| `tudey/util/b`, `j`, `a`, `k` | Actor, mobile (1/60 s substeps), active (activities with durations) and pawn advancers (upstream ActorAdvancer, MobileAdvancer, ActiveAdvancer, PawnAdvancer) |
| `util/j` | Knight advancer: activity durations for emotes, lifts, throws; interacting on the action flag's press |
| `dungeon/data/DungeonInputFrame`, `data/ProjectXInputFrame` | The input frame: rotation, direction, flags, `_actionChanged` (when the action flag last changed), the weapon index (bits 56) and sprite skill (bits 384) |
| `dungeon/util/i` | Dungeoneer advancer, the knight's prediction: activities 274 flinch (500 ms, walking), 275 knockdown, 276 getting up (400), 277 shield recoil (411), 279 down, 280 dying (1290), 283 charge, 284 defend, 285, 286 dodge (625), 287 bash, 288 sprite skill (750), 289 incomplete charge, 290 charged, 291 cooldown (reload), 292-299 combo steps. `NO` reads the input frame (dodge 1024, sprite skills 384, action 4, defend 64, bash 2048, weapon index 56, auto-target 512); `RX` may attack, `OJ` + `OL` chain limit, `Sd`/`eN`/`eO` pick and start a combo step and the chain count, `bV`/`RY` shield and bash, `OK`/`Se` dodge, `Sc` auto-target, `Sg` facing; inner `a` (attack activity: land, rearm, clear over attack speed, the reload at the last shot's rearm, the lunge, holding into a charge), `b` (dodge impulse) |
| `dungeon/util/j`, `k`, `l`, `m` | Dungeoneer activities: down (279, until revived), dying (280, then dead 281), charging (283: release picks the charged attack or the next step), defending (284: ends when the button or `bV` fails) |
| `dungeon/util/c`, `p`, `q`, `r` | Bullet, orbital and orbital-bullet advancers |
| `dungeon/util/b` | Auto-targeting: the nearest valid monster whose shape meets the triangle from the knight to `targetingDist` at `targetingAngle / 2` either side of its facing; switch snapping by tag; the keep-target check |
| `dungeon/config/AttackConfig` | Attack timing (land 350, rearm 83, clear 833, speeds), impulseReceived, Chain, ShieldBash (bashHealthPct 0.5) |
| `dungeon/config/ImpulseConfig` | DamageImpulse (translation, duration, level), ItemImpulse (delay, speedModified) |
| `dungeon/config/FireActionConfig`, `TargetActionConfig` | Fire actions (delay, refractory, loops); target actions (SimpleAttack minAttackInterval 1000, PathAttack maxAttackDistance 0.85, ChargeAttack, StraightAttack, weighted choices) |
| `dungeon/config/DungeonActionConfig` | Dungeon actions: damage regions and targets, heals, statuses, impulses, table spawns, prespawned spawns, behaviour push/pop, party and floor actions |
| `dungeon/client/a/x` | Monster sprite: per hit, particle/fx_gethit_monster-scaled.dat by Performance, the damage number (fx_damagenumber.dat, styles Damage / Crap / Effective Damage / Heal) when `show_damage`, and a red-to-white colour flash over 150 ms (`a/y`) |
| `dungeon/client/a/i` (file `a/I`) | Dungeoneer sprite: activity animations (hurt_soft, hurt_hard, hurt_recover, shield_hit, shocked, sleeping, death, dead, dodge_fire, sprite_activate), the hit transient and HUD pulse, hearts per damage type (fx_damagenumber-pc.dat), the invulnerable blink (50 ms), the shield bubble's Power by quarter, charge models |
| `dungeon/client/a/s` | Charge activity sprite: charge_and_sound.dat (Length 2/3/5 by charge time), charge_complete_and_sound.dat past the charge time, the charge bar (character/charge_transformed.dat) |

## Input and camera

| Class | What it does |
|---|---|
| `tudey/a/a` | TudeySceneController (upstream, obfuscated): pick ray against the plane through the camera target gives the rotation; WASD absolute, MOVE_FORWARD relative directions (`aO`); input frames on change or every tick |
| `client/dt` | ProjectX scene controller: action flag 4 and `_actionChanged`, keyboard facing sticks (`k`: warps the pointer), TOGGLE_ZOOM (1.5 s QuadraticOut), the rotating arrow cursor |
| `dungeon/client/m` | Dungeon controller: DEFEND 64, AUTO_TARGET 512 (inverted by the auto_target preference), DODGE 1024, SHIELD_BASH 2048, sprite skills, weapon keys (next/previous 135 ms apart) |
| `client/Command` | Commands and default keys per control scheme (CUSTOM/MOUSE_MOVE: left button MOVE_FORWARD, Z/right ACTION, X DEFEND, Shift+Z bash, Shift+X dodge; WASD_MOVE: left ACTION, right DEFEND, Shift+left bash, Shift+right dodge) |
| `tudey/a/i` | TudeySceneView: the camera handler's target is the target sprite's translation plus the camera config's offset, every tick; camera configs by priority and zoom with eased transitions |
| `client/ProjectXPrefs` | zoom (0 or 1), auto_target (true), show_damage (true), show_charge_bar (true), show_damage_effects (true), noShake (false) |

## Behaviours and AI

| Class | What it does |
|---|---|
| `tudey/config/BehaviorConfig` | Upstream behaviours (Wander, GridWander, Patrol, Follow, Random, Scripted, Combined) with defaults; logic-class names stripped |
| `dungeon/config/DungeonBehaviorConfig` | Targeting (acquire, weights, target action, release), Cascading, Attack, Dodging (minDodgeInterval 1000), RailRider: fields only |
| (none) | No AI logic: monsters are interpolated from server snapshots; behavior.dat ships empty and actor.dat holds almost no behaviour configs |

## Status conditions

| Class | What it does |
|---|---|
| `dungeon/config/StatusConditionConfig` | Every condition class with defaults: Default (duration 1000-10000, chance, power, monsterDurationMultiplier), Slow/Stun, Poison, Fire (damageInterval 2000), Freeze (ice health), Shock (spasms, arcs, debuff), Curse (cap 120), Sleep (regeneration), Buff, Shield, Resist, DepthScaled |
| `dungeon/data/StatusCodes` | StatusChance and StatusPower levels, StatusResist levels and their shrinking rule |
| `dungeon/data/StatusCondition` | Condition bits (stun 1, poison 2, fire 4, freeze 8, shock 16, curse 32, sleep 256, ...) |
| `dungeon/data/StatusModifiers`, `ImmutableStatusModifiers`, `Status` | What the server sends: speed, attack speed, damage, defence, heal multipliers, can-move flags; condition expiry times |
| `dungeon/data/DungeonCodes` | Difficulty: monster health scale (0.8/1/1.25), status power shift, status chance tables, reward scale |

## Levels, heat, energy and drops

| Class | What it does |
|---|---|
| `item/data/LevelItem` | Item level and heat progress; the heat series (`p` step, `a` cumulative, `b` progress) |
| `item/config/ItemPropertyConfig`, `LevelTableConfig`, `ForgePropertyConfig` | baseHeat 5 / maxHeat 2000 defaults, level tables, forging (crystals, bonuses) |
| `dungeon/client/EndOfLevelWindow` (with `y`, `z`) | End-of-level report: the floor's heat shared evenly between heatable items |
| `dungeon/config/SpawnTableConfig` | Spawn and loot tables: crowns and heat by depth (gaussian between min and max, difficulty reward scale, denominations), items, tags |
| `dungeon/config/ItemDepthWeightConfig` | Material weights by depth |
| `dungeon/client/ai` | Revive window: Spark of Life or energy at the server's price |
| `dungeon/data/Heat`, `Loot`, `Health` | Per-player run records |

## Bosses

No boss code in the client. Only names: achievements (`data/Achievement`), mission keys
(`mission/data/MissionCodes`), exporter path lists (`tools/ProjectXExporterReplacers`),
`StatusCondition.JELLY`, the ShadowPolyp actor and the boss feed and token actions. Boss
behaviour has to come from the boss actors' configs (health, handlers, status references),
see client-fidelity.md section 6.

## Coverage

Read closely: damage and defence, depth scales, bonus values, level and variant configs,
status configs and codes, difficulty, actor and attack config defaults, impulses, the
dungeoneer advancer (attacks, dodge, shield, its input rules), the knight and monster sprites'
hit feedback, the scene controllers' input and camera, heat series and the end-of-level report.
Skimmed: projectile and orbital advancers, sprites, spawn tables, forging. Not looked at:
UI, chat, guilds, trading, PvP, missions beyond their keys. Not in the client at all: AI,
boss logic, damage application, status rolls, drops.
