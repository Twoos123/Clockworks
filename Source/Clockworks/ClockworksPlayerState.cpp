// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksPlayerState.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksGearDefinition.h"
#include "ClockworksGearStats.h"
#include "World/ClockworksGameState.h"
#include "ClockworksGameplayAbility.h"
#include "ClockworksGameplayTags.h"
#include "ClockworksWeaponDefinition.h"
#include "Clockworks.h"
#include "AbilitySystemComponent.h"
#include "GameplayEffect.h"
#include "Net/UnrealNetwork.h"

// Runs on: all machines (class default object and every instance). The PlayerState replicates to
// everyone, so every client gets a copy of the component and the attribute set.
AClockworksPlayerState::AClockworksPlayerState()
{
	AbilitySystemComponent = CreateDefaultSubobject<UAbilitySystemComponent>(TEXT("AbilitySystemComponent"));
	AbilitySystemComponent->SetIsReplicated(true);

	// Mixed: gameplay effects replicate to the owning client only, tags and cues to everyone.
	// The right mode for a player-owned component; Minimal is for AI.
	AbilitySystemComponent->SetReplicationMode(EGameplayEffectReplicationMode::Mixed);

	// Found by the component automatically because it is a subobject of the same owner.
	AttributeSet = CreateDefaultSubobject<UClockworksAttributeSet>(TEXT("AttributeSet"));

	// PlayerStates default to one update per second, far too slow for combat state.
	SetNetUpdateFrequency(100.f);
}

// Runs on: all machines (the engine asks once per class).
void AClockworksPlayerState::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);

	DOREPLIFETIME(AClockworksPlayerState, WeaponSlots);
	DOREPLIFETIME(AClockworksPlayerState, ActiveWeaponIndex);
	DOREPLIFETIME(AClockworksPlayerState, GearSlots);
}

// Runs on: server only, once, from the first character's InitAbilitySystem.
void AClockworksPlayerState::InitialiseLoadout(const TArray<TObjectPtr<UClockworksWeaponDefinition>>& Weapons)
{
	if (!HasAuthority())
	{
		return;
	}

	WeaponSlots.Reset();
	for (const TObjectPtr<UClockworksWeaponDefinition>& Weapon : Weapons)
	{
		if (Weapon && WeaponSlots.Num() < MaxWeaponSlots)
		{
			WeaponSlots.Add(Weapon);
		}
	}
	ActiveWeaponIndex = INDEX_NONE;

	if (WeaponSlots.Num() > 0)
	{
		EquipWeaponSlot(0);
	}
	else
	{
		OnLoadoutChanged.Broadcast();
	}
}

// Runs on: owning client (or the listen host for its own knight). Intent only; the server decides.
void AClockworksPlayerState::RequestSetLoadout(const TArray<UClockworksWeaponDefinition*>& Weapons)
{
	if (HasAuthority())
	{
		SetLoadout(Weapons);
		return;
	}
	ServerSetLoadout(Weapons);
}

// Runs on: server only (RPC from the owning client).
void AClockworksPlayerState::ServerSetLoadout_Implementation(const TArray<UClockworksWeaponDefinition*>& Weapons)
{
	SetLoadout(Weapons);
}

// Runs on: server only. The whole toolbar at once, from the gear screen. Refused in the same cases
// a single switch is refused, so a new loadout can never cut an attack short.
bool AClockworksPlayerState::SetLoadout(const TArray<UClockworksWeaponDefinition*>& Weapons)
{
	if (!HasAuthority() || !CanSwitchWeapon())
	{
		return false;
	}

	WeaponSlots.Reset();
	for (UClockworksWeaponDefinition* Weapon : Weapons)
	{
		if (Weapon && WeaponSlots.Num() < MaxWeaponSlots)
		{
			WeaponSlots.Add(Weapon);
		}
	}

	// The drawn weapon is gone with the old toolbar, so the hand has to be cleared before the new
	// slot 0 is granted: EquipWeaponSlot only takes back what it knows it gave out.
	ActiveWeaponIndex = INDEX_NONE;

	if (WeaponSlots.Num() > 0)
	{
		EquipWeaponSlot(0);
	}
	else
	{
		OnLoadoutChanged.Broadcast();
	}
	return true;
}

