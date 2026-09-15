// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksElevator.h"
#include "ClockworksCharacter.h"
#include "ClockworksEnemyCharacter.h"
#include "ClockworksGameState.h"
#include "Clockworks.h"
#include "Components/BoxComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/TextRenderComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Net/UnrealNetwork.h"
#include "UObject/ConstructorHelpers.h"

#define LOCTEXT_NAMESPACE "Clockworks"

// Runs on: all machines (class default object and every replicated instance).
AClockworksElevator::AClockworksElevator()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = true;
	bReplicates = true;

	Trigger = CreateDefaultSubobject<UBoxComponent>(TEXT("Trigger"));
	RootComponent = Trigger;
	Trigger->SetBoxExtent(FVector(120.f, 120.f, 100.f));
	Trigger->SetCollisionProfileName(TEXT("OverlapAllDynamic"));
	Trigger->SetGenerateOverlapEvents(true);

	// A flat pad on the floor. Its colour is the whole of the elevator's state: shut, open, or
	// counting down with someone on it.
	Platform = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Platform"));
	Platform->SetupAttachment(RootComponent);
	Platform->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Platform->SetCastShadow(false);
	Platform->bReceivesDecals = false;

	static ConstructorHelpers::FObjectFinder<UStaticMesh> CubeMesh(TEXT("/Engine/BasicShapes/Cube.Cube"));
	if (CubeMesh.Succeeded())
	{
		Platform->SetStaticMesh(CubeMesh.Object);
		Platform->SetRelativeScale3D(FVector(2.4f, 2.4f, 0.08f));
		Platform->SetRelativeLocation(FVector(0.f, 0.f, -96.f));
	}

	Sign = CreateDefaultSubobject<UTextRenderComponent>(TEXT("Sign"));
	Sign->SetupAttachment(RootComponent);
	Sign->SetRelativeLocation(FVector(0.f, 0.f, 60.f));
	Sign->SetRelativeRotation(FRotator(0.f, 180.f, 0.f));
	Sign->SetHorizontalAlignment(EHTA_Center);
	Sign->SetWorldSize(34.f);
	Sign->SetTextRenderColor(FColor::White);
}

// Runs on: all machines (the engine asks once per class).
void AClockworksElevator::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);

	DOREPLIFETIME(AClockworksElevator, bOpen);
}

// Runs on: all machines.
void AClockworksElevator::BeginPlay()
{
	Super::BeginPlay();

	if (PadMaterial && Platform)
	{
		PadMaterialInstance = UMaterialInstanceDynamic::Create(PadMaterial, this);
		Platform->SetMaterial(0, PadMaterialInstance);
	}

	if (HasAuthority())
	{
		bOpen = bStartOpen;
	}
	RefreshVisuals();
}

// Runs on: server only for the rules; every machine for the paint.
void AClockworksElevator::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	if (!HasAuthority() || bDescending)
	{
		RefreshVisuals();
		return;
	}

	// "Clear the floor" without anything keeping a list of what is on it: the elevator simply looks
	// for a living enemy each frame and opens when it cannot find one.
	if (!bOpen && bOpenWhenFloorCleared)
	{
		bool bAnyEnemyAlive = false;
		for (TActorIterator<AClockworksEnemyCharacter> It(GetWorld()); It; ++It)
		{
			if (IsValid(*It) && !It->IsHidden())
			{
				bAnyEnemyAlive = true;
				break;
			}
		}
		if (!bAnyEnemyAlive)
		{
			SetOpen(true);
		}
	}

	if (!bOpen)
	{
		BoardedSeconds = 0.f;
		RefreshVisuals();
		return;
	}

	// Everyone goes together, or nobody does. That is the original's rule and the one that matters
	// once there are two knights.
	if (AreAllPlayersAboard())
	{
		BoardedSeconds += DeltaSeconds;
		if (BoardedSeconds >= BoardingSeconds)
		{
			Descend();
		}
	}
	else
	{
		BoardedSeconds = 0.f;
	}

	RefreshVisuals();
}

