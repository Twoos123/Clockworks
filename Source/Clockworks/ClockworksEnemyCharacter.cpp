// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksEnemyCharacter.h"
#include "Clockworks.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksEnemyAIController.h"
#include "ClockworksEnemyHealthBar.h"
#include "ClockworksGameplayTags.h"
#include "GameplayTagsManager.h"
#include "ClockworksDamageNumber.h"
#include "ClockworksHitSpark.h"
#include "ClockworksStatusDisplay.h"
#include "World/ClockworksGameState.h"
#include "Components/WidgetComponent.h"
#include "AbilitySystemComponent.h"
#include "Abilities/GameplayAbility.h"
#include "Animation/AnimInstance.h"
#include "Animation/AnimMontage.h"
#include "Animation/AnimSequenceBase.h"
#include "GameFramework/Controller.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Materials/MaterialInterface.h"
#include "Kismet/GameplayStatics.h"
#include "Sound/SoundBase.h"
#include "TimerManager.h"

// Runs on: all machines (class default object and every instance).
AClockworksEnemyCharacter::AClockworksEnemyCharacter()
{
	AbilitySystemComponent = CreateDefaultSubobject<UAbilitySystemComponent>(TEXT("AbilitySystemComponent"));
	AbilitySystemComponent->SetIsReplicated(true);

	// Minimal: attributes still replicate; effects and tags stay on the server, which is where every
	// check on an enemy runs. Cheapest mode, and the right one for AI-controlled actors.
	AbilitySystemComponent->SetReplicationMode(EGameplayEffectReplicationMode::Minimal);

	AttributeSet = CreateDefaultSubobject<UClockworksAttributeSet>(TEXT("AttributeSet"));

	HeadMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("HeadMesh"));
	HeadMesh->SetupAttachment(GetMesh(), HeadSocketName);
	HeadMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	// Screen space keeps the bar the same size and always camera-facing, which is what a fixed
	// isometric view needs; a world-space quad would foreshorten and turn edge-on.
	// Statuses show as their own shell, so they can appear at the same time as the hit flash or the
	// attack telegraph, which both already own the mesh's overlay slot.
	StatusDisplay = CreateDefaultSubobject<UClockworksStatusDisplay>(TEXT("StatusDisplay"));

	// Direct animation mode picks its loop each frame, so the enemy has to tick.
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = true;

	HealthBarWidget = CreateDefaultSubobject<UWidgetComponent>(TEXT("HealthBarWidget"));
	HealthBarWidget->SetupAttachment(RootComponent);
	HealthBarWidget->SetWidgetSpace(EWidgetSpace::Screen);
	HealthBarWidget->SetDrawSize(FVector2D(90.f, 12.f));
	HealthBarWidget->SetWidgetClass(UClockworksEnemyHealthBar::StaticClass());
	HealthBarWidget->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	HealthBarWidget->SetGenerateOverlapEvents(false);
	HealthBarWidget->SetRelativeLocation(FVector(0.f, 0.f, HealthBarHeight));

	// Enemies face the way they move; attacks turn them explicitly during the telegraph.
	bUseControllerRotationYaw = false;
	GetCharacterMovement()->bOrientRotationToMovement = true;
	GetCharacterMovement()->RotationRate = FRotator(0.f, 540.f, 0.f);
	GetCharacterMovement()->bConstrainToPlane = true;
	GetCharacterMovement()->bSnapToPlaneAtStart = true;

	// Every enemy gets the shared brain unless a Blueprint child says otherwise. AI controllers only
	// exist on the server, so this is where all enemy decisions are made.
	AIControllerClass = AClockworksEnemyAIController::StaticClass();
	AutoPossessAI = EAutoPossessAI::PlacedInWorldOrSpawned;

	// The number needs no assets of its own, so the C++ class is enough; no Blueprint to assign.
	DamageNumberClass = AClockworksDamageNumber::StaticClass();
}

