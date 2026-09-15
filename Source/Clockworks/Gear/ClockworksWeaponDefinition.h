// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "GameplayTagContainer.h"
#include "Templates/SubclassOf.h"
#include "ClockworksAttackProfile.h"
#include "ClockworksWeaponDefinition.generated.h"

/**
 * The three weapon classes. Spiral Knights hangs a great deal on this: a class decides how a weapon
 * is used, not merely what it looks like, and a loadout is expected to carry one of each.
 */
UENUM(BlueprintType)
enum class EClockworksWeaponClass : uint8
{
	Sword     UMETA(DisplayName = "Sword"),
	Handgun   UMETA(DisplayName = "Handgun"),
	Bomb      UMETA(DisplayName = "Bomb")
};

class UAnimSequenceBase;
class UClockworksGameplayAbility;
class UGameplayEffect;
class UMaterialInterface;
class UStaticMesh;
class UStaticMeshComponent;
class UTexture2D;

/**
 * One weapon the knight can carry: what sits in the hand, which ability the attack button runs
 * while it is drawn, and how holding it changes the knight. One DA_Weapon_* asset per weapon.
 * The attack's own numbers (timings, damage, clips) live on the ability class (BP_GA_*) unless the
 * weapon's Attack profile overrides them, which every catalogue weapon does.
 *
 * The PlayerState's replicated loadout points at these, so each one must be a real asset under
 * Content/ (object references replicate by path; a runtime-made object would not arrive).
 */
