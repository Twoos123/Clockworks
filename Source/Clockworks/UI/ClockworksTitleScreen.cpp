// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksTitleScreen.h"

#include "ClockworksHUDArt.h"
#include "ClockworksPlayerController.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Button.h"
#include "Components/CanvasPanel.h"
#include "Components/CanvasPanelSlot.h"
#include "Components/Image.h"
#include "Components/TextBlock.h"
#include "Engine/Texture2D.h"
#include "Kismet/GameplayStatics.h"
#include "Kismet/KismetSystemLibrary.h"

#define LOCTEXT_NAMESPACE "Clockworks"

namespace
{
	/** One of the title screen's textures, or null if the art has not been imported. */
	UTexture2D* LoadArt(const FString& Folder, const TCHAR* Name)
	{
		return LoadObject<UTexture2D>(nullptr, *(Folder + Name));
	}
}

UClockworksTitleScreen::UClockworksTitleScreen(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	Title = FText::GetEmpty();
	bPausesGame = true;
}

// Runs on: the local machine only. Interface is never replicated.
TSharedRef<SWidget> UClockworksTitleScreen::RebuildWidget()
{
	if (!WidgetTree->RootWidget)
	{
		UCanvasPanel* Canvas = WidgetTree->ConstructWidget<UCanvasPanel>(UCanvasPanel::StaticClass(), TEXT("TitleCanvas"));
		WidgetTree->RootWidget = Canvas;

		// The sky, back to front. The original composites these additively; Slate alpha-blends, so a starfield laid
		// over the sky at any real opacity brings its own black with it and drowns the blue. They are therefore kept
		// faint, and the blue is carried by the sky layer and a wash behind the planet instead.
		AddFullScreenLayer(Canvas, TEXT("SkyWash"), LoadArt(ArtPath, TEXT("T_Logon_Sky")), FLinearColor(0.22f, 0.55f, 0.95f, 1.f));
		AddFullScreenLayer(Canvas, TEXT("Stars"), LoadArt(ArtPath, TEXT("T_Logon_Stars")), FLinearColor(1.f, 1.f, 1.f, 0.16f));

		// The glow the planet sits in, which is most of what makes the original's screen read as blue.
		AddPiece(Canvas, TEXT("Glow"), LoadArt(ArtPath, TEXT("T_Logon_Moon")),
			FVector2D(0.5f, 0.5f), FVector2D(0.f, -60.f), FVector2D(1500.f, 1500.f),
			FLinearColor(0.35f, 0.75f, 1.f, 0.30f));

		// Cradle itself, a little above centre, with its gold arm over it and a moon off to the right.
		AddPiece(Canvas, TEXT("Cradle"), LoadArt(ArtPath, TEXT("T_Logon_Cradle")),
			FVector2D(0.5f, 0.5f), FVector2D(0.f, -60.f), FVector2D(620.f, 620.f));
		AddPiece(Canvas, TEXT("Arm"), LoadArt(ArtPath, TEXT("T_Logon_Arm")),
			FVector2D(0.5f, 0.5f), FVector2D(40.f, -40.f), FVector2D(700.f, 700.f));
		AddPiece(Canvas, TEXT("Moon"), LoadArt(ArtPath, TEXT("T_Logon_Moon")),
			FVector2D(0.5f, 0.5f), FVector2D(430.f, -150.f), FVector2D(130.f, 130.f));
		AddPiece(Canvas, TEXT("Clouds"), LoadArt(ArtPath, TEXT("T_Logon_Clouds")),
			FVector2D(0.5f, 0.5f), FVector2D(-330.f, 30.f), FVector2D(420.f, 420.f),
			FLinearColor(1.f, 1.f, 1.f, 0.75f));

		BuildForeground(Canvas);

		// The Grey Havens mark at the foot, where the original puts it.
		if (UImage* Footer = bShowFooter ? AddPiece(Canvas, TEXT("Footer"), LoadArt(ArtPath, TEXT("T_Logon_Footer")),
			FVector2D(0.5f, 1.f), FVector2D(0.f, -50.f), FVector2D(195.f, 80.f)) : nullptr)
		{
			if (UCanvasPanelSlot* FooterSlot = Cast<UCanvasPanelSlot>(Footer->Slot))
			{
				FooterSlot->SetAlignment(FVector2D(0.5f, 1.f));
			}
		}

		// The vignette goes over everything.
		AddFullScreenLayer(Canvas, TEXT("Border"), LoadArt(ArtPath, TEXT("T_Logon_Border")), FLinearColor::White);
	}

	return UUserWidget::RebuildWidget();
}

