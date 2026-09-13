// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameplayEffect.h"
#include "ClockworksDamageEffect.generated.h"

/**
 * Instant effect that delivers raw damage into the target's Damage meta attribute. The amount is
 * a SetByCaller magnitude keyed by Data.Damage, set by the attacking ability. The target's
 * attribute set turns it into Shield and Health changes.
 */
UCLASS()
class UClockworksDamageEffect : public UGameplayEffect
{
	GENERATED_BODY()

public:

	UClockworksDamageEffect();
};
