# Unreal Editor Python script. Run it headless AFTER generate_attack_profiles.py (which rebuilds every attack profile
# and so clears what this writes), with the game module that carries the damage tables built:
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/apply_weapon_damage.py"
#
# Writes the original's knight weapon damage (user's decisions 2026-09-15) onto the weapon catalogue, from
# D:/Dev/SKAssets/_research/weapon_damage/weapon_damage.json: gross damage per hit at the weapon's own star, medium
# difficulty, at original depths 1 4 7 11 15 18 22 25 29, which are the demo's depths 0 to 8.
#
#   DamageByDepth            every mapped hit (swing, region, blast, spawned bullet), bullet, burst and sub-bullet
#   Detonation               added to piercing charged shots: the original deals their damage again where the shot
#                            ends. Its radius is the bullet's hit radius, at least half a tile (INFERRED)
#   OrbitDamageByDepth       the Mixer line's bullets (Celestial Orbitgun, Diskguns, Mixmaster): the pellets' damage
#   StatusChance             the game's enum per hit and per weapon: LOW 5%, MEDIUM 10%, HIGH 25%, VERY_HIGH 50%, ULTRA 65%
#   StatusTickDamageByDepth  Fire (its tick at the status power, a lerp the research marks INFERRED) and Shock (its arc
#                            damage), both per 0.5 s signal
#
# A bullet whose contact damage now comes from a table has its ContactDamageMultiplier set back to 1: the table already
# is that contact hit's damage. Re-runnable. Logs at warning level (commandlet output filters Display).

import json
import os
import re
import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
RESEARCH = r"D:\Dev\SKAssets\_research\weapon_damage\weapon_damage.json"
WEAPONS_JSON = os.path.join(HERE, "weapons.json")
# Every problem of the last run, next to the research it came from.
REPORT = r"D:\Dev\SKAssets\_research\weapon_damage\apply_report.json"
# Dual-type splits, the Warmaster orbitals and the four swords' bolts; the status damage rules and the Catalyzer orbs.
GAPS_JSON = r"D:\Dev\SKAssets\_research\weapon_gaps\weapon_gaps.json"
STATUS_JSON = r"D:\Dev\SKAssets\_research\status_damage\status_damage.json"
GAPS = {}
STATUS_RESEARCH = {}
GEAR_PATH = "/Game/TopDown/Gear/Catalogue"
# The hand-made starter weapons, written too when their profile has the catalogue's shape.
EXTRA_ASSETS = {"Calibur": "/Game/TopDown/Gear/DA_Weapon_Calibur", "Proto Gun": "/Game/TopDown/Gear/DA_Weapon_ProtoGun"}
DEPTHS = ["1", "4", "7", "11", "15", "18", "22", "25", "29"]
CHANCE = {"LOW": 0.05, "MEDIUM": 0.10, "HIGH": 0.25, "VERY_HIGH": 0.50, "ULTRA": 0.65}
STATUS_KINDS = ("Fire", "Freeze", "Shock", "Poison", "Stun", "Curse", "Sleep")
KIND_OF_CLASS = {
    "ClockworksFireEffect": "Fire", "ClockworksFreezeEffect": "Freeze", "ClockworksShockEffect": "Shock",
    "ClockworksPoisonEffect": "Poison", "ClockworksStatusStunEffect": "Stun", "ClockworksCurseEffect": "Curse",
    "ClockworksSleepEffect": "Sleep",
}
TOKEN = re.compile(r"([A-Za-z]+)(?:\[(\d+)\])?")


class Missing(Exception):
    pass


def safe_asset_name(display_name):
    """The weapon generator's asset name (generate_attack_profiles.py)."""
    cleaned = "".join(ch if ch.isalnum() else " " for ch in display_name)
    return "DA_Weapon_" + "".join(part.capitalize() for part in cleaned.split())


def table(by_depth):
    return [round(float((by_depth or {}).get(depth) or 0.0), 2) for depth in DEPTHS]


def parse(path):
    """'Attack.Chain[1].Bullet.Detonation' -> [('chain', 1), ('bullet', None), ('detonation', None)]."""
    tokens = []
    for part in path.split(".")[1:]:
        match = TOKEN.fullmatch(part)
        name = re.sub(r"(?<!^)(?=[A-Z])", "_", match.group(1)).lower()
        tokens.append((name, int(match.group(2)) if match.group(2) is not None else None))
    return tokens


