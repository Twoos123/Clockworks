// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksPauseMenu.h"
#include "ClockworksGearScreen.h"
#include "ClockworksGuideScreen.h"
#include "Components/Button.h"
#include "Kismet/GameplayStatics.h"
#include "Kismet/KismetSystemLibrary.h"

// Runs on: the local machine only.
UClockworksPauseMenu::UClockworksPauseMenu(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	Title = NSLOCTEXT("Clockworks", "PauseMenuTitle", "PAUSED");
	Subtitle = NSLOCTEXT("Clockworks", "PauseMenuSubtitle", "The world is stopped. Escape puts you back in it.");
	bPausesGame = true;
}

// Runs on: the local machine.
void UClockworksPauseMenu::BuildContents()
{
	if (UButton* Resume = AddMenuButton(TEXT("ResumeButton"),
		NSLOCTEXT("Clockworks", "MenuResume", "Resume"),
		NSLOCTEXT("Clockworks", "MenuResumeSub", "Back to the fight.")))
	{
		Resume->OnClicked.AddDynamic(this, &UClockworksPauseMenu::OnResumeClicked);
	}
	if (UButton* Loadout = AddMenuButton(TEXT("PauseLoadoutButton"),
		NSLOCTEXT("Clockworks", "MenuLoadout", "Loadout"),
		NSLOCTEXT("Clockworks", "MenuLoadoutSub2", "Change what you are carrying. L opens this straight from play.")))
	{
		Loadout->OnClicked.AddDynamic(this, &UClockworksPauseMenu::OnLoadoutClicked);
	}
	if (UButton* Guide = AddMenuButton(TEXT("PauseGuideButton"),
		NSLOCTEXT("Clockworks", "MenuGuide", "How to Play"),
		NSLOCTEXT("Clockworks", "MenuGuideSub2", "Controls, weapon classes, damage types and statuses.")))
	{
		Guide->OnClicked.AddDynamic(this, &UClockworksPauseMenu::OnGuideClicked);
	}
	if (UButton* Quit = AddMenuButton(TEXT("PauseQuitButton"),
		NSLOCTEXT("Clockworks", "MenuQuit", "Quit"),
		NSLOCTEXT("Clockworks", "MenuQuitSub2", "Close the game.")))
	{
		Quit->OnClicked.AddDynamic(this, &UClockworksPauseMenu::OnQuitClicked);
	}
}

// Runs on: the local machine.
void UClockworksPauseMenu::OnResumeClicked()
{
	PlayClick();
	CloseMenu();
}

// Runs on: the local machine.
void UClockworksPauseMenu::OnLoadoutClicked()
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
void UClockworksPauseMenu::OnGuideClicked()
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
void UClockworksPauseMenu::OnQuitClicked()
{
	PlayClick();
	UGameplayStatics::SetGamePaused(this, false);
	if (APlayerController* Controller = GetOwningPlayer())
	{
		UKismetSystemLibrary::QuitGame(this, Controller, EQuitPreference::Quit, /*bIgnorePlatformRestrictions*/ false);
	}
}
