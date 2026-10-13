# Tudey server-side logic: semantics spec

Source: Clyde (BSD), `clyde/core/src/main/java/com/threerings/tudey/` in `clyde-web-upstream`:
`config/{Handler,Action,Target,Condition,Region,Expression,Actor,Placeable,Area,Tag,ParameterizedHandler}Config.java`,
`server/logic/*.java`, `server/TudeySceneManager.java`, `data/TudeySceneModel.java`, plus
samskivert `Interval`, `ObserverList`, `RandomUtil` and `com.threerings.expr.ExpressionParser`.
Only the open-source repos were read. Game-specific subclasses (projectx) are not covered. Wherever the
game could override a hook (`resolveTarget`, `getTags`, actor flag fields), this spec says so.

Conventions: "seconds" and "ms" are exactly as stored in config. Angles are radians; the editor
shows degrees, but the stored value is radians. `normalizeAngle(a)` wraps into [-π, π]. All
`random()` values are uniform in [0,1).

---

## 0. Core object model

### 0.1 Logic (base of everything)
Every handler, action, target, condition, region and expression is a `Logic`. Each one has:
- `_scenemgr` and `_source` (the owning **entity** logic, either an `EntryLogic` or an `ActorLogic`,
  passed down unchanged to every nested sub-logic).
- For handler, action, target, condition, region and expression logics, `getTranslation()`,
  `getRotation()`, `getEntityKey()` and `isActive()` delegate to `_source`.
- Base defaults: `getTags()` returns `[]`, `getTranslation()` returns (0,0), `getRotation()` returns 0,
  `getShape()` returns null, `signal()` does nothing, and `resolveTarget()` returns `this` (the game
  may override it).
- Variables: a lazily created `Map<String,Object>`. `getVariable` returns null when unset.
  Base `setVariable` only stores the value. `EntryLogic` and `ActorLogic` override it to then call
  `variableChanged(ts, source, name)` on every handler (§1.16).
- Factory helpers (`createAction`, `createTarget`, ...) instantiate the class named by
  `config.getLogicClassName()`. If that name is `TudeyCodes.NO_LOGIC` (the class is a `None`) or the
  class fails to load, they return **null**. Compound action and target, and All/Any conditions,
  silently drop nulls. Other callers would NPE, so treat a null sub-logic as a no-op.

### 0.2 Entry logics (placeables, areas, paths, tiles, globals)
`TudeySceneManager.didStartup → createEntryLogics`:
1. For **every** entry, `addLogic(entry, notify=false)`. `entry.getLogicClassName()` returns null
   when the entry has no tags, no handlers and `defaultEntrance == false`, and then no logic is
   created. Otherwise it is `EntryLogic`; `PlaceableConfig.StatefulProp` gives
   `EntryLogic$StatefulProp`. Each created logic runs `init` and is put into `_entries` and the tag,
   instance and default-entrance mappings.
2. Then, for every created entry logic, `added()` runs. It calls `startup(ts)` on each handler in
   order with `ts = getNextTimestamp()` (current timestamp + tick interval, default 50 ms), then
   `wasAdded()`. StatefulProp spawns its actor in `wasAdded`, so its handlers start first.
   - Iteration order is that of a `HashMap` over entry keys, so it is effectively **unspecified**.
     Because everything is mapped before anything starts, Startup handlers can find any tagged
     entry. They cannot yet find actors that a later entry's startup will spawn.
- `EntryLogic.init`: `_translation`, `_rotation`, `_tags`, `_defaultEntrance` and `_shape` are
  computed once from the entry. Handlers are created from `entry.getHandlers()` with
  `source = this`.
- Values per entry kind:
  - **PlaceableEntry**: translation = `transform.translation.xy`; **rotation =
    normalizeAngle(rotZ − π/2)**; shape = `config.shape` transformed by the full 2D part of the
    entry transform (translation, rotation, uniform scale); tags = `config.tags.getTags()`;
    handlers = `config.handlers`. These come from `PlaceableConfig.Original`, which covers Prop,
    Marker, ClickableProp and StatefulProp; `Derived` resolves to its original.
  - **AreaEntry**: translation = mean of the vertices; rotation = **0**. Shape: none for 0
    vertices, Point for 1, Segment for 2, Polygon otherwise, with the vertex order reversed if
    the vertices wind clockwise. Tags and handlers come from `AreaConfig.Original`.
- `isActive()` is true when `_scenemgr.getEntryLogic(key) == this`.
- `signal(ts, src, name)`: forwards to every handler, with no "destroyed" check.
- `removed(endScene)`: for each handler in order, `shutdown(ts, this, endScene)` then
  `handler.removed()`; then `wasRemoved`. `ts = getNextTimestamp()`. This runs on an editor
  entry removal or update (`endScene=false`) and at scene shutdown (`endScene=true`).

### 0.3 Actor logics
`spawnActor(ts, translation, rotation, ref, actor=null, preStartup)`:
1. Return null if the place object is inactive or the config fails to resolve.
2. `id = ++_lastActorId`.
3. `ActorLogic.init`: create the `Actor` at (translation, rotation, created=ts); build the shape
   element; if `spawnMask != 0` and the actor collides, search for a free spot (§2.1 note); **add
   it to the actor space**; create the handlers (`ActorConfig.Original.handlers`, source = actor);
   run `didInit` (MobileLogic registers itself as a tick participant here unless
   `startInStasis`); run `preStartup`, which sets `source` and `activator` (§2.1); **run every
   handler's `startup(ts)`** (only for fresh spawns).
4. `_actors.put(id)`, then `addMappings` (tags, instances, default entrance).
5. Notify ActorObservers through `actorAdded` (§1.13).

