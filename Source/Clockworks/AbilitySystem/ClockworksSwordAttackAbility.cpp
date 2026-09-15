// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksSwordAttackAbility.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksCharacter.h"
#include "ClockworksDamageEffect.h"
#include "ClockworksGameplayTags.h"
#include "ClockworksProjectile.h"
#include "ClockworksBomb.h"
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
#include "Sound/SoundBase.h"
#include "CollisionQueryParams.h"
#include "DrawDebugHelpers.h"
#include "Engine/OverlapResult.h"
#include "Engine/World.h"
#include "GameFramework/Character.h"
#include "TimerManager.h"
#include "ClockworksWeaponDefinition.h"

// Runs on: owning client and server, at the start of every activation. Pure data: it copies the
// drawn weapon's own moves over this instance's defaults, so a weapon with no profile swings as the
// Blueprint says and every catalogue weapon swings as the original's attack configs say.
void UClockworksSwordAttackAbility::ApplyWeaponProfile()
{
	bHasIncompleteSwing = false;
	const UClockworksWeaponDefinition* Weapon = GetSourceWeapon();
	if (!Weapon || !Weapon->Attack.IsSet())
	{
		return;
	}
	const FClockworksAttackProfile& Profile = Weapon->Attack;

	// The Blueprint's swings keep lending their sounds until the weapon names its own.
	const TArray<FClockworksSwordComboStep> Template = GetClass()->GetDefaultObject<UClockworksSwordAttackAbility>()->ComboSteps;

	// One of the weapon's moves as a swing; Index is its place in the combo.
	auto MakeStep = [&Template](const FClockworksAttackMove& Move, int32 Index)
	{
		FClockworksSwordComboStep Step;
		if (Template.Num() > 0)
		{
			Step.SwingSound = Template[FMath::Min(Index, Template.Num() - 1)].SwingSound;
		}

		Step.WindupAnim = Move.StartAnim;
		Step.WindupSeconds = Move.StartSeconds;
		Step.AttackAnim = Move.FireAnim;
		Step.ActiveSeconds = FMath::Max(Move.FireSeconds, 0.05f);
		Step.RecoveryAnim = Move.EndAnim;
		Step.RecoveryAnimRate = Move.EndRate;

		// The first swing frees the knight at once: the user's choice for the Calibur, kept for every
		// line so the opener of every sword feels the same. Later swings keep the original's rearm.
		Step.RecoverySeconds = (Index == 0) ? 0.f : Move.RecoverySeconds;
		Step.bLockMovementDuringRecovery = Index > 0;

		if (Move.LungeDistanceCm > 0.f && Move.LungeSeconds > 0.f)
		{
			Step.LungeSpeed = Move.LungeDistanceCm / Move.LungeSeconds;
			Step.LungeSeconds = Move.LungeSeconds;
			Step.LungeDelaySeconds = Move.LungeDelaySeconds;
		}

		for (const FClockworksAttackHit& Hit : Move.Hits)
		{
			if (Hit.RadiusCm > 0.f)
			{
				Step.HitRadius = Hit.RadiusCm;
				Step.HitForwardOffset = FMath::Max(Hit.OffsetCm.X, 0.f);
				Step.KnockbackMultiplier = Hit.KnockbackMultiplier;
				break;
			}
		}
		return Step;
	};

	if (Profile.Chain.Num() > 0)
	{
		ComboSteps.Reset();
		for (int32 Index = 0; Index < Profile.Chain.Num(); ++Index)
		{
			ComboSteps.Add(MakeStep(Profile.Chain[Index], Index));
		}
	}

	// Letting go of a charge early swings the weapon's incomplete-charge move, which the original gives every sword
	// (user's decision 2026-09-15). It swings like an opener, freeing the knight at once.
	bHasIncompleteSwing = Profile.IncompleteCharge.Hits.ContainsByPredicate(
		[](const FClockworksAttackHit& Hit) { return Hit.RadiusCm > 0.f || Hit.bSpawns; });
	if (bHasIncompleteSwing)
	{
		IncompleteStep = MakeStep(Profile.IncompleteCharge, 0);
	}

	if (Profile.ChargeSeconds > 0.f)
	{
		ChargeSeconds = Profile.ChargeSeconds;
	}
	if (Profile.ChargeHoldAnim)
	{
		ChargeHoldAnim = Profile.ChargeHoldAnim;
	}

	const FClockworksAttackMove& Charged = Profile.ChargedAttack;
	if (Charged.IsSet())
	{
		ChargeReleaseAnim = Charged.StartAnim;
		ChargeReleaseAnimRate = Charged.StartRate;
		ChargeReleaseSeconds = Charged.StartSeconds;
		ChargeSpinAnim = Charged.FireAnim;
		ChargeSpinAnimRate = Charged.FireRate;
		ChargeEndAnim = Charged.EndAnim;
		ChargeEndAnimRate = Charged.EndRate;
		ChargeRecoverySeconds = Charged.RecoverySeconds;
		ChargeLungeDistance = FMath::Max(Charged.LungeDistanceCm, 0.f);
		if (Charged.LungeSeconds > 0.f)
		{
			ChargeLungeSeconds = Charged.LungeSeconds;
		}
		ChargeLungeDelaySeconds = Charged.LungeDelaySeconds;

		ChargeSamples.Reset();
		float LastDelay = 0.f;
		for (int32 HitIndex = 0; HitIndex < Charged.Hits.Num(); ++HitIndex)
		{
			const FClockworksAttackHit& Hit = Charged.Hits[HitIndex];
			// The strike lasts until its last moment, whether that moment is a hit, a bullet or a blast.
			LastDelay = FMath::Max(LastDelay, Hit.DelaySeconds);
			if (Hit.RadiusCm <= 0.f || Hit.bSpawns || Hit.bBlast)
			{
				continue;
			}
			FClockworksSwordChargeSample Sample;
			Sample.DelaySeconds = Hit.DelaySeconds;
			Sample.OffsetCm = Hit.OffsetCm;
			Sample.RadiusCm = Hit.RadiusCm;
			Sample.KnockbackMultiplier = Hit.KnockbackMultiplier;
			Sample.BoxSizeCm = Hit.bRectangle ? Hit.BoxSizeCm : FVector2D::ZeroVector;
			Sample.DamageMultiplier = Hit.DamageMultiplier;
			Sample.HitIndex = HitIndex;
			ChargeSamples.Add(Sample);
		}
		ChargeLunges = Charged.Lunges;

		// The strike lasts as long as its clip, and never ends before its last hit has landed.
		ChargeSpinSeconds = FMath::Max(Charged.FireSeconds, LastDelay + 0.05f);
	}
}

