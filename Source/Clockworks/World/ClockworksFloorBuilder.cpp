// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksFloorBuilder.h"

#include "Clockworks.h"
#include "ClockworksFloorDefinition.h"
#include "ClockworksFloorObject.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "Components/SkyLightComponent.h"
#include "Engine/PostProcessVolume.h"
#include "Engine/DirectionalLight.h"
#include "Engine/ExponentialHeightFog.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Engine/SkyLight.h"
#include "Components/DirectionalLightComponent.h"
#include "NavMesh/NavMeshBoundsVolume.h"
#include "NavigationSystem.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
	/** The engine's own 100 cm cube, which every invisible collision box is an instance of. */
	const TCHAR* BoxMeshPath = TEXT("/Engine/BasicShapes/Cube.Cube");
}

AClockworksFloorBuilder::AClockworksFloorBuilder()
{
	PrimaryActorTick.bCanEverTick = false;

	// A floor is the same asset on every machine and is built from it, so there is nothing to send about it.
	bReplicates = false;

	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	RootComponent->SetMobility(EComponentMobility::Static);
}

// Runs on: every machine.
void AClockworksFloorBuilder::BeginPlay()
{
	Super::BeginPlay();

	if (Floor)
	{
		BuildFloor(Floor);
	}
}

// Runs on: every machine. The definition is identical everywhere, so every machine builds the same floor.
void AClockworksFloorBuilder::BuildFloor(UClockworksFloorDefinition* InFloor)
{
	ClearFloor();

	Floor = InFloor;
	if (!Floor)
	{
		return;
	}

	// The grid first: the boxes and every question about a spot are answered from it.
	MinElevation = 0;
	for (const FClockworksFloorCell& Cell : Floor->Cells)
	{
		MinElevation = FMath::Min(MinElevation, Cell.Elevation);

		FClockworksFloorCellLookup& Entry = Grid.FindOrAdd(Cell.Tile);
		Entry.HeightCm = Cell.Elevation * Floor->ElevationCm;
		Entry.Collision = Cell.Collision;
		Entry.Floor = Cell.Floor;
	}

	int32 Instances = 0, Missing = 0;
	for (int32 Index = 0; Index < Floor->MeshGroups.Num(); ++Index)
	{
		const FClockworksFloorMeshGroup& Group = Floor->MeshGroups[Index];
		if (Group.Instances.Num() == 0)
		{
			continue;
		}

		// Synchronous: a floor has to stand before anyone is put on it, and these are the models it is made of.
		UStaticMesh* Mesh = Group.Mesh.LoadSynchronous();
		if (!Mesh)
		{
			++Missing;
			continue;
		}

		UInstancedStaticMeshComponent* Instancer = MakeInstancer(Mesh, *FString::Printf(TEXT("Scenery_%d"), Index), /*bVisible*/ true);
		if (!Instancer)
		{
			continue;
		}

		Instancer->AddInstances(Group.Instances, /*bShouldReturnIndices*/ false, /*bWorldSpace*/ false);
		Instances += Group.Instances.Num();
	}

	BuildCollision();
	SpawnFloorObjects();

	if (bApplyFloorLighting)
	{
		ApplyFloorLighting();
	}

	if (bResizeNavigationBounds)
	{
		RefreshNavigationBounds();
	}

	UE_LOG(LogClockworks, Warning, TEXT("Floor: built %s (%s) - %d models, %d copies, %d cells, %d markers, %d objects%s"),
		*Floor->LevelName, *Floor->SceneId, Floor->MeshGroups.Num(), Instances, Floor->Cells.Num(), Floor->Markers.Num(),
		Objects.Num(), Missing > 0 ? *FString::Printf(TEXT(", %d models missing"), Missing) : TEXT(""));
}

// Runs on: every machine.
void AClockworksFloorBuilder::ClearFloor()
{
	for (UInstancedStaticMeshComponent* Instancer : Built)
	{
		if (Instancer)
		{
			Instancer->DestroyComponent();
		}
	}
	for (AClockworksFloorObject* Object : Objects)
	{
		if (IsValid(Object))
		{
			Object->Destroy();
		}
	}
	Objects.Reset();
	SignalsSent.Reset();

	Built.Reset();
	SolidBlocks = nullptr;
	FootBlocks = nullptr;
	ShotBlocks = nullptr;
	Grid.Reset();
}

