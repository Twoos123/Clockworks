// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksSwordAttackAbility.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksCharacter.h"
#include "ClockworksDamageEffect.h"
#include "ClockworksGameplayTags.h"
#include "Clockworks.h"
#include "AbilitySystemComponent.h"
#include "AbilitySystemInterface.h"
#include "Abilities/Tasks/AbilityTask_ApplyRootMotionConstantForce.h"
#include "Abilities/Tasks/AbilityTask_PlayMontageAndWait.h"
#include "Abilities/Tasks/AbilityTask_WaitDelay.h"
#include "Abilities/Tasks/AbilityTask_WaitInputPress.h"
#include "Abilities/Tasks/AbilityTask_WaitInputRelease.h"
#include "Animation/AnimMontage.h"
#include "Animation/AnimSequenceBase.h"
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

	// Spiral Knights "Base (3 Hit)" at the Calibur's speeds (start 1.75, fire 1.0, end 2.0):
	// 0.233 s start clips become 0.133 s windups, the 0.217 s fire clips play as they are. Every
	// swing does the same damage; what changes is the forward step and the shove.
	FClockworksSwordComboStep First;   // Swing 0 (R-L): no step, a nudge of 0.6 tiles
	First.WindupSeconds = 0.133f;
	First.ActiveSeconds = 0.217f;
	First.RecoverySeconds = 0.f;       // free at once, the design the user chose over SK's 0.233 s rearm
	First.LungeSpeed = 0.f;
	First.KnockbackMultiplier = 0.25f;
	ComboSteps.Add(First);

	FClockworksSwordComboStep Second;  // Swing 1 (L-R): 1.25 tiles over 0.15 s after 0.1 s
	Second.WindupSeconds = 0.133f;
	Second.ActiveSeconds = 0.217f;
	Second.RecoverySeconds = 0.233f;   // SK rearm
	Second.bLockMovementDuringRecovery = true;
	Second.LungeSpeed = 833.f;
	Second.LungeSeconds = 0.15f;
	Second.LungeDelaySeconds = 0.1f;
	Second.KnockbackMultiplier = 1.f;
	ComboSteps.Add(Second);

	FClockworksSwordComboStep Third;   // Swing 2 (Around CW): 2.5 tiles over 0.2 s after 0.05 s, long rearm
	Third.WindupSeconds = 0.133f;
	Third.ActiveSeconds = 0.217f;
	Third.RecoverySeconds = 0.65f;     // SK rearms after 0.9 s; trimmed to the end clip. The user's number to tune.
	Third.bLockMovementDuringRecovery = true;
	Third.LungeSpeed = 1250.f;
	Third.LungeSeconds = 0.2f;
	Third.LungeDelaySeconds = 0.05f;
	Third.KnockbackMultiplier = 1.f;
	ComboSteps.Add(Third);
}

// Runs on: wherever the instance runs. Always valid: a class with no steps configured still gets one.
const FClockworksSwordComboStep& UClockworksSwordAttackAbility::GetCurrentStep() const
{
	static const FClockworksSwordComboStep Fallback;
	return ComboSteps.IsValidIndex(CurrentStepIndex) ? ComboSteps[CurrentStepIndex] : Fallback;
}

// Runs on: wherever the instance runs.
AClockworksCharacter* UClockworksSwordAttackAbility::GetKnight() const
{
	return Cast<AClockworksCharacter>(GetAvatarCharacter());
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
	bButtonHeld = true;
	bCharging = false;
	bChargeReady = false;
	bChargeAttacking = false;

	// The release arrives here on the client directly and on the server through the ability
	// system's replicated input event.
	// A release task fires once and ends itself, so every hold needs a fresh listener. Testing the
	// current input state means a press that already ended before we got here is caught too.
	if (!ReleaseTask)
	{
		ReleaseTask = UAbilityTask_WaitInputRelease::WaitInputRelease(this, /*bTestAlreadyReleased*/ true);
		ReleaseTask->OnRelease.AddDynamic(this, &UClockworksSwordAttackAbility::OnAttackReleased);
		ReleaseTask->ReadyForActivation();
	}

	StartStep(0);
}

