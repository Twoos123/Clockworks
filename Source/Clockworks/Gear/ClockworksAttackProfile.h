// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Templates/SubclassOf.h"
#include "ClockworksAttackProfile.generated.h"

class UAnimSequenceBase;
class USoundBase;
class UStaticMesh;
class UGameplayEffect;

/**
 * A sound as the original's sounders play it: one of several recordings, at a gain, with the pitch
 * picked at random from a range each time. The pitch spread is most of why ten sword swings in a row
 * do not sound like a machine. Cosmetic data only; whoever plays it picks the variant and pitch.
 */
USTRUCT(BlueprintType)
struct FClockworksWeaponSound
{
	GENERATED_BODY()

	/** Alternative recordings of the same sound; one is picked each time. */
	UPROPERTY(EditAnywhere,Category = "Sound")
	TArray<TObjectPtr<USoundBase>> Variants;

	UPROPERTY(EditAnywhere,Category = "Sound", meta = (ClampMin = "0.0"))
	float Volume = 1.f;

	UPROPERTY(EditAnywhere,Category = "Sound", meta = (ClampMin = "0.1"))
	float PitchMin = 1.f;

	UPROPERTY(EditAnywhere,Category = "Sound", meta = (ClampMin = "0.1"))
	float PitchMax = 1.f;

	bool IsSet() const { return Variants.Num() > 0; }

	/** A random variant and pitch. Null when empty. */
	USoundBase* Pick(float& OutPitch) const
	{
		OutPitch = FMath::FRandRange(FMath::Min(PitchMin, PitchMax), FMath::Max(PitchMin, PitchMax));
		return Variants.Num() > 0 ? Variants[FMath::RandRange(0, Variants.Num() - 1)].Get() : nullptr;
	}
};

/**
 * What a bullet looks like in flight. The original draws its bullets as particle systems (a bright
 * core, an additive glare, a streak behind), which do not survive export; this is those layers boiled
 * down to what a couple of glowing spheres can show: the colours, the sizes and how they pulse, the
 * streak's length, a spinning model where the bullet has one (the Magnus shell), and the muzzle flash
 * and impact that frame it. Filled per weapon from the game's own particle configs.
 */
USTRUCT(BlueprintType)
struct FClockworksBulletLook
{
	GENERATED_BODY()

	/** False leaves the projectile Blueprint's own look alone. */
	UPROPERTY(EditAnywhere,Category = "Look")
	bool bEnabled = false;

	UPROPERTY(EditAnywhere,Category = "Look")
	FLinearColor CoreColor = FLinearColor::White;

	/** Core diameter in cm at the small and the large end of its pulse. */
	UPROPERTY(EditAnywhere,Category = "Look", meta = (ClampMin = "0.0"))
	float CoreSizeMinCm = 10.f;

	UPROPERTY(EditAnywhere,Category = "Look", meta = (ClampMin = "0.0"))
	float CoreSizeMaxCm = 12.f;

	UPROPERTY(EditAnywhere,Category = "Look")
	FLinearColor GlowColor = FLinearColor(1.f, 1.f, 1.f, 0.25f);

	/** Glare diameter in cm, pulsing like the core. Zero draws no glare. */
	UPROPERTY(EditAnywhere,Category = "Look", meta = (ClampMin = "0.0"))
	float GlowSizeMinCm = 45.f;

	UPROPERTY(EditAnywhere,Category = "Look", meta = (ClampMin = "0.0"))
	float GlowSizeMaxCm = 50.f;

	/** One pulse: the original particles' lifespan. */
	UPROPERTY(EditAnywhere,Category = "Look", meta = (ClampMin = "0.01"))
	float PulseSeconds = 0.25f;

	/** Length of the streak left behind, in cm. Zero draws none. */
	UPROPERTY(EditAnywhere,Category = "Look", meta = (ClampMin = "0.0"))
	float TrailLengthCm = 0.f;

	/** A solid bullet model (the Magnus shell, the barb), drawn at MeshSizeCm along its longest side. */
	UPROPERTY(EditAnywhere,Category = "Look")
	TObjectPtr<UStaticMesh> Mesh;

	UPROPERTY(EditAnywhere,Category = "Look", meta = (ClampMin = "0.0"))
	float MeshSizeCm = 30.f;

