// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksEnemyCharacter.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksEnemyAIController.h"
#include "ClockworksGameplayTags.h"
#include "AbilitySystemComponent.h"
#include "Abilities/GameplayAbility.h"
#include "Animation/AnimInstance.h"
#include "Animation/AnimMontage.h"
#include "GameFramework/Controller.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/World.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Materials/MaterialInterface.h"
#include "TimerManager.h"

// Runs on: all machines (class default object and every instance).
AClockworksEnemyCharacter::AClockworksEnemyCharacter()
{
	AbilitySystemComponent = CreateDefaultSubobject<UAbilitySystemComponent>(TEXT("AbilitySystemComponent"));
	AbilitySystemComponent->SetIsReplicated(true);

	// Minimal: attributes still replicate; effects and tags stay on the server, which is where every
	// check on an enemy runs. Cheapest mode, and the right one for AI-controlled actors.
	AbilitySystemComponent->SetReplicationMode(EGameplayEffectReplicationMode::Minimal);

	AttributeSet = CreateDefaultSubobject<UClockworksAttributeSet>(TEXT("AttributeSet"));

	HeadMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("HeadMesh"));
	HeadMesh->SetupAttachment(GetMesh(), HeadSocketName);
	HeadMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	// Enemies face the way they move; attacks turn them explicitly during the telegraph.
	bUseControllerRotationYaw = false;
	GetCharacterMovement()->bOrientRotationToMovement = true;
	GetCharacterMovement()->RotationRate = FRotator(0.f, 540.f, 0.f);
	GetCharacterMovement()->bConstrainToPlane = true;
	GetCharacterMovement()->bSnapToPlaneAtStart = true;

	// Every enemy gets the shared brain unless a Blueprint child says otherwise. AI controllers only
	// exist on the server, so this is where all enemy decisions are made.
	AIControllerClass = AClockworksEnemyAIController::StaticClass();
	AutoPossessAI = EAutoPossessAI::PlacedInWorldOrSpawned;
}

// Runs on: all machines. The component needs to know its owner and avatar everywhere so replicated
// attributes land in the right place; gameplay setup below is server only.
void AClockworksEnemyCharacter::PostInitializeComponents()
{
	Super::PostInitializeComponents();

	AbilitySystemComponent->InitAbilityActorInfo(this, this);

	if (HasAuthority())
	{
		AttributeSet->InitMaxHealth(InitialHealth);
		AttributeSet->InitHealth(InitialHealth);
		AttributeSet->InitAttackPower(InitialAttackPower);
		AttributeSet->InitDefensePower(InitialDefensePower);
		AttributeSet->InitMoveSpeed(InitialMoveSpeed);

		AbilitySystemComponent->AddLooseGameplayTag(ClockworksTags::Faction_Enemy, 1, EGameplayTagReplicationState::None);

		for (const TSubclassOf<UGameplayAbility>& AbilityClass : DefaultAbilities)
		{
			if (AbilityClass)
			{
				AbilitySystemComponent->GiveAbility(FGameplayAbilitySpec(AbilityClass, 1, INDEX_NONE, this));
			}
		}

		AttributeSet->OnDamaged.AddUObject(this, &AClockworksEnemyCharacter::HandleDamaged);
		AttributeSet->OnOutOfHealth.AddUObject(this, &AClockworksEnemyCharacter::HandleOutOfHealth);
		AbilitySystemComponent->RegisterGameplayTagEvent(ClockworksTags::State_MovementLocked, EGameplayTagEventType::NewOrRemoved).AddUObject(this, &AClockworksEnemyCharacter::OnMovementLockChanged);
	}

	GetCharacterMovement()->MaxWalkSpeed = InitialMoveSpeed;
}

// Runs on: server only (the tag is added by the server-only attack ability). Enemy movement is
// server-authoritative, so the speed change reaches clients as replicated motion.
void AClockworksEnemyCharacter::OnMovementLockChanged(const FGameplayTag Tag, int32 NewCount)
{
	GetCharacterMovement()->MaxWalkSpeed = NewCount > 0 ? 0.f : InitialMoveSpeed;
}

// Runs on: server only (bound to the attribute set on the server). Knockback is gameplay: this actor
// is server-controlled, so the resulting movement reaches clients through normal replication.
void AClockworksEnemyCharacter::HandleDamaged(AActor* InstigatorActor, AActor* Causer, float Amount, FVector HitDirection)
{
	if (bDead)
	{
		return;
	}

	LaunchCharacter(HitDirection * KnockbackSpeed, true, false);
	MulticastHitFlash();
}

// Runs on: all machines (multicast from the server). Cosmetic.
void AClockworksEnemyCharacter::MulticastHitFlash_Implementation()
{
	if (!HitFlashMaterial)
	{
		return;
	}

	GetMesh()->SetOverlayMaterial(HitFlashMaterial);
	GetWorldTimerManager().SetTimer(HitFlashTimer, this, &AClockworksEnemyCharacter::ClearHitFlash, FMath::Max(HitFlashSeconds, 0.01f), false);
}

// Runs on: all machines.
void AClockworksEnemyCharacter::ClearHitFlash()
{
	GetMesh()->SetOverlayMaterial(nullptr);
}

// Runs on: server only. Hidden and collision state replicate; the destroy replicates as removal.
void AClockworksEnemyCharacter::HandleOutOfHealth()
{
	if (bDead)
	{
		return;
	}
	bDead = true;

	AbilitySystemComponent->AddLooseGameplayTag(ClockworksTags::State_Dead, 1, EGameplayTagReplicationState::None);
	AbilitySystemComponent->CancelAllAbilities();

	if (AController* MyController = GetController())
	{
		MyController->StopMovement();
	}

	SetActorEnableCollision(false);
	GetCharacterMovement()->DisableMovement();

	// With a death clip the body stays and plays it out; without one it just vanishes as before.
	if (DeathMontage)
	{
		MulticastPlayDeathMontage();
	}
	else
	{
		SetActorHiddenInGame(true);
	}
	SetLifeSpan(FMath::Max(DeathDestroyDelay, 0.01f));
}

// Runs on: all machines (multicast from the server). Cosmetic. Played straight on the animation
// instance rather than through the ability system, since the enemy's abilities were just cancelled.
void AClockworksEnemyCharacter::MulticastPlayDeathMontage_Implementation()
{
	if (UAnimInstance* AnimInstance = GetMesh() ? GetMesh()->GetAnimInstance() : nullptr)
	{
		if (DeathMontage)
		{
			AnimInstance->Montage_Play(DeathMontage);
		}
	}
}
