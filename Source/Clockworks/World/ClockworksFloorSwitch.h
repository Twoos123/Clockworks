// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "ClockworksFloorObject.h"
#include "AbilitySystemInterface.h"
#include "ClockworksFloorSwitch.generated.h"

class UAbilitySystemComponent;
class UBoxComponent;
class UClockworksAttributeSet;
class UStaticMeshComponent;
class USoundBase;

/** The kinds of switch the original has, and each is worked differently. */
UENUM(BlueprintType)
enum class EClockworksSwitchKind : uint8
{
	/** Stepped on. The common one: press it and a gate somewhere opens. */
	Button,
	/** Struck with a weapon. */
	Lever,
	/** Held down only while something stands on it, and it lets go when you step off. */
	PressurePlate,
	/** Needs every living knight standing on it at once, which is what makes it a party platform. */
	PartyPlatform
};

/**
 * A button, a lever, a pressure plate or a party platform: the things that raise a floor's signals.
 *
 * A one-time switch raises its signal once and is spent. A toggle raises it and lowers it again. A timed one lowers it
 * after a few seconds, which is the original's "press this and run" puzzle. A pressure plate holds its signal only
 * while something stands on it, so two of them need two knights — or a statue carried onto one.
 *
 * Runs on: the server alone decides a switch was worked and raises the signal. What everyone sees comes off the
 * replicated state.
 */
UCLASS()
class AClockworksFloorSwitch : public AClockworksFloorObject, public IAbilitySystemInterface
{
	GENERATED_BODY()

public:

	AClockworksFloorSwitch();

	virtual UAbilitySystemComponent* GetAbilitySystemComponent() const override { return AbilitySystemComponent; }

	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

	virtual void PostInitializeComponents() override;

	virtual void BeginPlay() override;

	virtual void SetupFromMarker(const FString& InConfig, FName InTag) override;

	/** Valid on every machine: the state replicates. */
	UFUNCTION(BlueprintPure, Category = "Switch")
	bool IsOn() const { return bOn; }

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Switch")
	EClockworksSwitchKind Kind = EClockworksSwitchKind::Button;

	/** Whether working it once is the end of it. A one-time switch cannot be turned back off. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Switch")
	bool bOneTime = true;

	/** How long it stays on before it lets go by itself. Zero means it does not. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Switch", meta = (ClampMin = "0.0"))
	float TimerSeconds = 0.f;

	/** How long the whole party has to stand on a platform before it counts, in seconds. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Switch", meta = (ClampMin = "0.0"))
	float PartyStandSeconds = 1.f;

	/** How wide it is, in tiles. A party platform is wider than a button. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Switch", meta = (ClampMin = "0.1"))
	float SizeTiles = 1.f;

protected:

	/** Runs on: server. Something stood on it. */
	UFUNCTION()
	void OnTouchBegin(UPrimitiveComponent* Component, AActor* Other, UPrimitiveComponent* OtherComponent,
		int32 BodyIndex, bool bFromSweep, const FHitResult& Sweep);

	/** Runs on: server. Something stepped off it. */
	UFUNCTION()
	void OnTouchEnd(UPrimitiveComponent* Component, AActor* Other, UPrimitiveComponent* OtherComponent, int32 BodyIndex);

	/** Runs on: server. A weapon struck it, which is how a lever is worked. */
	void HandleDamaged(AActor* InstigatorActor, AActor* Causer, float Amount, FVector HitDirection,
		float KnockbackMultiplier, float FamilyMultiplier);

	/** Runs on: server. Watches a party platform for the whole party standing on it. */
	void CheckParty();

	/** Runs on: server. Turns it on or off and moves the floor's signal with it. */
	void SetOn(bool bNewOn);

	/** Runs on: server, from the timer. */
	void ExpireTimer();

	UFUNCTION()
	void OnRep_On();

	/** Runs on: every machine. The switch's own look and sound, off the replicated state. */
	void ApplyState();

	/** How many knights are standing on it right now, and how many are alive to stand. Server only. */
	int32 CountKnightsOn(int32& OutLivingKnights) const;

	UPROPERTY(VisibleAnywhere, Category = "Switch")
	TObjectPtr<UBoxComponent> Touch;

	UPROPERTY(VisibleAnywhere, Category = "Switch")
	TObjectPtr<UStaticMeshComponent> SwitchMesh;

	/** A lever is struck with a weapon, and the knight's weapons only strike things that carry one of these. */
	UPROPERTY(VisibleAnywhere, Category = "Switch")
	TObjectPtr<UAbilitySystemComponent> AbilitySystemComponent;

	UPROPERTY()
	TObjectPtr<UClockworksAttributeSet> AttributeSet;

	UPROPERTY(EditAnywhere, Category = "Switch")
	TObjectPtr<USoundBase> OnSound;

	UPROPERTY(EditAnywhere, Category = "Switch")
	TObjectPtr<USoundBase> OffSound;

	UPROPERTY(ReplicatedUsing = OnRep_On)
	bool bOn = false;

	/** Set once a one-time switch has been worked, so it can never be worked again. */
	UPROPERTY(Replicated)
	bool bSpent = false;

	/** Server only. */
	FTimerHandle Timer;

	FTimerHandle PartyTimer;

	/** Server only: how long the whole party has been standing on it. */
	float PartyHeldSeconds = 0.f;
};