// Runs on: all machines. The component needs to know its owner and avatar everywhere so replicated
// attributes land in the right place; gameplay setup below is server only.
void AClockworksEnemyCharacter::PostInitializeComponents()
{
	Super::PostInitializeComponents();

	AbilitySystemComponent->InitAbilityActorInfo(this, this);

	if (HasAuthority())
	{
		// The original's health at the party's depth when this monster carries it (monsters are spawned for a floor
		// after its depth is set); the flat number otherwise.
		const AClockworksGameState* GameState = GetWorld() ? GetWorld()->GetGameState<AClockworksGameState>() : nullptr;
		const int32 Depth = GameState ? GameState->GetDepth() : 0;
		const float StartHealth = HealthByDepth.Num() > 0 ? HealthByDepth[FMath::Clamp(Depth, 0, HealthByDepth.Num() - 1)] : InitialHealth;
		AttributeSet->InitMaxHealth(StartHealth);
		AttributeSet->InitHealth(StartHealth);
		AttributeSet->InitAttackPower(InitialAttackPower);
		AttributeSet->InitDefensePower(InitialDefensePower);
		AttributeSet->InitMoveSpeed(InitialMoveSpeed);

		AbilitySystemComponent->AddLooseGameplayTag(ClockworksTags::Faction_Enemy, 1, EGameplayTagReplicationState::None);

		// The family decides what this enemy is weak and strong against. It has to reach every
		// machine, not just the server: the health bar and the targeting readout show it.
		if (FamilyTag.IsValid())
		{
			AbilitySystemComponent->AddLooseGameplayTag(FamilyTag, 1, EGameplayTagReplicationState::TagAndCountToAll);
		}

		for (const TSubclassOf<UGameplayAbility>& AbilityClass : DefaultAbilities)
		{
			if (AbilityClass)
			{
				AbilitySystemComponent->GiveAbility(FGameplayAbilitySpec(AbilityClass, 1, INDEX_NONE, this));
			}
		}

		AttributeSet->OnDamaged.AddUObject(this, &AClockworksEnemyCharacter::HandleDamaged);
		AttributeSet->OnOutOfHealth.AddUObject(this, &AClockworksEnemyCharacter::HandleOutOfHealth);
		// Guarded from the moment it spawns, until something stuns it (a bell boss) or its rage lets up.
		bRageGuarded = true;
		RefreshGuard();
		if (RageGuardSeconds > 0.f && RageOpenSeconds > 0.f)
		{
			GetWorldTimerManager().SetTimer(RageTimer, this, &AClockworksEnemyCharacter::TickRage, RageGuardSeconds, false);
		}
		// A stage that hands over on its own clock rather than by being killed (the Royal Jelly's transition).
		if (StageSeconds > 0.f)
		{
			GetWorldTimerManager().SetTimer(StageTimer, this, &AClockworksEnemyCharacter::AdvanceStage, StageSeconds, false);
		}
		// What it keeps around it: the jelly's polyps, a polyp's Royal Minis.
		if (MinionClass && MinionCount > 0)
		{
			SpawnMinions();
		}
		if ((MinionClass && bMinionsRespawn) || AbsorbMinionClass)
		{
			GetWorldTimerManager().SetTimer(MinionTimer, this, &AClockworksEnemyCharacter::TickMinions,
				FMath::Max(MinionRespawnSeconds, 0.5f), true);
		}
		// A cursed monster pays for each attack it uses.
		AbilitySystemComponent->AbilityActivatedCallbacks.AddUObject(ToRawPtr(AttributeSet), &UClockworksAttributeSet::HandleAbilityActivated);
		AbilitySystemComponent->RegisterGameplayTagEvent(ClockworksTags::State_MovementLocked, EGameplayTagEventType::NewOrRemoved).AddUObject(this, &AClockworksEnemyCharacter::OnMovementLockChanged);
		AbilitySystemComponent->RegisterGameplayTagEvent(ClockworksTags::State_Stunned, EGameplayTagEventType::NewOrRemoved).AddUObject(this, &AClockworksEnemyCharacter::OnStunnedChanged);
	}

	GetCharacterMovement()->MaxWalkSpeed = InitialMoveSpeed;
}