// Runs on: all machines (class default object).
UClockworksSwordAttackAbility::UClockworksSwordAttackAbility()
{
	SetAssetTags(FGameplayTagContainer(ClockworksTags::Ability_Attack_Sword));
	AbilityInputID = EClockworksAbilityInputID::Attack;

	// Owned for the whole activation: slows movement (character) and blocks the dodge.
	ActivationOwnedTags.AddTag(ClockworksTags::State_Attacking);

	ActivationBlockedTags.AddTag(ClockworksTags::State_Attacking);
	ActivationBlockedTags.AddTag(ClockworksTags::State_Dodging);
	ActivationBlockedTags.AddTag(ClockworksTags::State_Shielding);
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
	if (CurrentStepIndex == IncompleteSwingIndex)
	{
		return IncompleteStep;
	}
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

	// The drawn weapon's own swings, charge and clips, before anything reads them.
	ApplyWeaponProfile();

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

	// A press soon after a swing that ended mid-combo carries on from the next swing; any later press
	// starts the combo over. The window is spent either way.
	int32 FirstStep = 0;
	if (const UWorld* World = GetWorld(); World && World->GetTimeSeconds() <= ComboResumeDeadline && ComboSteps.IsValidIndex(ComboResumeStep))
	{
		FirstStep = ComboResumeStep;
	}
	ComboResumeDeadline = 0.0;

	StartStep(FirstStep);
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

	UAbilityTask_WaitDelay* Windup = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(ResolveAttackSeconds(Step.WindupSeconds)));
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
		else if (bHasIncompleteSwing)
		{
			// Let go early: the charge is lost, and the knight swings the weapon's incomplete-charge move instead.
			StartIncompleteSwing();
		}
		else
		{
			// Let go early with no incomplete move in the data: the charge is lost, the knight is simply free again.
			EndAbility(CurrentSpecHandle, CurrentActorInfo, CurrentActivationInfo, true, false);
		}
	}
}

// Runs on: owning client and server, each from its own release event, so both copies swing together.
void UClockworksSwordAttackAbility::StartIncompleteSwing()
{
	bCharging = false;
	bChargeReady = false;
	RemoveLocalTag(ClockworksTags::State_Charging);
	SetChargeLoopSound(false);
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(ChargeReadyTimer);
	}
	UE_LOG(LogClockworks, Log, TEXT("Sword: charge let go early, incomplete swing (authority=%d)"), HasServerAuthority());

	// The arms-only hold loop lets go; the swing takes the whole body.
	if (AClockworksCharacter* Knight = GetKnight())
	{
		if (HasServerAuthority())
		{
			Knight->MulticastStopSlotAnimation(Knight->GetUpperBodySlotName());
		}
		else
		{
			Knight->StopSlotAnimation(0.1f, Knight->GetUpperBodySlotName());
		}
	}

	StartStep(IncompleteSwingIndex);
}

