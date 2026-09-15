// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksMainMenu.h"
#include "ClockworksGearScreen.h"
#include "ClockworksGuideScreen.h"
#include "Components/Button.h"
#include "Kismet/GameplayStatics.h"
#include "Kismet/KismetSystemLibrary.h"

#define LOCTEXT_NAMESPACE "Clockworks"

// Runs on: the local machine only.
UClockworksMainMenu::UClockworksMainMenu(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	Title = LOCTEXT("MainMenuTitle", "CLOCKWORKS");
	Subtitle = LOCTEXT("MainMenuSubtitle",
		"An isometric co-op dungeon crawler, after Spiral Knights. "
		"Descend into the machinery under the world and see how far you get.");
	bPausesGame = true;
}

// Runs on: the local machine.
void UClockworksMainMenu::BuildContents()
{
	// Each button says what it is for. A stranger should never have to click something to find out
	// whether it is the thing they wanted.
	if (UButton* Play = AddMenuButton(TEXT("PlayButton"),
		LOCTEXT("MenuPlay", "Play"),
		LOCTEXT("MenuPlaySub", "Drop into the arena with the loadout you are carrying.")))
	{
		Play->OnClicked.AddDynamic(this, &UClockworksMainMenu::OnPlayClicked);
	}

	if (UButton* Loadout = AddMenuButton(TEXT("LoadoutButton"),
		LOCTEXT("MenuLoadout", "Loadout"),
		LOCTEXT("MenuLoadoutSub", "Choose the three weapons on your toolbar. A sword, a gun and a bomb is the usual mix.")))
	{
		Loadout->OnClicked.AddDynamic(this, &UClockworksMainMenu::OnLoadoutClicked);
	}

	if (UButton* Guide = AddMenuButton(TEXT("GuideButton"),
		LOCTEXT("MenuGuide", "How to Play"),
		LOCTEXT("MenuGuideSub", "Controls, the three weapon classes, the shield, and why some weapons work better on some monsters.")))
	{
		Guide->OnClicked.AddDynamic(this, &UClockworksMainMenu::OnGuideClicked);
	}

	if (UButton* Quit = AddMenuButton(TEXT("QuitButton"),
		LOCTEXT("MenuQuit", "Quit"),
		LOCTEXT("MenuQuitSub", "Close the game.")))
	{
		Quit->OnClicked.AddDynamic(this, &UClockworksMainMenu::OnQuitClicked);
	}

	// The short version, for someone who is going to press Play without reading anything else.
	AddSectionHeading(TEXT("QuickStartHeading"), LOCTEXT("QuickStart", "IF YOU READ NOTHING ELSE"));
	AddDefinitionRow(TEXT("RowMove"), LOCTEXT("KeyMove", "W A S D"),
		LOCTEXT("KeyMoveDef", "Move. You always face the mouse cursor, whichever way you are walking."));
	AddDefinitionRow(TEXT("RowAttack"), LOCTEXT("KeyAttack", "Left mouse"),
		LOCTEXT("KeyAttackDef", "Attack. Hold it instead of tapping to charge a much stronger one."));
	AddDefinitionRow(TEXT("RowShield"), LOCTEXT("KeyShield", "Right mouse"),
		LOCTEXT("KeyShieldDef", "Raise your shield. It absorbs whole hits until it shatters."));
	AddDefinitionRow(TEXT("RowSwitch"), LOCTEXT("KeySwitch", "Space / wheel"),
		LOCTEXT("KeySwitchDef", "Draw the next weapon on your toolbar."));
	AddDefinitionRow(TEXT("RowMenus"), LOCTEXT("KeyMenus", "Esc / L"),
		LOCTEXT("KeyMenusDef", "Pause, and open your loadout, at any time during play."));

	AddSpacer(TEXT("FooterSpace"), 10.f);
	AddBodyText(TEXT("Attribution"), LOCTEXT("MainMenuAttribution",
		"Art, animation and audio are Spiral Knights assets standing in as placeholders. "
		"Spiral Knights is the property of Grey Havens and SEGA; nothing here ships with them."));
}

// Runs on: the local machine.
void UClockworksMainMenu::OnPlayClicked()
{
	PlayClick();
	CloseMenu();
}

// Runs on: the local machine. The other screen sits on top; closing it comes back here.
void UClockworksMainMenu::OnLoadoutClicked()
{
	PlayClick();
	if (UClockworksGearScreen* Screen = GearScreen.Get())
	{
		Screen->SetReturnMenu(this);
		Screen->OpenMenu();
		SetVisibility(ESlateVisibility::Collapsed);
	}
}

// Runs on: the local machine.
void UClockworksMainMenu::OnGuideClicked()
{
	PlayClick();
	if (UClockworksGuideScreen* Screen = GuideScreen.Get())
	{
		Screen->SetReturnMenu(this);
		Screen->OpenMenu();
		SetVisibility(ESlateVisibility::Collapsed);
	}
}

// Runs on: the local machine.
void UClockworksMainMenu::OnQuitClicked()
{
	PlayClick();
	UGameplayStatics::SetGamePaused(this, false);
	if (APlayerController* Controller = GetOwningPlayer())
	{
		UKismetSystemLibrary::QuitGame(this, Controller, EQuitPreference::Quit, /*bIgnorePlatformRestrictions*/ false);
	}
}

#undef LOCTEXT_NAMESPACE
