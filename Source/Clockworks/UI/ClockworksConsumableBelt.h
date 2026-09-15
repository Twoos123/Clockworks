// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "ClockworksConsumableBelt.generated.h"

/**
 * The belt, bottom-centre, after the user's screenshots of the original: four quick slots on keys 4
 * to 7 and a fifth, red-rimmed slot for a vitapod. Spiral Knights keeps health capsules, remedies and
 * vials here.
 *
 * Empty for now, on the user's decision: the consumables themselves are a separate item on the demo
 * list. The slots are drawn so the layout is complete, and they are pictures, so a click on one is
 * still an attack.
 *
 * Local display only.
 */
UCLASS()
class UClockworksConsumableBelt : public UUserWidget
{
	GENERATED_BODY()

public:

	UClockworksConsumableBelt(const FObjectInitializer& ObjectInitializer);

protected:

	virtual TSharedRef<SWidget> RebuildWidget() override;

	void BuildTree();

	/** One slot; Key empty means no badge. The vitapod slot has its own red rim. */
	UWidget* MakeBeltSlot(const FText& Key, bool bVitapod);

	UPROPERTY(EditDefaultsOnly, Category = "Belt", meta = (ClampMin = "16.0"))
	float SlotSize = 62.f;

	UPROPERTY(EditDefaultsOnly, Category = "Belt", meta = (ClampMin = "1"))
	int32 QuickSlotCount = 4;

	/** The key the first quick slot answers to. The original's quick slots are 4 to 7. */
	UPROPERTY(EditDefaultsOnly, Category = "Belt", meta = (ClampMin = "0"))
	int32 FirstKey = 4;

	UPROPERTY(EditDefaultsOnly, Category = "Belt", meta = (ClampMin = "0.0"))
	float BottomMargin = 4.f;
};
