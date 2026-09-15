// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "ClockworksWeaponDefinition.h"
#include "ClockworksGearDefinition.generated.h"

class UMaterialInterface;
class USkeletalMesh;
class UStaticMesh;
class UStaticMeshComponent;
class UTexture2D;

/** What kind of gear a piece is. Spiral Knights gives a knight one helmet, one armour, one shield and two trinkets. */
UENUM(BlueprintType)
enum class EClockworksGearSlot : uint8
{
	Helmet    UMETA(DisplayName = "Helmet"),
	Armor     UMETA(DisplayName = "Armor"),
	Shield    UMETA(DisplayName = "Shield"),
	Trinket   UMETA(DisplayName = "Trinket")
};

/** Where an equipped piece sits in the PlayerState's gear, in this order. */
UENUM(BlueprintType)
enum class EClockworksGearSlotIndex : uint8
{
	Helmet,
	Armor,
	Shield,
	Trinket1,
	Trinket2,
	Count UMETA(Hidden)
};

/** Which of the original's shield bashes a shield does (research: D:\Dev\SKAssets\_research\shield_bonus\findings.md). */
UENUM(BlueprintType)
enum class EClockworksShieldBashKind : uint8
{
	/** Shield/Bash, every rank: one launch, a hit on everything touched. */
	Standard    UMETA(DisplayName = "Standard"),
	/** The Tortoise and Shell shields: a quicker launch and a ring of force where it ends. */
	Tortodrone  UMETA(DisplayName = "Tortodrone"),
	/** The Raider Buckler: the standard bash with an afterimage. */
	Targe       UMETA(DisplayName = "Targe")
};

/** A status the piece makes its wearer resist, and by how much, as the original's numbers give it. */
USTRUCT(BlueprintType)
struct FClockworksGearStatusResist
{
	GENERATED_BODY()

	/** Fire, Freeze, Shock, Poison, Stun, Sleep or Curse. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gear")
	FString Status;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gear")
	float Resist = 0.f;
};

/** Health a piece adds once the knight is at least MinDepth deep (the original's depth, 1 to 30). */
USTRUCT(BlueprintType)
struct FClockworksGearHealthStep
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gear")
	int32 MinDepth = 0;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gear")
	float Health = 0.f;
};

/** A loose rigid piece of an armour (the Merc's pylon, a tassel, a scarf), riding one of the knight's bones. */
USTRUCT(BlueprintType)
struct FClockworksGearPiece
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gear")
	TObjectPtr<UStaticMesh> Mesh;

	/** The knight's bone it rides. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gear")
	FName Bone;

	/** Placement on the bone. For a camera-facing piece only the location counts: its rotation follows the camera. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gear")
	FTransform Offset;

	/** Turns to face the camera every frame, as the original's billboards do (tassels, the Merc's glows). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gear")
	bool bFacesCamera = false;
};

/**
 * One bonus the piece grants, named as the original names it: RelativeDamageBonus, AttackSpeedIncrease,
 * ChargeTimeReduction and the like, for one weapon class or all of them.
 */
USTRUCT(BlueprintType)
struct FClockworksGearBonus
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gear")
	FString Kind;

	/** True when the bonus is for every weapon, not one class. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gear")
	bool bAllWeaponClasses = false;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gear")
	EClockworksWeaponClass WeaponClass = EClockworksWeaponClass::Sword;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gear")
	float Value = 0.f;

	/** The original's own label (LOW, MEDIUM, HIGH...), which the item card shows. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gear")
	FString Label;

	/** For a TaggedDamageBonus, the monster family it works against (Beast, Undead...). Empty otherwise. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gear")
	FString Tag;

	/** The data gave only the label; Value is the most common real number for it (user's decision, 2026-09-15). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gear")
	bool bValueInferred = false;
};

/**
 * One piece of knight gear: a helmet, an armour, a shield or a trinket. One DA_Gear_* asset per piece,
 * generated from the game's item.xml by Tools/SKImport (mine_gear.py -> gear.json -> generate_gear_assets.py).
 *
 * The PlayerState's replicated gear points at these, so each must be a real asset under Content/ (object
 * references replicate by path).
 *
 * Stats are the original's depth-scaled curves, sampled at the original depths in OriginalDepthSamples: the
 * same helmet defends more the deeper the knight goes. Gear counts as fully heated (level 10), whose extra
 * defense and health are HeatDefenseBonus and HeatHealth (user's decision, 2026-09-15). The rules that turn
 * these numbers into defense, health and resistance live in ClockworksGearStats.
 */
