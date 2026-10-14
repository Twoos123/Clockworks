# Monster AI

Spiral Knights runs its monster AI on the game server, which players never get. The client's
`config/behavior.dat` ships empty (63 bytes) and the actors' `behavior` fields are stripped
from `config/actor.dat`, so the behaviour each monster ran is lost. This port rebuilds it from
what survives. Everything here is our own TypeScript; no game or decompiled code is copied.

Code: `src/game/behavior.ts` (the engine), `src/game/monsterai.ts` (which behaviour each
monster runs), `src/game/world.ts` (`updateMonster`, `brainOf`: the world's side),
`src/game/collision.ts` (`getPath`). Survey: `npx tsx tools/audit/ai-survey.ts [filter]`
prints every monster's speeds, attacks and the behaviour it gets. Tests: `tests/behavior.test.ts`.

## Sources, in order of weight

1. **Clyde (open source, BSD)**, `clyde/core/src/main/java/com/threerings/tudey`: the server
   logic Spiral Knights' server builds on. `server/logic/AgentLogic` (turning, moving, speed),
   `BehaviorLogic` (Idle, Evaluating, BaseWander, Wander, WanderCollision, GridWander, Pathing,
   Patrol, Follow, Random, Scripted, Combined), `ScriptLogic` (Wait, Move, Rotate, Condition,
   ConditionalScript, Goto, Action, SetSpeed, ClearSpeed), `server/util/Pathfinder` (A* with
   partial paths, path length limits and swept-shape shortcuts), `config/BehaviorConfig`,
   `ScriptConfig`, `TargetConfig` for fields and defaults. These are reimplemented
   faithfully.
2. **The decompiled client** (`.decompiled/projectx-full.zip`), Spiral Knights' own config
   classes, fields and defaults only (the logic classes are not in the client):
   `dungeon/config/DungeonBehaviorConfig` (Targeting, Cascading, Attack, Dodging, RailRider),
   `TargetActionConfig` (SimpleAttack, PathAttack, TrackAttack, StraightAttack, ChargeAttack,
   Flee, RandomAction, Constant/Conditional/SwitchWeight), `DungeonScriptConfig` (Attack,
   Attacks, ChargeAttack, TargetChargeAttack, Noop), `DungeonActorConfig.Monster`
   (targetedSpeed, moveWhileAttacking, activateTime, reactTime, minReactPercent, size),
   `AttackConfig` (interruptable, monsterMovement, monsterRearmRotate), `DungeonConditionConfig`
   (Health, MonsterIsSize...). The logic behind these fields is our reconstruction from their
   names, types and defaults.
3. **The install's configs**: each monster's attack list, in its config order (the stripped
   behaviours referred to attacks by index), speeds, turn rate, react settings; behaviour
   scripts that survive as arguments (below).
4. **Bang! Howdy** (github.com/greyhavens/bang-game, `server/.../game/server/ai`), for
   patterns: per-unit logic objects ticked by the manager (`PieceLogic`), targets scored by a
   pluggable evaluator (`AILogic.TargetEvaluator`), and moving to a point between a minimum
   and maximum fire distance (`PieceLogic.getClosestPoint`). Our Targeting weights and
   TrackAttack band follow the same shape.
5. **The wiki** (wiki.spiralknights.com monster pages) for how each family fights.

## What survives of the behaviours

- `behavior.dat`: empty. The actors' `behavior` fields: stripped, but their **parameters**
  survive, so we know which actors had a behaviour argument (Gun Puppy, Jelly Cube, Zombie,
  Gremlin Base, Polyp, Mecha Knight, Chromalisk, Lizardman, Devilite Worker, the Twins,
  Vanaduke, Scuttlebot, Mimic...) but not its value.
- **Behaviour scripts survive as arguments.** Blastcores pass `implementation.behavior["Script"]`
  through a "Behavior Script" argument, and the presets' values (lists of `ScriptConfig$Wait`,
  `DungeonScriptConfig$Attack`, `ScriptConfig$Goto`) are in the export: 48 Blastcore monsters
  (Ghost in the Machine, the Crimson boss cores, BP Artillery, Healing, Laser, Rocket,
  Minelayer cores...), scripted knights and mission NPCs. `behaviorScript()` finds them down
  the Derived chain (the argument cannot be applied to the stripped field, so it is read from
  the reference). These run exactly as written. Before, Blastcores never attacked.