// ---------------------------------------------------------------------------------------------
// Combo
// ---------------------------------------------------------------------------------------------

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

	if (Step.WindupAnim)
	{
		PlayPhaseAnim(Step.WindupAnim, Step.WindupSeconds);
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
	// A press is a new hold: the release that ends it is the one that matters for charging.
	bButtonHeld = true;
	bNextStepQueued = true;
	// A release task fires once and ends itself, so every hold needs a fresh listener. Testing the
	// current input state means a press that already ended before we got here is caught too.
	if (!ReleaseTask)
	{
		ReleaseTask = UAbilityTask_WaitInputRelease::WaitInputRelease(this, /*bTestAlreadyReleased*/ true);
		ReleaseTask->OnRelease.AddDynamic(this, &UClockworksSwordAttackAbility::OnAttackReleased);
		ReleaseTask->ReadyForActivation();
	}
}

// Runs on: owning client and server, when the attack button comes up at any point in the activation.
void UClockworksSwordAttackAbility::OnAttackReleased(float TimeWaited)
{
	bButtonHeld = false;
	ReleaseTask = nullptr; // the task ends itself after this callback
	UE_LOG(LogClockworks, Log, TEXT("Sword: attack released (charging=%d ready=%d authority=%d)"), bCharging, bChargeReady, HasServerAuthority());

	if (bCharging)
	{
		if (bChargeReady)
		{
			StartChargeAttack();
		}
		else
		{
			// Let go early: the charge is lost, the knight is simply free again.
			EndAbility(CurrentSpecHandle, CurrentActorInfo, CurrentActivationInfo, true, false);
		}
	}
}

// Runs on: owning client and server. The hitbox only opens on the server.
void UClockworksSwordAttackAbility::OnWindupFinished()
{
	const FClockworksSwordComboStep& Step = GetCurrentStep();

	if (Step.AttackAnim)
	{
		PlayPhaseAnim(Step.AttackAnim, Step.ActiveSeconds);
	}
	else if (Step.Montage && CurrentActorInfo && CurrentActorInfo->GetAnimInstance())
	{
		// The older montage path. The ability system replicates the montage to other clients itself.
		UAbilityTask_PlayMontageAndWait* MontageTask = UAbilityTask_PlayMontageAndWait::CreatePlayMontageAndWaitProxy(this, NAME_None, Step.Montage, Step.MontagePlayRate, NAME_None, /*bStopWhenAbilityEnds*/ true);
		MontageTask->ReadyForActivation();
	}

	if (Step.LungeSpeed > 0.f)
	{
		if (UWorld* World = GetWorld(); World && Step.LungeDelaySeconds > 0.f)
		{
			World->GetTimerManager().SetTimer(LungeTimer, this, &UClockworksSwordAttackAbility::StartStepLunge, Step.LungeDelaySeconds, false);
		}
		else
		{
			StartStepLunge();
		}
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

// Runs on: owning client and server.
void UClockworksSwordAttackAbility::StartStepLunge()
{
	const FClockworksSwordComboStep& Step = GetCurrentStep();
	StartLunge(Step.LungeSpeed, Step.LungeSeconds > 0.f ? Step.LungeSeconds : Step.ActiveSeconds);
}

// Runs on: server only (started from OnWindupFinished under HasServerAuthority).
void UClockworksSwordAttackAbility::DoHitCheck()
{
	ACharacter* Avatar = GetAvatarCharacter();
	if (!Avatar)
	{
		return;
	}
	const FClockworksSwordComboStep& Step = GetCurrentStep();
	SweepHitbox(Avatar->GetActorLocation() + Avatar->GetActorForwardVector() * HitForwardOffset, HitRadius, Step.DamageMultiplier, Step.KnockbackMultiplier);
}

// Runs on: owning client and server. Either chains into the queued step or starts recovery.
void UClockworksSwordAttackAbility::OnActiveFinished()
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(HitCheckTimer);
		World->GetTimerManager().ClearTimer(LungeTimer);
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
		FinishSwing();
		return;
	}

	if (Step.bLockMovementDuringRecovery)
	{
		AddLocalTag(ClockworksTags::State_MovementLocked);
	}
	if (Step.RecoveryAnim)
	{
		PlayPhaseAnim(Step.RecoveryAnim, Step.RecoverySeconds);
	}

	UAbilityTask_WaitDelay* Recovery = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(Step.RecoverySeconds));
	Recovery->OnFinish.AddDynamic(this, &UClockworksSwordAttackAbility::OnRecoveryFinished);
	Recovery->ReadyForActivation();
}

// Runs on: owning client and server.
void UClockworksSwordAttackAbility::OnRecoveryFinished()
{
	RemoveLocalTag(ClockworksTags::State_MovementLocked);
	FinishSwing();
}

