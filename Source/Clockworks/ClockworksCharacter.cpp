// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksCharacter.h"
#include "Debug/ClockworksInputLog.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksDodgeAbility.h"
#include "ClockworksGameplayAbility.h"
#include "ClockworksGameplayTags.h"
#include "ClockworksDamageNumber.h"
#include "ClockworksHitSpark.h"
#include "ClockworksStatusDisplay.h"
#include "ClockworksPlayerState.h"
#include "ClockworksWeaponDefinition.h"
#include "ClockworksGearDefinition.h"
#include "ClockworksGearStats.h"
#include "Camera/PlayerCameraManager.h"
#include "Kismet/KismetMathLibrary.h"
#include "Engine/SkeletalMesh.h"
#include "Net/UnrealNetwork.h"
#include "UObject/ConstructorHelpers.h"
#include "Camera/CameraComponent.h"
#include "Components/AudioComponent.h"
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
#include "Animation/AnimSequenceBase.h"
#include "Animation/AnimMontage.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "GameFramework/GameModeBase.h"
#include "Materials/MaterialInterface.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Kismet/GameplayStatics.h"
#include "Sound/SoundBase.h"
#include "TimerManager.h"
#include "Clockworks.h"

namespace
{
	/** The shield a knight wears, or null for none (then the character's own shield numbers apply). Any machine. */
	const UClockworksGearDefinition* WornShieldOf(const APawn* Pawn)
	{
		const AClockworksPlayerState* ClockworksPlayerState = Pawn ? Pawn->GetPlayerState<AClockworksPlayerState>() : nullptr;
		return ClockworksPlayerState ? ClockworksPlayerState->GetGear(EClockworksGearSlotIndex::Shield) : nullptr;
	}
}

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

	// Main-hand weapon. Cosmetic only: the sword ability's hitbox is its own sphere, so the blade
	// mesh never needs collision.
	WeaponMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("WeaponMesh"));
	WeaponMesh->SetupAttachment(GetMesh(), TEXT("bone_weapon_r"));
	WeaponMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	// The shield rides the back until raised. Cosmetic like the sword; blocking is an attribute rule.
	ShieldMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("ShieldMesh"));
	ShieldMesh->SetupAttachment(GetMesh(), TEXT("bone_shield_away"));
	ShieldMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	// The dome. On the capsule rather than the skeleton, so it stays centred on the knight instead of
	// swaying with the animation. Hidden until the shield goes up.
	ShieldBubbleMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("ShieldBubbleMesh"));
	ShieldBubbleMesh->SetupAttachment(RootComponent);
	ShieldBubbleMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	ShieldBubbleMesh->SetCastShadow(false);
	ShieldBubbleMesh->bReceivesDecals = false;
	ShieldBubbleMesh->SetHiddenInGame(true);

	// Statuses show as their own shell, so they can appear at the same time as a hit flash or the
	// charge aura, which both already own the mesh's overlay slot.
	StatusDisplay = CreateDefaultSubobject<UClockworksStatusDisplay>(TEXT("StatusDisplay"));

	// Spiral Knights' four shield states, worst first: heavy damage is orange, then yellow for
	// moderate, green for slight, blue for a full shield.
	ShieldBubbleColors.Add(FLinearColor(1.f, 0.30f, 0.02f, 1.f));
	ShieldBubbleColors.Add(FLinearColor(1.f, 0.80f, 0.05f, 1.f));
	ShieldBubbleColors.Add(FLinearColor(0.15f, 1.f, 0.35f, 1.f));
	ShieldBubbleColors.Add(FLinearColor(0.12f, 0.55f, 1.f, 1.f));

	// The C++ abilities by default; BP_ClockworksCharacter can swap in Blueprint children for tuning.
	// The sword is no longer here: attacks come from the drawn weapon (DefaultLoadout).
	DefaultAbilities.Add(UClockworksDodgeAbility::StaticClass());

	// The number needs no assets of its own, so the C++ class is enough; no Blueprint to assign.
	DamageNumberClass = AClockworksDamageNumber::StaticClass();

	// Activate ticking in order to update the cursor every frame.
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = true;
}

// Runs on: all machines. The dome's material instance is made once per body; after that only its
// colour parameter changes, which costs nothing.
void AClockworksCharacter::BeginPlay()
{
	Super::BeginPlay();

	if (ShieldBubbleMesh && ShieldBubbleMaterial)
	{
		ShieldBubbleMaterialInstance = UMaterialInstanceDynamic::Create(ShieldBubbleMaterial, this);
		ShieldBubbleMesh->SetMaterial(0, ShieldBubbleMaterialInstance);
	}
	RefreshShieldBubble();

}

// Runs on: the owning machine only, and only with bDebugAutoFight set. The editor automation cannot
// deliver keyboard or mouse input to the play viewport, so this is how the kit gets exercised
// without a person: it presses the same ability inputs the real buttons press, which means what it
// tests is the real path and the server still decides every outcome.
void AClockworksCharacter::TickAutoFight(float DeltaSeconds)
{
	if (!bDebugAutoFight || !IsLocallyControlled() || IsDead())
	{
		return;
	}

	// First time through, wait out the spawn delay so possession and the loadout have settled.
	if (!bDebugAutoFightStarted)
	{
		bDebugAutoFightStarted = true;
		DebugAutoFightElapsed = -FMath::Max(DebugAutoFightDelaySeconds, 0.f);
	}

	DebugAutoFightElapsed += DeltaSeconds;
	if (DebugAutoFightElapsed < FMath::Max(DebugAutoFightStepSeconds, 0.5f))
	{
		return;
	}
	DebugAutoFightElapsed = 0.f;

	AClockworksPlayerState* ClockworksPlayerState = GetPlayerState<AClockworksPlayerState>();
	const int32 Step = DebugAutoFightStepIndex++ % 16;

	switch (Step)
	{
	case 0:
	case 1:
	case 2:
		// Three taps in a row: the combo, including whether swing one plays its follow-through.
		UE_LOG(LogClockworks, Log, TEXT("AutoFight %d: swing"), Step);
		DebugTapAttack(0.05f);
		break;

	case 3:
		UE_LOG(LogClockworks, Log, TEXT("AutoFight %d: dodge"), Step);
		OnDodgeInput();
		break;

	case 4:
		// Held well past ChargeSeconds, because the charge does not begin until the swing that
		// precedes it has finished.
		UE_LOG(LogClockworks, Log, TEXT("AutoFight %d: charge"), Step);
		DebugTapAttack(4.5f);
		break;

	case 5:
		UE_LOG(LogClockworks, Log, TEXT("AutoFight %d: shield"), Step);
		DebugHoldShield(1.5f);
		break;

	case 6:
		UE_LOG(LogClockworks, Log, TEXT("AutoFight %d: shield bash"), Step);
		OnShieldBashInput();
		break;

	case 7:
		UE_LOG(LogClockworks, Log, TEXT("AutoFight %d: draw next weapon"), Step);
		if (ClockworksPlayerState)
		{
			ClockworksPlayerState->RequestWeaponStep(1);
		}
		break;

	case 8:
	case 9:
		UE_LOG(LogClockworks, Log, TEXT("AutoFight %d: shoot"), Step);
		DebugTapAttack(0.05f);
		break;

	case 10:
		UE_LOG(LogClockworks, Log, TEXT("AutoFight %d: charged shot"), Step);
		DebugTapAttack(5.0f);
		break;

	case 11:
		UE_LOG(LogClockworks, Log, TEXT("AutoFight %d: draw bomb"), Step);
		if (ClockworksPlayerState)
		{
			ClockworksPlayerState->RequestWeaponStep(1);
		}
		break;

	case 12:
	case 14:
		// Held past the bomb's arming time, so one actually gets dropped.
		UE_LOG(LogClockworks, Log, TEXT("AutoFight %d: arm and drop a bomb"), Step);
		DebugTapAttack(2.5f);
		break;

	case 13:
		// Deliberately let go early, to exercise the dud path and its lockout.
		UE_LOG(LogClockworks, Log, TEXT("AutoFight %d: bomb released early (expect a dud)"), Step);
		DebugTapAttack(0.5f);
		break;

	case 15:
		UE_LOG(LogClockworks, Log, TEXT("AutoFight %d: back to the sword"), Step);
		if (ClockworksPlayerState)
		{
			ClockworksPlayerState->RequestWeaponStep(1);
		}
		break;

	default:
		break;
	}
}

// Runs on: the owning machine only (debug).
void AClockworksCharacter::DebugTapAttack(float HoldSeconds)
{
	OnAttackInput();
	GetWorldTimerManager().SetTimer(
		DebugAttackReleaseTimer, this, &AClockworksCharacter::OnAttackInputReleased,
		FMath::Max(HoldSeconds, 0.01f), false);
}

