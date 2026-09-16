// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "ClockworksEventHub.generated.h"

class UButton;
class UVerticalBox;

/**
 * EVENT HUB: the panel down the left of the ready room.
 *
 * The original fills it with what other people have been doing - a friend became Crown King, a friend
 * defeated Vanaduke - plus events you can sign up for, grouped into Events, Today and This Week.
 *
 * All of that comes from a service, and a service is the one thing an offline rebuild cannot have.
 * So this shows the only feed that is real here: what **this** knight has done. Until the run keeps a
 * history there is nothing in it, and it says so - which is better than inventing a friend.
 *
 * Local only.
 */
UCLASS()
class UClockworksEventHub : public UUserWidget
{
	GENERATED_BODY()

public:

	UClockworksEventHub(const FObjectInitializer& ObjectInitializer);

	/** Runs on: the local machine. Adds a line to the feed, newest first. */
	UFUNCTION(BlueprintCallable, Category = "Event Hub")
	void AddEvent(const FText& Text);

protected:

	virtual TSharedRef<SWidget> RebuildWidget() override;

	/** A small uppercase heading with a rule under it: Events, Today, This Week. */
	void AddSection(const FText& Label);

	void Refresh();

	UPROPERTY(Transient)
	TObjectPtr<UVerticalBox> Column;

	/** What has happened to this knight, newest first. Empty until the run keeps a history. */
	UPROPERTY(Transient)
	TArray<FText> Events;

	UPROPERTY(EditDefaultsOnly, Category = "Event Hub")
	FVector2D PanelSize = FVector2D(210.f, 520.f);

	UPROPERTY(EditDefaultsOnly, Category = "Event Hub")
	FLinearColor PanelColor = FLinearColor(0.035f, 0.075f, 0.145f, 0.94f);

	UPROPERTY(EditDefaultsOnly, Category = "Event Hub")
	FLinearColor HeaderColor = FLinearColor(0.75f, 0.56f, 0.12f, 1.f);

	UPROPERTY(EditDefaultsOnly, Category = "Event Hub")
	FLinearColor AccentColor = FLinearColor(0.91f, 0.71f, 0.29f, 1.f);

	UPROPERTY(EditDefaultsOnly, Category = "Event Hub")
	FLinearColor TextColor = FLinearColor(0.86f, 0.90f, 0.96f, 1.f);

	UPROPERTY(EditDefaultsOnly, Category = "Event Hub")
	FLinearColor MutedTextColor = FLinearColor(0.55f, 0.62f, 0.74f, 1.f);
};
