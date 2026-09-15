// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksBomb.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksDamageEffect.h"
#include "ClockworksGameplayAbility.h"
#include "ClockworksGameplayTags.h"
#include "ClockworksHitSpark.h"
#include "ClockworksProjectile.h"
#include "ClockworksWeaponDefinition.h"
#include "Clockworks.h"
#include "AbilitySystemComponent.h"
#include "AbilitySystemInterface.h"
#include "CollisionQueryParams.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/OverlapResult.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Net/UnrealNetwork.h"
#include "Sound/SoundBase.h"
#include "TimerManager.h"
#include "UObject/ConstructorHelpers.h"

// Runs on: all machines (class default object and every spawned instance).
AClockworksBomb::AClockworksBomb()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = true;

	// The bomb is a real thing in the world that both players must be able to see and plan around,
	// so it replicates. Its damage is still decided only on the server.
	bReplicates = true;
	SetReplicateMovement(true);

	BombMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("BombMesh"));
	RootComponent = BombMesh;
	BombMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	BombMesh->SetCastShadow(true);

	// The floor ring: flat, unlit, and exactly the size of the blast, so the warning never lies
	// about where it is safe to stand.
	BlastIndicatorMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("BlastIndicatorMesh"));
	BlastIndicatorMesh->SetupAttachment(RootComponent);
	BlastIndicatorMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	BlastIndicatorMesh->SetCastShadow(false);
	BlastIndicatorMesh->bReceivesDecals = false;

	static ConstructorHelpers::FObjectFinder<UStaticMesh> SphereMesh(TEXT("/Engine/BasicShapes/Sphere.Sphere"));
	if (SphereMesh.Succeeded())
	{
		BombMesh->SetStaticMesh(SphereMesh.Object);
		BlastIndicatorMesh->SetStaticMesh(SphereMesh.Object);
		// A default bomb body about a third of a metre across, until a real model is assigned.
		BombMesh->SetRelativeScale3D(FVector(0.35f));
	}
}

// Runs on: all machines (the engine asks once per class).
void AClockworksBomb::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);

	DOREPLIFETIME(AClockworksBomb, bDetonated);
	DOREPLIFETIME_CONDITION(AClockworksBomb, SourceWeapon, COND_InitialOnly);
	DOREPLIFETIME_CONDITION(AClockworksBomb, BodyMode, COND_InitialOnly);
}

// Runs on: server only, right after spawning.
void AClockworksBomb::HideBody(bool bSilent)
{
	if (!HasAuthority())
	{
		return;
	}
	BodyMode = bSilent ? 2 : 1;
	ApplyBodyMode();
}

// Runs on: server only. The status is rolled on the server with the damage, so it never replicates.
void AClockworksBomb::InitBombStatus(TSubclassOf<UGameplayEffect> InStatusEffect, float InChance, float InSeconds, float InTickDamage)
{
	if (!HasAuthority())
	{
		return;
	}
	StatusEffect = InStatusEffect;
	StatusChance = InChance;
	StatusSeconds = InSeconds;
	StatusTickDamage = InTickDamage;
}

// Runs on: clients, when the server's choice arrives with the bomb.
void AClockworksBomb::OnRep_BodyMode()
{
	ApplyBodyMode();
}

// Runs on: every machine. Only the body: the ring attached to it stays, since it warns of the blast.
void AClockworksBomb::ApplyBodyMode()
{
	if (BodyMode != 0 && BombMesh)
	{
		BombMesh->SetHiddenInGame(true, /*bPropagateToChildren*/ false);
	}
}

// Runs on: clients, when the server's choice of weapon arrives.
void AClockworksBomb::OnRep_SourceWeapon()
{
	ApplyAppearance();
}

// Runs on: every machine. Cosmetic. The component's scale is left as the Blueprint set it, so every
// bomb model sits at the size the Proto Bomb was tuned to.
void AClockworksBomb::ApplyAppearance()
{
	if (!BombMesh || !SourceWeapon || !SourceWeapon->Mesh)
	{
		return;
	}
	UClockworksWeaponDefinition::ShowModel(SourceWeapon, BombMesh, BombExtraMeshes);
}

// Runs on: every machine. Cosmetic.
void AClockworksBomb::PlayDropSound()
{
	if (BodyMode != 0)
	{
		return;
	}
	if (SourceWeapon && SourceWeapon->Attack.DropSound.IsSet())
	{
		float Pitch = 1.f;
		if (USoundBase* Sound = SourceWeapon->Attack.DropSound.Pick(Pitch))
		{
			UGameplayStatics::PlaySoundAtLocation(this, Sound, GetActorLocation(), SourceWeapon->Attack.DropSound.Volume, Pitch);
		}
		return;
	}
	UGameplayStatics::PlaySoundAtLocation(this, ArmSound, GetActorLocation());
}

