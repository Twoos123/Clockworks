// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksProjectile.h"
#include "ClockworksDamageEffect.h"
#include "ClockworksGameplayTags.h"
#include "AbilitySystemComponent.h"
#include "AbilitySystemInterface.h"
#include "Components/SphereComponent.h"
#include "Components/StaticMeshComponent.h"
#include "GameFramework/ProjectileMovementComponent.h"

// Runs on: all machines (class default object and every replicated instance).
AClockworksProjectile::AClockworksProjectile()
{
	bReplicates = true;
	SetReplicatingMovement(true);

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

	ProjectileMovement = CreateDefaultSubobject<UProjectileMovementComponent>(TEXT("ProjectileMovement"));
	ProjectileMovement->ProjectileGravityScale = 0.f;
	ProjectileMovement->bRotationFollowsVelocity = true;
	ProjectileMovement->bInitialVelocityInLocalSpace = false;
}

// Runs on: server only. The ability spawns, then calls this before the first tick.
void AClockworksProjectile::InitProjectile(UAbilitySystemComponent* InSourceAbilitySystemComponent, float InDamage, const FVector& Direction, float Speed)
{
	SourceAbilitySystemComponent = InSourceAbilitySystemComponent;
	Damage = InDamage;

	const FVector Velocity = Direction.GetSafeNormal() * Speed;
	ProjectileMovement->InitialSpeed = Speed;
	ProjectileMovement->MaxSpeed = Speed;
	ProjectileMovement->Velocity = Velocity;

	// Never hit the one who fired it.
	if (AActor* Shooter = GetInstigator())
	{
		CollisionSphere->IgnoreActorWhenMoving(Shooter, true);
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
	if (bConsumed || !OtherActor || OtherActor == GetInstigator())
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

	// Same faction as the shooter: pass straight through (shots don't hurt other enemies).
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

	bConsumed = true;

	FGameplayEffectContextHandle Context = Source->MakeEffectContext();
	Context.AddInstigator(Source->GetOwnerActor(), this);
	const FHitResult Hit(OtherActor, OtherComponent, OtherActor->GetActorLocation(), -GetVelocity().GetSafeNormal());
	Context.AddHitResult(Hit);

	FGameplayEffectSpecHandle SpecHandle = Source->MakeOutgoingSpec(UClockworksDamageEffect::StaticClass(), 1.f, Context);
	if (SpecHandle.IsValid())
	{
		SpecHandle.Data->SetSetByCallerMagnitude(ClockworksTags::Data_Damage, Damage);
		Source->ApplyGameplayEffectSpecToTarget(*SpecHandle.Data, TargetAbilitySystemComponent);
	}

	Destroy();
}

// Runs on: server only. Walls stop shots; that is what "break line of sight" means.
void AClockworksProjectile::OnSphereHit(UPrimitiveComponent* HitComponent, AActor* OtherActor, UPrimitiveComponent* OtherComponent, FVector NormalImpulse, const FHitResult& Hit)
{
	if (!bConsumed)
	{
		bConsumed = true;
		Destroy();
	}
}
