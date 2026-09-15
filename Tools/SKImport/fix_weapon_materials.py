# Unreal Editor Python script. Run it headless after generate_weapon_assets.py:
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/fix_weapon_materials.py"
#
# Gives every catalogue weapon its skin.
#
# Why this is needed. The exporter leaves most weapon models on a blank placeholder material
# ("dummymtl-..."). Two different things are going on:
#
#   * A single model with its skins inside (the Proto Bomb): the glb carries skin_proto, skin_fire,
#     skin_ice and so on as real materials, but the mesh's slot still points at the placeholder,
#     because the game picks the skin per weapon at runtime.
#   * A model *set* (the chemical bombs, the Brandish swords, the Pulsars): the glb carries no
#     textures at all. The skin PNGs sit in the game's rsrc folder next to the model file.
#
# So, per weapon, this picks the PNG in the model's rsrc folder whose name best matches the weapon's
# model file ("model_brandish-fir-r2" -> "brandish_fir-r2") and variant ("Fire Red" -> "skin_firered"),
# uses the imported skin material of that name if the model already has one, and otherwise imports
# the PNG and makes a material instance for it from one of the imported glTF skins. The result is set
# as the weapon definition's MeshMaterial; the models themselves are not changed, since several
# weapons share one.
#
# Writes only under the git-ignored Content/SK and the catalogue's own data assets. Re-runnable.
# A report of what was chosen, and what could not be resolved, goes to CLOCKWORKS_FIX_OUT or next to
# this script as weapon_material_fix.json.

import json
import os
import re
import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
WEAPONS_JSON = os.path.join(HERE, "weapons.json")
OUT = os.environ.get("CLOCKWORKS_FIX_OUT") or os.path.join(HERE, "weapon_material_fix.json")

RSRC = r"C:\Program Files (x86)\Steam\steamapps\common\Spiral Knights\rsrc"
MODEL_PATH = "/Game/SK/WeaponModels"
GEAR_PATH = "/Game/TopDown/Gear/Catalogue"

# PNGs beside a model that are never a skin.
NOT_A_SKIN = re.compile(r"(^|[_-])(spec|fx|chain|glow|mask|normal)([_-]|$)")


def words(text):
    return [w for w in re.split(r"[^a-z0-9]+", (text or "").lower()) if w]


def clean_name(text):
    cleaned = "".join(ch if ch.isalnum() else "_" for ch in text)
    while "__" in cleaned:
        cleaned = cleaned.replace("__", "_")
    return cleaned.strip("_")


def safe_asset_name(display_name):
    cleaned = "".join(ch if ch.isalnum() else " " for ch in display_name)
    return "DA_Weapon_" + "".join(part.capitalize() for part in cleaned.split())


def similar(a, b):
    """'shock' matches 'sho', 'fire' matches 'fir'. Short fragments are the game's own abbreviations."""
    if a == b:
        return True
    shorter, longer = sorted((a, b), key=len)
    return len(shorter) >= 3 and longer.startswith(shorter)


def choose_skin(model_path, variant):
    """(png path, score) for the skin this weapon wears, or (None, 0)."""
    folder = os.path.join(RSRC, os.path.dirname(model_path.replace("/", os.sep)))
    if not os.path.isdir(folder):
        return None, 0

    stem = os.path.splitext(os.path.basename(model_path))[0]
    wanted = [w for w in words(stem) if w != "model"]
    revision = next((w for w in wanted if re.fullmatch(r"r\d", w)), None)
    wanted_words = [w for w in wanted if w != revision] + words(variant)
    if variant:
        # "Fire Red" is spelled "firered" in the file names.
        wanted_words.append("".join(words(variant)))

    best, best_score = None, 0
    for file_name in sorted(os.listdir(folder)):
        if not file_name.lower().endswith(".png"):
            continue
        png_stem = os.path.splitext(file_name)[0].lower()
        if NOT_A_SKIN.search(png_stem):
            continue

        png_words = words(png_stem)
        score = 0
        for w in png_words:
            if re.fullmatch(r"[rt]\d", w):
                if revision and w[1] == revision[1] and w[0] == "r":
                    score += 4
                elif revision:
                    score -= 3
                continue
            if w == "skin":
                score += 1
                continue
            # An exact word beats an abbreviation: "Poison Green" must pick skin_poisongreen over
            # skin_greenblue, which only shares a prefix with "green".
            if w in wanted_words:
                score += 4
            elif any(similar(w, want) for want in wanted_words):
                score += 2
            else:
                score -= 2
        if score > best_score:
            best, best_score = os.path.join(folder, file_name), score
    return best, best_score


