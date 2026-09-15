// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Abilities/GameplayAbility.h"
#include "GameplayTagContainer.h"
#include "ClockworksGameplayAbility.generated.h"

class ACharacter;
class UAbilitySystemComponent;
class UClockworksWeaponDefinition;
struct FClockworksDamageTypes;

/**
 * Which button an ability answers to. Granted abilities carry this as their input ID so a press
 * on an already-running ability reaches it (combo follow-ups) instead of being dropped.
 */
UENUM(BlueprintType)
enum class EClockworksAbilityInputID : uint8
{
	None = 0,
	Attack,
	Dodge,
	Shield,
	ShieldBash
};

/**
 * Base for Clockworks abilities. Instanced per actor and locally predicted: the owning client runs
 * its copy immediately for responsiveness, the server runs its own copy and is the only one that
 * changes gameplay state (damage, tags that gate damage). Each machine's instance manages its own
 * timers and local tags.
 */
UCLASS(Abstract)
class UClockworksGameplayAbility : public UGameplayAbility
{
	GENERATED_BODY()

public:

	UClockworksGameplayAbility();

	EClockworksAbilityInputID GetAbilityInputID() const { return AbilityInputID; }

	/**
	 * The faction tag carried by an ability system component, or an invalid tag if it has none.
	 * Public because things that are not abilities need the same rule: a bomb sitting on the floor
	 * has to decide who its blast is allowed to hurt, and it must decide it the same way a sword does.
	 */
	static FGameplayTag GetFactionTag(const UAbilitySystemComponent* AbilitySystemComponent);

	/**
	 * Writes a hit's damage onto an effect spec: the untyped total, which is what feeds the Damage
	 * meta attribute, and the same figure again under its damage type, which is what the attribute
	 * set resolves against the target's family.
	 *
	 * Public and static because the bomb and the projectile are actors, not abilities, and a hit
	 * has to be written the same way wherever it comes from or the weakness chart stops being true.
	 */
	static void SetDamageMagnitudes(const FGameplayEffectSpecHandle& Spec, float Amount, const FGameplayTag& DamageType);

	/** The party's depth on the demo's scale (0 the lobby ... 8 the Core), read off the replicated game state; 0 without one. */
	static int32 CurrentDemoDepth(const UWorld* World);

	/** A status's tick damage at the party's depth: the weapon data's table when it has one, else the flat Fallback. */
	static float StatusTickAt(const UWorld* World, const TArray<float>& Table, float Fallback);

	/**
	 * A hit's damage types at the party's depth: Types' main type (DefaultType when it names none), its second type and
	 * that type's share. OutSecond is left invalid and OutSecondShare zero for a hit of one type.
	 */
	static void ResolveDamageTypes(const UWorld* World, const FClockworksDamageTypes& Types, const FGameplayTag& DefaultType,
		FGameplayTag& OutPrimary, FGameplayTag& OutSecond, float& OutSecondShare);

	/** Writes Amount onto a spec split between two damage types, SecondShare of it SecondType's; one type when SecondType is invalid. */
	static void SetSplitDamageMagnitudes(const FGameplayEffectSpecHandle& Spec, float Amount, const FGameplayTag& PrimaryType,
		const FGameplayTag& SecondType, float SecondShare);

	/** Writes a hit's damage split by type (Normal, Piercing, Elemental, Shadow): each part and their total. */
	static void SetTypedDamageMagnitudes(const FGameplayEffectSpecHandle& Spec, const float Parts[4]);

	/**
	 * A monster attack's damage parts at the party's depth, from per-type tables indexed by the demo's depth (the
	 * original's numbers). False when every table is empty, so the caller falls back to its flat damage.
	 */
	static bool DepthDamageParts(const UWorld* World, const TArray<float>& Normal, const TArray<float>& Piercing,
		const TArray<float>& Elemental, const TArray<float>& Shadow, float OutParts[4]);

	/**
	 * Rolls a weapon's status chance and, on a hit, applies it for Seconds.
	 *
	 * Server only: the roll has to happen once, on the machine that decides, or the two copies of
	 * the game would disagree about whether a target is on fire. Public and static for the same
	 * reason SetDamageMagnitudes is: bombs and projectiles inflict statuses too.
	 */
	static void TryApplyStatus(UAbilitySystemComponent* Source, UAbilitySystemComponent* Target,
		TSubclassOf<UGameplayEffect> StatusEffect, float Chance, float Seconds, float TickDamage);

	/** This ability's own damage type, before any weapon overrides it. The targeting readout reads it off class defaults. */
	const FGameplayTag& GetDamageTypeFallback() const { return DamageTypeFallback; }