// Runs on: owning client and server. The hitbox only opens on the server.
void UClockworksSwordAttackAbility::OnWindupFinished()
{
	const FClockworksSwordComboStep& Step = GetCurrentStep();

	PlayMoveSound(GetMove(false, CurrentStepIndex), Step.SwingSound);

	// The blade smear, for exactly as long as the hitbox is live, so what you see is when it hurts.
	if (AClockworksCharacter* Knight = GetKnight())
	{
		if (HasServerAuthority())
		{
			Knight->StartSwingTrail(Step.ActiveSeconds);
		}
		else
		{
			Knight->ShowSwingTrail(Step.ActiveSeconds);
		}
	}

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
			World->GetTimerManager().SetTimer(LungeTimer, this, &UClockworksSwordAttackAbility::StartStepLunge, ResolveAttackSeconds(Step.LungeDelaySeconds), false);
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
		ScheduleMoveBullets(false, CurrentStepIndex);
	}

	UAbilityTask_WaitDelay* Active = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(ResolveAttackSeconds(Step.ActiveSeconds)));
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
	// A swing from the weapon's own data carries its own reach; the Blueprint's swings use the ability's.
	const float Radius = Step.HitRadius > 0.f ? Step.HitRadius : HitRadius;
	const float Reach = Step.HitRadius > 0.f ? Step.HitForwardOffset : HitForwardOffset;
	// The swing's own damage region in the weapon's data, for its status and sideways shove.
	ActiveHitData = nullptr;
	if (const FClockworksAttackMove* Move = GetMove(false, CurrentStepIndex))
	{
		ActiveHitData = Move->Hits.FindByPredicate([](const FClockworksAttackHit& Hit) { return Hit.RadiusCm > 0.f && !Hit.bSpawns; });
	}
	SweepHitbox(Avatar->GetActorLocation() + Avatar->GetActorForwardVector() * Reach, Radius, Step.DamageMultiplier, Step.KnockbackMultiplier);
	ActiveHitData = nullptr;
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

	// The follow-through plays either way. On a step with no gameplay recovery the knight is free to
	// move and swing immediately, and the clip simply gets cut off by whatever they do next; that is
	// what keeps a single swing from snapping back to idle the instant the hitbox closes.
	const FClockworksSwordComboStep& Step = GetCurrentStep();
	if (Step.RecoveryAnim)
	{
		PlayPhaseAnim(Step.RecoveryAnim, Step.RecoverySeconds, false, Step.RecoveryAnimRate);
	}

	if (Step.RecoverySeconds <= 0.f)
	{
		FinishSwing();
		return;
	}

	if (Step.bLockMovementDuringRecovery)
	{
		AddLocalTag(ClockworksTags::State_MovementLocked);
	}

	UAbilityTask_WaitDelay* Recovery = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(ResolveAttackSeconds(Step.RecoverySeconds)));
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
	// A press during the recovery queued the next swing; before this it was silently dropped.
	if (bNextStepQueued && ComboSteps.IsValidIndex(CurrentStepIndex + 1))
	{
		StartStep(CurrentStepIndex + 1);
		return;
	}
	if (bButtonHeld && ChargeSeconds > 0.f)
	{
		BeginCharge();
		return;
	}
	// Ended mid-combo: a press soon after picks up at the next swing. Each machine times this on its
	// own clock, which agrees closely enough because both timelines start from the same press.
	if (ComboSteps.IsValidIndex(CurrentStepIndex + 1))
	{
		if (const UWorld* World = GetWorld())
		{
			ComboResumeStep = CurrentStepIndex + 1;
			ComboResumeDeadline = World->GetTimeSeconds() + ComboContinueSeconds;
		}
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

	// The hold is arms only. The knight walks while charging at full speed, so the legs keep the run;
	// played full body, the loop froze them and the knight slid across the floor. The swing that led
	// into the charge still owns the whole body, so it lets go first.
	if (ChargeHoldAnim)
	{
		if (AClockworksCharacter* Knight = GetKnight())
		{
			if (HasServerAuthority())
			{
				Knight->MulticastStopSlotAnimation(Knight->GetFullBodySlotName());
				Knight->MulticastPlaySlotAnimation(ChargeHoldAnim, 1.f, /*bLoop*/ true, Knight->GetUpperBodySlotName());
			}
			else
			{
				Knight->StopSlotAnimation(0.2f, Knight->GetFullBodySlotName());
				Knight->PlaySlotAnimation(ChargeHoldAnim, 1.f, /*bLoop*/ true, Knight->GetUpperBodySlotName());
			}
		}
	}

	SetChargeLoopSound(true);

	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().SetTimer(ChargeReadyTimer, this, &UClockworksSwordAttackAbility::OnChargeReady, ClampPhaseSeconds(ResolveChargeSeconds(ChargeSeconds)), false);
	}
}

// Runs on: owning client and server. Cosmetic, so it follows the aura's rule: the server broadcasts,
// the owning client starts its own at once so the hum begins on the button rather than a round trip later.
void UClockworksSwordAttackAbility::SetChargeLoopSound(bool bPlaying)
{
	if (AClockworksCharacter* Knight = GetKnight())
	{
		if (HasServerAuthority())
		{
			Knight->SetChargeLoop(bPlaying);
		}
		else
		{
			Knight->ShowChargeLoop(bPlaying);
		}
	}
}