	/** How fast the model spins about its flight line, degrees per second. */
	UPROPERTY(EditAnywhere,Category = "Look")
	float SpinDegreesPerSecond = 0.f;

	/**
	 * Pellets circling the bullet instead of a core: the Mixer line (Celestial Orbitgun, Mixmaster,
	 * Diskguns), whose shot is an invisible core carrying orbiting pellets. Zero is an ordinary bullet.
	 */
	UPROPERTY(EditAnywhere, Category = "Look", meta = (ClampMin = "0", ClampMax = "8"))
	int32 OrbitCount = 0;

	UPROPERTY(EditAnywhere, Category = "Look", meta = (ClampMin = "0.0"))
	float OrbitRadiusCm = 0.f;

	UPROPERTY(EditAnywhere, Category = "Look")
	float OrbitDegreesPerSecond = 0.f;

	/** The flash at the muzzle as it leaves. Alpha zero draws none. */
	UPROPERTY(EditAnywhere,Category = "Look")
	FLinearColor MuzzleColor = FLinearColor(0.f, 0.f, 0.f, 0.f);

	/** What it sounds like when it hits something (not when it runs out of range). */
	UPROPERTY(EditAnywhere,Category = "Look")
	FClockworksWeaponSound ImpactSound;

	/**
	 * Draws nothing in flight. Some of the original's bullets have no body at all and are seen only by
	 * what they leave: a Brandish's charge is an invisible carrier whose explosions are the attack.
	 */
	UPROPERTY(EditAnywhere, Category = "Look")
	bool bHideBody = false;

	/**
	 * What a burst of this bullet looks like (a pulse or its detonation, when either hits an area): a
	 * column of light standing on the floor, BurstWidthCm across and BurstHeightCm tall, rising and fading
	 * over BurstSeconds. Alpha zero draws none. Width zero is the burst's own diameter.
	 */
	UPROPERTY(EditAnywhere, Category = "Look|Burst")
	FLinearColor BurstColor = FLinearColor(0.f, 0.f, 0.f, 0.f);

	UPROPERTY(EditAnywhere, Category = "Look|Burst", meta = (ClampMin = "0.0"))
	float BurstWidthCm = 0.f;

	/** Zero is as tall as it is wide. */
	UPROPERTY(EditAnywhere, Category = "Look|Burst", meta = (ClampMin = "0.0"))
	float BurstHeightCm = 0.f;

	UPROPERTY(EditAnywhere, Category = "Look|Burst", meta = (ClampMin = "0.01"))
	float BurstSeconds = 0.3f;

	UPROPERTY(EditAnywhere, Category = "Look|Burst")
	FClockworksWeaponSound BurstSound;
};

/**
 * A bullet that another one breaks into or leaves behind: an Alchemer shot's split, a Pulsar orb's wave,
 * a shard bomb's shards, the crystal a Tortofist missile leaves. It names one of the weapon's SubBullets.
 */
USTRUCT(BlueprintType)
struct FClockworksBulletChild
{
	GENERATED_BODY()

	/** Index into the weapon profile's SubBullets. */
	UPROPERTY(EditAnywhere, Category = "Child")
	int32 SubBullet = INDEX_NONE;

	UPROPERTY(EditAnywhere, Category = "Child", meta = (ClampMin = "1"))
	int32 Count = 1;

	/** The whole fan they leave in, degrees, centred on the heading. 360 spaces them evenly all round. */
	UPROPERTY(EditAnywhere, Category = "Child", meta = (ClampMin = "0.0", ClampMax = "360.0"))
	float SpreadDegrees = 0.f;

	/** The heading is mirrored off what the parent hit, so a split bounces away from it. */
	UPROPERTY(EditAnywhere, Category = "Child")
	bool bRicochet = false;

	/** Each is dropped at a random point within this many cm (a Tortofist's missiles). */
	UPROPERTY(EditAnywhere, Category = "Child", meta = (ClampMin = "0.0"))
	float ScatterRadiusCm = 0.f;

	/** Damage as a multiple of the parent's. Used only when the sub-bullet carries no DamageByDepth of its own. */
	UPROPERTY(EditAnywhere, Category = "Child", meta = (ClampMin = "0.0"))
	float DamageMultiplier = 1.f;
};

