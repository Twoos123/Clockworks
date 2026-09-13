# Clockworks — plan and decisions

This file exists so a fresh Claude Code session understands not just the rules
(`CLAUDE.md`) but *why* they're the rules, and what order things get built in.

---

## What the game is

An isometric co-op action dungeon crawler in the shape of **Spiral Knights**:
real-time melee combat, floors assembled procedurally from hand-built room
modules, two players online.

**The one thing that has to feel good:** a sword swing landing on an enemy that
reacts to it. Everything else is in service of that.

## The slice we are building

One floor · one sword · three enemy types · eight room modules · two players ·
about ten minutes of play.

This is not a slice *of* a bigger game we're building in parallel. It is the
whole current project. When it's done and playable we decide what's next with
evidence rather than optimism.

---

## Decisions already made — don't relitigate these

**Unreal Engine 5.8, C++, Top Down template.** C++ rather than Blueprint-only
because Blueprints are binary and neither git nor an AI assistant can read,
diff, or merge them. Blueprints still get used for materials, VFX, sound and UI.

**Listen server, not dedicated server.** One player hosts. Reason: building a
dedicated server target requires a source build of Unreal from GitHub (~200 GB
and hours of compiling), and for two-player co-op it buys nothing. The costs we
accept: the host has zero latency and the guest doesn't, and the session ends
when the host quits. Both are fine for co-op.

Migrating to dedicated servers later is a packaging change *provided* everything
was server-authoritative throughout — which is why that rule is absolute.

**Server-authoritative from the first line.** Not because we need it today, but
because retrofitting authority onto finished single-player systems is a rewrite.
The way projects like this die is twenty features that each worked fine solo,
discovered three months later to be quietly client-authoritative.

**GAS (Gameplay Ability System) for all combat.** It maps almost one-to-one onto
this genre: windup/active/recovery abilities, cooldowns, damage types, gear that
modifies attributes, and status effects. Its learning curve is steep — two weeks
of friction is the expected cost, not a sign something is wrong.

**Lumen and Nanite off.** A stylized isometric game needs neither. They cost
frames and iteration time for detail the camera is too far away to show.

**Epic Online Services for sessions.** Free, and it handles NAT punch-through.
Invite-only to start; matchmaking is a separate project.

---

## Build order

Work these in sequence. Each one assumes the previous one works.

**00 — Scope.** Write the slice down. Keep the cut list visible.

**01 — Project and version control.** Top Down C++ template. Git + LFS +
One File Per Actor. Commit `.gitattributes` before any content. Commit before
every session, not after.

**02 — Two-player testing loop.** Play → Number of Players `2`, Net Mode
`Play As Listen Server`. Make this one keystroke. It is the development loop
for the rest of the project, and a feature isn't done until it works here as
both host and client.

**03 — Isometric camera and movement.** Spring arm, fixed world rotation
(~45–55° pitch), `bInheritPitch/Yaw/Roll` all false. Leave
`CharacterMovementComponent` alone — it's already client-predicted and
server-authoritative. Replacing it is how an easy problem becomes a six-month
one. Camera is purely local; never replicate it.

**04 — GAS combat spine.** `AbilitySystemComponent` on PlayerState for players
(survives respawn), on the Pawn for enemies. Attributes: Health, Shield,
AttackPower, DefensePower, MoveSpeed. First ability is the sword in three
phases — windup (committed, rotation locked), active (hitbox live), recovery
(can't act). The commitment is what gives action combat weight; do not shorten
the windup to improve "responsiveness". Add a dodge with i-frames second.

**05 — Three enemies that ask three questions.** Not three stat blocks. One
charges (dodge it), one shoots (break line of sight), one is slow and armoured
(kite it). Behavior Tree + Blackboard + AIPerception, server-only. Telegraph
every attack and give each a visible recovery window — the loop is read, evade,
punish. Tune for two players; aggro splitting changes everything.

**06 — Clockworks floor assembly.** Eight hand-built room modules with
standardised exit sockets. Assemble on the server, replicate only the **seed**,
let clients rebuild deterministically. Never replicate the geometry. Validate
that the exit is reachable from the start — unreachable exits are the classic
bug here. Give each floor a "danger budget" so difficulty is a number you tune.

**07 — Sessions.** `OnlineSubsystemEOS`. Create → find → join, invite-only.
Test over the real internet with a real friend early; PIE and LAN both lie about
latency. Then play the whole slice with `Net PktLag=150` and see if combat still
feels good.

**08 — Gear, minimally.** DataTable of items, DataAsset per weapon, equipping
applies GameplayEffects. **Server owns inventory, always** — client-side
inventory is where cheating lives. Two or three weapons with different rhythms
beats twenty with different numbers. No crafting.

**09 — Readability.** At a fixed distant camera with two players and six
enemies, legibility is a mechanic. High silhouette contrast. Hit feedback:
flash, knockback, sound, and **hitstop** — hitstop is a few lines of code and
does more for game feel than almost anything else. Health bars, status icons,
damage numbers.

**10 — Ship it.** Package Shipping. Play end to end with a friend on a different
network. Watch for exactly three things: desync, hits that don't register, and
the host having a visible advantage. Put it on itch.io.

---

## The cut list

Spiral Knights has all of these. We are deliberately building none of them.
Re-read this whenever a phase starts growing.

Energy and economy · crafting trees · PvP · guilds, chat, friends lists ·
accounts, login, backend persistence · matchmaking beyond invite-only ·
multiple biomes or tilesets · anti-cheat beyond server authority · parties
larger than two · levels, XP, or meta-progression · dedicated server target.

If one of these seems genuinely necessary to solve a problem, say so and explain
why — don't build it.

---

## Context worth knowing

The person building this is new to Unreal and is learning it alongside the
project. Explain what a thing is before saying to do it, and say where in the
editor UI to find anything you mention. Expand acronyms the first time.

The project lives at `D:\Dev\Clockworks` — deliberately not inside OneDrive,
which corrupts Unreal projects by syncing files the editor is actively writing.