// Runs on: server only. Takes back what the previous weapon granted, grants the new one's ability
// and effects, then the replicated index tells everyone which model to put in the hand.
bool AClockworksPlayerState::EquipWeaponSlot(int32 SlotIndex)
{
	if (!HasAuthority() || !AbilitySystemComponent || !WeaponSlots.IsValidIndex(SlotIndex))
	{
		return false;
	}
	if (SlotIndex == ActiveWeaponIndex)
	{
		return true;
	}
	if (!CanSwitchWeapon())
	{
		return false;
	}

	if (ActiveWeaponAbilityHandle.IsValid())
	{
		AbilitySystemComponent->ClearAbility(ActiveWeaponAbilityHandle);
		ActiveWeaponAbilityHandle = FGameplayAbilitySpecHandle();
	}
	for (const FActiveGameplayEffectHandle& EffectHandle : EquipEffectHandles)
	{
		AbilitySystemComponent->RemoveActiveGameplayEffect(EffectHandle);
	}
	EquipEffectHandles.Reset();

	UClockworksWeaponDefinition* Weapon = WeaponSlots[SlotIndex];
	if (Weapon->AttackAbility)
	{
		// Same input ID rule as the character's default abilities: the button reaches a running
		// ability (combo follow-ups, charge release) on both the client and the server.
		int32 InputID = INDEX_NONE;
		if (const UClockworksGameplayAbility* Defaults = Weapon->AttackAbility->GetDefaultObject<UClockworksGameplayAbility>())
		{
			if (Defaults->GetAbilityInputID() != EClockworksAbilityInputID::None)
			{
				InputID = static_cast<int32>(Defaults->GetAbilityInputID());
			}
		}
		ActiveWeaponAbilityHandle = AbilitySystemComponent->GiveAbility(FGameplayAbilitySpec(Weapon->AttackAbility, 1, InputID, Weapon));
	}

	for (const TSubclassOf<UGameplayEffect>& EffectClass : Weapon->EquipEffects)
	{
		if (!EffectClass)
		{
			continue;
		}
		FGameplayEffectContextHandle Context = AbilitySystemComponent->MakeEffectContext();
		Context.AddSourceObject(Weapon);
		const FGameplayEffectSpecHandle SpecHandle = AbilitySystemComponent->MakeOutgoingSpec(EffectClass, 1.f, Context);
		if (SpecHandle.IsValid())
		{
			EquipEffectHandles.Add(AbilitySystemComponent->ApplyGameplayEffectSpecToSelf(*SpecHandle.Data));
		}
	}

	ActiveWeaponIndex = SlotIndex;
	UE_LOG(LogClockworks, Log, TEXT("Loadout: %s drew slot %d (%s)"), *GetPlayerName(), SlotIndex, *GetNameSafe(Weapon));

	// The server's own listeners (the host's toolbar and its copy of the knight). Clients hear the
	// same change through OnRep_ActiveWeapon.
	OnLoadoutChanged.Broadcast();
	return true;
}

// Runs on: server (the authoritative check) and owning client (an early out before sending).
bool AClockworksPlayerState::CanSwitchWeapon() const
{
	if (!AbilitySystemComponent)
	{
		return false;
	}
	FGameplayTagContainer Busy;
	Busy.AddTag(ClockworksTags::State_Attacking);
	Busy.AddTag(ClockworksTags::State_Dodging);
	Busy.AddTag(ClockworksTags::State_Dead);
	return !AbilitySystemComponent->HasAnyMatchingGameplayTags(Busy);
}

// Runs on: owning client, or the listen host for its own knight. Intent: the server decides.
void AClockworksPlayerState::RequestWeaponSlot(int32 SlotIndex)
{
	if (!WeaponSlots.IsValidIndex(SlotIndex) || SlotIndex == ActiveWeaponIndex)
	{
		return;
	}
	if (HasAuthority())
	{
		EquipWeaponSlot(SlotIndex);
	}
	else
	{
		ServerSelectWeapon(SlotIndex);
	}
}

// Runs on: owning client. Wraps, so Space cycles round the toolbar like Spiral Knights.
void AClockworksPlayerState::RequestWeaponStep(int32 Direction)
{
	const int32 Count = WeaponSlots.Num();
	if (Count <= 1 || Direction == 0)
	{
		return;
	}
	const int32 Current = ActiveWeaponIndex < 0 ? 0 : ActiveWeaponIndex;
	const int32 Step = Direction > 0 ? 1 : -1;
	RequestWeaponSlot(((Current + Step) % Count + Count) % Count);
}

