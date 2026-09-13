// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksPlayerState.h"
#include "ClockworksAttributeSet.h"
#include "AbilitySystemComponent.h"

// Runs on: all machines (class default object and every instance). The PlayerState replicates to
// everyone, so every client gets a copy of the component and the attribute set.
AClockworksPlayerState::AClockworksPlayerState()
{
	AbilitySystemComponent = CreateDefaultSubobject<UAbilitySystemComponent>(TEXT("AbilitySystemComponent"));
	AbilitySystemComponent->SetIsReplicated(true);

	// Mixed: gameplay effects replicate to the owning client only, tags and cues to everyone.
	// The right mode for a player-owned component; Minimal is for AI.
	AbilitySystemComponent->SetReplicationMode(EGameplayEffectReplicationMode::Mixed);

	// Found by the component automatically because it is a subobject of the same owner.
	AttributeSet = CreateDefaultSubobject<UClockworksAttributeSet>(TEXT("AttributeSet"));

	// PlayerStates default to one update per second, far too slow for combat state.
	SetNetUpdateFrequency(100.f);
}
