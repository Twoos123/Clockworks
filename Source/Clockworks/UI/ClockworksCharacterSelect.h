// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "ClockworksTitleScreen.h"
#include "ClockworksCharacterSelect.generated.h"

class UButton;
class UCanvasPanel;
class UClockworksProfileSave;

/**
 * "SELECT A CHARACTER": the knights on this machine, over the same planet the title screen shows.
 *
 * In the original this is the account's characters. Here there is no account and no server, so a
 * character is a local save slot - which is the honest offline reading of the same screen, and the
 * shape is identical: a name plate, a portrait, the knight's rank, guild and played time, and a way
 * to delete it.
 *
 * It derives from the title screen so the sky behind it is built once and is the same sky.
 *
 * Local only. When two players are in a game each has chosen their own knight on their own machine.
 */
UCLASS()
class UClockworksCharacterSelect : public UClockworksTitleScreen
{
	GENERATED_BODY()

public:

	UClockworksCharacterSelect(const FObjectInitializer& ObjectInitializer);

	virtual void OpenMenu() override;

protected:

	virtual void BuildForeground(UCanvasPanel* Canvas) override;

	/** Builds the row of cards from the save. Called again whenever a knight is added or deleted. */
	void RefreshCards();

	/** One knight's card, or the empty "New Knight" card at the end of the row. */
	void AddCard(UCanvasPanel* Row, int32 Index, float X);

	UFUNCTION()
	void OnKnightClicked();

	UFUNCTION()
	void OnNewKnightClicked();

	UFUNCTION()
	void OnDeleteClicked();

	UFUNCTION()
	void OnLogOffClicked();

	/** The knights on this machine, loaded when the screen opens. */
	UPROPERTY(Transient)
	TObjectPtr<UClockworksProfileSave> Profile;

	/** The row the cards are built into, emptied and refilled on a change. */
	UPROPERTY(Transient)
	TObjectPtr<UCanvasPanel> CardRow;

	/** Which card each button belongs to, so one handler serves the whole row. */
	UPROPERTY(Transient)
	TMap<TObjectPtr<UButton>, int32> CardIndices;

	UPROPERTY(Transient)
	TMap<TObjectPtr<UButton>, int32> DeleteIndices;

	UPROPERTY(EditDefaultsOnly, Category = "Character Select")
	FVector2D CardSize = FVector2D(232.f, 380.f);

	UPROPERTY(EditDefaultsOnly, Category = "Character Select", meta = (ClampMin = "1"))
	int32 MaxKnights = 4;
};
