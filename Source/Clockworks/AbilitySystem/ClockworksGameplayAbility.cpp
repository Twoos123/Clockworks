// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksGameplayAbility.h"
#include "ClockworksGameplayTags.h"
#include "ClockworksWeaponDefinition.h"
#include "ClockworksAttackProfile.h"
#include "ClockworksGearStats.h"
#include "ClockworksPlayerState.h"
#include "World/ClockworksGameState.h"
#include "ClockworksStatusEffects.h"
#include "ClockworksDamageEffect.h"
#include "AbilitySystemInterface.h"
#include "CollisionQueryParams.h"
#include "Engine/OverlapResult.h"
#include "Engine/World.h"
#include "TimerManager.h"
#include "GameplayEffect.h"
#include "GameplayEffectTypes.h"
#include "AbilitySystemComponent.h"
#include "GameFramework/Character.h"

// Runs on: all machines (class default object).
UClockworksGameplayAbility::UClockworksGameplayAbility()
{
	InstancingPolicy = EGameplayAbilityInstancingPolicy::InstancedPerActor;
	NetExecutionPolicy = EGameplayAbilityNetExecutionPolicy::LocalPredicted;
}

// Runs on: wherever the ability instance runs.
ACharacter* UClockworksGameplayAbility::GetAvatarCharacter() const
{
	return Cast<ACharacter>(GetAvatarActorFromActorInfo());
}

// Runs on: wherever the ability instance runs. GetCurrentActivationInfo returns by value, so take
// a local copy before asking HasAuthority about it.
bool UClockworksGameplayAbility::HasServerAuthority() const
{
	const FGameplayAbilityActivationInfo ActivationInfo = GetCurrentActivationInfo();
	return HasAuthority(&ActivationInfo);
}

// Runs on: wherever it is called. Pure query.
FGameplayTag UClockworksGameplayAbility::GetFactionTag(const UAbilitySystemComponent* AbilitySystemComponent)
{
	if (AbilitySystemComponent)
	{
		if (AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::Faction_Player))
		{
			return ClockworksTags::Faction_Player;
		}
		if (AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::Faction_Enemy))
		{
			return ClockworksTags::Faction_Enemy;
		}
	}
	return FGameplayTag();
}

// Runs on: server only in practice, since only the server builds damage specs.
void UClockworksGameplayAbility::SetDamageMagnitudes(const FGameplayEffectSpecHandle& Spec, float Amount, const FGameplayTag& DamageType)
{
	if (!Spec.IsValid())
	{
		return;
	}

	Spec.Data->SetSetByCallerMagnitude(ClockworksTags::Data_Damage, Amount);

	// An untyped weapon is Normal; the attribute set assumes that for anything left unaccounted for,
	// so writing nothing here is correct rather than merely harmless.
	if (DamageType.IsValid())
	{
		Spec.Data->SetSetByCallerMagnitude(DamageType, Amount);
	}
}

// Runs on: anywhere; the depth replicates.
int32 UClockworksGameplayAbility::CurrentDemoDepth(const UWorld* World)
{
	const AClockworksGameState* GameState = World ? World->GetGameState<AClockworksGameState>() : nullptr;
	return GameState ? GameState->GetDepth() : 0;
}

// Runs on: server only in practice (statuses are applied there); a pure read anywhere.
float UClockworksGameplayAbility::StatusTickAt(const UWorld* World, const TArray<float>& Table, float Fallback)
{
	return ClockworksAttackDepth::Read(Table, CurrentDemoDepth(World), Fallback);
}

namespace
{
	/** Seconds between a shocked thing's spasms, picked at random each time (the Shock class default, 1000 to 4000 ms). */
	constexpr float ShockSpasmMinSeconds = 1.f;
	constexpr float ShockSpasmMaxSeconds = 4.f;

	/** The shock arc's reach in cm: the config's circle of radius 2.0 tiles (the wiki says one block). */
	constexpr float ShockArcRadiusCm = 200.f;

