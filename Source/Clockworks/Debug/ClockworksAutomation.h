// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"

class AClockworksCharacter;
class UWorld;

/**
 * Driving the game without a person at the keyboard.
 *
 * Almost everything built so far has been verified by reading data back, which catches a wrong number but never
 * catches a knight standing inside a wall. These console commands close that gap: the game runs headlessly, a command
 * dismisses the menu, another puts the knight somewhere, another presses attack, and `HighResShot` writes a picture
 * that can be looked at. None of it is OS-level input — every command calls the same function the key binding calls,
 * so what is tested is the real path and not a copy of it.
 *
 *   UnrealEditor-Cmd.exe Clockworks.uproject /Game/TopDown/Lvl_Floor -game -RenderOffScreen -unattended -nopause
 *       -ExecCmds="Clockworks.After 6 Clockworks.CloseMenus, Clockworks.After 9 HighResShot 1280x720,
 *                  Clockworks.After 11 Clockworks.Report, Clockworks.After 13 quit"
 *
 * `Clockworks.After` is what makes that work: -ExecCmds runs everything at once, at startup, before the world has
 * settled, so anything worth seeing needs a delay in front of it.
 *
 * Every command is local and does nothing a player could not do. They exist outside shipping builds only.
 */
struct FClockworksAutomation
{
	/** The local player's knight, or null. */
	static AClockworksCharacter* FindKnight(UWorld* World);

	/** Runs a console command after a delay, on the game thread. */
	static void RunAfter(UWorld* World, float Seconds, const FString& Command);
};
