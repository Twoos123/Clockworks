// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/SaveGame.h"
#include "ClockworksProfileSave.generated.h"

/**
 * One knight on the character-select screen.
 *
 * The original shows a name, a rank, a guild and how long the knight has been played, and this is
 * the offline version of exactly that. Rank and guild are here because the screen shows them, not
 * because either system exists yet.
 */
USTRUCT(BlueprintType)
struct FClockworksKnightRecord
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadWrite, Category = "Knight")
	FString Name;

	/** The rank the original prints under the portrait: Recruit, Apprentice, Vanguard. */
	UPROPERTY(BlueprintReadWrite, Category = "Knight")
	FString Rank = TEXT("Recruit");

	UPROPERTY(BlueprintReadWrite, Category = "Knight")
	FString Guild;

	/** How long this knight has been played, in seconds. The screen prints it as hh:mm:ss. */
	UPROPERTY(BlueprintReadWrite, Category = "Knight")
	double PlayedSeconds = 0.0;

	UPROPERTY(BlueprintReadWrite, Category = "Knight")
	FDateTime Created;

	/** The deepest floor this knight has reached, which is the only progress the game keeps so far. */
	UPROPERTY(BlueprintReadWrite, Category = "Knight")
	int32 DeepestDepth = 0;
};

/**
 * The knights on this machine.
 *
 * There are no accounts and no server: a "character" is a local save slot, which is the honest
 * offline reading of the original's character-select screen. Written to a single save called
 * `Knights`.
 *
 * Runs on: the local machine only. Nothing here is replicated - when two players are in a game, each
 * has chosen their own knight on their own machine.
 */
UCLASS()
class UClockworksProfileSave : public USaveGame
{
	GENERATED_BODY()

public:

	/** The name of the save this is written to. */
	static const TCHAR* SlotName() { return TEXT("Knights"); }

	/** Loads the knights on this machine, or an empty list the first time. Never returns null. */
	UFUNCTION(BlueprintCallable, Category = "Profile")
	static UClockworksProfileSave* Load();

	/** Writes it back. */
	UFUNCTION(BlueprintCallable, Category = "Profile")
	void Save() const;

	/** Adds a knight and saves. Returns its index. */
	UFUNCTION(BlueprintCallable, Category = "Profile")
	int32 AddKnight(const FString& Name);

	/** Removes one and saves. */
	UFUNCTION(BlueprintCallable, Category = "Profile")
	void RemoveKnight(int32 Index);

	/** "17:03:28" - how the original prints a knight's played time. */
	UFUNCTION(BlueprintPure, Category = "Profile")
	static FString FormatPlayed(double Seconds);

	UPROPERTY(BlueprintReadWrite, Category = "Profile")
	TArray<FClockworksKnightRecord> Knights;

	/** Which one was last played, so the game can offer it first. */
	UPROPERTY(BlueprintReadWrite, Category = "Profile")
	int32 LastPlayed = 0;
};
