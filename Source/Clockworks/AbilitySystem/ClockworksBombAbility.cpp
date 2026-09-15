// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksBombAbility.h"
#include "ClockworksBomb.h"
#include "ClockworksCharacter.h"
#include "ClockworksGameplayTags.h"
#include "ClockworksWeaponDefinition.h"
#include "Clockworks.h"
#include "AbilitySystemComponent.h"
#include "Abilities/Tasks/AbilityTask_WaitDelay.h"
#include "Abilities/Tasks/AbilityTask_WaitInputRelease.h"
#include "Animation/AnimSequenceBase.h"
#include "Engine/World.h"
#include "GameFramework/Character.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Sound/SoundBase.h"
#include "TimerManager.h"

// Runs on: all machines (class default object).
UClockworksBombAbility::UClockworksBombAbility()
{
	SetAssetTags(FGameplayTagContainer(ClockworksTags::Ability_Attack_Bomb));
	AbilityInputID = EClockworksAbilityInputID::Attack;

	// Owned for the whole activation: the character reads it to slow the walk, and the dodge is
	// blocked while a live bomb is in hand.
	ActivationOwnedTags.AddTag(ClockworksTags::State_Attacking);

	ActivationBlockedTags.AddTag(ClockworksTags::State_Attacking);
	ActivationBlockedTags.AddTag(ClockworksTags::State_Dodging);
	ActivationBlockedTags.AddTag(ClockworksTags::State_Shielding);
	ActivationBlockedTags.AddTag(ClockworksTags::State_Dead);
}

// Runs on: wherever the instance runs.
AClockworksCharacter* UClockworksBombAbility::GetKnight() const
{
	return Cast<AClockworksCharacter>(GetAvatarCharacter());
}

// Runs on: owning client and server, at the start of every activation. Every bomb in the original
// uses the same three clips (the charge hold, the bomb-placing blend, the throw for a dud) but its own
// charge time, fuse and radius; those come from the drawn weapon here.
void UClockworksBombAbility::ApplyWeaponProfile()
{
	FuseSeconds = 0.f;

	const UClockworksWeaponDefinition* Weapon = GetSourceWeapon();
	if (!Weapon || !Weapon->Attack.IsSet())
	{
		return;
	}
	const FClockworksAttackProfile& Profile = Weapon->Attack;

	if (Profile.ChargeSeconds > 0.f)
	{
		ArmSeconds = Profile.ChargeSeconds;
	}
	if (Profile.ChargeHoldAnim)
	{
		// The original has no reach-for-it clip: the hold loop starts on the press.
		HoldAnim = Profile.ChargeHoldAnim;
		ArmAnim = nullptr;
	}

	const FClockworksAttackMove& Charged = Profile.ChargedAttack;
	if (Charged.FireAnim)
	{
		PlaceAnim = Charged.FireAnim;
		PlaceAnimRate = Charged.FireRate;
	}
	PlaceSeconds = FMath::Max(Charged.StartSeconds, 0.05f);
	RecoverySeconds = Charged.RecoverySeconds;
	for (const FClockworksAttackHit& Hit : Charged.Hits)
	{
		if (Hit.bSpawns)
		{
			if (Hit.FuseSeconds > 0.f)
			{
				FuseSeconds = Hit.FuseSeconds;
			}
			if (Hit.BlastRadiusCm > 0.f)
			{
				BlastRadius = Hit.BlastRadiusCm;
			}
			break;
		}
	}

	const FClockworksAttackMove& Dud = Profile.IncompleteCharge;
	if (Dud.FireAnim)
	{
		DudAnim = Dud.FireAnim;
		DudAnimRate = Dud.FireRate;
	}
	if (Dud.RecoverySeconds > 0.f)
	{
		DudRecoverySeconds = Dud.RecoverySeconds;
	}
}

