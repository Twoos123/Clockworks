// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksMenuScreen.h"
#include "Blueprint/WidgetTree.h"
#include "Camera/PlayerCameraManager.h"
#include "Components/Border.h"
#include "Components/BorderSlot.h"
#include "Components/Button.h"
#include "Components/ButtonSlot.h"
#include "Components/CanvasPanel.h"
#include "Components/CanvasPanelSlot.h"
#include "Components/HorizontalBox.h"
#include "Components/HorizontalBoxSlot.h"
#include "Components/Image.h"
#include "Components/ScrollBox.h"
#include "Components/SizeBox.h"
#include "Components/Spacer.h"
#include "Components/TextBlock.h"
#include "Components/VerticalBox.h"
#include "Components/VerticalBoxSlot.h"
#include "Engine/Texture2D.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"
#include "Sound/SoundBase.h"
#include "Styling/SlateTypes.h"

// Runs on: the local machine only. UI is never replicated.
UClockworksMenuScreen::UClockworksMenuScreen(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	// A menu takes the keyboard, unlike the HUD, so Escape and the arrow keys reach it.
	SetIsFocusable(true);
}

// Runs on: the local machine. A WBP_ child that designed its own tree keeps it.
TSharedRef<SWidget> UClockworksMenuScreen::RebuildWidget()
{
	if (WidgetTree && !WidgetTree->RootWidget)
	{
		BuildTree();
		BuildContents();
	}
	return Super::RebuildWidget();
}

// Runs on: the local machine.
void UClockworksMenuScreen::BuildTree()
{
	RootCanvas = WidgetTree->ConstructWidget<UCanvasPanel>(UCanvasPanel::StaticClass(), TEXT("MenuCanvas"));
	WidgetTree->RootWidget = RootCanvas;

	// The dimmed sheet over the game. It also swallows clicks, so nothing behind a menu can be hit.
	Backdrop = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("Backdrop"));
	Backdrop->SetBrushColor(BackdropColor);
	Backdrop->SetPadding(FMargin(24.f));
	Backdrop->SetHorizontalAlignment(HAlign_Center);
	Backdrop->SetVerticalAlignment(VAlign_Center);

	if (UCanvasPanelSlot* BackdropSlot = RootCanvas->AddChildToCanvas(Backdrop))
	{
		// Anchored to all four corners so it covers the screen at any resolution.
		BackdropSlot->SetAnchors(FAnchors(0.f, 0.f, 1.f, 1.f));
		BackdropSlot->SetOffsets(FMargin(0.f));
	}

	// The panel is a fixed width and a capped height. Capped rather than fixed, so a short screen
	// stays short and only a long one scrolls.
	USizeBox* PanelSize = WidgetTree->ConstructWidget<USizeBox>(USizeBox::StaticClass(), TEXT("PanelSize"));
	PanelSize->SetWidthOverride(PanelWidth);
	PanelSize->SetMaxDesiredHeight(PanelMaxHeight);
	Backdrop->SetContent(PanelSize);

	UBorder* Panel = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("MenuPanel"));
	Panel->SetBrushColor(PanelColor);
	Panel->SetPadding(FMargin(0.f));
	PanelSize->SetContent(Panel);

	UVerticalBox* Column = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("MenuColumn"));
	Panel->SetContent(Column);

	// ----- header -----

	UBorder* Header = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("MenuHeader"));
	Header->SetBrushColor(HeaderColor);
	Header->SetPadding(FMargin(30.f, 22.f, 30.f, 18.f));

	UVerticalBox* HeaderColumn = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("HeaderColumn"));
	Header->SetContent(HeaderColumn);

	if (!Title.IsEmpty())
	{
		UTextBlock* TitleText = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), TEXT("MenuTitle"));
		TitleText->SetText(Title);
		TitleText->SetColorAndOpacity(FSlateColor(TextColor));
		FSlateFontInfo TitleFont = TitleText->GetFont();
		TitleFont.Size = TitleFontSize;
		TitleText->SetFont(TitleFont);
		// Letter spacing gives a short all-caps word the weight a title needs without a display face.
		TitleText->SetMinDesiredWidth(0.f);
		HeaderColumn->AddChildToVerticalBox(TitleText);
	}

	if (!Subtitle.IsEmpty())
	{
		UTextBlock* SubtitleText = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), TEXT("MenuSubtitle"));
		SubtitleText->SetText(Subtitle);
		SubtitleText->SetColorAndOpacity(FSlateColor(MutedTextColor));
		FSlateFontInfo SubtitleFont = SubtitleText->GetFont();
		SubtitleFont.Size = BodyFontSize;
		SubtitleText->SetFont(SubtitleFont);
		SubtitleText->SetAutoWrapText(true);

		if (UVerticalBoxSlot* SubtitleSlot = HeaderColumn->AddChildToVerticalBox(SubtitleText))
		{
			SubtitleSlot->SetPadding(FMargin(0.f, 6.f, 0.f, 0.f));
		}
	}

	if (UVerticalBoxSlot* HeaderSlot = Column->AddChildToVerticalBox(Header))
	{
		HeaderSlot->SetHorizontalAlignment(HAlign_Fill);
		HeaderSlot->SetSize(FSlateChildSize(ESlateSizeRule::Automatic));
	}

	// ----- scrolling content -----

	ContentScroll = WidgetTree->ConstructWidget<UScrollBox>(UScrollBox::StaticClass(), TEXT("MenuScroll"));
	ContentScroll->SetOrientation(Orient_Vertical);
	ContentScroll->SetScrollBarVisibility(ESlateVisibility::Visible);
	ContentScroll->SetAllowOverscroll(false);

	UBorder* ContentPad = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("ContentPad"));
	ContentPad->SetBrushColor(FLinearColor(0.f, 0.f, 0.f, 0.f));
	ContentPad->SetPadding(FMargin(30.f, 22.f, 30.f, 26.f));

	ContentBox = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("MenuContent"));
	ContentPad->SetContent(ContentBox);
	ContentScroll->AddChild(ContentPad);

	if (UVerticalBoxSlot* ScrollSlot = Column->AddChildToVerticalBox(ContentScroll))
	{
		// Fill what is left of the capped height, so the scroll bar appears only when it is needed.
		ScrollSlot->SetSize(FSlateChildSize(ESlateSizeRule::Fill));
		ScrollSlot->SetHorizontalAlignment(HAlign_Fill);
	}
}

