// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "GameplayEffectTypes.h"
#include "GameplayTagContainer.h"
#include "ClockworksBomb.generated.h"

class AClockworksHitSpark;
class AClockworksProjectile;
class UAbilitySystemComponent;
class UClockworksWeaponDefinition;
class UMaterialInstanceDynamic;
class UGameplayEffect;
class UMaterialInterface;
class USoundBase;
class UStaticMeshComponent;

/**
 * A bomb on the ground, counting down.
 *
 * Spiral Knights bombs are not thrown: the knight arms one by holding the button, then drops it at
 * their feet on release, and it sits there for its fuse before going off in a radius. That is what
 * makes the class different from the sword and the gun — you have to place yourself in relation to
 * where the blast is going to be, and then leave.
 *
 * Who runs what. The server spawns this actor, owns the fuse timer and is the only machine that
 * ever runs the overlap or applies damage. The actor replicates, so every machine has one sitting
 * where the server put it; the pulse that reads as a countdown is driven locally off replicated
 * state, and the blast itself is a multicast of nothing but sound and light. What it looks like is
 * the weapon that dropped it, which also replicates, so every machine paints its own.
 */
UCLASS()
class AClockworksBomb : public AActor
{
	GENERATED_BODY()

public:

	AClockworksBomb();

	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

	/** Server: starts the fuse. Everyone: starts the countdown pulse. */
	virtual void BeginPlay() override;

	virtual void Tick(float DeltaSeconds) override;

	/**
	 * Server only. Hands the bomb everything it needs to do damage in the thrower's name: whose it
	 * is, how hard it hits, how far, how much it shoves, and which weapon dropped it, so the thing on
	 * the floor is that weapon's model rather than always a Proto Bomb. Call immediately after
	 * spawning, before the fuse matters.
	 */
	void InitBomb(UAbilitySystemComponent* InOwnerAbilitySystemComponent, float InDamage, float InRadius, float InKnockbackMultiplier, const FGameplayTag& InDamageType, const UClockworksWeaponDefinition* InWeapon = nullptr, float InFuseSeconds = 0.f);

	/**
	 * Server only, before InitBomb. Makes this a bare blast: no body and no landing sound, only the warning
	 * ring and the blast. A sword's slam aftershock is one; bSilent also mutes the blast, for a combo
	 * sword's near-instant ghost swings, which the swing's own sound already covers.
	 */
	void HideBody(bool bSilent);

	/**
	 * Server only, with InitBomb. The status the blast inflicts: the hit's own or the weapon's. A null
	 * effect clears the Blueprint's default, for a weapon whose blast inflicts nothing.
	 */
	void InitBombStatus(TSubclassOf<UGameplayEffect> InStatusEffect, float InChance, float InSeconds, float InTickDamage);

	/** Server only, with InitBomb: a second damage type the blast is split with and that type's share (a dual-type weapon's). */
	void InitBombSecondType(const FGameplayTag& InSecondType, float InShare)
	{
		SecondDamageType = InSecondType;
		SecondDamageShare = FMath::Clamp(InShare, 0.f, 1.f);
	}

protected:

	/** Server only. The fuse ran out: overlap, damage everything hostile in range, then the blast. */
	void Detonate();

	/** Cosmetic only, on every machine: the flash, the sound, and hiding the body. */
	UFUNCTION(NetMulticast, Reliable)
	void MulticastBlast();

	UPROPERTY(VisibleAnywhere, Category = "Bomb")
	TObjectPtr<UStaticMeshComponent> BombMesh;

	/** Grows and brightens as the fuse runs down, which is the only warning anyone gets. */
	UPROPERTY(VisibleAnywhere, Category = "Bomb")
	TObjectPtr<UStaticMeshComponent> BlastIndicatorMesh;

	/**
	 * Seconds between being dropped and going off. The Proto Bomb's own Fuse is 1500 ms, which is
	 * long enough to walk out of your own blast and not much longer. That gap is the whole skill
	 * of the class.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb", meta = (ClampMin = "0.1"))
	float FuseSeconds = 1.5f;

	/** Damage at the centre. Set by the ability from the weapon's numbers; this is only the fallback. */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb", meta = (ClampMin = "0.0"))
	float BlastDamage = 45.f;

	/** Blast radius in cm. The Proto Bomb's own Radius is 2.5 tiles, and a tile is 100 cm here. */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb", meta = (ClampMin = "0.0"))
	float BlastRadius = 250.f;

