// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "ClockworksGameplayAbility.h"
#include "ClockworksAttackProfile.h"
#include "ClockworksSwordAttackAbility.generated.h"

class AClockworksCharacter;
class UAbilitySystemComponent;
class UAbilityTask_WaitInputPress;
class UAbilityTask_WaitInputRelease;
class UAnimMontage;
class UAnimSequenceBase;
class USoundBase;
class AClockworksProjectile;
class AClockworksBomb;
struct FClockworksClipSegment;
struct FClockworksLunge;
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

	/**
	 * Optional raw clip for the follow-through (the SK *_end clip). Unlike the windup and the swing
	 * this is played whether or not the step has a gameplay recovery: the knight finishes the motion
	 * even when you are already free to act, and pressing again simply cuts it off. Skipping it is
	 * what made a single swing snap back to idle.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Step|Animation")
	TObjectPtr<UAnimSequenceBase> RecoveryAnim;

	/**
	 * How fast the follow-through plays. 1 is the clip's own speed, which is what keeps it fluid.
	 * Zero squeezes it into RecoverySeconds instead, which on a short recovery looks like a twitch.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Step|Animation", meta = (ClampMin = "0.0"))
	float RecoveryAnimRate = 1.f;

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

	/** The whoosh as this swing starts. The original gives each swing in a combo its own. */
	UPROPERTY(EditDefaultsOnly, Category = "Step|Sound")
	TObjectPtr<USoundBase> SwingSound;

	/** Multiplies BaseDamage for this swing. */
	UPROPERTY(EditDefaultsOnly, Category = "Step|Damage", meta = (ClampMin = "0.0"))
	float DamageMultiplier = 1.f;

	/** Multiplies the target's own knockback speed. The Calibur's opener barely nudges; its finisher shoves. */
	UPROPERTY(EditDefaultsOnly, Category = "Step|Damage", meta = (ClampMin = "0.0"))
	float KnockbackMultiplier = 1.f;

	/** This swing's own hitbox radius and reach, in cm. Zero uses the ability's HitRadius and HitForwardOffset. */
	UPROPERTY(EditDefaultsOnly, Category = "Step|Hitbox", meta = (ClampMin = "0.0"))
	float HitRadius = 0.f;

	UPROPERTY(EditDefaultsOnly, Category = "Step|Hitbox", meta = (ClampMin = "0.0"))
	float HitForwardOffset = 0.f;
};

/** One sample of a charged attack's hitbox: when, where around the knight, how big, how hard it shoves. */
USTRUCT()
struct FClockworksSwordChargeSample
{
	GENERATED_BODY()

	UPROPERTY()
	float DelaySeconds = 0.f;

	/** cm from the knight: X forward, Y right. */
	UPROPERTY()
	FVector2D OffsetCm = FVector2D::ZeroVector;

	UPROPERTY()
	float RadiusCm = 100.f;

	UPROPERTY()
	float KnockbackMultiplier = 1.f;

	/** A rectangle's length along the facing and width, in cm; zero for a circle. */
	UPROPERTY()
	FVector2D BoxSizeCm = FVector2D::ZeroVector;

	/** Damage as a multiple of BaseDamage; zero keeps ChargeDamageMultiplier. */
	UPROPERTY()
	float DamageMultiplier = 0.f;

	/** Which hit of the charged move this sample is, for its status and its sideways shove. */
	UPROPERTY()
	int32 HitIndex = INDEX_NONE;
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

	/**
	 * Overlap at Center: a sphere of Radius, or a box when BoxHalfExtent is set (turned with the knight).
	 * Damages every valid target not already in HitActors. Server only.
	 */
	void SweepHitbox(const FVector& Center, float Radius, float DamageMultiplier, float KnockbackMultiplier, const FVector& BoxHalfExtent = FVector::ZeroVector, const FQuat& BoxRotation = FQuat::Identity);

	/** Build and apply the damage effect to one target. Server only. */
	void ApplyDamageTo(UAbilitySystemComponent* TargetAbilitySystemComponent, const FOverlapResult& Overlap, float DamageMultiplier, float KnockbackMultiplier);

	/** Root-motion push along the facing. Owning client and server. */
	void StartLunge(float Speed, float Seconds);

	/**
	 * Plays a clip locally on the owning client and multicast from the server. ExplicitRate of zero
	 * squeezes the clip into PhaseSeconds; anything else plays at that rate and lets the clip run its
	 * own length. Follow-through clips use a rate, because fitting a 0.65 s clip into a 0.23 s
	 * recovery is what made the combo look frantic.
	 */
	void PlayPhaseAnim(UAnimSequenceBase* Anim, float PhaseSeconds, bool bLoop = false, float ExplicitRate = 0.f);
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

	/** The impact when a swing connects, as distinct from the whoosh when it misses. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Sound")
	TObjectPtr<USoundBase> HitSound;

	/** The charge release, and the heavier impact each of its samples makes. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Sound")
	TObjectPtr<USoundBase> ChargeSwingSound;

	UPROPERTY(EditDefaultsOnly, Category = "Sword|Sound")
	TObjectPtr<USoundBase> ChargeHitSound;

	/** Plays a sound at the knight: broadcast from the server, local on the predicting client. */
	void PlayPhaseSound(USoundBase* Sound);

