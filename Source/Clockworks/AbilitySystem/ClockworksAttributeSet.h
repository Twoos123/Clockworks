// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "AttributeSet.h"
#include "AbilitySystemComponent.h"
#include "ClockworksAttributeSet.generated.h"

/**
 * Standard accessor bundle for one attribute: static Get<Name>Attribute(), Get<Name>(), Set<Name>()
 * and Init<Name>(). The engine's AttributeSet.h shows this macro as an example but does not define it.
 */
#ifndef ATTRIBUTE_ACCESSORS
#define ATTRIBUTE_ACCESSORS(ClassName, PropertyName) \
	GAMEPLAYATTRIBUTE_PROPERTY_GETTER(ClassName, PropertyName) \
	GAMEPLAYATTRIBUTE_VALUE_GETTER(PropertyName) \
	GAMEPLAYATTRIBUTE_VALUE_SETTER(PropertyName) \
	GAMEPLAYATTRIBUTE_VALUE_INITTER(PropertyName)
#endif

/**
 * Fired on the server after damage has been applied. Instigator is the ASC owner (PlayerState for
 * players), Causer the attacking actor.
 *
 * FamilyMultiplier is how the target's family took the hit: above one it was a weakness, below one
 * a resistance, exactly one neutral. Spiral Knights colours its damage numbers by precisely this,
 * and it is the only way a player learns the weakness chart without reading it.
 */
DECLARE_MULTICAST_DELEGATE_SixParams(FClockworksDamagedSignature, AActor* /*Instigator*/, AActor* /*Causer*/, float /*Amount*/, FVector /*HitDirection*/, float /*KnockbackMultiplier*/, float /*FamilyMultiplier*/);

/** Fired on the server after a raised shield took a hit instead of Health. */
DECLARE_MULTICAST_DELEGATE_ThreeParams(FClockworksBlockedSignature, float /*Absorbed*/, FVector /*HitDirection*/, float /*KnockbackMultiplier*/);

/**
 * Attributes shared by players and enemies. Lives as a subobject of whatever actor owns the
 * AbilitySystemComponent (the PlayerState for players, the pawn for enemies).
 *
 * Damage is a "meta" attribute: never replicated, never read directly. A damage effect adds to it,
 * PostGameplayEffectExecute turns it into Shield and Health changes on the server, then zeroes it.
 */
UCLASS()
class UClockworksAttributeSet : public UAttributeSet
{
	GENERATED_BODY()

public:

	UClockworksAttributeSet();

	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;
	virtual void PreAttributeChange(const FGameplayAttribute& Attribute, float& NewValue) override;
	virtual void PostGameplayEffectExecute(const FGameplayEffectModCallbackData& Data) override;

	/** Server only: broadcast after each damage application that got through. */
	FClockworksDamagedSignature OnDamaged;

	/** Server only: broadcast once when Health reaches zero. */
	FSimpleMulticastDelegate OnOutOfHealth;

	/** Server only: broadcast after a raised shield absorbed a hit (State.Shielding on the target). */
	FClockworksBlockedSignature OnBlocked;

	/** Server only: broadcast when a blocked hit took the shield to zero. */
	FSimpleMulticastDelegate OnShieldBroken;

	/**
	 * How much of a hit of DamageTypeTag a target of FamilyTag actually takes.
	 *
	 * This is the Spiral Knights weakness chart, and it is the reason a weapon is worth choosing:
	 * every family is weak to one damage type and strong against another, so the same sword is
	 * excellent in one room and close to useless in the next. The numbers are the wiki's — a
	 * weakness lands about 166% and a resistance about 30%.
	 *
	 * A target with no family tag takes everything at face value, which is what a training dummy
	 * and a player knight should do.
	 */
	static float GetFamilyMultiplier(const FGameplayTag& FamilyTag, const FGameplayTag& DamageTypeTag);

	/** The family tag on an ability system component, or an invalid tag if it carries none. */
	static FGameplayTag GetFamilyTag(const UAbilitySystemComponent* AbilitySystemComponent);

	/**
	 * Server only, bound to the owning ability system's AbilityActivatedCallbacks: a cursed bearer pays health each time it
	 * uses an attack (the original's rule: once per use, not per hit, and the attack still happens). The cost is the curse's
	 * own damage at the depth it was inflicted, never more than CurseCostCap (user's decision 2026-09-15).
	 */
	void HandleAbilityActivated(class UGameplayAbility* Ability);

	/** The damage a status stored when it was inflicted (SetByCaller Data.Damage), the largest among its active copies; zero without it. */
	static float ActiveStatusDamage(const UAbilitySystemComponent& AbilitySystemComponent, const FGameplayTag& StatusTag);

	/** The original's maximum curse damage (Base/Curse maxCurseDamage 40). */
	static constexpr float CurseCostCap = 40.f;

public:

	UPROPERTY(BlueprintReadOnly, ReplicatedUsing = OnRep_Health, Category = "Attributes")
	FGameplayAttributeData Health;
	ATTRIBUTE_ACCESSORS(UClockworksAttributeSet, Health)

	UPROPERTY(BlueprintReadOnly, ReplicatedUsing = OnRep_MaxHealth, Category = "Attributes")
	FGameplayAttributeData MaxHealth;
	ATTRIBUTE_ACCESSORS(UClockworksAttributeSet, MaxHealth)

	UPROPERTY(BlueprintReadOnly, ReplicatedUsing = OnRep_Shield, Category = "Attributes")
	FGameplayAttributeData Shield;
	ATTRIBUTE_ACCESSORS(UClockworksAttributeSet, Shield)

	UPROPERTY(BlueprintReadOnly, ReplicatedUsing = OnRep_MaxShield, Category = "Attributes")
	FGameplayAttributeData MaxShield;
	ATTRIBUTE_ACCESSORS(UClockworksAttributeSet, MaxShield)

	UPROPERTY(BlueprintReadOnly, ReplicatedUsing = OnRep_AttackPower, Category = "Attributes")
	FGameplayAttributeData AttackPower;
	ATTRIBUTE_ACCESSORS(UClockworksAttributeSet, AttackPower)

	UPROPERTY(BlueprintReadOnly, ReplicatedUsing = OnRep_DefensePower, Category = "Attributes")
	FGameplayAttributeData DefensePower;
	ATTRIBUTE_ACCESSORS(UClockworksAttributeSet, DefensePower)

	UPROPERTY(BlueprintReadOnly, ReplicatedUsing = OnRep_MoveSpeed, Category = "Attributes")
	FGameplayAttributeData MoveSpeed;
	ATTRIBUTE_ACCESSORS(UClockworksAttributeSet, MoveSpeed)

	/** Meta attribute. Server only, consumed in PostGameplayEffectExecute. */
	UPROPERTY(BlueprintReadOnly, Category = "Attributes|Meta")
	FGameplayAttributeData Damage;
	ATTRIBUTE_ACCESSORS(UClockworksAttributeSet, Damage)

protected:

	UFUNCTION() void OnRep_Health(const FGameplayAttributeData& OldValue);
	UFUNCTION() void OnRep_MaxHealth(const FGameplayAttributeData& OldValue);
	UFUNCTION() void OnRep_Shield(const FGameplayAttributeData& OldValue);
	UFUNCTION() void OnRep_MaxShield(const FGameplayAttributeData& OldValue);
	UFUNCTION() void OnRep_AttackPower(const FGameplayAttributeData& OldValue);
	UFUNCTION() void OnRep_DefensePower(const FGameplayAttributeData& OldValue);
	UFUNCTION() void OnRep_MoveSpeed(const FGameplayAttributeData& OldValue);
};