	/**
	 * A status's own damage, dealt in the name of whoever inflicted it: the thaw of a monster's ice, a shock's arc. A hit
	 * like any other, so defense and the family rules apply, but with no shove.
	 */
	void ApplyStatusDamage(UAbilitySystemComponent* Source, UAbilitySystemComponent* Target, float Amount, const FGameplayTag& DamageType)
	{
		if (!Source || !Target || Amount <= 0.f || Target->HasMatchingGameplayTag(ClockworksTags::State_Dead))
		{
			return;
		}
		FGameplayEffectContextHandle Context = Source->MakeEffectContext();
		Context.AddInstigator(Source->GetOwnerActor(), Source->GetAvatarActor());
		const FGameplayEffectSpecHandle Spec = Source->MakeOutgoingSpec(UClockworksDamageEffect::StaticClass(), 1.f, Context);
		if (!Spec.IsValid())
		{
			return;
		}
		UClockworksGameplayAbility::SetDamageMagnitudes(Spec, Amount, DamageType);
		Spec.Data->SetSetByCallerMagnitude(ClockworksTags::Data_Knockback, 0.f);
		Source->ApplyGameplayEffectSpecToTarget(*Spec.Data, Target);
	}

	/** One spasm's arc: the shocked thing and everything on its side within ShockArcRadiusCm take elemental damage. */
	void ShockArc(UAbilitySystemComponent* Source, UAbilitySystemComponent* Victim, float ArcDamage)
	{
		AActor* VictimActor = Victim ? Victim->GetAvatarActor() : nullptr;
		UWorld* World = VictimActor ? VictimActor->GetWorld() : nullptr;
		if (!World || !Source)
		{
			return;
		}
		const FGameplayTag Side = UClockworksGameplayAbility::GetFactionTag(Victim);
		TArray<FOverlapResult> Overlaps;
		FCollisionQueryParams Params(SCENE_QUERY_STAT(ClockworksShockArc), /*bTraceComplex*/ false);
		World->OverlapMultiByObjectType(Overlaps, VictimActor->GetActorLocation(), FQuat::Identity, FCollisionObjectQueryParams(ECC_Pawn),
			FCollisionShape::MakeSphere(ShockArcRadiusCm), Params);

		TSet<UAbilitySystemComponent*> Struck;
		Struck.Add(Victim);
		ApplyStatusDamage(Source, Victim, ArcDamage, ClockworksTags::Data_Damage_Elemental);
		for (const FOverlapResult& Overlap : Overlaps)
		{
			const IAbilitySystemInterface* AbilityInterface = Cast<IAbilitySystemInterface>(Overlap.GetActor());
			UAbilitySystemComponent* Other = AbilityInterface ? AbilityInterface->GetAbilitySystemComponent() : nullptr;
			if (!Other || Other == Source || Struck.Contains(Other) || UClockworksGameplayAbility::GetFactionTag(Other) != Side)
			{
				continue;
			}
			if (Other->HasMatchingGameplayTag(ClockworksTags::State_Invulnerable))
			{
				continue;
			}
			Struck.Add(Other);
			ApplyStatusDamage(Source, Other, ArcDamage, ClockworksTags::Data_Damage_Elemental);
		}
	}

	/** The next spasm of a shock, 1 to 4 s away; the chain ends when the shock does. Server only. */
	void ScheduleShockSpasm(TWeakObjectPtr<UAbilitySystemComponent> WeakSource, TWeakObjectPtr<UAbilitySystemComponent> WeakTarget, float ArcDamage)
	{
		UAbilitySystemComponent* Target = WeakTarget.Get();
		AActor* Avatar = Target ? Target->GetAvatarActor() : nullptr;
		UWorld* World = Avatar ? Avatar->GetWorld() : nullptr;
		if (!World)
		{
			return;
		}
		FTimerHandle Spasm;
		World->GetTimerManager().SetTimer(Spasm, FTimerDelegate::CreateWeakLambda(Avatar, [WeakSource, WeakTarget, ArcDamage]()
		{
			UAbilitySystemComponent* Victim = WeakTarget.Get();
			if (!Victim || !Victim->HasMatchingGameplayTag(ClockworksTags::Status_Shock) || Victim->HasMatchingGameplayTag(ClockworksTags::State_Dead))
			{
				return;
			}
			ShockArc(WeakSource.Get(), Victim, ArcDamage);
			ScheduleShockSpasm(WeakSource, WeakTarget, ArcDamage);
		}), FMath::FRandRange(ShockSpasmMinSeconds, ShockSpasmMaxSeconds), false);
	}

