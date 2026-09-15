# Unreal Editor Python script. Read-only. Run it headless with:
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/audit_weapon_materials.py"
#
# Answers "which weapons render untextured, and why". For every imported weapon model it reports
# whether the mesh's material slots point at the exporter's placeholder ("dummymtl-...") material,
# and whether the model's folder has real skin materials and textures that could be used instead.
# It then maps that onto the weapon catalogue, per class, and checks the bomb actor's own mesh.
#
# Writes nothing to the project. The full report goes to the path in the CLOCKWORKS_AUDIT_OUT
# environment variable, or next to this script as weapon_material_audit.json.

import json
import os
import unreal

MODEL_PATH = "/Game/SK/WeaponModels"
GEAR_PATHS = ["/Game/TopDown/Gear", "/Game/TopDown/Gear/Catalogue"]
BLUEPRINTS = "/Game/TopDown/Blueprints"
OUT = os.environ.get("CLOCKWORKS_AUDIT_OUT") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "weapon_material_audit.json")


def folder_of(path):
    # /Game/SK/WeaponModels/SM_X/StaticMeshes/SM_X.SM_X -> SM_X
    rest = path[len(MODEL_PATH) + 1:]
    return rest.split("/")[0]


def describe_material(material):
    info = {"name": material.get_name() if material else None, "class": material.get_class().get_name() if material else None}
    if isinstance(material, unreal.MaterialInstance):
        textures = []
        for value in material.get_editor_property("texture_parameter_values") or []:
            tex = value.get_editor_property("parameter_value")
            textures.append(tex.get_name() if tex else None)
        parent = material.get_editor_property("parent")
        info["parent"] = parent.get_path_name() if parent else None
        info["textures"] = textures
    return info


def main():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous([MODEL_PATH, BLUEPRINTS] + GEAR_PATHS, True)

    folders = {}
    for path in unreal.EditorAssetLibrary.list_assets(MODEL_PATH, recursive=True, include_folder=False):
        folder = folders.setdefault(folder_of(path), {"meshes": [], "skins": [], "textures": 0})
        asset = unreal.EditorAssetLibrary.load_asset(path)
        if isinstance(asset, unreal.StaticMesh):
            slots = []
            for static_material in asset.get_editor_property("static_materials"):
                material = static_material.get_editor_property("material_interface")
                slots.append({
                    "slot": str(static_material.get_editor_property("material_slot_name")),
                    "material": material.get_name() if material else None,
                    "dummy": (material is None) or material.get_name().startswith("dummymtl"),
                })
            folder["meshes"].append({"path": asset.get_path_name(), "slots": slots})
        elif isinstance(asset, unreal.MaterialInterface) and not asset.get_name().startswith("dummymtl"):
            folder["skins"].append(describe_material(asset))
        elif isinstance(asset, unreal.Texture2D):
            folder["textures"] += 1

    # The catalogue: what each weapon's hand mesh actually looks like.
    by_class = {}
    weapons = []
    for gear_path in GEAR_PATHS:
        for path in unreal.EditorAssetLibrary.list_assets(gear_path, recursive=False, include_folder=False):
            weapon = unreal.EditorAssetLibrary.load_asset(path)
            if not isinstance(weapon, unreal.ClockworksWeaponDefinition):
                continue
            weapon_class = str(weapon.get_editor_property("weapon_class")).split(".")[-1]
            mesh = weapon.get_editor_property("mesh")
            if not mesh:
                state = "no-mesh"
            else:
                folder = folders.get(folder_of(mesh.get_path_name()), {})
                all_dummy = all(slot["dummy"] for entry in folder.get("meshes", []) if entry["path"] == mesh.get_path_name() for slot in entry["slots"])
                if not all_dummy:
                    state = "textured"
                elif folder.get("skins"):
                    state = "dummy-slot-but-skins-exist"
                else:
                    state = "dummy-slot-no-skins"
            by_class.setdefault(weapon_class, {}).setdefault(state, 0)
            by_class[weapon_class][state] += 1
            weapons.append({"asset": weapon.get_name(), "class": weapon_class, "mesh": mesh.get_path_name() if mesh else None, "state": state})

    # The bomb that lands on the floor is its own actor with its own mesh.
    bomb_actor = {}
    bomb_bp = unreal.EditorAssetLibrary.load_asset(BLUEPRINTS + "/BP_Bomb")
    if bomb_bp:
        cdo = unreal.get_default_object(bomb_bp.generated_class())
        component = cdo.get_editor_property("bomb_mesh")
        mesh = component.get_editor_property("static_mesh") if component else None
        materials = component.get_editor_property("override_materials") if component else []
        bomb_actor = {
            "mesh": mesh.get_path_name() if mesh else None,
            "override_materials": [m.get_name() if m else None for m in (materials or [])],
        }

    report = {"by_class": by_class, "bomb_actor": bomb_actor, "folders": folders, "weapons": weapons}
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=1)

    unreal.log_warning("Clockworks: weapon material audit by class: " + json.dumps(by_class))
    unreal.log_warning("Clockworks: bomb actor: " + json.dumps(bomb_actor))
    unreal.log_warning("Clockworks: report written to " + OUT)


main()