// Runs on: server only.
bool AClockworksElevator::AreAllPlayersAboard() const
{
	UWorld* World = GetWorld();
	if (!World || !Trigger)
	{
		return false;
	}

	TArray<AActor*> Overlapping;
	Trigger->GetOverlappingActors(Overlapping, AClockworksCharacter::StaticClass());

	int32 Living = 0;
	for (TActorIterator<AClockworksCharacter> It(World); It; ++It)
	{
		AClockworksCharacter* Knight = *It;
		if (!IsValid(Knight) || Knight->IsDead() || !Knight->GetController())
		{
			continue;
		}
		++Living;
		if (!Overlapping.Contains(Knight))
		{
			return false;
		}
	}

	return Living > 0;
}

// Runs on: server only. The one place a floor ends.
void AClockworksElevator::Descend()
{
	if (bDescending)
	{
		return;
	}

	AClockworksGameState* GameState = GetWorld() ? GetWorld()->GetGameState<AClockworksGameState>() : nullptr;
	if (!GameState)
	{
		UE_LOG(LogClockworks, Warning,
			TEXT("Elevator: no AClockworksGameState, so there is nothing to descend into. "
			     "Set the GameStateClass on the game mode."));
		return;
	}

	bDescending = true;
	if (GameState->AdvanceDepth())
	{
		UE_LOG(LogClockworks, Log, TEXT("Elevator: the party descended to depth %d"), GameState->GetDepth());
	}
	MulticastDescended();

	// Shut behind them, so the next floor's elevator starts closed like any other.
	SetOpen(false);
	bDescending = false;
	BoardedSeconds = 0.f;
}

// Runs on: server only.
void AClockworksElevator::SetOpen(bool bNewOpen)
{
	if (!HasAuthority() || bOpen == bNewOpen)
	{
		return;
	}
	bOpen = bNewOpen;

	if (bOpen && OpenSound)
	{
		UGameplayStatics::PlaySoundAtLocation(this, OpenSound, GetActorLocation());
	}
	RefreshVisuals();
}

// Runs on: clients, when the server's state arrives.
void AClockworksElevator::OnRep_Open()
{
	if (bOpen && OpenSound)
	{
		UGameplayStatics::PlaySoundAtLocation(this, OpenSound, GetActorLocation());
	}
	RefreshVisuals();
}

// Runs on: all machines (multicast from the server). Cosmetic; the depth has already changed.
void AClockworksElevator::MulticastDescended_Implementation()
{
	if (DescendSound)
	{
		UGameplayStatics::PlaySoundAtLocation(this, DescendSound, GetActorLocation());
	}
}

// Runs on: every machine. Everything it reads is either replicated or local, so each machine paints
// the same pad without anything being sent for it.
void AClockworksElevator::RefreshVisuals()
{
	FLinearColor Wanted = bOpen ? OpenColor : ClosedColor;
	if (bOpen && BoardedSeconds > 0.f)
	{
		Wanted = BoardingColor;
	}

	if (PadMaterialInstance && Wanted != ShownColor)
	{
		ShownColor = Wanted;
		PadMaterialInstance->SetVectorParameterValue(PadColorParameterName, Wanted);
		PadMaterialInstance->SetScalarParameterValue(PadOpacityParameterName, 0.75f);
	}

	if (!Sign)
	{
		return;
	}

	const AClockworksGameState* GameState = GetWorld() ? GetWorld()->GetGameState<AClockworksGameState>() : nullptr;
	if (!GameState)
	{
		return;
	}

	if (!bOpen)
	{
		Sign->SetText(LOCTEXT("ElevatorClosed", "CLEAR THE FLOOR"));
		Sign->SetTextRenderColor(FColor(200, 90, 90));
		return;
	}

	if (GameState->GetDepth() >= GameState->GetMaxDepth())
	{
		Sign->SetText(LOCTEXT("ElevatorEnd", "THE CORE"));
		Sign->SetTextRenderColor(FColor(230, 190, 90));
		return;
	}

	Sign->SetText(FText::Format(LOCTEXT("ElevatorDepth", "DEPTH {0}"), FText::AsNumber(GameState->GetDepth() + 1)));
	Sign->SetTextRenderColor(FColor::White);
}

#undef LOCTEXT_NAMESPACE