// Runs on: owning client and server. The fork between "done" and "charging".
void UClockworksSwordAttackAbility::FinishSwing()
{
	if (bButtonHeld && ChargeSeconds > 0.f)
	{
		BeginCharge();
		return;
	}
	EndAbility(CurrentSpecHandle, CurrentActorInfo, CurrentActivationInfo, true, false);
}

// ---------------------------------------------------------------------------------------------
// Charge
// ---------------------------------------------------------------------------------------------

// Runs on: owning client and server. Free movement at the charge speed, aiming follows the cursor.
void UClockworksSwordAttackAbility::BeginCharge()
{
	bCharging = true;
	bChargeReady = false;
	UE_LOG(LogClockworks, Log, TEXT("Sword: charging for %.2fs (hold clip %s)"), ChargeSeconds, *GetNameSafe(ChargeHoldAnim));

	if (InputTask)
	{
		InputTask->EndTask();
		InputTask = nullptr;
	}

	AddLocalTag(ClockworksTags::State_Charging);

	// Never charge without a way out. If the button is in fact already up, this fires at once and
	// the charge ends before it starts.
	// A release task fires once and ends itself, so every hold needs a fresh listener. Testing the
	// current input state means a press that already ended before we got here is caught too.
	if (!ReleaseTask)
	{
		ReleaseTask = UAbilityTask_WaitInputRelease::WaitInputRelease(this, /*bTestAlreadyReleased*/ true);
		ReleaseTask->OnRelease.AddDynamic(this, &UClockworksSwordAttackAbility::OnAttackReleased);
		ReleaseTask->ReadyForActivation();
	}

	if (ChargeHoldAnim)
	{
		PlayPhaseAnim(ChargeHoldAnim, 0.f, /*bLoop*/ true);
	}

	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().SetTimer(ChargeReadyTimer, this, &UClockworksSwordAttackAbility::OnChargeReady, ChargeSeconds, false);
	}
}

// Runs on: owning client and server. The aura: cosmetic, so the server tells everyone and the
// owning client shows its own straight away.
void UClockworksSwordAttackAbility::OnChargeReady()
{
	bChargeReady = true;
	UE_LOG(LogClockworks, Log, TEXT("Sword: charge ready"));

	if (AClockworksCharacter* Knight = GetKnight())
	{
		if (HasServerAuthority())
		{
			Knight->MulticastChargeReadyFlash();
		}
		else
		{
			Knight->PlayChargeReadyFlash();
		}
	}
}

// Runs on: owning client and server, on release once the charge is ready.
void UClockworksSwordAttackAbility::StartChargeAttack()
{
	bCharging = false;
	bChargeAttacking = true;
	RemoveLocalTag(ClockworksTags::State_Charging);
	UE_LOG(LogClockworks, Log, TEXT("Sword: charge attack (release %s, spin %s)"), *GetNameSafe(ChargeReleaseAnim), *GetNameSafe(ChargeSpinAnim));

	// Committed from here: face where the cursor was on release, feet planted through the spin.
	AddLocalTag(ClockworksTags::State_RotationLocked);
	AddLocalTag(ClockworksTags::State_MovementLocked);

	if (ChargeReleaseAnim && ChargeReleaseSeconds > 0.f)
	{
		PlayPhaseAnim(ChargeReleaseAnim, ChargeReleaseSeconds);
		UAbilityTask_WaitDelay* Release = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(ChargeReleaseSeconds));
		Release->OnFinish.AddDynamic(this, &UClockworksSwordAttackAbility::OnChargeReleaseFinished);
		Release->ReadyForActivation();
	}
	else
	{
		OnChargeReleaseFinished();
	}
}

