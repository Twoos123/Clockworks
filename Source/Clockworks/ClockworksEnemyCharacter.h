// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "AbilitySystemInterface.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksEnemyCharacter.generated.h"

class UAbilitySystemComponent;
class UClockworksAttributeSet;
class UMaterialInterface;

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

	/** Cosmetic only. Everyone shows the flash; nothing gameplay-relevant happens here. */
	UFUNCTION(NetMulticast, Unreliable)
	void MulticastHitFlash();

	void ClearHitFlash();

	UPROPERTY(VisibleAnywhere, Category = "Abilities")
	TObjectPtr<UAbilitySystemComponent> AbilitySystemComponent;

	UPROPERTY()
	TObjectPtr<UClockworksAttributeSet> AttributeSet;

	UPROPERTY(EditDefaultsOnly, Category = "Combat", meta = (ClampMin = "1.0"))
	float InitialHealth = 50.f;

	/** Zero keeps a training dummy in place. Enemies that walk get a real number. */
	UPROPERTY(EditDefaultsOnly, Category = "Combat", meta = (ClampMin = "0.0"))
	float InitialMoveSpeed = 0.f;

	/** How hard a hit shoves this enemy, in cm/s along the hit direction. */
	UPROPERTY(EditDefaultsOnly, Category = "Combat|Feedback", meta = (ClampMin = "0.0"))
	float KnockbackSpeed = 600.f;

	/** Drawn over the mesh for a moment when hit. An unlit additive material reads best. */
	UPROPERTY(EditDefaultsOnly, Category = "Combat|Feedback")
	TObjectPtr<UMaterialInterface> HitFlashMaterial;

	UPROPERTY(EditDefaultsOnly, Category = "Combat|Feedback", meta = (ClampMin = "0.0"))
	float HitFlashSeconds = 0.1f;

	/** Seconds between dying and being removed from the world. */
	UPROPERTY(EditDefaultsOnly, Category = "Combat", meta = (ClampMin = "0.0"))
	float DeathDestroyDelay = 2.f;

private:

	FTimerHandle HitFlashTimer;
	bool bDead = false;
};
