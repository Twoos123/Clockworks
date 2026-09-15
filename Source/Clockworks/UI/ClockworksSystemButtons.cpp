// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksSystemButtons.h"
#include "ClockworksHUDArt.h"
#include "ClockworksPlayerController.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Border.h"
#include "Components/Button.h"
#include "Components/ButtonSlot.h"
#include "Components/CanvasPanel.h"
#include "Components/HorizontalBox.h"
#include "Components/HorizontalBoxSlot.h"
#include "Components/Image.h"
#include "Components/Overlay.h"
#include "Components/OverlaySlot.h"
#include "Components/SizeBox.h"
#include "Components/TextBlock.h"
#include "Styling/SlateTypes.h"

#define LOCTEXT_NAMESPACE "ClockworksHUD"

// Runs on: the local machine only. UI is never replicated.
UClockworksSystemButtons::UClockworksSystemButtons(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	SetIsFocusable(false);
}

// Runs on: the local machine.
TSharedRef<SWidget> UClockworksSystemButtons::RebuildWidget()
{
	if (WidgetTree && !WidgetTree->RootWidget)
	{
		BuildTree();
	}
	return Super::RebuildWidget();
}

// Runs on: the local machine.
void UClockworksSystemButtons::BuildTree()
{
	using namespace ClockworksHUDArt;

	UCanvasPanel* Canvas = WidgetTree->ConstructWidget<UCanvasPanel>(UCanvasPanel::StaticClass(), TEXT("SystemButtonsCanvas"));
	// Only the real buttons take clicks.
	Canvas->SetVisibility(ESlateVisibility::SelfHitTestInvisible);
	WidgetTree->RootWidget = Canvas;

	auto MakeStrip = [this](FName StripName, const FVector4& Corners, UHorizontalBox*& OutRow) -> UBorder*
	{
		UBorder* Strip = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), StripName);
		FSlateBrush StripBrush = RoundedBrush(Navy, 0.f);
		StripBrush.OutlineSettings.CornerRadii = Corners;
		Strip->SetBrush(StripBrush);
		Strip->SetPadding(FMargin(8.f, 6.f, 8.f, 2.f));
		Strip->SetVisibility(ESlateVisibility::SelfHitTestInvisible);
		OutRow = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass());
		OutRow->SetVisibility(ESlateVisibility::SelfHitTestInvisible);
		Strip->SetContent(OutRow);
		return Strip;
	};
	auto AddToRow = [this](UHorizontalBox* Row, UWidget* Item)
	{
		if (UHorizontalBoxSlot* ItemSlot = Row->AddChildToHorizontalBox(Item))
		{
			ItemSlot->SetPadding(FMargin(ButtonSpacing * 0.5f, 0.f));
			ItemSlot->SetVerticalAlignment(VAlign_Center);
		}
	};
	auto MakeTab = [this](const TCHAR* TextureName)
	{
		return MakeSized(WidgetTree, MakeImage(WidgetTree, TextureBrush(TextureName, FVector2D(16.f, 36.f), NavyDark, 4.f)), FVector2D(16.f, 36.f));
	};

	// ---- bottom-left: main menu, help, social, event hub, uplink ----
	UHorizontalBox* LeftRow = nullptr;
	UBorder* LeftStrip = MakeStrip(TEXT("LeftStrip"), FVector4(0.f, 12.f, 0.f, 0.f), LeftRow);
	AddToRow(LeftRow, MakeButton(TEXT("SysSettings"), FText::GetEmpty(), false, TEXT("MenuButton"), &MenuButton));
	AddToRow(LeftRow, MakeDivider(WidgetTree, true));
	AddToRow(LeftRow, MakeButton(TEXT("SysHelp"), LOCTEXT("KeyF1", "F1"), false, TEXT("HelpButton"), &HelpButton));
	AddToRow(LeftRow, MakeDivider(WidgetTree, true));
	AddToRow(LeftRow, MakeButton(TEXT("SysSocial"), LOCTEXT("KeyF6", "F6"), false, TEXT("SocialPicture"), nullptr));
	AddToRow(LeftRow, MakeButton(TEXT("SysFeed"), LOCTEXT("KeyF7", "F7"), false, TEXT("EventHubPicture"), nullptr));
	AddToRow(LeftRow, MakeButton(TEXT("SysMail"), FText::GetEmpty(), false, TEXT("UplinkPicture"), nullptr));
	AddToRow(LeftRow, MakeTab(TEXT("CollapseTabLeft")));
	Place(Canvas, LeftStrip, FVector2D(0.f, 1.f), FVector2D(0.f, 1.f), FVector2D::ZeroVector);

	// ---- bottom-right: character, loadouts, forge, arsenal ----
	UHorizontalBox* RightRow = nullptr;
	UBorder* RightStrip = MakeStrip(TEXT("RightStrip"), FVector4(12.f, 0.f, 0.f, 0.f), RightRow);
	AddToRow(RightRow, MakeTab(TEXT("CollapseTabRight")));
	AddToRow(RightRow, MakeButton(TEXT("SysEquipment"), LOCTEXT("KeyP", "P"), true, TEXT("CharacterPicture"), nullptr));
	AddToRow(RightRow, MakeButton(TEXT("SysLoadout"), LOCTEXT("KeyL", "L"), true, TEXT("LoadoutsButton"), &LoadoutsButton));
	AddToRow(RightRow, MakeButton(TEXT("SysForge"), LOCTEXT("KeyU", "U"), true, TEXT("ForgePicture"), nullptr));
	AddToRow(RightRow, MakeButton(TEXT("SysArsenal"), LOCTEXT("KeyI", "I"), true, TEXT("ArsenalPicture"), nullptr));
	Place(Canvas, RightStrip, FVector2D(1.f, 1.f), FVector2D(1.f, 1.f), FVector2D::ZeroVector);

	if (MenuButton)
	{
		MenuButton->OnClicked.AddDynamic(this, &UClockworksSystemButtons::HandleMenuClicked);
	}
	if (HelpButton)
	{
		HelpButton->OnClicked.AddDynamic(this, &UClockworksSystemButtons::HandleHelpClicked);
	}
	if (LoadoutsButton)
	{
		LoadoutsButton->OnClicked.AddDynamic(this, &UClockworksSystemButtons::HandleLoadoutsClicked);
	}
}