def model_folder_of(mesh):
    rest = mesh.get_path_name()[len(MODEL_PATH) + 1:]
    return MODEL_PATH + "/" + rest.split("/")[0]


def find_template():
    """An imported glTF skin with a texture parameter, to copy for the skins that have none."""
    for path in unreal.EditorAssetLibrary.list_assets(MODEL_PATH, recursive=True, include_folder=False):
        if "/Materials/" not in path:
            continue
        asset = unreal.EditorAssetLibrary.load_asset(path)
        if isinstance(asset, unreal.MaterialInstanceConstant):
            values = asset.get_editor_property("texture_parameter_values") or []
            if values:
                info = values[0].get_editor_property("parameter_info")
                return asset, info.get_editor_property("name")
    return None, None


def existing_skin(folder, png_stem):
    """The imported material in a model folder named after this PNG, if the glb brought one."""
    materials = folder + "/Materials"
    if not unreal.EditorAssetLibrary.does_directory_exist(materials):
        return None
    for path in unreal.EditorAssetLibrary.list_assets(materials, recursive=False, include_folder=False):
        asset_name = path.split("/")[-1].split(".")[0]
        if asset_name.lower() in (png_stem.lower(), clean_name(png_stem).lower(), "mi_" + clean_name(png_stem).lower()):
            return unreal.EditorAssetLibrary.load_asset(path)
    return None


def make_skin(folder, png_path, template, parameter_name):
    """Imports the PNG into the model folder and makes a material instance showing it."""
    png_stem = os.path.splitext(os.path.basename(png_path))[0]
    texture_name = "T_" + clean_name(png_stem)
    texture_path = folder + "/Textures/" + texture_name
    texture = unreal.EditorAssetLibrary.load_asset(texture_path) if unreal.EditorAssetLibrary.does_asset_exist(texture_path) else None
    if not texture:
        task = unreal.AssetImportTask()
        task.set_editor_property("filename", png_path)
        task.set_editor_property("destination_path", folder + "/Textures")
        task.set_editor_property("destination_name", texture_name)
        task.set_editor_property("automated", True)
        task.set_editor_property("replace_existing", False)
        task.set_editor_property("save", True)
        unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
        texture = unreal.EditorAssetLibrary.load_asset(texture_path) if unreal.EditorAssetLibrary.does_asset_exist(texture_path) else None
    if not texture:
        return None

    material_path = folder + "/Materials/MI_" + clean_name(png_stem)
    if unreal.EditorAssetLibrary.does_asset_exist(material_path):
        material = unreal.EditorAssetLibrary.load_asset(material_path)
    else:
        material = unreal.EditorAssetLibrary.duplicate_asset(template.get_path_name(), material_path)
    if not material:
        return None
    unreal.MaterialEditingLibrary.set_material_instance_texture_parameter_value(material, parameter_name, texture)
    unreal.MaterialEditingLibrary.update_material_instance(material)
    unreal.EditorAssetLibrary.save_loaded_asset(material, False)
    return material


GUN_JSON = os.path.join(HERE, "gun_models_textures.json")
_GUN_SKINS = None


