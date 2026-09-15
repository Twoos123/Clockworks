// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "ClockworksHitSpark.generated.h"

class UMaterialInstanceDynamic;
class UMaterialInterface;
class UStaticMeshComponent;

/**
 * The flash where a blow lands: a shell that expands and fades over a fifth of a second, then
 * removes itself.
 *
 * Built in C++ rather than as a Niagara system because Niagara assets cannot be authored through the
 * editor automation this project is driven by, and an expanding fresnel shell is most of what the
 * original's impact reads as anyway. Swap it for a Niagara system later by replacing the class that
 * the characters spawn.
 *
 * Cosmetic in the strictest sense. It never replicates: each machine spawns its own from the hit
 * flash it already receives, so a spark costs nothing on the wire and cannot affect the simulation.
 */
UCLASS()
class AClockworksHitSpark : public AActor
{
	GENERATED_BODY()

public:

	AClockworksHitSpark();

	/** Makes the material instance so the colour and fade can be animated without new assets. */
	virtual void BeginPlay() override;

	virtual void Tick(float DeltaSeconds) override;

	/** Overrides the colour for this one spark, for damage types later. Call before BeginPlay. */
	void SetSparkColor(const FLinearColor& NewColor) { SparkColor = NewColor; }

	/**
	 * Overrides the size and length of this one spark, before BeginPlay. HeightStretch above one makes it a
	 * column rather than a ball: a Brandish explosion, a Pulsar wave's blast.
	 */
	void SetSparkShape(float InStartRadius, float InEndRadius, float InHeightStretch, float InLifeSeconds)
	{
		StartRadius = FMath::Max(InStartRadius, 0.f);
		EndRadius = FMath::Max(InEndRadius, 0.f);
		HeightStretch = FMath::Max(InHeightStretch, 0.01f);
		LifeSeconds = FMath::Max(InLifeSeconds, 0.01f);
	}

protected:

	UPROPERTY(VisibleAnywhere, Category = "Spark")
	TObjectPtr<UStaticMeshComponent> SparkMesh;

	/**
	 * Wants an unlit, translucent, two-sided material with a colour and an opacity parameter.
	 * M_ShieldBubble is exactly that and is what this uses by default.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Spark")
	TObjectPtr<UMaterialInterface> SparkMaterial;

	UPROPERTY(EditDefaultsOnly, Category = "Spark")
	FLinearColor SparkColor = FLinearColor(1.f, 0.86f, 0.45f, 1.f);

	/** Short: a spark that outstays its welcome reads as a bug rather than an impact. */
	UPROPERTY(EditDefaultsOnly, Category = "Spark", meta = (ClampMin = "0.01"))
	float LifeSeconds = 0.18f;

	UPROPERTY(EditDefaultsOnly, Category = "Spark", meta = (ClampMin = "0.0"))
	float StartRadius = 14.f;

	UPROPERTY(EditDefaultsOnly, Category = "Spark", meta = (ClampMin = "0.0"))
	float EndRadius = 58.f;

	/** Height as a multiple of width. One is a ball. */
	UPROPERTY(EditDefaultsOnly, Category = "Spark", meta = (ClampMin = "0.01"))
	float HeightStretch = 1.f;

	/** Parameter names on SparkMaterial. The defaults match M_ShieldBubble. */
	UPROPERTY(EditDefaultsOnly, Category = "Spark")
	FName ColorParameterName = TEXT("BubbleColor");

	UPROPERTY(EditDefaultsOnly, Category = "Spark")
	FName OpacityParameterName = TEXT("Opacity");

	UPROPERTY(EditDefaultsOnly, Category = "Spark")
	FName BrightnessParameterName = TEXT("Brightness");

	UPROPERTY(EditDefaultsOnly, Category = "Spark", meta = (ClampMin = "0.0"))
	float Brightness = 6.f;

private:

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> SparkMaterialInstance;

	float Elapsed = 0.f;
};