// Runs on: the owning machine only (debug).
void AClockworksCharacter::DebugHoldShield(float HoldSeconds)
{
	OnShieldInput();
	GetWorldTimerManager().SetTimer(
		DebugShieldReleaseTimer, this, &AClockworksCharacter::OnShieldInputReleased,
		FMath::Max(HoldSeconds, 0.01f), false);
}

void AClockworksCharacter::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);

	// The shield refills on the server; the attribute replicates to everyone.
	if (HasAuthority())
	{
		TickShieldRegen(DeltaSeconds);
	}

	// Cosmetic, so every machine runs it for every knight it can see.
	TickFootsteps(DeltaSeconds);
	TickArmorBillboards();

	// Owning client only (it checks): a press that found the knight busy gets retried until it fires.
	TickInputBuffer(DeltaSeconds);

	// Debug only, and a no-op unless bDebugAutoFight is set.
	TickAutoFight(DeltaSeconds);
}

// Runs on: every machine, for every knight. Cosmetic only. Movement is replicated, so each machine
// measures the same travel and plays its own steps; nothing goes over the wire for this.
void AClockworksCharacter::TickFootsteps(float DeltaSeconds)
{
	if (FootstepSounds.Num() == 0 || !GetCharacterMovement())
	{
		return;
	}
	if (!GetCharacterMovement()->IsMovingOnGround() || IsDead())
	{
		FootstepTravel = 0.f;
		return;
	}

	// Horizontal only: falling or being knocked upwards is not walking.
	const float Speed = GetVelocity().Size2D();
	if (Speed < 10.f)
	{
		FootstepTravel = 0.f;
		return;
	}

	FootstepTravel += Speed * DeltaSeconds;
	if (FootstepTravel < FootstepDistance)
	{
		return;
	}
	FootstepTravel = 0.f;

	const int32 Index = FMath::RandHelper(FootstepSounds.Num());
	if (USoundBase* Step = FootstepSounds[Index])
	{
		UGameplayStatics::PlaySoundAtLocation(this, Step, GetActorLocation(), FootstepVolume);
	}
}

// Runs on: all machines (the engine asks once per class).
void AClockworksCharacter::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);

	DOREPLIFETIME(AClockworksCharacter, bShieldRaised);
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

		// The dome's colour is the shield's health, and its shape changes when the shield shatters.
		// Both the attribute and the tag replicate to everyone, so every machine can paint its own.
		AbilitySystemComponent->GetGameplayAttributeValueChangeDelegate(UClockworksAttributeSet::GetShieldAttribute()).AddUObject(this, &AClockworksCharacter::OnShieldAttributeChanged);
		AbilitySystemComponent->RegisterGameplayTagEvent(ClockworksTags::State_ShieldBroken, EGameplayTagEventType::NewOrRemoved).AddUObject(this, &AClockworksCharacter::OnShieldBrokenTagChanged);
		AbilitySystemComponent->RegisterGameplayTagEvent(ClockworksTags::State_Attacking, EGameplayTagEventType::NewOrRemoved).AddUObject(this, &AClockworksCharacter::OnAttackingTagChanged);
		AbilitySystemComponent->RegisterGameplayTagEvent(ClockworksTags::State_MovementLocked, EGameplayTagEventType::NewOrRemoved).AddUObject(this, &AClockworksCharacter::OnAttackingTagChanged);
		AbilitySystemComponent->RegisterGameplayTagEvent(ClockworksTags::State_Charging, EGameplayTagEventType::NewOrRemoved).AddUObject(this, &AClockworksCharacter::OnAttackingTagChanged);
		AbilitySystemComponent->RegisterGameplayTagEvent(ClockworksTags::State_Shielding, EGameplayTagEventType::NewOrRemoved).AddUObject(this, &AClockworksCharacter::OnAttackingTagChanged);

		// The hand follows the loadout on every machine; the delegate is dynamic (weak), and EndPlay
		// unhooks it anyway.
		ClockworksPlayerState->OnLoadoutChanged.AddUniqueDynamic(this, &AClockworksCharacter::RefreshWeaponVisuals);
		ClockworksPlayerState->OnGearChanged.AddUniqueDynamic(this, &AClockworksCharacter::RefreshGearVisuals);

		// The attribute set outlives the pawn (it lives on the PlayerState), so each new body binds
		// its own reactions. The old body's bindings die with it.
		if (HasAuthority())
		{
			if (UClockworksAttributeSet* Attributes = ClockworksPlayerState->GetAttributeSet())
			{
				Attributes->OnDamaged.AddUObject(this, &AClockworksCharacter::HandleDamaged);
				Attributes->OnOutOfHealth.AddUObject(this, &AClockworksCharacter::HandleOutOfHealth);
				Attributes->OnBlocked.AddUObject(this, &AClockworksCharacter::HandleBlocked);
				Attributes->OnShieldBroken.AddUObject(this, &AClockworksCharacter::HandleShieldBroken);
			}
		}
	}

	if (HasAuthority())
	{
		// A respawned knight arrives with the PlayerState's old, empty health. Refill it and clear the
		// death mark before anything can read them. The shield comes back whole too: the break timer
		// died with the old body.
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
			AbilitySystemComponent->SetLooseGameplayTagCount(ClockworksTags::State_ShieldBroken, 0, EGameplayTagReplicationState::TagAndCountToAll);

			// Debug only: lets a knight stand in the test level long enough for the auto-fight loop
			// to get through its whole sequence instead of dying a few seconds in.
			AbilitySystemComponent->SetLooseGameplayTagCount(
				ClockworksTags::State_Invulnerable, bDebugInvulnerable ? 1 : 0,
				EGameplayTagReplicationState::TagAndCountToAll);
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
			// The knight's own numbers; the gear adds to them when it goes on (AClockworksPlayerState::RefreshGearStats).
			ClockworksPlayerState->BaseMaxHealth = InitialMaxHealth;
			ClockworksPlayerState->BaseMaxShield = InitialMaxShield;
			ClockworksPlayerState->bAttributesInitialised = true;
		}

		if (!ClockworksPlayerState->bAbilitiesGranted)
		{
			// Attacks belong to the weapons. A default entry that is also a weapon's ability (the
			// sword, from before loadouts existed) is skipped rather than granted twice.
			TSet<TSubclassOf<UGameplayAbility>> WeaponAbilities;
			for (const TObjectPtr<UClockworksWeaponDefinition>& Weapon : DefaultLoadout)
			{
				if (Weapon && Weapon->AttackAbility)
				{
					WeaponAbilities.Add(Weapon->AttackAbility);
				}
			}

			for (const TSubclassOf<UGameplayAbility>& AbilityClass : DefaultAbilities)
			{
				if (AbilityClass && WeaponAbilities.Contains(AbilityClass))
				{
					UE_LOG(LogClockworks, Log, TEXT("%s: %s is granted by the loadout; skipping it in DefaultAbilities."), *GetNameSafe(this), *GetNameSafe(AbilityClass));
					continue;
				}
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

			// The loadout lives on the PlayerState too, so it survives respawns like the abilities.
			// Drawing the first weapon grants its attack ability.
			ClockworksPlayerState->InitialiseLoadout(DefaultLoadout);
			ClockworksPlayerState->InitialiseGear(DefaultGear);
		}
	}

	RefreshMaxWalkSpeed();
	RefreshWeaponVisuals();
	RefreshGearVisuals();
	RefreshShieldAttachment();
	RefreshShieldBubble();
}

// Runs on: all machines. The PlayerState outlives this body; the next body binds itself.
void AClockworksCharacter::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (AClockworksPlayerState* ClockworksPlayerState = GetPlayerState<AClockworksPlayerState>())
	{
		ClockworksPlayerState->OnLoadoutChanged.RemoveDynamic(this, &AClockworksCharacter::RefreshWeaponVisuals);
		ClockworksPlayerState->OnGearChanged.RemoveDynamic(this, &AClockworksCharacter::RefreshGearVisuals);
	}

	Super::EndPlay(EndPlayReason);
}

