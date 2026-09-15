// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksMinimapPanel.h"
#include "ClockworksElevator.h"
#include "ClockworksEnemyCharacter.h"
#include "ClockworksGameplayTags.h"
#include "ClockworksGameState.h"
#include "ClockworksHUDArt.h"
#include "AbilitySystemComponent.h"
#include "Blueprint/WidgetTree.h"
#include "Camera/PlayerCameraManager.h"
#include "Components/Border.h"
#include "Components/CanvasPanel.h"
#include "Components/CanvasPanelSlot.h"
#include "Components/HorizontalBox.h"
#include "Components/HorizontalBoxSlot.h"
#include "Components/Image.h"
#include "Components/Overlay.h"
#include "Components/OverlaySlot.h"
#include "Components/SizeBox.h"
#include "Components/TextBlock.h"
#include "Components/VerticalBox.h"
#include "Components/VerticalBoxSlot.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"

#define LOCTEXT_NAMESPACE "ClockworksHUD"

// Runs on: the local machine only. UI is never replicated.
UClockworksMinimapPanel::UClockworksMinimapPanel(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	SetIsFocusable(false);
}

// Runs on: the local machine.
TSharedRef<SWidget> UClockworksMinimapPanel::RebuildWidget()
{
	if (WidgetTree && !WidgetTree->RootWidget)
	{
		BuildTree();
	}
	return Super::RebuildWidget();
}

// Runs on: the local machine.
void UClockworksMinimapPanel::BuildTree()
{
	using namespace ClockworksHUDArt;

	UCanvasPanel* Canvas = WidgetTree->ConstructWidget<UCanvasPanel>(UCanvasPanel::StaticClass(), TEXT("MinimapCanvas"));
	// Display only: a click here must still reach the game as an attack.
	Canvas->SetVisibility(ESlateVisibility::HitTestInvisible);
	WidgetTree->RootWidget = Canvas;

	Place(Canvas, BuildMinimap(), FVector2D(1.f, 0.f), FVector2D(1.f, 0.f), FVector2D(-ScreenMargin.X, ScreenMargin.Y), FVector2D(MinimapSize));

	UVerticalBox* Panels = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("SidePanels"));
	if (UVerticalBoxSlot* ObjectiveSlot = Panels->AddChildToVerticalBox(BuildObjectivePanel()))
	{
		ObjectiveSlot->SetPadding(FMargin(0.f, 0.f, 0.f, 8.f));
		ObjectiveSlot->SetHorizontalAlignment(HAlign_Right);
	}
	if (UVerticalBoxSlot* ActivitiesSlot = Panels->AddChildToVerticalBox(BuildActivitiesPanel()))
	{
		ActivitiesSlot->SetHorizontalAlignment(HAlign_Right);
	}
	Place(Canvas, Panels, FVector2D(1.f, 0.f), FVector2D(1.f, 0.f), FVector2D(0.f, ScreenMargin.Y + MinimapSize + 10.f));

	RefreshObjective();
}

