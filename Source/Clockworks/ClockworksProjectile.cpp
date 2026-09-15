// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksProjectile.h"
#include "ClockworksDamageEffect.h"
#include "ClockworksGameplayAbility.h"
#include "ClockworksGameplayTags.h"
#include "ClockworksHitSpark.h"
#include "ClockworksWeaponDefinition.h"
#include "AbilitySystemComponent.h"
#include "AbilitySystemInterface.h"
#include "CollisionQueryParams.h"
#include "Components/SphereComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/OverlapResult.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/ProjectileMovementComponent.h"
#include "TimerManager.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Net/UnrealNetwork.h"
#include "Sound/SoundBase.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
	/** Bursts deep a line of children may go: the Alchemer's three generations and a vortex's chain fit easily. */
	constexpr int32 MaxBulletGenerations = 6;

	/**
	 * Seconds a bullet stuck to a monster waits for a charged shot before it falls away without bursting: the Catalyzer
	 * orb's 20 s (wiki, and an unused 20 s status in the data; research: _research/status_damage). INFERRED.
	 */
	constexpr float AttachedLifeSeconds = 20.f;
}

// Runs on: all machines (class default object and every replicated instance).
AClockworksProjectile::AClockworksProjectile()
{
	bReplicates = true;
	SetReplicatingMovement(true);

	// The growing bolts and every weapon's look animate here; the cost of a tick on a short-lived
	// actor is nothing and the alternative is turning it on and off from several places.
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = true;

	CollisionSphere = CreateDefaultSubobject<USphereComponent>(TEXT("CollisionSphere"));
	CollisionSphere->InitSphereRadius(16.f);
	CollisionSphere->SetCollisionProfileName(TEXT("OverlapAllDynamic"));
	CollisionSphere->SetCollisionResponseToChannel(ECC_WorldStatic, ECR_Block);
	CollisionSphere->SetCollisionResponseToChannel(ECC_Pawn, ECR_Overlap);
	CollisionSphere->SetGenerateOverlapEvents(true);
	RootComponent = CollisionSphere;

	Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
	Mesh->SetupAttachment(CollisionSphere);
	Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	GlowMesh = MakeLookPart(TEXT("GlowMesh"));
	TrailMesh = MakeLookPart(TEXT("TrailMesh"));
	ModelMesh = MakeLookPart(TEXT("ModelMesh"));

	static ConstructorHelpers::FObjectFinder<UStaticMesh> SphereMesh(TEXT("/Engine/BasicShapes/Sphere.Sphere"));
	if (SphereMesh.Succeeded())
	{
		GlowMesh->SetStaticMesh(SphereMesh.Object);
		TrailMesh->SetStaticMesh(SphereMesh.Object);
	}

	ProjectileMovement = CreateDefaultSubobject<UProjectileMovementComponent>(TEXT("ProjectileMovement"));
	ProjectileMovement->ProjectileGravityScale = 0.f;
	ProjectileMovement->bRotationFollowsVelocity = true;
	ProjectileMovement->bInitialVelocityInLocalSpace = false;
}

// Runs on: all machines (constructor). A hidden, collisionless, shadowless visual riding the bolt.
UStaticMeshComponent* AClockworksProjectile::MakeLookPart(FName Name)
{
	UStaticMeshComponent* Part = CreateDefaultSubobject<UStaticMeshComponent>(Name);
	Part->SetupAttachment(CollisionSphere);
	Part->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Part->SetCastShadow(false);
	Part->SetHiddenInGame(true);
	return Part;
}

// Runs on: all machines (the engine asks once per class).
void AClockworksProjectile::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);

	// Set once, before the bolt's first replication; a bolt never changes how it looks.
	DOREPLIFETIME_CONDITION(AClockworksProjectile, Look, COND_InitialOnly);
}

// Runs on: server only. The ability spawns, then calls this before the first tick.
void AClockworksProjectile::InitProjectile(UAbilitySystemComponent* InSourceAbilitySystemComponent, float InDamage, const FVector& Direction, float Speed, float InKnockbackMultiplier, float MaxRange, const FGameplayTag& InDamageType)
{
	SourceAbilitySystemComponent = InSourceAbilitySystemComponent;
	Damage = InDamage;
	KnockbackMultiplier = FMath::Max(InKnockbackMultiplier, 0.f);
	if (InDamageType.IsValid())
	{
		DamageType = InDamageType;
	}

	LaunchHeading = Direction.GetSafeNormal2D().IsNearlyZero() ? GetActorForwardVector() : Direction.GetSafeNormal2D();
	const FVector Velocity = Direction.GetSafeNormal() * Speed;
	ProjectileMovement->InitialSpeed = Speed;
	ProjectileMovement->MaxSpeed = Speed;
	ProjectileMovement->Velocity = Velocity;

	// A reach given as a distance: the shot fizzles where a Spiral Knights bullet would. BeginPlay
	// already set the duration fallback; this replaces it.
	FlightTotal = LifeSeconds;
	if (MaxRange > 0.f && Speed > 0.f)
	{
		FlightTotal = FMath::Max(MaxRange / Speed, 0.01f);
		SetLifeSpan(FlightTotal);
	}

	LaunchDamage = Damage;
	BouncesLeft = MaxBounces;
	FlightElapsed = 0.f;

	// Only bolts that actually bounce need to notice walls rather than be stopped by them.
	if (MaxBounces > 0 && ProjectileMovement)
	{
		ProjectileMovement->bShouldBounce = true;
		ProjectileMovement->Bounciness = 1.f;
		ProjectileMovement->Friction = 0.f;
	}

	// Never hit the one who fired it.
	if (AActor* Shooter = GetInstigator())
	{
		CollisionSphere->IgnoreActorWhenMoving(Shooter, true);
	}
}