// Runs on: all machines. Reads the replicated loadout; changes nothing anyone else depends on.
void AClockworksCharacter::RefreshWeaponVisuals()
{
	const AClockworksPlayerState* ClockworksPlayerState = GetPlayerState<AClockworksPlayerState>();
	UClockworksWeaponDefinition* Weapon = ClockworksPlayerState ? ClockworksPlayerState->GetActiveWeapon() : nullptr;
	if (!Weapon || !WeaponMesh)
	{
		// No loadout (yet): whatever the Blueprint put in the hand stays there.
		return;
	}
	if (ShownWeapon.Get() == Weapon)
	{
		return;
	}
	const bool bSwitching = ShownWeapon.IsValid();
	ShownWeapon = Weapon;

	// The whole model, every piece of it, in this weapon's skin; the last weapon's pieces are cleared.
	UClockworksWeaponDefinition::ShowModel(Weapon, WeaponMesh, WeaponExtraMeshes);
	WeaponMesh->AttachToComponent(GetMesh(), FAttachmentTransformRules::KeepRelativeTransform, Weapon->AttachSocket);
	WeaponMesh->SetRelativeTransform(Weapon->MeshOffset);

	// The draw clip, only on a real switch: a fresh body arrives already holding its weapon. Each
	// machine hears the change itself, so each plays its own copy; nothing to replicate.
	if (bSwitching && !IsDead())
	{
		PlaySoundLocal(WeaponSwitchSound);
	}
	if (bSwitching && Weapon->DrawAnim && !IsDead())
	{
		const float Length = Weapon->DrawAnim->GetPlayLength();
		const float Rate = (Weapon->DrawSeconds > 0.f && Length > 0.f) ? Length / Weapon->DrawSeconds : 1.f;
		// Arms only: drawing a weapon should not stop the knight's feet.
		PlaySlotAnimation(Weapon->DrawAnim, Rate, false, UpperBodySlotName);
	}
}

// Runs on: all machines. Reads the replicated gear; changes nothing anyone else depends on.
void AClockworksCharacter::RefreshGearVisuals()
{
	const AClockworksPlayerState* ClockworksPlayerState = GetPlayerState<AClockworksPlayerState>();
	if (!ClockworksPlayerState)
	{
		return;
	}

	// No piece in a slot (yet): whatever the Blueprint put there stays.
	const UClockworksGearDefinition* Armor = ClockworksPlayerState->GetGear(EClockworksGearSlotIndex::Armor);
	if (Armor && Armor->ArmorMesh && ShownArmor.Get() != Armor && GetMesh())
	{
		ShownArmor = Armor;
		GetMesh()->SetSkeletalMeshAsset(Armor->ArmorMesh);
		GetMesh()->EmptyOverrideMaterials();
		for (int32 MaterialIndex = 0; MaterialIndex < Armor->ArmorMaterials.Num(); ++MaterialIndex)
		{
			if (Armor->ArmorMaterials[MaterialIndex])
			{
				GetMesh()->SetMaterial(MaterialIndex, Armor->ArmorMaterials[MaterialIndex]);
			}
		}
		// Tinted skins, by the name of the material each slot was imported with.
		const TArray<FSkeletalMaterial>& Slots = Armor->ArmorMesh->GetMaterials();
		for (int32 MaterialIndex = 0; MaterialIndex < Slots.Num(); ++MaterialIndex)
		{
			const UMaterialInterface* Own = Slots[MaterialIndex].MaterialInterface;
			if (const TObjectPtr<UMaterialInterface>* Swap = Own ? Armor->SkinSwaps.Find(Own->GetFName()) : nullptr)
			{
				GetMesh()->SetMaterial(MaterialIndex, *Swap);
			}
		}
		RefreshArmorPieces(Armor);
	}

	const UClockworksGearDefinition* Helmet = ClockworksPlayerState->GetGear(EClockworksGearSlotIndex::Helmet);
	if (Helmet && Helmet->Mesh && ShownHelmet.Get() != Helmet && HelmetMesh)
	{
		ShownHelmet = Helmet;
		UClockworksGearDefinition::ShowModel(Helmet, HelmetMesh, HelmetExtraMeshes);
		HelmetMesh->SetRelativeTransform(Helmet->MeshOffset);
		// The original blanks the face under a helmet that says so; every other helmet shows it.
		if (FaceMesh)
		{
			FaceMesh->SetVisibility(!Helmet->bHidesFace);
		}
	}

	const UClockworksGearDefinition* Shield = ClockworksPlayerState->GetGear(EClockworksGearSlotIndex::Shield);
	if (Shield && Shield->Mesh && ShownShield.Get() != Shield && ShieldMesh)
	{
		ShownShield = Shield;
		UClockworksGearDefinition::ShowModel(Shield, ShieldMesh, ShieldExtraMeshes);
		RefreshShieldAttachment();
	}

	// Gear can change walk speed (a slow shield, a SpeedChange bonus).
	RefreshMaxWalkSpeed();
}

// Runs on: every machine. Cosmetic: built from the replicated gear, one component per loose piece.
void AClockworksCharacter::RefreshArmorPieces(const UClockworksGearDefinition* Armor)
{
	for (UStaticMeshComponent* Piece : ArmorPieceMeshes)
	{
		if (Piece)
		{
			Piece->DestroyComponent();
		}
	}
	ArmorPieceMeshes.Reset();
	ArmorPieceFacesCamera.Reset();
	if (!Armor || !GetMesh())
	{
		return;
	}

	for (const FClockworksGearPiece& Spec : Armor->ArmorPieces)
	{
		if (!Spec.Mesh)
		{
			continue;
		}
		UStaticMeshComponent* Piece = NewObject<UStaticMeshComponent>(this, NAME_None, RF_Transient);
		Piece->SetStaticMesh(Spec.Mesh);
		Piece->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Piece->RegisterComponent();
		Piece->AttachToComponent(GetMesh(), FAttachmentTransformRules::SnapToTargetNotIncludingScale, Spec.Bone);
		Piece->SetRelativeTransform(Spec.Offset);
		// A camera-facing piece keeps its place on the bone but takes its rotation from TickArmorBillboards.
		Piece->SetUsingAbsoluteRotation(Spec.bFacesCamera);
		ArmorPieceMeshes.Add(Piece);
		ArmorPieceFacesCamera.Add(Spec.bFacesCamera);
	}
}

// Runs on: every machine that draws, for every knight it sees. Cosmetic and local: each machine turns the pieces
// toward its own camera, as the original's FACE_VIEWER billboards do.
void AClockworksCharacter::TickArmorBillboards()
{
	if (ArmorPieceMeshes.Num() == 0 || GetNetMode() == NM_DedicatedServer)
	{
		return;
	}
	const APlayerController* Viewer = GetWorld() ? GetWorld()->GetFirstPlayerController() : nullptr;
	const APlayerCameraManager* Camera = Viewer ? Viewer->PlayerCameraManager.Get() : nullptr;
	if (!Camera)
	{
		return;
	}
	const FVector CameraLocation = Camera->GetCameraLocation();
	const FVector CameraUp = Camera->GetCameraRotation().RotateVector(FVector::UpVector);
	for (int32 Index = 0; Index < ArmorPieceMeshes.Num(); ++Index)
	{
		UStaticMeshComponent* Piece = ArmorPieceMeshes[Index];
		if (!Piece || !ArmorPieceFacesCamera.IsValidIndex(Index) || !ArmorPieceFacesCamera[Index])
		{
			continue;
		}
		const FVector ToCamera = (CameraLocation - Piece->GetComponentLocation()).GetSafeNormal();
		// The billboard build faces +Y with +Z up after the glTF import's axis swap (INFERRED; research rigid_pieces.md).
		Piece->SetWorldRotation(UKismetMathLibrary::MakeRotFromYZ(ToCamera, CameraUp));
	}
}

// Runs on: server and owning client, the two machines that compute this character's movement. The
// server's value is authoritative; the client's keeps prediction in step. Simulated proxies get
// positions, not speeds, so the value there is harmless.
void AClockworksCharacter::RefreshMaxWalkSpeed()
{
	float Speed = InitialMoveSpeed;

	// The drawn weapon decides how much an attack or a charge slows the knight; the character's
	// own numbers only apply before a loadout exists.
	float AttackMultiplier = AttackMoveSpeedMultiplier;
	float ChargeMultiplier = ChargeMoveSpeedMultiplier;
	if (const AClockworksPlayerState* ClockworksPlayerState = GetPlayerState<AClockworksPlayerState>())
	{
		if (const UClockworksWeaponDefinition* Weapon = ClockworksPlayerState->GetActiveWeapon())
		{
			AttackMultiplier = Weapon->AttackMoveSpeedMultiplier;
			ChargeMultiplier = Weapon->ChargeMoveSpeedMultiplier;
		}
	}

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
		else if (AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Charging))
		{
			// Charging is part of the attack ability, so State.Attacking is also present; the charge speed wins.
			Speed *= ChargeMultiplier;
		}
		else if (AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Attacking))
		{
			Speed *= AttackMultiplier;
		}
		else if (AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Shielding))
		{
			// The worn shield's defendingSpeed (-0.5 is half speed) wins over the character's own.
			const UClockworksGearDefinition* WornShield = WornShieldOf(this);
			Speed *= WornShield ? FMath::Max(1.f + WornShield->ShieldDefendingSpeed, 0.f) : ShieldMoveSpeedMultiplier;
		}
	}

	// A SpeedChange on the gear (Barrier Shell: a tenth slower). Gear replicates, so server and owner agree.
	const FClockworksGearTotals Gear = ClockworksGearStats::TotalFor(GetPlayerState<AClockworksPlayerState>());
	Speed *= ClockworksGearStats::MoveSpeedFactor(Gear);

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
void AClockworksCharacter::HandleDamaged(AActor* InstigatorActor, AActor* Causer, float Amount, FVector HitDirection, float KnockbackMultiplier, float FamilyMultiplier)
{
	if (!bDeathHandled)
	{
		MulticastHitFlash();
		MulticastDamageNumber(Amount, FamilyMultiplier);
	}
}

