// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksAutomation.h"

#include "Clockworks.h"
#include "ClockworksCharacter.h"
#include "ClockworksEnemyCharacter.h"
#include "ClockworksFloorBuilder.h"
#include "ClockworksFloorDefinition.h"
#include "ClockworksGameState.h"
#include "ClockworksProfileSave.h"
#include "ClockworksReadyRoom.h"
#include "Engine/PostProcessVolume.h"
#include "GameFramework/SpringArmComponent.h"
#include "ClockworksPlayerController.h"
#include "AbilitySystem/ClockworksAttributeSet.h"
#include "AbilitySystem/ClockworksGameplayAbility.h"
#include "AbilitySystemComponent.h"
#include "Containers/Ticker.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"
#include "TimerManager.h"
#include "UObject/ConstructorHelpers.h"

#if !UE_BUILD_SHIPPING

AClockworksCharacter* FClockworksAutomation::FindKnight(UWorld* World)
{
	if (!World)
	{
		return nullptr;
	}
	if (APlayerController* Controller = UGameplayStatics::GetPlayerController(World, 0))
	{
		return Cast<AClockworksCharacter>(Controller->GetPawn());
	}
	return nullptr;
}

void FClockworksAutomation::RunAfter(UWorld* World, float Seconds, const FString& Command)
{
	TWeakObjectPtr<UWorld> WeakWorld(World);
	const FString Copy = Command;

	// A core ticker rather than a world timer: it survives a pause and a level change, which a screenshot run leans on.
	FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([WeakWorld, Copy](float) -> bool
		{
			if (UWorld* Alive = WeakWorld.Get())
			{
				UE_LOG(LogClockworks, Warning, TEXT("Automation: running '%s'"), *Copy);
				// Through the player controller, which is the path a typed command takes: the engine's own Exec does
				// not reach the viewport, and that is where screenshot commands are answered.
				if (APlayerController* Controller = UGameplayStatics::GetPlayerController(Alive, 0))
				{
					Controller->ConsoleCommand(Copy, /*bWriteToLog*/ true);
				}
				else
				{
					GEngine->Exec(Alive, *Copy);
				}
			}
			return false;
		}), Seconds);
}

namespace
{
	UWorld* GameWorld(UWorld* World)
	{
		return World && World->IsGameWorld() ? World : nullptr;
	}

	/** The input id a name stands for, matching EClockworksAbilityInputID. */
	int32 InputIdFromName(const FString& Name)
	{
		if (Name.Equals(TEXT("Attack"), ESearchCase::IgnoreCase))     { return (int32)EClockworksAbilityInputID::Attack; }
		if (Name.Equals(TEXT("Dodge"), ESearchCase::IgnoreCase))      { return (int32)EClockworksAbilityInputID::Dodge; }
		if (Name.Equals(TEXT("Shield"), ESearchCase::IgnoreCase))     { return (int32)EClockworksAbilityInputID::Shield; }
		if (Name.Equals(TEXT("ShieldBash"), ESearchCase::IgnoreCase)) { return (int32)EClockworksAbilityInputID::ShieldBash; }
		return (int32)EClockworksAbilityInputID::None;
	}

