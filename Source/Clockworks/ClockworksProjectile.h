// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "ClockworksProjectile.generated.h"

class UAbilitySystemComponent;
class UProjectileMovementComponent;
class USphereComponent;
class UStaticMeshComponent;

/**
 * A shot fired by a ranged attack. Spawned by the server only; its movement replicates to clients
 * (straight line, no gravity), so everyone sees the same bolt at the same place. The server alone
 * decides hits: on overlapping a pawn from another faction it applies the damage effect through the
 * shooter's ability system component and destroys itself. Walls destroy it too.
 *
 * The bolt is also the first thing the player can dodge by reading its line, which is the point.
 */
UCLASS(abstract)
class AClockworksProjectile : public AActor
{
	GENERATED_BODY()

public:

	AClockworksProjectile();

	/** Server: called by the ability right after spawning. Sets who shot it, how hard and how fast. */
	void InitProjectile(UAbilitySystemComponent* InSourceAbilitySystemComponent, float InDamage, const FVector& Direction, float Speed);

protected:

	virtual void BeginPlay() override;

	UFUNCTION()
	void OnSphereOverlap(UPrimitiveComponent* OverlappedComponent, AActor* OtherActor, UPrimitiveComponent* OtherComponent, int32 OtherBodyIndex, bool bFromSweep, const FHitResult& SweepResult);

	UFUNCTION()
	void OnSphereHit(UPrimitiveComponent* HitComponent, AActor* OtherActor, UPrimitiveComponent* OtherComponent, FVector NormalImpulse, const FHitResult& Hit);

	UPROPERTY(VisibleAnywhere, Category = "Projectile")
	TObjectPtr<USphereComponent> CollisionSphere;

	/** The visual. Blueprint children assign the mesh. */
	UPROPERTY(VisibleAnywhere, Category = "Projectile")
	TObjectPtr<UStaticMeshComponent> Mesh;

	UPROPERTY(VisibleAnywhere, Category = "Projectile")
	TObjectPtr<UProjectileMovementComponent> ProjectileMovement;

	/** Seconds before an unanswered shot removes itself. */
	UPROPERTY(EditDefaultsOnly, Category = "Projectile", meta = (ClampMin = "0.1"))
	float LifeSeconds = 3.f;

private:

	TWeakObjectPtr<UAbilitySystemComponent> SourceAbilitySystemComponent;
	float Damage = 0.f;
	bool bConsumed = false;
};
