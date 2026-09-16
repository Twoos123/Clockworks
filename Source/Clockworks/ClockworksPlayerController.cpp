// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksPlayerController.h"
#include "UI/ClockworksNotice.h"
#include "UI/ClockworksCharacterSelect.h"
#include "UI/ClockworksTitleScreen.h"
#include "ClockworksGameplayTags.h"
#include "ClockworksGearScreen.h"
#include "ClockworksGuideScreen.h"
#include "ClockworksMainMenu.h"
#include "ClockworksPauseMenu.h"
#include "ClockworksPlayerHUD.h"
#include "Debug/ClockworksInputLog.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/Character.h"
#include "Components/CapsuleComponent.h"
#include "ClockworksCharacter.h"
#include "Engine/World.h"
#include "EnhancedInputSubsystems.h"
#include "InputCoreTypes.h"
#include "Components/InputComponent.h"
#include "Engine/LocalPlayer.h"
#include "Engine/GameViewportClient.h"
#include "SceneView.h"
#include "AbilitySystemComponent.h"
#include "AbilitySystemInterface.h"
#include "Blueprint/UserWidget.h"
#include "Components/AudioComponent.h"
#include "Kismet/GameplayStatics.h"
#include "Sound/SoundBase.h"
#include "Clockworks.h"

// Runs on: all machines (class default object and every spawned instance).
AClockworksPlayerController::AClockworksPlayerController()
{
	// configure the controller
	bShowMouseCursor = true;
	DefaultMouseCursor = EMouseCursor::Default;

	// The C++ widgets work without any asset; BP_ClockworksController may point at WBP_ children.
	PlayerHUDClass = UClockworksPlayerHUD::StaticClass();
	MainMenuClass = UClockworksMainMenu::StaticClass();
	TitleScreenClass = UClockworksTitleScreen::StaticClass();
	CharacterSelectClass = UClockworksCharacterSelect::StaticClass();
	PauseMenuClass = UClockworksPauseMenu::StaticClass();
	GearScreenClass = UClockworksGearScreen::StaticClass();
	GuideScreenClass = UClockworksGuideScreen::StaticClass();

	// Escape has to reach the controller while the game is stopped, or the pause menu is a trap.
	// Tickable, but deliberately NOT a full tick: the menu key bindings carry bExecuteWhenPaused,
	// which is all that input needs.
	//
	// A full tick while paused is actively wrong here. It runs PlayerTick, which aims the knight at
	// the mouse cursor, and a paused camera manager then falls back to looking out of the pawn's
	// eyes along that rotation. The result was a menu with the arena spinning behind it at floor
	// level instead of the isometric view.
	SetTickableWhenPaused(true);
}

