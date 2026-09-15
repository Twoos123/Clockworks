// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "ClockworksSystemButtons.generated.h"

class UButton;

/**
 * The two bottom corners, after the user's screenshots of the original: a strip of tall buttons in
 * each, with their keys on small gold badges.
 *
 * Bottom-left: main menu, help (F1), social (F6), event hub (F7), uplink.
 * Bottom-right: character (P), loadouts (L), forge (U), arsenal (I).
 *
 * Three of them do something here: the wrench opens the pause menu, the question mark opens How to
 * Play, and loadouts opens the gear screen, the same things their keys do. The rest are pictures of
 * buttons, on the user's decision: social, the forge and the arsenal are cut from this demo, and the
 * event hub and uplink are live-service screens with nothing behind them. Pictures take no clicks, so
 * a stray click on one is still an attack.
 *
 * Local only. The buttons open local menus; nothing here decides anything.
 */
UCLASS()
class UClockworksSystemButtons : public UUserWidget
{
	GENERATED_BODY()

public:

	UClockworksSystemButtons(const FObjectInitializer& ObjectInitializer);

protected:

	virtual TSharedRef<SWidget> RebuildWidget() override;

	void BuildTree();

	/**
	 * One tall button with its icon and, when Key is not empty, a key badge over its bottom edge. With
	 * OutButton it is a real button, handed back through OutButton; without, it is a picture of one.
	 */
	UWidget* MakeButton(const TCHAR* IconName, const FText& Key, bool bRoundBadge, FName ButtonName, TObjectPtr<UButton>* OutButton);

	UFUNCTION()
	void HandleMenuClicked();

	UFUNCTION()
	void HandleHelpClicked();

	UFUNCTION()
	void HandleLoadoutsClicked();

	UPROPERTY(EditDefaultsOnly, Category = "Buttons")
	FVector2D ButtonSize = FVector2D(50.f, 70.f);

	/** How far a key badge hangs below its button. */
	UPROPERTY(EditDefaultsOnly, Category = "Buttons", meta = (ClampMin = "0.0"))
	float BadgeOverhang = 9.f;

	UPROPERTY(EditDefaultsOnly, Category = "Buttons", meta = (ClampMin = "0.0"))
	float ButtonSpacing = 4.f;

private:

	UPROPERTY()
	TObjectPtr<UButton> MenuButton;

	UPROPERTY()
	TObjectPtr<UButton> HelpButton;

	UPROPERTY()
	TObjectPtr<UButton> LoadoutsButton;
};
