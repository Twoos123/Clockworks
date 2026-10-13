# Spike: Clyde's Tudey gameplay layer in the browser through TeaVM

Date: 2026-10-12. Written up from the spike's own report; its build lives in `engine-spike/`,
which is not committed (about 180 MB of tools and jars).

Tools: JDK 21.0.8, Maven 3.9.11, TeaVM 0.16.0, Node 22.18.0, Chrome 152. Only the
open-source Clyde, Narya, Nenya and samskivert sources were used. The game client was not
touched.

## Verdict

**Feasible, with moderate and contained stubbing.** Tudey's real server-side
`TudeySceneManager` ran with no network, compiled to both JavaScript and Wasm GC, and matched
the JVM:

- it spawned actors from configs built in code;
- it ran `AgentLogic` with the Wander and Follow behaviours;
- `MobileAdvancer` collision stopped agents at a wall;
- Tudey's A* `Pathfinder` routed around the wall with the same path on every target.

A follower ended 0.6292559 from its goal on the JVM and in Wasm, and 0.6292556 in JS.

It took 16 small source overrides (mostly regex patches), a 70-line TeaVM plugin, one
reflection policy, and a 78-line `TudeySceneManager` subclass that skips the Narya and Guice
startup. No upstream file was modified.

## Main findings

1. **The distributed-object server is referenced but barely used at run time.**
   `TudeySceneManager` extends `SceneManager` and `PlaceManager` and has Guice fields. After
   TeaVM keeps only reachable code, Presents has 44 functions, Crowd 25 and Whirled 18, all
   data classes. Guice, Swing, OpenAL and JNI are never reached. Logic objects are made by a
   fixed name-to-constructor registry instead of `Injector.getInstance`.
2. **Reflection is the real design constraint.** Clyde's config copying and
   `ReflectionUtil.newInstance` need fields and constructors by reflection. A narrow policy
   (config, math, expr, util and Tudey data packages) works. A broad one pulled in AWT,
   sockets, Swing and javax.sound: 108 missing-class errors.
3. **TeaVM 0.16 has Wasm GC bugs this code hits.** All four were worked around: a null
   predicate argument, a generic-type crash on annotated fields, an invalid `br_on_cast` for
   one catch clause, and broken generated annotation classes.

## Measurements

| Test | JVM | JS | Wasm GC |
|---|---|---|---|
| 100k HashSpace queries | 24-29 ms | 23-24 ms | 16-22 ms |
| 600 ticks of 100 ms, 2 agents | 34-39 ms | 17-35 ms | 12-18 ms |
| Module load | – | 175-210 ms | 44-105 ms |

| Bundle | Size | Gzip |
|---|---|---|
| JS | 714 KB | 229 KB |
| Wasm GC | 1,092 KB | 368 KB |

Node 22 needs `--experimental-wasm-exnref` for Wasm. Chrome 152 needs no flag.

## What Clyde does not provide

Clyde and Tudey give actors, collision, movement, A* pathfinding, data-driven behaviours,
generic handlers and actions, effects, and scene sync. They have **no** Spiral Knights
gameplay: weapons, attacks, damage, health, defence, status effects, monster definitions,
gear, energy, heat or loot. Those live in the proprietary `projectx` code, so combat has to be
written fresh either way.

## Estimate to use Tudey as a JS module

About 2-3 weeks:

1. A JS API for scenes, spawning, stepping and input: 1-2 days.
2. Real level collision from the scenes this viewer already parses: 2-4 days.
3. Real configs, the main risk: 3-7 days. Either Clyde's own importer under TeaVM with a
   curated reflection list, or this project's TypeScript importer feeding a small Java
   builder.
4. A registry of every handler, action, condition, target and behaviour logic class: 1 day.
5. Hardening, such as a seeded RNG and bounded caches: 2-3 days.

## Not verified

- Loading real `.dat` configs under TeaVM.
- Pawn input, effects, and tile collision in `TudeySceneModel`.
- Firefox and Safari.
