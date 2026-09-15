// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksEnemyRangedAbility.h"
#include "ClockworksAttackCooldownEffect.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksEnemyAIController.h"
#include "ClockworksGameplayTags.h"
#include "ClockworksWeaponDefinition.h"
#include "ClockworksEnemyCharacter.h"
#include "ClockworksProjectile.h"
#include "Sound/SoundBase.h"
#include "AbilitySystemComponent.h"
#include "Abilities/Tasks/AbilityTask_PlayMontageAndWait.h"
#include "Abilities/Tasks/AbilityTask_WaitDelay.h"
#include "Animation/AnimMontage.h"
#include "Engine/World.h"
#include "GameFramework/Character.h"
#include "GameFramework/CharacterMovementComponent.h"

// Runs on: all machines (class default object).
UClockworksEnemyRangedAbility::UClockworksEnemyRangedAbility()
{
	SetAssetTags(FGameplayTagContainer(ClockworksTags::Ability_Attack_Ranged));
	NetExecutionPolicy = EGameplayAbilityNetExecutionPolicy::ServerOnly;

	ActivationOwnedTags.AddTag(ClockworksTags::State_Attacking);

	ActivationBlockedTags.AddTag(ClockworksTags::State_Attacking);
	ActivationBlockedTags.AddTag(ClockworksTags::State_Dead);
	ActivationBlockedTags.AddTag(ClockworksTags::State_Stunned);
	ActivationBlockedTags.AddTag(ClockworksTags::Cooldown_Attack);

	CooldownGameplayEffectClass = UClockworksAttackCooldownEffect::StaticClass();
}

// Runs on: server only. Super is deliberately not called: the engine's default ActivateAbility commits
// the ability itself, which would double up.
void UClockworksEnemyRangedAbility::ActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, const FGameplayEventData* TriggerEventData)
{
	if (!CommitAbility(Handle, ActorInfo, ActivationInfo))
	{
		EndAbility(Handle, ActorInfo, ActivationInfo, true, true);
		return;
	}

	ACharacter* Avatar = GetAvatarCharacter();
	if (!Avatar || !ProjectileClass)
	{
		EndAbility(Handle, ActorInfo, ActivationInfo, true, true);
		return;
	}

	// The telegraph: face the target now; the shot goes where the target is at the moment of firing.
	if (const AClockworksEnemyAIController* AI = Cast<AClockworksEnemyAIController>(Avatar->GetController()))
	{
		if (const AActor* Target = AI->GetTargetActor())
		{
			FVector ToTarget = Target->GetActorLocation() - Avatar->GetActorLocation();
			ToTarget.Z = 0.f;
			if (!ToTarget.IsNearlyZero())
			{
				Avatar->SetActorRotation(ToTarget.Rotation());
			}
		}
	}

	Avatar->GetCharacterMovement()->StopMovementImmediately();
	AddLocalTag(ClockworksTags::State_MovementLocked);

	PlayPhaseMontage(WindupMontage ? WindupMontage.Get() : AttackMontage.Get());

	UAbilityTask_WaitDelay* Windup = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(WindupSeconds));
	Windup->OnFinish.AddDynamic(this, &UClockworksEnemyRangedAbility::OnWindupFinished);
	Windup->ReadyForActivation();
}