	/** The damage type tag a weapon data type names; invalid for Default. */
	FGameplayTag TagOfHitDamageType(EClockworksHitDamageType Type)
	{
		switch (Type)
		{
		case EClockworksHitDamageType::Normal:    return ClockworksTags::Data_Damage_Normal;
		case EClockworksHitDamageType::Piercing:  return ClockworksTags::Data_Damage_Piercing;
		case EClockworksHitDamageType::Elemental: return ClockworksTags::Data_Damage_Elemental;
		case EClockworksHitDamageType::Shadow:    return ClockworksTags::Data_Damage_Shadow;
		default:                                  return FGameplayTag();
		}
	}
}

// Runs on: server only in practice (only the server builds damage); a pure read anywhere, the depth replicates.
void UClockworksGameplayAbility::ResolveDamageTypes(const UWorld* World, const FClockworksDamageTypes& Types, const FGameplayTag& DefaultType,
	FGameplayTag& OutPrimary, FGameplayTag& OutSecond, float& OutSecondShare)
{
	const FGameplayTag Primary = TagOfHitDamageType(Types.Primary);
	const FGameplayTag Second = TagOfHitDamageType(Types.Second);
	const float Share = Second.IsValid() ? FMath::Clamp(ClockworksAttackDepth::Read(Types.SecondShareByDepth, CurrentDemoDepth(World), 0.f), 0.f, 1.f) : 0.f;
	OutPrimary = Primary.IsValid() ? Primary : DefaultType;
	OutSecond = Share > 0.f ? Second : FGameplayTag();
	OutSecondShare = Share > 0.f ? Share : 0.f;
}

// Runs on: server only in practice, since only the server builds damage specs.
void UClockworksGameplayAbility::SetSplitDamageMagnitudes(const FGameplayEffectSpecHandle& Spec, float Amount, const FGameplayTag& PrimaryType,
	const FGameplayTag& SecondType, float SecondShare)
{
	if (!SecondType.IsValid() || SecondShare <= 0.f || SecondType == PrimaryType)
	{
		SetDamageMagnitudes(Spec, Amount, PrimaryType);
		return;
	}
	// Each part meets its own type's defense in the attribute set. An untyped main type is Normal, as everywhere.
	float Parts[4] = { 0.f, 0.f, 0.f, 0.f };
	const float Share = FMath::Clamp(SecondShare, 0.f, 1.f);
	Parts[static_cast<int32>(ClockworksGearStats::KindOf(PrimaryType))] += Amount * (1.f - Share);
	Parts[static_cast<int32>(ClockworksGearStats::KindOf(SecondType))] += Amount * Share;
	SetTypedDamageMagnitudes(Spec, Parts);
}

// Runs on: server only in practice, since only the server builds damage specs.
void UClockworksGameplayAbility::SetTypedDamageMagnitudes(const FGameplayEffectSpecHandle& Spec, const float Parts[4])
{
	if (!Spec.IsValid())
	{
		return;
	}
	static const FGameplayTag Types[] = {
		ClockworksTags::Data_Damage_Normal, ClockworksTags::Data_Damage_Piercing,
		ClockworksTags::Data_Damage_Elemental, ClockworksTags::Data_Damage_Shadow,
	};
	float Total = 0.f;
	for (int32 Kind = 0; Kind < 4; ++Kind)
	{
		if (Parts[Kind] > 0.f)
		{
			Spec.Data->SetSetByCallerMagnitude(Types[Kind], Parts[Kind]);
			Total += Parts[Kind];
		}
	}
	Spec.Data->SetSetByCallerMagnitude(ClockworksTags::Data_Damage, Total);
}

// Runs on: server (the attacks that call it). The depth replicates, so the number is the same everywhere.
bool UClockworksGameplayAbility::DepthDamageParts(const UWorld* World, const TArray<float>& Normal, const TArray<float>& Piercing,
	const TArray<float>& Elemental, const TArray<float>& Shadow, float OutParts[4])
{
	const AClockworksGameState* GameState = World ? World->GetGameState<AClockworksGameState>() : nullptr;
	const int32 Depth = GameState ? GameState->GetDepth() : 0;
	const TArray<float>* Tables[] = { &Normal, &Piercing, &Elemental, &Shadow };
	bool bAny = false;
	for (int32 Kind = 0; Kind < 4; ++Kind)
	{
		const TArray<float>& Table = *Tables[Kind];
		OutParts[Kind] = Table.Num() > 0 ? Table[FMath::Clamp(Depth, 0, Table.Num() - 1)] : 0.f;
		bAny |= Table.Num() > 0;
	}
	return bAny;
}