// Runs on: owning client and server. The aura: cosmetic, so the server tells everyone and the
// owning client shows its own straight away.
void UClockworksSwordAttackAbility::OnChargeReady()
{
	bChargeReady = true;
	UE_LOG(LogClockworks, Log, TEXT("Sword: charge ready"));

	// The aura stays up for as long as the charge is held, so both players can see it is loaded.
	if (AClockworksCharacter* Knight = GetKnight())
	{
		if (HasServerAuthority())
		{
			Knight->SetChargeReady(true);
		}
		else
		{
			Knight->ShowChargeReady(true);
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

	// The arms-only hold loop ends here; the release takes the whole body.
	if (AClockworksCharacter* Knight = GetKnight())
	{
		if (HasServerAuthority())
		{
			Knight->MulticastStopSlotAnimation(Knight->GetUpperBodySlotName());
		}
		else
		{
			Knight->StopSlotAnimation(0.1f, Knight->GetUpperBodySlotName());
		}
	}

	// Committed from here: face where the cursor was on release, feet planted through the spin.
	AddLocalTag(ClockworksTags::State_RotationLocked);
	AddLocalTag(ClockworksTags::State_MovementLocked);

	// The hum is the charge building; the swing replaces it.
	SetChargeLoopSound(false);
	PlayMoveSound(GetMove(true, 0), ChargeSwingSound);

	if (ChargeReleaseAnim && ChargeReleaseSeconds > 0.f)
	{
		PlayPhaseAnim(ChargeReleaseAnim, ChargeReleaseSeconds, false, ChargeReleaseAnimRate);
		UAbilityTask_WaitDelay* Release = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(ResolveAttackSeconds(ChargeReleaseSeconds)));
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
	// A strike made of several clips (a Flourish's thrusts, a Rocket Hammer's double slam) plays them all.
	const FClockworksAttackMove* ChargedMove = GetMove(true, 0);
	if (ChargedMove && ChargedMove->FireSequence.Num() > 0)
	{
		PlayPhaseSequence(ChargedMove->FireSequence);
	}
	else if (ChargeSpinAnim)
	{
		PlayPhaseAnim(ChargeSpinAnim, ChargeSpinSeconds, false, ChargeSpinAnimRate);
	}

	UWorld* World = GetWorld();
	if (World && HasServerAuthority())
	{
		ScheduleMoveBullets(true, 0);
		NextChargeSample = 0;
		// The weapon's own samples when it has them; otherwise the Round House timings.
		const int32 SampleCount = ChargeSamples.Num() > 0 ? ChargeSamples.Num() : ChargeSampleTimes.Num();
		ChargeSampleTimers.SetNum(SampleCount);
		for (int32 Index = 0; Index < SampleCount; ++Index)
		{
			const float Delay = ChargeSamples.Num() > 0 ? ChargeSamples[Index].DelaySeconds : ChargeSampleTimes[Index];
			// Each sample is its own sweep with its own "already hit" set, so a target standing where
			// two samples overlap is hit twice, as in Spiral Knights.
			if (Delay <= 0.f)
			{
				DoChargeSample();
			}
			else
			{
				World->GetTimerManager().SetTimer(ChargeSampleTimers[Index], this, &UClockworksSwordAttackAbility::DoChargeSample, Delay, false);
			}
		}
	}

	if (World && ChargeLunges.Num() > 0)
	{
		// Every push the weapon's data names: a Faust's backstep, a Rocket Hammer's second surge.
		ChargeLungeTimers.SetNum(ChargeLunges.Num());
		for (int32 Index = 0; Index < ChargeLunges.Num(); ++Index)
		{
			if (ChargeLunges[Index].DelaySeconds <= 0.f)
			{
				StartChargeLungeAt(Index);
			}
			else
			{
				World->GetTimerManager().SetTimer(ChargeLungeTimers[Index], FTimerDelegate::CreateUObject(this, &UClockworksSwordAttackAbility::StartChargeLungeAt, Index), ChargeLunges[Index].DelaySeconds, false);
			}
		}
	}
	else if (World && ChargeLungeDistance > 0.f)
	{
		if (ChargeLungeDelaySeconds > 0.f)
		{
			World->GetTimerManager().SetTimer(LungeTimer, this, &UClockworksSwordAttackAbility::StartChargeLunge, ResolveAttackSeconds(ChargeLungeDelaySeconds), false);
		}
		else
		{
			StartChargeLunge();
		}
	}

	UAbilityTask_WaitDelay* Spin = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(ResolveAttackSeconds(ChargeSpinSeconds)));
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

	// A weapon with its own charged attack carries where each of its hits lands; the hand-tuned
	// Calibur numbers (behind, left, front, right) are the fallback.
	FVector Local;
	float Radius = ChargeHitRadius;
	float Knockback = ChargeKnockbackMultiplier;
	float DamageMultiplier = ChargeDamageMultiplier;
	FVector BoxHalfExtent = FVector::ZeroVector;
	ActiveHitData = nullptr;
	if (ChargeSamples.IsValidIndex(NextChargeSample))
	{
		const FClockworksSwordChargeSample& Sample = ChargeSamples[NextChargeSample];
		Local = FVector(Sample.OffsetCm.X, Sample.OffsetCm.Y, 0.f);
		const FClockworksAttackMove* ChargedMove = GetMove(true, 0);
		ActiveHitData = (ChargedMove && ChargedMove->Hits.IsValidIndex(Sample.HitIndex)) ? &ChargedMove->Hits[Sample.HitIndex] : nullptr;
		Radius = Sample.RadiusCm;
		Knockback = Sample.KnockbackMultiplier;
		if (Sample.DamageMultiplier > 0.f)
		{
			DamageMultiplier = Sample.DamageMultiplier;
		}
		if (!Sample.BoxSizeCm.IsNearlyZero())
		{
			// Tall enough to catch anything standing on the floor the knight stands on.
			BoxHalfExtent = FVector(Sample.BoxSizeCm.X * 0.5f, Sample.BoxSizeCm.Y * 0.5f, 100.f);
		}
	}
	else
	{
		static const FVector Directions[4] = { FVector(-1.f, 0.f, 0.f), FVector(0.f, -1.f, 0.f), FVector(1.f, 0.f, 0.f), FVector(0.f, 1.f, 0.f) };
		Local = Directions[NextChargeSample % 4] * ChargeHitOffset;
	}
	++NextChargeSample;

	const FVector Center = Avatar->GetActorLocation() + Avatar->GetActorTransform().TransformVectorNoScale(Local);
	HitActors.Reset();
	SweepHitbox(Center, Radius, DamageMultiplier, Knockback, BoxHalfExtent, FQuat(FRotator(0.f, Avatar->GetActorRotation().Yaw, 0.f)));
	ActiveHitData = nullptr;
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
		PlayPhaseAnim(ChargeEndAnim, ChargeRecoverySeconds, false, ChargeEndAnimRate);
	}

	UAbilityTask_WaitDelay* Recovery = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(ResolveAttackSeconds(ChargeRecoverySeconds)));
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
void UClockworksSwordAttackAbility::SweepHitbox(const FVector& Center, float Radius, float DamageMultiplier, float KnockbackMultiplier, const FVector& BoxHalfExtent, const FQuat& BoxRotation)
{
	const bool bBox = !BoxHalfExtent.IsNearlyZero();
	ACharacter* Avatar = GetAvatarCharacter();
	UAbilitySystemComponent* SourceAbilitySystemComponent = GetAbilitySystemComponentFromActorInfo();
	UWorld* World = Avatar ? Avatar->GetWorld() : nullptr;
	if (!Avatar || !SourceAbilitySystemComponent || !World)
	{
		return;
	}

	if (bDrawDebugHitbox)
	{
		if (bBox)
		{
			DrawDebugBox(World, Center, BoxHalfExtent, BoxRotation, FColor::Red, false, HitCheckInterval * 2.f);
		}
		else
		{
			DrawDebugSphere(World, Center, Radius, 16, FColor::Red, false, HitCheckInterval * 2.f);
		}
	}

	TArray<FOverlapResult> Overlaps;
	FCollisionQueryParams QueryParams(TEXT("ClockworksSwordHit"), /*bTraceComplex*/ false, Avatar);
	World->OverlapMultiByObjectType(Overlaps, Center, bBox ? BoxRotation : FQuat::Identity, FCollisionObjectQueryParams(ECC_Pawn),
		bBox ? FCollisionShape::MakeBox(BoxHalfExtent) : FCollisionShape::MakeSphere(Radius), QueryParams);

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
	float Amount = (BaseDamage * DamageMultiplier + AttackPower) * ResolveDamageMultiplier();
	if (ActiveHitData && ActiveHitData->DamageByDepth.Num() > 0)
	{
		// The original's own damage for this swing or region at the party's depth, which replaces every multiplier.
		Amount = ClockworksAttackDepth::Read(ActiveHitData->DamageByDepth, CurrentDemoDepth(GetWorld()), Amount);
	}
	// The swing's own damage types where its data names them (a Blazebrand splits Normal and Elemental); else the weapon's.
	FGameplayTag PrimaryType = ResolveDamageType();
	FGameplayTag SecondType;
	float SecondShare = 0.f;
	if (ActiveHitData && ActiveHitData->DamageTypes.IsSet())
	{
		const FGameplayTag WeaponType = PrimaryType;
		ResolveDamageTypes(GetWorld(), ActiveHitData->DamageTypes, WeaponType, PrimaryType, SecondType, SecondShare);
	}
	SetSplitDamageMagnitudes(SpecHandle, Amount, PrimaryType, SecondType, SecondShare);
	SpecHandle.Data->SetSetByCallerMagnitude(ClockworksTags::Data_Knockback, KnockbackMultiplier);
	if (ActiveHitData && !FMath::IsNearlyZero(ActiveHitData->KnockbackAngleDegrees))
	{
		SpecHandle.Data->SetSetByCallerMagnitude(ClockworksTags::Data_KnockbackAngle, ActiveHitData->KnockbackAngleDegrees);
	}

	SourceAbilitySystemComponent->ApplyGameplayEffectSpecToTarget(*SpecHandle.Data, TargetAbilitySystemComponent);

	// The hit's own status where the weapon's data names one (a Gram's charge stuns); else the weapon's.
	if (ActiveHitData && ActiveHitData->StatusEffect)
	{
		TryApplyStatus(SourceAbilitySystemComponent, TargetAbilitySystemComponent, ActiveHitData->StatusEffect,
			ActiveHitData->StatusChance, ActiveHitData->StatusSeconds,
			StatusTickAt(GetWorld(), ActiveHitData->StatusTickDamageByDepth, ActiveHitData->StatusTickDamage));
	}
	else
	{
		ApplyWeaponStatus(SourceAbilitySystemComponent, TargetAbilitySystemComponent);
	}

	// Server only, so this is a broadcast rather than a local play: connecting is the server's call.
	// The attacker freezes with the victim; the victim's own freeze rides its hit flash.
	if (AClockworksCharacter* Knight = GetKnight())
	{
		// The weapon's own impact when its data names one; nobody predicted this, so the owner hears it too.
		const UClockworksWeaponDefinition* Weapon = GetSourceWeapon();
		if (Weapon && Weapon->Attack.IsSet())
		{
			Knight->PlayWeaponSound(Weapon->Attack.ImpactSound, /*bFromServer*/ true, /*bOwnerPredicted*/ false);
		}
		else
		{
			Knight->MulticastPlaySound(bChargeAttacking && ChargeHitSound ? ChargeHitSound.Get() : HitSound.Get());
		}
		Knight->MulticastHitstop();
	}
}

