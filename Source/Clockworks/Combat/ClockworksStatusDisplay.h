// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "GameplayTagContainer.h"
#include "ClockworksStatusDisplay.generated.h"

class UAbilitySystemComponent;
class UAudioComponent;
class UMaterialInstanceDynamic;
class UMaterialInterface;
class USoundBase;
class UStaticMeshComponent;

/**
 * How one status looks and sounds. One row per status, set on the component in a Blueprint.
 */
USTRUCT(BlueprintType)
struct FClockworksStatusVisual
{
	GENERATED_BODY()

	/** Which status this row describes, e.g. State.Status.Fire. */
	UPROPERTY(EditDefaultsOnly, Category = "Status", meta = (Categories = "State.Status"))
	FGameplayTag StatusTag;

	/** The aura colour while it is on. Spiral Knights colours every status distinctly on purpose. */
	UPROPERTY(EditDefaultsOnly, Category = "Status")
	FLinearColor AuraColor = FLinearColor::White;

	/** Played once, the moment it lands. This is the cue the player actually reacts to. */
	UPROPERTY(EditDefaultsOnly, Category = "Status")
	TObjectPtr<USoundBase> ApplySound;

	/** Optional, looped for as long as it lasts: a fire crackle, a shock hum. */
	UPROPERTY(EditDefaultsOnly, Category = "Status")
	TObjectPtr<USoundBase> LoopSound;

	/**
	 * Which status wins when a target has more than one. Higher shows. Fire and Freeze outrank
	 * Poison because they are the ones you have to act on immediately.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Status")
	int32 Priority = 0;
};

/**
 * Shows and sounds whatever statuses its owner is under.
 *
 * A component rather than code on the character, because the knight and every monster need exactly
 * the same behaviour and neither should have to know about the other. Anything with an ability
 * system component can carry one.
 *
 * Entirely cosmetic, and entirely local. Status tags replicate from the server as part of the
 * ability system's own state, so every machine sees the same tags arrive and paints its own aura
 * off them; nothing extra goes over the wire for this.
 *
 * The aura is a translucent shell around the owner rather than an overlay material on its mesh,
 * because the overlay is already spoken for by the hit flash, the attack telegraph and the stun
 * pose, and a status has to be able to show at the same time as any of those.
 */
UCLASS(ClassGroup = (Clockworks), meta = (BlueprintSpawnableComponent))
class UClockworksStatusDisplay : public UActorComponent
{
	GENERATED_BODY()

public:

	UClockworksStatusDisplay();

	/** Finds the owner's ability system component and starts listening for every configured status. */
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

protected:

	/** A status tag came or went on this machine. */
	void OnStatusTagChanged(const FGameplayTag Tag, int32 NewCount);

	/** Repaints the aura and restarts the loop for whichever status currently outranks the rest. */
	void Refresh();

	/** The row for a tag, or null. */
	const FClockworksStatusVisual* FindVisual(const FGameplayTag& Tag) const;

	/**
	 * One row per status. Left empty the component does nothing, which is the right default for
	 * anything that should not show statuses at all.
	 */
	UPROPERTY(EditAnywhere, Category = "Status")
	TArray<FClockworksStatusVisual> StatusVisuals;

	/** Wants an unlit, translucent, two-sided material with a colour and an opacity parameter. */
	UPROPERTY(EditAnywhere, Category = "Status|Aura")
	TObjectPtr<UMaterialInterface> AuraMaterial;

	UPROPERTY(EditAnywhere, Category = "Status|Aura")
	FName AuraColorParameterName = TEXT("BubbleColor");

	UPROPERTY(EditAnywhere, Category = "Status|Aura")
	FName AuraOpacityParameterName = TEXT("Opacity");

	UPROPERTY(EditAnywhere, Category = "Status|Aura")
	FName AuraBrightnessParameterName = TEXT("Brightness");

	/** Radius of the shell in cm. A little wider than the body it is wrapped around. */
	UPROPERTY(EditAnywhere, Category = "Status|Aura", meta = (ClampMin = "1.0"))
	float AuraRadius = 62.f;

	/** Height above the owner's origin, in cm. */
	UPROPERTY(EditAnywhere, Category = "Status|Aura")
	float AuraHeight = 0.f;

	UPROPERTY(EditAnywhere, Category = "Status|Aura", meta = (ClampMin = "0.0"))
	float AuraOpacity = 0.42f;

	UPROPERTY(EditAnywhere, Category = "Status|Aura", meta = (ClampMin = "0.0"))
	float AuraBrightness = 3.f;

private:

	/** Made once, at BeginPlay, and attached to the owner's root. */
	UPROPERTY(Transient)
	TObjectPtr<UStaticMeshComponent> AuraMesh;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> AuraMaterialInstance;

	/** The looped sound for whichever status is currently showing. */
	UPROPERTY(Transient)
	TObjectPtr<UAudioComponent> LoopAudio;

	TWeakObjectPtr<UAbilitySystemComponent> BoundAbilitySystemComponent;

	/** Which status the aura is currently painted for, so a repaint that changes nothing does nothing. */
	FGameplayTag ShownStatus;

	TArray<FDelegateHandle> TagHandles;
};