// Runs on: wherever the instance runs.
const UClockworksWeaponDefinition* UClockworksGameplayAbility::GetSourceWeapon() const
{
	return Cast<UClockworksWeaponDefinition>(GetCurrentSourceObject());
}

// Runs on: wherever the instance runs. The weapon wins: two swords in a line share one ability and
// differ only in what they are made of.
FGameplayTag UClockworksGameplayAbility::ResolveDamageType() const
{
	if (const UClockworksWeaponDefinition* Weapon = GetSourceWeapon())
	{
		if (Weapon->DamageType.IsValid())
		{
			return Weapon->DamageType;
		}
	}
	return DamageTypeFallback;
}

// Runs on: wherever the instance runs. The gear and the depth both replicate, so the predicting client and
// the server agree.
float UClockworksGameplayAbility::ResolveDamageMultiplier() const
{
	const UClockworksWeaponDefinition* Weapon = GetSourceWeapon();
	if (!Weapon)
	{
		return 1.f;
	}
	// The gear's damage bonuses are not applied here: they pool with bonuses against the target's family, which only
	// the target knows, so the attribute set applies them to each hit (it reads the weapon off the hit's context).
	return FMath::Max(Weapon->DamageMultiplier, 0.f);
}

// Runs on: wherever the instance runs.
float UClockworksGameplayAbility::ResolveChargeSeconds(float Seconds) const
{
	const UClockworksWeaponDefinition* Weapon = GetSourceWeapon();
	const AClockworksPlayerState* Knight = Cast<AClockworksPlayerState>(GetOwningActorFromActorInfo());
	if (!Weapon || !Knight)
	{
		return Seconds;
	}
	// The original caps the summed reduction at 48%, so a charge never drops below 52% of the weapon's own time.
	return Seconds * ClockworksGearStats::ChargeFactor(ClockworksGearStats::TotalFor(Knight), Weapon->WeaponClass);
}

// Runs on: wherever the instance runs. Gear and depth replicate, so the predicting client and the server agree.
float UClockworksGameplayAbility::ResolveAttackSeconds(float Seconds) const
{
	const UClockworksWeaponDefinition* Weapon = GetSourceWeapon();
	const AClockworksPlayerState* Knight = Cast<AClockworksPlayerState>(GetOwningActorFromActorInfo());
	if (!Weapon || !Knight)
	{
		return Seconds;
	}
	// Capped at ±24% by the original, so the factor is never near zero.
	return Seconds / ClockworksGearStats::AttackSpeedFactor(ClockworksGearStats::TotalFor(Knight), Weapon->WeaponClass);
}

// Runs on: server only.
void UClockworksGameplayAbility::ApplyWeaponStatus(UAbilitySystemComponent* Source, UAbilitySystemComponent* Target) const
{
	if (const UClockworksWeaponDefinition* Weapon = GetSourceWeapon())
	{
		if (Weapon->StatusEffect)
		{
			TryApplyStatus(Source, Target, Weapon->StatusEffect, Weapon->StatusChance, Weapon->StatusSeconds,
				StatusTickAt(GetWorld(), Weapon->StatusTickDamageByDepth, Weapon->StatusTickDamage));
			return;
		}
	}
	TryApplyStatus(Source, Target, StatusEffect, StatusChance, StatusSeconds, StatusTickDamage);
}

