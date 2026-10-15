# Spiral Knights combat and knight controls: research notes

Compiled 2026-10-12 from public sources only, mostly the official community wiki (wiki.spiralknights.com). No client code was read or described. Each fact has its source URL inline. "Not stated" means none of the sources checked give a number. In those cases the gap is flagged so the implementation can choose a tuned value instead of inventing a "canonical" one.

Distance unit: the wiki measures in **squares/tiles/blocks**, the size of one floor tile. Breakable blocks are 1x1 tiles (https://wiki.spiralknights.com/Exploration).

---

## 1. Controls and key bindings

Two keyboard/mouse schemes plus gamepad, per https://wiki.spiralknights.com/Controls and https://wiki.spiralknights.com/Official:Controls:

| Action | "Mouse movement" scheme | "WASD" scheme | Gamepad |
|---|---|---|---|
| Move | Hold LMB, knight walks toward cursor | W/A/S/D | Left stick |
| Attack | RMB or Z | LMB | A / Button 0 |
| Shield (defend) | Hold X | Hold RMB | Hold right trigger |
| Shield bash (needs full shield bar) | LShift + X | LShift + LMB | B / Button 1 |
| Dash | LShift + Z | LShift + RMB | Button 4 |
| Strafe (keep facing) | Hold C | (not listed) | Hold left trigger |
| Switch weapon | Mouse wheel or Space | Mouse wheel or Space | Start / Back |
| Battle Sprite skills | 1, 2, 3 | 1, 2, 3 | X, Y, bumper |
| Quickslot items (capsules/vials) | 4, 5, 6, 7 | 4, 5, 6, 7 | D-pad |

- **Aiming (WASD scheme):** the knight aims automatically toward the mouse cursor (https://wiki.spiralknights.com/Official:Controls). This applies to all weapon types. Swords swing toward the cursor, guns fire toward it, and bombs are dropped at the knight's feet (see section 5).
- **Auto-target:** the game has auto-targeting, which snaps attacks onto monsters. Guides say holding Left Shift disables it for precise aiming between monsters (https://wiki.spiralknights.com/Gunslinger_Guide, https://wiki.spiralknights.com/Swordmaster_Guide). A keybinding list gives "Toggle Auto Target – Left Ctrl" and "Modifier – Left Shift" (https://www.magicgameworld.com/?p=98263). **Conflict:** that list also swaps the bash and dash bindings (Dash = LShift+X, Shield Bash = LShift+Z) compared with the wiki. The Dash page says the default is Shift+RMB (https://wiki.spiralknights.com/Dash). Shift is a modifier key, and its meaning varies by binding set.
- **Weapon slots:** 2 by default, up to 4 with temporary upgrades (250 energy, 30 days each) (https://wiki.spiralknights.com/Usable, https://wiki.spiralknights.com/Arsenal). The wheel cycles Prev/Next, and "Weapon 1–4" direct-select binds exist but are unbound by default (https://www.magicgameworld.com/?p=98263).
- **Items:** walk over a pickup to put it on the belt. Press 4–7 to use a capsule. A vial is readied with 4–7, then thrown with the Attack key in the facing direction. Each belt slot holds up to 3 of one item type. Being hit while using a capsule cancels it, and the capsule is not consumed. Being hit while readying a vial may break it (https://wiki.spiralknights.com/Pickup).
- **Other default keys:** Map = B, Arsenal = U, Forge = I, Mission = M, Loadouts = L, Character = P, Chat = Enter, Reply = R, Toggle windows = Tab, Help = F1, plus quick commands /attack /come /fallback /follow /helpme /ready on numpad (https://www.magicgameworld.com/?p=98263). The HUD page says Q (or a lock icon) locks the HUD in the Clockworks (https://wiki.spiralknights.com/HUD).
- **Interact and emotes:** none of the sources list a dedicated interact key or emote bindings. Pickups and crowns are collected by walking over them (https://wiki.spiralknights.com/Crowns). Switches and buttons are hit or stood on (section 9), so a generic "use" key does not appear to be central to gameplay.
- Rebinding is under Esc > Options > Controls (https://wiki.spiralknights.com/Controls).

## 2. Knight movement and stats

- **Health units:** health is shown as **pips/bars**. The display turns silver above 30 pips and gold above 60 (https://wiki.spiralknights.com/Health). The HUD wording is "red to silver and finally gold", with a percentage readout (https://wiki.spiralknights.com/HUD). **One health bar = 40 HP.** Damage is drawn in quarter-bar segments of about 10 HP, rounded up (https://wiki.spiralknights.com/Damage). Lost health briefly shows as purple pips, then becomes empty outlines (https://wiki.spiralknights.com/Health).
- **Base health:** no source found states a knight's base pip count with no armour. Armour and helmets add pips: a 3★ item adds +2 at heat 1+ and +3 at heat 5+ (https://wiki.spiralknights.com/Health). Most helmets and armour gain +1 health at heat 5 (https://wiki.spiralknights.com/Heat). Trinkets (Heart Pendant and others), Vitapods (temporary, dungeon-only) and the Healthy Boost sprite perk (up to +6) also add health (https://wiki.spiralknights.com/Health). Tier 1 and 2 dungeons scale down higher-star gear (https://wiki.spiralknights.com/Clockworks). *Implementation suggestion: start at about 5 bars (200 HP) and let gear add bars. This is a tuning choice, not sourced.*
- **Healing:** hearts dropped in the dungeon, Health Capsules (3 bars), Super (6) and Ultra (12) (https://wiki.spiralknights.com/Pickup). Heart Generator pads heal while you stand on them, and blue pads also cure status (https://wiki.spiralknights.com/Exploration). Poison blocks all healing (https://wiki.spiralknights.com/Poison).
- **Movement speed:** no base value is published. Movement Speed Increase (MSI) has levels from −3 to +6, about **4% per level** (https://wiki.spiralknights.com/Movement_Speed). Some heavy shields carry "MSD: Low" (https://wiki.spiralknights.com/Shield).
- **Speed modifiers in combat:** shielding slows movement (https://wiki.spiralknights.com/Shieldbearer_Guide). Blaster and Pulsar users move at about half speed while firing (https://wiki.spiralknights.com/Blaster, https://wiki.spiralknights.com/Pulsar). Magnus and Autogun root the knight (https://wiki.spiralknights.com/Gunslinger_Guide). Bomb charging slows the knight by an amount that depends on the bomb (section 5). Troika charging is "slightly slower" (https://wiki.spiralknights.com/Troika).
- **Attack speed and charge time stats:** ASI and CTR use the same +1..+6 scale. ASI is about 3.6–4% faster animations per level and does not affect projectile speed or bomb fuse. CTR is about 7.5% shorter charge per level. Every weapon gets CTR +1 at heat 5 and +1 more at heat 10 (https://wiki.spiralknights.com/Attack_Speed).
- **Damage bonus:** additive, about 7% per level (https://wiki.spiralknights.com/Damage).
- **Invincibility after a hit:** "the knight flickers briefly with invincibility frames" (https://wiki.spiralknights.com/Health). No duration is given. *Suggestion: about 0.5–1.0 s with a flicker.*
- **Knockback and stagger on the knight:** monster impacts briefly immobilize the knight, and shields do not prevent knockback (https://wiki.spiralknights.com/Shieldbearer_Guide). Lumber smashes push a shielding knight back, even through walls (https://wiki.spiralknights.com/Lumber).
- **Dash** (added 2013-05-22): up to 5 tiles in a straight line, in the movement direction or the facing direction if standing still. An obstacle hit after the 2nd tile stops it, and one hit before the 2nd tile deflects it. There is brief invulnerability at the **end** of the dash, but the knight can be hit during it. It is on a cooldown of unstated length, deals no damage, and does not jump traps (https://wiki.spiralknights.com/Dash).
- **Death:** at 0 HP the knight is defeated and cannot act until revived. Unrevived heat is lost (https://wiki.spiralknights.com/Health). Each knight gets **one free Emergency Revive per level**, shown by a light on the portrait. After that, a **Spark of Life** is needed (bought on the spot for **50 energy** if none are owned). A revive gives full HP plus a "Revive Blast", and no heat is lost. A party member can spend a Spark to revive a fallen ally by clicking their portrait. If the whole party is dead and nobody revives within **3 minutes**, everyone is ejected. If the survivors take the elevator, the dead are revived on the next floor (https://wiki.spiralknights.com/Revive).

## 3. Swords

**General combo rules** (https://wiki.spiralknights.com/Swordmaster_Guide):
- Each press of Attack performs the next swing. Holding Attack after a swing starts a **charge**, and releasing before the charge completes continues the combo as a normal swing.
- **Timing window:** "you can wait a fraction of a second between attacks and still continue the combo." No exact window is published. *Suggestion: about 0.3–0.5 s after a swing's recovery ends.*
- **Repositioning mid-combo:** the knight can move **up to one square in any direction between swings** without breaking the combo, but only once per two attacks (not both before and after the same swing). Turning to re-aim between swings is normal because the knight faces the cursor or auto-target.
- The **finisher** (last hit) does more damage, often hits a bigger area, and is usually the hit that **flinches** (interrupts) monsters. Landing a flinch while a monster shows its wind-up aura cancels that attack.
- **Shield cancel:** raising the shield right after a swing cuts its recovery, so the next attack can start sooner (https://wiki.spiralknights.com/Shieldbearer_Guide).
- **Shield charge:** with the shield up, hold Attack for at least about 0.5 s, then drop the shield to release a charge attack without swinging first (https://wiki.spiralknights.com/Shieldbearer_Guide).
- **Heavy swords** leave a moment after the 2nd swing when the knight cannot shield (https://wiki.spiralknights.com/Swordmaster_Guide).
- Charge times in seconds are **not published** for swords. Gran Faust is "very long" (https://wiki.spiralknights.com/Swordmaster_Guide). For scale, bombs are 2.2–3.18 s base (section 5).

**Attack speed column** (unitless, by style) from https://wiki.spiralknights.com/Swords: Cutter 127; Flourish/Spur 84; Calibur/Brandish/Wand 70; Troika/Sealed/Rocket 28. Read these as fast (Cutter), above normal (Flourish/Spur), normal (Calibur/Brandish), and slow (heavy).

| Family (line) | Basic combo | Forward movement per swing | Charge attack | Stratum-1 damage |
|---|---|---|---|---|
| **Calibur** (Calibur → … Leviathan Blade) | 3 swings. Only hit 3 knocks back | Not stated (in place) | 360° spin, hits up to 3x, high knockback | 30–35 / 30–35 / 36–43, charge 50–61 (https://wiki.spiralknights.com/Calibur); Leviathan 39–45 ×2, 47–54, charge 64–75 (https://wiki.spiralknights.com/Leviathan_Blade) |
| **Brandish** (Combuster, Glacius, Voltedge, Acheron, Obsidian Edge, Amputator) | Standard 3 hits | Not stated | Slight lunge into a forward slash, then 3 small explosions ahead. Elemental variants have a good status chance on the charge only | 30–35 / 30–35 / 36–43, charge 51–61, explosion 16–18 (https://wiki.spiralknights.com/Brandish, https://wiki.spiralknights.com/Swords) |
| **Fang of Vog** (5★, Brandish-type) | 3 strikes. Hit 2 reaches +0.5 block, hit 3 reaches +1 block. Fire chance on each hit. Slower than other medium swords | Not stated | Step forward, 360° flame ring, hits up to 4x. High chance to set the **user** on fire | e.g. vs Construct/Undead 39–43 ×2, 44–53, charge 66–82 (https://wiki.spiralknights.com/Fang_of_Vog) |
| **Cutter** (Striker, Vile/Dread Venom Striker, Hunting Blade, Wild Hunting Blade) | **5 swings, 10 hits**. Each main hit is followed about **0.25 s** later by a "shadow" hit at about half damage. Only the final hit flinches | **Every swing except the first thrusts forward 1 block** | Multi-slash flurry ending in a forward lunge. Lasts several seconds. Cannot be interrupted except by Shock | Main 22–24, shadow 10–12, charge 26–30 (https://wiki.spiralknights.com/Cutter, https://wiki.spiralknights.com/Wild_Hunting_Blade) |
| **Flourish** (Swift → Grand → Final Flourish; Barb/Thorn Blade variant) | 3 hits: a wide sweep, then two narrow lunging thrusts. Piercing | **Hit 1: 0. Hit 2: +1 square. Hit 3: +3 squares** | Lunging double thrust plus a slash, which can chain into another slash and a long lunge. Barbarous Thorn Blade fires a spike spread with no movement | Hits 1–2 35–44, hit 3 41–52 vs beasts/fiends (https://wiki.spiralknights.com/Flourish, https://wiki.spiralknights.com/Swordmaster_Guide) |
| **Spur** (Arc Razor, Winmillion) | 3 hits, wider than normal arc | **Hits 2 and 3 thrust forward** ("a fair distance", https://wiki.spiralknights.com/Swordmaster_Guide) | **Backstep**, then a slash plus a short projectile, hits up to 3x. Aim can be adjusted until the slash, and it can be shield-cancelled | 27–29 ×2, 36–43, charge 45–52, projectile 17–20 (https://wiki.spiralknights.com/Spur) |
| **Winmillion** (4★ Spur line) | 6 hits: 3 swings, each followed by an energy disk with progressively shorter range | Not stated | 360° half-block swing (**no movement**) plus a disk that hits up to 3x | 19–20 ×2, 24–25, disk 8–10, charge 51–62 (https://wiki.spiralknights.com/Winmillion) |
| **Troika** (Grintovec, Kamarin, Sudaruska, Triglav) heavy | **2 hits** over a 180° arc. Hit 1 is stationary with 1-square radius and fair knockback. Hit 2 **moves 1 square forward** and reaches 2 squares | Hit 1: 0. Hit 2: +1 | Lunge about **2.5 squares** forward, then smash about 1.5 squares further. The initial hit has no knockback, and a following flash does heavy knockback with a stun chance. Sudaruska has a recovery after the charge with no moving or shielding. Triglav can freeze | 42–51 / 50–61, charge 68–85 + 73–90 (https://wiki.spiralknights.com/Troika, https://wiki.spiralknights.com/Swordmaster_Guide) |
| **Avenger / Divine Avenger** (heavy) | 2 hits, long reach, average knockback | Not stated | Step back, then a wide swing releasing a sword-shaped beam that flies through monsters and over gaps, then detonates. Gran Faust variant: about 1/3 chance to curse the user | 44–53 / 53–65, charge 78–98, projectile 24–28 vs construct/undead (https://wiki.spiralknights.com/Avenger) |
| **Sealed Sword / Gran Faust** (heavy) | 2 hits | n/a | Projectile blades, very long charge | (https://wiki.spiralknights.com/Swordmaster_Guide) |
| **Warmaster Rocket Hammer** | 3 hits. Hit 2 can be a multi-hit dash, and its direction does not need to face the enemy | Hit 2 dashes | Overhead smash performed twice | (https://wiki.spiralknights.com/Swordmaster_Guide) |

Lunge summary for implementation: medium swords (Calibur/Brandish) are roughly in place. Spur moves forward on hits 2–3. Flourish moves 0/1/3 squares. Cutter moves 0 then +1 per swing. Troika moves 0/+1, and its charge covers about 2.5 squares. Swords that move the knight a lot can carry it into hazards (https://wiki.spiralknights.com/Swordmaster_Guide).

**Interruptibility:** taking damage does not stop the Wild Hunting Blade or Cutter charge, but Shock does (https://wiki.spiralknights.com/Wild_Hunting_Blade, https://wiki.spiralknights.com/Cutter). A Shock spasm interrupts the knight whatever it is doing, charges included (https://wiki.spiralknights.com/Shock). The sources do not clearly say whether ordinary hits cancel a normal swing or charge for every sword. They do say monster impacts "briefly immobilize" the knight (https://wiki.spiralknights.com/Shieldbearer_Guide).

## 4. Guns (handguns)

General rules:
- Ammo is unlimited. After a set number of shots the gun must **reload**, and the knight **cannot attack or shield** during the reload (https://wiki.spiralknights.com/Gun).
- **Ammo regenerates when you pause.** If you stop before firing the last round, the clip refills and the forced reload is skipped. The standard pattern is to fire all but one shot, pause, and repeat (https://wiki.spiralknights.com/Gunslinger_Guide). In practice, reloading is automatic when you stop firing, and a forced reload animation plays only when the clip empties. No reload duration is published.
- Every gun has a charge shot (hold Attack, release). ASI shortens reload recovery (https://wiki.spiralknights.com/Gunslinger_Guide).
- Some charge shots push the knight backward as recoil (below).

| Family | Clip | Basic shot | Charge shot | Movement | Stratum-1 dmg |
|---|---|---|---|---|---|
| **Blaster** | 3 | Medium-speed bullet, no recoil | Larger ball, detonates on contact, moderate knockback, 9-square range. Pushes the user back **2/3 square** | **~half speed while firing**, very mobile | 16–18 / charge 33–41 (https://wiki.spiralknights.com/Blaster) |
| **Pulsar** | 3 | Very slow pellet, 9-square range. **Expands at 4.5 squares**, then explodes on contact with knockback | One expanded pellet. Pushes back 2/3 square | ~half speed while firing | 12–15 small, 17–20 expanded, charge 36–46 (https://wiki.spiralknights.com/Pulsar) |
| **Catalyzer** | 3 | Slow blue shot, 9 squares, **1 damage**, sticks an orb to the target | Orb that detonates all stuck orbs (more orbs make a bigger blast). Charge is about **1.3 s**, the fastest in the game. Orbs expire after 20 s. Pushes back 2/3 square | — | charge 43–54, explosion 17–20 (https://wiki.spiralknights.com/Catalyzer, https://wiki.spiralknights.com/Gunslinger_Guide) |
| **Antigua** | **6** (largest) | Fast, long-range bullets. Reloads slightly faster | Fires a stream of all 6, then a 7th piercing "bird". Long animation lock | Very mobile except during the charge | 12–13 / charge 24–28 vs beast/fiend (https://wiki.spiralknights.com/Antigua, https://wiki.spiralknights.com/Gunslinger_Guide) |
| **Alchemer** | 2 | Slightly shorter range | Splits into 4 ricochets at 5★, longer range. Ricochets bounce left about 70–80° | — | (https://wiki.spiralknights.com/Gunslinger_Guide) |
| **Magnus** | 2 | Fast bullet. Recoil **1/3 square** per shot. Slow fire rate | Large piercing bullet, 10-square range, 1-square AoE | **Cannot move while shooting** | 26–33 / 48–62 (https://wiki.spiralknights.com/Magnus) |
| **Autogun** | 2 bursts | 6-bullet spread in a 30–40° cone | 15-bullet zig-zag | **Rooted, cannot turn** while firing | (https://wiki.spiralknights.com/Gunslinger_Guide) |
| **Tortofist** | 2 | Each shot propels the knight **forward** | 6 crystals that form a wall | — | (https://wiki.spiralknights.com/Gunslinger_Guide) |

Other styles listed but not researched: Shard Cannon (https://wiki.spiralknights.com/Gun). A typical gun range is **9 squares** (Blaster, Pulsar, Catalyzer).

### Disk guns and mixers (src/game/orbitals.ts)

The Slicer line (Slicer, Twicer, Thricer, Mandolin), the Overcharged Mixmaster and the
Celestial Orbitgun fire disks (DungeonActorConfig `OrbitalBullet`, charged ones
`CompoundOrbitalBullet`); the older Static and Fiery Diskguns and the "(OLD)" Mixmaster and
Orbitgun fire a mixer core (a plain `ActorConfig$Agent`) that carries two satellites
(`Orbital`, following it). Their fire actions are `MultiSpawnPrespawned` lists of
`SpawnPrespawned` / `SpawnTransformedPrespawned`, one actor each, so a twin shot is two disks.
How they move comes from the client's own prediction of these actors:

- A disk's centre flies straight out at `flightSpeed` (8 by default, 6 charged) for
  `outDuration` ms (870 diskgun, 990 mixer), then turns home and flies back to the shooter at
  the same speed, sitting on the shooter once there; it fizzles at `lifespan` (1700 by
  default; 2000 to 2260 charged). The disk orbits that centre at `orbitRadius`, `speed`
  revolutions a second, from `startingRotation` plus its aim; `alternateSpin` disks (MKI)
  alternate direction through a multi-spawn. A compound disk adds a second orbit.
- A disk hitting a monster or wall goes off (its Shutdown handler): outgoing damage, or the
  higher "Return Damage" once it has turned home. The wiki agrees: missed shots come back to
  the wielder, cannot hurt the shooter, and explode on impact
  (https://wiki.spiralknights.com/Mixmaster).
- A mixer core flies straight at its `speed` (8; the charged core uses ActorConfig Mobile's
  default 6), passing through monsters, and stops at walls. Its satellites circle it
  (`orbitRadius` 0.667, 1.5 revolutions a second, starting east and west) and go off on
  contact; when the core ends, they go off where they are. The core's timer is server data
  the export strips, so it flies for 990 ms (`AGENT_BULLET_FUSE`, the mixer disk's out time).

`npx tsx tools/audit/weapon-fire.ts` checks every weapon's attacks fire something the game
can fly (381 of 382; the exception is the PvP-only Blast Network, an arena `BlastBomb`).

## 5. Bombs

- Bombs have **only a charge attack**. Hold to charge, and on release the bomb is set down (at the knight's position, judging by the warnings about standing on your own vortex), then it explodes after a fuse. The "attack speed" stat of a bomb is its **fuse/detonation time**, not its charge time (https://wiki.spiralknights.com/Bomb, https://wiki.spiralknights.com/Bombing_Guide).
- **Charge times** (base, then with max CTR) (https://wiki.spiralknights.com/Bombing_Guide, appendix, last edited 2018):
  - Blast Bomb timing: **2.200 s** base (Low 2.04, Med 1.866, High 1.701, VH 1.545, Ultra 1.40, Max 1.225). This group also covers Dark Briar Barrage, Irontech Destroyer, Heavy Deconstructor and all Shard bombs.
  - Haze Bomb timing: **3.180 s** base (down to 1.755 at Max). This group also covers Graviton, Electron Vortex, Voltaic Tempest and Big Angry Bomb.
  - The release (placing) animation is about **0.20 s**, or about 0.17 s at high ASI. ASI does not change the fuse.
- **Movement while charging** varies by bomb. Nitronome is the fastest walker and has a short charge. Big Angry Bomb, Irontech Destroyer and all Vortex bombs are "significantly slower" (https://wiki.spiralknights.com/Bombing_Guide). The bomber cannot shield while attacking (https://wiki.spiralknights.com/Movement_Speed). The general bomb pages publish no exact percentages, radii or fuse seconds.
- Families (https://wiki.spiralknights.com/Bombing_Guide, https://wiki.spiralknights.com/Bomb):
  - **Blast** (Blast Bomb → Nitronome; Big Angry Bomb; Irontech Destroyer; Heavy Deconstructor): pure Normal damage, strong knockback, a blue smoke cloud. Nitronome has a large radius and the shortest fuse. BAB has the highest damage per blast, the strongest knockback, a stun chance and a long fuse.
  - **Dark Briar Barrage** (piercing): no knockback, can be chained.
  - **Haze / Vaporizer** (Ash of Agni = fire, Shivermist = freeze, Venom Veiler = poison, Voltaic Tempest = shock, Stagger Storm = stun, Torpor Tantrum = sleep): a small blast plus a lingering status cloud with little direct damage.
  - **Shard** (Deadly Shard, Crystal, Splinter, Sun Shards, Shocking Salt, Dark Matter): the initial blast fires shards that stick in the ground in a **ring** and explode, and the ring does more damage. At most 3 shards hit one enemy. Walls eat shards.
  - **Vortex** (Graviton, Electron = shock, Obsidian Crusher = poison, Celestial = fire): pulls enemies to the centre for a few seconds, then explodes and flings them. The final blast fails if too many enemies are inside or if they are shocked, frozen or asleep.
  - **Dark Retribution** (shadow, "orbiting" style): a small blast, then 4 orbs circling the area (2 clockwise, 2 counter-clockwise).
  - Spur/"Snarble" bombs: not covered by the sources checked.
- Self-damage and friendly fire are not mentioned. Bombs push enemies, so they can shove monsters into teammates (https://wiki.spiralknights.com/Bombing_Guide).

## 6. Shields

- **Omnidirectional bubble** while the defend key is held. A raised shield negates nearly all damage and statuses, including traps and breath attacks, but not fire already burning on the knight. It does **not** prevent knockback. Raising it slows movement (no number given) (https://wiki.spiralknights.com/Shieldbearer_Guide). An inactive or broken shield gives no passive protection (https://wiki.spiralknights.com/Shield).
- **Shield health by star rating:** ☆ 11, 1★ 22, 2★ 39, 3★ 56, 4–5★ 124, top tortoise/Omega 141. Each blocked hit drains shield HP according to its damage type against the shield's defences (https://wiki.spiralknights.com/Shield). Each defence unit absorbs about 1.9–2.1 damage. Example: a shield with 1.7 normal and 2.1 elemental defence reduces 20N + 20E (40 total) to 32.4 shield damage (https://wiki.spiralknights.com/Shieldbearer_Guide).
- **Feedback:** the dome colour runs blue → green → yellow → orange → red, and a shield meter sits top-left (https://wiki.spiralknights.com/Shieldbearer_Guide, https://wiki.spiralknights.com/HUD).
- **Regeneration:** regenerates after "a few seconds" without blocking (https://wiki.spiralknights.com/Shieldbearer_Guide). Full regeneration takes about 10–15 s if nothing is absorbed (https://wiki.spiralknights.com/Shield).
- **Break:** at 0 HP the shield **shatters for about 8 s**. It can still be raised during that time, and still slows the knight, but protects nothing. After that it flashes cyan and quickly refills if left alone (https://wiki.spiralknights.com/Shieldbearer_Guide).
- **Shield bump:** **at the moment of raising**, enemies right next to the knight are knocked away. Walking into enemies with the shield already up does nothing (https://wiki.spiralknights.com/Shieldbearer_Guide).
- **Shield bash** (2013-05-22): needs a **full** shield bar and costs **half** of it. The knight launches shield-first in the facing direction. It deals light damage, knockback and a minor stun. The knight is **not** invulnerable during it. Damage scales with shield star rating (stratum 1: about 6–7 at 0★ up to 21–22 at 5★), not with level. Tortodrone shields hit twice, the second time over a bigger radius (https://wiki.spiralknights.com/Shieldbearer_Guide, https://wiki.spiralknights.com/Dash).
- **Perfect block / parry:** none of the sources mention one.
- Shield stats protect only the shield itself, not the knight (https://wiki.spiralknights.com/Shieldbearer_Guide). Defences are Normal, Elemental, Piercing and Shadow, plus status resistances (https://wiki.spiralknights.com/Shield).

## 7. Damage types, statuses and scaling

**Types** (https://wiki.spiralknights.com/Damage): Normal (red), Piercing (yellow), Elemental (green), Shadow (purple). Monster telegraph circles use the same colours. A weapon can deal two types per hit, which counts as two simultaneous hits (for example 25N + 25E). All monsters resist Normal equally.

| Family | Deals | Weak to | Neutral | Strongly resists |
|---|---|---|---|---|
| Slime | Piercing | Shadow | Elemental | Piercing |
| Beast | Piercing | Piercing | Shadow | Elemental |
| Gremlin | Elemental | Shadow | Piercing | Elemental |
| Construct | Elemental | Elemental | Shadow | Piercing |
| Fiend | Shadow | Piercing | Elemental | Shadow |
| Undead | Shadow | Elemental | Piercing | Shadow |

(table from https://wiki.spiralknights.com/Damage, confirmed by https://wiki.spiralknights.com/Monster). So Piercing beats Beast and Fiend, Elemental beats Construct and Undead, and Shadow beats Slime and Gremlin. **Tier scaling:** in Tier 1, monster attacks are pure Normal (except on Elite). In Tier 2, attacks are Normal or Normal plus a second type. In Tier 3, pure non-Normal attacks appear (https://wiki.spiralknights.com/Damage). Weapon damage rises with depth and stratum. Compare Leviathan Blade: 39–45 in stratum 1, 94–95 in stratum 4, 193–203 in stratum 6 (https://wiki.spiralknights.com/Leviathan_Blade).

**Statuses** (durations are mostly unpublished):
- **Fire:** damage over time that ignores armour (only fire resistance helps) and "wears off after a few seconds". Burning knights may have offensive vials break. Cured by Remedy or water. Freeze extinguishes it, and fire and freeze cannot coexist (https://wiki.spiralknights.com/Fire, https://wiki.spiralknights.com/Status).
- **Freeze:** the victim cannot move or turn **but can still attack**. Any hit frees a monster. If a monster thaws on its own, it takes heavy "thaw" damage. Allies can free a frozen knight by hitting them (https://wiki.spiralknights.com/Freeze).
- **Shock:** periodic spasms that interrupt the victim (a knight's charge, or a monster's wind-up only). Spasm damage is elemental and also hits allies adjacent to the victim (about a 1-block radius) and breaks nearby blocks. A spasm while shielding deals no damage but drops the shield. Duration depends on strength (https://wiki.spiralknights.com/Shock, https://wiki.spiralknights.com/Status).
- **Poison:** no healing from hearts or capsules. Knights deal about **⅓ less** damage. Monsters deal about **45% less** and take more damage, and healers hurt them instead of healing (https://wiki.spiralknights.com/Poison).
- **Curse:** randomly locks some weapons and vials, and using a locked one damages you. Base duration is about **43 s**, from 22 to 59 s depending on resistance. Removed by Remedy. Monsters take damage whenever they attack or heal (https://wiki.spiralknights.com/Curse, https://wiki.spiralknights.com/Status).
- **Stun:** movement and attack speed are "reduced significantly". It does not reduce damage or turning, and it is very short (https://wiki.spiralknights.com/Stun, https://wiki.spiralknights.com/Status).
- **Sleep:** the victim is completely unresponsive, slowly regains HP and is immune to knockback. A flinch wakes a monster. Only vials and Torpor bombs inflict it, and Constructs are immune (https://wiki.spiralknights.com/Sleep, https://wiki.spiralknights.com/Status, https://wiki.spiralknights.com/Monster).

## 8. Monsters

Families and members (https://wiki.spiralknights.com/Monster):
- **Slime:** jellies, lichens, polyps, Royal Jelly.
- **Beast:** chromalisks, wolvers, Snarbolax.
- **Gremlin:** thwackers, menders, demos, knockers, mortafires.
- **Construct:** gun puppies, lumbers, retrodes, scuttlebots, mecha knights. Immune to sleep.
- **Fiend:** devilites, greavers, silkwings, trojans.
- **Undead:** zombies, kats, howlitzers, deadnaughts, phantoms. Mostly immune to curse.

Behaviours:
- **Jelly Cube:** tracks the knight, then **tackles** (lunges) for piercing damage. It always faces the screen, so the lunge direction is hard to read. In Tier 1 it backsteps after attacking. From Tier 2 it also raises **thorns** under the knight's feet (3 at once in Tier 3). Counters are shielding, knockback (a 3rd sword hit, heavy swords, charges, bumps) or strafing. Variants: Ice Cube (freezing tackle), Blast Cube (explodes on death, 1 tile in Tier 1), Rock Jelly, minis that swarm and break shields (https://wiki.spiralknights.com/Jelly_Cube).
- **Gun Puppy:** stationary turret that rotates slowly. Silent until attacked or until it has line of sight. Fires 1 bullet in Tier 1, 3 in Tier 2, and a 5-bullet sweeping spread in Tier 3 (higher tiers fire slower). At least one shot always aims at the knight. Weak from behind. Stagger or freeze stops it (https://wiki.spiralknights.com/Gun_Puppy).
- **Retrode:** zombie-like walker. Its **Swipe** is melee with a red aura, and it keeps rotating to track you during the wind-up. From Tier 2 it fires a straight **Beam** (green aura, no rotation, head rears back) that explodes along its path and stops at walls or gaps. A full sword combo knocks it down (https://wiki.spiralknights.com/Retrode).
- **Lumber:** slow-moving. Its one attack is a long-telegraphed arm smash in front of it, with a very high stun chance, normal plus elemental damage, and pushback even through a shield or walls. After a whiff it is harmless for a few seconds. Variants add freeze, fire, poison or shock (https://wiki.spiralknights.com/Lumber).
- **Scuttlebot:** small, quick, low-threat. Fires a 3-bullet elemental spread at very short range, then has a long recovery. Any hit cancels its attack (https://wiki.spiralknights.com/Scuttlebot).
- **Gremlin Thwacker:** axe swing and axe toss with stun. From Tier 2 it chains a second attack and gains a dash. In Tier 3 it gains a 360° spin and a back shield. Dodges projectiles, retreats to corners and uses health capsules when low, and flees and shields near death in Tier 3 (https://wiki.spiralknights.com/Thwacker).
- **General telegraph language:** monsters show a coloured **aura** during wind-up (red for Normal, green for Elemental, and so on). A flinch during the aura cancels the attack (https://wiki.spiralknights.com/Swordmaster_Guide, https://wiki.spiralknights.com/Damage, https://wiki.spiralknights.com/Retrode).
- **Aggro/leash:** no source gives radii. Gun puppies activate on line of sight or when attacked. Enemies often lose track of a knight after a dash (https://wiki.spiralknights.com/Gun_Puppy, https://wiki.spiralknights.com/Dash). *Suggestion: room-based activation, with monsters waking when the knight enters their room or line of sight.*
- **Health bars:** the HUD's targeting UI shows the current target's health, attack types and weaknesses, and hits flash the victim (https://wiki.spiralknights.com/HUD). The sources do not say whether floating bars appear over every monster.

## 9. Dungeon structure (the Clockworks)

- **Depths 0–29** per gate, split into **3 tiers × 2 strata**. Tier 1 is depths 0–7, Tier 2 is 8–17 and Tier 3 is 18–28/29. Each stratum has **3–5 floors** (https://wiki.spiralknights.com/Gate, https://wiki.spiralknights.com/Clockworks). Subtowns sit at depth 8 (Moorcroft Manor) and depth 18 (Emberlight).
- **Clockwork Terminals** are safe floors between strata (depths 4, 13, 23, 29). They have an Arsenal Station for gear swaps, 2 Heart Generators, and vendors (Basil for recipes, Kozma for the Supply Depot) (https://wiki.spiralknights.com/Clockwork_Terminal, https://wiki.spiralknights.com/Clockworks).
- **Level themes:** the level icon sets the layout type (Arena, Compound, Treasure Vault, Boss, and others). The background colour sets the status theme (fire, freeze, poison, shock, sleep). The icon colour sets the monster family (https://wiki.spiralknights.com/Gate).
- **Level completion:** each level ends at an **elevator**. The next level locks in once **all party members step onto the lift**, and heat is applied to gear at that moment (https://wiki.spiralknights.com/Gate, https://wiki.spiralknights.com/Heat). A prize wheel spins after a level (https://wiki.spiralknights.com/Clockworks). Older sources say descending cost **10 energy per floor** (https://www.giantbomb.com/wd/3030-34489). The current Energy page lists only **3 energy** per energy gate or danger room and says mist and crystal energy merged in 2013 (https://wiki.spiralknights.com/Energy). Treat elevator fees as version-dependent.
- **Party Button:** a large red button the whole party must stand on. It is "mandatory for progression" (https://wiki.spiralknights.com/Exploration). In an arena it locks the room and spawns waves.
- **Arenas:** 3 bouts. Each bout has **2 branches of 3 waves plus a final wave**. Clearing every living monster in a branch spawns that branch's next wave. The final wave spawns only when both branches are exhausted. There are no timers. Bout rewards are 6, 10 or 15 treasure boxes. Between bouts there are 4 heal panels, and the exit opens (https://wiki.spiralknights.com/Arena). The general pattern elsewhere is that gates or doors are lowered by buttons or switches (https://www.giantbomb.com/wd/3030-34489).
- **Objects** (https://wiki.spiralknights.com/Exploration):
  - **Blocks:** breakable blocks die to 1 hit, stone blocks to 3. Crystal blocks break their whole same-colour chain. Ghost blocks remove chains.
  - **Gold Key / Gold Door:** carry the key and set it down near the door.
  - **Barred doors:** opened by buttons or switches.
  - **Pressure pads:** opened by standing on them or by a statue.
  - **Switches:** yellow/purple ones toggle or are timed. Red/green ones are one-shot.
  - **Energy doors:** paid with energy.
  - **Heart Generators:** heal while you stand on them. Blue ones also cure status.
  - **Traps:** periodic status grates, spike traps (piercing), landmines, brambles, orbital chains, wheel launchers.
- **Pickups:**
  - **Hearts** heal.
  - **Crowns** are coins worth 1, 5, 10, 25 or 50 and must be walked over. Each knight collects their own (https://wiki.spiralknights.com/Crowns).
  - **Heat embers** come in small, medium and large, despawn if not collected, and are shown on the HUD flame (https://wiki.spiralknights.com/Heat).
- **Treasure boxes:** green ones hold heat, crowns, pickups, vitapods, materials or rarely gear. Red ones hold heat, crowns or tokens. Heart boxes hold hearts (https://wiki.spiralknights.com/Treasure_Box). The opening method is not stated on that page. *Treat it as "hit to open".*

## 10. HUD

Per https://wiki.spiralknights.com/HUD unless noted:
- **Top-left:** knight portrait (party, social), a **horizontal row of health pips** (red, silver above 30, gold above 60) with a % readout, and the **shield meter**. The free-revive light sits on the portrait (https://wiki.spiralknights.com/Revive).
- **Top-right:** **minimap** (enemy and NPC markers), with the objective notice under it. Map toggles with B (https://www.magicgameworld.com/?p=98263).
- **Weapon wheel:** shows the equipped weapons' names and icons. **Vials/Capsule belt** (4 slots plus a Vitapod slot).
- Heat flame counter (https://wiki.spiralknights.com/Heat). Crowns and energy appear in the Arsenal and an energy widget (bottom-right).
- Bottom-left: chat and menus.
- **Targeting UI:** target health, attack types and weaknesses.
- **Hit feedback:** a damage flash on whoever takes damage. Purple "just lost" pips on the knight's bar (https://wiki.spiralknights.com/Health).
- **Optional damage numbers** ("Show Attack Damage"): small grey means resisted, normal blue means about baseline, large brown means weakness. Weakness hits also show a golden-star effect (https://wiki.spiralknights.com/Damage).
- Monster attacks are telegraphed with coloured circles or auras by damage type (https://wiki.spiralknights.com/Damage).

---

### Gaps (no public numbers found)
- Knight base HP and base walk speed.
- Hit i-frame length and dash cooldown.
- Exact sword combo window and sword/gun charge times (except Catalyzer at about 1.3 s and bombs at 2.2 or 3.18 s).
- Reload duration, shield movement penalty, bomb fuse seconds and radii.
- Monster aggro radii and status durations (except Curse).

Choose tuned values for these and label them as such in code.

---

## 11. Balance audit after the depth-scale fix (2026-10-14)

Until the depth-scale reader was fixed (client-fidelity.md, section 1), every weapon dealt a
flat 10 normal, every monster had 100 health and no defence, armour gave nothing and shields
had 50 health. Code written or tuned in that world was re-checked against the real tables
with `npx tsx tools/audit/balance.ts [easy|medium|hard] [monster filter]`. The script loads
the install's `config/item.dat`, `item_property.dat`, `level_table.dat`, `actor.dat`,
`attack.dat`, `fire_action.dat`, `status_condition.dat` and `depth_scale.dat` through the
game's own code paths. For each tier it prints each monster family's health, defence, its
strongest attack against the tier's typical loadout, and time-to-kill both ways. It also
prints a wiki cross-check, the bosses, status conditions, mender heals and the revive blast.
Its model is an estimate, not a simulation: every swing lands, combo time is the sum of the
attack timings, and a monster lands its strongest attack once per max(1 s, its attack's
length).

### Validation against the wiki

The Leviathan Blade and Proto Sword pages tabulate damage per stratum at the completed level
(wiki.spiralknights.com/Leviathan_Blade, /Proto_Sword). Our depth tables, level bonus and
`dealt()` against a jelly's normal defence reproduce 70 of the 72 values exactly. The other 2
are one point low (Leviathan swing at depths 3 and 5, where the exact result is a whole
number and the game's float arithmetic lands a hair above it). Rounding to nearest put most
rows one point low, so a hit's damage now rounds **up** (`hitDamage` in combat.ts). Knight
health matches the wiki's Health page: 200 base, and +5 pips (200) per 5-star piece from heat
level 5. The wiki gives no per-hit monster damage or monster health. Those come from the same
evaluator and tables that reproduce the weapon tables.

### Time-to-kill (medium difficulty, from the script)

| Matchup | Monster health | Knight hit | Knight kills it in | Its hit on the knight | It knocks out the knight in |
|---|---|---|---|---|---|
| Proto knight (lvl 1) vs Jelly Cube, depth 1 | 40 | 11 | 4 hits, 2.1 s (gun 5.3 s) | 13 of 200 | 16 hits, about 36 s |
| Proto knight vs Jelly Cube, depth 7 | 150 | 12.7 | 12 hits, 6.9 s | 61 of 200 | 4 hits, about 9 s |
| 2-star lvl 5 vs Jelly Cube, depth 7 | 150 | 49 | 4 hits, 1.8 s | 36 of 280 | 8 hits, about 18 s |
| 3/4-star lvl 10 vs Jelly Cube, depth 17 | 375 | 98 | 4 hits, 2.2 s | 63 of 440 | 7 hits, about 16 s |
| 5-star lvl 10 (Skolver, Leviathan) vs Jelly Cube, depth 28 | 964 | 283 | 4 hits, 2.0 s | 108 of 600 | 6 hits, about 13 s |
| 5-star vs Trojan, depth 28 | 1929 | 283 | 7 hits, 4.0 s | slam 352 of 600 | 2 slams, about 6 s |
| 5-star vs Spookat / Gun Puppy / Scuttlebot, depth 28 | 964 | 283 | 4 hits, 2.0 s | 319 shadow or elemental (no armour for it) | 2 hits |

The tiers hold together: a tier's gear kills its monsters in about 2 to 4 seconds of
swinging. The monsters' types decide how hard they hit. A matching armour type halves a
hit, and an unarmoured type lands whole. This matches the wiki's type tables and the game's
armour design. Proto gear falls behind past depth 3, as the Proto Sword's own falling wiki
table shows. Nothing here was tuned. The remaining differences were bugs, listed below.

### Fixed (with before and after)

- **Damage flags.** A damage part reaches a victim only when its `flags` (default 1) meet
  the victim's `damageMask`: knights 13 (Character/PC/Level), monsters 3 by default (their
  configs' `damageMask`), blocks 3. Monster attacks carry 4, knights' weapons 2 and floor
  traps 8 (`DungeonActorConfig` Dungeoneer, Monster and Block fields, `DamageConfig.Base.flags`).
  The trojans' "Knightmare - Slam" pairs Attack Base +10 for knights with -10 for monsters.
  Both were summed onto the knight: 789 normal at depth 28, which one-shot a 5-star knight.
  It is now 510, which deals 352. `DepthScales.damage(..., mask)`, `DAMAGE_MASK`, and
  `World.against()` give each victim its own share. Status parts are filtered the same way.
- **Fire actions with their own damage region** ("Attack Shape", "Status Damage" arguments,
  no "Damage" argument). These cover the lumbers' slam, the trojans' slam, the deadnaughts'
  charge and skewer, the mimics' attacks, the tortodrones' attacks, lichen colonies and the
  Snarbolax's barbs. They read no damage and fell back to a flat 10 normal. A lumber at depth
  1 dealt about 5 to a proto knight and now deals 23; at depth 28 it dealt 1 to a 5-star
  knight and now deals 349 (`innerStrike` in data.ts). The lumber's slam lands 3 units
  ahead, as its Attack Shape says. It previously landed 0.8 units ahead.
- **"Fake Damage"** (gremlin dodges, trojan and deadnaught deflects) is a zero-amount strike.
  It fell back to 10 normal and hit the knight. A hit with no amount now brings only its
  conditions and push (`isHarmless`). The 10-normal fallback is gone.
- **Bullets that detonate through a fire action** (scuttlebot pellets) read that action's
  damage region, at the shooter's depth context (`projectile()` in data.ts).
- **Damage number colours.** Grey, blue or brown was picked by the share a defence took off.
  Every monster defends normal damage about as much as a same-depth weapon deals, so plain
  hits read as "resisted" (grey) on everything. The colour now comes from the hit's main type
  against the target's own defences: its lowest is its weakness (brown), its highest its
  resistance (grey), and anything else is blue (`defenseKind` in feedback.ts).
- **Curse** ticked every second, which was 126% of a fresh knight's health over one depth-1
  curse. It now bites when the victim acts, as the wiki and `StatusConditionConfig$Curse`
  say (`signalInterval` 0, `min/maxCurseWeapons`). A monster takes the damage on every attack.
  A knight takes it when using one of the 1 to 4 weapon slots the curse locked
  (`cursedSlots`). That is 14 a bite at depth 1 and 40 (the cap) from depth 7.
- **Freeze.** The ice's health (2 to 4 times the depth's health table) was 1 while the
  tables read 0, so any hit freed anyone. With real tables a frozen monster stayed frozen
  through 15 to 25 hits. Following the wiki, a frozen monster now breaks out at any hit, and
  one that thaws by itself takes the thaw damage (`damageStart` to `damageEnd`: 14 at depth
  1, 238 at depth 28, about a third of a same-tier monster). A frozen knight's ice still
  wears down by the damage taken.
- **Area heals** (the menders' heal bombs, healing totems) were capped at 10% of the monster's
  health, a cap that only made sense when every monster had 100. They now heal the config's
  amount: Monster/Damage/Attack Base, about 35 to 50% of a same-tier monster.
- **Untargeted monster heals** (the gremlins' Use Potion, Heal Base +10) healed the monster's
  target, the knight. They now heal the gremlin: 20 at depth 1, 327 at depth 28, 34 to 50%
  of its health.
- **Heal pads** quartered their 40/80/120 heal (one to three pips) for a 100-health knight.
  The knight now has 200 or more health, so they heal the full amount.
- **Revive energy blast**: Bomb Base at the best equipped weapon's star rating, without the
  bonuses of the weapon in hand. Before, a proto gun in hand made it 8 at depth 28 even with
  a 5-star sword equipped. It is now 142.

### Checked and left alone

- **Monster AI** (behavior.ts, monsterai.ts): its health conditions (potion below 40%,
  self-destruct below 25%, healers' wounded-ally checks) are already shares of the monster's
  own health. Targeting weighs damage taken as a share of its health. The hit-reaction
  threshold is `minReactPercent` of maximum health. Tests pin these down (tests/balance.test.ts).
- **Bosses** (bosses.ts): stages advance when the stage actor dies, and those actors carry
  their own health (Health Base +40/+30/+20/+10, Vanaduke 15000, masks 5000 and 5500).
  The Snarbolax's stun lets through at most a third of its health, so it always takes 3
  bells (750 health at depth 7; a 2-star sword does 136/s). The twins need one 7 s exposure
  per stage (750 health at depth 17). Vanaduke's masks need 2 to 3 five-second douses with
  a 5-star sword. The Royal Jelly's absorb heal is max(Heal Base -05, 3%) per mini.
- **Difficulty** (difficulty.ts): the client's multipliers. World now reads them from
  `DIFFICULTY_SCALES` rather than its own copy.
- **Fire, shock, poison and sleep**: depth-scaled from their configs. At MODERATE power, fire
  burns 6 to 37% of a knight's health over a burn. Shock arcs deal 5 to 85. Sleep's flat
  regeneration (`min/maxHealthRegen`, not depth-scaled in the client either) is unchanged.
- **Heat, crowns and arena waves** do not read monster health or damage (spawn tables scale
  by depth and difficulty).
- **Damage numbers** are centred strings, so four digits draw like two.
