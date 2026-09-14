// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksEnemyAIController.h"
#include "ClockworksCharacter.h"
#include "ClockworksEnemyCharacter.h"
#include "ClockworksGameplayTags.h"
#include "AbilitySystemComponent.h"
#include "AbilitySystemInterface.h"
#include "Camera/CameraComponent.h"
#include "Engine/World.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"

// Runs on: server only (AI controllers are never replicated).
AClockworksEnemyAIController::AClockworksEnemyAIController()
{
	PrimaryActorTick.bCanEverTick = true;
}

// Runs on: server only.
void AClockworksEnemyAIController::OnPossess(APawn* InPawn)
{
	Super::OnPossess(InPawn);

	State = EClockworksEnemyState::Idle;
	TargetActor = nullptr;
}

// Runs on: server only.
void AClockworksEnemyAIController::OnUnPossess()
{
	StopMovement();
	TargetActor = nullptr;

	Super::OnUnPossess();
}

// Runs on: server only.
bool AClockworksEnemyAIController::IsValidTarget(const AActor* Actor)
{
	const AClockworksCharacter* Player = Cast<AClockworksCharacter>(Actor);
	if (!Player)
	{
		return false;
	}
	const UAbilitySystemComponent* AbilitySystemComponent = Player->GetAbilitySystemComponent();
	return AbilitySystemComponent && !AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Dead);
}

// Runs on: server only. The knight's camera is a fixed boom off its pawn, so the server's copy of the
// pawn carries a correct camera transform for every player, host and client alike. The aspect ratio
// is the camera's setting, not the client's real window; close enough for "is it on my screen".
bool AClockworksEnemyAIController::IsOnScreenOf(const AClockworksCharacter* Player, const FVector& WorldLocation) const
{
	const UCameraComponent* Camera = Player ? Player->GetTopDownCameraComponent() : nullptr;
	if (!Camera)
	{
		return false;
	}

	const FVector Local = Camera->GetComponentRotation().UnrotateVector(WorldLocation - Camera->GetComponentLocation());
	if (Local.X <= KINDA_SMALL_NUMBER)
	{
		return false; // behind the camera
	}

	const float TanHalfHorizontal = FMath::Tan(FMath::DegreesToRadians(Camera->FieldOfView * 0.5f));
	const float Aspect = Camera->AspectRatio > KINDA_SMALL_NUMBER ? Camera->AspectRatio : (16.f / 9.f);
	const float TanHalfVertical = TanHalfHorizontal / Aspect;
	const float Scale = 1.f + ScreenEdgeMargin;

	return FMath::Abs(Local.Y) <= Local.X * TanHalfHorizontal * Scale
		&& FMath::Abs(Local.Z) <= Local.X * TanHalfVertical * Scale;
}

// Runs on: server only. Nearest player who can see this enemy wins; that is what splits aggro.
AActor* AClockworksEnemyAIController::ChooseTarget() const
{
	const APawn* MyPawn = GetPawn();
	UWorld* World = GetWorld();
	if (!MyPawn || !World)
	{
		return nullptr;
	}

	AActor* Best = nullptr;
	float BestDistanceSquared = TNumericLimits<float>::Max();
	for (FConstPlayerControllerIterator It = World->GetPlayerControllerIterator(); It; ++It)
	{
		const APlayerController* PlayerController = It->Get();
		AClockworksCharacter* Player = PlayerController ? Cast<AClockworksCharacter>(PlayerController->GetPawn()) : nullptr;
		if (!IsValidTarget(Player) || !IsOnScreenOf(Player, MyPawn->GetActorLocation()))
		{
			continue;
		}
		const float DistanceSquared = FVector::DistSquared2D(Player->GetActorLocation(), MyPawn->GetActorLocation());
		if (DistanceSquared < BestDistanceSquared)
		{
			BestDistanceSquared = DistanceSquared;
			Best = Player;
		}
	}
	return Best;
}

// Runs on: server only.
UAbilitySystemComponent* AClockworksEnemyAIController::GetPawnAbilitySystemComponent() const
{
	const IAbilitySystemInterface* Interface = Cast<IAbilitySystemInterface>(GetPawn());
	return Interface ? Interface->GetAbilitySystemComponent() : nullptr;
}

