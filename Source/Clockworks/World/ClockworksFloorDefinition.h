// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "ClockworksFloorDefinition.generated.h"

class USoundBase;
class UStaticMesh;

/**
 * One mesh and everywhere it stands on a floor. A Spiral Knights floor is a few hundred tile and prop models repeated
 * thousands of times, so each is drawn as one instanced mesh rather than an actor apiece.
 *
 * These are scenery only. What stops a knight is the cell grid below, exactly as it is in the original: the models are
 * dressing over a tile map, and a wall blocks because its cell says so, not because its mesh is in the way.
 */
USTRUCT(BlueprintType)
struct FClockworksFloorMeshGroup
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "Floor")
	TSoftObjectPtr<UStaticMesh> Mesh;

	/** Where every copy of it stands, already in Unreal's space (the manifest does the conversion). */
	UPROPERTY(EditAnywhere, Category = "Floor")
	TArray<FTransform> Instances;

	/** The game's own name for it, kept for reading a floor back (e.g. "world/tileset/clockworks/floor/floor_base.dat|catwalk_08"). */
	UPROPERTY(EditAnywhere, Category = "Floor")
	FString Source;
};

/**
 * One tile of the floor's grid: how high it is and what it stops.
 *
 * The original is a 100 cm grid with a height in half-tile steps, and every question about movement and line of fire is
 * answered here rather than by geometry. `Collision` is the scene's own bit field (wall, edge, player, monster, item,
 * player_barrier, monster_barrier, attack_barrier, ...) and is tested against the masks on the floor, which are the
 * game's own. `Floor` says the tile can be stood on at all (its bits: default, switch, mobile).
 */
USTRUCT(BlueprintType)
struct FClockworksFloorCell
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "Cell")
	FIntPoint Tile = FIntPoint::ZeroValue;

	/** Height in the original's steps; a step is `ElevationCm`. */
	UPROPERTY(EditAnywhere, Category = "Cell")
	int32 Elevation = 0;

	UPROPERTY(EditAnywhere, Category = "Cell")
	int32 Collision = 0;

	UPROPERTY(EditAnywhere, Category = "Cell")
	int32 Floor = 0;
};

/**
 * A prop that stops things where the tile grid does not: a roadblock, an invisible barrier around a shop, the rail
 * along a catwalk. The original gives each a rectangle or a circle in tiles, and its own copy of the collision bits.
 */
USTRUCT(BlueprintType)
struct FClockworksFloorBlocker
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "Blocker")
	FTransform Where;

	/** Its footprint in cm. A circle uses X as the diameter and leaves Y at 0. */
	UPROPERTY(EditAnywhere, Category = "Blocker")
	FVector2D SizeCm = FVector2D::ZeroVector;

	UPROPERTY(EditAnywhere, Category = "Blocker")
	bool bCircle = false;

	UPROPERTY(EditAnywhere, Category = "Blocker")
	int32 Collision = 0;

	/** The original's name for it, e.g. "Null barrier, no-walk no-shoot". */
	UPROPERTY(EditAnywhere, Category = "Blocker")
	FString Config;
};

/**
 * Somewhere on the floor that means something to the game rather than the eye: where the knights arrive, where the
 * elevator stands, where monsters are spawned, a shop, a door, a switch, a treasure box.
 *
 * The categories are the ones the floor research read off the original's placeable configs, among them
 * player_entrance, elevator_exit, monster_spawn, npc_spawn, shop, door, barrier, switch, breakable, block, treasure,
 * hazard, respawn_pad, boss_object, lift_object, trigger, light, camera, sound, prop and misc_dynamic.
 */
USTRUCT(BlueprintType)
struct FClockworksFloorMarker
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "Marker")
	FName Category;

	UPROPERTY(EditAnywhere, Category = "Marker")
	FTransform Where;

	/** The original's config name, so an unbuilt marker can still be identified later ("Elevator/Exit", "Shop/Arsenal"). */
	UPROPERTY(EditAnywhere, Category = "Marker")
	FString Config;
};

