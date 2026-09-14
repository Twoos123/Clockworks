// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksCharacter.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksDodgeAbility.h"
#include "ClockworksGameplayAbility.h"
#include "ClockworksGameplayTags.h"
#include "ClockworksPlayerState.h"
#include "ClockworksSwordAttackAbility.h"
#include "UObject/ConstructorHelpers.h"
#include "Camera/CameraComponent.h"
#include "Components/DecalComponent.h"
#include "Components/CapsuleComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/SpringArmComponent.h"
#include "Materials/Material.h"
#include "Engine/World.h"
#include "EnhancedInputComponent.h"
#include "InputActionValue.h"
#include "AbilitySystemComponent.h"
#include "Abilities/GameplayAbility.h"
#include "Animation/AnimInstance.h"
#include "Animation/AnimMontage.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "GameFramework/GameModeBase.h"
#include "Materials/MaterialInterface.h"
#include "TimerManager.h"
#include "Clockworks.h"

// Runs on: all machines (class default object and every spawned instance, server and clients).
AClockworksCharacter::AClockworksCharacter()
{
	// Set size for player capsule
	GetCapsuleComponent()->InitCapsuleSize(42.f, 96.0f);

	// Face the control yaw. The owning client's controller sets it from the mouse cursor;
	// the server receives it inside the CharacterMovementComponent's move packet, applies it
	// to its own copy of the character, and replicates the resulting rotation to other clients.
	bUseControllerRotationPitch = false;
	bUseControllerRotationYaw = true;
	bUseControllerRotationRoll = false;

	// Configure character movement
	GetCharacterMovement()->bOrientRotationToMovement = false; // facing comes from the cursor, not from velocity
	GetCharacterMovement()->RotationRate = FRotator(0.f, 640.f, 0.f); // unused while facing is instant; the knob for smoothed turning later
	GetCharacterMovement()->bConstrainToPlane = true;
	GetCharacterMovement()->bSnapToPlaneAtStart = true;
	GetCharacterMovement()->MaxWalkSpeed = 400.f; // fallback until the MoveSpeed attribute takes over

	// Create the camera boom component. Fixed world rotation: it inherits nothing from the character.
	CameraBoom = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom"));

	CameraBoom->SetupAttachment(RootComponent);
	CameraBoom->SetUsingAbsoluteRotation(true);
	CameraBoom->bInheritPitch = false;
	CameraBoom->bInheritYaw = false;
	CameraBoom->bInheritRoll = false;
	CameraBoom->TargetArmLength = 1500.f;
	CameraBoom->SetRelativeRotation(FRotator(-45.f, 0.f, 0.f));
	CameraBoom->bDoCollisionTest = false;

	// Create the camera component
	TopDownCameraComponent = CreateDefaultSubobject<UCameraComponent>(TEXT("TopDownCamera"));

	TopDownCameraComponent->SetupAttachment(CameraBoom, USpringArmComponent::SocketName);
	TopDownCameraComponent->bUsePawnControlRotation = false;

	// A respawn must never fail because something stands on the PlayerStart (the other player, a
	// corpse, an enemy). Nudge aside if possible, spawn regardless.
	SpawnCollisionHandlingMethod = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;

	// Head pieces ride the helmet bone. The exported bone frame and the exported rigid meshes share
	// the same axis convention, so an identity offset lines them up.
	HelmetMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("HelmetMesh"));
	HelmetMesh->SetupAttachment(GetMesh(), TEXT("bone_helmet"));
	HelmetMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	FaceMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("FaceMesh"));
	FaceMesh->SetupAttachment(GetMesh(), TEXT("bone_helmet"));
	FaceMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	// The C++ abilities by default; BP_ClockworksCharacter can swap in Blueprint children for tuning.
	DefaultAbilities.Add(UClockworksSwordAttackAbility::StaticClass());
	DefaultAbilities.Add(UClockworksDodgeAbility::StaticClass());

	// Activate ticking in order to update the cursor every frame.
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = true;
}

void AClockworksCharacter::BeginPlay()
{
	Super::BeginPlay();

	// stub
}

void AClockworksCharacter::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);

	// stub
}

// Runs on: all machines. Null until the PlayerState exists on this machine.
UAbilitySystemComponent* AClockworksCharacter::GetAbilitySystemComponent() const
{
	const AClockworksPlayerState* ClockworksPlayerState = GetPlayerState<AClockworksPlayerState>();
	return ClockworksPlayerState ? ClockworksPlayerState->GetAbilitySystemComponent() : nullptr;
}