**Ordering consequence:** an actor's own Startup handlers run **before** the actor is in the tag
map, before `getActorLogic(id)` works, and before ActorAdded observers fire. A `Tagged` target
evaluated in an actor's Startup does not include that actor.

- Tags: `ActorConfig.Original.tags`. `TagConfig.getTags()` concatenates `tags` with the chain of
  `derived` TagConfigs. A duplicated tag gets the logic listed twice under that tag.
- `isActive()` is `!isDestroyed()`, where `isDestroyed()` is `scene.timestamp >= actor.destroyed`.
- `signal()`: ignored if the actor is destroyed; otherwise forwarded to every handler.
- `destroy(ts, activator, endScene)`: idempotent. Sets `actor.destroyed = ts` and schedules
  `remove()` for the **next tick**. Then calls `handler.shutdown(ts, activator, endScene)` on each
  handler in order, then `wasDestroyed()` (MobileLogic stops ticking).
- `remove()` (next tick): removes the actor from the actor space, then `removeActorLogic(id)`,
  which removes it from `_actors` and **removes its mappings**, then notifies ActorObservers
  through `actorRemoved` (§1.13). After that come `handler.removed()` and `wasRemoved()`.
  **Between destroy and removal (about one tick) a destroyed actor is still in `getTagged()` and
  `getInstances()`.**
- At scene shutdown every actor gets `destroy(ts, itself, endScene=true)` and then `remove()`, so
  ActorRemoved observers that are still registered (on entries, whose shutdown comes later) do
  fire during teardown.
- `ActorLogic` implements `Activated`, so `getActivator()` returns the activator stored at spawn.

### 0.4 Tag map and instance map
- `getTagged(tag)` returns the live `ArrayList` in insertion order (entries in creation order,
  then actors in spawn order), or an empty list. Removal uses `list.remove(logic)` (identity
  equality). An empty list is deleted.
- `getInstances(Class)`: every logic is registered under each class from its concrete class up to
  `Logic`. Used by InstanceOf targets.

### 0.5 Tick loop and timers (ordering)
`tick()` does the following, in order:
1. Advance `timestamp` by the elapsed wall-clock ms.
2. Snapshot the runnable queue.
3. **Tick every TickParticipant** in registration order. The list is copy-on-write: a participant
   added during this pass is not ticked until the next tick. Returning false removes it. A
   participant added twice is ignored (duplicate check).
4. **Run the queued runnables.** These include every expired `Interval`: Timer, WarnTimer and
   Delayed. An Interval runs on a java `Timer` thread on wall-clock time and, when it expires, posts
   itself to the scene's run queue. So timer callbacks always run **after** the tick participants
   of the tick in which they are processed. Their `timestamp` is `scenemgr.getTimestamp()`.
5. Post deltas to the clients.

TickParticipants include every non-stasis MobileLogic (movement, then
`triggerIntersectionSensors`), Tick handlers, active Transition handlers (Signal/Intersection
Start/Stop/Count), and one-shot participants (actor removal, WARP-flag clearing).

ActorObservers are a FAST_UNSAFE `ObserverList`: they are notified **last-registered first**
(reverse order).

---

## 1. Handlers (`HandlerConfig` → `HandlerLogic`)

Every *ActionHandler* has `action: ActionConfig = new SpawnActor()`. `SpawnActor` with
`actor == null` maps to `ActionLogic$None`, so the default does nothing. The action is created
once in `didInit` with `source = handler._source`. `execute(ts)` means
`action.execute(ts, activator = _source)`. `execute(ts, a)` passes activator `a`. **Handlers ignore
the action's boolean result.**

`handler.removed()` → `action.removed()`, which cancels Delayed intervals (§2.8).

### 1.1 None
No fields. Logic class is NO_LOGIC, so no handler is created.

### 1.2 Startup
- `action`.
- On `startup(ts)`: `execute(ts)`, activator = source. For an entry, ts = next timestamp at scene
  start (or when the entry is added). For an actor, ts = the spawn timestamp (§0.3 ordering).

### 1.3 Shutdown
- `action`.
- On `shutdown(ts, activator, endScene)`: if `!endScene`, then `execute(ts, activator)`.
- Activator: for an actor destroyed by `DestroyActor`, it is **the DestroyActor action's
  activator**. For an actor that destroys itself because its body left, it is the actor itself.
  For an entry removal, it is the entry itself. Nothing fires at scene end or for `DestroyActor`
  with `endScene=true`.

### 1.4 Reference
- `handler: ConfigReference<ParameterizedHandlerConfig> = null`.
- `didInit` resolves the ParameterizedHandlerConfig (with args) and creates its `handlers[]` with
  the same `source`. If the reference is null or unresolvable, the list is empty.
- Forwards only `startup`, `shutdown`, `variableChanged`, `signal` and `removed()` to the children,
  in order. **`request` is not forwarded.** Children that self-register (Tick, Timer, Intersection,
  ActorAdded/Removed, BodyEntered, Transitions) work normally because they do so in `startup`.

### 1.5 Tick
- `action`.
- `startup` registers as a TickParticipant; `shutdown` unregisters it. Each tick:
  `execute(tickTs)` with activator = source. The first execution is on the first tick pass after
  startup (the copy-on-write rule applies).

### 1.6 Timer
| field | type = default | meaning |
|---|---|---|
| interval | float = 1.0 | **seconds** between firings |
| offset | float = 0.0 | seconds added to the first delay only (may be negative) |
| limit | int = 0 | number of firings; **0 = unlimited** |

Behaviour:
- `startup`: `_limit = (limit==0) ? MAX_INT : limit`. The first delay is
  `max(0, interval + offset)` s, so the first firing comes **one interval after startup** by
  default, not at startup.
