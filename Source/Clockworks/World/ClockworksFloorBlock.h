// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "ClockworksFloorObject.h"
#include "AbilitySystemInterface.h"
#include "ClockworksAttackProfile.h"
#include "ClockworksFloorBlock.generated.h"

class UAbilitySystemComponent;
class UBoxComponent;
class UClockworksAttributeSet;
class UStaticMeshComponent;
class USoundBase;

/** What a block is. The original has more than one kind, and they are not interchangeable. */
UENUM(BlueprintType)
enum class EClockworksBlockKind : uint8
{
	/** In the way, and stays in the way. */
	Solid,
	/** Smashed by a hit: a crate, a crystal, a shrub. */
	Breakable,
	/** Smashed by a hit, and takes the room with it. */
	Explosive,
	/** Smashed by a hit and leaves something behind. */
	Treasure,
	/** There to look at, and walked straight through. */
	Phase
};

/**
 * A block: the most common thing on a Spiral Knights floor after the tiles themselves.
 *
 * There are more than 22,000 of them across the archived floors — crates to smash on the way past, unbreakable pillars
 * that shape a room, explosive barrels that clear it, and treasure boxes. What kind a block is comes out of the name
 * the original gives it.
 *
 * Runs on: the server owns its health and decides it breaks; the break replicates, and every machine hides it and
 * plays the sound off that.
 */
UCLASS()
class AClockworksFloorBlock : public AClockworksFloorObject, public IAbilitySystemInterface
{
	GENERATED_BODY()

public:

	AClockworksFloorBlock();

	virtual UAbilitySystemComponent* GetAbilitySystemComponent() const override { return AbilitySystemComponent; }

	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

	virtual void PostInitializeComponents() override;

	virtual void BeginPlay() override;

	virtual void SetupFromMarker(const FClockworksFloorMarker& Marker) override;

	/** Valid on every machine: the state replicates. */
	UFUNCTION(BlueprintPure, Category = "Block")
	bool IsBroken() const { return bBroken; }

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Block")
	EClockworksBlockKind Kind = EClockworksBlockKind::Solid;

	/** How much it takes to smash it. The original's crates go on one hit whatever hit it. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Block", meta = (ClampMin = "1.0"))
	float BlockHealth = 1.f;

	/** How much of a tile it fills, so a 2x2 crate stops the right amount of floor. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Block", meta = (ClampMin = "0.1"))
	FVector2D SizeTiles = FVector2D(1.f, 1.f);

	/** What an explosive block does when it goes. Uses the same blast the weapons' bullets do. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Block")
	FClockworksBulletBurst Blast;

protected:

	/** Runs on: server. A weapon struck it. */
	void HandleDamaged(AActor* InstigatorActor, AActor* Causer, float Amount, FVector HitDirection,
		float KnockbackMultiplier, float FamilyMultiplier);

	/** Runs on: server. It goes, and sends whatever it emits, so a crate that unlocks a gate can. */
	void Break(AActor* BrokenBy);

	UFUNCTION()
	void OnRep_Broken();

	/** Runs on: every machine. Off the replicated state. */
	void ApplyBrokenState();

	UPROPERTY(VisibleAnywhere, Category = "Block")
	TObjectPtr<UBoxComponent> Body;

	UPROPERTY(VisibleAnywhere, Category = "Block")
	TObjectPtr<UStaticMeshComponent> BlockMesh;

	/** The knight's weapons only strike things that carry one of these, so a breakable block has one. */
	UPROPERTY(VisibleAnywhere, Category = "Block")
	TObjectPtr<UAbilitySystemComponent> AbilitySystemComponent;

	UPROPERTY()
	TObjectPtr<UClockworksAttributeSet> AttributeSet;

	UPROPERTY(EditAnywhere, Category = "Block")
	TObjectPtr<USoundBase> BreakSound;

	/** How tall a block stands, in cm. */
	UPROPERTY(EditAnywhere, Category = "Block", meta = (ClampMin = "10.0"))
	float HeightCm = 200.f;

	UPROPERTY(ReplicatedUsing = OnRep_Broken)
	bool bBroken = false;
};
