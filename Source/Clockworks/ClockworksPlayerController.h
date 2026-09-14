// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
//#include "Templates/SubclassOf.h"
#include "GameFramework/PlayerController.h"
#include "ClockworksPlayerController.generated.h"

class UInputMappingContext;

DECLARE_LOG_CATEGORY_EXTERN(LogTemplateCharacter, Log, All);

/**
 *  Player controller for a top-down perspective game.
 *  Registers the input mapping context and aims the possessed character at the
 *  mouse cursor by setting the control yaw. Movement input lives on the character.
 */
UCLASS(abstract)
class AClockworksPlayerController : public APlayerController
{
	GENERATED_BODY()

protected:

	/** MappingContext */
	UPROPERTY(EditAnywhere, Category="Input")
	TObjectPtr<UInputMappingContext> DefaultMappingContext;

public:

	/** Constructor */
	AClockworksPlayerController();

protected:

	/** Initialize input bindings */
	virtual void SetupInputComponent() override;

	/** Per-frame local player update. Owning client only. */
	virtual void PlayerTick(float DeltaTime) override;

	/** Points the control yaw at the mouse cursor projected onto the floor plane. Owning client only. */
	void UpdateAimFromCursor();

	/**
	 * Measures the real view frustum (window shape, FOV rules) and tells the server, so enemy aggro
	 * can test "is it on my screen" against what this player actually sees. Owning client only.
	 */
	void ReportViewExtents();

	/** Intent from the owning client: the tangents of its half view angles. Server stores them. */
	UFUNCTION(Server, Unreliable)
	void ServerSetViewExtents(float TanHalfX, float TanHalfY);

public:

	/** Server: the owning client's view half-angle tangents, or false until the client has reported. */
	bool GetViewExtents(float& OutTanHalfX, float& OutTanHalfY) const;

private:

	/** Set by ServerSetViewExtents; also set directly on a listen host. */
	float ViewTanHalfX = 0.f;
	float ViewTanHalfY = 0.f;

	/** Last values sent, so the client only talks when the window changes. */
	float SentTanHalfX = 0.f;
	float SentTanHalfY = 0.f;
	float ViewReportCooldown = 0.f;
};
