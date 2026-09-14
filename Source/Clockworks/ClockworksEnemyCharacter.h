// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "AbilitySystemInterface.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksEnemyCharacter.generated.h"

class UAbilitySystemComponent;
class UAnimMontage;
class UClockworksAttributeSet;
class UGameplayAbility;
class UMaterialInterface;
class UStaticMeshComponent;

/**
 * Base for anything the player can hit. Owns its own AbilitySystemComponent (enemies don't
 * respawn, so nothing needs to outlive the pawn). Reacts to damage with server-side knockback and a
 * cosmetic flash, and dies at zero health. Blueprint children assign the mesh and tuning.
 */
UCLASS(abstract)
class AClockworksEnemyCharacter : public ACharacter, public IAbilitySystemInterface
{
	GENERATED_BODY()

public:

	AClockworksEnemyCharacter();

	virtual UAbilitySystemComponent* GetAbilitySystemComponent() const override { return AbilitySystemComponent; }

	virtual void PostInitializeComponents() override;

	UClockworksAttributeSet* GetAttributeSet() const { return AttributeSet; }

protected:

	/** Server: knockback and the flash broadcast. */
	void HandleDamaged(AActor* InstigatorActor, AActor* Causer, float Amount, FVector HitDirection);

	/** Server: death. */
	void HandleOutOfHealth();

	/** Server and owning machine: State.MovementLocked (attack windup/recovery) zeroes the walk speed. */
	void OnMovementLockChanged(const FGameplayTag Tag, int32 NewCount);

	/** Cosmetic only. Everyone shows the flash; nothing gameplay-relevant happens here. */
	UFUNCTION(NetMulticast, Unreliable)
	void MulticastHitFlash();

	void ClearHitFlash();

	/** Cosmetic only: the death clip on every machine. The server has already decided the death. */
	UFUNCTION(NetMulticast, Reliable)
	void MulticastPlayDeathMontage();

	UPROPERTY(VisibleAnywhere, Category = "Abilities")
	TObjectPtr<UAbilitySystemComponent> AbilitySystemComponent;

	/** Optional rigid head piece riding HeadSocketName (the Mechaknight's helmet is not part of its skin). */
	UPROPERTY(VisibleAnywhere, Category = "Components")
	TObjectPtr<UStaticMeshComponent> HeadMesh;

	/** Bone the head piece attaches to. Set before the mesh is assigned; changing it later needs a re-attach. */
	UPROPERTY(EditDefaultsOnly, Category = "Components")
	FName HeadSocketName = TEXT("bone_helmet");

	UPROPERTY()
	TObjectPtr<UClockworksAttributeSet> AttributeSet;

	/** Granted on the server when the enemy spawns. A training dummy has none; a wolver has its bite. */
	UPROPERTY(EditDefaultsOnly, Category = "Abilities")
	TArray<TSubclassOf<UGameplayAbility>> DefaultAbilities;

	UPROPERTY(EditDefaultsOnly, Category = "Combat", meta = (ClampMin = "1.0"))
	float InitialHealth = 50.f;

	/** Added to every attack's damage. */
	UPROPERTY(EditDefaultsOnly, Category = "Combat", meta = (ClampMin = "0.0"))
	float InitialAttackPower = 0.f;

	/** Subtracted from every hit taken (never below 1). The armoured enemy's whole identity. */
	UPROPERTY(EditDefaultsOnly, Category = "Combat", meta = (ClampMin = "0.0"))
	float InitialDefensePower = 0.f;

	/** Zero keeps a training dummy or a turret in place. Enemies that walk get a real number. */
	UPROPERTY(EditDefaultsOnly, Category = "Combat", meta = (ClampMin = "0.0"))
	float InitialMoveSpeed = 0.f;

	/** The brain stops chasing and attacks inside this distance, in cm. Melee: a body length. Ranged: the whole room. */
	UPROPERTY(EditDefaultsOnly, Category = "AI", meta = (ClampMin = "0.0"))
	float AttackRange = 220.f;

	/** If set, the brain only attacks with a clear line to the target. Shooters, so walls are an answer to them. */
	UPROPERTY(EditDefaultsOnly, Category = "AI")
	bool bAttackNeedsLineOfSight = false;

	/** How fast a stationary enemy turns to track its target, in degrees per second. */
	UPROPERTY(EditDefaultsOnly, Category = "AI", meta = (ClampMin = "0.0"))
	float TurnRateDegrees = 180.f;

public:

	float GetAttackRange() const { return AttackRange; }
	bool AttackNeedsLineOfSight() const { return bAttackNeedsLineOfSight; }
	float GetTurnRateDegrees() const { return TurnRateDegrees; }
	bool IsStationary() const { return InitialMoveSpeed <= 0.f; }

protected:

	/** How hard a hit shoves this enemy, in cm/s along the hit direction. */
	UPROPERTY(EditDefaultsOnly, Category = "Combat|Feedback", meta = (ClampMin = "0.0"))
	float KnockbackSpeed = 600.f;

	/** Drawn over the mesh for a moment when hit. An unlit additive material reads best. */
	UPROPERTY(EditDefaultsOnly, Category = "Combat|Feedback")
	TObjectPtr<UMaterialInterface> HitFlashMaterial;

	UPROPERTY(EditDefaultsOnly, Category = "Combat|Feedback", meta = (ClampMin = "0.0"))
	float HitFlashSeconds = 0.1f;

	/** Seconds between dying and being removed from the world. Match it to the death clip's length. */
	UPROPERTY(EditDefaultsOnly, Category = "Combat", meta = (ClampMin = "0.0"))
	float DeathDestroyDelay = 2.f;

	/** Optional. Played on death; the body stays visible until DeathDestroyDelay runs out. Needs a DefaultSlot in the Animation Blueprint. */
	UPROPERTY(EditDefaultsOnly, Category = "Combat|Feedback")
	TObjectPtr<UAnimMontage> DeathMontage;

private:

	FTimerHandle HitFlashTimer;
	bool bDead = false;
};
