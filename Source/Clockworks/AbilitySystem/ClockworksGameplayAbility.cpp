// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksGameplayAbility.h"
#include "ClockworksGameplayTags.h"
#include "AbilitySystemComponent.h"
#include "GameFramework/Character.h"

// Runs on: all machines (class default object).
UClockworksGameplayAbility::UClockworksGameplayAbility()
{
	InstancingPolicy = EGameplayAbilityInstancingPolicy::InstancedPerActor;
	NetExecutionPolicy = EGameplayAbilityNetExecutionPolicy::LocalPredicted;
}

// Runs on: wherever the ability instance runs.
ACharacter* UClockworksGameplayAbility::GetAvatarCharacter() const
{
	return Cast<ACharacter>(GetAvatarActorFromActorInfo());
}

// Runs on: wherever the ability instance runs. GetCurrentActivationInfo returns by value, so take
// a local copy before asking HasAuthority about it.
bool UClockworksGameplayAbility::HasServerAuthority() const
{
	const FGameplayAbilityActivationInfo ActivationInfo = GetCurrentActivationInfo();
	return HasAuthority(&ActivationInfo);
}

// Runs on: wherever it is called. Pure query.
FGameplayTag UClockworksGameplayAbility::GetFactionTag(const UAbilitySystemComponent* AbilitySystemComponent)
{
	if (AbilitySystemComponent)
	{
		if (AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::Faction_Player))
		{
			return ClockworksTags::Faction_Player;
		}
		if (AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::Faction_Enemy))
		{
			return ClockworksTags::Faction_Enemy;
		}
	}
	return FGameplayTag();
}

// Runs on: this machine only. Not replicated by design; see the header.
void UClockworksGameplayAbility::AddLocalTag(const FGameplayTag& Tag) const
{
	if (UAbilitySystemComponent* AbilitySystemComponent = GetAbilitySystemComponentFromActorInfo())
	{
		AbilitySystemComponent->AddLooseGameplayTag(Tag, 1, EGameplayTagReplicationState::None);
	}
}

// Runs on: this machine only. Safe to call when the tag is already gone.
void UClockworksGameplayAbility::RemoveLocalTag(const FGameplayTag& Tag) const
{
	UAbilitySystemComponent* AbilitySystemComponent = GetAbilitySystemComponentFromActorInfo();
	if (AbilitySystemComponent && AbilitySystemComponent->HasMatchingGameplayTag(Tag))
	{
		AbilitySystemComponent->RemoveLooseGameplayTag(Tag, 1, EGameplayTagReplicationState::None);
	}
}

float UClockworksGameplayAbility::ClampPhaseSeconds(float Seconds)
{
	return FMath::Max(Seconds, 0.01f);
}
