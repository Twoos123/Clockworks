// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksActivitiesPanel.h"

#include "ClockworksHUDArt.h"
#include "ClockworksPlayerController.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Border.h"
#include "Components/Button.h"
#include "Components/ButtonSlot.h"
#include "Components/CanvasPanel.h"
#include "Components/CanvasPanelSlot.h"
#include "Components/TextBlock.h"
#include "Components/VerticalBox.h"
#include "Components/VerticalBoxSlot.h"

#define LOCTEXT_NAMESPACE "Clockworks"

UClockworksActivitiesPanel::UClockworksActivitiesPanel(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
}

// Runs on: the local machine only. Interface is never replicated.
TSharedRef<SWidget> UClockworksActivitiesPanel::RebuildWidget()
{
	if (!WidgetTree->RootWidget)
	{
		UCanvasPanel* Canvas = WidgetTree->ConstructWidget<UCanvasPanel>(UCanvasPanel::StaticClass(), TEXT("ActivitiesCanvas"));
		WidgetTree->RootWidget = Canvas;

		UBorder* Panel = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("ActivitiesPanel"));
		Panel->SetBrushColor(PanelColor);
		Panel->SetPadding(FMargin(10.f, 10.f));

		Column = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("ActivitiesColumn"));
		Panel->SetContent(Column);

		UTextBlock* Heading = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), TEXT("ActivitiesHeading"));
		Heading->SetText(LOCTEXT("Activities", "ACTIVITIES"));
		Heading->SetFont(ClockworksHUDArt::Font(15));
		Heading->SetColorAndOpacity(FSlateColor(AccentColor));
		if (UVerticalBoxSlot* Placed = Column->AddChildToVerticalBox(Heading))
		{
			Placed->SetPadding(FMargin(4.f, 0.f, 4.f, 8.f));
		}

		// The original's own list, in its own order. Only what exists leads anywhere.
		AddActivity(Column, TEXT("Haven"), LOCTEXT("GoToHaven", "Go to Haven"), /*bBuilt*/ false);
		AddActivity(Column, TEXT("Missions"), LOCTEXT("Missions", "Missions"), /*bBuilt*/ false);
		AddActivity(Column, TEXT("GuildHalls"), LOCTEXT("GuildHalls", "Guild Halls"), /*bBuilt*/ false);
		AddActivity(Column, TEXT("Coliseum"), LOCTEXT("Coliseum", "Coliseum"), /*bBuilt*/ false);
		AddActivity(Column, TEXT("PartyFinder"), LOCTEXT("PartyFinder", "Party Finder"), /*bBuilt*/ false);
		AddActivity(Column, TEXT("SupplyDepot"), LOCTEXT("SupplyDepot", "Supply Depot"), /*bBuilt*/ false);

		if (UCanvasPanelSlot* Placed = Canvas->AddChildToCanvas(Panel))
		{
			// Down the right, where the original puts it.
			Placed->SetAnchors(FAnchors(1.f, 0.f, 1.f, 0.f));
			Placed->SetAlignment(FVector2D(1.f, 0.f));
			Placed->SetPosition(FVector2D(-16.f, 120.f));
			Placed->SetSize(FVector2D(190.f, 10.f));
			Placed->SetAutoSize(true);
		}
	}

	return Super::RebuildWidget();
}

UButton* UClockworksActivitiesPanel::AddActivity(UVerticalBox* InColumn, FName Name, const FText& Label, bool bBuilt)
{
	if (!InColumn)
	{
		return nullptr;
	}

	UButton* Button = WidgetTree->ConstructWidget<UButton>(UButton::StaticClass(), Name);
	FButtonStyle Style = Button->GetStyle();
	Style.Normal.TintColor = FSlateColor(ButtonColor);
	Style.Hovered.TintColor = FSlateColor(ButtonColor * 1.5f);
	Style.Pressed.TintColor = FSlateColor(ButtonColor * 0.75f);
	Button->SetStyle(Style);

	UTextBlock* Text = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), *(Name.ToString() + TEXT("Text")));
	Text->SetText(Label);
	Text->SetFont(ClockworksHUDArt::Font(14));
	Text->SetColorAndOpacity(FSlateColor(FLinearColor(0.88f, 0.93f, 1.f, 1.f)));
	if (UButtonSlot* Inner = Cast<UButtonSlot>(Button->AddChild(Text)))
	{
		Inner->SetPadding(FMargin(10.f, 5.f));
		Inner->SetHorizontalAlignment(HAlign_Left);
	}

	Button->OnClicked.AddDynamic(this, &UClockworksActivitiesPanel::OnActivityClicked);
	ActivityNames.Add(Button, Label);
	if (bBuilt)
	{
		BuiltActivities.Add(Button);
	}

	if (UVerticalBoxSlot* Placed = InColumn->AddChildToVerticalBox(Button))
	{
		Placed->SetPadding(FMargin(0.f, 0.f, 0.f, 3.f));
	}
	return Button;
}

// Runs on: the local machine only.
void UClockworksActivitiesPanel::OnActivityClicked()
{
	AClockworksPlayerController* Controller = Cast<AClockworksPlayerController>(GetOwningPlayer());
	if (!Controller)
	{
		return;
	}

	// Slate gives no sender, so the pressed one is found by its state.
	for (const TPair<TObjectPtr<UButton>, FText>& Pair : ActivityNames)
	{
		if (Pair.Key && Pair.Key->IsPressed())
		{
			if (!BuiltActivities.Contains(Pair.Key))
			{
				Controller->ShowNotBuiltYet(Pair.Value);
			}
			return;
		}
	}
}

#undef LOCTEXT_NAMESPACE
