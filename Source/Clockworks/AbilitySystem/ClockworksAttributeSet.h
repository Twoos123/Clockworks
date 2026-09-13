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

/** Fired on the server after damage has been applied. Instigator is the ASC owner (PlayerState for players), Causer the attacking actor. */
DECLARE_MULTICAST_DELEGATE_FourParams(FClockworksDamagedSignature, AActor* /*Instigator*/, AActor* /*Causer*/, float /*Amount*/, FVector /*HitDirection*/);

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
