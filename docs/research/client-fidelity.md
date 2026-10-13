# Client fidelity: guesses replaced by the client's own behaviour

Each entry gives what changed, the old guess, the new behaviour, and the client class it was
read from (obfuscated name and what it does; see client-map.md). Paths are relative to
`com/threerings/projectx/` in the decompiled client unless they start with `tudey/`.
Everything here is our own TypeScript written from reading the client; no client code is
copied.

What the client cannot tell us: the game logic runs on the server, which is not in the
client jar. Where a rule is server-only the entry says so and the value stays a guess.

## 1. Damage and defence (src/game/combat.ts, src/game/depth.ts)

| What | Old guess | Client behaviour | From |
|---|---|---|---|
| Damage against defence | `a² / (a + d/2)` per type (equal attack and defence took a third off) | Per type: no defence of that type, full damage. Damage at or above the defence loses half the defence (`dam - def/2`, so equal values deal half). Below the defence: loses `0.5 + 0.19 * log10((def - dam)/15 + 1)` of itself, down to nothing. | `dungeon/util/DamageSummary`: static `t` (reduction fraction) and `u` (damage after defence); inner `a.a(defences, ...)` applies them per type |
| Unblockable damage | counted as normal damage, so normal defence met it | its own type; no defence ever meets it | `DamageSummary.DamageType.UNBLOCKABLE`; `DamageConfig.Unblockable` |
| Damage increases | plain products | An increase by m deals `(dam * m + dam)/2`: a +50% bonus adds 25% | `DamageSummary.w`, dispatched by `v` |
| Damage decreases | plain products | A decrease by m deals the damage that, against a defence equal to the original damage, does m times what the original does (a 30-step bisection to whole numbers, cached) | `DamageSummary.x` |
| Gear, level and family damage bonuses | multiplied in one after another, uncapped | Gear bonuses and capped level bonuses add into one pool, the target's tag bonuses (fam_slime ...) are added for that target, the sum is capped at +/-0.48 and goes through the increase/decrease above | `DamageSummary.a(String[] tags, ...)`, `aG` (pool), `f` (tag bonus), `ItemCodes.ItemValueKey.DAMAGE.capped` |
| Weapon level damage | in the same product as gear bonuses | The level tables' `RelativeDamageBonus` entries are `capped: false`: applied on their own through the game's increase (level 10 on a 1-star weapon, +100%, deals 1.5x) | `item/config/LevelConfig$RelativeDamageBonus.a(DamageSummary, depth, ...)` |
| Random spread | each hit x0.95 to 1.05 | none: the damage summary has no randomness (the server's rounding is unknown; we round) | `DamageSummary` |
| `DepthScaleConfig.ModifyDamage` | plain multiplier, default 1 | the game's increase/decrease, default multiplier 2. `Handgun Base` is `Default` at 0.55 (a decrease), `Bomb Base` 1.15 | `dungeon/config/DepthScaleConfig$ModifyDamage` |
| `LinearEntry`, `PowerEntry`, `Offset` depth scales | evaluated to 0 | linear or power (default 2) between the two points, clamped; Offset shifts the depth | `DepthScaleConfig$LinearEntry`, `$PowerEntry`, `$Offset` (`TwoPointEntry.j` clamps) |
| `DamageConfig.Optional` | ignored | applies its damage with its probability (default 0.5) | `dungeon/config/DamageConfig$Optional` |

## 2. Bonus values (src/game/bonus.ts, src/game/economy.ts)

| What | Old guess | Client behaviour | From |
|---|---|---|---|
| ItemBonus levels | tables read off a few configs (damage 0.1 a level, charge 0.05, speed 0.05, attack speed 0.02 to 0.2, tagged 0.05 to 0.25) | `ItemValueKey`: a named level is that many steps (LOW 1 to MAXIMUM 6) of DAMAGE 0.08, SPEED 0.04 (move and attack speed), CHARGE 0.08, HEALTH 40; negative when `positive` is false; CUSTOM takes the config's own amount (which a named level overrides) | `item/data/ItemCodes$ItemValueKey.value` |
| Caps | none | sums capped at six steps: damage +/-0.48, speed +/-0.24, charge +/-0.48 | `ItemValueKey.capped` |
| Charge time | `chargeTime * max(0.3, 1 - bonuses)` | `(int)(chargeTime * (1 - capped(weapon + gear + status)))` | `dungeon/data/actor/Dungeoneer.Rr` |
| Attack speed | `1 + bonuses` | status attack speed `* (1 + capped(weapon + gear))` | `Dungeoneer.QG` |
| Move speed | `1 + bonus`, charging x0.5, shielding `1 + defendingSpeed` (default -0.5) | status speed `* (1 + capped(gear + weapon))`; charging x weapon `chargingSpeed` (default 1), attacking x `attackingSpeed` (default 1), shielding x `(1 + defendingSpeed)` (default 0) | `Dungeoneer.getSpeed` |
| Level defence (`DefenseIncrease`) | percent of the item's defence | adds its amount to every damage type the item already defends (`d > 0 ? d + defense : 0`) | `LevelConfig$DefenseIncrease.aK` |
| Variant defence (`DefenseTypeBonus`) | its depth scale, else `amount` (5 a grade) | its depth scale, rounded up; `amount` is unused | `item/config/VariantConfig$DefenseTypeBonus.b` |
| Variant status resist | 5/10/15/25 by level | named levels LOW 10, MEDIUM 20, HIGH 30, MAXIMUM 40, shrinking with the resistance already held: `round(min(1, 1 - held/100) * value)`; CUSTOM its own | `dungeon/data/StatusCodes$StatusResist.resist`, `VariantConfig$StatusResist.ax` |
| `HealthBonus` | its `health`, 0 if left out | `health` defaults to 40; a named level is 40 a step; from `minDepth` | `LevelConfig$HealthBonus.fr` |

## 3. Knight health and heat (src/game/world.ts, src/game/economy.ts, src/ui/hud.ts)

| What | Old guess | Client behaviour | From |
|---|---|---|---|
| Knight health | 100, plus a quarter of gear health ("100 for the game's 400") | 200 (five pips of 40) plus gear health bonuses at face value | `client/L.c` (loadout panel: starting pips `(gear health + 200) / 40`), `dungeon/util/g.a(loadout, cm, depth)` |
| HUD pips | 10 health a pip | 40 health a pip | `ItemValueKey.HEALTH` |
| Heat per level | geometric steps from baseHeat summing to maxHeat; maxHeat for 1-star items taken as 2500 | an arithmetic series: level i+1 to i+2 costs `base + i * step`, `step = (2 * max / n - 2 * base) / (n - 1)` for n levels, thresholds truncated; level 10 at `base + 0.8 * max`. Class defaults baseHeat 5, maxHeat 2000 | `item/data/LevelItem.p` (step), `.a(base, step, level)` (cumulative), `.b` (progress) |
| Heat shared out | every heated item took the whole floor's heat | the floor's heat is split evenly between the equipped items that can still take heat | `dungeon/client/EndOfLevelWindow` (heat count: total / number of heatable items) |

Still ours: the real game stops an item's progress at a full bar until it is forged with
crystals (`item/config/ForgePropertyConfig`); here heat carries over and the item levels up by
itself.

## 4. Status conditions (src/game/status.ts, src/game/world.ts)

| What | Old guess | Client behaviour | From |
|---|---|---|---|
| Chance levels | LOW 0.1, MEDIUM 0.2, HIGH 0.35, VERY_HIGH 0.5, ULTRA 0.7, MAXIMUM 1 | LOW 0.05, MEDIUM 0.1, HIGH 0.25, VERY_HIGH 0.5, ULTRA 0.65, MAXIMUM 0.9; CUSTOM is the config's `chance` | `dungeon/data/StatusCodes$StatusChance` |
| Power levels | 0.2 to 1, unknown power 0.3 | MINOR 20, MODERATE 40, STRONG 60, DEADLY 80, ULTIMATE 100 (out of 100); CUSTOM is the config's `power` (default 0) | `StatusCodes$StatusPower` |
| Where chance and power come from | the reference's arguments only | the condition's own `statusChance`/`chance` and `statusPower`/`power` fields (arguments are applied to them first) | `dungeon/config/StatusConditionConfig$Default` |
| Difficulty | none | easy and hard map a chance onto their own level tables (easy one level down, hard one up, by interpolation between levels) and shift power by -20 / +20 (easy at least 10) | `dungeon/data/DungeonCodes$Difficulty` (`getModifiedStatusChance`, constructor arguments) |
| Durations | 4 to 8 s when left out | `minDuration` 1000, `maxDuration` 10000 ms by default; monsters x `monsterDurationMultiplier` | `StatusConditionConfig$Default` |
| Fire ticks | `signalInterval`, 1 s default | `damageInterval`, 2000 ms by default | `StatusConditionConfig$Fire` |
| Poison | defence -5% to -25%, attack untouched | attack and defence -15% to -65%, healing -10% to -50% | `StatusConditionConfig$Poison` |
| Stun | speed -(minSpeedReduction or 0.3) - 0.3 x power, at most -80% | a Slow: speed -40% to -60% (`minSpeedReduction`, `maxSpeedReduction`); Slow itself modelled too | `StatusConditionConfig$Slow`, `$Stun` |
| Shock | a spasm every tick (0.35 to 0.6 s), 5 damage arcs within 2 units | a spasm every 1 to 4 s lasting 0.5 to 2 s; defence -15% to -45%; arcs within the arc shape (circle) times `arcExpand`, dealing `arcDamage` | `StatusConditionConfig$Shock` |
| Freeze | each hit took 0.6 s off | the victim is behind ice with health (`healthStart` to `healthEnd` depth scales); hits wear it down and break it | `StatusConditionConfig$Freeze` (fields; breaking is server code) |
| Sleep | held until hit | held until hit; after `healthRegenDelay` (4 s) regenerates every `healthRegenInterval` (2 s): monsters 10 to 30, knights 30 to 90 | `StatusConditionConfig$Sleep` |
| Curse damage | `damage.amount` or 20 | the damage scales, capped at `maxCurseDamage` 120 | `StatusConditionConfig$Curse` |

Still ours (server code): rolling the chance, how power picks a duration and strength
between each min and max (here: linearly, power / 100), how resistances cut chance and
duration (`resistFactor`, 2% a point), whether a hit wakes a sleeper, stacking and the
`cooloff` immunity.

## 5. Knockback, attacks, shield and dash (src/game/world.ts, src/game/data.ts)

| What | Old guess | Client behaviour | From |
|---|---|---|---|
| Knockback motion | a velocity of `3 + 6 x strength` decaying by e^-10t | an impulse: the configured distance over its duration, covered as `T * (2u - u^2)` (speed falls linearly to nothing); a new impulse merges an unfinished one (its remaining distance is added, and it lasts to the later end) | `dungeon/data/actor/Impulse` (step and merge `b`), `Dungeoneer.a(Impulse)`, `Monster.a(Impulse)` |
| Knockback strength | only the translation, scaled by guesses (bullets and bombs x0.25) | the DamageImpulse's translation, duration and level, unscaled; none when the attack gives no impulse (was 0.5) | `dungeon/config/ImpulseConfig$DamageImpulse` (`translation`, `duration`, `level`) |
| Who an impulse moves | everyone | targets whose `impulseLevel` (default 1) the impulse's level reaches (turrets and heavy monsters have 20); inference from the field names, the check is server code | `DungeonActorConfig$Monster.impulseLevel`, `ImpulseConfig$DamageImpulse.level` |
| Impulses while held | kept | dropped while the actor cannot move (frozen, asleep, in a shock spasm) | `Dungeoneer`/`Monster` per-step move: no `canMove`, no impulse |
| Attack lunges | constant speed, from the fire phase, a 1-unit default lunge for swings without one | the attack's `impulseReceived` only, `delay` from the attack's start (divided by attack speed), over `duration` (divided by status speed when `speedModified`), on the same easing curve | `dungeon/util/i` (dungeoneer advancer: attack impulse) |
| Attack phases | until each animation ended (1.5 s cap), then `rearm` before the next attack | timers from the AttackConfig: fires `land / startSpeed` after the start, rearmed `rearm / fireSpeed` later, clears `clear / endSpeed` after that; all divided by attack speed; no extra cooldown | `dungeon/config/AttackConfig$Original` (`aC`, `Qh`, `Qg`, `Qf`) |
| Dash | 5 units in 0.3 s at constant speed, 2 s cooldown | the dodge impulse: 5 units over 625 ms (longer when slowed: 625 / status speed), easing out, along the movement direction or facing; cooldown `dodgeCooldown`, 8000 ms in Character/PC/Level | `dungeon/util/i` (dodge activity 286, inner impulse), `DungeonActorConfig$Dungeoneer.dodgeCooldown` |
| Shield after breaking | full again when `breakTime` ends | regenerates from empty after `breakTime` | `Dungeoneer.a(Shield, now)`: health = stored + elapsed since the regen start x max / regenTime |
| Shield bash | at 98% shield health, costs half | only at full shield health; costs `bashHealthPct` (default 0.5) | `dungeon/util/i.RY` (bash needs full health), `AttackConfig$ShieldBash.bashHealthPct` |

Still ours: a shield taking hits (its damage and the reduced knockback through it), the
dash's moment of immunity, and how much a hit's reaction interrupts are server code.

## 6. Monster and boss health, boss timings (src/game/world.ts, src/game/bosses.ts)

The client holds no boss code at all (see client-map.md); the bosses' numbers below come
from their own configs, read the way the client's config classes define them.

| What | Old guess | Now | From |
|---|---|---|---|
| Monster health | `health` read as a percent of the health scale (default 100%) | the depth-scaled `healthScale` when the config has one (its flat `health` is then ignored), else the flat `health`; times the difficulty's monster health scale (easy 0.8, hard 1.25) | `DungeonActorConfig$Monster` (health default 0, "ignored when healthScale is set"), `DungeonCodes$Difficulty` |
| Boss health | Health Base +40 times 3 (Snarbolax), 2.2 / 2.2 / 1 / 2.6 (Jelly stages), 1.2 (Twins), 2.5 / 3 (Vanaduke), 1 (mask) | each boss actor's own health: Snarbolax Health Base +40, Royal Jelly v2 stages +30 and +20, Twins +10, Vanaduke 15000, his mask 5000 | actor.dat boss configs |
| Snarbolax stun | 6 s | 8 s: the bell runs its handler's ApplyStatus "Stun 3" at ULTIMATE power, maxDuration 8000 ms | actor.dat, status_condition.dat |
| Twins exposed | 5 s | 7 s ("Monster Attacks/Boss/Roarmulus Twins/Exposed": 7000 ms) | status_condition.dat |
| Surgebot respawn | 20 s | the scuttle pad's own "Delay", 45 s | the pad config |

Still guessed (nothing in the client or the configs): the bell's range (4.5), how long
Vanaduke's mask stays wet (5 s), the share of the Snarbolax's health one stun may take,
the Jelly's rage, and every director's sequencing. The configs' conditions, timers and
signal names that would decide them are stripped from the export.

## 7. Monster attack rate and floor traps

| What | Old guess | Now | From |
|---|---|---|---|
| Time between a monster's attacks | rearm + 0.6 to 1.7 s, random | 1 s between attack starts: `minAttackInterval` of the default target action (the monsters' own behaviour configs are stripped, so the class default is the best evidence) | `dungeon/config/TargetActionConfig$SimpleAttack` |
| Floor trap cycle | 3.2 s period, ours, B half a period later | the client's cycle table: down, warn and up times plus an offset, in units of the trap's `interval` (default 1000 ms); A is 3/1/4, B the same 4 intervals later, SLOW 7/1/8, QUICK 1/1/2, the CROSS and _SLOW variants, UP and DOWN fixed | `DungeonActorConfig$Trap$Cycle` |