// Runs on: owning client and server. The spin: samples on the server, the step everywhere.
void UClockworksSwordAttackAbility::OnChargeReleaseFinished()
{
	if (ChargeSpinAnim)
	{
		PlayPhaseAnim(ChargeSpinAnim, ChargeSpinSeconds);
	}

	UWorld* World = GetWorld();
	if (World && HasServerAuthority())
	{
		NextChargeSample = 0;
		ChargeSampleTimers.SetNum(ChargeSampleTimes.Num());
		for (int32 Index = 0; Index < ChargeSampleTimes.Num(); ++Index)
		{
			// Each sample is its own sweep with its own "already hit" set, so a target standing where
			// two samples overlap is hit twice, as in Spiral Knights.
			if (ChargeSampleTimes[Index] <= 0.f)
			{
				DoChargeSample();
			}
			else
			{
				World->GetTimerManager().SetTimer(ChargeSampleTimers[Index], this, &UClockworksSwordAttackAbility::DoChargeSample, ChargeSampleTimes[Index], false);
			}
		}
	}

	if (World && ChargeLungeDistance > 0.f)
	{
		if (ChargeLungeDelaySeconds > 0.f)
		{
			World->GetTimerManager().SetTimer(LungeTimer, this, &UClockworksSwordAttackAbility::StartChargeLunge, ChargeLungeDelaySeconds, false);
		}
		else
		{
			StartChargeLunge();
		}
	}

	UAbilityTask_WaitDelay* Spin = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(ChargeSpinSeconds));
	Spin->OnFinish.AddDynamic(this, &UClockworksSwordAttackAbility::OnChargeSpinFinished);
	Spin->ReadyForActivation();
}

// Runs on: server only. One of the four sweeps around the knight, in SK's order: behind, left,
// front, right.
void UClockworksSwordAttackAbility::DoChargeSample()
{
	ACharacter* Avatar = GetAvatarCharacter();
	if (!Avatar)
	{
		return;
	}

	static const FVector Directions[4] = { FVector(-1.f, 0.f, 0.f), FVector(0.f, -1.f, 0.f), FVector(1.f, 0.f, 0.f), FVector(0.f, 1.f, 0.f) };
	const FVector Local = Directions[NextChargeSample % 4];
	++NextChargeSample;

	const FVector Center = Avatar->GetActorLocation() + Avatar->GetActorTransform().TransformVectorNoScale(Local) * ChargeHitOffset;
	HitActors.Reset();
	SweepHitbox(Center, ChargeHitRadius, ChargeDamageMultiplier, ChargeKnockbackMultiplier);
}

// Runs on: owning client and server.
void UClockworksSwordAttackAbility::StartChargeLunge()
{
	StartLunge(ChargeLungeDistance / ChargeLungeSeconds, ChargeLungeSeconds);
}

// Runs on: owning client and server. Rotation is free again; the feet stay planted for the rearm.
void UClockworksSwordAttackAbility::OnChargeSpinFinished()
{
	RemoveLocalTag(ClockworksTags::State_RotationLocked);

	if (ChargeRecoverySeconds <= 0.f)
	{
		OnChargeRecoveryFinished();
		return;
	}
	if (ChargeEndAnim)
	{
		PlayPhaseAnim(ChargeEndAnim, ChargeRecoverySeconds);
	}

	UAbilityTask_WaitDelay* Recovery = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(ChargeRecoverySeconds));
	Recovery->OnFinish.AddDynamic(this, &UClockworksSwordAttackAbility::OnChargeRecoveryFinished);
	Recovery->ReadyForActivation();
}

// Runs on: owning client and server.
void UClockworksSwordAttackAbility::OnChargeRecoveryFinished()
{
	EndAbility(CurrentSpecHandle, CurrentActorInfo, CurrentActivationInfo, true, false);
}

// ---------------------------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------------------------

// Runs on: server only.
void UClockworksSwordAttackAbility::SweepHitbox(const FVector& Center, float Radius, float DamageMultiplier, float KnockbackMultiplier)
{
	ACharacter* Avatar = GetAvatarCharacter();
	UAbilitySystemComponent* SourceAbilitySystemComponent = GetAbilitySystemComponentFromActorInfo();
	UWorld* World = Avatar ? Avatar->GetWorld() : nullptr;
	if (!Avatar || !SourceAbilitySystemComponent || !World)
	{
		return;
	}

	if (bDrawDebugHitbox)
	{
		DrawDebugSphere(World, Center, Radius, 16, FColor::Red, false, HitCheckInterval * 2.f);
	}

	TArray<FOverlapResult> Overlaps;
	FCollisionQueryParams QueryParams(TEXT("ClockworksSwordHit"), /*bTraceComplex*/ false, Avatar);
	World->OverlapMultiByObjectType(Overlaps, Center, FQuat::Identity, FCollisionObjectQueryParams(ECC_Pawn), FCollisionShape::MakeSphere(Radius), QueryParams);

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
		ApplyDamageTo(TargetAbilitySystemComponent, Overlap, DamageMultiplier, KnockbackMultiplier);
	}
}

