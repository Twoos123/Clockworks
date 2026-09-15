// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksWeaponToolbar.h"
#include "ClockworksPlayerState.h"
#include "ClockworksWeaponDefinition.h"
#include "Blueprint/WidgetTree.h"
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
#include "Engine/Texture2D.h"

// Runs on: the local machine only. UI is never replicated.
UClockworksWeaponToolbar::UClockworksWeaponToolbar(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	SetIsFocusable(false);
}

// Runs on: the local machine. Called by the engine when the widget needs its Slate tree; a WBP_
// child that designed its own tree keeps it, otherwise the C++ layout is built here.
TSharedRef<SWidget> UClockworksWeaponToolbar::RebuildWidget()
{
	if (WidgetTree && !WidgetTree->RootWidget)
	{
		BuildTree();
	}
	return Super::RebuildWidget();
}

// Runs on: the local machine.
void UClockworksWeaponToolbar::BuildTree()
{
	UCanvasPanel* Canvas = WidgetTree->ConstructWidget<UCanvasPanel>(UCanvasPanel::StaticClass(), TEXT("ToolbarCanvas"));
	// The toolbar is display only: a click on it must still reach the game as an attack.
	Canvas->SetVisibility(ESlateVisibility::HitTestInvisible);
	WidgetTree->RootWidget = Canvas;

	SlotBox = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass(), TEXT("SlotBox"));
	if (UCanvasPanelSlot* CanvasSlot = Canvas->AddChildToCanvas(SlotBox))
	{
		// Bottom-right corner, sized by its contents, pushed in by the margin.
		CanvasSlot->SetAnchors(FAnchors(1.f, 1.f, 1.f, 1.f));
		CanvasSlot->SetAlignment(FVector2D(1.f, 1.f));
		CanvasSlot->SetAutoSize(true);
		CanvasSlot->SetPosition(FVector2D(-ScreenMargin.X, -ScreenMargin.Y));
	}
}

// Runs on: the local machine. The PlayerState may not exist yet on a client; TryBind keeps looking.
void UClockworksWeaponToolbar::NativeTick(const FGeometry& MyGeometry, float InDeltaTime)
{
	Super::NativeTick(MyGeometry, InDeltaTime);

	if (!BoundPlayerState.IsValid())
	{
		TryBind();
	}
}

// Runs on: the local machine.
bool UClockworksWeaponToolbar::TryBind()
{
	AClockworksPlayerState* PlayerState = GetOwningPlayerState<AClockworksPlayerState>();
	if (!PlayerState)
	{
		return false;
	}
	BoundPlayerState = PlayerState;
	PlayerState->OnLoadoutChanged.AddUniqueDynamic(this, &UClockworksWeaponToolbar::Refresh);
	Refresh();
	return true;
}

// Runs on: the local machine.
void UClockworksWeaponToolbar::NativeDestruct()
{
	if (AClockworksPlayerState* PlayerState = BoundPlayerState.Get())
	{
		PlayerState->OnLoadoutChanged.RemoveDynamic(this, &UClockworksWeaponToolbar::Refresh);
	}
	BoundPlayerState = nullptr;

	Super::NativeDestruct();
}

// Runs on: the local machine. Throws the slots away and builds them again; a toolbar has two or
// three entries, so there is nothing worth keeping.
void UClockworksWeaponToolbar::Refresh()
{
	AClockworksPlayerState* PlayerState = BoundPlayerState.Get();
	if (!PlayerState || !SlotBox || !WidgetTree)
	{
		return;
	}

	SlotBox->ClearChildren();

	const TArray<TObjectPtr<UClockworksWeaponDefinition>>& Slots = PlayerState->GetWeaponSlots();
	const int32 ActiveIndex = PlayerState->GetActiveWeaponIndex();

	for (int32 Index = 0; Index < Slots.Num(); ++Index)
	{
		const UClockworksWeaponDefinition* Weapon = Slots[Index];
		const bool bActive = Index == ActiveIndex;

		// Frame (the lit border) > fixed-size box > background > overlay of icon and label.
		UBorder* Frame = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass());
		Frame->SetBrushColor(bActive ? ActiveFrame : InactiveFrame);
		Frame->SetPadding(FMargin(3.f));

		USizeBox* Box = WidgetTree->ConstructWidget<USizeBox>(USizeBox::StaticClass());
		Box->SetWidthOverride(SlotSize);
		Box->SetHeightOverride(SlotSize);

		UBorder* Background = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass());
		Background->SetBrushColor(SlotBackground);
		Background->SetPadding(FMargin(4.f));

		UOverlay* Overlay = WidgetTree->ConstructWidget<UOverlay>(UOverlay::StaticClass());

		if (Weapon && Weapon->Icon)
		{
			UImage* Icon = WidgetTree->ConstructWidget<UImage>(UImage::StaticClass());
			Icon->SetBrushFromTexture(Weapon->Icon, /*bMatchSize*/ false);
			Icon->SetColorAndOpacity(bActive ? ActiveIconTint : InactiveIconTint);
			if (UOverlaySlot* IconSlot = Overlay->AddChildToOverlay(Icon))
			{
				IconSlot->SetHorizontalAlignment(HAlign_Fill);
				IconSlot->SetVerticalAlignment(VAlign_Fill);
			}
		}
		else
		{
			// No icon yet: the name, centred, so the slot still reads.
			UTextBlock* Name = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass());
			Name->SetText(Weapon ? Weapon->DisplayName : FText::GetEmpty());
			Name->SetJustification(ETextJustify::Center);
			Name->SetAutoWrapText(true);
			FSlateFontInfo NameFont = Name->GetFont();
			NameFont.Size = LabelFontSize;
			Name->SetFont(NameFont);
			Name->SetColorAndOpacity(FSlateColor(bActive ? ActiveIconTint : InactiveIconTint));
			if (UOverlaySlot* NameSlot = Overlay->AddChildToOverlay(Name))
			{
				NameSlot->SetHorizontalAlignment(HAlign_Center);
				NameSlot->SetVerticalAlignment(VAlign_Center);
			}
		}

		// The slot number in the top-left corner: the key that draws it is the same number for now.
		UTextBlock* Number = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass());
		Number->SetText(FText::AsNumber(Index + 1));
		FSlateFontInfo NumberFont = Number->GetFont();
		NumberFont.Size = LabelFontSize;
		Number->SetFont(NumberFont);
		Number->SetColorAndOpacity(FSlateColor(bActive ? ActiveFrame : InactiveIconTint));
		Number->SetShadowOffset(FVector2D(1.f, 1.f));
		Number->SetShadowColorAndOpacity(FLinearColor(0.f, 0.f, 0.f, 0.8f));
		if (UOverlaySlot* NumberSlot = Overlay->AddChildToOverlay(Number))
		{
			NumberSlot->SetHorizontalAlignment(HAlign_Left);
			NumberSlot->SetVerticalAlignment(VAlign_Top);
			NumberSlot->SetPadding(FMargin(2.f, 0.f, 0.f, 0.f));
		}

		Background->SetContent(Overlay);
		Box->SetContent(Background);
		Frame->SetContent(Box);

		if (UHorizontalBoxSlot* BoxSlot = SlotBox->AddChildToHorizontalBox(Frame))
		{
			BoxSlot->SetPadding(FMargin(Index == 0 ? 0.f : SlotSpacing, 0.f, 0.f, 0.f));
			BoxSlot->SetVerticalAlignment(VAlign_Bottom);
		}
	}
}
