// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameplayTagContainer.h"
#include "Templates/SubclassOf.h"
#include "ClockworksGearDefinition.h"

class AClockworksPlayerState;
class UAbilitySystemComponent;
class UClockworksGearDefinition;
class UGameplayEffect;
class UWorld;

/** The four damage types, in the order every per-type array here uses. */
enum class EClockworksDamageKind : uint8
{
	Normal,
	Piercing,
	Elemental,
	Shadow,
	Count
};

/** Monster families in the order gear bonuses against them are stored: Beast, Construct, Fiend, Gremlin, Slime, Undead. */
static constexpr int32 ClockworksFamilyCount = 6;

/** What a knight's worn gear adds up to at one depth. */
struct FClockworksGearTotals
{
	/** Defense against each damage type (EClockworksDamageKind) from the helmet, armour and trinkets, level 10's +25 included. */
	float Defense[static_cast<int32>(EClockworksDamageKind::Count)] = { 0.f, 0.f, 0.f, 0.f };

	/** The shield's own defense, which protects the shield while it blocks and nothing else. */
	float ShieldDefense[static_cast<int32>(EClockworksDamageKind::Count)] = { 0.f, 0.f, 0.f, 0.f };

	/** Health the gear adds to the knight's own. */
	float HealthBonus = 0.f;

	/** Walk speed change as a fraction (SpeedChange), before the cap. */
	float MoveSpeedChange = 0.f;

	/** Status resistance by status name (Fire, Freeze...), the original's resist numbers summed. */
	TMap<FString, float> StatusResist;

	/** Bonuses by weapon class (EClockworksWeaponClass: sword, handgun, bomb), each summed over the worn pieces, before the caps. */
	float DamageBonus[3] = { 0.f, 0.f, 0.f };
	float ChargeTimeReduction[3] = { 0.f, 0.f, 0.f };
	float AttackSpeedChange[3] = { 0.f, 0.f, 0.f };

	/** TaggedDamageBonus by weapon class and monster family, before the cap it shares with DamageBonus. */
	float TaggedDamageBonus[3][ClockworksFamilyCount] = {};
};

/**
 * Spiral Knights' gear rules, in one place (researched 2026-09-15; decisions in Docs/KnightChecklist.md, evidence in
 * D:\Dev\SKAssets\_research\shield_bonus\findings.md and _research\monsters\monster_numbers.md).
 *
 * Every gear number is a curve over the original's 30 depths; the demo's 8 depths are spread evenly over them.
 * Defense uses the original's code rule with the config values. Bonuses are the original's fixed steps with its caps:
 * damage (with any bonus against the target's family) ±48%, charge time ±48%, attack and walk speed ±24%. Status
 * resistance reduces a status's chance, duration and damage alike.
 *
 * Everything here is a pure read of replicated state (the gear on the PlayerState, the depth on the game
 * state), so any machine gets the same answer; only the server acts on it.
 */
namespace ClockworksGearStats
{
	/** The original depth the demo's depth reads its curves at: 0 (the lobby) 1, then 1→4, 2→7 ... 8→29. */
	float OriginalDepthFor(int32 DemoDepth);

	/** The original depth for wherever the party is now, from the game state; 1 when there is none. */
	float CurrentOriginalDepth(const UWorld* World);

	/** What a set of worn gear adds up to at an original depth. */
	FClockworksGearTotals Total(const TArray<TObjectPtr<UClockworksGearDefinition>>& Gear, float OriginalDepth);

	/** What a knight's worn gear adds up to right now. Empty totals for null. */
	FClockworksGearTotals TotalFor(const AClockworksPlayerState* Knight);

	/** A piece's own defenses at a depth, level 10 included. */
	void PieceDefense(const UClockworksGearDefinition& Piece, float OriginalDepth, float OutDefense[4]);

	/** Damage of one type that gets through a defense of that type (the original's code rule, config-value defense). */
	float NetDamage(float Gross, float Defense);

	/** How much of a status's chance, duration and damage is left after a resistance (1 = none resisted). */
	float StatusFactor(float Resist);

	/** The damage kind for a damage type tag (Data.Damage.Piercing...); Normal for anything else. */
	EClockworksDamageKind KindOf(const FGameplayTag& DamageType);

	/** The knight an ability system belongs to (players keep theirs on the PlayerState). Null for a monster. */
	const AClockworksPlayerState* KnightOf(const UAbilitySystemComponent* AbilitySystemComponent);

	/** The status a status effect class inflicts, as gear names it (Fire, Freeze...), from the tags it grants. Empty when none. */
	FString StatusNameOf(TSubclassOf<UGameplayEffect> StatusEffect);

	/** A family's index for TaggedDamageBonus from its name as gear names it ("Beast"...), or INDEX_NONE. */
	int32 FamilyIndex(const FString& Family);

	/** A family's index from a monster's family tag (Family.Beast...), or INDEX_NONE for none. */
	int32 FamilyIndexOf(const FGameplayTag& FamilyTag);

	/** Outgoing damage multiplier for a weapon class against a family (INDEX_NONE for none): 1 + the capped pool. */
	float DamageFactor(const FClockworksGearTotals& Totals, EClockworksWeaponClass WeaponClass, int32 Family);

	/** Charge time multiplier for a weapon class: 1 - the capped reduction (never below 52%). */
	float ChargeFactor(const FClockworksGearTotals& Totals, EClockworksWeaponClass WeaponClass);

	/** Attack speed multiplier for a weapon class: attack phases are divided by it. */
	float AttackSpeedFactor(const FClockworksGearTotals& Totals, EClockworksWeaponClass WeaponClass);

	/** Walk speed multiplier from the gear. */
	float MoveSpeedFactor(const FClockworksGearTotals& Totals);
}