// Runs on: server only. The PlayerState is already assigned when possession happens.
void AClockworksCharacter::PossessedBy(AController* NewController)
{
	Super::PossessedBy(NewController);

	InitAbilitySystem();
}

// Runs on: clients only, owning and simulated, when the PlayerState reference replicates. Simulated
// proxies need the link too so replicated montages and attributes have an avatar to land on.
void AClockworksCharacter::OnRep_PlayerState()
{
	Super::OnRep_PlayerState();

	InitAbilitySystem();
}

// Runs on: server (from PossessedBy) and clients (from OnRep_PlayerState). Only the server grants
// abilities, sets attributes and tags; clients just point the component at this avatar and listen.
void AClockworksCharacter::InitAbilitySystem()
{
	AClockworksPlayerState* ClockworksPlayerState = GetPlayerState<AClockworksPlayerState>();
	if (!ClockworksPlayerState)
	{
		return;
	}

	UAbilitySystemComponent* AbilitySystemComponent = ClockworksPlayerState->GetAbilitySystemComponent();
	if (!AbilitySystemComponent)
	{
		return;
	}

	AbilitySystemComponent->InitAbilityActorInfo(ClockworksPlayerState, this);

	if (BoundAbilitySystemComponent.Get() != AbilitySystemComponent)
	{
		BoundAbilitySystemComponent = AbilitySystemComponent;
		AbilitySystemComponent->GetGameplayAttributeValueChangeDelegate(UClockworksAttributeSet::GetMoveSpeedAttribute()).AddUObject(this, &AClockworksCharacter::OnMoveSpeedChanged);
		AbilitySystemComponent->RegisterGameplayTagEvent(ClockworksTags::State_Attacking, EGameplayTagEventType::NewOrRemoved).AddUObject(this, &AClockworksCharacter::OnAttackingTagChanged);
		AbilitySystemComponent->RegisterGameplayTagEvent(ClockworksTags::State_MovementLocked, EGameplayTagEventType::NewOrRemoved).AddUObject(this, &AClockworksCharacter::OnAttackingTagChanged);

		// The attribute set outlives the pawn (it lives on the PlayerState), so each new body binds
		// its own reactions. The old body's bindings die with it.
		if (HasAuthority())
		{
			if (UClockworksAttributeSet* Attributes = ClockworksPlayerState->GetAttributeSet())
			{
				Attributes->OnDamaged.AddUObject(this, &AClockworksCharacter::HandleDamaged);
				Attributes->OnOutOfHealth.AddUObject(this, &AClockworksCharacter::HandleOutOfHealth);
			}
		}
	}

	if (HasAuthority())
	{
		// A respawned knight arrives with the PlayerState's old, empty health. Refill it and clear the
		// death mark before anything can read them.
		if (ClockworksPlayerState->bAttributesInitialised)
		{
			if (UClockworksAttributeSet* Attributes = ClockworksPlayerState->GetAttributeSet())
			{
				if (Attributes->GetHealth() <= 0.f)
				{
					Attributes->SetHealth(Attributes->GetMaxHealth());
					Attributes->SetShield(Attributes->GetMaxShield());
				}
			}
			AbilitySystemComponent->SetLooseGameplayTagCount(ClockworksTags::State_Dead, 0, EGameplayTagReplicationState::TagAndCountToAll);
		}

		if (!ClockworksPlayerState->bAttributesInitialised)
		{
			if (UClockworksAttributeSet* Attributes = ClockworksPlayerState->GetAttributeSet())
			{
				Attributes->InitMaxHealth(InitialMaxHealth);
				Attributes->InitHealth(InitialHealth);
				Attributes->InitMaxShield(InitialMaxShield);
				Attributes->InitShield(InitialShield);
				Attributes->InitAttackPower(InitialAttackPower);
				Attributes->InitDefensePower(InitialDefensePower);
				Attributes->InitMoveSpeed(InitialMoveSpeed);
			}
			ClockworksPlayerState->bAttributesInitialised = true;
		}

		if (!ClockworksPlayerState->bAbilitiesGranted)
		{
			for (const TSubclassOf<UGameplayAbility>& AbilityClass : DefaultAbilities)
			{
				if (AbilityClass)
				{
					// The input ID lets a button press reach an ability that is already running
					// (combo follow-ups) on both the client and the server.
					int32 InputID = INDEX_NONE;
					if (const UClockworksGameplayAbility* Defaults = AbilityClass->GetDefaultObject<UClockworksGameplayAbility>())
					{
						if (Defaults->GetAbilityInputID() != EClockworksAbilityInputID::None)
						{
							InputID = static_cast<int32>(Defaults->GetAbilityInputID());
						}
					}
					AbilitySystemComponent->GiveAbility(FGameplayAbilitySpec(AbilityClass, 1, InputID, this));
				}
			}
			AbilitySystemComponent->AddLooseGameplayTag(ClockworksTags::Faction_Player, 1, EGameplayTagReplicationState::None);
			ClockworksPlayerState->bAbilitiesGranted = true;
		}
	}

	RefreshMaxWalkSpeed();
}

