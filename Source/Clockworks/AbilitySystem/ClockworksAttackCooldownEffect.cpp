// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksAttackCooldownEffect.h"
#include "ClockworksGameplayTags.h"
#include "GameplayEffectComponents/TargetTagsGameplayEffectComponent.h"

// Runs on: all machines (class default object). Fully configured here; no Blueprint asset needed.
UClockworksAttackCooldownEffect::UClockworksAttackCooldownEffect()
{
	DurationPolicy = EGameplayEffectDurationType::HasDuration;

	FSetByCallerFloat DurationSetByCaller;
	DurationSetByCaller.DataTag = ClockworksTags::Data_Cooldown;
	DurationMagnitude = FGameplayEffectModifierMagnitude(DurationSetByCaller);

	// Same shape as the dodge cooldown: a named default subobject, registered by hand, because
	// FindOrAddComponent is not allowed inside a constructor.
	UTargetTagsGameplayEffectComponent* TargetTagsComponent = CreateDefaultSubobject<UTargetTagsGameplayEffectComponent>(TEXT("TargetTagsComponent"));
	GEComponents.Add(TargetTagsComponent);

	FInheritedTagContainer GrantedTags;
	GrantedTags.AddTag(ClockworksTags::Cooldown_Attack);
	TargetTagsComponent->SetAndApplyTargetTagChanges(GrantedTags);
}
