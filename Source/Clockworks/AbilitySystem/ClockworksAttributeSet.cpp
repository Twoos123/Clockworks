// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksAttributeSet.h"
#include "ClockworksGameplayTags.h"
#include "ClockworksGearStats.h"
#include "ClockworksPlayerState.h"
#include "ClockworksEnemyCharacter.h"
#include "World/ClockworksGameState.h"
#include "AbilitySystemInterface.h"
#include "GameplayEffectExtension.h"
#include "Net/UnrealNetwork.h"

// Runs on: all machines (class default object and every instance). Defaults are overwritten by
// the owner's Init* calls on the server; they only matter if something reads the set before that.
UClockworksAttributeSet::UClockworksAttributeSet()
{
	InitMaxHealth(100.f);
	InitHealth(100.f);
	InitMaxShield(0.f);
	InitShield(0.f);
	InitAttackPower(0.f);
	InitDefensePower(0.f);
	InitMoveSpeed(400.f);
	InitDamage(0.f);
}

// Runs on: server (builds the replication list). Damage is deliberately absent.
void UClockworksAttributeSet::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);

	DOREPLIFETIME_CONDITION_NOTIFY(UClockworksAttributeSet, Health, COND_None, REPNOTIFY_Always);
	DOREPLIFETIME_CONDITION_NOTIFY(UClockworksAttributeSet, MaxHealth, COND_None, REPNOTIFY_Always);
	DOREPLIFETIME_CONDITION_NOTIFY(UClockworksAttributeSet, Shield, COND_None, REPNOTIFY_Always);
	DOREPLIFETIME_CONDITION_NOTIFY(UClockworksAttributeSet, MaxShield, COND_None, REPNOTIFY_Always);
	DOREPLIFETIME_CONDITION_NOTIFY(UClockworksAttributeSet, AttackPower, COND_None, REPNOTIFY_Always);
	DOREPLIFETIME_CONDITION_NOTIFY(UClockworksAttributeSet, DefensePower, COND_None, REPNOTIFY_Always);
	DOREPLIFETIME_CONDITION_NOTIFY(UClockworksAttributeSet, MoveSpeed, COND_None, REPNOTIFY_Always);
}

// Runs on: all machines, whenever an attribute's current value is about to change. Clamps only.
void UClockworksAttributeSet::PreAttributeChange(const FGameplayAttribute& Attribute, float& NewValue)
{
	Super::PreAttributeChange(Attribute, NewValue);

	if (Attribute == GetHealthAttribute())
	{
		NewValue = FMath::Clamp(NewValue, 0.f, GetMaxHealth());
	}
	else if (Attribute == GetShieldAttribute())
	{
		NewValue = FMath::Clamp(NewValue, 0.f, GetMaxShield());
	}
	else if (Attribute == GetMoveSpeedAttribute())
	{
		NewValue = FMath::Max(0.f, NewValue);
	}
}

