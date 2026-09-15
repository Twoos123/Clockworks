// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksGearStats.h"
#include "ClockworksGameplayTags.h"
#include "ClockworksPlayerState.h"
#include "World/ClockworksGameState.h"
#include "AbilitySystemComponent.h"
#include "GameplayEffect.h"
#include "Engine/World.h"

namespace
{
	/** Demo depth 0..8 -> original depth (user's decision, 2026-09-15: an even spread; the lobby reads depth 1). */
	const float OriginalDepths[] = { 1.f, 4.f, 7.f, 11.f, 15.f, 18.f, 22.f, 25.f, 29.f };

	/** The original's caps on summed bonuses (ItemCodes$ItemValueKey: six steps each). */
	constexpr float DamageCap = 0.48f;
	constexpr float ChargeCap = 0.48f;
	constexpr float SpeedCap = 0.24f;

	int32 ClassIndex(EClockworksWeaponClass WeaponClass)
	{
		return FMath::Clamp(static_cast<int32>(WeaponClass), 0, 2);
	}
}

// Runs on: anywhere.
float ClockworksGearStats::OriginalDepthFor(int32 DemoDepth)
{
	const int32 Last = UE_ARRAY_COUNT(OriginalDepths) - 1;
	if (DemoDepth > Last)
	{
		// Past the demo's Core: keep going at the original's pace of three and a half depths a floor.
		return FMath::Min(OriginalDepths[Last] + 3.5f * (DemoDepth - Last), 30.f);
	}
	return OriginalDepths[FMath::Max(DemoDepth, 0)];
}

// Runs on: anywhere. The depth replicates on the game state, so every machine reads the same one.
float ClockworksGearStats::CurrentOriginalDepth(const UWorld* World)
{
	const AClockworksGameState* GameState = World ? World->GetGameState<AClockworksGameState>() : nullptr;
	return OriginalDepthFor(GameState ? GameState->GetDepth() : 0);
}

// Runs on: anywhere.
void ClockworksGearStats::PieceDefense(const UClockworksGearDefinition& Piece, float OriginalDepth, float OutDefense[4])
{
	const TArray<float>* Curves[4] = { &Piece.NormalDefense, &Piece.PiercingDefense, &Piece.ElementalDefense, &Piece.ShadowDefense };
	for (int32 Kind = 0; Kind < 4; ++Kind)
	{
		// Level 10 adds its defense to each defense the piece has, not to ones it lacks (INFERRED).
		OutDefense[Kind] = Curves[Kind]->Num() > 0
			? UClockworksGearDefinition::ReadCurve(*Curves[Kind], OriginalDepth) + Piece.HeatDefenseBonus
			: 0.f;
	}
}