// Runs on: anywhere (class defaults and the replicated depth).
float AClockworksEnemyCharacter::GetDefenseAt(int32 Kind, int32 DemoDepth) const
{
	const TArray<float>* Tables[] = { &NormalDefenseByDepth, &PiercingDefenseByDepth, &ElementalDefenseByDepth, &ShadowDefenseByDepth };
	const TArray<float>& Table = *Tables[FMath::Clamp(Kind, 0, 3)];
	return Table.Num() > 0 ? Table[FMath::Clamp(DemoDepth, 0, Table.Num() - 1)] : 0.f;
}

// Runs on: all machines. The bar is built by the widget component on demand, so it only exists after
// the component has initialised; pointing it at this enemy here is the first safe moment.
void AClockworksEnemyCharacter::BeginPlay()
{
	Super::BeginPlay();

	if (HealthBarWidget)
	{
		HealthBarWidget->SetRelativeLocation(FVector(0.f, 0.f, HealthBarHeight));
		// A dedicated server has no widgets; InitWidget is a no-op there and the cast simply fails.
		HealthBarWidget->InitWidget();
		if (UClockworksEnemyHealthBar* Bar = Cast<UClockworksEnemyHealthBar>(HealthBarWidget->GetUserWidgetObject()))
		{
			Bar->SetTargetActor(this);
		}
	}
}

// Runs on: server only (the tag is added by the server-only attack ability). Enemy movement is
// server-authoritative, so the speed change reaches clients as replicated motion.
void AClockworksEnemyCharacter::OnMovementLockChanged(const FGameplayTag Tag, int32 NewCount)
{
	GetCharacterMovement()->MaxWalkSpeed = NewCount > 0 ? 0.f : InitialMoveSpeed;
}

// Runs on: server only (the stun effect is applied by the server's shield bash). A stunned enemy
// drops whatever it was doing; the brain reads the tag and waits, the abilities refuse to start.
void AClockworksEnemyCharacter::OnStunnedChanged(const FGameplayTag Tag, int32 NewCount)
{
	if (bDead)
	{
		return;
	}
	if (NewCount > 0)
	{
		AbilitySystemComponent->CancelAllAbilities();
		HealthAtStunStart = AttributeSet ? AttributeSet->GetHealth() : 0.f;
		if (AController* MyController = GetController())
		{
			MyController->StopMovement();
		}
		// The walk speed may have been zeroed by the cancelled attack's lock; the cancel removed the
		// tag, so put the speed back for when the stun ends.
		if (!AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_MovementLocked))
		{
			GetCharacterMovement()->MaxWalkSpeed = InitialMoveSpeed;
		}
	}
	// A guarded monster is only open while the stun lasts.
	RefreshGuard();
	MulticastSetStunned(NewCount > 0);
}

// Runs on: server only. State.Guarded turns every hit into no damage (the attribute set); a stun takes it off, which is
// the whole of the Snarbolax's fight.
void AClockworksEnemyCharacter::RefreshGuard()
{
	if (!AbilitySystemComponent || !HasAuthority())
	{
		return;
	}
	// A raging stage guards on its own clock (TickRage); a bell boss guards until it is stunned. Anything else never
	// carries the tag, so it is only ever removed here if something else put it on.
	const bool bRages = RageGuardSeconds > 0.f && RageOpenSeconds > 0.f;
	if (!bGuardedUntilStunned && !bRages)
	{
		return;
	}
	const bool bRageOpen = bRages && !bRageGuarded;
	const bool bWantGuard = !bDead && !AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Stunned) && !bRageOpen;
	const bool bHasGuard = AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Guarded);
	if (bWantGuard == bHasGuard)
	{
		return;
	}
	if (bWantGuard)
	{
		// Replicated, so every machine can show the guard (and the targeting readout can read it).
		AbilitySystemComponent->AddLooseGameplayTag(ClockworksTags::State_Guarded, 1, EGameplayTagReplicationState::TagAndCountToAll);
	}
	else
	{
		AbilitySystemComponent->RemoveLooseGameplayTag(ClockworksTags::State_Guarded, 1, EGameplayTagReplicationState::TagAndCountToAll);
	}
}