def known_skin(display_name):
    """The skin the game's own model data names for this weapon, when it has been traced.

    gun_models_textures.json follows each weapon's model reference through its variant and model
    arguments down to the model file that holds the mesh, which names its texture outright. That is
    better than any guess from file names, so it wins wherever it exists.
    """
    global _GUN_SKINS
    if _GUN_SKINS is None:
        _GUN_SKINS = {}
        if os.path.isfile(GUN_JSON):
            with open(GUN_JSON, encoding="utf-8") as handle:
                for name, entry in json.load(handle).items():
                    if isinstance(entry, dict) and entry.get("skin_png") and entry.get("skin_png_exists", True):
                        _GUN_SKINS[name] = os.path.join(RSRC, entry["skin_png"].replace("/", os.sep))
    path = _GUN_SKINS.get(display_name)
    return path if path and os.path.isfile(path) else None


def main():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous([MODEL_PATH, GEAR_PATH], True)

    with open(WEAPONS_JSON, encoding="utf-8") as handle:
        weapons = json.load(handle)

    template, parameter_name = find_template()
    if not template:
        unreal.log_warning("Clockworks: no imported glTF skin to copy; cannot make skins")
        return

    report = {"template": template.get_path_name(), "parameter": str(parameter_name), "applied": [], "kept": [], "unresolved": []}
    counts = {}

    for weapon in weapons:
        asset_path = GEAR_PATH + "/" + safe_asset_name(weapon.get("display_name") or "")
        if not unreal.EditorAssetLibrary.does_asset_exist(asset_path):
            continue
        definition = unreal.EditorAssetLibrary.load_asset(asset_path)
        mesh = definition.get_editor_property("mesh")
        weapon_class = weapon.get("weapon_class")
        tally = counts.setdefault(weapon_class, {"applied": 0, "kept": 0, "unresolved": 0, "no_mesh": 0})
        if not mesh:
            tally["no_mesh"] += 1
            continue

        slots = mesh.get_editor_property("static_materials")
        current = slots[0].get_editor_property("material_interface") if slots else None
        current_name = current.get_name() if current else ""
        placeholder = (not current) or current_name.startswith("dummymtl")

        png = known_skin(weapon.get("display_name") or "")
        score = 100 if png else 0
        if not png:
            png, score = choose_skin(weapon.get("model_path") or "", weapon.get("model_variant"))
        entry = {"weapon": weapon.get("display_name"), "model": weapon.get("model_path"), "variant": weapon.get("model_variant"),
                 "mesh_material": current_name, "png": os.path.basename(png) if png else None, "score": score}

        if not png:
            if placeholder:
                tally["unresolved"] += 1
                report["unresolved"].append(entry)
            else:
                tally["kept"] += 1
                report["kept"].append(entry)
            continue

        png_stem = os.path.splitext(os.path.basename(png))[0]
        # A model that already wears the right skin keeps it; only a placeholder, or a variant asking
        # for a different skin than the model's default, gets an override.
        if not placeholder and current_name.lower() == png_stem.lower():
            if definition.get_editor_property("mesh_material"):
                definition.set_editor_property("mesh_material", None)
                unreal.EditorAssetLibrary.save_loaded_asset(definition, False)
            tally["kept"] += 1
            report["kept"].append(entry)
            continue

        folder = model_folder_of(mesh)
        material = existing_skin(folder, png_stem) or make_skin(folder, png, template, parameter_name)
        if not material:
            tally["unresolved"] += 1
            report["unresolved"].append(entry)
            continue

        definition.set_editor_property("mesh_material", material)
        unreal.EditorAssetLibrary.save_loaded_asset(definition, False)
        entry["applied"] = material.get_path_name()
        tally["applied"] += 1
        report["applied"].append(entry)

    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=1)

    unreal.log_warning("Clockworks: weapon skins by class: " + json.dumps(counts))
    unreal.log_warning("Clockworks: skin report written to " + OUT)


main()