// Runs on: server only, right after InitProjectile. The look replicates with the bolt's first update.
void AClockworksProjectile::InitProjectileLook(const FClockworksBulletLook& InLook, float InCollisionRadiusCm)
{
	if (!HasAuthority())
	{
		return;
	}
	if (InCollisionRadiusCm > 0.f && CollisionSphere)
	{
		CollisionSphere->SetSphereRadius(InCollisionRadiusCm);
	}
	if (!InLook.bEnabled)
	{
		return;
	}
	Look = InLook;
	ApplyLook();
}

// Runs on: clients, when the server's look arrives with the bolt.
void AClockworksProjectile::OnRep_Look()
{
	ApplyLook();
}

// Runs on: every machine. Cosmetic only.
void AClockworksProjectile::ApplyLook()
{
	if (bLookApplied || !Look.bEnabled)
	{
		return;
	}
	bLookApplied = true;
	LookElapsed = 0.f;

	// A bullet with no body of its own is seen only by its bursts.
	if (Look.bHideBody)
	{
		if (Mesh)
		{
			Mesh->SetHiddenInGame(true);
		}
		return;
	}

	// An orbiting bullet shows only its pellets, circling where the core flies.
	if (Look.OrbitCount > 0)
	{
		BuildOrbit();
		TickLook(0.f);
		if (Look.MuzzleColor.A > 0.f)
		{
			SpawnSpark(GetActorLocation(), Look.MuzzleColor);
		}
		return;
	}

	// A solid model replaces the round core; the glare and the streak go with either.
	const bool bHasModel = Look.Mesh != nullptr;
	if (bHasModel && ModelMesh)
	{
		ModelMesh->SetStaticMesh(Look.Mesh);
		const float Longest = Look.Mesh->GetBounds().BoxExtent.GetMax() * 2.f;
		ModelMesh->SetRelativeScale3D(FVector(Longest > UE_KINDA_SMALL_NUMBER ? Look.MeshSizeCm / Longest : 1.f));
		ModelMesh->SetHiddenInGame(false);
	}

	if (Mesh)
	{
		Mesh->SetHiddenInGame(bHasModel);
		if (!bHasModel && GlowMesh)
		{
			// The core is the engine sphere like the glare, so its size in cm is simply scale x 100.
			Mesh->SetStaticMesh(GlowMesh->GetStaticMesh());
			CoreMaterialInstance = PaintPart(Mesh, CoreMaterial, Look.CoreColor, CoreBrightness);
		}
	}

	if (GlowMesh && Look.GlowSizeMaxCm > 0.f)
	{
		GlowMesh->SetHiddenInGame(false);
		GlowMaterialInstance = PaintPart(GlowMesh, GlowMaterial, Look.GlowColor, GlowBrightness);
	}

	if (TrailMesh && Look.TrailLengthCm > 0.f)
	{
		// Stretched backwards along the flight; the bolt's rotation follows its velocity.
		const float Width = FMath::Max(Look.CoreSizeMaxCm, 4.f) / 100.f;
		TrailMesh->SetRelativeScale3D(FVector(Look.TrailLengthCm / 100.f, Width, Width));
		TrailMesh->SetRelativeLocation(FVector(-Look.TrailLengthCm * 0.5f, 0.f, 0.f));
		TrailMesh->SetHiddenInGame(false);
		PaintPart(TrailMesh, GlowMaterial, Look.CoreColor * 0.6f, GlowBrightness);
	}

	TickLook(0.f);

	if (Look.MuzzleColor.A > 0.f)
	{
		SpawnSpark(GetActorLocation(), Look.MuzzleColor);
	}
}

// Runs on: every machine. Cosmetic only. The pellets are the engine sphere like the core and the glow.
void AClockworksProjectile::BuildOrbit()
{
	if (Mesh)
	{
		Mesh->SetHiddenInGame(true);
	}
	UStaticMesh* Sphere = GlowMesh ? GlowMesh->GetStaticMesh() : nullptr;
	if (!Sphere || !CollisionSphere)
	{
		return;
	}

	auto MakePellet = [this, Sphere](UMaterialInterface* Material, const FLinearColor& Color, float Brightness)
	{
		UStaticMeshComponent* Part = NewObject<UStaticMeshComponent>(this, NAME_None, RF_Transient);
		Part->SetStaticMesh(Sphere);
		Part->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Part->SetCastShadow(false);
		Part->RegisterComponent();
		Part->AttachToComponent(CollisionSphere, FAttachmentTransformRules::KeepRelativeTransform);
		PaintPart(Part, Material, Color, Brightness);
		return Part;
	};

	const int32 Count = FMath::Clamp(Look.OrbitCount, 1, 8);
	for (int32 Index = 0; Index < Count; ++Index)
	{
		OrbitCores.Add(MakePellet(CoreMaterial, Look.CoreColor, CoreBrightness));
		if (Look.GlowSizeMaxCm > 0.f)
		{
			OrbitGlows.Add(MakePellet(GlowMaterial, Look.GlowColor, GlowBrightness));
		}
	}
}

// Runs on: every machine. Cosmetic only.
UMaterialInstanceDynamic* AClockworksProjectile::PaintPart(UStaticMeshComponent* Part, UMaterialInterface* Material, const FLinearColor& Color, float Brightness)
{
	if (!Part || !Material)
	{
		return nullptr;
	}
	UMaterialInstanceDynamic* Instance = UMaterialInstanceDynamic::Create(Material, this);
	Instance->SetVectorParameterValue(ColorParameterName, Color);
	Instance->SetScalarParameterValue(BrightnessParameterName, Brightness);
	Part->SetMaterial(0, Instance);
	return Instance;
}

// Runs on: every machine. Cosmetic only; spawned locally, never replicated.
void AClockworksProjectile::SpawnSpark(const FVector& Location, const FLinearColor& Color) const
{
	UWorld* World = GetWorld();
	if (!World || !SparkClass)
	{
		return;
	}
	const FTransform Transform(Location);
	if (AClockworksHitSpark* Spark = World->SpawnActorDeferred<AClockworksHitSpark>(SparkClass, Transform, nullptr, nullptr, ESpawnActorCollisionHandlingMethod::AlwaysSpawn))
	{
		Spark->SetSparkColor(Color);
		Spark->FinishSpawning(Transform);
	}
}

