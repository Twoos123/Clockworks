// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "ClockworksEnemyHealthBar.generated.h"

class UBorder;
class UProgressBar;
class USizeBox;
struct FOnAttributeChangeData;

/**
 * A slim health bar floating over one enemy, the way Spiral Knights shows monster health. Display
 * only, and local to each machine: it reads the enemy's replicated Health attribute, so both players
 * see the same bar without anything extra being sent.
 *
 * Hidden while the enemy is untouched, so a room full of full-health monsters stays clean; it
 * appears the moment one takes a hit. The fill also drains through a colour ramp, which is the
 * cheapest way to read "nearly dead" from across an isometric room.
 */
UCLASS()
class UClockworksEnemyHealthBar : public UUserWidget
{
	GENERATED_BODY()

public:

	UClockworksEnemyHealthBar(const FObjectInitializer& ObjectInitializer);

	/** Called by the enemy that owns this widget once its ability system component exists. */
	void SetTargetActor(AActor* InTarget);

protected:

	virtual TSharedRef<SWidget> RebuildWidget() override;
	virtual void NativeDestruct() override;

	void BuildTree();
	void Refresh();
	void OnHealthChanged(const FOnAttributeChangeData& Data);

	UPROPERTY(EditDefaultsOnly, Category = "HealthBar", meta = (ClampMin = "8.0"))
	float BarWidth = 84.f;

	UPROPERTY(EditDefaultsOnly, Category = "HealthBar", meta = (ClampMin = "2.0"))
	float BarHeight = 9.f;

	/** Full health. */
	UPROPERTY(EditDefaultsOnly, Category = "HealthBar|Colours")
	FLinearColor HealthyColor = FLinearColor(0.95f, 0.25f, 0.25f, 1.f);

	/** Nearly dead; the fill blends to this as the bar drains. */
	UPROPERTY(EditDefaultsOnly, Category = "HealthBar|Colours")
	FLinearColor DyingColor = FLinearColor(1.f, 0.75f, 0.1f, 1.f);

	UPROPERTY(EditDefaultsOnly, Category = "HealthBar|Colours")
	FLinearColor BackgroundColor = FLinearColor(0.02f, 0.02f, 0.03f, 0.8f);

private:

	UPROPERTY()
	TObjectPtr<UProgressBar> Bar;

	UPROPERTY()
	TObjectPtr<UBorder> Background;

	TWeakObjectPtr<AActor> TargetActor;
};
