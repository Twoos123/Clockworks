// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksEnemyMeleeAbility.h"
#include "ClockworksAttackCooldownEffect.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksDamageEffect.h"
#include "ClockworksEnemyAIController.h"
#include "ClockworksEnemyCharacter.h"
#include "Sound/SoundBase.h"
#include "ClockworksGameplayTags.h"
#include "AbilitySystemComponent.h"
#include "AbilitySystemInterface.h"
#include "Abilities/Tasks/AbilityTask_ApplyRootMotionConstantForce.h"
#include "Abilities/Tasks/AbilityTask_PlayMontageAndWait.h"
#include "Abilities/Tasks/AbilityTask_WaitDelay.h"
#include "Animation/AnimMontage.h"
#include "Animation/AnimSequenceBase.h"
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
	ActivationBlockedTags.AddTag(ClockworksTags::State_Stunned);
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

	// Visuals only, and the most important clip in the game: the telegraph the player reads before
	// stepping out of the way. Either one clip for the whole attack, or the windup now and the rest
	// per phase.
	// The telegraph is heard as well as seen: this is the cue the player reacts to when the enemy is
	// off the edge of the screen. Enemy abilities are server-only, so a multicast reaches everyone.
	if (AClockworksEnemyCharacter* Enemy = Cast<AClockworksEnemyCharacter>(Avatar))
	{
		Enemy->MulticastPlaySound(AttackSound);
		// The tint goes up with the windup and comes down when the hitbox opens: it marks the window
		// you still have to get out of the way, not the attack itself.
		Enemy->SetTelegraph(true);
	}

	if (WindupAnim || AttackAnim)
	{
		PlayPhase(WindupAnim ? WindupAnim.Get() : AttackAnim.Get(), nullptr, WindupSeconds);
	}
	else
	{
		PlayPhaseMontage(WindupMontage ? WindupMontage.Get() : AttackMontage.Get());
	}

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

	// The window to react has closed; the tint comes off as the hitbox opens.
	if (AClockworksEnemyCharacter* Enemy = Cast<AClockworksEnemyCharacter>(Avatar))
	{
		Enemy->SetTelegraph(false);
	}

	if (WindupAnim)
	{
		PlayPhase(AttackAnim, nullptr, LungeSeconds);
	}
	else if (WindupMontage)
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

	if (RecoilDistance > 0.f)
	{
		// A step backwards instead of a lunge: the original's lickers and throwers pull away as they strike.
		FVector Backwards = -Avatar->GetActorForwardVector();
		Backwards.Z = 0.f;
		UAbilityTask_ApplyRootMotionConstantForce* Recoil = UAbilityTask_ApplyRootMotionConstantForce::ApplyRootMotionConstantForce(
			this, NAME_None, Backwards.GetSafeNormal(), RecoilDistance / FMath::Max(RecoilSeconds, 0.01f), ClampPhaseSeconds(RecoilSeconds), /*bIsAdditive*/ false, /*StrengthOverTime*/ nullptr,
			ERootMotionFinishVelocityMode::SetVelocity, FVector::ZeroVector, 0.f, /*bEnableGravity*/ false);
		Recoil->ReadyForActivation();
	}

	// The hitbox opens part-way through the strike where the monster's data says so, which is what makes the swing
	// readable rather than instant.
	if (UWorld* World = GetWorld(); World && HitDelaySeconds > 0.f)
	{
		World->GetTimerManager().SetTimer(HitWindowTimer, this, &UClockworksEnemyMeleeAbility::OpenHitWindow, ClampPhaseSeconds(HitDelaySeconds), false);
	}
	else
	{
		OpenHitWindow();
	}

	UAbilityTask_WaitDelay* Active = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(LungeSeconds + HitDelaySeconds));
	Active->OnFinish.AddDynamic(this, &UClockworksEnemyMeleeAbility::OnLungeFinished);
	Active->ReadyForActivation();
}

