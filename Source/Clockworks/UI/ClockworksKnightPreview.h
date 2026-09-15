// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "ClockworksKnightPreview.generated.h"

class ACharacter;
class UAnimSequenceBase;
class UPointLightComponent;
class USceneCaptureComponent2D;
class USkeletalMeshComponent;
class UStaticMeshComponent;
class UTextureRenderTarget2D;

/**
 * The knight on the gear screen's Character window: a copy of the player's knight standing far away from the level,
 * filmed by a scene capture into a texture the screen draws, on a turntable the screen's arrows turn.
 *
 * It copies whatever the real knight is wearing (the body mesh and every model piece riding it), so the picture is
 * always exactly what the server has put on, with nothing of its own to keep in step.
 *
 * Runs on: the local machine only. Never replicated; spawned and destroyed by UClockworksGearScreen.
 */
UCLASS(NotBlueprintable, NotPlaceable)
class AClockworksKnightPreview : public AActor
{
	GENERATED_BODY()

public:

	AClockworksKnightPreview();

	/** Dresses the preview the way Source is dressed right now. */
	void CopyLook(const ACharacter* Source);

	/** Turns the knight on its turntable. */
	void AddTurn(float Degrees);

	/** Starts or stops filming; stopped while the screen is closed so it costs nothing. */
	void SetFilming(bool bFilming);

	UTextureRenderTarget2D* GetRenderTarget() const { return RenderTarget; }

	/** The picture's size in pixels. */
	static constexpr int32 PictureWidth = 480;
	static constexpr int32 PictureHeight = 600;

protected:

	virtual void BeginPlay() override;

	UPROPERTY(VisibleAnywhere, Category = "Preview")
	TObjectPtr<USceneComponent> Turntable;

	UPROPERTY(VisibleAnywhere, Category = "Preview")
	TObjectPtr<USkeletalMeshComponent> Body;

	UPROPERTY(VisibleAnywhere, Category = "Preview")
	TObjectPtr<USceneCaptureComponent2D> Capture;

	UPROPERTY(VisibleAnywhere, Category = "Preview")
	TObjectPtr<UPointLightComponent> KeyLight;

	/** The idle loop the knight stands in (the original's idle). */
	UPROPERTY(EditDefaultsOnly, Category = "Preview")
	TSoftObjectPtr<UAnimSequenceBase> IdleAnim;

	/**
	 * Lit like the game, or flat colours. Flat by default: it is always readable and has no lighting to tune, and the
	 * lit picture has not been looked at yet.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Preview")
	bool bLit = false;

private:

	UPROPERTY(Transient)
	TArray<TObjectPtr<UStaticMeshComponent>> Pieces;

	UPROPERTY(Transient)
	TObjectPtr<UTextureRenderTarget2D> RenderTarget;
};
