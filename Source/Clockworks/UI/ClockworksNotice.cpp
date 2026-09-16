// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksNotice.h"

#include "ClockworksHUDArt.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Border.h"
#include "Components/CanvasPanel.h"
#include "Components/CanvasPanelSlot.h"
#include "Components/TextBlock.h"
#include "Engine/World.h"
#include "TimerManager.h"

UClockworksNotice::UClockworksNotice(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	SetVisibility(ESlateVisibility::Collapsed);
}

// Runs on: the local machine only. Interface is never replicated.
TSharedRef<SWidget> UClockworksNotice::RebuildWidget()
{
	if (!WidgetTree->RootWidget)
	{
		UCanvasPanel* Canvas = WidgetTree->ConstructWidget<UCanvasPanel>(UCanvasPanel::StaticClass(), TEXT("NoticeCanvas"));
		WidgetTree->RootWidget = Canvas;

		Panel = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("NoticePanel"));
		Panel->SetBrushColor(PanelColor);
		Panel->SetPadding(FMargin(22.f, 12.f));
		Panel->SetHorizontalAlignment(HAlign_Center);
		Panel->SetVerticalAlignment(VAlign_Center);

		Message = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), TEXT("NoticeText"));
		Message->SetColorAndOpacity(FSlateColor(TextColor));
		Message->SetFont(ClockworksHUDArt::Font(18));
		Message->SetJustification(ETextJustify::Center);
		Panel->SetContent(Message);

		UCanvasPanelSlot* PanelSlot = Canvas->AddChildToCanvas(Panel);
		// Anchored to the bottom centre, so it reads wherever the window is and whatever its shape.
		PanelSlot->SetAnchors(FAnchors(0.5f, 1.f, 0.5f, 1.f));
		PanelSlot->SetAlignment(FVector2D(0.5f, 1.f));
		PanelSlot->SetPosition(FVector2D(0.f, -BottomMargin));
		PanelSlot->SetAutoSize(true);
	}

	return Super::RebuildWidget();
}

// Runs on: the local machine only.
void UClockworksNotice::Show(const FText& InMessage, float Seconds)
{
	if (!Message)
	{
		// Force the tree to exist: a notice can be asked for before the widget has ever been drawn.
		TakeWidget();
	}
	if (!Message)
	{
		return;
	}

	Message->SetText(InMessage);
	SetVisibility(ESlateVisibility::HitTestInvisible);

	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(HideTimer);
		World->GetTimerManager().SetTimer(HideTimer, this, &UClockworksNotice::Hide, FMath::Max(0.5f, Seconds), false);
	}
}

// Runs on: the local machine only.
void UClockworksNotice::ShowNotBuiltYet(const FText& What)
{
	Show(FText::Format(NSLOCTEXT("Clockworks", "NotBuiltYet", "{0} is not built yet."), What));
}

void UClockworksNotice::Hide()
{
	SetVisibility(ESlateVisibility::Collapsed);
}