/** Helpers for the per-depth damage tables every hit, bullet and burst can carry. */
namespace ClockworksAttackDepth
{
	/** A table's value at a demo depth (index 0 the lobby ... 8 the Core), or Fallback when the table is empty. */
	inline float Read(const TArray<float>& Table, int32 DemoDepth, float Fallback)
	{
		return Table.Num() > 0 ? Table[FMath::Clamp(DemoDepth, 0, Table.Num() - 1)] : Fallback;
	}
}

/** A damage type as weapon data names it. A plain enum rather than a gameplay tag, because the Python tools cannot build tags. */
UENUM(BlueprintType)
enum class EClockworksHitDamageType : uint8
{
	/** Whatever the weapon (or the bullet that carries it) deals. */
	Default,
	Normal,
	Piercing,
	Elemental,
	Shadow
};

/**
 * A hit's damage types when they are not simply its weapon's. The original splits some weapons' damage between two
 * types (a Blazebrand is Normal and Elemental) by a share that changes with depth, and a few hits deal another type
 * than their weapon. Written by apply_weapon_damage.py.
 */
USTRUCT(BlueprintType)
struct FClockworksDamageTypes
{
	GENERATED_BODY()

	/** The hit's main type. Default keeps its weapon's, or the bullet's that carries it. */
	UPROPERTY(EditAnywhere, Category = "Damage")
	EClockworksHitDamageType Primary = EClockworksHitDamageType::Default;

	/** A second type the damage is split with. Default deals one type. */
	UPROPERTY(EditAnywhere, Category = "Damage")
	EClockworksHitDamageType Second = EClockworksHitDamageType::Default;

	/** Second's share of the damage by the demo's depth (index 0 to 8, each from 0 to 1); Primary deals the rest. */
	UPROPERTY(EditAnywhere, Category = "Damage")
	TArray<float> SecondShareByDepth;

	bool IsSet() const { return Primary != EClockworksHitDamageType::Default || Second != EClockworksHitDamageType::Default; }
};

/**
 * Something a bullet does where it is, all at once: its detonation, or one of its pulses. A damage region
 * (a Brandish's explosion, a Pulsar wave's blast, a cloud's status tick, a vortex's pull) and the bullets it
 * breaks into. Empty does nothing.
 */
USTRUCT(BlueprintType)
struct FClockworksBulletBurst
{
	GENERATED_BODY()

	/** Radius of the damage region in cm. Zero opens none (the burst only spawns children). */
	UPROPERTY(EditAnywhere, Category = "Burst", meta = (ClampMin = "0.0"))
	float RadiusCm = 0.f;

	/** Damage as a multiple of the bullet's own. Zero hurts nobody, but still shoves and inflicts status. */
	UPROPERTY(EditAnywhere, Category = "Burst", meta = (ClampMin = "0.0"))
	float DamageMultiplier = 1.f;

	/**
	 * The burst's own damage by the demo's depth (index 0 to 8): the original's absolute curve for it, which replaces
	 * DamageMultiplier when set. Written by apply_weapon_damage.py.
	 */
	UPROPERTY(EditAnywhere, Category = "Burst")
	TArray<float> DamageByDepth;

	/** The burst's own damage types, when they differ from the bullet's. */
	UPROPERTY(EditAnywhere, Category = "Burst")
	FClockworksDamageTypes DamageTypes;

	/** The shove, as a multiple of a target's own knockback. Negative pulls towards the centre. */
	UPROPERTY(EditAnywhere, Category = "Burst")
	float Knockback = 1.f;

	/**
	 * Shoves along the bullet's flight instead of out from the centre. The original puts a Brandish
	 * explosion's push ten tiles behind it, so monsters are carried forward into the next explosion.
	 */
	UPROPERTY(EditAnywhere, Category = "Burst")
	bool bShoveAlongFlight = false;

	/** Chance to inflict the bullet's status. Negative uses the bullet's own chance. */
	UPROPERTY(EditAnywhere, Category = "Burst", meta = (ClampMax = "1.0"))
	float StatusChance = -1.f;

	UPROPERTY(EditAnywhere, Category = "Burst")
	TArray<FClockworksBulletChild> Children;

	bool IsSet() const { return RadiusCm > 0.f || Children.Num() > 0; }
};

/** A bullet's flight and look, per move: a gun's shot and its charged shot fly differently. */
USTRUCT(BlueprintType)
struct FClockworksBulletSpec
{
	GENERATED_BODY()

