// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksPistolAbility.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksCharacter.h"
#include "ClockworksGameplayTags.h"
#include "ClockworksWeaponDefinition.h"
#include "ClockworksProjectile.h"
#include "Clockworks.h"
#include "AbilitySystemComponent.h"
#include "Abilities/Tasks/AbilityTask_ApplyRootMotionConstantForce.h"
#include "Abilities/Tasks/AbilityTask_WaitDelay.h"
#include "Abilities/Tasks/AbilityTask_WaitInputPress.h"
#include "Abilities/Tasks/AbilityTask_WaitInputRelease.h"
#include "Animation/AnimSequenceBase.h"
#include "Sound/SoundBase.h"
#include "Engine/World.h"
#include "GameFramework/Character.h"
#include "TimerManager.h"

// Runs on: all machines (class default object).
UClockworksPistolAbility::UClockworksPistolAbility()
{
	SetAssetTags(FGameplayTagContainer(ClockworksTags::Ability_Attack_Pistol));
	AbilityInputID = EClockworksAbilityInputID::Attack;

	// Owned for the whole activation: slows movement (character) and blocks the dodge.
	ActivationOwnedTags.AddTag(ClockworksTags::State_Attacking);

	ActivationBlockedTags.AddTag(ClockworksTags::State_Attacking);
	ActivationBlockedTags.AddTag(ClockworksTags::State_Dodging);
	ActivationBlockedTags.AddTag(ClockworksTags::State_Shielding);
	ActivationBlockedTags.AddTag(ClockworksTags::State_Dead);
}

// Runs on: wherever the instance runs.
AClockworksCharacter* UClockworksPistolAbility::GetKnight() const
{
	return Cast<AClockworksCharacter>(GetAvatarCharacter());
}

// Runs on: owning client and server, at the start of every activation. Copies the drawn weapon's own
// clip, clips, timings and bursts over the Proto Gun defaults, so a Magnus kicks and plays the heavy
// pistol clips and an Autogun streams six bullets, all through this one ability.
void UClockworksPistolAbility::ApplyWeaponProfile()
{
	const UClockworksWeaponDefinition* Weapon = GetSourceWeapon();
	if (!Weapon || !Weapon->Attack.IsSet())
	{
		return;
	}
	const FClockworksAttackProfile& Profile = Weapon->Attack;

	if (Profile.Chain.Num() > 0)
	{
		const FClockworksAttackMove& First = Profile.Chain[0];
		ClipSize = Profile.Chain.Num();
		WindupAnim = First.StartAnim;
		WindupAnimRate = First.StartRate;
		FirstShotWindupSeconds = First.StartSeconds;
		FireAnim = First.FireAnim;
		FireAnimRate = First.FireRate;
		// The original's rearm is the fire window; its clear, less the rearm, is the follow-through.
		FireSeconds = FMath::Max(First.RecoverySeconds, 0.05f);
		RecoveryAnim = First.EndAnim;
		RecoveryAnimRate = First.EndRate;
		RecoverySeconds = FMath::Max(First.ClearSeconds - First.RecoverySeconds, 0.f);
		if (First.LungeDistanceCm < 0.f)
		{
			ShotRecoilDistance = -First.LungeDistanceCm;
			ShotRecoilSeconds = FMath::Max(First.LungeSeconds, 0.01f);
		}
	}

	const FClockworksAttackMove& Reload = Profile.Reload;
	if (Reload.IsSet())
	{
		ReloadAnim = Reload.FireAnim;
		ReloadAnimRate = Reload.FireRate;
		ReloadSeconds = FMath::Max(Reload.RecoverySeconds, 0.1f);
	}

	if (Profile.ChargeSeconds > 0.f)
	{
		ChargeSeconds = Profile.ChargeSeconds;
	}
	if (Profile.ChargeHoldAnim)
	{
		ChargeHoldAnim = Profile.ChargeHoldAnim;
	}

	const FClockworksAttackMove& Charged = Profile.ChargedAttack;
	if (Charged.IsSet())
	{
		ChargeReleaseAnim = Charged.StartAnim;
		ChargeReleaseAnimRate = Charged.StartRate;
		ChargeReleaseSeconds = Charged.StartSeconds;
		// The fire clips play first (PlayChargedFire); this is only the follow-through after them.
		ChargeEndAnim = Charged.EndAnim;
		ChargeEndAnimRate = Charged.EndRate;
		ChargeRecoverySeconds = Charged.RecoverySeconds;
		if (Charged.LungeDistanceCm < 0.f)
		{
			ChargeRecoilDistance = -Charged.LungeDistanceCm;
			ChargeRecoilSeconds = FMath::Max(Charged.LungeSeconds, 0.01f);
			ChargeRecoilDelaySeconds = Charged.LungeDelaySeconds;
		}
		else
		{
			ChargeRecoilDistance = 0.f;
		}
	}
}

