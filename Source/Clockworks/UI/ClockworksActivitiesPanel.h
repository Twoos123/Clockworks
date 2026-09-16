// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "ClockworksActivitiesPanel.generated.h"

class UButton;
class UVerticalBox;

/**
 * The ACTIVITIES panel down the right of the ready room: Go to Haven, Missions, Guild Halls,
 * Coliseum, Party Finder, Supply Depot.
 *
 * It is the game's table of contents - nearly everything a knight does is reached from here - so it
 * is worth building before the things it points at. Each entry that is not built says so, which is
 * the standing rule, and that makes the panel an honest map of how much of the game exists.
 *
 * Local only.
 */
UCLASS()
class UClockworksActivitiesPanel : public UUserWidget
{
	GENERATED_BODY()

public:

	UClockworksActivitiesPanel(const FObjectInitializer& ObjectInitializer);

protected:

	virtual TSharedRef<SWidget> RebuildWidget() override;

	/** One entry. `bBuilt` decides whether pressing it does the thing or says it is not built. */
	UButton* AddActivity(UVerticalBox* Column, FName Name, const FText& Label, bool bBuilt);

	UFUNCTION()
	void OnActivityClicked();

	UPROPERTY(Transient)
	TObjectPtr<UVerticalBox> Column;

	/** What each button is called, for the message it shows, and whether it leads anywhere yet. */
	UPROPERTY(Transient)
	TMap<TObjectPtr<UButton>, FText> ActivityNames;

	UPROPERTY(Transient)
	TSet<TObjectPtr<UButton>> BuiltActivities;

	UPROPERTY(EditDefaultsOnly, Category = "Activities")
	FLinearColor PanelColor = FLinearColor(0.035f, 0.075f, 0.145f, 0.94f);

	UPROPERTY(EditDefaultsOnly, Category = "Activities")
	FLinearColor ButtonColor = FLinearColor(0.10f, 0.22f, 0.42f, 1.f);

	UPROPERTY(EditDefaultsOnly, Category = "Activities")
	FLinearColor AccentColor = FLinearColor(0.91f, 0.71f, 0.29f, 1.f);
};
