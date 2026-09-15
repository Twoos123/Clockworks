// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "GameplayTagContainer.h"
#include "ClockworksAttackProfile.h"

class UGameplayEffect;
#include "ClockworksProjectile.generated.h"

class AClockworksHitSpark;
class APawn;
class UAbilitySystemComponent;
class UClockworksWeaponDefinition;
class UMaterialInstanceDynamic;
class UMaterialInterface;
class UProjectileMovementComponent;
class USphereComponent;
class UStaticMeshComponent;

/**
 * Who a bullet's children fight for and with what, handed down from whatever spawned them: a bullet
 * bursting, or a bomb's blast. Server only; never stored.
 */
struct FClockworksBulletLineage
{
	/** The projectile class the children are. */
	UClass* Class = nullptr;
	AActor* Owner = nullptr;
	APawn* Instigator = nullptr;
	UAbilitySystemComponent* Source = nullptr;
	/** Whose SubBullets the children name. */
	const UClockworksWeaponDefinition* Weapon = nullptr;
	/** The spawner's damage; each child's is this times its own multiplier. */
	float Damage = 0.f;
	float KnockbackMultiplier = 1.f;
	FGameplayTag DamageType;
	/** The second damage type the spawner's damage is split with, and its share; invalid for one type. */
	FGameplayTag SecondDamageType;
	float SecondDamageShare = 0.f;
	TSubclassOf<UGameplayEffect> StatusEffect;
	float StatusChance = 0.f;
	float StatusSeconds = 0.f;
	float StatusTickDamage = 0.f;
	/** How many bursts deep the spawner is. Children past a cap are not made, so nothing can multiply forever. */
	int32 Generation = 0;
	/** The monster the spawner just struck, which its children leave alone. */
	AActor* IgnoredActor = nullptr;
};

/**
 * A shot fired by a ranged attack. Spawned by the server only; its movement replicates to clients
 * (straight line, no gravity), so everyone sees the same bolt at the same place. The server alone
 * decides hits: on overlapping a pawn from another faction it applies the damage effect through the
 * shooter's ability system component and destroys itself. Walls destroy it too.
 *
 * The bolt is also the first thing the player can dodge by reading its line, which is the point.
 * The knight's handgun fires the same actor the other way round; the faction tags sort out who
 * is hurt by whom.
 *
 * Look. A weapon can hand the bolt its own look (InitProjectileLook): the colours, sizes and pulse of
 * the original's bullet particles, a streak, a spinning model, a muzzle flash and an impact. The look
 * replicates once with the bolt and every machine animates its own copy; nothing about it is gameplay.
 */
UCLASS(abstract)
class AClockworksProjectile : public AActor
{
	GENERATED_BODY()

public:

	AClockworksProjectile();

	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

	/**
	 * Server: called by the ability right after spawning. Sets who shot it, how hard and how fast.
	 * KnockbackMultiplier scales the target's own knockback (1 = a normal hit). MaxRange, when
	 * positive, replaces LifeSeconds with the time it takes to fly that far, so a gun's reach is a
	 * distance in cm rather than a duration.
	 */
	void InitProjectile(UAbilitySystemComponent* InSourceAbilitySystemComponent, float InDamage, const FVector& Direction, float Speed, float InKnockbackMultiplier = 1.f, float MaxRange = 0.f, const FGameplayTag& InDamageType = FGameplayTag());

	/**
	 * Server only, right after InitProjectile. The weapon's own look for this bolt, and its hit radius
	 * in cm (zero keeps the Blueprint's). The look reaches clients with the bolt itself.
	 */
	void InitProjectileLook(const FClockworksBulletLook& InLook, float InCollisionRadiusCm);

	/**
	 * Server only, right after InitProjectile, in place of InitProjectileLook: the weapon's whole bullet. Its
	 * look, and what it does besides flying into a monster: passing through, sticking, pulsing while it
	 * lives and bursting when it ends, into the damage regions and child bullets its data names. InWeapon
	 * is whose SubBullets the children come from; InGeneration how many bursts deep this bullet is.
	 */
	void InitProjectileSpec(const FClockworksBulletSpec& InSpec, const UClockworksWeaponDefinition* InWeapon, int32 InGeneration = 0);

