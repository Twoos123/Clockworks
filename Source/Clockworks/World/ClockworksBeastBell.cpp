// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksBeastBell.h"
#include "Clockworks.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksEnemyCharacter.h"
#include "ClockworksGameplayTags.h"
#include "ClockworksStatusEffects.h"
#include "AbilitySystemComponent.h"
#include "AbilitySystemInterface.h"
#include "Animation/AnimSequenceBase.h"
#include "CollisionQueryParams.h"
#include "Components/SkeletalMeshComponent.h"
#include "Engine/OverlapResult.h"
#include "Engine/World.h"
#include "GameFramework/Pawn.h"
#include "Kismet/GameplayStatics.h"
#include "Net/UnrealNetwork.h"
#include "Sound/SoundBase.h"
#include "TimerManager.h"

// Runs on: all machines (class default object and every replicated instance).
AClockworksBeastBell::AClockworksBeastBell()
{
	PrimaryActorTick.bCanEverTick = false;
	bReplicates = true;

	BellMesh = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("BellMesh"));
	// A knight's sword and bullets sweep for pawns, so the bell answers on that channel: it is not a pawn, but it is
	// something you hit, and that is the only channel the weapons look at.
	BellMesh->SetCollisionObjectType(ECC_Pawn);
	BellMesh->SetCollisionResponseToAllChannels(ECR_Block);
	BellMesh->SetCollisionResponseToChannel(ECC_Pawn, ECR_Overlap);
	BellMesh->SetGenerateOverlapEvents(true);
	RootComponent = BellMesh;

	AbilitySystemComponent = CreateDefaultSubobject<UAbilitySystemComponent>(TEXT("AbilitySystemComponent"));
	AbilitySystemComponent->SetIsReplicated(true);
	AttributeSet = CreateDefaultSubobject<UClockworksAttributeSet>(TEXT("AttributeSet"));

	StunEffect = UClockworksStatusStunEffect::StaticClass();
}

// Runs on: all machines (the engine asks once per class).
void AClockworksBeastBell::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);

	DOREPLIFETIME(AClockworksBeastBell, bOnCooldown);
}

// Runs on: all machines. The server alone listens for hits.
void AClockworksBeastBell::PostInitializeComponents()
{
	Super::PostInitializeComponents();

	AbilitySystemComponent->InitAbilityActorInfo(this, this);

	if (HasAuthority())
	{
		// Health it will never spend: the bell cannot be destroyed, and HandleDamaged puts it back after every hit.
		AttributeSet->InitMaxHealth(1000.f);
		AttributeSet->InitHealth(1000.f);

		// The monsters' faction, so a knight's weapons are willing to strike it and monsters are not.
		AbilitySystemComponent->AddLooseGameplayTag(ClockworksTags::Faction_Enemy, 1, EGameplayTagReplicationState::None);

		AttributeSet->OnDamaged.AddUObject(this, &AClockworksBeastBell::HandleDamaged);
	}
}

// Runs on: all machines.
void AClockworksBeastBell::BeginPlay()
{
	Super::BeginPlay();

	PlayClip(ReadyAnim);
}

// Runs on: server only (bound there). Any hit rings it, whatever the damage: the original's bell has no health.
void AClockworksBeastBell::HandleDamaged(AActor* InstigatorActor, AActor* Causer, float Amount, FVector HitDirection, float KnockbackMultiplier, float FamilyMultiplier)
{
	// The bell never actually loses anything, so put back whatever the hit took.
	AttributeSet->SetHealth(AttributeSet->GetMaxHealth());

	if (bOnCooldown)
	{
		MulticastDullHit();
		return;
	}
	Ring(InstigatorActor);
}

