"""Boil the projectile and sound research down to what the generators need: weapon_fx.json.

Plain Python, no editor. Inputs are the two research dumps, which are too big to keep in the repo:

  projectile_visuals.json  every bullet's flight, particle layers and model; every handgun's fire
                           pattern and muzzle flash; every sword that throws bullets
  weapon_sounds.json       every weapon's sounds per move, with gains and pitch ranges

    python Tools/SKImport/distill_weapon_fx.py <projectile_visuals.json> <weapon_sounds.json>

Output, next to this script: weapon_fx.json with, per weapon, the sounds of each move, the bullets each
move fires (speed, range, hit radius, colours, sizes, pulse, streak, model, spin, muzzle colour) and
the fire pattern (when each bullet leaves and at what heading); plus the sound files and bullet models
to import, with their asset names, so stage_and_import.py and generate_attack_profiles.py agree.

The original draws bullets as particle systems, which do not export. What survives is read off the
layers: the layer the miner names as the main colour is the core, a glare or glow layer is the glow,
layers flagged as trails give the streak's length (their lifespan at the bullet's speed).
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from stage_and_import import _asset_name, SK_ASSETS, SK_RSRC  # noqa: E402

OUT = os.path.join(HERE, "weapon_fx.json")
RAD_TO_DEG = 57.29578

# The muzzle flare's colour names. The game resolves them through a colorization table the miner did
# not dump, so these are the bullets' own colours for the same names (green, cyan, yellow) and close
# matches for the rest.
MUZZLE_COLOURS = {
    "green": [0.66, 1.0, 0.22], "cyan": [0.40, 1.0, 0.75], "yellow": [1.0, 0.89, 0.12],
    "frost": [0.60, 0.85, 1.0], "silver": [0.85, 0.88, 0.92], "purple": [0.70, 0.30, 1.0],
    "red": [1.0, 0.37, 0.37], "ivory": [0.99, 0.99, 0.79], "blue": [0.36, 0.74, 1.0],
}

# A sword Burst Bullet's "Burst Scale" argument, as a core diameter in tiles (inferred).
BURST_SCALE_TILES = {"Small": 0.3, "Medium": 0.45, "Large": 0.6}


def nums(value):
    return [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?(?:[eE]-?\d+)?", str(value))]


def first(value):
    found = nums(value)
    return found[0] if found else None


def rgba(values):
    return (list(values) + [1.0, 1.0, 1.0, 1.0])[:4]


def colour_of(curve):
    """The brightest point of a colour curve: its middle, else its constant, start or end."""
    if isinstance(curve, dict):
        for key in ("middle", "value", "start", "end"):
            if curve.get(key) and nums(curve[key]):
                return rgba(nums(curve[key]))
    elif curve and nums(curve):
        return rgba(nums(curve))
    return None


def size_of(curve):
    """(smallest, largest) of a size curve, in tiles. An in-and-out curve never shows at zero size
    on a bullet, because new particles keep coming; its low end is taken as most of its high end."""
    if isinstance(curve, dict):
        values = [first(curve[key]) for key in ("start", "middle", "end", "value") if curve.get(key) and first(curve[key]) is not None]
        if not values:
            return None
        if curve.get("type") == "InAndOut":
            return (max(values) * 0.6, max(values))
        return (min(values), max(values))
    values = nums(curve)
    return (min(values), max(values)) if values else None


PROJECTILES = {}


def orbit_of(spawn_keys, depth=0):
    """(pellet count, ring radius in cm, degrees per second, pellet record) for a bullet whose visible part
    is pellets circling it. The Mixer line's core carries two; its charged core carries two that each carry
    two more, drawn here as four on the outer ring at the inner pellets' speed."""
    children = [PROJECTILES.get(key) for key in spawn_keys or []]
    children = [c for c in children if c and (c.get("motion") or {}).get("orbits")]
    if not children or depth > 2:
        return None
    motion = children[0]["motion"]
    count = len(children)
    radius = float(motion.get("orbit_radius_tiles") or 0.5) * 100.0
    # Revolutions per second: the game's Orbital computes its period as 1000 / speed ms (weapon_gaps research,
    # projectx-pcode.jar). Read as radians before 2026-09-15, which turned the Mixer pellets six times too slowly.
    speed = float(motion.get("orbit_speed") or 0.33) * 360.0
    inner = orbit_of(motion.get("handler_spawns"), depth + 1)
    if inner:
        return (count * inner[0], radius, inner[2], inner[3])
    return (count, radius, speed, children[0])


