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
};
