// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksFloorBlock.h"

#include "Clockworks.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksFloorBuilder.h"
#include "ClockworksFloorDefinition.h"
#include "ClockworksGameplayTags.h"
#include "ClockworksProjectile.h"
#include "AbilitySystemComponent.h"
#include "Components/BoxComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "Net/UnrealNetwork.h"
#include "Sound/SoundBase.h"

// Runs on: all machines.
AClockworksFloorBlock::AClockworksFloorBlock()
{
	Body = CreateDefaultSubobject<UBoxComponent>(TEXT("Body"));
	Body->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
	// A knight's sword and bullets sweep for pawns, so a block answers on that channel to be hittable at all, and
	// blocks everything else so it is genuinely in the way.
	Body->SetCollisionObjectType(ECC_Pawn);
	Body->SetCollisionResponseToAllChannels(ECR_Block);
	Body->SetCollisionResponseToChannel(ECC_Pawn, ECR_Overlap);
	Body->SetGenerateOverlapEvents(true);
	Body->SetCanEverAffectNavigation(true);
	RootComponent = Body;

	BlockMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("BlockMesh"));
	BlockMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	BlockMesh->SetupAttachment(Body);

	AbilitySystemComponent = CreateDefaultSubobject<UAbilitySystemComponent>(TEXT("AbilitySystemComponent"));
	AbilitySystemComponent->SetIsReplicated(true);
	AttributeSet = CreateDefaultSubobject<UClockworksAttributeSet>(TEXT("AttributeSet"));
}

// Runs on: all machines (the engine asks once per class).
void AClockworksFloorBlock::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);

	DOREPLIFETIME(AClockworksFloorBlock, bBroken);
}

// Runs on: all machines. The server alone listens for hits.
void AClockworksFloorBlock::PostInitializeComponents()
{
	Super::PostInitializeComponents();

	AbilitySystemComponent->InitAbilityActorInfo(this, this);

	if (HasAuthority())
	{
		AttributeSet->InitMaxHealth(BlockHealth);
		AttributeSet->InitHealth(BlockHealth);
		// The monsters' faction, so a knight's weapons are willing to strike it and monsters are not.
		AbilitySystemComponent->AddLooseGameplayTag(ClockworksTags::Faction_Enemy, 1, EGameplayTagReplicationState::None);
		AttributeSet->OnDamaged.AddUObject(this, &AClockworksFloorBlock::HandleDamaged);
	}
}

// Runs on: server, before the spawn finishes.
void AClockworksFloorBlock::SetupFromMarker(const FString& InConfig, FName InTag)
{
	Super::SetupFromMarker(InConfig, InTag);

	if (Config.Contains(TEXT("Explosive")))
	{
		Kind = EClockworksBlockKind::Explosive;
	}
	else if (Config.Contains(TEXT("Treasure")))
	{
		Kind = EClockworksBlockKind::Treasure;
	}
	else if (Config.Contains(TEXT("Ghost")))
	{
		Kind = EClockworksBlockKind::Phase;
	}
	else if (Config.Contains(TEXT("Breakable")) || Config.Contains(TEXT("Crystal"))
		|| Config.Contains(TEXT("Mineral")) || Config.Contains(TEXT("Shrub"))
		|| Config.Contains(TEXT("Stone")) || Config.Contains(TEXT("Breakable Objects")))
	{
		Kind = EClockworksBlockKind::Breakable;
	}
	else
	{
		Kind = EClockworksBlockKind::Solid;
	}
}

// Runs on: all machines.
void AClockworksFloorBlock::BeginPlay()
{
	Super::BeginPlay();

	const float Tile = Floor && Floor->GetFloor() ? Floor->GetFloor()->TileCm : 100.f;
	Body->SetBoxExtent(FVector(SizeTiles.X * Tile * 0.5f, SizeTiles.Y * Tile * 0.5f, HeightCm * 0.5f));
	Body->AddLocalOffset(FVector(0.f, 0.f, HeightCm * 0.5f));

	if (Kind == EClockworksBlockKind::Phase)
	{
		// A ghost block is scenery you walk through.
		Body->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Body->SetCanEverAffectNavigation(false);
	}

	ApplyBrokenState();
}

// Runs on: server.
void AClockworksFloorBlock::HandleDamaged(AActor* InstigatorActor, AActor* Causer, float, FVector, float, float)
{
	if (!HasAuthority() || bBroken)
	{
		return;
	}

	if (Kind == EClockworksBlockKind::Solid || Kind == EClockworksBlockKind::Phase)
	{
		// Unbreakable means unbreakable. The hit lands, the block stands.
		AttributeSet->SetHealth(AttributeSet->GetMaxHealth());
		return;
	}

	if (AttributeSet->GetHealth() <= 0.f)
	{
		Break(InstigatorActor ? InstigatorActor : Causer);
	}
}

// Runs on: server.
void AClockworksFloorBlock::Break(AActor* BrokenBy)
{
	bBroken = true;
	ApplyBrokenState();

	if (Kind == EClockworksBlockKind::Explosive && Blast.RadiusCm > 0.f)
	{
		// The same blast a bullet's detonation uses, so an exploding barrel and an exploding bomb hurt the same way.
		// The blast's own damage lives in its DamageByDepth table, exactly as a bullet's detonation does.
		FClockworksBulletLineage Lineage;
		Lineage.Owner = this;
		Lineage.Source = AbilitySystemComponent;
		AClockworksProjectile::ApplyAreaHit(GetWorld(), this, Lineage, Blast, GetActorLocation(), GetActorForwardVector());
	}

	if (bSignalsWhenBroken)
	{
		RaiseSignal();
	}

	UE_LOG(LogClockworks, Warning, TEXT("Floor: block broken (%s) by %s"),
		*Config, BrokenBy ? *BrokenBy->GetName() : TEXT("nothing"));
}

// Runs on: clients.
void AClockworksFloorBlock::OnRep_Broken()
{
	ApplyBrokenState();
}

// Runs on: every machine, off the replicated state.
void AClockworksFloorBlock::ApplyBrokenState()
{
	if (!bBroken)
	{
		return;
	}

	Body->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Body->SetCanEverAffectNavigation(false);
	BlockMesh->SetVisibility(false);

	if (BreakSound && HasActorBegunPlay())
	{
		UGameplayStatics::PlaySoundAtLocation(this, BreakSound, GetActorLocation());
	}
}
