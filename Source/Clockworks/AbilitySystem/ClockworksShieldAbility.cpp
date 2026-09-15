// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksShieldAbility.h"
#include "ClockworksCharacter.h"
#include "ClockworksDamageEffect.h"
#include "ClockworksEnemyCharacter.h"
#include "ClockworksGameplayTags.h"
#include "ClockworksGearDefinition.h"
#include "ClockworksPlayerState.h"
#include "Clockworks.h"
#include "AbilitySystemComponent.h"
#include "AbilitySystemInterface.h"
#include "Abilities/Tasks/AbilityTask_WaitInputRelease.h"
#include "CollisionQueryParams.h"
#include "Components/CapsuleComponent.h"
#include "Engine/OverlapResult.h"
#include "Engine/World.h"

namespace
{
	/**
	 * The original's shield push-back by Knock-Back Power 1 to 5: 3.0 to 5.0 tiles over 400 to 800 ms at impulse
	 * level 1 to 5, as a multiplier on the monster's own knockback (tiles ÷ 2.5, like the rest of this project's
	 * knockback). Research: D:\Dev\SKAssets\_research\shield_bonus\findings.md.
	 */
	const float PushBackMultiplier[] = { 0.f, 1.2f, 1.4f, 1.6f, 1.8f, 2.0f };

	/** How far past the knight's capsule a monster still counts as touching it, in cm (INFERRED). */
	constexpr float PushBackReach = 40.f;
}

// Runs on: all machines (class default object).
UClockworksShieldAbility::UClockworksShieldAbility()
{
	SetAssetTags(FGameplayTagContainer(ClockworksTags::Ability_Shield));
	AbilityInputID = EClockworksAbilityInputID::Shield;

	// Owned for the whole hold: the attribute set reads it to route damage into the shield, the
	// character reads it for the walk speed, the attacks refuse to start while it is present.
	ActivationOwnedTags.AddTag(ClockworksTags::State_Shielding);

	ActivationBlockedTags.AddTag(ClockworksTags::State_Attacking);
	ActivationBlockedTags.AddTag(ClockworksTags::State_Dodging);
	ActivationBlockedTags.AddTag(ClockworksTags::State_Reloading);
	ActivationBlockedTags.AddTag(ClockworksTags::State_ShieldBroken);
	ActivationBlockedTags.AddTag(ClockworksTags::State_Dead);
}

// Runs on: wherever the instance runs.
AClockworksCharacter* UClockworksShieldAbility::GetKnight() const
{
	return Cast<AClockworksCharacter>(GetAvatarCharacter());
}

// Runs on: owning client (predicted) and server, each on its own instance. Super is deliberately
// not called: the engine's default ActivateAbility commits the ability itself, which would double up.
void UClockworksShieldAbility::ActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, const FGameplayEventData* TriggerEventData)
{
	if (!CommitAbility(Handle, ActorInfo, ActivationInfo))
	{
		EndAbility(Handle, ActorInfo, ActivationInfo, true, true);
		return;
	}

	AClockworksCharacter* Knight = GetKnight();
	if (!Knight)
	{
		EndAbility(Handle, ActorInfo, ActivationInfo, true, true);
		return;
	}

	// The server's raise replicates to everyone else; the owning client shows its own at once.
	if (HasServerAuthority())
	{
		Knight->SetShieldRaised(true);
		PushBack(Knight);
	}
	else
	{
		Knight->ShowShieldRaised(true);
	}

	// Never hold without a way out. If the button is in fact already up, this fires at once. The
	// release arrives here on the client directly and on the server through the ability system's
	// replicated input event.
	ReleaseTask = UAbilityTask_WaitInputRelease::WaitInputRelease(this, /*bTestAlreadyReleased*/ true);
	ReleaseTask->OnRelease.AddDynamic(this, &UClockworksShieldAbility::OnShieldReleased);
	ReleaseTask->ReadyForActivation();
}