	/**
	 * Which damage type the blast deals. Set by the ability from the weapon's own type; this is the
	 * fallback for a bomb placed by hand in a level.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb", meta = (Categories = "Data.Damage"))
	FGameplayTag DamageType;

	/**
	 * The status the blast inflicts. The original's Proto Bomb carries a Stun at moderate power and
	 * high chance, which is most of why a bomb is worth its two-second commitment.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Status")
	TSubclassOf<UGameplayEffect> StatusEffect;

	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Status", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float StatusChance = 0.f;

	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Status", meta = (ClampMin = "0.0"))
	float StatusSeconds = 2.f;

	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Status", meta = (ClampMin = "0.0"))
	float StatusTickDamage = 4.f;

	/** Bombs shove hard; that is how they are used to control a room. */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb", meta = (ClampMin = "0.0"))
	float KnockbackMultiplier = 2.f;

	/**
	 * Whether the blast can hurt the knight who dropped it. Spiral Knights bombs do not hurt their
	 * owner, which is what lets you stand at the edge of your own blast.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb")
	bool bDamagesOwner = false;

	/** The ring drawn on the floor showing exactly where the blast will reach. */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Feedback")
	TObjectPtr<UMaterialInterface> IndicatorMaterial;

	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Feedback")
	FLinearColor IndicatorColor = FLinearColor(1.f, 0.35f, 0.05f, 1.f);

	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Feedback")
	FName IndicatorColorParameterName = TEXT("BubbleColor");

	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Feedback")
	FName IndicatorOpacityParameterName = TEXT("Opacity");

	/** How many times the indicator pulses over the fuse. More reads as more urgent. */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Feedback", meta = (ClampMin = "1.0"))
	float IndicatorPulses = 5.f;

	/** The flash at the moment it goes off. Reuses the hit spark, scaled to the blast. */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Feedback")
	TSubclassOf<AClockworksHitSpark> BlastSparkClass;

	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Sound")
	TObjectPtr<USoundBase> ArmSound;

	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Sound")
	TObjectPtr<USoundBase> BlastSound;

	/**
	 * What a bomb's blast breaks into, when its weapon's data says it does (a Shard Bomb's shards, a Vaporizer's
	 * cloud, a Graviton's vortex): the bullet actor those are, painted per bullet by the weapon's sub-bullet looks.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Children")
	TSubclassOf<AClockworksProjectile> ChildBulletClass;

	/** How far above the floor the children start, so a shard leaving the blast does not strike the floor. */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb|Children", meta = (ClampMin = "0.0"))
	float ChildBulletHeightCm = 60.f;

	/** Seconds the body hangs around after the blast, so the flash is not cut off with it. */
	UPROPERTY(EditDefaultsOnly, Category = "Bomb", meta = (ClampMin = "0.0"))
	float DestroyDelaySeconds = 1.f;

private:

	/** Set by the server the moment it goes off, so a client that joins late does not see a live bomb. */
	UPROPERTY(ReplicatedUsing = OnRep_Detonated)
	bool bDetonated = false;

	UFUNCTION()
	void OnRep_Detonated();

	/**
	 * The weapon that dropped this bomb. Set once by the server; a data asset, so it replicates as a
	 * path. Only its model and skin are read here: the damage numbers were already handed over.
	 */
	UPROPERTY(ReplicatedUsing = OnRep_SourceWeapon)
	TObjectPtr<UClockworksWeaponDefinition> SourceWeapon;

	UFUNCTION()
	void OnRep_SourceWeapon();

	/** Every machine: shows the source weapon's model and skin. Keeps the Blueprint's body without one. */
	void ApplyAppearance();

	/**
	 * Every machine, one tick after spawning so the server has handed over the weapon by then: the
	 * weapon's own landing sound, or ArmSound for a bomb without one.
	 */
	void PlayDropSound();

	/** 0 an ordinary bomb, 1 a bare blast, 2 a silent bare blast. Set once by the server (HideBody). */
	UPROPERTY(ReplicatedUsing = OnRep_BodyMode)
	uint8 BodyMode = 0;

	UFUNCTION()
	void OnRep_BodyMode();

	/** Every machine: hides the body of a bare blast. Cosmetic. */
	void ApplyBodyMode();

	/** The second damage type the blast is split with (InitBombSecondType), and its share. Server only. */
	FGameplayTag SecondDamageType;
	float SecondDamageShare = 0.f;

	/** Whose bomb this is, for faction checks and for crediting the damage. Server only. */
	TWeakObjectPtr<UAbilitySystemComponent> OwnerAbilitySystemComponent;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> IndicatorMaterialInstance;

	/** The source weapon's other model pieces, riding BombMesh. */
	UPROPERTY(Transient)
	TArray<TObjectPtr<UStaticMeshComponent>> BombExtraMeshes;

	FTimerHandle FuseTimer;
	float FuseElapsed = 0.f;
};