// Runs on: wherever the instance runs.
const FClockworksAttackMove* UClockworksPistolAbility::GetMove(bool bCharged, int32 MoveIndex) const
{
	const UClockworksWeaponDefinition* Weapon = GetSourceWeapon();
	if (!Weapon || !Weapon->Attack.IsSet())
	{
		return nullptr;
	}
	if (bCharged)
	{
		return Weapon->Attack.ChargedAttack.IsSet() ? &Weapon->Attack.ChargedAttack : nullptr;
	}
	return Weapon->Attack.Chain.IsValidIndex(MoveIndex) ? &Weapon->Attack.Chain[MoveIndex] : nullptr;
}

// Runs on: wherever the instance runs. ShotsFired already counts the shot being fired.
int32 UClockworksPistolAbility::GetShotMoveIndex() const
{
	const UClockworksWeaponDefinition* Weapon = GetSourceWeapon();
	const int32 Count = Weapon ? Weapon->Attack.Chain.Num() : 0;
	return Count > 0 ? FMath::Max(ShotsFired - 1, 0) % Count : 0;
}

// Runs on: owning client and server. Bullets due at once leave now; the rest of a burst each get a
// timer that also flicks the fire clip and plays the shot again, as the original's streams do.
void UClockworksPistolAbility::FireMoveBullets(bool bCharged, int32 MoveIndex)
{
	const FClockworksAttackMove* Move = GetMove(bCharged, MoveIndex);
	UWorld* World = GetWorld();
	int32 Bullets = 0;
	if (Move)
	{
		for (int32 HitIndex = 0; HitIndex < Move->Hits.Num(); ++HitIndex)
		{
			const FClockworksAttackHit& Hit = Move->Hits[HitIndex];
			// A gun fires bullets; a blast in its data is not one of them.
			if (!Hit.bSpawns || Hit.bBlast)
			{
				continue;
			}
			++Bullets;
			if (Hit.DelaySeconds <= 0.f || !World)
			{
				SpawnMoveBullet(bCharged, MoveIndex, HitIndex);
			}
			else
			{
				FTimerHandle& Burst = BurstTimers.AddDefaulted_GetRef();
				World->GetTimerManager().SetTimer(Burst, FTimerDelegate::CreateUObject(this, &UClockworksPistolAbility::FireBurstBullet, bCharged, MoveIndex, HitIndex), Hit.DelaySeconds, false);
			}
		}
	}

	// No fire pattern to follow: the ability's own single shot.
	if (Bullets == 0)
	{
		SpawnMoveBullet(bCharged, MoveIndex, INDEX_NONE);
	}
}

// Runs on: owning client and server, from a burst timer. The clip and the sound everywhere; the
// bullet only on the server, which is the only machine that ever spawns one.
void UClockworksPistolAbility::FireBurstBullet(bool bCharged, int32 MoveIndex, int32 HitIndex)
{
	if (!IsActive())
	{
		return;
	}
	if (!bCharged && FireAnim)
	{
		PlayPhaseAnim(FireAnim, FireSeconds, false, FireAnimRate, /*bHoldLastFrame*/ true);
	}
	PlayMoveSound(GetMove(bCharged, MoveIndex), bCharged ? ChargeShotSound.Get() : ShotSound.Get(), /*bWithExtra*/ false);
	SpawnMoveBullet(bCharged, MoveIndex, HitIndex);
}

// Runs on: server only; a no-op anywhere else.
void UClockworksPistolAbility::SpawnMoveBullet(bool bCharged, int32 MoveIndex, int32 HitIndex)
{
	if (!HasServerAuthority())
	{
		return;
	}
	const FClockworksAttackMove* Move = GetMove(bCharged, MoveIndex);
	const FClockworksAttackHit* Spawn = (Move && Move->Hits.IsValidIndex(HitIndex)) ? &Move->Hits[HitIndex] : nullptr;
	const FClockworksBulletSpec* Spec = (Move && Move->Bullet.IsSet()) ? &Move->Bullet : nullptr;
	// The original's damage for this bullet at the party's depth when the weapon's data carries it: the spawning hit's
	// own curve, else the move's bullet's.
	const int32 Depth = CurrentDemoDepth(GetWorld());
	const float TableDamage = Spawn && Spawn->DamageByDepth.Num() > 0
		? ClockworksAttackDepth::Read(Spawn->DamageByDepth, Depth, 0.f)
		: (Spec ? ClockworksAttackDepth::Read(Spec->DamageByDepth, Depth, -1.f) : -1.f);
	if (bCharged)
	{
		// Without the table: the weapon's own charged damage as a multiple of its ordinary bullet, or the Blueprint's.
		const float Damage = TableDamage >= 0.f ? TableDamage
			: ((Spawn && Spawn->DamageMultiplier > 0.f) ? BaseDamage * Spawn->DamageMultiplier : ChargeDamage);
		SpawnProjectile(ChargedProjectileClass ? ChargedProjectileClass : ProjectileClass, Damage, ChargeProjectileSpeed, ChargeProjectileRange, ChargeKnockbackMultiplier, Spec, Spawn);
	}
	else
	{
		SpawnProjectile(ProjectileClass, TableDamage >= 0.f ? TableDamage : BaseDamage, ProjectileSpeed, ProjectileRange, KnockbackMultiplier, Spec, Spawn);
	}
}