// Runs on: every machine. The original's bullet particles live a fraction of a second and are
// re-emitted all the way, so a bullet reads as a core that swells and shrinks as it flies; one pulse
// here is one of those lifespans.
void AClockworksProjectile::TickLook(float DeltaSeconds)
{
	if (!bLookApplied)
	{
		return;
	}
	LookElapsed += DeltaSeconds;
	const float Phase = FMath::Fmod(LookElapsed, FMath::Max(Look.PulseSeconds, 0.01f)) / FMath::Max(Look.PulseSeconds, 0.01f);
	const float Swell = FMath::Sin(Phase * PI);

	if (Look.OrbitCount > 0)
	{
		// Evenly spaced round the core, turning at the original's orbit speed, in the bullet's own frame.
		OrbitAngle = FMath::Fmod(OrbitAngle + Look.OrbitDegreesPerSecond * DeltaSeconds, 360.f);
		const float CoreScale = FMath::Lerp(Look.CoreSizeMinCm, Look.CoreSizeMaxCm, Swell) / 100.f;
		const float GlowScale = FMath::Lerp(Look.GlowSizeMinCm, Look.GlowSizeMaxCm, Swell) / 100.f;
		for (int32 Index = 0; Index < OrbitCores.Num(); ++Index)
		{
			const float Radians = FMath::DegreesToRadians(OrbitAngle + 360.f * Index / OrbitCores.Num());
			const FVector Offset(FMath::Cos(Radians) * Look.OrbitRadiusCm, FMath::Sin(Radians) * Look.OrbitRadiusCm, 0.f);
			if (OrbitCores[Index])
			{
				OrbitCores[Index]->SetRelativeLocation(Offset);
				OrbitCores[Index]->SetRelativeScale3D(FVector(CoreScale));
			}
			if (OrbitGlows.IsValidIndex(Index) && OrbitGlows[Index])
			{
				OrbitGlows[Index]->SetRelativeLocation(Offset);
				OrbitGlows[Index]->SetRelativeScale3D(FVector(GlowScale));
			}
		}
		return;
	}

	if (Mesh && !Look.Mesh)
	{
		Mesh->SetRelativeScale3D(FVector(FMath::Lerp(Look.CoreSizeMinCm, Look.CoreSizeMaxCm, Swell) / 100.f));
	}
	if (GlowMesh && Look.GlowSizeMaxCm > 0.f)
	{
		GlowMesh->SetRelativeScale3D(FVector(FMath::Lerp(Look.GlowSizeMinCm, Look.GlowSizeMaxCm, Swell) / 100.f));
	}
	if (ModelMesh && Look.Mesh && !FMath::IsNearlyZero(Look.SpinDegreesPerSecond))
	{
		ModelMesh->AddLocalRotation(FRotator(0.f, 0.f, Look.SpinDegreesPerSecond * DeltaSeconds));
	}
}

// Runs on: all machines. Only the server binds the hit logic.
void AClockworksProjectile::BeginPlay()
{
	Super::BeginPlay();

	SetLifeSpan(LifeSeconds);

	if (HasAuthority())
	{
		CollisionSphere->OnComponentBeginOverlap.AddDynamic(this, &AClockworksProjectile::OnSphereOverlap);
		CollisionSphere->OnComponentHit.AddDynamic(this, &AClockworksProjectile::OnSphereHit);
	}
}

