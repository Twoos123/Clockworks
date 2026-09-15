// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "ClockworksElevator.generated.h"

class UBoxComponent;
class UMaterialInstanceDynamic;
class UMaterialInterface;
class USoundBase;
class UStaticMeshComponent;
class UTextRenderComponent;

/**
 * The way down. Stand on it and the party descends a floor.
 *
 * Spiral Knights' elevator is what makes a set of rooms into a run: it is the only way forward, it
 * only opens once the floor is finished, and the whole party goes together. The last of those is
 * the rule worth keeping even in a single-player demo, because it is the one that will matter when
 * there are two knights.
 *
 * Who runs what. The server owns the overlap test, the countdown and the descent; it alone calls
 * into the game state to change the depth. The platform's colour and its sign are driven from
 * replicated state, so every machine paints its own and nothing is sent for them.
 */
UCLASS()
class AClockworksElevator : public AActor
{
	GENERATED_BODY()

public:

	AClockworksElevator();

	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	/** Server: opens the elevator. Until this is called, standing on it does nothing. */
	UFUNCTION(BlueprintCallable, Category = "Elevator")
	void SetOpen(bool bNewOpen);

	UFUNCTION(BlueprintPure, Category = "Elevator")
	bool IsOpen() const { return bOpen; }

protected:

	UFUNCTION()
	void OnRep_Open();

	/** Server: is every living knight standing on the pad? */
	bool AreAllPlayersAboard() const;

	/** Server: the countdown finished. Advances the depth and rebuilds the floor. */
	void Descend();

	/** Cosmetic, on every machine: the arrival chime and the flash. */
	UFUNCTION(NetMulticast, Reliable)
	void MulticastDescended();

	/** Repaints the pad and rewrites the sign from whatever this machine currently knows. */
	void RefreshVisuals();

	UPROPERTY(VisibleAnywhere, Category = "Elevator")
	TObjectPtr<UBoxComponent> Trigger;

	UPROPERTY(VisibleAnywhere, Category = "Elevator")
	TObjectPtr<UStaticMeshComponent> Platform;

	/** The depth sign. Spiral Knights puts the number you are about to reach on the lift itself. */
	UPROPERTY(VisibleAnywhere, Category = "Elevator")
	TObjectPtr<UTextRenderComponent> Sign;

	/** Wants an unlit, translucent material with a colour and an opacity parameter. */
	UPROPERTY(EditAnywhere, Category = "Elevator|Style")
	TObjectPtr<UMaterialInterface> PadMaterial;

	UPROPERTY(EditAnywhere, Category = "Elevator|Style")
	FName PadColorParameterName = TEXT("BubbleColor");

	UPROPERTY(EditAnywhere, Category = "Elevator|Style")
	FName PadOpacityParameterName = TEXT("Opacity");

	/** Shut: there is still something to do on this floor. */
	UPROPERTY(EditAnywhere, Category = "Elevator|Style")
	FLinearColor ClosedColor = FLinearColor(0.35f, 0.10f, 0.10f, 1.f);

	/** Open, and nobody on it yet. */
	UPROPERTY(EditAnywhere, Category = "Elevator|Style")
	FLinearColor OpenColor = FLinearColor(0.15f, 0.55f, 0.95f, 1.f);

	/** Someone is aboard and the countdown is running. */
	UPROPERTY(EditAnywhere, Category = "Elevator|Style")
	FLinearColor BoardingColor = FLinearColor(0.25f, 0.85f, 0.45f, 1.f);

	/**
	 * Seconds everyone must stay on the pad before it goes. Short enough not to be a chore, long
	 * enough that walking across one by accident does not end the floor.
	 */
	UPROPERTY(EditAnywhere, Category = "Elevator", meta = (ClampMin = "0.0"))
	float BoardingSeconds = 2.f;

	/** Whether the elevator starts open. A lobby's does; a floor with monsters on it does not. */
	UPROPERTY(EditAnywhere, Category = "Elevator")
	bool bStartOpen = false;

	/**
	 * Open the moment every enemy on the floor is dead. This is what "clear the floor" means without
	 * anything having to keep a list of what is on it.
	 */
	UPROPERTY(EditAnywhere, Category = "Elevator")
	bool bOpenWhenFloorCleared = true;

	UPROPERTY(EditAnywhere, Category = "Elevator|Sound")
	TObjectPtr<USoundBase> OpenSound;

	UPROPERTY(EditAnywhere, Category = "Elevator|Sound")
	TObjectPtr<USoundBase> DescendSound;

private:

	/** Whether the way down is available. The server decides; everyone reads it for the colour. */
	UPROPERTY(ReplicatedUsing = OnRep_Open)
	bool bOpen = false;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> PadMaterialInstance;

	/** Server: how long the party has been aboard. Resets the moment anyone steps off. */
	float BoardedSeconds = 0.f;

	/** Server: set once the descent has started, so it cannot happen twice. */
	bool bDescending = false;

	/** What the pad is currently painted, so a repaint that changes nothing does nothing. */
	FLinearColor ShownColor = FLinearColor::Transparent;
};
