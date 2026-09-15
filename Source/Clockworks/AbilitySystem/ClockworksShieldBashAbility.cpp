// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksShieldBashAbility.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksCharacter.h"
#include "ClockworksDamageEffect.h"
#include "ClockworksGameplayTags.h"
#include "ClockworksGearStats.h"
#include "ClockworksPlayerState.h"
#include "ClockworksStunEffect.h"
#include "Sound/SoundBase.h"
#include "Clockworks.h"
#include "AbilitySystemComponent.h"
#include "AbilitySystemInterface.h"
#include "Abilities/Tasks/AbilityTask_ApplyRootMotionConstantForce.h"
#include "Abilities/Tasks/AbilityTask_WaitDelay.h"
#include "Animation/AnimSequenceBase.h"
#include "CollisionQueryParams.h"
#include "DrawDebugHelpers.h"
#include "Engine/OverlapResult.h"
#include "Engine/World.h"
#include "GameFramework/Character.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/Controller.h"
#include "TimerManager.h"

// Runs on: all machines (class default object).
UClockworksShieldBashAbility::UClockworksShieldBashAbility()
{
	SetAssetTags(FGameplayTagContainer(ClockworksTags::Ability_ShieldBash));
	AbilityInputID = EClockworksAbilityInputID::ShieldBash;

	// An attack like any other: slows movement, blocks the dodge and the weapons.
	ActivationOwnedTags.AddTag(ClockworksTags::State_Attacking);

	ActivationBlockedTags.AddTag(ClockworksTags::State_Attacking);
	ActivationBlockedTags.AddTag(ClockworksTags::State_Dodging);
	ActivationBlockedTags.AddTag(ClockworksTags::State_Reloading);
	ActivationBlockedTags.AddTag(ClockworksTags::State_ShieldBroken);
	ActivationBlockedTags.AddTag(ClockworksTags::State_Dead);
}

// Runs on: wherever the instance runs.
AClockworksCharacter* UClockworksShieldBashAbility::GetKnight() const
{
	return Cast<AClockworksCharacter>(GetAvatarCharacter());
}

// Runs on: owning client and server. The shield attribute replicates to the owner, so both read
// the same number and the client's prediction is honest.
bool UClockworksShieldBashAbility::CanActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayTagContainer* SourceTags, const FGameplayTagContainer* TargetTags, FGameplayTagContainer* OptionalRelevantTags) const
{
	if (!Super::CanActivateAbility(Handle, ActorInfo, SourceTags, TargetTags, OptionalRelevantTags))
	{
		return false;
	}
	const UAbilitySystemComponent* AbilitySystemComponent = ActorInfo ? ActorInfo->AbilitySystemComponent.Get() : nullptr;
	const UClockworksAttributeSet* Attributes = AbilitySystemComponent ? AbilitySystemComponent->GetSet<UClockworksAttributeSet>() : nullptr;
	if (!Attributes || Attributes->GetMaxShield() <= 0.f)
	{
		return false;
	}
	return Attributes->GetShield() + KINDA_SMALL_NUMBER >= Attributes->GetMaxShield() * RequiredShieldFraction;
}

