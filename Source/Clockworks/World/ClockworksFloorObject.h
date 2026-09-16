// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "ClockworksFloorDefinition.h"
#include "ClockworksFloorObject.generated.h"

class AClockworksFloorBuilder;

/**
 * Something on a floor that does rather than decorates: a gate, a button, a block, a hazard.
 *
 * Spiral Knights floors are built out of these. A button sends "open" at a gate's tag, the gate opens, and the room
 * past it holds the monsters that unlock the next one. Without them an imported floor is a room with nothing in it,
 * which is why they are being built at the same time as the floors themselves.
 *
 * Every one of them is spawned by AClockworksFloorBuilder from the floor's own markers, on the server only, and
 * replicates down. What they agree on is a tag: an address. A signal names a target tag and a verb, and whatever wears
 * that tag reads it - which is how the original wires a floor, and it is recovered per floor in
 * D:\Dev\SKAssets\_floors\interactive.
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

	/** Runs on: server. Sets it up from the floor's own marker, before it is finished spawning. */
	virtual void SetupFromMarker(const FClockworksFloorMarker& Marker);

	/** One of the marker's parameters, or a fallback. */
	FString Param(FName Name, const FString& Fallback = FString()) const;

	/** The original's own name for it, e.g. "Dynamic/Door/Iron Gate/Trigger 3". Kept so a floor can be read back. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Floor Object")
	FString Config;

	/**
	 * This object's own tag - its address. A gate tagged "_door 2" is opened by anything that sends "open" at
	 * "_door 2"; it has no listener of its own, because the original's gates do not either.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Floor Object")
	FName SignalTag;

	/** What this one sends when it is worked. Empty for something that only listens. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Floor Object")
	TArray<FClockworksFloorEmission> Emits;

	/** Whatever the original's config carried for it, by name: "blockKind", "width", "hits". */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Floor Object")
	TMap<FName, FString> Params;

protected:

	/** The builder that laid this floor out, and the thing that counts signals. Null if it was placed by hand. */
	AClockworksFloorBuilder* FindFloor() const;

	/** Runs on: server. Sends everything this object emits, the "on" half or the "off" half. */
	void Emit(bool bReleasing);

	/** Runs on: server. Sends one signal directly. */
	void SendSignal(FName TargetTag, FName Verb);

	/** Runs on: every machine. Plays a sound at this object. Cosmetic. */
	UFUNCTION(NetMulticast, Unreliable)
	void MulticastPlaySound(USoundBase* Sound);

	/** The floor this was built into, found once in BeginPlay. */
	UPROPERTY(Transient)
	TObjectPtr<AClockworksFloorBuilder> Floor;
};
