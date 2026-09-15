// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksGameplayTags.h"

namespace ClockworksTags
{
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Ability_Attack_Sword, "Ability.Attack.Sword", "Activates the sword attack ability.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Ability_Attack_Pistol, "Ability.Attack.Pistol", "Activates the handgun attack ability.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Ability_Attack_Bomb, "Ability.Attack.Bomb", "Activates the bomb ability: arm on hold, drop on release.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Ability_Attack, "Ability.Attack", "Parent of every attack. The enemy brain activates by this so it works for melee and ranged alike.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Ability_Attack_Melee, "Ability.Attack.Melee", "Activates an enemy's melee attack (bite, swipe).");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Ability_Attack_Ranged, "Ability.Attack.Ranged", "Activates an enemy's ranged attack (a projectile).");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Ability_Dodge, "Ability.Dodge", "Activates the dodge ability.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Ability_Shield, "Ability.Shield", "The raised shield (hold right mouse).");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Ability_ShieldBash, "Ability.ShieldBash", "The shield bash (Shift + left mouse).");

	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_Attacking, "State.Attacking", "Owned for the whole sword swing. Blocks other actions and slows movement.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_Dodging, "State.Dodging", "Owned for the whole dodge. Blocks other actions.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_RotationLocked, "State.RotationLocked", "Cursor aiming is suspended while present (windup + active swing).");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_MovementLocked, "State.MovementLocked", "Walk speed is zero while present (recovery of a committed combo swing).");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_Invulnerable, "State.Invulnerable", "Damage is ignored while present (dodge i-frames).");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_Dead, "State.Dead", "Health reached zero. No further damage or actions.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_Charging, "State.Charging", "Holding the attack button to charge the weapon. Movement runs at the weapon's charge speed instead of the attack slow.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_Reloading, "State.Reloading", "A handgun is reloading its clip. The knight can walk but not attack or shield.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_Shielding, "State.Shielding", "The shield is raised: the Shield attribute absorbs hits, movement is slowed, attacks are refused.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_ShieldBroken, "State.ShieldBroken", "The shield shattered; it cannot be raised until the tag clears. Replicated to everyone.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_Stunned, "State.Stunned", "Granted by the stun effect. A stunned enemy stops, cancels its attack and cannot start another.");

	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Cooldown_Dodge, "Cooldown.Dodge", "Granted by the dodge cooldown effect; dodge cannot activate while present.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Cooldown_Attack, "Cooldown.Attack", "Granted by the attack cooldown effect; an enemy's attack cannot activate while present.");

	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Faction_Player, "Faction.Player", "Player characters. No friendly fire.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Faction_Enemy, "Faction.Enemy", "Enemies and training dummies.");

	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Family_Beast, "Family.Beast", "Wolvers and their kin. Weak to Piercing, strong against Shadow.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Family_Construct, "Family.Construct", "Mechaknights, gunpuppies, anything built. Weak to Elemental, strong against Normal.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Family_Slime, "Family.Slime", "Jellies and lichens. Weak to Piercing, strong against Elemental.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Family_Gremlin, "Family.Gremlin", "Gremlins. Weak to Shadow, strong against Piercing.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Family_Undead, "Family.Undead", "Zombies and their kin. Weak to Elemental, strong against Piercing.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Family_Fiend, "Family.Fiend", "Devilites and their kin. Weak to Piercing, strong against Shadow.");

	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Status_Fire, "State.Status.Fire", "Burning: damage over time until it wears off.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Status_Freeze, "State.Status.Freeze", "Frozen solid: the feet are planted until it wears off.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Status_Shock, "State.Status.Shock", "Shocked: spasms that damage and interrupt, and any charge is cancelled.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Status_Poison, "State.Status.Poison", "Poisoned: deals less damage, has less defense, and cannot be healed.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Status_Stun, "State.Status.Stun", "Stunned by a status: movement and attack speed cut, briefly.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Status_Curse, "State.Status.Curse", "Cursed: attacking costs the attacker health.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Status_Sleep, "State.Status.Sleep", "Asleep: completely unresponsive until something hits it, which wakes it for extra damage.");

	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_NoKnockback, "State.NoKnockback", "This target cannot be shoved. Granted by Freeze and Sleep.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(State_NoHealing, "State.NoHealing", "This target cannot be healed. Granted by Poison.");

	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Data_Damage, "Data.Damage", "SetByCaller magnitude: raw damage before the target's defense.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Data_Cooldown, "Data.Cooldown", "SetByCaller magnitude: cooldown duration in seconds.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Data_Knockback, "Data.Knockback", "SetByCaller magnitude: knockback multiplier for this hit (1 when absent). Combo finishers and charges shove harder.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Data_KnockbackAngle, "Data.KnockbackAngle", "SetByCaller magnitude: degrees the shove turns off straight-away, positive to the right (0 when absent). A Combo Strike knocks left, then right.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Data_ShoveOnly, "Data.ShoveOnly", "SetByCaller magnitude: above 0, the hit shoves but deals no damage (a vortex's pull, a pulse with no damage of its own).");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Data_Duration, "Data.Duration", "SetByCaller magnitude: how long a status effect (the stun) lasts, in seconds.");

	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Data_Damage_Normal, "Data.Damage.Normal", "SetByCaller magnitude: Normal damage, resolved against the target's family.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Data_Damage_Piercing, "Data.Damage.Piercing", "SetByCaller magnitude: Piercing damage, resolved against the target's family.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Data_Damage_Elemental, "Data.Damage.Elemental", "SetByCaller magnitude: Elemental damage, resolved against the target's family.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Data_Damage_Shadow, "Data.Damage.Shadow", "SetByCaller magnitude: Shadow damage, resolved against the target's family.");

	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Data_StatusChance, "Data.StatusChance", "SetByCaller magnitude: chance from 0 to 1 that this hit inflicts its weapon's status.");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Data_StatusDuration, "Data.StatusDuration", "SetByCaller magnitude: how long that status lasts, in seconds.");
}
