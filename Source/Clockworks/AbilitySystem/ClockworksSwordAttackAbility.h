// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "ClockworksGameplayAbility.h"
#include "ClockworksSwordAttackAbility.generated.h"

class UAbilitySystemComponent;
class UAnimMontage;
struct FOverlapResult;

/**
 * The sword swing, in three timed phases:
 *   windup   - committed; rotation locked, movement slowed (State.RotationLocked + State.Attacking)
 *   active   - hitbox live in front of the character; rotation still locked
 *   recovery - can't act; movement still slowed
 *
 * Timing comes from the tunables below, never from the animation, so feel can be tuned without
 * touching assets. The owning client predicts the whole timeline for responsiveness; only the
 * server's copy runs the hitbox and applies damage.
 */
UCLASS()
class UClockworksSwordAttackAbility : public UClockworksGameplayAbility
{
	GENERATED_BODY()

public:

	UClockworksSwordAttackAbility();

protected:

	virtual void ActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, const FGameplayEventData* TriggerEventData) override;
	virtual void EndAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, bool bReplicateEndAbility, bool bWasCancelled) override;

	UFUNCTION() void OnWindupFinished();
	UFUNCTION() void OnActiveFinished();
	UFUNCTION() void OnRecoveryFinished();

	/** One sweep of the hitbox. Server only. */
	void DoHitCheck();

	/** Build and apply the damage effect to one target. Server only. */
	void ApplyDamageTo(UAbilitySystemComponent* TargetAbilitySystemComponent, const FOverlapResult& Overlap);

	/** Seconds before the hitbox goes live. The player is committed from the first frame. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Timing", meta = (ClampMin = "0.0"))
	float WindupSeconds = 0.20f;

	/** Seconds the hitbox stays live. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Timing", meta = (ClampMin = "0.0"))
	float ActiveSeconds = 0.15f;

	/** Seconds after the hitbox closes during which nothing else can be started. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Timing", meta = (ClampMin = "0.0"))
	float RecoverySeconds = 0.35f;

	/** Raw damage before the attacker's AttackPower is added and the target's DefensePower subtracted. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Damage", meta = (ClampMin = "0.0"))
	float BaseDamage = 10.f;

	/** Radius of the sphere swept in front of the character, in cm. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Hitbox", meta = (ClampMin = "0.0"))
	float HitRadius = 90.f;

	/** Distance from the character's centre to the sphere's centre along its facing, in cm. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Hitbox", meta = (ClampMin = "0.0"))
	float HitForwardOffset = 110.f;

	/** Forward burst when the hitbox opens, in cm/s. Zero disables it. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Feel", meta = (ClampMin = "0.0"))
	float LungeSpeed = 0.f;

	/** Optional. Played for the visuals only; the phases above set the timing. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Animation")
	TObjectPtr<UAnimMontage> AttackMontage;

	UPROPERTY(EditDefaultsOnly, Category = "Sword|Animation", meta = (ClampMin = "0.01"))
	float MontagePlayRate = 1.f;

	/** Draws the hitbox sphere on the server while it is live. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Debug")
	bool bDrawDebugHitbox = false;

private:

	/** How often the live hitbox is re-checked, so a target walking into it mid-swing still gets hit. */
	static constexpr float HitCheckInterval = 1.f / 30.f;

	FTimerHandle HitCheckTimer;

	/** Targets already hit by this swing. Each target takes damage once per activation. */
	TSet<TWeakObjectPtr<AActor>> HitActors;
};
