// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "ClockworksGameplayAbility.h"
#include "ClockworksBombAbility.generated.h"

class AClockworksBomb;
class AClockworksCharacter;
class UAbilityTask_WaitInputRelease;
class UAnimSequenceBase;
class USoundBase;

/**
 * The bomb: the third weapon class, and the only one with no quick attack at all.
 *
 * Spiral Knights bombs are charge-only. Holding the button arms one, and it is not until the charge
 * completes that anything can happen; releasing early throws the charge away with nothing to show
 * for it. On a completed release the knight drops the bomb where they are standing and it sits there
 * for its fuse before going off in a radius. Nothing is thrown and nothing is aimed, so the whole
 * weapon is about where you put yourself and how fast you leave.
 *
 * Every bomb in the catalogue carries its own charge time, fuse, radius and clips in its weapon
 * definition's Attack profile; the numbers below are the Proto Bomb's, used when a weapon has none.
 *
 * Who runs what. The owning client and the server both run the timeline, the same as the sword and
 * the gun. Only the server spawns the bomb actor, and only that actor does damage. Clips and sounds
 * are cosmetic and follow the usual rule: the server broadcasts, the owning client plays its own
 * immediately so the arming reads on the button rather than a round trip later.
 */
UCLASS()
class UClockworksBombAbility : public UClockworksGameplayAbility
{
	GENERATED_BODY()

public:

	UClockworksBombAbility();

protected:

	virtual void ActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, const FGameplayEventData* TriggerEventData) override;
	virtual void EndAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, bool bReplicateEndAbility, bool bWasCancelled) override;

	/** Owning client and server: copies the drawn weapon's own charge, clips, fuse and radius over the defaults. */
	void ApplyWeaponProfile();

	/** The charge finished: the bomb is armed and will drop the moment the button comes up. */
	void OnArmed();

	UFUNCTION() void OnAttackReleased(float TimeWaited);
	UFUNCTION() void OnPlaceFinished();
	UFUNCTION() void OnRecoveryFinished();
	UFUNCTION() void OnDudFinished();

	/** Server only. Puts the bomb on the floor at the knight's feet and hands it its numbers. */
	void SpawnBomb();

	AClockworksCharacter* GetKnight() const;

	/** Cosmetic. Fits a clip to a phase, or plays it at ExplicitRate when that is non-zero. */
	void PlayPhaseAnim(UAnimSequenceBase* Anim, float PhaseSeconds, bool bLoop = false, float ExplicitRate = 0.f);
	void StopPhaseAnim();
	void PlayPhaseSound(USoundBase* Sound);

	/** The bomb actor dropped on release. Without one the ability does nothing but play clips. */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb")
	TSubclassOf<AClockworksBomb> BombClass;

	/**
	 * Seconds of holding before the bomb is armed. The Proto Bomb's own "Charge Time" is 2000 ms,
	 * and that two-second commitment with no aim and no quick attack is the whole shape of the class.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Timing", meta = (ClampMin = "0.1"))
	float ArmSeconds = 2.f;

	/** Seconds of the placing motion before the bomb actually appears. The original's "land" is 200 ms. */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Timing", meta = (ClampMin = "0.0"))
	float PlaceSeconds = 0.2f;

	/** Seconds after the bomb lands before the knight can act. The original's "rearm" is 200 ms. */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Timing", meta = (ClampMin = "0.0"))
	float RecoverySeconds = 0.2f;

	/**
	 * Seconds the knight is locked out after letting go too early. Releasing before the charge
	 * completes is not free in the original: it drops a dud and locks you for most of a second
	 * (its "Base Interupt" is a 767 ms rearm). That penalty is what stops hold-and-panic play.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Timing", meta = (ClampMin = "0.0"))
	float DudRecoverySeconds = 0.767f;

	/**
	 * Damage at the centre of the blast, before the knight's attack power and before falloff.
	 *
	 * This is the one number here not taken straight from the game files. The original's Proto Bomb
	 * is an item with a depth-scaled attack value of 20 and a separate standalone default of 75,
	 * neither of which means anything without its depth curve. 45 is the number that sits right
	 * against this project's own scale, where a sword swing is 10 and a charged bolt is 35: more
	 * than any single hit, because it costs two seconds and cannot be aimed.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Damage", meta = (ClampMin = "0.0"))
	float BlastDamage = 45.f;

	/**
	 * Blast radius in cm. The Proto Bomb's own Radius is 2.5 tiles.
	 *
	 * A tile is 100 cm here, which is the scale the sword's own lunges already use: its finisher
	 * covers "2.5 tiles" at 1250 cm/s for 0.2 s, which is 250 cm. Everything measured in tiles has
	 * to agree on that or two weapons quoting the same reach will not have the same reach.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Damage", meta = (ClampMin = "0.0"))
	float BlastRadius = 250.f;

	/**
	 * Bombs shove much harder than a sword; it is how a bomber makes room. The original's blast
	 * impulse pushes 3 tiles over 150 ms, which against this project's knockback speeds is about
	 * double a sword's finisher.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Damage", meta = (ClampMin = "0.0"))
	float KnockbackMultiplier = 2.f;

	/** The knight reaches for the bomb. Played over the arming time. Unset plays HoldAnim from the start instead. */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Animation")
	TObjectPtr<UAnimSequenceBase> ArmAnim;

	/** Loops while the bomb is held (SK charge_bomb_hold). */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Animation")
	TObjectPtr<UAnimSequenceBase> HoldAnim;

	/** The placing motion (SK attack_bomb_blend). */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Animation")
	TObjectPtr<UAnimSequenceBase> PlaceAnim;

	/**
	 * How fast the placing clip runs. One is the clip's own speed, which is what keeps it fluid;
	 * zero squeezes it into PlaceSeconds instead. Same knob the sword's follow-throughs have, for
	 * the same reason: crushing a clip into a short phase reads as a twitch.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Animation", meta = (ClampMin = "0.0"))
	float PlaceAnimRate = 1.f;

	/** Letting go too early (SK throw, at 2.0). */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Animation")
	TObjectPtr<UAnimSequenceBase> DudAnim;

	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Animation", meta = (ClampMin = "0.0"))
	float DudAnimRate = 2.f;

	/** The click as the bomb is armed, and the moment it leaves the hand. */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Sound")
	TObjectPtr<USoundBase> ArmSound;

	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Sound")
	TObjectPtr<USoundBase> ArmedSound;

	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Sound")
	TObjectPtr<USoundBase> PlaceSound;

private:

	UPROPERTY()
	TObjectPtr<UAbilityTask_WaitInputRelease> ReleaseTask;

	FTimerHandle ArmTimer;

	/** The drawn weapon's own fuse, or zero for the bomb actor's. */
	float FuseSeconds = 0.f;

	/** True once the arming time has elapsed: only then does a release drop anything. */
	bool bArmed = false;

	/** True from the drop until the ability ends, so a second release cannot drop a second bomb. */
	bool bPlacing = false;
};
