// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "AIController.h"
#include "ClockworksEnemyAIController.generated.h"

class AClockworksCharacter;
class UAbilitySystemComponent;

/** What the enemy is doing right now. Exposed for debugging; the controller decides it every tick. */
UENUM(BlueprintType)
enum class EClockworksEnemyState : uint8
{
	Idle,
	Chase,
	Attack,
	Stunned
};

/**
 * The brain of every enemy. A small, explicit state machine rather than a Behavior Tree so the
 * decision logic is readable in a diff and needs no editor graph:
 *   Idle   - no player has this enemy on screen. Stand still.
 *   Chase  - path toward the current target until within attack range.
 *   Attack - the attack ability owns the pawn (State.Attacking); wait for it to end.
 *
 * Aggro is "am I on a player's screen". The camera is fixed relative to each knight, so the server
 * can rebuild every player's view from their pawn and test the enemy against it; no perception
 * component, no line of sight. Once aggroed the enemy keeps its target while it stays on someone's
 * screen and drops it LoseTargetSeconds after it doesn't. The nearest eligible player wins and the
 * choice is re-checked every TargetReevaluateSeconds, so two players split aggro by proximity.
 *
 * AI controllers exist on the server only, so everything here is server-side by construction. The
 * pawn's replicated movement is what clients see.
 */
UCLASS()
class AClockworksEnemyAIController : public AAIController
{
	GENERATED_BODY()

public:

	AClockworksEnemyAIController();

	/** The player this enemy is currently after, or null. Read by attack abilities for their telegraph. */
	AActor* GetTargetActor() const { return TargetActor.Get(); }

	EClockworksEnemyState GetEnemyState() const { return State; }

protected:

	virtual void OnPossess(APawn* InPawn) override;
	virtual void OnUnPossess() override;
	virtual void Tick(float DeltaSeconds) override;

	/** Picks the nearest live player who has this enemy on screen, or null. */
	AActor* ChooseTarget() const;

	/** True if the enemy at WorldLocation would be inside this player's camera view. */
	bool IsOnScreenOf(const AClockworksCharacter* Player, const FVector& WorldLocation) const;

	/** True if the actor is a live player character with an ability system component. */
	static bool IsValidTarget(const AActor* Actor);

	UAbilitySystemComponent* GetPawnAbilitySystemComponent() const;

	/** Fallback attack distance in cm for pawns that are not AClockworksEnemyCharacter; enemies carry their own. */
	UPROPERTY(EditDefaultsOnly, Category = "AI", meta = (ClampMin = "0.0"))
	float AttackRange = 220.f;

	/** How often the path to the target is refreshed while chasing, in seconds. */
	UPROPERTY(EditDefaultsOnly, Category = "AI", meta = (ClampMin = "0.05"))
	float RepathSeconds = 0.3f;

	/** How often the enemy reconsiders which player to chase, in seconds. */
	UPROPERTY(EditDefaultsOnly, Category = "AI", meta = (ClampMin = "0.1"))
	float TargetReevaluateSeconds = 1.f;

	/** Seconds off every player's screen before the enemy gives up and returns to Idle. */
	UPROPERTY(EditDefaultsOnly, Category = "AI", meta = (ClampMin = "0.0"))
	float LoseTargetSeconds = 3.f;

	/**
	 * Grows the screen test by this fraction on each side, so an enemy just past the edge still
	 * counts as seen. Negative shrinks it, so the enemy must be well inside the view.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "AI", meta = (ClampMin = "-0.5", ClampMax = "1.0"))
	float ScreenEdgeMargin = 0.0f;

	/** Logged once per enemy so a missing navigation mesh is visible in the log without spam. */
	bool bWarnedNoPath = false;

private:

	TWeakObjectPtr<AActor> TargetActor;
	EClockworksEnemyState State = EClockworksEnemyState::Idle;

	float RepathTimer = 0.f;
	float ReevaluateTimer = 0.f;
	float TimeSinceTargetSeen = 0.f;
};