// Runs on: anywhere.
FClockworksGearTotals ClockworksGearStats::Total(const TArray<TObjectPtr<UClockworksGearDefinition>>& Gear, float OriginalDepth)
{
	FClockworksGearTotals Totals;
	for (const TObjectPtr<UClockworksGearDefinition>& PiecePtr : Gear)
	{
		const UClockworksGearDefinition* Piece = PiecePtr.Get();
		if (!Piece)
		{
			continue;
		}

		// A shield's defense protects the shield, so it counts while blocking and the rest of the time not at all.
		float Defense[4];
		PieceDefense(*Piece, OriginalDepth, Defense);
		float* DefenseTotal = Piece->Slot == EClockworksGearSlot::Shield ? Totals.ShieldDefense : Totals.Defense;
		for (int32 Kind = 0; Kind < 4; ++Kind)
		{
			DefenseTotal[Kind] += Defense[Kind];
		}

		for (const FClockworksGearHealthStep& Step : Piece->HeatHealth)
		{
			if (OriginalDepth >= Step.MinDepth)
			{
				Totals.HealthBonus += Step.Health;
			}
		}

		for (const FClockworksGearStatusResist& Resist : Piece->StatusResists)
		{
			Totals.StatusResist.FindOrAdd(Resist.Status) += Resist.Resist;
		}

		for (const FClockworksGearBonus& Bonus : Piece->Bonuses)
		{
			if (Bonus.Kind == TEXT("HealthBonus"))
			{
				Totals.HealthBonus += Bonus.Value;
				continue;
			}
			if (Bonus.Kind == TEXT("SpeedChange"))
			{
				Totals.MoveSpeedChange += Bonus.Value;
				continue;
			}
			const int32 Family = Bonus.Kind == TEXT("TaggedDamageBonus") ? FamilyIndex(Bonus.Tag) : INDEX_NONE;
			float* PerClass = nullptr;
			if (Bonus.Kind == TEXT("RelativeDamageBonus"))
			{
				PerClass = Totals.DamageBonus;
			}
			else if (Bonus.Kind == TEXT("ChargeTimeReduction"))
			{
				PerClass = Totals.ChargeTimeReduction;
			}
			else if (Bonus.Kind == TEXT("AttackSpeedChange"))
			{
				PerClass = Totals.AttackSpeedChange;
			}
			if (!PerClass && Family == INDEX_NONE)
			{
				continue;
			}
			for (int32 Class = 0; Class < 3; ++Class)
			{
				if (!Bonus.bAllWeaponClasses && ClassIndex(Bonus.WeaponClass) != Class)
				{
					continue;
				}
				if (PerClass)
				{
					PerClass[Class] += Bonus.Value;
				}
				else
				{
					Totals.TaggedDamageBonus[Class][Family] += Bonus.Value;
				}
			}
		}
	}
	return Totals;
}

// Runs on: anywhere.
FClockworksGearTotals ClockworksGearStats::TotalFor(const AClockworksPlayerState* Knight)
{
	return Knight ? Total(Knight->GetGearSlots(), CurrentOriginalDepth(Knight->GetWorld())) : FClockworksGearTotals();
}

// Runs on: server (the attribute set) and anywhere a readout wants the number.
float ClockworksGearStats::NetDamage(float Gross, float Defense)
{
	if (Gross <= 0.f)
	{
		return 0.f;
	}
	if (Defense <= 0.f || Gross > Defense)
	{
		// A hit bigger than the defense loses half the defense (the original's code, read from projectx-pcode.jar;
		// the wiki's "full defense off above twice the defense" is the same rule in half-size defense units).
		return FMath::Max(Gross - 0.5f * Defense, 0.f);
	}
	// A smaller hit keeps a logarithmic share, meeting the rule above exactly where the hit equals the defense.
	const float Kept = 0.5f - 0.19f * FMath::LogX(10.f, (Defense - Gross) / 15.f + 1.f);
	return FMath::Max(Gross * Kept, 0.f);
}

// Runs on: server.
float ClockworksGearStats::StatusFactor(float Resist)
{
	// The wiki: four points negate about 40%, eight about 65%; a gear resist of 40 reads as four points
	// (INFERRED from the unique variants' 5/10/15/25). 0.6 per 40 fits both. A negative resist makes it worse.
	return FMath::Clamp(FMath::Pow(0.6f, Resist / 40.f), 0.f, 4.f);
}

// Runs on: anywhere.
EClockworksDamageKind ClockworksGearStats::KindOf(const FGameplayTag& DamageType)
{
	if (DamageType.MatchesTagExact(ClockworksTags::Data_Damage_Piercing))
	{
		return EClockworksDamageKind::Piercing;
	}
	if (DamageType.MatchesTagExact(ClockworksTags::Data_Damage_Elemental))
	{
		return EClockworksDamageKind::Elemental;
	}
	if (DamageType.MatchesTagExact(ClockworksTags::Data_Damage_Shadow))
	{
		return EClockworksDamageKind::Shadow;
	}
	return EClockworksDamageKind::Normal;
}

// Runs on: anywhere.
const AClockworksPlayerState* ClockworksGearStats::KnightOf(const UAbilitySystemComponent* AbilitySystemComponent)
{
	return AbilitySystemComponent ? Cast<AClockworksPlayerState>(AbilitySystemComponent->GetOwnerActor()) : nullptr;
}

