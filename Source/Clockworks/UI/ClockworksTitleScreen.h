// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "ClockworksMenuScreen.h"
#include "ClockworksTitleScreen.generated.h"

class UButton;
class UCanvasPanel;
class UImage;
class UTexture2D;

/**
 * The screen the game opens on: Cradle hanging in space, the logo across it, and three buttons.
 *
 * Built from the original's own art (`rsrc/ui/logon` and `rsrc/world/skybox/cradle`). There is no
 * background picture anywhere in the game's files because the original does not use one - it builds
 * the view out of layers, a sky, a starfield, a galaxy, the planet, its gold arm, a moon and drifting
 * cloud, and this does the same.
 *
 * **There is no login.** The original ships two versions of this screen; the Steam one asks for no
 * account name and no password, only a button, and that is the one rebuilt here. A game with no
 * server has nothing to log in to, and a replica of a credential form is the one piece of this
 * interface worth leaving out.
 *
 * Local, like every screen here. Nothing about it is replicated.
 */
UCLASS()
class UClockworksTitleScreen : public UClockworksMenuScreen
{
	GENERATED_BODY()

public:

	UClockworksTitleScreen(const FObjectInitializer& ObjectInitializer);

protected:

	virtual TSharedRef<SWidget> RebuildWidget() override;

	/**
	 * What sits in front of the sky. The title screen puts its logo and buttons here; the character-select screen
	 * derives from this one so the planet behind it is the same planet, built once.
	 */
	virtual void BuildForeground(UCanvasPanel* Canvas);

	/** Puts one layer of the sky across the whole screen. */
	UImage* AddFullScreenLayer(UCanvasPanel* Canvas, FName Name, UTexture2D* Texture, const FLinearColor& Tint);

	/** Puts one piece of the scene at a place on the screen, sized as a fraction of its height. */
	UImage* AddPiece(UCanvasPanel* Canvas, FName Name, UTexture2D* Texture, const FVector2D& Anchor,
		const FVector2D& Offset, const FVector2D& Size, const FLinearColor& Tint = FLinearColor::White);

	/** One of the three buttons, in the original's shape. */
	UButton* AddTitleButton(UCanvasPanel* Canvas, FName Name, const FText& Label, const FVector2D& Offset,
		const FVector2D& Size, bool bPrimary);

	UFUNCTION()
	void OnLogonClicked();

	UFUNCTION()
	void OnOptionsClicked();

	UFUNCTION()
	void OnQuitClicked();

	/** The pieces of the original's title screen, loaded by name from Content/SK/Logon. */
	UPROPERTY(EditDefaultsOnly, Category = "Title")
	FString ArtPath = TEXT("/Game/SK/Logon/");

	/** Whether the Grey Havens mark is drawn at the foot. */
	UPROPERTY(EditDefaultsOnly, Category = "Title")
	bool bShowFooter = true;
};