// Runs on: all machines. The fuse timer is server-only; the pulse is everyone's.
void AClockworksBomb::BeginPlay()
{
	Super::BeginPlay();

	if (IndicatorMaterial && BlastIndicatorMesh)
	{
		IndicatorMaterialInstance = UMaterialInstanceDynamic::Create(IndicatorMaterial, this);
		BlastIndicatorMesh->SetMaterial(0, IndicatorMaterialInstance);
		IndicatorMaterialInstance->SetVectorParameterValue(IndicatorColorParameterName, IndicatorColor);
	}

	// The engine sphere is 100 cm across, so a radius in centimetres is scale = radius / 50. Flattened
	// on Z so it reads as a mark on the floor rather than a dome the player might think is solid.
	if (BlastIndicatorMesh)
	{
		const float Scale = BlastRadius / 50.f;
		BlastIndicatorMesh->SetRelativeScale3D(FVector(Scale, Scale, 0.04f));
	}

	// Local: everyone hears it land where it landed. Next tick, because the server only hands the bomb its
	// weapon after spawning it, and the weapon decides the sound.
	GetWorldTimerManager().SetTimerForNextTick(FTimerDelegate::CreateUObject(this, &AClockworksBomb::PlayDropSound));

	if (HasAuthority())
	{
		GetWorldTimerManager().SetTimer(FuseTimer, this, &AClockworksBomb::Detonate, FMath::Max(FuseSeconds, 0.1f), false);
	}
}

// Runs on: all machines. Cosmetic only: the countdown the player reads.
void AClockworksBomb::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	if (bDetonated || !IndicatorMaterialInstance)
	{
		return;
	}

	FuseElapsed += DeltaSeconds;
	const float Alpha = FMath::Clamp(FuseElapsed / FMath::Max(FuseSeconds, 0.1f), 0.f, 1.f);

	// A pulse that speeds up as the fuse burns down: the flashes bunch together towards the end,
	// which reads as "now" without needing a number on screen.
	const float Phase = FMath::Square(Alpha) * IndicatorPulses * 2.f * PI;
	const float Pulse = 0.5f + 0.5f * FMath::Sin(Phase);

	// Never fully transparent: the ring has to stay legible as a keep-out area the whole time.
	IndicatorMaterialInstance->SetScalarParameterValue(IndicatorOpacityParameterName, 0.25f + 0.55f * Pulse);
}

// Runs on: server only. Called right after spawning, before anything can happen to the bomb.
void AClockworksBomb::InitBomb(UAbilitySystemComponent* InOwnerAbilitySystemComponent, float InDamage, float InRadius, float InKnockbackMultiplier, const FGameplayTag& InDamageType, const UClockworksWeaponDefinition* InWeapon, float InFuseSeconds)
{
	// The fuse started in BeginPlay, which ran inside SpawnActor before this was called. A weapon with
	// its own fuse restarts it with that length.
	if (HasAuthority() && InFuseSeconds > 0.f)
	{
		FuseSeconds = InFuseSeconds;
		FuseElapsed = 0.f;
		GetWorldTimerManager().SetTimer(FuseTimer, this, &AClockworksBomb::Detonate, FuseSeconds, false);
	}

	if (!HasAuthority())
	{
		return;
	}

	// A data asset is never modified through this pointer; the property is non-const only because
	// replicated object properties are.
	SourceWeapon = const_cast<UClockworksWeaponDefinition*>(InWeapon);
	ApplyAppearance();

	OwnerAbilitySystemComponent = InOwnerAbilitySystemComponent;
	BlastDamage = InDamage;
	KnockbackMultiplier = InKnockbackMultiplier;
	if (InDamageType.IsValid())
	{
		DamageType = InDamageType;
	}

	if (InRadius > 0.f)
	{
		BlastRadius = InRadius;
		if (BlastIndicatorMesh)
		{
			const float Scale = BlastRadius / 50.f;
			BlastIndicatorMesh->SetRelativeScale3D(FVector(Scale, Scale, 0.04f));
		}
	}
}

