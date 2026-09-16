// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksFloorDoor.h"

#include "Clockworks.h"
#include "ClockworksEnemyCharacter.h"
#include "ClockworksFloorBuilder.h"
#include "ClockworksFloorDefinition.h"
#include "Components/BoxComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "EngineUtils.h"
#include "Net/UnrealNetwork.h"
#include "TimerManager.h"

namespace
{
	/** How often a gate that waits on monsters looks to see whether any are left, in seconds. */
	constexpr float MonsterCheckSeconds = 0.5f;
}

// Runs on: all machines.
AClockworksFloorDoor::AClockworksFloorDoor()
{
	Barrier = CreateDefaultSubobject<UBoxComponent>(TEXT("Barrier"));
	Barrier->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
	Barrier->SetCollisionObjectType(ECC_WorldStatic);
	Barrier->SetCollisionResponseToAllChannels(ECR_Ignore);
	// A shut gate stops knights, monsters and shots alike.
	Barrier->SetCollisionResponseToChannel(ECC_Pawn, ECR_Block);
	Barrier->SetCollisionResponseToChannel(ECC_WorldDynamic, ECR_Block);
	Barrier->SetCanEverAffectNavigation(true);
	RootComponent = Barrier;

	GateMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("GateMesh"));
	GateMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	GateMesh->SetupAttachment(Barrier);
}

// Runs on: all machines (the engine asks once per class).
void AClockworksFloorDoor::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);

	DOREPLIFETIME(AClockworksFloorDoor, bOpen);
}

// Runs on: server, before the spawn finishes.
void AClockworksFloorDoor::SetupFromMarker(const FString& InConfig, FName InTag)
{
	Super::SetupFromMarker(InConfig, InTag);

	// The original puts everything about a gate in its name: "Dynamic/Door/Iron Gate/Trigger 3" is three signals and
	// three tiles wide, "Monster 5" is a room to clear and five tiles wide.
	if (Config.Contains(TEXT("Monster")))
	{
		Key = EClockworksDoorKey::MonstersCleared;
	}
	else if (Config.Contains(TEXT("Gold")))
	{
		Key = EClockworksDoorKey::GoldKey;
	}
	else if (Config.Contains(TEXT("Energy")))
	{
		Key = EClockworksDoorKey::Energy;
	}

	// The trailing number is both how many it wants and how wide it is.
	FString Tail = Config;
	int32 Slash = INDEX_NONE;
	if (Config.FindLastChar(TEXT('/'), Slash))
	{
		Tail = Config.Mid(Slash + 1);
	}
	FString Digits;
	for (int32 Index = Tail.Len() - 1; Index >= 0 && FChar::IsDigit(Tail[Index]); --Index)
	{
		Digits = FString::Chr(Tail[Index]) + Digits;
	}
	if (!Digits.IsEmpty())
	{
		const int32 Number = FCString::Atoi(*Digits);
		WidthTiles = Number;
		RequiredSignals = Key == EClockworksDoorKey::Signals ? Number : 1;
	}
}

// Runs on: all machines.
void AClockworksFloorDoor::BeginPlay()
{
	Super::BeginPlay();

	const float Tile = Floor && Floor->GetFloor() ? Floor->GetFloor()->TileCm : 100.f;
	Barrier->SetBoxExtent(FVector(WidthTiles * Tile * 0.5f, Tile * 0.5f, BarrierHeightCm * 0.5f));
	Barrier->AddLocalOffset(FVector(0.f, 0.f, BarrierHeightCm * 0.5f));

	if (bOpen)
	{
		ApplyOpenState();
		return;
	}

	if (!HasAuthority())
	{
		return;
	}

	switch (Key)
	{
	case EClockworksDoorKey::Signals:
		if (AClockworksFloorBuilder* Builder = FindFloor())
		{
			Builder->OnSignal.AddDynamic(this, &AClockworksFloorDoor::HandleSignal);
			// A signal may already have been raised before this gate existed.
			HandleSignal(SignalTag, Builder->SignalCount(SignalTag));
		}
		break;

	case EClockworksDoorKey::MonstersCleared:
		GetWorldTimerManager().SetTimer(MonsterTimer, this, &AClockworksFloorDoor::CheckMonsters,
			MonsterCheckSeconds, /*bLoop*/ true);
		break;

	default:
		// A gold key or a power supply is carried, and neither is built yet; the gate stands shut and says so once.
		UE_LOG(LogClockworks, Warning, TEXT("Floor: %s waits for something not built yet (%s) and will stay shut"),
			*GetName(), *Config);
		break;
	}
}

// Runs on: server.
void AClockworksFloorDoor::HandleSignal(FName Tag, int32 Count)
{
	if (!HasAuthority() || bOpen || Tag != SignalTag)
	{
		return;
	}
	if (Count >= RequiredSignals)
	{
		Open();
	}
}

// Runs on: server.
void AClockworksFloorDoor::CheckMonsters()
{
	if (!HasAuthority() || bOpen)
	{
		return;
	}

	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	// A dead monster is hidden rather than destroyed, which is how the elevator counts them too.
	for (TActorIterator<AClockworksEnemyCharacter> It(World); It; ++It)
	{
		if (IsValid(*It) && !It->IsHidden())
		{
			return;
		}
	}

	GetWorldTimerManager().ClearTimer(MonsterTimer);
	Open();
}

// Runs on: server.
void AClockworksFloorDoor::ForceOpen()
{
	if (HasAuthority() && !bOpen)
	{
		Open();
	}
}

// Runs on: server.
void AClockworksFloorDoor::Open()
{
	bOpen = true;
	GetWorldTimerManager().ClearTimer(MonsterTimer);
	ApplyOpenState();

	UE_LOG(LogClockworks, Warning, TEXT("Floor: gate open (%s)"), *Config);
}

// Runs on: clients.
void AClockworksFloorDoor::OnRep_Open()
{
	ApplyOpenState();
}

// Runs on: every machine, off the replicated state, so the gate is never open on one machine and shut on another and
// nothing has to be sent for the sound.
void AClockworksFloorDoor::ApplyOpenState()
{
	Barrier->SetCollisionEnabled(bOpen ? ECollisionEnabled::NoCollision : ECollisionEnabled::QueryAndPhysics);
	GateMesh->SetVisibility(!bOpen);

	if (bOpen && OpenSound && HasActorBegunPlay())
	{
		UGameplayStatics::PlaySoundAtLocation(this, OpenSound, GetActorLocation());
	}
}