// Runs on: the local machine only.
void UClockworksTitleScreen::BuildForeground(UCanvasPanel* Canvas)
{
	// The logo sits across the planet's middle.
	AddPiece(Canvas, TEXT("Logo"), LoadArt(ArtPath, TEXT("T_Logon_Logo")),
		FVector2D(0.5f, 0.5f), FVector2D(0.f, -75.f), FVector2D(393.f, 145.f));

	// Logon wide across the top, Quit and Options side by side beneath it, as the original has them.
	if (UButton* Logon = AddTitleButton(Canvas, TEXT("LogonButton"), LOCTEXT("TitleLogon", "Logon"),
		FVector2D(0.f, 105.f), FVector2D(366.f, 34.f), /*bPrimary*/ true))
	{
		Logon->OnClicked.AddDynamic(this, &UClockworksTitleScreen::OnLogonClicked);
	}
	if (UButton* Quit = AddTitleButton(Canvas, TEXT("QuitButton"), LOCTEXT("TitleQuit", "Quit"),
		FVector2D(-93.f, 146.f), FVector2D(178.f, 30.f), /*bPrimary*/ false))
	{
		Quit->OnClicked.AddDynamic(this, &UClockworksTitleScreen::OnQuitClicked);
	}
	if (UButton* Options = AddTitleButton(Canvas, TEXT("OptionsButton"), LOCTEXT("TitleOptions", "Options"),
		FVector2D(93.f, 146.f), FVector2D(178.f, 30.f), /*bPrimary*/ false))
	{
		Options->OnClicked.AddDynamic(this, &UClockworksTitleScreen::OnOptionsClicked);
	}

	// The line the original puts under the buttons, minus the part that points at a service.
	UTextBlock* Note = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), TEXT("TitleNote"));
	Note->SetText(LOCTEXT("TitleNote",
		"An unofficial rebuild. Spiral Knights is the property of Grey Havens and SEGA."));
	Note->SetFont(ClockworksHUDArt::Font(13));
	Note->SetColorAndOpacity(FSlateColor(FLinearColor(0.72f, 0.80f, 0.92f, 0.85f)));
	Note->SetJustification(ETextJustify::Center);
	if (UCanvasPanelSlot* NoteSlot = Canvas->AddChildToCanvas(Note))
	{
		NoteSlot->SetAnchors(FAnchors(0.5f, 0.5f, 0.5f, 0.5f));
		NoteSlot->SetAlignment(FVector2D(0.5f, 0.f));
		NoteSlot->SetPosition(FVector2D(0.f, 190.f));
		NoteSlot->SetAutoSize(true);
	}

}

UImage* UClockworksTitleScreen::AddFullScreenLayer(UCanvasPanel* Canvas, FName Name, UTexture2D* Texture, const FLinearColor& Tint)
{
	if (!Canvas || !Texture)
	{
		return nullptr;
	}

	UImage* Layer = WidgetTree->ConstructWidget<UImage>(UImage::StaticClass(), Name);
	Layer->SetBrushFromTexture(Texture, /*bMatchSize*/ false);
	Layer->SetColorAndOpacity(Tint);
	if (UCanvasPanelSlot* Placed = Canvas->AddChildToCanvas(Layer))
	{
		// Anchored to all four corners, so it fills whatever shape the window is.
		Placed->SetAnchors(FAnchors(0.f, 0.f, 1.f, 1.f));
		Placed->SetOffsets(FMargin(0.f));
	}
	return Layer;
}

UImage* UClockworksTitleScreen::AddPiece(UCanvasPanel* Canvas, FName Name, UTexture2D* Texture,
	const FVector2D& Anchor, const FVector2D& Offset, const FVector2D& Size, const FLinearColor& Tint)
{
	if (!Canvas || !Texture)
	{
		return nullptr;
	}

	UImage* Piece = WidgetTree->ConstructWidget<UImage>(UImage::StaticClass(), Name);
	Piece->SetBrushFromTexture(Texture, /*bMatchSize*/ false);
	Piece->SetColorAndOpacity(Tint);
	if (UCanvasPanelSlot* Placed = Canvas->AddChildToCanvas(Piece))
	{
		Placed->SetAnchors(FAnchors(Anchor.X, Anchor.Y, Anchor.X, Anchor.Y));
		Placed->SetAlignment(FVector2D(0.5f, 0.5f));
		Placed->SetPosition(Offset);
		Placed->SetSize(Size);
	}
	return Piece;
}

UButton* UClockworksTitleScreen::AddTitleButton(UCanvasPanel* Canvas, FName Name, const FText& Label,
	const FVector2D& Offset, const FVector2D& Size, bool bPrimary)
{
	if (!Canvas)
	{
		return nullptr;
	}

	UButton* Button = WidgetTree->ConstructWidget<UButton>(UButton::StaticClass(), Name);
	StyleButton(Button, bPrimary ? FLinearColor(0.82f, 0.86f, 0.92f, 1.f) : ButtonColor);

	UTextBlock* Text = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), *(Name.ToString() + TEXT("Text")));
	Text->SetText(Label);
	Text->SetFont(ClockworksHUDArt::Font(16));
	// The original's primary button is pale with dark lettering; the other two are blue with light.
	Text->SetColorAndOpacity(FSlateColor(bPrimary ? FLinearColor(0.06f, 0.10f, 0.19f, 1.f) : TextColor));
	Text->SetJustification(ETextJustify::Center);
	Button->AddChild(Text);

	if (UCanvasPanelSlot* Placed = Canvas->AddChildToCanvas(Button))
	{
		Placed->SetAnchors(FAnchors(0.5f, 0.5f, 0.5f, 0.5f));
		Placed->SetAlignment(FVector2D(0.5f, 0.f));
		Placed->SetPosition(Offset);
		Placed->SetSize(Size);
	}
	return Button;
}

// Runs on: the local machine only.
void UClockworksTitleScreen::OnLogonClicked()
{
	PlayClick();
	CloseMenu();

	// The original goes from here to the knights on the account; offline, that is the knights on this machine.
	if (AClockworksPlayerController* Controller = Cast<AClockworksPlayerController>(GetOwningPlayer()))
	{
		Controller->ShowCharacterSelect();
	}
}

// Runs on: the local machine only.
void UClockworksTitleScreen::OnOptionsClicked()
{
	PlayClick();
	if (AClockworksPlayerController* Controller = Cast<AClockworksPlayerController>(GetOwningPlayer()))
	{
		Controller->ShowNotBuiltYet(LOCTEXT("TitleOptionsName", "Options"));
	}
}

// Runs on: the local machine only.
void UClockworksTitleScreen::OnQuitClicked()
{
	PlayClick();
	UKismetSystemLibrary::QuitGame(this, GetOwningPlayer(), EQuitPreference::Quit, /*bIgnorePlatformRestrictions*/ false);
}

#undef LOCTEXT_NAMESPACE
