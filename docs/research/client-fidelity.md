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

## 4. Config defaults the export leaves out (src/game/data.ts)

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
