# Unreal Editor Python script. Run it headless after importing the RoyalPolyp model (stage_and_import.py):
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/make_monster_tint.py"
#
# The original tints some monsters at run time instead of shipping a texture: the Royal Polyp (the Royal Jelly's
# minion) is the plain polyp's magenta skin shifted to purple. User's decision 2026-09-15: do it in the material.
# Research: D:\Dev\SKAssets\_research\polyp_tint (findings.md, polyp_tint.json), read from actor.xml and
# pollup/model.dat: the Royal variant's ColorizationConfig matches every pixel (range 1,1,1) and shifts
# hue -0.122, saturation -0.012, value +0.052 in Java HSB on the 8-bit sRGB colour; one offset tints body, skirt
# and shell alike.
#
# Makes:
#   /Game/TopDown/Materials/Monsters/M_MonsterTint     masked, two-sided; Texture, HueShift, SaturationShift, ValueShift
#   /Game/SK/Monsters/RoyalPolyp/Materials/MI_RoyalPolyp_Skin    body and skirt (skin_recolor)
#   /Game/SK/Monsters/RoyalPolyp/Materials/MI_RoyalPolyp_Gloss   shell (gloss_recolor), additive like the game's shell
# and puts them on the polyp mesh in place of the imported skin_recolor / gloss_recolor materials.
#
# Not carried: the skirt's scrolling UVs and the shell's sphere mapping (the game's material effects), and the
# purple core particles. Re-runnable; re-run after re-importing the polyp.

import unreal

MATERIAL_PATH = "/Game/TopDown/Materials/Monsters"
MATERIAL_NAME = "M_MonsterTint"
POLYP = "/Game/SK/Monsters/RoyalPolyp"
POLYP_MESH = POLYP + "/SkeletalMeshes/pollup_model-Skin-Mesh_0_"
INSTANCES = POLYP + "/Materials"
ROYAL = {"HueShift": -0.122, "SaturationShift": -0.012, "ValueShift": 0.052}

MEL = unreal.MaterialEditingLibrary

# Linear -> sRGB, RGB -> HSV, the shift, HSV -> RGB, sRGB -> linear. The game recolours the 8-bit sRGB palette, so
# the shift happens in sRGB (plain HSV maths matched the game's bake exactly for the Royal variant).
TINT_CODE = """
float3 lin = saturate(Color.rgb);
float3 c = lerp(1.055 * pow(lin, 1.0 / 2.4) - 0.055, lin * 12.92, step(lin, 0.0031308));
float4 K = float4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
float4 p = lerp(float4(c.bg, K.wz), float4(c.gb, K.xy), step(c.b, c.g));
float4 q = lerp(float4(p.xyw, c.r), float4(c.r, p.yzx), step(p.x, c.r));
float d = q.x - min(q.w, q.y);
float e = 1.0e-10;
float3 hsv = float3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
float h = frac(hsv.x + HueShift);
float s = saturate(hsv.y + SaturationShift);
float v = saturate(hsv.z + ValueShift);
float3 rgb = v * lerp(float3(1.0, 1.0, 1.0), saturate(abs(frac(h + float3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0), s);
return lerp(pow((rgb + 0.055) / 1.055, 2.4), rgb / 12.92, step(rgb, 0.04045));
"""


def make_material():
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    path = MATERIAL_PATH + "/" + MATERIAL_NAME
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        material = unreal.EditorAssetLibrary.load_asset(path)
        MEL.delete_all_material_expressions(material)
    else:
        material = tools.create_asset(MATERIAL_NAME, MATERIAL_PATH, unreal.Material, unreal.MaterialFactoryNew())

    material.set_editor_property("blend_mode", unreal.BlendMode.BLEND_MASKED)
    material.set_editor_property("two_sided", True)
    material.set_editor_property("opacity_mask_clip_value", 0.5)

    texture = MEL.create_material_expression(material, unreal.MaterialExpressionTextureSampleParameter2D, -900, 0)
    texture.set_editor_property("parameter_name", "Texture")
    default_texture = unreal.EditorAssetLibrary.load_asset("/Engine/EngineResources/DefaultTexture")
    if default_texture:
        texture.set_editor_property("texture", default_texture)

    custom = MEL.create_material_expression(material, unreal.MaterialExpressionCustom, -500, 0)
    custom.set_editor_property("code", TINT_CODE)
    custom.set_editor_property("output_type", unreal.CustomMaterialOutputType.CMOT_FLOAT3)
    custom.set_editor_property("description", "Monster colorization")
    inputs = []
    for name in ["Color"] + list(ROYAL.keys()):
        entry = unreal.CustomInput()
        entry.set_editor_property("input_name", name)
        inputs.append(entry)
    custom.set_editor_property("inputs", inputs)
    MEL.connect_material_expressions(texture, "RGB", custom, "Color")

    for row, name in enumerate(ROYAL.keys()):
        parameter = MEL.create_material_expression(material, unreal.MaterialExpressionScalarParameter, -900, 300 + row * 120)
        parameter.set_editor_property("parameter_name", name)
        parameter.set_editor_property("default_value", 0.0)
        MEL.connect_material_expressions(parameter, "", custom, name)

    MEL.connect_material_property(custom, "", unreal.MaterialProperty.MP_BASE_COLOR)
    MEL.connect_material_property(texture, "A", unreal.MaterialProperty.MP_OPACITY_MASK)
    roughness = MEL.create_material_expression(material, unreal.MaterialExpressionConstant, -500, 400)
    roughness.set_editor_property("r", 1.0)
    MEL.connect_material_property(roughness, "", unreal.MaterialProperty.MP_ROUGHNESS)

    MEL.recompile_material(material)
    unreal.EditorAssetLibrary.save_loaded_asset(material, False)
    return material