UCLASS(BlueprintType)
class UClockworksGearDefinition : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:

	virtual FPrimaryAssetId GetPrimaryAssetId() const override { return FPrimaryAssetId(FPrimaryAssetType(TEXT("Gear")), GetFName()); }

	/** The original depths every curve on a gear asset is sampled at, in order. */
	static const TArray<float>& OriginalDepthSamples();

	/** A curve's value at an original depth: straight lines between samples, flat past either end. */
	static float ReadCurve(const TArray<float>& Curve, float OriginalDepth);

	/**
	 * Every machine, cosmetic: shows the piece's static model on MainMesh with one child component per extra
	 * piece, painted in its skin, placed by MeshOffset. A null piece empties both. Helmets and shields.
	 */
	static void ShowModel(const UClockworksGearDefinition* Gear, UStaticMeshComponent* MainMesh, TArray<TObjectPtr<UStaticMeshComponent>>& ExtraComponents);

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear")
	FText DisplayName;

	/** The original's flavour text, shown at the bottom of the item card. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear")
	FText Flavor;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear")
	EClockworksGearSlot Slot = EClockworksGearSlot::Helmet;

	/** The original's star rating, 0 to 5. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear", meta = (ClampMin = "0", ClampMax = "5"))
	int32 StarRating = 0;

	/** The piece this one is upgraded from in the original's recipes; groups a line into tiers. Nothing is crafted. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear")
	TObjectPtr<UClockworksGearDefinition> UpgradesFrom;

	/** The line or set the piece belongs to (Cobalt, Wolver Cap...), for grouping. Empty when it has none. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear")
	FString Line;

	/** Never given out by the original (an underscore-named trinket); included by decision. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear")
	bool bUnreleased = false;

	/** The arsenal icon, colours baked in. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear")
	TObjectPtr<UTexture2D> Icon;

	// ----- look -----

	/** A helmet's or shield's model. Helmets ride bone_helmet, shields bone_shield / bone_shield_away. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Visual")
	TObjectPtr<UStaticMesh> Mesh;

	/** The model's other pieces, drawn with Mesh at the same place. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Visual")
	TArray<TObjectPtr<UStaticMesh>> ExtraMeshes;

	/** The skin painted on Mesh and its pieces wherever they wear a placeholder. Null keeps their own. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Visual")
	TObjectPtr<UMaterialInterface> MeshMaterial;

	/** Where the model sits on its bone: the original's own placement for a shield built as a compound (Targe, Tortafist). */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Visual")
	FTransform MeshOffset;

	/** An armour's body: skinned to the knight's skeleton, it replaces the knight's own mesh. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Visual")
	TObjectPtr<USkeletalMesh> ArmorMesh;

	/** The armour's skins by material slot; a null entry keeps the mesh's own. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Visual")
	TArray<TObjectPtr<UMaterialInterface>> ArmorMaterials;

	/** The armour's loose pieces the skinned import leaves out (pylons, tassels, scarves). */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Visual")
	TArray<FClockworksGearPiece> ArmorPieces;

	/**
	 * Tinted skins by the imported material they replace (a material's name on the model): the original colours these
	 * pieces at run time, so their skins were baked from its colour tables and the personal-colour areas are shifted by
	 * M_GearSkin. Applies to helmets, shields and armour alike.
	 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Visual")
	TMap<FName, TObjectPtr<UMaterialInterface>> SkinSwaps;

	/** A helmet that hides the knight's face (the original's showEyes false: the Padded, Quilted and Starlit Hunting Caps). */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Visual")
	bool bHidesFace = false;

	// ----- stats -----

	/** Defense against each damage type, sampled at OriginalDepthSamples. Empty when the piece gives none. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Stats")
	TArray<float> NormalDefense;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Stats")
	TArray<float> PiercingDefense;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Stats")
	TArray<float> ElementalDefense;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Stats")
	TArray<float> ShadowDefense;

	/** What level 10 adds to every defense the piece has. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Stats")
	float HeatDefenseBonus = 0.f;

	/**
	 * What level 10 adds to the knight's health (helmets and armour). The original gates these by depth, in
	 * steps rather than a curve: a 5-star helmet adds 40, another 80 from depth 8 and another 80 from depth 18.
	 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Stats")
	TArray<FClockworksGearHealthStep> HeatHealth;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Stats")
	TArray<FClockworksGearStatusResist> StatusResists;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Stats")
	TArray<FClockworksGearBonus> Bonuses;

	// ----- shield -----

	/** The shield's health, sampled at OriginalDepthSamples. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Shield")
	TArray<float> ShieldHealth;

	/** Seconds after the last block before the shield starts to refill (the original's regenTime is the whole refill). */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Shield", meta = (ClampMin = "0.0"))
	float ShieldRegenSeconds = 6.f;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Shield", meta = (ClampMin = "0.0"))
	float ShieldHitSeconds = 3.f;

	/** How long a shattered shield stays broken. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Shield", meta = (ClampMin = "0.0"))
	float ShieldBreakSeconds = 8.f;

	/** The original's defendingSpeed: added to walk speed while blocking (-0.5 is half speed). */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Shield")
	float ShieldDefendingSpeed = -0.5f;

	/** Which of the original's shield bashes the shield has (Shield/Bash, Rank N; a Tortoise shield's Tortodrone bash is reported as its own name). */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Shield")
	FString ShieldBash;

	/** The bash this shield does. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Shield")
	EClockworksShieldBashKind ShieldBashKind = EClockworksShieldBashKind::Standard;

	/** The bash's rank: the shield's stars in the original. Sizes a Tortodrone bash's ring (rank 3, 4, 5). */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Shield")
	int32 ShieldBashRank = 0;

	/**
	 * The bash's damage before defense, sampled at OriginalDepthSamples: the original's handgun damage curve at the
	 * shield's stars (PC/Damage/Handgun/Handgun Base). Empty keeps the bash ability's own number.
	 */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Shield")
	TArray<float> ShieldBashDamage;

	/** The push-back a block gives, in the original's Knock-Back Power; zero for none. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gear|Shield", meta = (ClampMin = "0.0"))
	float ShieldPushBack = 0.f;
};
