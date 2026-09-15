// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerState.h"
#include "AbilitySystemInterface.h"
#include "ClockworksAttributeSet.h"
#include "GameplayAbilitySpecHandle.h"
#include "GameplayEffectTypes.h"
#include "ClockworksGearDefinition.h"
#include "ClockworksPlayerState.generated.h"

class UAbilitySystemComponent;
class UClockworksAttributeSet;
class UClockworksGearDefinition;
class UClockworksWeaponDefinition;

/** Fires on every machine when the loadout or the drawn weapon changes. */
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FClockworksLoadoutChangedSignature);

/**
 * Hosts a player's AbilitySystemComponent and attributes. Lives here rather than on the character
 * so health, abilities and effects survive the character being destroyed and respawned.
 *
 * Also owns the player's gear (phase 08): the weapons carried and which one is drawn. The server
 * decides both; clients only send a request and read the replicated result. Drawing a weapon
 * grants its attack ability to the attack button and takes the previous weapon's back, so the
 * combo you get is always the one for the thing in your hand.
 */
UCLASS()
class AClockworksPlayerState : public APlayerState, public IAbilitySystemInterface
{
	GENERATED_BODY()

public:

	AClockworksPlayerState();

	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

	virtual UAbilitySystemComponent* GetAbilitySystemComponent() const override { return AbilitySystemComponent; }

	UClockworksAttributeSet* GetAttributeSet() const { return AttributeSet; }

	/** Server-only bookkeeping so a respawned character doesn't grant or initialise twice. */
	bool bAbilitiesGranted = false;
	bool bAttributesInitialised = false;

	// ----- loadout -----

	/** The toolbar and the knight's hand listen to this. Runs on whichever machine saw the change. */
	UPROPERTY(BlueprintAssignable, Category = "Gear")
	FClockworksLoadoutChangedSignature OnLoadoutChanged;

	/** Server: fills the slots once, from the character's DefaultLoadout, and draws the first weapon. */
	void InitialiseLoadout(const TArray<TObjectPtr<UClockworksWeaponDefinition>>& Weapons);

	/** Server: draws the weapon in SlotIndex. Refused mid-attack, mid-dodge or dead. */
	bool EquipWeaponSlot(int32 SlotIndex);

	/** Owning client (or the listen host for its own knight): asks for a slot. Intent only; the server decides. */
	void RequestWeaponSlot(int32 SlotIndex);

	/** Owning client: the next (+1) or previous (-1) slot, wrapping round. */
	void RequestWeaponStep(int32 Direction);

	/** The weapon in the hand, or null before the loadout arrives. Valid on every machine. */
	UFUNCTION(BlueprintPure, Category = "Gear")
	UClockworksWeaponDefinition* GetActiveWeapon() const;

	UFUNCTION(BlueprintPure, Category = "Gear")
	int32 GetActiveWeaponIndex() const { return ActiveWeaponIndex; }

	const TArray<TObjectPtr<UClockworksWeaponDefinition>>& GetWeaponSlots() const { return WeaponSlots; }

	/** False while an attack or dodge is running, when a switch would cut it short. */
	bool CanSwitchWeapon() const;

	/**
	 * Owning client: asks for a whole new toolbar. This is what the gear screen sends; it is intent
	 * like any other, and the server decides whether to honour it.
	 */
	void RequestSetLoadout(const TArray<UClockworksWeaponDefinition*>& Weapons);

	/** Server: replaces the toolbar and redraws slot 0. Refused mid-attack, mid-dodge or dead. */
	bool SetLoadout(const TArray<UClockworksWeaponDefinition*>& Weapons);

	/** Most weapons a knight carries: the original's four slots, all open (user's decision, 2026-09-15). */
	static constexpr int32 MaxWeaponSlots = 4;

	// ----- gear -----

	/** Fires on every machine when a helmet, armour, shield or trinket changes. The knight's look listens. */
	UPROPERTY(BlueprintAssignable, Category = "Gear")
	FClockworksLoadoutChangedSignature OnGearChanged;

