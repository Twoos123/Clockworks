# Unreal Editor Python script. Run it headless after importing the GearSkins group:
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/make_gear_skin_materials.py"
#
# The original colours much of its gear at run time from a colour table. bake_gear_skins.py baked those colours into
# textures (T_GearSkin_*, imported under /Game/SK/GearSkins), except the knight's personal colour: the areas painted
# magenta in the files are where the colour each player picks goes (colour class "player"). Decision 2026-09-15: the
# material shifts that colour, blue by default, so the cosmetics pass later only has to change a parameter.
#
# Makes:
#   /Game/TopDown/Materials/Gear/M_GearSkin   masked, two-sided (the original's gear skins are two-sided masked);
#                                             Texture, and PlayerHueShift in turns of hue (magenta 0.833 + shift)
#   /Game/SK/GearSkins/Materials/MI_GearSkin_<stem>   one instance per tinted texture
#
# The shift is the original's recolour rule for the player class (bake_gear_icons.py): a pixel whose hue is within
# 0.025 of the class source (magenta) takes the offset; saturation and value ranges are 1.0, so they always match.
# Blue is -0.1667 (hue 0.667; INFERRED from the class's hue steps, see gear_tinted.json's summary).
#
# Re-runnable: the material is rebuilt, existing instances are updated.

import unreal

MATERIAL_PATH = "/Game/TopDown/Materials/Gear"
MATERIAL_NAME = "M_GearSkin"
SKINS = "/Game/SK/GearSkins"
INSTANCES = SKINS + "/Materials"
DEFAULT_HUE_SHIFT = -0.1667

MEL = unreal.MaterialEditingLibrary

# RGB -> HSV, shift the hue of magenta-keyed pixels, HSV -> RGB. Greys have no hue and never match (Java's RGBtoHSB
# gives them hue 0, far from magenta).
SHIFT_CODE = """
float3 c = Color.rgb;
float4 K = float4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
float4 p = lerp(float4(c.bg, K.wz), float4(c.gb, K.xy), step(c.b, c.g));
float4 q = lerp(float4(p.xyw, c.r), float4(c.r, p.yzx), step(p.x, c.r));
float d = q.x - min(q.w, q.y);
float e = 1.0e-10;
float3 hsv = float3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
float dist = abs(hsv.x - 0.8333333);
dist = min(dist, 1.0 - dist);
if (dist > 0.025 || hsv.y <= 0.0001)
{
    return c;
}
float h = frac(hsv.x + HueShift);
float3 rgb = saturate(abs(frac(h + float3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0);
return hsv.z * lerp(float3(1.0, 1.0, 1.0), rgb, hsv.y);
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

    hue = MEL.create_material_expression(material, unreal.MaterialExpressionScalarParameter, -900, 300)
    hue.set_editor_property("parameter_name", "PlayerHueShift")
    hue.set_editor_property("default_value", DEFAULT_HUE_SHIFT)

    custom = MEL.create_material_expression(material, unreal.MaterialExpressionCustom, -500, 0)
    custom.set_editor_property("code", SHIFT_CODE)
    custom.set_editor_property("output_type", unreal.CustomMaterialOutputType.CMOT_FLOAT3)
    custom.set_editor_property("description", "Player colour shift")
    color_input = unreal.CustomInput()
    color_input.set_editor_property("input_name", "Color")
    hue_input = unreal.CustomInput()
    hue_input.set_editor_property("input_name", "HueShift")
    custom.set_editor_property("inputs", [color_input, hue_input])

    MEL.connect_material_expressions(texture, "RGB", custom, "Color")
    MEL.connect_material_expressions(hue, "", custom, "HueShift")
    MEL.connect_material_property(custom, "", unreal.MaterialProperty.MP_BASE_COLOR)
    MEL.connect_material_property(texture, "A", unreal.MaterialProperty.MP_OPACITY_MASK)

    roughness = MEL.create_material_expression(material, unreal.MaterialExpressionConstant, -500, 300)
    roughness.set_editor_property("r", 1.0)
    MEL.connect_material_property(roughness, "", unreal.MaterialProperty.MP_ROUGHNESS)

    MEL.recompile_material(material)
    unreal.EditorAssetLibrary.save_loaded_asset(material, False)
    return material


def main():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous([SKINS, MATERIAL_PATH], True)

    material = make_material()
    tools = unreal.AssetToolsHelpers.get_asset_tools()

    made, updated = 0, 0
    for path in unreal.EditorAssetLibrary.list_assets(SKINS, recursive=False, include_folder=False):
        texture = unreal.EditorAssetLibrary.load_asset(path)
        if not isinstance(texture, unreal.Texture2D) or not texture.get_name().startswith("T_GearSkin_"):
            continue
        name = "MI_GearSkin_" + texture.get_name()[len("T_GearSkin_"):]
        instance_path = INSTANCES + "/" + name
        if unreal.EditorAssetLibrary.does_asset_exist(instance_path):
            instance = unreal.EditorAssetLibrary.load_asset(instance_path)
            updated += 1
        else:
            instance = tools.create_asset(name, INSTANCES, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
            made += 1
        MEL.set_material_instance_parent(instance, material)
        MEL.set_material_instance_texture_parameter_value(instance, "Texture", texture)
        unreal.EditorAssetLibrary.save_loaded_asset(instance, False)

    unreal.log_warning("GearSkins: %s built; %d instances made, %d updated" % (MATERIAL_NAME, made, updated))


main()
