# Spiral Knights reference

A catalogue of everything Spiral Knights does, compiled from the official wiki
(https://wiki.spiralknights.com/) on 2026-09-13, to serve as the reference
for future Clockworks phases. It is deliberately exhaustive: the cut list in
PLAN.md still applies, and this document is the menu it was cut from, not a
to-do list.

Sections:

1. Monsters and bosses
2. Core combat mechanics
3. The Clockworks and level design
4. Gear, items and progression
5. World, UI, party, PvP, story and events

Each fact carries the wiki page it came from.

---

## 1. Monsters and bosses

### 1.0 Global rules

**Tiers / depth** — https://wiki.spiralknights.com/Depth
- T1 = depth 0–7, T2 = 8–17, T3 = 18–29. Each tier = 2 strata of 3–5 floors; strata carry a theme (one family or one status: Fire/Freeze/Poison/Shock/Sleep). Shadow Lairs sit at depth 23 (boss floor 28 for Vanaduke).
- Every monster "gains preceding-tier abilities with increased intensity" per tier; variant names rarely change, the moveset grows.

**Damage scaling** — https://wiki.spiralknights.com/Damage, https://wiki.spiralknights.com/Defense
- T1: all monster attacks are pure Normal damage regardless of telegraph colour (except on Elite difficulty). T2: attacks are Normal or Normal+one type. T3: pure Normal, split, or pure typed.
- Telegraph circle colour = type: red Normal, yellow Piercing, green Elemental, purple Shadow. Dual-type = two simultaneous hits.
- Monster defense per stratum (weak / moderate): S1 5–9 / 10–17; S2 11–15 / 23–30; S3 19–27 / 39–53; S4 30–38 / 61–75; S5 44–57 / 89–114; S6 65–82 / 130–164. Each monster: moderate vs Normal + one type, weak vs one, strong vs one (family-determined). Vanaduke custom: 180 N / 150 P / 200 E / 200 S.
- Family table — https://wiki.spiralknights.com/Monster : Beast weak Piercing, resists Elemental · Construct weak Elemental, resists Piercing, immune Sleep · Fiend weak Piercing, resists Shadow · Gremlin weak Shadow, resists Elemental · Slime weak Shadow, resists Piercing · Undead weak Elemental, resists Shadow, immune Curse (except Howlitzer) · Unknown: no family bonus (Battlepod/Shufflebot take Construct-bonus damage anyway).
- Difficulty (https://wiki.spiralknights.com/Difficulty): Normal/Advanced/Elite raise monster HP and status intensity; Elite strips the Normal component from split attacks (e.g. Wolver bite becomes pure Piercing).

**Status effects on monsters** — https://wiki.spiralknights.com/Status
- Fire: DoT, cancelled by any Freeze, ignites Oilers. Freeze: locks movement and turning, broken by any damage, bonus damage if it expires untouched; frozen enemies still attack in their facing. Poison: damages on heal (kills T3 healers), lowers attack and slightly defense. Shock: interrupts attacks/movement, chain-spasm damage in 1-tile radius, supercharges Quicksilvers. Stun: big slow + attack-speed cut, doesn't stop turning, very short. Curse: damage whenever the monster attacks/heals/uses an ability. Sleep: full pacification, monster heals while asleep, any flinch wakes; vials only.

**Monster classes** — https://wiki.spiralknights.com/Monster_Classification
- Drone (fixed path, contact damage only), Mini (swarm, tiny HP), Grunt (baseline), Brute (high HP, few in number), Elite (grunt HP, large moveset, rarely alone), Giant (rare, solitary, multi-knight), Turret (immobile, ranged), Support (no attack, buffs/heals), Boss, Mini-boss, No-category (Punkin King, Grimalkin, Harvester, Lost Soul, Swarm).

**General AI notes** (no dedicated AI page exists; aggregated from monster pages)
- Aggro: most monsters aggro on line of sight; Gun Puppies only when attacked or LoS; Deadnaughts attack on a timer, not on player action; Tortodrones ignore you until provoked; Harvester stalks one player until death or aggro steal. Invisible knights lose all targeting (in-flight attacks continue).
- Dodging: T2+ Wolvers, Chromalisks, Devilites, Thwackers, Demos, Menders, Stalkers dodge projectiles; Scorchers, Knockers, Mortafires do not.
- Interrupts: most windups cancel on hit; T1–2 knocked down by full combo, T3 only flinch (Zombies); Retrode beam already firing cannot be stopped.
- Self-heal: all Gremlin combat units carry Health/Super/Ultra capsules (T1/2/3) and use them when unpressured.

### 1.1 Spawning, arenas, danger rooms

**Exploration entities** — https://wiki.spiralknights.com/Exploration
- Respawn Pad: perpetually spawns; rotating-arrow speed = spawn rate; empty pad → monster, occupied pad → respawns the block/object; shielding on it can block spawns (not all); standing on it while it spawns hurts you.
- Monster Cage (https://wiki.spiralknights.com/Monster_Cage): 1×1, breaks to release a random monster that attacks instantly; some disguised as blocks or "med cache" boxes.
- Grave Mound: spawns a zombie when approached or left. Fiend Gate: continuously opens portals; destroy portals to stem flow. Burrow: floor hole that occasionally spawns Wolvers. Swarm Sphere: black sphere, spawns Swarm monsters on contact. Busted Floor: spawns Minis (Dust Bunny/Glop Drop/Scarab). Monster Garage (https://wiki.spiralknights.com/Monster_Garage): Treasure Vault block that spawns Drop clusters.
- Party Button: all members must stand on it; locks the room. Beast Bell (https://wiki.spiralknights.com/Beast_Bell): hit to ring; stuns nearby Wolvers/Dust Bunnies and is the only way to make Snarbolax vulnerable. Grim Totem (https://wiki.spiralknights.com/Grim_Totem): 1×1, pulses purple, resurrects any zombie killed in radius ("ARISE!"); indestructible but can be carried; skull disintegrates if totem is moved before the pulse.

**Battle Arena** — https://wiki.spiralknights.com/Battle_Arena
- Central party button locks the room and spawns the first two waves. Two independent branches × 3 waves; clearing a wave spawns the next in that branch; final wave only after both branches. Trick: leave one monster alive per wave to control tempo.
- Composition slots: Theme monster, Heavy (Lumber/Alpha), Turret (Gun Puppy/Polyp/Howlitzer/Rocket Puppy), Healer (Silkwing/Mender), Elite, Giant (Trojan/Lichen Colony). Bout 1: 4+2+4 elites per branch; Bout 3: 12 elites + 8 turrets + 6 theme in final wave, plus 4 spike beds at cardinals. Rewards 6/10/15 boxes.

**Danger Room** — https://wiki.spiralknights.com/Danger_Room
- Optional locked room, 3 energy, can't leave until cleared. 3 consecutive waves. Monsters use stats/appearance of one stratum deeper and are usually strong against the weakness the stage's normal population has (so bring a second damage type). Entrance pillars show trap type = status theme (not guaranteed). Layouts: circular/square/rectangular/irregular with spike traps, blocks, orbital chains, respawn pads. Reward room: 12 boxes, 4 heart boxes.

### 1.2 Beast family — https://wiki.spiralknights.com/Beast
Weak Piercing, resists Elemental. Sounds-based ("growl, yelp, bark"). No elite+ members. Less Stun-resistant, more Freeze-resistant.

**Wolver** (Grunt; Alpha = Brute) — https://wiki.spiralknights.com/Wolver
- Variants T1–3: Wolver, Alpha Wolver; Ash Tail/Alpha Ash Tail (Fire, immune Fire); Frostifur/Alpha Frostifur (Freeze); Rabid Wolver/Rabid Alpha (Poison); Voltail/Alpha Voltail (Shock); Perma-Frostifur (T2–3, invulnerable Maulos add, no loot); Void Wolver (T3 Swarm, no burrow, hearts only, infinite); Vog Cub (unreleased).
- Damage: Normal+Piercing (+status); Elite difficulty pure Piercing.
- Attacks: Bite (single lunge; block/dodge). Alpha 3-bite combo (hard to interrupt; back off, punish after third). Bark/howl (sits, can't dodge — free hit; knocks down non-Alphas; Alphas apply pack attack buff — kill Alpha first). Dash (Alpha T1+). Burrow/teleport (Alpha T2+, all T3): dives, resurfaces behind target.
- AI: pack hunters, call others, rarely solo; T2 dodge projectiles, T3 full dodge. Countered by cornering (stops burrow) or running circles with a gun.

**Chromalisk** (Grunt) — https://wiki.spiralknights.com/Chromalisk
- Variants: Whelp (lick only), Kleptolisk (lick + steals pickups on hit), Chromalisk (camouflage), Salamander/Tundralisk/Virulisk/Electrolisk (Fire/Freeze/Poison/Shock spit, immune own status). All T1–3.
- Attacks: Lick (short Piercing tongue). Spit (Piercing+status glob; glob persists on floor dealing damage/status). Camouflage: near-invisible grey outline. Dodges projectiles. Rated least threatening; more resistant to Fire/Poison, less to Freeze.

**Bunny** (Mini) — https://wiki.spiralknights.com/Bunny
- Dust/Toast/Snow/Blech/Jolt Bunny (none/Fire/Freeze/Poison/Shock). Attack: Nibble, Piercing + status, lock-on bite. Large packs from Busted Floors; attack rate rises with tier; shreds shields. Counter: piercing AoE.

**Snarbolax** (T1 boss, Gloaming Wildwoods d7) — https://wiki.spiralknights.com/Snarbolax, https://wiki.spiralknights.com/Lair_of_the_Snarbolax
- Arena: square room, Beast Bell in centre, bramble hedges on borders, boss burrows and surfaces at one of 4 corners.
- Invulnerable and status-immune by default (black coat). Ring bell while it's nearby → stunned 3–4 s, coat turns brown/eyes yellow, now weak to Piercing, can be frozen (freeze persists into invulnerable phase). Regains invulnerability after losing ~1/3 remaining HP.
- Attacks: Burrowed Spikes (emerges at a corner, spikes erupt), Bite combo (Alpha-Wolver style), Thrown Spikes (ranged). Single phase, cyclic.
- Counter loop: lure/shield-bump/vortex toward bell → ring → burst. Rewards 1–4 Frumious Fang.

**Rabid Snarbolax** (Shadow Lair, T3) — https://wiki.spiralknights.com/Rabid_Snarbolax
- Two Snarbolaxes at once, all attacks add Poison; poison hedges; respawning Silkwing heals both at 63 HP/s; Swarm Source in arena buffs bosses/slows knights; bell occasionally ignored; can still attack while stunned. 6–8 tokens.

### 1.3 Construct family — https://wiki.spiralknights.com/Construct
Weak Elemental, resists Piercing, immune Sleep. Gremlin-built defenders.

**Gun Puppy** (Turret) — https://wiki.spiralknights.com/Gun_Puppy
- Gun Puppy: 1 bullet T1, 3-spread T2, 5-spread T3 (Normal+Elemental). Rocket Puppy: single rocket, homing T2, stronger homing T3, slower fire, +Fire. Red Rover: flamethrower, T3 curves toward knights. Slush/Sick/Sparky Puppy = Gun Puppy + Freeze/Poison/Shock. Love Puppy: heals knights 1 HP/bullet. Gold Puppy: invulnerable, removed.
- AI: stationary, limited turn rate, passive until shot or LoS; fire rate drops as tier rises. Counters: flank (slow rotation), Freeze stops rotation, Shock makes aim wander, stagger interrupts, rockets can be outrun or detonated with sword/bomb.

**Mecha Turret** (map object) — https://wiki.spiralknights.com/Mecha_Turret
- Rotates, locks on, vibrates while charging, fires one piercing knockback laser, contracts to recharge (light row shows recharge). Destructible; takes statuses. Variants: light blue (missions), purple (OCH/Starlight), red Energy (Aurora Isles, costs 5 energy), Auto Turret (player kit).

**Lumber** (Brute) — https://wiki.spiralknights.com/Lumber
- Lumber, Redward (Fire), Silversap (Freeze — most dangerous: freeze → repeat smash loop), Vilewood (Poison), Electreant (Shock), all T1–3; Void Lumber (T3, axe arm, huge, infinite, no loot); Ironwood Sentinel (T1 mini-boss, Crash Site, burning axe, huge HP, Gun Puppies spawn mid-fight, no loot).
- Attack: Smash — long slow windup, hits everything in front, high Stun chance on knights and monsters, knockback even through walls/shields; T2–3 shorter warning. After a whiffed smash it's harmless for several seconds.
- AI: slow, turns slowly — fight from behind, use corridors to bait smash → retreat → punish. Normal+Elemental.

**Mecha Knight** (Elite) — https://wiki.spiralknights.com/Mecha_Knight
- Base T1–3 (blade upgrades; T2 gains time-decaying projectile shield; T3 charge releases 4 bullets); Firo/Cryo/Poison/Volt Knight (status, immune own). Sees through Stalker cloak.
- Attacks: Sword slash combo (melee; if shot mid-combo it's knocked down). Charge attack (whirring telegraph, auto-releases only if target in range; base drops bombs, elemental T3 fires 4 status bullets). Malfunction: self-shock that spreads to nearby enemies/Quicksilvers, briefly stuns itself. Auto projectile shield T2+ decays on a timer, not damage — shoot in the gap.
- AI: aggressive chaser; frozen ones spin instantly and still attack.

**Retrode** (Grunt) — https://wiki.spiralknights.com/Retrode
- Retrode, Hotrode, Sleetrode, Isotrode, Voltrode (T1–3), Batterbot (Shock, spawns a Current Cake on death). Rises from ground like a zombie.
- Swipe: red aura, rotates to track during windup (can't circle behind), Normal+status; full sword combo knocks it down. Beam (T2+): green aura, head rears back, straight line, explosions along path, Elemental+status, can't be interrupted once firing; cannot cross gaps/blocks; if aimed into a wall no explosions — break LoS or fight across a gap.

**Scuttlebot** (Grunt) — https://wiki.spiralknights.com/Scuttlebot
- Scuttlebot, Cinderbot, Brumabot, Hazbot, Surgebot. Moves like a Chromalisk. One attack: 3-bullet short-range spread + status, long delay before firing, cancelled by almost any hit. Dangerous only in mobs. Infinite Surgebots in Roarmulus fight.

**Tortodrone** (Boss class, T2–3) — https://wiki.spiralknights.com/Tortodrone
- Bipedal tortoise; passive patroller until provoked; corrupted (Dark Matter) variant is aggressive — the only fought version (March of the Tortodrones event, 2 per run + infinite fiends via Fiend Gates).
- Attacks: Stomp; Charge (Stun, corner-locks); Rock Missiles (Normal+Elemental, Stun+Shock, lodge in floor as collision hazards — its most vulnerable window); Drill Punch (close, heavy knockback); Ground Pound (expanding shockwave, stun on entry). Drops 1–4 Ancient Shell.

**Battlepod** (Mini-boss) — https://wiki.spiralknights.com/Battlepod
- Large stationary pod; immune to all damage while shield up, immune to all statuses always; may have orbiting breakable blockades; supported by Gremlins/Constructs — kill adds first. Ability pool (subset per pod): bullets, bombs, beams, lasers, rockets (plain/homing/large), flamethrower (+Fire), status spill/mist, orbital chain, repel + ally attack buff, area heal.
- **The Big Iron** (Ghosts in the Machine): 3 phases — P1 1 spawner, ≤2 ground tentacle-wires, 2 shock lasers; P2 2 spawners, 4/4; P3 6 wires, 6–8 lasers, eye red. Spawners emit Surgebots/Volt Knights/Voltrodes. Vulnerable only when mouth opens; count 4 laser bursts to time it; far corners are safe from wires; shield-bump minions into wires. No loot.
- **Grinchlin Assault pod**: single phase, freeze orbital chain, rockets, repel+buff; endless spawners (Slush/Rocket Puppies, Grinchlin Thwackers/Stalkers, Darkfang Menders, Humbugs); attack mouth after the repel.

**Collector** (T1 mini-boss, Camp Crimson; also 10-1) — https://wiki.spiralknights.com/Collector
- Lowest boss HP. Attacks: Charge (Normal+Shadow), Goo Grenades (opener), Explosion (Normal+Elemental) — it stuns itself with each explosion and rotates to next attack: punish window. 10-1 adds Shock Oil spit while walking.
- Adds: at 2/3 HP 3 Retrodes + 2 red searchlights; at 1/3 HP 2 Gun Puppies + 2 more; adds despawn on kill.

**Roarmulus Twins** (T2 boss, IMF d17) — https://wiki.spiralknights.com/Roarmulus_Twins, https://wiki.spiralknights.com/The_Roarmulus_Twins
- Arena: knights on a platform between two giant Gun Puppies in side chambers; lever-controlled purple/yellow gate walls; central lane; infinite Surgebot pads (8 in Shadow version). Pre-boss floor over a slag pit with rocket fire.
- Twins only damaged by each other's rockets: use gates to redirect one twin's rocket into the other. Hit twin gets yellow arrow = stunned/vulnerable; after enough damage it raises a purple shield — switch. Swords, bomb lines (Shard/Crystal/Dark Matter/Splinter) and vials do nothing.
- P1 stationary, fire straight down lane; P2 twins slide vertically; P3 adds lane-wide laser sweep (blocked by walls, dash i-frames it; laser also kills scuttlebots) and only one twin needs to die. Attacks: energy bullet spread (Shock), small rockets (jaw closes), large rockets (P2+). Rockets colliding cancel each other. Shock on the lever-puller ruins timing — freeze scuttlebots rather than fight. 1–4 Bark Module.
- **Red Roarmulus Twins** (https://wiki.spiralknights.com/Red_Roarmulus_Twins): +Fire on rockets, red laser P3, 8 pads, 6–8 tokens.

### 1.4 Fiend family — https://wiki.spiralknights.com/Fiend
Weak Piercing, resists Shadow. Only family absent from the Unknown Passage.

**Devilite** (Grunt/Elite/Support) — https://wiki.spiralknights.com/Devilite
- Devilite (Toss Supplies, Normal+Shadow); Firebrander/Layoafer/Blarful/Devil-IT (Fire/Freeze/Poison/Shock tosses). Overtimer: converted by a Pit Boss — glowing, fast, throws pitchfork / axe slash (+Stun, +status). Yesman: no attack, buffs Pit Boss defense, becomes Overtimer if boss dies. Pit Boss: never attacks; converts nearby Devilites into Overtimers/Yesmen; demoted to plain Devilite when all workers die.
- Projectiles very fast — shield rather than dodge at close range; they dodge guns, so melee. They stand still while targeting — plant a bomb and back off shielded. Attack speed rises with depth.

**Gorgo** (Grunt) — https://wiki.spiralknights.com/Gorgo
- Gorgo, Firegut, Guster, Waster, Storm Belly. Hover/bounce until they see you, then feeding frenzy: Chomp (Normal+Shadow+status, 1–3 chained by tier; 2 chomps break a shield); Body Slam (Shadow+status, only with 2+ knights). Faster and more frequent deeper. Counter: shield bash first, then attack; deadly with Silkwings.

**Greaver** (Elite) — https://wiki.spiralknights.com/Greaver
- Greaver (Stun), Ruby/Pearl/Jade/Beryl (Fire/Freeze/Poison/Shock), Humbug (Winterfest, high Stun).
- Dive: flies, "hugs target's behind" then swoops, Shadow+status. T2: leaves status haze at impact (haze bypasses shield — don't stand still after block). T3: bigger longer haze + 4 bullets after a successful dive. Easily interrupted; shield-push or dodge then counter.

**Silkwing** (Support) — https://wiki.spiralknights.com/Silkwing
- No attack. Heals adjacent monsters; T2 releases heal aura on death, T3 bigger aura. Wanders or follows big monsters (Lumbers, Trojans). Counters: shield-push it off allies, Poison/Curse punish heals, kill first.

**Trojan** (Giant) — https://wiki.spiralknights.com/Trojan
- Trojan T1–3, Maulos, Gold Trojan (invulnerable, promo). Immune Curse. Frontal shield blocks everything; purple Dark Matter crystal on back is the weak point.
- Attacks: Charge (fast, Normal+Shadow — sidestep, then hit back); Sword Slam (overhead, ground impact, Stun, long recovery); Attack Buff (roars, Shadow + Shock + knockback around it, raises its own damage). Turns quickly to face highest damage dealer. At death threshold it petrifies (purple bursts) and shatters when hit. Can be made to hit other monsters; two knights on opposite sides interrupt it permanently.

**Maulos** (Frozen Trojan mini-boss, Heart of Ice) — https://wiki.spiralknights.com/Maulos
- Mace strike (Normal+Shadow+Stun), Attack Buff (Stun+Shock), Ice Block Trail (leaves breakable Freeze blocks). 3 phases separated by encasing itself in ice: P1 spawns 2 invulnerable Perma-Frostifurs; P2 ~4 Frostifurs + Frozen Souls; P3 2–4 Layoafers; Tundralisks throughout. Hit it while encased/immobile.

**Arkus** (fallen Guardian Knight, 9-1 Cryptic Statuary d26) — https://wiki.spiralknights.com/Arkus
- 3 phases (revives twice; each revive = Normal+Stun energy blast). 2-hit sword combo, Sword Slam (Stun), Shadow Spikes slam (P3), passive orbiting Shadow orbs (+2 per phase). Reach double a Trojan's; no dash, no buff; front is heavily damage-reduced not immune; flanks normal. Adds P2–3: Beryl Greavers + Silkwing. No weakness/resistance.

### 1.5 Gremlin family — https://wiki.spiralknights.com/Gremlin
Weak Shadow, resists Elemental. Clans by tier: Tenderfoot T1, Ironclaw T2 (adds dash/double attacks), Darkfang T3 (shields, resurrection, spin). All carry health capsules and retreat to heal.

**Thwacker** (Elite) — https://wiki.spiralknights.com/Thwacker
- Axe Swing (melee, Stun), Axe Toss (ranged, Stun); T2 dash + double swing; T3 adds 360° spin when knights are near and a back-shield (attack from the front); Void Thwacker (Striker weapon, Swarm bullet, hearts only); Grinchlin (event). At low HP idles/flees, T3 shields in corners and faces walls. Dodges projectiles. Short recovery after charged swing — punish it. Dozens spawn in Deconstruction Zones.

**Mender** (Support) — https://wiki.spiralknights.com/Mender
- T1 Mend (single target). T2 + Area Mend (AoE heal that knocks knights back). T3 + Mending Rune (floor heal tile), Energy Dome (self-shield, immobile while casting), Resurrect (revives gremlin corpses; Knockers leave none). Flees, dodges; stands still while healing — that's the kill window. Poison/Curse punish it.

**Scorcher** (Elite) + **Gremlin Incinerator** (Giant) — https://wiki.spiralknights.com/Scorcher
- Flamethrower (red anim; T2+ sweeps to follow you), Ember Bolts (green anim, slow big bullets; T3 3-spread), T3 Flame Wave and Oil Spill (lays oil then ignites). Slow, bulky, does NOT dodge guns, keeps distance. Fast knockback sword hits interrupt. Incinerator: giant dual-flamethrower, high HP, Compound 42 finale. Grinchlin Scorcher event.

**Demo** (Elite) — https://wiki.spiralknights.com/Demo
- Places bombs (T1 Normal → T3 Elemental); T2+ throws bombs (Stun on mid-air contact) and drops bombs when hit; T3 erratic movement. Very evasive vs guns — use fast swords or bombs and never let it heal.

**Knocker** (Grunt) — https://wiki.spiralknights.com/Knocker
- Knocker, Lighter, Cooler, Choker, Jumper. Claps two wrench-wands together → explosion at your feet + status; occasional Misfire = bigger blast stunning everyone incl. itself. Doesn't dodge guns, easily cancelled. Weakest gremlin; leaves no corpse.

**Mortafire** (Brute) — https://wiki.spiralknights.com/Mortafire
- Gremlin/Blazing/Icy/Toxic/Static Mortafire. Fires mortar arcs at ground target circles; T1 wildly inaccurate → T3 ~100%. Front shield — only hittable from behind; slow but erratic walk, stops to aim; any hit or status makes it drop mortar and shield, then it goes to pick them up (throw the gear away). Freeze locks it.

**Stalker** (Elite) — https://wiki.spiralknights.com/Stalker
- Ghostmane Stalker; Grinchlin (event). Saw Slash, Saw Throw (T3 three blades), Recon Cloak (invisible; breaks on damage; Mecha Knights see it), Warning Mark → Death Mark (target defense nullified 5 s). Reveal with AoE bombs, kill fast or it re-cloaks and flees.

**Razwog** (T1 mini-boss, 1-2/1-4) — https://wiki.spiralknights.com/Razwog
- Flamethrower; after first revive huge short-range fire waves. Plays dead and goes invulnerable until its summoned Constructs die, then revives with upgrades; summons at start and each revive. 1-4 arena has rockets that detonate into a burning obstacle course.

**Sputterspark** (4-3, 8-2) — https://wiki.spiralknights.com/Sputterspark
- Never fought directly. 4-3: lightning rains on burnt floor patches (Shock) while waves of Gremlins/Constructs, hedgehogs, spike traps attack; he leaves when waves end. 8-2: press 3 switches to make his Sparkcaster 9000 short-circuit for 9,000 damage.

**Herex** (T3, Shadowplay) — https://wiki.spiralknights.com/Herex
- Stalker boss: step-forward slash, charged 3-blade cone throw, Recon Cloak (warning mark betrays him), Death Mark (getting hit while marked is punished). Orbiting green blades are harmless. Corner him and keep pressure; hit to decloak. Preceded by toxic constructs/Toxoil waves.

**Warmaster Seerus** (all tiers, OCH Engines of War) — https://wiki.spiralknights.com/Warmaster_Seerus
- Arena: Grand Arsenal, throne ledge above, 3 Battlepods below (L/R unshielded and respawning, centre shielded), orange floor marks = laser zones in P5.
- P1/P3 throne: kill the centre pod to end phase. P2/P4: descends with Rocket Hammer — Hammer Smash, Charged Smash (Blast-Network explosion lines; after ~4 charged smashes he self-stuns → knockdown window), Spin (Stun), drops Shadow bombs while Rocket-Dashing. P5: fights with 3 indestructible shielded pods + lasers; ignore pods. Immune to vials. Shadow guns for dash phases, Shadow sword for the stun window. Mask fragments by tier.

### 1.6 Slime family — https://wiki.spiralknights.com/Slime
Weak Shadow, resists Piercing.

**Jelly** (Grunt/Brute/Mini) — https://wiki.spiralknights.com/Jelly
- Jelly Cube T1 tackle then backstep; T2 + thorn eruption; T3 up to 3 thorns (Piercing). Ice Cube (+Freeze tackle, freeze vapour; refreezes off other Ice Cubes; burning turns it into a Jelly). Blast Cube: T1 explodes on death (harmless), T2 scatters delayed goo, T3 both. Rock Jelly (hides among stone blocks, heavy tackle). Impostocube (rare, accessory drops). Minis: Jelly Green, Royal (T2, tiny hitbox), Ice (T3, freeze). Jelly Green Giant retired.
- Always faces the camera, tracks you before lunging — intent unreadable; block, knockback or strafe. Keep them in a line for multi-hit charges.

**Lichen** (Grunt/Giant) — https://wiki.spiralknights.com/Lichen
- Merging: 10 lichens (any combination of pre-merged doubles/triples; T2 spawn as doubles, T3 triples, merging faster each tier) → Colony (full heal, statuses cured; spin fires random spikes). 16 → Giant Colony (Spin + Stun, Thorn Roots, Dash chase; absorbs unlimited lichens for HP only). Core count = HP + damage, capped at 21. Skilled parties let it merge for more heat.
- Variants: Oiler (Fire; ignites, gains Elemental resistance while burning, leaves camouflaging oil slicks, slides after attacks, freeze extinguishes, dies to rock salt); Toxigel (Poison, T3 spin); Toxoil (T2–3, Fire+Poison, dashes, poison trail that burns, hunts cloaked knights); Giant Toxoil (slow, no dash, spike spin); Toxilargo (T3, poison aura that weakens, "most dangerous lichen"); Quicksilver (Shock; shocked = brief invulnerability + self-heal + erratic movement, damages neighbours — use vs its own crowd); Sloom/Sloombargo (Sleep; mist persists after death — stand in it to heal); Void Gel (T3 Swarm, poison, 75% damage taken, hearts only, infinite); Baby Mimic (fake purple treasure box); Soul Jelly (rare, cannot merge, immune to shield bump, 75% damage).

**Polyp** (Turret) — https://wiki.spiralknights.com/Polyp
- Barb Shot: 1/3/5 barbs T1/2/3, slower than Gun Puppy bullets. Slick/Polar/Caustic/Silver (+status). Compound Polyp (T2–3: poison barbs, oil slicks, spawns Toxoils). Royal Polyp (T2, RJ arena: barbs + jelly globs that become 3 Royal Minis; every attack heals the boss). Royal Polar Polyp (T3 Ice Queen equivalent, Ice Minis). Sees 360° so can't be ambushed, but must physically rotate to fire; frozen = locked facing.

**Drop** (Mini) — https://wiki.spiralknights.com/Drop
- Glop/Spice/Snow/Germ/Power Drop. Rolls like a ball, attacks by flattening into a puddle (Piercing+status); large colonies from Busted Floors/Monster Garages; no face so hard to read; attacks faster deeper.

**Treasure Mimic** (Treasure Vault boss) — https://wiki.spiralknights.com/Treasure_Mimic
- Oversized Shankle-like thing hiding as a purple box; opens on approach. Ground Pound (floor shockwave, can multi-hit), Swipe. Huge HP; constantly spawns high-HP tentacles that wall it off and Drops in threes every few seconds; arena has 2 short N/S barriers and Monster Garages. Bombs get destroyed — use piercing/shadow direct hits; frequent hits flinch it. Rare Misplaced Promissory Note.

**Royal Jelly** (T2 boss, Battle Royale d16/17) — https://wiki.spiralknights.com/Royal_Jelly
- Arena: open castle floor, breakable blocks (boss smashes them), unbreakable corner blocks for cover, regenerating block pads (standing on one stops the respawn but the respawn hits you — shieldable), Royal Polyps around the perimeter (more each phase), 4 Jelly Cubes summoned periodically (only first 3 drop loot).
- 3 damage-threshold phases; HP scales with party size. Tackle (slow windup burst — sidestep). 360° Spin (P2+, big knockback). Repel contact damage. Tantrum/Rage Spin (P3, pink counter-clockwise, invulnerable during). Royal Minis heal it on contact. Strategies: blitz with Shadow/Poison/Fire/Curse, or starve by killing Polyps first.
- **Ice Queen** (https://wiki.spiralknights.com/Ice_Queen): Shadow Lair, higher damage, passive damage aura around her, Curse-immune, cannot be frozen; Tackle +Freeze; P2 on losing crown (pinkish-blue) adds Spin; Polar Polyps + Ice Minis. Poison to stop heals; skirmish, don't stand in melee. 6–8 gems.

### 1.7 Undead family — https://wiki.spiralknights.com/Undead
Weak Elemental, resists Shadow, Curse-immune (not Howlitzer). Skeletons burrow and ambush; ghosts strike from behind.

**Howlitzer** (Turret) — https://wiki.spiralknights.com/Howlitzer
- Howlitzer, Smoking/Chilling/Vile/Shocking. Shadow bullets: 3-spread T2, 5-spread T3 (+status). On death: brief invulnerable delay, then launches a homing kamikaze skull missile (homing scales with tier; self-destructs on timer) — shield or kite in circles; don't kill several at once. Immune Curse and Sleep.

**Kat** (Grunt) — https://wiki.spiralknights.com/Kat
- Spookat (Bite Normal+Shadow; T2 single bullet, T3 3-spread; prefers attacking from behind). Pepperkat/Bloogato/Hurkat/Statikat (+Fire/Freeze/Poison/Shock). Black Kat (T2–3, rare replacement, 2× HP, Curse bite/bullets, summons Dust Zombies T2 or Carnavons T3, high knockback resistance; drops Ancient Pages). Mewkat (harmless). Grimalkin (unkillable giant Spookat: spawns in darkness after 3 s, up to one per party member, phases through walls, won't enter candle-light, unblockable Normal bite; run perpendicular or dash through it).
- Lunge-bite has a windup — Shock interrupts it and chains between grouped Kats; run at a charging Kat to trigger the bite early; cooldown shrinks with depth.

**Zombie** (Grunt) — https://wiki.spiralknights.com/Zombie
- Dust Zombie; Slag Walker (Fire); Frozen Shambler (Freeze); Droul (Poison); Frankenzom (Shock); Carnavon (T3, Cursing Breath, back shield); Void Zombie (Swarm, no breath, freeze-resistant, hearts only).
- Swipe, Lunge/Leap (grabs and immobilises, long damage window — shield it; shield push throws it back further), Bite, Breath (T2+, status only, no damage, interrupted by any hit). Immune while emerging from ground or being revived (Grim Totem / Deadnaught). T1–2 knock down, T3 only flinch. Same look at every depth.

**Bombie** (Grunt) — https://wiki.spiralknights.com/Bombie
- Bombie / Burning / Freezing / Choking / Surging. Very low HP; explodes on contact or when damaged (Shadow + Stun/status); T2–3 fire bullets in 4 cardinal directions on death. Revivable by totems/Deadnaughts. Keep moving, kill at range.

**Scarab** (Mini) — https://wiki.spiralknights.com/Scarab
- Grave/Sun/Pale/Plague/Silver/Grim Scarab. Flying Tackle: lock-on straight-line Shadow charge (+status); swarms; faster deeper. Grim Scarab (Dark Harvest) releases a Grim Gourdling on death.

**Almirian Crusader** (Elite, T2–3) — https://wiki.spiralknights.com/Almirian_Crusader
- Dormant in glowing ash until approached/attacked (nearby Bombie blasts wake it). Spear flourish (Shadow, rapier-style), shield raised after attacks or when shot (blocks projectiles). Flank when shielded; Stun very effective.

**Deadnaught** (Giant, T2–3; formerly "Slag Guard") — https://wiki.spiralknights.com/Deadnaught
- Deadnaught, Burning, Frozen, Vile, Static; Almirian Royal Guard (T3, FSC, Normal only), Almirian Shadow Guard (Curse). Spear Charge (Shadow), turns fast after a miss. Resurrects nearby Zombies/Bombies (Almirian variants auto-revive in a ring; others charge first — ring appearing offscreen warns of a charge). Aggro on timer, not on your actions. Kill first; punish after a whiffed charge; piercing passes its shield.

**Phantom** (Elite, T1–3) — https://wiki.spiralknights.com/Phantom
- Spawns as small red orb (one per party member), audible Doppler cry across the level, materialises near you, phases through walls; unkillable — beating it returns it to orb form for minutes. 3-slash combo (safe to counter after third), T2 charged Shadow projectile, T3 3-spread, both Curse. Immune to all statuses except Stun/Freeze. Slower in orb form if you outrun it.

**Margrel** (T2, Moorcroft Manor, summoned via Book of Dark Rituals) — https://wiki.spiralknights.com/Margrel
- Giant Grimalkin: invulnerable most of the time, windows drop periodically. Bite (Normal+Shadow), orbiting Shadow bullets while flying, Poison Smog, Curse on summon, summons Black Kats; zombie hordes. Low traction, slides. Burst in windows; freeze adds. 6 Ancient Pages, Wicked Whisker, Black Kat Cowl.

**Punkin King / Gourdling** (Dark Harvest) — https://wiki.spiralknights.com/Punkin_King, https://wiki.spiralknights.com/Gourdling
- Graveyard arena with ~10 respawn pads and fire jars. TREAT: drops 10 candy and leaves. TRICK: bounces away from players; drops a token per 3–6 hits; pads endlessly respawn Gourdlings (Zombie-type: lunge/bite/Stun breath; or Bomb-type: Shadow explosion + blob bombs) — one type per fight; timed. Grim Gourdling: Burning Breath, from Grim Scarab.

### 1.8 Unknown / no family — https://wiki.spiralknights.com/Monster#Unknown

- **Shankle** (https://wiki.spiralknights.com/Shankle): Normal/Dark/Sage/Sharp (N/S/E/P spikes) + Golden of each. Fixed path, never targets, only hittable when it stops and retracts spikes; Golden never stops = invulnerable; no flinch/knockback; hearts only.
- **Wisp** (https://wiki.spiralknights.com/Wisp): Volcanic/Winter/Bog/Storm + Golden (+Golden Sleep). No damage, contact status only; alternate "angered" (blades out, invulnerable) and "sad" (vulnerable); Golden never sad. Status intensity rises with difficulty.
- **Razor** (https://wiki.spiralknights.com/Razor): Treasure Vault square blade, faster than Shankle, contact Normal damage, indestructible, no loot.
- **Soul** (https://wiki.spiralknights.com/Soul): Lost/Fire/Frozen/Static/Void/Freed Soul. One-hit kill; slowly pursues, grows, self-destructs (Normal or Elemental+status). Infinite spawns, no loot. Shield up, ignore.
- **The Swarm** (https://wiki.spiralknights.com/The_Swarm, https://wiki.spiralknights.com/Unknown_Passage): Swarm Source — shadow field that slows knights and raises monster defense; damage its centre to shrink/suppress it temporarily; itself status/damage immune; fires heavy shots. Swarm Turret fires Swarm Missiles, indestructible. Portal resurrects Void monsters. Infested zones: no crowns/heat/materials, endless spawning, static minimap, Catalyzer can't tag.
- **Shufflebot** (https://wiki.spiralknights.com/Shufflebot): training-hall cube, Tackle, tiny damage, sleepable, neutral to all damage, respawns via block.
- **Cake** (https://wiki.spiralknights.com/Cake): Creep Cake (Tackle; Candles — up to 5 piercing fire candles erupt at T3), Mini Creep Cake, Current Cake (Shock candles, from Batterbot). **Dread Velvet**: P1 Batterbot form (Swipe Normal+Curse, Beam Elemental+Shock); P2 Creep Cake form (Tackle/Candles + Curse). Arena has fire grates. No loot.
- **Apocrean Harvester** (https://wiki.spiralknights.com/Apocrean_Harvester): unkillable stalker (respawns at 0 HP), picks one knight, HUD static; slow until in range then teleport-rush; burrows when idle. Apocrean Grip (ground shakes, dust drifts → tendrils in a Brandish-charge pattern; walk straight or turn 90°/shield; snares ~15 s unless ally frees). Apocrean Gaze (screen flashes pink, clap sound → 4 s multi-hit beam on snared target, ignores i-frames, partial shield). Immune Stun/Freeze/Shock/Curse; resists Shadow; Poison/Fire work. Avoid; one player kites.

**Lord Vanaduke** (T3 boss, FSC Throne Room d28) — https://wiki.spiralknights.com/Lord_Vanaduke, https://wiki.spiralknights.com/Throne_Room
- Arena: throne room, 4 Water Wells (waterballs), overhead supports that collapse; party locked. Debris no longer damages but spawns Shadow Fire.
- P1 body: Mace Swing (overhead, Fire+Stun, quake breaks ceiling → orange floor marks → falling debris Fire+Stun), Dash Charge (kites you into corners = bodyblock trap), 4 Slag Walkers (respawn when all dead). P2 mask: detaches, floats, immune while burning; a waterball douses it for 5 s (multiple waterballs run separate timers — wait 5 s between); fires 360° bullet rings + 2 large orbiting bullets (waterballs pop them); takes Normal only. P3 body: + 4 orbiting flame orbs (douse or avoid), strikes spawn Shadow Fire that becomes trapping lava blocks (can spawn inside you; "lava gardening" pre-fills up to ~25 tiles at the edges). P4 mask: more/faster bullets. P5 body: 2 orb rings, Fire Stream (no damage, applies Fire), Almirian Royal Guards replace walkers, immune to Shadow.
- Body weak Piercing; freezing him is the standard control (one knight on Shivermist). 1–4 Almirian Seal.
- **Darkfire Vanaduke** (https://wiki.spiralknights.com/Darkfire_Vanaduke): +2 orbiting bullets, mace and bullets add Curse, Shadow Fire from P1, immune to Shivermist/haze; adds P1 6 Carnavons, P3 2 Carnavons + 2 Shadow Guards, P5 4 + 2; a Swarm Seed must be kept knocked away. 6–8 seals.

**Shadow Lairs** — https://wiki.spiralknights.com/Shadow_Lair: depth 23, Shadow Key consumed, party locked, monsters are Swarm-buffed status variants of the base dungeon (poison/ice/fire/curse), then Unknown Passage → Sanctuary. Void monsters (Wolver/Lumber/Thwacker/Gel/Zombie/Soul) give hearts only, respawn forever.

### 1.9 Gaps
- No dedicated monster-AI page exists; the wiki has no monster HP table by depth (only the per-stratum defense table above and the note that HP rises with difficulty and, for Royal Jelly, party size).
- Spawn-object pages (`/Spawner`, `/Respawn_Pad`, `/Fiend_Gate`, `/Grave_Mound`, `/Burrow`, `/Swarm_Sphere`) do not exist; `/Exploration` covers them.

---

## 2. Core combat mechanics

Source paths are relative to `https://wiki.spiralknights.com` (e.g. `/Dash`). Where the wiki gives only community-measured numbers (Talk pages, guild data pages, user research), that is flagged.

### 2.1 Controls and movement

**Default bindings** (`/Controls`)
- Three preset schemes: Mouse-movement, WASD, Gamepad. Custom binds allowed (`/Options`).
- Mouse scheme: Move = hold LMB · Attack = RMB or `Z` · Defend (shield) = hold `X` · Shield Bash = `Shift`+`X` · Dash = `Shift`+`Z` · Strafe (lock facing) = hold `C` · Switch weapon = mouse wheel or `Space` · Sprite skills = `1`–`3` · Quickslots (pickups) = `4`–`7`.
- WASD scheme: Move = `W/A/S/D` · Attack = LMB · Defend = hold RMB · Shield Bash = `Shift`+LMB · Dash = `Shift`+RMB · "Your knight will always aim in the direction of the mouse cursor" · same weapon-switch / sprite / quickslot keys.
- Gamepad: Move = left stick · Attack = A · Defend = hold RT · Shield Bash = B · Dash = LB · Strafe = hold LT · Switch weapon = Start / Back · Sprite skills = X, Y, RB · Quickslots = D-pad.
- **Auto Target** option: "automatically lock on to targets when near." Other HUD options: attack damage numbers, monster health bars, weapon selection wheel, weapon charge meter (`/Options`). Disabling auto-target lets a single bullet hit two adjacent monsters (`/Gunslinger_Guide`).

**Movement speed**
- Base run speed measured over a 51-tile straight line: 11.0 s at MSI 0 (≈ 4.6 tiles/s); 12.4 s at MSI −3, 9.8 s at MSI +3. "Each level of MSI increases running speed by about 4%." (`/Lancer_Knightz_(Guild)/Sword_Movement_Speed`, community data; `/Abilities`)
- Movement Speed Increase/Decrease (MSI/MSD) uses the 6-point Low→Maximum! scale; no MSI Unique Variants exist (`/Abilities`).
- While charging: "Most guns, bombs, and slow swords reduce movement speed by roughly 15% until the charge is used or lost" (`/Charge_attack`). Measured: Sudaruska charge 13.3 s / 51 tiles vs 11.0 s uncharged. Since 2014-12-03 all guns let the user run at full speed while charging. Vortex bombs: movement −10 while charging (`/Graviton_Vortex`). Nitronome: decreased by medium (`/Nitronome`).
- While firing: Blaster and Pulsar move at about half speed; Autogun, Needle Shot and Magnus root the knight and cannot change direction while firing (`/Blaster`, `/Pulsar`, `/Autogun`, `/Magnus`).
- Holding shield reduces movement speed; a broken shield still slows you when raised (`/Shieldbearer_Guide`). "MSD: Low" appears on some shields (`/Shield`).
- Speed Booster pickup: +movement speed for 30 s; re-pickup refreshes, doesn't stack (`/Consumables`).

**Dash** (`/Dash`) — added with Shield Bash in release 2013-05-22
- Direction: facing direction if standing still, movement direction if moving.
- "When unobstructed, the jump is five tiles long, in a straight line." Hitting an obstacle after the second square stops the dash; hitting one before the second square deflects it.
- "At the end of a dash, the knight is immune to attacks for a brief period." Nearby enemies tend to drop the knight as a target; unaware monsters can stay unaware.
- Deals no damage or status. The knight can take damage during the dash (floor traps still hurt). Can't be activated when cornered by enemies.

**Strafe**: hold the strafe key to keep facing fixed while moving (`/Controls`).

### 2.2 Health and death

- Health is in "pips"/bars. Display: >30 pips shows silver, >60 shows gold. Damage flashes purple then becomes empty outlines; recovery shows cyan then red (`/Health`). Health is tracked internally at higher precision than the UI shows (`/Talk:Damage`, community).

**Max health sources** (`/Health`, `/Abilities`, `/Tier`)
- Helmet and suit each grant per star: 0★ +0 · 1★ +0 (heat 1–4) / +1 (heat 5+) · 2★ +1/+2 · 3★ +2/+3 · 4★ +3/+4 · 5★ +4/+5. "At heat level 5 all armor gains one health point."
- Tier penalty: in Tier 1 gear 2★+ is reduced in effectiveness; in Tier 2 gear 4★+ is reduced; Tier 3 no penalty; health-bonus penalties range −1 to −4 depending on stars/heat (`/Tier`).
- Trinkets and sprite perks: up to +6 health each; UVs cannot be health bonuses (`/Abilities`). Healthy Boost perk: +1 to +6 by sprite tier (`/Perk`).
- Vitapods: pickup adds the red number on the pod as *empty* pips; only a better pod replaces the current one; lost when you leave the expedition; best current pods +21 (Shadow Lairs) (`/Vitapod`).

**Healing**
- Hearts: Small = 1 bar, Medium = 2, Large = 3; heart pads (Clockwork Terminals) refill 3; hearts drop from monsters and breakables, vanish after 120 s on the ground; each party member gets their own copy; can't be picked up at full health, except a large heart is picked up even with <3 pips missing (`/Heart`, `/Consumables`).
- Health capsules: 3 / 6 (Super) / 12 (Ultra) bars; if you are interrupted or attacked while using them you won't be healed and the capsule won't be consumed (`/Health_Capsule`).
- Poisoned knights cannot heal from hearts or capsules (`/Poison`, `/Health`).
- Full heal on entering a subtown (`/Health`). Sleep slowly regenerates small HP (`/Sleep`).

**Death and revive** (`/Reviving`, `/Revive`, `/Health`, `/Spark_of_Life`, `/Party`)
- At 0 HP the knight is defeated: cannot move or fight until revived.
- One free **Emergency Revive** per dungeon level (indicator light on portrait; resets each level). `/Reviving` says revives restore full health; `/Health` says the emergency revive restores "up to 30 max health"; treat the full-health statement as current.
- Further revives need a **Spark of Life**: 50 energy each via the death popup; 200 energy per 10 from the Supply Depot; also mission rewards/rare drops. A living knight can revive a teammate by clicking their portrait (consumes one spark).
- Revive creates an energy blast: severe stun and considerable damage to all monsters in range, then knockback (`/Reviving`, `/Stun`).
- Heat: current rules keep heat on revive; the old 30% heat loss on death was removed (`/Revive`). Fallen members do not gain the level's heat (`/Party`).
- Elevator rule: if all living members reach the elevator they may descend and every dead player is revived on the next level; fallen members get an automatic Emergency Revive at the next depth (`/Reviving`, `/Party`).

### 2.3 Shield

- Raised shield blocks incoming damage from all directions; facing is irrelevant. Inactive/broken shield gives nothing passively (`/Shield`, `/Shieldbearer_Guide`).
- Shield has its own health. Damage taken by the shield depends on the attack's damage type/status vs the shield's four defenses (Normal, Piercing, Elemental, Shadow) and seven status resistances. "Shield stats protect only the shield itself, not the knight." Each defense unit (except the first) ≈ 1.9–2.1 damage absorbed (`/Shield`, `/Shieldbearer_Guide`).
- Listed shield health: Proto Shield 5; most 3★ shields 56; top 5★ (Ancient Plate, Grand Tortoise) 141 (`/Shield` tables). Community measurement of shield HP scaling by depth (all shields identical at stratum 1 except the Omega Shell line): depth 1 = 50, 2 = 70, 3 = 91, 4 = 112, 5 = 133, 6 = 154, 7 = 175, 9 = 200, 10 = 228, 17 = 425, 18 = 475, 19 = 525, 20 = 575, 21 = 625, 22 = 675, 23 = 725, 24 = 750, 25 = 775, 26 = 800, 27 = 825, 28 = 850, 30 = 900 (`/User:BlarghBlargh`).
- Regeneration: shields quickly regenerate health if they go a few seconds without blocking. At 0 HP the shield **shatters**: disabled ≈ 8 s (can be raised but blocks nothing), then turns orange and can block again; full recovery roughly 10–15 seconds as long as no new damage is absorbed (`/Shield`, `/Shieldbearer_Guide`).
- Blocks essentially all damage and statuses, spikes, breath attacks. Exceptions: fire damage passes through if you're already burning; curse causes mild damage when shielded; shock spasms still interrupt a shielding knight (`/Shieldbearer_Guide`, `/Status`, `/Shock`).
- Shields do **not** prevent knockback (`/Shieldbearer_Guide`).
- **Shield bump**: enemies adjacent at the instant the shield is raised are pushed away; no momentum transfer between enemies; cannot bump through two layers (`/Shieldbearer_Guide`).
- **Shield cancel**: raising the shield right after an attack interrupts the animation; the first attack after blocking always restarts the combo at hit 1. **Shield charge**: hold attack while shielded, drop shield after ~0.5 s to begin charging without the opening swing (`/Shieldbearer_Guide`).
- **Shield Bash** (`/Shield_Bash`, `/Shieldbearer_Guide`): requires full shield HP; costs 50% of shield HP; launches the knight shield-first in facing direction; light damage + knockback + minor Stun; knight is not invulnerable during it. Damage scales with shield stars and stratum only (not heat): 5★: S1 21–22, S2 25–28, S3 50–49, S4 50–51, S5 55–67, S6 71–74; 0★: 4–7. Some shields carry "Double shield bash damage, MSD: Low". Tortodrone shields bash twice, second hit larger radius.

### 2.4 Weapon classes and attack patterns

**General** (`/Weapon`, `/Charge_attack`, `/Abilities`, `/Heat`)
- Three classes: Sword, Handgun, Bomb. Every weapon has a regular attack and a charge attack; bombs are charge-only.
- Charging: hold attack; ready when a bright yellow aura flashes around the knight with an audio ping; release before that = a normal attack. Taking damage halves the charge; fire damage halves it; shock cancels it outright. Cutter, Troika and Rocket Hammer charges can't be interrupted except by Shock (`/Cutter`, `/Warmaster_Rocket_Hammer`).
- Heat gives every weapon CTR Low at heat 5 and CTR Medium at heat 10.
- **ASI (Attack Speed Increase)**: 6-point scale Low(1)/Medium(2)/High(3)/Very High(4)/Ultra(5)/Maximum!(6); each level ≈ +4% attack speed (~3.6% more combos or clips per minute); affects all weapon animations incl. gun reload recovery; not available on bombs; caps at +6 across sources (`/Abilities`, `/Lancer_Knightz_(Guild)/Sword_Combos_Per_Minute`).
- **CTR (Charge Time Reduction)**: same scale; each level removes ≈ 7.5% of the weapon's baseline charge time; cap +6 (`/Abilities`).
- **Damage Bonus**: +4% of original gross damage per level (~5% net); `/Damage` says ~7% per level. Additive stacking, cap +6.
- UV tiers on weapons: Low/Medium/High/Very High only (ASI, CTR, damage vs family); no duplicate UV of the same property (`/Unique_Variant`).

**Swords** (`/Sword`, `/Swordmaster_Guide`, line pages)
- Calibur: 3-hit combo, the last hit knocking back enemies; charge = 360° spin hitting up to 3 times (`/Calibur`).
- Brandish: 3-hit combo; charge = short lunge + forward slash followed by 3 small explosions (don't cross gaps) (`/Brandish`).
- Cutter: 10-hit combo of 5 swings doing 2 hits apiece (shadow afterimage hit 0.25 s after each swing); each main swing can knock back; charge = series of hits then lunge slash, uninterruptible except Shock (`/Cutter`).
- Flourish: 3-hit — wide sweep (no movement), lunge moving 1 square, lunge moving 3 squares; charge = double thrust + slash; Piercing (`/Flourish`).
- Troika: 2-hit, each a 180° arc; hit 1 stationary 1-square reach, hit 2 steps 1 square forward, 2-square reach; charge lunges ~2.5 squares and smashes 1.5 further; delayed flash deals extra damage with heavy knockback and Stun chance (`/Troika`).
- Sealed Sword: 2-hit heavy; charge = lunging AoE that cycles a strong status each use (Fire, Poison, Shock, Freeze, Stun) (`/Sealed_Sword`). Gran Faust: hit 2 chance to Curse; charge can Curse the user, 40 s (`/Gran_Faust`).
- Spur: 3-hit, wider than normal, hits 2–3 thrust forward; charge = strong slash + short projectile hitting up to 3× (`/Spur`).
- Wrench Wand: 3-hit; charge = lunge + energy bolt with minor knockback (`/Wrench_Wand`).
- Warmaster Rocket Hammer: heavy swing, 5-tile dash hitting up to 3×, heavy finisher with big knockback; each swing explodes on hit; charge = two overhead smashes, can push teammates (`/Warmaster_Rocket_Hammer`).
- Combo rules: you can wait a fraction of a second between attacks and still build towards your finisher; holding then releasing the attack lets you move up to 1 square between hits; charging allows free movement. Final hits and charges flinch (interrupt) a monster whose telegraph aura is showing (`/Swordmaster_Guide`).
- Measured combos/min at ASI 0 (5★): Leviathan Blade 31, Cold Iron Vanquisher 32, Dread Venom Striker 24, Sudaruska 26, Flourish family 33, Rocket Hammer 24, Divine Avenger 32, Gran Faust 31, Brandish family 31–33. Charges/min at CTR 0: Leviathan 17, Glacius 18, Gran Faust 10.5 (`/Lancer_Knightz_(Guild)/...`).

**Handguns** (`/Handgun`, `/Gunslinger_Guide`, line pages)
- Unlimited ammo, but each gun reloads after its clip, during which the knight may not attack or shield. Pausing before the last shot lets the clip regenerate without a reload animation; ASI shortens reload recovery.
- Clips: Alchemer 2 · Blaster 3 · Antigua 6 · Pulsar 3 · Catalyzer 3 · Autogun 2 bursts · Magnus 2 · Tortofist 2 · Needle Shot 2 bursts of 6 · Mixmaster 3 shots of 2 bullets.
- Blaster: 8-square shot, minor knockback; charge = big detonating ball, moderate knockback (`/Blaster`).
- Alchemer: 7-square slow bolt exploding in 0.5-square radius; ricochets ~70–80° off walls/targets; no recoil; charge = 10-square bolt splitting into 2 at 135°/225° (5★: 4 ricochets), 2/3-square recoil (`/Prismatech_Alchemer`).
- Autogun: burst spread 6×3 squares, rooted; charge = wider 6×5 spread sweeping twice; ~1.3 s charge, fastest in the game (`/Autogun`).
- Needle Shot: bursts of 6 Piercing shots in 9×5; charge 15 shots 9×7 sweeping 3×, knocks small enemies upward (`/Needle_Shot`).
- Antigua: 6 fast long-range Piercing shots, minimal knockback; charge = all 6 in a stream plus a 7th phantasmal bird that pierces (`/Antigua`).
- Magnus: 8-square fast bullet, interrupts, Stun chance; 1/3-square recoil and brief root; charge = 10-square piercing bullet (`/Magnus`).
- Pulsar: 9-square slow pellet that expands at 4.5 squares and explodes with knockback; charge = pre-expanded pellet, high knockback (`/Pulsar`).
- Catalyzer: 9-square slow bolts that tag targets with orbs (dissipate ~20 s); charge orb detonates stacked orbs (`/Catalyzer`).
- Measured clips/min at ASI 0: Valiance 31, Callahan 27, Blitz Needle 21, Polaris 30, Argent Peacemaker 24, Alchemer Drivers 32, Biohazard 30, Sentenza 24.

**Bombs** (`/Bomb`, `/Bombing_Guide`, bomb pages)
- Charge-only; placed at the knight's feet, explode after a fuse. Blast Bomb: fuse ~2 s, radius ~2 tiles, very strong knockback. Nitronome: ~2 s, ~4 tiles, moderate knockback, fastest charge. Graviton/Electron Vortex: ~2 s fuse, ~2.5 tile blast (suction larger), pulls non-friendlies to centre, holds 4 s, second explosion scatters them; shocked/frozen/asleep enemies aren't flung. Dark Retribution: ~2.5 s fuse, ~3 tiles, 4 orbs orbit ~5 s. Haze bombs: tiny elemental hit + wide status cloud that disperses after several seconds. Shard bombs: explosion + shards; at most 3 shards can damage one enemy at once. Big Angry Bomb long fuse.
- Status strengths on bombs are minor/moderate/strong. Piercing bombs don't disrupt teammates; blast bombs obscure vision (`/Bombing_Guide`).

### 2.5 Damage model

- Four types: Normal (baseline), Piercing, Elemental, Shadow (`/Damage`). Weapons may mix types; each type is resolved independently then summed (`/Defense`).
- Family chart (`/Monster`, `/Damage`): Beast — weak Piercing, resists Elemental · Fiend — weak Piercing, resists Shadow · Construct — weak Elemental, resists Piercing · Undead — weak Elemental, resists Shadow · Gremlin — weak Shadow, resists Elemental · Slime — weak Shadow, resists Piercing. Normal is neutral to everyone. "Unknown" monsters are neutral to all types and ignore family damage-bonus UVs; Battlepods are neutral to everything and immune to all statuses.
- Multipliers (community): resistance means 30% damage and weakness means 166% (`/Talk:Damage`); another estimate ~+20% / −80% (`/User:Jdavis/Swords`).
- Monster damage types by tier: T1 monsters deal Normal only; T2 Normal or Normal+another; T3 any type (`/Damage`).
- Defense: net damage = gross damage − defense when gross > 2×defense; below that net < gross/2 (`/Defense`). Newer tests found defense is flat, not exponential (`/User:Antistone`). Knight defense (full set, depth 25): base ≈125, class ≈142, special ≈150, plate ≈201, heavy plate ≈301; trinket pair ≈32; double Max UV ≈52. Monster defense by stratum (weak / moderate): S1 5–9 / 10–17, S2 11–15 / 23–30, S3 19–27 / 39–53, S4 30–38 / 61–75, S5 44–57 / 89–114, S6 65–82 / 130–164 (`/Defense`).
- Damage-resistance ability tiers: 4-point (Low/Medium/High/Maximum!), each ≈10% of a standard armor piece's defense, max 40% (`/Abilities`).
- Depth: T1 = depths 0–7, T2 = 8–17, T3 = 18–28; strata S1 1–3, S2 5–7, S3 9–12, S4 14–17, S5 19–22, S6 24–28 (`/Tier`, `/Stratum`). Weapon damage tables are per stratum (e.g. Calibur hits 1–2 30–35 at S1, 70–78 at S3) (`/Calibur`).
- Difficulty (Normal/Advanced/Elite): more monster health and more intense statuses; fixed for the run; joiners use host's setting (`/Difficulty`).
- Party: each additional party member increases the monster's health by about 1/3 of its baseline (4 players ≈ 2×) (`/Party`).
- No critical-hit system is documented. Knockback: dealt by combo finishers, charges, Blaster/Pulsar shots, bombs, shield bump/bash and revive blast; frozen or sleeping targets can't be knocked back; Antigua has almost none (`/Swordmaster_Guide`, `/Gunslinger_Guide`, `/Sleep`).

### 2.6 Status effects

Seven statuses (`/Status`). Strength tiers minor/moderate/strong; only equal or stronger status may override (`/Fire`); difficulty raises intensity; Remedy Capsule cures all. Status resistance: 4 points ≈ −40% status damage, 8 ≈ −65% (`/Abilities`).
- **Fire** (`/Fire`): periodic damage for a few seconds; unaffected by poison, defense or shields once burning; halves a charge; breaks a vial being readied; extinguished by Freeze or water orb; ignites oil slicks. Fire-themed monsters immune.
- **Freeze** (`/Freeze`): can't move or turn, can still attack; any hit breaks it; monsters left to thaw take substantial damage (players don't); breaking early = no damage; prevents knockback.
- **Shock** (`/Shock`): spasms at intervals — damage + interrupt; knights always interrupted (shield stops damage, not interruption); monsters interrupted only during telegraph; adjacent allies of victim also hit; breaks blocks; cancels charges. Spasm damage is Elemental and depends on the inflicting weapon's tier; strength only sets duration; T3 source vs Construct/Undead 3–5 (S1) → 28–30 (S6).
- **Poison** (`/Poison`, `/Vial`): knights — no healing, attack ≈ −1/3; monsters — damage ≈ −45%, defense −10%, can't heal, are damaged when healed.
- **Stun** (`/Stun`): movement and attack speed reduced significantly; very short duration; immune: Oilers, Quicksilvers, Drops, Arkus.
- **Curse** (`/Curse`): knights — random weapons/vials locked, using them self-damages; base 43 s (22–59 s by resistance); monsters — damage on every attack or heal; mild damage while shielded. Most Undead and Fiends immune.
- **Sleep** (`/Sleep`): fully unresponsive until damaged; immune to knockback incl. shield bumps; slow HP regen (monsters heal a significant amount); Constructs, Polyps, Howlitzers, Vanaduke immune.

### 2.7 Consumables and pickups

- Belt: keys 4–7; only 3 pickups per slot of the same item, one slot of each type; pickups don't leave the Clockworks (`/Vial`, `/Health_Capsule`).
- Vials (Curse/Fire/Freeze/Poison/Shock/Sleep/Stun; standard/Super 2★/Ultra 4★): ready with 4–7, throw with Attack; destroy projectiles in flight without being consumed; break if you're hit while readying (`/Vial`, `/Pickup`).
- Capsules: Health 3/6/12, Remedy; not consumed if interrupted (`/Health_Capsule`).
- Barriers: ~8 s rotating status orbs (Fire/Freeze/Shock/Poison) (`/Pickup`).
- Support: Mecha Knight Kit, Auto Turret Kit, Artillery Strike (6 rockets), Ranger flare, Ocarina of Slime; mecha knight/turret activation costs 5 energy (`/Pickup`, `/Energy`).
- Boosters (Attack/Defense/Speed): 30 s, refresh not stack (`/Consumables`).
- Crowns 1/5/10/25/50, auto-collected by walking near, per-player since 2013-07-30 (`/Crowns`). Hearts and pickups are per-player copies (`/Party`).
- Heat: embers (small/medium/large) collected during a level, distributed at the elevator; lost if you leave or die before boarding; heat 1–10 per item; heat 5 = +1 HP on armor / CTR Low; heat 10 = CTR Medium (`/Heat`).

### 2.8 Battle sprites (combat side)

- Drakon (fire offense), Seraphynx (light support), Maskeraith (shadow/poison debuff). Skill 1 at start, skill 2 at level 15, skill 3 at level 50; ultimates at 90/95/100 (two choices each). Skill points augment speed/duration/intensity; sprite can't out-level the knight's rank cap (`/Battle_Sprite`).
- Harness sets damage type and cooldown: Iron Normal, Crystal Elemental (Drakon/Seraphynx), Dark Shadow (Drakon/Maskeraith), Golden Piercing (Maskeraith/Seraphynx); Advanced −5% cooldown, Elite −10% (`/Harness`).
- Perks: one active at a time; health, defense, status resistance, family damage bonus, weapon ASI/CTR/damage (Low/Medium), Swift Steps (`/Perk`).
- Drakon: Firebolt (explodes on impact, Fire), Flame Barrier (orbiting fireballs, defense boost, 7 s), Firestorm (three flame patches along a flight path). Seraphynx: Ray of Light (beam ≥5 s; Disintegration = −defense ~4 s), Heart Attack (extra heart drops on kill), Angelic Aura (party defense aura; Valkyrian = party CTR). Maskeraith: Caustic Quills (poison quills; each hit removes one for extra damage), Shadow Cloak (partial invisibility + defense ~15 s, cancels on damage/attack), Hexing Haze (miasma; each hex ~2.5 s then heavy damage).
- Skill damage tables scale by stratum and family weakness (Hexing Haze neutral 51–59 S1 → 189–199 S6). Base cooldowns are "Pending" on the wiki.

### 2.9 Other combat rules

- Telegraph/flinch: monsters show a damage-coloured aura before attacking; a flinching hit then interrupts the attack (`/Swordmaster_Guide`).
- Flashing (bug): an attack-speed change mid-animation instantly restarts the attack; charges can't be flashed since 2019-08-07.
- Gun Puppies: stationary turrets, aggro on sight or damage; T1 1 bullet, T2 3, T3 5-spread; slow turn; stagger stops firing; Freeze stops rotation, Shock spoils aim; projectiles destroyable by vials (`/Gun_Puppy`).
- Party: 1–4 knights; no friendly fire, but knockback from weapons/shield bumps moves monsters onto teammates; one member reaching the exit advances all (`/Party`).
- Gates: floors rotate ~every 5 min; stratum themes by family or status (`/Depth` → `/Gate`).

### 2.10 Gaps
- No `/Knockback`, `/Combat`, `/Capsule` pages. Base cooldowns for sprite skills, exact status durations for Fire/Freeze/Shock/Poison/Stun/Sleep, and haze/shard bomb radii are "Pending" or absent on the wiki. The fandom mirror returns HTTP 402.

---

## 3. The Clockworks and level design

Paths are relative to `https://wiki.spiralknights.com`. Where the wiki is silent, it's flagged.

### 3.1 Structure

**World model** — `/Clockworks`
- The Clockworks is planet-spanning machinery beneath Cradle; levels are organised into "towers" that shift through depths. Two region kinds: **Skydomes** (spheres containing imported worlds with own geology/weather) and **Clockwork Tunnels** (the machinery itself).
- Access: 4 randomised Arcade gates, mission gates, and elevators between floors. 30 depths (0–29). Depth 0 = Haven Arcade party lobby; Depth 29 = terminal over The Core.

**Tiers / strata / depths** — `/Clockworks`, `/Gate`, `/Stratum`, `/Clockwork_Terminal`, `/Subtown`

| Tier | Depths | Strata | Start floor | Terminal | Gear stars intended |
|---|---|---|---|---|---|
| 1 | 0–7 | S1: D1–3, S2: D5–7 | D0 Arcade lobby | D4 | 0★–1★ |
| 2 | 8–17 | S3: D9–12, S4: D14–17 | D8 Moorcroft Manor | D13 | 2★–3★ |
| 3 | 18–28(29) | S5: D19–22, S6: D24–28 | D18 Emberlight | D23 | 4★–5★ |

- Two strata per tier; each stratum is 3–5 floors; strata are separated by a **Clockwork Terminal** (safe floor: Arsenal Station to change gear, 2 heart generators, Basil recipes, Kozma Supply Depot, elevators to Haven or deeper). D23 terminal also has elevators to Shadow Lairs. — `/Clockwork_Terminal`
- **Subtowns** (D8, D18): full heal on entry; Arsenal Station; vendors; a **Spiral Warden force field** (pink = blocked, blue = passable) gates the next stratum until star-certified. Moorcroft: rank 4-2 minimum; Emberlight: rank 7-1. — `/Subtown`, `/Spiral_Warden`
- Elevator to a subtown/terminal descends automatically; other elevators offer "descend" or "return to Haven". — `/Gate`

**Gate generation** — `/Gate`, `/Gate_construction`
- Arcade always has 4 active gates in rotation. Gate = control panel + display monitor + totem (totem shows current stratum themes).
- Each of the 6 strata gets one of **11 themes**: 6 monster (Beast, Construct, Fiend, Gremlin, Slime, Undead) + 5 status (Fire, Freeze, Poison, Shock, Sleep). Random generation prevents two themes from occupying the same tier.
- Gate names: 13 colours × 14 chess/heraldic symbols = 182 combos.
- Historical (removed 2013-10): players deposited minerals in dormant gates for 8 days; stratum theme = top two mineral colours. — `/Gate_construction`

**Floor assembly and rotation** — `/Gate`, `/Levels`
- Each depth has a pool of candidate levels; the next depth's level changes in real time if there is more than one possible level for that depth. Gate map shows ◀/▶ arrows or "?" (constantly changing).
- Rotation interval usually ~5 min (3–7), full range ~1:45–20:00. "The next level is not locked in until all party members step on the lift."
- Fixed-map regions rotate in matched pairs/trios at ≤3 min (Emerald Axis ⇄ Emerald Axis II; Ritual Road I/II/III; Cravat Hall trio). — `/Jigsaw_Valley`, `/Dark_City`, `/Scarlet_Fortress`
- Randomised regions (Clockwork Tunnels, Wolver Den, Lichenous Lair, Deconstruction Zone, Devilish Drudgery, Candlestick Keep, Graveyard, Compound, Treasure Vault/Trove) are built from random **map segments** on entry; fixed regions (Jigsaw Valley, Aurora Isles, Concrete Jungle, Dark City, Scarlet Fortress, Starlight Cradle, boss strata) are hand-authored.
- Mission floors reuse arcade segment pools but guarantee scenarios near floor end; missions never spawn random Danger Rooms, Mysterious Rooms or Scenario Rooms; arcade does. — `/Clockworks`, `/Mission`
- Boss strata are permanent fixtures: Gloaming Wildwoods always in T1 stratum 2; Royal Jelly Palace and Ironclaw Munitions Factory permanent in T2; Firestorm Citadel permanent in T3.

**Party** — `/Party`
- 1–4 knights. Public / Private / Solo. Join via gate console, Party Finder, social list, or invite (invites bypass tier clearance).
- Cannot join: Treasure Vaults, Treasure Troves, boss levels, Shadow Lairs, danger-mission floors after the first combat floor; solo parties.
- Loot: every member gets their own randomly generated copy; heat only applies at level completion; one Shadow Key per party.
- Elevator rule: as long as at least one knight makes it to the lift, the entire party makes it through. Fallen members gain no heat and auto-Emergency-Revive on the next depth.

**Revives** — `/Reviving`, `/Health`
- One free **Emergency Revive** per floor (refreshes each floor; restores up to 30 HP). Beyond that: a **Spark of Life** or 50 energy; energy revives add a **Revive Blast** (damage + stun + knockback). 3-minute window before removal from the dungeon. Death loses uncollected heat.

**Elevators / energy** — `/Release_Notes_2013-07-30`, `/Energy`, `/Prize_Wheel`
- Since 2013-07-30 elevators cost no energy. In-level energy sinks: energy gate 3, Danger Room 3, Energy Mecha Knight 5, Mecha Turret 5, energy revive 50.
- **Prize wheel** spins on activating the elevator after any monster floor: materials (rarity rises with depth), crowns 5/10/25/50, hearts, full heal (rare), pickups, lockboxes, or Kleptolisk (nothing). Each knight rolls independently.

### 3.2 Difficulty scaling

**Gear gates / tier penalty** — `/Clockworks`, `/Hall_of_Heroes`, `/Player_Rank`, `/Health`
- Tier clearances (permanent): T1 auto after "Crossing the Chasm"; T2 needs 2★ certification; T3 needs 4★. Certification requires armor+helm+shield+weapon all ≥ target stars.
- Rank caps equippable stars: Recruit 0★ … Defender Elite+ 5★. Arcade tier hostable: T1 ranks 1–4, T2 ranks 5–6, T3 ranks 7+.
- Depth-based effectiveness reduction: in T1 all 2★+ gear is reduced; in T2 all 4★+; T3 none. Health-bonus penalty (T1 / T2, heat 1–4 vs 5–10): 2★ −1/−1 | none; 3★ −1/−2 | none; 4★ −2/−3 | −1/−1; 5★ −3/−4 | −1/−2.

**Monster scaling** — `/Defense`, `/Damage`, `/Party`
- Monster defence rises per depth; by stratum (weak / moderate): S1 5–9 / 10–17; S2 11–15 / 23–30; S3 19–27 / 39–53; S4 30–38 / 61–75; S5 44–57 / 89–114; S6 65–82 / 130–164.
- Damage by tier: T1 monsters deal normal-only; T2 mixed normal+typed; T3 pure typed allowed.
- Attack complexity grows with tier (Gun Puppy 1 → 3 → 5 bullets; Rocket Puppy no-homing → slight → advanced; Phantom slash → +curse shot → 3-spread; Kats bite → single shot → 3-spread).
- **Party HP scaling**: each additional party member increases the monster's health by about 1/3 of its baseline → 4 players ≈ 2× solo HP.
- Community sample solo HP ranges (incomplete draft, `/User:SK_Tactics/Enemy_Health_Testing`): Wolver 77–152, Chromalisk/Jelly Cube 165–205, Alpha Wolver 217–270, Mender 109–162 across D1–28. No authoritative formula on the wiki.
- Knight health: each bar = 40 damage; pip colours red ≤30, silver 31–60, gold 60+. — `/Damage`, `/Health`

**Difficulty modes** — `/Difficulty`
- Normal / Advanced / Elite chosen by host before start; locked mid-run; joiners inherit. Higher = more enemy HP, stronger statuses, better drop odds, trap composition changes. Advanced = pre-2013 baseline.

**Danger rooms / arenas step-up** — `/Danger_Room`: monsters usually spawn one stratum deeper stat-wise and resist the level's expected weakness.

### 3.3 Level types

- **Party/Mission Lobby (D0)** — `/Gate`, `/Vitapod`: mission lobbies have vitapod spawners; prestige reward requires starting in lobby.
- **Clockwork Tunnels** (randomised, all tiers) — `/Clockwork_Tunnels`: the "bones" of the world. 5 areas by status: Clockwork Tunnels (normal), Blast Furnace (fire), Cooling Chamber (freeze), Power Complex (shock), Wasteworks (poison). 6 monster variants in each: Wild Path (beast), Mechanized Mile (construct), Infernal Passage (fiend), Gremlin Grounds (gremlin), Slimeway (slime), Haunted Passage (undead). Always Menders, Silkwings; heavies anywhere; elites rare, one per room; minis ambush on key pickup/button press; Shankle drones common, Wisps in status areas. May contain Danger Rooms, Scenario Rooms, Mysterious Rooms.
- **Danger Room** (optional, arcade tunnels only) — `/Danger_Room`: 3 energy; single chamber, gates locked until all monsters dead, 3 waves. Reward room: 12 boxes (8 red, 4 green), 4 heart boxes. 25+ documented layouts using respawning block rings, spike-trap crosses, orbital chains, rocket blocks, busted floors, monster cages, respawn pads, a switch/door, Battlepod finale.
- **Scenario Room** — `/Scenario_Room`: rare story/bonus rooms (Geo Knight camps, Tortodrone fossils, wishing wells, statue-on-button rituals, meteor lichen waves, Gremlin workshops, chained coffins).
- **Mysterious Room** — `/Mysterious_Room`: event-only tunnel segments behind a Danger Module; themed monster waves → event tokens.
- **Battle Arena** — `/Battle_Arena`: three bouts of rising difficulty; bout 1 mandatory. Each bout: central party button locks the room and spawns the first two waves; two branches × 3 waves + final wave (spawns only when both branches exhausted). Wave table: bout 1 A: 4 theme/2 elites/4 elites, B: 2 turrets/2–4 theme+2 healers/4 turrets; bout 2 A: 2 elites/2 elites/6 theme, B: 2 elites/2 theme+2 heavies/3 elites; bout 3 A: 6 theme/4 turrets/4 heavies, B: 4 elites/2 heavies+2 healers/8 turrets. Bout 3 has 4 spike beds at cardinal points. Between bouts: 6/10/15 treasure boxes, 5 mineral spires, 4 healing panels, exit elevator. Names: Beastly Brawl, Cadaverous Clash, Fiendish Fray, Robo Rampage, Slimey Showdown, Wrench Warfare; status skins Flame Lash / Ice Maul / Iron Edge / Thunder Fist / Venom Fang.
- **Treasure Vault** (2019 revamp) — `/Treasure_Vault`: purple boxes (chance of Baby Mimic); Monster Garages, Echo Blocks, Misery Blocks, Super Explosive Blocks, one-time pressure pads; ends with Treasure Mimic miniboss. No joining. **Treasure Trove** — `/Treasure_Trove`: beast theme, few Kleptolisks, many boxes/minerals, energy doors. **Treasure Floor** — `/Treasure_Floor`: monster-free box floors ending danger/expansion missions.
- **Wolver Den** (randomised) — `/Wolver_Den`: beast; Pack Brutality, Ashes to Ash Tails, Frosty Fury, High Voltail, Raving Rabids. Wolvers/Alphas; Chromalisks, Lumbers, Polyps, Silkwings; brambles, day skydome; rain.
- **Lichenous Lair** (randomised) — `/Lichenous_Lair`: slime; Lichens (keep them from mingling), Polyps, Gun Puppies, Lumbers, Jelly Cubes; crystal blocks, brambles; starry night dome.
- **Deconstruction Zone** (randomised) — `/Deconstruction_Zone`: gremlin; Thwackers/Menders/Scorchers/Demos, Gun Puppies, Mecha Knights, Knockers; **gold-key/gold-door lock chains**, switches, crystal blocks; Energy Mecha Knight statues.
- **Graveyard** (randomised, curse) — `/Graveyard`, `/Phantom`: Zombies everywhere; grave mounds; Grim Totems; breakable tombstones; energy gates in front of most treasure; blocks/gates deliberately slow you so **Phantoms** (spawn minutes after the entrance party button; one per knight; unkillable, phase through walls) can catch up → maze design rewards speed.
- **Candlestick Keep** (randomised, dark) — `/Candlestick_Keep`, `/Grimalkin`: undead; Kats, Zombies, Howlitzers, Trojans. Very dark; embers thrown at candles (yellow ≈30 s, big radius; blue permanent). **Grimalkin rules**: spawn after a player is out of candle light 3 s, +1 every 3 s up to party size; unblockable, unkillable bite; pass through walls; won't enter lit areas; vanish after biting, after a dash/shield-bash through them, after a miss, or after time; sweat indicator on the knight when close.
- **Jigsaw Valley** (fixed) — `/Jigsaw_Valley`: construct+gremlin; sky islands; Emerald Axis I/II, Jade Tangle I/II, Perimeter Promenade I/II.
- **Aurora Isles** (fixed) — `/Aurora_Isles`: beast+slime, no status; Stone Grove, Jelly Farm I/II, Low Gardens.
- **Concrete Jungle** (fixed, poison) — `/Concrete_Jungle`: slime+undead; Blight Boulevard I/II, Totem Trouble I/II, Briar Bone Barrage (T3 finale with Toxilargo).
- **Dark City** (fixed) — `/Dark_City`: fiend+undead; Sinful Steps I/II, Plazamonium, Stygian Steeds (T3; Trojans, Pit Boss), Ritual Road I–III.
- **Devilish Drudgery** (randomised) — `/Devilish_Drudgery`: fiend "office underworld"; Devilites, Pit Boss, Yesmen, Overtimers; fiend gates.
- **Scarlet Fortress** (fixed) — `/Scarlet_Fortress`: undead+slime; Cravat Hall I–III, Spiral Court I–II, Grim Gallery; Kats, Jelly Cubes, Gun Puppies, monster cages.
- **Starlight Cradle** (fixed, sleep) — `/Starlight_Cradle`: slime; Meteor Mile I–III, Shrine of Slumber I–IV, Torporal Titan (T3 finale; Sloombargos).
- **Compound** (randomised, T2–3) — `/Compound`: floating islands mixing organic "brush" segments (small critters) and "facility" segments (large monsters); minis spawn infinitely from busted floors. Variants Ruined/Charred/Frozen/Blighted/Shocked × Chittering Burrows (scarabs) / Creeping Colony (drops) / Ravenous Warrens (bunnies).
- **Compact Area** (mission-only) — `/Compact_Area`: compressed puzzles and a centralised combat area with Battlepods; 5 sections: beginning, middle, connector, arena, end.
- **Boss strata**: Gloaming Wildwoods (T1), Royal Jelly Palace, Ironclaw Munitions Factory (T2), Firestorm Citadel (T3). **Special**: Shadow Lairs, Unknown Passage, Sanctuary, The Core (3.7). Tutorial: Crash Site / Rescue Camp. Mission-unique: Sunset Steppes (2-2), Camp Crimson (2-3).

### 3.4 Level mechanics and objects (from `/Exploration` unless noted)

**Progression gates**
- **Party Button**: large red; all players gather; locks arena rooms; starts the Phantom timer in Graveyards.
- **Button** (small red): triggers doors or monster spawns. **Rocket Button** (green): disables rocket blocks.
- **Switch**: yellow/purple = toggleable or timed; red/green = one-shot (green = already used).
- **Lever**: raises/lowers purple or yellow toggle walls (IMF). — `/Ironclaw_Munitions_Factory`
- **Pressure Pad** (knight or Heavy Statue). **Heavy-Statue Pad** (statue only). **One-time Pad** (vaults): all pads down simultaneously.
- **Door** (barred; find button/switch). **Monster Door** (kill area monsters). **Energy Door** (3 energy). **Gold Door** (carry Gold Key). **Padlocked Door** (Recon Knight hacks).
- **Force Field**: many one-way; T3 wolvers burrow through. **Lift Barrier**: blocks a player carrying an item. **Elevator**: end of every level.

**Blocks**
- Block (1 hit), Stone Block (3 hits; may hide Rock Jelly), Unbreakable, Crystal Block (same-colour touching chain shatters together; hides buttons), Ghost Block (destroying poofs all connected blocks incl. treasure boxes), Explosive (1×1), Timed Explosive (3-count), Super Explosive (Blast-Cube-style globs), Vortex Block (short pull), Echo Block (reflects damage/status), Mush Block (slow-mush), Misery Block (unbreakable spike block), Empty Rocket (2 hits), Unused Rocket (flash then 2-tile blast), Hedgehog (3 hits) / Barbed Hedgehog (1 hit, damages), Ice Barrier (3 hits, expires; monsters pass freely).
- **Respawn Pad**: perpetually produces entities; arrow-spin speed ≈ rate; darker tiles = landmine; spawn can hurt you; shielding on it usually blocks the spawn.

**Hazards**
- Brambles (grey = damage; green = damage + likely poison).
- Status grates: Fire / Freeze / Poison / Shock traps, periodic; safe when inactive. Spike Trap: periodic cones, high piercing.
- Fire Pit (water pot extinguishes); **Shadow Fire** (Firestorm Citadel; needs water from Nature-Sprite wells).
- Orbital Chain: chain orbits a pivot; gaps between orbs.
- Wheel Launcher: periodic crushing wheel; destroy from behind or block with a statue.
- Rocket Block (periodic missile; green button disables), Gun Block (fires when hit; LEDs green=ready, red=reloading), Fire Launcher (periodic flame line), Red Searchlight (walk into pool → missiles fall), Landmine (invisible; darker tiles), Barbed Wire, Swarm Spikes (rise after you step), Falling Mush (15 s slow zone).
- Rocket Puppies as hazards: slow homing rockets (T2 slight, T3 advanced), fire status. — `/Gun_Puppy`

**Carried objects** (drop on direct damage): Clay Pot (throw at switches), Fire Pot, Oil Pot (spill then ignite), Water Pot (douses fire/shadow fire), Bomb Shell, Gold Key, Heavy Statue, Ember (lights candles), Cursed Nature Sprite.

**Spawners**: Grave Mound (zombie on approach/leave), Monster Cage (random monster when broken), Busted Floor (minis), Burrow (wolvers), Bunker (gremlin entry; disable by shooting into the door), Fiend Gate (portals; destroy them), Swarm Portal, Swarm Sphere, Monster Garage (drops).

**Enemy aids**: Grim Totem (purple ring; killed zombies leave skulls, next pulse revives; indestructible, can be carried away), Swarm Source (slow field + monster defence; shrinks with damage), Healing Totem (heals enemies; colour = tier).

**Player aids**: Caged Knight (3 hits to free; fights), Energy Mecha Knight (5 energy; trap-immune; can't ride lift), Mecha Turret (5 energy or Auto Turret Kit), Heart Generator (stand to heal), Water Well, Beast Bell (stuns wolvers/bunnies; needed for Snarbolax), Candles, Information/Danger/Recon Modules, Echo Stones.

**Loot objects**: Treasure Box green (heat/crowns/pickup/vitapod/material/token/gear) vs red (heat/crowns/token; rarer) vs purple (vault), Heart Box. Breakables: tombstone, bucket, bush, fence, hydrant, lamp, mailbox, plant, tome stack, chair, cabinet. — `/Treasure_Box`
- Hearts: small 1 bar, medium 2, large 3; per-player copies; vanish after 120 s; heart pads refill continually. — `/Heart`
- Vitapods: raise max HP for one expedition; max 21. — `/Vitapod`
- Minerals: 1–2 spire rooms per level, 3 hits to free, sizes 1/2/4/6; one carried at a time. — `/Mineral`
- Pickups: capsules (3/6/12 bars), remedy, vials (7 statuses × 3 strengths), barriers (~8 s orbs), Mecha Knight Kit, Artillery Strike, Auto Turret Kit, Ranger Flare, Ocarina of Slime. — `/Pickup`

**Not on the wiki**: conveyor belts, wind/fans, moving platforms, bottomless pits are not documented as Clockworks mechanics; "edge" tiles are impassable, not fall hazards.

### 3.5 Missions system — `/Mission`, `/Player_Rank`, `/List_of_rank_missions`, `/List_of_prestige_missions`

- 122 missions: 97 rank, 24 prestige (10 event), 1 expansion, plus Arcade. Subtypes: Clockworks (PvE), Supply (turn-in), Dialogue (NPC), Hall of Heroes (certification), Danger (prestige only).
- Rewards once on first completion; items bound; must start in lobby and return via elevator.
- **Arcade vs mission**: arcade = no objectives, random gates, random Danger/Scenario/Mysterious rooms; missions = fixed floor list with guaranteed end-of-floor scenarios and mission-exclusive levels.
- **Rank ladder**: 1 Recruit, 2 Apprentice, 3 Squire, 4 Soldier, 5 Knight, 6 Knight Elite, 7 Defender, 8 Defender Elite, 9 Champion, 10 Vanguard. Prestige-mission depth by rank: Squire 4, Soldier/Knight 9, KE 14, Defender/DE 19, Champion/Vanguard 24.
- **Rank missions** (clockworks/boss, depths): R1 The Ancient Generator (D0–1), Crossing the Chasm (D1; Razwog). R2 A Revelation in Flames (D1–2), Angels from Antiquity, The Phantom Mask (D1–2), The Collector (D2–3). R3 Alien Ooze (D2–3), Toy Soldiers (D2–3), Faith in Armor (D4), Strength in Unity (D4–5), Blades of the Fallen (D4), Shadow of the Beast (boss, D5–7). R4 A New Threat (D9), Oilers in the Boilers, Frostifur Fandango, Rescues and Recycling, Shocking Sentient Sentries (D9–10). R5 Chilled to the Bone, Work for Idle Hands (D11–12), Time Enough at Last, Rise or Fall (D11–13), The Sovereign Slime (boss D14–16). R6 Axes of Evil, Plan of Attack (D14–15), High Temperature Hostages, Whipping and Mishandling, Sewer Stash (D14–16), Built to Destroy! (boss D15–17). R7 In Cold Blood, Vicious and Viscous (D19–21), Beyond the Axes of Evil, Spark and Roar (D19–22). R8 The Return of Ur, Weight of Darkness (D19–21), The Vile Engine, The Rotting Metropolis, The Great Escape (D20–22). R9 An Occurrence at Owlite Keep, The Silent Legion (D24–26; Arkus), Terminal Meltdown, Alone in the Dark, The Gauntlet (D24–26), The King of Ashes (FSC D24–28 + The Path is Sealed D29). R10 Breaking in the Recruits, Crimson Chaos, It Came From Below (D24–26), Shadowplay (Herex), Dreams and Nightmares (D24–28 → Core; Refuge treasure floor).
- **Prestige (daily)**: Clockworks (rank 3-1+; lobby + 2 combat floors, last floor family-themed; 30–90 prestige): A Pinch of Salt (slime), Assault on Machine Shop 13 (construct), Hazardous Heist (gremlin), Nature of the Beast (beast), Scared to Death (undead), White Collar Captives (fiend). Danger (4-1+; lobby + 2 combat + treasure floor; 100–180): Legion of Almire (undead), Compound 42 (gremlin/slime, fire+poison), Heart of Ice (beast/fiend, freeze; Maulos), Ghosts in the Machine (construct/undead, shock; Big Iron). Supply: Arms Appropriation, Geological Survey, Monstrous Research, Supply Delivery. Rotation: clockworks 6-day, supply 9-day, danger 4-day → 36-day cycle.
- **Expansion**: Operation Crimson Hammer (Storming the Walls → Silence the Guns → Flank the Frontlines → Clear the Gatehouse → Engines of War (Warmaster Seerus) → Aftermath).

### 3.6 Themes, biomes, tilesets — `/Stratum`, `/Gate`, region pages

| Theme | Icon colour | Regions | Hazards/notes |
|---|---|---|---|
| Beast | yellow | Wolver Den, Wild Path, Aurora Isles, Beastly Brawl, Treasure Trove | brambles, burrows, beast bells |
| Construct | brown | Jigsaw Valley, Mechanized Mile, Robo Rampage, Compact Areas, IMF | turrets, rocket/gun blocks, lumbers (stun) |
| Fiend | blue | Dark City, Devilish Drudgery, Infernal Passage, Fiendish Fray | fiend gates, Trojans, Silkwing healers |
| Gremlin | orange | Deconstruction Zone, Gremlin Grounds, Wrench Warfare, Compounds | bunkers, gold keys/doors, menders, demos/landmines |
| Slime | pink | Lichenous Lair, Slimeway, Starlight Cradle, Slimey Showdown, RJP | lichen merging, polyps, glop drops |
| Undead | grey | Graveyard, Candlestick Keep, Scarlet Fortress, Haunted Passage, Cadaverous Clash, FSC | curse, phantoms, grimalkins, grim totems |
| Fire (orange bg) | — | Blast Furnace, Charred Compound, Flame Lash | fire grates, fire pits, oilers |
| Freeze (blue bg) | — | Cooling Chamber, Frozen Compound, Ice Maul; snow | freeze grates, ice barriers |
| Poison (green bg) | — | Wasteworks, Blighted Compound, Venom Fang, Concrete Jungle | poison grates, poison brambles |
| Shock (turquoise bg) | — | Power Complex, Shocked Compound, Thunder Fist, IMF | shock grates, quicksilvers |
| Sleep (ultramarine bg) | — | Starlight Cradle only | slooms |
| Normal (grey bg) | — | plain tunnels, Iron Edge | — |

- Skydome sets: day/sun-bulb grass (Aurora, Jigsaw, Lichenous, Starlight, Trove, Wolver), starry moon-bulb (Lichenous, Dark City, Devilish), noxious-haze city (Concrete Jungle), castle/fire (Scarlet, Keep, RJP, FSC), dark forest (Gloaming), magma (FSC), electric dark (IMF). Weather: rain, snow (all freeze depths), fog. — `/Weather`
- Mineral bias per theme affects what spires drop. — `/Mineral`

### 3.7 Bosses, Shadow Lairs, special zones — `/Boss`, `/Shadow_Lair`, `/Unknown_Passage`, `/The_Sanctuary`, `/The_Core`

- **Snarbolax** (T1, Gloaming Wildwoods: Terrilous Trail → Roarsterous Ruins → Lair of the Snarbolax; beast bells stun it; Frumious Fang tokens). **Royal Jelly** (T2, Garden of Goo → Red Carpet Runaround → Battle Royale; Jelly Gems). **Roarmulus Twins** (T2, Abandoned Assembly → Warfare Workshop → The Roarmulus Twins; shock; lever toggle walls, rocket blocks, lasers; Bark Modules). **Lord Vanaduke** (T3, Blackstone Bridge → Charred Court → Ashen Armory → Smoldering Steps → Throne Room, D24–28; fire; shadow fire, water wells, wheel launchers; Almirian Seals). Each boss floor ends in a treasure room with a Recon Module; no joining on boss levels.
- **Shadow Lairs**: curse-laden mirrors — Shadow Gloaming (Rabid Snarbolax, poison), Shadow RJP (Ice Queen, frozen), Shadow IMF (Red Roarmulus Twins, fire+shock), Shadow FSC (Darkfire Vanaduke). Entry: one Shadow Key per party at the D23 terminal; no joins after boarding; double tokens; vitapods up to 21. After the boss: **Unknown Passage** (Swarm-defiled, static minimap, void monsters, zero loot, endless spawns) → **The Sanctuary** (no monsters; lair-specific 5★ shadow material; Sanctuary alchemy machine; Echo Stone) → Haven.
- **The Core** (D29): terminal overlooking the world's "heart"; reached in 9-3 The King of Ashes and 10-2 Dreams and Nightmares; Swarm, poison/stun; no prize wheel.
- Minibosses in structure: Ironwood Sentinel (Crash Site), Razwog (1-4), Collector (2-3/10-1), Sputterspark (4-3/8-2), Big Iron, Maulos (danger), Arkus (9-1), Herex (10-2), Toxilargo/Stygian Trojans/Sloombargo (T3 region finales), Treasure Mimic (vaults), Margrel (Moorcroft).

### 3.8 Readability conventions

- **Gate map icons**: background = status theme (grey normal, orange fire, blue freeze, green poison, turquoise shock, ultramarine sleep); icon = region/layout (rook = boss, gear = tunnels); icon colour = monster family. Arrows/"?" = rotation. — `/Gate`
- **Damage numbers**: grey = resisted, blue = neutral, gold+stars = weakness; damage types coloured red/yellow/green/purple (normal/pierce/elemental/shadow). — `/Damage`
- **Health pips**: red/silver/gold by total; damage shows purple-then-white; heal shows cyan; i-frames flicker. — `/Health`
- **Hazard telegraphs**: grates with inactive/active phases; round floor holes (spikes); darker tiles (landmines); red light pool (searchlight); gun-block LEDs; pinkish base (shadow fire); grey vs green thorns; X strip (lift barrier); pink vs blue force field; rotating-arrow pads; Grim Totem purple ring + "ARISE!"; lit-candle radius = safe zone; Grimalkin sweat icon; Phantom cry with doppler + red orb; Danger Module signage. — `/Exploration`, `/Zombie`, `/Grimalkin`, `/Phantom`
- **Minimap**: top-right radar; player arrow (personal colour); teammates as coloured dots; monsters as pink dots in range; icons for elevator, gold key, gold gate, NPC, objective, prize wheel; static in Unknown Passage; B-key large map overlay; Q locks HUD. — `/HUD`
- **Camera**: not documented on the wiki.

### 3.9 Gaps
- No pages for `/Level_Types`, `/Elevator`, `/Party_Lobby`, `/Lobby`. `/List_of_rank_missions` truncated after rank 8 in the fetch tool; ranks 9–10 come from individual mission pages. Per-depth crown/heat tables and an authoritative monster HP-by-depth formula do not exist on the wiki. Individual level pages mark layout/entities "pending".

---

## 4. Gear, items and progression

Sources: `W/Page` = `https://wiki.spiralknights.com/Page`. Numbers in image-only stat bars were not readable; where that happened it is said.

### 4.1 Star rating, tiers, heat, upgrading

**Star rating (0★–5★) = position in an alchemy path / general tier** (W/Unique_Variant, W/Player_Rank).
- Rank gates what you may equip: Recruit 0★, Apprentice 1★, Squire/Soldier 2★, Knight 3★, Knight Elite/Defender 4★, Defender Elite/Champion/Vanguard 5★ (W/Player_Rank, W/Arsenal).
- Star Certifications from Lt. Barrus in the Hall of Heroes: mission 4-1 → 2★, 5-2 → 3★, 6-2 → 4★, 8-2 → 5★; you must have helmet+armor+shield+one weapon of that star equipped to pass (W/Hall_of_Heroes).
- **Tiers/strata**: Tier 1 = depths 0–7 (strata 1–2, terminal at depth 4); Tier 2 = depths 8–17 (strata 3–4, terminal 13, requires Knight rank / 2★ cert); Tier 3 = depths 18–28 (strata 5–6, terminal 23, requires Defender / 4★ cert) (W/Tier, W/Hall_of_Heroes).
- **Recommended depth per star**: 0–1★ depth 1+, 2★ depth 4+, 3★ depth 8+, 4★ depth 13+, 5★ depth 18+ (W/Material/General_Acquisition).
- **Gear is nerfed in shallow tiers**: Tier 1 reduces 2★+ gear; Tier 2 reduces 4★+ gear; Tier 3 no reduction. Reduction hits attack, defence and bonuses; health-bonus penalty −1 to −4 pips by star/heat (W/Tier).
- **Weapon damage scales with depth as well as star**: every weapon page carries a 6-row "damage by stratum" table (Calibur 2★: 30–35 in S1, 70–78 in S3, then falling to 41–37 in S6 because it is under-tiered; Leviathan Blade 5★: 39–45 in S1 up to 193–203 in S6) (W/Calibur, W/Leviathan_Blade).
- Crafting cost table by star (recipe price / alchemy fee / heat prerequisite on precursor / orb type / material count): 1★ 250 / 200 / — / Flawed / 3; 2★ 1,000 / 400 / — / Simple / 5; 3★ 4,000 / 1,000 / — / Advanced / 10; 4★ 10,000 / 2,500 / precursor heat 5+ / Elite / 15; 5★ 25,000 / 5,000 / precursor heat 10 / Eternal / 20. Always 3 orbs (W/Alchemy, W/Crafting, W/Recipe).
- Canonical upgrade path: Calibur (2★) → Tempered Calibur (3★) → Ascended Calibur (4★) → Leviathan Blade (5★); side branch Ascended Calibur → Cold Iron Carver (4★) → Cold Iron Vanquisher (5★) (W/Calibur).
- Upgraded item always starts at heat level 1; bound precursor → bound result; accessories survive only if the new item has that slot (W/Alchemy).

**Heat (levels 1–10)** (W/Heat, W/Forge):
- Earned from embers dropped by monsters and boxes; banked on the elevator and split across all equipped heatable items; lost if you leave early, are dead when the party boards, or unbind the item.
- Items do not auto-level: use the Forge (U key / arsenal station) with Fire Crystals matching the item's star: Cracked 0★, Dim 1★, Warm 2★, Glowing 3★, Shining 4★, Radiant 5★.
- Crystals per level (min/med/max), 5★ example: L1→2 3/6/9 … L4→5 14/28/42 … L9→10 34/68/102; totals 0★ 12/24/36 … 5★ 151/302/453. Maximum = 100% success; minimal can drop to 20–30% at mid levels on 3–5★. Failure loses crystals, never heat. Bonuses: Heat +25%, Double Level Up (not on 9→10), Forge Prize Box.
- What levelling does: stats step up discretely each level. Weapons gain CTR Low at heat 5, CTR Medium at heat 10. Armor/helmets gain +1 health pip at heat 5. Weapon speed, status resistances and shield health never change with heat.
- Health pips from a single armor piece by star (heat 1–4 / heat 5+): 0★ 0/0, 1★ 0/1, 2★ 1/2, 3★ 2/3, 4★ 3/4, 5★ 4/5 (W/Health).
- Crystal prices: Cracked 50cr/5, Dim 125cr/5 (Vatel); Warm 85e/50, Glowing 175e/50, Shining 350e/50, Radiant 700e/50 (Supply Depot) (W/Rarity, W/Supply_Depot).

### 4.2 Weapon lines

Damage types: Normal, Piercing, Elemental, Shadow; a weapon deals one or two. Statuses: Curse, Fire, Freeze, Poison, Shock, Sleep, Stun (W/Weapon, W/Damage). All weapons: CTR Low at heat 5, Medium at heat 10.

**Swords** (W/Sword)
- **Calibur** (Normal; 3-swing combo, 3rd knocks back; charge = 360° spin, up to 3 hits, deflects). Calibur 2★ → Tempered 3★ → Ascended 4★ → Leviathan Blade 5★ (5★ recipe: 20 Light Shard, 5 Bronze Bolt, 4 Swordstone, 3 Force Dynamo, 2 Silver Coil, 1 Sun Silver; Jorin 25k or mission 8-2). Branch → Cold Iron Carver 4★ / Vanquisher 5★ (Undead High). Reskins/variants: Celestial Saber 5★ (stun on charge), Sweet Dreams 5★ (Undead Med + stun). Calibur itself: mission 3-2 "Blades of the Fallen" or Jorin 1,000cr.
- **Brandish** (Normal; 3-hit combo; charge = short lunge slash + 3 explosions at 2★, 5 at 5★; explosions don't cross gaps). Branches: Fireburst→Blazebrand→Combuster (N+E, strong fire on charge); Iceburst→Blizzbrand→Glacius (freeze); Shockburst→Boltbrand→Voltedge (shock; Krogmo recipes); Nightblade→Silent Nightblade→Acheron (N+S, no status); Cautery Sword→Advanced Cautery→Amputator (Slime High); Obsidian Edge 5★ (N+S, strong poison, Mysterious Alchemy Machine). Combuster charge vs Construct/Undead S6: 547–613.
- **Cutter** (Normal; 10-hit combo = 5 swings × 2 hits; charge = multi-hit + final lunge, uninterruptible except by shock). Cutter 2★ → Striker 3★ → Vile Striker 4★ → Dread Venom Striker 5★ (strong poison every swing); or Hunting Blade 4★ → Wild Hunting Blade 5★ (Beast High).
- **Troika** (Normal, heavy; 2-hit 180° combo; charge = 2½-square lunge + blast, heavy knockback, stun chance). Troika 2★ → Kamarin 3★ → Khorovod 4★ → Sudaruska 5★ (stun on charge; S6 charge 391–427 + explosion 427–468); Krogmo branch Grintovec → Jalovec → Triglav 5★ (strong freeze). Kamarin: Quillion 35,000cr or Izola recipe 4,000cr.
- **Flourish** (Piercing; wide sweep + 2 narrow lunges advancing 1 then 3 spaces; charge = double thrust + slash, or at 5★ three rapid lunges with long cooldown). Flourish → Swift → Grand → Final Flourish (no status); Rigadoon → Daring → Fearless Rigadoon (stun); Flamberge → Fierce → Furious Flamberge (fire).
- **Sealed Sword** (Normal, 2-hit heavy; charge = lunging AoE with rotating random status). Brinks, 20 Jelly Gems, 3★. → Avenger 4★ → Divine Avenger 5★ (N+E; charge = wide swing + 3 sword-shaped beams that detonate, pierce gaps) or Faust 4★ → Gran Faust 5★ (N+S; curse on 2nd hit; charge beam can curse the user 40 s). 5★ recipes 25,000cr from Basil depth 23.
- **Spur / Winmillion** (Normal; wide 3-hit, each swing emits a projectile at 4★+; charge = 360° swing + energy disk hitting up to 3×). Spur 2★ → Arc Razor 3★ → Winmillion 4★ → Turbillion 5★ (charge fires vortex projectile).
- **Snarble Barb / Thorn** (Piercing; Flourish-style combo; charge = spread of 5 thorns at 2★, 8 spikes in 75° arc + phantom Snarbolax bite at 5★). Snarble Barb 2★ (Brinks, 10 Frumious Fangs) → Twisted Snarble Barb → Dark Thorn Blade → Barbarous Thorn Blade 5★.
- **Fang of Vog** 5★ (N+E; 3 strikes with growing reach; every hit good chance of moderate fire; charge = 360° flame ring up to 4 hits, strong fire, high chance to burn the user). Brinks, 40 Almirian Seals, bound.
- **Rocket Hammer** (Elemental; 3 swings, 2nd dashes 5 tiles hitting 3×, explosions on contact; charge = two overhead smashes, uninterruptible). Prototype → Stable → Warmaster; Operation Crimson Hammer rewards.
- **Wrench Wand** 2★ (Normal; charge = lunge + energy bolt, triple dmg on direct hit). Quillion 7,500cr.
- 0–1★ starters: Proto Sword, Beast Basher, Hatchet, Slime Slasher, Robo Wrecker; 1★ Big Beast Basher, Bolted Blade, Heavy Hatchet, Hot Edge, Static Edge, Super Slime Slasher, Thwack Hammer.

**Handguns** (W/Handgun)
Reload after N shots; unlimited ammo. Styles: Blaster, Alchemer, Autogun, Antigua, Magnus, Pulsar, Catalyzer, Shard Cannon (Tortofist), Mixmaster, Slicer.
- **Blaster** (Normal; 3 shots, 8-square ball, minor knockback, half move speed while firing; charge = big ball, 9 squares, detonates, recoils user ⅔ square). Blaster 2★ → Super → Master → Valiance 5★. Siblings: Elemental Blaster→Fusion→Arcana (E); Pierce→Breach→Riftlocker (P); Shadow→Umbral→Phantamos (S). Valiance S6 108 basic / 286–313 charge.
- **Alchemer** (Elemental or Shadow; 2 shots; bullets ricochet twice; charge splits into 4 on impact). Firotech/Cryotech/Voltech/Shadowtech/Prismatech Alchemer 2★ → Mk II 3★ → Firo/Cryo/Volt/Shadow/Prisma Driver 4★ → Magma/Hail/Storm/Umbra/Nova Driver 5★ (fire/freeze/shock/—/—). Nova Driver S6 198–220 / 383–431.
- **Autogun** (Normal/Piercing; cone burst of 6, 2 bursts per clip, can't move while firing; charge = 15-shot sweeping burst). Autogun 2★ → Needle Shot → Strike Needle → Blitz Needle 5★ (P); Toxic → Blight → Plague Needle (P, strong poison, Krogmo); Pepperbox → Fiery → Volcanic Pepperbox (N, fire); Dark Chaingun → Black Chaingun → Grim Repeater (S). Blitz S6 113–127 per bullet.
- **Antigua** (6-shot clip; charge = 6-shot stream + 7th / at 5★ five shots + giant eagle ≈2.5× dmg that pierces). Antigua 3★ (Brinks 20 Jelly Gems, P) → Silversix → Argent Peacemaker 5★ (pure Elemental, Undead High); Blackhawk → Sentenza 5★ (pure Shadow, Gremlin High); Raptor → Gilded Griffin 5★ (P, Fiend High); Obsidian Carbine 5★ (S, poison, Mysterious Machine).
- **Magnus** (2 shots, fast bullet 8 squares, interrupts, stun chance, ⅓-square recoil; charge = piercing 10-square slug). Magnus 3★ (P) → Mega Magnus → Callahan 5★ (P, stun; S6 217–241 / 414–467) or Iron Slug 5★ (N, blast-radius bullets, charge launches user back); Tundrus → Mega Tundrus → Winter Grave (S, freeze).
- **Pulsar** (3 slow pellets that expand halfway and explode with knockback; damage grows with distance). Pulsar 2★ (Brinks 15 Bark Modules) → Heavy → Radiant → Supernova 5★ (N); Kilowatt → Gigawatt → Polaris (E, shock); Flaming → Blazing → Wildfire (fire); Freezing → Frozen → Permafroster (S, freeze).
- **Catalyzer** (3 slow tag-shots, 9 squares; charge orb detonates all tags on the target; tags expire 20 s; anyone with any Catalyzer can detonate). Catalyzer 2★ (Brinks 15 Bark Modules) → Industrial → Volatile → Neutralizer 5★ (N); Toxic → Virulent → Biohazard 5★ (S, poison on charge).
- **Tortofist / Shard Cannon** (2 shots, each lunges the knight forward; charge = 6 crystals landing 3–4 tiles ahead as a damaging wall). Buster 3★ → Cannon 4★ → Savage Tortofist (P)/Gorgofist (S)/Omega Tortofist (E)/Grand Tortofist (N) 5★; Mysterious Alchemy Machine, 12 Ancient Shells + 5,000cr.
- **Mixmaster** 5★ (E + shock; 3 shots × 2 spiralling bullets that boomerang if they miss; Confection Prize Box only). **Slicer** line: Slicer 2★ → Twicer → Thricer → Mandolin 5★ (N, stun).
- Starters: Proto Gun, Stun Gun, Punch Gun (0★); Frost Gun, Pummel Gun, Super Stun Gun, Zapper, Spitfire, Chilling Duelist (1★).

**Bombs** (W/Bomb)
Charge-only; ~2 s fuse unless noted; bombs cannot take ASI UVs.
- **Blast** (Normal, powerful knockback, ~2-tile radius at 2★, ~4 at 5★). Proto Bomb 0★ → Blast Bomb 2★ → Super → Master → Nitronome 5★ (fastest charging bomb, S6 217–230) or Big Angry Bomb 5★ (stun) / Irontech Bomb 4★ → Destroyer 5★ (stun); Deconstructor 3★ → Heavy Deconstructor 4★ (Construct High).
- **Haze / Vaporizer** (Elemental cloud, ~4-tile radius, 5 s, minor status; small 1.5-tile explosion). Fiery/Freezing/Toxic Vaporizer, Slumber Smogger, Static Capacitor, Haze Bomb 2★ → Mk II → Atomizers 4★ → Ash of Agni (fire), Shivermist Buster (freeze), Venom Veiler (poison), Torpor Tantrum (sleep), Voltaic Tempest (shock), Stagger Storm (stun; Krogmo) 5★.
- **Vortex** (pulls all enemies to centre, holds 4 s, second explosion; ~2.5-tile blast, suction larger; −10 move speed while charging). Graviton Charge 3★ → Graviton Bomb → Graviton Vortex 5★ (Shadow) → Obsidian Crusher 5★ (strong poison); Electron Charge → Electron Bomb → Electron Vortex (E, strong shock; Krogmo 50/100/150 coins); Celestial Vortex 5★ (E, fire).
- **Spine Cone / Spike Shower** (Piercing blast, ~3–4 tile, slight knockback). Spine Cone 2★ (Brinks 10 Frumious Fangs) → Twisted Spine Cone → Spike Shower → Dark Briar Barrage 5★ (S6 vs Beast/Fiend 283–312).
- **Shard bombs** (~5 s fuse; 1.5-tile core then ring of 8 shards at ~3.5–4.5 tiles that detonate ~3 s later; charging barely slows movement). Shard (N) / Crystal (E) / Dark Matter (S) / Splinter (P) Bomb 2★ → Super → Heavy → Deadly 5★. Specials: Rock Salt → Ionized Salt → Shocking Salt Bomb 5★ (S, shock, Slime Very High); Sun Shards → Radiant → Scintillating Sun Shards 5★ (P, stun/shock, Fiend Very High).
- **Dark Reprisal / Dark Retribution** 5★ (Shadow; after detonation 4 orbs orbit the 3-tile radius for ~5 s; 2.5 s fuse). Dark Retribution is the Crimson Hammer T3 reward.
- 1★ status bombs: Cold Snap (strong freeze), Firecracker (strong fire), Static Flash (strong shock), all Normal.

### 4.3 Armor and helmet lines

Each piece has Normal/Piercing/Elemental/Shadow defence, status resist/vulnerability, and optional abilities. Helmet abilities mirror the armor of the same set. 5★ pieces show ≈85 (secondary type), 101 (primary), 109 (Azure Guardian/Grey Feather primary) (W/Helmet); depth-25 values for a 5★ armor: base 125, class 142, special 150, plate 201, heavy plate 301 (W/Defense). Each 5★ piece gives +4 pips (heat 1–4), +5 (heat 5+).
- **Wolver → Dusker → Ash Tail → {Skolver, Vog Cub, Snarbolax}**: Skolver: Normal+Piercing, Freeze resist, Sword DMG Medium. Vog Cub: Normal+Elemental, Fire resist, Sword ASI Medium. Snarbolax Coat: Normal+Shadow, Freeze+Poison resist, Sword DMG Medium; Sanctuary Alchemy Machine.
- **Cobalt → Solid → Mighty Cobalt → {Azure Guardian, Almirian Crusader, Vitasuit Deluxe}**: Azure Guardian Normal+Piercing, no abilities; Almirian Crusader Normal+Shadow, Curse resist, Fire weak (Sanctuary). Cobalt is a mission 3-x reward.
- **Magic Cloak → Elemental → Miracle Cloak → {Divine Mantle, Chaos Cloak, Grey Feather Mantle}**: Divine: Elemental+Shadow, Curse/Fire/Shock resist, helm Fiend DMG Medium. Chaos: Normal+Elemental, CTR Medium + DMG Medium (all weapons), −3 to every status. Grey Feather: Normal+Elemental, Fire/Shock resist.
- **Demo: Spiral → Fused → Heavy Demo → {Bombastic, Mad Bomber, Volcanic Demo, Mercurial Demo}**: Mad Bomber: Bomb CTR Medium + Bomb DMG Medium, weak to Fire/Freeze/Poison/Shock. Volcanic Demo: Fire resist, Bomb CTR Medium. Mercurial Demo: MSI Low + Bomb DMG Low, Shock resist (Sanctuary).
- **Gunslinger Sash (3★) → Sunset Duster (4★) → {Justifier, Nameless, Shadowsun, Deadshot}**: Justifier: Stun resist, Handgun ASI Medium. Nameless: Freeze resist, Handgun ASI Medium. Shadowsun: Normal+Shadow, Poison resist, Handgun DMG Medium. Deadshot: Curse resist, Handgun ASI Low + Undead DMG Medium.
- **Scale → Drake → Wyvern → Dragon Scale (→ Radiant Silvermail)**: Dragon Scale: Piercing+Elemental, Fire+Poison resist, Beast DMG Medium. Radiant Silvermail: Piercing+Shadow, Curse/Poison resist, Undead DMG Medium.
- **Chroma Suit → Salamander → Arcane/Volcanic Salamander → Virulisk → Deadly Virulisk**: Deadly Virulisk: Poison resist, Slime DMG Medium.
- **Plate → Boosted → Heavy Plate → {Ironmight, Volcanic Plate}; Ancient Plate** (Brinks, 30 Almirian Seals each piece): Normal-heavy; Ironmight/Volcanic: ASD Low, Stun resist, Sleep weak; Ancient Plate: Health +7/+8, ASD Low, MSD Low.
- **Quicksilver Mail (3★, Brinks 20 Bark Modules) → Charged Quicksilver → Mercurial Mail**: Normal+Elemental, Shock resist, MSI Low.
- **Jelly Mail → Brute Jelly (Brinks 15 Jelly Gems) → Rock Jelly → {Royal Jelly, Ice Queen}**: Royal Jelly: Normal+Piercing, Sleep+Stun resist; Ice Queen: Freeze+Stun resist (Sanctuary).
- **Skelly → Scary → Sinister → Dread Skelly Suit**: Normal+Shadow, Freeze+Poison resist.
- **Black Kat Raiment** 5★ (Mysterious Machine): Normal+Shadow, Freeze resist, weak to Curse/Fire/Shock/Poison, DMG High (all) + MSI Low; Kat Claw/Eye/Hiss Raiments give Sword/Handgun/Bomb ASI-or-CTR Low + DMG Low.
- **Sacred Falcon/Firefly/Grizzly/Snakebite** variants: Handgun CTR/ASI Low + family DMG Medium by variant. **Heavenly Iron** (Sanctuary): DMG Low + Fiend DMG Low. **Valkyrie Mail**: Fiend DMG Medium. **Starlit Hunting Coat / Demo Suit**: Sword DMG Med / Bomb CTR Med + Slime DMG Low.

### 4.4 Shields (W/Shield)

- Mechanics: hold to block from all directions; shield health drains by incoming damage vs shield defence; at 0 it shatters; regenerates in ~10–15 s if untouched; shield bash; shield health never grows with heat.
- Lines: Defender 2★ → Great → Mighty → **Aegis** 5★ (Normal+Piercing+Shadow, no status); Owlite 2★ → Horned → Wise → **Grey Owlite** 5★ (Normal+Elemental, Fire+Shock resist); Skelly → Scary → Sinister → **Dread Skelly** (Normal+Shadow, Freeze+Poison resist); Jelly → Brute → Rock → Royal Jelly (Sleep resist); Scale → Drake → Wyvern → Dragon Scale (Fire+Poison resist); Plate → Boosted → Heavy Plate → Ironmight/Volcanic Plate (Normal 141); Ancient Plate Shield (Brinks 30 seals); Bristling Buckler 2★ (10 Frumious Fangs, Sword DMG Low) → Twisted Targe → Dark Thorn → **Barbarous Thorn** 5★ (Sword DMG Medium); Blackened Crest 4★ (30 seals) → **Crest of Almire** 5★ (Normal+Shadow, Fire+Shock resist); **Swiftstrike Buckler** 3★ stand-alone (ASI High); Breakers 1★→3★ (Fire/Ice/Volt/Circuit) Basil-only; Shells (Tortodrone lines, 5★ Omegaward/Gorgomega/Grand Tortoise/Savage Tortoise) with double shield-bash damage + MSD Low; Scarlet Shield 3★ +20 health; Omega Shell 5★ balanced; Celestial (E+S); Power Mitt; Teddy Bear Buckler.
- Category-page numbers: Volcanic/Ironmight/Ancient Plate 141 Normal; Heavy Plate/Mighty Shell 123; Boosted Plate/Stoic Shell 70; Plate Shield 65; Force Buckler 16; Proto/Iron Buckler 5–12.
- Shield UVs: only Normal/Piercing/Elemental/Shadow defence via Punch; status UVs only from crafting (W/Punch).

### 4.5 Trinkets and bonus stacking

- Trinkets need slots: both slots locked by default, unlocked with Trinket Slot Upgrades, 150 energy for 30 days; max 2 active (W/Trinket_Slot_Upgrade).
- **Bonus levels are integers**: Low +1, Medium +2, High +3, Very High +4, Ultra +5, Maximum! +6 for ASI, CTR, Damage Bonus, MSI. Sources add (Medium +2 & High +3 = Ultra +5) and cap at +6. Per level: ASI ≈4% speed, CTR ≈7.5% of base charge, DMG ≈4–5% gross, MSI ≈4%. Defence/status resist use a 4-step scale Low/Medium/High/Maximum (+1…+4); each Damage-Resistance level ≈10% of standard armor defence (W/Abilities, W/Damage).
- UVs: weapons Low–Very High only; armor Low/Medium/High/Maximum only; Ultra/Maximum on weapons only via combined gear (W/Unique_Variant).
- Trinket catalogue (W/Trinket): Health: Heart Pendant 0★ +10 → Dual +20 → Tri +30 → Tetra +40 → Penta-Heart 4★ +50 (Krogmo Machine); True Love Locket 5★ +60; Gift of Autumn / Grand Solstice Ring 5★ +40. Krogmo modules: Slash / Quick Strike / Sword Focus (Sword DMG / ASI / CTR), Trueshot / Quick Draw / Handgun Focus, Boom / Bomb Focus; 4★ = Low, Elite 5★ = Medium. Brinks spark-token lines (2★–5★ for 5/20/50/100 tokens): Hearthstone Pendant (Freeze), Jelly Band (Piercing def), Katnip Pouch (Sleep), Silver Amulet (Curse), Skelly Charm (Shadow def), White Laurel (Poison), Crystal Pin (Elemental def), Driftwood/Redwood/Ironwood/Wyrmwood Bracelet (Shock), Wetstone Pendant (Fire); 5★ status pendants = resist Medium. Misc: Daybreaker Band (Health +1, CTR Low, Slime DMG Low), Somnambulist's Totem (MSI Low), Misplaced Promissory Note.
- Defence page: a trinket pair ≈ 32 defence, double-Max UV ≈ 52 at depth 25 (W/Defense).

### 4.6 Unique Variants and special items

- UV = extra ability not on all copies; max 3 per item; no duplicate type. Weapon UVs: ASI (not bombs), CTR, DMG vs Construct/Gremlin/Fiend/Beast/Undead/Slime. Armor/helm/shield UVs: +type defence, +status resist. Crafting chance "low", ≈10% on bombs; observed level split Low 65.7%, Med 21.3%, High 7.4%, VH 5.6%. On upgrade you may transfer existing UVs (blocks new rolls) or discard them for a fresh roll (W/Unique_Variant).
- **Punch** (Bazaar) rerolls: 1 UV 20,000cr, 2 UVs 75,000cr (lock 1), 3 UVs 225,000cr (lock 2); Variant Tickets from prize boxes do the same (W/Punch).
- **Punkin**: Dark Harvest Festival; Punkin King in Clockwork Tunnels party rooms ("TRICK"/"TREAT"), Candy Tokens → Maskwell masks; Punkin Sprout 4★ material = 20 Candy Tokens; Maskeraith (Punkin) pod from the Mysterious Machine (W/Punkin_King, W/Dark_Harvest_Festival).
- **King Krogmo**: Coliseum (Lockdown, Blast Network 200cr entry); 1 Krogmo Coin per finished match, +1 for winning, boosters to 7; Bombhead Masks 150 coins; Krogmo Alchemy Machine crafts trinkets without recipes (W/Coliseum, W/Krogmo_Coin, W/Sullivan).
- **Reskins**: separate items with identical combat stats (Scissor Blades = Leviathan Blade, Caladbolg = Combuster, Honor Guard = Defender, Peppermint Repeater = Grim Repeater) (W/Reskin).
- **Shadow Lair** items: Sanctuary Alchemy Machine (end of any Shadow Lair, no recipes, all bind): Almirian Crusader, Arcane Salamander, Heavenly Iron, Ice Queen, Mercurial Demo, Snarbolax sets. Entry needs a Shadow Key (1,800 energy / Iron Lockbox) (W/Sanctuary_Alchemy_Machine, W/Shadow_Lair).
- **Mysterious Alchemy Machine**: Kat cowls/raiments, Obsidian Edge/Carbine/Crusher, Winterfest reskins, Tortofist guns and Tortoise shields, Punkin pod; no recipes (W/Mysterious_Alchemy_Machine).

### 4.7 Alchemy and crafting sources

- Steps: learn recipe (permanent, unlimited uses) → gather materials + 3 orbs → Alchemy Machine anywhere in Haven; never fails (W/Recipe, W/Crafting).
- Orbs: Flawed 1★ 10e/3, Simple 2★ 50e/3, Advanced 3★ 200e/3, Elite 4★ 400e/3, Eternal 5★ 800e/3; also loot by stratum (W/Rarity).
- Material tiers & vendor sell price: 0–1★ 1cr (stratum 1), 2★ 5cr (S2), 3★ 10cr (S3), 4★ 25cr (S4), 5★ 50cr (S5–6). Material count per recipe: 5★ = 20 common shard + 5/4/3/2/1 of rising rarity (W/Material).
- Recipe sources: **Basil** (terminals d4: 1–2★; d13: 2–4★; d23: 4–5★; 6–25 random recipes; only source for Breaker shields and boss-token lines) unbound; **Vatel** (Bazaar, 1–2★) unbound; **Hall of Heroes** (rank 4-1+): Jorin (Cobalt/Calibur/Defender), Daxen (Gunslinger), Remi (Bomber), Echo (Striker/Spur/Swiftstrike), Izola (Guardian/Troika), Zebulon (Scale/Virulisk), Archilus (Owlite/Cloak), Walkon (Jelly), Sylvin (Skelly), bound, stock by rank; **Sullivan** Krogmo recipes 50/100/150 coins for 3/4/5★ (W/Basil, W/Vatel, W/Hall_of_Heroes, W/Sullivan).
- Ready-made gear: Quillion (swords), Ricasso (guns/bombs), Greave (armor), Kragen (shields) in the Bazaar; Supply Depot bound gear 65e (1★) … 3,500e (5★) (W/Vendor, W/Supply_Depot).
- **Binding**: unbound on drop/craft; binds on equip; 4–5★ upgrades arrive bound; **Vise** unbinds for energy 1★ 100, 2★ 200, 3★ 600, 4★ 1,800, 5★ 4,000, resets heat to 1 (W/Equipment, W/Vise).
- **Token trade-ins (Brinks)**: Frumious Fang (Snarbolax): Bristling Buckler/Snarble Barb/Spine Cone 10; Jelly Gem (Royal Jelly): Rock Salt 2, Brute Jelly set 15 each, Antigua/Sealed Sword 20; Bark Module (Roarmulus Twins): Catalyzer/Pulsar/Static Capacitor 15, Quicksilver Helm/Mail 20; Almirian Seal (Vanaduke): Dark Ember 25, Ancient Plate pieces & Blackened Crest 30, Fang of Vog 40; bosses drop 1–4 tokens (6–8 in Shadow Lairs). Forge/Grim/Primal Sparks buy materials 2/5/10/20 by star and trinkets 5/20/50/100 (W/Token, W/Brinks).
- Event tokens: Candy → Maskwell; Winter Wishes → Randolph; Cake Slices → Maskwell; Ancient Pages → Montague; Apocrean Sigils → Obelisk (W/Token).

### 4.8 Economy

- **Crowns**: loose drops, treasure boxes, monsters, PvP wins, selling; coins 1 / 5 / 10 / 25 / 50 (W/Crowns).
- **Energy**: mist + crystal merged 2013-07-30 into one currency. Sinks: energy gates & danger rooms 3, mecha knights/turrets 5, guild creation 500, Spark of Life 50 (10 for 200), unbinding, slots, orbs/crystals, Evo Catalysts 125/250/525, Reset Star 2,000, Heat Amplifier 800/2 days, Krogmo Booster 300/24 h, name change 3,500, Silver Key 750, Shadow Key 1,800, sprite pods 2,100 (W/Energy, W/Supply_Depot). Elevators are no longer charged (W/Elevator_Pass).
- **Energy Depot**: buy energy for cash; player market trades crowns↔energy in lots of 100, offers last 10 days, seller pays 2% tax (W/Energy_Depot).
- **Auction House**: listing fee = max(star-based 5–250cr, 5% start bid, 0.5% buyout) × duration multiplier (12 h ×1.2, 1 d ×1.5, 2 d ×2); 10% commission; min bid step 5%; buyout delivers via mail (W/Auction_House).
- **Supply Depot** (Kozma / K key): rarities, orbs, slots, keys, bound star-gear by rank, flash sales (W/Supply_Depot).
- **Prize Boxes**: 92 listed; contain accessories, costumes, equipment, reskins, furniture, UV tickets, sprite food; only the Forge Prize Box is permanent (W/Prize_Box). Lockboxes (Iron, Silver, Gold, Slime) need keys (W/Lockbox).

### 4.9 Battle sprites (progression side)

- Three families: Drakon (fire offence), Seraphynx (support), Maskeraith (poison/debuff). Chosen at mission 2-x "An Eternal Bond"; extra pods 2,100e (W/Battle_Sprite).
- Levels 1–100 (+5 hidden perk levels); skill 2 at 15, skill 3 at 50; Evo Catalyst at 14 (125e), Advanced at 49 (250e), Ultimate at 89/94/99 (525e each); ultimates at 90/95/100, each a 2-way choice → 27 final looks (W/Evo_Catalyst).
- Skills: Drakon Firebolt / Flame Barrier / Firestorm; Maskeraith Caustic Quills / Shadow Cloak / Hexing Haze; Seraphynx Ray of Light / Heart Attack / Angelic Aura; each has 3 augments bought with skill points.
- Perks: random at non-skill levels; defence shields, status resists, family DMG bonuses, weapon ASI/CTR/DMG, Swift Steps, Healthy Boost up to +6 pips (W/Perk).
- Feeding: appetite 0–5, regen ≈5/h; favoured food Mote/Dust/Stone/Orb/Star (1–5★) per family, or raw materials; ≈65 3★ / 35 4★ / 20 5★ materials per level (W/Sprite_Food).
- Harnesses (Riley, Lab): Iron (Normal), Crystal (Elemental), Dark (Shadow), Golden (Piercing), each 8k/32k/128k for 0/5/10% cooldown (W/Harness).

### 4.10 Loadouts, slots, arsenal

- Equipment slots: helmet, armor, shield, weapons, trinkets, plus costume slots and a sprite (W/Equipment).
- Weapon slots: 2 base, up to 4 via Weapon Slot Upgrades (250e / 30 days, max 2 active). Trinket slots: 0 base, 2 via 150e/30-day upgrades.
- Loadouts (L key): PvE loadouts switch only in Haven, terminals, subtowns; PvP loadouts switch inside Lockdown bases; name ≤20 chars (W/Loadout).
- Arsenal (I key): unlimited storage; tabs Sword/Handgun/Bomb/Armor/Helmet/Shield/Trinket/Mineral/Material/Recipe (+Accessory, Costume, Sprite, Key, Rarity, Ticket, Token, Usable) (W/Arsenal). Up to 3 knights per account (W/Knight).

### 4.11 Cosmetics

- **Accessories**: 11 slots (Helmet Top/Brow/Front/Back/Side; Armor Front/Back/Rear/Arms/Ankle/Aura); Bechamel attaches free; remove = destroy (free) or recover with energy (3,500–10,000 by slot) (W/Accessory).
- **Costumes**: helmet/armor/shield costume slots; no stats; bind permanently (W/Costume).
- **Personal colour**: 25 colours, chosen at creation; Vatel 50,000cr; drives prismatic gear, minimap arrow, badges (W/Personal_Color).
- **Knight creation**: helmet/armor + design colour, up to 2 accessories, height, eye shape, personal colour; name 4–18 chars; height/eyes changeable at Vatel for 50,000cr (W/Starting_out, W/Knight).
- Starter kit from early missions: Proto Sword/Gun/Bomb/Shield, Cyclops Cap, Robo Wrecker, Fencing Jacket, Slime Slasher.

### 4.12 Gaps
- No pages for `/Star`, `/Ability` (used `/Abilities`), `/Damage_Bonus`, `/Attack_Speed_Increase`, `/Charge_Time_Reduction`. `/Loadout` gives no slot count, `/Health` no base HP, `/Shield` shield-health column unreadable. Individual armor/shield pages store defence numbers in images.

---

## 5. World, UI, party, PvP, story and events

Paths are relative to `https://wiki.spiralknights.com` (`[/Party]` = https://wiki.spiralknights.com/Party).

### 5.1 World and story

- Free-to-play co-op MMOG, Three Rings → Grey Havens (2016), published by SEGA; Java client; GDC Online Best Online Game Design 2011 `[/Spiral_Knights]`.
- Cradle: the planet; elaborate machinery inside called the Clockworks; two native lifeforms: Strangers and Gremlins `[/Cradle]`.
- Clockworks = 30 depths (0–29); levels stacked into "towers" that move through machinery; elevators connect levels; Haven's four Arcade gates catch passing towers; gate map shows movement in real time `[/Clockworks]`.
- Regions include Skydomes (spheres containing parts taken from other worlds) and Clockwork Tunnels; Alpha Squad's Euclid speculated the Clockworks harvest alien worlds; Feron: Cradle is "hundreds of massive slabs of other worlds" `[/Clockworks]` `[/Recon_Module]` `[/Becoming_a_Champion]`.
- 35 named regions incl. Aurora Isles, Candlestick Keep, Clockwork Tunnels, Compound, Concrete Jungle, Dark City, Deconstruction Zone, Devilish Drudgery, Graveyard, Jigsaw Valley, Lichenous Lair, Scarlet Fortress, Starlight Cradle, Treasure Trove/Vault, Wolver Den, Unknown Passage, The Sanctuary, The Core, plus the four boss regions and towns `[/Category:Regions]`.
- Spiral Order existed before the crash on Isora, fought the Morai; the Skylark traced an energy source to Cradle, was attacked by surface fire, its Tearium core exploded; Captain Ozlo ordered evacuation via escape pods `[/Spiral_Order]` `[/Skylark]`. Survivors: Rescue Camp → Haven, a Stranger settlement; Spiral HQ's goal is to reach the Core's power signature `[/Spiral_HQ]`.
- Key figures: Kora (Intel Agent, comlink briefer), Feron (Arcade lieutenant, Core-as-prison theory), Vaelyn (Core Terminal research), Rhendon (tutorial guide), Greta (Rescue Camp), Virgil (chasm warden), Desna (Recon Rangers), Hahn (Chief Biotech); Alpha Squad: Euclid, Grantz, Parma, Rulen, who left recon modules as breadcrumbs `[/Kora]` `[/Feron]` `[/Alpha_Squad]`. Arkus: Guardian Knight turned Trojan-like miniboss at depth 26 `[/Arkus]`.
- Gremlins build and repair the Clockworks on orders from the Core; ruled by King Tinkinzar via the Crimson Order (nine members; Seerus the Warmaster, Herex the exile allied with the Swarm, Razwog the Schemer); Outcasts founded Emberlight `[/Gremlin]` `[/Crimson_Order]` `[/Emberlight]`.
- Strangers: friendly natives, tall, cloaked, masked; call crowns "shinies" `[/Stranger]`.
- The Artifact: taken from Razwog's Battle Pod (1-2), stored in the Lab, stolen by Herex (4-2), used to awaken the Swarm in Firestorm Citadel (10-2) `[/The_Artifact]`.
- Swarm: black pixels leeching the Core; Swarm Sources buff monsters/slow players; Void variants `[/Swarm]`. Unknown Passage: Swarm-defiled depth, static minimap, no crowns/heat/materials `[/Unknown_Passage]`. Sanctuary: grants a 5★ shadow material per boss; Echo Stones say the worlds were "created to protect" something and twisted by "the Architect" `[/Sanctuary]`.
- Ending (10-2 Dreams and Nightmares, D24–28; final floor Refuge, no combat, 41 treasure boxes): "The Sleeper" was created to protect the Core; the Swarm breached it; Grantz died, Euclid stayed to fight the Swarm, Rulen vanished; the Core must stay sealed `[/Refuge]` `[/The_Sleeper]`.

### 5.2 Haven

- Four districts: Town Square (centre), Arcade (N), Bazaar (W), Garrison (E); multiple instances chosen via minimap button `[/Haven]`.
- **Town Square**: Auction House, two Alchemy Machines, Sprite Food machine, Advanced Training Hall; NPCs Kozma (Supply Depot), Energy Stranger, Hailoh (greeter), Warnel (Snipes), event NPCs at the fountain `[/Town_Square]`.
- **Arcade**: four gates along the north edge, auto-activate on approach; Feron, Wegner (minerals), Sullivan (Krogmo rewards); Alchemy, Mysterious and Krogmo Alchemy Machines `[/Arcade]`.
- **Bazaar**: Greave (armour), Kragen (shields), Quillion (swords), Ricasso (guns/bombs), Vatel (colours, height, eyes, crystals, recipes), Brinks (token trader), Punch (Unique Variants), Vise (unbinding), Bechamel (accessorizor) `[/Bazaar]`.
- **Garrison**: Lab, Guild Hall entrance, Hall of Heroes `[/Garrison]`. **Lab**: Morlin (sprites), Biscotti (sprite diet), Riley (harnesses), Hahn, Pakrat; the Artifact on display until stolen `[/Laboratory]`. **Hall of Heroes**: recipe vendors; Barrus gives star certification (2★ → Tier 2, 4★ → Tier 3) `[/Hall_of_Heroes]`.
- **Advanced Training Hall** (Konway): wings for consumables/pickups, blocks/switches/doors/pads, pots/shields/traps/status, spike traps and Arsenal Stations; free revive `[/Advanced_Training_Hall]`.
- **Subtowns**: Moorcroft Manor D8 (Mewkat NPCs, Lost Souls selling vials/vitapods), Emberlight D18 (Gracken, Brinks, Kozma), Clockwork Terminals D4/13/23 (Basil recipes, Kozma, Arsenal Station, 2 Heart Generators, elevator to Haven or deeper) `[/Moorcroft_Manor]` `[/Emberlight]` `[/Clockwork_Terminal]`.

### 5.3 HUD and UI

- **Top-left**: portrait (shortcut to Social); health pips red → silver (>30) → gold (>60), damage shown as purple pips, recovery cyan; shield power meter; heat flame that intensifies as heat is acquired; emergency-revive indicator light `[/HUD]` `[/Health]` `[/Heat]` `[/Revive]`.
- **Party portraits** on the left in Clockworks; right-click to inspect; click a fallen teammate's portrait → Spark revive `[/Inspect]` `[/Revive]`.
- **Top-right**: minimap — rotating arrow (personal colour in Clockworks); players grey/blue/green (stranger/friend/guild), off-screen arrows; monsters pink dots; exit icon; keys/gates, prize wheels; buttons for zoom, map overlay, instance select, HUD lock (Q); connection-quality bars; objective notice under minimap; Activities Panel (missions, party finder) `[/Minimap]` `[/HUD]`.
- **Bottom-left**: Main Menu, Help, Social (F6), Event Hub (F7), Mail, chat box (Enter or /); crowns shown when arsenal open `[/HUD]`.
- **Bottom-right**: Character (P), Loadouts (L), Forge (U), Arsenal (I); energy widget appears above when needed `[/HUD]`.
- **In-combat**: weapon selection wheel; targeting UI with monster health, attack types, weaknesses; damage flash; vial/capsule belt with Vitapod slot; quickslots 4–7 hold up to 3 of one pickup type each `[/HUD]` `[/Vial]`.
- **Status icons**: fire red flame, freeze blue snowflake, shock yellow bolt, poison green drop, stun purple star, curse dark swirl, sleep blue moon `[/Status]`.
- **Toggles** in Options: damage numbers, monster health bars, NPC names, weapon wheel, charge meter, screen damage effects, Lockdown arrows, auto-target `[/Options]`.
- **Arsenal**: unlimited storage; locked in Clockworks except at Terminals, subtowns, Arsenal Stations `[/Arsenal]`. **Loadouts**: L key `[/Loadout]`. **Character window**: rotating model, stats, tier requirements `[/Character]`.
- **Gate map**: red circle = you; lines to next level; branches; depths rotate every ~1:45–20 min (typically 3–7); level icon = background colour (element) + icon (layout) + icon colour (family); elevator monitor shows the next depth's current level `[/Gate]`.
- **Elevator**: ends every level; next level is not locked in until all party members step on the lift; prize wheel spins on activation (materials, crowns, hearts, full health, pickups, lockboxes) `[/Gate]` `[/Prize_Wheel]`.
- **Mission UI**: subtype icons; progress bar per rank `[/Mission]`. **Party Finder**: lists gate/mission, members, depth `[/Party_Finder]`. **Forge**: crystal amount (Min/Med/Max), success %, bonuses `[/Forge]`.
- **Chat**: colours white local, beige zone, green guild, purple whisper, blue tips, pink server; caps auto-lowered; spam → "hoarse" `[/Chat]`.

### 5.4 Party and multiplayer

- Max 4; create from a gate console or Mission interface: Public / Private / Solo; join via gate, Party Finder, Social list, or direct invite `[/Party]`.
- No joining: Treasure Vaults, boss levels, Shadow Lairs (after the elevator), danger missions after first combat floor; solo parties unjoinable `[/Party]` `[/Shadow_Lair]`.
- Leader: invite (delegable), remove anytime, change access. Leave: Return to Haven / Quit / Go Solo (keeps position, loses floor heat & loot) `[/Party]`.
- Progress: one knight on the lift = whole party proceeds; dead revive on next floor; wipe with no revive in 3 min → ejected `[/Party]` `[/Revive]`.
- Revive: one free Emergency Revive per level; Spark of Life (10 for 200 energy; 50 energy on-the-spot); revive blast stuns/knocks back `[/Revive]` `[/Spark_of_Life]`.
- Loot: each knight picks up own drops (crowns not shared since 2013); each member gets copies of every mineral; heat applied only at the lift, forfeited if you leave/die before boarding; energy gates (3), danger rooms (3), Mecha Knights/turrets (5) paid by one member `[/Party]` `[/Crowns]` `[/Heat]`.
- Party buttons: big red buttons all party members gather on, mandatory for progression `[/Party_Button]`; Battle Arenas lock the room on press, 3 rounds of branching waves `[/Battle_Arena]`; Danger Rooms 3 waves, gates locked until clear `[/Danger_Room]`.
- Chat defaults to /party in Clockworks; commands /p, /g, /o, /z, /t, /r, /trade, /join, /ignore, /report, /afk, /me, /sit, /bug, /clear `[/Chat]`.
- Friends: 250 max; shows status/location; Tell/Join/Guild invite/Party invite `[/Friend]`. Event Hub (F7): friend/guild activity, joinable parties, leaderboards `[/Event_Hub]`.
- Guilds: 500 energy + 50k cr; 100 members (upgrades +50 per 150k cr to 300); ranks Recruit/Member/Veteran/Officer/Guild Master with permission matrix `[/Guild]`. Guild Hall: furniture/rooms from Treasury, Guild Storage, Design Mode, wing expansions, weekly upkeep 0 → 40k cr; installable Punch & Vise Workshop, Bechamel's studio, Coliseum room `[/Guild_Hall]`.
- Emotes: 80+ slash emotes, some animated; /emote free text `[/Emote]`. Trade: right-click → trade; 15 items; both confirm with 3-s re-confirm; unbound gear/materials/recipes/crowns/energy only `[/Trade]`. Mail: 25 cr text, 100 cr with up to 14 attachments; 30-day expiry `[/Mail]`.

### 5.5 PvP — King Krogmo's Coliseum

- Coliseum via crossed-swords HUD icon; crown entry fee; bribe Krogmo with energy for bonus prizes; Krogmo Coin Boosters `[/King_Krogmo's_Coliseum]`.
- **Lockdown**: 200 cr entry; 4–6 per team; Random or Guild Team; tier by highest gear star; classes — Striker (3-s sprint, −3 HP, sword bonuses), Guardian (shield bubble + ally regen, +9 HP), Recon (invisibility, pulse marks, Death Mark −defence 5 s, +7 HP); neutral control points, ring capture faster with more players; 3-CP maps to 500, 5-CP to 900; points every 5 s; respawn 7–22 s or Spark instant; win 2 coins + 280 cr, loss 1 coin; 16 maps; Hardcore mode disables auto-target; PvP loadouts `[/Lockdown]`.
- **Blast Network**: gear disabled; cross-blast bombs, no charge; FFA / Random Team / Guild Team (min 4); 1 pt per kill +1 if your bomb; powerups Blast Up (max 15), Count Up (max 5), Speed Up (max 5); 13 maps; synchronized respawn; zoomed-out camera `[/Blast_Network]`.
- **Krogmo Coins**: 1 per match +1 win, up to 7 with boosters; Sullivan sells Enamorock 10, Mod Calibrator 75, 3★/4★/5★ recipes 50/100/150, Bombhead Masks 150 `[/Krogmo_Coin]` `[/Sullivan]`.

### 5.6 Progression and social meta

**Ranks** `[/Player_Rank]` `[/Hall_of_Heroes]` `[/Tier]`

| Rank | Earned | Gear cap | Tier host | Prestige depth |
|---|---|---|---|---|
| Recruit | start | ☆ | 1 | — |
| Apprentice | progression | 1★ | 1 | — |
| Squire | progression | 2★ | 1 | 4 |
| Soldier | 4-1 HoH (2★ cert) | 2★ | 1 | 9 |
| Knight | 5-2 HoH (3★) | 3★ | 2 | 9 |
| Knight Elite | 6-2 HoH (4★) | 4★ | 2 | 14 |
| Defender | progression | 4★ | 3 | 19 |
| Defender Elite | 8-2 HoH (5★) | 5★ | 3 | 19 |
| Champion | progression | 5★ | 3 | 24 |
| Vanguard | 9-4 HoH | 5★ | 3 | 24 |

- Tier gear penalty: T1 reduces 2★+, T2 reduces 4★+, T3 none `[/Tier]`. Arsenal equip gates: rank 3+ 2★, 5+ 3★, 6+ 4★, 8+ 5★ `[/Arsenal]`.
- 97 rank missions over 10 ranks; rewards once, bound `[/Mission]`; full table at `[/List_of_rank_missions]`. Champion/Vanguard missions: 9-1 The Silent Legion (D24–26), An Occurrence at Owlite Keep; 9-2 Terminal Meltdown, Alone in the Dark, The Gauntlet; 9-3 Heart of the Matter, The King of Ashes (D24–29, Almirian Seal); 9-4 The Search Continues, Honor and Duty (Vanguard promotion); 10-1 Crimson Chaos, It Came From Below; 10-2 The Flickering Flame, Shadowplay, A Call to Arms, Dreams and Nightmares (D24–28).
- **Prestige**: never decreases, not spendable; badges at 5k/10k/15k/25k/45k `[/Prestige]`. **Daily prestige**: Clockworks (6-day cycle), Supply (9-day), Danger (4-day, rank 4-1+, 4 floors, party locks after first combat floor, treasure floor); resets 00:00 PT `[/Prestige_Mission]` `[/Danger_Mission]`. Danger examples: Compound 42, Heart of Ice, Legion of Almire, Grinchlin Assault.
- **Expansion**: only Operation Crimson Hammer ($5.95 or 3,200 energy, needs 3-2 "The Pioneers"; 6 levels ending in Engines of War boss; Rocket Hammer / Dark Retribution lines; Seerus mask fragments) `[/Operation_Crimson_Hammer]`.
- **Shadow Lairs**: Shadow Key consumed at D23; four lairs — Rabid Snarbolax ×2, Ice Queen, Red Roarmulus Twins, Darkfire Vanaduke; then Unknown Passage → Sanctuary `[/Shadow_Lair]`.
- **Energy** uses: orbs, sprite catalysts, devices, Sparks, Supply Depot, guild creation, unbinding `[/Energy]`. Elevator Pass (2011–2013) removed `[/Elevator_Pass]`.
- **Supply Depot** (Kozma / K key): Sparks ×10 200; Evo Catalysts 125/250/525; Fire Crystals; Orbs; Reset Star 2,000; Heat Amplifier 800; Coin Booster 300; Trinket/Weapon slot upgrades 150/250 (30 d); name change 3,500; sprite pods 2,100; Silver Key 750; Shadow Key 1,800; bound gear 65–3,500 by star `[/Supply_Depot]`.
- **Keys**: Silver (any lockbox), Shadow, Slime (60k cr, Gracken), Gold field keys; Book of Dark Rituals / Fiendish ID Card act as party keys `[/Key]`.
- **Achievements** (O key): Exploration 8, Boss 4, Alchemy 8, Collection 12, Aid 5, Survival 5, PvP 1, Casino 4, plus 6 legacy `[/Achievement]`.

### 5.7 Events and seasonal content

- Generic pattern: transient NPCs at the fountain, event tokens/materials at the Mysterious Alchemy Machine, themed monsters in Clockworks and prestige missions `[/Event]`.
- **Dark Harvest Festival** (Oct–Nov yearly since 2011): Punkin King lairs (TREAT 10 tokens / TRICK Gourdlings), Grim Scarabs, candy tokens → Maskwell masks; spooky Haven music `[/Dark_Harvest_Festival]`.
- **Shroud of the Apocrea** (since 2013): Lovecraftian prestige mission D19–25 ending on the Grasping Plateau (radar off, minimal healing); Apocrean Harvester; Sigils → Obsidian gear `[/Shroud_of_the_Apocrea]`.
- **Winterfest** (Dec 12–Jan 2): Impostoclaus + Randolph; Save Winterfest (escort in Emberlight), Grinchlin Assault; snowballs; Winter Wish tokens `[/Winterfest]`.
- **Caketastrophe** (April anniversary): Biscotti, cake nests with Creep Cakes, Dread Velvet; Cake Slice tokens `[/Caketastrophe]`.
- **Kataclysmic Confrontation** (2–3×/yr): Black Kats drop Ancient Pages, Book of Dark Rituals summons Margrel; Montague trades Kat gear `[/Kataclysmic_Confrontation]`.
- **March of the Tortodrones**: fiends reassembling Tortodrones; Fiendish Glyphs + Ancient Shells; shell shields/guns `[/March_of_the_Tortodrones]`.
- Golden Slime Casino (transient tunnels segment, prize wheels, Slime Lockboxes); Nonna (solstice/equinox vendor); April Fools 2012 monster quotes; Prize Boxes: 1 prize + confetti; only the Forge Prize Box is permanent `[/Golden_Slime_Casino]` `[/Prize_Box]`.

### 5.8 Tutorial flow (in order)

1. Character creation: helmet, armour, design colour, accessories, height, eye shape, personal colour; 4–18-char name; 3 knights per account `[/Starting_out]`.
2. Prologue: Ozlo, Isora/Morai, Skylark attack, escape pods `[/Captain_Ozlo]`.
3. Crash Site teaches in order: move → attack → aim with mouse → hearts heal → cycle weapons → switch to handgun → hold shield; Jelly Cubes, Chromalisk Whelps, Gun Puppies, Ironwood Sentinel miniboss; collect heat and crowns; ends at Rescue Camp. Not taught: dodge, combos, energy, vials `[/Crash_Site]`.
4. Rescue Camp: Greta (power crisis), Rhendon (basic tutorials), Forge Knight, Virgil (chasm, dead elevator) `[/Rescue_Camp]`.
5. 1-1 Should You Choose to Accept (Activities bar, missions give rank → gear); 1-2 The Ancient Generator (D1, restore camp power, Razwog Battle Pod, the Artifact); 1-3 First Contact (Kora: Cradle, Clockworks, gremlins, Haven); 1-4 Crossing the Chasm (elevator use; Razwog retakes Artifact; Feron rescues) `[/List_of_rank_missions]`.
6. Rank 2 dialogue tour: Welcome to Haven → Reporting for Duty (Arcade) → Let's Go Shopping (Bazaar) → Pumping Up (Training Hall) → A Visit to the Lab → three D0 shard runs → Alchemy for Beginners → Time to Get Crafty → An Eternal Bond (sprite) → The Collector (D3).

### 5.9 Camera, controls, graphics, sound

- Camera: no wiki page; Blast Network uses a zoomed-out camera; community consensus: fixed angle, non-rotatable because environments are 2D-rendered (outside the wiki, unverified).
- Controls: three schemes (see section 2.1); rebindable `[/Controls]`.
- Options: resolution, quality low/med/high, UI scale, VSync, AA, FPS cap; music/effects/UI volume; chat size/font/profanity; languages EN/FR/DE/ES; host region `[/Options]`.
- Music: Harry Mack; OST 2011 (31 tracks) and Vol. II 2012 (23); tracks tied to regions/bosses; Haven music swaps in events `[/Soundtrack]`.

### 5.10 Other "part of the experience" items

- Stranger vendors wear masks matching wares. Personal colour drives prismatic gear, minimap arrow, badges. Costumes: no stats, bind on equip.
- Level furniture: red/green/purple/heart treasure boxes `[/Treasure_Box]`; energy gates 3, danger rooms 3 (12 boxes reward); Battle Arena 3 rounds; Treasure Vault mimics; Mecha Knight kits and 5-energy allies; vitapods lost on return to Haven; capsules 3/6/12 bars, seven vial types.
- Bosses: Snarbolax, Royal Jelly, Roarmulus Twins, Vanaduke (tokens Frumious Fang / Jelly Gem / Bark Module / Almirian Seal); minibosses Big Iron, Maulos, Arkus, Collector, Ironwood Sentinel, Razwog, Sputterspark, Herex, Treasure Mimic, Dread Velvet, Margrel `[/Boss]`.
- Recipes: Basil pricing 250 → 25,000 cr by star `[/Basil]`. Crown denominations 1/5/10/25/50 `[/Crowns]`.
- Social texture: Haven instances, connection-quality bar, "hoarse" spam penalty, Event Hub leaderboards, inspect privacy, public guild halls.

### 5.11 Gaps
- No pages for `/Story`, `/Interface`, `/Vanguard`, `/Champion`, `/Camera`, `/Music`, `/Tutorial`, `/Elevator`, `/Lobby`, `/Isora`, `/Morai`, `/The_Architect`, `/Iron_Law`. `List_of_rank_missions` Champion/Vanguard sections were reconstructed from individual mission pages. The fandom mirror returned HTTP 402.