- On expiry: `execute(sceneTs)` with activator = source. Then, if `--_limit > 0`, it reschedules
  `interval` s. The reschedule starts when the expiry *runs* (after tick latency), so small drift
  accumulates.
- `shutdown` cancels.
- `(long)(seconds*1000f)` truncates to ms. `interval = 0` with an unlimited limit means re-firing
  on essentially every tick.

### 1.7 WarnTimer (extends Timer)
- Adds `warn: float = 0` (s) and `warnAction: ActionConfig = null`.
- `startup`: runs Timer's startup first. If `warn == 0` or `warn > interval`, there is no warning.
  Otherwise a second interval is scheduled with a first delay of `interval − warn + offset`
  seconds. Note that this value is **not clamped**, so a negative delay fires immediately. On expiry
  it runs `warnAction.execute(ts, _source)`. If the main timer's `_limit > 1`, it reschedules every
  `interval`. That test reads the *current* main `_limit`, which the main timer may already have
  decremented. Result: the warning fires `warn` seconds before each main firing except the last.
- If `warnAction` is null and `warn` is valid, it would NPE; treat that as a no-op.
- `shutdown` cancels both intervals.

### 1.8 Signal
| field | default |
|---|---|
| name: String | "" |
| refractoryPeriod: float | 0 (seconds) |

- `signal(ts, source, name)`: **exact, case-sensitive name match**, and `ts >= _minTimestamp`
  (initially 0). Then `execute(ts, activator = signal source)` and
  `_minTimestamp = round(ts + refractoryPeriod*1000)`.
- **The activator is the signal's source**, i.e. the `_source` entity of the `Signal` *action*
  that sent it (§2.12). It is *not* that action's activator.

### 1.9 Transition base (used by SignalStart/Stop, IntersectionStart/Stop and IntersectionCount)
State: an identity map `activated: Logic → bool`.
- `activate(ts, L)`: if not yet registered, it registers as a TickParticipant. It then puts
  `activated[L] = true`. If L was **absent** and this is a *start* type, it calls
  `execute(ts, L)`.
- `tick(ts)`: for each entry, if the value is true, set it to false. If it is false (not
  re-activated since the previous handler tick), then for a *stop* type `execute(ts, L)`, and
  remove the entry. It stays registered while the map is non-empty.
- `shutdown` unregisters. The map is **not** cleared, and no stop actions fire.
- Effect: the "start" fires on the first activation of L after it has been absent for one full
  handler tick. The "stop" fires on the first handler tick where L did not activate since the
  previous handler tick. Intersection sensors re-trigger every tick from MobileLogic.tick, so stop
  comes 1–2 ticks after L leaves, depending on participant order.

### 1.10 SignalStart / SignalStop
- `name: String = ""`, matched exactly. No refractory period.
- `signal` with a matching name calls `activate(ts, source)`.
- SignalStart executes on the first signal from a given source. SignalStop executes when a source
  that was signalling **stops signalling for a tick**. The activator is the signal source. These
  are meant for signals sent every tick.

### 1.11 Intersection family (sensors)
Common to all (BaseIntersection):
- `shape: IntersectionShape = DefaultShape{expansion=0}`.
  - `DefaultShape{expansion: float = 0}`: uses the source's own shape (entry shape, or actor world
    shape), expanded by `expansion` if it is non-zero. If the source shape is null, there is no
    sensor.
  - `TransformedShape{shape: ShapeConfig = Point}`: the given shape transformed by the source's
    `(getTranslation(), getRotation())`. This has no scale, and for placeables uses the rotZ−π/2
    rotation (§0.2).
- `startup`: build the shape; if it is null, return. Otherwise add a `ShapeElement` to the
  **sensor space** and observe the source's shape changes, so a sensor on an actor follows it.
- `shutdown`: remove it from the sensor space.

**Who triggers sensors:** only `MobileLogic` (and its subclasses Mobile, Pawn and Agent actors),
in each of its ticks, after movement:
`triggerSensors(IntersectionSensor, ts, actor.worldShape, flags = actor.collisionFlags, actor)`.
- If `flags == 0`, nothing triggers.
- Otherwise it gathers every sensor element whose shape intersects the actor shape (the result
  is a set, so each sensor at most once per actor per tick), and triggers each sensor where
  `(flags & sensor.mask) != 0`.
- `collisionFlags` comes from `ActorConfig.Original.collisionFlags` (default `0x01`).
- Static (non-Mobile) actors, and mobiles in **stasis** (not ticking), never trigger sensors.
  There is no condition and no tag filter at this level: the mask is the only filter, except for
  the Count variants below.
- The activator is always the intersecting `ActorLogic`.

| class | extra fields (defaults) | on trigger(ts, actor) |
|---|---|---|
| Intersection | `mask: int = 0xFFFF`, `refractoryPeriod: float = 0` s | if `ts >= _min` (init 0): `execute(ts, actor)`; `_min = round(ts + rp*1000)`. Fires **every tick** while overlapping, unless rp>0. The refractory period is shared across all actors. |
| IntersectionStart | `mask = 0xFFFF` | `activate(ts, actor)`: fires once per actor on entering (Transition start) |
| IntersectionStop | `mask = 0xFFFF` | `activate`: fires once per actor on leaving (Transition stop) |
| ThresholdIntersectionCount | `mask = 0xFFFF`, `condition: ConditionConfig = InstanceOf{logicClass=PawnLogic, all=false, target=Source}`, `threshold: int = 0`, `underAction: ActionConfig = null` | see below |

ThresholdIntersectionCount (BaseIntersectionCount):
- On trigger: if `condition.isSatisfied(activator = actor)`, then `activate(ts, actor)`. Nothing
  is executed at activation time.