// Runs on: all machines (multicast from the server). Cosmetic.
void AClockworksCharacter::MulticastHitFlash_Implementation()
{
	PlaySoundLocal(HurtSound);
	ApplyHitstop();
	SpawnHitSpark(GetActorLocation() + FVector(0.f, 0.f, HitSparkHeight - GetDefaultHalfHeight()));

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

// Runs on: all machines. A knight holding a ready charge keeps its aura once the hit flash is over.
void AClockworksCharacter::ClearHitFlash()
{
	if (bChargeReadyShown)
	{
		UMaterialInterface* Material = ChargeReadyFlashMaterial ? ChargeReadyFlashMaterial : HitFlashMaterial;
		GetMesh()->SetOverlayMaterial(Material);
		return;
	}
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

	// A charge dies with its knight; the hum must not outlive the body.
	SetChargeLoop(false);

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
	PlaySoundLocal(DeathSound);
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
		EnhancedInputComponent->BindAction(AttackAction, ETriggerEvent::Completed, this, &AClockworksCharacter::OnAttackInputReleased);
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

	if (SwitchWeaponAction)
	{
		// Triggered, not Started: the mapping context gives Space and the wheel a Pressed trigger,
		// so this fires once per tap or notch and carries the wheel's sign.
		EnhancedInputComponent->BindAction(SwitchWeaponAction, ETriggerEvent::Triggered, this, &AClockworksCharacter::OnSwitchWeaponInput);
	}
	else
	{
		UE_LOG(LogClockworks, Warning, TEXT("'%s' has no SwitchWeaponAction assigned. Set it under Input in BP_ClockworksCharacter's Class Defaults."), *GetNameSafe(this));
	}

	if (ShieldAction)
	{
		EnhancedInputComponent->BindAction(ShieldAction, ETriggerEvent::Started, this, &AClockworksCharacter::OnShieldInput);
		EnhancedInputComponent->BindAction(ShieldAction, ETriggerEvent::Completed, this, &AClockworksCharacter::OnShieldInputReleased);
	}
	else
	{
		UE_LOG(LogClockworks, Warning, TEXT("'%s' has no ShieldAction assigned. Set it under Input in BP_ClockworksCharacter's Class Defaults."), *GetNameSafe(this));
	}

	if (ShieldBashAction)
	{
		EnhancedInputComponent->BindAction(ShieldBashAction, ETriggerEvent::Started, this, &AClockworksCharacter::OnShieldBashInput);
	}
	else
	{
		UE_LOG(LogClockworks, Warning, TEXT("'%s' has no ShieldBashAction assigned. Set it under Input in BP_ClockworksCharacter's Class Defaults."), *GetNameSafe(this));
	}
}

// Runs on: owning client only. Same shape as OnAttackInput; the shield ability answers to the Shield ID
// and ends when the release reaches it.
void AClockworksCharacter::OnShieldInput()
{
	if (UAbilitySystemComponent* AbilitySystemComponent = GetAbilitySystemComponent())
	{
		PressAbilityInput(static_cast<int32>(EClockworksAbilityInputID::Shield));
	}
}

// Runs on: owning client only.
void AClockworksCharacter::OnShieldInputReleased()
{
	ReleaseAbilityInput(static_cast<int32>(EClockworksAbilityInputID::Shield));
}

// Runs on: owning client only.
void AClockworksCharacter::OnShieldBashInput()
{
	PressAbilityInput(static_cast<int32>(EClockworksAbilityInputID::ShieldBash));
}

namespace
{
	// Runs on: the local machine. For the input log only.
	const TCHAR* AbilityButtonName(int32 InputID)
	{
		switch (static_cast<EClockworksAbilityInputID>(InputID))
		{
		case EClockworksAbilityInputID::Attack:     return TEXT("Attack");
		case EClockworksAbilityInputID::Dodge:      return TEXT("Dodge");
		case EClockworksAbilityInputID::Shield:     return TEXT("Shield");
		case EClockworksAbilityInputID::ShieldBash: return TEXT("Shield bash");
		default:                                    return TEXT("unknown button");
		}
	}

	// Runs on: the local machine. The knight's states, which are what refuse a press ("Attacking, Dodging").
	FString KnightStates(const UAbilitySystemComponent* AbilitySystemComponent)
	{
		FGameplayTagContainer Owned;
		AbilitySystemComponent->GetOwnedGameplayTags(Owned);
		TArray<FString> Names;
		for (const FGameplayTag& Tag : Owned)
		{
			FString Name = Tag.ToString();
			if (Name.RemoveFromStart(TEXT("State.")))
			{
				Names.Add(Name);
			}
		}
		return Names.Num() > 0 ? FString::Join(Names, TEXT(", ")) : FString(TEXT("no state"));
	}

	// Runs on: the local machine. Whether any granted ability answers to this button at all.
	bool HasAbilityOn(const UAbilitySystemComponent* AbilitySystemComponent, int32 InputID)
	{
		for (const FGameplayAbilitySpec& Spec : AbilitySystemComponent->GetActivatableAbilities())
		{
			if (Spec.InputID == InputID)
			{
				return true;
			}
		}
		return false;
	}
}

// Runs on: owning client only. Intent, as before: the ability system predicts locally and asks the
// server, which decides. What is new is the memory: a press that finds the knight busy is kept for
// InputBufferSeconds and retried every frame, instead of being thrown away.
void AClockworksCharacter::PressAbilityInput(int32 InputID)
{
	UAbilitySystemComponent* AbilitySystemComponent = GetAbilitySystemComponent();
	if (!AbilitySystemComponent)
	{
		ClockworksInputLog::Write(FString::Printf(TEXT("[game] %s pressed: ignored, the knight has no ability system yet"), AbilityButtonName(InputID)), FColor::Red);
		return;
	}
	const bool bWasRunning = IsAbilityInputActive(InputID);
	HeldAbilityInputs.Add(InputID);
	AbilitySystemComponent->AbilityLocalInputPressed(InputID);

	FString Weapon;
	if (InputID == static_cast<int32>(EClockworksAbilityInputID::Attack))
	{
		const AClockworksPlayerState* ClockworksPlayerState = GetPlayerState<AClockworksPlayerState>();
		const UClockworksWeaponDefinition* Drawn = ClockworksPlayerState ? ClockworksPlayerState->GetActiveWeapon() : nullptr;
		Weapon = FString::Printf(TEXT(" (%s)"), Drawn ? *Drawn->DisplayName.ToString() : TEXT("no weapon drawn"));
	}

	// Running now means it either started or was already running and took the press (a queued swing).
	if (IsAbilityInputActive(InputID))
	{
		ClockworksInputLog::Write(FString::Printf(TEXT("[game] %s%s pressed: %s"), AbilityButtonName(InputID), *Weapon,
			bWasRunning ? TEXT("went to the attack already running, as its next move") : TEXT("started")), FColor::Green);
		if (BufferedInputID == InputID)
		{
			BufferedInputID = 0;
		}
		return;
	}
	if (!HasAbilityOn(AbilitySystemComponent, InputID))
	{
		ClockworksInputLog::Write(FString::Printf(TEXT("[game] %s%s pressed: nothing is bound to this button"), AbilityButtonName(InputID), *Weapon), FColor::Red);
		return;
	}
	ClockworksInputLog::Write(FString::Printf(TEXT("[game] %s%s pressed: refused for now, kept %.2f s. Knight: %s"),
		AbilityButtonName(InputID), *Weapon, InputBufferSeconds, *KnightStates(AbilitySystemComponent)), FColor::Yellow);
	BufferedInputID = InputID;
	BufferedInputAge = 0.f;
}

// Runs on: owning client only.
void AClockworksCharacter::ReleaseAbilityInput(int32 InputID)
{
	ClockworksInputLog::Write(FString::Printf(TEXT("[game] %s released"), AbilityButtonName(InputID)));
	HeldAbilityInputs.Remove(InputID);
	if (UAbilitySystemComponent* AbilitySystemComponent = GetAbilitySystemComponent())
	{
		AbilitySystemComponent->AbilityLocalInputReleased(InputID);
	}
	// The shield is held, not pressed: once the button is up there is nothing left to raise.
	if (BufferedInputID == InputID && InputID == static_cast<int32>(EClockworksAbilityInputID::Shield))
	{
		BufferedInputID = 0;
	}
}

// Runs on: whichever machine asks. On the owning client a predicted activation counts as running at once.
bool AClockworksCharacter::IsAbilityInputActive(int32 InputID) const
{
	const UAbilitySystemComponent* AbilitySystemComponent = GetAbilitySystemComponent();
	if (!AbilitySystemComponent)
	{
		return false;
	}
	for (const FGameplayAbilitySpec& Spec : AbilitySystemComponent->GetActivatableAbilities())
	{
		if (Spec.InputID == InputID && Spec.IsActive())
		{
			return true;
		}
	}
	return false;
}

// Runs on: owning client only. A refused try costs nothing: the ability system checks locally and
// only asks the server once the ability can actually start.
void AClockworksCharacter::TickInputBuffer(float DeltaSeconds)
{
	if (BufferedInputID == 0 || !IsLocallyControlled())
	{
		return;
	}
	BufferedInputAge += DeltaSeconds;

	UAbilitySystemComponent* AbilitySystemComponent = GetAbilitySystemComponent();
	if (!AbilitySystemComponent || BufferedInputAge > InputBufferSeconds || IsDead())
	{
		if (AbilitySystemComponent)
		{
			ClockworksInputLog::Write(FString::Printf(TEXT("[game] kept %s press dropped after %.2f s. Knight still: %s"),
				AbilityButtonName(BufferedInputID), BufferedInputAge, *KnightStates(AbilitySystemComponent)), FColor::Orange);
		}
		BufferedInputID = 0;
		return;
	}

	const int32 InputID = BufferedInputID;
	AbilitySystemComponent->AbilityLocalInputPressed(InputID);
	if (!IsAbilityInputActive(InputID))
	{
		return;
	}
	ClockworksInputLog::Write(FString::Printf(TEXT("[game] kept %s press started %.2f s late"), AbilityButtonName(InputID), BufferedInputAge), FColor::Green);
	BufferedInputID = 0;

	// The button came up while the press waited. Say so now, or the ability would read the stale
	// "pressed" state as a hold and start charging.
	if (!HeldAbilityInputs.Contains(InputID))
	{
		AbilitySystemComponent->AbilityLocalInputReleased(InputID);
	}
}

// Runs on: owning client only. Intent: the PlayerState asks the server, which decides and
// replicates the drawn slot back to everyone.
void AClockworksCharacter::OnSwitchWeaponInput(const FInputActionValue& Value)
{
	const float Direction = Value.Get<float>();
	if (FMath::IsNearlyZero(Direction))
	{
		return;
	}
	ClockworksInputLog::Write(FString::Printf(TEXT("[game] switch weapon %s"), Direction > 0.f ? TEXT("next") : TEXT("previous")));
	if (AClockworksPlayerState* ClockworksPlayerState = GetPlayerState<AClockworksPlayerState>())
	{
		ClockworksPlayerState->RequestWeaponStep(Direction > 0.f ? 1 : -1);
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
	PressAbilityInput(static_cast<int32>(EClockworksAbilityInputID::Attack));
}

// Runs on: owning client only. The release is what turns a held attack into a charge; the sword
// ability waits for it through the same replicated input path.
void AClockworksCharacter::OnAttackInputReleased()
{
	ReleaseAbilityInput(static_cast<int32>(EClockworksAbilityInputID::Attack));
}

// Runs on: owning client only. Same shape as OnAttackInput.
void AClockworksCharacter::OnDodgeInput()
{
	PressAbilityInput(static_cast<int32>(EClockworksAbilityInputID::Dodge));
}

// Runs on: the local machine only. A dynamic montage in the named slot; the ability decides who plays it.
void AClockworksCharacter::PlaySlotAnimation(UAnimSequenceBase* Anim, float PlayRate, bool bLoop, FName SlotName, bool bHoldLastFrame)
{
	UAnimInstance* AnimInstance = GetMesh() ? GetMesh()->GetAnimInstance() : nullptr;
	if (!Anim || !AnimInstance)
	{
		return;
	}
	const FName Slot = SlotName.IsNone() ? FullBodySlotName : SlotName;

	// Only this slot's clip is replaced, so a blocked-hit clip on the arms cannot cancel a dodge.
	StopSlotAnimation(0.05f, Slot);
	// A loop count of zero builds a zero-length segment that never shows; "forever" is a big number here.
	UAnimMontage* Montage = AnimInstance->PlaySlotAnimationAsDynamicMontage(Anim, Slot, /*BlendIn*/ 0.05f, /*BlendOut*/ 0.1f, FMath::Max(PlayRate, 0.01f), bLoop ? 1000 : 1);

	// The original holds a clip's last frame until the next one starts. The pistol's fire clip is
	// 0.067 s against a 0.252 s rearm; without the hold the arms fell back to the run between shots,
	// so the gun was down while firing and only came up in the follow-through after the last shot.
	if (Montage && bHoldLastFrame)
	{
		Montage->bEnableAutoBlendOut = false;
	}
	ActiveSlotMontages.Add(Slot, Montage);
}

// Runs on: the local machine only.
void AClockworksCharacter::ReleaseHeldSlotAnimation(float BlendOutSeconds, FName SlotName)
{
	const FName Slot = SlotName.IsNone() ? FullBodySlotName : SlotName;
	if (const TWeakObjectPtr<UAnimMontage>* Found = ActiveSlotMontages.Find(Slot))
	{
		const UAnimMontage* Montage = Found->Get();
		if (Montage && !Montage->bEnableAutoBlendOut)
		{
			StopSlotAnimation(BlendOutSeconds, Slot);
		}
	}
}

// Runs on: all machines (multicast from the server). Cosmetic; the owning client predicted its own.
void AClockworksCharacter::MulticastPlaySlotAnimationHeld_Implementation(UAnimSequenceBase* Anim, float PlayRate, FName SlotName)
{
	if (!HasAuthority() && IsLocallyControlled())
	{
		return;
	}
	PlaySlotAnimation(Anim, PlayRate, false, SlotName, /*bHoldLastFrame*/ true);
}

// Runs on: all machines (multicast from the server). Cosmetic; the owning client released its own.
void AClockworksCharacter::MulticastReleaseHeldSlotAnimation_Implementation(FName SlotName)
{
	if (!HasAuthority() && IsLocallyControlled())
	{
		return;
	}
	ReleaseHeldSlotAnimation(0.15f, SlotName);
}

// Runs on: the local machine only. Cosmetic.
void AClockworksCharacter::PlaySlotSequence(const TArray<FClockworksClipSegment>& Segments, FName SlotName)
{
	const FName Slot = SlotName.IsNone() ? FullBodySlotName : SlotName;
	GetWorldTimerManager().ClearTimer(SequenceTimer);
	PendingSequence.Reset();
	for (const FClockworksClipSegment& Segment : Segments)
	{
		if (Segment.Anim)
		{
			PendingSequence.Add(Segment);
		}
	}
	PendingSequence.StableSort([](const FClockworksClipSegment& A, const FClockworksClipSegment& B) { return A.StartSeconds < B.StartSeconds; });
	PendingSequenceSlot = Slot;
	PendingSequenceIndex = 0;
	PlayNextSequenceClip();
}

// Runs on: the local machine only. Each clip holds its last frame, so the pose never drops between two
// clips whose start times leave a gap.
void AClockworksCharacter::PlayNextSequenceClip()
{
	if (!PendingSequence.IsValidIndex(PendingSequenceIndex))
	{
		PendingSequence.Reset();
		return;
	}
	const FClockworksClipSegment Segment = PendingSequence[PendingSequenceIndex];
	bPlayingSequenceClip = true;
	PlaySlotAnimation(Segment.Anim, Segment.Rate, false, PendingSequenceSlot, /*bHoldLastFrame*/ true);
	bPlayingSequenceClip = false;

	++PendingSequenceIndex;
	if (PendingSequence.IsValidIndex(PendingSequenceIndex))
	{
		const float Wait = FMath::Max(PendingSequence[PendingSequenceIndex].StartSeconds - Segment.StartSeconds, 0.01f);
		GetWorldTimerManager().SetTimer(SequenceTimer, this, &AClockworksCharacter::PlayNextSequenceClip, Wait, false);
	}
	else
	{
		PendingSequence.Reset();
	}
}

// Runs on: all machines (multicast from the server). Cosmetic; the owning client predicted its own.
void AClockworksCharacter::MulticastPlaySlotSequence_Implementation(const TArray<FClockworksClipSegment>& Segments, FName SlotName)
{
	if (!HasAuthority() && IsLocallyControlled())
	{
		return;
	}
	PlaySlotSequence(Segments, SlotName);
}

// Runs on: the local machine only.
void AClockworksCharacter::StopSlotAnimation(float BlendOutSeconds, FName SlotName)
{
	const FName Slot = SlotName.IsNone() ? FullBodySlotName : SlotName;

	// Anything else in the slot ends a run of clips; the run's own clips do not.
	if (!bPlayingSequenceClip && Slot == PendingSequenceSlot && PendingSequence.Num() > 0)
	{
		GetWorldTimerManager().ClearTimer(SequenceTimer);
		PendingSequence.Reset();
	}

	if (TWeakObjectPtr<UAnimMontage>* Found = ActiveSlotMontages.Find(Slot))
	{
		if (UAnimMontage* Montage = Found->Get())
		{
			if (UAnimInstance* AnimInstance = GetMesh() ? GetMesh()->GetAnimInstance() : nullptr)
			{
				AnimInstance->Montage_Stop(BlendOutSeconds, Montage);
			}
		}
		ActiveSlotMontages.Remove(Slot);
	}
}

// Runs on: all machines (multicast from the server). Cosmetic. The owning client already played
// this clip when it predicted the ability, so it skips; the listen-server host is both owner and
// authority and plays it here.
void AClockworksCharacter::MulticastPlaySlotAnimation_Implementation(UAnimSequenceBase* Anim, float PlayRate, bool bLoop, FName SlotName)
{
	if (!HasAuthority() && IsLocallyControlled())
	{
		return;
	}
	PlaySlotAnimation(Anim, PlayRate, bLoop, SlotName);
}

// Runs on: the local machine only. Cosmetic in the strictest sense: it scales the mesh's animation
// clock, not the actor's, so movement, ability timers and replication are all untouched. That is why
// hitstop is safe to apply on a listen host without the two machines drifting apart.
void AClockworksCharacter::ApplyHitstop()
{
	USkeletalMeshComponent* MeshComponent = GetMesh();
	if (!MeshComponent || HitstopSeconds <= 0.f)
	{
		return;
	}
	MeshComponent->GlobalAnimRateScale = 0.f;
	// Restarting rather than stacking: two hits in one frame should not freeze for twice as long.
	GetWorldTimerManager().SetTimer(HitstopTimer, this, &AClockworksCharacter::EndHitstop, HitstopSeconds, false);
}

// Runs on: server only. Cosmetic, but the server is the only machine that knows what a hit came to
// after defence and the family chart, so it is the one that has to say.
void AClockworksCharacter::MulticastDamageNumber_Implementation(float Amount, float FamilyMultiplier)
{
	ShowDamageNumber(Amount, FamilyMultiplier);
}

// Runs on: the local machine only.
void AClockworksCharacter::ShowDamageNumber(float Amount, float FamilyMultiplier)
{
	UWorld* World = GetWorld();
	if (!DamageNumberClass || !World)
	{
		return;
	}

	// Over the head rather than at the feet, where it would be hidden by the body it belongs to.
	const FVector Location = GetActorLocation() + FVector(0.f, 0.f, GetDefaultHalfHeight() + 40.f);

	FActorSpawnParameters SpawnParams;
	SpawnParams.Owner = this;
	SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	if (AClockworksDamageNumber* Number = World->SpawnActor<AClockworksDamageNumber>(
		DamageNumberClass, Location, FRotator::ZeroRotator, SpawnParams))
	{
		Number->ShowDamage(Amount, FamilyMultiplier);
	}
}

// Runs on: the local machine only. Purely a flourish, so a missing class is not worth a warning.
void AClockworksCharacter::SpawnHitSpark(const FVector& WorldLocation)
{
	UWorld* World = GetWorld();
	if (!HitSparkClass || !World)
	{
		return;
	}
	FActorSpawnParameters SpawnParams;
	SpawnParams.Owner = this;
	SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	World->SpawnActor<AClockworksHitSpark>(HitSparkClass, WorldLocation, FRotator::ZeroRotator, SpawnParams);
}

// Runs on: server only. Cosmetic, so it follows the sound rule.
void AClockworksCharacter::StartSwingTrail(float Seconds)
{
	if (!HasAuthority())
	{
		return;
	}
	MulticastStartSwingTrail(Seconds);
}

// Runs on: all machines (multicast from the server). Cosmetic. No owner-skip: restarting a smear
// that is already running only pushes its end time out, which costs nothing.
void AClockworksCharacter::MulticastStartSwingTrail_Implementation(float Seconds)
{
	ShowSwingTrail(Seconds);
}

// Runs on: the local machine only.
void AClockworksCharacter::ShowSwingTrail(float Seconds)
{
	UWorld* World = GetWorld();
	if (!World || !SwingTrailSparkClass || Seconds <= 0.f)
	{
		return;
	}

	SwingTrailEndTime = World->GetTimeSeconds() + Seconds;

	// One mark straight away so the first frame of the swing is not bare, then a steady trickle.
	TickSwingTrail();
	GetWorldTimerManager().SetTimer(
		SwingTrailTimer, this, &AClockworksCharacter::TickSwingTrail,
		FMath::Max(SwingTrailIntervalSeconds, 0.005f), true);
}

// Runs on: the local machine only. One mark at the blade, or stop when the swing is over.
void AClockworksCharacter::TickSwingTrail()
{
	UWorld* World = GetWorld();
	USkeletalMeshComponent* MeshComponent = GetMesh();
	if (!World || !MeshComponent || !SwingTrailSparkClass)
	{
		GetWorldTimerManager().ClearTimer(SwingTrailTimer);
		return;
	}

	if (World->GetTimeSeconds() >= SwingTrailEndTime)
	{
		GetWorldTimerManager().ClearTimer(SwingTrailTimer);
		return;
	}

	// Out along the blade from the hand bone. The bone's own X axis runs down the weapon, so the
	// mark lands near the tip, which is the part of the arc the eye actually follows.
	const FTransform BoneTransform = MeshComponent->GetSocketTransform(SwingTrailSocket);
	const FVector Location = BoneTransform.GetLocation() + BoneTransform.GetUnitAxis(EAxis::X) * SwingTrailReach;

	FActorSpawnParameters SpawnParams;
	SpawnParams.Owner = this;
	SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	World->SpawnActor<AClockworksHitSpark>(SwingTrailSparkClass, Location, FRotator::ZeroRotator, SpawnParams);
}

// Runs on: the local machine only.
void AClockworksCharacter::EndHitstop()
{
	if (USkeletalMeshComponent* MeshComponent = GetMesh())
	{
		MeshComponent->GlobalAnimRateScale = 1.f;
	}
}

// Runs on: all machines (multicast from the server). Cosmetic. This is the attacker's freeze; the
// victim gets its own inside the hit flash.
void AClockworksCharacter::MulticastHitstop_Implementation()
{
	ApplyHitstop();
}

// Runs on: all machines (multicast from the server). Cosmetic. No owner-skip: a sound triggered by
// the server (a block, a death) was never predicted locally, and the ones that were predicted are
// played through PlaySoundLocal instead.
void AClockworksCharacter::MulticastPlaySound_Implementation(USoundBase* Sound)
{
	PlaySoundLocal(Sound);
}

// Runs on: the local machine only. Positional, so the other knight's sword is heard where it is.
void AClockworksCharacter::PlaySoundLocal(USoundBase* Sound, float VolumeMultiplier, float PitchMultiplier)
{
	if (Sound)
	{
		UGameplayStatics::PlaySoundAtLocation(this, Sound, GetActorLocation(), VolumeMultiplier, PitchMultiplier);
	}
}

// Runs on: all machines (multicast from the server). Cosmetic.
void AClockworksCharacter::MulticastPlaySoundPitched_Implementation(USoundBase* Sound, float VolumeMultiplier, float PitchMultiplier, bool bSkipPredictingOwner)
{
	if (bSkipPredictingOwner && !HasAuthority() && IsLocallyControlled())
	{
		return;
	}
	PlaySoundLocal(Sound, VolumeMultiplier, PitchMultiplier);
}

// Runs on: owning client and server. Each machine picks its own variant and pitch; they need not
// agree, any more than two players hear the same echo.
void AClockworksCharacter::PlayWeaponSound(const FClockworksWeaponSound& Sound, bool bFromServer, bool bOwnerPredicted)
{
	float Pitch = 1.f;
	USoundBase* Picked = Sound.Pick(Pitch);
	if (!Picked)
	{
		return;
	}
	if (bFromServer)
	{
		MulticastPlaySoundPitched(Picked, Sound.Volume, Pitch, bOwnerPredicted);
	}
	else
	{
		PlaySoundLocal(Picked, Sound.Volume, Pitch);
	}
}

// Runs on: owning client and server.
void AClockworksCharacter::PlayMoveSounds(const FClockworksWeaponSound& Sound, const FClockworksWeaponSound& Extra, USoundBase* Fallback, bool bFromServer)
{
	if (Sound.IsSet())
	{
		PlayWeaponSound(Sound, bFromServer);
	}
	else if (Fallback)
	{
		if (bFromServer)
		{
			MulticastPlaySound(Fallback);
		}
		else
		{
			PlaySoundLocal(Fallback);
		}
	}
	if (Extra.IsSet())
	{
		PlayWeaponSound(Extra, bFromServer);
	}
}

// Runs on: all machines (multicast from the server). Cosmetic.
void AClockworksCharacter::MulticastStopSlotAnimation_Implementation(FName SlotName)
{
	if (!HasAuthority() && IsLocallyControlled())
	{
		return;
	}
	StopSlotAnimation(0.1f, SlotName);
}

// Runs on: server only. The hum belongs to the charge, so the ability owns when it starts and stops.
void AClockworksCharacter::SetChargeLoop(bool bPlaying)
{
	if (!HasAuthority())
	{
		return;
	}
	MulticastSetChargeLoop(bPlaying);
}

// Runs on: the local machine only. Idempotent: the owning client starts its own on prediction and the
// multicast arrives afterwards, and starting an already-running loop must not layer a second copy.
void AClockworksCharacter::ShowChargeLoop(bool bPlaying)
{
	if (bPlaying)
	{
		if (ChargeLoopSound && !ChargeLoopAudio)
		{
			// Attached, so the hum follows the knight while the charge is walked around.
			ChargeLoopAudio = UGameplayStatics::SpawnSoundAttached(ChargeLoopSound, GetRootComponent());
		}
	}
	else if (ChargeLoopAudio)
	{
		ChargeLoopAudio->Stop();
		ChargeLoopAudio = nullptr;
	}
}

// Runs on: all machines (multicast from the server). Cosmetic.
void AClockworksCharacter::MulticastSetChargeLoop_Implementation(bool bPlaying)
{
	ShowChargeLoop(bPlaying);
}

// Runs on: server only. The aura is held, not blinked, so a charged knight is readable the whole time.
void AClockworksCharacter::SetChargeReady(bool bReady)
{
	if (!HasAuthority())
	{
		return;
	}
	MulticastSetChargeReady(bReady);
}

// Runs on: the local machine only. Shares the overlay slot with the hit flash; ClearHitFlash puts the
// aura back rather than wiping it, so being hit mid-charge does not lose the cue.
void AClockworksCharacter::ShowChargeReady(bool bReady)
{
	const bool bWasReady = bChargeReadyShown;
	bChargeReadyShown = bReady;
	if (bReady && !bWasReady)
	{
		PlaySoundLocal(ChargeReadySound);
	}
	UMaterialInterface* Material = ChargeReadyFlashMaterial ? ChargeReadyFlashMaterial : HitFlashMaterial;
	if (bReady && Material)
	{
		GetWorldTimerManager().ClearTimer(HitFlashTimer);
		GetMesh()->SetOverlayMaterial(Material);
	}
	else if (!bReady)
	{
		GetMesh()->SetOverlayMaterial(nullptr);
	}
}

// Runs on: all machines (multicast from the server). Cosmetic. No owner-skip: the owning client set
// its own on prediction, and setting the same material twice costs nothing.
void AClockworksCharacter::MulticastSetChargeReady_Implementation(bool bReady)
{
	ShowChargeReady(bReady);
}

// ---------------------------------------------------------------------------------------------
// Shield
// ---------------------------------------------------------------------------------------------

// Runs on: server only. The ability's decision made into replicated state; the server's own copy
// (the listen host's screen) shows it straight away.
void AClockworksCharacter::SetShieldRaised(bool bRaised)
{
	if (!HasAuthority())
	{
		return;
	}
	bShieldRaised = bRaised;
	ShowShieldRaised(bRaised);
}

// Runs on: clients, when the server's value arrives. On the owner it only confirms the prediction.
void AClockworksCharacter::OnRep_ShieldRaised()
{
	ShowShieldRaised(bShieldRaised);
}

// Runs on: this machine only. Cosmetic: the model moves to the arm, the raise clip plays, then the
// hold loop; lowering stops the clip and puts the model back.
void AClockworksCharacter::ShowShieldRaised(bool bRaised)
{
	if (bShieldShownRaised == bRaised)
	{
		return;
	}
	bShieldShownRaised = bRaised;
	PlaySoundLocal(bRaised ? ShieldRaiseSound : ShieldLowerSound);
	RefreshShieldAttachment();
	RefreshShieldBubble();
	GetWorldTimerManager().ClearTimer(ShieldAnimTimer);

	// The shield lives on the upper body, so raising it never stops the legs: the knight walks at half
	// speed with the shield up, as in Spiral Knights, and a shield bash can still take the whole body.
	if (!bRaised)
	{
		StopSlotAnimation(0.1f, UpperBodySlotName);
		return;
	}
	if (ShieldRaiseAnim && ShieldRaiseSeconds > 0.f)
	{
		const float Length = ShieldRaiseAnim->GetPlayLength();
		PlaySlotAnimation(ShieldRaiseAnim, Length > 0.f ? Length / ShieldRaiseSeconds : 1.f, false, UpperBodySlotName);
		GetWorldTimerManager().SetTimer(ShieldAnimTimer, this, &AClockworksCharacter::PlayShieldHold, ShieldRaiseSeconds, false);
	}
	else
	{
		PlayShieldHold();
	}
}

// Runs on: this machine only. The hold loop at its natural speed, as long as the shield is still up.
void AClockworksCharacter::PlayShieldHold()
{
	if (bShieldShownRaised && ShieldHoldAnim && !IsDead())
	{
		PlaySlotAnimation(ShieldHoldAnim, 1.f, true, UpperBodySlotName);
	}
}

// Runs on: this machine only.
void AClockworksCharacter::RefreshShieldAttachment()
{
	if (!ShieldMesh || !GetMesh())
	{
		return;
	}
	if (!bShieldBaseScaleCaptured)
	{
		ShieldMeshBaseScale = ShieldMesh->GetRelativeScale3D();
		bShieldBaseScaleCaptured = true;
	}
	ShieldMesh->AttachToComponent(GetMesh(), FAttachmentTransformRules::SnapToTargetNotIncludingScale, bShieldShownRaised ? ShieldRaisedSocket : ShieldAwaySocket);

	// The knight's own placement for the bone, with a compound shield's placement (Targe, Tortafist) inside it: the
	// original composes attachment ∘ compound, which in Unreal's child-first order is compound * attachment.
	FTransform Placement = bShieldShownRaised ? ShieldRaisedPlacement : ShieldAwayPlacement;
	if (const UClockworksGearDefinition* Shield = ShownShield.Get())
	{
		Placement = Shield->MeshOffset * Placement;
	}
	Placement.SetScale3D(Placement.GetScale3D() * ShieldMeshBaseScale);
	ShieldMesh->SetRelativeTransform(Placement);
}

// Runs on: this machine only. Everything it reads is replicated to everyone (bShieldRaised, the Shield
// attribute, State.ShieldBroken), so each machine paints the same dome and nothing is sent for it.
// Called whenever one of those changes, which is why the dome never needs to tick.
void AClockworksCharacter::RefreshShieldBubble()
{
	if (!ShieldBubbleMesh)
	{
		return;
	}

	const UAbilitySystemComponent* AbilitySystemComponent = GetAbilitySystemComponent();
	const bool bBroken = AbilitySystemComponent && AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_ShieldBroken);
	const bool bKnightDead = IsDead();

	// Spiral Knights collapses the dome when the shield shatters: a red aura at the feet for the eight
	// seconds it is down, then a cyan flash at the feet when it comes back. Both use the same flattened
	// shape, so one component covers all three looks.
	const bool bShowAura = !bKnightDead && (bBroken || bShieldRestoredFlash);
	const bool bShowDome = !bKnightDead && !bBroken && bShieldShownRaised;

	if (!bShowAura && !bShowDome)
	{
		ShieldBubbleMesh->SetHiddenInGame(true);
		return;
	}

	// The engine sphere is 100 cm across, so a scale of Radius/50 gives the radius asked for and
	// Height/100 flattens it to that thickness.
	const float Radius = FMath::Max(ShieldBubbleRadius, 1.f);
	const float FeetZ = -GetCapsuleComponent()->GetScaledCapsuleHalfHeight();
	FLinearColor Color;

	if (bShowAura)
	{
		const float Height = FMath::Max(ShieldAuraHeight, 0.1f);
		ShieldBubbleMesh->SetRelativeLocation(FVector(0.f, 0.f, FeetZ + Height * 0.5f));
		ShieldBubbleMesh->SetRelativeScale3D(FVector(Radius / 50.f, Radius / 50.f, Height / 100.f));
		Color = bBroken ? ShieldBrokenColor : ShieldRestoredColor;
	}
	else
	{
		// Centred on the floor, not on the knight: the bottom half is buried and what shows is a dome,
		// the way Spiral Knights draws it. The floor hides the far side, so there is no inside-out look.
		ShieldBubbleMesh->SetRelativeLocation(FVector(0.f, 0.f, FeetZ + ShieldBubbleCentreHeight));
		ShieldBubbleMesh->SetRelativeScale3D(FVector(Radius / 50.f));
		Color = GetShieldBubbleColor();
	}

	if (ShieldBubbleMaterialInstance)
	{
		ShieldBubbleMaterialInstance->SetVectorParameterValue(ShieldBubbleColorParameter, Color);
	}
	ShieldBubbleMesh->SetHiddenInGame(false);
}

// Runs on: this machine only. Entry zero is an empty shield, the last entry a full one.
FLinearColor AClockworksCharacter::GetShieldBubbleColor() const
{
	if (ShieldBubbleColors.Num() == 0)
	{
		return FLinearColor::White;
	}
	if (ShieldBubbleColors.Num() == 1)
	{
		return ShieldBubbleColors[0];
	}

	float Fraction = 1.f;
	if (const UAbilitySystemComponent* AbilitySystemComponent = GetAbilitySystemComponent())
	{
		if (const UClockworksAttributeSet* Attributes = AbilitySystemComponent->GetSet<UClockworksAttributeSet>())
		{
			const float MaxShield = Attributes->GetMaxShield();
			Fraction = MaxShield > 0.f ? FMath::Clamp(Attributes->GetShield() / MaxShield, 0.f, 1.f) : 1.f;
		}
	}

	const float Position = Fraction * (ShieldBubbleColors.Num() - 1);
	const int32 Low = FMath::Clamp(FMath::FloorToInt(Position), 0, ShieldBubbleColors.Num() - 2);
	return FMath::Lerp(ShieldBubbleColors[Low], ShieldBubbleColors[Low + 1], Position - Low);
}

// Runs on: every machine that receives the attribute (all of them). Only the dome's colour depends on it.
void AClockworksCharacter::OnShieldAttributeChanged(const FOnAttributeChangeData& Data)
{
	RefreshShieldBubble();
}

// Runs on: every machine (the server adds and removes the tag with TagAndCountToAll).
void AClockworksCharacter::OnShieldBrokenTagChanged(const FGameplayTag Tag, int32 NewCount)
{
	if (NewCount <= 0 && ShieldRestoredFlashSeconds > 0.f)
	{
		// Spiral Knights flashes cyan at the knight's feet when the shield is usable again, whether or
		// not it is raised at that moment. It is the only signal that the eight seconds are up.
		bShieldRestoredFlash = true;
		GetWorldTimerManager().SetTimer(ShieldRestoredFlashTimer, this, &AClockworksCharacter::EndShieldRestoredFlash, ShieldRestoredFlashSeconds, false);
	}
	RefreshShieldBubble();
}

// Runs on: this machine only.
void AClockworksCharacter::EndShieldRestoredFlash()
{
	bShieldRestoredFlash = false;
	RefreshShieldBubble();
}

// Runs on: all machines (multicast from the server). Cosmetic: the block clip, then back to the hold.
// Nobody predicted this one, so no owner skip.
void AClockworksCharacter::MulticastShieldHit_Implementation()
{
	PlaySoundLocal(ShieldBlockSound);

	if (!ShieldHitAnim || IsDead())
	{
		return;
	}
	const float Length = ShieldHitAnim->GetPlayLength();
	PlaySlotAnimation(ShieldHitAnim, (ShieldHitSeconds > 0.f && Length > 0.f) ? Length / ShieldHitSeconds : 1.f, false, UpperBodySlotName);
	GetWorldTimerManager().SetTimer(ShieldAnimTimer, this, &AClockworksCharacter::PlayShieldHold, FMath::Max(ShieldHitSeconds, 0.01f), false);
}

// Runs on: server only (bound to the attribute set on the server). The block itself already
// happened in the attribute set; this is the refill delay and the clip.
void AClockworksCharacter::HandleBlocked(float Absorbed, FVector HitDirection, float KnockbackMultiplier)
{
	TimeSinceShieldHit = 0.f;
	MulticastShieldHit();
}

// Runs on: server only. The break is a replicated tag: the shield ability refuses to start while it is
// present on any machine, and the one running now is cancelled (the cancel replicates to the owner).
void AClockworksCharacter::HandleShieldBroken()
{
	TimeSinceShieldHit = 0.f;
	if (UAbilitySystemComponent* AbilitySystemComponent = GetAbilitySystemComponent())
	{
		AbilitySystemComponent->AddLooseGameplayTag(ClockworksTags::State_ShieldBroken, 1, EGameplayTagReplicationState::TagAndCountToAll);
		const FGameplayTagContainer ShieldTags(ClockworksTags::Ability_Shield);
		AbilitySystemComponent->CancelAbilities(&ShieldTags);
	}
	MulticastHitFlash();
	MulticastPlaySound(ShieldBreakSound);
	const UClockworksGearDefinition* WornShield = WornShieldOf(this);
	const float BrokenSeconds = WornShield ? WornShield->ShieldBreakSeconds : ShieldBrokenSeconds;
	UE_LOG(LogClockworks, Log, TEXT("%s: shield shattered, down for %.1fs"), *GetNameSafe(this), BrokenSeconds);
	GetWorldTimerManager().SetTimer(ShieldBrokenTimer, this, &AClockworksCharacter::ClearShieldBroken, FMath::Max(BrokenSeconds, 0.01f), false);
}

// Runs on: server only. The refill starts at once when the break lifts.
void AClockworksCharacter::ClearShieldBroken()
{
	if (UAbilitySystemComponent* AbilitySystemComponent = GetAbilitySystemComponent())
	{
		AbilitySystemComponent->SetLooseGameplayTagCount(ClockworksTags::State_ShieldBroken, 0, EGameplayTagReplicationState::TagAndCountToAll);
	}
	const UClockworksGearDefinition* WornShield = WornShieldOf(this);
	TimeSinceShieldHit = WornShield ? WornShield->ShieldHitSeconds : ShieldRegenDelaySeconds;
}

// Runs on: server only (from Tick). Spiral Knights: a shield that goes a few seconds without blocking
// refills; a shattered one waits out the break first. The attribute replicates to everyone.
void AClockworksCharacter::TickShieldRegen(float DeltaSeconds)
{
	if (bDeathHandled)
	{
		return;
	}
	UAbilitySystemComponent* AbilitySystemComponent = GetAbilitySystemComponent();
	AClockworksPlayerState* ClockworksPlayerState = GetPlayerState<AClockworksPlayerState>();
	UClockworksAttributeSet* Attributes = ClockworksPlayerState ? ClockworksPlayerState->GetAttributeSet() : nullptr;
	if (!AbilitySystemComponent || !Attributes || AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_ShieldBroken))
	{
		return;
	}

	const float MaxShield = Attributes->GetMaxShield();
	if (MaxShield <= 0.f || Attributes->GetShield() >= MaxShield)
	{
		return;
	}

	// The worn shield's own hit and refill times (the original's hitTime / regenTime) win over the character's.
	const UClockworksGearDefinition* WornShield = WornShieldOf(this);
	TimeSinceShieldHit += DeltaSeconds;
	if (TimeSinceShieldHit < (WornShield ? WornShield->ShieldHitSeconds : ShieldRegenDelaySeconds))
	{
		return;
	}
	const float Rate = MaxShield / FMath::Max(WornShield ? WornShield->ShieldRegenSeconds : ShieldRegenSeconds, 0.1f);
	Attributes->SetShield(FMath::Min(MaxShield, Attributes->GetShield() + Rate * DeltaSeconds));
}