// Runs on: server only. Minions stand in a ring around their keeper, evenly spaced with a random turn so two jellies
// do not look identical.
void AClockworksEnemyCharacter::SpawnMinions()
{
	UWorld* World = GetWorld();
	if (!World || !MinionClass || MinionCount <= 0)
	{
		return;
	}
	const float TurnOffset = FMath::FRandRange(0.f, 360.f);
	for (int32 Index = Minions.Num(); Index < MinionCount; ++Index)
	{
		const float Yaw = TurnOffset + 360.f * Index / FMath::Max(MinionCount, 1);
		const FVector At = GetActorLocation() + FRotator(0.f, Yaw, 0.f).Vector() * MinionRadiusCm;

		FActorSpawnParameters SpawnParams;
		SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
		SpawnParams.Owner = this;
		if (AClockworksEnemyCharacter* Minion = World->SpawnActor<AClockworksEnemyCharacter>(MinionClass, At, FRotator(0.f, Yaw + 180.f, 0.f), SpawnParams))
		{
			Minions.Add(Minion);
		}
	}
}

// Runs on: server only, on the minion timer. Two jobs on one clock: replace the minions that have died, and eat any
// that have wandered onto us.
void AClockworksEnemyCharacter::TickMinions()
{
	if (bDead)
	{
		return;
	}
	Minions.RemoveAll([](const TWeakObjectPtr<AClockworksEnemyCharacter>& Minion) { return !Minion.IsValid(); });

	// The Royal Jelly's absorb: a Royal Mini standing on it is consumed and heals it. The wiki's reason not to leave
	// the minis alive.
	if (AbsorbMinionClass && AttributeSet && AttributeSet->GetHealth() > 0.f)
	{
		for (TActorIterator<AClockworksEnemyCharacter> It(GetWorld(), AbsorbMinionClass); It; ++It)
		{
			AClockworksEnemyCharacter* Mini = *It;
			if (!Mini || Mini == this || FVector::Dist2D(Mini->GetActorLocation(), GetActorLocation()) > AbsorbRadiusCm)
			{
				continue;
			}
			const float Healed = FMath::Min(AttributeSet->GetMaxHealth() * AbsorbHealFraction,
				AttributeSet->GetMaxHealth() - AttributeSet->GetHealth());
			AttributeSet->SetHealth(AttributeSet->GetHealth() + Healed);
			Mini->Destroy();
			UE_LOG(LogClockworks, Log, TEXT("%s: absorbed a minion for %.0f"), *GetName(), Healed);
		}
	}

	if (MinionClass && bMinionsRespawn && Minions.Num() < MinionCount)
	{
		SpawnMinions();
	}
}

// Runs on: server only, from the rage timer. The original's last Royal Jelly stage is unhittable in bursts; the user's
// numbers (2026-09-15) are 5 s shut, 5 s open, over and over.
void AClockworksEnemyCharacter::TickRage()
{
	if (bDead)
	{
		return;
	}
	bRageGuarded = !bRageGuarded;
	RefreshGuard();
	GetWorldTimerManager().SetTimer(RageTimer, this, &AClockworksEnemyCharacter::TickRage,
		FMath::Max(bRageGuarded ? RageGuardSeconds : RageOpenSeconds, 0.05f), false);
}

// Runs on: server only. One stage of a boss gives way to the next where it stood, so the fight is one health bar after
// another rather than one long one. Without a next stage this is simply the end of it.
void AClockworksEnemyCharacter::AdvanceStage()
{
	if (!HasAuthority() || !NextStageClass || bDead)
	{
		return;
	}
	bDead = true;
	GetWorldTimerManager().ClearTimer(StageTimer);
	GetWorldTimerManager().ClearTimer(RageTimer);

	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}
	FActorSpawnParameters SpawnParams;
	SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	SpawnParams.Instigator = GetInstigator();
	SpawnParams.Owner = GetOwner();
	World->SpawnActor<AClockworksEnemyCharacter>(NextStageClass, GetActorLocation(), GetActorRotation(), SpawnParams);

	UE_LOG(LogClockworks, Log, TEXT("%s: stage over, %s takes its place"), *GetName(), *GetNameSafe(NextStageClass));
	Destroy();
}

// Runs on: all machines (multicast from the server). Cosmetic: the pose freezes and the flash stays
// on for the length of the stun.
void AClockworksEnemyCharacter::MulticastSetStunned_Implementation(bool bNewStunned)
{
	bStunnedShown = bNewStunned;
	if (USkeletalMeshComponent* MeshComponent = GetMesh())
	{
		MeshComponent->bPauseAnims = bNewStunned;
	}
	RefreshOverlay();
}

