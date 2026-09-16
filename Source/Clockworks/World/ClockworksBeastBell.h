// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "AbilitySystemInterface.h"
#include "GameplayTagContainer.h"
#include "ClockworksBeastBell.generated.h"

class UAbilitySystemComponent;
class UAnimSequenceBase;
class UClockworksAttributeSet;
class UGameplayEffect;
class USkeletalMeshComponent;
class USoundBase;

/**
 * The beast bell of the Snarbolax's lair: the one thing in the fight that matters.
 *
 * The Snarbolax cannot be hurt (State.Guarded, kept by AClockworksEnemyCharacter::bGuardedUntilStunned) until a knight
 * strikes the bell. One hit rings it, whatever the damage; every beast within RingRadius is stunned, and the Snarbolax
 * itself takes its own longer stun (the user's decision 2026-09-15: its own 8 s), which is the window to hurt it. Then
 * the bell will not ring again for CooldownSeconds, so the fight is a loop of ring, punish, run.
 *
 * Who runs what. The bell owns an ability system component purely so a knight's sword and bullets can hit it at all;
 * it has no health and takes no damage. The server alone decides that a hit rings it, applies the stuns and starts the
 * cooldown; the clips and sounds are multicast, and the replicated cooldown drives what everyone sees.
 */
UCLASS()
class AClockworksBeastBell : public AActor, public IAbilitySystemInterface
{
	GENERATED_BODY()

public:

	AClockworksBeastBell();

	virtual UAbilitySystemComponent* GetAbilitySystemComponent() const override { return AbilitySystemComponent; }

	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

	virtual void PostInitializeComponents() override;

	virtual void BeginPlay() override;

	/** Whether the bell can be rung right now. Valid on every machine: the cooldown replicates. */
	UFUNCTION(BlueprintPure, Category = "Bell")
	bool IsReady() const { return !bOnCooldown; }

protected:

	/** Server only: a knight hit it. Rings it if it is ready; otherwise only the dull no-damage sound. */
	void HandleDamaged(AActor* InstigatorActor, AActor* Causer, float Amount, FVector HitDirection, float KnockbackMultiplier, float FamilyMultiplier);

	/** Server only: the ring itself. Stuns every beast in range and starts the cooldown. */
	void Ring(AActor* RungBy);

	/** Server only, from the cooldown timer. */
	void EndCooldown();

	/** Server only: one target's stun, at the length its kind gets. */
	void StunTarget(UAbilitySystemComponent* Target, float Seconds) const;

	/** Everyone: the arm swings, the bell sounds, the lights change. Cosmetic only. */
	UFUNCTION(NetMulticast, Reliable)
	void MulticastRing();

	UFUNCTION(NetMulticast, Unreliable)
	void MulticastDullHit();

	UFUNCTION()
	void OnRep_OnCooldown();

	/** This machine: plays a clip on the bell's own mesh. Cosmetic. */
	void PlayClip(UAnimSequenceBase* Clip, float PlayRate = 1.f);

	UPROPERTY(VisibleAnywhere, Category = "Bell")
	TObjectPtr<USkeletalMeshComponent> BellMesh;

	/**
	 * The bell answers to the knight's weapons, which only strike things that carry an ability system component, so it
	 * has one. It holds no health worth speaking of: HandleDamaged reads the hit and then ignores the damage.
	 */
	UPROPERTY(VisibleAnywhere, Category = "Bell")
	TObjectPtr<UAbilitySystemComponent> AbilitySystemComponent;

	UPROPERTY()
	TObjectPtr<UClockworksAttributeSet> AttributeSet;

	/** How far the ring reaches, in cm. The original's circle is 4.5 tiles. */
	UPROPERTY(EditAnywhere, Category = "Bell", meta = (ClampMin = "0.0"))
	float RingRadius = 450.f;

	/** Seconds before it can be rung again. The original's cooldown is 8 s. */
	UPROPERTY(EditAnywhere, Category = "Bell", meta = (ClampMin = "0.0"))
	float CooldownSeconds = 8.f;

	/**
	 * How long an ordinary beast stays stunned. The original applies Stun 2 at power 50, which by its own formula is
	 * about 3.5 s and matches the wiki's 3 to 4 s.
	 */
	UPROPERTY(EditAnywhere, Category = "Bell", meta = (ClampMin = "0.0"))
	float BeastStunSeconds = 3.5f;

	/**
	 * How long the boss stays stunned, and open to damage. Its own Stun 3 rather than the bell's (the user's decision
	 * 2026-09-15), which is the window the whole fight is built around.
	 */
	UPROPERTY(EditAnywhere, Category = "Bell", meta = (ClampMin = "0.0"))
	float BossStunSeconds = 8.f;

	/**
	 * Which monsters the ring stuns. The user's decision 2026-09-15: wolvers and the Snarbolax only, as the wiki says,
	 * so a chromalisk in the lair is not caught by it. A monster matches when its Blueprint's name contains one of
	 * these, which is how the generated monsters are named (BP_Wolver, BP_Snarbolax).
	 */
	UPROPERTY(EditAnywhere, Category = "Bell")
	TArray<FString> StunsMonstersNamed = { TEXT("Wolver"), TEXT("Snarbolax") };

	/** Which of those is the boss, and so takes BossStunSeconds instead. */
	UPROPERTY(EditAnywhere, Category = "Bell")
	FString BossNamed = TEXT("Snarbolax");

	/** The stun the ring applies. Defaults to the game's own status stun effect. */
	UPROPERTY(EditAnywhere, Category = "Bell")
	TSubclassOf<UGameplayEffect> StunEffect;

	/** The arm swinging and the bell ringing (BeastBellactivate_sequence), fitted to nothing: it plays at its own speed. */
	UPROPERTY(EditAnywhere, Category = "Bell|Feedback")
	TObjectPtr<UAnimSequenceBase> RingAnim;

	/** Played when the cooldown ends and the bell stands ready again (BeastBellinactive_extend). */
	UPROPERTY(EditAnywhere, Category = "Bell|Feedback")
	TObjectPtr<UAnimSequenceBase> ReadyAnim;

	UPROPERTY(EditAnywhere, Category = "Bell|Sound")
	TObjectPtr<USoundBase> RingSound;

	/** The flat clank of hitting it while it is still cooling down. */
	UPROPERTY(EditAnywhere, Category = "Bell|Sound")
	TObjectPtr<USoundBase> DullSound;

private:

	/** Replicated so every machine can show whether the bell is ready. Server owns it. */
	UPROPERTY(ReplicatedUsing = OnRep_OnCooldown)
	bool bOnCooldown = false;

	FTimerHandle CooldownTimer;
};
