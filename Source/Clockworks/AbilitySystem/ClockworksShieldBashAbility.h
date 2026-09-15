// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "ClockworksGameplayAbility.h"
#include "ClockworksGearDefinition.h"
#include "ClockworksShieldBashAbility.generated.h"

class AClockworksCharacter;
class UAbilitySystemComponent;
class UAnimSequenceBase;
class USoundBase;
struct FOverlapResult;

/**
 * Shield bash (Shift + left mouse), after Spiral Knights: only with a full shield, costs half of
 * it, launches the knight shield-first along the movement direction (or the facing when standing
 * still), damages, shoves and stuns whatever it touches, then a locked recovery. The knight is not
 * invulnerable during it.
 *
 * The worn shield decides the bash (research 2026-09-15, D:\Dev\SKAssets\_research\shield_bonus\findings.md):
 * every rank of the original's Shield/Bash is one attack whose damage follows the handgun damage curve at the
 * shield's stars (UClockworksGearDefinition::ShieldBashDamage) and whose stun grows with depth; the Tortoise and
 * Shell shields launch faster and end in a ring of force. Without a worn shield, this ability's own numbers apply.
 *
 * Three phases like every attack: windup (committed; rotation and movement locked), the lunge
 * (hitbox live, root motion), recovery (locked). Owning client predicts the timeline, only the
 * server's copy pays the shield cost, runs the hitbox and applies damage and the stun effect.
 */
UCLASS()
class UClockworksShieldBashAbility : public UClockworksGameplayAbility
{
	GENERATED_BODY()

public:

	UClockworksShieldBashAbility();

protected:

	virtual bool CanActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayTagContainer* SourceTags = nullptr, const FGameplayTagContainer* TargetTags = nullptr, FGameplayTagContainer* OptionalRelevantTags = nullptr) const override;
	virtual void ActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, const FGameplayEventData* TriggerEventData) override;
	virtual void EndAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, bool bReplicateEndAbility, bool bWasCancelled) override;

	UFUNCTION() void OnWindupFinished();
	UFUNCTION() void OnLungeFinished();
	UFUNCTION() void OnRecoveryFinished();

	/** One sweep of the hitbox at the knight's shield. Server only. */
	void DoHitCheck();

	/** Hits everything in a sphere once per set, with the bash's damage and stun and the given shove. Server only. */
	void HitAround(const FVector& Center, float Radius, TSet<TWeakObjectPtr<AActor>>& AlreadyHit, float Knockback);

	/** Damage plus the stun to one target. Server only. */
	void ApplyHitTo(UAbilitySystemComponent* TargetAbilitySystemComponent, const FOverlapResult& Overlap, float Knockback);

	/** Root-motion push along the facing. Owning client and server. */
	void StartLunge(float Speed, float Seconds);

	/** Plays a clip fitted to PhaseSeconds: locally on the owning client, multicast from the server. */
	void PlayPhaseAnim(UAnimSequenceBase* Anim, float PhaseSeconds);
	void StopPhaseAnim();

	AClockworksCharacter* GetKnight() const;

	/** The shield must hold at least this fraction of its health to bash. SK: full. */
	UPROPERTY(EditDefaultsOnly, Category = "Bash|Cost", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float RequiredShieldFraction = 1.f;

	/** Fraction of the shield's health the bash spends. SK: half. */
	UPROPERTY(EditDefaultsOnly, Category = "Bash|Cost", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float ShieldCostFraction = 0.5f;

	/** Seconds of telegraph before the launch. SK: fires at 500 ms. */
	UPROPERTY(EditDefaultsOnly, Category = "Bash|Timing", meta = (ClampMin = "0.0"))
	float WindupSeconds = 0.5f;

	/** How long the launch lasts; the hitbox is live for exactly this long. SK: 800 ms. */
	UPROPERTY(EditDefaultsOnly, Category = "Bash|Timing", meta = (ClampMin = "0.01"))
	float LungeSeconds = 0.8f;

	/** The Tortodrone bash's quicker launch. SK: 600 ms. */
	UPROPERTY(EditDefaultsOnly, Category = "Bash|Timing", meta = (ClampMin = "0.01"))
	float TortodroneLungeSeconds = 0.6f;

	/** How far the launch carries the knight, in cm. SK: six tiles. */
	UPROPERTY(EditDefaultsOnly, Category = "Bash|Timing", meta = (ClampMin = "0.0"))
	float LungeDistance = 600.f;

	/** Locked follow-through after the launch. SK: the attack ends at 1.6 s. */
	UPROPERTY(EditDefaultsOnly, Category = "Bash|Timing", meta = (ClampMin = "0.0"))
	float RecoverySeconds = 0.3f;

	/** Raw damage when no worn shield names its own: the original's 0-star bash at the demo's first depth. */
	UPROPERTY(EditDefaultsOnly, Category = "Bash|Damage", meta = (ClampMin = "0.0"))
	float BaseDamage = 15.6f;

	/** Multiplies the target's own knockback speed. SK: six tiles over a second (÷2.5 like the push-back table). */
	UPROPERTY(EditDefaultsOnly, Category = "Bash|Damage", meta = (ClampMin = "0.0"))
	float KnockbackMultiplier = 2.4f;

	/** Stun without a worn shield, in seconds. */
	UPROPERTY(EditDefaultsOnly, Category = "Bash|Damage", meta = (ClampMin = "0.0"))
	float StunSeconds = 2.2f;

	/** Stun at original depths below 8, 8 to 17, and 18 or deeper. SK: a moderate stun capped at 4 / 6 / 8 s; these durations are INFERRED. */
	UPROPERTY(EditDefaultsOnly, Category = "Bash|Damage", meta = (ClampMin = "0.0"))
	float StunSecondsShallow = 2.2f;

	UPROPERTY(EditDefaultsOnly, Category = "Bash|Damage", meta = (ClampMin = "0.0"))
	float StunSecondsMiddle = 3.f;

	UPROPERTY(EditDefaultsOnly, Category = "Bash|Damage", meta = (ClampMin = "0.0"))
	float StunSecondsDeep = 3.8f;

	/** The Tortodrone ring's radius for bash rank 3, 4 and 5, in cm. SK: 1.5 / 1.75 / 2 tiles. */
	UPROPERTY(EditDefaultsOnly, Category = "Bash|Tortodrone")
	TArray<float> TortodroneRingRadius = { 150.f, 175.f, 200.f };

	/** The ring's shove. SK: two tiles over a second. */
	UPROPERTY(EditDefaultsOnly, Category = "Bash|Tortodrone", meta = (ClampMin = "0.0"))
	float TortodroneRingKnockback = 0.8f;

	/** Radius of the sphere at the shield, in cm. SK hits everything touching the knight. */
	UPROPERTY(EditDefaultsOnly, Category = "Bash|Hitbox", meta = (ClampMin = "0.0"))
	float HitRadius = 80.f;

	/** Distance from the knight's centre to the sphere's centre along its facing, in cm. */
	UPROPERTY(EditDefaultsOnly, Category = "Bash|Hitbox", meta = (ClampMin = "0.0"))
	float HitForwardOffset = 30.f;

	/** Optional raw clips, fitted to their phases (SK shieldbash_start / _fire / _end). */
	UPROPERTY(EditDefaultsOnly, Category = "Bash|Animation")
	TObjectPtr<UAnimSequenceBase> WindupAnim;

	UPROPERTY(EditDefaultsOnly, Category = "Bash|Animation")
	TObjectPtr<UAnimSequenceBase> LungeAnim;

	UPROPERTY(EditDefaultsOnly, Category = "Bash|Animation")
	TObjectPtr<UAnimSequenceBase> RecoveryAnim;

	/** The shove as the bash starts, and the impact when it connects. */
	UPROPERTY(EditDefaultsOnly, Category = "Bash|Sound")
	TObjectPtr<USoundBase> BashSound;

	UPROPERTY(EditDefaultsOnly, Category = "Bash|Sound")
	TObjectPtr<USoundBase> HitSound;

	/** Plays a sound at the knight: the server broadcasts, the owning client plays its own at once. */
	void PlayPhaseSound(USoundBase* Sound);

	/** Draws the hitbox sphere on the server while it is live. */
	UPROPERTY(EditDefaultsOnly, Category = "Bash|Debug")
	bool bDrawDebugHitbox = false;

private:

	static constexpr float HitCheckInterval = 1.f / 30.f;

	FTimerHandle HitCheckTimer;

	/** Targets already hit by this bash's launch, and by its ring. Each takes each hit once. */
	TSet<TWeakObjectPtr<AActor>> HitActors;
	TSet<TWeakObjectPtr<AActor>> RingHitActors;

	/** This bash's numbers, read from the worn shield when it starts. */
	EClockworksShieldBashKind ActiveKind = EClockworksShieldBashKind::Standard;
	int32 ActiveRank = 0;
	float ActiveDamage = 0.f;
	float ActiveStunSeconds = 0.f;
	float ActiveLungeSeconds = 0.8f;
};