	/** cm per second. Zero keeps the ability's own. */
	UPROPERTY(EditAnywhere,Category = "Bullet", meta = (ClampMin = "0.0"))
	float SpeedCmPerSecond = 0.f;

	/** How far it flies before it fizzles, in cm. Zero keeps the ability's own. */
	UPROPERTY(EditAnywhere,Category = "Bullet", meta = (ClampMin = "0.0"))
	float RangeCm = 0.f;

	/** The hit radius in cm. Zero keeps the projectile's own. */
	UPROPERTY(EditAnywhere,Category = "Bullet", meta = (ClampMin = "0.0"))
	float CollisionRadiusCm = 0.f;

	UPROPERTY(EditAnywhere,Category = "Bullet")
	FClockworksBulletLook Look;

	/**
	 * What touching a monster does, as a multiple of the bullet's damage. Zero touches for nothing: a
	 * Brandish carrier, a cloud, a shard that only wants to land.
	 */
	UPROPERTY(EditAnywhere, Category = "Bullet|Behaviour", meta = (ClampMin = "0.0"))
	float ContactDamageMultiplier = 1.f;

	/** A monster does not stop it. With contact damage it pierces, hitting each monster once (a charged Magnus). */
	UPROPERTY(EditAnywhere, Category = "Bullet|Behaviour")
	bool bPassesThrough = false;

	/** Sticks to the monster it hits and waits (a Catalyzer's shot), bursting when a charged shot from the same knight hits that monster. */
	UPROPERTY(EditAnywhere, Category = "Bullet|Behaviour")
	bool bAttachOnHit = false;

	/** Sets off every bullet of the same knight stuck to the monster it hits (a charged Catalyzer). */
	UPROPERTY(EditAnywhere, Category = "Bullet|Behaviour")
	bool bDetonateAttachedOnHit = false;

	/** Seconds it lasts, for a bullet that does not fly (a cloud, a mine). Zero keeps the range's. */
	UPROPERTY(EditAnywhere, Category = "Bullet|Behaviour", meta = (ClampMin = "0.0"))
	float LifeSeconds = 0.f;

	/** What it does when it ends: stopped by a monster or a wall, out of range, or at the end of its life. */
	UPROPERTY(EditAnywhere, Category = "Bullet|Behaviour")
	FClockworksBulletBurst Detonation;

	/** Seconds between pulses while it lives. Zero never pulses. */
	UPROPERTY(EditAnywhere, Category = "Bullet|Behaviour", meta = (ClampMin = "0.0"))
	float PulseSeconds = 0.f;

	/** How many pulses at most. Zero is as many as its life allows. */
	UPROPERTY(EditAnywhere, Category = "Bullet|Behaviour", meta = (ClampMin = "0"))
	int32 PulseLimit = 0;

	/** It ends (and detonates) with its last pulse: a Brandish's carrier after its last explosion. */
	UPROPERTY(EditAnywhere, Category = "Bullet|Behaviour")
	bool bEndsAfterPulses = false;

	UPROPERTY(EditAnywhere, Category = "Bullet|Behaviour")
	FClockworksBulletBurst Pulse;

	/**
	 * The bullet's own damage by the demo's depth (index 0 to 8), the original's curve at the weapon's stars. Set on a
	 * sub-bullet, it replaces the parent's damage times the child's multiplier. Written by apply_weapon_damage.py.
	 */
	UPROPERTY(EditAnywhere, Category = "Bullet|Damage")
	TArray<float> DamageByDepth;

	/** The bullet's own damage types, when they differ from its weapon's (or, for a sub-bullet, its parent's). */
	UPROPERTY(EditAnywhere, Category = "Bullet|Damage")
	FClockworksDamageTypes DamageTypes;

	/**
	 * Damage the orbiting pellets deal (the Mixer line's whole attack) by the demo's depth. Every monster the ring
	 * touches is hit, again at most every OrbitHitSeconds. Empty: the pellets are only a look.
	 */
	UPROPERTY(EditAnywhere, Category = "Bullet|Damage")
	TArray<float> OrbitDamageByDepth;

	/** How soon one monster can be struck again by the orbiting pellets, in seconds (INFERRED; not in the game files). */
	UPROPERTY(EditAnywhere, Category = "Bullet|Damage", meta = (ClampMin = "0.05"))
	float OrbitHitSeconds = 0.5f;