// Runs on: server only. One roll, on the machine that decides, so both copies of the game agree
// about whether a target is burning.
void UClockworksGameplayAbility::TryApplyStatus(UAbilitySystemComponent* Source, UAbilitySystemComponent* Target,
	TSubclassOf<UGameplayEffect> StatusEffect, float Chance, float Seconds, float TickDamage)
{
	if (!Source || !Target || !StatusEffect || Chance <= 0.f || Seconds <= 0.f)
	{
		return;
	}

	// A knight's gear resists a status by making it less likely, shorter and weaker alike (user's decision,
	// 2026-09-15); a negative resist makes all three worse.
	if (const AClockworksPlayerState* Knight = ClockworksGearStats::KnightOf(Target))
	{
		const FString Status = ClockworksGearStats::StatusNameOf(StatusEffect);
		const FClockworksGearTotals Gear = ClockworksGearStats::TotalFor(Knight);
		if (const float* Resist = Status.IsEmpty() ? nullptr : Gear.StatusResist.Find(Status))
		{
			const float Factor = ClockworksGearStats::StatusFactor(*Resist);
			Chance = FMath::Min(Chance * Factor, 1.f);
			Seconds *= Factor;
			TickDamage *= Factor;
		}
	}

	if (FMath::FRand() > Chance)
	{
		return;
	}

	const FGameplayEffectSpecHandle Spec = Source->MakeOutgoingSpec(StatusEffect, 1.f, Source->MakeEffectContext());
	if (!Spec.IsValid())
	{
		return;
	}

	Spec.Data->SetSetByCallerMagnitude(ClockworksTags::Data_Duration, Seconds);

	// The status's own damage: a burn's tick, a shock's arc, a thaw, a curse's cost, a sleeper's wake damage. Each status
	// reads it its own way; setting it for every one means the caller does not have to know which status it is applying.
	Spec.Data->SetSetByCallerMagnitude(ClockworksTags::Data_Damage, TickDamage);

	const bool bShock = StatusEffect->IsChildOf(UClockworksShockEffect::StaticClass());
	const bool bAlreadyShocked = bShock && Target->HasMatchingGameplayTag(ClockworksTags::Status_Shock);

	const FActiveGameplayEffectHandle Applied = Source->ApplyGameplayEffectSpecToTarget(*Spec.Data, Target);

	// A monster whose ice melts on its own takes the thaw damage; any hit that breaks it early removes the effect before its
	// time and spares it (user's decision 2026-09-15: the wiki's rules). A knight pays only when a monster breaks its ice,
	// in the attribute set.
	if (StatusEffect->IsChildOf(UClockworksFreezeEffect::StaticClass()) && TickDamage > 0.f && Applied.IsValid() && !ClockworksGearStats::KnightOf(Target))
	{
		if (auto* Removed = Target->OnGameplayEffectRemoved_InfoDelegate(Applied))
		{
			TWeakObjectPtr<UAbilitySystemComponent> WeakSource(Source);
			TWeakObjectPtr<UAbilitySystemComponent> WeakTarget(Target);
			Removed->AddLambda([WeakSource, WeakTarget, TickDamage](const FGameplayEffectRemovalInfo& Info)
			{
				UAbilitySystemComponent* Thawed = WeakTarget.Get();
				UWorld* World = Thawed ? Thawed->GetWorld() : nullptr;
				if (Info.bPrematureRemoval || !World)
				{
					return;
				}
				// A frame later: dealing damage from inside another effect's removal is not safe.
				World->GetTimerManager().SetTimerForNextTick(FTimerDelegate::CreateWeakLambda(Thawed, [WeakSource, WeakTarget, TickDamage]()
				{
					ApplyStatusDamage(WeakSource.Get(), WeakTarget.Get(), TickDamage, FGameplayTag());
				}));
			});
		}
	}

	// A shock spasms every 1 to 4 s, each spasm an arc (user's decision 2026-09-15). One chain per shocked thing: a
	// second shock only lengthens the first.
	if (bShock && !bAlreadyShocked && TickDamage > 0.f && Target->HasMatchingGameplayTag(ClockworksTags::Status_Shock))
	{
		ScheduleShockSpasm(Source, Target, TickDamage);
	}
}

// Runs on: this machine only. Not replicated by design; see the header.
void UClockworksGameplayAbility::AddLocalTag(const FGameplayTag& Tag) const
{
	if (UAbilitySystemComponent* AbilitySystemComponent = GetAbilitySystemComponentFromActorInfo())
	{
		AbilitySystemComponent->AddLooseGameplayTag(Tag, 1, EGameplayTagReplicationState::None);
	}
}

// Runs on: this machine only. Safe to call when the tag is already gone.
void UClockworksGameplayAbility::RemoveLocalTag(const FGameplayTag& Tag) const
{
	UAbilitySystemComponent* AbilitySystemComponent = GetAbilitySystemComponentFromActorInfo();
	if (AbilitySystemComponent && AbilitySystemComponent->HasMatchingGameplayTag(Tag))
	{
		AbilitySystemComponent->RemoveLooseGameplayTag(Tag, 1, EGameplayTagReplicationState::None);
	}
}

float UClockworksGameplayAbility::ClampPhaseSeconds(float Seconds)
{
	return FMath::Max(Seconds, 0.01f);
}
