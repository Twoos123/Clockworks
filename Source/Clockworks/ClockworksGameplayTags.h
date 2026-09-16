// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "NativeGameplayTags.h"

/**
 * Gameplay tags used by Clockworks, declared natively so they exist from module load and can
 * be referenced from C++ without a config lookup. Definitions live in ClockworksGameplayTags.cpp.
 */
namespace ClockworksTags
{
	// Ability activation tags
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Ability_Attack);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Ability_Attack_Sword);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Ability_Attack_Pistol);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Ability_Attack_Bomb);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Ability_Attack_Melee);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Ability_Attack_Ranged);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Ability_Dodge);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Ability_Shield);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Ability_ShieldBash);

	// Character state
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(State_Attacking);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(State_Dodging);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(State_RotationLocked);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(State_MovementLocked);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(State_Invulnerable);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(State_Guarded);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(State_Dead);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(State_Charging);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(State_Reloading);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(State_Shielding);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(State_ShieldBroken);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(State_Stunned);

	// Cooldowns
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Cooldown_Dodge);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Cooldown_Attack);

	// Factions. Members of the same faction never damage each other.
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Faction_Player);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Faction_Enemy);

	/**
	 * Monster families. Which family a target belongs to decides what it is weak and strong against;
	 * the chart lives in UClockworksAttributeSet. A target with no family tag takes everything at
	 * face value, which is what a training dummy should do.
	 */
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Family_Beast);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Family_Construct);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Family_Slime);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Family_Gremlin);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Family_Undead);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Family_Fiend);

	/**
	 * All seven Spiral Knights statuses. Each one changes what the person holding the controller
	 * should do next, which is what separates a status from a damage bonus.
	 */
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Status_Fire);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Status_Freeze);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Status_Shock);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Status_Poison);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Status_Stun);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Status_Curse);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Status_Sleep);

	/**
	 * Rules other systems read off a status rather than knowing the status itself.
	 * Freeze and Sleep both stop a target being shoved; Poison stops it being healed.
	 */
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(State_NoKnockback);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(State_NoHealing);

	// SetByCaller data keys on gameplay effects
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Data_Damage);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Data_Cooldown);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Data_Knockback);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Data_KnockbackAngle);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Data_ShoveOnly);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Data_Duration);

	/**
	 * Damage by type. Spiral Knights resolves each type separately against the target's family and
	 * sums the results, which is why a weapon can deal two types at once and why the same weapon is
	 * excellent against one monster and useless against another.
	 *
	 * Data.Damage without a type is still read, and is treated as Normal. Every ability written
	 * before types existed keeps working unchanged.
	 */
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Data_Damage_Normal);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Data_Damage_Piercing);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Data_Damage_Elemental);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Data_Damage_Shadow);

	/** Chance (0-1) that a hit applies its weapon's status, and how long that status lasts. */
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Data_StatusChance);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Data_StatusDuration);
}
