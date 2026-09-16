// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "ClockworksFloorObject.generated.h"

class AClockworksFloorBuilder;

/**
 * Something on a floor that does rather than decorates: a gate, a button, a block, a hazard.
 *
 * Spiral Knights floors are built out of these. A button raises a signal, a gate that wants three signals opens, the
 * room past it holds the monsters that unlock the next gate. Without them an imported floor is a room with nothing in
 * it, which is why they are being built at the same time as the floors themselves.
 *
 * Every one of them is spawned by AClockworksFloorBuilder from the floor's own markers, on the server only, and
 * replicates down. What they agree on is a signal: a name that something raised, counted by the builder. The original
 * keys its gates by a count ("Iron Gate, Trigger 3"), so a count is what this carries.
 *
 * Runs on: spawned and decided by the server. Clients receive them and their state, and play the sounds and clips.
 */
UCLASS(Abstract)
class AClockworksFloorObject : public AActor
{
	GENERATED_BODY()

public:

	AClockworksFloorObject();

	virtual void BeginPlay() override;

	/** Runs on: server. Sets it up from the marker the floor names it in, before it is finished spawning. */
	virtual void SetupFromMarker(const FString& InConfig, FName InTag);

	/** The original's own name for it, e.g. "Dynamic/Door/Iron Gate/Trigger 3". Kept so a floor can be read back. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Floor Object")
	FString Config;

	/**
	 * Which signal this one speaks or listens to. None means the floor's own unnamed signal, which is what an
	 * unwired floor uses: everything that raises a signal raises that one, and every gate counts it.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Floor Object")
	FName SignalTag;

protected:

	/** The builder that laid this floor out, and the thing that counts signals. Null if it was placed by hand. */
	AClockworksFloorBuilder* FindFloor() const;

	/** Runs on: server. Says that this object's signal happened. */
	void RaiseSignal();

	/** Runs on: every machine. Plays a sound at this object. Cosmetic. */
	UFUNCTION(NetMulticast, Unreliable)
	void MulticastPlaySound(USoundBase* Sound);

	/** The floor this was built into, found once in BeginPlay. */
	UPROPERTY(Transient)
	TObjectPtr<AClockworksFloorBuilder> Floor;
};
