// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksDamageEffect.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksGameplayTags.h"

// Runs on: all machines (class default object). Fully configured here; no Blueprint asset needed.
UClockworksDamageEffect::UClockworksDamageEffect()
{
	DurationPolicy = EGameplayEffectDurationType::Instant;

	FSetByCallerFloat SetByCaller;
	SetByCaller.DataTag = ClockworksTags::Data_Damage;

	FGameplayModifierInfo DamageModifier;
	DamageModifier.Attribute = UClockworksAttributeSet::GetDamageAttribute();
	DamageModifier.ModifierOp = EGameplayModOp::Additive;
	DamageModifier.ModifierMagnitude = FGameplayEffectModifierMagnitude(SetByCaller);

	Modifiers.Add(DamageModifier);
}
