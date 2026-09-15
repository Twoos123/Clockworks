// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameStateBase.h"
#include "ClockworksGameState.generated.h"

/** What kind of floor a depth is. Decides what gets built on it and what the elevator does next. */
UENUM(BlueprintType)
enum class EClockworksFloorKind : uint8
{
	/** Depth 0: no monsters, a safe place to set out from. Spiral Knights' Arcade lobby. */
	Lobby,

	/** The ordinary case: monsters, level objects, and an elevator at the far end. */
	Tunnels,

	/** A safe floor between strata. Heal, change your gear, then go on. A Clockwork Terminal. */
	Terminal,

	/** One big fight. No elevator until it is over. */
	Boss,

	/** Depth 8: the end of the run. The terminal over the world's heart. */
	Core
};

/** Broadcast on every machine when the depth changes, so the HUD and the world can react. */
DECLARE_MULTICAST_DELEGATE(FClockworksDepthChangedSignature);

/**
 * The run: how deep you are, and what kind of floor that is.
 *
 * Spiral Knights is a descent. What makes a set of rooms feel like a run rather than a set of maps
 * is that the depth is a number that only goes one way, that the floors change character as it
 * rises, and that everyone in the party shares it. That number lives here, on the game state,
 * because the game state is the one object every machine has a copy of.
 *
 * The server owns it. Clients read it.
 */
UCLASS()
class AClockworksGameState : public AGameStateBase
{
	GENERATED_BODY()

public:

	AClockworksGameState();

	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

	/** How deep the party is. Depth 0 is the lobby you start in. */
	UFUNCTION(BlueprintPure, Category = "Run")
	int32 GetDepth() const { return Depth; }

	/** What kind of floor the current depth is. */
	UFUNCTION(BlueprintPure, Category = "Run")
	EClockworksFloorKind GetFloorKind() const { return FloorKindForDepth(Depth); }

	/** The deepest depth this run goes. Reaching it is the end of the demo. */
	UFUNCTION(BlueprintPure, Category = "Run")
	int32 GetMaxDepth() const { return MaxDepth; }

	/** Name for the current floor, for the HUD and the elevator sign. */
	UFUNCTION(BlueprintPure, Category = "Run")
	FText GetFloorName() const;

	/** Server only: go one floor deeper. Refused past MaxDepth. */
	bool AdvanceDepth();

	/** Server only: back to the start, for a fresh run. */
	void ResetRun();

	/**
	 * Which kind of floor a given depth is.
	 *
	 * The shape of the whole demo is in this one function. Spiral Knights' real descent is thirty
	 * depths across three tiers; this is the same shape compressed so that every *kind* of floor
	 * appears once: you set out from a lobby, fight through tunnels, reach a terminal where you can
	 * change your kit, fight through a themed stratum, beat a boss, and stand over the Core.
	 */
	UFUNCTION(BlueprintPure, Category = "Run")
	EClockworksFloorKind FloorKindForDepth(int32 InDepth) const;

	/** Fires on every machine when the depth changes. */
	FClockworksDepthChangedSignature OnDepthChanged;

protected:

	UFUNCTION()
	void OnRep_Depth();

	/** The current depth. Server decides; everyone reads. */
	UPROPERTY(ReplicatedUsing = OnRep_Depth, VisibleInstanceOnly, Category = "Run")
	int32 Depth = 0;

	/** The last depth of the run. Eight floors is one of every kind. */
	UPROPERTY(EditDefaultsOnly, Category = "Run", meta = (ClampMin = "1"))
	int32 MaxDepth = 8;

	/** Which depth the terminal sits at, between the two stretches of tunnels. */
	UPROPERTY(EditDefaultsOnly, Category = "Run", meta = (ClampMin = "1"))
	int32 TerminalDepth = 4;

	/** Which depth the boss is on. The one before the Core. */
	UPROPERTY(EditDefaultsOnly, Category = "Run", meta = (ClampMin = "1"))
	int32 BossDepth = 7;
};