// Runs on: server only. Fires the shot, then starts recovery.
void UClockworksEnemyRangedAbility::OnWindupFinished()
{
	ACharacter* Avatar = GetAvatarCharacter();
	UAbilitySystemComponent* SourceAbilitySystemComponent = GetAbilitySystemComponentFromActorInfo();
	UWorld* World = Avatar ? Avatar->GetWorld() : nullptr;
	if (!Avatar || !SourceAbilitySystemComponent || !World || !ProjectileClass)
	{
		EndAbility(CurrentSpecHandle, CurrentActorInfo, CurrentActivationInfo, true, true);
		return;
	}

	if (WindupMontage)
	{
		PlayPhaseMontage(AttackMontage);
	}

	// Aim at the target's position right now; if it moved since the telegraph, the shot misses.
	FVector Direction = Avatar->GetActorForwardVector();
	if (const AClockworksEnemyAIController* AI = Cast<AClockworksEnemyAIController>(Avatar->GetController()))
	{
		if (const AActor* Target = AI->GetTargetActor())
		{
			FVector ToTarget = Target->GetActorLocation() - Avatar->GetActorLocation();
			ToTarget.Z = 0.f;
			if (!ToTarget.IsNearlyZero())
			{
				Direction = ToTarget.GetSafeNormal();
				Avatar->SetActorRotation(Direction.Rotation());
			}
		}
	}

	const FTransform AvatarTransform = Avatar->GetActorTransform();
	const FVector SpawnLocation = AvatarTransform.TransformPosition(MuzzleOffset);

	FActorSpawnParameters SpawnParams;
	SpawnParams.Owner = Avatar;
	SpawnParams.Instigator = Avatar;
	SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;

	if (AClockworksProjectile* Projectile = World->SpawnActor<AClockworksProjectile>(ProjectileClass, SpawnLocation, Direction.Rotation(), SpawnParams))
	{
		float AttackPower = 0.f;
		if (const UClockworksAttributeSet* SourceAttributes = SourceAbilitySystemComponent->GetSet<UClockworksAttributeSet>())
		{
			AttackPower = SourceAttributes->GetAttackPower();
		}
		// The original's damage at this depth, split by type, when the monster carries it; otherwise the flat number.
		float Parts[4];
		const bool bDepthDamage = DepthDamageParts(World, NormalDamageByDepth, PiercingDamageByDepth, ElementalDamageByDepth, ShadowDamageByDepth, Parts);
		const float BoltDamage = bDepthDamage ? Parts[0] + Parts[1] + Parts[2] + Parts[3] : BaseDamage + AttackPower;
		Projectile->InitProjectile(SourceAbilitySystemComponent, BoltDamage, Direction, ProjectileSpeed, 1.f, 0.f, ResolveDamageType());
		if (bDepthDamage)
		{
			Projectile->InitProjectileDamageParts(Parts);
		}
		if (const UClockworksWeaponDefinition* SourceWeapon = GetSourceWeapon(); SourceWeapon && SourceWeapon->StatusEffect)
		{
			Projectile->InitProjectileStatus(SourceWeapon->StatusEffect, SourceWeapon->StatusChance, SourceWeapon->StatusSeconds, SourceWeapon->StatusTickDamage);
		}
		else
		{
			Projectile->InitProjectileStatus(StatusEffect, StatusChance, StatusSeconds, StatusTickDamage);
		}
	}

	// Server only, so everyone hears the shot where the turret is.
	if (AClockworksEnemyCharacter* Enemy = Cast<AClockworksEnemyCharacter>(Avatar))
	{
		Enemy->MulticastPlaySound(FireSound);
	}

	if (WindupMontage)
	{
		PlayPhaseMontage(RecoveryMontage);
	}

	UAbilityTask_WaitDelay* Recovery = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(RecoverySeconds));
	Recovery->OnFinish.AddDynamic(this, &UClockworksEnemyRangedAbility::OnRecoveryFinished);
	Recovery->ReadyForActivation();
}

// Runs on: server only. The ability system replicates the montage to clients on its own.
void UClockworksEnemyRangedAbility::PlayPhaseMontage(UAnimMontage* Montage)
{
	if (Montage && CurrentActorInfo && CurrentActorInfo->GetAnimInstance())
	{
		UAbilityTask_PlayMontageAndWait* MontageTask = UAbilityTask_PlayMontageAndWait::CreatePlayMontageAndWaitProxy(this, NAME_None, Montage, MontagePlayRate, NAME_None, /*bStopWhenAbilityEnds*/ true);
		MontageTask->ReadyForActivation();
	}
}

// Runs on: server only.
void UClockworksEnemyRangedAbility::OnRecoveryFinished()
{
	EndAbility(CurrentSpecHandle, CurrentActorInfo, CurrentActivationInfo, true, false);
}

// Runs on: server only. The cooldown duration comes from the tunable, not from the effect asset.
void UClockworksEnemyRangedAbility::ApplyCooldown(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo) const
{
	if (!CooldownGameplayEffectClass)
	{
		return;
	}

	FGameplayEffectSpecHandle SpecHandle = MakeOutgoingGameplayEffectSpec(Handle, ActorInfo, ActivationInfo, CooldownGameplayEffectClass, GetAbilityLevel(Handle, ActorInfo));
	if (SpecHandle.IsValid())
	{
		SpecHandle.Data->SetSetByCallerMagnitude(ClockworksTags::Data_Cooldown, FMath::Max(CooldownSeconds, 0.01f));
		ApplyGameplayEffectSpecToOwner(Handle, ActorInfo, ActivationInfo, SpecHandle);
	}
}

// Runs on: server only, including on cancel.
void UClockworksEnemyRangedAbility::EndAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, bool bReplicateEndAbility, bool bWasCancelled)
{
	RemoveLocalTag(ClockworksTags::State_MovementLocked);
	Super::EndAbility(Handle, ActorInfo, ActivationInfo, bReplicateEndAbility, bWasCancelled);
}
