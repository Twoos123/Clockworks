// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "ClockworksFloorBuilder.generated.h"

class AClockworksFloorObject;
class UClockworksFloorDefinition;
class UInstancedStaticMeshComponent;
class UStaticMesh;

/** Raised whenever a floor's signal count changes. Server only: nothing binds to this on a client. */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FClockworksFloorSignalEvent, FName, Tag, int32, Count);

/**
 * Which class to build for one of the floor's markers. The original names everything it places, so the rule is a piece
 * of that name: "Iron Gate" is a gate, "Switch/Button" is a button. Set in a Blueprint child of the builder, so the
 * mapping is data and adding an object never means editing this class.
 */
USTRUCT(BlueprintType)
struct FClockworksFloorObjectRule
{
	GENERATED_BODY()

	/** Only markers of this category are considered. None matches every category. */
	UPROPERTY(EditAnywhere, Category = "Rule")
	FName Category;

	/** ...and only those whose config contains this. Empty matches every config in the category. */
	UPROPERTY(EditAnywhere, Category = "Rule")
	FString ConfigContains;

	UPROPERTY(EditAnywhere, Category = "Rule")
	TSubclassOf<AClockworksFloorObject> ObjectClass;
};

/** One cell as the builder keeps it: its height in cm and what it stops. */
struct FClockworksFloorCellLookup
{
	float HeightCm = 0.f;
	int32 Collision = 0;
	int32 Floor = 0;
};

/**
 * Builds a real Spiral Knights floor out of a `UClockworksFloorDefinition`.
 *
 * The scenery goes in as one instanced mesh per model — a floor is a few hundred models repeated a few thousand times,
 * and an actor apiece would cost more than the rest of the game put together. What actually stops anything is the tile
 * grid, built as invisible boxes in three kinds, because that is how the original works: the models are dressing over a
 * 100 cm grid, and a wall blocks because its cell says "wall".
 *
 * Runs on: every machine, in BeginPlay or when the director hands it a floor. The definition is the same asset
 * everywhere, so each machine builds an identical copy and none of it is replicated; the server's copy is the one that
 * matters for movement and hits, and the clients' is what they see and predict against.
 */
UCLASS()
class AClockworksFloorBuilder : public AActor
{
	GENERATED_BODY()

public:

	AClockworksFloorBuilder();

	virtual void BeginPlay() override;

	/** Runs on: every machine. Tears down whatever stands and builds this floor in its place. */
	UFUNCTION(BlueprintCallable, Category = "Floor")
	void BuildFloor(UClockworksFloorDefinition* InFloor);

	/** Runs on: every machine. Removes every component this built. */
	UFUNCTION(BlueprintCallable, Category = "Floor")
	void ClearFloor();

	/** The floor standing right now, or null. */
	UFUNCTION(BlueprintPure, Category = "Floor")
	UClockworksFloorDefinition* GetFloor() const { return Floor; }

	/** Where the knights arrive: the floor's player entrance, or its centre when it names none. */
	UFUNCTION(BlueprintPure, Category = "Floor")
	FVector GetEntranceLocation() const;

	/** Where the way down stands, and whether the floor has one. */
	UFUNCTION(BlueprintPure, Category = "Floor")
	bool GetElevatorTransform(FTransform& OutWhere) const;

	/** Runs on: any. True when a knight could stand on this spot, by the floor's own grid rather than by a trace. */
	UFUNCTION(BlueprintPure, Category = "Floor")
	bool IsWalkable(const FVector& WorldLocation) const;

	/** Runs on: any. The floor's height under a spot, and whether there is any floor there at all. */
	UFUNCTION(BlueprintPure, Category = "Floor")
	bool FindGroundHeight(const FVector& WorldLocation, float& OutHeight) const;

	/** The tile a world position falls in. */
	UFUNCTION(BlueprintPure, Category = "Floor")
	FIntPoint TileAt(const FVector& WorldLocation) const;

	/**
	 * Runs on: server. Says that a signal happened — a button was pressed, a lever pulled, a room cleared. Gates count
	 * these: the original's "Iron Gate, Trigger 3" opens on the third one.
	 */
	UFUNCTION(BlueprintCallable, Category = "Floor")
	void RaiseSignal(FName Tag, AActor* From);

	/** Runs on: server. Takes one back, for a switch that is held rather than pressed. */
	UFUNCTION(BlueprintCallable, Category = "Floor")
	void LowerSignal(FName Tag, AActor* From);

	/** How many times this signal stands raised. Server only: signals are not replicated, their consequences are. */
	UFUNCTION(BlueprintPure, Category = "Floor")
	int32 SignalCount(FName Tag) const;

	/** Runs on: server. Fires whenever a count changes. */
	UPROPERTY(BlueprintAssignable, Category = "Floor")
	FClockworksFloorSignalEvent OnSignal;

protected:

	/** The floor to build in BeginPlay. The director replaces it as the run descends. */
	UPROPERTY(EditAnywhere, Category = "Floor")
	TObjectPtr<UClockworksFloorDefinition> Floor;

	/** How thick the invisible floor boxes are, in cm. Deep enough that a step down is solid, not a lip. */
	UPROPERTY(EditAnywhere, Category = "Floor", meta = (ClampMin = "10.0"))
	float FloorThicknessCm = 200.f;

	/** How tall a blocking cell is, in cm. The original's walls are taller than anything can reach. */
	UPROPERTY(EditAnywhere, Category = "Floor", meta = (ClampMin = "10.0"))
	float BlockerHeightCm = 400.f;

	/** How tall a prop's barrier is, in cm. */
	UPROPERTY(EditAnywhere, Category = "Floor", meta = (ClampMin = "10.0"))
	float PropBlockerHeightCm = 200.f;

	/**
	 * Whether to stretch the level's navigation bounds over the floor after building it. The navigation mesh is set to
	 * build at runtime, but it only builds inside a bounds volume, and a volume placed by hand cannot know how big a
	 * floor the run will drop next.
	 */
	UPROPERTY(EditAnywhere, Category = "Floor")
	bool bResizeNavigationBounds = true;

	/**
	 * Whether to light the floor from its own recorded ambient and background colours. Each archived scene carries
	 * them, and they are not decoration: the Mission Lobby is a dark blue room, and a generic white sun over it washes
	 * the whole tileset out to paper.
	 */
	UPROPERTY(EditAnywhere, Category = "Floor")
	bool bApplyFloorLighting = true;

	/** Draws the invisible collision boxes, for checking a floor's grid against the original. */
	UPROPERTY(EditAnywhere, Category = "Floor")
	bool bShowCollision = false;

	/**
	 * What to build for the floor's markers: gates, buttons, blocks. A marker with no rule is left as a note in the
	 * data, which is how a floor can carry more than is built yet without pretending otherwise.
	 */
	UPROPERTY(EditAnywhere, Category = "Floor")
	TArray<FClockworksFloorObjectRule> ObjectRules;

private:

	/** Makes one instanced mesh component and registers it. */
	UInstancedStaticMeshComponent* MakeInstancer(UStaticMesh* Mesh, FName Name, bool bVisible);

	/** The three kinds of blocking box, made on demand: solid, feet only (a ledge), shots only (a barrier). */
	UInstancedStaticMeshComponent* GetBlockInstancer(bool bStopsPawns, bool bStopsShots);

	/** Adds one box instance in cm, centred on Centre, to an instancer built from the engine's 100 cm cube. */
	static void AddBox(UInstancedStaticMeshComponent* Instancer, const FVector& Centre, const FVector& SizeCm, const FQuat& Rotation);

	/** Runs on: every machine. Builds the grid's boxes and the props' barriers. */
	void BuildCollision();

	/** Runs on: every machine. Stretches the level's navigation bounds over the floor and asks for a rebuild. */
	void RefreshNavigationBounds();

	/** Runs on: server. Builds a gate, a button or a block for every marker a rule matches. */
	void SpawnFloorObjects();

	/**
	 * Runs on: every machine. Lights the floor the way the original lights it.
	 *
	 * Each archived scene records its own ambient colour and background, and they are not decoration: the Mission Lobby
	 * is a dark blue room, and a generic white sun over it washes the whole tileset out to paper. This is the scene's
	 * own numbers, not a new look.
	 */
	void ApplyFloorLighting();

	/** The rule for one marker, or none. The most particular rule wins, so a general one can be a fallback. */
	const FClockworksFloorObjectRule* FindRule(FName Category, const FString& Config) const;

	/** Everything SpawnFloorObjects made, so a new floor can clear the old one's. */
	UPROPERTY(Transient)
	TArray<TObjectPtr<AClockworksFloorObject>> Objects;

	/** Server only: how many times each signal stands raised. */
	TMap<FName, int32> Signals;

	UPROPERTY(Transient)
	TArray<TObjectPtr<UInstancedStaticMeshComponent>> Built;

	/** Solid, feet only, shots only. */
	UPROPERTY(Transient)
	TObjectPtr<UInstancedStaticMeshComponent> SolidBlocks;

	UPROPERTY(Transient)
	TObjectPtr<UInstancedStaticMeshComponent> FootBlocks;

	UPROPERTY(Transient)
	TObjectPtr<UInstancedStaticMeshComponent> ShotBlocks;

	/** The grid, for answering questions about a spot without a trace. Rebuilt with the floor. */
	TMap<FIntPoint, FClockworksFloorCellLookup> Grid;

	/** The lowest cell on the floor, which is where the floor boxes reach down to. */
	int32 MinElevation = 0;
};
