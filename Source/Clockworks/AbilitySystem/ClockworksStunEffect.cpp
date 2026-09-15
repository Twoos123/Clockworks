// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksStunEffect.h"
#include "ClockworksGameplayTags.h"
#include "GameplayEffectComponents/TargetTagsGameplayEffectComponent.h"

// Runs on: all machines (class default object). Fully configured here; no Blueprint asset needed.
UClockworksStunEffect::UClockworksStunEffect()
{
	DurationPolicy = EGameplayEffectDurationType::HasDuration;

	FSetByCallerFloat DurationSetByCaller;
	DurationSetByCaller.DataTag = ClockworksTags::Data_Duration;
	DurationMagnitude = FGameplayEffectModifierMagnitude(DurationSetByCaller);

	// No stacking rules: a second stun simply runs alongside the first, and the tag stays until the
	// later one expires, which reads the same as a refresh.

	// Same shape as the cooldown effects: a named default subobject, registered by hand, because
	// FindOrAddComponent is not allowed inside a constructor.
	UTargetTagsGameplayEffectComponent* TargetTagsComponent = CreateDefaultSubobject<UTargetTagsGameplayEffectComponent>(TEXT("TargetTagsComponent"));
	GEComponents.Add(TargetTagsComponent);

	FInheritedTagContainer GrantedTags;
	GrantedTags.AddTag(ClockworksTags::State_Stunned);
	TargetTagsComponent->SetAndApplyTargetTagChanges(GrantedTags);
}