// Runs on: the local machine. One base colour in, three states out, so every button in the game
// lights up the same way.
void UClockworksMenuScreen::StyleButton(UButton* Button, const FLinearColor& BaseColor) const
{
	if (!Button)
	{
		return;
	}
	FButtonStyle Style = Button->GetStyle();
	Style.Normal.TintColor = FSlateColor(BaseColor);
	Style.Hovered.TintColor = FSlateColor(ButtonHoverColor);
	Style.Pressed.TintColor = FSlateColor(ButtonHoverColor * 0.75f);
	Style.Disabled.TintColor = FSlateColor(BaseColor * 0.5f);
	Button->SetStyle(Style);
}

// Runs on: the local machine. Icon on the left when there is one, then a title, then an optional
// explanation under it. That second line is what makes a menu legible to someone who has not played.
UWidget* UClockworksMenuScreen::MakeButtonContent(FName Name, const FText& Label, const FText& Subtitle2, UTexture2D* Icon, float IconSize)
{
	UHorizontalBox* Row = WidgetTree->ConstructWidget<UHorizontalBox>(
		UHorizontalBox::StaticClass(), FName(*(Name.ToString() + TEXT("Row"))));

	if (Icon)
	{
		const float Size = IconSize > 0.f ? IconSize : 44.f;

		USizeBox* IconSize2 = WidgetTree->ConstructWidget<USizeBox>(
			USizeBox::StaticClass(), FName(*(Name.ToString() + TEXT("IconSize"))));
		IconSize2->SetWidthOverride(Size);
		IconSize2->SetHeightOverride(Size);

		UImage* IconImage = WidgetTree->ConstructWidget<UImage>(
			UImage::StaticClass(), FName(*(Name.ToString() + TEXT("Icon"))));
		IconImage->SetBrushFromTexture(Icon, /*bMatchSize*/ false);
		IconSize2->SetContent(IconImage);

		if (UHorizontalBoxSlot* IconSlot = Row->AddChildToHorizontalBox(IconSize2))
		{
			IconSlot->SetPadding(FMargin(0.f, 0.f, 14.f, 0.f));
			IconSlot->SetVerticalAlignment(VAlign_Center);
			IconSlot->SetSize(FSlateChildSize(ESlateSizeRule::Automatic));
		}
	}

	UVerticalBox* TextColumn = WidgetTree->ConstructWidget<UVerticalBox>(
		UVerticalBox::StaticClass(), FName(*(Name.ToString() + TEXT("Text"))));

	UTextBlock* TitleText = WidgetTree->ConstructWidget<UTextBlock>(
		UTextBlock::StaticClass(), FName(*(Name.ToString() + TEXT("Label"))));
	TitleText->SetText(Label);
	TitleText->SetColorAndOpacity(FSlateColor(TextColor));
	FSlateFontInfo Font = TitleText->GetFont();
	Font.Size = ButtonFontSize;
	TitleText->SetFont(Font);
	TitleText->SetAutoWrapText(true);
	TextColumn->AddChildToVerticalBox(TitleText);

	if (!Subtitle2.IsEmpty())
	{
		UTextBlock* SubText = WidgetTree->ConstructWidget<UTextBlock>(
			UTextBlock::StaticClass(), FName(*(Name.ToString() + TEXT("Sub"))));
		SubText->SetText(Subtitle2);
		SubText->SetColorAndOpacity(FSlateColor(MutedTextColor));
		FSlateFontInfo SubFont = SubText->GetFont();
		SubFont.Size = FMath::Max(BodyFontSize - 1, 8);
		SubText->SetFont(SubFont);
		SubText->SetAutoWrapText(true);

		if (UVerticalBoxSlot* SubSlot = TextColumn->AddChildToVerticalBox(SubText))
		{
			SubSlot->SetPadding(FMargin(0.f, 3.f, 0.f, 0.f));
		}
	}

	if (UHorizontalBoxSlot* TextSlot = Row->AddChildToHorizontalBox(TextColumn))
	{
		// Fill, so the text column knows its width and can therefore wrap. Without this the labels
		// size to their content and run straight off the edge of the panel.
		TextSlot->SetSize(FSlateChildSize(ESlateSizeRule::Fill));
		TextSlot->SetVerticalAlignment(VAlign_Center);
	}

	return Row;
}