- The default condition's target is **Source** (the sensor owner), not Activator, so the default
  condition is "is the owning entry a PawnLogic", which is false. Real data must set
  `target = Activator`.
- `tick`: run the Transition tick (with no start/stop actions), then `n = activated.size`.
  `_lastCount` starts at -1. If `n != _lastCount`, it calls `countChanged`:
  - if `_lastCount < threshold && n >= threshold`, then `execute(ts)` (**activator = source**);
  - else if `underAction != null && _lastCount >= threshold && n < threshold`, then
    `underAction.execute(ts, source)`.
  It then sets `_lastCount = n` and stays ticking while `_lastCount != 0`.
- The count is only evaluated while the handler is ticking (after the first activation). With
  `threshold = 0` it fires on the first activation, because -1 < 0 and n >= 0.

### 1.12 BodyEntered (and BodyLeft)
- `action`.
- `startup` listens to the place object's occupant set. When an `OccupantInfo` is added, it looks
  up `getActorLogic(info.pawnId)`. If that is non-null, it calls `execute(sceneTs, pawnLogic)`, so
  the activator is the player's pawn.
- Order: in `bodyWillEnter`, the pawn is spawned (all its Startup handlers and ActorAdded
  observers run) **before** the occupant is added, so the pawn exists by the time this fires.
- BodyLeft is symmetric on occupant removal.

### 1.13 ActorAdded / ActorRemoved (BaseActorObserver)
Fields: `target: TargetConfig = Tagged{tag=""}`. ActorRemoved adds `all: boolean = true`.
- `startup`: `_lastCount = |target.resolve(activator = source)|`, then register as an
  ActorObserver.
- `actorAdded(A)` (after A is fully spawned and mapped): `n = |target.resolve(activator = A)|`.
  If `n > _lastCount`, then `execute(sceneTs, A)` (ActorAdded only) and `_lastCount = n`.
- `actorRemoved(A)` (on removal, a tick after destroy, after A's mappings are gone): only if
  `_lastCount > 0`, compute `n = |target.resolve(A)|`. If `n < _lastCount`, then:
  - ActorRemoved runs `execute(sceneTs, A)` if `!all`, **or** if `_lastCount == 1` (the *previous*
    count, so this was the last one). Then `_lastCount = n`.
- So `all = true` (the default) means "fire once, when the target set becomes empty". `all = false`
  means "fire for each removal". The activator is the removed or added actor.
- Counting uses whatever the target returns, including entries for Tagged. Changes not seen as
  increases on add or decreases on remove, such as entries added later, are not tracked.
- `_lastCount` only updates on these events. A target that is already empty at startup (count 0)
  never fires ActorRemoved until something has been added and counted.
- `shutdown` unregisters.

### 1.14 VariableChanged
- `action`.
- Fires on **every** `setVariable` on the owning entry or actor, for **any variable name** (there
  is no name filter, and the value need not have changed): `execute(ts, activator = the setter's
  source)`. With `SetVariable` that source is the `_source` of the SetVariable action.
- On actors it can fire during spawn only if handlers already exist.

### 1.15 Request (not in the data list)
`name` is matched against a client request; the activator is the requesting pawn.

### 1.16 Dispatch summary
| event | delivered to | activator passed to the action |
|---|---|---|
| startup | all handlers of an entity | source |
| shutdown | all handlers | destroyer's activator / entry itself |
| signal(name) | handlers of the entity that is a Signal target | Signal action's `_source` |
| variableChanged | handlers of the entity whose variable was set | SetVariable action's `_source` |
| sensor trigger | Intersection-family handlers | intersecting actor |
| actor add/remove | ActorAdded/Removed | the added/removed actor |
| timer/tick | Timer/WarnTimer/Tick | source |

---

## 2. Actions (`ActionConfig` → `ActionLogic`)

`boolean execute(int timestamp, Logic activator)`. Every target, condition and expression inside
an action is created with the same `_source` and receives the action's **activator** when
resolved. "Success" semantics are listed per class; only Compound(stopOnFailure),
Conditional, Switch, Random and the `Action` condition propagate results.

### 2.1 SpawnActor
| field | default |
|---|---|
| actor: ConfigReference<ActorConfig> | null; **null makes the logic class `None`** (returns true) |
| location: TargetConfig | Source |

- `execute`: resolve `location` with the activator. **For each resolved target T, spawn one actor**
  at `T.getTranslation()` with rotation `T.getRotation()`, at time `timestamp`. Returns true if at
  least one spawn was *attempted*: `spawnActor()` itself always returns true here, even if the
  scene manager returned null. If the location resolves to empty, it returns false.
- Location semantics: a placeable entry gives its translation and (rotZ − π/2); an area gives its
  centroid and 0; an actor gives its current translation and rotation; Source and Activator give
  the source or activator entity.
- `preStartup` sets the new actor's `source = action._source` and `activator = action activator`
  **before** its Startup handlers run, so `ActivatorOf` works inside them.
- If the actor's `spawnMask != 0` and its shape collides at the chosen point, it searches rings at
  distance 1..4 of (bounds width + 0.01, height + 0.01): the bottom row left→right, the right
  column bottom→top, the top row right→left, then the left column top→bottom. It takes the first
  point that does not collide (masked by `spawnMask`) and from which the original point is
  reachable by pathfinding within a path length of 8. If none is found, it keeps the original
  point. The WARP flag is set during the search.

### 2.2 SpawnRotatedActor (extends SpawnActor)
- `rotation: float = 0` (rad), `relative: boolean = false`, `rotationVariance: float = 0` (rad).
- Rotation is `normalizeAngle((relative ? T.rotation : 0) + rotation + (variance>0 ?
  variance*(random()−0.5) : 0))`. Translation is `T.translation`.

### 2.3 SpawnTransformedActor (extends SpawnRotatedActor)
- Adds `translation: Vector2f = (0,0)`.
- Translation is `T.translation + rotate(translation, T.rotation)`. The offset is always rotated by
  the target's rotation, regardless of `relative`. Rotation is computed as in §2.2.

### 2.4 SpawnRandomTranslatedActor (extends SpawnActor)
| field | default |
|---|---|
| count: int | 1 |
| stepSize: float | 1.0 |
| steps: int | 1 |
| collisionMask: int | 0 |
| collisionSource: TargetConfig | Source |

- Per location target T: if `collisionMask != 0`, resolve `collisionSource` with the activator and
  take the first result's translation as `origin`; otherwise there is no origin.
- `count` times: up to 3 attempts. Each attempt picks
  `loc = T.translation + (ix*stepSize, iy*stepSize)` with ix and iy uniform integers in
  **[−steps, steps]** inclusive. An attempt is accepted if `loc` is new for this call (a set of
  used locations) **and** either there is no origin or the segment origin→loc does not collide
  with the scene under `collisionMask`. If accepted, spawn at `loc` with rotation `T.rotation` and
  break. Returns true if any spawn was accepted.

### 2.5 SpawnFacingActor (extends SpawnActor)
- `facing: TargetConfig = Source`.
- Per location T: resolve `facing` with the activator. If it is non-empty, rotation =
  `atan2(F0.y − T.y, F0.x − T.x)` (towards the **first** facing result); otherwise T.rotation.

### 2.6 Conditional
- `condition: ConditionConfig = Tagged{tag="", all=false, target=Source}`, `action: ActionConfig
  = SpawnActor`, `elseAction: ActionConfig = null`.
- If `condition.isSatisfied(activator)`, return `action.execute(...)`. Else, if there is an
  `elseAction`, return its result. Otherwise return **true**. A failing condition with no else
  counts as success.

### 2.7 Compound
- `actions: ActionConfig[] = []`, `stopOnFailure: boolean = false`.
- Executes the actions in order: `success = action.execute(...) | success`, which is a cumulative
  OR. If `stopOnFailure && !success`, return false immediately.
  - Subtle: once **any** earlier action has succeeded, `success` stays true and stopOnFailure can
    no longer stop the sequence. In practice it means "stop while nothing has succeeded yet",
    which usually means only the first action can stop it.
- Returns the cumulative OR. An empty Compound returns false. Null (None) children are dropped
  from the array at init.

### 2.8 Delayed
- `delay: int = 0` (**milliseconds**), `variance: int = 0` (ms), `action: ActionConfig =
  SpawnActor`.
- `execute`: if already removed, or the scene manager is not running, return false. Otherwise
  `d = variance==0 ? delay : max(0, delay + randInt[0, 2*variance) − variance)`. It schedules an
  interval for `sceneTs + d` (relative to the **scene's current tick timestamp**, not the
  `timestamp` argument) that remembers the activator, and returns **true** immediately.
- On expiry (in the runnable phase, §0.5): `action.execute(sceneTs, storedActivator)`. The result
  is ignored.
- `removed()` (owner entity removed or destroyed-then-removed, or handler removed) cancels all
  pending intervals. **An actor's pending Delayed actions die with it** when it is removed (the tick
  after destroy). An entry's die when the entry is removed.

