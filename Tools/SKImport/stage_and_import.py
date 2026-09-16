"""Stage exported Spiral Knights glTF files under readable names and build the
ImportAssets commandlet config for Unreal.

Pipeline (see Docs/SpiralKnightsAssetPipeline.md):
  rsrc/*.dat  --SKExport.exe-->  D:/Dev/SKAssets/<rsrc path>.glb
              --this script-->   D:/Dev/SKAssets/_staging/<Category>/<Name>.glb + import.json
              --UnrealEditor-Cmd -run=ImportAssets-->  Content/SK/<Category>/<Name>/...

Everything under Content/SK/ is git-ignored: these are Grey Havens / SEGA assets used
as local reference and placeholders only.

Usage:
  python Tools/SKImport/stage_and_import.py            # stage + write import.json
  python Tools/SKImport/stage_and_import.py --import   # ...and run the commandlet
  python Tools/SKImport/stage_and_import.py --import --groups Gear,Monsters   # only these categories
  python Tools/SKImport/stage_and_import.py --import --names Devilite,RoyalPolyp   # only these asset names
  python Tools/SKImport/stage_and_import.py --import --groups World/Floors --floors Mission_Lobby__scenesmain__351
"""
import json
import os
import re
import shutil
import subprocess
import sys

import floor_model_names

SK_ASSETS = r"D:\Dev\SKAssets"
STAGING = os.path.join(SK_ASSETS, "_staging")
UE_CMD = r"C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
PROJECT = r"D:\Dev\Clockworks\Clockworks.uproject"
IMPORT_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "import.json")

# (exported glb relative to SK_ASSETS, content folder under /Game/SK, asset name)
MODELS = [
    # Monsters: skinned + animated (ArticulatedConfig)
    (r"character\npc\monster\wolver\model.glb",            "Monsters", "Wolver"),
    (r"character\npc\monster\jellycube\model.glb",         "Monsters", "Jellycube"),
    (r"character\npc\monster\lichen\model.glb",            "Monsters", "Lichen"),
    (r"character\npc\monster\gunpuppy\model.glb",          "Monsters", "Gunpuppy"),
    (r"character\npc\monster\zombie\model.glb",            "Monsters", "Zombie"),
    # Re-exported with the knight's sword clips mapped in (its own config only lists idle/run/hurt).
    (r"_fixed\Mechaknight.glb",                            "Monsters", "Mechaknight"),
    # Its head (mesh_helmet + mesh_icon) exports as orphan nodes; extract_rigid_nodes.py re-bases
    # them into bone_helmet space so BP_Mechaknight's HeadMesh attaches with an identity offset.
    (r"_fixed\MechaknightHead.glb",                        "Monsters", "MechaknightHead"),
    (r"character\npc\monster\spookat\model.glb",           "Monsters", "Spookat"),
    # Re-exported 2026-09-15 with the clips the bosses' moves need (D:\Dev\SKAssets\_exports_2026_09_15\exports.md):
    # same mesh names and skeletons as the first exports, so a re-import only adds clips.
    (r"_exports_2026_09_15\Snarbolax\Snarbolax.glb",       "Monsters", "Snarbolax"),
    (r"_exports_2026_09_15\RoyalJelly\RoyalJelly.glb",     "Monsters", "RoyalJelly"),
    (r"_exports_2026_09_15\RoyalMini\RoyalMini.glb",       "Monsters", "RoyalMini"),
    (r"_exports_2026_09_15\RoyalPolyp\RoyalPolyp.glb",     "Monsters", "RoyalPolyp"),
    (r"character\npc\monster\gremlin\artillery\model.glb", "Monsters", "GremlinArtillery"),
    # The plain Devilite (user's decision 2026-09-15: match the plain originals), no longer the Firebrander.
    (r"_exports_2026_09_15\Devilite\Devilite.glb",         "Monsters", "Devilite"),
    (r"_exports_2026_09_15\Chromalisk\Chromalisk.glb",     "Monsters", "Chromalisk"),
    (r"character\npc\monster\trainingbag\model.glb",       "Monsters", "TrainingBag"),
    (r"character\npc\monster\trainingtarget\model.glb",    "Monsters", "TrainingTarget"),
    # Knights
    (r"character\npc\crew\model.glb",                      "Knights",  "CrewKnight"),
    # Rigged knight: character/pc/model.dat re-typed from ProjectXModelConfig to ArticulatedConfig
    # (see Docs/SpiralKnightsAssetPipeline.md), wearing the cap helm and coat armour.
    (r"_fixed\PlayerKnight.glb",                           "Knights",  "PlayerKnight"),
    # Helmet and face as separate static meshes in bone_helmet space (extract_rigid_nodes.py);
    # Interchange bakes the bone's rest position into the pieces inside PlayerKnight.glb, so those
    # float a head-height too high when attached to the bone.
    (r"_fixed\PlayerKnightHelmet.glb",                     "Knights",  "PlayerKnightHelmet"),
    (r"_fixed\PlayerKnightFace.glb",                       "Knights",  "PlayerKnightFace"),
    # Weapons and gear (static)
    (r"item\weapon\sword\calibur\model.glb",               "Weapons",  "Calibur"),
    (r"item\weapon\handgun\proto\model.glb",              "Weapons",  "ProtoGun"),
    (r"item\weapon\bomb\proto\model.glb",                 "Weapons",  "ProtoBomb"),
    # The wider catalogue: one weapon from each Spiral Knights line, so every class covers every
    # damage type. Names here are the line's, not the particular tier's model file.
    (r"item\weapon\sword\flourish\model_flourish-r2.glb", "Weapons",  "Flourish"),
    (r"item\weapon\sword\troika\model.glb",               "Weapons",  "Troika"),
    (r"item\weapon\sword\spur\model.glb",                 "Weapons",  "Spur"),
    (r"item\weapon\sword\saber\model.glb",                "Weapons",  "Brandish"),
    (r"item\weapon\sword\cutter\model.glb",               "Weapons",  "Cutter"),
    (r"item\weapon\handgun\autogun\model.glb",            "Weapons",  "Autogun"),
    (r"item\weapon\handgun\needler\model.glb",            "Weapons",  "NeedleShot"),
    (r"item\weapon\handgun\firotech\model.glb",           "Weapons",  "Alchemer"),
    (r"item\weapon\handgun\pulsar\model_puls-nrm-r2.glb", "Weapons",  "Pulsar"),
    (r"item\weapon\bomb\blast\model.glb",                 "Weapons",  "BlastBomb"),
    (r"item\weapon\bomb\shard\model.glb",                 "Weapons",  "ShardBomb"),
    (r"item\weapon\bomb\chemical\model.glb",              "Weapons",  "HazeBomb"),
    (r"item\gear\helm\cap\model.glb",                      "Gear",     "HelmCap"),
    (r"item\gear\shield\buckler\model.glb",                "Gear",     "ShieldBuckler"),
    # Knight body armour exports unrigged (its skeleton is an external reference TRS does not follow)
    (r"item\gear\armor\coat\model.glb",                    "Gear",     "ArmorCoat"),
    # Clockworks tileset and props
    (r"world\tileset\clockworks\floor\floor_base.glb",     "World/Clockworks", "CW_FloorBase"),
    (r"world\tileset\clockworks\wall\wall.glb",            "World/Clockworks", "CW_Wall"),
    (r"world\tileset\clockworks\wall\roof_gear_6x2.glb",   "World/Clockworks", "CW_RoofGear6x2"),
    (r"world\tileset\clockworks\fence\fence_high.glb",     "World/Clockworks", "CW_FenceHigh"),
    (r"world\tileset\clockworks\fence\fence_low.glb",      "World/Clockworks", "CW_FenceLow"),
    (r"world\tileset\clockworks\edge_rail\rail.glb",       "World/Clockworks", "CW_EdgeRail"),
    (r"world\prop\clockworks\factory\control_console.glb", "World/Clockworks", "CW_ControlConsole"),
    (r"world\prop\clockworks\factory\conveyor_x2_01.glb",  "World/Clockworks", "CW_Conveyor2"),
    (r"world\prop\clockworks\lamp_rail01.glb",             "World/Clockworks", "CW_LampRail"),
    (r"world\prop\generic\altar_x3.glb",                   "World/Props",      "AltarX3"),
    # The Snarbolax's beast bell, rebuilt as a skinned prop with its clips (build_beastbell.py, 2026-09-15).
    (r"_exports_2026_09_15\BeastBell\BeastBell.glb",       "World/Props", "BeastBell"),
    (r"world\prop\generic\bones.glb",                      "World/Props",      "Bones"),
]