	// ---------------------------------------------------------------------------------------------
	// Clockworks.After <seconds> <command...>
	// ---------------------------------------------------------------------------------------------
	FAutoConsoleCommandWithWorldAndArgs GAfterCommand(
		TEXT("Clockworks.After"),
		TEXT("Clockworks.After <seconds> <command...> - runs a console command after a delay. -ExecCmds runs everything "
			 "at startup at once, so this is how a headless run does one thing after another."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateStatic([](const TArray<FString>& Args, UWorld* World)
			{
				if (Args.Num() < 2)
				{
					UE_LOG(LogClockworks, Warning, TEXT("Automation: Clockworks.After <seconds> <command...>"));
					return;
				}
				const float Seconds = FCString::Atof(*Args[0]);
				TArray<FString> Rest(Args);
				Rest.RemoveAt(0);
				FClockworksAutomation::RunAfter(World, Seconds, FString::Join(Rest, TEXT(" ")));
			}));

	// ---------------------------------------------------------------------------------------------
	// Clockworks.CloseMenus
	// ---------------------------------------------------------------------------------------------
	FAutoConsoleCommandWithWorld GCloseMenusCommand(
		TEXT("Clockworks.CloseMenus"),
		TEXT("Closes the start screen and any menu that is up, so a headless run can see the game."),
		FConsoleCommandWithWorldDelegate::CreateStatic([](UWorld* World)
			{
				if (UWorld* Game = GameWorld(World))
				{
					if (AClockworksPlayerController* Controller =
						Cast<AClockworksPlayerController>(UGameplayStatics::GetPlayerController(Game, 0)))
					{
						Controller->CloseAllMenus();
						UE_LOG(LogClockworks, Warning, TEXT("Automation: menus closed"));
						return;
					}
				}
				UE_LOG(LogClockworks, Warning, TEXT("Automation: no local controller to close menus on"));
			}));

	// ---------------------------------------------------------------------------------------------
	// Clockworks.Teleport <x> <y> <z>
	// ---------------------------------------------------------------------------------------------
	FAutoConsoleCommandWithWorldAndArgs GTeleportCommand(
		TEXT("Clockworks.Teleport"),
		TEXT("Clockworks.Teleport <x> <y> <z> - puts the knight there, in cm."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateStatic([](const TArray<FString>& Args, UWorld* World)
			{
				AClockworksCharacter* Knight = FClockworksAutomation::FindKnight(GameWorld(World));
				if (!Knight || Args.Num() < 3)
				{
					UE_LOG(LogClockworks, Warning, TEXT("Automation: Clockworks.Teleport <x> <y> <z> (no knight?)"));
					return;
				}
				const FVector Where(FCString::Atof(*Args[0]), FCString::Atof(*Args[1]), FCString::Atof(*Args[2]));
				Knight->SetActorLocation(Where, /*bSweep*/ false, nullptr, ETeleportType::TeleportPhysics);
				UE_LOG(LogClockworks, Warning, TEXT("Automation: knight at %s"), *Where.ToCompactString());
			}));

	// ---------------------------------------------------------------------------------------------
	// Clockworks.Press <Attack|Dodge|Shield|ShieldBash> [hold seconds]
	// ---------------------------------------------------------------------------------------------
	FAutoConsoleCommandWithWorldAndArgs GPressCommand(
		TEXT("Clockworks.Press"),
		TEXT("Clockworks.Press <Attack|Dodge|Shield|ShieldBash> [hold seconds] - presses an ability button through the "
			 "same path the key does, and releases it after the hold."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateStatic([](const TArray<FString>& Args, UWorld* World)
			{
				AClockworksCharacter* Knight = FClockworksAutomation::FindKnight(GameWorld(World));
				const int32 Input = Args.Num() > 0 ? InputIdFromName(Args[0]) : 0;
				if (!Knight || Input == 0)
				{
					UE_LOG(LogClockworks, Warning, TEXT("Automation: Clockworks.Press <Attack|Dodge|Shield|ShieldBash>"));
					return;
				}

				Knight->AutomationPress(Input);
				UE_LOG(LogClockworks, Warning, TEXT("Automation: pressed %s"), *Args[0]);

				const float Hold = Args.Num() > 1 ? FCString::Atof(*Args[1]) : 0.05f;
				TWeakObjectPtr<AClockworksCharacter> Weak(Knight);
				FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([Weak, Input](float) -> bool
					{
						if (AClockworksCharacter* Alive = Weak.Get())
						{
							Alive->AutomationRelease(Input);
						}
						return false;
					}), Hold);
			}));

	// ---------------------------------------------------------------------------------------------
	// Clockworks.Spawn <blueprint path> [count] [radius cm]
	// ---------------------------------------------------------------------------------------------
	FAutoConsoleCommandWithWorldAndArgs GSpawnCommand(
		TEXT("Clockworks.Spawn"),
		TEXT("Clockworks.Spawn <blueprint path> [count] [radius cm] - puts monsters around the knight, e.g. "
			 "Clockworks.Spawn /Game/TopDown/Blueprints/Monsters/BP_Wolver.BP_Wolver_C 3 600"),
		FConsoleCommandWithWorldAndArgsDelegate::CreateStatic([](const TArray<FString>& Args, UWorld* World)
			{
				UWorld* Game = GameWorld(World);
				AClockworksCharacter* Knight = FClockworksAutomation::FindKnight(Game);
				if (!Game || !Knight || Args.Num() < 1)
				{
					UE_LOG(LogClockworks, Warning, TEXT("Automation: Clockworks.Spawn <blueprint path> [count] [radius]"));
					return;
				}

				UClass* Class = LoadClass<AClockworksEnemyCharacter>(nullptr, *Args[0]);
				if (!Class)
				{
					UE_LOG(LogClockworks, Warning, TEXT("Automation: no monster class at %s"), *Args[0]);
					return;
				}

				const int32 Count = Args.Num() > 1 ? FMath::Max(1, FCString::Atoi(*Args[1])) : 1;
				const float Radius = Args.Num() > 2 ? FCString::Atof(*Args[2]) : 600.f;
				const FVector Centre = Knight->GetActorLocation();

				int32 Made = 0;
				for (int32 Index = 0; Index < Count; ++Index)
				{
					const float Angle = 2.f * PI * Index / FMath::Max(1, Count);
					const FVector Where = Centre + FVector(FMath::Cos(Angle) * Radius, FMath::Sin(Angle) * Radius, 0.f);
					FActorSpawnParameters Params;
					Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
					if (Game->SpawnActor<AActor>(Class, Where, FRotator::ZeroRotator, Params))
					{
						++Made;
					}
				}
				UE_LOG(LogClockworks, Warning, TEXT("Automation: spawned %d of %s"), Made, *Args[0]);
			}));

	// ---------------------------------------------------------------------------------------------
	// Clockworks.Exposure <ev>
	// ---------------------------------------------------------------------------------------------
	FAutoConsoleCommandWithWorldAndArgs GExposureCommand(
		TEXT("Clockworks.Exposure"),
		TEXT("Clockworks.Exposure <ev> - exposure compensation in stops. Higher is brighter. Exposure is pinned rather "
			 "than adapted, so this is the one number that decides how dark a floor reads."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateStatic([](const TArray<FString>& Args, UWorld* World)
			{
				UWorld* Game = GameWorld(World);
				if (!Game || Args.Num() < 1)
				{
					UE_LOG(LogClockworks, Warning, TEXT("Automation: Clockworks.Exposure <ev>"));
					return;
				}
				const float EV = FCString::Atof(*Args[0]);
				int32 Changed = 0;
				for (TActorIterator<APostProcessVolume> It(Game); It; ++It)
				{
					It->Settings.bOverride_AutoExposureBias = true;
					It->Settings.AutoExposureBias = EV;
					++Changed;
				}
				UE_LOG(LogClockworks, Warning, TEXT("Automation: exposure EV %.2f on %d volumes"), EV, Changed);
			}));

	// ---------------------------------------------------------------------------------------------
	// Clockworks.Camera <arm length> [pitch]
	// ---------------------------------------------------------------------------------------------
	FAutoConsoleCommandWithWorldAndArgs GCameraCommand(
		TEXT("Clockworks.Camera"),
		TEXT("Clockworks.Camera <arm length cm> [pitch] - moves the camera in or out, for looking closely at something "
			 "in a headless run. Cosmetic and local."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateStatic([](const TArray<FString>& Args, UWorld* World)
			{
				AClockworksCharacter* Knight = FClockworksAutomation::FindKnight(GameWorld(World));
				USpringArmComponent* Boom = Knight ? Knight->GetCameraBoom() : nullptr;
				if (!Boom || Args.Num() < 1)
				{
					UE_LOG(LogClockworks, Warning, TEXT("Automation: Clockworks.Camera <arm length> [pitch]"));
					return;
				}
				Boom->TargetArmLength = FCString::Atof(*Args[0]);
				if (Args.Num() > 1)
				{
					FRotator Rotation = Boom->GetRelativeRotation();
					Rotation.Pitch = FCString::Atof(*Args[1]);
					Boom->SetRelativeRotation(Rotation);
				}
				UE_LOG(LogClockworks, Warning, TEXT("Automation: camera arm %.0f"), Boom->TargetArmLength);
			}));

	// ---------------------------------------------------------------------------------------------
	// Clockworks.RoomCamera <dx> <dy> <dz>
	// ---------------------------------------------------------------------------------------------
	FAutoConsoleCommandWithWorldAndArgs GRoomCameraCommand(
		TEXT("Clockworks.RoomCamera"),
		TEXT("Clockworks.RoomCamera <dx> <dy> <dz> - moves the ready room's camera to an offset from the set and points "
			 "it back, so angles can be compared in one headless run."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateStatic([](const TArray<FString>& Args, UWorld* World)
			{
				UWorld* Game = GameWorld(World);
				if (!Game || Args.Num() < 3)
				{
					UE_LOG(LogClockworks, Warning, TEXT("Automation: Clockworks.RoomCamera <dx> <dy> <dz>"));
					return;
				}
				const FVector Offset(FCString::Atof(*Args[0]), FCString::Atof(*Args[1]), FCString::Atof(*Args[2]));
				for (TActorIterator<AClockworksReadyRoom> It(Game); It; ++It)
				{
					It->FrameSet(Offset);
					return;
				}
				UE_LOG(LogClockworks, Warning, TEXT("Automation: no ready room in this level"));
			}));

	// ---------------------------------------------------------------------------------------------
	// Clockworks.Knights [new <name> | clear]
	// ---------------------------------------------------------------------------------------------
	FAutoConsoleCommandWithWorldAndArgs GKnightsCommand(
		TEXT("Clockworks.Knights"),
		TEXT("Clockworks.Knights [new <name>|clear] - lists the knights saved on this machine, or changes them. "
			 "For checking that the profile save round-trips without clicking anything."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateStatic([](const TArray<FString>& Args, UWorld*)
			{
				UClockworksProfileSave* Profile = UClockworksProfileSave::Load();
				if (!Profile)
				{
					UE_LOG(LogClockworks, Warning, TEXT("Automation: no profile save"));
					return;
				}

				if (Args.Num() > 0 && Args[0] == TEXT("new"))
				{
					TArray<FString> Rest(Args);
					Rest.RemoveAt(0);
					Profile->AddKnight(Rest.Num() ? FString::Join(Rest, TEXT(" ")) : TEXT("Knight"));
				}
				else if (Args.Num() > 0 && Args[0] == TEXT("clear"))
				{
					while (Profile->Knights.Num() > 0)
					{
						Profile->RemoveKnight(0);
					}
				}

				UE_LOG(LogClockworks, Warning, TEXT("Automation: %d knights saved"), Profile->Knights.Num());
				for (const FClockworksKnightRecord& Knight : Profile->Knights)
				{
					UE_LOG(LogClockworks, Warning, TEXT("Automation:   %s - %s, played %s, deepest %d"),
						*Knight.Name, *Knight.Rank, *UClockworksProfileSave::FormatPlayed(Knight.PlayedSeconds),
						Knight.DeepestDepth);
				}
			}));

	// ---------------------------------------------------------------------------------------------
	// Clockworks.Screen <title|characters>
	// ---------------------------------------------------------------------------------------------
	FAutoConsoleCommandWithWorldAndArgs GScreenCommand(
		TEXT("Clockworks.Screen"),
		TEXT("Clockworks.Screen <title|characters> - opens one of the shell's screens, for looking at it headlessly."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateStatic([](const TArray<FString>& Args, UWorld* World)
			{
				AClockworksPlayerController* Controller =
					Cast<AClockworksPlayerController>(UGameplayStatics::GetPlayerController(GameWorld(World), 0));
				if (!Controller || Args.Num() < 1)
				{
					UE_LOG(LogClockworks, Warning, TEXT("Automation: Clockworks.Screen <title|characters>"));
					return;
				}

				Controller->CloseAllMenus();
				if (Args[0].StartsWith(TEXT("char")))
				{
					Controller->ShowCharacterSelect();
				}
				else
				{
					// The title screen is what ShowMainMenu opens now, and it is the game's own start path.
					Controller->RestartLevel();
				}
				UE_LOG(LogClockworks, Warning, TEXT("Automation: opened screen '%s'"), *Args[0]);
			}));

	// ---------------------------------------------------------------------------------------------
	// Clockworks.Notice <text...>
	// ---------------------------------------------------------------------------------------------
	FAutoConsoleCommandWithWorldAndArgs GNoticeCommand(
		TEXT("Clockworks.Notice"),
		TEXT("Clockworks.Notice <text...> - shows the on-screen notice, for checking it in a headless run."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateStatic([](const TArray<FString>& Args, UWorld* World)
			{
				if (AClockworksPlayerController* Controller =
					Cast<AClockworksPlayerController>(UGameplayStatics::GetPlayerController(GameWorld(World), 0)))
				{
					Controller->ShowNotBuiltYet(FText::FromString(Args.Num() ? FString::Join(Args, TEXT(" ")) : TEXT("The Forge")));
				}
			}));

	// ---------------------------------------------------------------------------------------------
	// Clockworks.Report
	// ---------------------------------------------------------------------------------------------
	FAutoConsoleCommandWithWorld GReportCommand(
		TEXT("Clockworks.Report"),
		TEXT("One line about the state of play: where the knight is, what it has, what floor it stands on, what is alive. "
			 "Written so a headless run can be checked by grepping the log."),
		FConsoleCommandWithWorldDelegate::CreateStatic([](UWorld* World)
			{
				UWorld* Game = GameWorld(World);
				if (!Game)
				{
					return;
				}

				FString Knight = TEXT("no knight");
				if (AClockworksCharacter* Character = FClockworksAutomation::FindKnight(Game))
				{
					float Health = -1.f, MaxHealth = -1.f, Shield = -1.f;
					if (UAbilitySystemComponent* Abilities = Character->GetAbilitySystemComponent())
					{
						if (const UClockworksAttributeSet* Set = Abilities->GetSet<UClockworksAttributeSet>())
						{
							Health = Set->GetHealth();
							MaxHealth = Set->GetMaxHealth();
							Shield = Set->GetShield();
						}
					}
					Knight = FString::Printf(TEXT("knight at %s, health %.0f/%.0f, shield %.0f"),
						*Character->GetActorLocation().ToCompactString(), Health, MaxHealth, Shield);
				}

				int32 Alive = 0;
				for (TActorIterator<AClockworksEnemyCharacter> It(Game); It; ++It)
				{
					if (IsValid(*It) && !It->IsHidden())
					{
						++Alive;
					}
				}

				FString FloorName = TEXT("no floor");
				for (TActorIterator<AClockworksFloorBuilder> It(Game); It; ++It)
				{
					if (const UClockworksFloorDefinition* Built = It->GetFloor())
					{
						FloorName = FString::Printf(TEXT("%s (%d copies, %d cells)"),
							*Built->LevelName, Built->CountInstances(), Built->Cells.Num());
					}
					break;
				}

				int32 Depth = -1;
				if (const AClockworksGameState* State = Game->GetGameState<AClockworksGameState>())
				{
					Depth = State->GetDepth();
				}

				UE_LOG(LogClockworks, Warning, TEXT("Automation: Report | %s | floor %s | depth %d | %d monsters alive"),
					*Knight, *FloorName, Depth, Alive);
			}));
}

#endif // !UE_BUILD_SHIPPING