// Runs on: owning client and server. A weapon with a profile is heard exactly as its data says, silence
// included (the Pulsar's shot has none); only a weapon without one falls back to the Blueprint's sound.
void UClockworksPistolAbility::PlayMoveSound(const FClockworksAttackMove* Move, USoundBase* Fallback, bool bWithExtra)
{
	if (!Move)
	{
		PlayPhaseSound(Fallback);
		return;
	}
	if (AClockworksCharacter* Knight = GetKnight())
	{
		static const FClockworksWeaponSound None;
		Knight->PlayMoveSounds(Move->Sound, bWithExtra ? Move->ExtraSound : None, nullptr, HasServerAuthority());
	}
}

// Runs on: owning client (predicted) and server, each on its own instance. Super is deliberately
// not called: the engine's default ActivateAbility commits the ability itself, which would double up.
void UClockworksPistolAbility::ActivateAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, const FGameplayEventData* TriggerEventData)
{
	if (!CommitAbility(Handle, ActorInfo, ActivationInfo))
	{
		EndAbility(Handle, ActorInfo, ActivationInfo, true, true);
		return;
	}

	// The drawn weapon's own clip, timings, clips and bursts, before anything reads them.
	ApplyWeaponProfile();

	ShotsFired = 0;
	bNextShotQueued = false;
	bButtonHeld = true;
	bCharging = false;
	bChargeReady = false;

	// A press soon after the last burst finds the gun still up: no windup, and the same clip carries
	// on. Any later press starts from idle. Each machine times this on its own clock from the same press.
	bGunRaised = false;
	if (const UWorld* World = GetWorld(); World && World->GetTimeSeconds() <= ShotResumeDeadline)
	{
		bGunRaised = true;
		ShotsFired = FMath::Clamp(ResumeShotsFired, 0, FMath::Max(ClipSize - 1, 0));
	}
	ShotResumeDeadline = 0.0;

	ListenForRelease();
	StartShot();
}

// ---------------------------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------------------------

// Runs on: owning client and server. The press arrives here on the client directly and on the
// server through the ability system's replicated input event, so both copies chain together.
void UClockworksPistolAbility::ListenForPress()
{
	if (InputTask)
	{
		InputTask->EndTask();
		InputTask = nullptr;
	}
	InputTask = UAbilityTask_WaitInputPress::WaitInputPress(this, /*bTestAlreadyPressed*/ false);
	InputTask->OnPress.AddDynamic(this, &UClockworksPistolAbility::OnAttackPressed);
	InputTask->ReadyForActivation();
}

// Runs on: owning client and server. A release task fires once and ends itself, so every hold needs
// a fresh listener. Testing the current input state means a press that already ended before we got
// here is caught too.
void UClockworksPistolAbility::ListenForRelease()
{
	if (!ReleaseTask)
	{
		ReleaseTask = UAbilityTask_WaitInputRelease::WaitInputRelease(this, /*bTestAlreadyReleased*/ true);
		ReleaseTask->OnRelease.AddDynamic(this, &UClockworksPistolAbility::OnAttackReleased);
		ReleaseTask->ReadyForActivation();
	}
}

// Runs on: owning client and server.
void UClockworksPistolAbility::StartShot()
{
	bNextShotQueued = false;

	// Aiming stays free between shots; the bullet goes where the knight faces when it leaves.
	// The windup is only paid when the gun is down: a shot, a reload or a quick follow-up press keeps it up.
	if (!bGunRaised && FirstShotWindupSeconds > 0.f)
	{
		if (WindupAnim)
		{
			// Held: the raise is 0.1 s of clip in a 0.287 s windup, and the gun stays up for the shot.
			PlayPhaseAnim(WindupAnim, FirstShotWindupSeconds, false, WindupAnimRate, /*bHoldLastFrame*/ true);
		}
		UAbilityTask_WaitDelay* Windup = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(ResolveAttackSeconds(FirstShotWindupSeconds)));
		Windup->OnFinish.AddDynamic(this, &UClockworksPistolAbility::OnWindupFinished);
		Windup->ReadyForActivation();
		return;
	}

	FireShot();
}