	/** Server: fills the gear once, from the character's DefaultGear, in slot order (helmet, armour, shield, two trinkets). */
	void InitialiseGear(const TArray<TObjectPtr<UClockworksGearDefinition>>& Gear);

	/** Owning client: asks for a whole set of gear in slot order. Intent only; the server decides. */
	void RequestSetGear(const TArray<UClockworksGearDefinition*>& Gear);

	/** Server: puts the set on. A piece offered for the wrong kind of slot is left out. Refused while busy (attacking, dodging, shielding) or dead. */
	bool SetGear(const TArray<UClockworksGearDefinition*>& Gear);

	/** The piece in a slot, or null. Valid on every machine. */
	UFUNCTION(BlueprintPure, Category = "Gear")
	UClockworksGearDefinition* GetGear(EClockworksGearSlotIndex Slot) const;

	const TArray<TObjectPtr<UClockworksGearDefinition>>& GetGearSlots() const { return GearSlots; }

	/** Which kind of gear a slot takes. */
	static EClockworksGearSlot SlotKind(EClockworksGearSlotIndex Slot);

	/** Server-only: the knight's own health and shield before gear, from the character's InitialMaxHealth / InitialMaxShield. */
	float BaseMaxHealth = 0.f;
	float BaseMaxShield = 0.f;

	/**
	 * Server: reads the worn gear at the party's depth into MaxHealth (base + the gear's health) and MaxShield
	 * (the shield's health). Runs when the gear or the depth changes. Health the new maximum adds arrives
	 * filled; a shield keeps how full it was.
	 */
	void RefreshGearStats();

	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

protected:

	/** Intent from the owning client: the whole set of gear at once, from the gear screen. */
	UFUNCTION(Server, Reliable)
	void ServerSetGear(const TArray<UClockworksGearDefinition*>& Gear);

	UFUNCTION() void OnRep_Gear();

	/** Helmet, armour, shield, trinket, trinket (EClockworksGearSlotIndex); null where nothing is worn. The server sets it; everyone reads it for the knight's look. */
	UPROPERTY(ReplicatedUsing = OnRep_Gear, VisibleInstanceOnly, Category = "Gear")
	TArray<TObjectPtr<UClockworksGearDefinition>> GearSlots;


	/** Intent from the owning client. */
	UFUNCTION(Server, Reliable)
	void ServerSelectWeapon(int32 SlotIndex);

	/** Intent from the owning client: the whole toolbar at once, from the gear screen. */
	UFUNCTION(Server, Reliable)
	void ServerSetLoadout(const TArray<UClockworksWeaponDefinition*>& Weapons);

	UFUNCTION() void OnRep_Loadout();
	UFUNCTION() void OnRep_ActiveWeapon();

	UPROPERTY(VisibleAnywhere, Category = "Abilities")
	TObjectPtr<UAbilitySystemComponent> AbilitySystemComponent;

	UPROPERTY()
	TObjectPtr<UClockworksAttributeSet> AttributeSet;

	/** The weapons carried, in toolbar order. Set by the server once; everyone reads it for the toolbar and the remote knights' hands. */
	UPROPERTY(ReplicatedUsing = OnRep_Loadout, VisibleInstanceOnly, Category = "Gear")
	TArray<TObjectPtr<UClockworksWeaponDefinition>> WeaponSlots;

	/** Which slot is drawn. The server decides; everyone reads. */
	UPROPERTY(ReplicatedUsing = OnRep_ActiveWeapon, VisibleInstanceOnly, Category = "Gear")
	int32 ActiveWeaponIndex = INDEX_NONE;

private:

	/** Server only: writes the gear slots from a set in slot order, leaving out pieces for the wrong kind of slot, and tells everyone. */
	void AssignGear(const TArray<UClockworksGearDefinition*>& Gear);

	/** Server only: gear numbers follow the depth. */
	void HandleDepthChanged();

	/** Server only: what the drawn weapon granted, so a switch can take it back. */
	FGameplayAbilitySpecHandle ActiveWeaponAbilityHandle;
	TArray<FActiveGameplayEffectHandle> EquipEffectHandles;
};
