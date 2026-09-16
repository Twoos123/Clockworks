// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksReadyRoom.h"

#include "Clockworks.h"
#include "ClockworksCharacter.h"
#include "ClockworksPlayerController.h"
#include "UI/ClockworksActivitiesPanel.h"
#include "UI/ClockworksEventHub.h"
#include "UI/ClockworksUplinkPanel.h"
#include "Camera/CameraComponent.h"
#include "ClockworksFloorBuilder.h"
#include "ClockworksFloorDefinition.h"
#include "EngineUtils.h"
#include "Kismet/KismetMathLibrary.h"
#include "Engine/World.h"
#include "GameFramework/Pawn.h"
#include "Kismet/GameplayStatics.h"
#include "TimerManager.h"

// Runs on: all machines.
AClockworksReadyRoom::AClockworksReadyRoom()
{
	PrimaryActorTick.bCanEverTick = false;

	// The room is the same on every machine and decides nothing, so there is nothing to send about it.
	bReplicates = false;

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	RootComponent = Camera;
	Camera->SetFieldOfView(CameraFOV);

	ActivitiesClass = UClockworksActivitiesPanel::StaticClass();
	UplinkClass = UClockworksUplinkPanel::StaticClass();
	EventHubClass = UClockworksEventHub::StaticClass();
}

// Runs on: all machines; only the local one does anything.
void AClockworksReadyRoom::BeginPlay()
{
	Super::BeginPlay();

	if (GetWorld())
	{
		GetWorldTimerManager().SetTimer(EnterTimer, this, &AClockworksReadyRoom::Enter, FMath::Max(0.01f, EnterDelay), false);
	}
}

void AClockworksReadyRoom::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (Activities)
	{
		Activities->RemoveFromParent();
		Activities = nullptr;
	}
	if (Uplink)
	{
		Uplink->RemoveFromParent();
		Uplink = nullptr;
	}
	if (EventHub)
	{
		EventHub->RemoveFromParent();
		EventHub = nullptr;
	}
	if (UWorld* World = GetWorld())
	{
		if (AClockworksPlayerController* Controller =
			Cast<AClockworksPlayerController>(UGameplayStatics::GetPlayerController(World, 0)))
		{
			Controller->SetPlayHUDVisible(true);
		}
	}
	Super::EndPlay(EndPlayReason);
}

// Runs on: the local machine only.
void AClockworksReadyRoom::Enter()
{
	UWorld* World = GetWorld();
	AClockworksPlayerController* Controller =
		World ? Cast<AClockworksPlayerController>(UGameplayStatics::GetPlayerController(World, 0)) : nullptr;
	if (!Controller)
	{
		return;
	}

	// The room is looked at, not walked around: the camera is this actor's, and the knight the game mode spawned is
	// neither shown nor driven. The original gives no movement here at all.
	if (Camera)
	{
		Camera->SetFieldOfView(CameraFOV);
	}
	Controller->SetViewTargetWithBlend(this, 0.f);

	if (APawn* Pawn = Controller->GetPawn())
	{
		Pawn->DisableInput(Controller);
		Pawn->SetActorHiddenInGame(true);
	}

	// The play HUD is not wanted here: no health to watch, no belt to read, nothing on a radar. It also carries its
	// own activities list, and leaving it up put two of them on screen at once.
	Controller->SetPlayHUDVisible(false);

	// Interface only. The cursor is the whole input here.
	FInputModeUIOnly Input;
	Input.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
	Controller->SetInputMode(Input);
	Controller->SetShowMouseCursor(true);

	if (!Activities && ActivitiesClass)
	{
		Activities = CreateWidget<UClockworksActivitiesPanel>(Controller, ActivitiesClass);
		if (Activities)
		{
			Activities->AddToPlayerScreen(100);
		}
	}
	if (!Uplink && UplinkClass)
	{
		Uplink = CreateWidget<UClockworksUplinkPanel>(Controller, UplinkClass);
		if (Uplink)
		{
			Uplink->AddToPlayerScreen(90);
		}
	}
	if (!EventHub && EventHubClass)
	{
		EventHub = CreateWidget<UClockworksEventHub>(Controller, EventHubClass);
		if (EventHub)
		{
			EventHub->AddToPlayerScreen(80);
		}
	}

	// The set's middle, taken from whatever floor was built, so the camera can be pointed at it.
	if (SetCentre.IsNearlyZero())
	{
		for (TActorIterator<AClockworksFloorBuilder> It(World); It; ++It)
		{
			if (const UClockworksFloorDefinition* Built = It->GetFloor())
			{
				FBox Bounds(ForceInit);
				for (const FClockworksFloorMeshGroup& Group : Built->MeshGroups)
				{
					if (const UStaticMesh* Mesh = Group.Mesh.LoadSynchronous())
					{
						Bounds += Mesh->GetBounds().GetBox();
					}
				}
				if (Bounds.IsValid)
				{
					SetCentre = Bounds.GetCenter();
				}
			}
			break;
		}
	}

	UE_LOG(LogClockworks, Warning, TEXT("ReadyRoom: entered - fixed camera, no movement, activities up; set centre %s"),
		*SetCentre.ToCompactString());
}

// Runs on: the local machine only. Cosmetic.
void AClockworksReadyRoom::FrameSet(const FVector& Offset)
{
	const FVector Eye = SetCentre + Offset;
	SetActorLocation(Eye);
	SetActorRotation(UKismetMathLibrary::FindLookAtRotation(Eye, SetCentre));

	UE_LOG(LogClockworks, Warning, TEXT("ReadyRoom: camera offset %s (eye %s, looking at %s)"),
		*Offset.ToCompactString(), *Eye.ToCompactString(), *SetCentre.ToCompactString());
}
