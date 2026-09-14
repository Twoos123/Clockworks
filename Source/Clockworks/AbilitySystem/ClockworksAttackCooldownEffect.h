// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameplayEffect.h"
#include "ClockworksAttackCooldownEffect.generated.h"

/**
 * Timed effect that grants Cooldown.Attack for a SetByCaller duration (Data.Cooldown), set by an
 * enemy attack ability when it commits. While the tag is present the attack refuses to activate,
 * which is the gap between an enemy's swings that the player gets to punish.
 */
UCLASS()
class UClockworksAttackCooldownEffect : public UGameplayEffect
{
	GENERATED_BODY()

public:

	UClockworksAttackCooldownEffect();
};