	/**
	 * Each pellet strikes once in its life and then only circles (a Warmaster bomb's orbitals: the game's orbital turns its
	 * collision off after a hit for longer than it lives; INFERRED, research _research/weapon_gaps).
	 */
	UPROPERTY(EditAnywhere, Category = "Bullet|Damage")
	bool bOrbitPelletHitsOnce = false;

	bool IsSet() const { return SpeedCmPerSecond > 0.f; }
};

/** One clip of a run played back to back in a phase: a Sixshot's six hammer fans, a Flourish's thrusts. */
USTRUCT(BlueprintType)
struct FClockworksClipSegment
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "Clip")
	TObjectPtr<UAnimSequenceBase> Anim;

	/** Play rate: the original's speed for this clip times the clip file's own import speed. */
	UPROPERTY(EditAnywhere, Category = "Clip", meta = (ClampMin = "0.01"))
	float Rate = 1.f;

	/** Seconds into the phase at which this clip starts. */
	UPROPERTY(EditAnywhere, Category = "Clip", meta = (ClampMin = "0.0"))
	float StartSeconds = 0.f;
};

/** One push a move gives the knight, in cm on the floor: X forward, Y right. A negative X is a backstep. */
USTRUCT(BlueprintType)
struct FClockworksLunge
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "Lunge")
	FVector2D DistanceCm = FVector2D::ZeroVector;

	UPROPERTY(EditAnywhere, Category = "Lunge", meta = (ClampMin = "0.01"))
	float Seconds = 0.2f;

	/** Seconds after the fire phase begins. */
	UPROPERTY(EditAnywhere, Category = "Lunge", meta = (ClampMin = "0.0"))
	float DelaySeconds = 0.f;
};

/**
 * One moment in an attack that does something: a damage region opening, or a bullet or a bomb
 * leaving. Read straight from the original's attack configs by generate_weapon_assets.py.
 */
USTRUCT(BlueprintType)
struct FClockworksAttackHit
{
	GENERATED_BODY()

	/** Seconds after the move's fire phase begins. */
	UPROPERTY(EditAnywhere,Category = "Hit", meta = (ClampMin = "0.0"))
	float DelaySeconds = 0.f;

	/** Centre of the damage region relative to the knight, in cm: X forward, Y right. */
	UPROPERTY(EditAnywhere,Category = "Hit")
	FVector2D OffsetCm = FVector2D::ZeroVector;

	/** Radius of the damage region in cm. Zero for a moment that spawns something instead. */
	UPROPERTY(EditAnywhere,Category = "Hit", meta = (ClampMin = "0.0"))
	float RadiusCm = 0.f;

	/** The shove, as a multiple of a target's own knockback. The original's 2.5 tiles is 1. */
	UPROPERTY(EditAnywhere,Category = "Hit", meta = (ClampMin = "0.0"))
	float KnockbackMultiplier = 1.f;

	/** A bullet or a bomb leaves at this moment. */
	UPROPERTY(EditAnywhere,Category = "Hit")
	bool bSpawns = false;

	/** A bomb's fuse in seconds. Zero keeps the bomb's own. */
	UPROPERTY(EditAnywhere,Category = "Hit", meta = (ClampMin = "0.0"))
	float FuseSeconds = 0.f;

	/** A bomb's blast radius in cm. Zero keeps the ability's own. */
	UPROPERTY(EditAnywhere,Category = "Hit", meta = (ClampMin = "0.0"))
	float BlastRadiusCm = 0.f;

	/** A bullet's heading off the knight's facing, in degrees, positive to the right: a charged Autogun's sweep. */
	UPROPERTY(EditAnywhere,Category = "Hit")
	float AngleDegrees = 0.f;

	/** Random wobble either side of that heading, in degrees: the Proto Gun's is 6. */
	UPROPERTY(EditAnywhere,Category = "Hit", meta = (ClampMin = "0.0"))
	float AngleVarianceDegrees = 0.f;

	/** A rectangle instead of a circle: BoxSizeCm is its length along the facing, then its width. */
	UPROPERTY(EditAnywhere, Category = "Hit")
	bool bRectangle = false;

	UPROPERTY(EditAnywhere, Category = "Hit")
	FVector2D BoxSizeCm = FVector2D::ZeroVector;

	/** Damage as a multiple of the weapon's ordinary hit: the Calibur's charge is 2. Zero keeps the ability's own. */
	UPROPERTY(EditAnywhere, Category = "Hit", meta = (ClampMin = "0.0"))
	float DamageMultiplier = 0.f;

