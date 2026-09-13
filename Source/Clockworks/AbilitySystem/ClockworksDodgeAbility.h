// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "ClockworksGameplayAbility.h"
#include "ClockworksDodgeAbility.generated.h"

class UAnimMontage;

/**
 * Dodge (Shift + right mouse): a short burst in the direction of movement, or the facing direction
 * when standing still, with a window of invulnerability and a cooldown. Blocked while attacking and
 * blocks attacking while it runs.
 */
UCLASS()
class UClockworksDodgeAbility : public UClockworksGameplayAbility
{
	GENERATED_BODY()

public:

	UClockworksDodgeAbility();

protected:

	virtual void ActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, const FGameplayEventData* TriggerEventData) override;
	virtual void EndAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, bool bReplicateEndAbility, bool bWasCancelled) override;
	virtual void ApplyCooldown(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo) const override;

	UFUNCTION() void OnInvulnerabilityFinished();
	UFUNCTION() void OnDodgeFinished();

	/** Launch speed, in cm/s. */
	UPROPERTY(EditDefaultsOnly, Category = "Dodge", meta = (ClampMin = "0.0"))
	float DodgeSpeed = 1200.f;

	/** Seconds of invulnerability from the start of the dodge. */
	UPROPERTY(EditDefaultsOnly, Category = "Dodge", meta = (ClampMin = "0.0"))
	float InvulnerableSeconds = 0.25f;

	/** Seconds the dodge occupies the character; nothing else can start until it ends. */
	UPROPERTY(EditDefaultsOnly, Category = "Dodge", meta = (ClampMin = "0.0"))
	float DodgeSeconds = 0.30f;

	/** Seconds after activation before the next dodge is allowed. */
	UPROPERTY(EditDefaultsOnly, Category = "Dodge", meta = (ClampMin = "0.0"))
	float CooldownSeconds = 0.8f;

	/** Optional. Visuals only; the numbers above set the timing. Needs a DefaultSlot in the Animation Blueprint. */
	UPROPERTY(EditDefaultsOnly, Category = "Dodge|Animation")
	TObjectPtr<UAnimMontage> DodgeMontage;

	UPROPERTY(EditDefaultsOnly, Category = "Dodge|Animation", meta = (ClampMin = "0.01"))
	float MontagePlayRate = 1.f;
};