# Plain image files copied straight into staging (no glTF fix-up): toolbar icons from the game's UI.
# (absolute source file, content folder under /Game/SK, asset name)
SK_RSRC = r"C:\Program Files (x86)\Steam\steamapps\common\Spiral Knights\rsrc"
TEXTURES = [
    (SK_RSRC + r"\ui\icon\inventory\weapon\sword\calibur.png",       "Icons", "T_Icon_Calibur"),
    (SK_RSRC + r"\ui\icon\inventory\weapon\handgun\proto_gun.png",   "Icons", "T_Icon_ProtoGun"),
    (SK_RSRC + r"\ui\icon\inventory\gear\shield\proto_shield.png",   "Icons", "T_Icon_ProtoShield"),
    (SK_RSRC + r"\ui\icon\inventory\weapon\bomb\proto_bomb.png",     "Icons", "T_Icon_ProtoBomb"),
    (SK_RSRC + r"\ui\icon\inventory\weapon\sword\flourish.png",      "Icons", "T_Icon_Flourish"),
    (SK_RSRC + r"\ui\icon\inventory\weapon\sword\troika.png",        "Icons", "T_Icon_Troika"),
    (SK_RSRC + r"\ui\icon\inventory\weapon\sword\spur.png",          "Icons", "T_Icon_Spur"),
    (SK_RSRC + r"\ui\icon\inventory\weapon\sword\combuster.png",     "Icons", "T_Icon_Brandish"),
    (SK_RSRC + r"\ui\icon\inventory\weapon\sword\cutter.png",        "Icons", "T_Icon_Cutter"),
    (SK_RSRC + r"\ui\icon\inventory\weapon\handgun\autogun.png",     "Icons", "T_Icon_Autogun"),
    (SK_RSRC + r"\ui\icon\inventory\weapon\handgun\needle_shot.png", "Icons", "T_Icon_NeedleShot"),
    (SK_RSRC + r"\ui\icon\inventory\weapon\handgun\firotech_alchemer.png", "Icons", "T_Icon_Alchemer"),
    (SK_RSRC + r"\ui\icon\inventory\weapon\handgun\pulsar.png",      "Icons", "T_Icon_Pulsar"),
    (SK_RSRC + r"\ui\icon\inventory\weapon\bomb\blast_bomb.png",     "Icons", "T_Icon_BlastBomb"),
    (SK_RSRC + r"\ui\icon\inventory\weapon\bomb\shard_bomb.png",     "Icons", "T_Icon_ShardBomb"),
    (SK_RSRC + r"\ui\icon\inventory\weapon\bomb\haze_bomb.png",      "Icons", "T_Icon_HazeBomb"),
] + [
    # The in-game HUD, from the game's second-generation HUD art (rsrc/ui/hud_v2) plus the minimap
    # markers and status icons it draws on top. Read by UClockworksPlayerHUD and its siblings.
    (SK_RSRC + "\\ui\\" + rel.replace("/", "\\") + ".png", "HUD", "T_HUD_" + name)
    for rel, name in [
        ("hud_v2/images/health/default/full",      "PipFull"),
        ("hud_v2/images/health/default/half",      "PipHalf"),
        ("hud_v2/images/health/default/empty",     "PipEmpty"),
        ("hud_v2/images/health/damage/full",       "PipDamageFull"),
        ("hud_v2/images/health/damage/half",       "PipDamageHalf"),
        ("hud_v2/images/health/heal/full",         "PipHealFull"),
        ("hud_v2/images/health/heal/half",         "PipHealHalf"),
        ("hud_v2/images/health/full-slv",          "PipSilverFull"),
        ("hud_v2/images/health/full-slv-half",     "PipSilverHalf"),
        ("hud_v2/images/health/full-gld",          "PipGoldFull"),
        ("hud_v2/images/health/full-gld-half",     "PipGoldHalf"),
        ("hud_v2/images/health/empty-slv",         "PipSilverEmpty"),
        ("hud_v2/images/health/heart",             "Heart"),
        ("hud_v2/images/health/heart-slv",         "HeartSilver"),
        ("hud_v2/images/health/heart-gld",         "HeartGold"),
        ("hud_v2/images/health/heart_backing",     "HeartBacking"),
        ("hud_v2/images/health/shield",            "Shield"),
        ("hud_v2/images/health/shield_disabled",   "ShieldDisabled"),
        ("hud_v2/images/health/bar-full",          "BarFull"),
        ("hud_v2/images/health/bar-empty",         "BarEmpty"),
        ("hud_v2/images/portrait/portrait_backing", "PortraitBacking"),
        ("hud_v2/images/portrait/portrait_ring",   "PortraitRing"),
        ("hud_v2/images/portrait/portrait_gloss",  "PortraitGloss"),
        ("hud_v2/images/portrait/mask",            "PortraitMask"),
        ("hud_v2/images/minimap/minimap_backing",  "MinimapBacking"),
        ("hud_v2/images/minimap/minimap_ring",     "MinimapRing"),
        ("hud_v2/images/minimap/minimap_gloss",    "MinimapGloss"),
        ("hud_v2/images/minimap/minimap_hashmarks", "MinimapHashmarks"),
        ("hud_v2/images/minimap/mask",             "MinimapMask"),
        ("minimap/player_local",                   "MinimapPlayer"),
        ("minimap/monster",                        "MinimapMonster"),
        ("minimap/elevator",                       "MinimapElevator"),
        ("hud_v2/images/quickbar/quickbar_backing", "SlotBacking"),
        ("hud_v2/images/quickbar/quickbar_up",     "SlotUp"),
        ("hud_v2/images/quickbar/quickbar_empty",  "SlotEmpty"),
        ("hud_v2/images/quickbar/quickbar_gloss",  "SlotGloss"),
        ("hud_v2/images/quickbar/quickbar_hotkey", "SlotHotkey"),
        ("hud_v2/images/quickbar/vitapod/quickbar_empty", "SlotVitapodEmpty"),
        ("hud_v2/images/corner_ul",                "CornerUL"),
        ("hud_v2/images/corner_ur",                "CornerUR"),
        ("hud_v2/images/icons/system/equipment",   "SysEquipment"),
        ("hud_v2/images/icons/system/loadout",     "SysLoadout"),
        ("hud_v2/images/icons/system/forge",       "SysForge"),
        ("hud_v2/images/icons/system/arsenal",     "SysArsenal"),
        ("hud_v2/images/icons/system/settings",    "SysSettings"),
        ("hud_v2/images/icons/system/help",        "SysHelp"),
        ("hud_v2/images/icons/system/social",      "SysSocial"),
        ("hud_v2/images/icons/system/feed",        "SysFeed"),
        ("hud_v2/images/icons/system/notice",      "SysNotice"),
        ("hud_v2/images/icons/system/missions",    "SysMissions"),
        ("icon/debuff/backing",                    "StatusBacking"),
        ("icon/debuff/fire",                       "StatusFire"),
        ("icon/debuff/freeze",                     "StatusFreeze"),
        ("icon/debuff/shock",                      "StatusShock"),
        ("icon/debuff/poison",                     "StatusPoison"),
        ("icon/debuff/stun",                       "StatusStun"),
        ("icon/debuff/curse",                      "StatusCurse"),
        ("icon/debuff/sleep",                      "StatusSleep"),
        ("hud_v2/images/icons/system/mail",        "SysMail"),
        ("hud_v2/images/icons/system/goto",        "SysGoto"),
        ("hud_v2/images/icons/system/supplydepot", "SysSupplyDepot"),
        ("hud_v2/images/heat/heat_backing",        "HeatBacking"),
        ("hud_v2/images/heat/heat_mask",           "HeatMask"),
        ("hud_v2/images/collapse/tab/left/up",     "CollapseTabLeft"),
        ("hud_v2/images/collapse/tab/right/up",    "CollapseTabRight"),
        ("hud_v2/images/minimap/zoom/up",          "MinimapZoom"),
        ("hud_v2/images/minimap/lock/up",          "MinimapLock"),
        ("status/images/def_def",                  "DamageNormal"),
        ("status/images/def_pie",                  "DamagePiercing"),
        ("status/images/def_ele",                  "DamageElemental"),
        ("status/images/def_sha",                  "DamageShadow"),
        # The portrait's bust. The knight wears the cap helm; this is the closest icon the game has.
        ("icon/inventory/gear/helm/wolver_cap",    "PortraitHelm"),
    ]
]