	/**
	 * Server only. Spawns a burst's child bullets at Location, heading along Heading (mirrored off
	 * SurfaceNormal for a ricochet, when there is one). Used by bullets bursting and by bombs going off.
	 */
	static void SpawnChildren(UWorld* World, const FClockworksBulletLineage& Lineage, const TArray<FClockworksBulletChild>& Children,
		const FVector& Location, const FVector& Heading, const FVector& SurfaceNormal);

	/** Grows the bolt and its damage over its flight, when the weapon asked for that, and animates its look. */
	virtual void Tick(float DeltaSeconds) override;

protected:

	/** Which damage type this bolt carries. Set by whatever fired it. */
	UPROPERTY(EditDefaultsOnly, Category = "Projectile", meta = (Categories = "Data.Damage"))
	FGameplayTag DamageType;

	/** The status this bolt can inflict, and how often. Set by whatever fired it. */
	UPROPERTY(EditDefaultsOnly, Category = "Projectile|Status")
	TSubclassOf<UGameplayEffect> StatusEffect;

	UPROPERTY(EditDefaultsOnly, Category = "Projectile|Status", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float StatusChance = 0.f;

	UPROPERTY(EditDefaultsOnly, Category = "Projectile|Status", meta = (ClampMin = "0.0"))
	float StatusSeconds = 4.f;

	/**
	 * How many walls this bolt bounces off before it dies. The Alchemer line's whole identity: its
	 * bullets ricochet twice, which turns a corridor into a weapon and is the reason to carry one.
	 * Zero is an ordinary bolt that dies on the first wall.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Projectile|Behaviour", meta = (ClampMin = "0"))
	int32 MaxBounces = 0;

	/**
	 * How much of its damage a bolt keeps after each bounce. Below one, a ricochet is worth less
	 * than the shot that made it, which stops a corridor being a free multiplier.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Projectile|Behaviour", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float BounceDamageRetained = 0.8f;

	/**
	 * How much bigger and harder this bolt gets over its flight. The Pulsar line: slow pellets that
	 * swell halfway and hit hardest at the far end, so the gun rewards backing off rather than
	 * closing. One leaves it alone throughout.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Projectile|Behaviour", meta = (ClampMin = "1.0"))
	float MaxGrowthScale = 1.f;

	/** Damage at maximum range, as a multiple of the damage it left the muzzle with. */
	UPROPERTY(EditDefaultsOnly, Category = "Projectile|Behaviour", meta = (ClampMin = "1.0"))
	float MaxGrowthDamage = 1.f;

	UPROPERTY(EditDefaultsOnly, Category = "Projectile|Status", meta = (ClampMin = "0.0"))
	float StatusTickDamage = 4.f;

public:

	/** Server only. Hands the bolt the status its weapon inflicts. Call with InitProjectile. */
	void InitProjectileStatus(TSubclassOf<UGameplayEffect> InStatusEffect, float InChance, float InSeconds, float InTickDamage);

	/** Server only, right after InitProjectile: the hit's damage split by type (a monster bolt's original numbers). Replaces the single type. */
	void InitProjectileDamageParts(const float Parts[4])
	{
		for (int32 Kind = 0; Kind < 4; ++Kind)
		{
			DamageParts[Kind] = Parts[Kind];
		}
		bHasDamageParts = true;
	}

	/**
	 * Server only, right after InitProjectile: a second damage type this bolt's damage is split with and that type's
	 * share (a dual-type weapon's shot). Its bursts, children and orbiting pellets deal the same split unless their own
	 * data names types.
	 */
	void InitProjectileSecondType(const FGameplayTag& InSecondType, float InShare)
	{
		SecondDamageType = InSecondType;
		SecondDamageShare = FMath::Clamp(InShare, 0.f, 1.f);
	}

	/** Server only: how this bolt behaves in flight. Set by the weapon that fired it. */
	void InitProjectileBehaviour(int32 InMaxBounces, float InBounceDamageRetained, float InMaxGrowthScale, float InMaxGrowthDamage);

protected:


	virtual void BeginPlay() override;

	/** Server: a bullet with a detonation bursts at the end of its range or life. Elsewhere, as ever. */
	virtual void LifeSpanExpired() override;

	UFUNCTION()
	void OnSphereOverlap(UPrimitiveComponent* OverlappedComponent, AActor* OtherActor, UPrimitiveComponent* OtherComponent, int32 OtherBodyIndex, bool bFromSweep, const FHitResult& SweepResult);

	UFUNCTION()
	void OnSphereHit(UPrimitiveComponent* HitComponent, AActor* OtherActor, UPrimitiveComponent* OtherComponent, FVector NormalImpulse, const FHitResult& Hit);

	UPROPERTY(VisibleAnywhere, Category = "Projectile")
	TObjectPtr<USphereComponent> CollisionSphere;

	/** The visual. Blueprint children assign the mesh; a weapon's look turns it into the bullet's core. */
	UPROPERTY(VisibleAnywhere, Category = "Projectile")
	TObjectPtr<UStaticMeshComponent> Mesh;

	/** The additive glare around the core. Hidden until a look asks for one. */
	UPROPERTY(VisibleAnywhere, Category = "Projectile|Look")
	TObjectPtr<UStaticMeshComponent> GlowMesh;

	/** The streak behind the bullet, stretched along its flight. Hidden until a look asks for one. */
	UPROPERTY(VisibleAnywhere, Category = "Projectile|Look")
	TObjectPtr<UStaticMeshComponent> TrailMesh;

	/** A solid bullet model (the Magnus shell). Hidden until a look names one. */
	UPROPERTY(VisibleAnywhere, Category = "Projectile|Look")
	TObjectPtr<UStaticMeshComponent> ModelMesh;

	UPROPERTY(VisibleAnywhere, Category = "Projectile")
	TObjectPtr<UProjectileMovementComponent> ProjectileMovement;

	/** Seconds before an unanswered shot removes itself, unless the ability gave it a range instead. */
	UPROPERTY(EditDefaultsOnly, Category = "Projectile", meta = (ClampMin = "0.1"))
	float LifeSeconds = 3.f;

	/**
	 * Materials a look paints with: an unlit solid for the core, an additive soft ball for the glare
	 * and the streak. Each needs a vector ColorParameterName and a scalar BrightnessParameterName.
	 * Without them a look still sizes, spins and flashes, but cannot colour anything.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Projectile|Look")
	TObjectPtr<UMaterialInterface> CoreMaterial;

	UPROPERTY(EditDefaultsOnly, Category = "Projectile|Look")
	TObjectPtr<UMaterialInterface> GlowMaterial;

	UPROPERTY(EditDefaultsOnly, Category = "Projectile|Look")
	FName ColorParameterName = TEXT("Color");

	UPROPERTY(EditDefaultsOnly, Category = "Projectile|Look")
	FName BrightnessParameterName = TEXT("Brightness");

	UPROPERTY(EditDefaultsOnly, Category = "Projectile|Look", meta = (ClampMin = "0.0"))
	float CoreBrightness = 4.f;

	UPROPERTY(EditDefaultsOnly, Category = "Projectile|Look", meta = (ClampMin = "0.0"))
	float GlowBrightness = 3.f;

	/** The muzzle flash and the impact. A look without it shows neither. */
	UPROPERTY(EditDefaultsOnly, Category = "Projectile|Look")
	TSubclassOf<AClockworksHitSpark> SparkClass;

private:

	/** The weapon's look. Set once by the server; every machine applies and animates its own copy. */
	UPROPERTY(ReplicatedUsing = OnRep_Look)
	FClockworksBulletLook Look;

	UFUNCTION()
	void OnRep_Look();

	/** Every machine: shows the look on the components and fires the muzzle flash. Cosmetic. */
	void ApplyLook();

	/** Every machine: the pulse, the spin, the orbit. Cosmetic. */
	void TickLook(float DeltaSeconds);

	/** Every machine: makes the pellets of an orbiting bullet and hides its core. Cosmetic. */
	void BuildOrbit();

	/** An orbiting bullet's pellets, a core and a glow each, made when the look arrives. */
	UPROPERTY(Transient)
	TArray<TObjectPtr<UStaticMeshComponent>> OrbitCores;

	UPROPERTY(Transient)
	TArray<TObjectPtr<UStaticMeshComponent>> OrbitGlows;

	float OrbitAngle = 0.f;

	/** Every machine (multicast from the server as the bolt lands): the impact flash and sound. */
	UFUNCTION(NetMulticast, Reliable)
	void MulticastImpact(FVector_NetQuantize Location);

	/** Server only: tells everyone this bolt hit something, then removes it. */
	void Impact();

	UStaticMeshComponent* MakeLookPart(FName Name);
	UMaterialInstanceDynamic* PaintPart(UStaticMeshComponent* Part, UMaterialInterface* Material, const FLinearColor& Color, float Brightness);
	void SpawnSpark(const FVector& Location, const FLinearColor& Color) const;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> CoreMaterialInstance;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> GlowMaterialInstance;

	bool bLookApplied = false;
	float LookElapsed = 0.f;

	TWeakObjectPtr<UAbilitySystemComponent> SourceAbilitySystemComponent;
	float Damage = 0.f;
	float KnockbackMultiplier = 1.f;
	bool bConsumed = false;

	/** A second damage type this bolt's damage is split with (InitProjectileSecondType), and its share. Server only. */
	FGameplayTag SecondDamageType;
	float SecondDamageShare = 0.f;

	/** A monster bolt's damage split by type, when InitProjectileDamageParts set it. */
	float DamageParts[4] = { 0.f, 0.f, 0.f, 0.f };
	bool bHasDamageParts = false;

	/** How many bounces are left. Counts down from MaxBounces. */
	int32 BouncesLeft = 0;

	/** Seconds this bolt has been flying, and how long it has before it fizzles, for the growth curve. */
	float FlightElapsed = 0.f;
	float FlightTotal = 0.f;

	/** What it was fired with, so growth scales from the original rather than compounding. */
	float LaunchDamage = 0.f;

	/** The way it was fired, for a burst's heading once it has stopped moving. */
	FVector LaunchHeading = FVector::ForwardVector;

	/** The weapon's bullet, when InitProjectileSpec gave it one. Server only; the look replicates on its own. */
	FClockworksBulletSpec Spec;
	bool bHasSpec = false;
	TWeakObjectPtr<const UClockworksWeaponDefinition> SourceWeapon;
	int32 Generation = 0;

	FTimerHandle PulseTimer;
	int32 PulsesDone = 0;

	/** Monsters already struck, so a piercing shot hits each once and a split spares its parent's target. */
	TArray<TWeakObjectPtr<AActor>> HitActors;

	/** Stuck to a monster (bAttachOnHit), waiting to be set off. */
	bool bAttachedToTarget = false;

	/** Server only. The bullet ends where it is: its detonation, if it has one, then the impact and removal. */
	void Detonate(const FVector& SurfaceNormal, AActor* HitActor);

	/** Server only, from the pulse timer: one pulse's damage region and children. */
	void OnPulse();

	/**
	 * Server only, every frame for a bullet whose spec carries OrbitDamageByDepth: each orbiting pellet strikes the
	 * hostiles it touches, one monster at most every Spec.OrbitHitSeconds.
	 */
	void TickOrbitDamage();

	/** When each monster was last struck by this bullet's pellets (server only). */
	TMap<TWeakObjectPtr<AActor>, double> OrbitLastHit;

	/** Pellets that have struck, for a spec whose pellets strike once (server only). */
	TArray<bool> OrbitPelletSpent;

	/** Server only. Stops, stops colliding and rides the monster it hit. */
	void AttachToTarget(AActor* Target);

	/** Server only. Sets off every bullet of the same shooter stuck to Target. */
	void DetonateAttachedTo(AActor* Target);

	FClockworksBulletLineage MakeLineage(AActor* HitActor) const;
	FVector FlightHeading() const;

	/** Server only. A burst's damage region: damage, shove (or pull) and status on every hostile inside it. */
	static void ApplyAreaHit(UWorld* World, AActor* Causer, const FClockworksBulletLineage& Lineage, const FClockworksBulletBurst& Burst,
		const FVector& Centre, const FVector& Heading);

	/** Every machine (multicast from the server): a burst's column of light and its sound. Cosmetic. */
	UFUNCTION(NetMulticast, Reliable)
	void MulticastBurst(FVector_NetQuantize Location, float RadiusCm);
};