// Runs on: the local machine.
UButton* UClockworksMenuScreen::AddMenuButton(FName Name, const FText& Label, const FText& InSubtitle)
{
	if (!ContentBox || !WidgetTree)
	{
		return nullptr;
	}

	UButton* Button = WidgetTree->ConstructWidget<UButton>(UButton::StaticClass(), Name);
	StyleButton(Button, ButtonColor);

	if (UButtonSlot* ContentSlot = Cast<UButtonSlot>(Button->AddChild(MakeButtonContent(Name, Label, InSubtitle, nullptr))))
	{
		ContentSlot->SetPadding(FMargin(18.f, 13.f));
		ContentSlot->SetHorizontalAlignment(HAlign_Fill);
		ContentSlot->SetVerticalAlignment(VAlign_Center);
	}

	if (UVerticalBoxSlot* ButtonSlot = ContentBox->AddChildToVerticalBox(Button))
	{
		ButtonSlot->SetPadding(FMargin(0.f, 4.f));
		ButtonSlot->SetHorizontalAlignment(HAlign_Fill);
	}

	return Button;
}

// Runs on: the local machine.
UTextBlock* UClockworksMenuScreen::AddSectionHeading(FName Name, const FText& Text)
{
	if (!ContentBox || !WidgetTree)
	{
		return nullptr;
	}

	UTextBlock* Heading = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), Name);
	Heading->SetText(Text);
	Heading->SetColorAndOpacity(FSlateColor(AccentColor));
	FSlateFontInfo Font = Heading->GetFont();
	Font.Size = HeadingFontSize;
	Heading->SetFont(Font);
	Heading->SetAutoWrapText(true);

	if (UVerticalBoxSlot* HeadingSlot = ContentBox->AddChildToVerticalBox(Heading))
	{
		HeadingSlot->SetPadding(FMargin(0.f, 18.f, 0.f, 4.f));
	}

	// A hairline under the heading, which is all the division a section needs.
	UBorder* Rule = WidgetTree->ConstructWidget<UBorder>(
		UBorder::StaticClass(), FName(*(Name.ToString() + TEXT("Rule"))));
	Rule->SetBrushColor(RuleColor);
	USizeBox* RuleSize = WidgetTree->ConstructWidget<USizeBox>(
		USizeBox::StaticClass(), FName(*(Name.ToString() + TEXT("RuleSize"))));
	RuleSize->SetHeightOverride(1.f);
	RuleSize->SetContent(Rule);

	if (UVerticalBoxSlot* RuleSlot = ContentBox->AddChildToVerticalBox(RuleSize))
	{
		RuleSlot->SetPadding(FMargin(0.f, 0.f, 0.f, 10.f));
		RuleSlot->SetHorizontalAlignment(HAlign_Fill);
	}

	return Heading;
}