// Runs on: anywhere.
FString ClockworksGearStats::StatusNameOf(TSubclassOf<UGameplayEffect> StatusEffect)
{
	const UGameplayEffect* Effect = StatusEffect ? StatusEffect->GetDefaultObject<UGameplayEffect>() : nullptr;
	if (!Effect)
	{
		return FString();
	}
	const FGameplayTagContainer& Granted = Effect->GetGrantedTags();
	static const TPair<FGameplayTag, const TCHAR*> Statuses[] = {
		{ ClockworksTags::Status_Fire,   TEXT("Fire") },
		{ ClockworksTags::Status_Freeze, TEXT("Freeze") },
		{ ClockworksTags::Status_Shock,  TEXT("Shock") },
		{ ClockworksTags::Status_Poison, TEXT("Poison") },
		{ ClockworksTags::Status_Stun,   TEXT("Stun") },
		{ ClockworksTags::Status_Curse,  TEXT("Curse") },
		{ ClockworksTags::Status_Sleep,  TEXT("Sleep") },
	};
	for (const TPair<FGameplayTag, const TCHAR*>& Status : Statuses)
	{
		if (Granted.HasTagExact(Status.Key))
		{
			return Status.Value;
		}
	}
	return FString();
}

// Runs on: anywhere.
int32 ClockworksGearStats::FamilyIndex(const FString& Family)
{
	static const TCHAR* Families[ClockworksFamilyCount] = { TEXT("Beast"), TEXT("Construct"), TEXT("Fiend"), TEXT("Gremlin"), TEXT("Slime"), TEXT("Undead") };
	for (int32 Index = 0; Index < ClockworksFamilyCount; ++Index)
	{
		if (Family.Equals(Families[Index], ESearchCase::IgnoreCase))
		{
			return Index;
		}
	}
	return INDEX_NONE;
}

// Runs on: anywhere.
int32 ClockworksGearStats::FamilyIndexOf(const FGameplayTag& FamilyTag)
{
	static const FGameplayTag Families[ClockworksFamilyCount] = {
		ClockworksTags::Family_Beast, ClockworksTags::Family_Construct, ClockworksTags::Family_Fiend,
		ClockworksTags::Family_Gremlin, ClockworksTags::Family_Slime, ClockworksTags::Family_Undead,
	};
	for (int32 Index = 0; Index < ClockworksFamilyCount; ++Index)
	{
		if (FamilyTag.IsValid() && FamilyTag.MatchesTagExact(Families[Index]))
		{
			return Index;
		}
	}
	return INDEX_NONE;
}

// Runs on: server (the attribute set). The original pools the relative bonus and every bonus against a tag the target
// carries, then caps the pool.
float ClockworksGearStats::DamageFactor(const FClockworksGearTotals& Totals, EClockworksWeaponClass WeaponClass, int32 Family)
{
	const int32 Class = ClassIndex(WeaponClass);
	float Pool = Totals.DamageBonus[Class];
	if (Family >= 0 && Family < ClockworksFamilyCount)
	{
		Pool += Totals.TaggedDamageBonus[Class][Family];
	}
	return 1.f + FMath::Clamp(Pool, -DamageCap, DamageCap);
}

// Runs on: wherever the charging ability runs.
float ClockworksGearStats::ChargeFactor(const FClockworksGearTotals& Totals, EClockworksWeaponClass WeaponClass)
{
	return 1.f - FMath::Clamp(Totals.ChargeTimeReduction[ClassIndex(WeaponClass)], -ChargeCap, ChargeCap);
}

// Runs on: wherever the attacking ability runs.
float ClockworksGearStats::AttackSpeedFactor(const FClockworksGearTotals& Totals, EClockworksWeaponClass WeaponClass)
{
	return 1.f + FMath::Clamp(Totals.AttackSpeedChange[ClassIndex(WeaponClass)], -SpeedCap, SpeedCap);
}

// Runs on: server and owning client (walk speed).
float ClockworksGearStats::MoveSpeedFactor(const FClockworksGearTotals& Totals)
{
	return 1.f + FMath::Clamp(Totals.MoveSpeedChange, -SpeedCap, SpeedCap);
}
