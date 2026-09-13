// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksCharacter.h"
#include "UObject/ConstructorHelpers.h"
#include "Camera/CameraComponent.h"
#include "Components/DecalComponent.h"
#include "Components/CapsuleComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/SpringArmComponent.h"
#include "Materials/Material.h"
#include "Engine/World.h"
#include "EnhancedInputComponent.h"
#include "InputActionValue.h"
#include "Clockworks.h"

// Runs on: all machines (class default object and every spawned instance, server and clients).
AClockworksCharacter::AClockworksCharacter()
{
	// Set size for player capsule
	GetCapsuleComponent()->InitCapsuleSize(42.f, 96.0f);

	// Face the control yaw. The owning client's controller sets it from the mouse cursor;
	// the server receives it inside the CharacterMovementComponent's move packet, applies it
	// to its own copy of the character, and replicates the resulting rotation to other clients.
	bUseControllerRotationPitch = false;
	bUseControllerRotationYaw = true;
	bUseControllerRotationRoll = false;

	// Configure character movement
	GetCharacterMovement()->bOrientRotationToMovement = false; // facing comes from the cursor, not from velocity
	GetCharacterMovement()->RotationRate = FRotator(0.f, 640.f, 0.f); // unused while facing is instant; the knob for smoothed turning later
	GetCharacterMovement()->bConstrainToPlane = true;
	GetCharacterMovement()->bSnapToPlaneAtStart = true;
	GetCharacterMovement()->MaxWalkSpeed = 400.f;

	// Create the camera boom component. Fixed world rotation: it inherits nothing from the character.
	CameraBoom = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom"));

	CameraBoom->SetupAttachment(RootComponent);
	CameraBoom->SetUsingAbsoluteRotation(true);
	CameraBoom->bInheritPitch = false;
	CameraBoom->bInheritYaw = false;
	CameraBoom->bInheritRoll = false;
	CameraBoom->TargetArmLength = 1500.f;
	CameraBoom->SetRelativeRotation(FRotator(-45.f, 0.f, 0.f));
	CameraBoom->bDoCollisionTest = false;

	// Create the camera component
	TopDownCameraComponent = CreateDefaultSubobject<UCameraComponent>(TEXT("TopDownCamera"));

	TopDownCameraComponent->SetupAttachment(CameraBoom, USpringArmComponent::SocketName);
	TopDownCameraComponent->bUsePawnControlRotation = false;

	// Activate ticking in order to update the cursor every frame.
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = true;
}

void AClockworksCharacter::BeginPlay()
{
	Super::BeginPlay();

	// stub
}

void AClockworksCharacter::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);

	// stub
}

// Runs on: owning client only. The engine calls this only for a pawn possessed by a local
// player controller, so it never runs on the server for the remote player's character.
void AClockworksCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	UEnhancedInputComponent* EnhancedInputComponent = Cast<UEnhancedInputComponent>(PlayerInputComponent);
	if (!EnhancedInputComponent)
	{
		UE_LOG(LogClockworks, Error, TEXT("'%s' Failed to find an Enhanced Input Component! This project is built to use the Enhanced Input system."), *GetNameSafe(this));
		return;
	}

	if (!MoveAction)
	{
		UE_LOG(LogClockworks, Warning, TEXT("'%s' has no MoveAction assigned. Set it under Input in BP_TopDownCharacter's Class Defaults."), *GetNameSafe(this));
		return;
	}

	EnhancedInputComponent->BindAction(MoveAction, ETriggerEvent::Triggered, this, &AClockworksCharacter::Move);
}

// Runs on: owning client only. AddMovementInput is consumed by the CharacterMovementComponent,
// which predicts the move locally and sends it to the server as acceleration inside the move
// packet. The server performs the authoritative move and corrects the client if they disagree.
void AClockworksCharacter::Move(const FInputActionValue& Value)
{
	const FVector2D Input = Value.Get<FVector2D>();

	// "Forward" is the camera's yaw projected onto the ground, so WASD is relative to the
	// screen regardless of which way the character faces. Read the boom rather than
	// hard-coding zero so a retuned camera yaw stays correct.
	const float CameraYaw = CameraBoom->GetComponentRotation().Yaw;
	const FRotationMatrix CameraBasis(FRotator(0.f, CameraYaw, 0.f));

	AddMovementInput(CameraBasis.GetUnitAxis(EAxis::X), Input.Y); // W / S
	AddMovementInput(CameraBasis.GetUnitAxis(EAxis::Y), Input.X); // D / A
}