// Runs on: owning client and server.
void UClockworksPistolAbility::OnWindupFinished()
{
	FireShot();
}

// Runs on: owning client and server. Only the server's copy spawns the bullet.
void UClockworksPistolAbility::FireShot()
{
	++ShotsFired;
	bGunRaised = true;

	const int32 MoveIndex = GetShotMoveIndex();
	PlayMoveSound(GetMove(false, MoveIndex), ShotSound, /*bWithExtra*/ true);

	if (FireAnim)
	{
		PlayPhaseAnim(FireAnim, FireSeconds, false, FireAnimRate, /*bHoldLastFrame*/ true);
	}

	// The shot's bullets: one for a Proto Gun, a timed stream of six for an Autogun, each with its own
	// flick of the fire clip. Timers still running from the last shot's stream carry on.
	FireMoveBullets(false, MoveIndex);

	// A press during the fire window queues the next shot, unless this was the clip's last.
	if (ShotsFired < ClipSize)
	{
		ListenForPress();
	}

	UAbilityTask_WaitDelay* Fire = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(ResolveAttackSeconds(FireSeconds)));
	Fire->OnFinish.AddDynamic(this, &UClockworksPistolAbility::OnFireFinished);
	Fire->ReadyForActivation();
}

// Runs on: owning client and server. Reload, chain, or wind down.
void UClockworksPistolAbility::OnFireFinished()
{
	if (ShotsFired >= ClipSize)
	{
		BeginReload();
		return;
	}
	if (bNextShotQueued)
	{
		StartShot();
		return;
	}

	// The press listener from the shot stays up through the follow-through: a click there is the next
	// shot (OnRecoveryFinished). Ending it here made that click land on the running ability and vanish.

	// The follow-through plays whether or not there is a gameplay recovery to play it in. It runs at
	// its own speed and gets cut off by whatever you do next, which is the same correction the sword
	// needed: skipping it is what made a single shot snap straight back to idle.
	if (RecoveryAnim)
	{
		PlayPhaseAnim(RecoveryAnim, RecoverySeconds, false, RecoveryAnimRate);
	}
	else
	{
		ReleaseHeldPose();
	}
	if (RecoverySeconds <= 0.f)
	{
		FinishShot();
		return;
	}
	UAbilityTask_WaitDelay* Recovery = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(ResolveAttackSeconds(RecoverySeconds)));
	Recovery->OnFinish.AddDynamic(this, &UClockworksPistolAbility::OnRecoveryFinished);
	Recovery->ReadyForActivation();
}

// Runs on: owning client and server.
void UClockworksPistolAbility::OnRecoveryFinished()
{
	// Clicked during the follow-through: the gun is still up, so the next shot goes straight away.
	if (bNextShotQueued && ShotsFired < ClipSize)
	{
		StartShot();
		return;
	}
	FinishShot();
}

// Runs on: owning client and server. The knight can walk but not attack; the tag is for the shield
// later and for anything that wants to show it.
void UClockworksPistolAbility::BeginReload()
{
	if (InputTask)
	{
		InputTask->EndTask();
		InputTask = nullptr;
	}

	AddLocalTag(ClockworksTags::State_Reloading);
	const UClockworksWeaponDefinition* Weapon = GetSourceWeapon();
	PlayMoveSound((Weapon && Weapon->Attack.Reload.IsSet()) ? &Weapon->Attack.Reload : nullptr, ReloadSound, /*bWithExtra*/ true);
	UE_LOG(LogClockworks, Log, TEXT("Pistol: reloading for %.2fs (authority=%d)"), ReloadSeconds, HasServerAuthority());

	if (ReloadAnim)
	{
		PlayPhaseAnim(ReloadAnim, ReloadSeconds, false, ReloadAnimRate);
	}
	else
	{
		ReleaseHeldPose();
	}

	UAbilityTask_WaitDelay* Reload = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(ReloadSeconds));
	Reload->OnFinish.AddDynamic(this, &UClockworksPistolAbility::OnReloadFinished);
	Reload->ReadyForActivation();
}

// Runs on: owning client and server.
void UClockworksPistolAbility::OnReloadFinished()
{
	RemoveLocalTag(ClockworksTags::State_Reloading);
	ShotsFired = 0;
	FinishShot();
}

// Runs on: owning client and server, when the attack button is pressed during a shot.
void UClockworksPistolAbility::OnAttackPressed(float TimeWaited)
{
	// A press is a new hold: the release that ends it is the one that matters for charging.
	bButtonHeld = true;
	bNextShotQueued = true;
	ListenForRelease();
}