// Runs on: server only. A pawn was touched: damage it if it is on another side, then vanish.
void AClockworksProjectile::OnSphereOverlap(UPrimitiveComponent* OverlappedComponent, AActor* OtherActor, UPrimitiveComponent* OtherComponent, int32 OtherBodyIndex, bool bFromSweep, const FHitResult& SweepResult)
{
	if (bConsumed || bAttachedToTarget || !OtherActor || OtherActor == GetInstigator())
	{
		return;
	}

	// A bullet that neither hurts, stops, sticks nor sets anything off on a monster (a Brandish's carrier,
	// a cloud, a missile waiting on its fuse) has nothing to do with one.
	if (bHasSpec && Spec.bPassesThrough && Spec.ContactDamageMultiplier <= 0.f && !Spec.bAttachOnHit && !Spec.bDetonateAttachedOnHit)
	{
		return;
	}
	// A Mixer's core hurts nobody and flies on past monsters: its orbiting pellets deal the damage (TickOrbitDamage).
	if (bHasSpec && Spec.OrbitDamageByDepth.Num() > 0)
	{
		return;
	}

	const IAbilitySystemInterface* TargetInterface = Cast<IAbilitySystemInterface>(OtherActor);
	UAbilitySystemComponent* TargetAbilitySystemComponent = TargetInterface ? TargetInterface->GetAbilitySystemComponent() : nullptr;
	UAbilitySystemComponent* Source = SourceAbilitySystemComponent.Get();
	if (!TargetAbilitySystemComponent || !Source)
	{
		return;
	}

	// Same faction as the shooter: pass straight through (shots don't hurt other enemies, or the
	// other player).
	FGameplayTagContainer SourceTags;
	Source->GetOwnedGameplayTags(SourceTags);
	for (const FGameplayTag& Tag : SourceTags)
	{
		if (Tag.MatchesTag(FGameplayTag::RequestGameplayTag(TEXT("Faction"))) && TargetAbilitySystemComponent->HasMatchingGameplayTag(Tag))
		{
			return;
		}
	}
	if (TargetAbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Dead) || TargetAbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Invulnerable))
	{
		return;
	}

	// Once per monster: a piercing shot passes on, and a split never strikes the monster its parent just hit.
	if (HitActors.Contains(OtherActor))
	{
		return;
	}
	HitActors.Add(OtherActor);

	const float ContactMultiplier = bHasSpec ? Spec.ContactDamageMultiplier : 1.f;
	if (ContactMultiplier > 0.f)
	{
		FGameplayEffectContextHandle Context = Source->MakeEffectContext();
		Context.AddInstigator(Source->GetOwnerActor(), this);
		// The weapon rides along like an ability's hit carries it, so the target's rules can see which weapon struck.
		Context.AddSourceObject(SourceWeapon.Get());
		const FHitResult Hit(OtherActor, OtherComponent, OtherActor->GetActorLocation(), -GetVelocity().GetSafeNormal());
		Context.AddHitResult(Hit);

		FGameplayEffectSpecHandle SpecHandle = Source->MakeOutgoingSpec(UClockworksDamageEffect::StaticClass(), 1.f, Context);
		if (SpecHandle.IsValid())
		{
			if (bHasDamageParts)
			{
				float Parts[4];
				for (int32 Kind = 0; Kind < 4; ++Kind)
				{
					Parts[Kind] = DamageParts[Kind] * ContactMultiplier;
				}
				UClockworksGameplayAbility::SetTypedDamageMagnitudes(SpecHandle, Parts);
			}
			else
			{
				UClockworksGameplayAbility::SetSplitDamageMagnitudes(SpecHandle, Damage * ContactMultiplier, DamageType, SecondDamageType, SecondDamageShare);
			}
			SpecHandle.Data->SetSetByCallerMagnitude(ClockworksTags::Data_Knockback, KnockbackMultiplier);
			Source->ApplyGameplayEffectSpecToTarget(*SpecHandle.Data, TargetAbilitySystemComponent);
			UClockworksGameplayAbility::TryApplyStatus(Source, TargetAbilitySystemComponent,
				StatusEffect, StatusChance, StatusSeconds, StatusTickDamage);
		}
	}

	if (bHasSpec && Spec.bDetonateAttachedOnHit)
	{
		DetonateAttachedTo(OtherActor);
	}
	if (bHasSpec && Spec.bAttachOnHit)
	{
		AttachToTarget(OtherActor);
		return;
	}
	if (bHasSpec && Spec.bPassesThrough)
	{
		return;
	}

	bConsumed = true;
	// The surface it struck faces from the monster's centre towards the bullet, for a split's ricochet.
	FVector AwayFromTarget = GetActorLocation() - OtherActor->GetActorLocation();
	AwayFromTarget.Z = 0.f;
	Detonate(AwayFromTarget.GetSafeNormal(), OtherActor);
}

// Runs on: server only. Reliable so the flash is not lost with the bolt it belongs to: the call is
// queued on the bolt's channel before the destroy closes it.
void AClockworksProjectile::Impact()
{
	if (Look.bEnabled)
	{
		MulticastImpact(GetActorLocation());
	}
	Destroy();
}

// Runs on: all machines (multicast from the server). Cosmetic only; the damage is already done.
void AClockworksProjectile::MulticastImpact_Implementation(FVector_NetQuantize Location)
{
	if (!Look.bHideBody)
	{
		SpawnSpark(Location, Look.CoreColor);
	}

	float Pitch = 1.f;
	if (USoundBase* Sound = Look.ImpactSound.Pick(Pitch))
	{
		UGameplayStatics::PlaySoundAtLocation(this, Sound, Location, Look.ImpactSound.Volume, Pitch);
	}
}

// Runs on: all machines, but only meaningful where the bolt is simulated. The look's pulse, and the
// growth: cosmetic here, the damage it will deal is recomputed from the same curve at the moment it lands.
void AClockworksProjectile::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	TickLook(DeltaSeconds);

	if (HasAuthority() && bHasSpec && !bConsumed && Spec.OrbitDamageByDepth.Num() > 0 && Look.OrbitCount > 0)
	{
		TickOrbitDamage();
	}

	if (bConsumed || MaxGrowthScale <= 1.f || FlightTotal <= 0.f)
	{
		return;
	}

	FlightElapsed = FMath::Min(FlightElapsed + DeltaSeconds, FlightTotal);
	const float Alpha = FlightElapsed / FlightTotal;

	// The Pulsar's pellets swell about halfway and are at their worst at the far end, so the gun is
	// better the further away you stand. Growth is shown here; the damage is read off the same alpha.
	const float Scale = FMath::Lerp(1.f, MaxGrowthScale, Alpha);
	SetActorScale3D(FVector(Scale));

	if (HasAuthority())
	{
		Damage = LaunchDamage * FMath::Lerp(1.f, MaxGrowthDamage, Alpha);
	}
}

// Runs on: server only. A wall stops an ordinary shot, which is what "break line of sight" means.
// A bolt with bounces left comes off it instead: the Alchemer line's whole identity, and the reason
// a corridor is a good place to use one.
void AClockworksProjectile::OnSphereHit(UPrimitiveComponent* HitComponent, AActor* OtherActor, UPrimitiveComponent* OtherComponent, FVector NormalImpulse, const FHitResult& Hit)
{
	if (bConsumed)
	{
		return;
	}

	if (BouncesLeft > 0)
	{
		--BouncesLeft;
		Damage *= BounceDamageRetained;
		LaunchDamage *= BounceDamageRetained;
		return;
	}

	bConsumed = true;
	Detonate(Hit.ImpactNormal, nullptr);
}

// Runs on: server only. Called alongside InitProjectile by whatever fired the bolt.
void AClockworksProjectile::InitProjectileStatus(TSubclassOf<UGameplayEffect> InStatusEffect, float InChance, float InSeconds, float InTickDamage)
{
	StatusEffect = InStatusEffect;
	StatusChance = InChance;
	StatusSeconds = InSeconds;
	StatusTickDamage = InTickDamage;
}