// Runs on: all machines, but only a local player controller (the owning client, or the listen host
// for its own player) builds UI. The server's copy of a remote player's controller has no screen.
void AClockworksPlayerController::BeginPlay()
{
	Super::BeginPlay();

	if (!IsLocalPlayerController())
	{
		return;
	}

	// Every key and click this player makes, and what the game did with it (Clockworks.LogInput).
	ClockworksInputLog::StartListening();

	if (PlayerHUDClass && !PlayerHUD)
	{
		PlayerHUD = CreateWidget<UClockworksPlayerHUD>(this, PlayerHUDClass);
		if (PlayerHUD)
		{
			PlayerHUD->AddToViewport();
		}
	}

	// 2D and looping: the music has no place in the world, so it does not fade with distance and
	// the listen host and the client each play their own copy.
	if (MusicLoop && !MusicAudio)
	{
		MusicAudio = UGameplayStatics::SpawnSound2D(this, MusicLoop, MusicVolume, 1.f, 0.f, nullptr, /*bPersistAcrossLevelTransition*/ false, /*bAutoDestroy*/ false);
	}

	// The three menus are made up front and kept, hidden, rather than built on demand: the gear
	// screen scans the asset registry to fill its catalogue, and doing that the first time Escape
	// is pressed would hitch.
	if (GearScreenClass && !GearScreen)
	{
		GearScreen = CreateWidget<UClockworksGearScreen>(this, GearScreenClass);
		if (GearScreen)
		{
			GearScreen->AddToViewport(100);
			GearScreen->SetVisibility(ESlateVisibility::Collapsed);
		}
	}
	if (GuideScreenClass && !GuideScreen)
	{
		GuideScreen = CreateWidget<UClockworksGuideScreen>(this, GuideScreenClass);
		if (GuideScreen)
		{
			GuideScreen->AddToViewport(100);
			GuideScreen->SetVisibility(ESlateVisibility::Collapsed);
		}
	}
	if (PauseMenuClass && !PauseMenu)
	{
		PauseMenu = CreateWidget<UClockworksPauseMenu>(this, PauseMenuClass);
		if (PauseMenu)
		{
			PauseMenu->SetGearScreen(GearScreen);
			PauseMenu->SetGuideScreen(GuideScreen);
			PauseMenu->AddToViewport(100);
			PauseMenu->SetVisibility(ESlateVisibility::Collapsed);
		}
	}
	if (MainMenuClass && !MainMenu)
	{
		MainMenu = CreateWidget<UClockworksMainMenu>(this, MainMenuClass);
		if (MainMenu)
		{
			MainMenu->SetGearScreen(GearScreen);
			MainMenu->SetGuideScreen(GuideScreen);
			MainMenu->AddToViewport(100);
			MainMenu->SetVisibility(ESlateVisibility::Collapsed);

			// Not in this frame. BeginPlay can run before the pawn is possessed and before the
			// camera has been evaluated once, and a menu that pauses in that frame freezes the view
			// at the pawn's eye level instead of on the isometric boom.
			if (bShowMainMenuOnStart)
			{
				FTimerHandle OpenTimer;
				GetWorldTimerManager().SetTimer(OpenTimer, this, &AClockworksPlayerController::ShowMainMenu, 0.2f, false);
			}
		}
	}
}

// Runs on: the local machine only. Deferred out of BeginPlay; see the comment there.
void AClockworksPlayerController::ShowMainMenu()
{
	if (IsAnyMenuOpen())
	{
		return;
	}

	// The title screen is what the game opens on, the way the original does. The main menu is still what Escape
	// reaches once you are playing.
	if (!TitleScreen && TitleScreenClass)
	{
		TitleScreen = CreateWidget<UClockworksTitleScreen>(this, TitleScreenClass);
	}
	if (TitleScreen)
	{
		TitleScreen->OpenMenu();
		return;
	}

	if (MainMenu)
	{
		MainMenu->OpenMenu();
	}
}

// Runs on: the local machine only.
bool AClockworksPlayerController::IsAnyMenuOpen() const
{
	return (TitleScreen && TitleScreen->IsMenuOpen())
		|| (CharacterSelect && CharacterSelect->IsMenuOpen())
		|| (MainMenu && MainMenu->IsMenuOpen())
		|| (PauseMenu && PauseMenu->IsMenuOpen())
		|| (GuideScreen && GuideScreen->IsMenuOpen())
		|| (GearScreen && GearScreen->IsMenuOpen());
}

// Runs on: the local machine only.
void AClockworksPlayerController::ShowCharacterSelect()
{
	if (!CharacterSelect && CharacterSelectClass)
	{
		CharacterSelect = CreateWidget<UClockworksCharacterSelect>(this, CharacterSelectClass);
	}
	if (CharacterSelect)
	{
		CharacterSelect->OpenMenu();
	}
}

// Runs on: the local machine only. Interface is never replicated.
void AClockworksPlayerController::ShowNotice(const FText& Message)
{
	if (!IsLocalController())
	{
		return;
	}

	if (!Notice)
	{
		TSubclassOf<UClockworksNotice> Class = NoticeClass;
		if (!Class)
		{
			Class = UClockworksNotice::StaticClass();
		}
		Notice = CreateWidget<UClockworksNotice>(this, Class);
		if (Notice)
		{
			// Above the HUD, so it is readable over anything.
			Notice->AddToPlayerScreen(500);
		}
	}

	if (Notice)
	{
		Notice->Show(Message);
	}
}

