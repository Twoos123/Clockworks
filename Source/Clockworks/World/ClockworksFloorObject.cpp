// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksFloorObject.h"

#include "Clockworks.h"
#include "ClockworksFloorBuilder.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
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
	BuildPieces();
}

// Runs on: every machine. The same data everywhere, so nothing about it is sent.
void AClockworksFloorObject::BuildPieces()
{
	for (int32 Index = 0; Index < Meshes.Num(); ++Index)
	{
		UStaticMesh* Mesh = Meshes[Index].LoadSynchronous();
		if (!Mesh)
		{
			continue;
		}

		UStaticMeshComponent* Piece = NewObject<UStaticMeshComponent>(this, *FString::Printf(TEXT("Piece_%d"), Index));
		Piece->SetMobility(EComponentMobility::Movable);
		Piece->SetStaticMesh(Mesh);
		// The object's own body is what collides; the model is only what you see.
		Piece->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Piece->SetCanEverAffectNavigation(false);
		Piece->SetupAttachment(RootComponent);
		Piece->RegisterComponent();
		AddInstanceComponent(Piece);
		Pieces.Add(Piece);
	}
}

// Runs on: every machine. Cosmetic.
void AClockworksFloorObject::SetPiecesVisible(bool bVisible)
{
	for (UStaticMeshComponent* Piece : Pieces)
	{
		if (Piece)
		{
			Piece->SetVisibility(bVisible);
		}
	}
}

// Runs on: every machine. Cosmetic.
void AClockworksFloorObject::SetPiecesOffset(const FVector& Offset)
{
	for (UStaticMeshComponent* Piece : Pieces)
	{
		if (Piece)
		{
			Piece->SetRelativeLocation(Offset);
		}
	}
}

// Runs on: server, before the spawn finishes.
void AClockworksFloorObject::SetupFromMarker(const FClockworksFloorMarker& Marker)
{
	Config = Marker.Config;
	Meshes = Marker.Meshes;
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