// Runs on: server only. Instant gameplay effects execute where they are applied, and the damage
// effect is only ever applied by server-side ability code. This is the single place damage turns
// into Shield and Health changes, so the rules live here, not in the attacker. The Shield
// attribute only counts while the shield is raised; a lowered shield is just a number waiting to
// refill (the character regenerates it).
void UClockworksAttributeSet::PostGameplayEffectExecute(const FGameplayEffectModCallbackData& Data)
{
	Super::PostGameplayEffectExecute(Data);

	if (Data.EvaluatedData.Attribute != GetDamageAttribute())
	{
		return;
	}

	// Consume the meta attribute so the next hit starts from zero.
	const float RawDamage = GetDamage();
	SetDamage(0.f);

	if (RawDamage <= 0.f)
	{
		return;
	}

	UAbilitySystemComponent& TargetASC = Data.Target;
	if (TargetASC.HasMatchingGameplayTag(ClockworksTags::State_Dead) || TargetASC.HasMatchingGameplayTag(ClockworksTags::State_Invulnerable))
	{
		return;
	}

	// Damage types. The Damage meta attribute is the total the effect added, but the effect also
	// carries how that total was split between the four types. Each part is resolved separately
	// against the target's family and the results summed, which is how the original works and why
	// a weapon can be excellent against one monster and useless against the next.
	//
	// A hit that named no types at all is Normal. Every ability written before types existed keeps
	// working unchanged, which is the point.
	const FGameplayTag FamilyTag = GetFamilyTag(&TargetASC);
	float TypedTotal = 0.f;
	float TypedResolved = 0.f;

	// A monster carrying the original's defense by depth has its family inside those numbers (a weakness halves that
	// type's defense, a resistance adds 1400), so the family chart must not apply on top.
	const AClockworksEnemyCharacter* DepthMonster = Cast<AClockworksEnemyCharacter>(TargetASC.GetAvatarActor());
	if (DepthMonster && !DepthMonster->HasDepthDefense())
	{
		DepthMonster = nullptr;
	}
	float DisplayMultiplier = -1.f;

	// In EClockworksDamageKind order, so each part meets the defense of its own type below.
	static const FGameplayTag TypeTags[] = {
		ClockworksTags::Data_Damage_Normal,
		ClockworksTags::Data_Damage_Piercing,
		ClockworksTags::Data_Damage_Elemental,
		ClockworksTags::Data_Damage_Shadow,
	};
	float PartAfterFamily[UE_ARRAY_COUNT(TypeTags)] = { 0.f, 0.f, 0.f, 0.f };

	for (int32 Kind = 0; Kind < UE_ARRAY_COUNT(TypeTags); ++Kind)
	{
		const float Part = Data.EffectSpec.GetSetByCallerMagnitude(TypeTags[Kind], /*WarnIfNotFound*/ false, /*DefaultIfNotFound*/ 0.f);
		if (Part > 0.f)
		{
			TypedTotal += Part;
			PartAfterFamily[Kind] = Part * (DepthMonster ? 1.f : GetFamilyMultiplier(FamilyTag, TypeTags[Kind]));
			TypedResolved += PartAfterFamily[Kind];
		}
	}

	// Whatever the effect did not account for by type is Normal. That covers both an untyped hit
	// and a typed one whose parts do not add up to the total.
	const float Untyped = FMath::Max(0.f, RawDamage - TypedTotal);
	const float UntypedAfterFamily = Untyped * (DepthMonster ? 1.f : GetFamilyMultiplier(FamilyTag, ClockworksTags::Data_Damage_Normal));
	PartAfterFamily[0] += UntypedAfterFamily;
	const float AfterFamily = TypedResolved + UntypedAfterFamily;

	// A knight's gear damage bonuses: the weapon class's relative bonus and any bonus against this target's family
	// share one pool capped at ±48% (the original's rule). The weapon comes off the hit's context: abilities, bullets
	// and bombs all put it there. A hit with no weapon (a bash, a burn) gets no bonus.
	float BonusFactor = 1.f;
	const FGameplayEffectContextHandle& HitContext = Data.EffectSpec.GetContext();
	if (const AClockworksPlayerState* Attacker = ClockworksGearStats::KnightOf(HitContext.GetInstigatorAbilitySystemComponent()))
	{
		if (const UClockworksWeaponDefinition* Weapon = Cast<UClockworksWeaponDefinition>(HitContext.GetSourceObject()))
		{
			BonusFactor = ClockworksGearStats::DamageFactor(ClockworksGearStats::TotalFor(Attacker), Weapon->WeaponClass,
				ClockworksGearStats::FamilyIndexOf(FamilyTag));
		}
	}
	for (float& Part : PartAfterFamily)
	{
		Part *= BonusFactor;
	}
	const float AfterBonus = AfterFamily * BonusFactor;

	// Burning ignores defense once it has started, which is what makes fire the answer to something
	// heavily armoured. Everything else goes through the armour first, and never below one point,
	// so a hit always registers.
	const bool bIsBurn = Data.EffectSpec.Def && Data.EffectSpec.Def->GetAssetTags().HasTag(ClockworksTags::Status_Fire);
	float Mitigated = AfterBonus;
	if (!bIsBurn)
	{
		if (const AClockworksPlayerState* Knight = ClockworksGearStats::KnightOf(&TargetASC))
		{
			// A knight defends with its gear, per damage type, by the original's rule (ClockworksGearStats::NetDamage).
			// A raised shield takes the hit on its own defense instead of the armour's: the armour is not what is hit.
			const FClockworksGearTotals Gear = ClockworksGearStats::TotalFor(Knight);
			const bool bBlocking = TargetASC.HasMatchingGameplayTag(ClockworksTags::State_Shielding) && GetShield() > 0.f;
			float Net = 0.f;
			for (int32 Kind = 0; Kind < UE_ARRAY_COUNT(TypeTags); ++Kind)
			{
				const float Defense = (bBlocking ? Gear.ShieldDefense[Kind] : Gear.Defense[Kind]) + GetDefensePower();
				Net += ClockworksGearStats::NetDamage(PartAfterFamily[Kind], Defense);
			}
			Mitigated = FMath::Max(1.f, Net);
		}
		else if (DepthMonster)
		{
			// The original's rule against the monster's own defense per type at the party's depth.
			const UWorld* World = TargetASC.GetWorld();
			const AClockworksGameState* GameState = World ? World->GetGameState<AClockworksGameState>() : nullptr;
			const int32 Depth = GameState ? GameState->GetDepth() : 0;
			float Net = 0.f;
			for (int32 Kind = 0; Kind < UE_ARRAY_COUNT(TypeTags); ++Kind)
			{
				Net += ClockworksGearStats::NetDamage(PartAfterFamily[Kind], DepthMonster->GetDefenseAt(Kind, Depth));
			}
			Mitigated = FMath::Max(1.f, Net);
			// For the damage number's colour: how this hit did against the monster's Normal defense, weak above 1.
			const float AsNormal = ClockworksGearStats::NetDamage(AfterBonus, DepthMonster->GetDefenseAt(0, Depth));
			DisplayMultiplier = AsNormal > KINDA_SMALL_NUMBER ? Net / AsNormal : 1.f;
		}
		else
		{
			// Monsters without the original's numbers (the training dummy) keep the flat subtraction.
			Mitigated = FMath::Max(1.f, AfterBonus - GetDefensePower());
		}
	}

	// A shove with no damage of its own (a vortex pulling, a pulse that only pushes): it moves the target
	// and does nothing else, so it neither hurts, nor wakes, nor thaws, nor triggers a curse.
	const bool bShoveOnly = Data.EffectSpec.GetSetByCallerMagnitude(ClockworksTags::Data_ShoveOnly, /*WarnIfNotFound*/ false, /*DefaultIfNotFound*/ 0.f) > 0.f;
	if (bShoveOnly)
	{
		Mitigated = 0.f;
	}

	// Freeze and Sleep both break on any hit, and the two break differently on purpose (user's decisions 2026-09-15,
	// research _research/status_damage). The hit that wakes a sleeper adds the sleep's wake damage, the original's
	// depth-scaled amount stored when it was inflicted. Breaking a monster's ice early spares it the thaw damage it takes
	// when the ice melts on its own (UClockworksGameplayAbility::TryApplyStatus); a knight's ice costs the thaw damage
	// only when a monster breaks it.
	if (!bShoveOnly && TargetASC.HasMatchingGameplayTag(ClockworksTags::Status_Sleep))
	{
		Mitigated += ActiveStatusDamage(TargetASC, ClockworksTags::Status_Sleep);
		TargetASC.RemoveActiveEffectsWithGrantedTags(FGameplayTagContainer(ClockworksTags::Status_Sleep));
	}
	else if (!bShoveOnly && TargetASC.HasMatchingGameplayTag(ClockworksTags::Status_Freeze))
	{
		if (ClockworksGearStats::KnightOf(&TargetASC) && !ClockworksGearStats::KnightOf(HitContext.GetInstigatorAbilitySystemComponent()))
		{
			Mitigated += ActiveStatusDamage(TargetASC, ClockworksTags::Status_Freeze);
		}
		TargetASC.RemoveActiveEffectsWithGrantedTags(FGameplayTagContainer(ClockworksTags::Status_Freeze));
	}

	// Direction from the attacker to the target, flattened to the floor, for knockback.
	const FGameplayEffectContextHandle& Context = Data.EffectSpec.GetContext();
	AActor* InstigatorActor = Context.GetInstigator();
	AActor* Causer = Context.GetEffectCauser();
	AActor* TargetActor = TargetASC.GetAvatarActor();

	FVector HitDirection = FVector::ForwardVector;
	if (Causer && TargetActor)
	{
		FVector ToTarget = TargetActor->GetActorLocation() - Causer->GetActorLocation();
		ToTarget.Z = 0.f;
		HitDirection = ToTarget.IsNearlyZero() ? Causer->GetActorForwardVector() : ToTarget.GetSafeNormal();
	}

	// Some hits shove sideways as well as away: a Combo Strike knocks left, then right.
	const float KnockbackAngle = Data.EffectSpec.GetSetByCallerMagnitude(ClockworksTags::Data_KnockbackAngle, /*WarnIfNotFound*/ false, /*DefaultIfNotFound*/ 0.f);
	if (!FMath::IsNearlyZero(KnockbackAngle))
	{
		HitDirection = HitDirection.RotateAngleAxis(KnockbackAngle, FVector::UpVector);
	}

	// How hard this particular hit shoves, relative to the target's own knockback speed. Absent
	// on most hits; the sword's finisher and charge set it above one.
	float KnockbackMultiplier = Data.EffectSpec.GetSetByCallerMagnitude(ClockworksTags::Data_Knockback, /*WarnIfNotFound*/ false, /*DefaultIfNotFound*/ 1.f);

	// Frozen and sleeping things cannot be shoved. Checked after the break above, so the hit that
	// breaks the ice does shove: it is a normal hit by the time it lands.
	if (TargetASC.HasMatchingGameplayTag(ClockworksTags::State_NoKnockback))
	{
		KnockbackMultiplier = 0.f;
	}

	// A curse is no longer paid per hit landed: its bearer pays once per attack it uses (HandleAbilityActivated).

	// A raised shield (State.Shielding, owned by the shield ability on the server) takes the whole
	// hit in place of Health, even one bigger than what is left: as in Spiral Knights the knight is
	// untouched and the shield shatters instead. Knockback still applies; shields never stop that.
	if (TargetASC.HasMatchingGameplayTag(ClockworksTags::State_Shielding) && GetShield() > 0.f)
	{
		const float OldShield = GetShield();
		SetShield(FMath::Max(0.f, OldShield - Mitigated));
		OnBlocked.Broadcast(FMath::Min(Mitigated, OldShield), HitDirection, KnockbackMultiplier);
		if (GetShield() <= 0.f)
		{
			OnShieldBroken.Broadcast();
		}
		return;
	}

	const float OldHealth = GetHealth();
	const float NewHealth = FMath::Clamp(OldHealth - Mitigated, 0.f, GetMaxHealth());
	SetHealth(NewHealth);

	// How the family took it, averaged across the types this hit carried. One is neutral.
	const float EffectiveMultiplier = DisplayMultiplier >= 0.f ? DisplayMultiplier : (TypedTotal + Untyped > 0.f)
		? (AfterFamily / FMath::Max(TypedTotal + Untyped, KINDA_SMALL_NUMBER))
		: 1.f;

	OnDamaged.Broadcast(InstigatorActor, Causer, Mitigated, HitDirection, KnockbackMultiplier, EffectiveMultiplier);

	if (OldHealth > 0.f && NewHealth <= 0.f)
	{
		OnOutOfHealth.Broadcast();
	}
}

