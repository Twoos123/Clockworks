// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksGameMode.h"
#include "ClockworksGameState.h"

// Runs on: all machines (class default object).
AClockworksGameMode::AClockworksGameMode()
{
	// The run's depth lives on the game state, which is the one object every machine has a copy of.
	// Set here rather than in a Blueprint so the elevator can never find itself with nothing to
	// descend into because someone forgot to tick a box.
	GameStateClass = AClockworksGameState::StaticClass();
}