### 2.9 FireEffect
- `effect: ConfigReference<EffectConfig> = null` (null returns true), `location: TargetConfig =
  Source`.
- For each target T: `fireEffect(ts, target=T, translation=null, rotation=0, effect)`. The effect
  is placed at T's translation and rotation, attached to T's entity key, and its timestamp is
  clamped to `>= previousTimestamp + 1`. If the EffectConfig has an `action`, it runs immediately
  with activator = T (or the effect itself if there is no target) and source = the effect logic.
  Always returns **true**.

### 2.10 Random
- `actions: WeightedAction[] = []`. Each WeightedAction is `{weight: float = 1.0, action:
  ActionConfig = SpawnActor}`.
- Picks an index with probability weight/sum (`RandomUtil.getWeightedIndex`). It returns -1 if the
  sum ≤ 0 or any weight < 0, and then the action returns true. Otherwise it returns the chosen
  action's result.

### 2.11 Switch / Case
- `cases: Case[] = []`, `defaultAction: ActionConfig = null`. Each Case is `{condition:
  ConditionConfig = Tagged{}, action: ActionConfig = SpawnActor}`.
- Takes the first case whose condition (with the activator) is satisfied and returns its action's
  result. If none matches, returns the defaultAction's result, or **true** if there is none.

### 2.12 Signal
- `name: String = ""`, `target: TargetConfig = Source`.
- For each resolved target X: `X.signal(ts, source = this action's _source, name)`. Only
  EntryLogic and ActorLogic react (§0.2, §0.3); a destroyed actor ignores it. Delivery is
  synchronous and in target order, recursively; a handler reacting to the signal runs before the
  next target is signalled. Always returns **true**.
- There is no broadcast and no scene-level name registry. Matching is per receiving handler by
  exact `name` equality.

### 2.13 DestroyActor
- `target: TargetConfig = Source`, `endScene: boolean = false`.
- For each target that is an `ActorLogic`: `destroy(ts, activator, endScene)` (§0.3). Returns
  true if at least one target was an actor. Already-destroyed actors still count as success,
  because `destroy` returns silently.
- `endScene = true` suppresses the destroyed actor's Shutdown handlers.

### 2.14 ExpressionSwitch / ExpressionCase
- `value: ExpressionConfig = Constant{""}`, `cases: ExpressionCase[] = []`, `defaultAction = null`.
  Each ExpressionCase is `{value: ExpressionConfig = Constant{""}, action = SpawnActor}`.
