// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "ClockworksMenuScreen.generated.h"

class UBorder;
class UButton;
class UCanvasPanel;
class UHorizontalBox;
class UImage;
class UScrollBox;
class USoundBase;
class UTextBlock;
class UTexture2D;
class UVerticalBox;

/**
 * Shared furniture for every full-screen menu: the dimmed backdrop, the header, the scrolling
 * content column and the house button style, so the start screen, the pause menu, the guide and the
 * loadout all look like the same game.
 *
 * Everything wraps and everything scrolls. A menu that has to explain a weapon to someone who has
 * never played needs room for sentences, and a fixed-height column of unwrapped text is how you get
 * words running off the edge of the panel.
 *
 * Built in C++ like the rest of this project's UI, so there is no designer graph to keep in sync and
 * the layout is diffable. A WBP_ child that builds its own tree keeps it.
 *
 * Menus are local. Nothing here replicates, and nothing here decides anything: a menu sends the same
 * intent a button press would, and the server still makes every call that matters.
 */
UCLASS(Abstract)
class UClockworksMenuScreen : public UUserWidget
{
	GENERATED_BODY()

public:

	UClockworksMenuScreen(const FObjectInitializer& ObjectInitializer);

	/** Shows the menu, takes the mouse, and (optionally) pauses. */
	virtual void OpenMenu();

	/** Hides it, gives input back to the game, and unpauses if this menu paused. */
	virtual void CloseMenu();

	bool IsMenuOpen() const { return bMenuOpen; }

protected:

	virtual TSharedRef<SWidget> RebuildWidget() override;

	/** Subclasses build their contents into ContentBox here. Called once, before the first paint. */
	virtual void BuildContents() {}

	/** Lays out backdrop, header and the empty scrolling content column. */
	void BuildTree();

	// ----- content helpers, all of which append to the scrolling column -----

	/** A button in the house style. Bind its OnClicked yourself. */
	UButton* AddMenuButton(FName Name, const FText& Label, const FText& Subtitle = FText::GetEmpty());

	/** A small uppercase heading with a rule under it, for dividing a long screen into sections. */
	UTextBlock* AddSectionHeading(FName Name, const FText& Text);

	/** A paragraph. Wraps, so it never runs off the panel however long the sentence is. */
	UTextBlock* AddBodyText(FName Name, const FText& Text);

	/** A labelled line: a short bold term on the left, an explanation that wraps on the right. */
	void AddDefinitionRow(FName Name, const FText& Term, const FText& Definition);

	/** Vertical space between blocks. */
	void AddSpacer(FName Name, float Height);

	/** Plays the shared click sound. Local, 2D. */
	void PlayClick() const;

	/** Builds a styled button body: an optional icon, a title, and an optional second line. */
	UWidget* MakeButtonContent(FName Name, const FText& Label, const FText& Subtitle, UTexture2D* Icon, float IconSize = 0.f);

	/** Paints a button's three states from one base colour. */
	void StyleButton(UButton* Button, const FLinearColor& BaseColor) const;

	/** The words across the top. Set in the subclass constructor. */
	UPROPERTY(EditDefaultsOnly, Category = "Menu")
	FText Title;

	/** The line under the title. Optional. */
	UPROPERTY(EditDefaultsOnly, Category = "Menu")
	FText Subtitle;

	/** Whether opening this menu pauses the game. True for the pause menu and the start screen. */
	UPROPERTY(EditDefaultsOnly, Category = "Menu")
	bool bPausesGame = true;

	// ----- palette, shared by every screen -----

	UPROPERTY(EditDefaultsOnly, Category = "Menu|Style")
	FLinearColor BackdropColor = FLinearColor(0.015f, 0.025f, 0.05f, 0.90f);

	UPROPERTY(EditDefaultsOnly, Category = "Menu|Style")
	FLinearColor PanelColor = FLinearColor(0.035f, 0.055f, 0.105f, 0.98f);

	/** The strip behind the title. A shade lighter than the panel, so the header reads as a header. */
	UPROPERTY(EditDefaultsOnly, Category = "Menu|Style")
	FLinearColor HeaderColor = FLinearColor(0.06f, 0.10f, 0.19f, 1.f);

	UPROPERTY(EditDefaultsOnly, Category = "Menu|Style")
	FLinearColor ButtonColor = FLinearColor(0.085f, 0.135f, 0.245f, 1.f);

	UPROPERTY(EditDefaultsOnly, Category = "Menu|Style")
	FLinearColor ButtonHoverColor = FLinearColor(0.17f, 0.42f, 0.85f, 1.f);

	/** The one warm colour, for headings. The original's interface leans on gold the same way. */
	UPROPERTY(EditDefaultsOnly, Category = "Menu|Style")
	FLinearColor AccentColor = FLinearColor(0.91f, 0.71f, 0.29f, 1.f);

	UPROPERTY(EditDefaultsOnly, Category = "Menu|Style")
	FLinearColor TextColor = FLinearColor(0.86f, 0.90f, 0.96f, 1.f);

	/** Explanations and captions: present, but never competing with the thing they explain. */
	UPROPERTY(EditDefaultsOnly, Category = "Menu|Style")
	FLinearColor MutedTextColor = FLinearColor(0.55f, 0.62f, 0.74f, 1.f);

	UPROPERTY(EditDefaultsOnly, Category = "Menu|Style")
	FLinearColor RuleColor = FLinearColor(0.14f, 0.22f, 0.38f, 1.f);

	UPROPERTY(EditDefaultsOnly, Category = "Menu|Style", meta = (ClampMin = "8"))
	int32 TitleFontSize = 40;

	UPROPERTY(EditDefaultsOnly, Category = "Menu|Style", meta = (ClampMin = "6"))
	int32 HeadingFontSize = 13;

	UPROPERTY(EditDefaultsOnly, Category = "Menu|Style", meta = (ClampMin = "6"))
	int32 ButtonFontSize = 17;

	UPROPERTY(EditDefaultsOnly, Category = "Menu|Style", meta = (ClampMin = "6"))
	int32 BodyFontSize = 13;

	/** Wide enough for a sentence to breathe. The original's panels are wide and short-lined. */
	UPROPERTY(EditDefaultsOnly, Category = "Menu|Style", meta = (ClampMin = "200.0"))
	float PanelWidth = 640.f;

	/** The panel never grows past this, so a tall screen scrolls instead of running off the top. */
	UPROPERTY(EditDefaultsOnly, Category = "Menu|Style", meta = (ClampMin = "200.0"))
	float PanelMaxHeight = 760.f;

	UPROPERTY(EditDefaultsOnly, Category = "Menu|Sound")
	TObjectPtr<USoundBase> ClickSound;

	/** Where subclasses put their buttons and text. Inside the scroll box. */
	UPROPERTY()
	TObjectPtr<UVerticalBox> ContentBox;

	UPROPERTY()
	TObjectPtr<UScrollBox> ContentScroll;

private:

	UPROPERTY()
	TObjectPtr<UCanvasPanel> RootCanvas;

	UPROPERTY()
	TObjectPtr<UBorder> Backdrop;

	bool bMenuOpen = false;

	/** True only when this menu is the one that paused, so closing cannot unpause someone else's. */
	bool bPausedByThisMenu = false;
};
