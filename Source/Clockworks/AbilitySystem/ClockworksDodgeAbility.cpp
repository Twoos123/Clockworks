// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksDodgeAbility.h"
#include "ClockworksCharacter.h"
#include "ClockworksDodgeCooldownEffect.h"
#include "ClockworksGameplayTags.h"
#include "Animation/AnimSequenceBase.h"
#include "AbilitySystemComponent.h"
#include "Abilities/Tasks/AbilityTask_ApplyRootMotionConstantForce.h"
#include "Abilities/Tasks/AbilityTask_PlayMontageAndWait.h"
#include "Abilities/Tasks/AbilityTask_WaitDelay.h"
#include "Animation/AnimMontage.h"
#include "GameFramework/Character.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/RootMotionSource.h"

// Runs on: all machines (class default object).
UClockworksDodgeAbility::UClockworksDodgeAbility()
{
	SetAssetTags(FGameplayTagContainer(ClockworksTags::Ability_Dodge));
	AbilityInputID = EClockworksAbilityInputID::Dodge;

	ActivationOwnedTags.AddTag(ClockworksTags::State_Dodging);

	// An attack no longer blocks the dodge outright; CanActivateAbility decides. When the dodge does
	// come out mid-attack, it ends the attack, which is what makes it a cancel rather than an overlap.
	ActivationBlockedTags.AddTag(ClockworksTags::State_Dodging);
	ActivationBlockedTags.AddTag(ClockworksTags::State_Dead);
	CancelAbilitiesWithTag.AddTag(ClockworksTags::Ability_Attack);

	// The cooldown effect grants Cooldown.Dodge; CommitAbility refuses while that tag is present.
	CooldownGameplayEffectClass = UClockworksDodgeCooldownEffect::StaticClass();
}

// Runs on: owning client (predicting) and server. The user's rule: the dodge may cut an attack's
// recovery short, but never its windup or its live hit, and never a charge being held. Those
// committed parts already carry tags every attack sets on both machines: the windup and the live hit
// lock rotation (a sword swing, a bomb being put down, a charged release), and a held charge or an
// arming bomb carries State.Charging. Anything else during State.Attacking is recovery.
bool UClockworksDodgeAbility::CanActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayTagContainer* SourceTags, const FGameplayTagContainer* TargetTags, FGameplayTagContainer* OptionalRelevantTags) const
{
	if (!Super::CanActivateAbility(Handle, ActorInfo, SourceTags, TargetTags, OptionalRelevantTags))
	{
		return false;
	}

	const UAbilitySystemComponent* AbilitySystemComponent = ActorInfo ? ActorInfo->AbilitySystemComponent.Get() : nullptr;
	if (AbilitySystemComponent && AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Attacking))
	{
		const bool bCommitted = AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_RotationLocked)
			|| AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Charging);
		if (bCommitted)
		{
			return false;
		}
	}
	return true;
}

