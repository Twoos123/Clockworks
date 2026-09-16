// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "ClockworksUplinkPanel.generated.h"

class UBorder;
class UButton;
class UTextBlock;
class UVerticalBox;

/** Which of the Uplink's three tabs is showing. */
UENUM(BlueprintType)
enum class EClockworksUplinkTab : uint8
{
	News,
	Mail,
	Invites
};

/**
 * SPIRAL UPLINK: the window in the middle of the ready room, with NEWS, MAIL and INVITES.
 *
 * In the original this is a live feed from the service - announcements, a mailbox, party invitations.
 * There is no service here, so what it shows is what an offline build honestly has: news about the
 * rebuild itself, an empty mailbox, and no invitations. The original prints "You have no messages."
 * in exactly that case, so the empty state is the faithful one.
 *
 * Local only.
 */
UCLASS()
class UClockworksUplinkPanel : public UUserWidget
{
	GENERATED_BODY()

public:

	UClockworksUplinkPanel(const FObjectInitializer& ObjectInitializer);

	/** Runs on: the local machine. Shows one of the three tabs. */
	UFUNCTION(BlueprintCallable, Category = "Uplink")
	void ShowTab(EClockworksUplinkTab Tab);

protected:

	virtual TSharedRef<SWidget> RebuildWidget() override;

	/** One tab button along the top. */
	UButton* AddTab(class UHorizontalBox* Row, FName Name, const FText& Label, EClockworksUplinkTab Tab);

	/** Fills the body for whichever tab is showing. */
	void BuildBody();

	/** A headline and a paragraph under it, which is the shape of every news card. */
	void AddStory(const FText& Headline, const FText& Body);

	UFUNCTION()
	void OnTabClicked();

	UFUNCTION()
	void OnCloseClicked();

	UPROPERTY(Transient)
	TObjectPtr<UVerticalBox> Body;

	UPROPERTY(Transient)
	TMap<TObjectPtr<UButton>, EClockworksUplinkTab> Tabs;

	UPROPERTY(Transient)
	EClockworksUplinkTab Current = EClockworksUplinkTab::News;

	UPROPERTY(EditDefaultsOnly, Category = "Uplink")
	FVector2D PanelSize = FVector2D(590.f, 580.f);

	UPROPERTY(EditDefaultsOnly, Category = "Uplink")
	FLinearColor PanelColor = FLinearColor(0.035f, 0.075f, 0.145f, 0.96f);

	UPROPERTY(EditDefaultsOnly, Category = "Uplink")
	FLinearColor HeaderColor = FLinearColor(0.75f, 0.56f, 0.12f, 1.f);

	UPROPERTY(EditDefaultsOnly, Category = "Uplink")
	FLinearColor AccentColor = FLinearColor(0.91f, 0.71f, 0.29f, 1.f);

	UPROPERTY(EditDefaultsOnly, Category = "Uplink")
	FLinearColor TextColor = FLinearColor(0.86f, 0.90f, 0.96f, 1.f);

	UPROPERTY(EditDefaultsOnly, Category = "Uplink")
	FLinearColor MutedTextColor = FLinearColor(0.55f, 0.62f, 0.74f, 1.f);
};