// Runs on: the local machine. Backing, markers, hashmarks, gloss, ring, then the rim furniture on top.
UWidget* UClockworksMinimapPanel::BuildMinimap()
{
	using namespace ClockworksHUDArt;

	const FVector2D Extent(MinimapSize, MinimapSize);
	UOverlay* Map = WidgetTree->ConstructWidget<UOverlay>(UOverlay::StaticClass(), TEXT("Minimap"));
	auto AddLayer = [Map](UWidget* Layer)
	{
		if (UOverlaySlot* LayerSlot = Map->AddChildToOverlay(Layer))
		{
			LayerSlot->SetHorizontalAlignment(HAlign_Fill);
			LayerSlot->SetVerticalAlignment(VAlign_Fill);
		}
	};

	AddLayer(MakeImage(WidgetTree, TextureBrush(TEXT("MinimapBacking"), Extent, FLinearColor(0.05f, 0.22f, 0.32f, 0.95f), -1.f)));

	MarkerCanvas = WidgetTree->ConstructWidget<UCanvasPanel>(UCanvasPanel::StaticClass(), TEXT("MinimapMarkers"));
	AddLayer(MarkerCanvas);

	AddLayer(MakeImage(WidgetTree, TextureBrush(TEXT("MinimapHashmarks"), Extent)));
	AddLayer(MakeImage(WidgetTree, TextureBrush(TEXT("MinimapGloss"), Extent)));
	AddLayer(MakeImage(WidgetTree, Texture(TEXT("MinimapRing"))
		? TextureBrush(TEXT("MinimapRing"), Extent)
		: RoundedBrush(FLinearColor::Transparent, -1.f, SteelBlue, 6.f)));

	UCanvasPanel* Rim = WidgetTree->ConstructWidget<UCanvasPanel>(UCanvasPanel::StaticClass(), TEXT("MinimapRim"));
	AddLayer(Rim);

	// The knight, always at the centre, turned the way it faces.
	PlayerMarker = MakeImage(WidgetTree, TextureBrush(TEXT("MinimapPlayer"), FVector2D(16.f), Gold, -1.f));
	Place(Rim, PlayerMarker, FVector2D::ZeroVector, FVector2D(0.5f), Extent * 0.5f, FVector2D(16.f));

	// Zoom and lock sockets on the rim at seven and five o'clock. Pictures only in this demo.
	Place(Rim, MakeImage(WidgetTree, TextureBrush(TEXT("MinimapZoom"), FVector2D(30.f), NavyDark, -1.f)),
		FVector2D::ZeroVector, FVector2D(0.5f), FVector2D(Extent.X * 0.17f, Extent.Y * 0.86f), FVector2D(30.f));
	Place(Rim, MakeImage(WidgetTree, TextureBrush(TEXT("MinimapLock"), FVector2D(30.f), NavyDark, -1.f)),
		FVector2D::ZeroVector, FVector2D(0.5f), FVector2D(Extent.X * 0.83f, Extent.Y * 0.86f), FVector2D(30.f));

	DepthText = MakeText(WidgetTree, FText::GetEmpty(), 14, Gold, EHUDTypeface::BoldItalic, 2);
	Place(Rim, DepthText, FVector2D::ZeroVector, FVector2D::ZeroVector, FVector2D(Extent.X * 0.10f, -4.f));

	ElevatorMarker = MakeImage(WidgetTree, TextureBrush(TEXT("MinimapElevator"), FVector2D(18.f), FLinearColor(0.30f, 0.90f, 0.40f, 1.f), 3.f));
	ElevatorMarker->SetVisibility(ESlateVisibility::Collapsed);
	Place(MarkerCanvas, ElevatorMarker, FVector2D::ZeroVector, FVector2D(0.5f), Extent * 0.5f, FVector2D(18.f));

	return Map;
}

// Runs on: the local machine.
UWidget* UClockworksMinimapPanel::BuildObjectivePanel()
{
	using namespace ClockworksHUDArt;

	UVerticalBox* Column = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("ObjectiveColumn"));
	Column->AddChildToVerticalBox(MakeText(WidgetTree, LOCTEXT("ObjectiveHeader", "CURRENT OBJECTIVE:"), 13, Gold, EHUDTypeface::BoldItalic, 1));

	ObjectiveText = MakeText(WidgetTree, FText::GetEmpty(), 12, TextWhite, EHUDTypeface::Regular, 0);
	ObjectiveText->SetAutoWrapText(true);
	if (UVerticalBoxSlot* TextSlot = Column->AddChildToVerticalBox(ObjectiveText))
	{
		TextSlot->SetPadding(FMargin(0.f, 3.f, 0.f, 0.f));
	}

	return MakeSidePanel(Column, TEXT("ObjectivePanel"));
}