	/**
	 * What a swing or a charged attack fires, for the lines whose swords throw something: a Winmillion's
	 * wheels, a Spur's sonic ring, a Brandish's burst. A Blueprint child of AClockworksProjectile; each
	 * weapon's data gives the bullet its own flight and look. Unset, those swords simply fire nothing.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Bullets")
	TSubclassOf<AClockworksProjectile> ProjectileClass;

	/** Where a sword's bullets leave, relative to the knight: forward, right, up in cm. */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Bullets")
	FVector MuzzleOffset = FVector(60.f, 0.f, 14.f);

	/**
	 * What a charged attack's blasts are: a Troika slam's aftershock, a Cutter's ghost swings. A child of
	 * AClockworksBomb; its body is hidden, only its blast (and, for a real fuse, its warning ring) shows.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Bullets")
	TSubclassOf<AClockworksBomb> BlastClass;

	/** Starts or stops the knight's looping charge hum. Cosmetic; safe to call when nothing is playing. */
	void SetChargeLoopSound(bool bPlaying);

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

	/**
	 * Play rates for the three charge clips. Zero fits the clip to its phase. The release defaults to
	 * Spiral Knights' own 2.75 and the spin to its own speed; the follow-through runs at 1 so the
	 * knight settles out of the spin instead of snapping.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Charge|Animation", meta = (ClampMin = "0.0"))
	float ChargeReleaseAnimRate = 2.75f;

	UPROPERTY(EditDefaultsOnly, Category = "Sword|Charge|Animation", meta = (ClampMin = "0.0"))
	float ChargeSpinAnimRate = 1.f;

	UPROPERTY(EditDefaultsOnly, Category = "Sword|Charge|Animation", meta = (ClampMin = "0.0"))
	float ChargeEndAnimRate = 1.f;

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

	/**
	 * How long after a mid-combo swing ends a new press still carries on to the next swing instead of
	 * starting over. Without it a swing with no recovery (the first) could only be chained during its
	 * own 0.35 s, so a steady click slightly slower than that repeated the first swing forever.
	 * Spiral Knights: a chained swing's rearm is 233 ms plus its 667 ms end clip at End Speed, which
	 * for the Calibur (End Speed 2.0) is 0.566 s.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Sword|Combo", meta = (ClampMin = "0.0"))
	float ComboContinueSeconds = 0.566f;

private:

	/** CurrentStepIndex while the knight swings the weapon's incomplete-charge move after letting go of a charge early. */
	static constexpr int32 IncompleteSwingIndex = -2;

	/**
	 * The weapon's incomplete-charge move as a swing: what the original does when the button comes up before the
	 * charge is ready (for most swords their opener). Built by ApplyWeaponProfile; used when bHasIncompleteSwing.
	 */
	UPROPERTY()
	FClockworksSwordComboStep IncompleteStep;

	bool bHasIncompleteSwing = false;

	/** Owning client and server: leaves the charge and swings IncompleteStep. */
	void StartIncompleteSwing();

	/** The swing a press starts on if it lands before ComboResumeDeadline. */
	int32 ComboResumeStep = 0;

	/** World time after which a press starts the combo from its first swing again. */
	double ComboResumeDeadline = 0.0;

	/** Owning client and server: copies the drawn weapon's own swings and charge over this instance's defaults. */
	void ApplyWeaponProfile();

	/** The drawn weapon's charged attack, or swing MoveIndex (IncompleteSwingIndex: its incomplete charge). Null without a profile. */
	const struct FClockworksAttackMove* GetMove(bool bCharged, int32 MoveIndex) const;

	/** Owning client and server: a move's own sounds, or Fallback for a weapon with no profile. */
	void PlayMoveSound(const struct FClockworksAttackMove* Move, USoundBase* Fallback);

	/** Server only: the bullets a move throws, those due at once now and the rest on timers. */
	void ScheduleMoveBullets(bool bCharged, int32 MoveIndex);

	/** Server only: one bullet of a move, with its heading, flight and look. */
	void SpawnMoveBullet(bool bCharged, int32 MoveIndex, int32 HitIndex);

	/** A move's later bullets, cleared if the ability ends first. */
	TArray<FTimerHandle> BulletTimers;

	/**
	 * Server only, for the length of one sweep: the weapon's data for the hit being swept, so each target
	 * it catches gets that hit's own status and sideways shove. Points into the weapon asset.
	 */
	const FClockworksAttackHit* ActiveHitData = nullptr;

	/** Server only: one blast of a move, a hidden bomb that goes off where the hit landed. */
	void SpawnMoveBlast(bool bCharged, int32 MoveIndex, int32 HitIndex);

	/** Owning client and server: a root-motion push by DistanceCm (X forward, Y right) over Seconds. */
	void StartLungeVector(const FVector2D& DistanceCm, float Seconds);

	/** Owning client and server, from a timer: ChargeLunges[Index]. */
	void StartChargeLungeAt(int32 Index);

	/** Owning client and server: a run of clips on the whole body, multicast from the server. */
	void PlayPhaseSequence(const TArray<FClockworksClipSegment>& Segments);

	/** Owning client and server: lets go of a held clip of a run. Safe when nothing is held. */
	void ReleaseHeldPose();

	/** The charged attack's pushes, when the weapon names them. Empty uses ChargeLungeDistance. */
	TArray<FClockworksLunge> ChargeLunges;
	TArray<FTimerHandle> ChargeLungeTimers;

	/**
	 * The charged attack's hit samples, when the drawn weapon names its own. Empty keeps the Round
	 * House's four samples behind, left, front and right.
	 */
	UPROPERTY()
	TArray<FClockworksSwordChargeSample> ChargeSamples;

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