// Runs on: owning client (predicted) and server, each on its own instance. Super is deliberately
// not called: the engine's default ActivateAbility commits the ability itself, which would double up.
void UClockworksDodgeAbility::ActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, const FGameplayEventData* TriggerEventData)
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

	// Direction of the current movement input; facing if there is none. Each machine reads its own
	// movement component: the client's from input, the server's from the last move packet.
	FVector Direction = Avatar->GetCharacterMovement()->GetCurrentAcceleration();
	Direction.Z = 0.f;
	if (Direction.IsNearlyZero())
	{
		Direction = Avatar->GetActorForwardVector();
		Direction.Z = 0.f;
	}
	Direction = Direction.GetSafeNormal();

	// A constant-velocity root motion source rather than a launch: ground braking can't eat it, so the
	// distance is exactly DodgeSpeed x DodgeSeconds. The movement component predicts it on the owning
	// client and reconciles it with the server like any other move. Velocity is zeroed at the end for
	// a crisp stop; gravity is off for the burst so it doesn't dip on slopes.
	UAbilityTask_ApplyRootMotionConstantForce* Dash = UAbilityTask_ApplyRootMotionConstantForce::ApplyRootMotionConstantForce(
		this, NAME_None, Direction, DodgeSpeed, ClampPhaseSeconds(DodgeSeconds), /*bIsAdditive*/ false, /*StrengthOverTime*/ nullptr,
		ERootMotionFinishVelocityMode::SetVelocity, FVector::ZeroVector, 0.f, /*bEnableGravity*/ false);
	Dash->OnFinish.AddDynamic(this, &UClockworksDodgeAbility::OnDodgeFinished);
	Dash->ReadyForActivation();

	// Visuals only. The raw clip is fitted to DodgeSeconds so the roll always finishes inside the burst;
	// the owning client shows its own prediction and the server broadcasts to everyone else.
	AClockworksCharacter* Knight = Cast<AClockworksCharacter>(Avatar);
	if (Knight && DodgeAnim)
	{
		const float Rate = FMath::Max(DodgeAnimRate, 0.1f);
		if (HasServerAuthority())
		{
			Knight->MulticastPlaySlotAnimation(DodgeAnim, Rate, false, Knight->GetFullBodySlotName());
		}
		else
		{
			Knight->PlaySlotAnimation(DodgeAnim, Rate, false, Knight->GetFullBodySlotName());
		}
	}
	else if (DodgeMontage && ActorInfo && ActorInfo->GetAnimInstance())
	{
		// The older path: the ability system replicates the montage to other clients on its own.
		UAbilityTask_PlayMontageAndWait* MontageTask = UAbilityTask_PlayMontageAndWait::CreatePlayMontageAndWaitProxy(this, NAME_None, DodgeMontage, MontagePlayRate, NAME_None, /*bStopWhenAbilityEnds*/ true);
		MontageTask->ReadyForActivation();
	}

	AddLocalTag(ClockworksTags::State_Invulnerable);

	UAbilityTask_WaitDelay* Invulnerability = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(InvulnerableSeconds));
	Invulnerability->OnFinish.AddDynamic(this, &UClockworksDodgeAbility::OnInvulnerabilityFinished);
	Invulnerability->ReadyForActivation();
}

// Runs on: owning client and server.
void UClockworksDodgeAbility::OnInvulnerabilityFinished()
{
	RemoveLocalTag(ClockworksTags::State_Invulnerable);
}

// Runs on: owning client and server, when the dash's duration elapses.
void UClockworksDodgeAbility::OnDodgeFinished()
{
	EndAbility(CurrentSpecHandle, CurrentActorInfo, CurrentActivationInfo, true, false);
}

// Runs on: owning client (predicted) and server, from CommitAbility. Same as the engine's version
// except the duration comes from CooldownSeconds instead of a fixed number on the effect.
void UClockworksDodgeAbility::ApplyCooldown(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo) const
{
	if (!CooldownGameplayEffectClass)
	{
		return;
	}

	FGameplayEffectSpecHandle SpecHandle = MakeOutgoingGameplayEffectSpec(Handle, ActorInfo, ActivationInfo, CooldownGameplayEffectClass, GetAbilityLevel(Handle, ActorInfo));
	if (SpecHandle.IsValid())
	{
		SpecHandle.Data->SetSetByCallerMagnitude(ClockworksTags::Data_Cooldown, CooldownSeconds);
		ApplyGameplayEffectSpecToOwner(Handle, ActorInfo, ActivationInfo, SpecHandle);
	}
}

// Runs on: owning client and server, including on cancel. Ending the ability also ends the dash task.
void UClockworksDodgeAbility::EndAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, bool bReplicateEndAbility, bool bWasCancelled)
{
	RemoveLocalTag(ClockworksTags::State_Invulnerable);

	Super::EndAbility(Handle, ActorInfo, ActivationInfo, bReplicateEndAbility, bWasCancelled);
}