// Runs on: server and owning client, the two machines that compute this character's movement. The
// server's value is authoritative; the client's keeps prediction in step. Simulated proxies get
// positions, not speeds, so the value there is harmless.
void AClockworksCharacter::RefreshMaxWalkSpeed()
{
	float Speed = InitialMoveSpeed;

	if (const UAbilitySystemComponent* AbilitySystemComponent = GetAbilitySystemComponent())
	{
		if (const UClockworksAttributeSet* Attributes = AbilitySystemComponent->GetSet<UClockworksAttributeSet>())
		{
			Speed = Attributes->GetMoveSpeed();
		}
		if (AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_MovementLocked))
		{
			Speed = 0.f;
		}
		else if (AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Attacking))
		{
			Speed *= AttackMoveSpeedMultiplier;
		}
	}

	GetCharacterMovement()->MaxWalkSpeed = Speed;
}

// Runs on: every machine that receives the attribute (all of them); see RefreshMaxWalkSpeed.
void AClockworksCharacter::OnMoveSpeedChanged(const FOnAttributeChangeData& Data)
{
	RefreshMaxWalkSpeed();
}

// Runs on: server and owning client (the tag is owned by the running ability on both).
void AClockworksCharacter::OnAttackingTagChanged(const FGameplayTag Tag, int32 NewCount)
{
	RefreshMaxWalkSpeed();
}

// Runs on: all machines. The tag is replicated to everyone by HandleOutOfHealth.
bool AClockworksCharacter::IsDead() const
{
	const UAbilitySystemComponent* AbilitySystemComponent = GetAbilitySystemComponent();
	return AbilitySystemComponent && AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Dead);
}

// Runs on: server only (bound to the attribute set on the server).
void AClockworksCharacter::HandleDamaged(AActor* InstigatorActor, AActor* Causer, float Amount, FVector HitDirection)
{
	if (!bDeathHandled)
	{
		MulticastHitFlash();
	}
}

// Runs on: all machines (multicast from the server). Cosmetic.
void AClockworksCharacter::MulticastHitFlash_Implementation()
{
	if (HitFlashMaterial)
	{
		GetMesh()->SetOverlayMaterial(HitFlashMaterial);
		GetWorldTimerManager().SetTimer(HitFlashTimer, this, &AClockworksCharacter::ClearHitFlash, FMath::Max(HitFlashSeconds, 0.01f), false);
	}

	// The flinch. Played straight on the animation instance so it can interrupt an attack montage
	// visually without touching the ability's timing.
	if (HurtMontage)
	{
		if (UAnimInstance* AnimInstance = GetMesh() ? GetMesh()->GetAnimInstance() : nullptr)
		{
			AnimInstance->Montage_Play(HurtMontage);
		}
	}
}

// Runs on: all machines.
void AClockworksCharacter::ClearHitFlash()
{
	GetMesh()->SetOverlayMaterial(nullptr);
}

// Runs on: server only. The death itself: a replicated tag everyone can read (abilities are blocked
// by it on the predicting client too), movement off, the clip, then a respawn timer.
void AClockworksCharacter::HandleOutOfHealth()
{
	if (bDeathHandled)
	{
		return;
	}
	bDeathHandled = true;

	if (UAbilitySystemComponent* AbilitySystemComponent = GetAbilitySystemComponent())
	{
		AbilitySystemComponent->AddLooseGameplayTag(ClockworksTags::State_Dead, 1, EGameplayTagReplicationState::TagAndCountToAll);
		AbilitySystemComponent->CancelAllAbilities();
	}

	SetActorEnableCollision(false);
	GetCharacterMovement()->DisableMovement();
	MulticastPlayDeathMontage();

	GetWorldTimerManager().SetTimer(RespawnTimer, this, &AClockworksCharacter::HandleRespawn, FMath::Max(DeathRespawnSeconds, 0.01f), false);
}