def texture_of(material_interface, want_size):
    """The imported material's colour texture, else the polyp texture of the wanted size (skin 256x255, gloss 32x32)."""
    if isinstance(material_interface, unreal.MaterialInstance):
        for name in MEL.get_texture_parameter_names(material_interface):
            texture = MEL.get_material_instance_texture_parameter_value(material_interface, name)
            if texture and ("color" in str(name).lower() or "diffuse" in str(name).lower()):
                return texture
    for path in unreal.EditorAssetLibrary.list_assets(POLYP + "/Textures", recursive=False, include_folder=False):
        texture = unreal.EditorAssetLibrary.load_asset(path)
        if isinstance(texture, unreal.Texture2D) and (texture.blueprint_get_size_x(), texture.blueprint_get_size_y()) == want_size:
            return texture
    return None


def make_instance(name, parent, texture, additive):
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    path = INSTANCES + "/" + name
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        instance = unreal.EditorAssetLibrary.load_asset(path)
    else:
        instance = tools.create_asset(name, INSTANCES, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    MEL.set_material_instance_parent(instance, parent)
    MEL.set_material_instance_texture_parameter_value(instance, "Texture", texture)
    for parameter, value in ROYAL.items():
        MEL.set_material_instance_scalar_parameter_value(instance, parameter, value)
    overrides = instance.get_editor_property("base_property_overrides")
    overrides.set_editor_property("override_blend_mode", additive)
    overrides.set_editor_property("blend_mode", unreal.BlendMode.BLEND_ADDITIVE if additive else unreal.BlendMode.BLEND_MASKED)
    instance.set_editor_property("base_property_overrides", overrides)
    MEL.update_material_instance(instance)
    unreal.EditorAssetLibrary.save_loaded_asset(instance, False)
    return instance


def main():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous([POLYP, MATERIAL_PATH], True)

    mesh = unreal.EditorAssetLibrary.load_asset(POLYP_MESH) if unreal.EditorAssetLibrary.does_asset_exist(POLYP_MESH) else None
    if not mesh:
        unreal.log_warning("MonsterTint: no polyp mesh at %s; import RoyalPolyp first" % POLYP_MESH)
        return
    material = make_material()

    parts = {"skin_recolor": ("MI_RoyalPolyp_Skin", (256, 255), False), "gloss_recolor": ("MI_RoyalPolyp_Gloss", (32, 32), True)}
    made, swapped = {}, []

    def tint(slots, label):
        for index, slot in enumerate(slots):
            current = slot.get_editor_property("material_interface")
            # The imported name, or our own instance's on a re-run.
            key = current.get_name() if current else ""
            key = next((k for k, v in parts.items() if key in (k, v[0])), None)
            if not key:
                continue
            name, size, additive = parts[key]
            if name not in made:
                texture = texture_of(current, size) if current and current.get_name() == key else None
                if texture is None and unreal.EditorAssetLibrary.does_asset_exist(INSTANCES + "/" + name):
                    texture = MEL.get_material_instance_texture_parameter_value(unreal.EditorAssetLibrary.load_asset(INSTANCES + "/" + name), "Texture")
                if texture is None:
                    unreal.log_warning("MonsterTint: no texture found for %s" % key)
                    continue
                made[name] = make_instance(name, material, texture, additive)
                unreal.log_warning("MonsterTint: %s uses %s" % (name, texture.get_path_name()))
            slot.set_editor_property("material_interface", made[name])
            slots[index] = slot
            swapped.append("%s slot %d: %s" % (label, index, name))
        return slots

    mesh.set_editor_property("materials", tint(list(mesh.get_editor_property("materials")), "body"))
    unreal.EditorAssetLibrary.save_loaded_asset(mesh, False)

    # Interchange imports only the first of the export's three skin copies as the skinned mesh; the skirt and the
    # shell come in as static meshes beside it, and are tinted the same way.
    for path in unreal.EditorAssetLibrary.list_assets(POLYP + "/StaticMeshes", recursive=False, include_folder=False):
        part = unreal.EditorAssetLibrary.load_asset(path)
        if not isinstance(part, unreal.StaticMesh):
            continue
        part.set_editor_property("static_materials", tint(list(part.get_editor_property("static_materials")), part.get_name()[-9:]))
        unreal.EditorAssetLibrary.save_loaded_asset(part, False)

    unreal.log_warning("MonsterTint: %s built; polyp parts tinted: %s" % (MATERIAL_NAME, "; ".join(swapped) or "none"))


main()
