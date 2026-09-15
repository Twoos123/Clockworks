// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"

/**
 * A debugging log of what the player presses and what the game makes of it, for when the controls do
 * not seem to correspond. Three kinds of line, so one press can be followed end to end:
 *
 *   [button]  the raw key or mouse button, taken from Slate before any widget or the game sees it,
 *             with what was under the cursor: the game view, or a HUD or menu widget that may keep it
 *   [game]    what the knight made of it: which ability button, and whether the ability started, took
 *             the press as its next move, or refused it and why (the knight's states at that moment)
 *   [menu]    menu keys and the HUD's buttons
 *
 * Local and cosmetic: nothing here replicates or changes gameplay. Console variable Clockworks.LogInput:
 * 0 off, 1 the Output Log and the top-left of the game screen (default), 2 the Output Log only. Every
 * line goes to the Output Log prefixed "Input:", with seconds since play started.
 */
namespace ClockworksInputLog
{
	/** Local machine. True while Clockworks.LogInput is not 0. */
	bool IsEnabled();

	/** Local machine. One line to the Output Log, and to the screen at level 1. */
	void Write(const FString& Line, const FColor& Color = FColor::White);

	/**
	 * Local player controller only. Starts or stops the raw button listener. Counted, so two local
	 * players (split-screen PIE) share one listener and the second stop is the one that removes it.
	 */
	void StartListening();
	void StopListening();
}
