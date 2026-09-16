// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksReadyRoom.h"

#include "Clockworks.h"
#include "ClockworksCharacter.h"
#include "ClockworksPlayerController.h"
#include "UI/ClockworksActivitiesPanel.h"
#include "Camera/CameraComponent.h"
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

	ActivitiesClass = UClockworksActivitiesPanel::StaticClass();
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
	Controller->SetViewTargetWithBlend(this, 0.f);

	if (APawn* Pawn = Controller->GetPawn())
	{
		Pawn->DisableInput(Controller);
		Pawn->SetActorHiddenInGame(true);
	}

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

	UE_LOG(LogClockworks, Warning, TEXT("ReadyRoom: entered - fixed camera, no movement, activities up"));
}
