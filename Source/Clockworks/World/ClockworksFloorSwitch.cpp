// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksFloorSwitch.h"

#include "Clockworks.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksCharacter.h"
#include "ClockworksFloorBuilder.h"
#include "ClockworksFloorDefinition.h"
#include "ClockworksGameplayTags.h"
#include "AbilitySystemComponent.h"
#include "Components/BoxComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"
#include "Net/UnrealNetwork.h"
#include "Sound/SoundBase.h"
#include "TimerManager.h"

namespace
{
	/** How often a party platform looks to see who is standing on it, in seconds. */
	constexpr float PartyCheckSeconds = 0.25f;

	/** How tall a switch's touch box is, in cm: enough that a knight walking over it is inside it. */
	constexpr float TouchHeightCm = 200.f;
}

// Runs on: all machines.
AClockworksFloorSwitch::AClockworksFloorSwitch()
{
	Touch = CreateDefaultSubobject<UBoxComponent>(TEXT("Touch"));
	Touch->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
	Touch->SetCollisionObjectType(ECC_WorldDynamic);
	Touch->SetCollisionResponseToAllChannels(ECR_Ignore);
	Touch->SetCollisionResponseToChannel(ECC_Pawn, ECR_Overlap);
	Touch->SetGenerateOverlapEvents(true);
	Touch->SetCanEverAffectNavigation(false);
	RootComponent = Touch;

	SwitchMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("SwitchMesh"));
	SwitchMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	SwitchMesh->SetupAttachment(Touch);

	// A lever is struck with a weapon, and the knight's weapons only sweep for things that carry an ability system.
	AbilitySystemComponent = CreateDefaultSubobject<UAbilitySystemComponent>(TEXT("AbilitySystemComponent"));
	AbilitySystemComponent->SetIsReplicated(true);
	AttributeSet = CreateDefaultSubobject<UClockworksAttributeSet>(TEXT("AttributeSet"));
}

// Runs on: all machines (the engine asks once per class).
void AClockworksFloorSwitch::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);

	DOREPLIFETIME(AClockworksFloorSwitch, bOn);
	DOREPLIFETIME(AClockworksFloorSwitch, bSpent);
}

// Runs on: all machines. The server alone listens for a weapon striking it.
void AClockworksFloorSwitch::PostInitializeComponents()
{
	Super::PostInitializeComponents();

	AbilitySystemComponent->InitAbilityActorInfo(this, this);

	if (HasAuthority())
	{
		// Health it never spends: a lever is worked by being hit, not destroyed.
		AttributeSet->InitMaxHealth(1000.f);
		AttributeSet->InitHealth(1000.f);
		AbilitySystemComponent->AddLooseGameplayTag(ClockworksTags::Faction_Enemy, 1, EGameplayTagReplicationState::None);
		AttributeSet->OnDamaged.AddUObject(this, &AClockworksFloorSwitch::HandleDamaged);
	}
}

// Runs on: server, before the spawn finishes. Everything about a switch is in the name the original gives it.
void AClockworksFloorSwitch::SetupFromMarker(const FClockworksFloorMarker& Marker)
{
	Super::SetupFromMarker(Marker);

	if (Config.Contains(TEXT("Party Platform")))
	{
		// A party platform is a three-by-three region the whole party has to be inside; the original states no count,
		// the handler class itself is the requirement.
		Kind = EClockworksSwitchKind::PartyPlatform;
		SizeTiles = 3.f;
	}
	else if (Config.Contains(TEXT("Pressure Plate")))
	{
		Kind = EClockworksSwitchKind::PressurePlate;
	}
	else if (Config.Contains(TEXT("Lever")))
	{
		Kind = EClockworksSwitchKind::Lever;
	}
	else
	{
		Kind = EClockworksSwitchKind::Button;
	}

	// "One-Time" is spent after one use; "Toggle" goes back and forth; "Timer"/"Timed" lets go by itself. A pressure
	// plate is held by weight whatever its name says.
	bOneTime = Config.Contains(TEXT("One-Time"));
	// The original's two timed switches, read out of their configs: a Button/Timer holds for 15 s, a Lever/Timed
	// Toggle for 5 s. No other switch has a timer at all.
	if (Config.Contains(TEXT("Timer")))
	{
		bOneTime = false;
		TimerSeconds = 15.f;
	}
	else if (Config.Contains(TEXT("Timed")))
	{
		bOneTime = false;
		TimerSeconds = 5.f;
	}
	if (Kind == EClockworksSwitchKind::PressurePlate)
	{
		bOneTime = false;
	}
}

// Runs on: all machines.
void AClockworksFloorSwitch::BeginPlay()
{
	Super::BeginPlay();

	const float Tile = Floor && Floor->GetFloor() ? Floor->GetFloor()->TileCm : 100.f;
	Touch->SetBoxExtent(FVector(SizeTiles * Tile * 0.5f, SizeTiles * Tile * 0.5f, TouchHeightCm * 0.5f));
	Touch->AddLocalOffset(FVector(0.f, 0.f, TouchHeightCm * 0.5f));

	ApplyState();

	if (!HasAuthority())
	{
		return;
	}

	if (Kind == EClockworksSwitchKind::PartyPlatform)
	{
		GetWorldTimerManager().SetTimer(PartyTimer, this, &AClockworksFloorSwitch::CheckParty,
			PartyCheckSeconds, /*bLoop*/ true);
	}
	else if (Kind != EClockworksSwitchKind::Lever)
	{
		Touch->OnComponentBeginOverlap.AddDynamic(this, &AClockworksFloorSwitch::OnTouchBegin);
		Touch->OnComponentEndOverlap.AddDynamic(this, &AClockworksFloorSwitch::OnTouchEnd);
	}
}