// Runs on: all machines (multicast from the server). Cosmetic, plus stopping the local body so a
// predicting client doesn't keep sliding its corpse before the server's movement mode arrives.
void AClockworksCharacter::MulticastPlayDeathMontage_Implementation()
{
	GetCharacterMovement()->DisableMovement();
	if (UAnimInstance* AnimInstance = GetMesh() ? GetMesh()->GetAnimInstance() : nullptr)
	{
		if (DeathMontage)
		{
			AnimInstance->Montage_Play(DeathMontage);
		}
	}
}

// Runs on: server only. The GameMode spawns a new pawn at a PlayerStart and possesses the
// controller with it; InitAbilitySystem on the new body refills health and clears the death mark.
void AClockworksCharacter::HandleRespawn()
{
	AController* MyController = GetController();
	AGameModeBase* GameMode = GetWorld() ? GetWorld()->GetAuthGameMode() : nullptr;
	if (MyController && GameMode)
	{
		MyController->UnPossess();
		GameMode->RestartPlayer(MyController);
	}
	Destroy();
}

// Runs on: owning client only. The engine calls this only for a pawn possessed by a local
// player controller, so it never runs on the server for the remote player's character.
void AClockworksCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	UEnhancedInputComponent* EnhancedInputComponent = Cast<UEnhancedInputComponent>(PlayerInputComponent);
	if (!EnhancedInputComponent)
	{
		UE_LOG(LogClockworks, Error, TEXT("'%s' Failed to find an Enhanced Input Component! This project is built to use the Enhanced Input system."), *GetNameSafe(this));
		return;
	}

	if (MoveAction)
	{
		EnhancedInputComponent->BindAction(MoveAction, ETriggerEvent::Triggered, this, &AClockworksCharacter::Move);
	}
	else
	{
		UE_LOG(LogClockworks, Warning, TEXT("'%s' has no MoveAction assigned. Set it under Input in BP_ClockworksCharacter's Class Defaults."), *GetNameSafe(this));
	}

	if (AttackAction)
	{
		EnhancedInputComponent->BindAction(AttackAction, ETriggerEvent::Started, this, &AClockworksCharacter::OnAttackInput);
	}
	else
	{
		UE_LOG(LogClockworks, Warning, TEXT("'%s' has no AttackAction assigned. Set it under Input in BP_ClockworksCharacter's Class Defaults."), *GetNameSafe(this));
	}

	if (DodgeAction)
	{
		EnhancedInputComponent->BindAction(DodgeAction, ETriggerEvent::Started, this, &AClockworksCharacter::OnDodgeInput);
	}
	else
	{
		UE_LOG(LogClockworks, Warning, TEXT("'%s' has no DodgeAction assigned. Set it under Input in BP_ClockworksCharacter's Class Defaults."), *GetNameSafe(this));
	}
}

// Runs on: owning client only. AddMovementInput is consumed by the CharacterMovementComponent,
// which predicts the move locally and sends it to the server as acceleration inside the move
// packet. The server performs the authoritative move and corrects the client if they disagree.
void AClockworksCharacter::Move(const FInputActionValue& Value)
{
	const FVector2D Input = Value.Get<FVector2D>();

	// "Forward" is the camera's yaw projected onto the ground, so WASD is relative to the
	// screen regardless of which way the character faces. Read the boom rather than
	// hard-coding zero so a retuned camera yaw stays correct.
	const float CameraYaw = CameraBoom->GetComponentRotation().Yaw;
	const FRotationMatrix CameraBasis(FRotator(0.f, CameraYaw, 0.f));

	AddMovementInput(CameraBasis.GetUnitAxis(EAxis::X), Input.Y); // W / S
	AddMovementInput(CameraBasis.GetUnitAxis(EAxis::Y), Input.X); // D / A
}

// Runs on: owning client only. This is intent: the ability system predicts locally and asks the
// server, which runs its own copy and decides everything that matters. A press on an ability that
// is already running is forwarded to it as a replicated input event (the sword combo listens for it).
void AClockworksCharacter::OnAttackInput()
{
	if (UAbilitySystemComponent* AbilitySystemComponent = GetAbilitySystemComponent())
	{
		AbilitySystemComponent->AbilityLocalInputPressed(static_cast<int32>(EClockworksAbilityInputID::Attack));
	}
}

// Runs on: owning client only. Same shape as OnAttackInput.
void AClockworksCharacter::OnDodgeInput()
{
	if (UAbilitySystemComponent* AbilitySystemComponent = GetAbilitySystemComponent())
	{
		AbilitySystemComponent->AbilityLocalInputPressed(static_cast<int32>(EClockworksAbilityInputID::Dodge));
	}
}