// Runs on: server only (the callbacks also fire on a predicting client, which is ignored here). Spiral Knights curses a
// monster so that it hurts itself every time it attacks, which punishes it for doing the one thing it wants to do.
void UClockworksAttributeSet::HandleAbilityActivated(UGameplayAbility* Ability)
{
	UAbilitySystemComponent* Owner = GetOwningAbilitySystemComponent();
	if (!Ability || !Owner || !Owner->IsOwnerActorAuthoritative())
	{
		return;
	}
	if (!Owner->HasMatchingGameplayTag(ClockworksTags::Status_Curse) || Owner->HasMatchingGameplayTag(ClockworksTags::State_Dead)
		|| !Ability->GetAssetTags().HasTag(ClockworksTags::Ability_Attack))
	{
		return;
	}

	// Straight off health, deliberately: a curse is not a hit and must not be blocked, resisted by a family, or turned
	// away by a shield (the original's curse damage is unblockable).
	const float Cost = FMath::Min(ActiveStatusDamage(*Owner, ClockworksTags::Status_Curse), CurseCostCap);
	if (Cost <= 0.f || GetHealth() <= 0.f)
	{
		return;
	}
	SetHealth(FMath::Max(0.f, GetHealth() - Cost));
	if (GetHealth() <= 0.f)
	{
		OnOutOfHealth.Broadcast();
	}
}