// Runs on: server.
void AClockworksFloorSwitch::OnTouchBegin(UPrimitiveComponent*, AActor* Other, UPrimitiveComponent*, int32, bool, const FHitResult&)
{
	if (!HasAuthority() || bSpent)
	{
		return;
	}

	// A statue-only plate is not worked by a knight, and nothing carries statues yet, so it simply stays up.
	if (Config.Contains(TEXT("Statue Only")))
	{
		return;
	}

	const AClockworksCharacter* Knight = Cast<AClockworksCharacter>(Other);
	if (!Knight || Knight->IsDead())
	{
		return;
	}

	if (Kind == EClockworksSwitchKind::PressurePlate || !bOn)
	{
		SetOn(true);
	}
}

// Runs on: server.
void AClockworksFloorSwitch::OnTouchEnd(UPrimitiveComponent*, AActor* Other, UPrimitiveComponent*, int32)
{
	if (!HasAuthority() || Kind != EClockworksSwitchKind::PressurePlate || !bOn)
	{
		return;
	}
	if (!Cast<AClockworksCharacter>(Other))
	{
		return;
	}

	// A plate is held by whatever stands on it, so it only lets go when the last thing steps off.
	int32 Living = 0;
	if (CountKnightsOn(Living) <= 1)
	{
		SetOn(false);
	}
}

// Runs on: server. A lever is worked by being struck, and the damage itself is ignored.
void AClockworksFloorSwitch::HandleDamaged(AActor*, AActor*, float, FVector, float, float)
{
	if (!HasAuthority() || Kind != EClockworksSwitchKind::Lever || bSpent)
	{
		return;
	}

	AttributeSet->SetHealth(AttributeSet->GetMaxHealth());
	SetOn(bOneTime ? true : !bOn);
}

// Runs on: server.
void AClockworksFloorSwitch::CheckParty()
{
	if (!HasAuthority() || bSpent)
	{
		return;
	}

	int32 Living = 0;
	const int32 Standing = CountKnightsOn(Living);
	const bool bWholeParty = Living > 0 && Standing >= Living;

	PartyHeldSeconds = bWholeParty ? PartyHeldSeconds + PartyCheckSeconds : 0.f;

	if (bWholeParty && PartyHeldSeconds >= PartyStandSeconds && !bOn)
	{
		SetOn(true);
	}
	else if (!bWholeParty && bOn && !bOneTime)
	{
		SetOn(false);
	}
}

// Runs on: server. Server only: the overlap list and who is alive are both the server's truth.
int32 AClockworksFloorSwitch::CountKnightsOn(int32& OutLivingKnights) const
{
	OutLivingKnights = 0;
	UWorld* World = GetWorld();
	if (!World)
	{
		return 0;
	}

	for (FConstPlayerControllerIterator It = World->GetPlayerControllerIterator(); It; ++It)
	{
		if (const AClockworksCharacter* Knight = It->IsValid() ? Cast<AClockworksCharacter>(It->Get()->GetPawn()) : nullptr)
		{
			if (!Knight->IsDead())
			{
				++OutLivingKnights;
			}
		}
	}

	TArray<AActor*> Touching;
	Touch->GetOverlappingActors(Touching, AClockworksCharacter::StaticClass());

	int32 Standing = 0;
	for (const AActor* Actor : Touching)
	{
		const AClockworksCharacter* Knight = Cast<AClockworksCharacter>(Actor);
		if (Knight && !Knight->IsDead())
		{
			++Standing;
		}
	}
	return Standing;
}

// Runs on: server.
void AClockworksFloorSwitch::SetOn(bool bNewOn)
{
	if (bOn == bNewOn)
	{
		return;
	}

	bOn = bNewOn;
	if (bOn && bOneTime)
	{
		bSpent = true;
	}

	// Everything it emits for this half. A pressure plate's data carries "open" on and "close" off; a lever carries
	// "toggle" on both, which is the original's own wiring.
	Emit(/*bReleasing*/ !bOn);

	if (bOn && TimerSeconds > 0.f)
	{
		GetWorldTimerManager().SetTimer(Timer, this, &AClockworksFloorSwitch::ExpireTimer, TimerSeconds, /*bLoop*/ false);
	}

	ApplyState();

	UE_LOG(LogClockworks, Warning, TEXT("Floor: switch %s (%s)"), bOn ? TEXT("on") : TEXT("off"), *Config);
}

// Runs on: server.
void AClockworksFloorSwitch::ExpireTimer()
{
	if (HasAuthority() && bOn)
	{
		SetOn(false);
	}
}

// Runs on: clients.
void AClockworksFloorSwitch::OnRep_On()
{
	ApplyState();
}

// Runs on: every machine, off the replicated state.
void AClockworksFloorSwitch::ApplyState()
{
	// The original sinks a pressed button into the floor; a few cm is enough to read at this camera.
	SetPiecesOffset(FVector(0.f, 0.f, bOn ? -8.f : 0.f));

	if (!HasActorBegunPlay())
	{
		return;
	}
	if (USoundBase* Sound = bOn ? OnSound : OffSound)
	{
		UGameplayStatics::PlaySoundAtLocation(this, Sound, GetActorLocation());
	}
}
