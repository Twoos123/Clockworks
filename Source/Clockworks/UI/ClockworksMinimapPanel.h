// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "ClockworksMinimapPanel.generated.h"

class UCanvasPanel;
class UImage;
class UTextBlock;

/**
 * The top-right corner, after the user's screenshots of the original: a round minimap with the depth
 * on its rim, and under it two panels hanging off the screen's right edge, the current objective and
 * the activities list.
 *
 * The minimap is a radar rather than a floor plan. Floors here are one arena redressed per depth, so
 * there is no layout worth drawing yet; what the map shows is where the monsters are and which way the
 * elevator is, which is what the original's minimap is used for in a fight. It turns with the camera,
 * so up on the map is up on the screen.
 *
 * The objective is real: it reads the floor kind and whether the elevator is open. The activities
 * list is there for looks, on the user's decision, since the screens it opens do not exist in a demo.
 *
 * Local display of replicated state. It decides nothing.
 */
UCLASS()
class UClockworksMinimapPanel : public UUserWidget
{
	GENERATED_BODY()

public:

	UClockworksMinimapPanel(const FObjectInitializer& ObjectInitializer);

protected:

	virtual TSharedRef<SWidget> RebuildWidget() override;
	virtual void NativeTick(const FGeometry& MyGeometry, float InDeltaTime) override;

	void BuildTree();
	UWidget* BuildMinimap();
	UWidget* BuildObjectivePanel();
	UWidget* BuildActivitiesPanel();

	/** A navy panel with the yellow collapse tab on its left, the way both panels in the original look. */
	UWidget* MakeSidePanel(UWidget* Content, FName PanelName);

	/** One entry in the activities list. Large ones are the pale "Go to" buttons; small ones are the slim blue ones. */
	UWidget* MakeActivity(const FText& Label, bool bLarge, const TCHAR* IconName);

	void RefreshMarkers();
	void RefreshObjective();

	/** A monster marker, made on first use and reused after. */
	UImage* GetMarker(int32 Index);

	UPROPERTY(EditDefaultsOnly, Category = "Minimap", meta = (ClampMin = "64.0"))
	float MinimapSize = 190.f;

	/** How far from the knight the map reaches, in cm, from its centre to the inside of the ring. */
	UPROPERTY(EditDefaultsOnly, Category = "Minimap", meta = (ClampMin = "100.0"))
	float MinimapRange = 2500.f;

	/** The inside of the ring, as a fraction of the map's size. Markers stop here. */
	UPROPERTY(EditDefaultsOnly, Category = "Minimap", meta = (ClampMin = "0.1", ClampMax = "0.5"))
	float MinimapInnerRadius = 0.40f;

	UPROPERTY(EditDefaultsOnly, Category = "Minimap", meta = (ClampMin = "2.0"))
	float MonsterMarkerSize = 10.f;

	/** Seconds between marker and objective updates. Ten a second reads as live. */
	UPROPERTY(EditDefaultsOnly, Category = "Minimap", meta = (ClampMin = "0.0"))
	float RefreshInterval = 0.1f;

	/** Distance of the map from the top-right corner. The panels under it sit flush with the edge. */
	UPROPERTY(EditDefaultsOnly, Category = "Minimap")
	FVector2D ScreenMargin = FVector2D(8.f, 6.f);

	UPROPERTY(EditDefaultsOnly, Category = "Minimap", meta = (ClampMin = "80.0"))
	float PanelWidth = 230.f;

private:

	UPROPERTY()
	TObjectPtr<UCanvasPanel> MarkerCanvas;

	UPROPERTY()
	TArray<TObjectPtr<UImage>> Markers;

	UPROPERTY()
	TObjectPtr<UImage> ElevatorMarker;

	UPROPERTY()
	TObjectPtr<UImage> PlayerMarker;

	UPROPERTY()
	TObjectPtr<UTextBlock> DepthText;

	UPROPERTY()
	TObjectPtr<UTextBlock> ObjectiveText;

	float RefreshClock = 0.f;
	int32 ShownDepth = -2;
	FText ShownObjective;
};