// Runs on: server only in practice (statuses live there); a pure read.
float UClockworksAttributeSet::ActiveStatusDamage(const UAbilitySystemComponent& AbilitySystemComponent, const FGameplayTag& StatusTag)
{
	float Amount = 0.f;
	const FGameplayEffectQuery Query = FGameplayEffectQuery::MakeQuery_MatchAnyOwningTags(FGameplayTagContainer(StatusTag));
	for (const FActiveGameplayEffectHandle& Handle : AbilitySystemComponent.GetActiveEffects(Query))
	{
		if (const FActiveGameplayEffect* Active = AbilitySystemComponent.GetActiveGameplayEffect(Handle))
		{
			Amount = FMath::Max(Amount, Active->Spec.GetSetByCallerMagnitude(ClockworksTags::Data_Damage, /*WarnIfNotFound*/ false, /*DefaultIfNotFound*/ 0.f));
		}
	}
	return Amount;
}

// Runs on: wherever it is called; pure. The Spiral Knights weakness chart.
//
// Each family is weak to exactly one damage type and strong against exactly one, and everything
// else lands as written. Those two facts are what make a loadout a decision rather than a formality.
float UClockworksAttributeSet::GetFamilyMultiplier(const FGameplayTag& FamilyTag, const FGameplayTag& DamageTypeTag)
{
	// A weakness lands about two thirds again; a resistance takes off about seventy per cent.
	constexpr float Weak = 1.66f;
	constexpr float Strong = 0.3f;

	if (!FamilyTag.IsValid() || !DamageTypeTag.IsValid())
	{
		return 1.f;
	}

	FGameplayTag WeakTo;
	FGameplayTag StrongAgainst;

	if (FamilyTag == ClockworksTags::Family_Beast)
	{
		WeakTo = ClockworksTags::Data_Damage_Piercing;
		StrongAgainst = ClockworksTags::Data_Damage_Shadow;
	}
	else if (FamilyTag == ClockworksTags::Family_Construct)
	{
		WeakTo = ClockworksTags::Data_Damage_Elemental;
		StrongAgainst = ClockworksTags::Data_Damage_Normal;
	}
	else if (FamilyTag == ClockworksTags::Family_Slime)
	{
		WeakTo = ClockworksTags::Data_Damage_Piercing;
		StrongAgainst = ClockworksTags::Data_Damage_Elemental;
	}
	else if (FamilyTag == ClockworksTags::Family_Gremlin)
	{
		WeakTo = ClockworksTags::Data_Damage_Shadow;
		StrongAgainst = ClockworksTags::Data_Damage_Piercing;
	}
	else if (FamilyTag == ClockworksTags::Family_Undead)
	{
		WeakTo = ClockworksTags::Data_Damage_Elemental;
		StrongAgainst = ClockworksTags::Data_Damage_Piercing;
	}
	else if (FamilyTag == ClockworksTags::Family_Fiend)
	{
		WeakTo = ClockworksTags::Data_Damage_Piercing;
		StrongAgainst = ClockworksTags::Data_Damage_Shadow;
	}
	else
	{
		return 1.f;
	}

	if (DamageTypeTag == WeakTo)
	{
		return Weak;
	}
	if (DamageTypeTag == StrongAgainst)
	{
		return Strong;
	}
	return 1.f;
}

