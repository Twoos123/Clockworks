# Unreal Editor Python script. Run it headless after generate_weapon_assets.py:
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/generate_attack_profiles.py"
#
# Gives every catalogue weapon its own way of attacking: the FClockworksAttackProfile on its weapon
# definition. The numbers and clip names come from weapon_base_attacks.json, which was mined from the
# game's attack configs (37 attack bases, with the fields each weapon overrides). The clips are the
# knight's own, re-exported with every line's animations as PlayerKnightsk_* sequences.
#
# Per move: the start, fire and end clips at the original's speeds; the start time (the config's
# "land", or the start clip's length at its speed); the rearm and clear; the lunge or recoil; and the
# moments that do something (a damage region with its size, reach and shove, or a bullet or bomb
# leaving, with a bomb's fuse and radius).
#
# Also points BP_GA_BombAttack's own clips at the real bomb clips, so the hand-tuned Proto Bomb moves
# like every other bomb.
#
# Re-runnable. Writes only the catalogue's data assets and that one Blueprint's defaults.

import json
import math
import os
import re
import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
WEAPONS_JSON = os.path.join(HERE, "weapons.json")
ATTACKS_JSON = os.path.join(HERE, "weapon_base_attacks.json")
# Per weapon sounds, bullets and fire patterns, from distill_weapon_fx.py. Optional.
FX_JSON = os.path.join(HERE, "weapon_fx.json")
SOUND_PATH = "/Game/SK/Audio/Weapons"
PROJECTILE_PATH = "/Game/SK/Projectiles"

GEAR_PATH = "/Game/TopDown/Gear/Catalogue"
KNIGHT_ANIMS = "/Game/SK/Knights/PlayerKnight/SkeletalMeshes"
BLUEPRINTS = "/Game/TopDown/Blueprints"

TILE_CM = 100.0
# The shove the original calls 2.5 tiles is a knockback multiplier of 1 in this project.
KNOCKBACK_TILES_PER_UNIT = 2.5

STAR_SUFFIX = re.compile(r"\s*\(\d\*\)$")

_CLIPS = {}
missing_clips = set()


def safe_asset_name(display_name):
    cleaned = "".join(ch if ch.isalnum() else " " for ch in display_name)
    return "DA_Weapon_" + "".join(part.capitalize() for part in cleaned.split())


