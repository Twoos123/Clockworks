// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksUplinkPanel.h"

#include "ClockworksHUDArt.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Border.h"
#include "Components/Button.h"
#include "Components/ButtonSlot.h"
#include "Components/CanvasPanel.h"
#include "Components/CanvasPanelSlot.h"
#include "Components/HorizontalBox.h"
#include "Components/HorizontalBoxSlot.h"
#include "Components/TextBlock.h"
#include "Components/VerticalBox.h"
#include "Components/VerticalBoxSlot.h"

#define LOCTEXT_NAMESPACE "Clockworks"

UClockworksUplinkPanel::UClockworksUplinkPanel(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
}

// Runs on: the local machine only. Interface is never replicated.
TSharedRef<SWidget> UClockworksUplinkPanel::RebuildWidget()
{
	if (!WidgetTree->RootWidget)
	{
		UCanvasPanel* Canvas = WidgetTree->ConstructWidget<UCanvasPanel>(UCanvasPanel::StaticClass(), TEXT("UplinkCanvas"));
		WidgetTree->RootWidget = Canvas;

		UBorder* Panel = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("UplinkPanel"));
		Panel->SetBrushColor(PanelColor);

		UVerticalBox* Column = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("UplinkColumn"));
		Panel->SetContent(Column);

		// The gold title bar the original puts on every window.
		UBorder* Header = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("UplinkHeader"));
		Header->SetBrushColor(HeaderColor);
		Header->SetPadding(FMargin(12.f, 6.f));
		UTextBlock* HeaderText = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), TEXT("UplinkTitle"));
		HeaderText->SetText(LOCTEXT("SpiralUplink", "SPIRAL UPLINK"));
		HeaderText->SetFont(ClockworksHUDArt::Font(17));
		HeaderText->SetColorAndOpacity(FSlateColor(FLinearColor(0.10f, 0.07f, 0.02f, 1.f)));
		Header->SetContent(HeaderText);
		Column->AddChildToVerticalBox(Header);

		UHorizontalBox* TabRow = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass(), TEXT("UplinkTabs"));
		AddTab(TabRow, TEXT("NewsTab"), LOCTEXT("UplinkNews", "NEWS"), EClockworksUplinkTab::News);
		AddTab(TabRow, TEXT("MailTab"), LOCTEXT("UplinkMail", "MAIL"), EClockworksUplinkTab::Mail);
		AddTab(TabRow, TEXT("InvitesTab"), LOCTEXT("UplinkInvites", "INVITES"), EClockworksUplinkTab::Invites);
		if (UVerticalBoxSlot* Placed = Column->AddChildToVerticalBox(TabRow))
		{
			Placed->SetPadding(FMargin(8.f, 8.f, 8.f, 0.f));
		}

		Body = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("UplinkBody"));
		if (UVerticalBoxSlot* Placed = Column->AddChildToVerticalBox(Body))
		{
			Placed->SetPadding(FMargin(14.f, 12.f, 14.f, 14.f));
		}

		if (UCanvasPanelSlot* Placed = Canvas->AddChildToCanvas(Panel))
		{
			Placed->SetAnchors(FAnchors(0.5f, 0.5f, 0.5f, 0.5f));
			Placed->SetAlignment(FVector2D(0.5f, 0.5f));
			Placed->SetPosition(FVector2D(0.f, 40.f));
			Placed->SetSize(PanelSize);
		}

		BuildBody();
	}

	return Super::RebuildWidget();
}

UButton* UClockworksUplinkPanel::AddTab(UHorizontalBox* Row, FName Name, const FText& Label, EClockworksUplinkTab Tab)
{
	if (!Row)
	{
		return nullptr;
	}

	UButton* Button = WidgetTree->ConstructWidget<UButton>(UButton::StaticClass(), Name);
	FButtonStyle Style = Button->GetStyle();
	const FLinearColor Base = (Tab == Current) ? FLinearColor(0.09f, 0.17f, 0.30f, 1.f) : FLinearColor(0.05f, 0.09f, 0.16f, 1.f);
	Style.Normal.TintColor = FSlateColor(Base);
	Style.Hovered.TintColor = FSlateColor(Base * 1.5f);
	Style.Pressed.TintColor = FSlateColor(Base * 0.8f);
	Button->SetStyle(Style);

	UTextBlock* Text = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), *(Name.ToString() + TEXT("Text")));
	Text->SetText(Label);
	Text->SetFont(ClockworksHUDArt::Font(14));
	Text->SetColorAndOpacity(FSlateColor(Tab == Current ? AccentColor : MutedTextColor));
	if (UButtonSlot* Inner = Cast<UButtonSlot>(Button->AddChild(Text)))
	{
		Inner->SetPadding(FMargin(16.f, 5.f));
	}

	Button->OnClicked.AddDynamic(this, &UClockworksUplinkPanel::OnTabClicked);
	Tabs.Add(Button, Tab);

	if (UHorizontalBoxSlot* Placed = Row->AddChildToHorizontalBox(Button))
	{
		Placed->SetPadding(FMargin(0.f, 0.f, 3.f, 0.f));
	}
	return Button;
}

