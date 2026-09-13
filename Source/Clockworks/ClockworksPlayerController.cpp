// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksPlayerController.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/Character.h"
#include "Components/CapsuleComponent.h"
#include "ClockworksCharacter.h"
#include "Engine/World.h"
#include "EnhancedInputSubsystems.h"
#include "Engine/LocalPlayer.h"
#include "Clockworks.h"

// Runs on: all machines (class default object and every spawned instance).
AClockworksPlayerController::AClockworksPlayerController()
{
	// configure the controller
	bShowMouseCursor = true;
	DefaultMouseCursor = EMouseCursor::Default;
}

// Runs on: owning client only (guarded by IsLocalPlayerController). The server's copy of a
// remote player's controller has no local player and does nothing here.
void AClockworksPlayerController::SetupInputComponent()
{
	// set up gameplay key bindings
	Super::SetupInputComponent();

	// Only set up input on local player controllers
	if (IsLocalPlayerController())
	{
		// Add Input Mapping Context. Action bindings live on AClockworksCharacter.
		if (UEnhancedInputLocalPlayerSubsystem* Subsystem = ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(GetLocalPlayer()))
		{
			Subsystem->AddMappingContext(DefaultMappingContext, 0);
		}
	}
}

// Runs on: owning client only. The engine calls PlayerTick only on controllers that own a
// PlayerInput, i.e. the local player's controller (the listen-server host included). The
// server's copy of a remote player's controller never runs this; it gets that player's control
// rotation from the CharacterMovementComponent's move packet instead.
void AClockworksPlayerController::PlayerTick(float DeltaTime)
{
	// Aim before Super so this frame's UpdateRotation faces the pawn and the movement
	// component records the new yaw in the move it sends to the server.
	UpdateAimFromCursor();

	Super::PlayerTick(DeltaTime);
}

// Runs on: owning client only (called from PlayerTick). Sets control rotation only. The
// character faces it via bUseControllerRotationYaw, and the engine replicates the result:
// control rotation travels in the move packet, the server re-applies it to its own copy, and
// the resulting actor rotation reaches other clients through ReplicatedMovement. Nothing here
// is authoritative and the cursor position never leaves this machine.
void AClockworksPlayerController::UpdateAimFromCursor()
{
	ACharacter* ControlledCharacter = Cast<ACharacter>(GetPawn());
	if (!ControlledCharacter)
	{
		return;
	}

	// Ray from the camera through the mouse cursor. Fails when the cursor is outside the
	// viewport; keep the last yaw in that case.
	FVector RayOrigin;
	FVector RayDirection;
	if (!DeprojectMousePositionToWorld(RayOrigin, RayDirection))
	{
		return;
	}

	// A ray parallel to the floor never reaches it.
	if (FMath::IsNearlyZero(RayDirection.Z))
	{
		return;
	}

	// Intersect with a horizontal plane at the character's feet, so the yaw matches where the
	// cursor visually sits on the floor. A math plane rather than a physics trace: the cursor
	// passing over a tall object must not skew the aim.
	const FVector CharacterLocation = ControlledCharacter->GetActorLocation();
	const float FeetZ = CharacterLocation.Z - ControlledCharacter->GetCapsuleComponent()->GetScaledCapsuleHalfHeight();
	const FPlane FloorPlane(FVector(0.f, 0.f, FeetZ), FVector::UpVector);
	const FVector CursorOnFloor = FMath::RayPlaneIntersection(RayOrigin, RayDirection, FloorPlane);

	FVector ToCursor = CursorOnFloor - CharacterLocation;
	ToCursor.Z = 0.f;

	// Cursor on top of the character: no meaningful direction, keep the last yaw.
	if (ToCursor.SizeSquared() < 1.f)
	{
		return;
	}

	SetControlRotation(FRotator(0.f, ToCursor.Rotation().Yaw, 0.f));
}
