// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksSwordAttackAbility.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksDamageEffect.h"
#include "ClockworksGameplayTags.h"
#include "AbilitySystemComponent.h"
#include "AbilitySystemInterface.h"
#include "Abilities/Tasks/AbilityTask_WaitDelay.h"
#include "Abilities/Tasks/AbilityTask_PlayMontageAndWait.h"
#include "Animation/AnimMontage.h"
#include "CollisionQueryParams.h"
#include "DrawDebugHelpers.h"
#include "Engine/OverlapResult.h"
#include "Engine/World.h"
#include "GameFramework/Character.h"
#include "TimerManager.h"

// Runs on: all machines (class default object).
UClockworksSwordAttackAbility::UClockworksSwordAttackAbility()
{
	SetAssetTags(FGameplayTagContainer(ClockworksTags::Ability_Attack_Sword));

	// Owned for the whole activation: slows movement (character) and blocks the dodge.
	ActivationOwnedTags.AddTag(ClockworksTags::State_Attacking);

	ActivationBlockedTags.AddTag(ClockworksTags::State_Attacking);
	ActivationBlockedTags.AddTag(ClockworksTags::State_Dodging);
	ActivationBlockedTags.AddTag(ClockworksTags::State_Dead);
}

// Runs on: owning client (predicted) and server, each on its own instance. Super is deliberately
// not called: the engine's default ActivateAbility commits the ability itself, which would double up.
void UClockworksSwordAttackAbility::ActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, const FGameplayEventData* TriggerEventData)
{
	if (!CommitAbility(Handle, ActorInfo, ActivationInfo))
	{
		EndAbility(Handle, ActorInfo, ActivationInfo, true, true);
		return;
	}

	HitActors.Reset();

	// Windup: face where you were facing when you pressed the button.
	AddLocalTag(ClockworksTags::State_RotationLocked);

	// Visuals only. The ability system replicates the montage to other clients on its own.
	if (AttackMontage && ActorInfo && ActorInfo->GetAnimInstance())
	{
		UAbilityTask_PlayMontageAndWait* MontageTask = UAbilityTask_PlayMontageAndWait::CreatePlayMontageAndWaitProxy(this, NAME_None, AttackMontage, MontagePlayRate, NAME_None, /*bStopWhenAbilityEnds*/ true);
		MontageTask->ReadyForActivation();
	}

	UAbilityTask_WaitDelay* Windup = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(WindupSeconds));
	Windup->OnFinish.AddDynamic(this, &UClockworksSwordAttackAbility::OnWindupFinished);
	Windup->ReadyForActivation();
}

// Runs on: owning client and server. The hitbox only opens on the server.
void UClockworksSwordAttackAbility::OnWindupFinished()
{
	ACharacter* Avatar = GetAvatarCharacter();

	if (Avatar && LungeSpeed > 0.f)
	{
		// LaunchCharacter does not replicate; both the predicting client and the server call it.
		Avatar->LaunchCharacter(Avatar->GetActorForwardVector() * LungeSpeed, true, false);
	}

	if (HasServerAuthority())
	{
		DoHitCheck();
		if (UWorld* World = GetWorld())
		{
			World->GetTimerManager().SetTimer(HitCheckTimer, this, &UClockworksSwordAttackAbility::DoHitCheck, HitCheckInterval, true);
		}
	}

	UAbilityTask_WaitDelay* Active = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(ActiveSeconds));
	Active->OnFinish.AddDynamic(this, &UClockworksSwordAttackAbility::OnActiveFinished);
	Active->ReadyForActivation();
}

// Runs on: server only (started from OnWindupFinished under HasServerAuthority).
void UClockworksSwordAttackAbility::DoHitCheck()
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
		DrawDebugSphere(World, Center, HitRadius, 16, FColor::Red, false, HitCheckInterval * 2.f);
	}

	TArray<FOverlapResult> Overlaps;
	FCollisionQueryParams QueryParams(TEXT("ClockworksSwordHit"), /*bTraceComplex*/ false, Avatar);
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
void UClockworksSwordAttackAbility::ApplyDamageTo(UAbilitySystemComponent* TargetAbilitySystemComponent, const FOverlapResult& Overlap)
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

	// Where the hit landed, for later effects. The context already carries instigator and causer.
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

// Runs on: owning client and server.
void UClockworksSwordAttackAbility::OnActiveFinished()
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(HitCheckTimer);
	}

	// Recovery: can turn again, still can't act, still slowed.
	RemoveLocalTag(ClockworksTags::State_RotationLocked);

	UAbilityTask_WaitDelay* Recovery = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(RecoverySeconds));
	Recovery->OnFinish.AddDynamic(this, &UClockworksSwordAttackAbility::OnRecoveryFinished);
	Recovery->ReadyForActivation();
}

// Runs on: owning client and server.
void UClockworksSwordAttackAbility::OnRecoveryFinished()
{
	EndAbility(CurrentSpecHandle, CurrentActorInfo, CurrentActivationInfo, true, false);
}

// Runs on: owning client and server, including on cancel. Leaves nothing running behind.
void UClockworksSwordAttackAbility::EndAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, bool bReplicateEndAbility, bool bWasCancelled)
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(HitCheckTimer);
	}
	RemoveLocalTag(ClockworksTags::State_RotationLocked);

	Super::EndAbility(Handle, ActorInfo, ActivationInfo, bReplicateEndAbility, bWasCancelled);
}