def clip_asset(dat_path):
    """The imported knight sequence for a clip path like character/pc/attack_sword_2_start.dat."""
    if not dat_path or not dat_path.startswith("character/pc/"):
        return None
    if dat_path in _CLIPS:
        return _CLIPS[dat_path]
    rel = dat_path[len("character/pc/"):-len(".dat")]
    name = "PlayerKnightsk_" + re.sub(r"[^a-z0-9]+", "_", rel.lower()).strip("_")
    path = "{0}/{1}.{1}".format(KNIGHT_ANIMS, name)
    asset = unreal.EditorAssetLibrary.load_asset(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else None
    if not asset:
        missing_clips.add(name)
    _CLIPS[dat_path] = asset
    return asset


def phase(entry):
    """(first clip, speed, seconds at that speed) for a start, fire or end entry.

    A sequential entry (an Autogun's six fire clips) plays its first clip; its seconds cover the
    whole sequence, since that is how long the phase lasts in the original.
    """
    if not entry:
        return None, 1.0, 0.0
    clips = [s.get("clip") for s in entry.get("sequence") or [] if s.get("clip")] or [entry.get("clip")]
    speed = entry.get("speed") or 1.0
    first, length = None, 0.0
    for clip in clips:
        asset = clip_asset(clip)
        if asset:
            first = first or asset
            length += asset.get_play_length()
    return first, speed, (length / speed if speed > 0 else length)


def make_move(step):
    move = unreal.ClockworksAttackMove()
    if not step:
        return move

    start_anim, start_rate, start_seconds = phase(step.get("start"))
    fire_anim, fire_rate, fire_seconds = phase(step.get("fire"))
    end_anim, end_rate, _ = phase(step.get("end"))

    land = step.get("land_ms")
    move.set_editor_property("start_anim", start_anim)
    move.set_editor_property("start_rate", float(start_rate))
    move.set_editor_property("start_seconds", float(land) / 1000.0 if land else float(start_seconds))
    move.set_editor_property("fire_anim", fire_anim)
    move.set_editor_property("fire_rate", float(fire_rate))
    move.set_editor_property("fire_seconds", float(fire_seconds))
    move.set_editor_property("end_anim", end_anim)
    move.set_editor_property("end_rate", float(end_rate))
    move.set_editor_property("recovery_seconds", float(step.get("rearm_ms") or 0) / 1000.0)
    move.set_editor_property("clear_seconds", float(step.get("clear_ms") or 0) / 1000.0)

    lunge = step.get("lunge")
    if lunge and lunge.get("translation_tiles"):
        move.set_editor_property("lunge_distance_cm", float(lunge["translation_tiles"][0]) * TILE_CM)
        move.set_editor_property("lunge_seconds", float(lunge.get("duration_ms") or 0) / 1000.0)
        move.set_editor_property("lunge_delay_seconds", float(lunge.get("delay_ms") or 0) / 1000.0)

    hits = []
    for source in step.get("hits") or []:
        shape = source.get("shape")
        spawns = source.get("spawns")
        if not shape and not spawns:
            continue
        hit = unreal.ClockworksAttackHit()
        hit.set_editor_property("delay_seconds", float(source.get("delay_ms") or 0) / 1000.0)
        if shape:
            if shape.get("type") == "Circle":
                radius = float(shape.get("radius") or 0) * TILE_CM
            else:
                radius = max(float(shape.get("width") or 0), float(shape.get("height") or 0)) * TILE_CM * 0.5
            translation = shape.get("translation") or [0.0, 0.0]
            hit.set_editor_property("radius_cm", radius)
            # The original's Y is to the left; this project's offset is X forward, Y right.
            hit.set_editor_property("offset_cm", unreal.Vector2D(float(translation[0]) * TILE_CM, -float(translation[1]) * TILE_CM))
        knockback = source.get("knockback")
        if knockback and knockback.get("translation_tiles"):
            kx, ky = (list(knockback["translation_tiles"]) + [0.0, 0.0])[:2]
            hit.set_editor_property("knockback_multiplier", math.hypot(float(kx), float(ky)) / KNOCKBACK_TILES_PER_UNIT)
            if abs(float(ky)) > 1e-6:
                # Sideways as well as away; the original's Y is to the left.
                hit.set_editor_property("knockback_angle_degrees", math.degrees(math.atan2(-float(ky), float(kx))))
        if spawns:
            hit.set_editor_property("spawns", True)
            if spawns.get("fuse_ms"):
                hit.set_editor_property("fuse_seconds", float(spawns["fuse_ms"]) / 1000.0)
            radius_tiles = (spawns.get("args") or {}).get("Radius")
            if radius_tiles:
                hit.set_editor_property("blast_radius_cm", float(radius_tiles) * TILE_CM)
        hits.append(hit)
    move.set_editor_property("hits", hits)
    return move


FX = {}
missing_sounds = set()
_SOUNDS = {}
_BULLET_MESHES = {}


def sound_asset(rel_path):
    """The imported sound for a path under rsrc/sound, by the name distill_weapon_fx.py gave it."""
    name = (FX.get("sound_assets") or {}).get(rel_path)
    if not name:
        return None
    if name not in _SOUNDS:
        path = "{0}/{1}.{1}".format(SOUND_PATH, name)
        _SOUNDS[name] = unreal.EditorAssetLibrary.load_asset(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else None
        if not _SOUNDS[name]:
            missing_sounds.add(name)
    return _SOUNDS[name]


def make_sound(spec):
    sound = unreal.ClockworksWeaponSound()
    if not spec:
        return sound
    variants = [a for a in (sound_asset(f) for f in spec.get("files") or []) if a]
    sound.set_editor_property("variants", variants)
    sound.set_editor_property("volume", float(spec.get("volume") or 1.0))
    pitch = spec.get("pitch") or [1.0, 1.0]
    sound.set_editor_property("pitch_min", float(pitch[0]))
    sound.set_editor_property("pitch_max", float(pitch[-1]))
    return sound


BULLET_CARD = re.compile(r"flare|glow|trail|fx|plane", re.IGNORECASE)


def bullet_mesh(rel_glb):
    """The bullet body imported from a bullet model's glb: the largest piece that is not a flare, glow
    or trail card (the Magnus model's flare is bigger than its shell, and is drawn additively)."""
    name = (FX.get("projectile_assets") or {}).get(rel_glb)
    if not name:
        return None
    if name not in _BULLET_MESHES:
        folder = PROJECTILE_PATH + "/" + name
        meshes = []
        if unreal.EditorAssetLibrary.does_directory_exist(folder):
            for path in unreal.EditorAssetLibrary.list_assets(folder, recursive=True, include_folder=False):
                asset = unreal.EditorAssetLibrary.load_asset(path)
                if isinstance(asset, unreal.StaticMesh):
                    meshes.append(asset)
        bodies = [m for m in meshes if not BULLET_CARD.search(m.get_name().split("-", 1)[-1])] or meshes
        _BULLET_MESHES[name] = max(bodies, key=lambda m: m.get_bounds().box_extent.length()) if bodies else None
    return _BULLET_MESHES[name]


def colour(values, alpha=None):
    values = list(values or [1.0, 1.0, 1.0, 1.0]) + [1.0] * 4
    return unreal.LinearColor(values[0], values[1], values[2], values[3] if alpha is None else alpha)


def make_bullet(spec, impact):
    bullet = unreal.ClockworksBulletSpec()
    if not spec:
        return bullet
    bullet.set_editor_property("speed_cm_per_second", float(spec["speed_cm"]))
    bullet.set_editor_property("range_cm", float(spec["range_cm"]))
    bullet.set_editor_property("collision_radius_cm", float(spec["radius_cm"]))
    source = spec["look"]
    look = unreal.ClockworksBulletLook()
    look.set_editor_property("enabled", True)
    look.set_editor_property("core_color", colour(source["core_colour"]))
    look.set_editor_property("core_size_min_cm", float(source["core_cm"][0]))
    look.set_editor_property("core_size_max_cm", float(source["core_cm"][1]))
    look.set_editor_property("glow_color", colour(source["glow_colour"]))
    look.set_editor_property("glow_size_min_cm", float(source["glow_cm"][0]))
    look.set_editor_property("glow_size_max_cm", float(source["glow_cm"][1]))
    look.set_editor_property("pulse_seconds", float(source["pulse_s"]))
    look.set_editor_property("trail_length_cm", float(source["trail_cm"]))
    if source.get("mesh_glb"):
        look.set_editor_property("mesh", bullet_mesh(source["mesh_glb"]))
        look.set_editor_property("mesh_size_cm", float(source["mesh_cm"]))
        look.set_editor_property("spin_degrees_per_second", float(source["spin_deg"]))
    if source.get("muzzle"):
        look.set_editor_property("muzzle_color", colour(source["muzzle"]))
    orbit = source.get("orbit")
    if orbit:
        look.set_editor_property("orbit_count", int(orbit["count"]))
        look.set_editor_property("orbit_radius_cm", float(orbit["radius_cm"]))
        look.set_editor_property("orbit_degrees_per_second", float(orbit["deg_per_s"]))
    look.set_editor_property("impact_sound", make_sound(impact))
    bullet.set_editor_property("look", look)
    return bullet


def nth(items, index):
    """Item index of a per-step list, the last one for a longer chain, None for an empty list."""
    items = items or []
    if not items:
        return None
    return items[index] if index < len(items) else items[-1]


def apply_fx(move, sound, extra, bullet=None, spawns=None, impact=None):
    """A move's own sounds, and the bullets it fires with their timing and headings.

    The fire pattern replaces the attack config's bullet moments: it is the same data resolved through
    the fire actions, so it also knows each bullet's heading (a charged Autogun's fan, the Proto Gun's
    six degree wobble). Damage regions and a bomb's spawn stay as they were."""
    move.set_editor_property("sound", make_sound(sound))
    move.set_editor_property("extra_sound", make_sound(extra))
    if not bullet:
        return
    move.set_editor_property("bullet", make_bullet(bullet, impact))
    if spawns:
        # Blasts stay; only the bullet moments are replaced by the fire pattern.
        hits = [h for h in move.get_editor_property("hits") if not h.get_editor_property("spawns") or h.get_editor_property("blast")]
        for entry in spawns:
            hit = unreal.ClockworksAttackHit()
            hit.set_editor_property("spawns", True)
            hit.set_editor_property("delay_seconds", float(entry["delay_ms"]) / 1000.0)
            hit.set_editor_property("angle_degrees", float(entry["angle"]))
            hit.set_editor_property("angle_variance_degrees", float(entry["variance"]))
            hits.append(hit)
        move.set_editor_property("hits", hits)


def apply_weapon_fx(name, profile, chain, charged, incomplete, reload, charged_from_research=False):
    fx = (FX.get("weapons") or {}).get(name)
    if not fx:
        return False
    sounds = fx.get("sounds") or {}
    for index, move in enumerate(chain):
        apply_fx(move, nth(sounds.get("chain"), index), nth(sounds.get("chain_extra"), index),
                 nth(fx.get("chain_bullets"), index), nth(fx.get("chain_spawns"), index), sounds.get("bullet_impact"))
    # A charged move built from the charged attack research already has its bullets' timing, headings and
    # damage; the fx only lends the bullet's flight and look.
    apply_fx(charged, sounds.get("charged"), sounds.get("charged_extra"),
             fx.get("charged_bullet"), None if charged_from_research else fx.get("charged_spawns"),
             sounds.get("charged_bullet_impact") or sounds.get("bullet_impact"))
    apply_fx(incomplete, sounds.get("incomplete"), sounds.get("incomplete_extra"))
    apply_fx(reload, sounds.get("reload"), sounds.get("reload_extra"))
    profile.set_editor_property("impact_sound", make_sound(sounds.get("impact")))
    profile.set_editor_property("impact_extra_sound", make_sound(sounds.get("impact_extra")))
    profile.set_editor_property("drop_sound", make_sound(sounds.get("drop")))
    return True


CHARGED_JSON = os.path.join(HERE, "weapon_charged_attacks.json")
CHARGED = {}

# Special bullets (splits, bursts, pulses, clouds, shards, vortexes, sticking, piercing), from
# distill_bullet_behaviours.py. Optional.
BEHAVIOURS_JSON = os.path.join(HERE, "weapon_bullet_behaviours.json")
BEHAVIOURS = {}


def make_child(source):
    child = unreal.ClockworksBulletChild()
    child.set_editor_property("sub_bullet", int(source["sub"]))
    child.set_editor_property("count", int(source.get("count") or 1))
    child.set_editor_property("spread_degrees", float(source.get("spread_deg") or 0.0))
    child.set_editor_property("ricochet", bool(source.get("ricochet")))
    child.set_editor_property("scatter_radius_cm", float(source.get("scatter_cm") or 0.0))
    child.set_editor_property("damage_multiplier", float(source.get("damage", 1.0)))
    return child


def make_burst(source):
    burst = unreal.ClockworksBulletBurst()
    burst.set_editor_property("radius_cm", float(source.get("radius_cm") or 0.0))
    burst.set_editor_property("damage_multiplier", float(source.get("damage", 1.0)))
    burst.set_editor_property("knockback", float(source.get("knockback", 1.0)))
    burst.set_editor_property("shove_along_flight", bool(source.get("along_flight")))
    burst.set_editor_property("status_chance", float(source.get("status_chance", -1.0)))
    burst.set_editor_property("children", [make_child(c) for c in source.get("children") or [] if c.get("sub") is not None])
    return burst


def apply_behaviour(bullet, behaviour):
    """The bullet with a behaviour from weapon_bullet_behaviours.json applied. Structs are copies in Python,
    so the caller sets the result back."""
    if not behaviour:
        return bullet
    if "contact_damage" in behaviour:
        bullet.set_editor_property("contact_damage_multiplier", float(behaviour["contact_damage"]))
    for key, prop in (("passes_through", "passes_through"), ("attach", "attach_on_hit"),
                      ("detonate_attached", "detonate_attached_on_hit"), ("ends_after_pulses", "ends_after_pulses"),
                      ("orbit_hits_once", "orbit_pellet_hits_once")):
        if key in behaviour:
            bullet.set_editor_property(prop, bool(behaviour[key]))
    if behaviour.get("life_s"):
        bullet.set_editor_property("life_seconds", float(behaviour["life_s"]))
    if behaviour.get("detonation"):
        bullet.set_editor_property("detonation", make_burst(behaviour["detonation"]))
    if behaviour.get("pulse"):
        bullet.set_editor_property("pulse_seconds", float(behaviour.get("pulse_s") or 1.0))
        bullet.set_editor_property("pulse_limit", int(behaviour.get("pulse_limit") or 0))
        bullet.set_editor_property("pulse", make_burst(behaviour["pulse"]))
    burst = behaviour.get("burst_look")
    if behaviour.get("hidden") or burst:
        look = bullet.get_editor_property("look")
        look.set_editor_property("enabled", True)
        if behaviour.get("hidden"):
            look.set_editor_property("hide_body", True)
        if burst:
            look.set_editor_property("burst_color", colour(burst["colour"]))
            look.set_editor_property("burst_width_cm", float(burst.get("width_cm") or 0.0))
            look.set_editor_property("burst_height_cm", float(burst.get("height_cm") or 0.0))
            look.set_editor_property("burst_seconds", float(burst.get("seconds") or 0.3))
            look.set_editor_property("burst_sound", make_sound(burst.get("sound")))
        bullet.set_editor_property("look", look)
    return bullet


def apply_weapon_behaviours(name, profile, chain, charged):
    """A weapon's special bullets: its ordinary shots', its charged shot's (a bomb's blast), and the bullets
    those break into or leave behind."""
    record = BEHAVIOURS.get(name)
    if not record:
        return False
    if record.get("normal"):
        for move in chain:
            bullet = move.get_editor_property("bullet")
            if bullet.get_editor_property("speed_cm_per_second") > 0.0:
                move.set_editor_property("bullet", apply_behaviour(bullet, record["normal"]))
    if record.get("charged"):
        charged.set_editor_property("bullet", apply_behaviour(charged.get_editor_property("bullet"), record["charged"]))
        # A Brandish's charge sound of an explosion now plays with each explosion instead.
        if record["charged"].get("clear_extra_sound"):
            charged.set_editor_property("extra_sound", unreal.ClockworksWeaponSound())
    subs = []
    for spec in record.get("subs") or []:
        subs.append(apply_behaviour(make_bullet(spec, None), spec))
    profile.set_editor_property("sub_bullets", subs)
    return True


STATUS_CLASS = {
    "Fire": "/Script/Clockworks.ClockworksFireEffect",
    "Freeze": "/Script/Clockworks.ClockworksFreezeEffect",
    "Shock": "/Script/Clockworks.ClockworksShockEffect",
    "Poison": "/Script/Clockworks.ClockworksPoisonEffect",
    "Stun": "/Script/Clockworks.ClockworksStatusStunEffect",
    "Curse": "/Script/Clockworks.ClockworksCurseEffect",
    "Sleep": "/Script/Clockworks.ClockworksSleepEffect",
}


def set_hit_status(hit, status):
    """A hit's own status, when the charged attack research names one."""
    if not status or status.get("type") not in STATUS_CLASS:
        return
    status_class = unreal.load_class(None, STATUS_CLASS[status["type"]])
    if not status_class:
        return
    hit.set_editor_property("status_effect", status_class)
    hit.set_editor_property("status_chance", float(status.get("chance") or 0.1))
    hit.set_editor_property("status_seconds", float(status.get("seconds") or 5.0))
    hit.set_editor_property("status_tick_damage", float(status.get("tick") or 5.0))


def make_clip_segment(entry):
    segment = unreal.ClockworksClipSegment()
    segment.set_editor_property("anim", clip_asset(entry.get("clip")))
    segment.set_editor_property("rate", float(entry.get("rate") or 1.0))
    segment.set_editor_property("start_seconds", float(entry.get("start") or 0.0))
    return segment


def make_charged_move(entry):
    """A charged move from weapon_charged_attacks.json (distill_charged_attacks.py): every clip of its fire
    phase at its own rate, every lunge, and every hit with its own shape, damage and shove, including the
    blasts (aftershocks, ghost swings) the first pass dropped."""
    move = unreal.ClockworksAttackMove()
    start = entry.get("start") or {}
    fire = entry.get("fire") or {}
    end = entry.get("end") or {}

    move.set_editor_property("start_anim", clip_asset(start.get("clip")))
    move.set_editor_property("start_rate", float(start.get("rate") or 1.0))
    land = entry.get("land_s")
    move.set_editor_property("start_seconds", float(land if land else (start.get("seconds") or 0.0)))

    sequence = [make_clip_segment(s) for s in fire.get("sequence") or []]
    sequence = [s for s in sequence if s.get_editor_property("anim")]
    move.set_editor_property("fire_sequence", sequence)
    move.set_editor_property("fire_anim", clip_asset(fire.get("clip")))
    move.set_editor_property("fire_rate", float(fire.get("rate") or 1.0))
    move.set_editor_property("fire_seconds", float(fire.get("seconds") or 0.0))

    move.set_editor_property("end_anim", clip_asset(end.get("clip")))
    move.set_editor_property("end_rate", float(end.get("rate") or 1.0))
    move.set_editor_property("recovery_seconds", float(entry.get("rearm_s") or 0.0))
    move.set_editor_property("clear_seconds", float(entry.get("clear_s") or 0.0))

    lunges = []
    for source in entry.get("lunges") or []:
        lunge = unreal.ClockworksLunge()
        lunge.set_editor_property("distance_cm", unreal.Vector2D(float(source["forward_cm"]), float(source["right_cm"])))
        lunge.set_editor_property("seconds", float(source["seconds"]))
        lunge.set_editor_property("delay_seconds", float(source["delay_s"]))
        lunges.append(lunge)
    move.set_editor_property("lunges", lunges)
    if entry.get("lunges"):
        first = entry["lunges"][0]
        move.set_editor_property("lunge_distance_cm", float(first["forward_cm"]))
        move.set_editor_property("lunge_seconds", float(first["seconds"]))
        move.set_editor_property("lunge_delay_seconds", float(first["delay_s"]))

    hits = []
    for source in entry.get("hits") or []:
        hit = unreal.ClockworksAttackHit()
        hit.set_editor_property("delay_seconds", float(source.get("delay_s") or 0.0))
        hit.set_editor_property("damage_multiplier", float(source.get("damage") or 0.0))
        set_hit_status(hit, source.get("status"))
        if source.get("knock_angle"):
            hit.set_editor_property("knockback_angle_degrees", float(source["knock_angle"]))
        kind = source.get("kind")
        if kind == "damage":
            offset = source.get("offset_cm") or [0.0, 0.0]
            hit.set_editor_property("offset_cm", unreal.Vector2D(float(offset[0]), float(offset[1])))
            hit.set_editor_property("radius_cm", float(source.get("radius_cm") or 100.0))
            hit.set_editor_property("knockback_multiplier", float(source.get("knockback") or 0.0))
            if source.get("box_cm"):
                hit.set_editor_property("rectangle", True)
                hit.set_editor_property("box_size_cm", unreal.Vector2D(float(source["box_cm"][0]), float(source["box_cm"][1])))
        elif kind == "blast":
            offset = source.get("offset_cm") or [0.0, 0.0]
            # Still a spawn: a bomb's own charged move is this blast, and the bomb ability reads spawns.
            hit.set_editor_property("spawns", True)
            hit.set_editor_property("blast", True)
            hit.set_editor_property("offset_cm", unreal.Vector2D(float(offset[0]), float(offset[1])))
            hit.set_editor_property("fuse_seconds", float(source.get("fuse_s") or 0.001))
            hit.set_editor_property("blast_radius_cm", float(source.get("blast_radius_cm") or 100.0))
            hit.set_editor_property("knockback_multiplier", float(source.get("knockback") or 1.0))
        else:
            hit.set_editor_property("spawns", True)
            hit.set_editor_property("angle_degrees", float(source.get("angle") or 0.0))
            hit.set_editor_property("angle_variance_degrees", float(source.get("variance") or 0.0))
        hits.append(hit)
    move.set_editor_property("hits", hits)
    return move


def resolve_for_weapon(base, weapon_name):
    """The base's attack data with this weapon's own overrides applied."""
    data = {key: base.get(key) for key in ("normal_chain", "charged_attack", "incomplete_charge", "reload", "charge", "charge_time_ms")}
    chain = list(base.get("normal_chain") or [])
    for variant in base.get("weapon_variants") or []:
        names = {STAR_SUFFIX.sub("", name) for name in variant.get("weapons") or []}
        if weapon_name not in names:
            continue
        for key, value in (variant.get("differs_from_base") or {}).items():
            if key == "normal_chain" and isinstance(value, dict):
                for index, step in value.items():
                    index = int(index)
                    while len(chain) <= index:
                        chain.append(None)
                    chain[index] = step
            elif key == "normal_chain":
                chain = list(value or [])
            else:
                data[key] = value
    data["normal_chain"] = [step for step in chain if step]
    return data


def main():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous([GEAR_PATH, KNIGHT_ANIMS, BLUEPRINTS, SOUND_PATH, PROJECTILE_PATH], True)

    with open(WEAPONS_JSON, encoding="utf-8") as handle:
        weapons = json.load(handle)
    with open(ATTACKS_JSON, encoding="utf-8") as handle:
        bases = json.load(handle)["bases"]
    if os.path.isfile(FX_JSON):
        with open(FX_JSON, encoding="utf-8") as handle:
            FX.update(json.load(handle))
    if os.path.isfile(CHARGED_JSON):
        with open(CHARGED_JSON, encoding="utf-8") as handle:
            CHARGED.update(json.load(handle).get("weapons") or {})
    if os.path.isfile(BEHAVIOURS_JSON):
        with open(BEHAVIOURS_JSON, encoding="utf-8") as handle:
            BEHAVIOURS.update(json.load(handle).get("weapons") or {})
    with_behaviours = 0
    with_fx = 0
    with_charged = 0

    # Which base each weapon sits on, by the base's own weapon list first.
    base_of = {}
    for key, base in bases.items():
        for name in base.get("weapons") or []:
            base_of.setdefault(STAR_SUFFIX.sub("", name), key)

    made, no_base, no_asset = 0, [], []
    for weapon in weapons:
        name = weapon.get("display_name") or ""
        asset_path = GEAR_PATH + "/" + safe_asset_name(name)
        if not unreal.EditorAssetLibrary.does_asset_exist(asset_path):
            no_asset.append(name)
            continue
        base_key = base_of.get(name) or weapon.get("base_item")
        base = bases.get(base_key)
        if not base:
            no_base.append(name)
            continue

        data = resolve_for_weapon(base, name)
        profile = unreal.ClockworksAttackProfile()
        chain = [make_move(step) for step in data["normal_chain"]]
        charged_entry = CHARGED.get(name)
        charged = make_charged_move(charged_entry) if charged_entry else make_move(data.get("charged_attack"))
        with_charged += 1 if charged_entry else 0
        incomplete = make_move(data.get("incomplete_charge"))
        reload = make_move(data.get("reload"))
        with_fx += 1 if apply_weapon_fx(name, profile, chain, charged, incomplete, reload, charged_from_research=bool(charged_entry)) else 0
        with_behaviours += 1 if apply_weapon_behaviours(name, profile, chain, charged) else 0
        profile.set_editor_property("chain", chain)
        profile.set_editor_property("charged_attack", charged)
        profile.set_editor_property("incomplete_charge", incomplete)
        profile.set_editor_property("reload", reload)

        charge = data.get("charge") or {}
        profile.set_editor_property("charge_hold_anim", clip_asset(charge.get("hold_clip")))
        charge_ms = weapon.get("charge_time_ms") or charge.get("charge_time_ms") or data.get("charge_time_ms") or 0
        profile.set_editor_property("charge_seconds", float(charge_ms) / 1000.0)

        definition = unreal.EditorAssetLibrary.load_asset(asset_path)
        definition.set_editor_property("attack", profile)
        unreal.EditorAssetLibrary.save_loaded_asset(definition, False)
        made += 1

    # The Proto Bomb's own ability: the real bomb clips instead of the generic lift, hold and throw.
    bomb = unreal.EditorAssetLibrary.load_asset(BLUEPRINTS + "/BP_GA_BombAttack")
    if bomb:
        cdo = unreal.get_default_object(bomb.generated_class())
        hold = clip_asset("character/pc/charge_bomb_hold.dat")
        place = clip_asset("character/pc/attack_bomb_blend.dat")
        dud = clip_asset("character/pc/throw.dat")
        if hold and place:
            cdo.set_editor_property("arm_anim", None)
            cdo.set_editor_property("hold_anim", hold)
            cdo.set_editor_property("place_anim", place)
            cdo.set_editor_property("place_anim_rate", 1.0)
        if dud:
            cdo.set_editor_property("dud_anim", dud)
            cdo.set_editor_property("dud_anim_rate", 2.0)
        unreal.EditorAssetLibrary.save_loaded_asset(bomb, False)

    unreal.log_warning("Clockworks: attack profiles written for {0} weapons, {1} with their own sounds and bullets, {2} with researched charged attacks, {3} with special bullets".format(made, with_fx, with_charged, with_behaviours))
    if missing_sounds:
        unreal.log_warning("Clockworks: weapon sounds not imported ({0}): {1}".format(len(missing_sounds), ", ".join(sorted(missing_sounds)[:40])))
    if no_base:
        unreal.log_warning("Clockworks: no attack base for {0}: {1}".format(len(no_base), ", ".join(sorted(no_base)[:30])))
    if no_asset:
        unreal.log_warning("Clockworks: no weapon asset for {0}: {1}".format(len(no_asset), ", ".join(sorted(no_asset)[:30])))
    if missing_clips:
        unreal.log_warning("Clockworks: knight clips not imported ({0}): {1}".format(len(missing_clips), ", ".join(sorted(missing_clips))))


main()