# Ogg files copied straight out of the game, same terms as the models: Grey Havens / SEGA property,
# git-ignored, local placeholders only. Import produces SoundWave assets under Content/SK/Audio.
# (path relative to the rsrc sound folder, content folder under /Game/SK, asset name)
SOUNDS = [
    # Sword: a whoosh per combo step, an impact per step, and the charge pair.
    (r"effect\weapon\sword_swing_01.ogg",                   "Audio", "S_SwordSwing1"),
    (r"effect\weapon\sword_swing_02.ogg",                   "Audio", "S_SwordSwing2"),
    (r"effect\weapon\sword_swing_03.ogg",                   "Audio", "S_SwordSwing3"),
    (r"effect\weapon\sword_01.ogg",                         "Audio", "S_SwordHit1"),
    (r"effect\weapon\sword_02.ogg",                         "Audio", "S_SwordHit2"),
    (r"effect\weapon\sword_03.ogg",                         "Audio", "S_SwordHit3"),
    (r"effect\weapon\sword_swing_c01.ogg",                  "Audio", "S_SwordChargeSwing"),
    (r"effect\weapon\sword_c01.ogg",                        "Audio", "S_SwordChargeHit"),
    # The charge cue the player listens for, and the loop underneath it.
    (r"effect\weapon\charge_complete_01.ogg",               "Audio", "S_ChargeReady"),
    (r"effect\weapon\charging_3second_mono_01.ogg",         "Audio", "S_ChargeLoop"),
    # Handgun.
    (r"effect\weapon\handgun_01.ogg",                       "Audio", "S_PistolShot"),
    (r"effect\weapon\handgun_c02.ogg",                      "Audio", "S_PistolChargeShot"),
    (r"effect\weapon\handgun_reload.ogg",                   "Audio", "S_PistolReload"),
    # The knight.
    (r"effect\player\player_damage.ogg",                    "Audio", "S_PlayerHurt"),
    (r"effect\player\player_death.ogg",                     "Audio", "S_PlayerDeath"),
    (r"effect\player\player_footstep_01.ogg",               "Audio", "S_Footstep1"),
    (r"effect\player\player_footstep_02.ogg",               "Audio", "S_Footstep2"),
    # Shield and shield bash.
    (r"effect\player\shield_activate_05.ogg",               "Audio", "S_ShieldRaise"),
    (r"effect\player\shield_deactivate_02.ogg",             "Audio", "S_ShieldLower"),
    (r"effect\pvp\classmod\guardian_shield_break.ogg",      "Audio", "S_ShieldBreak"),
    (r"effect\pvp\classmod\guardian_shield.ogg",            "Audio", "S_ShieldBlock"),
    (r"effect\player\shieldbash\player_shieldbash_woosh_02.ogg",  "Audio", "S_ShieldBashWoosh"),
    (r"effect\player\shieldbash\player_shieldbash_start_02.ogg",  "Audio", "S_ShieldBashStart"),
    (r"effect\player\shieldbash\player_shieldbash_hit_medium.ogg", "Audio", "S_ShieldBashHit"),
    # Monsters.
    (r"effect\monster\wolver_bite.ogg",                     "Audio", "S_WolverBite"),
    (r"effect\monster\wolver_alpha_bark.ogg",               "Audio", "S_WolverBark"),
    (r"effect\monster\wolver_death.ogg",                    "Audio", "S_WolverDeath"),
    (r"effect\monster\gun_puppy_fire.ogg",                  "Audio", "S_GunpuppyFire"),
    (r"effect\monster\gun_puppy_death.ogg",                 "Audio", "S_GunpuppyDeath"),
    # The Mechaknight: its sword telegraph, the engine hum, and a construct death.
    (r"effect\monster\mechaknight\mechaknight_attackcue_05.ogg", "Audio", "S_MechaknightCue"),
    (r"effect\monster\mechaknight\mechaknight_engine_loop2.ogg", "Audio", "S_MechaknightEngine"),
    (r"effect\monster\gremlin_death_01.ogg",                "Audio", "S_MechaknightDeath"),
    # Menus and the toolbar.
    (r"feedback\button_press.ogg",                          "Audio", "S_UIClick"),
    (r"feedback\ui_confirm.ogg",                            "Audio", "S_UIConfirm"),
    (r"feedback\ui_dismiss.ogg",                            "Audio", "S_UIBack"),
    (r"feedback\ui_equip.ogg",                              "Audio", "S_UIEquip"),
    # Music: the Clockworks loops for play, Haven for a menu, fanfares for the end of a floor.
    (r"music\clockwork_ambient.ogg",                        "Audio", "M_ClockworkAmbient"),
    (r"music\clockwork_action.ogg",                         "Audio", "M_ClockworkAction"),
    (r"music\haven.ogg",                                    "Audio", "M_Haven"),
    (r"music\fanfare_victory_1.ogg",                        "Audio", "M_FanfareVictory"),
    (r"music\fanfare_elevator_1.ogg",                       "Audio", "M_FanfareElevator"),
    # Bombs: the drop, the blast, the dud when you let go too early.
    (r"effect\weapon\bomb_drop_01.ogg",                     "Audio", "S_BombDrop"),
    (r"effect\weapon\bomb_01.ogg",                          "Audio", "S_BombBlast"),
    (r"effect\weapon\bomb_dud_07b.ogg",                     "Audio", "S_BombDud"),

    # ---- one aggro / attack / hurt / death set per imported monster ----
    # Jellycube.
    (r"effect\monster\jelly\jelly_lunge_02.ogg",            "Audio", "S_JellyAttack"),
    (r"effect\monster\jelly\jelly_movement_new_04.ogg",     "Audio", "S_JellyMove"),
    (r"effect\monster\jelly\jelly_little_death_02.ogg",     "Audio", "S_JellyDeath"),
    (r"effect\monster\jelly\jelly_big_spawn_02.ogg",        "Audio", "S_JellyAggro"),
    (r"effect\monster\jelly_death_big.ogg",                 "Audio", "S_RoyalJellyDeath"),
    (r"effect\monster\jelly\jelly_royal_dying_01.ogg",      "Audio", "S_RoyalJellyAggro"),
    # Zombie.
    (r"effect\monster\zombie\zombie_claw_01.ogg",           "Audio", "S_ZombieAttack"),
    (r"effect\monster\zombie\zombie_moan_01.ogg",           "Audio", "S_ZombieAggro"),
    (r"effect\monster\zombie\zombie_moan_03.ogg",           "Audio", "S_ZombieHurt"),
    (r"effect\monster\zombie\zombie_spawn_01.ogg",          "Audio", "S_ZombieSpawn"),
    # Spookat.
    (r"effect\monster\spookat\spookat_attackcue_01.ogg",    "Audio", "S_SpookatAggro"),
    (r"effect\monster\spookat_chomp.ogg",                   "Audio", "S_SpookatAttack"),
    (r"effect\monster\spookat_meow.ogg",                    "Audio", "S_SpookatHurt"),
    (r"effect\monster\spookat_death.ogg",                   "Audio", "S_SpookatDeath"),
    # Chromalisk.
    (r"effect\monster\chromalisk_idle.ogg",                 "Audio", "S_ChromaliskAggro"),
    (r"effect\monster\chromalisk_spit.ogg",                 "Audio", "S_ChromaliskAttack"),
    (r"effect\monster\chromalisk_gulp.ogg",                 "Audio", "S_ChromaliskHurt"),
    (r"effect\monster\chromalisk_death.ogg",                "Audio", "S_ChromaliskDeath"),
    # Devilite.
    (r"effect\monster\devilite\devilite_surprise.ogg",      "Audio", "S_DeviliteAggro"),
    (r"effect\monster\devilite\devilite_leap.ogg",          "Audio", "S_DeviliteAttack"),
    (r"effect\monster\devilite\devilite_hurt.ogg",          "Audio", "S_DeviliteHurt"),
    (r"effect\monster\devilite\devilite_death.ogg",         "Audio", "S_DeviliteDeath"),
    # Gremlin (the artillery gremlin).
    (r"effect\monster\gremlin\gremlin_attackgrowl_01.ogg",  "Audio", "S_GremlinAggro"),
    (r"effect\monster\gremlin_thwack.ogg",                  "Audio", "S_GremlinAttack"),
    (r"effect\monster\gremlin\gremlin_chat_cry.ogg",        "Audio", "S_GremlinHurt"),
    (r"effect\monster\gremlin_death_01.ogg",                "Audio", "S_GremlinDeath"),
    # Snarbolax, the boss.
    # The beast bell's strike, which lives with the world's dynamic objects rather than with the Snarbolax. The game
    # ships no separate sound for hitting it on cooldown; the bell falls back to a monster hurt sound for that.
    (r"effect\world\dynamic\snarby_bell_strike.ogg",         "Audio", "S_BeastBellRing"),
    (r"effect\monster\snarbolax\snarby_howl.ogg",           "Audio", "S_SnarbolaxAggro"),
    (r"effect\monster\snarbolax\snarby_bite_01.ogg",        "Audio", "S_SnarbolaxAttack"),
    (r"effect\monster\snarbolax\snarby_rush.ogg",           "Audio", "S_SnarbolaxRush"),
    (r"effect\monster\snarbolax\snarby_yipe_01.ogg",        "Audio", "S_SnarbolaxHurt"),
    (r"effect\monster\snarbolax\snarby_death_alt.ogg",      "Audio", "S_SnarbolaxDeath"),
    # Lichen has no sounds of its own in the install; the generic monster set stands in.
    (r"effect\monster\monster_damage.ogg",                  "Audio", "S_MonsterHurt"),
    (r"effect\monster\monster_death_cloud.ogg",             "Audio", "S_MonsterDeath"),
    (r"effect\monster\monster_spawn_01.ogg",                "Audio", "S_MonsterSpawn"),
    # More of the existing three, so each has a full set.
    (r"effect\monster\wolver_dash.ogg",                     "Audio", "S_WolverDash"),
    (r"effect\monster\wolver_spawn.ogg",                    "Audio", "S_WolverSpawn"),
    (r"effect\monster\gun_puppy_turn_01.ogg",               "Audio", "S_GunpuppyTurn"),

    # ---- the seven statuses: the moment one lands, and the pulse while it runs ----
    (r"effect\status\status_fire_activate.ogg",             "Audio", "S_StatusFire"),
    (r"effect\status\status_fire_pulse.ogg",                "Audio", "S_StatusFirePulse"),
    (r"effect\status\status_freeze_activate.ogg",           "Audio", "S_StatusFreeze"),
    (r"effect\status\status_shock.ogg",                     "Audio", "S_StatusShock"),
    (r"effect\status\status_shock_pulse_02.ogg",            "Audio", "S_StatusShockPulse"),
    (r"effect\status\status_poison.ogg",                    "Audio", "S_StatusPoison"),
    (r"effect\status\status_stun.ogg",                      "Audio", "S_StatusStun"),
    (r"effect\status\status_curse.ogg",                     "Audio", "S_StatusCurse"),
    (r"effect\status\status_sleep.ogg",                     "Audio", "S_StatusSleep"),
    (r"effect\status\status_alert.ogg",                     "Audio", "S_StatusAlert"),
]


