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
void AClockworksFloorDoor::SetupFromMarker(const FClockworksFloorMarker& Marker)
{
	Super::SetupFromMarker(Marker);

	// The count is the original's own argument where it carried one, and one signal otherwise.
	RequiredSignals = FMath::Max(1, FCString::Atoi(*Param(TEXT("triggers"), TEXT("1"))));

	// The name says what opens it and how wide it stands. The number is the width, not a count: "Trigger 3" loads the
	// game's own irongate/3wide model, and a gate's required count is a separate argument that can differ from it
	// (a "Multi Trigger 3" placed with Triggers: "4"). Research 2026-09-15, _research/floor_objects/report.md.
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
		WidthTiles = FCString::Atoi(*Digits);
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

// Runs on: server. Addressed by tag: a gate is targeted, it does not listen for a name.
void AClockworksFloorDoor::HandleSignal(FName TargetTag, FName Verb, AActor* From)
{
	if (!HasAuthority() || TargetTag != SignalTag || SignalTag.IsNone())
	{
		return;
	}

	static const FName OpenVerb(TEXT("open"));
	static const FName CloseVerb(TEXT("close"));
	static const FName ToggleVerb(TEXT("toggle"));
	static const FName IncrementVerb(TEXT("increment"));

	if (Verb == CloseVerb)
	{
		Openers.Reset();
		SetOpen(false);
		return;
	}

	if (Verb == ToggleVerb)
	{
		Openers.Reset();
		SetOpen(!bOpen);
		return;
	}

	if (Verb == OpenVerb || Verb == IncrementVerb || Verb.IsNone())
	{
		// Counted by who sent it, so a lever worked twice is still one of the three a gate is waiting for.
		Openers.Add(From);
		if (Openers.Num() >= RequiredSignals)
		{
			SetOpen(true);
		}
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
	SetOpen(true);
}

// Runs on: server.
void AClockworksFloorDoor::ForceOpen()
{
	if (HasAuthority() && !bOpen)
	{
		SetOpen(true);
	}
}

// Runs on: server.
void AClockworksFloorDoor::SetOpen(bool bNewOpen)
{
	if (bOpen == bNewOpen)
	{
		return;
	}

	bOpen = bNewOpen;
	if (bOpen)
	{
		GetWorldTimerManager().ClearTimer(MonsterTimer);
	}
	ApplyOpenState();

	UE_LOG(LogClockworks, Warning, TEXT("Floor: gate %s '%s' (%s)"),
		bOpen ? TEXT("open") : TEXT("shut"), *SignalTag.ToString(), *Config);
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
