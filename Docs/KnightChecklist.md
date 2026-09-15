# Knight checklist

Everything that belongs to the knight, imported and working before the monster pass
(user, 2026-09-14: "once we have the core mechanics for the knight down we can start with
the monsters after"). Scope decided the same day: **gear first** (shields, helmets, armour,
trinkets), **cosmetics after**; the checklist also covers **battle sprites** and
**consumables**.

Legend: `[x]` done and checked (the check is named) · `[ ]` to do · `[?]` needs a decision
from the user before it can be done · *untested* = built but not seen in play.

Research sources: the game's config dumps in
`D:\Dev\Tools\ThreeRingsSharp\ThreeRingsSharp\ConfigRefs` (`item.xml`, `accessory.xml`,
`depth_scale.xml`, `recipe.xml`, `battle_sprite.xml`), the install's `rsrc`, and the
experiments in `D:\Dev\SKAssets\_gear_samples`.

---

## 1. Where the knight is today (audited 2026-09-15)

- [x] **Shield** works as one fixed shield: raise, block into a Shield attribute, refill
      3 s after the last block over 6 s, 8 s break, half walk speed, bash with stun, bubble
      coloured by shield health. Every number is on `AClockworksCharacter` or the two
      shield abilities; the mesh (Buckler) is set in `BP_ClockworksCharacter`.
      Checked: `ClockworksCharacter.h:146-265`, `ClockworksShieldBashAbility.h:60-101`.
- [x] **Helmet, face, armour** are the Cap helm and Coat armour baked into the knight
      export; `HelmetMesh` / `FaceMesh` are static meshes on `bone_helmet`. Nothing swaps
      them and nothing replicates. The armour renders grey (untinted masks).
- [x] **Attributes**: Health, MaxHealth, Shield, MaxShield, AttackPower, **one flat
      DefensePower** (subtracted, minimum 1 damage), MoveSpeed. Four damage types exist
      on the attack side only. **No per-type defense, no status resistance.**
- [x] **Loadout**: weapons only (`WeaponSlots` on the PlayerState, server equips,
      `EquipEffects` applied only while a weapon is drawn).
- [x] **Gear screen**: typed to weapons throughout (tabs, catalogue scan, tier tree,
      apply path).
- [x] **Nothing exists** for trinkets, sprites, consumables or cosmetics; the HUD belt
      draws empty slots by decision.

## 2. Gear data

- [x] **Miner**: `Tools/SKImport/mine_gear.py` → `gear.json` (1.7 MB, ~2 s).
      **623 items: 109 shields, 215 helmets, 206 armours, 93 trinkets** (26 of them the
      unreleased `_` trinkets, tagged `unreleased`); 68 excluded and listed with reasons
      (30 shared bases, 12 dev, 10 test, 12 Game Master, 3 PvP Lockdown kits, 1 bogus).
      Checked: counts re-read from the file after the re-run; Proto Shield, Skolver Cap and
      Bomb Focus Module read back in full.
- [x] **Names** from the game's own text for 592 items (5 kat/rooster helms named from
      their config path). **Icons** for all 597. **Models** for all 530 non-trinkets.
- [x] **Defense per damage type** for 543 items, as the original's depth-scale curve
      (value at depths 1, 3, 7, 12, 17, 23, 30 and the maximum). Checked: no upgrade step
      of 312 lowers defense or stars; averages rise with stars (armour 8.6 at 0★, 259.5
      at 5★). Skolver Cap: 144.15 Normal, 122.45 Piercing at depth 30.
- [x] **Status resistance** for 418 items (Skolver Cap: Freeze 40).
- [x] **Shield numbers** for all 109: health curve (Proto Shield 91.67), regen 6000 ms,
      hit 3000 ms, break 8000 ms, speed while blocking (-0.5), bash rank, push-back
      action (108), particles. Oddities kept: Stop Sign blocks at -1.0 speed with a 10 s
      break; Tortoise and Shell use a Tortodrone bash, Raider Buckler a Targe bash.
- [x] **Bonuses** for 309 items: damage, attack speed and charge time by weapon class
      (Bomb Focus Module: bomb charge time -10%). 440 of 539 values explicit.
- [x] **Upgrade lines** (325 items), line (387) and set (388) for the gear screen's tree.
- [x] **Decided 2026-09-15: gear grows with depth.** Each of the demo's 8 depths reads the
      original's curve at a matching original depth. [x] Mapping decided (even spread,
      decision 9) and read by `ClockworksGearStats::OriginalDepthFor`; the lobby reads depth 1.