def get(obj, tokens):
    for name, index in tokens:
        obj = obj.get_editor_property(name)
        if index is not None:
            items = list(obj)
            if index >= len(items):
                raise Missing("%s[%d]" % (name, index))
            obj = items[index]
    return obj


def edit(obj, tokens, change):
    """Structs are copies in Python: change the leaf, then set every level back on its parent."""
    if not tokens:
        change(obj)
        return obj
    name, index = tokens[0]
    child = obj.get_editor_property(name)
    if index is None:
        obj.set_editor_property(name, edit(child, tokens[1:], change))
    else:
        items = list(child)
        if index >= len(items):
            raise Missing("%s[%d]" % (name, index))
        items[index] = edit(items[index], tokens[1:], change)
        obj.set_editor_property(name, items)
    return obj


def bullet_tokens(tokens):
    """The bullet a hit's path stands for: a spawning hit's move bullet, or the bullet or sub-bullet itself."""
    last = tokens[-1][0]
    if last == "hits":
        return tokens[:-1] + [("bullet", None)]
    if last in ("bullet", "sub_bullets"):
        return tokens
    return None


def kind_of_effect(obj):
    effect = obj.get_editor_property("status_effect")
    return KIND_OF_CLASS.get(effect.get_name()) if effect else None


def research_status(hit, wanted=None):
    for status in hit.get("statuses") or []:
        name = status.get("name") or ""
        kind = next((k for k in STATUS_KINDS if name.startswith(k)), None)
        if kind and (wanted is None or kind == wanted):
            return kind, status
    return None, None


def tick_table(kind, status):
    """A status's own damage by depth, what the game code reads from Data.Damage (research _research/status_damage):
    Fire's burn per 2 s tick, Shock's arc per spasm, Freeze's thaw, Curse's cost per attack (capped at the original's
    40, user's decision), Sleep's wake damage. Start..end by power is the research's INFERRED linear lerp."""
    damage = (status or {}).get("status_damage") or {}
    if kind in ("Fire", "Freeze") and damage.get("tick_at_power_by_depth_INFERRED"):
        return table(damage["tick_at_power_by_depth_INFERRED"])
    if kind == "Curse" and damage.get("tick_at_power_by_depth_INFERRED"):
        cap = float(damage.get("max_curse_damage") or 40.0)
        return [min(value, cap) for value in table(damage["tick_at_power_by_depth_INFERRED"])]
    if kind == "Sleep" and damage.get("wake_at_power_by_depth_INFERRED"):
        return table(damage["wake_at_power_by_depth_INFERRED"])
    if kind == "Shock" and (damage.get("monster_arc_damage") or {}).get("by_depth"):
        return table(damage["monster_arc_damage"]["by_depth"])
    return None


