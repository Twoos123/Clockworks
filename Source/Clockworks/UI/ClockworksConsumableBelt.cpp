// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksConsumableBelt.h"
#include "ClockworksHUDArt.h"
#include "Blueprint/WidgetTree.h"
#include "Components/CanvasPanel.h"
#include "Components/HorizontalBox.h"
#include "Components/HorizontalBoxSlot.h"
#include "Components/Image.h"
#include "Components/Overlay.h"
#include "Components/OverlaySlot.h"
#include "Components/SizeBox.h"
#include "Components/TextBlock.h"

// Runs on: the local machine only. UI is never replicated.
UClockworksConsumableBelt::UClockworksConsumableBelt(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	SetIsFocusable(false);
}

// Runs on: the local machine.
TSharedRef<SWidget> UClockworksConsumableBelt::RebuildWidget()
{
	if (WidgetTree && !WidgetTree->RootWidget)
	{
		BuildTree();
	}
	return Super::RebuildWidget();
}

// Runs on: the local machine.
void UClockworksConsumableBelt::BuildTree()
{
	using namespace ClockworksHUDArt;

	UCanvasPanel* Canvas = WidgetTree->ConstructWidget<UCanvasPanel>(UCanvasPanel::StaticClass(), TEXT("BeltCanvas"));
	Canvas->SetVisibility(ESlateVisibility::HitTestInvisible);
	WidgetTree->RootWidget = Canvas;

	UHorizontalBox* Row = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass(), TEXT("BeltSlots"));
	for (int32 Index = 0; Index < QuickSlotCount; ++Index)
	{
		if (UHorizontalBoxSlot* QuickSlot = Row->AddChildToHorizontalBox(MakeBeltSlot(FText::AsNumber(FirstKey + Index), false)))
		{
			QuickSlot->SetPadding(FMargin(3.f, 0.f));
		}
	}
	if (UHorizontalBoxSlot* DividerSlot = Row->AddChildToHorizontalBox(MakeDivider(WidgetTree, true)))
	{
		DividerSlot->SetPadding(FMargin(6.f, 0.f));
		DividerSlot->SetVerticalAlignment(VAlign_Center);
	}
	if (UHorizontalBoxSlot* VitapodSlot = Row->AddChildToHorizontalBox(MakeBeltSlot(FText::GetEmpty(), true)))
	{
		VitapodSlot->SetPadding(FMargin(3.f, 0.f));
	}

	Place(Canvas, Row, FVector2D(0.5f, 1.f), FVector2D(0.5f, 1.f), FVector2D(0.f, -BottomMargin));
}

// Runs on: the local machine.
UWidget* UClockworksConsumableBelt::MakeBeltSlot(const FText& Key, bool bVitapod)
{
	using namespace ClockworksHUDArt;

	const FVector2D Extent(SlotSize, SlotSize);
	UOverlay* Stack = WidgetTree->ConstructWidget<UOverlay>(UOverlay::StaticClass());
	auto AddFill = [Stack](UWidget* Layer)
	{
		if (UOverlaySlot* LayerSlot = Stack->AddChildToOverlay(Layer))
		{
			LayerSlot->SetHorizontalAlignment(HAlign_Fill);
			LayerSlot->SetVerticalAlignment(VAlign_Fill);
		}
	};

	AddFill(MakeImage(WidgetTree, TextureBrush(TEXT("SlotBacking"), Extent, Navy, 10.f)));

	const TCHAR* FaceName = bVitapod ? TEXT("SlotVitapodEmpty") : TEXT("SlotEmpty");
	const FLinearColor Rim = bVitapod ? FLinearColor(0.85f, 0.12f, 0.12f, 1.f) : SteelBlue;
	AddFill(MakeImage(WidgetTree, Texture(FaceName)
		? TextureBrush(FaceName, Extent)
		: RoundedBrush(FLinearColor::Transparent, 10.f, Rim, 3.f)));

	if (!Key.IsEmpty())
	{
		const FVector2D BadgeSize(22.f, 22.f);
		UOverlay* Badge = WidgetTree->ConstructWidget<UOverlay>(UOverlay::StaticClass());
		if (UOverlaySlot* DiscSlot = Badge->AddChildToOverlay(MakeImage(WidgetTree, TextureBrush(TEXT("SlotHotkey"), BadgeSize, NavyDark, -1.f))))
		{
			DiscSlot->SetHorizontalAlignment(HAlign_Fill);
			DiscSlot->SetVerticalAlignment(VAlign_Fill);
		}
		if (UOverlaySlot* KeySlot = Badge->AddChildToOverlay(MakeText(WidgetTree, Key, 11, Gold, EHUDTypeface::Bold, 0)))
		{
			KeySlot->SetHorizontalAlignment(HAlign_Center);
			KeySlot->SetVerticalAlignment(VAlign_Center);
		}
		if (UOverlaySlot* BadgeSlot = Stack->AddChildToOverlay(MakeSized(WidgetTree, Badge, BadgeSize)))
		{
			BadgeSlot->SetHorizontalAlignment(HAlign_Left);
			BadgeSlot->SetVerticalAlignment(VAlign_Bottom);
		}
	}

	return MakeSized(WidgetTree, Stack, Extent);
}