// Runs on: the local machine. The Clockworks version of the list: the way home, the ready room, the
// missions board and the supply depot. For looks only.
UWidget* UClockworksMinimapPanel::BuildActivitiesPanel()
{
	using namespace ClockworksHUDArt;

	UVerticalBox* Column = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("ActivitiesColumn"));
	auto AddRow = [Column](UWidget* Row, float Top)
	{
		if (UVerticalBoxSlot* RowSlot = Column->AddChildToVerticalBox(Row))
		{
			RowSlot->SetPadding(FMargin(0.f, Top, 0.f, 0.f));
		}
	};

	AddRow(MakeText(WidgetTree, LOCTEXT("ActivitiesHeader", "ACTIVITIES"), 13, Gold, EHUDTypeface::BoldItalic, 1), 0.f);
	AddRow(MakeActivity(LOCTEXT("GoHaven", "Go to Haven"), true, TEXT("SysGoto")), 6.f);
	AddRow(MakeActivity(LOCTEXT("GoReadyRoom", "Go to Ready Room"), true, TEXT("SysGoto")), 5.f);
	AddRow(MakeDivider(WidgetTree, false), 2.f);
	AddRow(MakeActivity(LOCTEXT("Missions", "Missions"), false, nullptr), 2.f);
	AddRow(MakeDivider(WidgetTree, false), 2.f);
	AddRow(MakeActivity(LOCTEXT("SupplyDepot", "Supply Depot"), false, TEXT("SysSupplyDepot")), 2.f);

	return MakeSidePanel(Column, TEXT("ActivitiesPanel"));
}

// Runs on: the local machine.
UWidget* UClockworksMinimapPanel::MakeSidePanel(UWidget* Content, FName PanelName)
{
	using namespace ClockworksHUDArt;

	UHorizontalBox* Row = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass(), PanelName);

	if (UHorizontalBoxSlot* TabSlot = Row->AddChildToHorizontalBox(MakeSized(WidgetTree,
		MakeImage(WidgetTree, TextureBrush(TEXT("CollapseTabLeft"), FVector2D(16.f, 36.f), NavyDark, 4.f)), FVector2D(16.f, 36.f))))
	{
		TabSlot->SetVerticalAlignment(VAlign_Top);
		TabSlot->SetPadding(FMargin(0.f, 6.f, 0.f, 0.f));
	}

	UBorder* Panel = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass());
	FSlateBrush PanelBrush = RoundedBrush(Navy, 0.f);
	PanelBrush.OutlineSettings.CornerRadii = FVector4(8.f, 0.f, 0.f, 8.f);
	Panel->SetBrush(PanelBrush);
	Panel->SetPadding(FMargin(10.f, 6.f, 10.f, 8.f));
	Panel->SetContent(Content);

	USizeBox* PanelBox = WidgetTree->ConstructWidget<USizeBox>(USizeBox::StaticClass());
	PanelBox->SetWidthOverride(PanelWidth);
	PanelBox->SetContent(Panel);
	Row->AddChildToHorizontalBox(PanelBox);

	return Row;
}

// Runs on: the local machine.
UWidget* UClockworksMinimapPanel::MakeActivity(const FText& Label, bool bLarge, const TCHAR* IconName)
{
	using namespace ClockworksHUDArt;

	UBorder* Body = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass());
	Body->SetBrush(bLarge
		? RoundedBrush(PaleButton, 5.f, FLinearColor(0.20f, 0.40f, 0.75f, 1.f), 1.5f)
		: RoundedBrush(ButtonBlue, 4.f, ButtonOutline, 1.f));
	Body->SetPadding(bLarge ? FMargin(6.f, 5.f) : FMargin(8.f, 3.f));

	UHorizontalBox* Row = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass());
	if (IconName)
	{
		if (UHorizontalBoxSlot* IconSlot = Row->AddChildToHorizontalBox(MakeSized(WidgetTree,
			MakeImage(WidgetTree, TextureBrush(IconName, FVector2D(22.f), SteelBlue, 4.f)), FVector2D(22.f))))
		{
			IconSlot->SetVerticalAlignment(VAlign_Center);
			IconSlot->SetPadding(FMargin(0.f, 0.f, 6.f, 0.f));
		}
	}
	UTextBlock* Text = MakeText(WidgetTree, Label, bLarge ? 13 : 12, bLarge ? NavyDark : TextWhite, EHUDTypeface::Bold, 0);
	if (UHorizontalBoxSlot* TextSlot = Row->AddChildToHorizontalBox(Text))
	{
		TextSlot->SetVerticalAlignment(VAlign_Center);
	}
	Body->SetContent(Row);
	return Body;
}