// Runs on: server only (RPC from the owning client; the engine drops it from anyone else).
void AClockworksPlayerState::ServerSelectWeapon_Implementation(int32 SlotIndex)
{
	EquipWeaponSlot(SlotIndex);
}

// Runs on: clients, when the replicated slots arrive.
void AClockworksPlayerState::OnRep_Loadout()
{
	OnLoadoutChanged.Broadcast();
}

// Runs on: clients, when the drawn slot changes.
void AClockworksPlayerState::OnRep_ActiveWeapon()
{
	OnLoadoutChanged.Broadcast();
}

// Runs on: all machines.
UClockworksWeaponDefinition* AClockworksPlayerState::GetActiveWeapon() const
{
	return WeaponSlots.IsValidIndex(ActiveWeaponIndex) ? WeaponSlots[ActiveWeaponIndex].Get() : nullptr;
}

// Runs on: all machines.
EClockworksGearSlot AClockworksPlayerState::SlotKind(EClockworksGearSlotIndex Slot)
{
	switch (Slot)
	{
	case EClockworksGearSlotIndex::Helmet: return EClockworksGearSlot::Helmet;
	case EClockworksGearSlotIndex::Armor:  return EClockworksGearSlot::Armor;
	case EClockworksGearSlotIndex::Shield: return EClockworksGearSlot::Shield;
	default:                               return EClockworksGearSlot::Trinket;
	}
}

// Runs on: server only, once, from the first character's InitAbilitySystem.
void AClockworksPlayerState::InitialiseGear(const TArray<TObjectPtr<UClockworksGearDefinition>>& Gear)
{
	if (!HasAuthority())
	{
		return;
	}
	TArray<UClockworksGearDefinition*> Pieces;
	for (const TObjectPtr<UClockworksGearDefinition>& Piece : Gear)
	{
		Pieces.Add(Piece.Get());
	}
	AssignGear(Pieces);
}

// Runs on: owning client (or the listen host for its own knight). Intent only; the server decides.
void AClockworksPlayerState::RequestSetGear(const TArray<UClockworksGearDefinition*>& Gear)
{
	if (HasAuthority())
	{
		SetGear(Gear);
		return;
	}
	ServerSetGear(Gear);
}

// Runs on: server only (RPC from the owning client).
void AClockworksPlayerState::ServerSetGear_Implementation(const TArray<UClockworksGearDefinition*>& Gear)
{
	SetGear(Gear);
}

// Runs on: server only. Changing gear mid-fight is refused in the same cases a weapon switch is, and
// while the shield is up, so a block can never lose its shield halfway through.
bool AClockworksPlayerState::SetGear(const TArray<UClockworksGearDefinition*>& Gear)
{
	if (!HasAuthority() || !CanSwitchWeapon())
	{
		return false;
	}
	if (AbilitySystemComponent && AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Shielding))
	{
		return false;
	}
	AssignGear(Gear);
	return true;
}

// Runs on: server only.
void AClockworksPlayerState::AssignGear(const TArray<UClockworksGearDefinition*>& Gear)
{
	const int32 Count = static_cast<int32>(EClockworksGearSlotIndex::Count);
	GearSlots.SetNum(Count);
	for (int32 Index = 0; Index < Count; ++Index)
	{
		UClockworksGearDefinition* Piece = Gear.IsValidIndex(Index) ? Gear[Index] : nullptr;
		// A piece offered for the wrong kind of slot is left out rather than worn where it does not belong.
		if (Piece && Piece->Slot != SlotKind(static_cast<EClockworksGearSlotIndex>(Index)))
		{
			UE_LOG(LogClockworks, Warning, TEXT("Gear: %s is not a piece for slot %d; left out."), *GetNameSafe(Piece), Index);
			Piece = nullptr;
		}
		GearSlots[Index] = Piece;
	}
	UE_LOG(LogClockworks, Log, TEXT("Gear: %s wears %s, %s, %s, %s, %s"), *GetPlayerName(),
		*GetNameSafe(GearSlots[0]), *GetNameSafe(GearSlots[1]), *GetNameSafe(GearSlots[2]), *GetNameSafe(GearSlots[3]), *GetNameSafe(GearSlots[4]));

	RefreshGearStats();

	// The server's own listeners (the host's copy of the knight). Clients hear it through OnRep_Gear.
	OnGearChanged.Broadcast();
}