// Runs on: server only. The one place a bomb does anything that matters.
void AClockworksBomb::Detonate()
{
	if (!HasAuthority() || bDetonated)
	{
		return;
	}
	bDetonated = true;

	UWorld* World = GetWorld();
	UAbilitySystemComponent* SourceAbilitySystemComponent = OwnerAbilitySystemComponent.Get();
	if (World && SourceAbilitySystemComponent)
	{
		const FGameplayTag SourceFaction = UClockworksGameplayAbility::GetFactionTag(SourceAbilitySystemComponent);
		const FVector Centre = GetActorLocation();

		TArray<FOverlapResult> Overlaps;
		FCollisionQueryParams Params(SCENE_QUERY_STAT(ClockworksBombBlast), /*bTraceComplex*/ false);
		Params.AddIgnoredActor(this);

		World->OverlapMultiByObjectType(
			Overlaps, Centre, FQuat::Identity,
			FCollisionObjectQueryParams(FCollisionObjectQueryParams::InitType::AllDynamicObjects),
			FCollisionShape::MakeSphere(BlastRadius), Params);

		// What the weapon's data adds to its blast: a vortex's pull, and what the blast breaks into.
		const FClockworksBulletBurst* WeaponBurst = SourceWeapon ? &SourceWeapon->Attack.ChargedAttack.Bullet.Detonation : nullptr;
		const bool bPulls = WeaponBurst && WeaponBurst->Knockback < 0.f;

		// One hit per actor however many of its components the sphere caught.
		TSet<AActor*> Damaged;
		for (const FOverlapResult& Overlap : Overlaps)
		{
			AActor* HitActor = Overlap.GetActor();
			if (!HitActor || Damaged.Contains(HitActor))
			{
				continue;
			}

			const IAbilitySystemInterface* AbilityInterface = Cast<IAbilitySystemInterface>(HitActor);
			UAbilitySystemComponent* TargetAbilitySystemComponent = AbilityInterface ? AbilityInterface->GetAbilitySystemComponent() : nullptr;
			if (!TargetAbilitySystemComponent)
			{
				continue;
			}

			// Your own bomb does not hurt you, which is what lets you fight at the edge of a blast.
			const bool bIsOwner = TargetAbilitySystemComponent == SourceAbilitySystemComponent;
			if (bIsOwner && !bDamagesOwner)
			{
				continue;
			}

			// Same faction is spared: two players never blow each other up.
			const FGameplayTag TargetFaction = UClockworksGameplayAbility::GetFactionTag(TargetAbilitySystemComponent);
			if (!bIsOwner && SourceFaction.IsValid() && TargetFaction == SourceFaction)
			{
				continue;
			}

			Damaged.Add(HitActor);

			FGameplayEffectContextHandle Context = SourceAbilitySystemComponent->MakeEffectContext();
			Context.AddInstigator(SourceAbilitySystemComponent->GetOwnerActor(), this);
			// The weapon rides along like an ability's hit carries it, so the target's rules can see which weapon struck.
			Context.AddSourceObject(SourceWeapon);

			const FGameplayEffectSpecHandle DamageSpec = SourceAbilitySystemComponent->MakeOutgoingSpec(
				UClockworksDamageEffect::StaticClass(), 1.f, Context);
			if (!DamageSpec.IsValid())
			{
				continue;
			}

			float AttackPower = 0.f;
			if (const UClockworksAttributeSet* SourceAttributes = SourceAbilitySystemComponent->GetSet<UClockworksAttributeSet>())
			{
				AttackPower = SourceAttributes->GetAttackPower();
			}

			// Full damage anywhere inside the blast, as the original appears to do (user's decision 2026-09-15).
			UClockworksGameplayAbility::SetSplitDamageMagnitudes(DamageSpec, BlastDamage + AttackPower, DamageType, SecondDamageType, SecondDamageShare);
			if (bPulls)
			{
				// A Graviton's blast draws everything in rather than throwing it out.
				DamageSpec.Data->SetSetByCallerMagnitude(ClockworksTags::Data_Knockback, -WeaponBurst->Knockback);
				DamageSpec.Data->SetSetByCallerMagnitude(ClockworksTags::Data_KnockbackAngle, 180.f);
			}
			else
			{
				DamageSpec.Data->SetSetByCallerMagnitude(ClockworksTags::Data_Knockback, KnockbackMultiplier);
			}
			SourceAbilitySystemComponent->ApplyGameplayEffectSpecToTarget(*DamageSpec.Data, TargetAbilitySystemComponent);
			UClockworksGameplayAbility::TryApplyStatus(SourceAbilitySystemComponent, TargetAbilitySystemComponent,
				StatusEffect, StatusChance, StatusSeconds, StatusTickDamage);
		}

		UE_LOG(LogClockworks, Log, TEXT("Bomb: blast %.0f damage, %.0f cm, hit %d"), BlastDamage, BlastRadius, Damaged.Num());

		// What the blast breaks into (a Shard Bomb's shards, a Vaporizer's cloud, a Graviton's implosion),
		// fighting in the thrower's name with the blast's damage and status.
		if (WeaponBurst && WeaponBurst->Children.Num() > 0)
		{
			if (!ChildBulletClass)
			{
				UE_LOG(LogClockworks, Warning, TEXT("%s has no ChildBulletClass; %s's blast leaves nothing behind. Run make_bullet_materials.py."),
					*GetNameSafe(GetClass()), *GetNameSafe(SourceWeapon));
			}
			else
			{
				float AttackPower = 0.f;
				if (const UClockworksAttributeSet* SourceAttributes = SourceAbilitySystemComponent->GetSet<UClockworksAttributeSet>())
				{
					AttackPower = SourceAttributes->GetAttackPower();
				}
				FClockworksBulletLineage Lineage;
				Lineage.Class = ChildBulletClass.Get();
				Lineage.Owner = GetOwner();
				Lineage.Instigator = GetInstigator();
				Lineage.Source = SourceAbilitySystemComponent;
				Lineage.Weapon = SourceWeapon.Get();
				Lineage.Damage = BlastDamage + AttackPower;
				Lineage.KnockbackMultiplier = KnockbackMultiplier;
				Lineage.DamageType = DamageType;
				Lineage.SecondDamageType = SecondDamageType;
				Lineage.SecondDamageShare = SecondDamageShare;
				Lineage.StatusEffect = StatusEffect;
				Lineage.StatusChance = StatusChance;
				Lineage.StatusSeconds = StatusSeconds;
				Lineage.StatusTickDamage = StatusTickDamage;
				AClockworksProjectile::SpawnChildren(World, Lineage, WeaponBurst->Children, Centre + FVector(0.f, 0.f, ChildBulletHeightCm),
					FVector::ForwardVector, FVector::ZeroVector);
			}
		}
	}

	MulticastBlast();
	SetLifeSpan(FMath::Max(DestroyDelaySeconds, 0.1f));
}

