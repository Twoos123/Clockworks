// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "ClockworksDamageNumber.generated.h"

class UTextRenderComponent;

/**
 * The number that floats off something you just hit.
 *
 * Spiral Knights colours these by how the target's family took the hit — grey when it was resisted,
 * blue when it landed as written, gold when it was a weakness — and that colour is the only way a
 * player ever learns the weakness chart. Without it the chart is a rule in a menu; with it, it is
 * something you notice in the second room.
 *
 * A text render actor rather than a screen widget, because a number belongs over the thing it
 * refers to and has to survive several at once without a widget pool.
 *
 * Purely cosmetic and never replicated: every machine spawns its own from the hit it already sees.
 */
UCLASS()
class AClockworksDamageNumber : public AActor
{
	GENERATED_BODY()

public:

	AClockworksDamageNumber();

	virtual void Tick(float DeltaSeconds) override;

	/**
	 * Sets the number and picks its colour from how the family took it. Call immediately after
	 * spawning, before the first tick.
	 *
	 * FamilyMultiplier above one is a weakness, below one a resistance.
	 */
	void ShowDamage(float Amount, float FamilyMultiplier);

protected:

	UPROPERTY(VisibleAnywhere, Category = "Damage Number")
	TObjectPtr<UTextRenderComponent> Text;

	/** The hit landed as written. */
	UPROPERTY(EditDefaultsOnly, Category = "Damage Number")
	FColor NeutralColor = FColor(150, 195, 255);

	/** The family resisted it. Deliberately drab: a grey number should feel like a wasted swing. */
	UPROPERTY(EditDefaultsOnly, Category = "Damage Number")
	FColor ResistedColor = FColor(140, 140, 145);

	/** The family is weak to it. The one number on screen worth being pleased about. */
	UPROPERTY(EditDefaultsOnly, Category = "Damage Number")
	FColor WeaknessColor = FColor(255, 205, 90);

	/** How far it drifts upward over its life, in cm. */
	UPROPERTY(EditDefaultsOnly, Category = "Damage Number", meta = (ClampMin = "0.0"))
	float RiseDistance = 90.f;

	/** Sideways scatter, so several hits in a row do not stack into an unreadable column. */
	UPROPERTY(EditDefaultsOnly, Category = "Damage Number", meta = (ClampMin = "0.0"))
	float Scatter = 45.f;

	UPROPERTY(EditDefaultsOnly, Category = "Damage Number", meta = (ClampMin = "0.05"))
	float LifeSeconds = 0.9f;

	UPROPERTY(EditDefaultsOnly, Category = "Damage Number", meta = (ClampMin = "1.0"))
	float BaseTextSize = 34.f;

	/** A weakness hit is drawn bigger as well as gold, so it reads without having to be looked at. */
	UPROPERTY(EditDefaultsOnly, Category = "Damage Number", meta = (ClampMin = "1.0"))
	float WeaknessTextScale = 1.35f;

private:

	float Elapsed = 0.f;
	FVector StartLocation = FVector::ZeroVector;
	FVector Drift = FVector::ZeroVector;
};