// Runs on: server only. The original's shield push-back: raising the shield shoves every monster touching the knight
// straight away from it, with no damage (INFERRED to fire once on the raise; research findings.md). Heavy monsters
// whose impulse level is above the push's are not moved.
void UClockworksShieldAbility::PushBack(AClockworksCharacter* Knight)
{
	const AClockworksPlayerState* KnightState = Knight ? Knight->GetPlayerState<AClockworksPlayerState>() : nullptr;
	const UClockworksGearDefinition* Shield = KnightState ? KnightState->GetGear(EClockworksGearSlotIndex::Shield) : nullptr;
	const int32 Power = Shield ? FMath::Clamp(FMath::RoundToInt(Shield->ShieldPushBack), 0, UE_ARRAY_COUNT(PushBackMultiplier) - 1) : 0;
	UAbilitySystemComponent* Source = GetAbilitySystemComponentFromActorInfo();
	UWorld* World = Knight ? Knight->GetWorld() : nullptr;
	if (Power <= 0 || !Source || !World)
	{
		return;
	}

	const float Radius = (Knight->GetCapsuleComponent() ? Knight->GetCapsuleComponent()->GetScaledCapsuleRadius() : 40.f) + PushBackReach;
	TArray<FOverlapResult> Overlaps;
	FCollisionQueryParams QueryParams(TEXT("ClockworksShieldPushBack"), /*bTraceComplex*/ false, Knight);
	World->OverlapMultiByObjectType(Overlaps, Knight->GetActorLocation(), FQuat::Identity, FCollisionObjectQueryParams(ECC_Pawn), FCollisionShape::MakeSphere(Radius), QueryParams);

	const FGameplayTag SourceFaction = GetFactionTag(Source);
	TSet<AActor*> Pushed;
	for (const FOverlapResult& Overlap : Overlaps)
	{
		AActor* HitActor = Overlap.GetActor();
		if (!HitActor || HitActor == Knight || Pushed.Contains(HitActor))
		{
			continue;
		}
		const IAbilitySystemInterface* TargetInterface = Cast<IAbilitySystemInterface>(HitActor);
		UAbilitySystemComponent* Target = TargetInterface ? TargetInterface->GetAbilitySystemComponent() : nullptr;
		if (!Target || (SourceFaction.IsValid() && Target->HasMatchingGameplayTag(SourceFaction)) || Target->HasMatchingGameplayTag(ClockworksTags::State_Dead))
		{
			continue;
		}
		if (const AClockworksEnemyCharacter* Monster = Cast<AClockworksEnemyCharacter>(HitActor); Monster && Monster->GetImpulseLevel() > Power)
		{
			continue;
		}
		Pushed.Add(HitActor);

		FGameplayEffectContextHandle Context = Source->MakeEffectContext();
		Context.AddInstigator(Knight, Knight);
		const FGameplayEffectSpecHandle Shove = Source->MakeOutgoingSpec(UClockworksDamageEffect::StaticClass(), 1.f, Context);
		if (Shove.IsValid())
		{
			// A hit that carries only the shove: the attribute set spends none of its damage.
			SetDamageMagnitudes(Shove, 1.f, FGameplayTag());
			Shove.Data->SetSetByCallerMagnitude(ClockworksTags::Data_ShoveOnly, 1.f);
			Shove.Data->SetSetByCallerMagnitude(ClockworksTags::Data_Knockback, PushBackMultiplier[Power]);
			Source->ApplyGameplayEffectSpecToTarget(*Shove.Data, Target);
		}
	}
	if (Pushed.Num() > 0)
	{
		UE_LOG(LogClockworks, Log, TEXT("Shield push-back (power %d): pushed %d"), Power, Pushed.Num());
	}
}

// Runs on: owning client and server, when the button comes up.
void UClockworksShieldAbility::OnShieldReleased(float TimeWaited)
{
	ReleaseTask = nullptr; // the task ends itself after this callback
	EndAbility(CurrentSpecHandle, CurrentActorInfo, CurrentActivationInfo, true, false);
}

// Runs on: owning client and server, including when the character cancels it on a shield break.
void UClockworksShieldAbility::EndAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, bool bReplicateEndAbility, bool bWasCancelled)
{
	if (ReleaseTask)
	{
		ReleaseTask->EndTask();
		ReleaseTask = nullptr;
	}

	if (AClockworksCharacter* Knight = GetKnight())
	{
		if (HasServerAuthority())
		{
			Knight->SetShieldRaised(false);
		}
		else
		{
			Knight->ShowShieldRaised(false);
		}
	}

	Super::EndAbility(Handle, ActorInfo, ActivationInfo, bReplicateEndAbility, bWasCancelled);
}