// Runs on: owning client and server, when the button comes up at any point in the activation.
void UClockworksPistolAbility::OnAttackReleased(float TimeWaited)
{
	bButtonHeld = false;
	ReleaseTask = nullptr; // the task ends itself after this callback
	UE_LOG(LogClockworks, Log, TEXT("Pistol: attack released (charging=%d ready=%d authority=%d)"), bCharging, bChargeReady, HasServerAuthority());

	if (bCharging)
	{
		if (bChargeReady)
		{
			StartChargeAttack();
		}
		else
		{
			// Let go early: the charge is lost, the knight is simply free again.
			EndAbility(CurrentSpecHandle, CurrentActorInfo, CurrentActivationInfo, true, false);
		}
	}
}

// Runs on: owning client and server. The fork between "done" and "charging".
void UClockworksPistolAbility::FinishShot()
{
	if (bButtonHeld && ChargeSeconds > 0.f)
	{
		BeginCharge();
		return;
	}
	EndAbility(CurrentSpecHandle, CurrentActorInfo, CurrentActivationInfo, true, false);
}

// ---------------------------------------------------------------------------------------------
// Charge
// ---------------------------------------------------------------------------------------------

// Runs on: owning client and server. Free movement at the charge speed, aiming follows the cursor.
void UClockworksPistolAbility::BeginCharge()
{
	bCharging = true;
	bChargeReady = false;
	UE_LOG(LogClockworks, Log, TEXT("Pistol: charging for %.2fs (hold clip %s)"), ChargeSeconds, *GetNameSafe(ChargeHoldAnim));

	if (InputTask)
	{
		InputTask->EndTask();
		InputTask = nullptr;
	}

	AddLocalTag(ClockworksTags::State_Charging);

	// Never charge without a way out. If the button is in fact already up, this fires at once and
	// the charge ends before it starts.
	ListenForRelease();

	if (ChargeHoldAnim)
	{
		PlayPhaseAnim(ChargeHoldAnim, 0.f, /*bLoop*/ true);
	}

	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().SetTimer(ChargeReadyTimer, this, &UClockworksPistolAbility::OnChargeReady, ClampPhaseSeconds(ResolveChargeSeconds(ChargeSeconds)), false);
	}
}

// Runs on: owning client and server. The aura: cosmetic, so the server tells everyone and the
// owning client shows its own straight away.
void UClockworksPistolAbility::OnChargeReady()
{
	bChargeReady = true;
	UE_LOG(LogClockworks, Log, TEXT("Pistol: charge ready"));

	// The aura stays up for as long as the charge is held, so both players can see it is loaded.
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

// Runs on: owning client and server, on release once the charge is ready.
void UClockworksPistolAbility::StartChargeAttack()
{
	bCharging = false;
	RemoveLocalTag(ClockworksTags::State_Charging);
	UE_LOG(LogClockworks, Log, TEXT("Pistol: charged shot (release %s)"), *GetNameSafe(ChargeReleaseAnim));

	// Committed from here: face where the cursor was on release, feet planted through the shot.
	AddLocalTag(ClockworksTags::State_RotationLocked);
	AddLocalTag(ClockworksTags::State_MovementLocked);

	if (ChargeReleaseAnim && ChargeReleaseSeconds > 0.f)
	{
		PlayPhaseAnim(ChargeReleaseAnim, ChargeReleaseSeconds, false, ChargeReleaseAnimRate);
	}
	if (ChargeReleaseSeconds > 0.f)
	{
		UAbilityTask_WaitDelay* Release = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(ResolveAttackSeconds(ChargeReleaseSeconds)));
		Release->OnFinish.AddDynamic(this, &UClockworksPistolAbility::OnChargeReleaseFinished);
		Release->ReadyForActivation();
	}
	else
	{
		OnChargeReleaseFinished();
	}
}

// Runs on: owning client and server. The shot leaves (server), the recoil follows (everywhere),
// then the locked follow-through.
void UClockworksPistolAbility::OnChargeReleaseFinished()
{
	PlayMoveSound(GetMove(true, 0), ChargeShotSound, /*bWithExtra*/ true);

	// A charged shot of several bullets (a Sixshot's six, an Autogun's fan) sends the rest after the first.
	FireMoveBullets(true, 0);

	UWorld* World = GetWorld();
	if (World && ChargeRecoilDistance > 0.f)
	{
		if (ChargeRecoilDelaySeconds > 0.f)
		{
			World->GetTimerManager().SetTimer(RecoilTimer, this, &UClockworksPistolAbility::StartChargeRecoil, ResolveAttackSeconds(ChargeRecoilDelaySeconds), false);
		}
		else
		{
			StartChargeRecoil();
		}
	}

	// Rotation is free again once the shot is out; the feet stay planted for the rearm.
	RemoveLocalTag(ClockworksTags::State_RotationLocked);

	if (ChargeRecoverySeconds <= 0.f)
	{
		OnChargeRecoveryFinished();
		return;
	}
	PlayChargedFire();
	UAbilityTask_WaitDelay* Recovery = UAbilityTask_WaitDelay::WaitDelay(this, ClampPhaseSeconds(ResolveAttackSeconds(ChargeRecoverySeconds)));
	Recovery->OnFinish.AddDynamic(this, &UClockworksPistolAbility::OnChargeRecoveryFinished);
	Recovery->ReadyForActivation();
}