// Runs on: server only. The windup tint. Cosmetic, so the server simply tells everyone.
void AClockworksEnemyCharacter::SetTelegraph(bool bActive)
{
	if (!HasAuthority())
	{
		return;
	}
	MulticastSetTelegraph(bActive);
}

// Runs on: the local machine only.
void AClockworksEnemyCharacter::ShowTelegraph(bool bActive)
{
	bTelegraphShown = bActive;
	RefreshOverlay();
}

// Runs on: all machines (multicast from the server). Cosmetic.
void AClockworksEnemyCharacter::MulticastSetTelegraph_Implementation(bool bActive)
{
	ShowTelegraph(bActive);
}

// Runs on: the local machine only. Three things want the overlay slot and they must not clear one
// another: a stun is held until it ends, a telegraph lasts the whole windup, and a hit flash is a
// blink over the top. Highest priority wins; the rest keep their own flags for when it lifts.
void AClockworksEnemyCharacter::RefreshOverlay()
{
	USkeletalMeshComponent* MeshComponent = GetMesh();
	if (!MeshComponent)
	{
		return;
	}

	UMaterialInterface* Material = nullptr;
	if (bStunnedShown)
	{
		Material = HitFlashMaterial;
	}
	else if (bHitFlashShown)
	{
		Material = HitFlashMaterial;
	}
	else if (bTelegraphShown)
	{
		Material = TelegraphMaterial ? TelegraphMaterial.Get() : HitFlashMaterial.Get();
	}
	MeshComponent->SetOverlayMaterial(Material);
}

// Runs on: the local machine only. Cosmetic in the strictest sense: it scales the mesh's animation
// clock, not the actor's, so movement, ability timers and replication are all untouched.
void AClockworksEnemyCharacter::ApplyHitstop()
{
	USkeletalMeshComponent* MeshComponent = GetMesh();
	if (!MeshComponent || HitstopSeconds <= 0.f)
	{
		return;
	}
	MeshComponent->GlobalAnimRateScale = 0.f;
	// Restarting rather than stacking: two hits in one frame should not freeze for twice as long.
	GetWorldTimerManager().SetTimer(HitstopTimer, this, &AClockworksEnemyCharacter::EndHitstop, HitstopSeconds, false);
}

// Runs on: server only. Cosmetic, but the server is the only machine that knows what a hit came to
// after defence and the family chart, so it is the one that has to say.
void AClockworksEnemyCharacter::MulticastDamageNumber_Implementation(float Amount, float FamilyMultiplier)
{
	ShowDamageNumber(Amount, FamilyMultiplier);
}

// Runs on: the local machine only.
void AClockworksEnemyCharacter::ShowDamageNumber(float Amount, float FamilyMultiplier)
{
	UWorld* World = GetWorld();
	if (!DamageNumberClass || !World)
	{
		return;
	}

	// Over the head rather than at the feet, where it would be hidden by the body it belongs to.
	const FVector Location = GetActorLocation() + FVector(0.f, 0.f, GetDefaultHalfHeight() + 40.f);

	FActorSpawnParameters SpawnParams;
	SpawnParams.Owner = this;
	SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	if (AClockworksDamageNumber* Number = World->SpawnActor<AClockworksDamageNumber>(
		DamageNumberClass, Location, FRotator::ZeroRotator, SpawnParams))
	{
		Number->ShowDamage(Amount, FamilyMultiplier);
	}
}

// Runs on: the local machine only. Purely a flourish, so a missing class is not worth a warning.
void AClockworksEnemyCharacter::SpawnHitSpark(const FVector& WorldLocation)
{
	UWorld* World = GetWorld();
	if (!HitSparkClass || !World)
	{
		return;
	}
	FActorSpawnParameters SpawnParams;
	SpawnParams.Owner = this;
	SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	World->SpawnActor<AClockworksHitSpark>(HitSparkClass, WorldLocation, FRotator::ZeroRotator, SpawnParams);
}