// Runs on: the local machine only.
void AClockworksPlayerController::ShowNotBuiltYet(const FText& What)
{
	ShowNotice(FText::Format(NSLOCTEXT("Clockworks", "NotBuiltYetLine", "{0} is not built yet."), What));
}

// Runs on: the local machine only.
void AClockworksPlayerController::CloseAllMenus()
{
	if (CharacterSelect && CharacterSelect->IsMenuOpen()) { CharacterSelect->CloseMenu(); }
	if (TitleScreen && TitleScreen->IsMenuOpen()) { TitleScreen->CloseMenu(); }
	if (GearScreen && GearScreen->IsMenuOpen())   { GearScreen->CloseMenu(); }
	if (GuideScreen && GuideScreen->IsMenuOpen()) { GuideScreen->CloseMenu(); }
	if (PauseMenu && PauseMenu->IsMenuOpen())     { PauseMenu->CloseMenu(); }
	if (MainMenu && MainMenu->IsMenuOpen())       { MainMenu->CloseMenu(); }
}

// Runs on: the local machine only. Escape means "back": out of the gear screen to whatever opened
// it, out of a menu into the game, and out of the game into the pause menu.
void AClockworksPlayerController::ToggleGameMenu()
{
	ClockworksInputLog::Write(TEXT("[menu] Escape: back / pause menu"), FColor::Silver);
	if (GearScreen && GearScreen->IsMenuOpen())
	{
		GearScreen->CloseMenu();
		if (MainMenu && MainMenu->GetVisibility() == ESlateVisibility::Collapsed
			&& PauseMenu && PauseMenu->GetVisibility() == ESlateVisibility::Collapsed)
		{
			// Opened straight from play, so Escape goes back to play.
			return;
		}
		return;
	}
	if (GuideScreen && GuideScreen->IsMenuOpen())
	{
		GuideScreen->CloseMenu();
		return;
	}
	if (MainMenu && MainMenu->IsMenuOpen())
	{
		MainMenu->CloseMenu();
		return;
	}
	if (PauseMenu && PauseMenu->IsMenuOpen())
	{
		PauseMenu->CloseMenu();
		return;
	}
	if (PauseMenu)
	{
		PauseMenu->OpenMenu();
	}
}

// Runs on: the local machine only. The loadout key, straight from play.
void AClockworksPlayerController::ToggleGearScreen()
{
	ClockworksInputLog::Write(TEXT("[menu] loadout screen"), FColor::Silver);
	if (!GearScreen)
	{
		return;
	}
	if (GearScreen->IsMenuOpen())
	{
		GearScreen->CloseMenu();
		return;
	}
	if (IsAnyMenuOpen())
	{
		return;
	}
	GearScreen->SetReturnMenu(nullptr);
	GearScreen->OpenMenu();
}

// Runs on: the local machine only. The HUD's wrench button: the pause menu, as Escape opens it.
void AClockworksPlayerController::OpenPauseMenu()
{
	ClockworksInputLog::Write(TEXT("[menu] wrench button: pause menu"), FColor::Silver);
	if (PauseMenu && !IsAnyMenuOpen())
	{
		PauseMenu->OpenMenu();
	}
}

// Runs on: the local machine only. F1 and the HUD's help button: How to Play, straight from play,
// closing back to play.
void AClockworksPlayerController::OpenGuideScreen()
{
	ClockworksInputLog::Write(TEXT("[menu] how to play"), FColor::Silver);
	if (!GuideScreen || IsAnyMenuOpen())
	{
		return;
	}
	GuideScreen->SetReturnMenu(nullptr);
	GuideScreen->OpenMenu();
}

