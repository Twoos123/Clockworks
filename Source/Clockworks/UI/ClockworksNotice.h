// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "ClockworksNotice.generated.h"

class UBorder;
class UTextBlock;

/**
 * A line of text across the bottom of the screen that says what just happened, then goes away.
 *
 * It exists for one rule of the user's: **every button does its job, and a button whose job is not
 * built yet says so on screen rather than doing nothing.** A menu entry that silently ignores a
 * click is indistinguishable from a broken one, and this game is going to have a lot of buttons
 * ahead of the systems behind them.
 *
 * Local and cosmetic, like every other piece of interface here. Nothing about it is replicated.
 */
UCLASS()
class UClockworksNotice : public UUserWidget
{
	GENERATED_BODY()

public:

	UClockworksNotice(const FObjectInitializer& ObjectInitializer);

	/** Shows a message for a few seconds. Calling it again replaces whatever is up. */
	UFUNCTION(BlueprintCallable, Category = "Notice")
	void Show(const FText& Message, float Seconds = 3.f);

	/** The standard sentence for a thing that is not built: "The Forge is not built yet." */
	UFUNCTION(BlueprintCallable, Category = "Notice")
	void ShowNotBuiltYet(const FText& What);

protected:

	virtual TSharedRef<SWidget> RebuildWidget() override;

	void Hide();

	UPROPERTY(Transient)
	TObjectPtr<UBorder> Panel;

	UPROPERTY(Transient)
	TObjectPtr<UTextBlock> Message;

	/** How far up from the bottom edge it sits, in pixels, so it clears the weapon belt. */
	UPROPERTY(EditDefaultsOnly, Category = "Notice")
	float BottomMargin = 150.f;

	UPROPERTY(EditDefaultsOnly, Category = "Notice")
	FLinearColor PanelColor = FLinearColor(0.035f, 0.055f, 0.105f, 0.95f);

	UPROPERTY(EditDefaultsOnly, Category = "Notice")
	FLinearColor TextColor = FLinearColor(0.91f, 0.71f, 0.29f, 1.f);

	FTimerHandle HideTimer;
};
