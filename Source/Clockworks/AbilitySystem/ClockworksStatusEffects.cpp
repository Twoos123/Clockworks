// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksStatusEffects.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksGameplayTags.h"
#include "GameplayEffectComponents/TargetTagsGameplayEffectComponent.h"

namespace
{
	/** Every status runs for a SetByCaller duration, so the weapon decides, not the status. */
	void MakeTimedStatus(UGameplayEffect& Effect)
	{
		Effect.DurationPolicy = EGameplayEffectDurationType::HasDuration;

		FSetByCallerFloat DurationSetByCaller;
		DurationSetByCaller.DataTag = ClockworksTags::Data_Duration;
		Effect.DurationMagnitude = FGameplayEffectModifierMagnitude(DurationSetByCaller);
	}

	/**
	 * Damage every Period seconds, through the same meta attribute every other hit uses, so defense,
	 * shields, the family chart and the death check all apply to a burn exactly as to a sword.
	 */
	void MakePeriodicDamage(UGameplayEffect& Effect, float PeriodSeconds)
	{
		Effect.Period = FScalableFloat(PeriodSeconds);
		Effect.bExecutePeriodicEffectOnApplication = false;

		FGameplayModifierInfo DamageModifier;
		DamageModifier.Attribute = UClockworksAttributeSet::GetDamageAttribute();
		DamageModifier.ModifierOp = EGameplayModOp::Additive;

		FSetByCallerFloat DamageSetByCaller;
		DamageSetByCaller.DataTag = ClockworksTags::Data_Damage;
		DamageModifier.ModifierMagnitude = FGameplayEffectModifierMagnitude(DamageSetByCaller);
		Effect.Modifiers.Add(DamageModifier);
	}

	/**
	 * Builds the tag-granting component for a status. The caller adds it to its own GEComponents,
	 * because that member is protected and only the effect itself can reach it.
	 */
	UTargetTagsGameplayEffectComponent* MakeTagGrant(UObject* Outer, const FInheritedTagContainer& GrantedTags)
	{
		UTargetTagsGameplayEffectComponent* Component = NewObject<UTargetTagsGameplayEffectComponent>(
			Outer, UTargetTagsGameplayEffectComponent::StaticClass(), TEXT("TargetTagsComponent"));
		Component->SetAndApplyTargetTagChanges(GrantedTags);
		return Component;
	}

	/** Scales an attribute for the effect's lifetime, e.g. a stun cutting walk speed to a third. */
	void MakeAttributeScale(UGameplayEffect& Effect, const FGameplayAttribute& Attribute, float Multiplier)
	{
		FGameplayModifierInfo Modifier;
		Modifier.Attribute = Attribute;
		Modifier.ModifierOp = EGameplayModOp::Multiplicitive;
		Modifier.ModifierMagnitude = FGameplayEffectModifierMagnitude(FScalableFloat(Multiplier));
		Effect.Modifiers.Add(Modifier);
	}
}

// Runs on: all machines (class default object). Fully configured here; no Blueprint asset needed.
UClockworksFireEffect::UClockworksFireEffect()
{
	MakeTimedStatus(*this);

	// The Fire class's own damageInterval, 2000 ms (research: D:\Dev\SKAssets\_research\status_damage; the 500 ms read
	// first is the status signal). User's decision 2026-09-15.
	MakePeriodicDamage(*this, 2.f);

	FInheritedTagContainer GrantedTags;
	GrantedTags.AddTag(ClockworksTags::Status_Fire);
	GEComponents.Add(MakeTagGrant(this, GrantedTags));

	// The same tag on the effect itself, so the attribute set can recognise a burn tick and let it
	// past armour. An effect's own tags are the only thing it can be identified by there.
	InheritableGameplayEffectTags.AddTag(ClockworksTags::Status_Fire);
}