// Runs on: owning client and server. Backward: the gun kicks.
void UClockworksPistolAbility::StartChargeRecoil()
{
	StartLunge(-ChargeRecoilDistance / ChargeRecoilSeconds, ChargeRecoilSeconds);
}

// Runs on: owning client and server.
void UClockworksPistolAbility::OnChargeRecoveryFinished()
{
	EndAbility(CurrentSpecHandle, CurrentActorInfo, CurrentActivationInfo, true, false);
}

// ---------------------------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------------------------

// Runs on: server only. The projectile replicates on its own and carries the damage; the faction
// tags on it keep it from hurting the other player.
void UClockworksPistolAbility::SpawnProjectile(TSubclassOf<AClockworksProjectile> Class, float Damage, float Speed, float Range, float InKnockbackMultiplier, const FClockworksBulletSpec* Spec, const FClockworksAttackHit* Spawn)
{
	// The weapon's own bullet flies at its own speed and reach.
	if (Spec)
	{
		Speed = Spec->SpeedCmPerSecond > 0.f ? Spec->SpeedCmPerSecond : Speed;
		Range = Spec->RangeCm > 0.f ? Spec->RangeCm : Range;
	}

	ACharacter* Avatar = GetAvatarCharacter();
	UAbilitySystemComponent* SourceAbilitySystemComponent = GetAbilitySystemComponentFromActorInfo();
	UWorld* World = Avatar ? Avatar->GetWorld() : nullptr;
	if (!Avatar || !SourceAbilitySystemComponent || !World)
	{
		return;
	}
	if (!Class)
	{
		UE_LOG(LogClockworks, Warning, TEXT("%s has no ProjectileClass; the pistol fires nothing. Set it in the BP_GA_ asset."), *GetNameSafe(GetClass()));
		return;
	}

	FVector Forward = Avatar->GetActorForwardVector();
	Forward.Z = 0.f;
	Forward = Forward.GetSafeNormal();

	const FVector SpawnLocation = Avatar->GetActorTransform().TransformPosition(MuzzleOffset);

	FActorSpawnParameters SpawnParams;
	SpawnParams.Owner = Avatar;
	SpawnParams.Instigator = Avatar;
	SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;

	float AttackPower = 0.f;
	if (const UClockworksAttributeSet* SourceAttributes = SourceAbilitySystemComponent->GetSet<UClockworksAttributeSet>())
	{
		AttackPower = SourceAttributes->GetAttackPower();
	}

	const UClockworksWeaponDefinition* SourceWeapon = GetSourceWeapon();

	// The bullet's damage types: the spawning hit's where named, else the bullet's, else the weapon's.
	const FGameplayTag WeaponType = ResolveDamageType();
	FGameplayTag PrimaryType = WeaponType;
	FGameplayTag SecondType;
	float SecondShare = 0.f;
	if (Spawn && Spawn->DamageTypes.IsSet())
	{
		ResolveDamageTypes(World, Spawn->DamageTypes, WeaponType, PrimaryType, SecondType, SecondShare);
	}
	else if (Spec && Spec->DamageTypes.IsSet())
	{
		ResolveDamageTypes(World, Spec->DamageTypes, WeaponType, PrimaryType, SecondType, SecondShare);
	}

	// One bullet of a fire pattern is exactly one bullet; the ability's cone is for weapons without one.
	const int32 BulletCount = Spawn ? 1 : FMath::Max(BulletsPerShot, 1);

	for (int32 Index = 0; Index < BulletCount; ++Index)
	{
		// A single bullet gets a small random wobble; a burst is spread evenly across the cone, so
		// an Autogun's six pellets cover a predictable arc instead of clumping at random.
		float YawOffset = 0.f;
		if (Spawn)
		{
			// The pattern's own heading, and its wobble as a total spread like SpreadAngleDegrees.
			YawOffset = Spawn->AngleDegrees + FMath::FRandRange(-Spawn->AngleVarianceDegrees * 0.5f, Spawn->AngleVarianceDegrees * 0.5f);
		}
		else if (SpreadAngleDegrees > 0.f)
		{
			YawOffset = (BulletCount > 1)
				? FMath::Lerp(-SpreadAngleDegrees * 0.5f, SpreadAngleDegrees * 0.5f, static_cast<float>(Index) / static_cast<float>(BulletCount - 1))
				: FMath::FRandRange(-SpreadAngleDegrees * 0.5f, SpreadAngleDegrees * 0.5f);
		}
		const FVector Direction = Forward.RotateAngleAxis(YawOffset, FVector::UpVector);

		AClockworksProjectile* Projectile = World->SpawnActor<AClockworksProjectile>(Class, SpawnLocation, Direction.Rotation(), SpawnParams);
		if (!Projectile)
		{
			continue;
		}

		Projectile->InitProjectile(SourceAbilitySystemComponent, Damage + AttackPower, Direction, Speed, InKnockbackMultiplier, Range, PrimaryType);
		Projectile->InitProjectileSecondType(SecondType, SecondShare);
		Projectile->InitProjectileBehaviour(ProjectileBounces, BounceDamageRetained, ProjectileGrowthScale, ProjectileGrowthDamage);
		if (Spec)
		{
			// Its look and what it does besides flying: splits, waves, sticking, passing through.
			Projectile->InitProjectileSpec(*Spec, SourceWeapon);
		}

		if (Spawn && Spawn->StatusEffect)
		{
			// The bullet's own status where its data names one.
			Projectile->InitProjectileStatus(Spawn->StatusEffect, Spawn->StatusChance, Spawn->StatusSeconds,
				StatusTickAt(World, Spawn->StatusTickDamageByDepth, Spawn->StatusTickDamage));
		}
		else if (SourceWeapon && SourceWeapon->StatusEffect)
		{
			Projectile->InitProjectileStatus(SourceWeapon->StatusEffect, SourceWeapon->StatusChance, SourceWeapon->StatusSeconds,
				StatusTickAt(World, SourceWeapon->StatusTickDamageByDepth, SourceWeapon->StatusTickDamage));
		}
		else
		{
			Projectile->InitProjectileStatus(StatusEffect, StatusChance, StatusSeconds, StatusTickDamage);
		}
	}

	// The kick. Applied once per shot, not once per bullet, so a burst does not launch the knight.
	if (ShotRecoilDistance > 0.f)
	{
		StartLunge(-ShotRecoilDistance / FMath::Max(ShotRecoilSeconds, 0.01f), ShotRecoilSeconds);
	}
}

