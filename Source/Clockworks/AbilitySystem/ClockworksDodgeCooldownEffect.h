// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameplayEffect.h"
#include "ClockworksDodgeCooldownEffect.generated.h"

/**
 * Timed effect that grants Cooldown.Dodge for a SetByCaller duration (Data.Cooldown), set by the
 * dodge ability when it commits. While the tag is present the dodge refuses to activate.
 */
UCLASS()
class UClockworksDodgeCooldownEffect : public UGameplayEffect
{
	GENERATED_BODY()

public:

	UClockworksDodgeCooldownEffect();
};