- [x] **Decided 2026-09-15: gear is fully heated (level 10)**, the extra defense and the
      extra health included, with no levelling system. [x] Level-10 numbers from the heat
      tables: +25 defense on every defense a piece has (whether it applies to defenses the
      piece lacks is INFERRED as no), and health in depth steps (a 5-star helmet or armour:
      +40, +80 from depth 8, +80 from depth 18).
- [x] **Decided 2026-09-15: use the filled-in bonus values** (93, marked as inferred so they
      can be corrected; Black Kat takes the most common HIGH number).
- [x] **Decided 2026-09-15: include the 26 unreleased `_` trinkets** (Armor Ward, Impact
      Band, Wing Pendant…). Re-run done: all 26 in and tagged.
- [ ] **Assumptions to confirm by play**: straight lines between depth points; a star rating
      caps the depth it is read at (0★ 3, 1★ 7, 2★ 12, 3★ 17, 4★ and 5★ 30); shield health
      read at medium difficulty; 37 bonuses with no weapon class read as sword.
- [x] **Damage formula against real defense** (`ClockworksGearStats::NetDamage`, corrected 2026-09-15 to
      the original's code, read from `projectx-pcode.jar`): per damage type, a hit bigger than the
      defense loses half the defense; a smaller one keeps `0.5 - 0.19·log10((D - G)/15 + 1)` of itself.
      The wiki's "twice the defense" form is the same rule in half-size units, which is why the first
      build counted defense double.
- [ ] Misplaced Promissory Note's conditional defenses (conditions empty in the dump).
- [ ] Owlite shields: configs say `owilite/`, the install folder is `owlite/` (4 models);
      map the path in the export list.

## 3. Gear models (export)

- [x] **Survey** of `rsrc/item/gear`: helm 317 .dat in 65 folders, armour 341 in 76,
      shield 108 in 31 (plus accessories 1,077). Real gear references **178 model files**
      (54 shield, 64 helm, 60 armour; trinkets are icons only). Checked: all 178 looked up
      in the install, only the 4 Owlite paths missing.
- [x] **Helmets and shields export standalone as rigid meshes.** Checked on tusk, valkyrie,
      cap, lizardhat helms and plate, owlite, buckler shields.
- [x] **Armour exports rigged only through a knight copy** (armour swapped into
      `PlayerKnight.xml`): Plate came out skinned to the knight's 49-joint skeleton, 22
      bones weighted (pelvis, spine, arms, legs, the four belt bones). Checked:
      `_gear_samples/wrap/KnightGear.glb`; exported alone it is static and unskinned.
- [x] **Offset bug found**: standalone exports put each `Mesh[n]` node at its own bounding
      box centre (cap +0.233, plate +0.525); the vertices themselves are right. The
      existing HelmCap and ArmorCoat imports carry it.
- [x] **Attachment data**: shield held on `bone_shield` at scale 0.9, away on
      `bone_shield_away` at (-0.05, -0.1, 0) plus a turn; helmets on `bone_helmet`.
- [x] **All 178 gear models exported (2026-09-15)** to `D:\Dev\SKAssets`, scripts and logs in
      `D:\Dev\SKAssets\_gear_export`. Checked by `report_exports.py` (geometry, skins, clips,
      offsets) and a joint check against `PlayerKnight.glb`:
      - **Shields and helmets, 118:** 104 exported directly (`owilite` mapped to `owlite`). The
        other 14 are wrappers the exporter cannot follow (Targe, 12 Tortafist colours, Pith
        Cyclopse); `resolve_wrappers.py` follows them to 6 base meshes, exported, with each
        base's texture and placement in `wrappers.json`. The Cyclopse eye needed its material
        written into a patched copy (`patched/model_eye`). 59 carry the `Mesh[n]` offset.
        Only Airbraker has clips (10).
      - **Armour, 60, all skinned to the knight's skeleton:** 35 through a knight copy
        (`export_armor.py`; the knight's animation list is cut to one, since an empty list
        crashes the exporter). 25 (Doublebelt, Hybrid, Padded, Ranger, Stalker, Warden,
        Rearpouch, Rivet) are Derived chains over detail switchers; `export_armor_leaves.py`
        follows them to their skinned parts at highest detail and attaches every part to the
        knight's Root. That needed exporter patch 5 (a material left to a parameter is no
        longer a crash; `Docs/SpiralKnightsAssetPipeline.md`). 26.9 MB in all.
- [ ] **Armour parts are separate meshes with separate skins** (43 of 60 have 2–6 parts, each
      with its own copy of the 49-joint skeleton): merge them on import or attach each part to
      the knight.