// Runs on: owning client (predicted) and server. Super is deliberately not called: the engine's
// default ActivateAbility commits the ability itself, which would double up with CommitAbility.
void UClockworksBombAbility::ActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, const FGameplayEventData* TriggerEventData)
{
	if (!CommitAbility(Handle, ActorInfo, ActivationInfo))
	{
		EndAbility(Handle, ActorInfo, ActivationInfo, true, true);
		return;
	}

	bArmed = false;
	bPlacing = false;

	// The drawn weapon's own charge time, clips, fuse and radius, before anything reads them.
	ApplyWeaponProfile();

	UE_LOG(LogClockworks, Log, TEXT("Bomb: arming for %.2fs (authority=%d)"), ArmSeconds, HasServerAuthority());

	// Arming is a charge, so the character slows to the charge speed and the aura rules apply.
	AddLocalTag(ClockworksTags::State_Charging);

	PlayPhaseSound(ArmSound);
	if (ArmAnim)
	{
		PlayPhaseAnim(ArmAnim, ResolveChargeSeconds(ArmSeconds));
	}
	else if (HoldAnim)
	{
		// The original's bombs have no reach-for-it clip: the hold loop starts on the press.
		PlayPhaseAnim(HoldAnim, 0.f, /*bLoop*/ true, 1.f);
	}

	// The release is what drops the bomb, so a listener has to exist from the first frame. Testing
	// the current input state catches a press that already ended before we got here.
	if (!ReleaseTask)
	{
		ReleaseTask = UAbilityTask_WaitInputRelease::WaitInputRelease(this, /*bTestAlreadyReleased*/ true);
		ReleaseTask->OnRelease.AddDynamic(this, &UClockworksBombAbility::OnAttackReleased);
		ReleaseTask->ReadyForActivation();
	}

	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().SetTimer(ArmTimer, this, &UClockworksBombAbility::OnArmed, ClampPhaseSeconds(ResolveChargeSeconds(ArmSeconds)), false);
	}
}

// Runs on: owning client and server. The bomb is now live in the hand.
void UClockworksBombAbility::OnArmed()
{
	bArmed = true;
	UE_LOG(LogClockworks, Log, TEXT("Bomb: armed"));

	PlayPhaseSound(ArmedSound);

	// The held loop, and the same held aura the sword's charge uses, so both players can see a
	// bomber is carrying something live.
	// Without an arming clip the hold loop has been playing since the press already.
	if (HoldAnim && ArmAnim)
	{
		PlayPhaseAnim(HoldAnim, 0.f, /*bLoop*/ true, 1.f);
	}
	if (AClockworksCharacter* Knight = GetKnight())
	{
		if (HasServerAuthority())
		{
			Knight->SetChargeReady(true);
		}
		else
		{
			Knight->ShowChargeReady(true);
		}
	}
}

// Runs on: owning client and server, when the button comes up.
void UClockworksBombAbility::OnAttackReleased(float TimeWaited)
{
	ReleaseTask = nullptr; // the task ends itself after this callback

	// Released early: a dud. Nothing is dropped, and the knight is locked out for most of a second
	// rather than being free to try again straight away. The original does the same (its interrupt
	// spawns a dud with a 767 ms rearm), and that penalty is what makes arming a real commitment.
	if (!bArmed)
	{
		UE_LOG(LogClockworks, Log, TEXT("Bomb: released early, dud (locked %.2fs)"), DudRecoverySeconds);
		bPlacing = true; // no second release can restart anything
		RemoveLocalTag(ClockworksTags::State_Charging);
		AddLocalTag(ClockworksTags::State_MovementLocked);
		StopPhaseAnim();
		// The throw and the dud's fizzle, when the weapon's data names them.
		if (const UClockworksWeaponDefinition* Weapon = GetSourceWeapon(); Weapon && Weapon->Attack.IsSet())
		{
			if (AClockworksCharacter* Knight = GetKnight())
			{
				Knight->PlayMoveSounds(Weapon->Attack.IncompleteCharge.Sound, Weapon->Attack.IncompleteCharge.ExtraSound, nullptr, HasServerAuthority());
			}
		}
		// The original tosses the dud away with the throw clip.
		if (DudAnim)
		{
			PlayPhaseAnim(DudAnim, DudRecoverySeconds, false, DudAnimRate);
		}

		UAbilityTask_WaitDelay* Dud = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(ResolveAttackSeconds(DudRecoverySeconds)));
		Dud->OnFinish.AddDynamic(this, &UClockworksBombAbility::OnDudFinished);
		Dud->ReadyForActivation();
		return;
	}

	if (bPlacing)
	{
		return;
	}
	bPlacing = true;

	UE_LOG(LogClockworks, Log, TEXT("Bomb: placing"));

	// Committed from here: the knight plants to put it down.
	AddLocalTag(ClockworksTags::State_RotationLocked);
	RemoveLocalTag(ClockworksTags::State_Charging);

	// The original's place clip is silent: the bomb itself makes the landing sound. Only a weapon with no
	// data keeps the Blueprint's place sound.
	const UClockworksWeaponDefinition* PlacedWeapon = GetSourceWeapon();
	if (!PlacedWeapon || !PlacedWeapon->Attack.IsSet())
	{
		PlayPhaseSound(PlaceSound);
	}
	if (PlaceAnim)
	{
		PlayPhaseAnim(PlaceAnim, PlaceSeconds, false, PlaceAnimRate);
	}

	UAbilityTask_WaitDelay* Place = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(ResolveAttackSeconds(PlaceSeconds)));
	Place->OnFinish.AddDynamic(this, &UClockworksBombAbility::OnPlaceFinished);
	Place->ReadyForActivation();
}

