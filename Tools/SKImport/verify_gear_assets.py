# Unreal Editor Python script. Run it headless after generate_gear_assets.py:
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/verify_gear_assets.py"
#
# Reads every DA_Gear_* back and reports, per slot: how many, with an icon, with a model, with stats curves of the
# right length, with heat numbers, shields with health; and what BP_ClockworksCharacter starts in. Changes nothing.

import unreal

OUT = "/Game/TopDown/Gear/Knight"
CHARACTER_BP = "/Game/TopDown/Blueprints/BP_ClockworksCharacter"
SAMPLES = 7


def main():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous([OUT, "/Game/TopDown/Blueprints"], True)

    rows = {}
    problems = []
    for path in unreal.EditorAssetLibrary.list_assets(OUT, recursive=True, include_folder=False):
        gear = unreal.EditorAssetLibrary.load_asset(path)
        if not isinstance(gear, unreal.ClockworksGearDefinition):
            continue
        # The enum prints as "<ClockworksGearSlot.SHIELD: 2>"; its name is the part wanted.
        slot = gear.get_editor_property("slot").name
        row = rows.setdefault(slot, {"count": 0, "icon": 0, "model": 0, "curves_ok": 0, "heat": 0, "shield_health": 0, "bonuses": 0, "resists": 0, "unreleased": 0})
        row["count"] += 1
        row["icon"] += 1 if gear.get_editor_property("icon") else 0
        has_model = gear.get_editor_property("mesh") or gear.get_editor_property("armor_mesh")
        row["model"] += 1 if has_model else 0
        curves = [gear.get_editor_property(p) for p in ("normal_defense", "piercing_defense", "elemental_defense", "shadow_defense")]
        if all(len(c) in (0, SAMPLES) for c in curves):
            row["curves_ok"] += 1
        else:
            problems.append("%s: a defense curve is not %d long" % (path, SAMPLES))
        row["heat"] += 1 if gear.get_editor_property("heat_defense_bonus") > 0 else 0
        if slot == "SHIELD":
            if len(gear.get_editor_property("shield_health")) == SAMPLES:
                row["shield_health"] += 1
            else:
                problems.append("%s: shield health curve missing" % path)
        row["bonuses"] += 1 if len(gear.get_editor_property("bonuses")) else 0
        row["resists"] += 1 if len(gear.get_editor_property("status_resists")) else 0
        row["unreleased"] += 1 if gear.get_editor_property("unreleased") else 0
        row["skin_swaps"] = row.get("skin_swaps", 0) + (1 if len(gear.get_editor_property("skin_swaps")) else 0)
        row["loose_pieces"] = row.get("loose_pieces", 0) + len(gear.get_editor_property("armor_pieces"))
        row["hides_face"] = row.get("hides_face", 0) + (1 if gear.get_editor_property("hides_face") else 0)
        if slot == "SHIELD":
            row["bash_damage"] = row.get("bash_damage", 0) + (1 if len(gear.get_editor_property("shield_bash_damage")) == SAMPLES else 0)
            kind = gear.get_editor_property("shield_bash_kind").name
            row["bash_" + kind.lower()] = row.get("bash_" + kind.lower(), 0) + 1
        for bonus in gear.get_editor_property("bonuses"):
            value = bonus.get_editor_property("value")
            kind = bonus.get_editor_property("kind")
            if kind in ("RelativeDamageBonus", "TaggedDamageBonus", "ChargeTimeReduction") and abs(value) > 0.481:
                problems.append("%s: %s %.3f is above one bonus's biggest step" % (path, kind, value))
        if slot != "TRINKET" and not has_model:
            problems.append("%s: no model" % path)

    for slot, row in sorted(rows.items()):
        unreal.log_warning("GearVerify: %-8s %s" % (slot, ", ".join("%s %d" % kv for kv in row.items())))
    unreal.log_warning("GearVerify: total %d" % sum(r["count"] for r in rows.values()))

    blueprint = unreal.EditorAssetLibrary.load_asset(CHARACTER_BP)
    if blueprint:
        defaults = unreal.get_default_object(blueprint.generated_class())
        worn = defaults.get_editor_property("default_gear")
        unreal.log_warning("GearVerify: BP_ClockworksCharacter default gear %s, health %s" % (
            [g.get_name() if g else None for g in worn], defaults.get_editor_property("initial_max_health")))
    for problem in problems[:30]:
        unreal.log_warning("GearVerify: PROBLEM " + problem)
    unreal.log_warning("GearVerify: %d problems" % len(problems))


main()