// Runs on: the local machine only. A stunned enemy stays frozen by bPauseAnims, not by this.
void AClockworksEnemyCharacter::EndHitstop()
{
	if (USkeletalMeshComponent* MeshComponent = GetMesh())
	{
		MeshComponent->GlobalAnimRateScale = 1.f;
	}
}

// Runs on: server only (bound to the attribute set on the server). Knockback is gameplay: this actor
// is server-controlled, so the resulting movement reaches clients through normal replication.
void AClockworksEnemyCharacter::HandleDamaged(AActor* InstigatorActor, AActor* Causer, float Amount, FVector HitDirection, float KnockbackMultiplier, float FamilyMultiplier)
{
	if (bDead)
	{
		return;
	}

	// A stunned boss shakes the stun off early once enough has been dealt during it: the Snarbolax's "about a third of
	// its health" (the user's decision 2026-09-15 that it is a third of its maximum), which rewards burst damage in the
	// window the bell bought and closes it again.
	if (StunBreakHealthFraction > 0.f && AttributeSet && AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Stunned))
	{
		const float DealtDuringStun = HealthAtStunStart - AttributeSet->GetHealth();
		if (DealtDuringStun >= StunBreakHealthFraction * AttributeSet->GetMaxHealth())
		{
			AbilitySystemComponent->RemoveActiveEffectsWithGrantedTags(FGameplayTagContainer(ClockworksTags::State_Stunned));
			UE_LOG(LogClockworks, Log, TEXT("%s: shook off its stun after %.0f damage"), *GetName(), DealtDuringStun);
		}
	}

	LaunchCharacter(HitDirection * KnockbackSpeed * FMath::Max(KnockbackMultiplier, 0.f), true, false);
	MulticastHitFlash();
	MulticastPlaySound(HurtSound);
	MulticastDamageNumber(Amount, FamilyMultiplier);

	// A flinch, but never over a telegraph: Spiral Knights only lets finishers and charges interrupt a
	// monster that is already winding up, and stomping the wind-up clip would hide the tell the player
	// is reading. The stun (shield bash) is the move that actually interrupts.
	if (HurtAnim && !AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Attacking))
	{
		PlayPhaseAnimation(HurtAnim, HurtSeconds);
	}
}

// Runs on: server only, from the AI controller when it takes a target after having none.
void AClockworksEnemyCharacter::PlayAggroAnimation()
{
	if (!HasAuthority() || bDead)
	{
		return;
	}
	MulticastPlaySound(AggroSound);
	if (AggroAnim)
	{
		MulticastPlayAggroAnimation();
	}
}

// Runs on: all machines (multicast from the server). Cosmetic.
void AClockworksEnemyCharacter::MulticastPlayAggroAnimation_Implementation()
{
	if (AggroAnim)
	{
		const float Length = AggroAnim->GetPlayLength();
		PlaySlotAnimation(AggroAnim, (AggroSeconds > 0.f && Length > 0.f) ? Length / AggroSeconds : 1.f, false);
	}
}

// Runs on: server only. Fits the clip to the phase, then shows it everywhere.
void AClockworksEnemyCharacter::PlayPhaseAnimation(UAnimSequenceBase* Anim, float PhaseSeconds, bool bLoop)
{
	if (!Anim)
	{
		return;
	}
	const float Length = Anim->GetPlayLength();
	const float Rate = (PhaseSeconds > 0.f && Length > 0.f) ? Length / PhaseSeconds : 1.f;
	MulticastPlaySlotAnimation(Anim, Rate, bLoop);
}

// Runs on: the local machine only.
void AClockworksEnemyCharacter::PlaySlotAnimation(UAnimSequenceBase* Anim, float PlayRate, bool bLoop)
{
	if (bUseDirectAnimation)
	{
		PlayDirectAnimation(Anim, PlayRate, bLoop);
		return;
	}

	UAnimInstance* AnimInstance = GetMesh() ? GetMesh()->GetAnimInstance() : nullptr;
	if (!Anim || !AnimInstance)
	{
		return;
	}

	StopSlotAnimation(0.05f);
	// A loop count of zero builds a zero-length segment that never shows; "forever" is a big number here.
	ActiveSlotMontage = AnimInstance->PlaySlotAnimationAsDynamicMontage(Anim, AnimationSlotName, /*BlendIn*/ 0.05f, /*BlendOut*/ 0.1f, FMath::Max(PlayRate, 0.01f), bLoop ? 1000 : 1);
}