// Runs on: owning client (predicted) and server, each on its own instance. Super is deliberately
// not called: the engine's default ActivateAbility commits the ability itself, which would double up.
void UClockworksShieldBashAbility::ActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, const FGameplayEventData* TriggerEventData)
{
	if (!CommitAbility(Handle, ActorInfo, ActivationInfo))
	{
		EndAbility(Handle, ActorInfo, ActivationInfo, true, true);
		return;
	}

	AClockworksCharacter* Knight = GetKnight();
	UAbilitySystemComponent* AbilitySystemComponent = GetAbilitySystemComponentFromActorInfo();
	if (!Knight || !AbilitySystemComponent)
	{
		EndAbility(Handle, ActorInfo, ActivationInfo, true, true);
		return;
	}

	HitActors.Reset();
	RingHitActors.Reset();

	// The worn shield decides the bash. The gear and the depth replicate, so the predicting client and the server
	// read the same numbers.
	const AClockworksPlayerState* KnightState = Knight->GetPlayerState<AClockworksPlayerState>();
	const UClockworksGearDefinition* WornShield = KnightState ? KnightState->GetGear(EClockworksGearSlotIndex::Shield) : nullptr;
	const float Depth = ClockworksGearStats::CurrentOriginalDepth(GetWorld());
	ActiveKind = WornShield ? WornShield->ShieldBashKind : EClockworksShieldBashKind::Standard;
	ActiveRank = WornShield ? WornShield->ShieldBashRank : 0;
	ActiveDamage = (WornShield && WornShield->ShieldBashDamage.Num() > 0)
		? UClockworksGearDefinition::ReadCurve(WornShield->ShieldBashDamage, Depth)
		: BaseDamage;
	ActiveStunSeconds = WornShield
		? (Depth < 8.f ? StunSecondsShallow : (Depth < 18.f ? StunSecondsMiddle : StunSecondsDeep))
		: StunSeconds;
	ActiveLungeSeconds = ActiveKind == EClockworksShieldBashKind::Tortodrone ? TortodroneLungeSeconds : LungeSeconds;

	// A held shield gives way to the bash. Each machine cancels its own copy of the shield ability.
	const FGameplayTagContainer ShieldTags(ClockworksTags::Ability_Shield);
	AbilitySystemComponent->CancelAbilities(&ShieldTags);

	// The cost is gameplay: only the server pays it, and the attribute replicates back.
	if (HasServerAuthority())
	{
		if (const UClockworksAttributeSet* Attributes = AbilitySystemComponent->GetSet<UClockworksAttributeSet>())
		{
			const float NewShield = FMath::Max(0.f, Attributes->GetShield() - Attributes->GetMaxShield() * ShieldCostFraction);
			AbilitySystemComponent->SetNumericAttributeBase(UClockworksAttributeSet::GetShieldAttribute(), NewShield);
		}
	}

	// Direction: where the knight is moving, or where it faces when still (Spiral Knights' rule for
	// the dash and the bash). Each machine reads its own movement component: the client's from
	// input, the server's from the last move packet. Then face that way and freeze the facing.
	FVector Direction = Knight->GetCharacterMovement()->GetCurrentAcceleration();
	Direction.Z = 0.f;
	if (Direction.IsNearlyZero())
	{
		Direction = Knight->GetActorForwardVector();
		Direction.Z = 0.f;
	}
	Direction = Direction.GetSafeNormal();
	const FRotator Facing(0.f, Direction.Rotation().Yaw, 0.f);
	if (AController* Controller = Knight->GetController(); Controller && Knight->IsLocallyControlled())
	{
		// The owning client's control rotation travels in the move packet; the server's copy follows.
		Controller->SetControlRotation(Facing);
	}
	Knight->SetActorRotation(Facing);

	AddLocalTag(ClockworksTags::State_RotationLocked);
	AddLocalTag(ClockworksTags::State_MovementLocked);

	// Shield up on the arm for the whole bash, for everyone to see.
	if (HasServerAuthority())
	{
		Knight->SetShieldRaised(true);
	}
	else
	{
		Knight->ShowShieldRaised(true);
	}

	UE_LOG(LogClockworks, Log, TEXT("Shield bash (%s, rank %d): windup %.2fs, lunge %.0f cm over %.2fs, damage %.1f, stun %.1fs (authority=%d)"),
		*GetNameSafe(WornShield), ActiveRank, WindupSeconds, LungeDistance, ActiveLungeSeconds, ActiveDamage, ActiveStunSeconds, HasServerAuthority());

	PlayPhaseSound(BashSound);

	if (WindupAnim)
	{
		PlayPhaseAnim(WindupAnim, WindupSeconds);
	}
	UAbilityTask_WaitDelay* Windup = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(WindupSeconds));
	Windup->OnFinish.AddDynamic(this, &UClockworksShieldBashAbility::OnWindupFinished);
	Windup->ReadyForActivation();
}

