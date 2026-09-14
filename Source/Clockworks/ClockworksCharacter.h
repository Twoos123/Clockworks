// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "AbilitySystemInterface.h"
#include "GameplayTagContainer.h"
#include "ClockworksCharacter.generated.h"

class UAnimMontage;
class UCameraComponent;
class UStaticMeshComponent;
class USpringArmComponent;
class UInputAction;
class UGameplayAbility;
class UAbilitySystemComponent;
class UMaterialInterface;
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

	/**
	 * The knight's helmet and face are rigid pieces riding the head bone, not part of the skinned
	 * body (that is how Spiral Knights builds a knight). Blueprint children assign the meshes.
	 */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Components", meta = (AllowPrivateAccess = "true"))
	TObjectPtr<UStaticMeshComponent> HelmetMesh;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Components", meta = (AllowPrivateAccess = "true"))
	TObjectPtr<UStaticMeshComponent> FaceMesh;

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

	/** Drawn over the mesh for a moment when hit. Same material the enemies use reads consistently. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Feedback")
	TObjectPtr<UMaterialInterface> HitFlashMaterial;

	UPROPERTY(EditDefaultsOnly, Category="Combat|Feedback", meta = (ClampMin = "0.0"))
	float HitFlashSeconds = 0.1f;

	/** Optional. A short flinch played on every hit, over whatever the knight was doing. Cosmetic. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Feedback")
	TObjectPtr<UAnimMontage> HurtMontage;

	/** Optional. Played on death; the body stays until the respawn. Needs a DefaultSlot in the Animation Blueprint. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Feedback")
	TObjectPtr<UAnimMontage> DeathMontage;

	/** Seconds between dying and respawning at a PlayerStart with full health. */
	UPROPERTY(EditDefaultsOnly, Category="Combat", meta = (ClampMin = "0.0"))
	float DeathRespawnSeconds = 5.f;

public:

	/** True once the server has declared this knight dead. Valid on every machine (replicated tag). */
	bool IsDead() const;

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

	/** Pushes the MoveSpeed attribute, the attacking slow and the recovery lock into the movement component. */
	void RefreshMaxWalkSpeed();

	void OnMoveSpeedChanged(const FOnAttributeChangeData& Data);

	/** Bound to State.Attacking and State.MovementLocked; both just re-evaluate the walk speed. */
	void OnAttackingTagChanged(const FGameplayTag Tag, int32 NewCount);

	/** Server: something damaged this knight. Only the flash broadcast; the attribute set did the maths. */
	void HandleDamaged(AActor* InstigatorActor, AActor* Causer, float Amount, FVector HitDirection);

	/** Server: health reached zero. Marks the knight dead, stops it, and schedules the respawn. */
	void HandleOutOfHealth();

	/** Server: spawns a fresh knight for the controller and removes this one. */
	void HandleRespawn();

	/** Cosmetic only. Everyone shows the flash; nothing gameplay-relevant happens here. */
	UFUNCTION(NetMulticast, Unreliable)
	void MulticastHitFlash();

	void ClearHitFlash();

	/** Cosmetic only: the death clip on every machine. The server has already decided the death. */
	UFUNCTION(NetMulticast, Reliable)
	void MulticastPlayDeathMontage();

private:

	/** Which component the delegates are bound to, so a re-init doesn't bind twice. */
	TWeakObjectPtr<UAbilitySystemComponent> BoundAbilitySystemComponent;

	FTimerHandle HitFlashTimer;
	FTimerHandle RespawnTimer;

	/** Server-side guard so death handling runs once per life. */
	bool bDeathHandled = false;
};
