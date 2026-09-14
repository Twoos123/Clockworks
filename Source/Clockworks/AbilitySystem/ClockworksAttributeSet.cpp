// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksAttributeSet.h"
#include "ClockworksGameplayTags.h"
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
// into Shield and Health changes, so the rules live here, not in the attacker.
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

	// Defense reduces damage but never below one point, so a hit always registers.
	const float Mitigated = FMath::Max(1.f, RawDamage - GetDefensePower());

	// Shield absorbs first, Health takes the remainder.
	const float ShieldAbsorbed = FMath::Min(GetShield(), Mitigated);
	if (ShieldAbsorbed > 0.f)
	{
		SetShield(GetShield() - ShieldAbsorbed);
	}

	const float OldHealth = GetHealth();
	const float NewHealth = FMath::Clamp(OldHealth - (Mitigated - ShieldAbsorbed), 0.f, GetMaxHealth());
	SetHealth(NewHealth);

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

	// How hard this particular hit shoves, relative to the target's own knockback speed. Absent
	// on most hits; the sword's finisher and charge set it above one.
	const float KnockbackMultiplier = Data.EffectSpec.GetSetByCallerMagnitude(ClockworksTags::Data_Knockback, /*WarnIfNotFound*/ false, /*DefaultIfNotFound*/ 1.f);

	OnDamaged.Broadcast(InstigatorActor, Causer, Mitigated, HitDirection, KnockbackMultiplier);

	if (OldHealth > 0.f && NewHealth <= 0.f)
	{
		OnOutOfHealth.Broadcast();
	}
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