// Runs on: the local machine. Without this the music component outlives the level and a second copy
// starts on the next one.
void AClockworksPlayerController::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (MusicAudio)
	{
		MusicAudio->Stop();
		MusicAudio = nullptr;
	}
	if (IsLocalPlayerController())
	{
		ClockworksInputLog::StopListening();
	}
	Super::EndPlay(EndPlayReason);
}

// Runs on: owning client only (guarded by IsLocalPlayerController). The server's copy of a
// remote player's controller has no local player and does nothing here.
void AClockworksPlayerController::SetupInputComponent()
{
	// set up gameplay key bindings
	Super::SetupInputComponent();

	// Only set up input on local player controllers
	if (IsLocalPlayerController())
	{
		// Add Input Mapping Context. Action bindings live on AClockworksCharacter.
		if (UEnhancedInputLocalPlayerSubsystem* Subsystem = ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(GetLocalPlayer()))
		{
			Subsystem->AddMappingContext(DefaultMappingContext, 0);
		}

		// Bound as plain keys rather than Enhanced Input actions on purpose: menu keys have to work
		// while the game is paused and while the mapping context is not driving the pawn, and the
		// engine's own input stack handles that without any extra assets to keep in sync.
		if (InputComponent)
		{
			InputComponent->BindKey(EKeys::Escape, IE_Pressed, this, &AClockworksPlayerController::ToggleGameMenu)
				.bExecuteWhenPaused = true;
			InputComponent->BindKey(EKeys::L, IE_Pressed, this, &AClockworksPlayerController::ToggleGearScreen)
				.bExecuteWhenPaused = true;
			// F1 is help in the original, and the HUD's help button carries the badge for it.
			InputComponent->BindKey(EKeys::F1, IE_Pressed, this, &AClockworksPlayerController::OpenGuideScreen);
		}
	}
}

// Runs on: owning client only. The engine calls PlayerTick only on controllers that own a
// PlayerInput, i.e. the local player's controller (the listen-server host included). The
// server's copy of a remote player's controller never runs this; it gets that player's control
// rotation from the CharacterMovementComponent's move packet instead.
void AClockworksPlayerController::PlayerTick(float DeltaTime)
{
	// Nothing aims while a menu has stopped the world. Belt and braces alongside not taking a full
	// tick when paused: aiming a paused knight moves the camera and nothing else.
	if (UWorld* World = GetWorld(); World && World->IsPaused())
	{
		Super::PlayerTick(DeltaTime);
		return;
	}

	// Aim before Super so this frame's UpdateRotation faces the pawn and the movement
	// component records the new yaw in the move it sends to the server.
	UpdateAimFromCursor();
	ReportViewExtents();

	Super::PlayerTick(DeltaTime);
}

// Runs on: owning client only (called from PlayerTick). Sets control rotation only. The
// character faces it via bUseControllerRotationYaw, and the engine replicates the result:
// control rotation travels in the move packet, the server re-applies it to its own copy, and
// the resulting actor rotation reaches other clients through ReplicatedMovement. Nothing here
// is authoritative and the cursor position never leaves this machine.
void AClockworksPlayerController::UpdateAimFromCursor()
{
	ACharacter* ControlledCharacter = Cast<ACharacter>(GetPawn());
	if (!ControlledCharacter)
	{
		return;
	}

	// A committed swing keeps the facing it started with. The frozen yaw keeps travelling in the
	// move packet, so the server's copy freezes with it.
	if (const IAbilitySystemInterface* AbilityInterface = Cast<IAbilitySystemInterface>(ControlledCharacter))
	{
		const UAbilitySystemComponent* AbilitySystemComponent = AbilityInterface->GetAbilitySystemComponent();
		if (AbilitySystemComponent && AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_RotationLocked))
		{
			return;
		}
	}

	// Ray from the camera through the mouse cursor. Fails when the cursor is outside the
	// viewport; keep the last yaw in that case.
	FVector RayOrigin;
	FVector RayDirection;
	if (!DeprojectMousePositionToWorld(RayOrigin, RayDirection))
	{
		return;
	}

	// A ray parallel to the floor never reaches it.
	if (FMath::IsNearlyZero(RayDirection.Z))
	{
		return;
	}

	// Intersect with a horizontal plane at the character's feet, so the yaw matches where the
	// cursor visually sits on the floor. A math plane rather than a physics trace: the cursor
	// passing over a tall object must not skew the aim.
	const FVector CharacterLocation = ControlledCharacter->GetActorLocation();
	const float FeetZ = CharacterLocation.Z - ControlledCharacter->GetCapsuleComponent()->GetScaledCapsuleHalfHeight();
	const FPlane FloorPlane(FVector(0.f, 0.f, FeetZ), FVector::UpVector);
	const FVector CursorOnFloor = FMath::RayPlaneIntersection(RayOrigin, RayDirection, FloorPlane);

	FVector ToCursor = CursorOnFloor - CharacterLocation;
	ToCursor.Z = 0.f;

	// Cursor on top of the character: no meaningful direction, keep the last yaw.
	if (ToCursor.SizeSquared() < 1.f)
	{
		return;
	}

	SetControlRotation(FRotator(0.f, ToCursor.Rotation().Yaw, 0.f));
}