	/**
	 * A monster attack's damage by the demo's depth (index 0 to 8) for one damage type (0 Normal, 1 Piercing, 2 Elemental,
	 * 3 Shadow). Empty unless the attack carries the original's numbers. The targeting readout reads it off class defaults.
	 */
	const TArray<float>& GetDamageByDepth(int32 Kind) const
	{
		switch (Kind)
		{
		case 1:  return PiercingDamageByDepth;
		case 2:  return ElementalDamageByDepth;
		case 3:  return ShadowDamageByDepth;
		default: return NormalDamageByDepth;
		}
	}

	/**
	 * The original's damage by the demo's depth, per damage type: a mixed attack's split. When any is set, a monster
	 * attack uses them instead of its flat damage and type. Written by apply_monster_numbers.py
	 * (research: D:\Dev\SKAssets\_research\monsters\monster_numbers.json).
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Attack|Depth")
	TArray<float> NormalDamageByDepth;

	UPROPERTY(EditDefaultsOnly, Category = "Attack|Depth")
	TArray<float> PiercingDamageByDepth;

	UPROPERTY(EditDefaultsOnly, Category = "Attack|Depth")
	TArray<float> ElementalDamageByDepth;

	UPROPERTY(EditDefaultsOnly, Category = "Attack|Depth")
	TArray<float> ShadowDamageByDepth;

protected:

	/**
	 * The weapon definition this ability was granted by, or null when it is not a weapon's ability.
	 * The loadout grants a weapon's attack with the definition as the spec's source object, so this
	 * is how an attack finds out which weapon is swinging it.
	 */
	const UClockworksWeaponDefinition* GetSourceWeapon() const;

	/** The drawn weapon's damage type, falling back to this ability's own. */
	FGameplayTag ResolveDamageType() const;

	/** The drawn weapon's damage multiplier, or one, raised by the knight's gear damage bonus for the weapon's class. */
	float ResolveDamageMultiplier() const;

	/** A charge time shortened by the knight's gear charge time reduction for the drawn weapon's class. */
	float ResolveChargeSeconds(float Seconds) const;

	/**
	 * An attack phase (windup, fire, recovery, a lunge's delay) shortened by the knight's gear attack speed for the
	 * drawn weapon's class. The original divides every attack phase by it, but never a charge, a reload, or how long
	 * and how far a lunge moves.
	 */
	float ResolveAttackSeconds(float Seconds) const;

	/**
	 * Applies the drawn weapon's status, falling back to this ability's own. Server only.
	 * One call covers "this weapon freezes" and "this ability always stuns" without the caller
	 * having to know which of the two it is dealing with.
	 */
	void ApplyWeaponStatus(UAbilitySystemComponent* Source, UAbilitySystemComponent* Target) const;

	/**
	 * The status this weapon inflicts, how often it lands, and for how long. Spiral Knights hangs a
	 * status off most weapons past the starter tier, and it is the second reason to carry more than
	 * one: a weapon that freezes is worth having even where its damage type is resisted.
	 *
	 * Left unset on anything that inflicts nothing, which is every starter weapon and the dodge.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Status")
	TSubclassOf<UGameplayEffect> StatusEffect;

	/** Chance from 0 to 1 that a landed hit inflicts it. Zero means never. */
	UPROPERTY(EditDefaultsOnly, Category = "Status", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float StatusChance = 0.f;

	UPROPERTY(EditDefaultsOnly, Category = "Status", meta = (ClampMin = "0.0"))
	float StatusSeconds = 4.f;

	/** Damage per tick, for a status that burns. Ignored by the others. */
	UPROPERTY(EditDefaultsOnly, Category = "Status", meta = (ClampMin = "0.0"))
	float StatusTickDamage = 4.f;

	/**
	 * The damage type used when the drawn weapon names none, and the only one an ability that is not
	 * a weapon's (the shield bash, an enemy's claw) ever has. Unset means Normal.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Status", meta = (Categories = "Data.Damage"))
	FGameplayTag DamageTypeFallback;


	/** Set in the subclass constructor. None means the ability is never driven by a button. */
	UPROPERTY(VisibleDefaultsOnly, Category = "Input")
	EClockworksAbilityInputID AbilityInputID = EClockworksAbilityInputID::None;

	/** The character this ability is acting through, or null. */
	ACharacter* GetAvatarCharacter() const;

	/** True on the server's copy of a running ability. False on the predicting client. */
	bool HasServerAuthority() const;

	/**
	 * Add or remove a loose tag on this machine's ability system component only (no replication).
	 * Both the server and the owning client run the ability, so each adds and removes its own copy.
	 */
	void AddLocalTag(const FGameplayTag& Tag) const;
	void RemoveLocalTag(const FGameplayTag& Tag) const;

	/** Timer durations of zero would never fire; keep every phase at least one tick long. */
	static float ClampPhaseSeconds(float Seconds);
};
