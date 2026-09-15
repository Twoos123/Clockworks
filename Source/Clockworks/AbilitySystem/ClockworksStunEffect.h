// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameplayEffect.h"
#include "ClockworksStunEffect.generated.h"

/**
 * Timed effect that grants State.Stunned for a SetByCaller duration (Data.Duration). Applied by the
 * shield bash to whatever it hits. While the tag is present an enemy's brain stops it, its running
 * attack is cancelled and no new one can start: the shield bash buys the punish window.
 */
UCLASS()
class UClockworksStunEffect : public UGameplayEffect
{
	GENERATED_BODY()

public:

	UClockworksStunEffect();
};