def bullet_spec(record, muzzle=None, colour=None, core_tiles=None):
    """Flight and look of one bullet actor, or None when it does not fly."""
    if not record:
        return None
    motion = record.get("motion") or {}
    orbit = orbit_of(motion.get("handler_spawns"))
    speed = float(motion.get("speed_cm_per_s") or 0.0)
    if speed <= 0.0 and motion.get("speed_tiles_per_s"):
        speed = float(motion["speed_tiles_per_s"]) * 100.0
    if speed <= 0.0 and orbit:
        speed = 800.0  # inferred: the charged core names no speed; the normal core flies at 8 tiles a second
    if speed <= 0.0:
        return None
    radius = float(motion.get("collision_radius_cm") or 0.0)

    source = record
    if orbit:
        # The core draws nothing; its pellets are the bullet, and they are what hits, so the hit radius
        # reaches out to the ring.
        source = orbit[3]
        radius = orbit[1] + float((source.get("motion") or {}).get("collision_radius_cm") or 20.0)

    look = (source.get("visual") or {}).get("look") or {}
    layers = look.get("layers") or []
    main_name = (look.get("main_colour_layer") or "").split(" : ")[-1]
    core = next((l for l in layers if l.get("layer") == main_name), None)
    glow = next((l for l in layers if l is not core and re.search(r"glare|glow", l.get("layer") or "", re.I)), None)
    if glow is None:
        glow = next((l for l in layers if l is not core and l.get("blend") == "ADDITIVE"), None)
    if core is None:
        core = next((l for l in layers if l is not glow), glow)

    core_colour = colour or (rgba(nums(look["main_colour_rgba"])) if look.get("main_colour_rgba") else None) \
        or (colour_of(core.get("colour")) if core else None) or [1.0, 1.0, 1.0, 1.0]
    core_colour = core_colour[:3] + [1.0]
    core_size = core_tiles or (size_of(core.get("size_tiles")) if core else None) or (0.1, 0.12)

    glow_size = size_of(glow.get("size_tiles")) if glow else None
    glow_colour = (colour_of(glow.get("colour")) if glow else None) or core_colour[:3] + [0.25]
    if colour:
        glow_colour = colour[:3] + [0.35]
        glow_size = glow_size or (core_size[0] * 2.0, core_size[1] * 2.0)

    glow_colour = glow_colour[:3] + [min(glow_colour[3], 0.6)]

    # A layer that lives for many seconds is an emitter's own life, not a pulse; keep pulses brisk.
    pulse = first(core.get("lifespan_s")) if core and core.get("lifespan_s") is not None else None
    pulse = min(max(pulse or 0.25, 0.05), 1.0)
    trail_life = max([first(l.get("lifespan_s")) or 0.0 for l in layers if l.get("trail")] or [0.0])
    # A trail particle fades over its life, so what reads as the streak is the brighter first third.
    if orbit:
        trail = 0.0
    elif trail_life:
        trail = min(speed * trail_life * 0.35, 150.0)
    else:
        trail = min(speed * 0.05, 100.0) if look.get("has_trail_layer") else 0.0

    mesh_glb, spin = None, 0.0
    for mesh in look.get("meshes") or []:
        glb = mesh.get("exported_glb")
        if glb and os.path.isfile(glb) and os.path.normcase(glb).startswith(os.path.normcase(SK_ASSETS + os.sep)):
            mesh_glb = os.path.relpath(glb, SK_ASSETS)
            speeds = [abs(first(s.get("speed")) or 0.0) for s in mesh.get("spin") or []]
            # The rotate_y speeds are probably radians per second (the miner could not confirm the unit).
            spin = min(max(speeds or [0.0]) * RAD_TO_DEG, 1440.0)
            break

    return {
        "speed_cm": speed,
        # The Mixer core names no fuse; ten tiles is inferred.
        "range_cm": float(motion.get("range_cm") or (1000.0 if orbit else 0.0)),
        "radius_cm": radius,
        "look": {
            "core_colour": core_colour,
            "core_cm": [max(core_size[0] * 100.0, 4.0), max(core_size[1] * 100.0, 4.0)],
            "glow_colour": glow_colour,
            "glow_cm": [min(glow_size[0] * 100.0, 200.0), min(glow_size[1] * 100.0, 200.0)] if glow_size else [0.0, 0.0],
            "pulse_s": pulse,
            "trail_cm": trail,
            "mesh_glb": mesh_glb,
            "mesh_cm": max(core_size[1] * 100.0, radius * 3.0, 20.0),
            "spin_deg": spin,
            "muzzle": muzzle,
            "orbit": {"count": orbit[0], "radius_cm": orbit[1], "deg_per_s": orbit[2]} if orbit else None,
        },
    }


def spawn_of(entry):
    """One bullet of a fire pattern. The original turns anticlockwise for a positive angle; this project
    measures to the right, hence the sign."""
    return {
        "delay_ms": float(entry.get("delay_ms") or 0.0),
        "angle": -float(entry.get("rotation_rad") or 0.0) * RAD_TO_DEG,
        "variance": float(entry.get("rotation_variance_rad") or 0.0) * RAD_TO_DEG,
    }


