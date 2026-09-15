// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "ClockworksMenuScreen.h"
#include "ClockworksPauseMenu.generated.h"

class UClockworksGearScreen;
class UClockworksGuideScreen;

/**
 * Escape, mid-run: resume, change what you are carrying, or leave.
 *
 * Changing gear from the pause menu is deliberate. In the original you can only swap kit at an
 * Arsenal Station on a safe floor, and that restriction is worth having once there are floors to
 * put stations on; until then, being able to try a different weapon without restarting is what
 * makes the demo demonstrable.
 */
UCLASS()
class UClockworksPauseMenu : public UClockworksMenuScreen
{
	GENERATED_BODY()

public:

	UClockworksPauseMenu(const FObjectInitializer& ObjectInitializer);

	void SetGearScreen(UClockworksGearScreen* InGearScreen) { GearScreen = InGearScreen; }
	void SetGuideScreen(UClockworksGuideScreen* InGuideScreen) { GuideScreen = InGuideScreen; }

protected:

	virtual void BuildContents() override;

	UFUNCTION() void OnResumeClicked();
	UFUNCTION() void OnLoadoutClicked();
	UFUNCTION() void OnGuideClicked();
	UFUNCTION() void OnQuitClicked();

private:

	UPROPERTY()
	TWeakObjectPtr<UClockworksGearScreen> GearScreen;

	UPROPERTY()
	TWeakObjectPtr<UClockworksGuideScreen> GuideScreen;
};
