// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksFloorDirector.h"
#include "ClockworksCharacter.h"
#include "ClockworksElevator.h"
#include "ClockworksEnemyCharacter.h"
#include "ClockworksGameState.h"
#include "Clockworks.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Controller.h"
#include "NavigationSystem.h"

// Runs on: all machines (class default object and every instance). Only the server does anything.
AClockworksFloorDirector::AClockworksFloorDirector()
{
	PrimaryActorTick.bCanEverTick = false;
	bReplicates = false;
}

// Runs on: all machines. The binding is harmless on a client; the guard inside is what keeps the
// work server-only.
void AClockworksFloorDirector::BeginPlay()
{
	Super::BeginPlay();

	UWorld* World = GetWorld();
	AClockworksGameState* GameState = World ? World->GetGameState<AClockworksGameState>() : nullptr;
	if (!GameState)
	{
		UE_LOG(LogClockworks, Warning,
			TEXT("FloorDirector: no AClockworksGameState, so there is no run to build floors for."));
		return;
	}

	GameState->OnDepthChanged.AddUObject(this, &AClockworksFloorDirector::OnDepthChanged);

	// One elevator per floor, and finding it beats making someone wire it up.
	if (!Elevator)
	{
		for (TActorIterator<AClockworksElevator> It(World); It; ++It)
		{
			Elevator = *It;
			break;
		}
	}

	if (HasAuthority())
	{
		BuildFloor();
	}
}

// Runs on: all machines.
void AClockworksFloorDirector::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (UWorld* World = GetWorld())
	{
		if (AClockworksGameState* GameState = World->GetGameState<AClockworksGameState>())
		{
			GameState->OnDepthChanged.RemoveAll(this);
		}
	}
	Super::EndPlay(EndPlayReason);
}

// Runs on: every machine, because the delegate fires on every machine. Only the server builds; the
// result reaches the others as ordinary actor replication.
void AClockworksFloorDirector::OnDepthChanged()
{
	if (HasAuthority())
	{
		BuildFloor();
	}
}

// Runs on: server only. The one place a floor comes into being.
void AClockworksFloorDirector::BuildFloor()
{
	UWorld* World = GetWorld();
	AClockworksGameState* GameState = World ? World->GetGameState<AClockworksGameState>() : nullptr;
	if (!HasAuthority() || !GameState || bBuilding)
	{
		return;
	}
	bBuilding = true;

	const int32 Depth = GameState->GetDepth();
	const EClockworksFloorKind Kind = GameState->GetFloorKind();

	ClearFloor();
	PlacePlayers();

	int32 Spawned = 0;

	switch (Kind)
	{
	case EClockworksFloorKind::Boss:
		if (BossMonster)
		{
			FVector Location;
			if (FindSpawnPoint(Location))
			{
				FActorSpawnParameters Params;
				Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
				if (World->SpawnActor<AClockworksEnemyCharacter>(BossMonster, Location, FRotator::ZeroRotator, Params))
				{
					++Spawned;
				}
			}
		}
		break;

	case EClockworksFloorKind::Tunnels:
	{
		const int32 Wanted = MonsterCountForDepth(Depth);
		for (int32 Index = 0; Index < Wanted; ++Index)
		{
			TSubclassOf<AClockworksEnemyCharacter> Monster = PickMonster(Depth);
			FVector Location;
			if (!Monster || !FindSpawnPoint(Location))
			{
				continue;
			}
			FActorSpawnParameters Params;
			Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
			if (World->SpawnActor<AClockworksEnemyCharacter>(Monster, Location, FRotator::ZeroRotator, Params))
			{
				++Spawned;
			}
		}
		break;
	}

	case EClockworksFloorKind::Lobby:
	case EClockworksFloorKind::Terminal:
	case EClockworksFloorKind::Core:
	default:
		// Nothing to fight. A lobby is where a run starts, a terminal is where it catches its breath,
		// and the Core is where it ends.
		break;
	}

	// A floor with nothing on it has already been cleared, so the way down opens at once. Otherwise
	// the elevator finds that out for itself when the last monster falls.
	if (Elevator)
	{
		const bool bNothingToFight = (Spawned == 0);
		Elevator->SetOpen(bNothingToFight && Kind != EClockworksFloorKind::Core);
	}

	UE_LOG(LogClockworks, Log, TEXT("Floor: depth %d (%s), %d monsters"),
		Depth, *GameState->GetFloorName().ToString(), Spawned);

	bBuilding = false;
}