- [x] **Stalker ranks 3–5 have a scarf with its own small skeleton** (`bone_scarf1-3`) outside
      the knight's: exported rigid in its rest pose and attached to `Bip01-Spine1` (the original waves it).
- [ ] **Armour exported through leaves embeds no textures**; take each item's texture from
      `rsrc` by its Variant (section 4).
- [ ] `fix_glb` mode that zeroes the `Mesh[n]` node translation; re-export HelmCap too.
- [ ] `static_only` for rigged helmets and shields wanted as static meshes (Airbraker's clips).
- [ ] Bring the export scripts from `_gear_export` into `Tools/SKImport` so the export is
      re-runnable from the repo.
- [x] **Armour imports onto the knight's own skeleton (proved 2026-09-15).**
      `Tools/SKImport/import_armor_test.py` (headless) drives the Interchange manager with the
      generic assets pipeline's skeleton set to `coat_model-Mesh_0__Skeleton` (the ImportAssets
      commandlet cannot name a skeleton). Coat (one part) and Padded (three parts) both came in as
      skeletal meshes on that skeleton, 49 bones, no new skeleton or physics asset; Padded with 3
      material slots. Needed `fix_armor_glb` in `stage_and_import.py`: merges an armour's parts
      onto one skin (joint indices remapped by bone name), links each part to its placeholder
      material, drops the knight clips, and repairs what Interchange silently refuses (null
      `pbrMetallicRoughness`, empty arrays, unused meshes). Checked offline on all 60: one skin of
      49 joints each, indices in range, valid glTF. Test assets are in `/Game/SK/GearTest` (git-
      ignored), including a leftover 1-slot Padded from an earlier try.
- [x] **Only the first Interchange import of a headless run completes**; worked around with one run
      per armour (`run_armor_imports.py` driving `import_armor.py`, ~10 s each). **All 60 armours
      imported (2026-09-15)** under `/Game/SK/Gear/Armor/<SK_Armor...>`, results in
      `D:\Dev\SKAssets\_staging\GearArmor\armor_import_results.json`. The cause is still unknown.
- [ ] Batch importer: the glTF preset's folder layout (a fresh generic pipeline puts the mesh at the
      folder root and logs `AlphaMode` errors on placeholder materials).
- [ ] **See it on the knight in the editor**: the binding is proven, the deformation is not.
- [x] Rigid pieces left out of the skinned import (Merc pylon and 2 glows, Almire tassel, 2 Iron Valkyrie
      tassels, 3 Stalker scarves): found by re-running the merge over all 60 armours, bones and offsets read
      from the game's configs, exported (`D:\Dev\SKAssets\_research\rigid_armor`), imported as
      `Gear/ArmorPieces`, attached per armour (`ArmorPieces`); tassels and glows face the camera (user's
      choice, INFERRED setup).
