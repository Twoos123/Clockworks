// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksFloorProp.h"

#include "Components/BoxComponent.h"

// Runs on: all machines.
AClockworksFloorProp::AClockworksFloorProp()
{
	// A prop is its model and nothing else, so the root is just a place to hang the pieces off.
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	RootComponent->SetMobility(EComponentMobility::Movable);
}

// Runs on: all machines.
void AClockworksFloorProp::BeginPlay()
{
	Super::BeginPlay();

	if (!bBlocksMovement)
	{
		return;
	}

	UBoxComponent* Body = NewObject<UBoxComponent>(this, TEXT("Body"));
	Body->SetBoxExtent(FVector(BlockSizeCm * 0.5f, BlockSizeCm * 0.5f, BlockHeightCm * 0.5f));
	Body->SetRelativeLocation(FVector(0.f, 0.f, BlockHeightCm * 0.5f));
	Body->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
	Body->SetCollisionObjectType(ECC_WorldStatic);
	Body->SetCollisionResponseToAllChannels(ECR_Ignore);
	Body->SetCollisionResponseToChannel(ECC_Pawn, ECR_Block);
	Body->SetupAttachment(RootComponent);
	Body->RegisterComponent();
	AddInstanceComponent(Body);
}