// Runs on: all machines (class default object).
UClockworksFreezeEffect::UClockworksFreezeEffect()
{
	MakeTimedStatus(*this);

	// Planted and unable to turn, but not unable to attack: that is the original's rule, and it is
	// what keeps freezing a ranged monster from being a free win. No damage of its own.
	FInheritedTagContainer GrantedTags;
	GrantedTags.AddTag(ClockworksTags::Status_Freeze);
	GrantedTags.AddTag(ClockworksTags::State_MovementLocked);
	GrantedTags.AddTag(ClockworksTags::State_RotationLocked);
	GrantedTags.AddTag(ClockworksTags::State_NoKnockback);
	GEComponents.Add(MakeTagGrant(this, GrantedTags));
}

// Runs on: all machines (class default object).
UClockworksShockEffect::UClockworksShockEffect()
{
	MakeTimedStatus(*this);

	// No ticks of its own: the damage is an arc on each spasm, every 1 to 4 s, hurting the shocked thing and everything on
	// its side within 2 tiles (user's decision 2026-09-15). Scheduled by UClockworksGameplayAbility::TryApplyStatus,
	// which carries the arc's damage.
	FInheritedTagContainer GrantedTags;
	GrantedTags.AddTag(ClockworksTags::Status_Shock);
	// Stunned as well, so the enemy brain, the attack blocks and the frozen pose all already respect
	// a shock without anything new having to learn what one is.
	GrantedTags.AddTag(ClockworksTags::State_Stunned);
	GEComponents.Add(MakeTagGrant(this, GrantedTags));
}

// Runs on: all machines (class default object).
UClockworksPoisonEffect::UClockworksPoisonEffect()
{
	MakeTimedStatus(*this);

	// The original's numbers: a poisoned monster deals about 45% less and has about 10% less defense,
	// and cannot be healed at all. No damage of its own; poison is a softener.
	MakeAttributeScale(*this, UClockworksAttributeSet::GetAttackPowerAttribute(), 0.55f);
	MakeAttributeScale(*this, UClockworksAttributeSet::GetDefensePowerAttribute(), 0.9f);

	FInheritedTagContainer GrantedTags;
	GrantedTags.AddTag(ClockworksTags::Status_Poison);
	GrantedTags.AddTag(ClockworksTags::State_NoHealing);
	GEComponents.Add(MakeTagGrant(this, GrantedTags));
}

// Runs on: all machines (class default object).
UClockworksStatusStunEffect::UClockworksStatusStunEffect()
{
	MakeTimedStatus(*this);

	// Slowed, not stopped. A stunned thing is still coming for you; you just have time to leave.
	MakeAttributeScale(*this, UClockworksAttributeSet::GetMoveSpeedAttribute(), 0.35f);

	FInheritedTagContainer GrantedTags;
	GrantedTags.AddTag(ClockworksTags::Status_Stun);
	GEComponents.Add(MakeTagGrant(this, GrantedTags));
}

// Runs on: all machines (class default object).
UClockworksCurseEffect::UClockworksCurseEffect()
{
	MakeTimedStatus(*this);

	// No modifiers and no ticks: the whole of a curse is what happens when the cursed thing attacks,
	// and that is applied in the attribute set, which is the only place that sees who dealt a hit.
	FInheritedTagContainer GrantedTags;
	GrantedTags.AddTag(ClockworksTags::Status_Curse);
	GEComponents.Add(MakeTagGrant(this, GrantedTags));
}

// Runs on: all machines (class default object).
UClockworksSleepEffect::UClockworksSleepEffect()
{
	MakeTimedStatus(*this);

	// Fully unresponsive and unshovable. Stunned covers "does not act"; the movement and rotation
	// locks cover "does not move". Any hit wakes it, for extra damage, in the attribute set.
	FInheritedTagContainer GrantedTags;
	GrantedTags.AddTag(ClockworksTags::Status_Sleep);
	GrantedTags.AddTag(ClockworksTags::State_Stunned);
	GrantedTags.AddTag(ClockworksTags::State_MovementLocked);
	GrantedTags.AddTag(ClockworksTags::State_RotationLocked);
	GrantedTags.AddTag(ClockworksTags::State_NoKnockback);
	GEComponents.Add(MakeTagGrant(this, GrantedTags));
}
