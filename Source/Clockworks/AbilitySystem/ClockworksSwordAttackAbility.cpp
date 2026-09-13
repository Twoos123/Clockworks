// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksSwordAttackAbility.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksDamageEffect.h"
#include "ClockworksGameplayTags.h"
#include "AbilitySystemComponent.h"
#include "AbilitySystemInterface.h"
#include "Abilities/Tasks/AbilityTask_ApplyRootMotionConstantForce.h"
#include "Abilities/Tasks/AbilityTask_PlayMontageAndWait.h"
#include "Abilities/Tasks/AbilityTask_WaitDelay.h"
#include "Abilities/Tasks/AbilityTask_WaitInputPress.h"
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
	AbilityInputID = EClockworksAbilityInputID::Attack;

	// Owned for the whole activation: slows movement (character) and blocks the dodge.
	ActivationOwnedTags.AddTag(ClockworksTags::State_Attacking);

	ActivationBlockedTags.AddTag(ClockworksTags::State_Attacking);
	ActivationBlockedTags.AddTag(ClockworksTags::State_Dodging);
	ActivationBlockedTags.AddTag(ClockworksTags::State_Dead);

	// Calibur-style three-hit combo. A single press is one quick swing with no recovery; the
	// follow-ups are where the knight commits and cannot walk out.
	FClockworksSwordComboStep First;
	First.WindupSeconds = 0.15f;
	First.ActiveSeconds = 0.15f;
	First.RecoverySeconds = 0.f;
	ComboSteps.Add(First);

	FClockworksSwordComboStep Second;
	Second.WindupSeconds = 0.15f;
	Second.ActiveSeconds = 0.15f;
	Second.RecoverySeconds = 0.3f;
	Second.bLockMovementDuringRecovery = true;
	ComboSteps.Add(Second);

	FClockworksSwordComboStep Third;
	Third.WindupSeconds = 0.2f;
	Third.ActiveSeconds = 0.2f;
	Third.RecoverySeconds = 0.5f;
	Third.bLockMovementDuringRecovery = true;
	Third.DamageMultiplier = 1.5f;
	ComboSteps.Add(Third);
}

// Runs on: wherever the instance runs. Always valid: a class with no steps configured still gets one.
const FClockworksSwordComboStep& UClockworksSwordAttackAbility::GetCurrentStep() const
{
	static const FClockworksSwordComboStep Fallback;
	return ComboSteps.IsValidIndex(CurrentStepIndex) ? ComboSteps[CurrentStepIndex] : Fallback;
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

	CurrentStepIndex = 0;
	bNextStepQueued = false;
	StartStep(0);
}

// Runs on: owning client and server.
void UClockworksSwordAttackAbility::StartStep(int32 StepIndex)
{
	CurrentStepIndex = StepIndex;
	bNextStepQueued = false;
	HitActors.Reset();

	const FClockworksSwordComboStep& Step = GetCurrentStep();

	// Windup: face where you were facing when you pressed the button. A committed recovery from
	// the previous step is over once the next swing starts.
	RemoveLocalTag(ClockworksTags::State_MovementLocked);
	AddLocalTag(ClockworksTags::State_RotationLocked);

	// Visuals only. The ability system replicates the montage to other clients on its own.
	if (Step.Montage && CurrentActorInfo && CurrentActorInfo->GetAnimInstance())
	{
		UAbilityTask_PlayMontageAndWait* MontageTask = UAbilityTask_PlayMontageAndWait::CreatePlayMontageAndWaitProxy(this, NAME_None, Step.Montage, Step.MontagePlayRate, NAME_None, /*bStopWhenAbilityEnds*/ true);
		MontageTask->ReadyForActivation();
	}

	// Listen for the follow-up press. The press arrives here on the client directly and on the
	// server through the ability system's replicated input event, so both copies chain together.
	if (InputTask)
	{
		InputTask->EndTask();
		InputTask = nullptr;
	}
	if (ComboSteps.IsValidIndex(StepIndex + 1))
	{
		InputTask = UAbilityTask_WaitInputPress::WaitInputPress(this, /*bTestAlreadyPressed*/ false);
		InputTask->OnPress.AddDynamic(this, &UClockworksSwordAttackAbility::OnAttackPressed);
		InputTask->ReadyForActivation();
	}

	UAbilityTask_WaitDelay* Windup = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(Step.WindupSeconds));
	Windup->OnFinish.AddDynamic(this, &UClockworksSwordAttackAbility::OnWindupFinished);
	Windup->ReadyForActivation();
}

