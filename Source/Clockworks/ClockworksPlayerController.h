// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
//#include "Templates/SubclassOf.h"
#include "GameFramework/PlayerController.h"
#include "ClockworksPlayerController.generated.h"

class UAudioComponent;
class UClockworksGearScreen;
class UClockworksGuideScreen;
class UClockworksMainMenu;
class UClockworksNotice;
class UClockworksPauseMenu;
class UClockworksPlayerHUD;
class USoundBase;
class UInputMappingContext;

DECLARE_LOG_CATEGORY_EXTERN(LogTemplateCharacter, Log, All);

/**
 *  Player controller for a top-down perspective game.
 *  Registers the input mapping context and aims the possessed character at the
 *  mouse cursor by setting the control yaw. Movement input lives on the character.
 *  Owns the local player's HUD and menus; UI is local and never replicated.
 */
UCLASS(abstract)
class AClockworksPlayerController : public APlayerController
{
	GENERATED_BODY()

protected:

	/** MappingContext */
	UPROPERTY(EditAnywhere, Category="Input")
	TObjectPtr<UInputMappingContext> DefaultMappingContext;

	/**
	 * The whole in-game HUD: every corner of the screen, the weapon wheel and the targeting readout.
	 * Point this at a WBP_ child to restyle it.
	 */
	UPROPERTY(EditDefaultsOnly, Category="UI")
	TSubclassOf<UClockworksPlayerHUD> PlayerHUDClass;

	UPROPERTY()
	TObjectPtr<UClockworksPlayerHUD> PlayerHUD;

	/**
	 * The level's music. Local and 2D: music is a thing this player hears, not a thing in the world,
	 * so it is never replicated and each machine starts its own.
	 */
	UPROPERTY(EditDefaultsOnly, Category="Audio")
	TObjectPtr<USoundBase> MusicLoop;

	UPROPERTY(EditDefaultsOnly, Category="Audio", meta = (ClampMin = "0.0"))
	float MusicVolume = 0.35f;

	UPROPERTY(Transient)
	TObjectPtr<UAudioComponent> MusicAudio;

	/** The start screen. Shown once when the level opens; Play dismisses it. */
	UPROPERTY(EditDefaultsOnly, Category="UI")
	TSubclassOf<UClockworksMainMenu> MainMenuClass;

	UPROPERTY()
	TObjectPtr<UClockworksMainMenu> MainMenu;

	/** The line of text that says what just happened. Made on demand. */
	UPROPERTY(EditDefaultsOnly, Category = "UI")
	TSubclassOf<UClockworksNotice> NoticeClass;

	UPROPERTY(Transient)
	TObjectPtr<UClockworksNotice> Notice;

	/** Escape. */
	UPROPERTY(EditDefaultsOnly, Category="UI")
	TSubclassOf<UClockworksPauseMenu> PauseMenuClass;

	UPROPERTY()
	TObjectPtr<UClockworksPauseMenu> PauseMenu;

	/** The loadout overlay, reachable from both menus and from its own key. */
	UPROPERTY(EditDefaultsOnly, Category="UI")
	TSubclassOf<UClockworksGearScreen> GearScreenClass;

	UPROPERTY()
	TObjectPtr<UClockworksGearScreen> GearScreen;

	/** How to play, opened from either menu. */
	UPROPERTY(EditDefaultsOnly, Category="UI")
	TSubclassOf<UClockworksGuideScreen> GuideScreenClass;

	UPROPERTY()
	TObjectPtr<UClockworksGuideScreen> GuideScreen;

	/** Whether the start screen appears at all. Off makes the level open straight into play. */
	UPROPERTY(EditDefaultsOnly, Category="UI")
	bool bShowMainMenuOnStart = true;

	/** Opens the start screen, a moment after BeginPlay so the camera has settled first. */
	void ShowMainMenu();

	/** Escape: opens the pause menu, or backs out of whichever menu is open. */
	void ToggleGameMenu();

public:

	/** Constructor */
	AClockworksPlayerController();

	/** The loadout key and the HUD's loadout button: opens the gear overlay straight from play. */
	void ToggleGearScreen();

	/** The HUD's wrench button: the pause menu, unless another menu is already up. */
	void OpenPauseMenu();

	/** F1 and the HUD's help button: how to play, straight from play. */
	void OpenGuideScreen();

	/** True while any of the menus is up, so one key cannot open two. */
	bool IsAnyMenuOpen() const;

	/**
	 * Shuts every menu that is up and gives the game the input back. The start screen is up when a run begins, so a
	 * headless test run needs a way past it; `Clockworks.CloseMenus` is that way. Local only, like the menus.
	 */
	void CloseAllMenus();

	/**
	 * Says something across the bottom of the screen for a moment.
	 *
	 * The user's rule: every button does its job, and one whose job is not built yet says so rather than doing
	 * nothing. A click that is silently ignored cannot be told apart from a broken one.
	 */
	UFUNCTION(BlueprintCallable, Category = "UI")
	void ShowNotice(const FText& Message);

	/** "The Forge is not built yet." */
	UFUNCTION(BlueprintCallable, Category = "UI")
	void ShowNotBuiltYet(const FText& What);

protected:

	/** Creates the local HUD and starts the music. Owning client only. */
	virtual void BeginPlay() override;

	/** Stops the music so it cannot outlive the level. */
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

	/** Initialize input bindings */
	virtual void SetupInputComponent() override;

	/** Per-frame local player update. Owning client only. */
	virtual void PlayerTick(float DeltaTime) override;

	/** Points the control yaw at the mouse cursor projected onto the floor plane. Owning client only. */
	void UpdateAimFromCursor();

	/**
	 * Measures the real view frustum (window shape, FOV rules) and tells the server, so enemy aggro
	 * can test "is it on my screen" against what this player actually sees. Owning client only.
	 */
	void ReportViewExtents();

	/** Intent from the owning client: the tangents of its half view angles. Server stores them. */
	UFUNCTION(Server, Unreliable)
	void ServerSetViewExtents(float TanHalfX, float TanHalfY);

public:

	/** Server: the owning client's view half-angle tangents, or false until the client has reported. */
	bool GetViewExtents(float& OutTanHalfX, float& OutTanHalfY) const;

private:

	/** Set by ServerSetViewExtents; also set directly on a listen host. */
	float ViewTanHalfX = 0.f;
	float ViewTanHalfY = 0.f;

	/** Last values sent, so the client only talks when the window changes. */
	float SentTanHalfX = 0.f;
	float SentTanHalfY = 0.f;
	float ViewReportCooldown = 0.f;
};