// Runs on: owning client and server. Only the server actually puts a bomb in the world.
void UClockworksBombAbility::OnPlaceFinished()
{
	if (HasServerAuthority())
	{
		SpawnBomb();
	}

	UAbilityTask_WaitDelay* Recovery = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(ResolveAttackSeconds(RecoverySeconds)));
	Recovery->OnFinish.AddDynamic(this, &UClockworksBombAbility::OnRecoveryFinished);
	Recovery->ReadyForActivation();
}

// Runs on: owning client and server.
void UClockworksBombAbility::OnRecoveryFinished()
{
	EndAbility(CurrentSpecHandle, CurrentActorInfo, CurrentActivationInfo, true, false);
}

// Runs on: owning client and server. The lockout after letting go too early.
void UClockworksBombAbility::OnDudFinished()
{
	RemoveLocalTag(ClockworksTags::State_MovementLocked);
	EndAbility(CurrentSpecHandle, CurrentActorInfo, CurrentActivationInfo, true, false);
}

// Runs on: server only. The bomb is a replicated actor, so the client sees it arrive rather than
// predicting one and having to reconcile a thing that does damage.
void UClockworksBombAbility::SpawnBomb()
{
	UWorld* World = GetWorld();
	ACharacter* Avatar = GetAvatarCharacter();
	UAbilitySystemComponent* AbilitySystemComponent = GetAbilitySystemComponentFromActorInfo();
	if (!World || !Avatar || !BombClass || !AbilitySystemComponent)
	{
		return;
	}

	// At the feet, not the chest: a bomb is a thing on the floor and its blast is measured from there.
	FVector Location = Avatar->GetActorLocation();
	Location.Z -= Avatar->GetDefaultHalfHeight();

	FActorSpawnParameters SpawnParams;
	SpawnParams.Owner = Avatar;
	SpawnParams.Instigator = Avatar;
	SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;

	if (AClockworksBomb* Bomb = World->SpawnActor<AClockworksBomb>(BombClass, Location, FRotator::ZeroRotator, SpawnParams))
	{
		// The weapon's own blast damage: the original's curve at the party's depth where its data carries one, else a
		// multiple of the ability's.
		float Damage = BlastDamage * ResolveDamageMultiplier();
		const FClockworksAttackHit* BlastHit = nullptr;
		if (const UClockworksWeaponDefinition* Weapon = GetSourceWeapon())
		{
			for (const FClockworksAttackHit& Hit : Weapon->Attack.ChargedAttack.Hits)
			{
				if (!Hit.bSpawns)
				{
					continue;
				}
				if (Hit.DamageByDepth.Num() > 0)
				{
					Damage = ClockworksAttackDepth::Read(Hit.DamageByDepth, CurrentDemoDepth(GetWorld()), Damage);
					BlastHit = &Hit;
					break;
				}
				if (Hit.DamageMultiplier > 0.f)
				{
					Damage = BlastDamage * Hit.DamageMultiplier * ResolveDamageMultiplier();
					BlastHit = &Hit;
					break;
				}
			}
		}
		// The blast's own damage types where its data names them; else the weapon's.
		const FGameplayTag WeaponType = ResolveDamageType();
		FGameplayTag PrimaryType = WeaponType;
		FGameplayTag SecondType;
		float SecondShare = 0.f;
		if (BlastHit)
		{
			ResolveDamageTypes(GetWorld(), BlastHit->DamageTypes, WeaponType, PrimaryType, SecondType, SecondShare);
		}
		Bomb->InitBomb(AbilitySystemComponent, Damage, BlastRadius, KnockbackMultiplier, PrimaryType, GetSourceWeapon(), FuseSeconds);
		Bomb->InitBombSecondType(SecondType, SecondShare);

		// The blast's status: its own from the data, else the weapon's. Before this every bomb stunned,
		// because the Blueprint's default was all a bomb ever had.
		if (const UClockworksWeaponDefinition* Weapon = GetSourceWeapon())
		{
			const FClockworksAttackHit* StatusHit = Weapon->Attack.ChargedAttack.Hits.FindByPredicate(
				[](const FClockworksAttackHit& Hit) { return Hit.bSpawns && Hit.StatusEffect; });
			if (StatusHit)
			{
				Bomb->InitBombStatus(StatusHit->StatusEffect, StatusHit->StatusChance, StatusHit->StatusSeconds,
					StatusTickAt(GetWorld(), StatusHit->StatusTickDamageByDepth, StatusHit->StatusTickDamage));
			}
			else if (Weapon->StatusEffect || Weapon->Attack.IsSet())
			{
				Bomb->InitBombStatus(Weapon->StatusEffect, Weapon->StatusChance, Weapon->StatusSeconds,
					StatusTickAt(GetWorld(), Weapon->StatusTickDamageByDepth, Weapon->StatusTickDamage));
			}
		}
		UE_LOG(LogClockworks, Log, TEXT("Bomb: dropped (%.0f damage, %.0f cm)"), BlastDamage, BlastRadius);
	}
}

