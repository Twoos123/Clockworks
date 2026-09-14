// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "ClockworksGameplayAbility.h"
#include "ClockworksSwordAttackAbility.generated.h"

class AClockworksCharacter;
class UAbilitySystemComponent;
class UAbilityTask_WaitInputPress;
class UAbilityTask_WaitInputRelease;
class UAnimMontage;
class UAnimSequenceBase;
struct FOverlapResult;

/**
 * One swing of a combo. Timing comes from here, never from the animation: each clip is stretched
 * or squeezed to fill its phase, the way Spiral Knights runs its start/fire/end clips at per-weapon
 * speed multipliers.
 */
USTRUCT(BlueprintType)
struct FClockworksSwordComboStep
{
	GENERATED_BODY()

	/** Optional raw clip for the windup (the SK *_start clip). Played in DefaultSlot, fitted to WindupSeconds. */
	UPROPERTY(EditDefaultsOnly, Category = "Step|Animation")
	TObjectPtr<UAnimSequenceBase> WindupAnim;

	/** Optional montage for the swing itself, the older way. Played at MontagePlayRate. Ignored when AttackAnim is set. */
	UPROPERTY(EditDefaultsOnly, Category = "Step|Animation")
	TObjectPtr<UAnimMontage> Montage;

	UPROPERTY(EditDefaultsOnly, Category = "Step|Animation", meta = (ClampMin = "0.01"))
	float MontagePlayRate = 1.f;

	/** Optional raw clip for the swing (the SK *_fire clip), fitted to ActiveSeconds. Preferred over Montage. */
	UPROPERTY(EditDefaultsOnly, Category = "Step|Animation")
	TObjectPtr<UAnimSequenceBase> AttackAnim;

	/** Optional raw clip for the follow-through (the SK *_end clip), fitted to RecoverySeconds. */
	UPROPERTY(EditDefaultsOnly, Category = "Step|Animation")
	TObjectPtr<UAnimSequenceBase> RecoveryAnim;

	/** Seconds before the hitbox goes live. Rotation is locked; movement is slowed. */
	UPROPERTY(EditDefaultsOnly, Category = "Step", meta = (ClampMin = "0.0"))
	float WindupSeconds = 0.133f;

	/** Seconds the hitbox stays live. Rotation still locked. */
	UPROPERTY(EditDefaultsOnly, Category = "Step", meta = (ClampMin = "0.0"))
	float ActiveSeconds = 0.217f;

	/** Seconds after the hitbox closes before the character is free again. Zero ends the swing at once. */
	UPROPERTY(EditDefaultsOnly, Category = "Step", meta = (ClampMin = "0.0"))
	float RecoverySeconds = 0.f;

	/** If set, the character cannot walk during this step's recovery; otherwise it is only slowed. */
	UPROPERTY(EditDefaultsOnly, Category = "Step")
	bool bLockMovementDuringRecovery = false;

	/** Forward step of the swing, in cm/s along the facing. Zero disables it. Spiral Knights swings carry the knight forward. */
	UPROPERTY(EditDefaultsOnly, Category = "Step|Lunge", meta = (ClampMin = "0.0"))
	float LungeSpeed = 0.f;

	/** How long the forward step lasts. Zero means the whole active window. */
	UPROPERTY(EditDefaultsOnly, Category = "Step|Lunge", meta = (ClampMin = "0.0"))
	float LungeSeconds = 0.f;

	/** Seconds after the hitbox opens before the forward step begins. */
	UPROPERTY(EditDefaultsOnly, Category = "Step|Lunge", meta = (ClampMin = "0.0"))
	float LungeDelaySeconds = 0.f;

	/** Multiplies BaseDamage for this swing. */
	UPROPERTY(EditDefaultsOnly, Category = "Step|Damage", meta = (ClampMin = "0.0"))
	float DamageMultiplier = 1.f;

	/** Multiplies the target's own knockback speed. The Calibur's opener barely nudges; its finisher shoves. */
	UPROPERTY(EditDefaultsOnly, Category = "Step|Damage", meta = (ClampMin = "0.0"))
	float KnockbackMultiplier = 1.f;
};