// Runs on: wherever the instance runs.
const FClockworksAttackMove* UClockworksSwordAttackAbility::GetMove(bool bCharged, int32 MoveIndex) const
{
	const UClockworksWeaponDefinition* Weapon = GetSourceWeapon();
	if (!Weapon || !Weapon->Attack.IsSet())
	{
		return nullptr;
	}
	if (bCharged)
	{
		return Weapon->Attack.ChargedAttack.IsSet() ? &Weapon->Attack.ChargedAttack : nullptr;
	}
	if (MoveIndex == IncompleteSwingIndex)
	{
		return Weapon->Attack.IncompleteCharge.IsSet() ? &Weapon->Attack.IncompleteCharge : nullptr;
	}
	return Weapon->Attack.Chain.IsValidIndex(MoveIndex) ? &Weapon->Attack.Chain[MoveIndex] : nullptr;
}

// Runs on: owning client and server. A weapon with a profile is heard exactly as its data says; only a
// weapon without one falls back to the Blueprint's sound.
void UClockworksSwordAttackAbility::PlayMoveSound(const FClockworksAttackMove* Move, USoundBase* Fallback)
{
	if (!Move)
	{
		PlayPhaseSound(Fallback);
		return;
	}
	if (AClockworksCharacter* Knight = GetKnight())
	{
		Knight->PlayMoveSounds(Move->Sound, Move->ExtraSound, nullptr, HasServerAuthority());
	}
}