// Runs on: owning client and server. A root motion source rather than a launch so ground friction
// cannot eat it; the movement component predicts it on the owning client and reconciles it with the
// server like any other move.
void UClockworksPistolAbility::StartLunge(float Speed, float Seconds)
{
	ACharacter* Avatar = GetAvatarCharacter();
	if (!Avatar || FMath::IsNearlyZero(Speed) || Seconds <= 0.f)
	{
		return;
	}

	FVector Direction = Avatar->GetActorForwardVector();
	Direction.Z = 0.f;
	if (Speed < 0.f)
	{
		Direction = -Direction;
		Speed = -Speed;
	}
	UAbilityTask_ApplyRootMotionConstantForce* Push = UAbilityTask_ApplyRootMotionConstantForce::ApplyRootMotionConstantForce(
		this, NAME_None, Direction.GetSafeNormal(), Speed, ClampPhaseSeconds(Seconds), /*bIsAdditive*/ false, /*StrengthOverTime*/ nullptr,
		ERootMotionFinishVelocityMode::SetVelocity, FVector::ZeroVector, 0.f, /*bEnableGravity*/ false);
	Push->ReadyForActivation();
}

// Runs on: owning client and server. Cosmetic: the owning client shows its own prediction, the
// server broadcasts to everyone else. A phase of zero seconds plays the clip at its natural speed.
void UClockworksPistolAbility::PlayPhaseAnim(UAnimSequenceBase* Anim, float PhaseSeconds, bool bLoop, float ExplicitRate, bool bHoldLastFrame)
{
	AClockworksCharacter* Knight = GetKnight();
	if (!Knight || !Anim)
	{
		return;
	}

	// An explicit rate is the original's own animation speed and is what keeps the gun fluid. Fitting
	// the clip to the gameplay phase is the fallback, and on a 0.1 s follow-through it reads as a
	// twitch rather than a motion.
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

	// Arms and chest only. Spiral Knights lets a gunner keep running while firing, and the legs
	// carrying on is what sells it; the layered blend in ABP_Knight does the rest.
	if (HasServerAuthority())
	{
		if (bHoldLastFrame && !bLoop)
		{
			Knight->MulticastPlaySlotAnimationHeld(Anim, Rate, Knight->GetUpperBodySlotName());
		}
		else
		{
			Knight->MulticastPlaySlotAnimation(Anim, Rate, bLoop, Knight->GetUpperBodySlotName());
		}
	}
	else
	{
		Knight->PlaySlotAnimation(Anim, Rate, bLoop, Knight->GetUpperBodySlotName(), bHoldLastFrame && !bLoop);
	}
}