// Runs on: server only. A floor never inherits the last one's monsters.
void AClockworksFloorDirector::ClearFloor()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	TArray<AClockworksEnemyCharacter*> Doomed;
	for (TActorIterator<AClockworksEnemyCharacter> It(World); It; ++It)
	{
		if (IsValid(*It))
		{
			Doomed.Add(*It);
		}
	}
	for (AClockworksEnemyCharacter* Enemy : Doomed)
	{
		Enemy->Destroy();
	}
}

// Runs on: server only. Everyone arrives at the entrance, on their feet.
void AClockworksFloorDirector::PlacePlayers()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	const FVector Entrance = EntranceMarker ? EntranceMarker->GetActorLocation() : GetActorLocation();

	int32 Index = 0;
	for (TActorIterator<AClockworksCharacter> It(World); It; ++It)
	{
		AClockworksCharacter* Knight = *It;
		if (!IsValid(Knight) || !Knight->GetController())
		{
			continue;
		}

		// Fanned out a little, so two knights do not arrive inside one another.
		const float Angle = Index * 90.f;
		const FVector Offset = FVector(FMath::Cos(FMath::DegreesToRadians(Angle)),
		                               FMath::Sin(FMath::DegreesToRadians(Angle)), 0.f) * (Index > 0 ? 120.f : 0.f);
		Knight->SetActorLocation(Entrance + Offset, /*bSweep*/ false, nullptr, ETeleportType::TeleportPhysics);
		++Index;
	}
}

// Runs on: server only.
int32 AClockworksFloorDirector::MonsterCountForDepth(int32 Depth) const
{
	const int32 Wanted = BaseMonsterCount + FMath::RoundToInt(MonstersPerDepth * FMath::Max(Depth - 1, 0));
	return FMath::Clamp(Wanted, 0, MaxMonsterCount);
}

// Runs on: server only. Weighted, and only from what this depth has unlocked.
TSubclassOf<AClockworksEnemyCharacter> AClockworksFloorDirector::PickMonster(int32 Depth) const
{
	float TotalWeight = 0.f;
	for (const FClockworksMonsterSpawn& Entry : TunnelMonsters)
	{
		if (Entry.Monster && Depth >= Entry.MinDepth)
		{
			TotalWeight += FMath::Max(Entry.Weight, 0.f);
		}
	}
	if (TotalWeight <= 0.f)
	{
		return nullptr;
	}

	float Roll = FMath::FRandRange(0.f, TotalWeight);
	for (const FClockworksMonsterSpawn& Entry : TunnelMonsters)
	{
		if (!Entry.Monster || Depth < Entry.MinDepth)
		{
			continue;
		}
		Roll -= FMath::Max(Entry.Weight, 0.f);
		if (Roll <= 0.f)
		{
			return Entry.Monster;
		}
	}
	return nullptr;
}

// Runs on: server only. On the ground, and not on top of the people who just arrived.
bool AClockworksFloorDirector::FindSpawnPoint(FVector& OutLocation) const
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return false;
	}

	const FVector Centre = GetActorLocation();
	const FVector Entrance = EntranceMarker ? EntranceMarker->GetActorLocation() : Centre;
	UNavigationSystemV1* Navigation = FNavigationSystem::GetCurrent<UNavigationSystemV1>(World);

	// A handful of tries rather than a search: the arena is mostly open, and a monster that cannot
	// find a spot is better skipped than placed somewhere silly.
	for (int32 Attempt = 0; Attempt < 24; ++Attempt)
	{
		FVector Candidate = Centre;

		if (Navigation)
		{
			FNavLocation NavLocation;
			if (!Navigation->GetRandomReachablePointInRadius(Centre, SpawnRadius, NavLocation))
			{
				continue;
			}
			Candidate = NavLocation.Location;
		}
		else
		{
			// No navigation mesh built yet: fall back to a ring, which at least spreads them out.
			const float Angle = FMath::FRandRange(0.f, 360.f);
			const float Distance = FMath::FRandRange(MinDistanceFromEntrance, SpawnRadius);
			Candidate = Centre + FVector(FMath::Cos(FMath::DegreesToRadians(Angle)),
			                             FMath::Sin(FMath::DegreesToRadians(Angle)), 0.f) * Distance;
		}

		if (FVector::Dist2D(Candidate, Entrance) < MinDistanceFromEntrance)
		{
			continue;
		}

		OutLocation = Candidate + FVector(0.f, 0.f, 100.f);
		return true;
	}

	return false;
}
