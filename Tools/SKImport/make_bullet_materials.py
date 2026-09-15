# Unreal Editor Python script. Run it headless:
#
#   UnrealEditor-Cmd.exe Clockworks.uproject -run=pythonscript
#       -script="D:/Dev/Clockworks/Tools/SKImport/make_bullet_materials.py"
#
# Builds the two materials a weapon's bullet look paints with, and points the knight's bolt at them:
#
#   M_BulletCore  unlit, solid: Color x Brightness. The bright centre of a bullet.
#   M_BulletGlow  unlit, additive: Color x Color.A x Brightness, fading out towards the rim of the
#                 sphere, so an engine sphere reads as a soft ball of light rather than a hard ball.
#                 The glare around a bullet and the streak behind it.
#
# The original's bullets are particle systems; these two are what lets AClockworksProjectile stand
# in for them with plain spheres. Both expose a vector "Color" and a scalar "Brightness", the names
# AClockworksProjectile sets.
#
# Then BP_PistolBolt gets CoreMaterial, GlowMaterial and SparkClass (BP_HitSpark, for the muzzle flash
# and the impact), and BP_GA_SwordAttack gets BP_PistolBolt as the bullet the throwing swords fire.
#
# Re-runnable: existing materials are rebuilt in place.

import unreal

MATERIALS = "/Game/TopDown/Materials"
BLUEPRINTS = "/Game/TopDown/Blueprints"

MEL = unreal.MaterialEditingLibrary


def get_or_create(name):
    path = MATERIALS + "/" + name
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        material = unreal.EditorAssetLibrary.load_asset(path)
        MEL.delete_all_material_expressions(material)
        return material
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    return tools.create_asset(name, MATERIALS, unreal.Material, unreal.MaterialFactoryNew())


def colour_times_brightness(material):
    colour = MEL.create_material_expression(material, unreal.MaterialExpressionVectorParameter, -700, 0)
    colour.set_editor_property("parameter_name", "Color")
    colour.set_editor_property("default_value", unreal.LinearColor(1.0, 1.0, 1.0, 1.0))
    brightness = MEL.create_material_expression(material, unreal.MaterialExpressionScalarParameter, -700, 250)
    brightness.set_editor_property("parameter_name", "Brightness")
    brightness.set_editor_property("default_value", 4.0)
    lit = MEL.create_material_expression(material, unreal.MaterialExpressionMultiply, -450, 0)
    MEL.connect_material_expressions(colour, "", lit, "A")
    MEL.connect_material_expressions(brightness, "", lit, "B")
    return colour, lit


def build_core():
    material = get_or_create("M_BulletCore")
    material.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    material.set_editor_property("blend_mode", unreal.BlendMode.BLEND_OPAQUE)
    _, lit = colour_times_brightness(material)
    MEL.connect_material_property(lit, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    MEL.recompile_material(material)
    unreal.EditorAssetLibrary.save_loaded_asset(material, False)
    return material


def build_glow():
    material = get_or_create("M_BulletGlow")
    material.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    material.set_editor_property("blend_mode", unreal.BlendMode.BLEND_ADDITIVE)
    colour, lit = colour_times_brightness(material)

    # The particle's own alpha scales how much light it adds: a glare at 0.25 is a faint halo.
    faded = MEL.create_material_expression(material, unreal.MaterialExpressionMultiply, -250, 0)
    MEL.connect_material_expressions(lit, "", faded, "A")
    MEL.connect_material_expressions(colour, "A", faded, "B")

    # Brightest where the sphere faces the camera, nothing at its silhouette: a soft ball of light.
    fresnel = MEL.create_material_expression(material, unreal.MaterialExpressionFresnel, -500, 400)
    fresnel.set_editor_property("exponent", 1.5)
    centre = MEL.create_material_expression(material, unreal.MaterialExpressionOneMinus, -300, 400)
    MEL.connect_material_expressions(fresnel, "", centre, "")
    soft = MEL.create_material_expression(material, unreal.MaterialExpressionMultiply, -100, 100)
    MEL.connect_material_expressions(faded, "", soft, "A")
    MEL.connect_material_expressions(centre, "", soft, "B")

    MEL.connect_material_property(soft, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    MEL.recompile_material(material)
    unreal.EditorAssetLibrary.save_loaded_asset(material, False)
    return material


def main():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous([MATERIALS, BLUEPRINTS], True)

    core = build_core()
    glow = build_glow()

    bolt = unreal.EditorAssetLibrary.load_asset(BLUEPRINTS + "/BP_PistolBolt")
    spark = unreal.EditorAssetLibrary.load_asset(BLUEPRINTS + "/BP_HitSpark")
    if bolt:
        cdo = unreal.get_default_object(bolt.generated_class())
        cdo.set_editor_property("core_material", core)
        cdo.set_editor_property("glow_material", glow)
        if spark:
            cdo.set_editor_property("spark_class", spark.generated_class())
        unreal.EditorAssetLibrary.save_loaded_asset(bolt, False)
    else:
        unreal.log_warning("Clockworks: BP_PistolBolt not found; bullet looks will not be coloured")

    sword = unreal.EditorAssetLibrary.load_asset(BLUEPRINTS + "/BP_GA_SwordAttack")
    bomb = unreal.EditorAssetLibrary.load_asset(BLUEPRINTS + "/BP_Bomb")
    if sword and bolt:
        sword_cdo = unreal.get_default_object(sword.generated_class())
        sword_cdo.set_editor_property("projectile_class", bolt.generated_class())
        # A charged slam's aftershock and a combo sword's ghost swings are bare blasts of the bomb.
        if bomb:
            sword_cdo.set_editor_property("blast_class", bomb.generated_class())
        unreal.EditorAssetLibrary.save_loaded_asset(sword, False)
    if bomb and bolt:
        # A shard bomb's shards, a vaporizer's cloud and a vortex's implosion are bullets the blast leaves.
        bomb_cdo = unreal.get_default_object(bomb.generated_class())
        bomb_cdo.set_editor_property("child_bullet_class", bolt.generated_class())
        unreal.EditorAssetLibrary.save_loaded_asset(bomb, False)

    unreal.log_warning("Clockworks: bullet materials built ({0}, {1}); BP_PistolBolt and BP_GA_SwordAttack pointed at them".format(
        core.get_path_name(), glow.get_path_name()))


main()