// Runs on: the local machine.
void UClockworksMinimapPanel::NativeTick(const FGeometry& MyGeometry, float InDeltaTime)
{
	Super::NativeTick(MyGeometry, InDeltaTime);

	RefreshClock += InDeltaTime;
	if (RefreshClock >= RefreshInterval)
	{
		RefreshClock = 0.f;
		RefreshMarkers();
		RefreshObjective();
	}
}

// Runs on: the local machine. Monsters and the elevator are replicated actors every machine already
// has, so the map needs nothing sent for it.
void UClockworksMinimapPanel::RefreshMarkers()
{
	APlayerController* OwningController = GetOwningPlayer();
	const APawn* Knight = GetOwningPlayerPawn();
	UWorld* World = GetWorld();
	if (!OwningController || !Knight || !World || !MarkerCanvas)
	{
		for (UImage* Marker : Markers)
		{
			Marker->SetVisibility(ESlateVisibility::Collapsed);
		}
		return;
	}

	const float CameraYaw = OwningController->PlayerCameraManager
		? OwningController->PlayerCameraManager->GetCameraRotation().Yaw
		: OwningController->GetControlRotation().Yaw;
	const FVector Centre = Knight->GetActorLocation();
	const float Half = MinimapSize * 0.5f;
	const float Radius = MinimapSize * MinimapInnerRadius;
	const float Scale = Radius / MinimapRange;
	const FRotator IntoCameraSpace(0.f, -CameraYaw, 0.f);

	// The camera's forward is up on the map, its right is right.
	auto ToMap = [&](const FVector& WorldLocation, bool bClampToRim, bool& bOutInRange)
	{
		const FVector Local = IntoCameraSpace.RotateVector(WorldLocation - Centre);
		FVector2D Offset(Local.Y * Scale, -Local.X * Scale);
		const float Length = Offset.Size();
		bOutInRange = Length <= Radius;
		if (!bOutInRange && bClampToRim && Length > UE_KINDA_SMALL_NUMBER)
		{
			Offset *= Radius / Length;
		}
		return FVector2D(Half, Half) + Offset;
	};

	int32 Used = 0;
	for (TActorIterator<AClockworksEnemyCharacter> It(World); It; ++It)
	{
		const AClockworksEnemyCharacter* Enemy = *It;
		const UAbilitySystemComponent* AbilitySystemComponent = Enemy ? Enemy->GetAbilitySystemComponent() : nullptr;
		if (!Enemy || Enemy->IsHidden() || (AbilitySystemComponent && AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Dead)))
		{
			continue;
		}

		bool bInRange = false;
		const FVector2D Position = ToMap(Enemy->GetActorLocation(), false, bInRange);
		if (!bInRange)
		{
			continue;
		}

		UImage* Marker = GetMarker(Used++);
		if (UCanvasPanelSlot* MarkerSlot = Cast<UCanvasPanelSlot>(Marker->Slot))
		{
			MarkerSlot->SetPosition(Position);
		}
		Marker->SetVisibility(ESlateVisibility::HitTestInvisible);
	}
	for (int32 Index = Used; Index < Markers.Num(); ++Index)
	{
		Markers[Index]->SetVisibility(ESlateVisibility::Collapsed);
	}

	// The way down is always on the map: out of range, it waits on the rim pointing the way.
	if (ElevatorMarker)
	{
		TActorIterator<AClockworksElevator> ElevatorIt(World);
		if (ElevatorIt)
		{
			bool bInRange = false;
			const FVector2D Position = ToMap(ElevatorIt->GetActorLocation(), true, bInRange);
			if (UCanvasPanelSlot* ElevatorSlot = Cast<UCanvasPanelSlot>(ElevatorMarker->Slot))
			{
				ElevatorSlot->SetPosition(Position);
			}
			ElevatorMarker->SetColorAndOpacity(ElevatorIt->IsOpen() ? FLinearColor::White : FLinearColor(1.f, 1.f, 1.f, 0.45f));
			ElevatorMarker->SetVisibility(ESlateVisibility::HitTestInvisible);
		}
		else
		{
			ElevatorMarker->SetVisibility(ESlateVisibility::Collapsed);
		}
	}

	if (PlayerMarker)
	{
		PlayerMarker->SetRenderTransformAngle(Knight->GetActorRotation().Yaw - CameraYaw);
	}
}