	/**
	 * The hit's own damage by the demo's depth (index 0 to 8): the original's curve for this swing, region, blast or the
	 * bullet it fires, at the weapon's stars (research: D:\Dev\SKAssets\_research\weapon_damage). Replaces the ability's
	 * damage and every multiplier when set. Written by apply_weapon_damage.py.
	 */
	UPROPERTY(EditAnywhere, Category = "Hit")
	TArray<float> DamageByDepth;

	/** The hit's own damage types (and the bullet's or blast's it fires), when they differ from its weapon's. */
	UPROPERTY(EditAnywhere, Category = "Hit")
	FClockworksDamageTypes DamageTypes;

	/**
	 * The spawn is a blast rather than a bullet: a Troika slam's aftershock, a Cutter's ghost swings. It
	 * goes off FuseSeconds after DelaySeconds at OffsetCm, BlastRadiusCm across.
	 */
	UPROPERTY(EditAnywhere, Category = "Hit")
	bool bBlast = false;

	/**
	 * The shove's heading off the line from the attacker to the target, in degrees, positive to the
	 * right: a Combo Strike's hits knock left and right in turn. Zero shoves straight away.
	 */
	UPROPERTY(EditAnywhere, Category = "Hit")
	float KnockbackAngleDegrees = 0.f;

	/** The status this hit itself inflicts (a Gram's charge stuns, a Faust's curses). Unset uses the weapon's. */
	UPROPERTY(EditAnywhere, Category = "Hit|Status")
	TSubclassOf<UGameplayEffect> StatusEffect;

	UPROPERTY(EditAnywhere, Category = "Hit|Status", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float StatusChance = 0.f;

	UPROPERTY(EditAnywhere, Category = "Hit|Status", meta = (ClampMin = "0.0"))
	float StatusSeconds = 0.f;

	UPROPERTY(EditAnywhere, Category = "Hit|Status", meta = (ClampMin = "0.0"))
	float StatusTickDamage = 0.f;

	/** The status's tick damage by the demo's depth (the original's status damage curve); replaces StatusTickDamage when set. */
	UPROPERTY(EditAnywhere, Category = "Hit|Status")
	TArray<float> StatusTickDamageByDepth;
};

/**
 * One move of a weapon: a swing, a shot, a reload, a charged attack or an early release.
 *
 * Spiral Knights builds every attack from a start clip, a fire clip and an end clip, each played at
 * its own speed, with a rearm after which the next move may begin. That is exactly what this holds,
 * so a Troika's slow two-hit, a Flourish's thrusts and an Autogun's stream of six bullets are all the
 * same shape of data played by the same abilities.
 */
USTRUCT(BlueprintType)
struct FClockworksAttackMove
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere,Category = "Move|Animation")
	TObjectPtr<UAnimSequenceBase> StartAnim;

	UPROPERTY(EditAnywhere,Category = "Move|Animation", meta = (ClampMin = "0.0"))
	float StartRate = 1.f;

	/** Seconds from the press to the fire phase: the start clip at its speed, or the config's own land time. */
	UPROPERTY(EditAnywhere,Category = "Move|Timing", meta = (ClampMin = "0.0"))
	float StartSeconds = 0.f;

	UPROPERTY(EditAnywhere,Category = "Move|Animation")
	TObjectPtr<UAnimSequenceBase> FireAnim;

	UPROPERTY(EditAnywhere,Category = "Move|Animation", meta = (ClampMin = "0.0"))
	float FireRate = 1.f;

	/** Seconds the fire clip runs at its speed, which is also how long a sword's hitbox stays live. */
	UPROPERTY(EditAnywhere,Category = "Move|Timing", meta = (ClampMin = "0.0"))
	float FireSeconds = 0.f;

	UPROPERTY(EditAnywhere,Category = "Move|Animation")
	TObjectPtr<UAnimSequenceBase> EndAnim;

	UPROPERTY(EditAnywhere,Category = "Move|Animation", meta = (ClampMin = "0.0"))
	float EndRate = 1.f;

	/** The original's rearm: seconds after firing before the next move may start. */
	UPROPERTY(EditAnywhere,Category = "Move|Timing", meta = (ClampMin = "0.0"))
	float RecoverySeconds = 0.f;

	/** The original's clear: seconds after firing before the weapon returns to idle. */
	UPROPERTY(EditAnywhere,Category = "Move|Timing", meta = (ClampMin = "0.0"))
	float ClearSeconds = 0.f;

	/** The step the knight takes, in cm along its facing. Negative is a recoil backwards. */
	UPROPERTY(EditAnywhere,Category = "Move|Lunge")
	float LungeDistanceCm = 0.f;

	UPROPERTY(EditAnywhere,Category = "Move|Lunge", meta = (ClampMin = "0.0"))
	float LungeSeconds = 0.f;

	UPROPERTY(EditAnywhere,Category = "Move|Lunge", meta = (ClampMin = "0.0"))
	float LungeDelaySeconds = 0.f;

	UPROPERTY(EditAnywhere,Category = "Move")
	TArray<FClockworksAttackHit> Hits;

	/** The sound the move makes as it fires. Empty keeps the ability's own. */
	UPROPERTY(EditAnywhere,Category = "Move")
	FClockworksWeaponSound Sound;

	/** A second sound on top of it: a charged shot's crack, a reload's second click, a dud's fizzle. */
	UPROPERTY(EditAnywhere,Category = "Move")
	FClockworksWeaponSound ExtraSound;

	/** The bullets this move fires, when it fires any. */
	UPROPERTY(EditAnywhere,Category = "Move")
	FClockworksBulletSpec Bullet;

	/** The fire phase as a run of clips, when the original plays several. Empty plays FireAnim alone. */
	UPROPERTY(EditAnywhere, Category = "Move|Animation")
	TArray<FClockworksClipSegment> FireSequence;

	/** Every push of the move, backsteps and second impulses included. Empty uses the single lunge above. */
	UPROPERTY(EditAnywhere, Category = "Move|Lunge")
	TArray<FClockworksLunge> Lunges;

	bool IsSet() const { return StartAnim != nullptr || FireAnim != nullptr || Hits.Num() > 0; }
};

