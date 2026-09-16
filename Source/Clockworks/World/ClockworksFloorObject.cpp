// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksFloorObject.h"

#include "Clockworks.h"
#include "ClockworksFloorBuilder.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "Sound/SoundBase.h"

// Runs on: all machines.
AClockworksFloorObject::AClockworksFloorObject()
{
	PrimaryActorTick.bCanEverTick = false;
	bReplicates = true;
}

// Runs on: all machines.
void AClockworksFloorObject::BeginPlay()
{
	Super::BeginPlay();

	Floor = FindFloor();
}

// Runs on: server, before the spawn finishes.
void AClockworksFloorObject::SetupFromMarker(const FString& InConfig, FName InTag)
{
	Config = InConfig;
	SignalTag = InTag;
}

AClockworksFloorBuilder* AClockworksFloorObject::FindFloor() const
{
	if (Floor)
	{
		return Floor;
	}
	if (UWorld* World = GetWorld())
	{
		for (TActorIterator<AClockworksFloorBuilder> It(World); It; ++It)
		{
			return *It;
		}
	}
	return nullptr;
}

// Runs on: server.
void AClockworksFloorObject::RaiseSignal()
{
	if (!HasAuthority())
	{
		return;
	}
	if (AClockworksFloorBuilder* Builder = FindFloor())
	{
		Builder->RaiseSignal(SignalTag, this);
	}
	else
	{
		UE_LOG(LogClockworks, Warning, TEXT("Floor: %s raised a signal with no floor to hear it"), *GetName());
	}
}

// Runs on: every machine. Cosmetic.
void AClockworksFloorObject::MulticastPlaySound_Implementation(USoundBase* Sound)
{
	if (Sound)
	{
		UGameplayStatics::PlaySoundAtLocation(this, Sound, GetActorLocation());
	}
}