// Runs on: clients, when the replicated gear arrives.
void AClockworksPlayerState::OnRep_Gear()
{
	OnGearChanged.Broadcast();
}

// Runs on: all machines; only the server listens for the depth.
void AClockworksPlayerState::BeginPlay()
{
	Super::BeginPlay();

	if (HasAuthority())
	{
		if (AClockworksGameState* GameState = GetWorld() ? GetWorld()->GetGameState<AClockworksGameState>() : nullptr)
		{
			GameState->OnDepthChanged.AddUObject(this, &AClockworksPlayerState::HandleDepthChanged);
		}
		// A cursed knight pays for each attack it uses, as a cursed monster does.
		if (AbilitySystemComponent && AttributeSet)
		{
			AbilitySystemComponent->AbilityActivatedCallbacks.AddUObject(ToRawPtr(AttributeSet), &UClockworksAttributeSet::HandleAbilityActivated);
		}
	}
}

// Runs on: all machines.
void AClockworksPlayerState::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (AClockworksGameState* GameState = GetWorld() ? GetWorld()->GetGameState<AClockworksGameState>() : nullptr)
	{
		GameState->OnDepthChanged.RemoveAll(this);
	}
	Super::EndPlay(EndPlayReason);
}

// Runs on: server only (bound only there).
void AClockworksPlayerState::HandleDepthChanged()
{
	RefreshGearStats();
}

// Runs on: server only. The attributes replicate to everyone.
void AClockworksPlayerState::RefreshGearStats()
{
	if (!HasAuthority() || !AttributeSet || !bAttributesInitialised)
	{
		return;
	}

	const float Depth = ClockworksGearStats::CurrentOriginalDepth(GetWorld());
	const FClockworksGearTotals Totals = ClockworksGearStats::Total(GearSlots, Depth);

	const float OldMaxHealth = AttributeSet->GetMaxHealth();
	const float NewMaxHealth = FMath::Max(1.f, BaseMaxHealth + Totals.HealthBonus);
	if (!FMath::IsNearlyEqual(OldMaxHealth, NewMaxHealth))
	{
		const float Health = AttributeSet->GetHealth();
		AttributeSet->SetMaxHealth(NewMaxHealth);
		// A dead knight stays dead; a living one gets the added health filled and loses only what no longer fits.
		if (Health > 0.f)
		{
			AttributeSet->SetHealth(FMath::Clamp(Health + FMath::Max(NewMaxHealth - OldMaxHealth, 0.f), 1.f, NewMaxHealth));
		}
	}

	const UClockworksGearDefinition* Shield = GetGear(EClockworksGearSlotIndex::Shield);
	const float OldMaxShield = AttributeSet->GetMaxShield();
	const float NewMaxShield = (Shield && Shield->ShieldHealth.Num() > 0)
		? UClockworksGearDefinition::ReadCurve(Shield->ShieldHealth, Depth)
		: BaseMaxShield;
	if (!FMath::IsNearlyEqual(OldMaxShield, NewMaxShield))
	{
		const float Fraction = OldMaxShield > 0.f ? AttributeSet->GetShield() / OldMaxShield : 1.f;
		AttributeSet->SetMaxShield(NewMaxShield);
		AttributeSet->SetShield(FMath::Clamp(Fraction, 0.f, 1.f) * NewMaxShield);
	}

	UE_LOG(LogClockworks, Log, TEXT("Gear: %s at original depth %.0f: health %.0f, shield %.0f, defense N%.0f P%.0f E%.0f S%.0f"),
		*GetPlayerName(), Depth, NewMaxHealth, NewMaxShield, Totals.Defense[0], Totals.Defense[1], Totals.Defense[2], Totals.Defense[3]);
}

// Runs on: all machines.
UClockworksGearDefinition* AClockworksPlayerState::GetGear(EClockworksGearSlotIndex Slot) const
{
	const int32 Index = static_cast<int32>(Slot);
	return GearSlots.IsValidIndex(Index) ? GearSlots[Index].Get() : nullptr;
}