// Runs on: owning client and server. Fitted to the move's own fire time; the follow-through waits for it.
void UClockworksPistolAbility::PlayChargedFire()
{
	const FClockworksAttackMove* Move = GetMove(true, 0);
	float EndDelay = 0.f;
	if (Move && Move->FireSequence.Num() > 0)
	{
		PlayPhaseSequence(Move->FireSequence);
		EndDelay = Move->FireSeconds;
	}
	else if (Move && Move->FireAnim)
	{
		PlayPhaseAnim(Move->FireAnim, Move->FireSeconds, false, Move->FireRate, /*bHoldLastFrame*/ true);
		EndDelay = Move->FireSeconds;
	}
	else if (!Move && ChargeEndAnim)
	{
		// No data: the Blueprint's follow-through, as before.
		PlayPhaseAnim(ChargeEndAnim, ChargeRecoverySeconds, false, ChargeEndAnimRate);
		return;
	}

	if (!ChargeEndAnim || !Move)
	{
		return;
	}
	UWorld* World = GetWorld();
	if (EndDelay <= 0.f || !World)
	{
		PlayChargeEndClip();
		return;
	}
	World->GetTimerManager().SetTimer(ChargeEndTimer, this, &UClockworksPistolAbility::PlayChargeEndClip, EndDelay, false);
}

// Runs on: owning client and server.
void UClockworksPistolAbility::PlayChargeEndClip()
{
	if (IsActive() && ChargeEndAnim)
	{
		PlayPhaseAnim(ChargeEndAnim, ChargeRecoverySeconds, false, ChargeEndAnimRate);
	}
}

// Runs on: owning client and server. Same split as the animations.
void UClockworksPistolAbility::PlayPhaseSequence(const TArray<FClockworksClipSegment>& Segments)
{
	AClockworksCharacter* Knight = GetKnight();
	if (!Knight)
	{
		return;
	}
	if (HasServerAuthority())
	{
		Knight->MulticastPlaySlotSequence(Segments, Knight->GetUpperBodySlotName());
	}
	else
	{
		Knight->PlaySlotSequence(Segments, Knight->GetUpperBodySlotName());
	}
}

// Runs on: owning client and server. Same split as the animations.
void UClockworksPistolAbility::ReleaseHeldPose()
{
	AClockworksCharacter* Knight = GetKnight();
	if (!Knight)
	{
		return;
	}
	if (HasServerAuthority())
	{
		Knight->MulticastReleaseHeldSlotAnimation(Knight->GetUpperBodySlotName());
	}
	else
	{
		Knight->ReleaseHeldSlotAnimation(0.15f, Knight->GetUpperBodySlotName());
	}
}

// Runs on: owning client and server. Same split as the animations.
void UClockworksPistolAbility::PlayPhaseSound(USoundBase* Sound)
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

// Runs on: owning client and server.
void UClockworksPistolAbility::StopPhaseAnim()
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

// Runs on: owning client and server, including on cancel. Leaves nothing running behind.
void UClockworksPistolAbility::EndAbility(const FGameplayAbilitySpecHandle Handle, const FGameplayAbilityActorInfo* ActorInfo, const FGameplayAbilityActivationInfo ActivationInfo, bool bReplicateEndAbility, bool bWasCancelled)
{
	if (UWorld* World = GetWorld())
	{
		FTimerManager& Timers = World->GetTimerManager();
		Timers.ClearTimer(ChargeReadyTimer);
		Timers.ClearTimer(RecoilTimer);
		Timers.ClearTimer(ChargeEndTimer);
		// A burst still in the air when the ability ends (a dodge, a stun) stops firing.
		for (FTimerHandle& Burst : BurstTimers)
		{
			Timers.ClearTimer(Burst);
		}
		BurstTimers.Reset();
	}
	if (InputTask)
	{
		InputTask->EndTask();
		InputTask = nullptr;
	}
	if (ReleaseTask)
	{
		ReleaseTask->EndTask();
		ReleaseTask = nullptr;
	}

	// A held gun pose ends with the ability; a follow-through still playing is left to finish.
	ReleaseHeldPose();

	// The looping hold clip must not outlive the ability; a cancelled shot clip can just blend out.
	if (bCharging || bWasCancelled)
	{
		StopPhaseAnim();
	}
	bCharging = false;
	bChargeReady = false;
	ShotsFired = 0;

	// The charge is gone, whether it was spent, dropped early or cancelled: take the aura with it.
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

	RemoveLocalTag(ClockworksTags::State_RotationLocked);
	RemoveLocalTag(ClockworksTags::State_MovementLocked);
	RemoveLocalTag(ClockworksTags::State_Charging);
	RemoveLocalTag(ClockworksTags::State_Reloading);

	Super::EndAbility(Handle, ActorInfo, ActivationInfo, bReplicateEndAbility, bWasCancelled);
}