def sound_groups(entries, split_all=False):
    """The miner's sound entries as sounds: files that differ only by a trailing number are alternative
    recordings of one sound (justcrash_basic_01..03); anything else is a separate layer. split_all keeps
    every file a layer of its own, for sounds that play in sequence (a reload's two clicks)."""
    groups, index = [], {}
    for entry in entries or []:
        name = entry.get("file")
        if not name:
            continue
        stem = os.path.splitext(name)[0]
        key = stem if split_all else re.sub(r"[_-]?\d+[a-z]?$", "", stem)
        if key not in index:
            index[key] = len(groups)
            groups.append({"files": [], "volume": float(entry["gain"]) if entry.get("gain") else 1.0, "pitch": []})
        group = groups[index[key]]
        if name not in group["files"]:
            group["files"].append(name)
        pitch = entry.get("pitch")
        group["pitch"].extend(float(p) for p in ([pitch] if isinstance(pitch, (int, float)) else pitch or []))
    for group in groups:
        group["pitch"] = [min(group["pitch"]), max(group["pitch"])] if group["pitch"] else [1.0, 1.0]
    return groups


def nth(groups, n=0):
    return groups[n] if len(groups) > n else None


HIT_WORD = re.compile(r"(?<![a-z])hit")


def is_hit(group):
    return any(HIT_WORD.search(os.path.basename(f)) for f in group["files"])


def hit_group(groups):
    """Of a bullet's impact layers, the one that sounds like the hit itself ("proto_charge_hit", not "avenger_chit")."""
    return next((g for g in groups if is_hit(g)), nth(groups))


def section(record, key):
    return (record or {}).get(key) or {}


def sword_sounds(record):
    special = sound_groups(section(record, "charged_attack").get("special_effect_sounds"))
    return {
        "chain": [nth(sound_groups(step.get("swing"))) for step in record.get("combo_steps") or []],
        "chain_extra": [nth(sound_groups(step.get("swing")), 1) for step in record.get("combo_steps") or []],
        "impact": nth(sound_groups(record.get("hit_impact"))),
        "charged": nth(sound_groups(section(record, "charged_attack").get("swing"))),
        "charged_extra": next((g for g in special if not is_hit(g)), None),
        "charged_bullet_impact": next((g for g in special if is_hit(g)), None),
        "incomplete": nth(sound_groups(section(record, "incomplete_charge").get("swing"))),
    }


def handgun_sounds(record):
    shots = record.get("shots") or []
    charged = section(record, "charged_shot")
    reload_groups = sound_groups(section(record, "reload").get("sounds"), split_all=True)
    return {
        "chain": [nth(sound_groups(shot.get("fire"))) for shot in shots],
        "bullet_impact": hit_group(sound_groups(shots[0].get("projectile_impact"))) if shots else None,
        "charged": nth(sound_groups(charged.get("fire"))),
        "charged_extra": nth(sound_groups(charged.get("projectile_spawn"))),
        "charged_bullet_impact": hit_group(sound_groups(charged.get("projectile_impact")) or sound_groups(charged.get("projectile_handlers_ricochet_etc"))),
        "incomplete": nth(sound_groups(section(record, "incomplete_charge").get("fire"))),
        "reload": nth(reload_groups),
        "reload_extra": nth(reload_groups, 1),
    }


def bomb_sounds(record):
    release = section(record, "charged_release")
    dud = section(record, "dud_incomplete_charge")
    blast = sound_groups(release.get("explosion_destruction"))
    return {
        "drop": nth(sound_groups(release.get("bomb_model_sounds"))) or nth(sound_groups(release.get("bomb_creation_transient"))),
        "impact": nth(blast),
        "impact_extra": nth(blast, 1),
        "incomplete": nth(sound_groups(dud.get("throw_or_place_anim"))),
        "incomplete_extra": nth(sound_groups(dud.get("bomb_creation_transient"))),
    }