// Runs on: the local machine only. Direct mode: one clip owns the mesh until it finishes, then the
// loops take it back. The timer is what "until it finishes" means, because single-node playback has
// no completion delegate to hang off.
void AClockworksEnemyCharacter::PlayDirectAnimation(UAnimSequenceBase* Anim, float PlayRate, bool bLoop)
{
	USkeletalMeshComponent* MeshComponent = GetMesh();
	if (!Anim || !MeshComponent)
	{
		return;
	}

	const float Rate = FMath::Max(PlayRate, 0.01f);
	MeshComponent->SetAnimationMode(EAnimationMode::AnimationSingleNode);
	MeshComponent->PlayAnimation(Anim, bLoop);
	MeshComponent->SetPlayRate(Rate);

	ShownLoopAnim = bLoop ? Anim : nullptr;
	bDirectClipPlaying = !bLoop;

	GetWorldTimerManager().ClearTimer(DirectClipTimer);
	if (!bLoop)
	{
		const float Length = Anim->GetPlayLength();
		const float Seconds = (Length > 0.f) ? (Length / Rate) : 0.2f;
		GetWorldTimerManager().SetTimer(DirectClipTimer, FTimerDelegate::CreateWeakLambda(this, [this]()
		{
			bDirectClipPlaying = false;
		}), FMath::Max(Seconds, 0.02f), false);
	}
}

// Runs on: every machine, for every enemy in direct mode. Cosmetic: movement is replicated, so each
// machine picks the same loop from the same speed and nothing is sent for it.
void AClockworksEnemyCharacter::TickDirectAnimation()
{
	USkeletalMeshComponent* MeshComponent = GetMesh();
	if (!bUseDirectAnimation || !MeshComponent || bDirectClipPlaying || bDead)
	{
		return;
	}

	const bool bMoving = GetVelocity().Size2D() > MoveAnimSpeedThreshold;
	UAnimSequenceBase* Wanted = bMoving ? MoveAnim.Get() : IdleAnim.Get();
	if (!Wanted)
	{
		return;
	}

	// The legs keep up with the feet: a monster moved faster than its clip was authored for walks on
	// the spot otherwise, which is the single most obvious animation fault at this camera distance.
	float Rate = 1.f;
	if (bMoving && MoveAnimReferenceSpeed > 0.f)
	{
		Rate = FMath::Clamp(GetVelocity().Size2D() / MoveAnimReferenceSpeed, 0.25f, 3.f);
	}

	if (ShownLoopAnim.Get() == Wanted)
	{
		MeshComponent->SetPlayRate(Rate);
		return;
	}

	MeshComponent->SetAnimationMode(EAnimationMode::AnimationSingleNode);
	MeshComponent->PlayAnimation(Wanted, /*bLooping*/ true);
	MeshComponent->SetPlayRate(Rate);
	ShownLoopAnim = Wanted;
}

// Runs on: every machine.
void AClockworksEnemyCharacter::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	TickDirectAnimation();
}

// Runs on: the local machine only.
void AClockworksEnemyCharacter::StopSlotAnimation(float BlendOutSeconds)
{
	if (bUseDirectAnimation)
	{
		// Nothing to stop: the loops resume of their own accord when the clip's timer runs out.
		return;
	}

	if (UAnimMontage* Montage = ActiveSlotMontage.Get())
	{
		if (UAnimInstance* AnimInstance = GetMesh() ? GetMesh()->GetAnimInstance() : nullptr)
		{
			AnimInstance->Montage_Stop(BlendOutSeconds, Montage);
		}
	}
	ActiveSlotMontage = nullptr;
}

// Runs on: all machines (multicast from the server). Cosmetic.
void AClockworksEnemyCharacter::MulticastPlaySlotAnimation_Implementation(UAnimSequenceBase* Anim, float PlayRate, bool bLoop)
{
	PlaySlotAnimation(Anim, PlayRate, bLoop);
}