// Runs on: the local machine.
UTextBlock* UClockworksMenuScreen::AddBodyText(FName Name, const FText& Text)
{
	if (!ContentBox || !WidgetTree)
	{
		return nullptr;
	}

	UTextBlock* Body = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), Name);
	Body->SetText(Text);
	Body->SetColorAndOpacity(FSlateColor(MutedTextColor));
	FSlateFontInfo Font = Body->GetFont();
	Font.Size = BodyFontSize;
	Body->SetFont(Font);
	Body->SetAutoWrapText(true);
	Body->SetLineHeightPercentage(1.2f);

	if (UVerticalBoxSlot* BodySlot = ContentBox->AddChildToVerticalBox(Body))
	{
		BodySlot->SetPadding(FMargin(0.f, 2.f, 0.f, 8.f));
		BodySlot->SetHorizontalAlignment(HAlign_Fill);
	}
	return Body;
}

// Runs on: the local machine. The shape a controls list wants: the key on the left, what it does on
// the right, and the right-hand side wrapping rather than pushing the row wider.
void UClockworksMenuScreen::AddDefinitionRow(FName Name, const FText& Term, const FText& Definition)
{
	if (!ContentBox || !WidgetTree)
	{
		return;
	}

	UHorizontalBox* Row = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass(), Name);

	USizeBox* TermSize = WidgetTree->ConstructWidget<USizeBox>(
		USizeBox::StaticClass(), FName(*(Name.ToString() + TEXT("TermSize"))));
	TermSize->SetWidthOverride(FMath::Min(PanelWidth * 0.32f, 190.f));

	UTextBlock* TermText = WidgetTree->ConstructWidget<UTextBlock>(
		UTextBlock::StaticClass(), FName(*(Name.ToString() + TEXT("Term"))));
	TermText->SetText(Term);
	TermText->SetColorAndOpacity(FSlateColor(TextColor));
	FSlateFontInfo TermFont = TermText->GetFont();
	TermFont.Size = BodyFontSize;
	TermText->SetFont(TermFont);
	TermText->SetAutoWrapText(true);
	TermSize->SetContent(TermText);

	if (UHorizontalBoxSlot* TermSlot = Row->AddChildToHorizontalBox(TermSize))
	{
		TermSlot->SetPadding(FMargin(0.f, 0.f, 14.f, 0.f));
		TermSlot->SetSize(FSlateChildSize(ESlateSizeRule::Automatic));
	}

	UTextBlock* DefinitionText = WidgetTree->ConstructWidget<UTextBlock>(
		UTextBlock::StaticClass(), FName(*(Name.ToString() + TEXT("Def"))));
	DefinitionText->SetText(Definition);
	DefinitionText->SetColorAndOpacity(FSlateColor(MutedTextColor));
	FSlateFontInfo DefinitionFont = DefinitionText->GetFont();
	DefinitionFont.Size = BodyFontSize;
	DefinitionText->SetFont(DefinitionFont);
	DefinitionText->SetAutoWrapText(true);
	DefinitionText->SetLineHeightPercentage(1.2f);

	if (UHorizontalBoxSlot* DefinitionSlot = Row->AddChildToHorizontalBox(DefinitionText))
	{
		DefinitionSlot->SetSize(FSlateChildSize(ESlateSizeRule::Fill));
	}

	if (UVerticalBoxSlot* RowSlot = ContentBox->AddChildToVerticalBox(Row))
	{
		RowSlot->SetPadding(FMargin(0.f, 4.f));
		RowSlot->SetHorizontalAlignment(HAlign_Fill);
	}
}