/**
 * Everything that makes one weapon move like itself in the original: its combo or clip, its charge
 * and its reload. Empty means the attack ability's own defaults, which are the Calibur, the Proto Gun
 * and the Proto Bomb.
 */
USTRUCT(BlueprintType)
struct FClockworksAttackProfile
{
	GENERATED_BODY()

	/** A sword's swings in order, or a gun's shots before its reload. */
	UPROPERTY(EditAnywhere,Category = "Attack")
	TArray<FClockworksAttackMove> Chain;

	UPROPERTY(EditAnywhere,Category = "Attack")
	FClockworksAttackMove ChargedAttack;

	/** Letting go before the charge is ready: a sword's quick swing, a bomb's dud. */
	UPROPERTY(EditAnywhere,Category = "Attack")
	FClockworksAttackMove IncompleteCharge;

	UPROPERTY(EditAnywhere,Category = "Attack")
	FClockworksAttackMove Reload;

	UPROPERTY(EditAnywhere,Category = "Attack")
	TObjectPtr<UAnimSequenceBase> ChargeHoldAnim;

	/** Seconds the button must be held for the charge. Zero keeps the ability's own. */
	UPROPERTY(EditAnywhere,Category = "Attack", meta = (ClampMin = "0.0"))
	float ChargeSeconds = 0.f;

	/** A sword connecting, or a bomb going off. Empty keeps the ability's or the bomb's own. */
	UPROPERTY(EditAnywhere,Category = "Attack")
	FClockworksWeaponSound ImpactSound;

	/** A second layer on the impact: a bomb blast's small debris sounds. */
	UPROPERTY(EditAnywhere,Category = "Attack")
	FClockworksWeaponSound ImpactExtraSound;

	/** A bomb landing on the floor. Played by the bomb itself, as the original's bomb model does. */
	UPROPERTY(EditAnywhere,Category = "Attack")
	FClockworksWeaponSound DropSound;

	/**
	 * The bullets this weapon's bullets break into or leave behind, named by index from a burst's
	 * children. A bomb's own detonation children and pull live on ChargedAttack.Bullet.Detonation.
	 */
	UPROPERTY(EditAnywhere, Category = "Attack")
	TArray<FClockworksBulletSpec> SubBullets;

	bool IsSet() const { return Chain.Num() > 0 || ChargedAttack.IsSet(); }
};