// Runs on: the local machine only.
void UClockworksUplinkPanel::ShowTab(EClockworksUplinkTab Tab)
{
	Current = Tab;

	// The chosen tab is the lit one.
	for (const TPair<TObjectPtr<UButton>, EClockworksUplinkTab>& Pair : Tabs)
	{
		if (!Pair.Key)
		{
			continue;
		}
		FButtonStyle Style = Pair.Key->GetStyle();
		const FLinearColor Base = (Pair.Value == Current)
			? FLinearColor(0.09f, 0.17f, 0.30f, 1.f) : FLinearColor(0.05f, 0.09f, 0.16f, 1.f);
		Style.Normal.TintColor = FSlateColor(Base);
		Style.Hovered.TintColor = FSlateColor(Base * 1.5f);
		Pair.Key->SetStyle(Style);
	}

	BuildBody();
}

void UClockworksUplinkPanel::AddStory(const FText& Headline, const FText& Story)
{
	if (!Body)
	{
		return;
	}

	UTextBlock* Head = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), NAME_None);
	Head->SetText(Headline);
	Head->SetFont(ClockworksHUDArt::Font(16));
	Head->SetColorAndOpacity(FSlateColor(TextColor));
	if (UVerticalBoxSlot* Placed = Body->AddChildToVerticalBox(Head))
	{
		Placed->SetPadding(FMargin(0.f, 10.f, 0.f, 2.f));
	}

	UTextBlock* Text = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), NAME_None);
	Text->SetText(Story);
	Text->SetFont(ClockworksHUDArt::Font(13));
	Text->SetColorAndOpacity(FSlateColor(AccentColor));
	Text->SetAutoWrapText(true);
	Body->AddChildToVerticalBox(Text);
}

void UClockworksUplinkPanel::BuildBody()
{
	if (!Body)
	{
		return;
	}

	Body->ClearChildren();

	switch (Current)
	{
	case EClockworksUplinkTab::News:
		// The original's feed is live announcements from the service. There is no service, so the news is about the
		// thing you are actually running.
		AddStory(LOCTEXT("NewsFloorsHead", "The Clockworks are real"),
			LOCTEXT("NewsFloors", "Every floor is the original's own: its tiles, its props, its collision grid and its "
				"gates, read out of the game's own data rather than rebuilt by hand."));
		AddStory(LOCTEXT("NewsWeaponsHead", "Three hundred and fifty-one weapons"),
			LOCTEXT("NewsWeapons", "Each carries its own damage at every depth, its own timings, its own sounds and "
				"its own charged attack, taken from the game's files."));
		AddStory(LOCTEXT("NewsUnbuiltHead", "What is not here yet"),
			LOCTEXT("NewsUnbuilt", "Haven, the missions, the economy and two of the four bosses. Anything you press "
				"that is not built will say so rather than doing nothing."));
		break;

	case EClockworksUplinkTab::Mail:
	{
		// The original prints exactly this when the mailbox is empty, which it always is here.
		UTextBlock* Empty = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), NAME_None);
		Empty->SetText(LOCTEXT("NoMessages", "You have no messages."));
		Empty->SetFont(ClockworksHUDArt::Font(15));
		Empty->SetColorAndOpacity(FSlateColor(TextColor));
		if (UVerticalBoxSlot* Placed = Body->AddChildToVerticalBox(Empty))
		{
			Placed->SetPadding(FMargin(0.f, 12.f, 0.f, 0.f));
		}

		UTextBlock* Why = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), NAME_None);
		Why->SetText(LOCTEXT("NoMessagesWhy", "There is no server to carry mail between knights."));
		Why->SetFont(ClockworksHUDArt::Font(13));
		Why->SetColorAndOpacity(FSlateColor(MutedTextColor));
		Why->SetAutoWrapText(true);
		Body->AddChildToVerticalBox(Why);
		break;
	}

	case EClockworksUplinkTab::Invites:
	{
		UTextBlock* Empty = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), NAME_None);
		Empty->SetText(LOCTEXT("NoInvites", "You have no invitations."));
		Empty->SetFont(ClockworksHUDArt::Font(15));
		Empty->SetColorAndOpacity(FSlateColor(TextColor));
		if (UVerticalBoxSlot* Placed = Body->AddChildToVerticalBox(Empty))
		{
			Placed->SetPadding(FMargin(0.f, 12.f, 0.f, 0.f));
		}

		UTextBlock* Why = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), NAME_None);
		Why->SetText(LOCTEXT("NoInvitesWhy", "Two players is a listen server and an invitation, and neither is built "
			"yet. It is not cut - it is next after the runs."));
		Why->SetFont(ClockworksHUDArt::Font(13));
		Why->SetColorAndOpacity(FSlateColor(MutedTextColor));
		Why->SetAutoWrapText(true);
		Body->AddChildToVerticalBox(Why);
		break;
	}
	}
}

// Runs on: the local machine only.
void UClockworksUplinkPanel::OnTabClicked()
{
	for (const TPair<TObjectPtr<UButton>, EClockworksUplinkTab>& Pair : Tabs)
	{
		if (Pair.Key && Pair.Key->IsPressed())
		{
			ShowTab(Pair.Value);
			return;
		}
	}
}

// Runs on: the local machine only.
void UClockworksUplinkPanel::OnCloseClicked()
{
	SetVisibility(ESlateVisibility::Collapsed);
}

#undef LOCTEXT_NAMESPACE
