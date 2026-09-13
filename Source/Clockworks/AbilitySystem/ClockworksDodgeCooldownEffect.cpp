// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksDodgeCooldownEffect.h"
#include "ClockworksGameplayTags.h"
#include "GameplayEffectComponents/TargetTagsGameplayEffectComponent.h"

// Runs on: all machines (class default object). Fully configured here; no Blueprint asset needed.
UClockworksDodgeCooldownEffect::UClockworksDodgeCooldownEffect()
{
	DurationPolicy = EGameplayEffectDurationType::HasDuration;

	FSetByCallerFloat DurationSetByCaller;
	DurationSetByCaller.DataTag = ClockworksTags::Data_Cooldown;
	DurationMagnitude = FGameplayEffectModifierMagnitude(DurationSetByCaller);

	// Granted tags live in a component since 5.3. FindOrAddComponent uses NewObject, which the engine
	// forbids inside a constructor, so create it as a named default subobject and register it by hand.
	UTargetTagsGameplayEffectComponent* TargetTagsComponent = CreateDefaultSubobject<UTargetTagsGameplayEffectComponent>(TEXT("TargetTagsComponent"));
	GEComponents.Add(TargetTagsComponent);

	FInheritedTagContainer GrantedTags;
	GrantedTags.AddTag(ClockworksTags::Cooldown_Dodge);
	TargetTagsComponent->SetAndApplyTargetTagChanges(GrantedTags);
}
