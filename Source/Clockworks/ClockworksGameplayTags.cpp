// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksGameplayTags.h"

namespace ClockworksTags
{
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Ability_Attack_Sword, "Ability.Attack.Sword", "Activates the sword attack ability.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Ability_Dodge, "Ability.Dodge", "Activates the dodge ability.");

	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_Attacking, "State.Attacking", "Owned for the whole sword swing. Blocks other actions and slows movement.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_Dodging, "State.Dodging", "Owned for the whole dodge. Blocks other actions.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_RotationLocked, "State.RotationLocked", "Cursor aiming is suspended while present (windup + active swing).");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_Invulnerable, "State.Invulnerable", "Damage is ignored while present (dodge i-frames).");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_Dead, "State.Dead", "Health reached zero. No further damage or actions.");

	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Cooldown_Dodge, "Cooldown.Dodge", "Granted by the dodge cooldown effect; dodge cannot activate while present.");

	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Faction_Player, "Faction.Player", "Player characters. No friendly fire.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Faction_Enemy, "Faction.Enemy", "Enemies and training dummies.");

	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Data_Damage, "Data.Damage", "SetByCaller magnitude: raw damage before the target's defense.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Data_Cooldown, "Data.Cooldown", "SetByCaller magnitude: cooldown duration in seconds.");
}