UInstancedStaticMeshComponent* AClockworksFloorBuilder::MakeInstancer(UStaticMesh* Mesh, FName Name, bool bVisible)
{
	if (!Mesh)
	{
		return nullptr;
	}

	UInstancedStaticMeshComponent* Instancer = NewObject<UInstancedStaticMeshComponent>(this, Name);

	// Movable: the component is made after the world is running, and a floor is replaced on every descent.
	Instancer->SetMobility(EComponentMobility::Movable);
	Instancer->SetStaticMesh(Mesh);
	Instancer->SetupAttachment(RootComponent);

	if (bVisible)
	{
		// Scenery is scenery. What stops anything is the grid, built below.
		Instancer->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Instancer->SetCanEverAffectNavigation(false);
	}

	Instancer->RegisterComponent();
	AddInstanceComponent(Instancer);
	Built.Add(Instancer);
	return Instancer;
}

UInstancedStaticMeshComponent* AClockworksFloorBuilder::GetBlockInstancer(bool bStopsPawns, bool bStopsShots)
{
	TObjectPtr<UInstancedStaticMeshComponent>& Slot =
		(bStopsPawns && bStopsShots) ? SolidBlocks : (bStopsPawns ? FootBlocks : ShotBlocks);
	if (Slot)
	{
		return Slot;
	}

	UStaticMesh* Box = LoadObject<UStaticMesh>(nullptr, BoxMeshPath);
	if (!Box)
	{
		UE_LOG(LogClockworks, Error, TEXT("Floor: the engine's cube is missing, so the floor has no collision"));
		return nullptr;
	}

	const FName Name = (bStopsPawns && bStopsShots) ? TEXT("SolidBlocks") : (bStopsPawns ? TEXT("FootBlocks") : TEXT("ShotBlocks"));
	UInstancedStaticMeshComponent* Instancer = MakeInstancer(Box, Name, /*bVisible*/ false);
	if (!Instancer)
	{
		return nullptr;
	}

	Instancer->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
	Instancer->SetCollisionObjectType(ECC_WorldStatic);
	Instancer->SetCollisionResponseToAllChannels(ECR_Ignore);
	if (bStopsPawns)
	{
		// Knights and monsters are both pawns. The original tells them apart (a monster-only pen keeps knights out);
		// until there is a channel of our own for monsters, a barrier against either stops both.
		Instancer->SetCollisionResponseToChannel(ECC_Pawn, ECR_Block);
	}
	if (bStopsShots)
	{
		// A bullet's sphere is a dynamic object that blocks against static geometry.
		Instancer->SetCollisionResponseToChannel(ECC_WorldDynamic, ECR_Block);
		Instancer->SetCollisionResponseToChannel(ECC_WorldStatic, ECR_Block);
		Instancer->SetCollisionResponseToChannel(ECC_PhysicsBody, ECR_Block);
	}

	// A ledge is not walkable and a wall is not passable, and the navigation mesh has to know both. A barrier that only
	// stops shots must not shape it, or monsters would refuse to walk through a doorway they can walk through.
	Instancer->SetCanEverAffectNavigation(bStopsPawns);

	Instancer->SetVisibility(bShowCollision);
	Instancer->SetHiddenInGame(!bShowCollision);
	Instancer->SetCastShadow(false);

	Slot = Instancer;
	return Instancer;
}

void AClockworksFloorBuilder::AddBox(UInstancedStaticMeshComponent* Instancer, const FVector& Centre, const FVector& SizeCm, const FQuat& Rotation)
{
	if (!Instancer)
	{
		return;
	}

	// The engine's cube is 100 cm on a side and centred on its origin, so its scale is the size in tiles.
	Instancer->AddInstance(FTransform(Rotation, Centre, SizeCm / 100.f), /*bWorldSpace*/ false);
}

