// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "ClockworksGameplayAbility.h"
#include "ClockworksEnemyRangedAbility.generated.h"

class AClockworksProjectile;
class UAnimMontage;

/**
 * An enemy's ranged attack: turn to the target, telegraph, fire one projectile along that line,
 * recover, cool down. The shot is aimed at where the target was when it fired, so a moving player
 * is already out of it; the answer to a shooter is a wall between you, which the projectile
 * respects, and the AI controller only starts this with a clear line of sight.
 *
 * Server only, like every enemy ability. The projectile actor replicates on its own.
 */
UCLASS()
class UClockworksEnemyRangedAbility : public UClockworksGameplayAbility
{
	GENERATED_BODY()

public:

	UClockworksEnemyRangedAbility();

protected:

	virtual void ActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, const FGameplayEventData* TriggerEventData) override;
	virtual void EndAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, bool bReplicateEndAbility, bool bWasCancelled) override;
	virtual void ApplyCooldown(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo) const override;

	UFUNCTION() void OnWindupFinished();
	UFUNCTION() void OnRecoveryFinished();

	/** What gets fired. A Blueprint child of AClockworksProjectile with the visual mesh. */
	UPROPERTY(EditDefaultsOnly, Category = "Ranged")
	TSubclassOf<AClockworksProjectile> ProjectileClass;

	/** Seconds of telegraph before the shot leaves. */
	UPROPERTY(EditDefaultsOnly, Category = "Ranged|Timing", meta = (ClampMin = "0.0"))
	float WindupSeconds = 0.6f;

	/** Seconds after the shot during which the enemy cannot act. */
	UPROPERTY(EditDefaultsOnly, Category = "Ranged|Timing", meta = (ClampMin = "0.0"))
	float RecoverySeconds = 0.5f;

	/** Seconds after activation before the next shot may start. */
	UPROPERTY(EditDefaultsOnly, Category = "Ranged|Timing", meta = (ClampMin = "0.0"))
	float CooldownSeconds = 2.f;

	/** Projectile speed in cm/s. Slow enough to see and step out of. */
	UPROPERTY(EditDefaultsOnly, Category = "Ranged", meta = (ClampMin = "1.0"))
	float ProjectileSpeed = 1100.f;

	/** Raw damage before the attacker's AttackPower and the target's DefensePower. */
	UPROPERTY(EditDefaultsOnly, Category = "Ranged|Damage", meta = (ClampMin = "0.0"))
	float BaseDamage = 8.f;

	/** Where the shot spawns, relative to the enemy: forward, right, up in cm. */
	UPROPERTY(EditDefaultsOnly, Category = "Ranged")
	FVector MuzzleOffset = FVector(60.f, 0.f, 40.f);

	/**
	 * Optional. Played at the start of the windup (a turret opening up). When set, AttackMontage plays
	 * at the shot and RecoveryMontage at the recovery; when unset, AttackMontage plays from the start.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Ranged|Animation")
	TObjectPtr<UAnimMontage> WindupMontage;

	/** Visuals only; the numbers above set the timing. Needs a DefaultSlot in the Animation Blueprint. */
	UPROPERTY(EditDefaultsOnly, Category = "Ranged|Animation")
	TObjectPtr<UAnimMontage> AttackMontage;

	/** Optional. Played when the recovery starts (a turret closing), only if WindupMontage is set. */
	UPROPERTY(EditDefaultsOnly, Category = "Ranged|Animation")
	TObjectPtr<UAnimMontage> RecoveryMontage;

	/** Plays a montage through the ability system (replicated to clients) if it and an anim instance exist. */
	void PlayPhaseMontage(UAnimMontage* Montage);

	UPROPERTY(EditDefaultsOnly, Category = "Ranged|Animation", meta = (ClampMin = "0.01"))
	float MontagePlayRate = 1.f;
};