def dedupe_animation_names(js):
    """Give every clip in a glb its own name. The game's sequence mappings export one name for all their parts
    (the Snarbolax's spin is a 0.8 s start, a 2 s loop and a 0.33 s end, all called "spin"), and Interchange then
    renames only some of the clashes, so a part can overwrite another from one import to the next. Parts are
    numbered in file order (spin, spin1, spin2), skipping a name another clip already uses. A later clip identical
    to an earlier one of its name (the Royal Jelly lists every clip once per skin copy) is dropped instead."""
    animations = js["animations"]
    taken = {a.get("name") for a in animations}

    def signature(animation):
        seconds = max((js["accessors"][s["input"]].get("max", [0.0])[0] for s in animation.get("samplers", [])), default=0.0)
        nodes = tuple(sorted(c["target"].get("node", -1) for c in animation.get("channels", [])))
        return len(animation.get("channels", [])), round(seconds, 4), nodes

    kept, seen = [], {}
    for animation in animations:
        name = animation.get("name") or "clip"
        if name not in seen:
            seen[name] = [signature(animation)]
            kept.append(animation)
            continue
        if signature(animation) in seen[name]:
            continue
        seen[name].append(signature(animation))
        index = len(seen[name]) - 1
        new_name = name + str(index)
        while new_name in taken:
            index += 1
            new_name = name + str(index)
        taken.add(new_name)
        animation["name"] = new_name
        kept.append(animation)
    js["animations"] = kept