// Runs on: every machine.
void AClockworksFloorBuilder::BuildCollision()
{
	if (!Floor)
	{
		return;
	}

	const float Tile = Floor->TileCm;
	const int32 PawnMask = Floor->KnightMask | Floor->MonsterMask;

	for (const FClockworksFloorCell& Cell : Floor->Cells)
	{
		// Tile (x, y) is the square from its corner to one tile further in each direction; the game's own axes are
		// swapped against ours, so the tile's x runs along our Y.
		const FVector Centre(Cell.Tile.Y * Tile + Tile * 0.5f, Cell.Tile.X * Tile + Tile * 0.5f, 0.f);
		const float Surface = Cell.Elevation * Floor->ElevationCm;

		if ((Cell.Floor & 1) != 0)
		{
			// Down to below the lowest cell on the floor, so a step down is a face rather than a lip with a gap under it.
			const float Depth = FMath::Max(FloorThicknessCm, Surface - MinElevation * Floor->ElevationCm + FloorThicknessCm);
			AddBox(GetBlockInstancer(/*bStopsPawns*/ true, /*bStopsShots*/ true),
				Centre + FVector(0.f, 0.f, Surface - Depth * 0.5f), FVector(Tile, Tile, Depth), FQuat::Identity);
		}

		const bool bStopsPawns = (Cell.Collision & PawnMask) != 0;
		const bool bStopsShots = (Cell.Collision & Floor->BulletMask) != 0;
		if (bStopsPawns || bStopsShots)
		{
			AddBox(GetBlockInstancer(bStopsPawns, bStopsShots),
				Centre + FVector(0.f, 0.f, Surface + BlockerHeightCm * 0.5f),
				FVector(Tile, Tile, BlockerHeightCm), FQuat::Identity);
		}
	}

	for (const FClockworksFloorBlocker& Blocker : Floor->Blockers)
	{
		const bool bStopsPawns = (Blocker.Collision & PawnMask) != 0;
		const bool bStopsShots = (Blocker.Collision & Floor->BulletMask) != 0;
		if (!bStopsPawns && !bStopsShots)
		{
			continue;
		}

		// A circle is kept as a box of its diameter: the original's own shapes are rectangles almost everywhere, and a
		// box that is a little too generous around a barrel is not something a player can feel.
		const float SizeX = Blocker.SizeCm.X > 0.f ? Blocker.SizeCm.X : Floor->TileCm;
		const float SizeY = Blocker.bCircle ? SizeX : (Blocker.SizeCm.Y > 0.f ? Blocker.SizeCm.Y : Floor->TileCm);

		AddBox(GetBlockInstancer(bStopsPawns, bStopsShots),
			Blocker.Where.GetLocation() + FVector(0.f, 0.f, PropBlockerHeightCm * 0.5f),
			FVector(SizeX, SizeY, PropBlockerHeightCm), Blocker.Where.GetRotation());
	}
}

// Runs on: every machine. The navigation mesh builds at runtime, but only inside a bounds volume.
void AClockworksFloorBuilder::RefreshNavigationBounds()
{
	UWorld* World = GetWorld();
	if (!World || !Floor || Floor->Cells.Num() == 0)
	{
		return;
	}

	FBox Bounds(ForceInit);
	for (const FClockworksFloorCell& Cell : Floor->Cells)
	{
		const FVector Centre(Cell.Tile.Y * Floor->TileCm + Floor->TileCm * 0.5f,
			Cell.Tile.X * Floor->TileCm + Floor->TileCm * 0.5f,
			Cell.Elevation * Floor->ElevationCm);
		Bounds += Centre;
	}
	Bounds = Bounds.ExpandBy(FVector(Floor->TileCm, Floor->TileCm, BlockerHeightCm + FloorThicknessCm));

	ANavMeshBoundsVolume* Volume = nullptr;
	for (TActorIterator<ANavMeshBoundsVolume> It(World); It; ++It)
	{
		Volume = *It;
		break;
	}
	if (!Volume)
	{
		UE_LOG(LogClockworks, Warning,
			TEXT("Floor: the level has no navigation bounds volume, so monsters will walk straight at their target"));
		return;
	}

	// A bounds volume placed by hand is a 200 cm cube's brush scaled to taste; stretching it is a scale and a move.
	if (USceneComponent* Root = Volume->GetRootComponent())
	{
		Root->SetMobility(EComponentMobility::Movable);
	}

	const FVector Size = Bounds.GetSize();
	Volume->SetActorLocation(Bounds.GetCenter());
	Volume->SetActorScale3D(Size / 200.f);

	if (UNavigationSystemV1* Navigation = FNavigationSystem::GetCurrent<UNavigationSystemV1>(World))
	{
		Navigation->OnNavigationBoundsUpdated(Volume);
	}
}

FVector AClockworksFloorBuilder::GetEntranceLocation() const
{
	FTransform Where;
	if (Floor && Floor->FindMarker(TEXT("player_entrance"), Where))
	{
		// Snapped, because an archived entrance marker is not always on a floor tile.
		FVector Standing;
		return FindNearestWalkable(Where.GetLocation(), Standing) ? Standing : Where.GetLocation();
	}
	if (Floor && Floor->Cells.Num() > 0)
	{
		FBox Bounds(ForceInit);
		for (const FClockworksFloorCell& Cell : Floor->Cells)
		{
			Bounds += FVector(Cell.Tile.Y * Floor->TileCm, Cell.Tile.X * Floor->TileCm, Cell.Elevation * Floor->ElevationCm);
		}
		return Bounds.GetCenter();
	}
	return GetActorLocation();
}