The client does not run monster AI (monsters are interpolated from the server), and
behavior.dat ships empty; the AI in world.ts stays ours apart from the class defaults above
and in section 8.

## 8. Config defaults the export leaves out (src/game/data.ts)

The export drops fields left at their class default, so the defaults have to match the
client's classes. Wrong ones were:

| Field | Old | Client default | From |
|---|---|---|---|
| Attack `clear`, `rearm`, `land` | 400, 300, (none) | 833, 83, 350 ms | `dungeon/config/AttackConfig$Original` |
| Attack `impulseReceived.duration` | 150 ms | 0 (the impulse lasts at least 1 ms) | `dungeon/config/ImpulseConfig`, `data/actor/Impulse` |
| Monster `speed`, `targetedSpeed` | 2 | 6 | `tudey/config/ActorConfig$Mobile`, `DungeonActorConfig$Monster` |
| Monster `turnRate` | 180 rad/s (instant) | pi rad/s | `tudey/config/ActorConfig$Agent` |
| Monster `minReactPercent`, `reactTime`, `deathTime` | 0.25, 300, 1000 | 0, 567, 2467 | `DungeonActorConfig$Monster` |
| Weapon `targetingDist`, `targetingAngle` | 0, 0 (no auto-aim) | 3 units, 90 degrees | `item/config/ItemConfig$Weapon` |
| Weapon `attackingSpeed`, `chargingSpeed` | 0.5 | 1 | `ItemConfig$Weapon` |
| Shield `regenTime`, `hitTime`, `breakTime`, `defendingSpeed` | 6000, 3000, 8000, -0.5 | 5000, 2000, 7000, 0 | `ItemConfig$Shield` |
| Bullet `fuse`, `speed`, `offset`, `height` | 500, 0, (0.5, 0), 1 | 1100, 6, (0, 0), 0 | `DungeonActorConfig$Bullet`, `ActorConfig$Mobile` |