// Runs on: server only, from the hit-delay timer or straight away. The hitbox stays live for the rest of the strike.
void UClockworksEnemyMeleeAbility::OpenHitWindow()
{
	DoHitCheck();
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().SetTimer(HitCheckTimer, this, &UClockworksEnemyMeleeAbility::DoHitCheck, HitCheckInterval, true);
	}
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

	// A rectangle where the monster's data names one (a chromalisk's lick reaches far and stays narrow), turned with the
	// monster; otherwise the sphere. Tall enough to catch anything standing on the same floor.
	const bool bBox = !HitBoxSizeCm.IsNearlyZero();
	const FVector BoxHalfExtent(HitBoxSizeCm.X * 0.5f, HitBoxSizeCm.Y * 0.5f, 100.f);
	const FQuat BoxRotation(FRotator(0.f, Avatar->GetActorRotation().Yaw, 0.f));

	if (bDrawDebugHitbox)
	{
		if (bBox)
		{
			DrawDebugBox(World, Center, BoxHalfExtent, BoxRotation, FColor::Orange, false, HitCheckInterval * 2.f);
		}
		else
		{
			DrawDebugSphere(World, Center, HitRadius, 16, FColor::Orange, false, HitCheckInterval * 2.f);
		}
	}

	TArray<FOverlapResult> Overlaps;
	FCollisionQueryParams QueryParams(TEXT("ClockworksEnemyMeleeHit"), /*bTraceComplex*/ false, Avatar);
	World->OverlapMultiByObjectType(Overlaps, Center, bBox ? BoxRotation : FQuat::Identity, FCollisionObjectQueryParams(ECC_Pawn),
		bBox ? FCollisionShape::MakeBox(BoxHalfExtent) : FCollisionShape::MakeSphere(HitRadius), QueryParams);

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
	// The original's damage at this depth, split by type, when the monster carries it; otherwise the flat number.
	float Parts[4];
	if (DepthDamageParts(GetWorld(), NormalDamageByDepth, PiercingDamageByDepth, ElementalDamageByDepth, ShadowDamageByDepth, Parts))
	{
		SetTypedDamageMagnitudes(SpecHandle, Parts);
	}
	else
	{
		SetDamageMagnitudes(SpecHandle, BaseDamage + AttackPower, ResolveDamageType());
	}

	SpecHandle.Data->SetSetByCallerMagnitude(ClockworksTags::Data_Knockback, KnockbackMultiplier);
	SourceAbilitySystemComponent->ApplyGameplayEffectSpecToTarget(*SpecHandle.Data, TargetAbilitySystemComponent);

	ApplyWeaponStatus(SourceAbilitySystemComponent, TargetAbilitySystemComponent);

	if (AClockworksEnemyCharacter* Enemy = Cast<AClockworksEnemyCharacter>(GetAvatarActorFromActorInfo()))
	{
		Enemy->MulticastPlaySound(HitSound);
	}
}

// Runs on: server only. Recovery: the punish window.
void UClockworksEnemyMeleeAbility::OnLungeFinished()
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(HitCheckTimer);
	}

	if (WindupAnim)
	{
		PlayPhase(RecoveryAnim, nullptr, RecoverySeconds);
	}
	else if (WindupMontage)
	{
		PlayPhaseMontage(RecoveryMontage);
	}

	UAbilityTask_WaitDelay* Recovery = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(RecoverySeconds));
	Recovery->OnFinish.AddDynamic(this, &UClockworksEnemyMeleeAbility::OnRecoveryFinished);
	Recovery->ReadyForActivation();
}

// Runs on: server only. The enemy character multicasts the clip, fitted to the phase, so the timing
// always comes from the numbers rather than the animation's own length.
void UClockworksEnemyMeleeAbility::PlayPhase(UAnimSequenceBase* Anim, UAnimMontage* Montage, float PhaseSeconds)
{
	if (Anim)
	{
		if (AClockworksEnemyCharacter* Enemy = Cast<AClockworksEnemyCharacter>(GetAvatarCharacter()))
		{
			Enemy->PlayPhaseAnimation(Anim, PhaseSeconds);
			return;
		}
	}
	PlayPhaseMontage(Montage);
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
		World->GetTimerManager().ClearTimer(HitWindowTimer);
	}
	RemoveLocalTag(ClockworksTags::State_MovementLocked);

	// Belt and braces: an attack cancelled during its windup (a stun, a death) must not leave the
	// enemy tinted for the rest of its life.
	if (AClockworksEnemyCharacter* Enemy = Cast<AClockworksEnemyCharacter>(GetAvatarActorFromActorInfo()))
	{
		Enemy->SetTelegraph(false);
	}

	Super::EndAbility(Handle, ActorInfo, ActivationInfo, bReplicateEndAbility, bWasCancelled);
}