- Evaluates `v = value.evaluate(activator, previous=null)` once. For each case in order it
  evaluates the case value and, if `valuesEqual(v, caseV)` (§6.3), returns that action's result.
  Otherwise it returns the default's result, or true.

### 2.15 RotateActor
- `target: TargetConfig = Source`, `rotation: FloatVariable = Uniform(−π, +π)`.
- For each ActorLogic target: `r = rotation.getValue()`, sampled **per target**. Then
  `move(x, y, normalizeAngle(actor.rotation + r))`. If the actor is Mobile, its `direction` also
  becomes `normalizeAngle(direction + r)`. Returns true if any actor was rotated. The rotation is
  relative, not absolute.

### 2.16 WarpActor
- `target: TargetConfig = Source`, `location: TargetConfig = Tagged{""}`, `maxWarpPath: int = 0`,
  `resetMap: boolean = false`.
- For each ActorLogic target: re-resolve `location` (with the activator) and skip if it is empty.
  Pick **one uniformly random** location L. Then
  `warp(L.x, L.y, L.rotation, tx=L.x, ty=L.y, adjust=true, maxWarpPath)`. `resetMap` calls a hook
  that does nothing in Clyde. Returns true if any warp happened.
- `warp`: sets the actor's `WARP` flag (cleared on the next tick) and moves the actor. If
  `spawnMask != 0`, it validates reachability: with `maxWarpPath > 0` it needs a path back to the
  old position within that length; otherwise a path to (tx, ty) within 8. If the actor collides or
  cannot path, it runs a spawn-point search like §2.1 and re-checks; on failure it reverts to the
  old position.
- `WarpTransformedActor` (not in the data list) adds rotation, translation and rotatedTranslation.
  When `rotatedTranslation=false` the translation offset is **ignored** (a Clyde bug), and a
  non-zero offset makes the actor face the location point.

### 2.17 TargetedAction
- `target: TargetConfig = Source`, `action: ActionConfig = SpawnActor`.
- For each resolved target X (with the original activator): `action.execute(ts, activator = X)`.
  This **re-roots the activator**. Always returns **true**, and child results are ignored.

### 2.18 ServerLog
- `level: LogLevel = INFO` (DEBUG/INFO/WARN/ERROR), `message: String = ""`.
- Substitutions are applied in this order:
  1. `%trace` is removed. If any was present, a stack trace is attached.
  2. `%source:NAME` and then `%activator:NAME` are replaced by `String(entity.getVariable(NAME))`.
     NAME runs up to the next space or comma.
  3. `%source`, `%activator` and `%stamp` are replaced.
- Returns **true**. In a port, log to the console and do nothing else.

### 2.19 None
Returns true. Also used for `SpawnActor` with a null actor.

### 2.20 Portals: TaggedPortal (with MoveBody/MoveAll)
- `AbstractMove`: `sceneId: int = 0`, `portal: Portal = TaggedPortal{tag=""}`. Other portal types
  are `TilePortal{x,y}` (key Coord) and `EntryPortal{id}` (key int).
- MoveBody (`target = Source`) moves each pawn target's body to `sceneId` with portal key = the
  `tag` string. It returns true if any body moved. MoveAll moves every occupant and returns true.
  As written, MoveAll would throw a ClassCastException in Clyde: `moveBody` casts the config to
  `MoveBody`.
- On arrival, a String portal key picks a **random** logic from `getTagged(tag)` in the
  destination scene and uses its translation and rotation as the spawn transform. If the key is
  absent, a random default-entrance logic is used. If there is none, (0,0) with rotation 0.

### 2.21 Others present in Clyde (for completeness)
- **SetVariable** `{name="", target=Source, value=Constant}`: for each target X,
  `X.setVariable(ts, _source, name, value.evaluate(activator, previous = X.getVariable(name)))`.
  Returns true.
- **SetFlag** `{target=Source, flag="", on=true}`: looks up the static int field `flag` on the
  actor's class by reflection and sets or clears that bit. Returns true if any succeeded.
- **StepLimitMobile**, **ForceClientAction**: client-facing. ForceClientAction returns true if it
  was sent to any pawn.
- **ServerLogTarget** `{message, target}`: returns true if there were any targets.
- **Fail** `{action}`: executes `action` and returns **false**. It exists to drive
  stopOnFailure and conditions.

---

## 3. Targets (`TargetConfig` → `TargetLogic`)

`resolve(activator, results)` **appends** to the results list. It does not de-duplicate (except
where noted), and order is preserved. "Source" always means the owning entity (`_source`), never
the handler or action.

| class | fields = default | resolve |
|---|---|---|
| Source | – | `[_source.resolveTarget()]` (always exactly one) |
| Activator | – | `[activator.resolveTarget()]` |
| ActivatorOf | `target = Source` | for each X in target that is `Activated` (ActorLogic) with a non-null `getActivator()`, append that activator |
| Tagged | `tag = ""` | `getTagged(tag)` as a whole: entries and actors, insertion order, **including destroyed-but-not-yet-removed actors** |
| InstanceOf | `logicClass = "com.threerings.tudey.server.logic.PawnLogic"` | all registered logics that are instances of that class (an unknown class name falls back to `Logic`, i.e. everything) |
| Intersecting | `actors = true`, `entries = false`, `region = Region.Default` | for each region shape: if actors, every ActorLogic in the actor space intersecting it; if entries, every scene entry intersecting it that has an EntryLogic. Duplicates are possible across shapes. |
| RandomSubset | `size = 1`, `target = Source` | resolve target. If count ≤ size, all of it. Else if size==1, one random element; else a random subset of `size` |
| NearestSubset | `size = 1`, `target = Source`, `location = Source` | if count ≤ size, all. Else the reference point is the **mean of all `location` translations**, the targets are sorted by distance ascending, and the first `size` are taken |
| FarthestSubset | same | same, sorted descending |
| Conditional | `condition = Tagged{}`, `target = Source` | targets X for which `condition.isSatisfied(activator = X)` holds. **The condition sees each candidate as its activator.** |
| Compound | `targets = []` | concatenation, in order (null children dropped) |
| Behavior | `target = Source` | for each AgentLogic X, append `X.getBehaviorTarget()` if non-null |
| Excluding | `target = Source`, `excluding = Source` | resolve target. If it is non-empty, resolve excluding and remove **all** occurrences of each excluded logic (identity), returning the rest |
| Randomized | `target = Source` | the target list, shuffled |

