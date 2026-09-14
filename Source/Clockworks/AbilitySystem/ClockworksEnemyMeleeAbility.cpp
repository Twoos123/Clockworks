// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksEnemyMeleeAbility.h"
#include "ClockworksAttackCooldownEffect.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksDamageEffect.h"
#include "ClockworksEnemyAIController.h"
#include "ClockworksGameplayTags.h"
#include "AbilitySystemComponent.h"
#include "AbilitySystemInterface.h"
#include "Abilities/Tasks/AbilityTask_ApplyRootMotionConstantForce.h"
#include "Abilities/Tasks/AbilityTask_PlayMontageAndWait.h"
#include "Abilities/Tasks/AbilityTask_WaitDelay.h"
#include "Animation/AnimMontage.h"
#include "CollisionQueryParams.h"
#include "DrawDebugHelpers.h"
#include "Engine/OverlapResult.h"
#include "Engine/World.h"
#include "GameFramework/Character.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/RootMotionSource.h"
#include "TimerManager.h"

// Runs on: all machines (class default object).
UClockworksEnemyMeleeAbility::UClockworksEnemyMeleeAbility()
{
	SetAssetTags(FGameplayTagContainer(ClockworksTags::Ability_Attack_Melee));

	// Enemies are server-controlled; there is no client to predict for.
	NetExecutionPolicy = EGameplayAbilityNetExecutionPolicy::ServerOnly;

	// Owned for the whole activation so the AI controller knows the enemy is busy.
	ActivationOwnedTags.AddTag(ClockworksTags::State_Attacking);

	ActivationBlockedTags.AddTag(ClockworksTags::State_Attacking);
	ActivationBlockedTags.AddTag(ClockworksTags::State_Dead);
	ActivationBlockedTags.AddTag(ClockworksTags::Cooldown_Attack);

	CooldownGameplayEffectClass = UClockworksAttackCooldownEffect::StaticClass();
}

// Runs on: server only. Super is deliberately not called: the engine's default ActivateAbility commits
// the ability itself, which would double up.
void UClockworksEnemyMeleeAbility::ActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, const FGameplayEventData* TriggerEventData)
{
	if (!CommitAbility(Handle, ActorInfo, ActivationInfo))
	{
		EndAbility(Handle, ActorInfo, ActivationInfo, true, true);
		return;
	}

	ACharacter* Avatar = GetAvatarCharacter();
	if (!Avatar)
	{
		EndAbility(Handle, ActorInfo, ActivationInfo, true, true);
		return;
	}

	HitActors.Reset();

	// The telegraph: turn to the target once, then commit to that line. The rest of the attack does
	// not track the player, which is what makes stepping out of it a real answer.
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

	// Plant the feet for the whole attack. The controller stops pathing while State.Attacking is set;
	// this makes sure momentum from the chase doesn't carry through the windup.
	Avatar->GetCharacterMovement()->StopMovementImmediately();
	AddLocalTag(ClockworksTags::State_MovementLocked);

	// Visuals only. Either one clip for the whole attack, or the windup clip now and the rest per phase.
	PlayPhaseMontage(WindupMontage ? WindupMontage.Get() : AttackMontage.Get());

	UAbilityTask_WaitDelay* Windup = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(WindupSeconds));
	Windup->OnFinish.AddDynamic(this, &UClockworksEnemyMeleeAbility::OnWindupFinished);
	Windup->ReadyForActivation();
}

// Runs on: server only. The lunge and the live hitbox.
void UClockworksEnemyMeleeAbility::OnWindupFinished()
{
	ACharacter* Avatar = GetAvatarCharacter();
	if (!Avatar)
	{
		EndAbility(CurrentSpecHandle, CurrentActorInfo, CurrentActivationInfo, true, true);
		return;
	}

	if (WindupMontage)
	{
		PlayPhaseMontage(AttackMontage);
	}

	if (LungeSpeed > 0.f)
	{
		FVector Direction = Avatar->GetActorForwardVector();
		Direction.Z = 0.f;
		UAbilityTask_ApplyRootMotionConstantForce* Lunge = UAbilityTask_ApplyRootMotionConstantForce::ApplyRootMotionConstantForce(
			this, NAME_None, Direction.GetSafeNormal(), LungeSpeed, ClampPhaseSeconds(LungeSeconds), /*bIsAdditive*/ false, /*StrengthOverTime*/ nullptr,
			ERootMotionFinishVelocityMode::SetVelocity, FVector::ZeroVector, 0.f, /*bEnableGravity*/ false);
		Lunge->ReadyForActivation();
	}

	DoHitCheck();
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().SetTimer(HitCheckTimer, this, &UClockworksEnemyMeleeAbility::DoHitCheck, HitCheckInterval, true);
	}

	UAbilityTask_WaitDelay* Active = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(LungeSeconds));
	Active->OnFinish.AddDynamic(this, &UClockworksEnemyMeleeAbility::OnLungeFinished);
	Active->ReadyForActivation();
}

