// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksCharacterSelect.h"

#include "ClockworksHUDArt.h"
#include "ClockworksPlayerController.h"
#include "ClockworksProfileSave.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Border.h"
#include "Components/Button.h"
#include "Components/CanvasPanel.h"
#include "Components/CanvasPanelSlot.h"
#include "Components/TextBlock.h"
#include "Components/VerticalBox.h"
#include "Components/VerticalBoxSlot.h"

#define LOCTEXT_NAMESPACE "Clockworks"

UClockworksCharacterSelect::UClockworksCharacterSelect(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	// The original keeps the Grey Havens mark on the title screen and an Energy readout here instead.
	bShowFooter = false;
}

// Runs on: the local machine only.
void UClockworksCharacterSelect::OpenMenu()
{
	Profile = UClockworksProfileSave::Load();
	Super::OpenMenu();
	RefreshCards();
}

// Runs on: the local machine only.
void UClockworksCharacterSelect::BuildForeground(UCanvasPanel* Canvas)
{
	if (!Canvas)
	{
		return;
	}

	UTextBlock* Heading = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), TEXT("SelectHeading"));
	Heading->SetText(LOCTEXT("SelectACharacter", "SELECT A CHARACTER"));
	Heading->SetFont(ClockworksHUDArt::Font(26));
	Heading->SetColorAndOpacity(FSlateColor(FLinearColor::White));
	if (UCanvasPanelSlot* Placed = Canvas->AddChildToCanvas(Heading))
	{
		Placed->SetAnchors(FAnchors(0.5f, 0.5f, 0.5f, 0.5f));
		Placed->SetAlignment(FVector2D(0.5f, 1.f));
		Placed->SetPosition(FVector2D(0.f, -210.f));
		Placed->SetAutoSize(true);
	}

	// The cards live in their own canvas so the row can be emptied and rebuilt without touching the sky.
	CardRow = WidgetTree->ConstructWidget<UCanvasPanel>(UCanvasPanel::StaticClass(), TEXT("CardRow"));
	if (UCanvasPanelSlot* Placed = Canvas->AddChildToCanvas(CardRow))
	{
		Placed->SetAnchors(FAnchors(0.5f, 0.5f, 0.5f, 0.5f));
		Placed->SetAlignment(FVector2D(0.5f, 0.f));
		Placed->SetPosition(FVector2D(0.f, -190.f));
		Placed->SetSize(FVector2D(CardSize.X * (MaxKnights + 1) + 60.f, CardSize.Y + 20.f));
	}

	// Bottom left, as the original has it.
	if (UButton* LogOff = AddTitleButton(Canvas, TEXT("LogOffButton"), LOCTEXT("LogOff", "Log off"),
		FVector2D(0.f, 0.f), FVector2D(120.f, 28.f), /*bPrimary*/ false))
	{
		LogOff->OnClicked.AddDynamic(this, &UClockworksCharacterSelect::OnLogOffClicked);
		if (UCanvasPanelSlot* Placed = Cast<UCanvasPanelSlot>(LogOff->Slot))
		{
			Placed->SetAnchors(FAnchors(0.f, 1.f, 0.f, 1.f));
			Placed->SetAlignment(FVector2D(0.f, 1.f));
			Placed->SetPosition(FVector2D(24.f, -24.f));
		}
	}
}

// Runs on: the local machine only.
void UClockworksCharacterSelect::RefreshCards()
{
	if (!CardRow)
	{
		return;
	}

	CardRow->ClearChildren();
	CardIndices.Reset();
	DeleteIndices.Reset();

	const int32 Existing = Profile ? Profile->Knights.Num() : 0;
	const int32 Shown = FMath::Min(Existing, MaxKnights);
	// The empty slot at the end is only offered while there is room for another knight.
	const int32 Total = Shown + (Existing < MaxKnights ? 1 : 0);
	const float Step = CardSize.X + 14.f;
	const float Left = -(Total - 1) * Step * 0.5f;

	for (int32 Index = 0; Index < Total; ++Index)
	{
		AddCard(CardRow, Index < Shown ? Index : INDEX_NONE, Left + Index * Step);
	}
}