- [x] Import groups in `stage_and_import.py` (2026-09-15): `Gear/Helmets` (65 model files) and
      `Gear/Shields` (45) as static meshes with the `Mesh[n]` offsets zeroed, `GearIcons` (623 baked
      icons) and `GearUI` (88 pieces of the original's Arsenal and Character window art), then
      `fix_gear_textures.py`. A model with several pieces imports as one mesh per piece inside its
      folder. Checked: every staged model folder present on disk.
- [ ] Verify on the knight: armour deformation, helmet and shield sizes and placement. The Targe and
      Tortafist conversion is proven exact (`_research/face_hiding/compound_shield_axes.md`); the knight's
      own shield placement on each bone (raised ×0.9, away offset and turn) is now applied too.

## 4. Gear colour

- [x] **How colour works**: textures are painted in key hues; a Colorization value is
      `class << 8 | colour` looked up in `colordefs.dat` (22 classes; dumped to
      `_gear_samples/colordefs/colordefs.txt`). 257 = class 1 "player" (keyed on magenta),
      colour 1. Pixels inside a class's hue range get that colour's HSV offsets.
- [x] **Variant swaps the texture file**, not the tint (Valkyrie Angelic →
      `helm_angelic_pink.png`). The exporter often gives the mesh a textureless material,
      so the item → texture mapping must come from the model's Variant, not the glb.
- [x] Colours baked offline instead (`bake_gear_skins.py`): 457 items, 558 tinted textures, each followed
      through the game's own configs to the texture actually drawn (`D:\Dev\SKAssets\_gear_tinted`).
- [x] Per-item skins on each definition: `SkinSwaps` replaces each imported material the manifest names
      (additive overlays keep their own).
- [x] The "player" colour class: `M_GearSkin` shifts its magenta by `PlayerHueShift`, blue by default
      (user's decision 2026-09-15); the cosmetics pass only has to set the knight's colour.

## 5. Gear in the game (C++) — built 2026-09-15, compiled, not seen in play

- [x] `UClockworksGearDefinition` (`Gear/ClockworksGearDefinition.h`, asset type `Gear`): slot, name,
      flavour, stars, upgrade line, line, unreleased flag, icon, mesh + extra pieces + skin + offset
      (helmets, shields), skeletal armour mesh + skins, defense curves per type, level-10 defense and
      health steps, status resists, bonuses (with the original's label, inferred flag and monster-family
      tag), shield health curve, refill, hit and break times, blocking speed, bash rank, push-back.
- [x] `AClockworksPlayerState` gear slots (helmet, armour, shield, trinket, trinket), replicated, set by
      the server only (`RequestSetGear` → `ServerSetGear` → `SetGear`), refused while attacking, dodging,
      shielding or dead; `OnGearChanged` on every machine. Weapon slots capped at 4.
- [x] ~~Always-on equip effects~~: not needed. Gear numbers are read where they apply
      (`ClockworksGearStats`) instead of being copied into attributes by effects.
- [x] Defense per damage type and status resistance, applied in `UClockworksAttributeSet` for knights:
      each part of a hit meets its own type's defense; a raised shield takes the hit on the shield's own
      defense. Resistance scales a status's chance, duration and tick damage by `0.6^(resist/40)`
      (INFERRED curve) in `TryApplyStatus`.
- [x] Bonuses, as the original's fixed steps (damage and charge 0.08 a level, speeds 0.04) with its caps:
      damage relative plus against the target's family pooled at ±48% (attribute set, per hit, weapon read
      off the hit), charge time ±48% (`ResolveChargeSeconds`), attack speed ±24% on every attack phase
      (`ResolveAttackSeconds`), walk speed ±24%.
- [x] Shield from its definition: max shield = its health at the depth, refill delay and time, break
      time, walk speed while blocking; the bash kind, rank and damage curve (`UClockworksShieldBashAbility`:
      the original's timings, depth-scaled stun INFERRED, Tortodrone ring); push-back on raising the
      shield (`UClockworksShieldAbility::PushBack`, monsters' `ImpulseLevel`). [ ] Particles.
- [x] Knight look on every machine (`RefreshGearVisuals`): the armour replaces the body mesh with its
      tinted skins and loose pieces, the helmet and shield models with all their pieces and skins, the face
      hidden under the three hunting caps (`bHidesFace`).
- [x] Knight health: 200 base (`InitialMaxHealth`, five pips of 40) plus the gear's level-10 health steps
      and `HealthBonus` trinkets, kept in step with the depth (`AClockworksPlayerState::RefreshGearStats`).
- [x] Default equipment on `BP_ClockworksCharacter`: Padded Cap, Wolver Coat, Proto Shield (the lowest-rated
      items on the cap, coat and buckler models the knight already wore).

## 6. Assets and tools

- [x] `generate_gear_assets.py` (2026-09-15): 623 `DA_Gear_*` under `Content/TopDown/Gear/Knight/<slot>`.
      Checked by `verify_gear_assets.py`: armour 206, helmets 215, shields 109, trinkets 93 (26 unreleased);
      every piece has its icon and every non-trinket its model; every curve 7 samples long; every shield
      has its health curve; the knight starts in Padded Cap, Wolver Coat, Proto Shield with 200 health.
      Looks guesses listed in `Tools/SKImport/gear_assets_report.json`: 107 model-set members, 54 skins
      with no name match, 13 compound placements; 6 bonuses with no number left out.
- [x] Gear colours applied (section 4); checked by `verify_gear_assets.py`: skins on 191 armours, 210 helmets,
      33 shields; loose pieces on 26 armours; 3 face-hiding helmets; bash numbers on all 109 shields (96
      standard, 12 Tortodrone, 1 Targe); no bonus above one step.
- [x] `verify_gear_assets.py`: per-slot counts and the starting gear.

## 7. Gear screen and HUD — built 2026-09-15, compiled, not seen in play

- [x] `UClockworksGearScreen` rebuilt like the original (L, the pause menu, the start menu, the HUD's
      loadouts button): the Character window (Equipment tab; Costume, Battle Sprite and Achievements drawn
      as pictures), 4 weapon + 5 gear slots, the knight turning on a stand (`AClockworksKnightPreview`, a
      local copy filmed by a scene capture, flat-lit by default), name and star total, health and defense
      at this depth; the item card (name and stars on gold, picture, level 10, defense and shield bars at
      this depth, resistances, bonuses, flavour, take off); the Arsenal (7 categories, upgrade lines, rows
      with icon and stars, gold when worn; click to put on). Uses the imported original art with flat
      fallbacks. Sends intent only; redraws when the server's result replicates.
- [x] Save Loadout: 5 loadouts, saved and switched with a click, kept until the game quits (not on disk).
- [x] HUD: a pip is 40 health (`HealthPerPip`); the shield row reads the equipped shield's max shield.
- [ ] Portrait from the equipped helmet.

## 8. Checks before calling the knight done

- [ ] Every item equips and looks right on the knight (spot-check each line and star).
- [ ] Numbers: defense reduces damage per type; resistances shorten statuses; bonuses change
      damage/speed/charge; each shield's health, refill and break match its data.
- [ ] Two-player PIE: equipment and looks replicate, server decides every change.

## 9. Battle sprites (researched, not built)

- [x] **20 sprites, 33 models** in `battle_sprite.xml` (Drakon, Maskeraith, Seraphynx, and
      their colour variants). Checked: counts re-read from `gear.json`.
- [ ] Research each sprite's abilities, levels, follow behaviour and models.
- [ ] Decide how much of the sprite system the demo needs (levels and upgrades are out of
      scope per CLAUDE.md).
- [ ] Export, import, companion actor, abilities, HUD.

## 10. Consumables (researched, not built)

- [x] **Found in `item.xml`**: Health, Super and Ultra Health capsules, Remedy capsule;
      Attack Booster, Defense Booster, Blazing Speed, Shadow Espresso; fire, freeze,
      poison and shock orbital barriers (three strengths each); seven status vials (three
      strengths each); Auto Turret Kit, Artillery Beacon, Mecha Knight Kit, Ranger Signal
      Flare, Cursed Idol, Ocarina of Slime; luck potions; Vitapods (Health +1 to +30, run
      health). Winterfest presents and fireworks/confetti are events or toys.
- [ ] Mine each consumable's effect, duration and model.
- [ ] Decide which belong in the demo (the HUD belt has slots 4–7 and a vitapod slot).
- [ ] Pickups in the floors, the belt, use on key press, effects.

## 11. Cosmetics (after gear)

- [x] **Counted**: Costume/Helm 562 items (135 models), Costume/Armor 437 (74),
      Costume/Shield 9 (2); Accessory/Helm 1,640 (239), Accessory/Armor 1,190 (252),
      `accessory.xml` 2,866 configs (492 models); Recolor Sets 868 (17); Colour 25, Eye 32,
      Height 5.
- [x] **Export notes**: accessory configs point at wrapper models that export EMPTY; the
      `*_base.dat` they wrap exports fine. Accessories attach to `Bip01 Head` /
      `Bip01 Spine1` slots with offsets (helm_top, armor_back…). Three models crash the
      exporter (bunnytail, toysword_base, warden_r4).
- [ ] Everything else, in its own pass after gear.

## Decisions (2026-09-15)

1. Gear stats follow depth: the demo's 8 depths map onto the original's curve.
2. Gear is fully heated (level 10), extra defense and health included.
3. Inferred bonus values are used, marked as inferred.
4. The 26 unreleased `_` trinkets are included.

5. **Gear screen like Spiral Knights' own (2026-09-15, from the user's screenshots):** the Arsenal
   (collapsible category list with stars, item cards with stat bars, bonuses, flavour and the item's
   picture, click to equip), the Character window (title bar, a column of equipment slots, a rotating
   3D knight wearing the gear, the name under it), the Costume / Battle Sprite / Achievements tabs drawn
   but not working yet, and Save Loadout.
6. **Slots:** 4 weapons, helmet, armour, shield, 2 trinkets, all open.
7. **Level and rank:** item cards show every piece at level 10; no rank line, just the name and a star total.
8. **The original's combat numbers throughout:** knight health 40 per pip, 5 pips base (200); monster damage
   and health from the original's depth curves (every monster retuned); defense subtracted per damage type,
   with the players' log curve for hits under twice the defense; knight weapon damage from the original's
   curves, hit by hit, for every weapon (2026-09-15, `apply_weapon_damage.py`).
9. **Depth mapping, even spread:** demo depth 1→4, 2→7, 3→11, 4→15, 5→18, 6→22, 7→25, 8→29.
10. **Defense at the full config values** (not halved to the wiki's numbers).
11. **Status resistance reduces duration, damage and the chance to be inflicted.**

## Open decisions

- How much of battle sprites and which consumables the demo needs (sections 9 and 10).
- Whether saved loadouts should survive quitting (today they last the session).
