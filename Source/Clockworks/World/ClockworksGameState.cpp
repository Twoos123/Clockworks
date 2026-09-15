// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksGameState.h"
#include "Clockworks.h"
#include "Net/UnrealNetwork.h"

#define LOCTEXT_NAMESPACE "Clockworks"

// Runs on: all machines (class default object and every spawned instance).
AClockworksGameState::AClockworksGameState()
{
	bReplicates = true;
}

// Runs on: all machines (the engine asks once per class).
void AClockworksGameState::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);

	DOREPLIFETIME(AClockworksGameState, Depth);
}

// Runs on: wherever it is called; pure.
EClockworksFloorKind AClockworksGameState::FloorKindForDepth(int32 InDepth) const
{
	if (InDepth <= 0)
	{
		return EClockworksFloorKind::Lobby;
	}
	if (InDepth >= MaxDepth)
	{
		return EClockworksFloorKind::Core;
	}
	if (InDepth == BossDepth)
	{
		return EClockworksFloorKind::Boss;
	}
	if (InDepth == TerminalDepth)
	{
		return EClockworksFloorKind::Terminal;
	}
	return EClockworksFloorKind::Tunnels;
}

// Runs on: wherever it is called. What the elevator sign and the HUD show.
FText AClockworksGameState::GetFloorName() const
{
	switch (GetFloorKind())
	{
	case EClockworksFloorKind::Lobby:
		return LOCTEXT("FloorLobby", "Arcade");
	case EClockworksFloorKind::Terminal:
		return LOCTEXT("FloorTerminal", "Clockwork Terminal");
	case EClockworksFloorKind::Boss:
		return LOCTEXT("FloorBoss", "Lair");
	case EClockworksFloorKind::Core:
		return LOCTEXT("FloorCore", "The Core");
	case EClockworksFloorKind::Tunnels:
	default:
		return LOCTEXT("FloorTunnels", "Clockwork Tunnels");
	}
}

// Runs on: server only. The one place the depth ever moves.
bool AClockworksGameState::AdvanceDepth()
{
	if (!HasAuthority() || Depth >= MaxDepth)
	{
		return false;
	}

	++Depth;
	UE_LOG(LogClockworks, Log, TEXT("Run: descended to depth %d (%s)"), Depth, *GetFloorName().ToString());

	// The server's own copy does not get an OnRep, so it tells itself.
	OnDepthChanged.Broadcast();
	return true;
}

// Runs on: server only.
void AClockworksGameState::ResetRun()
{
	if (!HasAuthority())
	{
		return;
	}
	Depth = 0;
	UE_LOG(LogClockworks, Log, TEXT("Run: reset to the lobby"));
	OnDepthChanged.Broadcast();
}

// Runs on: clients, when the server's depth arrives.
void AClockworksGameState::OnRep_Depth()
{
	OnDepthChanged.Broadcast();
}

#undef LOCTEXT_NAMESPACE