// Runs on: the local machine only.
void UClockworksCharacterSelect::AddCard(UCanvasPanel* Row, int32 Index, float X)
{
	const bool bEmpty = Index == INDEX_NONE;
	const FClockworksKnightRecord* Knight = (!bEmpty && Profile && Profile->Knights.IsValidIndex(Index))
		? &Profile->Knights[Index] : nullptr;

	UButton* Card = WidgetTree->ConstructWidget<UButton>(UButton::StaticClass(),
		*FString::Printf(TEXT("Card_%d"), bEmpty ? 99 : Index));
	StyleButton(Card, bEmpty ? FLinearColor(0.05f, 0.09f, 0.16f, 0.85f) : PanelColor);

	UVerticalBox* Column = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(),
		*FString::Printf(TEXT("CardColumn_%d"), bEmpty ? 99 : Index));

	const auto AddLine = [&](const FText& Text, int32 Size, const FLinearColor& Colour, float TopPad)
	{
		UTextBlock* Line = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), NAME_None);
		Line->SetText(Text);
		Line->SetFont(ClockworksHUDArt::Font(Size));
		Line->SetColorAndOpacity(FSlateColor(Colour));
		if (UVerticalBoxSlot* Placed = Column->AddChildToVerticalBox(Line))
		{
			Placed->SetPadding(FMargin(12.f, TopPad, 12.f, 0.f));
		}
	};

	if (Knight)
	{
		// The gold name plate across the top of the card.
		AddLine(FText::FromString(Knight->Name), 18, AccentColor, 10.f);
		AddLine(FText::Format(LOCTEXT("KnightRank", "Rank: {0}"), FText::FromString(Knight->Rank)), 13, TextColor, 180.f);
		AddLine(FText::Format(LOCTEXT("KnightGuild", "Guild: {0}"),
			FText::FromString(Knight->Guild.IsEmpty() ? TEXT("---") : Knight->Guild)), 13, MutedTextColor, 2.f);
		AddLine(FText::Format(LOCTEXT("KnightPlayed", "Played: {0}"),
			FText::FromString(UClockworksProfileSave::FormatPlayed(Knight->PlayedSeconds))), 13, MutedTextColor, 2.f);
		AddLine(FText::Format(LOCTEXT("KnightDepth", "Deepest: {0}"),
			FText::AsNumber(Knight->DeepestDepth)), 13, MutedTextColor, 2.f);
	}
	else
	{
		AddLine(LOCTEXT("NewKnight", "New Knight"), 18, AccentColor, 10.f);
		AddLine(LOCTEXT("NewKnightSub", "Start a new knight on this machine."), 13, MutedTextColor, 180.f);
	}

	Card->AddChild(Column);
	Card->OnClicked.AddDynamic(this, bEmpty
		? &UClockworksCharacterSelect::OnNewKnightClicked
		: &UClockworksCharacterSelect::OnKnightClicked);
	if (!bEmpty)
	{
		CardIndices.Add(Card, Index);
	}

	if (UCanvasPanelSlot* Placed = Row->AddChildToCanvas(Card))
	{
		Placed->SetAnchors(FAnchors(0.5f, 0.f, 0.5f, 0.f));
		Placed->SetAlignment(FVector2D(0.5f, 0.f));
		Placed->SetPosition(FVector2D(X, 0.f));
		Placed->SetSize(CardSize);
	}

	if (!Knight)
	{
		return;
	}

	// Delete sits along the bottom of the card, as it does in the original.
	UButton* Delete = WidgetTree->ConstructWidget<UButton>(UButton::StaticClass(),
		*FString::Printf(TEXT("Delete_%d"), Index));
	StyleButton(Delete, FLinearColor(0.32f, 0.08f, 0.10f, 1.f));

	UTextBlock* DeleteText = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), NAME_None);
	DeleteText->SetText(LOCTEXT("DeleteKnight", "Delete"));
	DeleteText->SetFont(ClockworksHUDArt::Font(13));
	DeleteText->SetColorAndOpacity(FSlateColor(FLinearColor(0.95f, 0.85f, 0.85f, 1.f)));
	DeleteText->SetJustification(ETextJustify::Center);
	Delete->AddChild(DeleteText);
	Delete->OnClicked.AddDynamic(this, &UClockworksCharacterSelect::OnDeleteClicked);
	DeleteIndices.Add(Delete, Index);

	if (UCanvasPanelSlot* Placed = Row->AddChildToCanvas(Delete))
	{
		Placed->SetAnchors(FAnchors(0.5f, 0.f, 0.5f, 0.f));
		Placed->SetAlignment(FVector2D(0.5f, 0.f));
		Placed->SetPosition(FVector2D(X, CardSize.Y - 34.f));
		Placed->SetSize(FVector2D(CardSize.X - 24.f, 26.f));
	}
}

// Runs on: the local machine only.
void UClockworksCharacterSelect::OnKnightClicked()
{
	PlayClick();

	// Whichever card was pressed: Slate gives no sender, so the pressed one is found by its state.
	for (const TPair<TObjectPtr<UButton>, int32>& Pair : CardIndices)
	{
		if (Pair.Key && Pair.Key->IsPressed())
		{
			if (Profile)
			{
				Profile->LastPlayed = Pair.Value;
				Profile->Save();
			}
			break;
		}
	}

	CloseMenu();
}

// Runs on: the local machine only.
void UClockworksCharacterSelect::OnNewKnightClicked()
{
	PlayClick();

	if (!Profile)
	{
		Profile = UClockworksProfileSave::Load();
	}
	if (Profile)
	{
		// Named for the order they were made until there is a screen to name one on, which the original has and this
		// does not yet.
		Profile->AddKnight(FString::Printf(TEXT("Knight %d"), Profile->Knights.Num() + 1));
	}
	RefreshCards();
}

// Runs on: the local machine only.
void UClockworksCharacterSelect::OnDeleteClicked()
{
	PlayClick();

	for (const TPair<TObjectPtr<UButton>, int32>& Pair : DeleteIndices)
	{
		if (Pair.Key && Pair.Key->IsPressed() && Profile)
		{
			Profile->RemoveKnight(Pair.Value);
			break;
		}
	}
	RefreshCards();
}

// Runs on: the local machine only.
void UClockworksCharacterSelect::OnLogOffClicked()
{
	PlayClick();
	if (AClockworksPlayerController* Controller = Cast<AClockworksPlayerController>(GetOwningPlayer()))
	{
		Controller->ShowNotBuiltYet(LOCTEXT("LogOffName", "Logging off"));
	}
}

#undef LOCTEXT_NAMESPACE