/**
 * The sword: a three-hit combo and a charge attack, both modelled on the Spiral Knights Calibur.
 *
 * Combo. Each press of the attack button is one swing in three timed phases:
 *   windup   - committed; rotation locked, movement slowed (State.RotationLocked + State.Attacking)
 *   active   - hitbox live in front of the character; rotation still locked
 *   recovery - can't act; movement slowed or, for committed swings, locked (State.MovementLocked)
 * Pressing again during a swing queues the next step, which starts the moment the hitbox closes.
 * With nothing queued the swing recovers and the ability ends. The first step has no recovery, so
 * a single press is one quick swing and the knight is free at once; later steps carry commitment.
 *
 * Charge. Keep the button held after a swing and the knight starts charging: the hold clip loops,
 * movement runs at the weapon's charge speed and aiming follows the cursor again. After
 * ChargeSeconds the aura flashes; releasing then fires the Round House: a release clip, a spinning
 * clip during which four hit samples sweep behind, left, front and right of the knight (so a target
 * can be hit more than once), a short forward step, then a locked recovery. Releasing before the
 * flash just ends the ability; the charge is lost.
 *
 * The owning client predicts the whole timeline; only the server's copy runs hitboxes and applies
 * damage. Presses and releases reach both copies through the ability system's replicated input
 * events, which is why the ability is granted with an input ID. Clips are cosmetic: the server
 * multicasts them to everyone else, the owning client plays them straight away.
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

	// ----- combo -----

	/** Begins ComboSteps[StepIndex]: clips, input listener, windup timer. */
	void StartStep(int32 StepIndex);

	UFUNCTION() void OnWindupFinished();
	UFUNCTION() void OnActiveFinished();
	UFUNCTION() void OnRecoveryFinished();
	UFUNCTION() void OnAttackPressed(float TimeWaited);
	UFUNCTION() void OnAttackReleased(float TimeWaited);

	/** After a swing fully finishes: charge if the button is still held, otherwise end. */
	void FinishSwing();

	/** The step's forward step, started from a timer so it can be delayed into the active window. */
	void StartStepLunge();

	/** One sweep of the step hitbox. Server only. */
	void DoHitCheck();

	const FClockworksSwordComboStep& GetCurrentStep() const;

	// ----- charge -----

	void BeginCharge();
	void OnChargeReady();
	void StartChargeAttack();
	UFUNCTION() void OnChargeReleaseFinished();
	UFUNCTION() void OnChargeSpinFinished();
	UFUNCTION() void OnChargeRecoveryFinished();
	void DoChargeSample();
	void StartChargeLunge();

	// ----- shared -----

	/** Sphere overlap at Center; damages every valid target not already in HitActors. Server only. */
	void SweepHitbox(const FVector& Center, float Radius, float DamageMultiplier, float KnockbackMultiplier);

	/** Build and apply the damage effect to one target. Server only. */
	void ApplyDamageTo(UAbilitySystemComponent* TargetAbilitySystemComponent, const FOverlapResult& Overlap, float DamageMultiplier, float KnockbackMultiplier);

	/** Root-motion push along the facing. Owning client and server. */
	void StartLunge(float Speed, float Seconds);

	/** Plays a clip fitted to PhaseSeconds: locally on the owning client, multicast from the server. */
	void PlayPhaseAnim(UAnimSequenceBase* Anim, float PhaseSeconds, bool bLoop = false);
	void StopPhaseAnim();

	AClockworksCharacter* GetKnight() const;

	/**
	 * The swings, in order. Defaults follow the Spiral Knights Calibur data (Base 3 Hit at the
	 * Calibur's speeds): a free first swing with a nudge, a lunging second, a lunging finisher that
	 * shoves. Tune in BP_GA_SwordAttack.
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

	/** Seconds the button must stay held after a swing before the charge is ready. Calibur: 3. Zero disables charging. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Charge", meta = (ClampMin = "0.0"))
	float ChargeSeconds = 3.f;

	/** Loops while charging (SK charge_sword_hold). Played at its natural speed. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Charge|Animation")
	TObjectPtr<UAnimSequenceBase> ChargeHoldAnim;

	/** Plays on release before the spin (SK sword-chargerelease), fitted to ChargeReleaseSeconds. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Charge|Animation")
	TObjectPtr<UAnimSequenceBase> ChargeReleaseAnim;

	/** The spin itself (SK attack_sword_3_firewithwindup2), fitted to ChargeSpinSeconds. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Charge|Animation")
	TObjectPtr<UAnimSequenceBase> ChargeSpinAnim;

	/** The follow-through (SK attack_sword_3_end), fitted to ChargeRecoverySeconds. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Charge|Animation")
	TObjectPtr<UAnimSequenceBase> ChargeEndAnim;

	/** Release wind-up before the spin. SK: the 0.9 s release clip at speed 2.75. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Charge", meta = (ClampMin = "0.0"))
	float ChargeReleaseSeconds = 0.33f;

	/** The spin, during which the hit samples fire. SK: 0.333 s at speed 1. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Charge", meta = (ClampMin = "0.0"))
	float ChargeSpinSeconds = 0.333f;

	/** Locked follow-through after the spin. SK rearms after 0.35 s with the end clip at speed 0.75. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Charge", meta = (ClampMin = "0.0"))
	float ChargeRecoverySeconds = 0.5f;

	/**
	 * When each hit sample fires, in seconds after the spin starts. The samples sweep behind, left,
	 * front, right in that order, one per entry. SK Round House: 0, 0.09, 0.13, 0.18.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Charge|Hitbox")
	TArray<float> ChargeSampleTimes = { 0.f, 0.09f, 0.13f, 0.18f };

	/** Radius of each sample sphere, in cm. SK: one tile. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Charge|Hitbox", meta = (ClampMin = "0.0"))
	float ChargeHitRadius = 100.f;

	/** Distance of each sample's centre from the knight, in cm. SK: one tile. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Charge|Hitbox", meta = (ClampMin = "0.0"))
	float ChargeHitOffset = 100.f;

	/** Each sample that touches a target deals BaseDamage times this. SK Calibur: 75 against a 50 swing. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Charge|Damage", meta = (ClampMin = "0.0"))
	float ChargeDamageMultiplier = 1.5f;

	/** SK Calibur charge shoves five tiles against the finisher's two and a half. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Charge|Damage", meta = (ClampMin = "0.0"))
	float ChargeKnockbackMultiplier = 2.f;

	/** Forward step during the spin: distance, duration, and delay from the spin's start. SK: one tile over 0.2 s after 0.3 s. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Charge|Lunge", meta = (ClampMin = "0.0"))
	float ChargeLungeDistance = 100.f;

	UPROPERTY(EditDefaultsOnly, Category = "Sword|Charge|Lunge", meta = (ClampMin = "0.01"))
	float ChargeLungeSeconds = 0.2f;

	UPROPERTY(EditDefaultsOnly, Category = "Sword|Charge|Lunge", meta = (ClampMin = "0.0"))
	float ChargeLungeDelaySeconds = 0.3f;

	/** Draws the hitbox spheres on the server while they are live. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Debug")
	bool bDrawDebugHitbox = false;

private:

	/** How often the live hitbox is re-checked, so a target walking into it mid-swing still gets hit. */
	static constexpr float HitCheckInterval = 1.f / 30.f;

	FTimerHandle HitCheckTimer;
	FTimerHandle LungeTimer;
	FTimerHandle ChargeReadyTimer;
	TArray<FTimerHandle> ChargeSampleTimers;

	/** Listens for the next attack press during the current step. Replaced every step. */
	UPROPERTY()
	TObjectPtr<UAbilityTask_WaitInputPress> InputTask;

	/** Listens for the button coming up, for the whole activation. */
	UPROPERTY()
	TObjectPtr<UAbilityTask_WaitInputRelease> ReleaseTask;

	/** Targets already hit by the current swing or sample. Each target takes damage once per sweep. */
	TSet<TWeakObjectPtr<AActor>> HitActors;

	int32 CurrentStepIndex = 0;

	/** The button was pressed during this step; chain into the next one when the hitbox closes. */
	bool bNextStepQueued = false;

	/** The button has not been released since the activation press. */
	bool bButtonHeld = true;

	bool bCharging = false;
	bool bChargeReady = false;
	bool bChargeAttacking = false;
	int32 NextChargeSample = 0;
};