/**
 * One real Spiral Knights floor, ready to be built in the world.
 *
 * Written by `Tools/SKImport/generate_floor_assets.py` from the manifests in `D:\Dev\SKAssets\_floors`, which were
 * decoded from the community scene archive with the placement rules read out of the game's own engine. Nothing here is
 * authored by hand: a floor is the original's own tiles, props, grid and markers, and the only judgement in the
 * conversion is which imported mesh answers to which of its model sets.
 *
 * The data is identical on every machine, so each builds its own copy of the scenery and its collision; none of it is
 * replicated. What the floor means — which monsters stand where, when the elevator opens — is the director's, and that
 * is the server's alone.
 */
UCLASS(BlueprintType)
class UClockworksFloorDefinition : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:

	/** The original's name for it, e.g. "Clockwork Tunnels: Slimeway". */
	UPROPERTY(EditAnywhere, Category = "Floor")
	FString LevelName;

	/** Which archived scene this came from, for tracing a floor back to its capture. */
	UPROPERTY(EditAnywhere, Category = "Floor")
	FString SceneId;

	/** Its size in tiles, and the corner its tile coordinates start at. */
	UPROPERTY(EditAnywhere, Category = "Floor")
	FIntPoint SizeTiles = FIntPoint::ZeroValue;

	UPROPERTY(EditAnywhere, Category = "Floor")
	FIntPoint MinTile = FIntPoint::ZeroValue;

	/** A tile's width in cm, and the height of one elevation step. Both are the original's. */
	UPROPERTY(EditAnywhere, Category = "Floor")
	float TileCm = 100.f;

	UPROPERTY(EditAnywhere, Category = "Floor")
	float ElevationCm = 50.f;

	UPROPERTY(EditAnywhere, Category = "Floor")
	TArray<FClockworksFloorMeshGroup> MeshGroups;

	UPROPERTY(EditAnywhere, Category = "Floor")
	TArray<FClockworksFloorCell> Cells;

	UPROPERTY(EditAnywhere, Category = "Floor")
	TArray<FClockworksFloorBlocker> Blockers;

	UPROPERTY(EditAnywhere, Category = "Floor")
	TArray<FClockworksFloorMarker> Markers;

	/** The game's own masks: which collision bits stop a knight, a shot and a monster. */
	UPROPERTY(EditAnywhere, Category = "Floor")
	int32 KnightMask = 43;

	UPROPERTY(EditAnywhere, Category = "Floor")
	int32 BulletMask = 137;

	UPROPERTY(EditAnywhere, Category = "Floor")
	int32 MonsterMask = 79;

	/** The floor's own background colour and ambient light, from the scene's globals. */
	UPROPERTY(EditAnywhere, Category = "Floor")
	FLinearColor BackgroundColor = FLinearColor::Black;

	UPROPERTY(EditAnywhere, Category = "Floor")
	FLinearColor AmbientColor = FLinearColor::Black;

	/** The floor's own music, if the scene names one. */
	UPROPERTY(EditAnywhere, Category = "Floor")
	TSoftObjectPtr<USoundBase> Music;

	/** How many mesh copies it draws in all, for the line it logs when it is built. */
	UFUNCTION(BlueprintPure, Category = "Floor")
	int32 CountInstances() const
	{
		int32 Total = 0;
		for (const FClockworksFloorMeshGroup& Group : MeshGroups)
		{
			Total += Group.Instances.Num();
		}
		return Total;
	}

	/** Every marker of one category, in the order the scene lists them. */
	UFUNCTION(BlueprintPure, Category = "Floor")
	TArray<FTransform> FindMarkers(FName Category) const
	{
		TArray<FTransform> Found;
		for (const FClockworksFloorMarker& Marker : Markers)
		{
			if (Marker.Category == Category)
			{
				Found.Add(Marker.Where);
			}
		}
		return Found;
	}

	/** The first marker of a category, or false if the floor has none. */
	UFUNCTION(BlueprintPure, Category = "Floor")
	bool FindMarker(FName Category, FTransform& OutWhere) const
	{
		for (const FClockworksFloorMarker& Marker : Markers)
		{
			if (Marker.Category == Category)
			{
				OutWhere = Marker.Where;
				return true;
			}
		}
		return false;
	}
};