// Runs on: owning client and server. The launch; the hitbox only opens on the server.
void UClockworksShieldBashAbility::OnWindupFinished()
{
	if (LungeAnim)
	{
		PlayPhaseAnim(LungeAnim, ActiveLungeSeconds);
	}
	StartLunge(LungeDistance / ActiveLungeSeconds, ActiveLungeSeconds);

	if (HasServerAuthority())
	{
		DoHitCheck();
		if (UWorld* World = GetWorld())
		{
			World->GetTimerManager().SetTimer(HitCheckTimer, this, &UClockworksShieldBashAbility::DoHitCheck, HitCheckInterval, true);
		}
	}

	UAbilityTask_WaitDelay* Lunge = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(ActiveLungeSeconds));
	Lunge->OnFinish.AddDynamic(this, &UClockworksShieldBashAbility::OnLungeFinished);
	Lunge->ReadyForActivation();
}

// Runs on: owning client and server. Rotation is free again; the feet stay planted for the rearm. A Tortodrone bash
// ends in its ring of force, on the server.
void UClockworksShieldBashAbility::OnLungeFinished()
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(HitCheckTimer);
	}
	RemoveLocalTag(ClockworksTags::State_RotationLocked);

	if (ActiveKind == EClockworksShieldBashKind::Tortodrone && HasServerAuthority())
	{
		if (const ACharacter* Avatar = GetAvatarCharacter())
		{
			const int32 RingIndex = FMath::Clamp(ActiveRank - 3, 0, FMath::Max(TortodroneRingRadius.Num() - 1, 0));
			const float Radius = TortodroneRingRadius.IsValidIndex(RingIndex) ? TortodroneRingRadius[RingIndex] : 150.f;
			HitAround(Avatar->GetActorLocation(), Radius, RingHitActors, TortodroneRingKnockback);
		}
	}

	if (RecoverySeconds <= 0.f)
	{
		OnRecoveryFinished();
		return;
	}
	if (RecoveryAnim)
	{
		PlayPhaseAnim(RecoveryAnim, RecoverySeconds);
	}
	UAbilityTask_WaitDelay* Recovery = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(RecoverySeconds));
	Recovery->OnFinish.AddDynamic(this, &UClockworksShieldBashAbility::OnRecoveryFinished);
	Recovery->ReadyForActivation();
}

// Runs on: owning client and server.
void UClockworksShieldBashAbility::OnRecoveryFinished()
{
	EndAbility(CurrentSpecHandle, CurrentActorInfo, CurrentActivationInfo, true, false);
}

// Runs on: server only (started from OnWindupFinished under HasServerAuthority).
void UClockworksShieldBashAbility::DoHitCheck()
{
	const ACharacter* Avatar = GetAvatarCharacter();
	if (!Avatar)
	{
		return;
	}
	HitAround(Avatar->GetActorLocation() + Avatar->GetActorForwardVector() * HitForwardOffset, HitRadius, HitActors, KnockbackMultiplier);
}