// Runs on: server only. Called alongside InitProjectile by whatever fired the bolt.
void AClockworksProjectile::InitProjectileBehaviour(int32 InMaxBounces, float InBounceDamageRetained, float InMaxGrowthScale, float InMaxGrowthDamage)
{
	MaxBounces = FMath::Max(InMaxBounces, 0);
	BouncesLeft = MaxBounces;
	BounceDamageRetained = FMath::Clamp(InBounceDamageRetained, 0.f, 1.f);
	MaxGrowthScale = FMath::Max(InMaxGrowthScale, 1.f);
	MaxGrowthDamage = FMath::Max(InMaxGrowthDamage, 1.f);

	if (MaxBounces > 0 && ProjectileMovement)
	{
		ProjectileMovement->bShouldBounce = true;
		ProjectileMovement->Bounciness = 1.f;
		ProjectileMovement->Friction = 0.f;
	}
}

// Runs on: server only, right after InitProjectile (and any status and behaviour).
void AClockworksProjectile::InitProjectileSpec(const FClockworksBulletSpec& InSpec, const UClockworksWeaponDefinition* InWeapon, int32 InGeneration)
{
	if (!HasAuthority())
	{
		return;
	}
	Spec = InSpec;
	bHasSpec = true;
	SourceWeapon = InWeapon;
	Generation = InGeneration;

	InitProjectileLook(Spec.Look, Spec.CollisionRadiusCm);

	// A bullet that does not fly lives for a time rather than a distance.
	if (Spec.LifeSeconds > 0.f)
	{
		FlightTotal = Spec.LifeSeconds;
		SetLifeSpan(Spec.LifeSeconds);
	}

	if (Spec.PulseSeconds > 0.f && Spec.Pulse.IsSet())
	{
		PulsesDone = 0;
		GetWorldTimerManager().SetTimer(PulseTimer, this, &AClockworksProjectile::OnPulse, Spec.PulseSeconds, /*bLoop*/ true);
	}
}

// Runs on: every machine whose copy has a lifespan; only the server's bursts. A bullet reaching the end
// of its range or life detonates as it would against a wall (an Alchemer's split, a Pulsar wave, a
// Tortofist missile). One stuck to a monster, or with nothing to detonate, simply goes.
void AClockworksProjectile::LifeSpanExpired()
{
	if (HasAuthority() && bHasSpec && !bConsumed && !bAttachedToTarget && Spec.Detonation.IsSet())
	{
		bConsumed = true;
		Detonate(FVector::ZeroVector, nullptr);
		return;
	}
	Super::LifeSpanExpired();
}

// Runs on: server only. The bullet ends where it is: its detonation's damage region and children, the
// burst everyone sees, then the impact and removal.
void AClockworksProjectile::Detonate(const FVector& SurfaceNormal, AActor* HitActor)
{
	GetWorldTimerManager().ClearTimer(PulseTimer);

	UWorld* World = GetWorld();
	if (bHasSpec && World && Spec.Detonation.IsSet())
	{
		const FVector Location = GetActorLocation();
		const FVector Heading = FlightHeading();
		const FClockworksBulletLineage Lineage = MakeLineage(HitActor);
		ApplyAreaHit(World, this, Lineage, Spec.Detonation, Location, Heading);
		SpawnChildren(World, Lineage, Spec.Detonation.Children, Location, Heading, SurfaceNormal);
		if (Spec.Detonation.RadiusCm > 0.f)
		{
			MulticastBurst(Location, Spec.Detonation.RadiusCm);
		}
	}
	Impact();
}

// Runs on: server only, from the pulse timer. A Brandish's carrier's explosions, a Pulsar orb's waves, a
// cloud's status ticks, a vortex's pulls, a Tortofist crystal's stings.
void AClockworksProjectile::OnPulse()
{
	UWorld* World = GetWorld();
	if (!HasAuthority() || bConsumed || !World)
	{
		return;
	}
	++PulsesDone;

	const FVector Location = GetActorLocation();
	const FVector Heading = FlightHeading();
	const FClockworksBulletLineage Lineage = MakeLineage(nullptr);
	ApplyAreaHit(World, this, Lineage, Spec.Pulse, Location, Heading);
	SpawnChildren(World, Lineage, Spec.Pulse.Children, Location, Heading, FVector::ZeroVector);
	if (Spec.Pulse.RadiusCm > 0.f)
	{
		MulticastBurst(Location, Spec.Pulse.RadiusCm);
	}

	if (Spec.PulseLimit > 0 && PulsesDone >= Spec.PulseLimit)
	{
		GetWorldTimerManager().ClearTimer(PulseTimer);
		if (Spec.bEndsAfterPulses)
		{
			bConsumed = true;
			Detonate(FVector::ZeroVector, nullptr);
		}
	}
}