// Runs on: the local machine.
void UClockworksMenuScreen::AddSpacer(FName Name, float Height)
{
	if (!ContentBox || !WidgetTree)
	{
		return;
	}
	USpacer* Spacer = WidgetTree->ConstructWidget<USpacer>(USpacer::StaticClass(), Name);
	Spacer->SetSize(FVector2D(1.f, Height));
	ContentBox->AddChildToVerticalBox(Spacer);
}

// Runs on: the local machine. The mouse comes back, the game stops, and the menu takes focus.
void UClockworksMenuScreen::OpenMenu()
{
	if (bMenuOpen)
	{
		return;
	}
	bMenuOpen = true;

	if (!IsInViewport())
	{
		AddToViewport(100);
	}
	SetVisibility(ESlateVisibility::Visible);

	if (APlayerController* Controller = GetOwningPlayer())
	{
		// Game and UI rather than UI only: the cursor works, and the game keeps drawing behind.
		FInputModeGameAndUI InputMode;
		InputMode.SetWidgetToFocus(TakeWidget());
		InputMode.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
		Controller->SetInputMode(InputMode);
		Controller->bShowMouseCursor = true;

		if (bPausesGame && !UGameplayStatics::IsGamePaused(this))
		{
			// Force one camera update before freezing the world.
			//
			// The camera manager only picks up the pawn's own camera component when it ticks. Pause
			// in the same frame the pawn is possessed and it never gets that tick, so the view stays
			// on the fallback "out of the pawn's eyes" pose: down at floor level, and turning with
			// the cursor because that pose follows the control rotation. That is what was spinning
			// behind the start screen before this call existed.
			if (APlayerCameraManager* CameraManager = Controller->PlayerCameraManager)
			{
				CameraManager->UpdateCamera(0.f);
			}

			// Pausing the world, which is right for a single-player demo. In a two-player game this
			// will have to become a per-player menu that does not stop the other knight.
			bPausedByThisMenu = true;
			UGameplayStatics::SetGamePaused(this, true);
		}
	}
}

// Runs on: the local machine.
void UClockworksMenuScreen::CloseMenu()
{
	if (!bMenuOpen)
	{
		return;
	}
	bMenuOpen = false;

	SetVisibility(ESlateVisibility::Collapsed);

	if (APlayerController* Controller = GetOwningPlayer())
	{
		if (bPausedByThisMenu)
		{
			bPausedByThisMenu = false;
			UGameplayStatics::SetGamePaused(this, false);
		}

		// The game takes the keyboard and mouse back. The cursor stays on: this is a cursor-aimed game.
		//
		// Game and UI, not Game Only. Game Only captures the mouse permanently and spends the first press
		// on taking the capture instead of handing it to the game; with the cursor shown the capture does
		// not stick, so every single click was swallowed and only double-clicks attacked. Game and UI
		// passes each press straight through, holds the capture only while a button is down, and leaves
		// the HUD's own buttons (the wrench, the guide, the loadouts) clickable.
		FInputModeGameAndUI InputMode;
		InputMode.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
		InputMode.SetHideCursorDuringCapture(false);
		Controller->SetInputMode(InputMode);
		Controller->bShowMouseCursor = true;
	}
}

// Runs on: the local machine. 2D and unattached: a click is not a thing in the world.
void UClockworksMenuScreen::PlayClick() const
{
	if (ClickSound)
	{
		UGameplayStatics::PlaySound2D(this, ClickSound);
	}
}