UCLASS(BlueprintType)
class UClockworksWeaponDefinition : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:

	virtual FPrimaryAssetId GetPrimaryAssetId() const override { return FPrimaryAssetId(FPrimaryAssetType(TEXT("Weapon")), GetFName()); }

	/**
	 * Sets DamageType from a tag name, e.g. "Data.Damage.Piercing".
	 *
	 * Exists for the catalogue generator: FGameplayTag's name is read-only through Unreal's Python
	 * bindings and the tag library is not exposed there at all, so a tool has no supported way to
	 * build one. Requesting it by name here also fails loudly if the tag was never declared in C++,
	 * which is the right behaviour for a generator that writes hundreds of assets unattended.
	 */
	UFUNCTION(BlueprintCallable, Category = "Weapon|Damage")
	void SetDamageTypeByName(const FString& TagName);

	/** The damage type as a readable string, for tools. Unreal's Python bindings cannot print a tag. */
	UFUNCTION(BlueprintPure, Category = "Weapon|Damage")
	FString GetDamageTypeName() const;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Weapon")
	FText DisplayName;

	/**
	 * Which class this is. Stored rather than inferred from the attack ability, because the loadout
	 * screen needs to group several hundred weapons by it and guessing from a class name is the sort
	 * of thing that quietly stops working when something is renamed.
	 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Weapon")
	EClockworksWeaponClass WeaponClass = EClockworksWeaponClass::Sword;

	/** The original's star rating, 1 to 5; zero when unknown. The loadout screen lays each line out by it. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Weapon", meta = (ClampMin = "0", ClampMax = "5"))
	int32 StarRating = 0;

	/**
	 * The weapon this one is upgraded from in the original's recipes, or null for the first rung of a
	 * line. Nothing is upgraded in this demo (crafting is cut): this only groups the catalogue into
	 * lines and tiers, so the loadout screen can show the Calibur, the Tempered Calibur and the
	 * Leviathan Blade as one tree instead of three unrelated entries in a list of hundreds.
	 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Weapon")
	TObjectPtr<UClockworksWeaponDefinition> UpgradesFrom;

	/** Toolbar icon. Optional: a slot without one shows the name instead. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Weapon")
	TObjectPtr<UTexture2D> Icon;

	/** The model in the hand. Spiral Knights weapons are rigid pieces snapped onto bone_weapon_r. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Weapon|Visual")
	TObjectPtr<UStaticMesh> Mesh;

	/**
	 * The skin painted on Mesh. Several weapons share one model and differ only in this (the grey
	 * Calibur and the blue Tempered Calibur), and the exporter leaves most models on a blank
	 * placeholder material, so the skin is chosen per weapon by fix_weapon_materials.py. Null keeps
	 * the mesh's own material.
	 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Weapon|Visual")
	TObjectPtr<UMaterialInterface> MeshMaterial;

	/**
	 * The model's other pieces, drawn with Mesh at the same spot: a needle gun's spheres, a grill's lid
	 * and handle, a mixer's beaters, the stacked tiers of an Autogun. The exporter writes a model's
	 * parts as separate meshes; the generator puts the largest in Mesh and the rest here, leaving out
	 * effect cards (trails, glows) that only the original's particle materials could draw.
	 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Weapon|Visual")
	TArray<TObjectPtr<UStaticMesh>> ExtraMeshes;

	/**
	 * Every machine, cosmetic: shows Weapon's whole model on MainMesh, with one child component per
	 * extra piece (made on MainMesh's owner the first time one is needed), and paints the weapon's
	 * skin wherever the model wears its placeholder or its base skin. A null Weapon empties the extras.
	 * The knight's hand and a dropped bomb both use it.
	 */
	static void ShowModel(const UClockworksWeaponDefinition* Weapon, UStaticMeshComponent* MainMesh, TArray<TObjectPtr<UStaticMeshComponent>>& ExtraComponents);

	UPROPERTY(EditDefaultsOnly, Category = "Weapon|Visual")
	FName AttachSocket = TEXT("bone_weapon_r");

	/** Offset from the socket, for a model whose grip is not at its origin. */
	UPROPERTY(EditDefaultsOnly, Category = "Weapon|Visual")
	FTransform MeshOffset;

	/** Played when this weapon is drawn (SK ready_sword / ready_pistol), fitted to DrawSeconds. Cosmetic. */
	UPROPERTY(EditDefaultsOnly, Category = "Weapon|Visual")
	TObjectPtr<UAnimSequenceBase> DrawAnim;

	UPROPERTY(EditDefaultsOnly, Category = "Weapon|Visual", meta = (ClampMin = "0.0"))
	float DrawSeconds = 0.3f;

	/** Granted to the attack button while drawn, taken back when another weapon is drawn. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Weapon|Combat")
	TSubclassOf<UClockworksGameplayAbility> AttackAbility;

	/**
	 * How this particular weapon attacks: its own combo or clip, clips at the original's speeds, its
	 * charge and its reload, read from the game's attack configs by generate_weapon_assets.py. This
	 * is what makes a Troika's two slow swings, a Flourish's thrusts and an Autogun's stream of
	 * bullets different moves of the same three abilities. Empty keeps the ability's own defaults.
	 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Weapon|Combat")
	FClockworksAttackProfile Attack;

	/** Applied by the server while the weapon is drawn and removed on switch: the place for gear stat changes. */
	UPROPERTY(EditDefaultsOnly, Category = "Weapon|Combat")
	TArray<TSubclassOf<UGameplayEffect>> EquipEffects;

	/** Fraction of walk speed kept while this weapon attacks. Spiral Knights: swords about 0.25, a Blaster about 0.5. */
	UPROPERTY(EditDefaultsOnly, Category = "Weapon|Feel", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float AttackMoveSpeedMultiplier = 0.25f;

	/** Fraction of walk speed kept while charging it. Spiral Knights: 1 for most swords and, since 2014, every gun. */
	UPROPERTY(EditDefaultsOnly, Category = "Weapon|Feel", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float ChargeMoveSpeedMultiplier = 1.f;

	/**
	 * Which of the four damage types this weapon deals, and what it is worth against the family it
	 * hits. This lives on the weapon rather than on the ability on purpose: every sword in a line
	 * swings with the same timing, and what separates a Calibur from a Blitz Needle is the damage
	 * type and the status, not the animation. One attack ability can therefore serve a whole class.
	 *
	 * Unset means Normal.
	 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Weapon|Damage", meta = (Categories = "Data.Damage"))
	FGameplayTag DamageType;

	/** Scales the attack ability's own BaseDamage. One leaves it alone; this is how a line's tiers differ. */
	UPROPERTY(EditDefaultsOnly, Category = "Weapon|Damage", meta = (ClampMin = "0.0"))
	float DamageMultiplier = 1.f;

	/**
	 * The status this weapon inflicts on a landed hit, how often, and for how long. In Spiral Knights
	 * this is the second reason to carry a particular weapon: one that freezes is worth having even
	 * in a room where its damage type is resisted.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Weapon|Status")
	TSubclassOf<UGameplayEffect> StatusEffect;

	UPROPERTY(EditDefaultsOnly, Category = "Weapon|Status", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float StatusChance = 0.f;

	UPROPERTY(EditDefaultsOnly, Category = "Weapon|Status", meta = (ClampMin = "0.0"))
	float StatusSeconds = 4.f;

	/** Damage per tick for a status that burns. Ignored by the others. */
	UPROPERTY(EditDefaultsOnly, Category = "Weapon|Status", meta = (ClampMin = "0.0"))
	float StatusTickDamage = 4.f;

	/**
	 * The status's tick damage by the demo's depth (index 0 to 8), the original's status damage curve at the weapon's
	 * status power; replaces StatusTickDamage when set. Written by apply_weapon_damage.py for Fire and Shock.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Weapon|Status")
	TArray<float> StatusTickDamageByDepth;
};