def sound_asset_name(path):
    """'effect/weapon/impacts/justcrash_basic_01.ogg' -> 'S_W_WeaponImpactsJustcrashBasic01'."""
    stem = os.path.splitext(path)[0]
    if stem.startswith("effect/"):
        stem = stem[len("effect/"):]
    return "S_W_" + "".join(part[:1].upper() + part[1:] for part in re.split(r"[^A-Za-z0-9]+", stem) if part)


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    with open(sys.argv[1], encoding="utf-8") as handle:
        visuals = json.load(handle)
    with open(sys.argv[2], encoding="utf-8") as handle:
        sounds = json.load(handle)

    projectiles = visuals.get("projectiles") or {}
    PROJECTILES.update(projectiles)
    weapons = {}

    for name, record in sounds.items():
        if name.startswith("_") or not isinstance(record, dict) or "weapon_class" not in record:
            continue
        cls = record["weapon_class"]
        maker = {"Sword": sword_sounds, "Handgun": handgun_sounds, "Bomb": bomb_sounds}.get(cls)
        weapons[name] = {"class": cls, "sounds": maker(record) if maker else {}}

    for name, gun in (visuals.get("weapons") or {}).items():
        entry = weapons.setdefault(name, {"class": "Handgun", "sounds": {}})
        colour = MUZZLE_COLOURS.get((gun.get("muzzle_flash") or {}).get("color"))
        muzzle = colour + [1.0] if colour else None
        steps = gun.get("normal_fire_pattern") or []
        if steps and isinstance(steps[0], dict):
            steps = [steps]
        entry["chain_spawns"] = [[spawn_of(s) for s in step] for step in steps]
        entry["chain_bullets"] = [bullet_spec(projectiles.get(step[0].get("actor")), muzzle) if step else None for step in steps]
        charged = gun.get("charged_fire_pattern") or []
        if charged and isinstance(charged[0], list):
            charged = [s for step in charged for s in step]
        entry["charged_spawns"] = [spawn_of(s) for s in charged]
        entry["charged_bullet"] = bullet_spec(projectiles.get(gun.get("charged")), muzzle)

    def sword_bullet(shot):
        args = shot.get("actor_args") or {}
        colour = rgba(nums(args["Color"])) if args.get("Color") else None
        scale = BURST_SCALE_TILES.get(args.get("Burst Scale"))
        return bullet_spec(projectiles.get(shot.get("actor")), None, colour, (scale * 0.8, scale) if scale else None)

    for name, sword in (visuals.get("sword_bullet_weapons") or {}).items():
        entry = weapons.setdefault(name, {"class": "Sword", "sounds": {}})
        normal = sword.get("normal_attack_bullets") or []
        # One entry per swing of the combo, in order.
        entry["chain_spawns"] = [[spawn_of(shot)] for shot in normal]
        entry["chain_bullets"] = [sword_bullet(shot) for shot in normal]
        charged = sword.get("charged_bullets") or []
        entry["charged_spawns"] = [spawn_of(shot) for shot in charged]
        entry["charged_bullet"] = sword_bullet(charged[0]) if charged else None

    # A charge that fires a marker (the Avenger and Faust lines) names no flight of its own, so the bolt the marker
    # releases stands in, resolved from the configs by the weapon gaps research (_research/weapon_gaps). Its hit
    # radius is INFERRED there from the bolt's rectangle.
    gaps_path = os.path.join(os.path.dirname(os.path.abspath(sys.argv[1])), "weapon_gaps", "weapon_gaps.json")
    if os.path.isfile(gaps_path):
        with open(gaps_path, encoding="utf-8") as handle:
            for name, spec in (json.load(handle).get("sword_bullets") or {}).items():
                entry = weapons.get(name)
                if entry is not None and not entry.get("charged_bullet"):
                    entry["charged_bullet"] = {key: value for key, value in spec.items() if not key.startswith("_")}

    # What to import, named once here so the import and the generator cannot disagree.
    sound_files, glbs = set(), set()
    for entry in weapons.values():
        for value in (entry.get("sounds") or {}).values():
            for group in (value if isinstance(value, list) else [value]):
                for path in (group or {}).get("files") or []:
                    sound_files.add(path)
        for spec in (entry.get("chain_bullets") or []) + [entry.get("charged_bullet")]:
            if spec and spec["look"].get("mesh_glb"):
                glbs.add(spec["look"]["mesh_glb"])

    missing = sorted(f for f in sound_files if not os.path.isfile(os.path.join(SK_RSRC, "sound", f.replace("/", os.sep))))
    sound_assets = {f: sound_asset_name(f) for f in sorted(sound_files) if f not in missing}
    projectile_assets = {g: _asset_name(g, "SM_") for g in sorted(glbs)}

    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump({
            "_about": "Written by distill_weapon_fx.py from the projectile and sound research. Sound paths are relative to rsrc/sound; glb paths to D:/Dev/SKAssets.",
            "sound_assets": sound_assets,
            "projectile_assets": projectile_assets,
            "missing_sound_files": missing,
            "weapons": weapons,
        }, handle, indent=1)

    with_bullets = sum(1 for e in weapons.values() if e.get("chain_bullets") or e.get("charged_bullet"))
    print(f"{len(weapons)} weapons, {with_bullets} with bullets, {len(sound_assets)} sound files, {len(projectile_assets)} bullet models -> {OUT}")
    if missing:
        print("missing sound files:", ", ".join(missing))


if __name__ == "__main__":
    main()
