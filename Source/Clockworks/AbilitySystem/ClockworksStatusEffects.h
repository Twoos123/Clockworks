// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameplayEffect.h"
#include "ClockworksStatusEffects.generated.h"

/**
 * All seven Spiral Knights statuses.
 *
 * A status is not a damage bonus. Each of these changes what the person holding the controller
 * should do next, and that is the whole reason to carry a weapon whose damage type is resisted:
 * something that cannot move cannot hit you, whatever its resistances are.
 *
 * Every one takes its duration from a SetByCaller (Data.Duration), so how long a status lasts
 * belongs to the weapon that inflicted it rather than to the status. Several also read
 * Data.Damage for their per-tick or on-break damage.
 *
 * All of these are gameplay, so they only ever exist on the server's copy of an ability system
 * component. Their tags replicate out from there to drive what everyone sees.
 */

/**
 * Fire. Periodic damage for a few seconds, and it cancels a charge the moment it lands.
 *
 * In the original, burning ignores defense and shields once it has started, which is what makes it
 * the answer to something heavily armoured. That part is handled in the attribute set, which is the
 * only place that knows what defense is.
 */
UCLASS()
class UClockworksFireEffect : public UGameplayEffect
{
	GENERATED_BODY()

public:

	UClockworksFireEffect();
};

/**
 * Freeze. The target cannot move or turn, but can still attack, and cannot be shoved.
 *
 * Any hit breaks it early. A monster left to thaw on its own takes the thaw damage (Data.Damage, dealt by
 * UClockworksGameplayAbility::TryApplyStatus when the effect runs its full time); one you break early takes none,
 * which is the trade the original asks you to think about. A knight pays the thaw only when a monster breaks its
 * ice. The breaking is handled in the attribute set, because that is where a hit becomes a hit.
 */
UCLASS()
class UClockworksFreezeEffect : public UGameplayEffect
{
	GENERATED_BODY()

public:

	UClockworksFreezeEffect();
};

/**
 * Shock. Spasms at intervals: damage plus an interrupt, and any charge is cancelled.
 *
 * Each spasm, every 1 to 4 s, is an arc of elemental damage (Data.Damage) on the shocked thing and everything on its
 * side within 2 tiles, scheduled by UClockworksGameplayAbility::TryApplyStatus.
 *
 * A knight is always interrupted by it. That is why it is the status you want against something
 * that is about to do something you cannot survive.
 */
UCLASS()
class UClockworksShockEffect : public UGameplayEffect
{
	GENERATED_BODY()

public:

	UClockworksShockEffect();
};

/**
 * Poison. No healing, less damage dealt, and less defense.
 *
 * The one status that does no damage at all. It is a softener: you poison something so that the next
 * thing you do to it lands harder, and so it cannot undo what you have already done.
 */
UCLASS()
class UClockworksPoisonEffect : public UGameplayEffect
{
	GENERATED_BODY()

public:

	UClockworksPoisonEffect();
};

/**
 * Stun. Movement and attack speed cut sharply, for a very short time.
 *
 * Distinct from being unable to act: a stunned target is still coming for you, just slowly enough
 * that you can leave. This is what the shield bash inflicts.
 */
UCLASS()
class UClockworksStatusStunEffect : public UGameplayEffect
{
	GENERATED_BODY()

public:

	UClockworksStatusStunEffect();
};

/**
 * Curse. Attacking costs the attacker health.
 *
 * On a monster this is punishing rather than disabling: it keeps fighting and keeps hurting itself
 * for doing so. Each attack it uses costs the curse's own damage (Data.Damage), at most 40, charged by
 * UClockworksAttributeSet::HandleAbilityActivated.
 */
UCLASS()
class UClockworksCurseEffect : public UGameplayEffect
{
	GENERATED_BODY()

public:

	UClockworksCurseEffect();
};

/**
 * Sleep. Completely unresponsive until something hits it, and it cannot be shoved.
 *
 * Waking it costs it: the hit that wakes it adds the sleep's wake damage (Data.Damage, the original's
 * depth-scaled amount), so sleep is an opener rather than a way to keep something down. Handled on break
 * in the attribute set.
 */
UCLASS()
class UClockworksSleepEffect : public UGameplayEffect
{
	GENERATED_BODY()

public:

	UClockworksSleepEffect();
};