// Runs on: server only (Tick checks HasAuthority). The pellets' places are worked out the way TickLook draws them, in
// the bullet's own frame, so what a player sees touching a monster is what hurts it.
void AClockworksProjectile::TickOrbitDamage()
{
	UWorld* World = GetWorld();
	UAbilitySystemComponent* Source = SourceAbilitySystemComponent.Get();
	if (!World || !Source)
	{
		return;
	}
	const double Now = World->GetTimeSeconds();
	const float Amount = ClockworksAttackDepth::Read(Spec.OrbitDamageByDepth, UClockworksGameplayAbility::CurrentDemoDepth(World), 0.f);
	if (Amount <= 0.f)
	{
		return;
	}
	const FGameplayTag SourceFaction = UClockworksGameplayAbility::GetFactionTag(Source);
	// INFERRED: a pellet reaches as far as its drawn core, and never less than a quarter tile.
	const float PelletRadius = FMath::Max(Look.CoreSizeMaxCm * 0.5f, 25.f);
	const int32 Count = FMath::Clamp(Look.OrbitCount, 1, 8);
	if (Spec.bOrbitPelletHitsOnce && OrbitPelletSpent.Num() != Count)
	{
		OrbitPelletSpent.Init(false, Count);
	}
	const FTransform& Frame = GetActorTransform();

	FCollisionQueryParams Params(SCENE_QUERY_STAT(ClockworksOrbitHit), /*bTraceComplex*/ false);
	Params.AddIgnoredActor(this);
	if (AActor* Shooter = GetInstigator())
	{
		Params.AddIgnoredActor(Shooter);
	}

	for (int32 Index = 0; Index < Count; ++Index)
	{
		// A spent pellet keeps circling but strikes no more.
		if (Spec.bOrbitPelletHitsOnce && OrbitPelletSpent[Index])
		{
			continue;
		}
		const float Radians = FMath::DegreesToRadians(OrbitAngle + 360.f * Index / Count);
		const FVector Centre = Frame.TransformPosition(FVector(FMath::Cos(Radians) * Look.OrbitRadiusCm, FMath::Sin(Radians) * Look.OrbitRadiusCm, 0.f));

		TArray<FOverlapResult> Overlaps;
		World->OverlapMultiByObjectType(Overlaps, Centre, FQuat::Identity, FCollisionObjectQueryParams(ECC_Pawn),
			FCollisionShape::MakeSphere(PelletRadius), Params);

		for (const FOverlapResult& Overlap : Overlaps)
		{
			AActor* HitActor = Overlap.GetActor();
			const IAbilitySystemInterface* AbilityInterface = Cast<IAbilitySystemInterface>(HitActor);
			UAbilitySystemComponent* Target = AbilityInterface ? AbilityInterface->GetAbilitySystemComponent() : nullptr;
			if (!Target || Target == Source)
			{
				continue;
			}
			if (SourceFaction.IsValid() && UClockworksGameplayAbility::GetFactionTag(Target) == SourceFaction)
			{
				continue;
			}
			if (Target->HasMatchingGameplayTag(ClockworksTags::State_Dead) || Target->HasMatchingGameplayTag(ClockworksTags::State_Invulnerable))
			{
				continue;
			}
			const TWeakObjectPtr<AActor> Key(HitActor);
			if (const double* Last = OrbitLastHit.Find(Key); Last && Now - *Last < Spec.OrbitHitSeconds)
			{
				continue;
			}
			OrbitLastHit.Add(Key, Now);

			FGameplayEffectContextHandle Context = Source->MakeEffectContext();
			Context.AddInstigator(Source->GetOwnerActor(), this);
			Context.AddSourceObject(SourceWeapon.Get());
			Context.AddHitResult(FHitResult(HitActor, Overlap.GetComponent(), HitActor->GetActorLocation(), (HitActor->GetActorLocation() - Centre).GetSafeNormal2D()));
			const FGameplayEffectSpecHandle DamageSpec = Source->MakeOutgoingSpec(UClockworksDamageEffect::StaticClass(), 1.f, Context);
			if (!DamageSpec.IsValid())
			{
				continue;
			}
			UClockworksGameplayAbility::SetSplitDamageMagnitudes(DamageSpec, Amount, DamageType, SecondDamageType, SecondDamageShare);
			DamageSpec.Data->SetSetByCallerMagnitude(ClockworksTags::Data_Knockback, KnockbackMultiplier);
			Source->ApplyGameplayEffectSpecToTarget(*DamageSpec.Data, Target);
			UClockworksGameplayAbility::TryApplyStatus(Source, Target, StatusEffect, StatusChance, StatusSeconds, StatusTickDamage);
			if (Spec.bOrbitPelletHitsOnce)
			{
				OrbitPelletSpent[Index] = true;
				break;
			}
		}
	}
}

// Runs on: server only. Its movement replicates the attachment, so every machine sees it ride the monster.
void AClockworksProjectile::AttachToTarget(AActor* Target)
{
	bAttachedToTarget = true;
	if (ProjectileMovement)
	{
		ProjectileMovement->StopMovementImmediately();
		ProjectileMovement->Deactivate();
	}
	if (CollisionSphere)
	{
		CollisionSphere->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	}
	AttachToActor(Target, FAttachmentTransformRules::KeepWorldTransform);
	SetLifeSpan(AttachedLifeSeconds);
}

// Runs on: server only. Only the same shooter's bullets: two knights' Catalyzers do not set each other's off.
void AClockworksProjectile::DetonateAttachedTo(AActor* Target)
{
	TArray<AActor*> Attached;
	Target->GetAttachedActors(Attached);
	for (AActor* Actor : Attached)
	{
		AClockworksProjectile* Stuck = Cast<AClockworksProjectile>(Actor);
		if (Stuck && Stuck != this && Stuck->bAttachedToTarget && !Stuck->bConsumed && Stuck->SourceAbilitySystemComponent == SourceAbilitySystemComponent)
		{
			Stuck->bConsumed = true;
			Stuck->Detonate(FVector::ZeroVector, nullptr);
		}
	}
}

// Runs on: server only.
FClockworksBulletLineage AClockworksProjectile::MakeLineage(AActor* HitActor) const
{
	FClockworksBulletLineage Lineage;
	Lineage.Class = GetClass();
	Lineage.Owner = GetOwner();
	Lineage.Instigator = GetInstigator();
	Lineage.Source = SourceAbilitySystemComponent.Get();
	Lineage.Weapon = SourceWeapon.Get();
	Lineage.Damage = Damage;
	Lineage.KnockbackMultiplier = KnockbackMultiplier;
	Lineage.DamageType = DamageType;
	Lineage.SecondDamageType = SecondDamageType;
	Lineage.SecondDamageShare = SecondDamageShare;
	Lineage.StatusEffect = StatusEffect;
	Lineage.StatusChance = StatusChance;
	Lineage.StatusSeconds = StatusSeconds;
	Lineage.StatusTickDamage = StatusTickDamage;
	Lineage.Generation = Generation;
	Lineage.IgnoredActor = HitActor;
	return Lineage;
}

// Runs on: server only. Where it is going, or where it was going before it stopped.
FVector AClockworksProjectile::FlightHeading() const
{
	const FVector Velocity = GetVelocity().GetSafeNormal2D();
	return Velocity.IsNearlyZero() ? LaunchHeading : Velocity;
}

