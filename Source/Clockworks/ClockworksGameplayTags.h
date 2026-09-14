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
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Ability_Attack_Melee);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Ability_Attack_Ranged);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Ability_Dodge);

	// Character state
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(State_Attacking);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(State_Dodging);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(State_RotationLocked);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(State_MovementLocked);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(State_Invulnerable);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(State_Dead);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(State_Charging);

	// Cooldowns
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Cooldown_Dodge);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Cooldown_Attack);

	// Factions. Members of the same faction never damage each other.
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Faction_Player);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Faction_Enemy);

	// SetByCaller data keys on gameplay effects
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Data_Damage);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Data_Cooldown);
	UE_DECLARE_GAMEPLAY_TAG_EXTERN(Data_Knockback);
}