// Runs on: server only. The whole decision loop.
void AClockworksEnemyAIController::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	APawn* MyPawn = GetPawn();
	UAbilitySystemComponent* AbilitySystemComponent = GetPawnAbilitySystemComponent();
	if (!MyPawn || !AbilitySystemComponent || AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Dead))
	{
		StopMovement();
		State = EClockworksEnemyState::Idle;
		return;
	}

	// While the attack ability owns the pawn, do nothing. It ends on its own.
	if (AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Attacking))
	{
		State = EClockworksEnemyState::Attack;
		return;
	}

	// Reconsider the target now and then. Keep the current one while it can still see us; drop it
	// after it has been off screen for long enough or died.
	ReevaluateTimer -= DeltaSeconds;
	if (ReevaluateTimer <= 0.f || !TargetActor.IsValid())
	{
		ReevaluateTimer = TargetReevaluateSeconds;
		if (AActor* Chosen = ChooseTarget())
		{
			TargetActor = Chosen;
		}
	}
	if (TargetActor.IsValid())
	{
		const AClockworksCharacter* TargetPlayer = Cast<AClockworksCharacter>(TargetActor.Get());
		if (IsValidTarget(TargetPlayer) && IsOnScreenOf(TargetPlayer, MyPawn->GetActorLocation()))
		{
			TimeSinceTargetSeen = 0.f;
		}
		else
		{
			TimeSinceTargetSeen += DeltaSeconds;
		}
		if (TimeSinceTargetSeen > LoseTargetSeconds || !IsValidTarget(TargetPlayer))
		{
			TargetActor = nullptr;
			TimeSinceTargetSeen = 0.f;
		}
	}

	AActor* Target = TargetActor.Get();
	if (!Target)
	{
		if (State != EClockworksEnemyState::Idle)
		{
			StopMovement();
			State = EClockworksEnemyState::Idle;
		}
		return;
	}

	// Range, sight rules and turret-ness come from the enemy class; the brain is shared.
	const AClockworksEnemyCharacter* Enemy = Cast<AClockworksEnemyCharacter>(MyPawn);
	const float Range = Enemy ? Enemy->GetAttackRange() : AttackRange;
	const bool bNeedsLineOfSight = Enemy && Enemy->AttackNeedsLineOfSight();
	const bool bStationary = Enemy && Enemy->IsStationary();

	// A turret keeps its target in front of it instead of walking.
	if (bStationary)
	{
		FVector ToTarget = Target->GetActorLocation() - MyPawn->GetActorLocation();
		ToTarget.Z = 0.f;
		if (!ToTarget.IsNearlyZero())
		{
			const FRotator Desired = ToTarget.Rotation();
			const float TurnRate = Enemy ? Enemy->GetTurnRateDegrees() : 180.f;
			MyPawn->SetActorRotation(FMath::RInterpConstantTo(MyPawn->GetActorRotation(), Desired, DeltaSeconds, TurnRate));
		}
	}

	// Close enough, off cooldown and (for shooters) with a clear line: attack. The ability handles
	// the telegraph and the rest. Ability.Attack is the parent tag, so melee and ranged both answer.
	const float Distance = FVector::Dist2D(Target->GetActorLocation(), MyPawn->GetActorLocation());
	if (Distance <= Range && !AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::Cooldown_Attack))
	{
		if (!bNeedsLineOfSight || LineOfSightTo(Target))
		{
			StopMovement();
			if (AbilitySystemComponent->TryActivateAbilitiesByTag(FGameplayTagContainer(ClockworksTags::Ability_Attack)))
			{
				State = EClockworksEnemyState::Attack;
				RepathTimer = 0.f;
				return;
			}
		}
	}

	if (bStationary)
	{
		State = EClockworksEnemyState::Idle;
		return;
	}

	// Otherwise chase. Refresh the path on a timer rather than every frame.
	RepathTimer -= DeltaSeconds;
	if (State != EClockworksEnemyState::Chase || RepathTimer <= 0.f)
	{
		RepathTimer = RepathSeconds;
		State = EClockworksEnemyState::Chase;
		MoveToActor(Target, Range * 0.5f, /*bStopOnOverlap*/ true, /*bUsePathfinding*/ true, /*bCanStrafe*/ false);
	}
}