def apply_weapon(name, entry, definition, weapon_enum, stats, problems):
    profile = definition.get_editor_property("attack")
    hits = list(entry.get("hits") or []) + list(entry.get("incomplete_charge_hits") or [])
    written = {}

    # Every hit the research maps onto the profile.
    for hit in hits:
        path = hit.get("profile_path")
        if not path:
            continue
        values = table(hit.get("gross_by_depth"))
        if path in written:
            if written[path] != values:
                problems.append("%s: two curves for %s (kept the first)" % (name, path))
            continue
        tokens = parse(path)
        try:
            leaf = get(profile, tokens)
        except Missing:
            problems.append("%s: no %s in the profile" % (name, path))
            continue
        written[path] = values
        edit(profile, tokens, lambda obj, v=values: obj.set_editor_property("damage_by_depth", v))
        stats["tables"] += 1

        kind, status = research_status(hit)
        leaf_name = tokens[-1][0]
        if kind and leaf_name == "hits" and kind_of_effect(leaf) == kind:
            chance = float(status.get("chance") or 0.0)
            ticks = tick_table(kind, status)

            def write_status(obj, chance=chance, ticks=ticks):
                if chance > 0.0:
                    obj.set_editor_property("status_chance", chance)
                obj.set_editor_property("status_tick_damage_by_depth", ticks or [])
            edit(profile, tokens, write_status)
            stats["hit_statuses"] += 1
        elif kind and leaf_name in ("detonation", "pulse") and leaf.get_editor_property("status_chance") >= 0.0 and float(status.get("chance") or 0.0) > 0.0:
            edit(profile, tokens, lambda obj, c=float(status["chance"]): obj.set_editor_property("status_chance", c))
            stats["burst_statuses"] += 1

        if hit.get("level") in ("bullet", "bullet pass-through"):
            btokens = bullet_tokens(tokens)
            try:
                bullet = get(profile, btokens) if btokens else None
            except Missing:
                bullet = None
            if bullet and bullet.get_editor_property("speed_cm_per_second") > 0.0:
                contact = bullet.get_editor_property("contact_damage_multiplier")
                if contact > 0.0 and abs(contact - 1.0) > 1e-3:
                    edit(profile, btokens, lambda obj: obj.set_editor_property("contact_damage_multiplier", 1.0))
                    stats["contact_reset"] += 1

    # Piercing charged shots deal their damage again where they end.
    ended = set()
    for hit in hits:
        if hit.get("profile_path") or hit.get("level") != "bullet end burst":
            continue
        sibling = next((h for h in hits if h.get("profile_path") and h.get("level") == "bullet pass-through"
                        and h.get("move") == hit.get("move") and h.get("step") == hit.get("step") and h.get("via") == hit.get("via")), None)
        btokens = bullet_tokens(parse(sibling["profile_path"])) if sibling else [("charged_attack", None), ("bullet", None)]
        key = repr(btokens)
        if not btokens or key in ended:
            continue
        try:
            bullet = get(profile, btokens)
        except Missing:
            problems.append("%s: end burst has no bullet at %s" % (name, key))
            continue
        if bullet.get_editor_property("speed_cm_per_second") <= 0.0:
            problems.append("%s: end burst's bullet %s is not set in the profile, so the move fires no bullet at all" % (name, key))
            continue
        if not bullet.get_editor_property("passes_through"):
            # A detonation on a bullet that stops at the first monster would strike that monster twice.
            problems.append("%s: end burst's bullet %s does not pass through in the profile; end burst not added" % (name, key))
            continue
        detonation = bullet.get_editor_property("detonation")
        if (detonation.get_editor_property("radius_cm") > 0.0 or len(detonation.get_editor_property("children")) > 0) \
                and len(detonation.get_editor_property("damage_by_depth")) == 0:
            problems.append("%s: bullet %s already has its own detonation; end burst not added" % (name, key))
            continue
        values = table(hit.get("gross_by_depth"))
        radius = max(float(bullet.get_editor_property("collision_radius_cm")), 50.0)

        def add_end_burst(obj, values=values, radius=radius):
            burst = unreal.ClockworksBulletBurst()
            burst.set_editor_property("radius_cm", radius)
            burst.set_editor_property("damage_multiplier", 1.0)
            burst.set_editor_property("damage_by_depth", values)
            burst.set_editor_property("knockback", 0.0)
            burst.set_editor_property("status_chance", -1.0)
            obj.set_editor_property("detonation", burst)
        edit(profile, btokens, add_end_burst)
        ended.add(key)
        stats["end_bursts"] += 1

    # The Mixer line's pellets.
    orbited = set()
    for hit in hits:
        level = hit.get("level") or ""
        if hit.get("profile_path") or "child" not in level or "handler" not in level:
            continue
        if not any("Mixer" in via for via in hit.get("via") or []):
            continue
        move = hit.get("move")
        if move == "normal":
            btokens = [("chain", int(hit.get("step") or 0)), ("bullet", None)]
        elif move == "charged":
            btokens = [("charged_attack", None), ("bullet", None)]
        else:
            btokens = [("incomplete_charge", None), ("bullet", None)]
        key = repr(btokens)
        if key in orbited:
            continue
        orbited.add(key)
        try:
            bullet = get(profile, btokens)
        except Missing:
            problems.append("%s: orbital has no bullet at %s" % (name, key))
            continue
        if bullet.get_editor_property("speed_cm_per_second") <= 0.0:
            if move != "incomplete":
                problems.append("%s: orbital's bullet %s is not set" % (name, key))
            continue
        if bullet.get_editor_property("look").get_editor_property("orbit_count") <= 0:
            problems.append("%s: bullet %s has no orbiting pellets to deal its orbital damage" % (name, key))
            continue
        edit(profile, btokens, lambda obj, v=table(hit.get("gross_by_depth")): obj.set_editor_property("orbit_damage_by_depth", v))
        stats["orbits"] += 1

    # Dual-type weapons: each mapped hit splits its damage between its two types (research _research/weapon_gaps: no
    # split is in the game files, so 50/50 is INFERRED from equal per-type placeholders and item cards).
    for path, split in (((GAPS.get("splits") or {}).get(name) or {}).get("hits") or {}).items():
        if path.startswith("unmapped:") or not split.get("type2"):
            continue
        first, second = split.get("type"), split.get("type2")
        shares = (split.get("share_by_depth_INFERRED") or {}).get(second)
        if not hasattr(unreal.ClockworksHitDamageType, str(first)) or not hasattr(unreal.ClockworksHitDamageType, str(second)) or not shares:
            problems.append("%s: split at %s has types %s / %s without a share" % (name, path, first, second))
            continue
        tokens = parse(path)

        def write_types(obj, first=first, second=second, shares=table(shares)):
            types = unreal.ClockworksDamageTypes()
            types.set_editor_property("primary", getattr(unreal.ClockworksHitDamageType, first))
            types.set_editor_property("second", getattr(unreal.ClockworksHitDamageType, second))
            types.set_editor_property("second_share_by_depth", shares)
            obj.set_editor_property("damage_types", types)
        try:
            edit(profile, tokens, write_types)
            stats["split_types"] += 1
        except Missing:
            problems.append("%s: no %s in the profile for its damage split" % (name, path))

    # The Warmaster bombs' orbiting pellets (rings built by distill_bullet_behaviours.py as stationary sub-bullets): the
    # blast's own damage on touch (research _research/weapon_gaps).
    orbital = (GAPS.get("orbitals") or {}).get(name) or {}
    if (orbital.get("orbital_damage") or {}).get("gross_by_depth") and orbital.get("rings"):
        values = table(orbital["orbital_damage"]["gross_by_depth"])
        subs = list(profile.get_editor_property("sub_bullets"))
        rings = 0
        for index, sub in enumerate(subs):
            if sub.get_editor_property("look").get_editor_property("orbit_count") > 0 and sub.get_editor_property("speed_cm_per_second") <= 0.0:
                sub.set_editor_property("orbit_damage_by_depth", values)
                subs[index] = sub
                rings += 1
        profile.set_editor_property("sub_bullets", subs)
        stats["orbits"] += rings
        if rings == 0:
            problems.append("%s: no orbital sub-bullets to carry the orbit damage (re-run distill_bullet_behaviours.py and generate_attack_profiles.py)" % name)

    # The Catalyzer line's orbs: each weapon's own Damage argument is the blast, not the +15 (Charged) default the
    # weapon damage research first read (correction by _research/status_damage). The poison lines' orbs also poison at
    # the LOW chance.
    catalyzer = ((STATUS_RESEARCH.get("catalyzer") or {}).get("weapons") or {}).get(name)
    if catalyzer:
        blast = next((part for part in (catalyzer.get("pellet") or {}).get("orbital_blast") or [] if part.get("kind") == "damage"), None)
        if blast:
            values = table(blast.get("gross_by_depth"))
            poison = any(word in name for word in ("Toxic", "Virulent", "Biohazard", "Pollinator"))
            for move_tokens in [[("chain", i)] for i in range(len(profile.get_editor_property("chain")))] + [[("incomplete_charge", None)]]:
                tokens = move_tokens + [("bullet", None), ("detonation", None)]
                try:
                    detonation = get(profile, tokens)
                except Missing:
                    continue
                if detonation.get_editor_property("radius_cm") <= 0.0:
                    continue

                def write_blast(obj, values=values, poison=poison):
                    obj.set_editor_property("damage_by_depth", values)
                    if poison:
                        obj.set_editor_property("status_chance", CHANCE["LOW"])
                edit(profile, tokens, write_blast)
                stats["catalyzer_blasts"] += 1

    definition.set_editor_property("attack", profile)

    # The weapon's own status, which every hit without one of its own falls back to.
    weapon_kind = kind_of_effect(definition)
    if weapon_kind:
        ordered = [h for h in hits if h.get("move") == "normal"] + hits
        status = next((s for s in (research_status(h, weapon_kind)[1] for h in ordered) if s), None)
        chance = float(status.get("chance") or 0.0) if status else 0.0
        if chance <= 0.0:
            chance = CHANCE.get(weapon_enum or "", 0.0)
        if chance > 0.0:
            definition.set_editor_property("status_chance", chance)
            stats["weapon_chances"] += 1
        ticks = tick_table(weapon_kind, status) if status else None
        definition.set_editor_property("status_tick_damage_by_depth", ticks or [])
        stats["weapon_ticks"] += 1 if ticks else 0

    unreal.EditorAssetLibrary.save_loaded_asset(definition, False)