// Runs on: server only.
void AClockworksProjectile::ApplyAreaHit(UWorld* World, AActor* Causer, const FClockworksBulletLineage& Lineage, const FClockworksBulletBurst& Burst,
	const FVector& Centre, const FVector& Heading)
{
	UAbilitySystemComponent* Source = Lineage.Source;
	if (!World || !Causer || !Source || Burst.RadiusCm <= 0.f)
	{
		return;
	}

	// A column rather than a ball: the floor is flat, and a bullet may burst at chest height or on the ground.
	TArray<FOverlapResult> Overlaps;
	FCollisionQueryParams Params(SCENE_QUERY_STAT(ClockworksBulletBurst), /*bTraceComplex*/ false);
	Params.AddIgnoredActor(Causer);
	World->OverlapMultiByObjectType(Overlaps, Centre, FQuat::Identity,
		FCollisionObjectQueryParams(FCollisionObjectQueryParams::InitType::AllDynamicObjects),
		FCollisionShape::MakeCapsule(Burst.RadiusCm, FMath::Max(Burst.RadiusCm, 200.f)), Params);

	const FGameplayTag SourceFaction = UClockworksGameplayAbility::GetFactionTag(Source);
	// The burst's own curve when the weapon's data carries it (the original gives each burst its own damage); else a
	// multiple of the bullet's.
	const float BurstDamage = ClockworksAttackDepth::Read(Burst.DamageByDepth, UClockworksGameplayAbility::CurrentDemoDepth(World), Lineage.Damage * Burst.DamageMultiplier);
	// The burst's own damage types where its data names them; else the bullet's.
	FGameplayTag BurstType = Lineage.DamageType;
	FGameplayTag BurstSecondType = Lineage.SecondDamageType;
	float BurstSecondShare = Lineage.SecondDamageShare;
	if (Burst.DamageTypes.IsSet())
	{
		UClockworksGameplayAbility::ResolveDamageTypes(World, Burst.DamageTypes, Lineage.DamageType, BurstType, BurstSecondType, BurstSecondShare);
	}
	const bool bShoves = !FMath::IsNearlyZero(Burst.Knockback);
	const float Chance = Burst.StatusChance >= 0.f ? Burst.StatusChance : Lineage.StatusChance;

	TSet<AActor*> Struck;
	for (const FOverlapResult& Overlap : Overlaps)
	{
		AActor* HitActor = Overlap.GetActor();
		if (!HitActor || Struck.Contains(HitActor))
		{
			continue;
		}
		const IAbilitySystemInterface* AbilityInterface = Cast<IAbilitySystemInterface>(HitActor);
		UAbilitySystemComponent* Target = AbilityInterface ? AbilityInterface->GetAbilitySystemComponent() : nullptr;
		if (!Target || Target == Source)
		{
			continue;
		}
		if (SourceFaction.IsValid() && UClockworksGameplayAbility::GetFactionTag(Target) == SourceFaction)
		{
			continue;
		}
		if (Target->HasMatchingGameplayTag(ClockworksTags::State_Dead) || Target->HasMatchingGameplayTag(ClockworksTags::State_Invulnerable))
		{
			continue;
		}
		Struck.Add(HitActor);

		if (BurstDamage > 0.f || bShoves)
		{
			FGameplayEffectContextHandle Context = Source->MakeEffectContext();
			Context.AddInstigator(Source->GetOwnerActor(), Causer);
			Context.AddSourceObject(Lineage.Weapon);
			const FGameplayEffectSpecHandle DamageSpec = Source->MakeOutgoingSpec(UClockworksDamageEffect::StaticClass(), 1.f, Context);
			if (DamageSpec.IsValid())
			{
				// A shove with no damage still needs a hit to carry it; the attribute set spends none of it.
				UClockworksGameplayAbility::SetSplitDamageMagnitudes(DamageSpec, BurstDamage > 0.f ? BurstDamage : 1.f, BurstType, BurstSecondType, BurstSecondShare);
				if (BurstDamage <= 0.f)
				{
					DamageSpec.Data->SetSetByCallerMagnitude(ClockworksTags::Data_ShoveOnly, 1.f);
				}
				DamageSpec.Data->SetSetByCallerMagnitude(ClockworksTags::Data_Knockback, FMath::Abs(Burst.Knockback));

				// The attribute set shoves from the causer outwards; turn that to pull, or to the bullet's flight.
				float Angle = Burst.Knockback < 0.f ? 180.f : 0.f;
				FVector Outward = HitActor->GetActorLocation() - Causer->GetActorLocation();
				Outward.Z = 0.f;
				if (Burst.bShoveAlongFlight && !Heading.IsNearlyZero() && !Outward.IsNearlyZero())
				{
					const FVector From = Outward.GetSafeNormal();
					const FVector To = Heading.GetSafeNormal2D();
					Angle += FMath::RadiansToDegrees(FMath::Atan2(From.X * To.Y - From.Y * To.X, FVector::DotProduct(From, To)));
				}
				if (!FMath::IsNearlyZero(Angle))
				{
					DamageSpec.Data->SetSetByCallerMagnitude(ClockworksTags::Data_KnockbackAngle, Angle);
				}
				Source->ApplyGameplayEffectSpecToTarget(*DamageSpec.Data, Target);
			}
		}
		UClockworksGameplayAbility::TryApplyStatus(Source, Target, Lineage.StatusEffect, Chance, Lineage.StatusSeconds, Lineage.StatusTickDamage);
	}
}