def fix_glb(src, dst, static_only=False, zero_mesh_offsets=False):
    """Copy a ThreeRingsSharp .glb, dropping scene-root entries for nodes that also have a
    parent. ThreeRingsSharp lists skeleton bones both under their parent and as scene roots,
    which is invalid glTF; Unreal then re-roots those bones and the skin explodes.

    static_only also strips the skin and the animations, so a rigged weapon model (the Pollinator,
    the Diskgun, the Electron and Graviton bombs) imports as a plain static mesh in its rest pose.
    A weapon definition holds static meshes; imported rigged, those weapons had no body at all."""
    import struct
    data = open(src, "rb").read()
    json_len = struct.unpack("<I", data[12:16])[0]
    js = json.loads(data[20:20 + json_len])
    rest = data[20 + json_len:]  # BIN chunk, already 4-byte aligned by the patched exporter
    parented = {c for n in js.get("nodes", []) for c in n.get("children", [])}
    for scene in js.get("scenes", []):
        scene["nodes"] = [i for i in scene["nodes"] if i not in parented]
    if zero_mesh_offsets:
        # A helmet or shield exported on its own puts each "Mesh[n]" node at its own bounding-box centre
        # while the vertices are already where they belong, so the piece would float off its bone by that.
        for node in js.get("nodes", []):
            if "mesh" in node and "-Mesh[" in (node.get("name") or ""):
                node.pop("translation", None)
    if not static_only and js.get("animations"):
        dedupe_animation_names(js)
    if static_only:
        js.pop("skins", None)
        js.pop("animations", None)
        for node in js.get("nodes", []):
            node.pop("skin", None)
        for mesh in js.get("meshes", []):
            for primitive in mesh.get("primitives", []):
                attributes = primitive.get("attributes", {})
                for key in [k for k in attributes if k.startswith(("JOINTS_", "WEIGHTS_"))]:
                    del attributes[key]
    body = json.dumps(js, separators=(",", ":")).encode("utf-8")
    body += b" " * ((4 - len(body) % 4) % 4)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(body) + len(rest))
    out += struct.pack("<II", len(body), 0x4E4F534A) + body + rest
    open(dst, "wb").write(out)


def fix_armor_glb(src, dst):
    """fix_glb for knight armour exported through the knight (D:/Dev/SKAssets/_gear_export/armor), with one more
    repair. An armour built from parts (padded, ranger, doublebelt...) exports one mesh per part, each skinned to
    its own copy of the knight's 49 bones listed in a different order, and Interchange imports nothing from such a
    file. Every copy has the same bones with the same bind matrices, so the parts are merged into one mesh on the
    first skin, each part's joint indices remapped by bone name, and the other skeleton copies are detached. The
    knight's clips the export carries are dropped: armour plays the knight's animation through its skeleton."""
    import struct
    data = open(src, "rb").read()
    json_len = struct.unpack("<I", data[12:16])[0]
    js = json.loads(data[20:20 + json_len])
    bin_len = struct.unpack("<I", data[20 + json_len:24 + json_len])[0]
    blob = bytearray(data[28 + json_len:28 + json_len + bin_len])
    nodes = js.get("nodes", [])
    skins = js.get("skins", [])
    spare = set()
    dropped = []

    # ThreeRingsSharp writes a placeholder material per part ("dummymtl-" + the mesh's name) but never links it, so
    # the parts would import sharing one material slot. Link each primitive to its own mesh's material before merging.
    material_by_name = {m.get("name"): index for index, m in enumerate(js.get("materials", []))}
    for mesh in js.get("meshes", []):
        own = material_by_name.get("dummymtl-" + (mesh.get("name") or ""))
        for primitive in mesh.get("primitives", []):
            if "material" not in primitive and own is not None:
                primitive["material"] = own

    if len(skins) > 1:
        size = {5121: 1, 5123: 2, 5125: 4}
        fmt = {5121: "B", 5123: "H", 5125: "I"}
        names = [frozenset(nodes[j].get("name") for j in skin["joints"]) for skin in skins]
        # The base is the knight's own bone set: the one most parts share (a Stalker's scarf brings a small set
        # of its own bones, so neither the fewest nor the most bones is a safe rule), the larger on a tie.
        shared = {}
        for bone_set in names:
            shared[bone_set] = shared.get(bone_set, 0) + 1
        most = max(shared.values())
        base = names.index(max((s for s, c in shared.items() if c == most), key=len))
        first = {nodes[j].get("name"): k for k, j in enumerate(skins[base]["joints"])}
        mesh_nodes = [i for i, n in enumerate(nodes) if "mesh" in n and "skin" in n]
        # A part with bones the knight does not have (the Stalker's scarf) cannot share the knight's skeleton;
        # it is left out here and reported, to be imported as a piece of its own.
        for i in mesh_nodes:
            if not names[nodes[i]["skin"]] <= names[base]:
                dropped.append(nodes[i].get("name"))
                nodes[i].pop("mesh")
                nodes[i].pop("skin")
        mesh_nodes = [i for i in mesh_nodes if "mesh" in nodes[i]]
        keep = mesh_nodes[0]
        merged = js["meshes"][nodes[keep]["mesh"]]["primitives"]
        for i in mesh_nodes:
            node = nodes[i]
            if node["skin"] != base:
                remap = [first[nodes[j].get("name")] for j in skins[node["skin"]]["joints"]]
                for primitive in js["meshes"][node["mesh"]]["primitives"]:
                    # A primitive without weights has no joint indices to remap.
                    if "JOINTS_0" not in primitive["attributes"]:
                        continue
                    accessor = js["accessors"][primitive["attributes"]["JOINTS_0"]]
                    view = js["bufferViews"][accessor["bufferView"]]
                    kind = accessor["componentType"]
                    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
                    stride = view.get("byteStride", size[kind] * 4)
                    values = []
                    for v in range(accessor["count"]):
                        values.extend(remap[x] for x in struct.unpack_from("<4" + fmt[kind], blob, start + v * stride))
                    packed = struct.pack("<%d%s" % (len(values), fmt[kind]), *values)
                    while len(blob) % 4:
                        blob.append(0)
                    js["bufferViews"].append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(packed)})
                    blob.extend(packed)
                    remapped = dict(accessor, bufferView=len(js["bufferViews"]) - 1)
                    remapped.pop("byteOffset", None)
                    js["accessors"].append(remapped)
                    primitive["attributes"]["JOINTS_0"] = len(js["accessors"]) - 1
            if i != keep:
                merged.extend(js["meshes"][node["mesh"]]["primitives"])
                node.pop("mesh")
                node.pop("skin")
        nodes[keep]["skin"] = 0

        used = set(skins[base]["joints"]) | ({skins[base]["skeleton"]} if "skeleton" in skins[base] else set())
        for index, skin in enumerate(skins):
            if index == base:
                continue
            spare.update(skin["joints"])
            if "skeleton" in skin:
                spare.add(skin["skeleton"])
        spare -= used
        for node in nodes:
            if "children" in node:
                node["children"] = [c for c in node["children"] if c not in spare]
                if not node["children"]:
                    node.pop("children")
        js["skins"] = [skins[base]]

    js.pop("animations", None)
    parented = {c for n in nodes for c in n.get("children", [])}
    for scene in js.get("scenes", []):
        scene["nodes"] = [i for i in scene["nodes"] if i not in parented and i not in spare]

    # What merging left behind, and what ThreeRingsSharp writes for a part with no texture, is not valid glTF, and
    # Interchange drops such a file without a word: meshes no node uses any more, placeholder materials with
    # "pbrMetallicRoughness": null and an "alphaCutoff " key with a trailing space, and empty top-level arrays.
    used_meshes = sorted({n["mesh"] for n in nodes if "mesh" in n})
    if len(used_meshes) != len(js.get("meshes", [])):
        renumber = {old: new for new, old in enumerate(used_meshes)}
        js["meshes"] = [js["meshes"][old] for old in used_meshes]
        for node in nodes:
            if "mesh" in node:
                node["mesh"] = renumber[node["mesh"]]
    for material in js.get("materials", []):
        if material.get("pbrMetallicRoughness", {}) is None:
            material.pop("pbrMetallicRoughness")
        if "alphaCutoff " in material:
            material["alphaCutoff"] = material.pop("alphaCutoff ")
    for key in [k for k, v in js.items() if isinstance(v, list) and not v]:
        js.pop(key)

    while len(blob) % 4:
        blob.append(0)
    if js.get("buffers"):
        js["buffers"][0]["byteLength"] = len(blob)
    body = json.dumps(js, separators=(",", ":")).encode("utf-8")
    body += b" " * ((4 - len(body) % 4) % 4)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(body) + 8 + len(blob))
    out += struct.pack("<II", len(body), 0x4E4F534A) + body
    out += struct.pack("<II", len(blob), 0x004E4942) + bytes(blob)
    open(dst, "wb").write(out)
    return dropped