// Runs on: server only. The moment each bullet leaves is counted from the start of the move's fire
// phase, which is when this is called.
void UClockworksSwordAttackAbility::ScheduleMoveBullets(bool bCharged, int32 MoveIndex)
{
	const FClockworksAttackMove* Move = GetMove(bCharged, MoveIndex);
	UWorld* World = GetWorld();
	if (!HasServerAuthority() || !Move || !World)
	{
		return;
	}
	for (int32 HitIndex = 0; HitIndex < Move->Hits.Num(); ++HitIndex)
	{
		const FClockworksAttackHit& Hit = Move->Hits[HitIndex];
		// Blasts need no bullet; bullets need the weapon's bullet to know how to fly.
		const bool bBlast = Hit.bBlast;
		if (!bBlast && (!Hit.bSpawns || !Move->Bullet.IsSet()))
		{
			continue;
		}
		const FTimerDelegate Spawn = bBlast
			? FTimerDelegate::CreateUObject(this, &UClockworksSwordAttackAbility::SpawnMoveBlast, bCharged, MoveIndex, HitIndex)
			: FTimerDelegate::CreateUObject(this, &UClockworksSwordAttackAbility::SpawnMoveBullet, bCharged, MoveIndex, HitIndex);
		if (Hit.DelaySeconds <= 0.f)
		{
			Spawn.ExecuteIfBound();
		}
		else
		{
			FTimerHandle& Timer = BulletTimers.AddDefaulted_GetRef();
			World->GetTimerManager().SetTimer(Timer, Spawn, Hit.DelaySeconds, false);
		}
	}
}

// Runs on: server only. The bullet replicates on its own and carries the damage, the swing's or the
// charge's, like a hit from the blade itself would.
void UClockworksSwordAttackAbility::SpawnMoveBullet(bool bCharged, int32 MoveIndex, int32 HitIndex)
{
	const FClockworksAttackMove* Move = GetMove(bCharged, MoveIndex);
	ACharacter* Avatar = GetAvatarCharacter();
	UAbilitySystemComponent* SourceAbilitySystemComponent = GetAbilitySystemComponentFromActorInfo();
	UWorld* World = Avatar ? Avatar->GetWorld() : nullptr;
	if (!HasServerAuthority() || !IsActive() || !Move || !Move->Hits.IsValidIndex(HitIndex) || !Avatar || !SourceAbilitySystemComponent || !World)
	{
		return;
	}
	if (!ProjectileClass)
	{
		UE_LOG(LogClockworks, Warning, TEXT("%s has no ProjectileClass; this sword's bullets are not fired. Set it in the BP_GA_ asset."), *GetNameSafe(GetClass()));
		return;
	}

	const FClockworksAttackHit& Hit = Move->Hits[HitIndex];
	FVector Forward = Avatar->GetActorForwardVector();
	Forward.Z = 0.f;
	const float Yaw = Hit.AngleDegrees + FMath::FRandRange(-Hit.AngleVarianceDegrees * 0.5f, Hit.AngleVarianceDegrees * 0.5f);
	const FVector Direction = Forward.GetSafeNormal().RotateAngleAxis(Yaw, FVector::UpVector);

	FActorSpawnParameters SpawnParams;
	SpawnParams.Owner = Avatar;
	SpawnParams.Instigator = Avatar;
	SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	AClockworksProjectile* Projectile = World->SpawnActor<AClockworksProjectile>(ProjectileClass, Avatar->GetActorTransform().TransformPosition(MuzzleOffset), Direction.Rotation(), SpawnParams);
	if (!Projectile)
	{
		return;
	}

	float AttackPower = 0.f;
	if (const UClockworksAttributeSet* SourceAttributes = SourceAbilitySystemComponent->GetSet<UClockworksAttributeSet>())
	{
		AttackPower = SourceAttributes->GetAttackPower();
	}
	const float StepMultiplier = Hit.DamageMultiplier > 0.f ? Hit.DamageMultiplier
		: (bCharged ? ChargeDamageMultiplier : (ComboSteps.IsValidIndex(MoveIndex) ? ComboSteps[MoveIndex].DamageMultiplier : 1.f));
	float Damage = (BaseDamage * StepMultiplier + AttackPower) * ResolveDamageMultiplier();
	// The original's own damage for this bullet at the party's depth: the spawning hit's curve, else the move's bullet's.
	if (Hit.DamageByDepth.Num() > 0)
	{
		Damage = ClockworksAttackDepth::Read(Hit.DamageByDepth, CurrentDemoDepth(World), Damage);
	}
	else if (Move->Bullet.DamageByDepth.Num() > 0)
	{
		Damage = ClockworksAttackDepth::Read(Move->Bullet.DamageByDepth, CurrentDemoDepth(World), Damage);
	}

	// Its damage types: the spawning hit's where named, else the move's bullet's, else the weapon's.
	const FGameplayTag WeaponType = ResolveDamageType();
	FGameplayTag PrimaryType = WeaponType;
	FGameplayTag SecondType;
	float SecondShare = 0.f;
	const FClockworksDamageTypes& Types = Hit.DamageTypes.IsSet() ? Hit.DamageTypes : Move->Bullet.DamageTypes;
	ResolveDamageTypes(World, Types, WeaponType, PrimaryType, SecondType, SecondShare);

	Projectile->InitProjectile(SourceAbilitySystemComponent, Damage, Direction, Move->Bullet.SpeedCmPerSecond, Hit.KnockbackMultiplier, Move->Bullet.RangeCm, PrimaryType);
	Projectile->InitProjectileSecondType(SecondType, SecondShare);
	// Its look and what it does besides flying: a Brandish carrier's explosions, a charged Spur passing through.
	Projectile->InitProjectileSpec(Move->Bullet, GetSourceWeapon());
	if (Hit.StatusEffect)
	{
		Projectile->InitProjectileStatus(Hit.StatusEffect, Hit.StatusChance, Hit.StatusSeconds, StatusTickAt(World, Hit.StatusTickDamageByDepth, Hit.StatusTickDamage));
	}
	else if (const UClockworksWeaponDefinition* Weapon = GetSourceWeapon(); Weapon && Weapon->StatusEffect)
	{
		Projectile->InitProjectileStatus(Weapon->StatusEffect, Weapon->StatusChance, Weapon->StatusSeconds,
			StatusTickAt(World, Weapon->StatusTickDamageByDepth, Weapon->StatusTickDamage));
	}
}

