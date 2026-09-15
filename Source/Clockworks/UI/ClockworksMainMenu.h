// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "ClockworksMenuScreen.h"
#include "ClockworksMainMenu.generated.h"

class UClockworksGearScreen;
class UClockworksGuideScreen;

/**
 * The start screen: the first thing anyone sees, and for most people the first thing they will ever
 * read about this game.
 *
 * It carries four choices rather than the usual three. Play and Quit are obvious; Loadout is there
 * because choosing what you carry is the decision this demo is actually about; and How to Play is
 * there because a Spiral Knights knight has six verbs and a stranger will not find half of them by
 * pressing buttons.
 *
 * It opens over the level with the game paused rather than on a map of its own. That is a deliberate
 * trade: a separate menu map is nicer, but the editor automation this project is driven by cannot
 * author one, and a paused level behind a dimmed sheet reads the same to a stranger.
 */
UCLASS()
class UClockworksMainMenu : public UClockworksMenuScreen
{
	GENERATED_BODY()

public:

	UClockworksMainMenu(const FObjectInitializer& ObjectInitializer);

	/** The screens this menu's buttons open. The player controller wires these up. */
	void SetGearScreen(UClockworksGearScreen* InGearScreen) { GearScreen = InGearScreen; }
	void SetGuideScreen(UClockworksGuideScreen* InGuideScreen) { GuideScreen = InGuideScreen; }

protected:

	virtual void BuildContents() override;

	UFUNCTION() void OnPlayClicked();
	UFUNCTION() void OnLoadoutClicked();
	UFUNCTION() void OnGuideClicked();
	UFUNCTION() void OnQuitClicked();

private:

	UPROPERTY()
	TWeakObjectPtr<UClockworksGearScreen> GearScreen;

	UPROPERTY()
	TWeakObjectPtr<UClockworksGuideScreen> GuideScreen;
};
