// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerState.h"
#include "AbilitySystemInterface.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksPlayerState.generated.h"

class UAbilitySystemComponent;
class UClockworksAttributeSet;

/**
 * Hosts a player's AbilitySystemComponent and attributes. Lives here rather than on the character
 * so health, abilities and effects survive the character being destroyed and respawned.
 */
UCLASS()
class AClockworksPlayerState : public APlayerState, public IAbilitySystemInterface
{
	GENERATED_BODY()

public:

	AClockworksPlayerState();

	virtual UAbilitySystemComponent* GetAbilitySystemComponent() const override { return AbilitySystemComponent; }

	UClockworksAttributeSet* GetAttributeSet() const { return AttributeSet; }

	/** Server-only bookkeeping so a respawned character doesn't grant or initialise twice. */
	bool bAbilitiesGranted = false;
	bool bAttributesInitialised = false;

protected:

	UPROPERTY(VisibleAnywhere, Category = "Abilities")
	TObjectPtr<UAbilitySystemComponent> AbilitySystemComponent;

	UPROPERTY()
	TObjectPtr<UClockworksAttributeSet> AttributeSet;
};
