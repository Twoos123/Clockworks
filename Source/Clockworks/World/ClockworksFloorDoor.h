// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "ClockworksFloorObject.h"
#include "ClockworksFloorDoor.generated.h"

class UBoxComponent;
class UStaticMeshComponent;
class USoundBase;

/** What opens a gate. The original's iron gates come in these kinds, and the kind is in the gate's own name. */
UENUM(BlueprintType)
enum class EClockworksDoorKey : uint8
{
	/** Waits for a number of signals: buttons, levers, the room's triggers. "Iron Gate, Trigger 3". */
	Signals,
	/** Waits for the monsters to be dead. "Iron Gate, Monster 5". */
	MonstersCleared,
	/** Waits for a gold key to be carried to it. */
	GoldKey,
	/** Waits for power. */
	Energy,
	/** Waits for the whole party to stand on its platform. */
	Party
};

/**
 * An iron gate: the thing between a Spiral Knights room and the next one.
 *
 * A gate is shut until what it asks for happens — three buttons pressed, the room cleared, a key carried over — and
 * then it stays open. It is not scenery: while it is shut it stops knights, monsters and shots, and that is the whole
 * shape of a floor's progress.
 *
 * Runs on: the server decides it opens; `bOpen` replicates and every machine opens its own copy, which keeps the
 * collision and the picture in step without sending either.
 */
UCLASS()
class AClockworksFloorDoor : public AClockworksFloorObject
{
	GENERATED_BODY()

public:

	AClockworksFloorDoor();

	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

	virtual void BeginPlay() override;

	virtual void SetupFromMarker(const FClockworksFloorMarker& Marker) override;

	/** Valid on every machine: the state replicates. */
	UFUNCTION(BlueprintPure, Category = "Door")
	bool IsOpen() const { return bOpen; }

	/** Runs on: server. Opens it whatever it was waiting for, for a boss fight or a debug key. */
	UFUNCTION(BlueprintCallable, Category = "Door")
	void ForceOpen();

	/** What this gate waits for. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Door")
	EClockworksDoorKey Key = EClockworksDoorKey::Signals;

	/**
	 * How many signals it wants before it opens.
	 *
	 * Not the number in its name: that is the width. The original carries the count as its own argument, and the two
	 * differ in the real data - a "Multi Trigger 3" gate is placed with Triggers: "4" (research 2026-09-15).
	 */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Door", meta = (ClampMin = "1"))
	int32 RequiredSignals = 1;

	/** How wide it stands, in tiles. This is the 3 or the 5 in the original's name, and it loads a 3wide or 5wide model. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Door", meta = (ClampMin = "1"))
	int32 WidthTiles = 3;

protected:

	/**
	 * Runs on: server. A signal was sent somewhere on the floor. A gate has no listener in the original: it is targeted
	 * by tag and understands open, close and toggle itself, so that is what this does.
	 */
	UFUNCTION()
	void HandleSignal(FName TargetTag, FName Verb, AActor* From);

	/** Runs on: server. Watches for the room emptying, when that is what it waits for. */
	void CheckMonsters();

	/** Runs on: server. It opens, or shuts again. */
	void SetOpen(bool bNewOpen);

	UFUNCTION()
	void OnRep_Open();

	/** Runs on: every machine. Collision off, the gate out of the way, the sound. */
	void ApplyOpenState();

	/** How tall the barrier is, in cm. A gate stops shots as well as feet, so it has to be taller than they fly. */
	UPROPERTY(EditAnywhere, Category = "Door", meta = (ClampMin = "10.0"))
	float BarrierHeightCm = 400.f;

	UPROPERTY(EditAnywhere, Category = "Door")
	TObjectPtr<USoundBase> OpenSound;

	UPROPERTY(VisibleAnywhere, Category = "Door")
	TObjectPtr<UStaticMeshComponent> GateMesh;

	/** What actually stops things, sized from WidthTiles rather than from the model. */
	UPROPERTY(VisibleAnywhere, Category = "Door")
	TObjectPtr<UBoxComponent> Barrier;

	UPROPERTY(ReplicatedUsing = OnRep_Open)
	bool bOpen = false;

	/** Server only: the timer that watches the room, for a gate that waits on monsters. */
	FTimerHandle MonsterTimer;

	/** Server only: who has told it to open so far, so two signals from one switch are not two signals. */
	TSet<TWeakObjectPtr<AActor>> Openers;
};