// Runs on: server only. Children replicate on their own, like any bullet.
void AClockworksProjectile::SpawnChildren(UWorld* World, const FClockworksBulletLineage& Lineage, const TArray<FClockworksBulletChild>& Children,
	const FVector& Location, const FVector& Heading, const FVector& SurfaceNormal)
{
	if (!World || !Lineage.Class || !Lineage.Source || !Lineage.Weapon || Children.Num() == 0)
	{
		return;
	}
	if (Lineage.Generation >= MaxBulletGenerations)
	{
		return;
	}
	const TArray<FClockworksBulletSpec>& Subs = Lineage.Weapon->Attack.SubBullets;
	const FVector Forward = Heading.GetSafeNormal2D().IsNearlyZero() ? FVector::ForwardVector : Heading.GetSafeNormal2D();

	for (const FClockworksBulletChild& Child : Children)
	{
		if (!Subs.IsValidIndex(Child.SubBullet))
		{
			continue;
		}
		const FClockworksBulletSpec& Sub = Subs[Child.SubBullet];

		FVector ChildHeading = Forward;
		const FVector Normal = SurfaceNormal.GetSafeNormal2D();
		if (Child.bRicochet && !Normal.IsNearlyZero())
		{
			ChildHeading = Forward.MirrorByVector(Normal).GetSafeNormal2D();
			if (FVector::DotProduct(ChildHeading, Normal) < 0.f)
			{
				ChildHeading = -ChildHeading;
			}
		}

		const int32 Count = FMath::Max(Child.Count, 1);
		for (int32 Index = 0; Index < Count; ++Index)
		{
			// Evenly round the whole circle, or evenly across the fan.
			float Yaw = 0.f;
			if (Child.SpreadDegrees >= 359.9f)
			{
				Yaw = 360.f * Index / Count;
			}
			else if (Count > 1)
			{
				Yaw = FMath::Lerp(-Child.SpreadDegrees * 0.5f, Child.SpreadDegrees * 0.5f, static_cast<float>(Index) / (Count - 1));
			}
			const FVector Direction = ChildHeading.RotateAngleAxis(Yaw, FVector::UpVector);

			FVector At = Location;
			if (Child.ScatterRadiusCm > 0.f)
			{
				const FVector2D Offset = FMath::RandPointInCircle(Child.ScatterRadiusCm);
				At += FVector(Offset.X, Offset.Y, 0.f);
			}

			FActorSpawnParameters SpawnParams;
			SpawnParams.Owner = Lineage.Owner;
			SpawnParams.Instigator = Lineage.Instigator;
			SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
			AClockworksProjectile* Spawned = World->SpawnActor<AClockworksProjectile>(Lineage.Class, At, Direction.Rotation(), SpawnParams);
			if (!Spawned)
			{
				continue;
			}
			// A sub-bullet with its own curve deals that; else a multiple of its parent's damage.
			const float ChildDamage = ClockworksAttackDepth::Read(Sub.DamageByDepth, UClockworksGameplayAbility::CurrentDemoDepth(World), Lineage.Damage * Child.DamageMultiplier);
			// Its damage types: the sub-bullet's own where named, else its parent's.
			FGameplayTag ChildType = Lineage.DamageType;
			FGameplayTag ChildSecondType = Lineage.SecondDamageType;
			float ChildSecondShare = Lineage.SecondDamageShare;
			if (Sub.DamageTypes.IsSet())
			{
				UClockworksGameplayAbility::ResolveDamageTypes(World, Sub.DamageTypes, Lineage.DamageType, ChildType, ChildSecondType, ChildSecondShare);
			}
			Spawned->InitProjectile(Lineage.Source, ChildDamage, Direction, Sub.SpeedCmPerSecond,
				Lineage.KnockbackMultiplier, Sub.RangeCm, ChildType);
			Spawned->InitProjectileSecondType(ChildSecondType, ChildSecondShare);
			Spawned->InitProjectileStatus(Lineage.StatusEffect, Lineage.StatusChance, Lineage.StatusSeconds, Lineage.StatusTickDamage);
			if (Lineage.IgnoredActor)
			{
				Spawned->HitActors.Add(Lineage.IgnoredActor);
			}
			Spawned->InitProjectileSpec(Sub, Lineage.Weapon, Lineage.Generation + 1);
		}
	}
}

// Runs on: every machine (multicast from the server). Cosmetic only; the damage is already done.
void AClockworksProjectile::MulticastBurst_Implementation(FVector_NetQuantize Location, float RadiusCm)
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	if (Look.BurstColor.A > 0.f && SparkClass)
	{
		const float Width = Look.BurstWidthCm > 0.f ? Look.BurstWidthCm : RadiusCm * 2.f;
		const float Height = Look.BurstHeightCm > 0.f ? Look.BurstHeightCm : Width;

		// Standing on the floor under the burst, which may be well below a bullet flying at chest height.
		FVector Base = FVector(Location) - FVector(0.f, 0.f, 80.f);
		FHitResult Floor;
		FCollisionQueryParams Params(SCENE_QUERY_STAT(ClockworksBurstFloor), /*bTraceComplex*/ false, this);
		if (World->LineTraceSingleByObjectType(Floor, FVector(Location) + FVector(0.f, 0.f, 50.f), FVector(Location) - FVector(0.f, 0.f, 600.f),
			FCollisionObjectQueryParams(ECC_WorldStatic), Params))
		{
			Base = Floor.ImpactPoint;
		}

		const FTransform Transform(Base + FVector(0.f, 0.f, Height * 0.5f));
		if (AClockworksHitSpark* Spark = World->SpawnActorDeferred<AClockworksHitSpark>(SparkClass, Transform, nullptr, nullptr, ESpawnActorCollisionHandlingMethod::AlwaysSpawn))
		{
			Spark->SetSparkColor(Look.BurstColor);
			Spark->SetSparkShape(Width * 0.15f, Width * 0.5f, Height / FMath::Max(Width, 1.f), Look.BurstSeconds);
			Spark->FinishSpawning(Transform);
		}
	}

	float Pitch = 1.f;
	if (USoundBase* Sound = Look.BurstSound.Pick(Pitch))
	{
		UGameplayStatics::PlaySoundAtLocation(this, Sound, Location, Look.BurstSound.Volume, Pitch);
	}
}
