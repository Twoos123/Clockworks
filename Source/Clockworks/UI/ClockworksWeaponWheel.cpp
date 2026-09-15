// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksWeaponWheel.h"
#include "ClockworksHUDArt.h"
#include "ClockworksPlayerState.h"
#include "ClockworksWeaponDefinition.h"
#include "Blueprint/WidgetLayoutLibrary.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Border.h"
#include "Components/CanvasPanel.h"
#include "Components/CanvasPanelSlot.h"
#include "Components/Image.h"
#include "Components/TextBlock.h"
#include "Engine/Texture2D.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"

// Runs on: the local machine only. UI is never replicated.
UClockworksWeaponWheel::UClockworksWeaponWheel(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	SetIsFocusable(false);
}

// Runs on: the local machine.
TSharedRef<SWidget> UClockworksWeaponWheel::RebuildWidget()
{
	if (WidgetTree && !WidgetTree->RootWidget)
	{
		BuildTree();
	}
	return Super::RebuildWidget();
}

// Runs on: the local machine. The previous weapon above, the drawn one in the middle with its name to
// the right, the next one below.
void UClockworksWeaponWheel::BuildTree()
{
	using namespace ClockworksHUDArt;

	UCanvasPanel* Canvas = WidgetTree->ConstructWidget<UCanvasPanel>(UCanvasPanel::StaticClass(), TEXT("WheelCanvas"));
	Canvas->SetVisibility(ESlateVisibility::HitTestInvisible);
	WidgetTree->RootWidget = Canvas;

	const float Height = CentreSize + SideSize * 2.f + 20.f;
	const float MidY = Height * 0.5f;
	const float SideX = CentreSize * 0.62f;

	WheelRoot = WidgetTree->ConstructWidget<UCanvasPanel>(UCanvasPanel::StaticClass(), TEXT("Wheel"));
	WheelSlot = Place(Canvas, WheelRoot, FVector2D::ZeroVector, FVector2D(0.f, 0.5f), FVector2D::ZeroVector, FVector2D(CentreSize + 320.f, Height));

	PrevIcon = AddCircle(WheelRoot, FVector2D(SideX, SideSize * 0.5f), SideSize, 0.55f);
	CentreIcon = AddCircle(WheelRoot, FVector2D(CentreSize * 0.5f, MidY), CentreSize, 1.f);
	NextIcon = AddCircle(WheelRoot, FVector2D(SideX, Height - SideSize * 0.5f), SideSize, 0.55f);

	NameText = MakeText(WidgetTree, FText::GetEmpty(), 20, TextWhite, EHUDTypeface::BoldItalic, 2);
	Place(WheelRoot, NameText, FVector2D::ZeroVector, FVector2D(0.f, 0.5f), FVector2D(CentreSize + 10.f, MidY));

	WheelRoot->SetVisibility(ESlateVisibility::Collapsed);
}

// Runs on: the local machine.
UImage* UClockworksWeaponWheel::AddCircle(UCanvasPanel* Wheel, const FVector2D& Centre, float Diameter, float Opacity)
{
	using namespace ClockworksHUDArt;

	UBorder* Frame = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass());
	Frame->SetBrush(RoundedBrush(CircleFill, -1.f, RingColor, FMath::Max(Diameter * 0.07f, 2.f)));
	Frame->SetPadding(FMargin(Diameter * 0.16f));
	Frame->SetHorizontalAlignment(HAlign_Fill);
	Frame->SetVerticalAlignment(VAlign_Fill);
	Frame->SetRenderOpacity(Opacity);

	UImage* Icon = MakeImage(WidgetTree, FSlateBrush());
	Frame->SetContent(Icon);

	Place(Wheel, Frame, FVector2D::ZeroVector, FVector2D(0.5f), Centre, FVector2D(Diameter));
	return Icon;
}

// Runs on: the local machine.
void UClockworksWeaponWheel::SetIcon(UImage* Icon, const UClockworksWeaponDefinition* Weapon, float Diameter) const
{
	if (!Icon)
	{
		return;
	}

	// A circle with no weapon (a one-weapon loadout has no neighbours) is not drawn at all.
	UWidget* Frame = Icon->GetParent();
	if (!Weapon)
	{
		if (Frame)
		{
			Frame->SetVisibility(ESlateVisibility::Collapsed);
		}
		return;
	}
	if (Frame)
	{
		Frame->SetVisibility(ESlateVisibility::HitTestInvisible);
	}

	if (Weapon->Icon)
	{
		FSlateBrush Brush;
		Brush.DrawAs = ESlateBrushDrawType::Image;
		Brush.SetResourceObject(Weapon->Icon);
		Brush.SetImageSize(FVector2D(Diameter * 0.68f));
		Icon->SetBrush(Brush);
		Icon->SetVisibility(ESlateVisibility::HitTestInvisible);
	}
	else
	{
		Icon->SetVisibility(ESlateVisibility::Hidden);
	}
}

