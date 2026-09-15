// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "ClockworksFloorDirector.generated.h"

class AClockworksElevator;
class AClockworksEnemyCharacter;

/**
 * One monster that can appear on a floor, and the rule for when it does.
 */
USTRUCT(BlueprintType)
struct FClockworksMonsterSpawn
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "Spawn")
	TSubclassOf<AClockworksEnemyCharacter> Monster;

	/**
	 * The shallowest depth it appears at. Spiral Knights introduces its monsters gradually, and the
	 * effect is that going deeper feels like meeting the place rather than meeting a bigger number.
	 */
	UPROPERTY(EditAnywhere, Category = "Spawn", meta = (ClampMin = "0"))
	int32 MinDepth = 1;

	/** Relative likelihood against the other entries eligible at this depth. */
	UPROPERTY(EditAnywhere, Category = "Spawn", meta = (ClampMin = "0.0"))
	float Weight = 1.f;
};

/**
 * Builds each floor of the run.
 *
 * A descent needs three things beyond a depth counter: the floor has to be repopulated when you
 * arrive, the knights have to arrive somewhere sensible, and the way down has to shut behind them.
 * This does those three, in response to the game state's depth changing.
 *
 * What it does not do is assemble rooms. The floors are one arena redressed, with a different
 * population each time; real room modules are the next step and this is the thing they will plug
 * into. Being honest about that is better than a procedural generator with one room in its library.
 *
 * Server only for everything that matters. It spawns monsters, which replicate on their own, and it
 * moves the knights, which replicates as movement. Nothing here has a client half.
 */
UCLASS()
class AClockworksFloorDirector : public AActor
{
	GENERATED_BODY()

public:

	AClockworksFloorDirector();

	/** Binds to the game state's depth and builds the floor the run starts on. */
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

	/** Server: tears the floor down and builds the one for the current depth. */
	UFUNCTION(BlueprintCallable, Category = "Floor")
	void BuildFloor();

protected:

	/** The depth changed under us. Server: rebuild. Clients: nothing; the result replicates. */
	void OnDepthChanged();

	/** Server: removes every enemy still standing, so a floor never inherits the last one's. */
	void ClearFloor();

	/** Server: puts the knights at the entrance, alive and whole. */
	void PlacePlayers();

	/** Server: how many monsters this depth deserves. */
	int32 MonsterCountForDepth(int32 Depth) const;

	/** Server: one monster from the table, weighted, and eligible at this depth. */
	TSubclassOf<AClockworksEnemyCharacter> PickMonster(int32 Depth) const;

	/** Server: a point on the ground inside the arena, away from where the knights come in. */
	bool FindSpawnPoint(FVector& OutLocation) const;

	/** Everything that can appear on an ordinary floor. */
	UPROPERTY(EditAnywhere, Category = "Floor")
	TArray<FClockworksMonsterSpawn> TunnelMonsters;

	/** The one that appears on the boss floor, alone. */
	UPROPERTY(EditAnywhere, Category = "Floor")
	TSubclassOf<AClockworksEnemyCharacter> BossMonster;

	/** How many monsters the first floor holds. */
	UPROPERTY(EditAnywhere, Category = "Floor", meta = (ClampMin = "0"))
	int32 BaseMonsterCount = 4;

	/** How many more each depth adds. A run should get harder for a reason you can see. */
	UPROPERTY(EditAnywhere, Category = "Floor", meta = (ClampMin = "0.0"))
	float MonstersPerDepth = 1.5f;

	UPROPERTY(EditAnywhere, Category = "Floor", meta = (ClampMin = "1"))
	int32 MaxMonsterCount = 14;

	/** Monsters appear inside this radius of the director, in cm. */
	UPROPERTY(EditAnywhere, Category = "Floor", meta = (ClampMin = "100.0"))
	float SpawnRadius = 1400.f;

	/** ...but never closer than this to where the knights come in. */
	UPROPERTY(EditAnywhere, Category = "Floor", meta = (ClampMin = "0.0"))
	float MinDistanceFromEntrance = 700.f;

	/** Where the knights arrive. Falls back to this actor's own location when unset. */
	UPROPERTY(EditAnywhere, Category = "Floor")
	TObjectPtr<AActor> EntranceMarker;

	/** The way down. Found in the level at BeginPlay when left unset. */
	UPROPERTY(EditAnywhere, Category = "Floor")
	TObjectPtr<AClockworksElevator> Elevator;

private:

	/** So a rebuild triggered while one is running cannot interleave two floors. */
	bool bBuilding = false;
};