// Runs on: owning client and server, when the attack button is pressed during a step.
void UClockworksSwordAttackAbility::OnAttackPressed(float TimeWaited)
{
	bNextStepQueued = true;
}

// Runs on: owning client and server. The hitbox only opens on the server.
void UClockworksSwordAttackAbility::OnWindupFinished()
{
	ACharacter* Avatar = GetAvatarCharacter();
	const FClockworksSwordComboStep& Step = GetCurrentStep();

	if (Avatar && Step.LungeSpeed > 0.f)
	{
		// The forward step of the swing. A root motion source rather than a launch so ground friction
		// cannot eat it; the movement component predicts it on the owning client and reconciles it
		// with the server like any other move. The clips cannot supply this as animation root motion
		// because the exported skeleton's root bone never moves.
		FVector Direction = Avatar->GetActorForwardVector();
		Direction.Z = 0.f;
		UAbilityTask_ApplyRootMotionConstantForce* Lunge = UAbilityTask_ApplyRootMotionConstantForce::ApplyRootMotionConstantForce(
			this, NAME_None, Direction.GetSafeNormal(), Step.LungeSpeed, ClampPhaseSeconds(Step.ActiveSeconds), /*bIsAdditive*/ false, /*StrengthOverTime*/ nullptr,
			ERootMotionFinishVelocityMode::SetVelocity, FVector::ZeroVector, 0.f, /*bEnableGravity*/ false);
		Lunge->ReadyForActivation();
	}

	if (HasServerAuthority())
	{
		DoHitCheck();
		if (UWorld* World = GetWorld())
		{
			World->GetTimerManager().SetTimer(HitCheckTimer, this, &UClockworksSwordAttackAbility::DoHitCheck, HitCheckInterval, true);
		}
	}

	UAbilityTask_WaitDelay* Active = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(Step.ActiveSeconds));
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
	SpecHandle.Data->SetSetByCallerMagnitude(ClockworksTags::Data_Damage, BaseDamage * GetCurrentStep().DamageMultiplier + AttackPower);

	SourceAbilitySystemComponent->ApplyGameplayEffectSpecToTarget(*SpecHandle.Data, TargetAbilitySystemComponent);
}

// Runs on: owning client and server. Either chains into the queued step or starts recovery.
void UClockworksSwordAttackAbility::OnActiveFinished()
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(HitCheckTimer);
	}

	// Loose tags are counted, so every StartStep's add needs exactly one remove or the aim lock
	// outlives the combo. The next step adds it back for its own windup.
	RemoveLocalTag(ClockworksTags::State_RotationLocked);

	if (bNextStepQueued && ComboSteps.IsValidIndex(CurrentStepIndex + 1))
	{
		StartStep(CurrentStepIndex + 1);
		return;
	}

	// Recovery: can turn again, still can't act. Committed swings also plant the feet.
	const FClockworksSwordComboStep& Step = GetCurrentStep();
	if (Step.RecoverySeconds <= 0.f)
	{
		EndAbility(CurrentSpecHandle, CurrentActorInfo, CurrentActivationInfo, true, false);
		return;
	}

	if (Step.bLockMovementDuringRecovery)
	{
		AddLocalTag(ClockworksTags::State_MovementLocked);
	}

	UAbilityTask_WaitDelay* Recovery = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(Step.RecoverySeconds));
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
	if (InputTask)
	{
		InputTask->EndTask();
		InputTask = nullptr;
	}
	RemoveLocalTag(ClockworksTags::State_RotationLocked);
	RemoveLocalTag(ClockworksTags::State_MovementLocked);

	Super::EndAbility(Handle, ActorInfo, ActivationInfo, bReplicateEndAbility, bWasCancelled);
}
