"""Special bullet behaviours per weapon: bursts, splits, pulses, clouds, shards, vortexes, sticking, piercing.

Plain Python, no editor:

    python Tools/SKImport/distill_bullet_behaviours.py

Reads the research in D:/Dev/SKAssets/_research (bullet_behaviours.json, which classified every weapon's
bullets by behaviour and resolved the actors they spawn per weapon; projectile_visuals.json for child
bullets' flight and look; charged_attacks.json for charged blast radii) and writes
weapon_bullet_behaviours.json next to this script. generate_attack_profiles.py applies it to each weapon's
bullets (FClockworksBulletSpec) and fills the profile's SubBullets.

The game's client ships without its server-only numbers (timer intervals, spawn angles and counts, signal
names). Where a number survives in the data it is used. The rest are the user's choices, marked USER:
  2026-09-14: Alchemer splits bounce off what they hit; Pulsar waves every 1 s; shards fan evenly round
  360 degrees; Tortofist drops 3 missiles within 2 tiles; Catalyzer pellets stick to a monster and burst
  when your charged shot hits it; shards lie on the floor and burst when a monster touches them or
  after 10 s. Later the same day: Brandish-line explosions 1 tile apart, one every 0.1 s.
Anything else not in the data is marked INFERRED.

Output per weapon: {"normal": behaviour of its ordinary bullets, "charged": behaviour of its charged bullet
(for a bomb, of its blast), "subs": [bullet specs the behaviours spawn, referenced by index]}.
A behaviour holds only what differs from a plain bullet:
  hidden, contact_damage, passes_through, attach, detonate_attached, life_s, detonation, pulse_s,
  pulse_limit, ends_after_pulses, pulse, burst_look, clear_extra_sound
  burst: {radius_cm, damage, knockback (negative pulls), along_flight, status_chance, children}
  child: {sub, count, spread_deg, ricochet, scatter_cm, damage}
Damage multipliers are relative to whatever spawns them; knockback is a multiple of a target's own shove,
which is 2.5 tiles (generate_attack_profiles.py KNOCKBACK_TILES_PER_UNIT).
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import distill_weapon_fx as fx  # noqa: E402  (bullet flight and look, the same way the weapons' own bullets get theirs)

RESEARCH = r"D:\Dev\SKAssets\_research"
OUT = os.path.join(HERE, "weapon_bullet_behaviours.json")
KNOCKBACK_TILES_PER_UNIT = 2.5

STATUS_COLOURS = {
    "Fire": [1.0, 0.45, 0.1], "Freeze": [0.5, 0.85, 1.0], "Shock": [0.3, 1.0, 1.0], "Poison": [0.45, 1.0, 0.3],
    "Stun": [1.0, 1.0, 0.6], "Sleep": [0.7, 0.5, 1.0], "Curse": [0.6, 0.2, 0.8],
}
NEUTRAL = [0.85, 0.9, 1.0]

# A Burst Bullet's "Burst Scale" as the explosion's width in cm (INFERRED: the argument sizes the explosion
# model, not the 1-tile damage region).
BURST_WIDTH_CM = {"Small": 120.0, "Medium": 160.0, "Large": 200.0}


def shove(tiles):
    return float(tiles) / KNOCKBACK_TILES_PER_UNIT


def child(sub, count=1, spread=0.0, ricochet=False, scatter=0.0, damage=1.0):
    return {"sub": sub, "count": count, "spread_deg": spread, "ricochet": ricochet, "scatter_cm": scatter, "damage": damage}


def burst_look(colour, width_cm, height_cm=0.0, seconds=0.3, alpha=0.9, sound=None):
    return {"colour": list(colour[:3]) + [alpha], "width_cm": width_cm, "height_cm": height_cm, "seconds": seconds, "sound": sound}


def merge(base, extra):
    out = dict(base or {})
    for key, value in extra.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            merged = dict(out[key])
            merged.update(value)
            out[key] = merged
        else:
            out[key] = value
    return out


def glow_look(colour, glow_cm, core_cm=0.0, alpha=0.35):
    """A look for a bullet the original draws only with particles: a soft glowing ball, optionally cored."""
    return {"core_colour": list(colour[:3]) + [1.0], "core_cm": [core_cm * 0.8, core_cm], "glow_colour": list(colour[:3]) + [alpha],
            "glow_cm": [glow_cm * 0.85, glow_cm], "pulse_s": 0.6, "trail_cm": 0.0, "mesh_glb": None, "mesh_cm": 20.0,
            "spin_deg": 0.0, "muzzle": None, "orbit": None}


def stationary(life_s, radius_cm, look, **behaviour):
    """A bullet that does not fly: a cloud, a mine, a missile waiting on its fuse."""
    return merge({"speed_cm": 0.0, "range_cm": 0.0, "radius_cm": radius_cm, "life_s": life_s, "look": look}, behaviour)


def flying(actor, colour=None, **behaviour):
    spec = fx.bullet_spec(fx.PROJECTILES.get(actor), None, colour)
    return merge(spec, behaviour) if spec else None


class Subs:
    def __init__(self):
        self.specs, self.keys = [], {}

    def add(self, key, spec):
        if spec is None:
            return None
        if key not in self.keys:
            self.keys[key] = len(self.specs)
            self.specs.append(spec)
        return self.keys[key]


def generation(actor):
    for word, rank in (("Primary", 0), ("Secondary", 1), ("Tirtiary", 2)):
        if actor.endswith("/" + word):
            return rank
    return None


def as_list(value):
    return value if isinstance(value, list) else ([value] if value else [])


def main():
    def load(name):
        with open(os.path.join(RESEARCH, name), encoding="utf-8") as handle:
            return json.load(handle)

    research = load("bullet_behaviours.json")
    visuals = load("projectile_visuals.json")
    charged_research = load("charged_attacks.json")
    with open(os.path.join(HERE, "weapons.json"), encoding="utf-8") as handle:
        statuses = {w["display_name"]: w.get("status") for w in json.load(handle)}
    with open(os.path.join(HERE, "weapon_fx.json"), encoding="utf-8") as handle:
        weapon_fx = json.load(handle).get("weapons") or {}
    fx.PROJECTILES.update(visuals.get("projectiles") or {})
    sword_bullets = visuals.get("sword_bullet_weapons") or {}
    gaps_path = os.path.join(RESEARCH, "weapon_gaps", "weapon_gaps.json")
    gaps = load(os.path.join("weapon_gaps", "weapon_gaps.json")) if os.path.isfile(gaps_path) else {}
    actors = research.get("actors") or {}

    def resolved_for(actor, weapon):
        for variant in (actors.get(actor) or {}).get("resolved_variants") or []:
            if weapon in (variant.get("weapons") or []):
                return variant.get("resolved") or {}
        return {}

    weapons_out, unresolved = {}, []
    for name, entry in (research.get("weapons") or {}).items():
        types = entry.get("behaviour_types") or {}
        if not types:
            continue
        subs = Subs()
        out = {"normal": None, "charged": None}
        colour = STATUS_COLOURS.get(statuses.get(name), NEUTRAL)
        roots = {slot: next(iter(((entry.get(slot) or {}).get("root_spawns") or {}).keys()), "") for slot in ("normal", "charged")}
        reached = (entry.get("normal") or {}).get("actors_reached", []) + (entry.get("charged") or {}).get("actors_reached", [])

        def apply(kind, behaviour):
            for slot in types.get(kind) or []:
                out[slot] = merge(out[slot], behaviour)

        # --- Alchemer, Driver, Owlite Wand, Nog Blaster: each generation splits into the next. ---------------
        if "split_on_hit" in types or "burst_on_hit" in types:
            lines = sorted({a.rsplit("/", 1)[0] for a in reached if generation(a) is not None})
            if not lines:
                unresolved.append(name + ": no split generations reached")
            else:
                line = lines[0]
                tertiary = subs.add(line + "/Tirtiary", flying(line + "/Tirtiary"))
                # A split bounces off what it hit (USER) at the parent's damage (research: 'Damage (Split 1)', x1.0).
                secondary = subs.add(line + "/Secondary", flying(line + "/Secondary", detonation={"children": [child(tertiary, ricochet=True)]}))
                primary = subs.add(line + "/Primary", flying(line + "/Primary", detonation={"children": [child(secondary, ricochet=True)]}))
                gens = [primary, secondary, tertiary]
                root_gen = generation(roots["normal"])
                if "split_on_hit" in types and root_gen is not None and root_gen < 2:
                    apply("split_on_hit", {"detonation": {"children": [child(gens[root_gen + 1], ricochet=True)]}})
                if "burst_on_hit" in types:
                    mark = re.search(r"MK(IV|III|II|I)\b", roots["charged"])
                    pairs = {"I": [(2, 2)], "II": [(1, 2)], "III": [(0, 2)], "IV": [(0, 2), (2, 2)]}.get(mark.group(1) if mark else "II")
                    # Children do 0.4167 of the charged shot (research). The pair leaves either side of the
                    # bounce, 40 degrees apart (INFERRED: the spawn rotations are stripped).
                    apply("burst_on_hit", {"detonation": {"children": [child(gens[g], count=c, spread=40.0, ricochet=True, damage=0.4167) for g, c in pairs]}})

        # --- Brandish line: an invisible floor-hugging carrier whose explosions are the attack. -----------------
        if "timed_trail_bursts" in types:
            shot = ((sword_bullets.get(name) or {}).get("charged_bullets") or [{}])[0]
            args = shot.get("actor_args") or {}
            count = int(float(args.get("Burst Count") or 3))
            arg_colour = fx.rgba(fx.nums(args["Color"])) if args.get("Color") else list(colour) + [1.0]
            sounds = (weapon_fx.get(name) or {}).get("sounds") or {}
            apply("timed_trail_bursts", {
                "hidden": True, "contact_damage": 0.0, "passes_through": True,
                # USER: one explosion every 0.1 s, i.e. a tile apart at the carrier's 10 tiles a second.
                "pulse_s": 0.1, "pulse_limit": count, "ends_after_pulses": True,
                # Research: a 1-tile damage region, a 2-tile shove pushed from 10 tiles behind (along the flight).
                "pulse": {"radius_cm": 100.0, "damage": 1.0, "knockback": shove(2.0), "along_flight": True},
                # The charge's bomb sound is the explosion's (the Burst Trail's destruction transient).
                "burst_look": burst_look(arg_colour, BURST_WIDTH_CM.get(args.get("Burst Scale"), 120.0), 260.0, 0.35, 0.9, sounds.get("charged_extra")),
                "clear_extra_sound": bool(sounds.get("charged_extra")),
            })

        # --- Pulsar line: the orb throws a wave every second (USER) that bursts with a heavy shove. ----------
        if "timed_spawn_wave" in types:
            rank_match = re.search(r"Rank(\d)", roots["normal"])
            rank = int(rank_match.group(1)) if rank_match else 3
            radius = None
            for action in as_list(resolved_for("Bullet/Handgun/Pulsar/Parts/Base Stage2", name).get("on_detonation")):
                shape = action.get("radius_or_shape")
                if action.get("do") == "damage_region" and isinstance(shape, dict) and shape.get("radius"):
                    radius = float(shape["radius"]) * 100.0
            if radius is None:
                radius = {2: 95.0, 3: 120.0}.get(rank, 145.0)  # INFERRED where the variant is not resolved for this weapon
                unresolved.append(name + ": Pulsar wave radius inferred from rank")
            multiplier = 1.353 if "Vanilla" in roots["normal"] else 1.4286
            wave = subs.add("Pulsar Stage2 %s %d" % (name, radius), flying(
                "Bullet/Handgun/Pulsar/Parts/Base Stage2", colour, contact_damage=0.0,
                detonation={"radius_cm": radius, "damage": 1.0, "knockback": shove(4.0), "along_flight": True},
                burst_look=burst_look(colour, radius * 2.0, radius * 1.6, 0.3)))
            apply("timed_spawn_wave", {"pulse_s": 1.0, "pulse": {"children": [child(wave, damage=multiplier)]}})

        # --- Charged Pulsar: one slow shot that bursts in a radius. -------------------------------------------
        if "area_detonation_bullet" in types:
            radius_tiles = None
            for move in (charged_research.get(name) or {}).get("moves") or []:
                for hit in move.get("hits") or []:
                    region = (hit.get("spawns") or {}).get("detonation_region") or {}
                    if region.get("radius"):
                        radius_tiles = float(region["radius"])
            if radius_tiles is None:
                radius_tiles = 0.95
                unresolved.append(name + ": charged Pulsar radius inferred")
            apply("area_detonation_bullet", {"contact_damage": 0.0,
                                             "detonation": {"radius_cm": radius_tiles * 100.0, "damage": 1.0, "knockback": shove(4.0), "along_flight": True},
                                             "burst_look": burst_look(colour, radius_tiles * 200.0, radius_tiles * 160.0, 0.35)})

        # --- Catalyzer line: shots stick and wait; the charged shot sets off what is stuck to what it hits. ----
        if "attach_on_hit" in types:
            poison = any(word in name for word in ("Toxic", "Virulent", "Biohazard", "Pollinator"))
            apply("attach_on_hit", {"attach": True, "contact_damage": 0.1,  # research: Base/Constant 1.0, the shot itself does almost nothing
                                    # INFERRED: the orbital's blast radius and damage are behind a stripped signal.
                                    "detonation": {"radius_cm": 150.0, "damage": 0.85 if poison else 0.7, "knockback": shove(3.0)},
                                    "burst_look": burst_look(colour, 300.0, 200.0, 0.3)})
        if "detonate_attached" in types:
            apply("detonate_attached", {"detonate_attached": True})

        # --- Tortofist line: the charged shot drops 3 missiles within 2 tiles (USER); each goes off after its
        # 1.75 s fuse and leaves a crystal that stings for 3 s. -------------------------------------------------
        if "scatter_then_linger" in types:
            crystal = subs.add("Tortodrone Shard %s" % colour, stationary(
                3.0, 50.0, glow_look(colour, 70.0, 20.0), contact_damage=0.0, passes_through=True,
                # Research: 0.528 against the missile's 0.726, a 1-tile shove. INFERRED: once a second, 50 cm across.
                pulse_s=1.0, pulse_limit=3, pulse={"radius_cm": 50.0, "damage": 0.727, "knockback": shove(1.0)},
                burst_look=burst_look(colour, 100.0, 80.0, 0.25, 0.6)))
            missile = subs.add("Tortodrone Missile %s" % colour, stationary(
                1.75, 30.0, glow_look([1.0, 0.55, 0.2], 60.0, 25.0), contact_damage=0.0, passes_through=True,
                # Research: 1.5-tile shove. INFERRED: a 1-tile blast (the region has no shape in the data).
                detonation={"radius_cm": 100.0, "damage": 1.0, "knockback": shove(1.5), "children": [child(crystal)]},
                burst_look=burst_look([1.0, 0.55, 0.2], 200.0, 180.0, 0.3)))
            apply("scatter_then_linger", {"hidden": True, "detonation": {"children": [child(missile, count=3, scatter=200.0)]}})

        # --- Status cloud bombs: a cloud that inflicts its status, no damage, on a timer for its lifespan. -----
        if "lingering_status_cloud" in types:
            radius_cm, life_s = None, None
            for action in as_list(resolved_for(roots["charged"], name).get("on_detonation")):
                args = action.get("args") or {}
                if action.get("do") == "spawn" and "Cloud" in (action.get("actor") or "") and args.get("Radius"):
                    radius_cm, life_s = float(args["Radius"]) * 100.0, float(args.get("Lifespan") or 4000) / 1000.0
            if radius_cm is None:
                radius_cm, life_s = 200.0, 4.0
                unresolved.append(name + ": cloud radius and lifespan inferred")
            cloud = subs.add("Cloud %s %d %.1f" % (statuses.get(name), radius_cm, life_s), stationary(
                life_s, 10.0, glow_look(colour, min(radius_cm * 2.0, 400.0), alpha=0.12), contact_damage=0.0, passes_through=True,
                # Research: status chance 0.5 per tick. INFERRED: a tick a second (the interval is stripped).
                pulse_s=1.0, pulse_limit=int(round(life_s)), pulse={"radius_cm": radius_cm, "damage": 0.0, "knockback": 0.0, "status_chance": 0.5},
                burst_look=burst_look(colour, radius_cm * 2.0, 40.0, 0.8, 0.25)))
            apply("lingering_status_cloud", {"detonation": {"children": [child(cloud)]}})

        # --- Shard bombs: shards fan evenly round the bomb (USER) and become mines that burst when a monster
        # touches them or after 10 s (USER). ---------------------------------------------------------------------
        if "shard_burst" in types:
            root = roots["charged"]
            count = 1 if "Sloppy" in root else (8 if "(T3)" in root else 6)
            ratio = 1.286
            for handler in as_list(resolved_for(root, name).get("handlers")):
                blast = shard = None
                for action in as_list(handler.get("actions")):
                    if action.get("do") == "damage_region":
                        blast = ((action.get("damage") or {}).get("parts") or [{}])[0].get("factor")
                    inner = action.get("action") or {}
                    if inner.get("do") == "spawn" and "Shard Base" in (inner.get("actor") or ""):
                        shard = (((inner.get("args") or {}).get("Damage") or {}).get("parts") or [{}])[0].get("factor")
                if blast and shard:
                    ratio = round(float(shard) / float(blast), 3)
                    break
            speed = 3000.0 if "Sloppy" in root else 2000.0
            mine = subs.add("Shard Mine %s %.3f" % (colour, ratio), stationary(
                10.0, 40.0, glow_look(colour, 50.0, 18.0, alpha=0.5), contact_damage=0.0,
                # INFERRED: a 1-tile burst with a small shove (the signal that sets the shard off is stripped).
                detonation={"radius_cm": 100.0, "damage": ratio, "knockback": shove(1.5)},
                burst_look=burst_look(colour, 200.0, 160.0, 0.3)))
            shard_spec = {"speed_cm": speed, "range_cm": speed * 0.15, "radius_cm": 20.0, "look": glow_look(colour, 30.0, 12.0, alpha=0.5),
                          "contact_damage": 0.0, "detonation": {"children": [child(mine)]}}
            shard = subs.add("Shard %s %d" % (colour, speed), shard_spec)
            apply("shard_burst", {"detonation": {"children": [child(shard, count=count, spread=360.0)]}})

        # --- Vortex bombs: the blast pulls, five implode pulses pull again over 2.5 s, then a pulling burst. ----
        if "pull_vortex_chain" in types:
            tier = 1 if "Charge" in name else (3 if any(word in name for word in ("Vortex", "Celestial", "Obsidian")) else 2)
            implode_radius = {1: 145.0, 2: 195.0, 3: 295.0}[tier]   # research: 1.45 / 1.95 / 2.95 tiles
            explode_radius = {1: 95.0, 2: 145.0, 3: 195.0}[tier]    # research: 0.95 / 1.45 / 1.95 tiles
            implode = subs.add("Implode %d %s" % (tier, colour), stationary(
                2.5, 10.0, glow_look(colour, implode_radius, 30.0, alpha=0.2), contact_damage=0.0, passes_through=True,
                # Research: 5 stages of 500 ms, each pulling 1.25 tiles; INFERRED: one pull per stage.
                pulse_s=0.5, pulse_limit=5, pulse={"radius_cm": implode_radius, "damage": 0.0, "knockback": -shove(1.25)},
                # Research: the explode stage pulls 8 tiles.
                detonation={"radius_cm": explode_radius, "damage": 1.0, "knockback": -shove(8.0)},
                burst_look=burst_look(colour, implode_radius * 2.0, 60.0, 0.45, 0.4)))
            apply("pull_vortex_chain", {"detonation": {"knockback": -shove(1.25), "children": [child(implode)]}})

        # --- Warmaster bombs: the blast leaves rings of pellets circling where it went off, each pellet striking once
        # on touch (research _research/weapon_gaps: rings, radii, speeds in revolutions a second and lifetime from
        # actor.xml; the strike rate and the centre are INFERRED there). ----------------------------------------------
        if "orbit_marker_orbitals" in types:
            record = (gaps.get("orbitals") or {}).get(name)
            if not record or not record.get("rings"):
                unresolved.append(name + ": orbitals not in weapon_gaps.json")
            else:
                purple = [0.6, 0.0, 0.8]  # the orbital pellet's purple, as the blast's colour 0.6, 0.0, 0.8
                pellet_cm = float((record.get("orbital_shape") or {}).get("circle_radius_cm") or 30.0) * 2.0
                rings = []
                for ring in record["rings"]:
                    look = glow_look(purple, pellet_cm * 1.5, pellet_cm, alpha=0.45)
                    look["orbit"] = {"count": int(ring["count"]), "radius_cm": float(ring["radius_cm"]), "deg_per_s": float(ring["deg_per_s"])}
                    ring_sub = subs.add("Warmaster Orbitals %s %.0f %.0f" % (name, ring["radius_cm"], ring["deg_per_s"]), stationary(
                        float(record.get("lifetime_s") or 3.0), 10.0, look, contact_damage=0.0, passes_through=True, orbit_hits_once=True))
                    rings.append(child(ring_sub))
                apply("orbit_marker_orbitals", {"detonation": {"children": rings}})

        # --- Magnus, Callahan, Silversix, Spur, Winmillion, Avenger lines: the shot passes through. ------------
        if "piercing_multi_hit" in types:
            apply("piercing_multi_hit", {"passes_through": True})
        if "delayed_spawn_bolt" in types:
            apply("delayed_spawn_bolt", {"passes_through": True})

        if out["normal"] or out["charged"]:
            weapons_out[name] = {"normal": out["normal"], "charged": out["charged"], "subs": subs.specs}

    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump({"_about": "Written by distill_bullet_behaviours.py. USER numbers are the user's choices of 2026-09-14 for values the game's client does not ship.",
                   "weapons": weapons_out}, handle, indent=1)

    kinds = {}
    for record in research.get("weapons", {}).values():
        for kind in record.get("behaviour_types") or {}:
            kinds[kind] = kinds.get(kind, 0) + 1
    print(f"{len(weapons_out)} weapons with special bullets -> {OUT}")
    print("orbitals built:", ", ".join(f"{k} ({kinds[k]})" for k in sorted(kinds) if k in ("orbiting_pellets", "orbit_marker_orbitals")))
    if unresolved:
        print("inferred instead of read:", "; ".join(unresolved))


if __name__ == "__main__":
    main()
