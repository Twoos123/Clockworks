// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "ClockworksFloorObject.h"
#include "ClockworksFloorProp.generated.h"

/**
 * Something on the floor that is there to be seen and stood next to rather than fought: the alchemy machine, the
 * arsenal, a vendor, a toughbox, a respawn pad, a bone pile.
 *
 * These are placed as markers with an actor behind them, not as tile instances, so the floor's scenery pass never
 * draws them - which is why an imported Mission Lobby had its walls and floors and none of its machines. The base
 * class already knows how to show a model's pieces; a prop is that and nothing more.
 *
 * Runs on: spawned by the server with the rest of the floor and replicated down. It decides nothing.
 */
UCLASS()
class AClockworksFloorProp : public AClockworksFloorObject
{
	GENERATED_BODY()

public:

	AClockworksFloorProp();

	virtual void BeginPlay() override;

protected:

	/**
	 * Whether knights walk into it. Most props do not stop anyone in the original - what stops you is the floor's own
	 * grid and the barriers around a shop, both of which the floor already builds.
	 */
	UPROPERTY(EditAnywhere, Category = "Prop")
	bool bBlocksMovement = false;

	/** How wide it stands when it does block, in cm. */
	UPROPERTY(EditAnywhere, Category = "Prop", meta = (ClampMin = "10.0"))
	float BlockSizeCm = 100.f;

	UPROPERTY(EditAnywhere, Category = "Prop", meta = (ClampMin = "10.0"))
	float BlockHeightCm = 200.f;
};