bool AClockworksFloorBuilder::GetElevatorTransform(FTransform& OutWhere) const
{
	return Floor && Floor->FindMarker(TEXT("elevator_exit"), OutWhere);
}

FIntPoint AClockworksFloorBuilder::TileAt(const FVector& WorldLocation) const
{
	const float Tile = Floor ? Floor->TileCm : 100.f;
	return FIntPoint(FMath::FloorToInt(WorldLocation.Y / Tile), FMath::FloorToInt(WorldLocation.X / Tile));
}

bool AClockworksFloorBuilder::IsWalkable(const FVector& WorldLocation) const
{
	const FClockworksFloorCellLookup* Cell = Grid.Find(TileAt(WorldLocation));
	return Cell && (Cell->Floor & 1) != 0 && Floor && (Cell->Collision & Floor->KnightMask) == 0;
}

bool AClockworksFloorBuilder::FindNearestWalkable(const FVector& Near, FVector& OutLocation) const
{
	if (!Floor)
	{
		return false;
	}

	const FIntPoint Start = TileAt(Near);
	const float Tile = Floor->TileCm;

	// Outwards a ring at a time, so the answer is the closest one rather than the first one found.
	for (int32 Radius = 0; Radius <= 16; ++Radius)
	{
		for (int32 OffsetX = -Radius; OffsetX <= Radius; ++OffsetX)
		{
			for (int32 OffsetY = -Radius; OffsetY <= Radius; ++OffsetY)
			{
				if (Radius > 0 && FMath::Abs(OffsetX) != Radius && FMath::Abs(OffsetY) != Radius)
				{
					continue;
				}

				const FIntPoint Tested(Start.X + OffsetX, Start.Y + OffsetY);
				const FClockworksFloorCellLookup* Cell = Grid.Find(Tested);
				if (!Cell || (Cell->Floor & 1) == 0 || (Cell->Collision & Floor->KnightMask) != 0)
				{
					continue;
				}

				OutLocation = FVector(Tested.Y * Tile + Tile * 0.5f, Tested.X * Tile + Tile * 0.5f, Cell->HeightCm);
				return true;
			}
		}
	}
	return false;
}

bool AClockworksFloorBuilder::FindGroundHeight(const FVector& WorldLocation, float& OutHeight) const
{
	if (const FClockworksFloorCellLookup* Cell = Grid.Find(TileAt(WorldLocation)))
	{
		OutHeight = Cell->HeightCm;
		return (Cell->Floor & 1) != 0;
	}
	return false;
}

// Runs on: server. Only the server builds the gates and buttons; they replicate down like any other actor.
void AClockworksFloorBuilder::SpawnFloorObjects()
{
	UWorld* World = GetWorld();
	if (!World || !Floor || !HasAuthority() || ObjectRules.Num() == 0)
	{
		return;
	}

	TMap<FName, int32> Unbuilt;
	for (const FClockworksFloorMarker& Marker : Floor->Markers)
	{
		// The mined behaviour is the better key: it boils 373 of the original's config names down to five kinds.
		const FClockworksFloorObjectRule* Rule = FindRule(
			Marker.Behaviour.IsNone() ? Marker.Category : Marker.Behaviour, Marker.Config);
		if (!Rule || !Rule->ObjectClass)
		{
			Unbuilt.FindOrAdd(Marker.Behaviour.IsNone() ? Marker.Category : Marker.Behaviour)++;
			continue;
		}

		FActorSpawnParameters Params;
		Params.Owner = this;
		Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;

		// Deferred, so the marker's own settings are read before BeginPlay decides what the object waits for.
		AClockworksFloorObject* Object = World->SpawnActorDeferred<AClockworksFloorObject>(
			Rule->ObjectClass, Marker.Where, this, nullptr, ESpawnActorCollisionHandlingMethod::AlwaysSpawn);
		if (!Object)
		{
			continue;
		}
		Object->SetupFromMarker(Marker);
		Object->FinishSpawning(Marker.Where);
		Objects.Add(Object);
	}

	if (Unbuilt.Num() > 0)
	{
		// Said once per floor rather than per marker: a floor carries far more than is built yet, and pretending
		// otherwise is how a missing gate becomes a mystery later.
		FString Note;
		for (const TPair<FName, int32>& Pair : Unbuilt)
		{
			Note += FString::Printf(TEXT("%s%s x%d"), Note.IsEmpty() ? TEXT("") : TEXT(", "), *Pair.Key.ToString(), Pair.Value);
		}
		UE_LOG(LogClockworks, Warning, TEXT("Floor: %d markers have nothing to build yet (%s)"), Floor->Markers.Num() - Objects.Num(), *Note);
	}
}

