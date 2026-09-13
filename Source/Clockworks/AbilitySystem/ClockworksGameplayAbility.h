// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Abilities/GameplayAbility.h"
#include "GameplayTagContainer.h"
#include "ClockworksGameplayAbility.generated.h"

class ACharacter;
class UAbilitySystemComponent;

/**
 * Which button an ability answers to. Granted abilities carry this as their input ID so a press
 * on an already-running ability reaches it (combo follow-ups) instead of being dropped.
 */
UENUM(BlueprintType)
enum class EClockworksAbilityInputID : uint8
{
	None = 0,
	Attack,
	Dodge
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

protected:

	/** Set in the subclass constructor. None means the ability is never driven by a button. */
	UPROPERTY(VisibleDefaultsOnly, Category = "Input")
	EClockworksAbilityInputID AbilityInputID = EClockworksAbilityInputID::None;

	/** The character this ability is acting through, or null. */
	ACharacter* GetAvatarCharacter() const;

	/** True on the server's copy of a running ability. False on the predicting client. */
	bool HasServerAuthority() const;

	/** The faction tag carried by an ability system component, or an invalid tag if it has none. */
	static FGameplayTag GetFactionTag(const UAbilitySystemComponent* AbilitySystemComponent);

	/**
	 * Add or remove a loose tag on this machine's ability system component only (no replication).
	 * Both the server and the owning client run the ability, so each adds and removes its own copy.
	 */
	void AddLocalTag(const FGameplayTag& Tag) const;
	void RemoveLocalTag(const FGameplayTag& Tag) const;

	/** Timer durations of zero would never fire; keep every phase at least one tick long. */
	static float ClampPhaseSeconds(float Seconds);
};
