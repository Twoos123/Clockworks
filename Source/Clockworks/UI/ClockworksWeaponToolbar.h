// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "ClockworksWeaponToolbar.generated.h"

class AClockworksPlayerState;
class UHorizontalBox;

/**
 * The weapon toolbar in the bottom-right corner, Spiral Knights style: one framed icon per weapon
 * carried, the drawn one lit. Pure display of the local PlayerState's replicated loadout; it never
 * decides anything (the switch input lives on the character, the choice on the server).
 *
 * The widget builds its own tree in C++ so no designer graph is needed; a WBP_ child can retune
 * the colours and sizes below. Created by AClockworksPlayerController for the local player only.
 */
UCLASS()
class UClockworksWeaponToolbar : public UUserWidget
{
	GENERATED_BODY()

public:

	UClockworksWeaponToolbar(const FObjectInitializer& ObjectInitializer);

protected:

	virtual TSharedRef<SWidget> RebuildWidget() override;
	virtual void NativeDestruct() override;
	virtual void NativeTick(const FGeometry& MyGeometry, float InDeltaTime) override;

	/** Rebuilds the slots from the PlayerState. Bound to its OnLoadoutChanged. */
	UFUNCTION()
	void Refresh();

	/** Canvas root with the slot row anchored bottom-right. */
	void BuildTree();

	/** The PlayerState arrives some frames after the widget on a client; keep trying until it does. */
	bool TryBind();

	/** Side of one slot in pixels. */
	UPROPERTY(EditDefaultsOnly, Category = "Toolbar", meta = (ClampMin = "16.0"))
	float SlotSize = 72.f;

	UPROPERTY(EditDefaultsOnly, Category = "Toolbar", meta = (ClampMin = "0.0"))
	float SlotSpacing = 8.f;

	/** Distance from the bottom-right corner of the screen. */
	UPROPERTY(EditDefaultsOnly, Category = "Toolbar")
	FVector2D ScreenMargin = FVector2D(24.f, 24.f);

	/** Frame of the drawn weapon. Brass, the Clockworks colour. */
	UPROPERTY(EditDefaultsOnly, Category = "Toolbar|Colours")
	FLinearColor ActiveFrame = FLinearColor(0.85f, 0.62f, 0.22f, 1.f);

	UPROPERTY(EditDefaultsOnly, Category = "Toolbar|Colours")
	FLinearColor InactiveFrame = FLinearColor(0.09f, 0.11f, 0.13f, 0.8f);

	/** Behind the icon. */
	UPROPERTY(EditDefaultsOnly, Category = "Toolbar|Colours")
	FLinearColor SlotBackground = FLinearColor(0.03f, 0.04f, 0.05f, 0.9f);

	UPROPERTY(EditDefaultsOnly, Category = "Toolbar|Colours")
	FLinearColor ActiveIconTint = FLinearColor::White;

	UPROPERTY(EditDefaultsOnly, Category = "Toolbar|Colours")
	FLinearColor InactiveIconTint = FLinearColor(0.55f, 0.55f, 0.55f, 1.f);

	/** The slot number in the corner, and the weapon's name when it has no icon. */
	UPROPERTY(EditDefaultsOnly, Category = "Toolbar", meta = (ClampMin = "6"))
	int32 LabelFontSize = 11;

private:

	UPROPERTY()
	TObjectPtr<UHorizontalBox> SlotBox;

	TWeakObjectPtr<AClockworksPlayerState> BoundPlayerState;
};