# ---------------------------------------------------------------------------------------------
# Knight gear (2026-09-15): helmets, shields, their icons and the gear screen's art.
#
# mine_gear.py writes gear.json; the models were exported to D:/Dev/SKAssets (see Docs/KnightChecklist.md).
# Helmet and shield models come in here as static meshes, their node offsets zeroed. Armour does not: it is
# skinned to the knight's skeleton, which the ImportAssets commandlet cannot name, so run_armor_imports.py
# brings it in one armour per headless run. Icons are the per-item PNGs bake_gear_icons.py writes.
# ---------------------------------------------------------------------------------------------

# ---------------------------------------------------------------------------------------------
# The floors themselves.
#
# D:\Dev\SKAssets\_floors holds one manifest per archived Spiral Knights scene: every tile and prop
# it places, the grid under them, and its markers. Between them they name 377 model files, which is
# far too many to list here and exactly the sort of list that is wrong within a week, so the models
# a floor needs are read out of the manifests instead. floor_model_names.model_asset decides where
# each lands, and generate_floor_assets.py reads the same rule when it points a floor at them.
# ---------------------------------------------------------------------------------------------

FLOORS_DIR = os.path.join(SK_ASSETS, "_floors")


def floor_entries(manifests=None):
    """(glb relative to SK_ASSETS, content category, asset name) for every model the floor manifests name.

    Pass `manifests` (file names without the .json) to stage only what those floors need."""
    entries, seen = [], set()
    if not os.path.isdir(FLOORS_DIR):
        return entries
    for file in sorted(os.listdir(FLOORS_DIR)):
        if not file.endswith(".json") or file == "report.json":
            continue
        if manifests and os.path.splitext(file)[0] not in manifests:
            continue
        with open(os.path.join(FLOORS_DIR, file), encoding="utf-8") as handle:
            try:
                manifest = json.load(handle)
            except ValueError:
                continue
        for group in manifest.get("meshes") or []:
            glb = (group.get("glb") or "").replace("/", os.sep)
            # Editor-only markers (the collision tester's own tiles) are not part of the floor anyone plays.
            if not glb or glb in seen or not group.get("glbExists") or group.get("editorOnly"):
                continue
            seen.add(glb)
            category, name = floor_model_names.model_asset(group["glb"])
            # The handful imported before the pipeline existed keep their folders and are not staged again.
            if group["glb"] not in floor_model_names.PRE_IMPORTED:
                entries.append((glb, category, name))
    return entries


GEAR_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gear.json")
GEAR_EXPORT = os.path.join(SK_ASSETS, "_gear_export")
GEAR_ICON_MANIFEST = os.path.join(SK_ASSETS, "_gear_icons", "gear_icons.json")


def gear_model_asset(model_path):
    """The static mesh asset name for a helmet or shield model file (or a base mesh a wrapper places)."""
    return _asset_name(model_path.replace("/owilite/", "/owlite/"), "SM_Gear")


def armor_asset(model_path):
    """The skeletal mesh asset name for an armour model file, e.g. item/gear/armor/padded/ranger/model_ranger_r2.dat
    becomes SK_ArmorPaddedRangerRangerR2. Also the folder it imports into under /Game/SK/Gear/Armor."""
    rel = model_path.replace("item/gear/armor/", "")[:-4]
    words = [w for w in re.split(r"[^A-Za-z0-9]+", rel) if w and w != "model"]
    return "SK_Armor" + "".join(w[:1].upper() + w[1:] for w in words)


def gear_entries():
    """(models, icons) for knight gear: every helmet and shield model gear.json names, a wrapper the exporter
    cannot follow replaced by the base meshes resolve_wrappers.py traced, and each item's baked icon."""
    models, icons, seen = [], [], set()
    if os.path.isfile(GEAR_JSON):
        with open(GEAR_JSON, encoding="utf-8") as handle:
            items = json.load(handle)["items"]
        wrappers = {}
        wrapper_file = os.path.join(GEAR_EXPORT, "wrappers.json")
        if os.path.isfile(wrapper_file):
            with open(wrapper_file, encoding="utf-8") as handle:
                wrappers = json.load(handle)
        for item in items:
            model = (item.get("model") or {}).get("path")
            if not model or item["slot"] not in ("Helm", "Shield"):
                continue
            category = "Gear/Helmets" if item["slot"] == "Helm" else "Gear/Shields"
            for path in [part["base"] for part in wrappers[model]] if model in wrappers else [model]:
                path = path.replace("/owilite/", "/owlite/")
                if path in seen:
                    continue
                seen.add(path)
                glb = os.path.splitext(path.replace("/", os.sep))[0] + ".glb"
                if os.path.isfile(os.path.join(SK_ASSETS, glb)):
                    models.append((glb, category, gear_model_asset(path)))
    if os.path.isfile(GEAR_ICON_MANIFEST):
        with open(GEAR_ICON_MANIFEST, encoding="utf-8") as handle:
            manifest = json.load(handle)
        entries = (manifest.get("icons") or {}) if isinstance(manifest, dict) else {}
        for entry in entries.values():
            if isinstance(entry, dict) and entry.get("png") and os.path.isfile(entry["png"]):
                icons.append((entry["png"], "GearIcons", entry["asset"]))
    return models, icons


