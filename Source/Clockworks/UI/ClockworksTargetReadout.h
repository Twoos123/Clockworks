// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "ClockworksTargetReadout.generated.h"

class AClockworksEnemyCharacter;
class UHorizontalBox;
class USizeBox;
class UTextBlock;

/**
 * The targeting readout, top-centre: the monster nearest the mouse cursor, its health, the damage type
 * it attacks with, and what it is weak and resistant to. The original's targeting UI shows exactly
 * this, and it is where a new player learns the weakness chart without opening a wiki.
 *
 * It follows the cursor rather than the last thing hit, so a monster can be read before the fight
 * starts, and it lingers a moment after the cursor moves off so it does not flicker.
 *
 * Local display of replicated state: the enemy's health attribute, and its family and attacks, which
 * are class defaults every machine already has.
 */
UCLASS()
class UClockworksTargetReadout : public UUserWidget
{
	GENERATED_BODY()

public:

	UClockworksTargetReadout(const FObjectInitializer& ObjectInitializer);

protected:

	virtual TSharedRef<SWidget> RebuildWidget() override;
	virtual void NativeTick(const FGeometry& MyGeometry, float InDeltaTime) override;

	void BuildTree();

	/** The living enemy whose centre is nearest the cursor on screen, within PickRadius. */
	AClockworksEnemyCharacter* FindTargetUnderCursor() const;

	/** Fills in the name, the family and the rows of damage type icons for a new target. */
	void BuildChart(const AClockworksEnemyCharacter* Enemy);

	/** One damage type icon at the end of Box. */
	void AddTypeIcon(UHorizontalBox* Box, const TCHAR* TextureName, const FLinearColor& Fallback);

	static bool IsAlive(const AClockworksEnemyCharacter* Enemy);

	/** "BP_RoyalJelly" reads as "Royal Jelly". */
	static FText MakeEnemyName(const AClockworksEnemyCharacter* Enemy);

	/** How close to a monster the cursor must be, in screen units at 1080p. */
	UPROPERTY(EditDefaultsOnly, Category = "Target", meta = (ClampMin = "10.0"))
	float PickRadius = 90.f;

	/** How long the readout stays after the cursor leaves its monster. */
	UPROPERTY(EditDefaultsOnly, Category = "Target", meta = (ClampMin = "0.0"))
	float LingerSeconds = 2.f;

	/** Seconds between looks for what is under the cursor. */
	UPROPERTY(EditDefaultsOnly, Category = "Target", meta = (ClampMin = "0.0"))
	float PickInterval = 0.1f;

	UPROPERTY(EditDefaultsOnly, Category = "Target", meta = (ClampMin = "120.0"))
	float PanelWidth = 300.f;

	UPROPERTY(EditDefaultsOnly, Category = "Target", meta = (ClampMin = "0.0"))
	float TopMargin = 8.f;

private:

	UPROPERTY()
	TObjectPtr<UWidget> PanelRoot;

	UPROPERTY()
	TObjectPtr<UTextBlock> NameText;

	UPROPERTY()
	TObjectPtr<UTextBlock> FamilyText;

	UPROPERTY()
	TObjectPtr<USizeBox> HealthFillBox;

	UPROPERTY()
	TObjectPtr<UHorizontalBox> AttackBox;

	UPROPERTY()
	TObjectPtr<UHorizontalBox> WeakBox;

	UPROPERTY()
	TObjectPtr<UHorizontalBox> ResistBox;

	UPROPERTY()
	TObjectPtr<UTextBlock> WeakLabel;

	UPROPERTY()
	TObjectPtr<UTextBlock> ResistLabel;

	TWeakObjectPtr<AClockworksEnemyCharacter> Target;
	TWeakObjectPtr<const AClockworksEnemyCharacter> ChartBuiltFor;

	float HealthBarWidth = 276.f;
	float ShownHealthFraction = -1.f;
	float LingerAge = 0.f;
	float PickClock = 0.f;
};
