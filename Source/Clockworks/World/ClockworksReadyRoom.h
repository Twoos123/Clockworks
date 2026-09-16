// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "ClockworksReadyRoom.generated.h"

class UCameraComponent;
class UClockworksActivitiesPanel;

/**
 * The ready room: a fixed view of a set, with the interface over it.
 *
 * It is not a level you walk around. The original frames it with a bounded camera and gives you no
 * movement at all - you look at the room and you press things - and its scene file bears that out:
 * no environment model, no globals, a set 605 x 329 cm across, and `world/environment/bounded_camera`
 * among its entries. So this takes the camera, takes the input, and puts the panels up; the knight
 * is spawned by the game mode as usual and is simply not shown or driven here.
 *
 * Runs on: the local machine. A view target, an input mode and a few widgets are all local, and
 * nothing here is replicated. Two players in the same game each sit in their own ready room.
 */
UCLASS()
class AClockworksReadyRoom : public AActor
{
	GENERATED_BODY()

public:

	AClockworksReadyRoom();

	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

protected:

	/** Runs on: the local machine. Takes the camera and the input, and raises the panels. */
	void Enter();

public:

	/**
	 * Runs on: the local machine. Puts the camera at an offset from the set and points it back at it.
	 *
	 * The original frames this room with a bounded camera whose numbers are not recovered, so the angle here is
	 * chosen by eye. `Clockworks.RoomCamera` drives this so several can be compared in one headless run.
	 */
	UFUNCTION(BlueprintCallable, Category = "Ready Room")
	void FrameSet(const FVector& Offset);

	/** Where the set is, for pointing the camera at it. */
	UFUNCTION(BlueprintPure, Category = "Ready Room")
	FVector GetSetCentre() const { return SetCentre; }

protected:

	/** The middle of the set, found from the built floor when the room is entered. */
	UPROPERTY(EditAnywhere, Category = "Ready Room")
	FVector SetCentre = FVector::ZeroVector;

	/** Where the room is looked at from. Placed in the level, pointed at the set. */
	UPROPERTY(VisibleAnywhere, Category = "Ready Room")
	TObjectPtr<UCameraComponent> Camera;

	/** The Activities panel: Go to Haven, Missions, Guild Halls, Coliseum, Party Finder, Supply Depot. */
	UPROPERTY(EditAnywhere, Category = "Ready Room")
	TSubclassOf<UClockworksActivitiesPanel> ActivitiesClass;

	UPROPERTY(Transient)
	TObjectPtr<UClockworksActivitiesPanel> Activities;

	/**
	 * How long to wait before taking over, in seconds. The game mode spawns the knight and the controller builds its
	 * HUD on the first frames; stepping in after that is simpler than racing them.
	 */
	UPROPERTY(EditAnywhere, Category = "Ready Room", meta = (ClampMin = "0.0"))
	float EnterDelay = 0.2f;

	FTimerHandle EnterTimer;
};