// Runs on: all machines (multicast from the server). Cosmetic only; the damage is already done.
void AClockworksBomb::MulticastBlast_Implementation()
{
	bDetonated = true;

	if (BombMesh)
	{
		BombMesh->SetHiddenInGame(true, /*bPropagateToChildren*/ true);
	}
	if (BlastIndicatorMesh)
	{
		BlastIndicatorMesh->SetHiddenInGame(true);
	}

	// The weapon's own detonation when its data names one: a Shard Bomb shatters, a Big Angry Bomb booms low.
	if (SourceWeapon && SourceWeapon->Attack.ImpactSound.IsSet())
	{
		for (const FClockworksWeaponSound* Layer : { &SourceWeapon->Attack.ImpactSound, &SourceWeapon->Attack.ImpactExtraSound })
		{
			float Pitch = 1.f;
			if (USoundBase* Sound = Layer->Pick(Pitch))
			{
				UGameplayStatics::PlaySoundAtLocation(this, Sound, GetActorLocation(), Layer->Volume, Pitch);
			}
		}
	}
	else if (BodyMode != 2)
	{
		UGameplayStatics::PlaySoundAtLocation(this, BlastSound, GetActorLocation());
	}

	// The flash, sized to the blast so what you see is what hurt you.
	if (UWorld* World = GetWorld(); World && BlastSparkClass)
	{
		FActorSpawnParameters SpawnParams;
		SpawnParams.Owner = this;
		SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		if (AClockworksHitSpark* Spark = World->SpawnActorDeferred<AClockworksHitSpark>(
			BlastSparkClass, FTransform(GetActorLocation()), this, nullptr,
			ESpawnActorCollisionHandlingMethod::AlwaysSpawn))
		{
			Spark->SetSparkColor(IndicatorColor);
			Spark->FinishSpawning(FTransform(GetActorLocation()));
		}
	}
}

// Runs on: clients, when the server's detonation arrives. Covers a client that was not listening
// when the multicast went out (it joined late, or was out of relevancy range).
void AClockworksBomb::OnRep_Detonated()
{
	if (BombMesh)
	{
		BombMesh->SetHiddenInGame(true, /*bPropagateToChildren*/ true);
	}
	if (BlastIndicatorMesh)
	{
		BlastIndicatorMesh->SetHiddenInGame(true);
	}
}