def sample(definition, path, prop):
    try:
        return list(get(definition.get_editor_property("attack"), parse(path)).get_editor_property(prop))
    except Exception as error:  # noqa: BLE001 - a report line, never a failure
        return "unreadable (%s)" % error


def main():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous([GEAR_PATH, "/Game/TopDown/Gear"], True)

    with open(RESEARCH, encoding="utf-8") as handle:
        research = json.load(handle)["weapons"]
    with open(WEAPONS_JSON, encoding="utf-8") as handle:
        enums = {w.get("display_name"): w.get("status_chance") for w in json.load(handle)}
    with open(GAPS_JSON, encoding="utf-8") as handle:
        GAPS.update(json.load(handle))
    with open(STATUS_JSON, encoding="utf-8") as handle:
        STATUS_RESEARCH.update(json.load(handle))

    stats = {k: 0 for k in ("weapons", "tables", "hit_statuses", "burst_statuses", "contact_reset", "end_bursts",
                            "orbits", "weapon_chances", "weapon_ticks", "split_types", "catalyzer_blasts")}
    problems, no_asset = [], []
    for name, entry in research.items():
        paths = [GEAR_PATH + "/" + safe_asset_name(name)]
        if name in EXTRA_ASSETS:
            paths.append(EXTRA_ASSETS[name])
        for path in paths:
            if not unreal.EditorAssetLibrary.does_asset_exist(path):
                if path.startswith(GEAR_PATH):
                    no_asset.append(name)
                continue
            definition = unreal.EditorAssetLibrary.load_asset(path)
            attack = definition.get_editor_property("attack")
            # A bomb has no chain, only its charged move.
            if not attack.get_editor_property("chain") and not attack.get_editor_property("charged_attack").get_editor_property("hits"):
                if path.startswith(GEAR_PATH):
                    problems.append("%s: no attack profile" % name)
                continue
            apply_weapon(name, entry, definition, enums.get(name), stats, problems)
            stats["weapons"] += 1

    unreal.log_warning("WeaponDamage: " + ", ".join("%s %d" % item for item in stats.items()))
    unreal.log_warning("WeaponDamage: no asset for %d: %s" % (len(no_asset), ", ".join(no_asset[:20])))
    unreal.log_warning("WeaponDamage: %d problems, listed in %s" % (len(problems), REPORT))
    with open(REPORT, "w", encoding="utf-8") as handle:
        json.dump({"stats": stats, "no_asset": no_asset, "problems": problems}, handle, indent=1)

    # Read back a few, to compare with the research by eye (index 4 is demo depth 4, original depth 15).
    checks = [
        ("Calibur", "Attack.Chain[2].Hits[0]", "damage_by_depth"),
        ("Calibur", "Attack.ChargedAttack.Hits[0]", "damage_by_depth"),
        ("Calibur", "Attack.IncompleteCharge.Hits[0]", "damage_by_depth"),
        ("Magnus", "Attack.ChargedAttack.Bullet.Detonation", "damage_by_depth"),
        ("Celestial Orbitgun", "Attack.Chain[0].Bullet", "orbit_damage_by_depth"),
        ("Nitronome", "Attack.ChargedAttack.Hits[0]", "damage_by_depth"),
        ("Brandish", "Attack.ChargedAttack.Bullet.Pulse", "damage_by_depth"),
        ("Autogun", "Attack.Chain[0].Hits[0]", "damage_by_depth"),
    ]
    for name, path, prop in checks:
        asset = GEAR_PATH + "/" + safe_asset_name(name)
        if unreal.EditorAssetLibrary.does_asset_exist(asset):
            definition = unreal.EditorAssetLibrary.load_asset(asset)
            unreal.log_warning("WeaponDamage check: %s %s.%s = %s" % (name, path, prop, sample(definition, path, prop)))
    for name in ("Firotech Alchemer", "Voltech Alchemer", "Magnus"):
        asset = GEAR_PATH + "/" + safe_asset_name(name)
        if unreal.EditorAssetLibrary.does_asset_exist(asset):
            definition = unreal.EditorAssetLibrary.load_asset(asset)
            unreal.log_warning("WeaponDamage check: %s status %s chance %.2f ticks %s" % (
                name, kind_of_effect(definition), definition.get_editor_property("status_chance"),
                list(definition.get_editor_property("status_tick_damage_by_depth"))))


main()
