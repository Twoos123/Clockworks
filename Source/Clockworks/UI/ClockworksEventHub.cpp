// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksEventHub.h"

#include "ClockworksHUDArt.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Border.h"
#include "Components/CanvasPanel.h"
#include "Components/CanvasPanelSlot.h"
#include "Components/TextBlock.h"
#include "Components/VerticalBox.h"
#include "Components/VerticalBoxSlot.h"

#define LOCTEXT_NAMESPACE "Clockworks"

UClockworksEventHub::UClockworksEventHub(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
}

// Runs on: the local machine only. Interface is never replicated.
TSharedRef<SWidget> UClockworksEventHub::RebuildWidget()
{
	if (!WidgetTree->RootWidget)
	{
		UCanvasPanel* Canvas = WidgetTree->ConstructWidget<UCanvasPanel>(UCanvasPanel::StaticClass(), TEXT("EventHubCanvas"));
		WidgetTree->RootWidget = Canvas;

		UBorder* Panel = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("EventHubPanel"));
		Panel->SetBrushColor(PanelColor);

		UVerticalBox* Outer = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("EventHubOuter"));
		Panel->SetContent(Outer);

		UBorder* Header = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("EventHubHeader"));
		Header->SetBrushColor(HeaderColor);
		Header->SetPadding(FMargin(10.f, 5.f));
		UTextBlock* HeaderText = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), TEXT("EventHubTitle"));
		HeaderText->SetText(LOCTEXT("EventHub", "EVENT HUB"));
		HeaderText->SetFont(ClockworksHUDArt::Font(15));
		HeaderText->SetColorAndOpacity(FSlateColor(FLinearColor(0.10f, 0.07f, 0.02f, 1.f)));
		Header->SetContent(HeaderText);
		Outer->AddChildToVerticalBox(Header);

		Column = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("EventHubColumn"));
		if (UVerticalBoxSlot* Placed = Outer->AddChildToVerticalBox(Column))
		{
			Placed->SetPadding(FMargin(10.f, 8.f, 10.f, 10.f));
		}

		if (UCanvasPanelSlot* Placed = Canvas->AddChildToCanvas(Panel))
		{
			// Down the left, where the original puts it.
			Placed->SetAnchors(FAnchors(0.f, 0.f, 0.f, 0.f));
			Placed->SetAlignment(FVector2D(0.f, 0.f));
			Placed->SetPosition(FVector2D(14.f, 14.f));
			Placed->SetSize(PanelSize);
		}

		Refresh();
	}

	return Super::RebuildWidget();
}

void UClockworksEventHub::AddSection(const FText& Label)
{
	if (!Column)
	{
		return;
	}

	UTextBlock* Heading = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), NAME_None);
	Heading->SetText(Label);
	Heading->SetFont(ClockworksHUDArt::Font(13));
	Heading->SetColorAndOpacity(FSlateColor(AccentColor));
	if (UVerticalBoxSlot* Placed = Column->AddChildToVerticalBox(Heading))
	{
		Placed->SetPadding(FMargin(0.f, 10.f, 0.f, 4.f));
	}
}

// Runs on: the local machine only.
void UClockworksEventHub::AddEvent(const FText& Text)
{
	Events.Insert(Text, 0);
	Refresh();
}

void UClockworksEventHub::Refresh()
{
	if (!Column)
	{
		return;
	}

	Column->ClearChildren();
	AddSection(LOCTEXT("EventsSection", "THIS KNIGHT"));

	if (Events.Num() == 0)
	{
		// The original's hub is full of other people. There are no other people here, and saying so is better than
		// inventing a friend who defeated Vanaduke.
		UTextBlock* Empty = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), NAME_None);
		Empty->SetText(LOCTEXT("NoEvents",
			"Nothing yet. What you do in the Clockworks will be listed here once a run keeps its history."));
		Empty->SetFont(ClockworksHUDArt::Font(12));
		Empty->SetColorAndOpacity(FSlateColor(MutedTextColor));
		Empty->SetAutoWrapText(true);
		Column->AddChildToVerticalBox(Empty);
		return;
	}

	for (const FText& Event : Events)
	{
		UTextBlock* Line = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), NAME_None);
		Line->SetText(Event);
		Line->SetFont(ClockworksHUDArt::Font(12));
		Line->SetColorAndOpacity(FSlateColor(TextColor));
		Line->SetAutoWrapText(true);
		if (UVerticalBoxSlot* Placed = Column->AddChildToVerticalBox(Line))
		{
			Placed->SetPadding(FMargin(0.f, 0.f, 0.f, 6.f));
		}
	}
}

#undef LOCTEXT_NAMESPACE