// Runs on: server only.
void UClockworksEnemyMeleeAbility::DoHitCheck()
{
	ACharacter* Avatar = GetAvatarCharacter();
	UAbilitySystemComponent* SourceAbilitySystemComponent = GetAbilitySystemComponentFromActorInfo();
	UWorld* World = Avatar ? Avatar->GetWorld() : nullptr;
	if (!Avatar || !SourceAbilitySystemComponent || !World)
	{
		return;
	}

	const FVector Center = Avatar->GetActorLocation() + Avatar->GetActorForwardVector() * HitForwardOffset;

	if (bDrawDebugHitbox)
	{
		DrawDebugSphere(World, Center, HitRadius, 16, FColor::Orange, false, HitCheckInterval * 2.f);
	}

	TArray<FOverlapResult> Overlaps;
	FCollisionQueryParams QueryParams(TEXT("ClockworksEnemyMeleeHit"), /*bTraceComplex*/ false, Avatar);
	World->OverlapMultiByObjectType(Overlaps, Center, FQuat::Identity, FCollisionObjectQueryParams(ECC_Pawn), FCollisionShape::MakeSphere(HitRadius), QueryParams);

	const FGameplayTag SourceFaction = GetFactionTag(SourceAbilitySystemComponent);

	for (const FOverlapResult& Overlap : Overlaps)
	{
		AActor* HitActor = Overlap.GetActor();
		if (!HitActor || HitActor == Avatar || HitActors.Contains(HitActor))
		{
			continue;
		}

		const IAbilitySystemInterface* TargetInterface = Cast<IAbilitySystemInterface>(HitActor);
		UAbilitySystemComponent* TargetAbilitySystemComponent = TargetInterface ? TargetInterface->GetAbilitySystemComponent() : nullptr;
		if (!TargetAbilitySystemComponent)
		{
			continue;
		}

		// No friendly fire, no hitting the dead, no hitting through i-frames.
		if (SourceFaction.IsValid() && TargetAbilitySystemComponent->HasMatchingGameplayTag(SourceFaction))
		{
			continue;
		}
		if (TargetAbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Dead) || TargetAbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Invulnerable))
		{
			continue;
		}

		HitActors.Add(HitActor);
		ApplyDamageTo(TargetAbilitySystemComponent, Overlap);
	}
}

// Runs on: server only. The target's attribute set applies defense and decides the outcome.
void UClockworksEnemyMeleeAbility::ApplyDamageTo(UAbilitySystemComponent* TargetAbilitySystemComponent, const FOverlapResult& Overlap)
{
	UAbilitySystemComponent* SourceAbilitySystemComponent = GetAbilitySystemComponentFromActorInfo();
	ACharacter* Avatar = GetAvatarCharacter();
	if (!SourceAbilitySystemComponent || !TargetAbilitySystemComponent || !Avatar)
	{
		return;
	}

	FGameplayEffectSpecHandle SpecHandle = MakeOutgoingGameplayEffectSpec(UClockworksDamageEffect::StaticClass(), GetAbilityLevel());
	if (!SpecHandle.IsValid())
	{
		return;
	}

	AActor* HitActor = Overlap.GetActor();
	const FHitResult Hit(HitActor, Overlap.GetComponent(), HitActor->GetActorLocation(), -Avatar->GetActorForwardVector());
	FGameplayEffectContextHandle Context = SpecHandle.Data->GetContext();
	Context.AddHitResult(Hit);

	float AttackPower = 0.f;
	if (const UClockworksAttributeSet* SourceAttributes = SourceAbilitySystemComponent->GetSet<UClockworksAttributeSet>())
	{
		AttackPower = SourceAttributes->GetAttackPower();
	}
	SpecHandle.Data->SetSetByCallerMagnitude(ClockworksTags::Data_Damage, BaseDamage + AttackPower);

	SourceAbilitySystemComponent->ApplyGameplayEffectSpecToTarget(*SpecHandle.Data, TargetAbilitySystemComponent);
}

// Runs on: server only. Recovery: the punish window.
void UClockworksEnemyMeleeAbility::OnLungeFinished()
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(HitCheckTimer);
	}

	if (WindupMontage)
	{
		PlayPhaseMontage(RecoveryMontage);
	}

	UAbilityTask_WaitDelay* Recovery = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(RecoverySeconds));
	Recovery->OnFinish.AddDynamic(this, &UClockworksEnemyMeleeAbility::OnRecoveryFinished);
	Recovery->ReadyForActivation();
}

// Runs on: server only. The ability system replicates the montage to clients on its own.
void UClockworksEnemyMeleeAbility::PlayPhaseMontage(UAnimMontage* Montage)
{
	if (Montage && CurrentActorInfo && CurrentActorInfo->GetAnimInstance())
	{
		UAbilityTask_PlayMontageAndWait* MontageTask = UAbilityTask_PlayMontageAndWait::CreatePlayMontageAndWaitProxy(this, NAME_None, Montage, MontagePlayRate, NAME_None, /*bStopWhenAbilityEnds*/ true);
		MontageTask->ReadyForActivation();
	}
}

// Runs on: server only.
void UClockworksEnemyMeleeAbility::OnRecoveryFinished()
{
	EndAbility(CurrentSpecHandle, CurrentActorInfo, CurrentActivationInfo, true, false);
}

// Runs on: server only. The cooldown duration comes from the tunable, not from the effect asset.
void UClockworksEnemyMeleeAbility::ApplyCooldown(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo) const
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

// Runs on: server only, including on cancel (death mid-attack). Leaves nothing running behind.
void UClockworksEnemyMeleeAbility::EndAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, bool bReplicateEndAbility, bool bWasCancelled)
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(HitCheckTimer);
	}
	RemoveLocalTag(ClockworksTags::State_MovementLocked);

	Super::EndAbility(Handle, ActorInfo, ActivationInfo, bReplicateEndAbility, bWasCancelled);
}
