// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "ClockworksGameplayAbility.h"
#include "ClockworksEnemyMeleeAbility.generated.h"

class UAbilitySystemComponent;
class UAnimMontage;
class UAnimSequenceBase;
class USoundBase;
struct FOverlapResult;

/**
 * An enemy's melee attack, the "read it, evade it, punish it" loop in one ability:
 *   windup   - the telegraph. The enemy turns to face its target once, then commits to that line.
 *   lunge    - bursts forward along that line with the hitbox live. The player who read the windup
 *              has already stepped out of it.
 *   recovery - can't act or move; the punish window. Then a cooldown before the next attempt.
 *
 * Runs on the server only: enemies are server-controlled, their ability system component lives on
 * the pawn, and nothing here needs predicting. Damage goes through the same damage effect as the
 * sword; the target's attribute set applies defense and shield. The AI controller activates this
 * by tag and reads State.Attacking to know when the enemy is busy.
 */
UCLASS()
class UClockworksEnemyMeleeAbility : public UClockworksGameplayAbility
{
	GENERATED_BODY()

public:

	UClockworksEnemyMeleeAbility();

protected:

	virtual void ActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, const FGameplayEventData* TriggerEventData) override;
	virtual void EndAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, bool bReplicateEndAbility, bool bWasCancelled) override;
	virtual void ApplyCooldown(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo) const override;

	UFUNCTION() void OnWindupFinished();
	UFUNCTION() void OnLungeFinished();

	/** Server only, from the hit-delay timer: opens the hitbox part-way through the strike. */
	void OpenHitWindow();
	UFUNCTION() void OnRecoveryFinished();

	/** Plays a montage through the ability system (replicated to clients) if it and an anim instance exist. */
	void PlayPhaseMontage(UAnimMontage* Montage);

	/**
	 * Shows one phase: the raw clip when there is one, fitted to PhaseSeconds, otherwise the montage
	 * at its own length. Raw clips are preferred because the Spiral Knights exports are plain
	 * sequences and montage assets can only be made by hand in the editor.
	 */
	void PlayPhase(UAnimSequenceBase* Anim, UAnimMontage* Montage, float PhaseSeconds);

	/** One sweep of the hitbox. */
	void DoHitCheck();

	/** Build and apply the damage effect to one target. */
	void ApplyDamageTo(UAbilitySystemComponent* TargetAbilitySystemComponent, const FOverlapResult& Overlap);

	/** Seconds of telegraph before the lunge. Longer is fairer; this is the number that makes the enemy readable. */
	UPROPERTY(EditDefaultsOnly, Category = "Melee|Timing", meta = (ClampMin = "0.0"))
	float WindupSeconds = 0.5f;

	/** Seconds the lunge lasts. The hitbox is live for exactly this long. */
	UPROPERTY(EditDefaultsOnly, Category = "Melee|Timing", meta = (ClampMin = "0.0"))
	float LungeSeconds = 0.25f;

	/**
	 * Seconds into the strike before the hitbox opens. The original's monsters strike part-way through the clip (the
	 * chromalisk licks 0.56 s into a 0.47 s fire phase), which is what makes the swing readable rather than instant.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Melee|Timing", meta = (ClampMin = "0.0"))
	float HitDelaySeconds = 0.f;

	/** Seconds after the lunge during which the enemy cannot act or move. The punish window. */
	UPROPERTY(EditDefaultsOnly, Category = "Melee|Timing", meta = (ClampMin = "0.0"))
	float RecoverySeconds = 0.6f;

	/** Seconds after activation before the next attack may start. */
	UPROPERTY(EditDefaultsOnly, Category = "Melee|Timing", meta = (ClampMin = "0.0"))
	float CooldownSeconds = 1.5f;

	/** Lunge speed along the committed facing, in cm/s. Distance = LungeSpeed x LungeSeconds. */
	UPROPERTY(EditDefaultsOnly, Category = "Melee|Feel", meta = (ClampMin = "0.0"))
	float LungeSpeed = 900.f;

	/**
	 * A step backwards as it strikes, in cm: the original gives its lickers and throwers a recoil rather than a lunge.
	 * Zero none. Runs over RecoilSeconds from the moment the hitbox opens (or the shot leaves).
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Melee|Feel", meta = (ClampMin = "0.0"))
	float RecoilDistance = 0.f;

	UPROPERTY(EditDefaultsOnly, Category = "Melee|Feel", meta = (ClampMin = "0.01"))
	float RecoilSeconds = 0.8f;

	/** Raw damage before the attacker's AttackPower and the target's DefensePower. */
	UPROPERTY(EditDefaultsOnly, Category = "Melee|Damage", meta = (ClampMin = "0.0"))
	float BaseDamage = 10.f;

	/** How hard the hit shoves, as a multiple of the target's own knockback. Zero does not move it (the chromalisk's lick). */
	UPROPERTY(EditDefaultsOnly, Category = "Melee|Damage", meta = (ClampMin = "0.0"))
	float KnockbackMultiplier = 1.f;

	/** Radius of the sphere swept in front of the enemy while lunging, in cm. */
	UPROPERTY(EditDefaultsOnly, Category = "Melee|Hitbox", meta = (ClampMin = "0.0"))
	float HitRadius = 80.f;

	/** Distance from the enemy's centre to the sphere's centre along its facing, in cm. */
	UPROPERTY(EditDefaultsOnly, Category = "Melee|Hitbox", meta = (ClampMin = "0.0"))
	float HitForwardOffset = 70.f;

	/**
	 * A rectangle instead of a circle: its length along the facing and its width, in cm, swept turned with the monster.
	 * Zero keeps the sphere. The chromalisk's lick is a 3 x 0.75 tile box reaching 3.1 tiles (research: _research/bosses).
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Melee|Hitbox")
	FVector2D HitBoxSizeCm = FVector2D::ZeroVector;

	/**
	 * Optional. Played at the start of the windup. When set, AttackMontage waits for the lunge and
	 * RecoveryMontage for the recovery, so a three-clip attack (start / fire / end) lines up with the
	 * three phases. When unset, AttackMontage plays from the start and is expected to span the whole attack.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Melee|Animation")
	TObjectPtr<UAnimMontage> WindupMontage;

	/** Visuals only; the numbers above set the timing. Needs a DefaultSlot in the enemy's Animation Blueprint. */
	UPROPERTY(EditDefaultsOnly, Category = "Melee|Animation")
	TObjectPtr<UAnimMontage> AttackMontage;

	/** Optional. Played when the recovery starts, only if WindupMontage is set. */
	UPROPERTY(EditDefaultsOnly, Category = "Melee|Animation")
	TObjectPtr<UAnimMontage> RecoveryMontage;

	UPROPERTY(EditDefaultsOnly, Category = "Melee|Animation", meta = (ClampMin = "0.01"))
	float MontagePlayRate = 1.f;

	/**
	 * The telegraph, the strike and the follow-through as raw clips, each squeezed to fit its phase.
	 * Preferred over the montages above; set these and the montages can stay empty. The windup clip
	 * is the one the player reads, so an enemy without it has no tell at all.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Melee|Animation")
	TObjectPtr<UAnimSequenceBase> WindupAnim;

	UPROPERTY(EditDefaultsOnly, Category = "Melee|Animation")
	TObjectPtr<UAnimSequenceBase> AttackAnim;

	UPROPERTY(EditDefaultsOnly, Category = "Melee|Animation")
	TObjectPtr<UAnimSequenceBase> RecoveryAnim;

	/** Draws the hitbox sphere while it is live. */
	/**
	 * The telegraph the player hears: played the moment the windup starts, not when the hit lands,
	 * so it is a warning rather than a report. Server only, multicast to everyone.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Melee|Sound")
	TObjectPtr<USoundBase> AttackSound;

	/** Played on the enemy when the swing connects with something. */
	UPROPERTY(EditDefaultsOnly, Category = "Melee|Sound")
	TObjectPtr<USoundBase> HitSound;

	UPROPERTY(EditDefaultsOnly, Category = "Melee|Debug")
	bool bDrawDebugHitbox = false;

private:

	static constexpr float HitCheckInterval = 1.f / 30.f;

	/** Counts down HitDelaySeconds inside the strike, then opens the hitbox. */
	FTimerHandle HitWindowTimer;

	FTimerHandle HitCheckTimer;

	/** Targets already hit by this lunge. Each takes damage once per activation. */
	TSet<TWeakObjectPtr<AActor>> HitActors;
};