// Runs on: server only. The blast is a bomb with its body hidden: it replicates, goes off on its own fuse
// and does its damage on the server like any bomb. A near-instant ghost swing makes no sound of its own.
void UClockworksSwordAttackAbility::SpawnMoveBlast(bool bCharged, int32 MoveIndex, int32 HitIndex)
{
	const FClockworksAttackMove* Move = GetMove(bCharged, MoveIndex);
	ACharacter* Avatar = GetAvatarCharacter();
	UAbilitySystemComponent* SourceAbilitySystemComponent = GetAbilitySystemComponentFromActorInfo();
	UWorld* World = Avatar ? Avatar->GetWorld() : nullptr;
	if (!HasServerAuthority() || !IsActive() || !Move || !Move->Hits.IsValidIndex(HitIndex) || !Avatar || !SourceAbilitySystemComponent || !World)
	{
		return;
	}
	if (!BlastClass)
	{
		UE_LOG(LogClockworks, Warning, TEXT("%s has no BlastClass; this sword's aftershocks and ghost swings do nothing. Set it in the BP_GA_ asset."), *GetNameSafe(GetClass()));
		return;
	}

	const FClockworksAttackHit& Hit = Move->Hits[HitIndex];
	FVector Location = Avatar->GetActorTransform().TransformPosition(FVector(Hit.OffsetCm.X, Hit.OffsetCm.Y, 0.f));
	Location.Z = Avatar->GetActorLocation().Z;

	FActorSpawnParameters SpawnParams;
	SpawnParams.Owner = Avatar;
	SpawnParams.Instigator = Avatar;
	SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	AClockworksBomb* Blast = World->SpawnActor<AClockworksBomb>(BlastClass, Location, FRotator::ZeroRotator, SpawnParams);
	if (!Blast)
	{
		return;
	}
	const float Multiplier = Hit.DamageMultiplier > 0.f ? Hit.DamageMultiplier : 1.f;
	// The original's own damage for this blast at the party's depth when the data carries it.
	const float Damage = ClockworksAttackDepth::Read(Hit.DamageByDepth, CurrentDemoDepth(World), BaseDamage * Multiplier * ResolveDamageMultiplier());
	Blast->HideBody(/*bSilent*/ Hit.FuseSeconds < 0.05f);
	// The bomb adds the thrower's AttackPower itself.
	const FGameplayTag WeaponType = ResolveDamageType();
	FGameplayTag PrimaryType = WeaponType;
	FGameplayTag SecondType;
	float SecondShare = 0.f;
	ResolveDamageTypes(World, Hit.DamageTypes, WeaponType, PrimaryType, SecondType, SecondShare);
	Blast->InitBomb(SourceAbilitySystemComponent, Damage, Hit.BlastRadiusCm > 0.f ? Hit.BlastRadiusCm : 100.f,
		Hit.KnockbackMultiplier, PrimaryType, nullptr, FMath::Max(Hit.FuseSeconds, 0.001f));
	Blast->InitBombSecondType(SecondType, SecondShare);

	// The blast's own status (a slam's aftershock stuns), else the weapon's, never the bomb Blueprint's.
	if (Hit.StatusEffect)
	{
		Blast->InitBombStatus(Hit.StatusEffect, Hit.StatusChance, Hit.StatusSeconds, StatusTickAt(World, Hit.StatusTickDamageByDepth, Hit.StatusTickDamage));
	}
	else if (const UClockworksWeaponDefinition* Weapon = GetSourceWeapon())
	{
		Blast->InitBombStatus(Weapon->StatusEffect, Weapon->StatusChance, Weapon->StatusSeconds,
			StatusTickAt(World, Weapon->StatusTickDamageByDepth, Weapon->StatusTickDamage));
	}
}