- Two named behaviour references survive (`Pumpkin King/Follow Player`, `Snipe, Walk`) and the
  flamethrower bullet's three (Snake, 90o, straight): names only.
- **The tiers' arguments to the behaviour survive too.** A base actor's parameter can point
  into its (stripped) behaviour, and the tier actors pass values to it that the export keeps:
  devilites' `["Behavior"]["Behavior"]["Aquire Range"]`, a greaver's
  `behavior["Target Action"].min_attack_interval`, a lichen colony's Size options setting
  `behavior["Max Attack Distance"]`. `behaviorArgs()` (monsterai.ts) collects them down the
  Derived chain, Choice options included; `tools/audit/ai-survey.ts` prints them per monster
  ("behaviour args"). The balance pass below uses every one that maps onto a field we model.

## The engine (src/game/behavior.ts)

| Piece | Behaviour | From |
|---|---|---|
| Agent | rotation turns toward a target rotation at the turn rate, "reached" when it gets there; moves along its rotation; `face(force)` snaps; speed is `targetedSpeed` while the behaviour has a target, else `speed`; SetSpeed overrides | Clyde `AgentLogic`, `ActorConfig.Agent`; projectx `Monster.targetedSpeed` (the targeted flag is ours to set: with a target) |
| Evaluating | evaluates every `evaluationInterval` (default constant 2 s) | Clyde `BehaviorLogic.Evaluating`, `BehaviorConfig.Evaluating` |
| Wander | every evaluation turns by `directionChange` (uniform -pi..pi), pauses pre/post rotation, walks; past `radius` (default 100) heads home; hitting a wall reflects its direction about the wall | Clyde `Wander`, `BaseWander` |
| GridWander | axis-aligned turns by `gridTurn` (REVERSE default) at walls | Clyde `GridWander` |
| Pathing | walks waypoints, turning to each; walks only within `moveFaceRange` (0 means 0.001) of facing the next | Clyde `Pathing` (we check the facing after the tick's turn, the same rule a tick earlier) |
| Follow | nearest target; within min..max (1..5) stops and faces, else paths (MAX_FOLLOW_PATH_LENGTH 8, partial) | Clyde `Follow` |
| Random, Combined | weighted pick per evaluation; two at once | Clyde |
| Scripted | runs ScriptConfig steps; Wait stops and waits; Rotate to direction ± variance (relative); Move paths to its target (maxPathLength 10); Condition waits for the condition; Goto jumps (its target step starts at once); Action runs once; projectx Attack starts the attack and the step lasts until it ends; Attacks picks one; Noop waits its delay | Clyde `ScriptLogic`; projectx `DungeonScriptConfig` (Attack lasting to the attack's end is ours) |
| Targeting | see below | projectx `DungeonBehaviorConfig.Targeting` fields; logic ours |
| Cascading | first cascade whose condition holds runs | projectx `Cascading` (`CascadeOption.condition` defaults to Always) |
| Dodging | inner behaviour, and when a threat enters its shape it turns by the entry's direction from the threat and uses the entry's attack, at most every `minDodgeInterval` (1000) | projectx `Dodging` (minDodgeInterval 1000, requiredTag faction_player, DodgeEntry direction + attack); threat = the knight's shots flying at it or its swing reaching it (ours) |
| Attack | uses its attack whenever it can | projectx `DungeonBehaviorConfig.Attack` (attack, stop true) |
| Pathfinder | straight when the swept shape is clear, else grid A* limited to `longest`, partial to the nearest explored cell, then shortcut | Clyde `Pathfinder.getPath` (SUBDIVISION 2 and the actor flag maps are not modelled: our grid is 1 unit; monsters push apart in `separate()`) |

### Targeting (ours, from the field names)

- **Acquire**: candidates are actors in the acquire region (the config's `Intersecting`
  region is stripped: a radius, 10 by default, per family below), plus with `acquireDamagers`
  ALWAYS (the default) anyone who has hurt it (`minHitToTarget` hits), plus its current target.
  WHEN_VICTIMLESS takes damagers only without a target; NEVER ignores them.
- **Weights**: `hitWeight` (10) x hits taken from it + `damageWeight` (10) x damage taken as a
  share of its health + `distanceWeight` (-1) x distance; the best wins. So by default the
  nearest, unless someone has been hitting it. Trojans weigh damage x30 (wiki: it faces "the
  knight who has dealt the most damage").
- **Release**: the `release` condition (default `ConditionConfig.Any` of nothing: never), plus
  our leash (18 units; bosses 60). A target that dies or is hidden (Shadow Cloak) is dropped.
- **Routine** without a target: Wander (radius 4 around its spawn, every 2 to 4 s; ours) for
  monsters that move, Idle for turrets.
- **Evaluation** every 0.5 s (ours; the configs' interval is stripped). Wall searches at most
  every 400 ms.

### Target actions

| Action | What it does | Field reading |
|---|---|---|
| SimpleAttack | stands, turns to the target at its turn rate, attacks once facing it (within 0.15 rad), one of `attacks` every `minAttackInterval` (1000 ms) | defaults from the client; facing rule ours (wiki: gun puppies "turn slowly", attacking from behind works) |
| PathAttack | paths to the target until the edge-to-edge gap is within `maxAttackDistance` (0.85), then attacks, snapping to face it when `attackFacesTarget` (true); `turnRate` and `turnSnap` while targeting | maxAttackDistance read as a gap in world units (ours) |
| TrackAttack | PathAttack that also backs away inside `minAttackDistance` | |
| StraightAttack | in sight and beyond attack distance: faces and runs straight at `attackSpeed` (0 = its untargeted `speed`) for up to `maxLength` (1000) ms, attacking in reach | 0 = `speed` is ours: the monsters these suit have `speed` above `targetedSpeed` (Trojan 4/2, Deadnaught 4/2, Quicksilver 10/3) |
| ChargeAttack | starts one of `attacks` (the wind-up loop), after `warmup` ms runs straight at `attackSpeed` for `maxLength` ms, and when the run ends (in reach, a wall, time) stops the loop and uses one of `chargeAttacks` | the attack lists match the configs' paired attacks: Deadnaught "Charge - Start, Loop" / "Charge - Finish", Tortodrone "Charge Loop" / "Charge Outro", Snarbolax "Charge - Start, Loop" / "Charge - End" |
| Flee | runs a few units away from the target, then faces it | ours |
| RandomAction | one action by weight each evaluation; ConditionalWeight gives `successWeight` or `failWeight` by its condition | client fields; conditions ours: target distance, own health, a wounded ally near |

## Attack roles

The stripped behaviours named attacks by index, and many "attacks" are movements or
postures. The old AI took "whichever attack reaches", so devilites dodged instead of
throwing, wolvers barked and hopped as attacks, and Blastcores never attacked. Now attacks
are sorted by name (`monsterai.ts`):

- **Dodges** (Dodging only): Dodge, Dive Away, Close Ground, Cower, Warp (Instant), Soldier Dodge.
- **Support** (chosen by name, never as the attack on the target): Heal, Raise, Promote,
  Overtime, Sip Coffee, Buff, Use Potion, Bark, Aura, Defend, Deflect, Spaz, Camoflage, Panic,
  Expose, Hide, Signal, Cloak, Self Destruct, the charge loops and finishes, Spawn, Swap,
  Call Minions...
- **Offensive**: the rest. Unresolved slots are never chosen. `MonsterDef.slots` keeps the
  config order so scripts and dodge entries index the right attack.

`FireActionConfig` "Base/Default" fire actions carrying an `Action` (a mender's
`Mender Heal (Single)` heal bomb, raise-dead actions) now run that action through the logic
from where the attacker stands; before they struck with nothing.

## Families (src/game/monsterai.ts)

| Family | Behaviour | Source |
|---|---|---|
| Blastcores (all presets) | their own surviving scripts | actor.dat "Behavior Script" arguments |
| Jellies (cubes, minis, rock, ice, blast, companion, sloom, toxilargo, creep cakes, void gel) | close in and tackle (Roundhouse/Punch); Impale (thorns under the knight) from a little way off; Spin close up. A big jelly (radius over 0.6: the Jelly Green Giant, radius 1, ShapeConfig.Circle's default) tackles and spins from 0.85 x radius / 0.4 (2.1), within its own reach, instead of a cube's 0.85 (ours) | wiki Jelly: "track your Knight's movements before lunging", thorns from tier 2 |
| Lichen colonies | tackle (reach: the colony size's "Max Attack Distance", 0.8 to 2); spin/impale close up; merging as before | actor.dat Size options; wiki Lichen |
| Oilers | dash across the floor (Oiler Dash, lunge 6) from 2 to 6 units, punch close up, place slicks | attack data |
| Quicksilver | punch; charge from 2+ | wiki Quicksilver |
| Glop drops | roll onto the knight (attack form) | wiki Drop |
| Polyps | turret, sees all round (no sight check), radius 9 | wiki Polyp |
| Gun/rocket/love puppies, plasma dog, red rover, howlitzers | turret with line of sight, turns slowly, fires once facing; anyone who shoots it is acquired | wiki Gun Puppy: "attacks when attacked first or when the player enters its line of sight" |
| Retrodes, cake bots | swipe close up every "Swing Interval" (4000/3000/2000 ms); eye beam from 1.5+ every "Beam Interval" (6000/6000/4000), only where "Eye Beam" is True (tiers 2 and 3) | actor.dat tier arguments; wiki Retrode |
| Mecha knights | sword charge, spin swing, self-shock (Spaz) as "Shock Chance" of its choices (0.333/0.222/0.111), at most every 5 s; the shield (Defend) against shots where "Shield" is True (tiers 2 and 3) | actor.dat tier arguments; wiki Mecha Knight |
| Lumbers, sentinels | slow approach and smash, 3 s between smashes | wiki Lumber: idle "for a few seconds before he strikes again" |
| Scuttlebots | short range three-bullet blast (band 0 to 3) | wiki Scuttlebot |
| Tortodrones | the plain one ("Acquire" Default) only answers being hurt (acquire radius 0); the hostile one ("Always Target") acquires; charge from afar, missiles from 3 to 10, punch and pound close up | actor.dat "Acquire"; wiki Tortodrone: "ignores Knights unless provoked" |
| Wolvers, alphas | bite (lunge), bark now and then; tier 3 dodges shots with Dodge (Y)/(X) and burrows (Warp) (50%); tier 2 alphas burrow (30%); tiers 1 and 2 otherwise do not dodge | wiki Wolver: "Tier 3: All Wolvers can burrow, and they can dodge projectiles"; tier 2 alphas burrow |
| Vog cubs | burrow attack (flames), bark | attack data (no bite) |
| Snarbolax (between its director's stuns) | tail-whip, charge from 4+, bark | attack data |
| Chromalisks | lick close up, spit (tier variants) from 1.5 to 5; dodge shots (back/forward/left/right) half the time | wiki Chromalisk: "can dodge projectiles" |
| Dust bunnies, scarabs | swarm and bite/tackle | wiki |
| Devilites | hold their spot and throw from 2 to 6 every "Attack Interval" (5000/4200/2600 ms; overtimers 5000/3500/2000); acquire within "Aquire Range" (6/9/12; overtimers 8/10/12); overtimers also swing close up; dive away from a knight on top of them; sidestep 70% of threats, at most every "Min Dodge Interval" (15000/4500/3000; overtimers 6000/3000/1500), not at all where "Dodges" is Off (tier 1) | actor.dat tier arguments; wiki Devilite: "stay in their spots trying to target you" |
| Pit bosses | keep away from knights within "Aquire Range" (12/14/18); work their staff every 6 s, picking Sip Coffee, Overtime and Promote by "Coffee Weight" (10/10/5), "Overtime Weight" (6/9/20) and "Promote Weight" (5) | actor.dat tier arguments; wiki: they do not attack directly |
| Yesmen | follow an ally | wiki |
| Trojans, slag guards | target whoever hurt them most; charge (StraightAttack) from 3+, slam close up, push back at their feet; shield deflect against swings and shots. Slag Guard (2), a deadnaught derivative, fights as a deadnaught | wiki Trojan |
| Deadnaughts, Almire knights, beast masters, Slag Guard (2) | spear charge every "Charge - Min Attack Interval" (7200/6400/6000 ms; the others 6000, Slag Guard (2) 6400) at "Charge - Movement Speed" (6/7/8), raise the dead; deflect | actor.dat tier arguments; wiki Deadnaught: "act on a timer" |
| Soldiers of Almire | lunge swipe from 3; side dodges | attack data |
| Gorgos | hover until a knight is in sight, then lunge and chomp | wiki Gorgo |
| Greavers | follow and swoop in from 4 units, every "Attack Interval" (the target action's minAttackInterval: 6000/5000/4000 ms) | actor.dat tier arguments; wiki Greaver |
| Silkwings | no attack: follow the wounded to touch them (the heal is their timer handler), else follow big monsters (2/3) or wander; dart back from shots (Silkwing 1, impulse -11) | wiki Silkwing: heals on touch, follows Lumbers and Trojans |
| Menders | a wounded ally within 10: go to it and heal (Heal Target/Renew, Omni); else flee knights; dodgy (60%) | wiki Gremlin: menders flee knights unless wounded monsters are near |
| Demos | throw bombs from 3 to 7, place bombs while moving; dodge back | wiki Gremlin: Demo |
| Scorchers | flames within 3, bullets beyond, flame wall; self-destruct below 25% health, potion below 40% | wiki Gremlin: Scorcher |
| Thwackers | hammer close up; tenderfoots throw beyond 2.5; ironclaws close the gap (Close Ground); all dodge back from shots (tenderfoots 25%, others 40%); potion below 40% | wiki Thwacker: "Thwackers dodge guns and projectile-like attacks" |
| Knockers | strike close up | wiki Knocker |
| Mortafires | shells from 3 to 9 every "Attack Interval" (6000/5000/4000 ms), aiming at "Turn Rate" (200/240/280 degrees a second) | actor.dat tier arguments |
| Stalkers, Herex | strike out of the cloak, dodge, re-cloak | attack data |
| Bombies | run at a knight and blow up on contact | wiki Bombie |
| Zombies | swipe close up; grapple (leap, lunge 4) from 1.2 to 4; breath within 2.5 at tiers 2 and 3; their chains as the configs give them | wiki Zombie |
| Kats | bite (fly in); spit from 2 to 6 at tiers 2 and 3; black kats bite and spit every "Attack Interval" (4000/3500 ms), wander with "Pre-Rotation Pause" (2/1.5 s), aura (summon) every 8 s at most | actor.dat tier arguments; wiki Kat |
| Drones (shankles, wisps) | stay put and peek/flip on their own cycle; never target | wiki Shankle: "does not target or chase players" (their rails are a RailRider behaviour, not modelled) |
| Allies (companions, energy turrets) | their family behaviour against monsters within 9 of them; otherwise follow the knight (1.5 to 3 away) | ours |
| Anything else | from its data: speed 0 is a SimpleAttack turret; ranged only keeps a band; mixed melee/ranged picks by distance | ours |
| Bosses | directors as before (`bosses.ts`); between scripted phases the engine runs them with the director's attack pool | |

## Hit reactions (the "did not react" monsters)

The actor audit listed 41 monsters that did not flinch at a big hit. 34 are configured never to
react: `reactTime` 0 (drones, Vanaduke and his stages, the Swarm's core, the Pumpkin King)
or `minReactPercent` 0.98/1 with `reactTime` 0 (tortodrones in their shells). The other 7
(Ironscale Hunter, Beast Master) have no model in the install. Now a `reactTime` of 0 never
interrupts an attack either, and the audit expects a reaction only where the config allows one.

## Balance pass (October 2026): config values first, then the wiki

Each guess was checked against the configs' surviving behaviour arguments (above), then the
wiki's monster pages. The wiki gives almost no numbers for monster AI (no aggro radii,
ranges or cooldowns on the Jelly Cube, Gun Puppy, Zombie, Wolver, Devilite, Lumber, Trojan,
Chromalisk, Kat, Thwacker, Mecha Knight or Greaver pages), so it decided only what a page
states plainly.

| Decision | Value | Source |
|---|---|---|
| Devilite acquire radius | 6 / 9 / 12 by tier; overtimers 8 / 10 / 12 (was 10) | actor.dat "Aquire Range" |
| Devilite attack interval | 5000 / 4200 / 2600 ms; overtimers 5000 / 3500 / 2000 (was 1000) | actor.dat "Attack Interval" |
| Devilite dodging | none at tier 1 ("Dodges" Off); min dodge interval 15000 / 4500 / 3000 ms, overtimers 6000 / 3000 / 1500 (Layoafer 1: 1500, Blarful 3: 1500) (was always, 1000) | actor.dat "Dodges", "Min Dodge Interval". The wiki's "all devilites can dodge projectiles" is overruled by the configs for tier 1 |
| Pit boss | acquire 12 / 14 / 18; staff work by weight: coffee 10 / 10 / 5, overtime 6 / 9 / 20, promote 5 (was any, evenly) | actor.dat "Aquire Range", "Coffee Weight", "Overtime Weight", "Promote Weight" |
| Greaver swoop interval | 6000 / 5000 / 4000 ms (was 2000) | actor.dat "Attack Interval" (`behavior["Target Action"].min_attack_interval`) |
| Mortafire | shell every 6000 / 5000 / 4000 ms; aim turn rate 3.49 / 4.19 / 4.89 rad/s (was 1000 ms, the actor's 3.49) | actor.dat "Attack Interval", "Turn Rate" |
| Deadnaught charge | every 7200 / 6400 / 6000 ms at speed 6 / 7 / 8; Almire knights, beast masters, Vanaduke's deadnaughts 6000 at 8; Slag Guard (2) 6400 at 8 (was 2500 ms at the untargeted speed) | actor.dat "Charge - Min Attack Interval", "Charge - Movement Speed" |
| Slag Guard (2) | fights as a deadnaught (it derives from Deadnought (Base)); before, the Trojan branch gave it no attack | actor.dat derivation |
| Mecha knight shield | Defend against shots only where "Shield" is True: tiers 2 and 3, bodyguards, the old Mk II/III (was by name) | actor.dat "Shield" |
| Mecha knight malfunction | Spaz is "Shock Chance" of its choices (0.333 / 0.222 / 0.111; bodyguards 0.3 / 0.15 / 0.075), at most every 5 s (was 0.15 / 4.15 of choices) | actor.dat "Shock Chance"; the reading as a share of choices and the 5 s floor are ours (wiki: it "will stop whatever it was doing for a few moments") |
| Retrode / cake bot | eye beam only where "Eye Beam" is True (tiers 2 and 3); swipe every 4000 / 3000 / 2000 ms; beam every 6000 / 6000 / 4000 (was beam at every tier, 1000 ms) | actor.dat "Eye Beam", "Swing Interval", "Beam Interval" |
| Tortodrone acquisition | from "Acquire" (Default: only when hurt; Always Target: acquires) instead of the name | actor.dat "Acquire" |
| Lichen tackle reach | the colony size's "Max Attack Distance": 0.8 (1 core) rising to 2 (20+) (was 0.85 for all) | actor.dat Size options |
| Black kat | bite and spit every 4000 / 3500 ms; wander pre-rotation pause 2 / 1.5 s | actor.dat "Attack Interval", "Pre-Rotation Pause" |
| Wolver dodging | tier 3 dodges and burrows (50% of threats); tier 2 alphas burrow (30%); otherwise none (was 25% at tier 1, 50% from tier 2) | wiki Wolver: "Tier 3: All Wolvers can burrow, and they can dodge projectiles", tier 2 alphas burrow |
| Thwacker dodging | all thwackers dodge back from shots (tenderfoots 25%, others 40%) (was ironclaws and up only) | wiki Thwacker: "Thwackers dodge guns and projectile-like attacks" |
| Lumber smash interval | 3000 ms (was 1000) | wiki Lumber: idle "for a few seconds before he strikes again" |
| Leash (18; bosses 60), default acquire radius (10), evaluation interval (0.5 s), wander | unchanged | no config value survives and the wiki gives none; the devilites' 6 / 9 / 12 shows the scale the designers used |

Arguments that survive but are not used: Quicksilver "Charge-Up" (True only at tier 3: a
wind-up before the charge we do not model), Gorgo "Attack Interval" (the tiers pass only the
option names "Tier 1" to "Tier 3", the values were in the stripped behaviour), mecha knight
bodyguards' "Target Mode" Friend (escort missions), drones' "Grid Turn" and "Expose Attacks"
(their rails are not modelled), Dust Bunny / Scarab / Glop Drop "Tier" (a name only), Heart of
Ice "Min Attack Interval" and "Open Attack" (6000 / 5000 / 4000; that boss has no director).
Royal Jelly "Hvy Minion Interval" was already the jelly director's.

## Still ours

- The acquire radii, leashes, evaluation interval, wander radius and the distances and
  weights of every family not in the table above (the configs are stripped).
- Reading `maxAttackDistance` as an edge-to-edge gap, `attackSpeed` 0 as the untargeted speed,
  and the ScriptConfig Attack step lasting to the attack's end.
- What counts as a threat for Dodging, and the share of threats each family dodges.
- Actor Timer handlers whose Conditional lost its (server) condition run their action, except
  one that would freeze, sleep or stun the actor itself (Logic.strippedSelfHold): the ice
  cube's "freeze myself" each second would otherwise hold it frozen for good.
- RailRider (drones on rails), Patrol (needs patrol paths), camouflage, the Butt Stomp (party
  of two or more), chromalisks' camouflage activation and raise-dead targets are not modelled.