// Runs on: server only.
void UClockworksShieldBashAbility::HitAround(const FVector& Center, float Radius, TSet<TWeakObjectPtr<AActor>>& AlreadyHit, float Knockback)
{
	ACharacter* Avatar = GetAvatarCharacter();
	UAbilitySystemComponent* SourceAbilitySystemComponent = GetAbilitySystemComponentFromActorInfo();
	UWorld* World = Avatar ? Avatar->GetWorld() : nullptr;
	if (!Avatar || !SourceAbilitySystemComponent || !World)
	{
		return;
	}

	if (bDrawDebugHitbox)
	{
		DrawDebugSphere(World, Center, Radius, 16, FColor::Cyan, false, HitCheckInterval * 2.f);
	}

	TArray<FOverlapResult> Overlaps;
	FCollisionQueryParams QueryParams(TEXT("ClockworksShieldBash"), /*bTraceComplex*/ false, Avatar);
	World->OverlapMultiByObjectType(Overlaps, Center, FQuat::Identity, FCollisionObjectQueryParams(ECC_Pawn), FCollisionShape::MakeSphere(Radius), QueryParams);

	const FGameplayTag SourceFaction = GetFactionTag(SourceAbilitySystemComponent);

	for (const FOverlapResult& Overlap : Overlaps)
	{
		AActor* HitActor = Overlap.GetActor();
		if (!HitActor || HitActor == Avatar || AlreadyHit.Contains(HitActor))
		{
			continue;
		}

		const IAbilitySystemInterface* TargetInterface = Cast<IAbilitySystemInterface>(HitActor);
		UAbilitySystemComponent* TargetAbilitySystemComponent = TargetInterface ? TargetInterface->GetAbilitySystemComponent() : nullptr;
		if (!TargetAbilitySystemComponent)
		{
			continue;
		}

		// No friendly fire, no hitting the dead, no hitting through i-frames.
		if (SourceFaction.IsValid() && TargetAbilitySystemComponent->HasMatchingGameplayTag(SourceFaction))
		{
			continue;
		}
		if (TargetAbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Dead) || TargetAbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Invulnerable))
		{
			continue;
		}

		AlreadyHit.Add(HitActor);
		ApplyHitTo(TargetAbilitySystemComponent, Overlap, Knockback);
	}
}

// Runs on: server only. The damage effect (the target's attribute set applies defense) and the
// stun effect (a timed tag the enemy brain and abilities obey).
void UClockworksShieldBashAbility::ApplyHitTo(UAbilitySystemComponent* TargetAbilitySystemComponent, const FOverlapResult& Overlap, float Knockback)
{
	UAbilitySystemComponent* SourceAbilitySystemComponent = GetAbilitySystemComponentFromActorInfo();
	ACharacter* Avatar = GetAvatarCharacter();
	if (!SourceAbilitySystemComponent || !TargetAbilitySystemComponent || !Avatar)
	{
		return;
	}

	AActor* HitActor = Overlap.GetActor();
	const FHitResult Hit(HitActor, Overlap.GetComponent(), HitActor->GetActorLocation(), -Avatar->GetActorForwardVector());

	FGameplayEffectSpecHandle DamageSpec = MakeOutgoingGameplayEffectSpec(UClockworksDamageEffect::StaticClass(), GetAbilityLevel());
	if (DamageSpec.IsValid())
	{
		FGameplayEffectContextHandle Context = DamageSpec.Data->GetContext();
		Context.AddHitResult(Hit);

		float AttackPower = 0.f;
		if (const UClockworksAttributeSet* SourceAttributes = SourceAbilitySystemComponent->GetSet<UClockworksAttributeSet>())
		{
			AttackPower = SourceAttributes->GetAttackPower();
		}
		// The original's bash is Normal damage.
		SetDamageMagnitudes(DamageSpec, ActiveDamage + AttackPower, ClockworksTags::Data_Damage_Normal);
		DamageSpec.Data->SetSetByCallerMagnitude(ClockworksTags::Data_Knockback, Knockback);
		SourceAbilitySystemComponent->ApplyGameplayEffectSpecToTarget(*DamageSpec.Data, TargetAbilitySystemComponent);
	}

	// The server is the only machine that knows a bash connected, so it tells everyone.
	if (AClockworksCharacter* Knight = GetKnight())
	{
		Knight->MulticastPlaySound(HitSound);
	}

	// Always stuns (100% in the original), through the knight-side stun so a status resistance never applies.
	if (ActiveStunSeconds > 0.f)
	{
		FGameplayEffectSpecHandle StunSpec = MakeOutgoingGameplayEffectSpec(UClockworksStunEffect::StaticClass(), GetAbilityLevel());
		if (StunSpec.IsValid())
		{
			StunSpec.Data->SetSetByCallerMagnitude(ClockworksTags::Data_Duration, ActiveStunSeconds);
			SourceAbilitySystemComponent->ApplyGameplayEffectSpecToTarget(*StunSpec.Data, TargetAbilitySystemComponent);
		}
	}
}