// Runs on: owning client and server.
void UClockworksBombAbility::EndAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, bool bReplicateEndAbility, bool bWasCancelled)
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(ArmTimer);
	}

	// A looping hold clip must not outlive the ability; a placing clip can blend out on its own.
	if (!bPlacing || bWasCancelled)
	{
		StopPhaseAnim();
	}

	// The charge is gone however it ended: spent, dropped early, or cancelled.
	if (AClockworksCharacter* Knight = GetKnight())
	{
		if (HasServerAuthority())
		{
			Knight->SetChargeReady(false);
		}
		else
		{
			Knight->ShowChargeReady(false);
		}
	}

	bArmed = false;
	bPlacing = false;

	RemoveLocalTag(ClockworksTags::State_Charging);
	RemoveLocalTag(ClockworksTags::State_RotationLocked);
	RemoveLocalTag(ClockworksTags::State_MovementLocked);

	Super::EndAbility(Handle, ActorInfo, ActivationInfo, bReplicateEndAbility, bWasCancelled);
}

// Runs on: owning client and server. Cosmetic: the server broadcasts, the owning client plays its
// own at once so arming reads on the button rather than a round trip later.
void UClockworksBombAbility::PlayPhaseAnim(UAnimSequenceBase* Anim, float PhaseSeconds, bool bLoop, float ExplicitRate)
{
	AClockworksCharacter* Knight = GetKnight();
	if (!Knight || !Anim)
	{
		return;
	}

	const float Length = Anim->GetPlayLength();
	float Rate = 1.f;
	if (ExplicitRate > 0.f)
	{
		Rate = ExplicitRate;
	}
	else if (PhaseSeconds > 0.f && Length > 0.f)
	{
		Rate = Length / PhaseSeconds;
	}

	// Arms and chest only, so the knight keeps walking while arming. A bomber who cannot move while
	// holding a live bomb is a bomber who never gets to use one.
	if (HasServerAuthority())
	{
		Knight->MulticastPlaySlotAnimation(Anim, Rate, bLoop, Knight->GetUpperBodySlotName());
	}
	else
	{
		Knight->PlaySlotAnimation(Anim, Rate, bLoop, Knight->GetUpperBodySlotName());
	}
}

// Runs on: owning client and server. Cosmetic.
void UClockworksBombAbility::StopPhaseAnim()
{
	AClockworksCharacter* Knight = GetKnight();
	if (!Knight)
	{
		return;
	}
	if (HasServerAuthority())
	{
		Knight->MulticastStopSlotAnimation(Knight->GetUpperBodySlotName());
	}
	else
	{
		Knight->StopSlotAnimation(0.1f, Knight->GetUpperBodySlotName());
	}
}

// Runs on: owning client and server. Same split as the animations.
void UClockworksBombAbility::PlayPhaseSound(USoundBase* Sound)
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