// Runs on: the local machine.
bool UClockworksWeaponWheel::TryBind()
{
	AClockworksPlayerState* PlayerState = GetOwningPlayerState<AClockworksPlayerState>();
	if (!PlayerState)
	{
		return false;
	}
	BoundPlayerState = PlayerState;
	PlayerState->OnLoadoutChanged.AddUniqueDynamic(this, &UClockworksWeaponWheel::HandleLoadoutChanged);
	ShownIndex = PlayerState->GetActiveWeaponIndex();
	return true;
}

// Runs on: the local machine.
void UClockworksWeaponWheel::NativeDestruct()
{
	if (AClockworksPlayerState* PlayerState = BoundPlayerState.Get())
	{
		PlayerState->OnLoadoutChanged.RemoveDynamic(this, &UClockworksWeaponWheel::HandleLoadoutChanged);
	}
	BoundPlayerState = nullptr;

	Super::NativeDestruct();
}

// Runs on: the local machine, on every machine's copy of the loadout changing.
void UClockworksWeaponWheel::HandleLoadoutChanged()
{
	const AClockworksPlayerState* PlayerState = BoundPlayerState.Get();
	if (!PlayerState)
	{
		return;
	}

	const int32 Active = PlayerState->GetActiveWeaponIndex();
	// The weapon drawn when the knight first appears is not a switch worth announcing, and neither is a
	// new toolbar from the gear screen that leaves the same slot drawn.
	const bool bSwitched = ShownIndex != INDEX_NONE && Active != INDEX_NONE && Active != ShownIndex;
	ShownIndex = Active;
	if (bSwitched)
	{
		ShowWheel();
	}
}

// Runs on: the local machine.
void UClockworksWeaponWheel::ShowWheel()
{
	const AClockworksPlayerState* PlayerState = BoundPlayerState.Get();
	if (!PlayerState || !WheelRoot)
	{
		return;
	}

	const TArray<TObjectPtr<UClockworksWeaponDefinition>>& Weapons = PlayerState->GetWeaponSlots();
	const int32 Count = Weapons.Num();
	const int32 Active = PlayerState->GetActiveWeaponIndex();
	if (!Weapons.IsValidIndex(Active))
	{
		return;
	}

	const UClockworksWeaponDefinition* Drawn = Weapons[Active];
	const bool bHasNeighbours = Count > 1;
	SetIcon(CentreIcon, Drawn, CentreSize);
	SetIcon(PrevIcon, bHasNeighbours ? Weapons[(Active - 1 + Count) % Count].Get() : nullptr, SideSize);
	SetIcon(NextIcon, bHasNeighbours ? Weapons[(Active + 1) % Count].Get() : nullptr, SideSize);
	if (NameText)
	{
		NameText->SetText(Drawn ? Drawn->DisplayName : FText::GetEmpty());
	}

	ShowAge = 0.f;
	WheelRoot->SetRenderOpacity(1.f);
	WheelRoot->SetVisibility(ESlateVisibility::HitTestInvisible);
}

// Runs on: the local machine. Follows the knight across the screen while it is up, then fades.
void UClockworksWeaponWheel::NativeTick(const FGeometry& MyGeometry, float InDeltaTime)
{
	Super::NativeTick(MyGeometry, InDeltaTime);

	if (!BoundPlayerState.IsValid())
	{
		TryBind();
	}

	if (ShowAge < 0.f || !WheelRoot)
	{
		return;
	}

	ShowAge += InDeltaTime;
	if (ShowAge >= ShowSeconds + FadeSeconds)
	{
		ShowAge = -1.f;
		WheelRoot->SetVisibility(ESlateVisibility::Collapsed);
		return;
	}
	WheelRoot->SetRenderOpacity(ShowAge <= ShowSeconds ? 1.f : 1.f - (ShowAge - ShowSeconds) / FadeSeconds);

	const APlayerController* OwningController = GetOwningPlayer();
	const APawn* Knight = GetOwningPlayerPawn();
	FVector2D ScreenPosition;
	if (OwningController && Knight && WheelSlot
		&& UWidgetLayoutLibrary::ProjectWorldLocationToWidgetPosition(OwningController, Knight->GetActorLocation(), ScreenPosition, /*bPlayerViewportRelative*/ true))
	{
		WheelSlot->SetPosition(ScreenPosition + OffsetFromKnight);
	}
}