// Runs on: the local machine. What to do on this floor, in the original's plain wording.
void UClockworksMinimapPanel::RefreshObjective()
{
	UWorld* World = GetWorld();
	const AClockworksGameState* GameState = World ? World->GetGameState<AClockworksGameState>() : nullptr;

	bool bElevatorOpen = false;
	if (World)
	{
		if (TActorIterator<AClockworksElevator> ElevatorIt(World); ElevatorIt)
		{
			bElevatorOpen = ElevatorIt->IsOpen();
		}
	}

	FText Objective = LOCTEXT("ObjectiveTest", "Defeat the monsters.");
	if (GameState)
	{
		switch (GameState->GetFloorKind())
		{
		case EClockworksFloorKind::Lobby:
			Objective = LOCTEXT("ObjectiveLobby", "Step onto the elevator to begin the descent.");
			break;
		case EClockworksFloorKind::Tunnels:
			Objective = bElevatorOpen
				? LOCTEXT("ObjectiveTunnelsOpen", "Reach the elevator.")
				: LOCTEXT("ObjectiveTunnels", "Clear the floor to open the elevator.");
			break;
		case EClockworksFloorKind::Terminal:
			Objective = LOCTEXT("ObjectiveTerminal", "Catch your breath, change your gear, then take the elevator down.");
			break;
		case EClockworksFloorKind::Boss:
			Objective = bElevatorOpen
				? LOCTEXT("ObjectiveBossOpen", "Reach the elevator.")
				: LOCTEXT("ObjectiveBoss", "Defeat the guardian of this depth.");
			break;
		case EClockworksFloorKind::Core:
			Objective = LOCTEXT("ObjectiveCore", "You have reached the Core.");
			break;
		}
	}

	if (ObjectiveText && !Objective.EqualTo(ShownObjective))
	{
		ShownObjective = Objective;
		ObjectiveText->SetText(Objective);
	}

	const int32 Depth = GameState ? GameState->GetDepth() : INDEX_NONE;
	if (DepthText && Depth != ShownDepth)
	{
		ShownDepth = Depth;
		if (GameState)
		{
			DepthText->SetText(FText::Format(LOCTEXT("MinimapDepth", "DEPTH {0}"), FText::AsNumber(Depth)));
			DepthText->SetVisibility(ESlateVisibility::HitTestInvisible);
		}
		else
		{
			DepthText->SetVisibility(ESlateVisibility::Collapsed);
		}
	}
}

// Runs on: the local machine.
UImage* UClockworksMinimapPanel::GetMarker(int32 Index)
{
	while (Markers.Num() <= Index)
	{
		UImage* Marker = ClockworksHUDArt::MakeImage(WidgetTree, ClockworksHUDArt::TextureBrush(TEXT("MinimapMonster"),
			FVector2D(MonsterMarkerSize), FLinearColor(0.95f, 0.35f, 0.55f, 1.f), -1.f));
		ClockworksHUDArt::Place(MarkerCanvas, Marker, FVector2D::ZeroVector, FVector2D(0.5f), FVector2D::ZeroVector, FVector2D(MonsterMarkerSize));
		Markers.Add(Marker);
	}
	return Markers[Index];
}

#undef LOCTEXT_NAMESPACE