Notes:
- Conditional-target conditions usually use `target = Activator` inside the condition to test
  each candidate.
- NearestSubset with an empty `location` divides by zero (NaN distances), giving an unspecified
  order.
- `resolveTarget()` is identity in Clyde. The game may override it, for example to map a handler
  or sub-logic to its owner.

---

## 4. Conditions (`ConditionConfig` → `ConditionLogic`)

`isSatisfied(activator)`. The "all/any" pattern used by several conditions is: iterate the
targets; if `pred(t) != all`, return `!all`; at the end return `all`. So **any** (all=false) over
an empty set is false, and **all** (all=true) over an empty set is true.

| class | fields = default | semantics |
|---|---|---|
| Tagged | `tag = ""`, `all = false`, `target = Source` | any/all of target have `hasTag(tag)` (an actor uses `TagConfig.hasTag`, which includes derived tags; an entry checks its tag array) |
| InstanceOf | `logicClass = PawnLogic`, `all = false`, `target = Source` | any/all targets are instances of the class |
| Intersecting | `allFirst = false`, `allSecond = false`, `first = Region.Default`, `second = Region.Default` | over the shapes of `first`: any/all(allFirst) shape A such that, over the shapes of `second`, any/all(allSecond) `A.intersects(B)` |
| IntersectsScene | `region = Region.Default`, `collisionMask = 0` | true if any region shape collides under `collisionMask` with the scene model (tiles and entries) or with a not-yet-destroyed actor whose `collisionFlags & mask` is non-zero. **Mask 0 (the default) means always false** |
| DistanceWithin | `minimum = 0`, `maximum = 0`, `allFirst = false`, `allSecond = false`, `first = Source`, `second = Activator` | any/all first F, any/all second S: `min <= |F−S| <= max` (inclusive) |
| Random | `probability = 0.5` | `random() < probability` |
| Limit | `limit = 1` | true for the first `limit` evaluations (a counter per logic instance), then false forever |
| All | `conditions = []` | AND, short-circuit, in order. Empty gives true |
| Any | `conditions = []` | OR, short-circuit. Empty gives false |
| FlagSet | `flagName = "WARP"`, `set = true`, `target = Source` | if **any** target is an ActorLogic whose actor has the flag `flagName` set, return `set`; else return `!set`. So with `set = false` it means "no target has it". Non-actors count as "not set". |
| Cooldown | `time = 0` (ms) | if `sceneTs > next` (next starts at -1): `next = sceneTs + time` and return true; else false. **Strict `>`**, so `time = 0` still allows at most one success per tick |
| Not | `condition = Tagged{}` | negation |
| Always | – | true |
| Evaluate | `expression = Constant{""}` | `coerceToBoolean(expr.evaluate(activator, null))` |
| Action | `action = SpawnActor` | executes the action (side effects!) and returns its success |
| Is | `all = false`, `target = Tagged{""}`, `source = Source` | `S0` = the first result of `source` (false if there is none); any/all of `target` are identical (`==`) to `S0` |
| DateRange | `start: Long = null`, `end: Long = null` (epoch ms) | `now >= start` (if set) and `now <= end` (if set), using the wall clock |

FlagSet flag names are resolved by reflection as a public static int field on the actor's
**runtime class**. Clyde defines `WARP = 1` (Actor), `MOVING = 2` (Mobile), and
`TURNING_LEFT = 4`, `TURNING_RIGHT = 8` (Agent). Game subclasses may add more fields. An unknown
name logs a warning and counts as unset.

---

## 5. Regions (`RegionConfig` → `RegionLogic`)

`resolve(activator, shapes)` appends world-space shapes.

| class | fields = default | shapes |
|---|---|---|
| Default | `location = Source`, `expansion = 0` | for each resolved location L with a non-null `getShape()`: that shape, or `shape.expand(expansion)` if it is non-zero. An entry gives its placeable or area shape; an actor gives its world shape |
| Transformed | `location = Source`, `shape: ShapeConfig = Point` | for each L: `shape` transformed by `(L.translation, L.rotation)`. No scale. A placeable's rotation is rotZ − π/2 |
| Fixed | `shape = Point` | the shape in **world coordinates** as-is, ignoring the activator |

Intersection *handlers* do not use RegionConfig. They use `IntersectionShape` (§1.11). Regions
appear in `Intersecting` targets and in `Intersecting` and `IntersectsScene` conditions.
`ShapeConfig.Point` gives the point (0,0) before transformation.

---

## 6. Expressions (`ExpressionConfig` → `ExpressionLogic`)

`evaluate(activator, previous)` returns Object: null, Boolean, Double (Long for Round, Float for
Variable, Integer for NumTargets) or String.

