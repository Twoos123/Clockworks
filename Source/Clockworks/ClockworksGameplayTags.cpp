// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksGameplayTags.h"

namespace ClockworksTags
{
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Ability_Attack_Sword, "Ability.Attack.Sword", "Activates the sword attack ability.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Ability_Attack, "Ability.Attack", "Parent of every attack. The enemy brain activates by this so it works for melee and ranged alike.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Ability_Attack_Melee, "Ability.Attack.Melee", "Activates an enemy's melee attack (bite, swipe).");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Ability_Attack_Ranged, "Ability.Attack.Ranged", "Activates an enemy's ranged attack (a projectile).");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Ability_Dodge, "Ability.Dodge", "Activates the dodge ability.");

	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_Attacking, "State.Attacking", "Owned for the whole sword swing. Blocks other actions and slows movement.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_Dodging, "State.Dodging", "Owned for the whole dodge. Blocks other actions.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_RotationLocked, "State.RotationLocked", "Cursor aiming is suspended while present (windup + active swing).");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_MovementLocked, "State.MovementLocked", "Walk speed is zero while present (recovery of a committed combo swing).");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_Invulnerable, "State.Invulnerable", "Damage is ignored while present (dodge i-frames).");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_Dead, "State.Dead", "Health reached zero. No further damage or actions.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_Charging, "State.Charging", "Holding the attack button to charge the weapon. Movement runs at the weapon's charge speed instead of the attack slow.");

	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Cooldown_Dodge, "Cooldown.Dodge", "Granted by the dodge cooldown effect; dodge cannot activate while present.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Cooldown_Attack, "Cooldown.Attack", "Granted by the attack cooldown effect; an enemy's attack cannot activate while present.");

	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Faction_Player, "Faction.Player", "Player characters. No friendly fire.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Faction_Enemy, "Faction.Enemy", "Enemies and training dummies.");

	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Data_Damage, "Data.Damage", "SetByCaller magnitude: raw damage before the target's defense.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Data_Cooldown, "Data.Cooldown", "SetByCaller magnitude: cooldown duration in seconds.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Data_Knockback, "Data.Knockback", "SetByCaller magnitude: knockback multiplier for this hit (1 when absent). Combo finishers and charges shove harder.");
}