# The game's own art for the Arsenal and Character windows (found in rsrc/ui, 2026-09-15). Missing files are
# reported by stage() and skipped. Named T_GearUI_<path in CamelCase>.
GEAR_UI_TEXTURES = [
    (SK_RSRC + "\\ui\\" + rel.replace("/", "\\") + ".png", "GearUI",
     "T_GearUI_" + "".join(w[:1].upper() + w[1:] for w in re.split(r"[^A-Za-z0-9]+", rel) if w))
    for rel in [
        "status/images/backing_preview", "status/images/backing_preview-wide", "status/images/backing_dark",
        "status/images/corners_preview", "status/previewcorner_tl", "status/previewcorner_lr",
        "preview/turnarrow/left_up", "preview/turnarrow/left_over", "preview/turnarrow/left_down",
        "preview/turnarrow/right_up", "preview/turnarrow/right_over", "preview/turnarrow/right_down",
        "status/tab/middle_active", "status/tab/middle_idle",
        "status/tab/edge_active_idle", "status/tab/edge_idle_active", "status/tab/edge_idle_idle",
        "status/tab/edge_empty_active", "status/tab/edge_empty_idle", "status/tab/edge_active_empty", "status/tab/edge_idle_empty",
        "window/standard", "window/alert_header", "window/tooltip", "window/tooltip_header", "window/seethrough",
        "window/solid", "window/solid_recess", "window/background",
        "slot/empty", "slot/occupied", "slot/over", "slot/disabled", "slot/label",
        "icon/inventory/categories/icon_helmet", "icon/inventory/categories/icon_armor",
        "icon/inventory/categories/icon_shield", "icon/inventory/categories/icon_gauntlet",
        "icon/inventory/categories/icon_amulet", "icon/inventory/categories/icon_costume",
        "icon/inventory/categories/icon_battlesprite", "icon/inventory/icon_locked",
        "window/geartip_rarity_star", "window/geartip_rarity_empty", "window/geartip_variant",
        "recipes/parts/pill_recipe/category_open", "recipes/parts/pill_recipe/category_closed",
        "recipes/parts/pill_recipe/category_open-hover", "recipes/parts/pill_recipe/category_closed-hover",
        "recipes/parts/pill_recipe/normal", "recipes/parts/pill_recipe/normal_hover",
        "recipes/parts/pill_recipe/selected", "recipes/parts/pill_recipe/selected_hover",
        "recipes/parts/backing_scroll", "recipes/parts/backing_scroll-dark", "arsenal/backing",
        "window/geartip_top", "window/geartip_top_equiped", "window/geartip_bottom", "window/geartip_bottom_equiped",
        "window/geartip_levelbar", "window/geartip_levelexp", "window/backing_preview",
        "window/tooltip_parts/backing_stats", "window/tooltip_parts/tierbar_backing", "window/tooltip_parts/tierbar_hashmarks",
        "window/tooltip_parts/tierbar_current", "window/tooltip_parts/tierbar_potential",
        "window/tooltip_parts/backing_bonus", "window/tooltip_parts/backing_penalty", "window/tooltip_parts/backing_variant",
        "window/tooltip_parts/icon_bonus", "window/tooltip_parts/icon_penalty", "window/tooltip_parts/icon_variant",
        "hud_v2/images/itempill/levelslot",
        "button/up", "button/over", "button/down", "button/selected", "button/disabled",
        "button/blue/up", "button/blue/over", "button/blue/down",
        "scrollbar/well_normal",
        "status/images/def_def", "status/images/def_pie", "status/images/def_ele", "status/images/def_sha",
    ]
]


# ---------------------------------------------------------------------------------------------
# The full weapon catalogue, generated rather than listed.
#
# Tools/SKImport/mine_weapons.py reads the game's own item.xml and writes weapons.json: every
# sword, handgun and bomb with its real damage types, status, timings, model and icon. Listing
# 352 weapons by hand here would be both unreadable and wrong within a week, so the models and
# icons they need are derived from that table instead. Delete weapons.json and this does nothing.
# ---------------------------------------------------------------------------------------------

WEAPONS_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "weapons.json")


def _asset_name(path, prefix):
    """A unique, valid Unreal asset name from a resource path.

    'item/weapon/bomb/barb/model_snarb-r2.dat' becomes 'Bomb_Barb_Snarb_R2'. The line folder is
    kept because several lines share a file called plain 'model', and the variant suffix is kept
    because a line's tiers are different models.
    """
    parts = path.replace("\\", "/").split("/")
    stem = os.path.splitext(parts[-1])[0]
    if stem.startswith("model_"):
        stem = stem[len("model_"):]
    elif stem == "model":
        stem = ""
    pieces = [parts[-3], parts[-2], stem] if len(parts) >= 3 else parts
    name = "_".join(x for x in pieces if x)
    cleaned = "".join(ch if ch.isalnum() else "_" for ch in name)
    while "__" in cleaned:
        cleaned = cleaned.replace("__", "_")
    return prefix + cleaned.strip("_").title().replace("_", "")


def catalogue_entries():
    """(models, icons) for every weapon in weapons.json whose files actually exist."""
    if not os.path.isfile(WEAPONS_JSON):
        return [], []
    with open(WEAPONS_JSON, encoding="utf-8") as handle:
        weapons = json.load(handle)

    models, icons, seen_models, seen_icons = [], [], set(), set()
    for weapon in weapons:
        model = weapon.get("model_path")
        if model and model not in seen_models:
            seen_models.add(model)
            glb = os.path.splitext(model.replace("/", os.sep))[0] + ".glb"
            # The exporter fails on a handful of models whose variants will not apply; those simply
            # do not appear here, and the weapons that wanted them keep a null mesh.
            if os.path.isfile(os.path.join(SK_ASSETS, glb)):
                models.append((glb, "WeaponModels", _asset_name(model, "SM_")))

        icon = weapon.get("icon_path")
        if icon and icon not in seen_icons:
            seen_icons.add(icon)
            src = os.path.join(SK_RSRC, icon.replace("/", os.sep))
            if os.path.isfile(src):
                icons.append((src, "WeaponIcons", _asset_name(icon, "T_")))

    # Models the exporter could not produce from the weapon's own model file (the Tortofist line's
    # compound, the mugs' held wrapper) were exported from the part that actually holds the mesh;
    # gun_models_textures.json records which part that is and where its glb went.
    gun_json = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gun_models_textures.json")
    if os.path.isfile(gun_json):
        with open(gun_json, encoding="utf-8") as handle:
            traced = json.load(handle)
        for entry in traced.values():
            model = entry.get("model_path_used")
            glb_abs = entry.get("exported_glb_path") or ""
            if not model or model in seen_models or not os.path.isfile(glb_abs):
                continue
            if not os.path.normcase(glb_abs).startswith(os.path.normcase(SK_ASSETS + os.sep)):
                continue
            seen_models.add(model)
            models.append((os.path.relpath(glb_abs, SK_ASSETS), "WeaponModels", _asset_name(model, "SM_")))
    return models, icons