// Runs on: owning client only (from PlayerTick). Throttled; sends only when the shape changes.
void AClockworksPlayerController::ReportViewExtents()
{
	ViewReportCooldown -= GetWorld() ? GetWorld()->GetDeltaSeconds() : 0.f;
	if (ViewReportCooldown > 0.f)
	{
		return;
	}
	ViewReportCooldown = 0.5f;

	ULocalPlayer* LocalPlayer = GetLocalPlayer();
	if (!LocalPlayer || !LocalPlayer->ViewportClient || !LocalPlayer->ViewportClient->Viewport)
	{
		return;
	}

	// The projection matrix already folds in the window's aspect ratio and the engine's FOV axis
	// rule: the visible half-extent at depth z is z / M[0][0] horizontally and z / M[1][1] vertically.
	FSceneViewProjectionData ProjectionData;
	if (!LocalPlayer->GetProjectionData(LocalPlayer->ViewportClient->Viewport, ProjectionData))
	{
		return;
	}
	const FMatrix& Projection = ProjectionData.ProjectionMatrix;
	if (FMath::IsNearlyZero(Projection.M[0][0]) || FMath::IsNearlyZero(Projection.M[1][1]))
	{
		return;
	}
	const float TanHalfX = 1.f / Projection.M[0][0];
	const float TanHalfY = 1.f / Projection.M[1][1];

	if (FMath::IsNearlyEqual(TanHalfX, SentTanHalfX, 0.01f) && FMath::IsNearlyEqual(TanHalfY, SentTanHalfY, 0.01f))
	{
		return;
	}
	SentTanHalfX = TanHalfX;
	SentTanHalfY = TanHalfY;

	if (HasAuthority())
	{
		ViewTanHalfX = TanHalfX; // listen host: no round trip needed
		ViewTanHalfY = TanHalfY;
	}
	else
	{
		ServerSetViewExtents(TanHalfX, TanHalfY);
	}
}

// Runs on: server only (RPC from the owning client). The client's screen shape is the client's
// fact; the server only clamps it to something sane.
void AClockworksPlayerController::ServerSetViewExtents_Implementation(float TanHalfX, float TanHalfY)
{
	ViewTanHalfX = FMath::Clamp(TanHalfX, 0.05f, 10.f);
	ViewTanHalfY = FMath::Clamp(TanHalfY, 0.05f, 10.f);
}

// Runs on: server only (read by the enemy brain).
bool AClockworksPlayerController::GetViewExtents(float& OutTanHalfX, float& OutTanHalfY) const
{
	if (ViewTanHalfX <= 0.f || ViewTanHalfY <= 0.f)
	{
		return false;
	}
	OutTanHalfX = ViewTanHalfX;
	OutTanHalfY = ViewTanHalfY;
	return true;
}
