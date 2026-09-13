// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "ClockworksGameplayAbility.h"
#include "ClockworksSwordAttackAbility.generated.h"

class UAbilitySystemComponent;
class UAbilityTask_WaitInputPress;
class UAnimMontage;
struct FOverlapResult;

/** One swing of a combo. Timing comes from here, never from the animation. */
USTRUCT(BlueprintType)
struct FClockworksSwordComboStep
{
	GENERATED_BODY()

	/** Optional. Played for the visuals only. Needs a slot named DefaultSlot in the character's Animation Blueprint. */
	UPROPERTY(EditDefaultsOnly, Category = "Step")
	TObjectPtr<UAnimMontage> Montage;

	UPROPERTY(EditDefaultsOnly, Category = "Step", meta = (ClampMin = "0.01"))
	float MontagePlayRate = 1.f;

	/** Seconds before the hitbox goes live. Rotation is locked; movement is slowed. */
	UPROPERTY(EditDefaultsOnly, Category = "Step", meta = (ClampMin = "0.0"))
	float WindupSeconds = 0.2f;

	/** Seconds the hitbox stays live. Rotation still locked. */
	UPROPERTY(EditDefaultsOnly, Category = "Step", meta = (ClampMin = "0.0"))
	float ActiveSeconds = 0.15f;

	/** Seconds after the hitbox closes before the character is free again. Zero ends the swing at once. */
	UPROPERTY(EditDefaultsOnly, Category = "Step", meta = (ClampMin = "0.0"))
	float RecoverySeconds = 0.f;

	/** If set, the character cannot walk during this step's recovery; otherwise it is only slowed. */
	UPROPERTY(EditDefaultsOnly, Category = "Step")
	bool bLockMovementDuringRecovery = false;

	/**
	 * Forward step while the hitbox is live, in cm/s along the facing. Distance = LungeSpeed x
	 * ActiveSeconds. Spiral Knights swings carry the knight forward; zero disables it.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Step", meta = (ClampMin = "0.0"))
	float LungeSpeed = 300.f;

	/** Multiplies BaseDamage for this swing. */
	UPROPERTY(EditDefaultsOnly, Category = "Step", meta = (ClampMin = "0.0"))
	float DamageMultiplier = 1.f;
};

/**
 * The sword combo. Each press of the attack button is one swing in three timed phases:
 *   windup   - committed; rotation locked, movement slowed (State.RotationLocked + State.Attacking)
 *   active   - hitbox live in front of the character; rotation still locked
 *   recovery - can't act; movement slowed or, for committed swings, locked (State.MovementLocked)
 *
 * Pressing attack again while a swing is running queues the next step. When the hitbox closes the
 * queued step starts immediately, skipping recovery, so the follow-through flows. With nothing queued
 * the current step's recovery runs and the ability ends. The first step has no recovery, so a single
 * press is one quick swing and the character is free again at once; later steps carry the commitment.
 *
 * The owning client predicts the whole timeline for responsiveness; only the server's copy runs the
 * hitbox and applies damage. Button presses reach both copies through the ability system's replicated
 * input events, which is why the ability is granted with an input ID.
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

	/** Begins ComboSteps[StepIndex]: montage, input listener, windup timer. */
	void StartStep(int32 StepIndex);

	UFUNCTION() void OnWindupFinished();
	UFUNCTION() void OnActiveFinished();
	UFUNCTION() void OnRecoveryFinished();
	UFUNCTION() void OnAttackPressed(float TimeWaited);

	/** One sweep of the hitbox. Server only. */
	void DoHitCheck();

	/** Build and apply the damage effect to one target. Server only. */
	void ApplyDamageTo(UAbilitySystemComponent* TargetAbilitySystemComponent, const FOverlapResult& Overlap);

	const FClockworksSwordComboStep& GetCurrentStep() const;

	/**
	 * The swings, in order. The defaults follow the Spiral Knights Calibur: a free first swing, then two
	 * committed follow-ups. Tune in BP_GA_SwordAttack.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Combo")
	TArray<FClockworksSwordComboStep> ComboSteps;

	/** Raw damage before the step multiplier, the attacker's AttackPower and the target's DefensePower. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Damage", meta = (ClampMin = "0.0"))
	float BaseDamage = 10.f;

	/** Radius of the sphere swept in front of the character, in cm. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Hitbox", meta = (ClampMin = "0.0"))
	float HitRadius = 90.f;

	/** Distance from the character's centre to the sphere's centre along its facing, in cm. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Hitbox", meta = (ClampMin = "0.0"))
	float HitForwardOffset = 110.f;

	/** Draws the hitbox sphere on the server while it is live. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Debug")
	bool bDrawDebugHitbox = false;

private:

	/** How often the live hitbox is re-checked, so a target walking into it mid-swing still gets hit. */
	static constexpr float HitCheckInterval = 1.f / 30.f;

	FTimerHandle HitCheckTimer;

	/** Listens for the next attack press during the current step. Replaced every step. */
	UPROPERTY()
	TObjectPtr<UAbilityTask_WaitInputPress> InputTask;

	/** Targets already hit by the current swing. Each target takes damage once per swing. */
	TSet<TWeakObjectPtr<AActor>> HitActors;

	int32 CurrentStepIndex = 0;

	/** The button was pressed during this step; chain into the next one when the hitbox closes. */
	bool bNextStepQueued = false;
};