// Runs on: the local machine.
UWidget* UClockworksSystemButtons::MakeButton(const TCHAR* IconName, const FText& Key, bool bRoundBadge, FName ButtonName, TObjectPtr<UButton>* OutButton)
{
	using namespace ClockworksHUDArt;

	const FVector2D IconSize(ButtonSize.X * 0.76f);
	UImage* Icon = MakeImage(WidgetTree, TextureBrush(IconName, IconSize, FLinearColor(0.60f, 0.80f, 1.f, 1.f), 4.f));
	const FSlateBrush BodyBrush = RoundedBrush(ButtonBlue, 8.f, ButtonOutline, 2.f);

	UWidget* Body = nullptr;
	if (OutButton)
	{
		UButton* Button = WidgetTree->ConstructWidget<UButton>(UButton::StaticClass(), ButtonName);
		FButtonStyle Style;
		Style.SetNormal(BodyBrush);
		Style.SetHovered(RoundedBrush(ButtonBlueHover, 8.f, Gold, 2.f));
		Style.SetPressed(RoundedBrush(ButtonBlue, 8.f, Gold, 2.f));
		Style.SetNormalPadding(FMargin(2.f));
		Style.SetPressedPadding(FMargin(2.f, 3.f, 2.f, 1.f));
		Button->SetStyle(Style);
		if (UButtonSlot* IconSlot = Cast<UButtonSlot>(Button->SetContent(MakeSized(WidgetTree, Icon, IconSize))))
		{
			IconSlot->SetHorizontalAlignment(HAlign_Center);
			IconSlot->SetVerticalAlignment(VAlign_Center);
		}
		*OutButton = Button;
		Body = Button;
	}
	else
	{
		UBorder* Picture = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), ButtonName);
		Picture->SetBrush(BodyBrush);
		Picture->SetPadding(FMargin(2.f));
		Picture->SetHorizontalAlignment(HAlign_Center);
		Picture->SetVerticalAlignment(VAlign_Center);
		Picture->SetContent(MakeSized(WidgetTree, Icon, IconSize));
		Picture->SetVisibility(ESlateVisibility::HitTestInvisible);
		Body = Picture;
	}

	UOverlay* Stack = WidgetTree->ConstructWidget<UOverlay>(UOverlay::StaticClass());
	Stack->SetVisibility(ESlateVisibility::SelfHitTestInvisible);
	if (UOverlaySlot* BodySlot = Stack->AddChildToOverlay(MakeSized(WidgetTree, Body, ButtonSize)))
	{
		BodySlot->SetHorizontalAlignment(HAlign_Center);
		BodySlot->SetVerticalAlignment(VAlign_Top);
	}

	if (!Key.IsEmpty())
	{
		UBorder* Badge = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass());
		Badge->SetBrush(RoundedBrush(NavyDark, bRoundBadge ? -1.f : 6.f, Gold, 1.5f));
		Badge->SetPadding(FMargin(bRoundBadge ? 5.f : 6.f, 0.f));
		Badge->SetContent(MakeText(WidgetTree, Key, 11, Gold, EHUDTypeface::Bold, 0));
		Badge->SetVisibility(ESlateVisibility::HitTestInvisible);
		if (UOverlaySlot* BadgeSlot = Stack->AddChildToOverlay(Badge))
		{
			BadgeSlot->SetHorizontalAlignment(HAlign_Center);
			BadgeSlot->SetVerticalAlignment(VAlign_Bottom);
		}
	}

	USizeBox* Outer = MakeSized(WidgetTree, Stack, FVector2D(ButtonSize.X, ButtonSize.Y + BadgeOverhang));
	Outer->SetVisibility(ESlateVisibility::SelfHitTestInvisible);
	return Outer;
}

// Runs on: the local machine. The wrench: the pause menu, as Escape opens it.
void UClockworksSystemButtons::HandleMenuClicked()
{
	if (AClockworksPlayerController* Controller = Cast<AClockworksPlayerController>(GetOwningPlayer()))
	{
		Controller->OpenPauseMenu();
	}
}

// Runs on: the local machine. The question mark: How to Play, as F1 opens it.
void UClockworksSystemButtons::HandleHelpClicked()
{
	if (AClockworksPlayerController* Controller = Cast<AClockworksPlayerController>(GetOwningPlayer()))
	{
		Controller->OpenGuideScreen();
	}
}

// Runs on: the local machine. Loadouts: the gear screen, as L opens it.
void UClockworksSystemButtons::HandleLoadoutsClicked()
{
	if (AClockworksPlayerController* Controller = Cast<AClockworksPlayerController>(GetOwningPlayer()))
	{
		Controller->ToggleGearScreen();
	}
}

#undef LOCTEXT_NAMESPACE
