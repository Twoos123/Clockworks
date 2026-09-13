// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksEnemyCharacter.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksGameplayTags.h"
#include "AbilitySystemComponent.h"
#include "Components/SkeletalMeshComponent.h"
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

	bUseControllerRotationYaw = false;
	GetCharacterMovement()->bOrientRotationToMovement = false;
	GetCharacterMovement()->bConstrainToPlane = true;
	GetCharacterMovement()->bSnapToPlaneAtStart = true;
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
		AttributeSet->InitMoveSpeed(InitialMoveSpeed);

		AbilitySystemComponent->AddLooseGameplayTag(ClockworksTags::Faction_Enemy, 1, EGameplayTagReplicationState::None);

		AttributeSet->OnDamaged.AddUObject(this, &AClockworksEnemyCharacter::HandleDamaged);
		AttributeSet->OnOutOfHealth.AddUObject(this, &AClockworksEnemyCharacter::HandleOutOfHealth);
	}

	GetCharacterMovement()->MaxWalkSpeed = InitialMoveSpeed;
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

	SetActorEnableCollision(false);
	GetCharacterMovement()->DisableMovement();
	SetActorHiddenInGame(true);
	SetLifeSpan(FMath::Max(DeathDestroyDelay, 0.01f));
}
