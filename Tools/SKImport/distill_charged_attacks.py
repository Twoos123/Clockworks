"""Boil the charged attack research down to what generate_attack_profiles.py needs: weapon_charged_attacks.json.

Plain Python, no editor. The input is charged_attacks.json, resolved from the game's item.xml and attack
configs for every weapon (kept outside the repo, in D:/Dev/SKAssets/_research, with the script that makes it):

    python Tools/SKImport/distill_charged_attacks.py D:/Dev/SKAssets/_research/charged_attacks.json

Every weapon has exactly one charged move. What the first pass lost was the detail inside it, so per weapon
this keeps:
  - the start, fire and end clips at the play rate Unreal needs (the original's speed times the clip's own
    import speed: the heavy slam's fire clip is imported at 1.5), and the fire phase as a run of clips when
    the original plays several (a Sixshot's six hammer fans, a Flourish's thrusts);
  - land, rearm and clear;
  - every lunge, backsteps and sideways pushes included;
  - every hit: damage regions (circle or rectangle, reach, shove, damage multiplier), bullets (heading and
    delay; a marker bolt's fuse is added to its delay, since its bullet leaves when the marker goes off) and
    blasts (a slam's aftershock, a combo sword's ghost swings: fuse, radius, damage).
Status actions and sideways knockback are not carried; the project has no place to put them yet.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "weapon_charged_attacks.json")
TILE_CM = 100.0
# The shove the original calls 2.5 tiles is a knockback multiplier of 1 here.
KNOCKBACK_TILES_PER_UNIT = 2.5


def rate_of(entry, clips):
    """Unreal play rate for a clip entry: the config's speed times the clip file's own speed."""
    if not entry or not entry.get("clip"):
        return 1.0
    speed = float(entry.get("speed") or 1.0)
    clip_speed = float((clips.get(entry["clip"]) or {}).get("clip_speed") or 1.0)
    return speed * clip_speed


def phase_of(entry, clips):
    if not entry:
        return None
    out = {
        "clip": entry.get("clip") if (entry.get("clip") or "").startswith("character/pc/") else None,
        "rate": rate_of(entry, clips),
        "seconds": float(entry.get("seconds_game_inferred") or 0.0),
    }
    sequence = []
    for segment in entry.get("sequence") or []:
        if not (segment.get("clip") or "").startswith("character/pc/"):
            continue
        sequence.append({"clip": segment["clip"], "rate": rate_of(segment, clips), "start": float(segment.get("starts_at_s_inferred") or 0.0)})
    if sequence:
        out["sequence"] = sequence
        out["clip"] = out["clip"] or sequence[0]["clip"]
        out["rate"] = sequence[0]["rate"] if not entry.get("clip", "").startswith("character/pc/") else out["rate"]
    return out


def knockback_of(hit):
    knockback = hit.get("knockback")
    if not knockback or not knockback.get("translation_tiles"):
        return 0.0
    x, y = (list(knockback["translation_tiles"]) + [0.0, 0.0])[:2]
    return math.hypot(float(x), float(y)) / KNOCKBACK_TILES_PER_UNIT


def knockback_angle_of(hit):
    """The shove's heading off straight-away, in degrees, positive to the right (the original's Y is left)."""
    knockback = hit.get("knockback")
    if not knockback or not knockback.get("translation_tiles"):
        return 0.0
    x, y = (list(knockback["translation_tiles"]) + [0.0, 0.0])[:2]
    if abs(float(x)) < 1e-6 and abs(float(y)) < 1e-6:
        return 0.0
    return math.degrees(math.atan2(-float(y), float(x)))


# The game's status chance and power enums, as the weapon generator reads them.
CHANCE = {"LOW": 0.05, "MEDIUM": 0.10, "HIGH": 0.25, "VERY_HIGH": 0.50, "ULTRA": 0.65, "CUSTOM": 0.10}
POWER_SECONDS = {"MINOR": 3.0, "MODERATE": 5.0, "STRONG": 8.0, "CUSTOM": 5.0}
STATUS_TYPES = ("Fire", "Freeze", "Shock", "Poison", "Stun", "Curse", "Sleep")


def status_of(hit):
    """The first status a hit inflicts, as {type, chance, seconds, tick}, or None."""
    for status in hit.get("status") or []:
        name = str(status.get("name") or "")
        kind = next((t for t in STATUS_TYPES if name.startswith(t)), None)
        if not kind:
            continue
        chance = float(status.get("chance") or 0.0) or CHANCE.get(status.get("status_chance"), 0.3)
        seconds = POWER_SECONDS.get(status.get("status_power"), 5.0)
        return {"type": kind, "chance": chance, "seconds": seconds, "tick": seconds}
    return None


def hits_of(move):
    hits = []
    move_status = []
    last_offset = [100.0, 0.0]
    for hit in move.get("hits") or []:
        kind = hit.get("kind")
        delay = float(hit.get("delay_ms") or 0.0) / 1000.0
        multiplier = float(hit.get("damage_multiplier") or 0.0)
        if kind == "damage":
            shape = hit.get("shape") or {}
            translation = (list(shape.get("translation") or []) + [0.0, 0.0])[:2]
            # The original's Y is to the left; this project's offset is X forward, Y right.
            offset = [float(translation[0]) * TILE_CM, -float(translation[1]) * TILE_CM]
            last_offset = offset
            entry = {"kind": "damage", "delay_s": delay, "offset_cm": offset, "knockback": knockback_of(hit),
                     "knock_angle": knockback_angle_of(hit), "damage": multiplier, "status": status_of(hit)}
            if shape.get("type") == "Rectangle":
                size = [float(shape.get("width") or 1.0) * TILE_CM, float(shape.get("height") or 1.0) * TILE_CM]
                entry["box_cm"] = size
                entry["radius_cm"] = max(size) * 0.5
            else:
                entry["radius_cm"] = float(shape.get("radius") or 1.0) * TILE_CM
            hits.append(entry)
        elif kind == "spawn":
            spawn = hit.get("spawns") or {}
            actor_class = spawn.get("actor_class")
            fuse = float(spawn.get("fuse_ms") or 0.0) / 1000.0
            if actor_class == "Bomb" and spawn.get("detonation_spawns"):
                # A marker: its bullet leaves when it goes off.
                hits.append({"kind": "bullet", "delay_s": delay + fuse, "angle": -float(spawn.get("rotation_deg") or 0.0),
                             "variance": math.degrees(float(spawn.get("rotation_variance") or 0.0)), "damage": multiplier,
                             "status": status_of(hit)})
            elif actor_class == "Bomb":
                args = spawn.get("args") or {}
                radius_tiles = ((spawn.get("detonation_region") or {}).get("radius") or args.get("Scale") or args.get("Radius") or 1.0)
                # Where the blast lands is inferred: at the move's last damage region, which is where the
                # slam or the swing it echoes landed.
                hits.append({"kind": "blast", "delay_s": delay, "offset_cm": last_offset, "fuse_s": max(fuse, 0.001),
                             "blast_radius_cm": float(radius_tiles) * TILE_CM, "damage": multiplier, "knockback": 1.0,
                             "status": status_of(hit)})
            else:
                hits.append({"kind": "bullet", "delay_s": delay, "angle": -float(spawn.get("rotation_deg") or 0.0),
                             "variance": math.degrees(float(spawn.get("rotation_variance") or 0.0)), "damage": multiplier,
                             "status": status_of(hit)})
        elif kind == "status":
            # An ApplyStatus fire action beside the move's hits (a Faust's curse, a Fang of Vog's fire): the
            # status those hits inflict. A hit that names its own keeps it.
            pending = status_of(hit)
            if pending:
                move_status.append(pending)
    for entry in hits:
        if not entry.get("status") and move_status:
            entry["status"] = move_status[0]
    return hits


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    with open(sys.argv[1], encoding="utf-8") as handle:
        research = json.load(handle)
    clips = research.get("_clips") or {}

    weapons = {}
    for name, record in research.items():
        if name.startswith("_") or not isinstance(record, dict) or not record.get("moves"):
            continue
        move = record["moves"][0]
        lunges = []
        for lunge in move.get("lunges") or []:
            translation = (list(lunge.get("translation_tiles") or []) + [0.0, 0.0])[:2]
            lunges.append({"forward_cm": float(translation[0]) * TILE_CM, "right_cm": -float(translation[1]) * TILE_CM,
                           "seconds": max(float(lunge.get("duration_ms") or 0.0) / 1000.0, 0.01),
                           "delay_s": float(lunge.get("delay_ms") or 0.0) / 1000.0})
        weapons[name] = {
            "class": record.get("weapon_class"),
            "charge_s": float(record.get("charge_time_ms") or 0.0) / 1000.0,
            "start": phase_of(move.get("start"), clips),
            "fire": phase_of(move.get("fire"), clips),
            "end": phase_of(move.get("end"), clips),
            "land_s": float(move.get("land_ms") or 0.0) / 1000.0,
            "rearm_s": float(move.get("rearm_ms") or 0.0) / 1000.0,
            "clear_s": float(move.get("clear_ms") or 0.0) / 1000.0,
            "lunges": lunges,
            "hits": hits_of(move),
        }

    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump({"_about": "Written by distill_charged_attacks.py from charged_attacks.json. Clip paths are rsrc paths under character/pc; rates are Unreal play rates.",
                   "weapons": weapons}, handle, indent=1)
    kinds = {}
    for entry in weapons.values():
        for hit in entry["hits"]:
            kinds[hit["kind"]] = kinds.get(hit["kind"], 0) + 1
    sequences = sum(1 for e in weapons.values() if (e.get("fire") or {}).get("sequence"))
    print(f"{len(weapons)} charged moves, {sequences} with clip sequences, hits {kinds} -> {OUT}")


if __name__ == "__main__":
    main()