// Runs on: wherever it is called. An ability system component with no family tag is not a monster.
FGameplayTag UClockworksAttributeSet::GetFamilyTag(const UAbilitySystemComponent* AbilitySystemComponent)
{
	if (!AbilitySystemComponent)
	{
		return FGameplayTag();
	}

	static const FGameplayTag FamilyTags[] = {
		ClockworksTags::Family_Beast,
		ClockworksTags::Family_Construct,
		ClockworksTags::Family_Slime,
		ClockworksTags::Family_Gremlin,
		ClockworksTags::Family_Undead,
		ClockworksTags::Family_Fiend,
	};

	for (const FGameplayTag& FamilyTag : FamilyTags)
	{
		if (AbilitySystemComponent->HasMatchingGameplayTag(FamilyTag))
		{
			return FamilyTag;
		}
	}
	return FGameplayTag();
}

// Runs on: clients, when a replicated attribute arrives. The macro keeps prediction bookkeeping straight.
void UClockworksAttributeSet::OnRep_Health(const FGameplayAttributeData& OldValue)
{
	GAMEPLAYATTRIBUTE_REPNOTIFY(UClockworksAttributeSet, Health, OldValue);
}

void UClockworksAttributeSet::OnRep_MaxHealth(const FGameplayAttributeData& OldValue)
{
	GAMEPLAYATTRIBUTE_REPNOTIFY(UClockworksAttributeSet, MaxHealth, OldValue);
}

void UClockworksAttributeSet::OnRep_Shield(const FGameplayAttributeData& OldValue)
{
	GAMEPLAYATTRIBUTE_REPNOTIFY(UClockworksAttributeSet, Shield, OldValue);
}

void UClockworksAttributeSet::OnRep_MaxShield(const FGameplayAttributeData& OldValue)
{
	GAMEPLAYATTRIBUTE_REPNOTIFY(UClockworksAttributeSet, MaxShield, OldValue);
}

void UClockworksAttributeSet::OnRep_AttackPower(const FGameplayAttributeData& OldValue)
{
	GAMEPLAYATTRIBUTE_REPNOTIFY(UClockworksAttributeSet, AttackPower, OldValue);
}

void UClockworksAttributeSet::OnRep_DefensePower(const FGameplayAttributeData& OldValue)
{
	GAMEPLAYATTRIBUTE_REPNOTIFY(UClockworksAttributeSet, DefensePower, OldValue);
}

void UClockworksAttributeSet::OnRep_MoveSpeed(const FGameplayAttributeData& OldValue)
{
	GAMEPLAYATTRIBUTE_REPNOTIFY(UClockworksAttributeSet, MoveSpeed, OldValue);
}
