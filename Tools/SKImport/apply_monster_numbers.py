# Unreal Editor Python script. Run it headless after the game module with the depth tables is built:
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/apply_monster_numbers.py"
#
# Writes the original's monster numbers (user's decision 2026-09-15: every monster retuned from the depth curves)
# onto the 12 monster Blueprints and their main attack abilities, from the research in
# D:/Dev/SKAssets/_research/monsters/monster_numbers.json (mined from the game's configs at medium difficulty):
#
#   monster:  HealthByDepth, Normal/Piercing/Elemental/ShadowDefenseByDepth
#   attack:   Normal/Piercing/Elemental/ShadowDamageByDepth (the main attack's split by type)
#
# Every table has 9 entries, the demo's depths 0 to 8, which the research gives at the matching original depths
# 1, 4, 7, 11, 15, 18, 22, 25, 29. Extra attacks (combo slashes, spires, hairballs, boss moves) are not built yet and
# are not written. Re-runnable.

import json
import unreal

NUMBERS = r"D:\Dev\SKAssets\_research\monsters\monster_numbers.json"
DEPTHS = ["1", "4", "7", "11", "15", "18", "22", "25", "29"]
KINDS = [("NORMAL", "normal"), ("PIERCING", "piercing"), ("ELEMENTAL", "elemental"), ("SHADOW", "shadow")]
FOLDERS = ["/Game/TopDown/Blueprints/Monsters", "/Game/TopDown/Blueprints"]


def find_blueprint(name):
    for folder in FOLDERS:
        path = folder + "/" + name
        if unreal.EditorAssetLibrary.does_asset_exist(path):
            return unreal.EditorAssetLibrary.load_asset(path)
    return None


def table(by_depth):
    return [float((by_depth or {}).get(depth) or 0.0) for depth in DEPTHS]


# The Royal Jelly's four stages share its numbers: stages 1 and 2 carry its own health curve, stages 3 and 4 three
# quarters of it (the original's Health Base +20 against +30: 2372.14 against 3162.86 at depth 25). Defense per type is
# the same throughout, and every fighting stage keeps the jelly's own attack, so only health differs.
JELLY_STAGE_HEALTH = {"BP_RoyalJellyStage1": 1.0, "BP_RoyalJellyStage2": 1.0,
                      "BP_RoyalJellyStage3": 0.75, "BP_RoyalJellyStage4": 0.75,
                      # Its minions are on the same curve: a polyp is exactly half the jelly's health at every depth
                      # (Health Base +10 against +30: 1581.43 against 3162.86 at 25), a Royal Mini an eighth.
                      "BP_RoyalPolyp": 0.5, "BP_RoyalMini": 0.125}


def apply_royal_jelly_stages(monsters, missing):
    """Health and defense by depth for the stage Blueprints generate_monsters.py chains together."""
    entry = monsters.get("RoyalJelly")
    if not entry:
        missing.append("RoyalJelly (no numbers)")
        return 0
    health = table(entry.get("health_by_depth"))
    defense = entry.get("defense_by_depth") or {}

    done = 0
    for name, share in sorted(JELLY_STAGE_HEALTH.items()):
        blueprint = find_blueprint(name)
        if not blueprint:
            missing.append(name)
            continue
        defaults = unreal.get_default_object(blueprint.generated_class())
        defaults.set_editor_property("health_by_depth", [value * share for value in health])
        for research_kind, ours in KINDS:
            defaults.set_editor_property(ours + "_defense_by_depth", table(defense.get(research_kind)))
        unreal.EditorAssetLibrary.save_loaded_asset(blueprint, False)
        unreal.log_warning("MonsterNumbers: %-16s health d1 %.0f d8 %.0f (%.0f%% of the jelly's)"
                           % (name, health[1] * share, health[8] * share, share * 100.0))
        done += 1
    return done


def main():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous(FOLDERS, True)

    with open(NUMBERS, encoding="utf-8") as handle:
        monsters = json.load(handle)["monsters"]

    done, missing = 0, []
    for key, entry in monsters.items():
        blueprint_name = (entry.get("our_asset") or ("BP_" + key)).split(" ")[0]
        blueprint = find_blueprint(blueprint_name)
        if not blueprint:
            missing.append(blueprint_name)
            continue
        defaults = unreal.get_default_object(blueprint.generated_class())
        defaults.set_editor_property("health_by_depth", table(entry.get("health_by_depth")))
        defense = entry.get("defense_by_depth") or {}
        for research_kind, ours in KINDS:
            defaults.set_editor_property(ours + "_defense_by_depth", table(defense.get(research_kind)))
        unreal.EditorAssetLibrary.save_loaded_asset(blueprint, False)

        attacks = entry.get("attacks") or []
        main_attack = next((a for a in attacks if (a.get("role") or "").startswith("main")), attacks[0] if attacks else None)
        ability = find_blueprint(main_attack["our_ability"]) if main_attack else None
        if not ability:
            missing.append("%s attack %s" % (key, main_attack.get("our_ability") if main_attack else "(none)"))
            continue
        ability_defaults = unreal.get_default_object(ability.generated_class())
        parts = {ours: [] for _, ours in KINDS}
        for depth in DEPTHS:
            per_type = ((main_attack.get("damage_by_depth") or {}).get(depth) or {}).get("per_type") or {}
            for research_kind, ours in KINDS:
                parts[ours].append(float(per_type.get(research_kind) or 0.0))
        for ours, values in parts.items():
            ability_defaults.set_editor_property(ours + "_damage_by_depth", values)
        unreal.EditorAssetLibrary.save_loaded_asset(ability, False)

        health = table(entry.get("health_by_depth"))
        gross = [sum(parts[ours][i] for _, ours in KINDS) for i in range(len(DEPTHS))]
        unreal.log_warning("MonsterNumbers: %-16s health d1 %.0f d4 %.0f d8 %.0f | %s d1 %.1f d4 %.1f d8 %.1f | defense N d1 %.0f"
                           % (key, health[1], health[4], health[8], main_attack.get("label"), gross[1], gross[4], gross[8],
                              table(defense.get("NORMAL"))[1]))
        done += 1

    done += apply_royal_jelly_stages(monsters, missing)

    unreal.log_warning("MonsterNumbers: %d monsters written; missing: %s" % (done, ", ".join(missing) or "none"))


main()