### 6.1 Classes
| class | fields = default | result |
|---|---|---|
| Constant | `value = ""` | `parseValue(value)`: case-insensitive "null", "true" or "false"; else Double if it parses; else the raw string. `""` stays `""`. |
| Parsed | `expression = ""` | parsed once (§6.4); on failure, `Constant("")` |
| Reference | `name = ""`, `target = Source` | the first non-null `getVariable(name)` across the targets, else null |
| Previous | – | `previous` (the target's current value inside SetVariable; null elsewhere) |
| NumTargets | `target = Tagged{""}` | Integer count of the resolved targets |
| Variable | `variable: FloatVariable = Constant(0)` | `variable.getValue()`, re-sampled on each evaluation |
| Round / Floor / Ceil | `operand = Constant` | `Math.round` (gives a long, half-up) / floor / ceil of the double |
| Increment / Decrement / Negate | `operand` | d+1 / d−1 / −d |
| Add, Subtract, Multiply, Divide, Remainder, Power | `firstOperand`, `secondOperand` = Constant | double arithmetic. Divide by 0 gives ±Inf or NaN. Remainder uses Java `%` (the sign follows the dividend) |
| Not / And / Or / Xor | boolean coercion; And and Or **short-circuit** |
| Less, Greater, LessEquals, GreaterEquals | double comparison |
| Equals | `valuesEqual` |
| IsNull | `operand == null` |

### 6.2 Coercions
- `coerceToDouble`: null gives 0; a Boolean gives 1 or 0; a Number gives its value; a String gives
  `parseDouble`, or else `parseBoolean(s) ? 1 : 0`. Anything else gives 0.
- `coerceToBoolean`: null gives false; a Boolean gives itself; a Number gives `!= 0`; a String gives
  `parseDouble(s) != 0`, or else `"true".equalsIgnoreCase(s)`. Anything else gives false.

### 6.3 valuesEqual(a, b)
1. If either is null, return `a == b` (true only if both are null).
2. If either is a Boolean, return `a.equals(b)`. So `true` ≠ `1` and `true` ≠ `"true"`.
3. Otherwise convert both to numbers (a Number, or a String that parses as a double). If both
   convert, compare numerically, so `"3"` == `3.0`. Otherwise use `a.equals(b)` (string equality).

### 6.4 Parsed grammar (shunting-yard)
Precedence (a lower number binds tighter): unary `++ -- + - !` (2, right-assoc); `* / %` (3);
binary `+ -` (4); `< <= > >=` (6); `==` (7); `&` (8); `^` (9); `|` (10); `&&` (11); `||` (12).
- Mapping: `&`/`&&` → And, `|`/`||` → Or, `^` → **Xor** (not power), `==` → Equals, unary `+` is a
  no-op.
- **`!=` and `.` are tokenised but not handled**, so the whole parse fails and becomes
  `Constant("")`.
- Number literals become Constant of the number's string form. Quoted strings become Constant.
- Identifiers: `null`, `true` and `false` (case-insensitive) become Constant; `previous` becomes
  Previous; anything else becomes `Reference{name, target = Source}`, i.e. a variable on the
  *owning entity*.

---

## 7. Implementation checklist and subtle rules

1. **Activator vs source.** Targets `Source` and `Activator` resolve against the owning entity and
   the activator passed down the execute chain. Only these points change the activator: the
   handler entry points (§1.16), `TargetedAction` (re-roots per target), `Delayed` (keeps the
   original), `Signal` (the receiver sees the *sender entity*, not the sender's activator), the
   `Conditional` target (per-candidate activator for its condition), and spawned actors (stored
   activator, readable via `ActivatorOf`).
2. **Return values.** None, Signal, FireEffect, TargetedAction, Delayed, ServerLog, SetVariable,
   MoveAll, and Conditional/Switch/ExpressionSwitch/Random with no branch taken all return true.
   SpawnActor returns false only when the location is empty. DestroyActor, RotateActor and
   WarpActor return false when no actor target was affected. An empty Compound returns false.
   Fail always returns false.
3. **Units.** Timer and WarnTimer `interval`, `offset` and `warn`, and every `refractoryPeriod`,
   are **seconds** (float). `Delayed.delay` and `variance`, and `Cooldown.time`, are
   **milliseconds** (int). Timestamps are ms ints.
4. **Timer first firing** happens after `interval + offset`, not at 0. Use `offset = −interval`
   for an immediate first firing (it is clamped to ≥ 0).
5. **Startup order.** Map all entries, then start them (unspecified order). An actor's Startup
   runs before it is mapped and before ActorAdded fires.
6. **Destroy is deferred.** Removal (ActorRemoved observers, tag-map removal, cancelling Delayed
   actions) happens on the next tick. Shutdown handlers run immediately inside `destroy`.
7. **Sensors** are triggered only by ticking Mobile, Pawn or Agent actors with non-zero
   collisionFlags `& mask`. Plain `Intersection` repeats every tick while overlapping (use
   `refractoryPeriod`). Start and Stop are per-actor edges with a one-tick hysteresis.
8. **Signal names** are exact, case-sensitive matches per handler. SignalStart and SignalStop are
   keyed per source entity and require a continuous per-tick signal.
9. **Notification orders.** Handlers fire in config order. ActorObservers fire in reverse
   registration order. Tick participants fire in registration order. Timers and Delayed actions
   run after all tick participants. Signals are delivered depth-first and synchronously.
10. **Randomness.** SpawnRotatedActor variance, Random weights, the Random condition, RandomSubset,
    Randomized, the WarpActor location pick, the Delayed variance, the TaggedPortal pick and
    `FloatVariable` sampling each draw independently on every evaluation.

---

## Appendix A: Activity logic
`ActivityLogic` (used by `ActiveLogic` actors) is a Logic whose translation, rotation, shape and
shape observers all delegate to the owning `ActiveLogic`. It has `start(ts)`, which records
`ts − activityAdvance`, plus `stop` and `tick`. It has no handlers of its own. It matters for this
spec only because, as a sub-logic, it reports its owner's position.
