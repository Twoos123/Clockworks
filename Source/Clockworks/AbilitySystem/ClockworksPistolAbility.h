// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "ClockworksGameplayAbility.h"
#include "ClockworksAttackProfile.h"
#include "ClockworksPistolAbility.generated.h"

class AClockworksCharacter;
class AClockworksProjectile;
class UAbilityTask_WaitInputPress;
class UAbilityTask_WaitInputRelease;
class UAnimSequenceBase;
class USoundBase;

/**
 * The handgun: a clip of quick shots and a charged shot, modelled on the Spiral Knights Proto Gun
 * (the Blaster pattern: three shots, then a reload).
 *
 * Shots. The first press draws and fires after a short windup; a press during a shot's fire window
 * queues the next one, so a steady rhythm empties the clip. Each shot spawns one projectile from
 * the muzzle along the facing: the server spawns it, it replicates to everyone, and it carries the
 * damage. Aiming stays free, the knight keeps turning to the cursor between shots. When the clip is
 * spent the reload plays (State.Reloading: can walk, can't attack) and the clip refills. Stop before
 * the last shot and the clip refills quietly, as in Spiral Knights.
 *
 * Charge. Keep the button held after a shot or a reload and the knight charges: the hold clip loops,
 * movement runs at the weapon's charge speed. After ChargeSeconds the aura flashes; releasing then
 * fires the charged shot: release clip, one heavier projectile, a recoil step backward, a locked
 * recovery. Releasing before the flash just ends the ability.
 *
 * Same machine split as the sword: the owning client predicts the whole timeline, only the server's
 * copy spawns projectiles, and clips are cosmetic (multicast from the server, owner plays its own).
 */
UCLASS()
class UClockworksPistolAbility : public UClockworksGameplayAbility
{
	GENERATED_BODY()

public:

	UClockworksPistolAbility();

protected:

	virtual void ActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, const FGameplayEventData* TriggerEventData) override;
	virtual void EndAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, bool bReplicateEndAbility, bool bWasCancelled) override;

	// ----- shots -----

	/** Begins the next shot: windup on the first of a clip, straight to the fire otherwise. */
	void StartShot();
	UFUNCTION() void OnWindupFinished();
	void FireShot();
	UFUNCTION() void OnFireFinished();
	UFUNCTION() void OnRecoveryFinished();
	void BeginReload();
	UFUNCTION() void OnReloadFinished();
	UFUNCTION() void OnAttackPressed(float TimeWaited);
	UFUNCTION() void OnAttackReleased(float TimeWaited);

	/** After a shot or a reload fully finishes: charge if the button is still held, otherwise end. */
	void FinishShot();

	// ----- charge -----

	void BeginCharge();
	void OnChargeReady();
	void StartChargeAttack();
	UFUNCTION() void OnChargeReleaseFinished();
	UFUNCTION() void OnChargeRecoveryFinished();
	void StartChargeRecoil();

	// ----- shared -----

	/**
	 * Spawns a shot from the muzzle along the facing. Server only. Spec, when given, is the weapon's own
	 * flight and look for it; Spawn, when given, is one bullet of the weapon's fire pattern with its own
	 * heading, and replaces the ability's cone.
	 */
	void SpawnProjectile(TSubclassOf<AClockworksProjectile> Class, float Damage, float Speed, float Range, float KnockbackMultiplier, const FClockworksBulletSpec* Spec = nullptr, const FClockworksAttackHit* Spawn = nullptr);

	/** Root-motion push along the facing; a negative speed steps backward. Owning client and server. */
	void StartLunge(float Speed, float Seconds);

	/** Plays a clip fitted to PhaseSeconds: locally on the owning client, multicast from the server. */
	void PlayPhaseAnim(UAnimSequenceBase* Anim, float PhaseSeconds, bool bLoop = false, float ExplicitRate = 0.f, bool bHoldLastFrame = false);
	void StopPhaseAnim();

	/**
	 * Owning client and server: lets the arms down from a held windup or fire pose. Does nothing to a
	 * clip playing out normally (the follow-through, the reload), so it is safe on every exit.
	 */
	void ReleaseHeldPose();

	void ListenForPress();
	void ListenForRelease();

	AClockworksCharacter* GetKnight() const;

	/** What a shot fires. A Blueprint child of AClockworksProjectile with the visual. */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol")
	TSubclassOf<AClockworksProjectile> ProjectileClass;

	/** What the charged shot fires. Falls back to ProjectileClass when unset. */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Charge")
	TSubclassOf<AClockworksProjectile> ChargedProjectileClass;

	/** Shots before the reload. SK: Proto Gun and Blaster 3. */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol", meta = (ClampMin = "1"))
	int32 ClipSize = 3;

	/** Windup before the first shot of a clip (SK: the blend_start clip at speed 1.75, 0.287 s). Later shots fire at once. */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Timing", meta = (ClampMin = "0.0"))
	float FirstShotWindupSeconds = 0.287f;

	/** Seconds after a shot before the next one may fire (SK rearm 252 ms). A press in this window queues the next shot. */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Timing", meta = (ClampMin = "0.0"))
	float FireSeconds = 0.252f;

	/** Follow-through after the last shot of a burst before the knight is free (SK clear 355 ms minus the rearm). */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Timing", meta = (ClampMin = "0.0"))
	float RecoverySeconds = 0.103f;

	/** The reload after an emptied clip. SK: 1.417 s. */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Timing", meta = (ClampMin = "0.0"))
	float ReloadSeconds = 1.417f;

	/** Raw damage per bullet before the attacker's AttackPower and the target's DefensePower. SK Proto Gun: 12. */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Damage", meta = (ClampMin = "0.0"))
	float BaseDamage = 12.f;

	/** Bullet speed in cm/s. SK: 15 tiles per second. */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol", meta = (ClampMin = "1.0"))
	float ProjectileSpeed = 1500.f;

	/** How far a bullet flies before it fizzles, in cm. SK: a 0.5 s fuse at 15 tiles/s, seven and a half tiles. */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol", meta = (ClampMin = "0.0"))
	float ProjectileRange = 750.f;

	/** Multiplies the target's own knockback speed. SK Proto Gun nudges 0.4 tiles; the sword finisher is 1. */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Damage", meta = (ClampMin = "0.0"))
	float KnockbackMultiplier = 0.4f;

	/** Where bullets spawn, relative to the knight: forward, right, up in cm. Just past the capsule, at chest height. */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol")
	FVector MuzzleOffset = FVector(60.f, 0.f, 14.f);

	/**
	 * How many bullets leave the muzzle per shot, spread across SpreadAngleDegrees.
	 *
	 * One is an ordinary handgun. The Autogun line fires a cone of six at once, which is what makes
	 * it a close-range weapon with a wide answer rather than a precise one.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Behaviour", meta = (ClampMin = "1"))
	int32 BulletsPerShot = 1;

	/** Total spread of that cone, in degrees. The original's Proto Gun has a 6 degree wobble. */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Behaviour", meta = (ClampMin = "0.0"))
	float SpreadAngleDegrees = 6.f;

	/**
	 * How far each ordinary shot shoves the knight backwards, in cm. The Magnus line kicks a third
	 * of a tile per shot, which is both its character and a real cost to firing it in a corner.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Behaviour", meta = (ClampMin = "0.0"))
	float ShotRecoilDistance = 0.f;

	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Behaviour", meta = (ClampMin = "0.01"))
	float ShotRecoilSeconds = 0.12f;

	/**
	 * How a bolt behaves in flight. Bounces are the Alchemer line; growth is the Pulsar line, whose
	 * pellets swell as they travel and hit hardest at the far end.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Behaviour", meta = (ClampMin = "0"))
	int32 ProjectileBounces = 0;

	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Behaviour", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float BounceDamageRetained = 0.8f;

	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Behaviour", meta = (ClampMin = "1.0"))
	float ProjectileGrowthScale = 1.f;

	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Behaviour", meta = (ClampMin = "1.0"))
	float ProjectileGrowthDamage = 1.f;

	/** The shot, the reload, and the heavier charged shot. */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Sound")
	TObjectPtr<USoundBase> ShotSound;

	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Sound")
	TObjectPtr<USoundBase> ReloadSound;

	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Sound")
	TObjectPtr<USoundBase> ChargeShotSound;

	/** Plays a sound at the knight: broadcast from the server, local on the predicting client. */
	void PlayPhaseSound(USoundBase* Sound);

	/** Optional raw clips, fitted to their phases (SK attack_pistol_1_start / _fire / _end, handgun_reload). */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Animation")
	TObjectPtr<UAnimSequenceBase> WindupAnim;

	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Animation")
	TObjectPtr<UAnimSequenceBase> FireAnim;

	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Animation")
	TObjectPtr<UAnimSequenceBase> RecoveryAnim;

	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Animation")
	TObjectPtr<UAnimSequenceBase> ReloadAnim;

	/**
	 * How fast each clip runs. These are the original's own animation speeds, not numbers derived
	 * from the gameplay phases: Spiral Knights plays the pistol windup at 1.75 and the follow-through
	 * at 0.667, and squeezing a clip into its phase instead is what made the gun read as a twitch.
	 * Zero means "fit to the phase", which is the old behaviour and almost never what you want.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Animation", meta = (ClampMin = "0.0"))
	float WindupAnimRate = 1.75f;

	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Animation", meta = (ClampMin = "0.0"))
	float FireAnimRate = 1.f;

	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Animation", meta = (ClampMin = "0.0"))
	float RecoveryAnimRate = 0.667f;

	/** The original runs the reload spin at 1.5. */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Animation", meta = (ClampMin = "0.0"))
	float ReloadAnimRate = 1.5f;

	/**
	 * Seconds the button must stay held after a shot before the charge is ready.
	 *
	 * The Proto Gun's own "chargeTime" is 2500 ms. This used to say 3.5, which was the release
	 * animation's "Release Time" float rather than the gameplay charge, and made the gun feel a full
	 * second slower to charge than the original. Zero disables charging.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Charge", meta = (ClampMin = "0.0"))
	float ChargeSeconds = 2.5f;

	/** Loops while charging (SK charge_pistol_hold). Played at its natural speed. */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Charge|Animation")
	TObjectPtr<UAnimSequenceBase> ChargeHoldAnim;

	/** Plays on release, fitted to ChargeReleaseSeconds (SK handgun-chargerelease). The shot leaves at its end. */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Charge|Animation")
	TObjectPtr<UAnimSequenceBase> ChargeReleaseAnim;

	/** The follow-through, fitted to ChargeRecoverySeconds (SK attack_heavypistol end). */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Charge|Animation")
	TObjectPtr<UAnimSequenceBase> ChargeEndAnim;

	/** Release wind-up before the charged shot leaves. The original's charge "land" is 1000 ms. */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Charge", meta = (ClampMin = "0.0"))
	float ChargeReleaseSeconds = 1.f;

	/** The original plays the charge release clip at 3.5, and its follow-through at its own speed. */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Charge|Animation", meta = (ClampMin = "0.0"))
	float ChargeReleaseAnimRate = 3.5f;

	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Charge|Animation", meta = (ClampMin = "0.0"))
	float ChargeEndAnimRate = 1.f;

	/** Raw damage of the charged shot. SK Proto Gun charged: 35 against a 12 bullet. */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Charge|Damage", meta = (ClampMin = "0.0"))
	float ChargeDamage = 35.f;

	/** The charged bolt is slower than a normal one: the original gives it 12 tiles a second to 15. */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Charge", meta = (ClampMin = "1.0"))
	float ChargeProjectileSpeed = 1200.f;

	/** A 650 ms fuse at 12 tiles a second: just under eight tiles, slightly further than a normal bolt. */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Charge", meta = (ClampMin = "0.0"))
	float ChargeProjectileRange = 780.f;

	/** The charged shot's shove: the original pushes 3 tiles against a normal bolt's 0.4. */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Charge|Damage", meta = (ClampMin = "0.0"))
	float ChargeKnockbackMultiplier = 3.f;

	/** Recoil: the knight steps back this far (SK two thirds of a tile) over ChargeRecoilSeconds, starting ChargeRecoilDelaySeconds after the shot. */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Charge|Recoil", meta = (ClampMin = "0.0"))
	float ChargeRecoilDistance = 67.f;

	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Charge|Recoil", meta = (ClampMin = "0.01"))
	float ChargeRecoilSeconds = 0.3f;

	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Charge|Recoil", meta = (ClampMin = "0.0"))
	float ChargeRecoilDelaySeconds = 0.286f;

	/** Locked follow-through after the charged shot. SK rearms after 717 ms. */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Charge", meta = (ClampMin = "0.0"))
	float ChargeRecoverySeconds = 0.717f;

	/**
	 * How long after a burst ends the gun still counts as raised. A press inside this window fires at
	 * once and carries on the same clip; after it the gun is idle, and the next press pays the
	 * first-shot windup again, as in the original. Without it, clicking steadily a little slower than
	 * the fire window replayed the windup before every shot, which read as the mouse lagging.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Pistol|Timing", meta = (ClampMin = "0.0"))
	float ShotContinueSeconds = 0.5f;

private:

	/** The gun is up: the next shot skips the windup. Set by a shot, kept through a reload. */
	bool bGunRaised = false;

	/** World time until which a new press carries on the last burst instead of raising the gun again. */
	double ShotResumeDeadline = 0.0;

	/** Shots already fired from the clip when the last burst ended, for a press inside that window. */
	int32 ResumeShotsFired = 0;

	/** Owning client and server: copies the drawn weapon's own clip, timings, clips and bursts over the defaults. */
	void ApplyWeaponProfile();

	/** The drawn weapon's move: its charged shot, or shot MoveIndex of its clip. Null without a profile. */
	const FClockworksAttackMove* GetMove(bool bCharged, int32 MoveIndex) const;

	/** Which shot of the weapon's clip the shot being fired is. */
	int32 GetShotMoveIndex() const;

	/**
	 * Owning client and server: a move's bullets, those due at once now and the rest of a burst on
	 * timers (an Autogun's shot is six, 83 ms apart; a charged Autogun sweeps fifteen across a fan).
	 */
	void FireMoveBullets(bool bCharged, int32 MoveIndex);

	/** Owning client and server, from a burst timer: the fire clip and the sound, then the bullet. */
	void FireBurstBullet(bool bCharged, int32 MoveIndex, int32 HitIndex);

	/** Server only: one bullet of a move, with its heading, flight and look. */
	void SpawnMoveBullet(bool bCharged, int32 MoveIndex, int32 HitIndex);

	/** Owning client and server: a move's own sounds, or Fallback for a weapon with no profile. */
	void PlayMoveSound(const FClockworksAttackMove* Move, USoundBase* Fallback, bool bWithExtra);

	/**
	 * Owning client and server: the charged shot's own fire clips (a Sixshot fans the hammer six times,
	 * a Proto Gun kicks and settles), then its follow-through once they are done.
	 */
	void PlayChargedFire();
	void PlayChargeEndClip();

	/** Owning client and server: a run of clips on the arms, multicast from the server. */
	void PlayPhaseSequence(const TArray<FClockworksClipSegment>& Segments);

	FTimerHandle ChargeEndTimer;

	/** The later bullets of the current burst, cleared if the ability ends first. */
	TArray<FTimerHandle> BurstTimers;

	FTimerHandle ChargeReadyTimer;
	FTimerHandle RecoilTimer;

	/** Listens for the next attack press during a shot. Replaced every shot. */
	UPROPERTY()
	TObjectPtr<UAbilityTask_WaitInputPress> InputTask;

	/** Listens for the button coming up, for the whole activation. */
	UPROPERTY()
	TObjectPtr<UAbilityTask_WaitInputRelease> ReleaseTask;

	/** Shots fired from the current clip. Reset by the reload and when the ability ends. */
	int32 ShotsFired = 0;

	/** The button was pressed during this shot; fire the next one when the fire window closes. */
	bool bNextShotQueued = false;

	/** The button has not been released since the last press. */
	bool bButtonHeld = true;

	bool bCharging = false;
	bool bChargeReady = false;
};