// Runs on: owning client and server. A root motion source like the forward lunge, in any floor direction.
void UClockworksSwordAttackAbility::StartLungeVector(const FVector2D& DistanceCm, float Seconds)
{
	ACharacter* Avatar = GetAvatarCharacter();
	const float Distance = DistanceCm.Size();
	if (!Avatar || Distance < UE_KINDA_SMALL_NUMBER || Seconds <= 0.f)
	{
		return;
	}
	FVector Forward = Avatar->GetActorForwardVector();
	Forward.Z = 0.f;
	Forward = Forward.GetSafeNormal();
	const FVector Right = FVector::CrossProduct(FVector::UpVector, Forward);
	const FVector Direction = (Forward * DistanceCm.X + Right * DistanceCm.Y).GetSafeNormal();
	UAbilityTask_ApplyRootMotionConstantForce* Lunge = UAbilityTask_ApplyRootMotionConstantForce::ApplyRootMotionConstantForce(
		this, NAME_None, Direction, Distance / Seconds, ClampPhaseSeconds(Seconds), /*bIsAdditive*/ false, /*StrengthOverTime*/ nullptr,
		ERootMotionFinishVelocityMode::SetVelocity, FVector::ZeroVector, 0.f, /*bEnableGravity*/ false);
	Lunge->ReadyForActivation();
}

// Runs on: owning client and server.
void UClockworksSwordAttackAbility::StartChargeLungeAt(int32 Index)
{
	if (IsActive() && ChargeLunges.IsValidIndex(Index))
	{
		StartLungeVector(ChargeLunges[Index].DistanceCm, ChargeLunges[Index].Seconds);
	}
}

// Runs on: owning client and server. Same split as the animations.
void UClockworksSwordAttackAbility::PlayPhaseSequence(const TArray<FClockworksClipSegment>& Segments)
{
	AClockworksCharacter* Knight = GetKnight();
	if (!Knight)
	{
		return;
	}
	if (HasServerAuthority())
	{
		Knight->MulticastPlaySlotSequence(Segments, NAME_None);
	}
	else
	{
		Knight->PlaySlotSequence(Segments, NAME_None);
	}
}

// Runs on: owning client and server. Same split as the animations.
void UClockworksSwordAttackAbility::ReleaseHeldPose()
{
	AClockworksCharacter* Knight = GetKnight();
	if (!Knight)
	{
		return;
	}
	if (HasServerAuthority())
	{
		Knight->MulticastReleaseHeldSlotAnimation(NAME_None);
	}
	else
	{
		Knight->ReleaseHeldSlotAnimation(0.15f, NAME_None);
	}
}

// Runs on: owning client and server. Same split as the animations.
void UClockworksSwordAttackAbility::PlayPhaseSound(USoundBase* Sound)
{
	AClockworksCharacter* Knight = GetKnight();
	if (!Knight || !Sound)
	{
		return;
	}
	if (HasServerAuthority())
	{
		Knight->MulticastPlaySound(Sound);
	}
	else
	{
		Knight->PlaySoundLocal(Sound);
	}
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
void UClockworksSwordAttackAbility::PlayPhaseAnim(UAnimSequenceBase* Anim, float PhaseSeconds, bool bLoop, float ExplicitRate)
{
	AClockworksCharacter* Knight = GetKnight();
	if (!Knight || !Anim)
	{
		return;
	}

	const float Length = Anim->GetPlayLength();
	const float Rate = ExplicitRate > 0.f
		? ExplicitRate
		: ((PhaseSeconds > 0.f && Length > 0.f) ? Length / PhaseSeconds : 1.f);

	// A swing takes the whole body: the knight plants and turns into it, legs included.
	if (HasServerAuthority())
	{
		Knight->MulticastPlaySlotAnimation(Anim, Rate, bLoop, Knight->GetFullBodySlotName());
	}
	else
	{
		Knight->PlaySlotAnimation(Anim, Rate, bLoop, Knight->GetFullBodySlotName());
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
		Knight->MulticastStopSlotAnimation(Knight->GetFullBodySlotName());
	}
	else
	{
		Knight->StopSlotAnimation(0.1f, Knight->GetFullBodySlotName());
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
		for (FTimerHandle& Handle_ : BulletTimers)
		{
			Timers.ClearTimer(Handle_);
		}
		BulletTimers.Reset();
		for (FTimerHandle& Handle_ : ChargeLungeTimers)
		{
			Timers.ClearTimer(Handle_);
		}
		ChargeLungeTimers.Reset();
	}
	// A held clip of a strike's run ends with the ability.
	ReleaseHeldPose();
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
	// The hold loop plays on the arms, so a charge dropped early or cancelled stops it there too.
	if (bCharging)
	{
		if (AClockworksCharacter* Knight = GetKnight())
		{
			if (HasServerAuthority())
			{
				Knight->MulticastStopSlotAnimation(Knight->GetUpperBodySlotName());
			}
			else
			{
				Knight->StopSlotAnimation(0.1f, Knight->GetUpperBodySlotName());
			}
		}
	}
	bCharging = false;
	bChargeReady = false;
	bChargeAttacking = false;

	// The charge is gone, whether it was spent, dropped early or cancelled: take the hum and the aura
	// with it. Stopping a loop that never started is a no-op, so this is safe on every exit path.
	SetChargeLoopSound(false);

	if (AClockworksCharacter* Knight = GetKnight())
	{
		if (HasServerAuthority())
		{
			Knight->SetChargeReady(false);
		}
		else
		{
			Knight->ShowChargeReady(false);
		}
	}

	RemoveLocalTag(ClockworksTags::State_RotationLocked);
	RemoveLocalTag(ClockworksTags::State_MovementLocked);
	RemoveLocalTag(ClockworksTags::State_Charging);

	Super::EndAbility(Handle, ActorInfo, ActivationInfo, bReplicateEndAbility, bWasCancelled);
}