// Runs on: owning client and server. Cosmetic, so it follows the animation's rule: the server
// broadcasts to everyone, the owning client plays its own at once rather than waiting a round trip.
void UClockworksShieldBashAbility::PlayPhaseSound(USoundBase* Sound)
{
	AClockworksCharacter* Knight = GetKnight();
	if (!Knight || !Sound)
	{
		return;
	}
	if (HasServerAuthority())
	{
		Knight->MulticastPlaySound(Sound);
	}
	else
	{
		Knight->PlaySoundLocal(Sound);
	}
}

// Runs on: owning client and server. A root motion source rather than a launch so ground friction
// cannot eat it; the movement component predicts it on the owning client and reconciles it with the
// server like any other move.
void UClockworksShieldBashAbility::StartLunge(float Speed, float Seconds)
{
	ACharacter* Avatar = GetAvatarCharacter();
	if (!Avatar || Speed <= 0.f || Seconds <= 0.f)
	{
		return;
	}

	FVector Direction = Avatar->GetActorForwardVector();
	Direction.Z = 0.f;
	UAbilityTask_ApplyRootMotionConstantForce* Push = UAbilityTask_ApplyRootMotionConstantForce::ApplyRootMotionConstantForce(
		this, NAME_None, Direction.GetSafeNormal(), Speed, ClampPhaseSeconds(Seconds), /*bIsAdditive*/ false, /*StrengthOverTime*/ nullptr,
		ERootMotionFinishVelocityMode::SetVelocity, FVector::ZeroVector, 0.f, /*bEnableGravity*/ false);
	Push->ReadyForActivation();
}

// Runs on: owning client and server. Cosmetic: the owning client shows its own prediction, the
// server broadcasts to everyone else.
void UClockworksShieldBashAbility::PlayPhaseAnim(UAnimSequenceBase* Anim, float PhaseSeconds)
{
	AClockworksCharacter* Knight = GetKnight();
	if (!Knight || !Anim)
	{
		return;
	}

	const float Length = Anim->GetPlayLength();
	const float Rate = (PhaseSeconds > 0.f && Length > 0.f) ? Length / PhaseSeconds : 1.f;

	// The whole body launches shield-first, so this takes the full-body slot and the raised shield's
	// upper-body hold sits underneath it without fighting for the same clip.
	if (HasServerAuthority())
	{
		Knight->MulticastPlaySlotAnimation(Anim, Rate, false, Knight->GetFullBodySlotName());
	}
	else
	{
		Knight->PlaySlotAnimation(Anim, Rate, false, Knight->GetFullBodySlotName());
	}
}

// Runs on: owning client and server.
void UClockworksShieldBashAbility::StopPhaseAnim()
{
	AClockworksCharacter* Knight = GetKnight();
	if (!Knight)
	{
		return;
	}
	if (HasServerAuthority())
	{
		Knight->MulticastStopSlotAnimation(Knight->GetFullBodySlotName());
	}
	else
	{
		Knight->StopSlotAnimation(0.1f, Knight->GetFullBodySlotName());
	}
}

// Runs on: owning client and server, including on cancel. Leaves nothing running behind.
void UClockworksShieldBashAbility::EndAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, bool bReplicateEndAbility, bool bWasCancelled)
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(HitCheckTimer);
	}
	if (bWasCancelled)
	{
		StopPhaseAnim();
	}

	RemoveLocalTag(ClockworksTags::State_RotationLocked);
	RemoveLocalTag(ClockworksTags::State_MovementLocked);

	if (AClockworksCharacter* Knight = GetKnight())
	{
		if (HasServerAuthority())
		{
			Knight->SetShieldRaised(false);
		}
		else
		{
			Knight->ShowShieldRaised(false);
		}
	}

	Super::EndAbility(Handle, ActorInfo, ActivationInfo, bReplicateEndAbility, bWasCancelled);
}
