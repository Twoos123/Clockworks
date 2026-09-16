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
void AClockworksFloorObject::SetupFromMarker(const FClockworksFloorMarker& Marker)
{
	Config = Marker.Config;
	SignalTag = Marker.Tag;
	Emits = Marker.Emits;
	Params = Marker.Params;
}

FString AClockworksFloorObject::Param(FName Name, const FString& Fallback) const
{
	const FString* Found = Params.Find(Name);
	return Found ? *Found : Fallback;
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
void AClockworksFloorObject::Emit(bool bReleasing)
{
	if (!HasAuthority())
	{
		return;
	}
	for (const FClockworksFloorEmission& Emission : Emits)
	{
		if (Emission.bOnRelease == bReleasing && !Emission.TargetTag.IsNone())
		{
			SendSignal(Emission.TargetTag, Emission.Verb);
		}
	}
}

// Runs on: server.
void AClockworksFloorObject::SendSignal(FName TargetTag, FName Verb)
{
	if (!HasAuthority())
	{
		return;
	}
	if (AClockworksFloorBuilder* Builder = FindFloor())
	{
		Builder->SendSignal(TargetTag, Verb, this);
	}
	else
	{
		UE_LOG(LogClockworks, Warning, TEXT("Floor: %s sent '%s' with no floor to carry it"), *GetName(), *Verb.ToString());
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
