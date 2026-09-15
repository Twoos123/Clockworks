// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "ClockworksMenuScreen.h"
#include "ClockworksGuideScreen.generated.h"

/**
 * How to play, written for someone who has never seen Spiral Knights.
 *
 * It covers the six things a knight can do, the three weapon classes and what each is actually for,
 * and the two rules that decide whether a weapon is any good in a given room: the damage type chart
 * and the statuses. Those last two are the part that is genuinely unguessable, and leaving them out
 * is why a new player concludes a weapon is bad when it is simply the wrong weapon.
 */
UCLASS()
class UClockworksGuideScreen : public UClockworksMenuScreen
{
	GENERATED_BODY()

public:

	UClockworksGuideScreen(const FObjectInitializer& ObjectInitializer);

	/** The menu to go back to when this one closes. */
	void SetReturnMenu(UClockworksMenuScreen* InReturnMenu) { ReturnMenu = InReturnMenu; }

protected:

	virtual void BuildContents() override;

	UFUNCTION() void OnBackClicked();

private:

	UPROPERTY()
	TWeakObjectPtr<UClockworksMenuScreen> ReturnMenu;
};