// Runs on: server only. Every beast in range is stunned; the Snarbolax gets its own longer one, which is the only
// window in which it can be hurt.
void AClockworksBeastBell::Ring(AActor* RungBy)
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	bOnCooldown = true;
	OnRep_OnCooldown();
	World->GetTimerManager().SetTimer(CooldownTimer, this, &AClockworksBeastBell::EndCooldown, FMath::Max(CooldownSeconds, 0.01f), false);
	MulticastRing();

	TArray<FOverlapResult> Overlaps;
	FCollisionQueryParams Params(SCENE_QUERY_STAT(ClockworksBeastBellRing), /*bTraceComplex*/ false);
	Params.AddIgnoredActor(this);
	World->OverlapMultiByObjectType(Overlaps, GetActorLocation(), FQuat::Identity, FCollisionObjectQueryParams(ECC_Pawn),
		FCollisionShape::MakeSphere(RingRadius), Params);

	TSet<UAbilitySystemComponent*> Stunned;
	for (const FOverlapResult& Overlap : Overlaps)
	{
		AClockworksEnemyCharacter* Monster = Cast<AClockworksEnemyCharacter>(Overlap.GetActor());
		if (!Monster)
		{
			continue;
		}
		UAbilitySystemComponent* Target = Monster->GetAbilitySystemComponent();
		if (!Target || Stunned.Contains(Target) || Target->HasMatchingGameplayTag(ClockworksTags::State_Dead))
		{
			continue;
		}

		// Wolvers and the Snarbolax only (the user's decision 2026-09-15), matched on the Blueprint's name because that
		// is what the generated monsters are told apart by.
		const FString MonsterName = GetNameSafe(Monster->GetClass());
		const bool bMatches = StunsMonstersNamed.ContainsByPredicate(
			[&MonsterName](const FString& Word) { return !Word.IsEmpty() && MonsterName.Contains(Word); });
		if (!bMatches)
		{
			continue;
		}

		Stunned.Add(Target);
		const bool bBoss = !BossNamed.IsEmpty() && MonsterName.Contains(BossNamed);
		StunTarget(Target, bBoss ? BossStunSeconds : BeastStunSeconds);
	}

	UE_LOG(LogClockworks, Log, TEXT("Beast bell: rung by %s, stunned %d"), *GetNameSafe(RungBy), Stunned.Num());
}

// Runs on: server only. The stun carries its length as a SetByCaller, like every other status in the game.
void AClockworksBeastBell::StunTarget(UAbilitySystemComponent* Target, float Seconds) const
{
	if (!Target || !StunEffect || Seconds <= 0.f)
	{
		return;
	}
	const FGameplayEffectSpecHandle Spec = AbilitySystemComponent->MakeOutgoingSpec(StunEffect, 1.f, AbilitySystemComponent->MakeEffectContext());
	if (!Spec.IsValid())
	{
		return;
	}
	Spec.Data->SetSetByCallerMagnitude(ClockworksTags::Data_Duration, Seconds);
	// No damage of its own: the bell stuns, the knights do the hurting.
	Spec.Data->SetSetByCallerMagnitude(ClockworksTags::Data_Damage, 0.f);
	AbilitySystemComponent->ApplyGameplayEffectSpecToTarget(*Spec.Data, Target);
}

// Runs on: server only.
void AClockworksBeastBell::EndCooldown()
{
	bOnCooldown = false;
	OnRep_OnCooldown();
}

// Runs on: every machine (multicast from the server). Cosmetic: the stuns are already applied.
void AClockworksBeastBell::MulticastRing_Implementation()
{
	PlayClip(RingAnim);
	if (RingSound)
	{
		UGameplayStatics::PlaySoundAtLocation(this, RingSound, GetActorLocation());
	}
}

// Runs on: every machine (multicast from the server). The flat clank of a bell that is not ready.
void AClockworksBeastBell::MulticastDullHit_Implementation()
{
	if (DullSound)
	{
		UGameplayStatics::PlaySoundAtLocation(this, DullSound, GetActorLocation());
	}
}

// Runs on: clients when the cooldown changes, and the server calls it directly. Cosmetic only.
void AClockworksBeastBell::OnRep_OnCooldown()
{
	if (!bOnCooldown)
	{
		PlayClip(ReadyAnim);
	}
}

// Runs on: this machine only. The bell is a skinned prop, so its clips play in single-node mode with no
// Animation Blueprint, exactly as the generated monsters do.
void AClockworksBeastBell::PlayClip(UAnimSequenceBase* Clip, float PlayRate)
{
	if (!Clip || !BellMesh)
	{
		return;
	}
	BellMesh->PlayAnimation(Clip, /*bLooping*/ false);
	BellMesh->SetPlayRate(PlayRate);
}
