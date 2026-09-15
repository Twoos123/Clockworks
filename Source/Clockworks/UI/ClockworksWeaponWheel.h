// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "ClockworksWeaponWheel.generated.h"

class AClockworksPlayerState;
class UCanvasPanel;
class UCanvasPanelSlot;
class UClockworksWeaponDefinition;
class UImage;
class UTextBlock;

/**
 * The weapon wheel. When the knight switches weapons, three circles pop up beside it for a moment: the
 * drawn weapon large in the middle with its name, the previous and next weapons small and faded above
 * and below. Then it fades away. This is how Spiral Knights shows the weapons you carry, and on the
 * user's decision it replaces the toolbar that sat in the bottom-right corner.
 *
 * Pure display of the local PlayerState's replicated loadout. The switch is still the character's
 * input and the server's decision; this only notices that the drawn weapon changed.
 */
UCLASS()
class UClockworksWeaponWheel : public UUserWidget
{
	GENERATED_BODY()

public:

	UClockworksWeaponWheel(const FObjectInitializer& ObjectInitializer);

protected:

	virtual TSharedRef<SWidget> RebuildWidget() override;
	virtual void NativeDestruct() override;
	virtual void NativeTick(const FGeometry& MyGeometry, float InDeltaTime) override;

	void BuildTree();

	/** The PlayerState arrives some frames after the widget on a client; keep trying until it does. */
	bool TryBind();

	/** Bound to the PlayerState's OnLoadoutChanged. */
	UFUNCTION()
	void HandleLoadoutChanged();

	void ShowWheel();

	/** One circle of the wheel, centred at Centre. Returns the image its weapon icon goes in. */
	UImage* AddCircle(UCanvasPanel* Wheel, const FVector2D& Centre, float Diameter, float Opacity);

	void SetIcon(UImage* Icon, const UClockworksWeaponDefinition* Weapon, float Diameter) const;

	/** How long the wheel stays up at full strength after a switch. */
	UPROPERTY(EditDefaultsOnly, Category = "Wheel", meta = (ClampMin = "0.0"))
	float ShowSeconds = 1.2f;

	UPROPERTY(EditDefaultsOnly, Category = "Wheel", meta = (ClampMin = "0.01"))
	float FadeSeconds = 0.35f;

	/** Where the centre circle's left edge sits relative to the knight on screen. The original puts it off to the right. */
	UPROPERTY(EditDefaultsOnly, Category = "Wheel")
	FVector2D OffsetFromKnight = FVector2D(60.f, -30.f);

	UPROPERTY(EditDefaultsOnly, Category = "Wheel", meta = (ClampMin = "16.0"))
	float CentreSize = 84.f;

	UPROPERTY(EditDefaultsOnly, Category = "Wheel", meta = (ClampMin = "8.0"))
	float SideSize = 50.f;

	/** The olive-gold ring around each circle. */
	UPROPERTY(EditDefaultsOnly, Category = "Wheel")
	FLinearColor RingColor = FLinearColor(0.58f, 0.54f, 0.14f, 1.f);

	UPROPERTY(EditDefaultsOnly, Category = "Wheel")
	FLinearColor CircleFill = FLinearColor(0.03f, 0.06f, 0.03f, 0.85f);

private:

	UPROPERTY()
	TObjectPtr<UCanvasPanel> WheelRoot;

	UPROPERTY()
	TObjectPtr<UCanvasPanelSlot> WheelSlot;

	UPROPERTY()
	TObjectPtr<UImage> PrevIcon;

	UPROPERTY()
	TObjectPtr<UImage> CentreIcon;

	UPROPERTY()
	TObjectPtr<UImage> NextIcon;

	UPROPERTY()
	TObjectPtr<UTextBlock> NameText;

	TWeakObjectPtr<AClockworksPlayerState> BoundPlayerState;

	/** The slot drawn when the wheel last looked. A change from this is a switch worth showing. */
	int32 ShownIndex = INDEX_NONE;

	/** Seconds since the wheel appeared, or below zero while it is hidden. */
	float ShowAge = -1.f;
};
