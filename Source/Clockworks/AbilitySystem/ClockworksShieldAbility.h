// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "ClockworksGameplayAbility.h"
#include "ClockworksShieldAbility.generated.h"

class AClockworksCharacter;
class UAbilityTask_WaitInputRelease;

/**
 * The raised shield (hold right mouse). While it runs the knight owns State.Shielding: the Shield
 * attribute takes every hit instead of Health (the attribute set's rule), movement runs at the
 * character's shield speed, and attacks are refused. Releasing the button ends it; a shattered
 * shield (State.ShieldBroken, set by the character when the Shield attribute hits zero) cancels it
 * and keeps it from coming back up until the break wears off.
 *
 * The shield's numbers (health, regeneration, break time, clips) live on the character, because
 * the shield is part of the knight's kit rather than a weapon in the toolbar. This ability is only
 * the button. Owning client predicts, server decides; the raised/lowered state itself replicates
 * from the character so other players see the shield move to the arm.
 */
UCLASS()
class UClockworksShieldAbility : public UClockworksGameplayAbility
{
	GENERATED_BODY()

public:

	UClockworksShieldAbility();

protected:

	virtual void ActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, const FGameplayEventData* TriggerEventData) override;
	virtual void EndAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, bool bReplicateEndAbility, bool bWasCancelled) override;

	UFUNCTION() void OnShieldReleased(float TimeWaited);

	AClockworksCharacter* GetKnight() const;

	/** Server only: the worn shield's push-back on the raise, shoving monsters touching the knight away. */
	void PushBack(AClockworksCharacter* Knight);

private:

	/** Listens for the button coming up. */
	UPROPERTY()
	TObjectPtr<UAbilityTask_WaitInputRelease> ReleaseTask;
};