// Runs on: the editor, from the monster generator. See the header for why this exists.
void AClockworksEnemyCharacter::SetFamilyTagByName(const FString& TagName)
{
	FamilyTag = UGameplayTagsManager::Get().RequestGameplayTag(FName(*TagName), /*ErrorIfNotFound*/ true);
}

// Runs on: anywhere. Tools only; the game reads the tag itself.
FString AClockworksEnemyCharacter::GetFamilyTagName() const
{
	return FamilyTag.IsValid() ? FamilyTag.ToString() : TEXT("none");
}

// Runs on: all machines (multicast from the server). Cosmetic, and positional so a bark off to the
// side is heard off to the side.
void AClockworksEnemyCharacter::MulticastPlaySound_Implementation(USoundBase* Sound)
{
	if (Sound)
	{
		UGameplayStatics::PlaySoundAtLocation(this, Sound, GetActorLocation());
	}
}

// Runs on: all machines (multicast from the server). Cosmetic.
void AClockworksEnemyCharacter::MulticastHitFlash_Implementation()
{
	// The freeze is the half of this the player feels rather than sees, and it wants to happen even
	// on an enemy with no flash material assigned.
	ApplyHitstop();
	SpawnHitSpark(GetActorLocation() + FVector(0.f, 0.f, HitSparkHeight - GetDefaultHalfHeight()));

	if (!HitFlashMaterial)
	{
		return;
	}

	bHitFlashShown = true;
	RefreshOverlay();
	GetWorldTimerManager().SetTimer(HitFlashTimer, this, &AClockworksEnemyCharacter::ClearHitFlash, FMath::Max(HitFlashSeconds, 0.01f), false);
}

// Runs on: all machines. A stunned enemy keeps its held flash.
void AClockworksEnemyCharacter::ClearHitFlash()
{
	bHitFlashShown = false;
	RefreshOverlay();
}

// Runs on: server only. Hidden and collision state replicate; the destroy replicates as removal.
void AClockworksEnemyCharacter::HandleOutOfHealth()
{
	if (bDead)
	{
		return;
	}
	// A boss stage hands over instead of dying: the next stage takes its place where it fell.
	if (NextStageClass)
	{
		AdvanceStage();
		return;
	}
	bDead = true;

	GetWorldTimerManager().ClearTimer(StageTimer);
	GetWorldTimerManager().ClearTimer(RageTimer);
	AbilitySystemComponent->AddLooseGameplayTag(ClockworksTags::State_Dead, 1, EGameplayTagReplicationState::None);
	AbilitySystemComponent->CancelAllAbilities();
	MulticastPlaySound(DeathSound);

	if (AController* MyController = GetController())
	{
		MyController->StopMovement();
	}

	SetActorEnableCollision(false);
	GetCharacterMovement()->DisableMovement();

	// A corpse should not keep an empty bar floating over it.
	if (HealthBarWidget)
	{
		HealthBarWidget->SetHiddenInGame(true);
	}

	// With a death clip the body stays and plays it out; without one it just vanishes as before.
	if (DeathMontage)
	{
		MulticastPlayDeathMontage();
	}
	else
	{
		SetActorHiddenInGame(true);
	}
	SetLifeSpan(FMath::Max(DeathDestroyDelay, 0.01f));
}

// Runs on: all machines (multicast from the server). Cosmetic. Played straight on the animation
// instance rather than through the ability system, since the enemy's abilities were just cancelled.
void AClockworksEnemyCharacter::MulticastPlayDeathMontage_Implementation()
{
	// bDead is already true on the server, but a client learns it here. Setting it stops the idle
	// and movement loops taking the mesh back over a corpse a frame later.
	bDead = true;

	if (bUseDirectAnimation)
	{
		if (DeathAnim && GetMesh())
		{
			GetMesh()->SetAnimationMode(EAnimationMode::AnimationSingleNode);
			GetMesh()->PlayAnimation(DeathAnim, /*bLooping*/ false);
			GetMesh()->SetPlayRate(1.f);
		}
		return;
	}

	if (UAnimInstance* AnimInstance = GetMesh() ? GetMesh()->GetAnimInstance() : nullptr)
	{
		if (DeathMontage)
		{
			AnimInstance->Montage_Play(DeathMontage);
		}
	}
}
