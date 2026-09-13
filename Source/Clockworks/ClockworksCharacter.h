// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "AbilitySystemInterface.h"
#include "GameplayTagContainer.h"
#include "ClockworksCharacter.generated.h"

class UCameraComponent;
class USpringArmComponent;
class UInputAction;
class UGameplayAbility;
class UAbilitySystemComponent;
struct FInputActionValue;
struct FOnAttributeChangeData;

/**
 *  A controllable top-down perspective character.
 *  Moves with WASD relative to the fixed camera and faces the control yaw,
 *  which AClockworksPlayerController sets from the mouse cursor.
 *  Its ability system component lives on the PlayerState; this class wires the two together.
 */
UCLASS(abstract)
class AClockworksCharacter : public ACharacter, public IAbilitySystemInterface
{
	GENERATED_BODY()

private:

	/** Top down camera */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Components", meta = (AllowPrivateAccess = "true"))
	TObjectPtr<UCameraComponent> TopDownCameraComponent;

	/** Camera boom positioning the camera above the character */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Components", meta = (AllowPrivateAccess = "true"))
	TObjectPtr<USpringArmComponent> CameraBoom;

protected:

	/** WASD movement action (Axis2D: X = right, Y = forward). Assigned in BP_ClockworksCharacter. */
	UPROPERTY(EditDefaultsOnly, Category="Input")
	TObjectPtr<UInputAction> MoveAction;

	/** Left mouse button. */
	UPROPERTY(EditDefaultsOnly, Category="Input")
	TObjectPtr<UInputAction> AttackAction;

	/** Shift + right mouse button (a chorded action in the mapping context). */
	UPROPERTY(EditDefaultsOnly, Category="Input")
	TObjectPtr<UInputAction> DodgeAction;

	/** Granted on the server when this character is first possessed. Swap in Blueprint children to tune. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Abilities")
	TArray<TSubclassOf<UGameplayAbility>> DefaultAbilities;

	UPROPERTY(EditDefaultsOnly, Category="Combat|Attributes", meta = (ClampMin = "1.0"))
	float InitialMaxHealth = 100.f;

	UPROPERTY(EditDefaultsOnly, Category="Combat|Attributes", meta = (ClampMin = "0.0"))
	float InitialHealth = 100.f;

	UPROPERTY(EditDefaultsOnly, Category="Combat|Attributes", meta = (ClampMin = "0.0"))
	float InitialMaxShield = 0.f;

	UPROPERTY(EditDefaultsOnly, Category="Combat|Attributes", meta = (ClampMin = "0.0"))
	float InitialShield = 0.f;

	UPROPERTY(EditDefaultsOnly, Category="Combat|Attributes", meta = (ClampMin = "0.0"))
	float InitialAttackPower = 0.f;

	UPROPERTY(EditDefaultsOnly, Category="Combat|Attributes", meta = (ClampMin = "0.0"))
	float InitialDefensePower = 0.f;

	/** Walk speed in cm/s. Becomes the MoveSpeed attribute, which drives the movement component. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Attributes", meta = (ClampMin = "0.0"))
	float InitialMoveSpeed = 400.f;

	/** Fraction of walk speed kept while swinging. Spiral Knights slows the knight sharply mid-combo. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Feel", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float AttackMoveSpeedMultiplier = 0.25f;

public:

	/** Constructor */
	AClockworksCharacter();

	/** Initialization */
	virtual void BeginPlay() override;

	/** Update */
	virtual void Tick(float DeltaSeconds) override;

	/** Binds input actions. Owning client only. */
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

	/** Server: a controller took this character. */
	virtual void PossessedBy(AController* NewController) override;

	/** Clients: the PlayerState arrived. */
	virtual void OnRep_PlayerState() override;

	/** The PlayerState's component, or null before the PlayerState exists. */
	virtual UAbilitySystemComponent* GetAbilitySystemComponent() const override;

	/** Returns the camera component **/
	UCameraComponent* GetTopDownCameraComponent() const { return TopDownCameraComponent.Get(); }

	/** Returns the Camera Boom component **/
	USpringArmComponent* GetCameraBoom() const { return CameraBoom.Get(); }

protected:

	/** Move input handler. Owning client only. */
	void Move(const FInputActionValue& Value);

	/** Attack and dodge input. Owning client only. */
	void OnAttackInput();
	void OnDodgeInput();

	/** Connects this character to the PlayerState's ability system. Server and clients. */
	void InitAbilitySystem();

	/** Pushes the MoveSpeed attribute and the attacking slow into the movement component. */
	void RefreshMaxWalkSpeed();

	void OnMoveSpeedChanged(const FOnAttributeChangeData& Data);
	void OnAttackingTagChanged(const FGameplayTag Tag, int32 NewCount);

private:

	/** Which component the delegates are bound to, so a re-init doesn't bind twice. */
	TWeakObjectPtr<UAbilitySystemComponent> BoundAbilitySystemComponent;
};