// Runs on: server only. The target's attribute set applies defense and decides the outcome.
void UClockworksSwordAttackAbility::ApplyDamageTo(UAbilitySystemComponent* TargetAbilitySystemComponent, const FOverlapResult& Overlap, float DamageMultiplier, float KnockbackMultiplier)
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
	SpecHandle.Data->SetSetByCallerMagnitude(ClockworksTags::Data_Damage, BaseDamage * DamageMultiplier + AttackPower);
	SpecHandle.Data->SetSetByCallerMagnitude(ClockworksTags::Data_Knockback, KnockbackMultiplier);

	SourceAbilitySystemComponent->ApplyGameplayEffectSpecToTarget(*SpecHandle.Data, TargetAbilitySystemComponent);
}

// Runs on: owning client and server. A root motion source rather than a launch so ground friction
// cannot eat it; the movement component predicts it on the owning client and reconciles it with the
// server like any other move. The clips cannot supply this as animation root motion because the
// exported skeleton's root bone never moves.
void UClockworksSwordAttackAbility::StartLunge(float Speed, float Seconds)
{
	ACharacter* Avatar = GetAvatarCharacter();
	if (!Avatar || Speed <= 0.f || Seconds <= 0.f)
	{
		return;
	}

	FVector Direction = Avatar->GetActorForwardVector();
	Direction.Z = 0.f;
	UAbilityTask_ApplyRootMotionConstantForce* Lunge = UAbilityTask_ApplyRootMotionConstantForce::ApplyRootMotionConstantForce(
		this, NAME_None, Direction.GetSafeNormal(), Speed, ClampPhaseSeconds(Seconds), /*bIsAdditive*/ false, /*StrengthOverTime*/ nullptr,
		ERootMotionFinishVelocityMode::SetVelocity, FVector::ZeroVector, 0.f, /*bEnableGravity*/ false);
	Lunge->ReadyForActivation();
}

// Runs on: owning client and server. Cosmetic: the owning client shows its own prediction, the
// server broadcasts to everyone else. A phase of zero seconds plays the clip at its natural speed.
void UClockworksSwordAttackAbility::PlayPhaseAnim(UAnimSequenceBase* Anim, float PhaseSeconds, bool bLoop)
{
	AClockworksCharacter* Knight = GetKnight();
	if (!Knight || !Anim)
	{
		return;
	}

	const float Length = Anim->GetPlayLength();
	const float Rate = (PhaseSeconds > 0.f && Length > 0.f) ? Length / PhaseSeconds : 1.f;

	if (HasServerAuthority())
	{
		Knight->MulticastPlaySlotAnimation(Anim, Rate, bLoop);
	}
	else
	{
		Knight->PlaySlotAnimation(Anim, Rate, bLoop);
	}
}

// Runs on: owning client and server.
void UClockworksSwordAttackAbility::StopPhaseAnim()
{
	AClockworksCharacter* Knight = GetKnight();
	if (!Knight)
	{
		return;
	}
	if (HasServerAuthority())
	{
		Knight->MulticastStopSlotAnimation();
	}
	else
	{
		Knight->StopSlotAnimation();
	}
}

// Runs on: owning client and server, including on cancel. Leaves nothing running behind.
void UClockworksSwordAttackAbility::EndAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, bool bReplicateEndAbility, bool bWasCancelled)
{
	if (UWorld* World = GetWorld())
	{
		FTimerManager& Timers = World->GetTimerManager();
		Timers.ClearTimer(HitCheckTimer);
		Timers.ClearTimer(LungeTimer);
		Timers.ClearTimer(ChargeReadyTimer);
		for (FTimerHandle& Handle_ : ChargeSampleTimers)
		{
			Timers.ClearTimer(Handle_);
		}
	}
	if (InputTask)
	{
		InputTask->EndTask();
		InputTask = nullptr;
	}
	if (ReleaseTask)
	{
		ReleaseTask->EndTask();
		ReleaseTask = nullptr;
	}

	// The looping hold clip must not outlive the ability; a cancelled swing clip can just blend out.
	if (bCharging || bWasCancelled)
	{
		StopPhaseAnim();
	}
	bCharging = false;
	bChargeReady = false;
	bChargeAttacking = false;

	RemoveLocalTag(ClockworksTags::State_RotationLocked);
	RemoveLocalTag(ClockworksTags::State_MovementLocked);
	RemoveLocalTag(ClockworksTags::State_Charging);

	Super::EndAbility(Handle, ActorInfo, ActivationInfo, bReplicateEndAbility, bWasCancelled);
}