def fx_entries():
    """(bullet models, weapon sounds) named in weapon_fx.json, which distill_weapon_fx.py writes from
    the projectile and sound research. Sounds land in Audio/Weapons, bullet models in Projectiles."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "weapon_fx.json")
    if not os.path.isfile(path):
        return [], []
    with open(path, encoding="utf-8") as handle:
        fx = json.load(handle)
    models = [(rel, "Projectiles", name) for rel, name in sorted((fx.get("projectile_assets") or {}).items())]
    sounds = [(os.path.join(SK_RSRC, "sound", rel.replace("/", os.sep)), "Audio/Weapons", name)
              for rel, name in sorted((fx.get("sound_assets") or {}).items())]
    return models, sounds


RIGID_PIECES = os.path.join(SK_ASSETS, "_research", "rigid_armor", "rigid_pieces.json")
TINTED_SKINS = os.path.join(SK_ASSETS, "_gear_tinted", "gear_tinted.json")


def armor_piece_entries():
    """(glb relative to SK_ASSETS, "Gear/ArmorPieces", asset name) for every loose armour piece the skinned armour import
    leaves out: a billboard piece's camera-facing build, the bone-space glb otherwise (research 2026-09-15,
    _research/rigid_armor/rigid_pieces.md). Imported static."""
    entries = []
    if os.path.isfile(RIGID_PIECES):
        with open(RIGID_PIECES, encoding="utf-8") as handle:
            for model in json.load(handle).values():
                for piece in model.get("pieces") or []:
                    chosen = piece.get("billboard_variant") or piece
                    entries.append((os.path.relpath(chosen["glb"], SK_ASSETS), "Gear/ArmorPieces", chosen["static_mesh_name"]))
    return entries


def gear_skin_entries():
    """(png, "GearSkins", asset) for every tinted gear skin bake_gear_skins.py wrote (_gear_tinted/gear_tinted.json)."""
    entries, seen = [], set()
    if os.path.isfile(TINTED_SKINS):
        with open(TINTED_SKINS, encoding="utf-8") as handle:
            data = json.load(handle)
        for name, item in data.items():
            if name == "summary" or not isinstance(item, dict):
                continue
            for texture in item.get("textures") or []:
                asset, png = texture.get("asset"), texture.get("tinted_png") or ""
                if asset and asset not in seen and os.path.isfile(png):
                    seen.add(asset)
                    entries.append((png, "GearSkins", asset))
    return entries


OBJECT_CLASSES = os.path.join(r"D:\Dev\SKAssets\_research", "floor_objects", "object_classes.json")

# Wrappers, animation clips, effects and sounds are named alongside a model but are not geometry.
NOT_GEOMETRY = ("model/wrapper/", "model/scripted/", "/animation", "/fx_", "/parts/")


def object_entries():
    """(glb relative to SK_ASSETS, category, asset name) for the models the floors' gates, switches, blocks, hazards
    and lift objects are made of.

    These are never in the floor manifests' mesh lists: a gate is placed as a *marker*, and its model is named by the
    config behind it, so the floor import never sees them. They come out of the floor-objects research instead."""
    if not os.path.isfile(OBJECT_CLASSES):
        return []
    with open(OBJECT_CLASSES, encoding="utf-8") as handle:
        rows = json.load(handle).get("configs") or []
    if isinstance(rows, dict):
        rows = list(rows.values())

    entries, seen = [], set()
    for row in rows:
        if not row.get("behaviour"):
            continue
        for model in row.get("models") or []:
            model = model.replace("\\", "/")
            if any(part in model for part in NOT_GEOMETRY):
                continue
            glb = os.path.splitext(model)[0] + ".glb"
            if glb in seen or glb in floor_model_names.PRE_IMPORTED:
                continue
            seen.add(glb)
            if os.path.isfile(os.path.join(SK_ASSETS, glb.replace("/", os.sep))):
                category, name = floor_model_names.model_asset(glb)
                entries.append((glb.replace("/", os.sep), category, name))
    return entries


def stage(only=None, names=None, floors=None):
    groups = {}
    missing = []

    catalogue_models, catalogue_icons = catalogue_entries()
    fx_models, fx_sounds = fx_entries()
    gear_models, gear_icons = gear_entries()

    for rel, category, name in (list(MODELS) + catalogue_models + fx_models + gear_models
                                + armor_piece_entries() + floor_entries(floors) + object_entries()):
        if only and category not in only:
            continue
        if names and name not in names:
            continue
        src = os.path.join(SK_ASSETS, rel)
        if not os.path.isfile(src):
            missing.append(rel)
            continue
        dst_dir = os.path.join(STAGING, category.replace("/", os.sep))
        os.makedirs(dst_dir, exist_ok=True)
        dst = os.path.join(dst_dir, name + ".glb")
        # A bullet model's spin is the game's procedural animation, redone in C++; import it still.
        gear = category in ("Gear/Helmets", "Gear/Shields")
        # Loose armour pieces are already in their bone's space: static, but their node offsets are real.
        static = category in ("WeaponModels", "Projectiles", "Gear/ArmorPieces", "World/Floors") or gear
        fix_glb(src, dst, static_only=static, zero_mesh_offsets=gear)
        groups.setdefault(category, []).append(dst)

    plain_files = list(TEXTURES) + catalogue_icons + fx_sounds + gear_icons + GEAR_UI_TEXTURES + gear_skin_entries() + [
        (os.path.join(SK_RSRC, "sound", rel), category, name) for rel, category, name in SOUNDS
    ]
    for src, category, name in plain_files:
        if only and category not in only:
            continue
        if names and name not in names:
            continue
        if not os.path.isfile(src):
            missing.append(src)
            continue
        dst_dir = os.path.join(STAGING, category.replace("/", os.sep))
        os.makedirs(dst_dir, exist_ok=True)
        dst = os.path.join(dst_dir, name + os.path.splitext(src)[1])
        shutil.copyfile(src, dst)
        groups.setdefault(category, []).append(dst)

    cfg = {"ImportGroups": [
        {
            "GroupName": "SK_" + category.replace("/", "_"),
            "Filenames": files,
            "DestinationPath": "/Game/SK/" + category,
            "bReplaceExisting": True,
            "bSkipReadOnly": True,
        }
        for category, files in groups.items()
    ]}
    with open(IMPORT_JSON, "w") as f:
        json.dump(cfg, f, indent=2)
    staged = sum(len(v) for v in groups.values())
    print(f"staged {staged} files in {len(groups)} groups -> {IMPORT_JSON}")
    for rel in missing:
        print("MISSING", rel)
    return staged


def run_import():
    cmd = [UE_CMD, PROJECT, "-run=ImportAssets", f"-importsettings={IMPORT_JSON}",
           "-nosourcecontrol", "-unattended", "-nopause", "-stdout", "-FullStdOutLogOutput"]
    print("running:", " ".join(cmd))
    return subprocess.call(cmd)


if __name__ == "__main__":
    only = None
    if "--groups" in sys.argv:
        only = sys.argv[sys.argv.index("--groups") + 1].split(",")
    # Only these asset names (a few models out of a group, without re-importing the rest of it).
    names = None
    if "--names" in sys.argv:
        names = sys.argv[sys.argv.index("--names") + 1].split(",")
    # Only the models these floor manifests need (file names without .json), instead of all 377.
    floors = None
    if "--floors" in sys.argv:
        floors = set(sys.argv[sys.argv.index("--floors") + 1].split(","))
    if stage(only, names, floors) and "--import" in sys.argv:
        sys.exit(run_import())