const FClockworksFloorObjectRule* AClockworksFloorBuilder::FindRule(FName Category, const FString& Config) const
{
	const FClockworksFloorObjectRule* Best = nullptr;
	int32 BestLength = -1;
	for (const FClockworksFloorObjectRule& Rule : ObjectRules)
	{
		if (!Rule.Category.IsNone() && Rule.Category != Category)
		{
			continue;
		}
		if (!Rule.ConfigContains.IsEmpty() && !Config.Contains(Rule.ConfigContains))
		{
			continue;
		}
		// The most particular rule wins, so "Iron Gate/Monster" beats a plain "Iron Gate".
		if (Rule.ConfigContains.Len() > BestLength)
		{
			BestLength = Rule.ConfigContains.Len();
			Best = &Rule;
		}
	}
	return Best;
}

// Runs on: server.
void AClockworksFloorBuilder::SendSignal(FName TargetTag, FName Verb, AActor* From)
{
	if (!HasAuthority())
	{
		return;
	}

	const int32 Sent = ++SignalsSent.FindOrAdd(TargetTag);
	UE_LOG(LogClockworks, Warning, TEXT("Floor: '%s' sent to '%s' by %s (%d so far)"),
		*Verb.ToString(), *TargetTag.ToString(), From ? *From->GetName() : TEXT("nothing"), Sent);

	OnSignal.Broadcast(TargetTag, Verb, From);
}

// Runs on: every machine. Lighting is cosmetic and identical everywhere, so it is not replicated.
void AClockworksFloorBuilder::ApplyFloorLighting()
{
	UWorld* World = GetWorld();
	if (!World || !Floor)
	{
		return;
	}

	// The scene's ambient is the colour the room is lit by when nothing else lights it. The original's lobby is a
	// blue-grey room, and the number is right there in the capture.
	const FLinearColor Ambient = Floor->AmbientColor;
	const float AmbientStrength = FMath::Max3(Ambient.R, Ambient.G, Ambient.B);

	for (TActorIterator<ASkyLight> It(World); It; ++It)
	{
		if (USkyLightComponent* Light = It->GetLightComponent())
		{
			Light->SetMobility(EComponentMobility::Movable);
			if (AmbientStrength > 0.f)
			{
				Light->SetLightColor(Ambient / AmbientStrength);
				Light->SetIntensity(AmbientStrength);
			}
			Light->SetLowerHemisphereColor(Floor->BackgroundColor);
		}
	}

	for (TActorIterator<ADirectionalLight> It(World); It; ++It)
	{
		if (UDirectionalLightComponent* Light = Cast<UDirectionalLightComponent>(It->GetLightComponent()))
		{
			Light->SetMobility(EComponentMobility::Movable);
			Light->SetIntensity(SunLux);
		}
	}

	// Exposure is pinned, not adapted. Left to adapt, the eye meters a dim room and multiplies it until the tileset's
	// dark blue panels clip to white, which is why turning the lights down changed nothing.
	APostProcessVolume* Volume = nullptr;
	for (TActorIterator<APostProcessVolume> It(World); It; ++It)
	{
		Volume = *It;
		break;
	}
	if (!Volume)
	{
		FActorSpawnParameters Params;
		Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		Volume = World->SpawnActor<APostProcessVolume>(APostProcessVolume::StaticClass(), FTransform::Identity, Params);
	}
	if (Volume)
	{
		Volume->bUnbound = true;
		Volume->Priority = 1.f;
		FPostProcessSettings& Settings = Volume->Settings;
		Settings.bOverride_AutoExposureMethod = true;
		Settings.AutoExposureMethod = EAutoExposureMethod::AEM_Manual;
		Settings.bOverride_AutoExposureBias = true;
		Settings.AutoExposureBias = ExposureEV;
		Settings.bOverride_AutoExposureApplyPhysicalCameraExposure = true;
		Settings.AutoExposureApplyPhysicalCameraExposure = false;
	}

	for (TActorIterator<AExponentialHeightFog> It(World); It; ++It)
	{
		if (UExponentialHeightFogComponent* Fog = It->GetComponent())
		{
			Fog->SetFogInscatteringColor(Floor->BackgroundColor);
		}
	}

	UE_LOG(LogClockworks, Warning, TEXT("Floor: lit from the scene's own ambient %s (strength %.2f), sun %.1f lux, exposure EV %.1f"),
		*Ambient.ToString(), AmbientStrength, SunLux, ExposureEV);
}
