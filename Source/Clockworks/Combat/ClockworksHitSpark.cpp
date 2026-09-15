// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksHitSpark.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "UObject/ConstructorHelpers.h"

// Runs on: whichever machine spawned it. Never replicated: this is a local flourish and every
// machine makes its own from the hit flash it already gets.
AClockworksHitSpark::AClockworksHitSpark()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = true;
	bReplicates = false;
	SetCanBeDamaged(false);

	SparkMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("SparkMesh"));
	RootComponent = SparkMesh;
	SparkMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	SparkMesh->SetCastShadow(false);
	SparkMesh->bReceivesDecals = false;

	// The engine sphere is 100 cm across, so a radius in centimetres is scale = radius / 50.
	static ConstructorHelpers::FObjectFinder<UStaticMesh> SphereMesh(TEXT("/Engine/BasicShapes/Sphere.Sphere"));
	if (SphereMesh.Succeeded())
	{
		SparkMesh->SetStaticMesh(SphereMesh.Object);
	}
}

// Runs on: the machine that spawned it.
void AClockworksHitSpark::BeginPlay()
{
	Super::BeginPlay();

	if (SparkMaterial && SparkMesh)
	{
		SparkMaterialInstance = UMaterialInstanceDynamic::Create(SparkMaterial, this);
		SparkMesh->SetMaterial(0, SparkMaterialInstance);
		SparkMaterialInstance->SetVectorParameterValue(ColorParameterName, SparkColor);
		SparkMaterialInstance->SetScalarParameterValue(BrightnessParameterName, Brightness);
	}

	// Start at the opening size so the first frame is already correct; a spark that spends its first
	// frame at the wrong scale is visible at this length.
	if (SparkMesh)
	{
		SparkMesh->SetWorldScale3D(FVector(StartRadius / 50.f, StartRadius / 50.f, StartRadius / 50.f * HeightStretch));
	}

	// A hard backstop, in case something stops this ticking.
	SetLifeSpan(LifeSeconds * 2.f + 1.f);
}

// Runs on: the machine that spawned it. Expand and fade, then go.
void AClockworksHitSpark::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	Elapsed += DeltaSeconds;
	const float Alpha = FMath::Clamp(Elapsed / FMath::Max(LifeSeconds, 0.01f), 0.f, 1.f);

	// Fast out of the gate and slowing as it goes, which is what an impact looks like.
	const float EasedAlpha = 1.f - FMath::Square(1.f - Alpha);
	const float Radius = FMath::Lerp(StartRadius, EndRadius, EasedAlpha);
	if (SparkMesh)
	{
		SparkMesh->SetWorldScale3D(FVector(Radius / 50.f, Radius / 50.f, Radius / 50.f * HeightStretch));
	}
	if (SparkMaterialInstance)
	{
		SparkMaterialInstance->SetScalarParameterValue(OpacityParameterName, 1.f - Alpha);
	}

	if (Alpha >= 1.f)
	{
		Destroy();
	}
}
