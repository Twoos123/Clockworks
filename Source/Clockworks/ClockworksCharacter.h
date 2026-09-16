// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "AbilitySystemInterface.h"
#include "GameplayTagContainer.h"
#include "ClockworksAttackProfile.h"
#include "ClockworksCharacter.generated.h"

class UAnimMontage;
class UAnimSequenceBase;
class UCameraComponent;
class UStaticMeshComponent;
class USpringArmComponent;
class UInputAction;
class UGameplayAbility;
class UAbilitySystemComponent;
class UMaterialInterface;
class UMaterialInstanceDynamic;
class AClockworksDamageNumber;
class AClockworksHitSpark;
class UClockworksStatusDisplay;
class UAudioComponent;
class USoundBase;
class UClockworksWeaponDefinition;
class UClockworksGearDefinition;
struct FInputActionValue;
struct FOnAttributeChangeData;

/**
 *  A controllable top-down perspective character.
 *  Moves with WASD relative to the fixed camera and faces the control yaw,
 *  which AClockworksPlayerController sets from the mouse cursor.
 *  Its ability system component lives on the PlayerState; this class wires the two together.
 */
UCLASS(abstract)
class AClockworksCharacter : public ACharacter, public IAbilitySystemInterface
{
	GENERATED_BODY()

private:

	/** Top down camera */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Components", meta = (AllowPrivateAccess = "true"))
	TObjectPtr<UCameraComponent> TopDownCameraComponent;

	/** Camera boom positioning the camera above the character */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Components", meta = (AllowPrivateAccess = "true"))
	TObjectPtr<USpringArmComponent> CameraBoom;

	/**
	 * The knight's helmet and face are rigid pieces riding the head bone, not part of the skinned
	 * body (that is how Spiral Knights builds a knight). Blueprint children assign the meshes.
	 */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Components", meta = (AllowPrivateAccess = "true"))
	TObjectPtr<UStaticMeshComponent> HelmetMesh;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Components", meta = (AllowPrivateAccess = "true"))
	TObjectPtr<UStaticMeshComponent> FaceMesh;

	/**
	 * The weapon in the main hand, riding bone_weapon_r. Spiral Knights weapons are separate models
	 * snapped onto that bone. RefreshWeaponVisuals swaps the mesh to the drawn weapon's; the
	 * Blueprint's assignment is only what shows before a loadout exists.
	 */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Components", meta = (AllowPrivateAccess = "true"))
	TObjectPtr<UStaticMeshComponent> WeaponMesh;

	/** The drawn weapon's other model pieces, riding WeaponMesh. Made as a weapon first needs them. */
	UPROPERTY(Transient)
	TArray<TObjectPtr<UStaticMeshComponent>> WeaponExtraMeshes;

	/**
	 * The shield: on the back (ShieldAwaySocket) until raised, then on the arm (ShieldRaisedSocket),
	 * the way Spiral Knights carries it. Cosmetic: blocking is a rule in the attribute set, not a
	 * collision. The Blueprint assigns the mesh.
	 */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Components", meta = (AllowPrivateAccess = "true"))
	TObjectPtr<UStaticMeshComponent> ShieldMesh;

	/**
	 * The shield dome: a sphere around the knight while the shield is up, tinted by how much shield is
	 * left. Spiral Knights reads the dome's colour as its health (blue full, green slight damage,
	 * yellow moderate, orange heavy); a shattered shield shows a flat red aura at the feet instead of
	 * a dome, and a cyan flash at the feet when it comes back.
	 *
	 * Cosmetic. Everything it shows comes from replicated state, so every machine paints its own and
	 * nothing is sent for it.
	 */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Components", meta = (AllowPrivateAccess = "true"))
	TObjectPtr<UStaticMeshComponent> ShieldBubbleMesh;

	/**
	 * Shows and sounds whatever statuses the knight is under. Cosmetic and local; the status tags
	 * it reads replicate as part of the ability system's own state.
	 */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Components", meta = (AllowPrivateAccess = "true"))
	TObjectPtr<UClockworksStatusDisplay> StatusDisplay;

protected:

	/** WASD movement action (Axis2D: X = right, Y = forward). Assigned in BP_ClockworksCharacter. */
	UPROPERTY(EditDefaultsOnly, Category="Input")
	TObjectPtr<UInputAction> MoveAction;

	/** Left mouse button. */
	UPROPERTY(EditDefaultsOnly, Category="Input")
	TObjectPtr<UInputAction> AttackAction;

	/** Shift + right mouse button (a chorded action in the mapping context). */
	UPROPERTY(EditDefaultsOnly, Category="Input")
	TObjectPtr<UInputAction> DodgeAction;

	/** Space and the mouse wheel: draw the next or previous weapon. Axis1D; the sign picks the direction. */
	UPROPERTY(EditDefaultsOnly, Category="Input")
	TObjectPtr<UInputAction> SwitchWeaponAction;

	/** Right mouse button, held: the shield stays up while it is down. */
	UPROPERTY(EditDefaultsOnly, Category="Input")
	TObjectPtr<UInputAction> ShieldAction;

	/** Shift + left mouse button (a chorded action in the mapping context): the shield bash. */
	UPROPERTY(EditDefaultsOnly, Category="Input")
	TObjectPtr<UInputAction> ShieldBashAction;

	/**
	 * Granted on the server when this character is first possessed. Swap in Blueprint children to
	 * tune. Weapon attacks do not belong here: the drawn weapon grants its own (DefaultLoadout), and
	 * an entry that matches a loadout weapon's ability is skipped so it cannot be granted twice.
	 */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Abilities")
	TArray<TSubclassOf<UGameplayAbility>> DefaultAbilities;

	/** The weapons the knight spawns with, in toolbar order; the first is drawn. Set in BP_ClockworksCharacter. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Gear")
	TArray<TObjectPtr<UClockworksWeaponDefinition>> DefaultLoadout;

	/** The gear the knight spawns wearing, in slot order: helmet, armour, shield, trinket, trinket. Set in BP_ClockworksCharacter. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Gear")
	TArray<TObjectPtr<UClockworksGearDefinition>> DefaultGear;

	/** The knight's own health before gear. Spiral Knights: five pips of 40 (user's decision, 2026-09-15). */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Attributes", meta = (ClampMin = "1.0"))
	float InitialMaxHealth = 200.f;

	UPROPERTY(EditDefaultsOnly, Category="Combat|Attributes", meta = (ClampMin = "0.0"))
	float InitialHealth = 200.f;

	UPROPERTY(EditDefaultsOnly, Category="Combat|Attributes", meta = (ClampMin = "0.0"))
	float InitialMaxShield = 0.f;

	UPROPERTY(EditDefaultsOnly, Category="Combat|Attributes", meta = (ClampMin = "0.0"))
	float InitialShield = 0.f;

	UPROPERTY(EditDefaultsOnly, Category="Combat|Attributes", meta = (ClampMin = "0.0"))
	float InitialAttackPower = 0.f;

	UPROPERTY(EditDefaultsOnly, Category="Combat|Attributes", meta = (ClampMin = "0.0"))
	float InitialDefensePower = 0.f;

	/** Walk speed in cm/s. Becomes the MoveSpeed attribute, which drives the movement component. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Attributes", meta = (ClampMin = "0.0"))
	float InitialMoveSpeed = 400.f;

	/** Fraction of walk speed kept while attacking, when no weapon is drawn. The drawn weapon's own value wins. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Feel", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float AttackMoveSpeedMultiplier = 0.25f;

	/** Fraction of walk speed kept while charging, when no weapon is drawn. The drawn weapon's own value wins. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Feel", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float ChargeMoveSpeedMultiplier = 1.f;

	/** Bone the shield rides while raised: the arm. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Shield")
	FName ShieldRaisedSocket = TEXT("bone_shield");

	/** Bone the shield rides while lowered: the back. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Shield")
	FName ShieldAwaySocket = TEXT("bone_shield_away");

	/** Fraction of walk speed kept while the shield is up. Spiral Knights: half. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Shield", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float ShieldMoveSpeedMultiplier = 0.5f;

	/** Seconds after a blocked hit before the shield starts refilling. Spiral Knights: 3. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Shield", meta = (ClampMin = "0.0"))
	float ShieldRegenDelaySeconds = 3.f;

	/** Seconds an empty shield takes to refill completely. Spiral Knights: 6. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Shield", meta = (ClampMin = "0.1"))
	float ShieldRegenSeconds = 6.f;

	/** Seconds a shattered shield stays down (State.ShieldBroken) before it refills and can rise again. Spiral Knights: 8. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Shield", meta = (ClampMin = "0.0"))
	float ShieldBrokenSeconds = 8.f;

	/** Raising the shield (SK ready_shield), fitted to ShieldRaiseSeconds, then the hold loop (SK blend_shield). Cosmetic. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Shield|Animation")
	TObjectPtr<UAnimSequenceBase> ShieldRaiseAnim;

	UPROPERTY(EditDefaultsOnly, Category="Combat|Shield|Animation", meta = (ClampMin = "0.0"))
	float ShieldRaiseSeconds = 0.15f;

	UPROPERTY(EditDefaultsOnly, Category="Combat|Shield|Animation")
	TObjectPtr<UAnimSequenceBase> ShieldHoldAnim;

	/** Played over the hold when a hit is blocked (SK shield_hit), fitted to ShieldHitSeconds. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Shield|Animation")
	TObjectPtr<UAnimSequenceBase> ShieldHitAnim;

	UPROPERTY(EditDefaultsOnly, Category="Combat|Shield|Animation", meta = (ClampMin = "0.0"))
	float ShieldHitSeconds = 0.3f;

	/**
	 * Slot in ABP_Knight that replaces the whole body: a sword swing, a dodge, a shield bash, a death.
	 */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Animation")
	FName FullBodySlotName = TEXT("DefaultSlot");

	/**
	 * Slot in ABP_Knight that only replaces the arms and chest, layered onto the locomotion from
	 * Bip01-Spine1 up. Shooting, reloading and blocking use it so the legs keep running, which is how
	 * Spiral Knights lets you walk and fire at the same time.
	 */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Animation")
	FName UpperBodySlotName = TEXT("UpperBody");

	/** Unlit translucent material for the dome, with a colour parameter this class tints per frame. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Shield|Bubble")
	TObjectPtr<UMaterialInterface> ShieldBubbleMaterial;

	/** The vector parameter on that material that takes the colour. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Shield|Bubble")
	FName ShieldBubbleColorParameter = TEXT("BubbleColor");

	/** Radius of the dome in cm. The knight is about 116 tall, so 120 just covers the head. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Shield|Bubble", meta = (ClampMin = "1.0"))
	float ShieldBubbleRadius = 120.f;

	/**
	 * Height of the sphere's centre above the knight's feet, in cm. Zero buries the bottom half in the
	 * floor, which is what makes it read as a dome rather than a ball the knight is standing inside.
	 * Negative sinks it further.
	 */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Shield|Bubble")
	float ShieldBubbleCentreHeight = 0.f;

	/** Thickness of the flat aura at the feet, in cm. Used for both the shattered and restored looks. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Shield|Bubble", meta = (ClampMin = "0.1"))
	float ShieldAuraHeight = 14.f;

	/**
	 * The dome's colour from an empty shield to a full one, blended across the remaining fraction.
	 * Spiral Knights' four states in that order: heavy damage, moderate, slight, full. Repeat an
	 * entry to make the change a step rather than a fade.
	 */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Shield|Bubble")
	TArray<FLinearColor> ShieldBubbleColors;

	/** The aura while the shield is shattered and cannot be raised. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Shield|Bubble")
	FLinearColor ShieldBrokenColor = FLinearColor(1.f, 0.04f, 0.04f, 1.f);

	/** The flash at the feet when a shattered shield comes back. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Shield|Bubble")
	FLinearColor ShieldRestoredColor = FLinearColor(0.1f, 1.f, 1.f, 1.f);

	UPROPERTY(EditDefaultsOnly, Category="Combat|Shield|Bubble", meta = (ClampMin = "0.0"))
	float ShieldRestoredFlashSeconds = 0.4f;

	/** Drawn over the mesh for as long as a ready charge is held (Spiral Knights' yellow aura). Falls back to HitFlashMaterial. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Feedback")
	TObjectPtr<UMaterialInterface> ChargeReadyFlashMaterial;

	/** Drawn over the mesh for a moment when hit. Same material the enemies use reads consistently. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Feedback")
	TObjectPtr<UMaterialInterface> HitFlashMaterial;

	UPROPERTY(EditDefaultsOnly, Category="Combat|Feedback", meta = (ClampMin = "0.0"))
	float HitFlashSeconds = 0.1f;

	/**
	 * Hitstop: the animation freezes for a moment on a landed hit so the blow has weight. Purely
	 * cosmetic — it pauses the mesh, never the actor, so movement, abilities and replication all
	 * carry on untouched and nothing about it can desynchronise the two machines.
	 */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Feedback", meta = (ClampMin = "0.0"))
	float HitstopSeconds = 0.06f;

	/** The flash where a hit lands. Spawned locally on every machine from the hit flash; never replicated. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Feedback")
	TSubclassOf<AClockworksHitSpark> HitSparkClass;

	/** How far up the body the spark appears, in cm. Roughly chest height on the knight. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Feedback")
	float HitSparkHeight = 60.f;

	/**
	 * The swing trail: a smear of small, short-lived marks dropped along the blade's path while a
	 * swing is live, which is what makes the arc of a sword readable at this camera distance.
	 *
	 * A ribbon would be the usual tool, but Niagara systems cannot be authored through the editor
	 * automation this project is driven by, and a dense enough trickle of fading marks reads the
	 * same in motion. Swap it for a ribbon later by leaving this unset.
	 */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Feedback")
	TSubclassOf<AClockworksHitSpark> SwingTrailSparkClass;

	/** Seconds between marks. Small enough that they overlap into a smear rather than a dotted line. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Feedback", meta = (ClampMin = "0.005"))
	float SwingTrailIntervalSeconds = 0.02f;

	/** Bone the marks are dropped from: the weapon hand, so the trail follows the blade. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Feedback")
	FName SwingTrailSocket = TEXT("bone_weapon_r");

	/** How far out along the blade from that bone, in cm. The tip draws a wider, more readable arc. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Feedback")
	float SwingTrailReach = 70.f;

	/** Played on every hit taken. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Sound")
	TObjectPtr<USoundBase> HurtSound;

	UPROPERTY(EditDefaultsOnly, Category="Combat|Sound")
	TObjectPtr<USoundBase> DeathSound;

	/** The moment a charge comes up, which is the cue the player is actually listening for. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Sound")
	TObjectPtr<USoundBase> ChargeReadySound;

	UPROPERTY(EditDefaultsOnly, Category="Combat|Sound")
	TObjectPtr<USoundBase> ShieldRaiseSound;

	UPROPERTY(EditDefaultsOnly, Category="Combat|Sound")
	TObjectPtr<USoundBase> ShieldLowerSound;

	/** A hit turned away by the shield, as distinct from one that landed. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Sound")
	TObjectPtr<USoundBase> ShieldBlockSound;

	UPROPERTY(EditDefaultsOnly, Category="Combat|Sound")
	TObjectPtr<USoundBase> ShieldBreakSound;

	/** The hum under a building charge. Starts when the charge starts, stops the instant it ends. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Sound")
	TObjectPtr<USoundBase> ChargeLoopSound;

	/** Played when the knight swaps to a different weapon. Local: each machine hears its own switch. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Sound")
	TObjectPtr<USoundBase> WeaponSwitchSound;

	/**
	 * One is picked at random each time the knight has covered FootstepDistance on the ground.
	 * Driven by distance rather than animation notifies because the Spiral Knights clips are raw
	 * imports with no notifies, and distance stays in step with the run whatever its play rate.
	 */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Sound")
	TArray<TObjectPtr<USoundBase>> FootstepSounds;

	/** Centimetres of ground travel per step. The knight's run cycle covers about 90 cm a stride. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Sound", meta = (ClampMin = "1.0"))
	float FootstepDistance = 90.f;

	/** Footsteps sit under the combat, never over it. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Sound", meta = (ClampMin = "0.0"))
	float FootstepVolume = 0.4f;

	/** Optional. A short flinch played on every hit, over whatever the knight was doing. Cosmetic. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Feedback")
	TObjectPtr<UAnimMontage> HurtMontage;

	/** Optional. Played on death; the body stays until the respawn. Needs a DefaultSlot in the Animation Blueprint. */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Feedback")
	TObjectPtr<UAnimMontage> DeathMontage;

	/** Seconds between dying and respawning at a PlayerStart with full health. */
	UPROPERTY(EditDefaultsOnly, Category="Combat", meta = (ClampMin = "0.0"))
	float DeathRespawnSeconds = 5.f;

	/**
	 * Debug only. Runs a fixed loop of the whole kit — three swings, a dodge, a charge, a shield
	 * hold, a bash, a weapon switch, the gun and its charge — on a timer, so the game can be
	 * exercised and read back from the log without a human at the keyboard. It drives the same
	 * ability-input path the real buttons do, so what it tests is the real code, not a shortcut.
	 *
	 * Leave this off in anything anyone is going to see.
	 */
	UPROPERTY(EditAnywhere, Category="Debug")
	bool bDebugAutoFight = false;

	/**
	 * Debug only. Grants State.Invulnerable for the whole life, which the attribute set already
	 * honours. Without it a knight standing still in the test level is killed in seconds and the
	 * auto-fight loop never gets far enough to exercise anything.
	 */
	UPROPERTY(EditAnywhere, Category="Debug")
	bool bDebugInvulnerable = false;

	/**
	 * Seconds between steps of that loop. Must exceed the longest hold in it, which is the charge:
	 * a charge only starts after the swing that precedes it finishes, so the hold has to cover the
	 * swing as well as ChargeSeconds or the release lands a hair early and the charge is lost.
	 */
	UPROPERTY(EditAnywhere, Category="Debug", meta = (ClampMin = "0.5"))
	float DebugAutoFightStepSeconds = 6.f;

	/** Seconds after spawning before the loop starts, so possession and the loadout are settled. */
	UPROPERTY(EditAnywhere, Category="Debug", meta = (ClampMin = "0.0"))
	float DebugAutoFightDelaySeconds = 3.f;

public:

	/** True once the server has declared this knight dead. Valid on every machine (replicated tag). */
	bool IsDead() const;

	/**
	 * Presses and releases an ability button from a console command, for a headless test run. It goes through exactly
	 * the path a key press does, input buffer and all, so what a test exercises is the real thing. See
	 * `Debug/ClockworksAutomation`. Owning client only, like every other press.
	 */
	void AutomationPress(int32 InputID) { PressAbilityInput(InputID); }

	void AutomationRelease(int32 InputID) { ReleaseAbilityInput(InputID); }

	/**
	 * Plays a raw animation clip as a throwaway montage in one of the Animation Blueprint's slots, so
	 * attack phases need no montage assets. Cosmetic. Rate stretches or squeezes the clip; the ability
	 * derives it from the phase length so timing always comes from the numbers, never the animation.
	 * Local machine only; the ability decides whether to also broadcast it.
	 *
	 * SlotName picks how much of the body the clip takes: the full-body slot replaces everything
	 * (a swing, a dodge, a bash), the upper-body slot only the arms and chest so the legs keep
	 * running (shooting, reloading, blocking). NAME_None means the full-body slot. Each slot holds
	 * one clip at a time, so an upper-body clip and a full-body clip do not fight each other.
	 */
	void PlaySlotAnimation(UAnimSequenceBase* Anim, float PlayRate, bool bLoop, FName SlotName = NAME_None, bool bHoldLastFrame = false);

	/** Stops whatever PlaySlotAnimation started in that slot, leaving the other slot alone. Local machine only. */
	void StopSlotAnimation(float BlendOutSeconds = 0.1f, FName SlotName = NAME_None);

	/**
	 * Local machine only. Lets go of a clip that was holding its last frame (bHoldLastFrame), blending
	 * back to what is underneath; a clip playing out normally is left alone.
	 */
	void ReleaseHeldSlotAnimation(float BlendOutSeconds = 0.15f, FName SlotName = NAME_None);

	/**
	 * All machines. PlaySlotAnimation with the clip holding its last frame until the next clip or a
	 * release: the original's gun poses stay up between shots. Skips the owning client, which played its own.
	 */
	UFUNCTION(NetMulticast, Unreliable)
	void MulticastPlaySlotAnimationHeld(UAnimSequenceBase* Anim, float PlayRate, FName SlotName);

	/** All machines. ReleaseHeldSlotAnimation; reliable, because a lost one would leave an arm up. */
	UFUNCTION(NetMulticast, Reliable)
	void MulticastReleaseHeldSlotAnimation(FName SlotName);

	/**
	 * Local machine only. A run of clips back to back in one slot, each at its own rate and start time and
	 * holding its last frame until the next: a Sixshot's hammer fans, a Flourish's thrusts. Any other clip
	 * played in the slot cancels the rest of the run.
	 */
	void PlaySlotSequence(const TArray<FClockworksClipSegment>& Segments, FName SlotName = NAME_None);

	/** All machines. PlaySlotSequence; skips the owning client, which played its own. */
	UFUNCTION(NetMulticast, Unreliable)
	void MulticastPlaySlotSequence(const TArray<FClockworksClipSegment>& Segments, FName SlotName);

	/**
	 * Cosmetic only. Everyone plays the clip; the owning client skips it because it already predicted
	 * the same clip locally. Nothing gameplay-relevant happens here.
	 */
	UFUNCTION(NetMulticast, Unreliable)
	void MulticastPlaySlotAnimation(UAnimSequenceBase* Anim, float PlayRate, bool bLoop, FName SlotName);

	UFUNCTION(NetMulticast, Unreliable)
	void MulticastStopSlotAnimation(FName SlotName);

	/**
	 * Cosmetic: a sound at this knight, heard on every machine. Abilities follow the same rule as the
	 * animations, the server broadcasting and the owning client playing its own straight away, so a
	 * swing sounds the instant you press rather than a round trip later.
	 */
	UFUNCTION(NetMulticast, Unreliable)
	void MulticastPlaySound(USoundBase* Sound);

	/**
	 * All machines. A weapon sound at the pitch and volume the server picked. bSkipPredictingOwner is
	 * for a sound the owning client already played itself (a swing it predicted); a sound only the
	 * server could know about (a hit landing) passes false.
	 */
	UFUNCTION(NetMulticast, Unreliable)
	void MulticastPlaySoundPitched(USoundBase* Sound, float VolumeMultiplier, float PitchMultiplier, bool bSkipPredictingOwner);

	/** This machine only. */
	void PlaySoundLocal(USoundBase* Sound, float VolumeMultiplier = 1.f, float PitchMultiplier = 1.f);

	/**
	 * Owning client and server. Picks one of the sound's recordings and a pitch in its range; the
	 * server broadcasts it (bFromServer), anyone else plays it here. bOwnerPredicted: the owning
	 * client runs the same code and plays its own copy, so the broadcast skips it.
	 */
	void PlayWeaponSound(const struct FClockworksWeaponSound& Sound, bool bFromServer, bool bOwnerPredicted = true);

	/** Owning client and server. A move's sound and its extra, or Fallback when the move names neither. */
	void PlayMoveSounds(const struct FClockworksWeaponSound& Sound, const struct FClockworksWeaponSound& Extra, USoundBase* Fallback, bool bFromServer);

	/** This machine only. Freezes the mesh for HitstopSeconds. Re-triggering restarts the freeze. */
	void ApplyHitstop();

	/** This machine only. The impact flash, at WorldLocation. Does nothing without a HitSparkClass. */
	void SpawnHitSpark(const FVector& WorldLocation);

	/** The floating number spawned where a hit lands. Cosmetic; never replicated. */
	UPROPERTY(EditAnywhere, Category = "Combat|Feedback")
	TSubclassOf<AClockworksDamageNumber> DamageNumberClass;

	/** This machine only. Shows what a hit did, coloured by how the family took it. */
	void ShowDamageNumber(float Amount, float FamilyMultiplier);

	/** Cosmetic: the number on every machine. Server-side call. */
	UFUNCTION(NetMulticast, Unreliable)
	void MulticastDamageNumber(float Amount, float FamilyMultiplier);


	/**
	 * The blade smear, for Seconds. Cosmetic: the server broadcasts so other players see the arc,
	 * and the owning client starts its own at once rather than a round trip later.
	 */
	void StartSwingTrail(float Seconds);

	/** This machine only. */
	void ShowSwingTrail(float Seconds);

	UFUNCTION(NetMulticast, Unreliable)
	void MulticastStartSwingTrail(float Seconds);

	/** Cosmetic: the attacker's own freeze. The server broadcasts; the owning client does its own at once. */
	UFUNCTION(NetMulticast, Unreliable)
	void MulticastHitstop();

	/**
	 * The charge hum. Server-side call from the sword ability; the owning client starts its own the
	 * moment it predicts the charge, so the hum begins on the button rather than a round trip later.
	 */
	void SetChargeLoop(bool bPlaying);

	/** This machine only. Starting twice is a no-op, so prediction and the multicast cannot double it. */
	void ShowChargeLoop(bool bPlaying);

	UFUNCTION(NetMulticast, Unreliable)
	void MulticastSetChargeLoop(bool bPlaying);

	/** The Animation Blueprint slot that replaces the whole body. Abilities pass this for committed moves. */
	FName GetFullBodySlotName() const { return FullBodySlotName; }

	/** The slot that only replaces the arms and chest, so the legs keep playing the run. */
	FName GetUpperBodySlotName() const { return UpperBodySlotName; }

	/**
	 * Server: the weapon's charge just became ready, or was spent. Spiral Knights keeps a bright aura
	 * around the knight for as long as a ready charge is held, rather than blinking once, so this is a
	 * state rather than an event: everyone can see who is holding a charge.
	 */
	void SetChargeReady(bool bReady);

	/** Cosmetic only, this machine: shows or hides that aura. The owning client predicts with it. */
	void ShowChargeReady(bool bReady);

	UFUNCTION(NetMulticast, Unreliable)
	void MulticastSetChargeReady(bool bReady);

	/** Server: the shield ability (or the bash) raises and lowers the shield. Replicated so every machine moves the model. */
	void SetShieldRaised(bool bRaised);

	/** Cosmetic, this machine only: the model to the arm or the back, the raise clip, the hold loop. The owning client predicts with it. */
	void ShowShieldRaised(bool bRaised);

	bool IsShieldRaised() const { return bShieldRaised; }

	/** Whether the charge-ready aura is up, which is exactly "the charge is loaded". Every machine; the HUD's orb reads it. */
	bool IsChargeReadyShown() const { return bChargeReadyShown; }

	/** Cosmetic only: the blocked-hit clip on every machine. The server decided the block. */
	UFUNCTION(NetMulticast, Unreliable)
	void MulticastShieldHit();

	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

	/** Constructor */
	AClockworksCharacter();

	/** Initialization */
	virtual void BeginPlay() override;

	/** Unhooks from the PlayerState, which outlives this body. */
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

	/** Update */
	virtual void Tick(float DeltaSeconds) override;

	/** Binds input actions. Owning client only. */
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

	/** Server: a controller took this character. */
	virtual void PossessedBy(AController* NewController) override;

	/** Clients: the PlayerState arrived. */
	virtual void OnRep_PlayerState() override;

	/** The PlayerState's component, or null before the PlayerState exists. */
	virtual UAbilitySystemComponent* GetAbilitySystemComponent() const override;

	/** Returns the camera component **/
	UCameraComponent* GetTopDownCameraComponent() const { return TopDownCameraComponent.Get(); }

	/** Returns the Camera Boom component **/
	USpringArmComponent* GetCameraBoom() const { return CameraBoom.Get(); }

protected:

	/** Move input handler. Owning client only. */
	void Move(const FInputActionValue& Value);

	/** Attack and dodge input. Owning client only. */
	void OnAttackInput();
	void OnAttackInputReleased();
	void OnDodgeInput();

	/** Weapon switch input. Owning client only: intent goes to the PlayerState, which asks the server. */
	void OnSwitchWeaponInput(const FInputActionValue& Value);

	/** Shield and shield bash input. Owning client only; same shape as OnAttackInput. */
	void OnShieldInput();
	void OnShieldInputReleased();
	void OnShieldBashInput();

	/** Sends an ability button press as intent, and remembers it if the knight is busy. Owning client only. */
	void PressAbilityInput(int32 InputID);

	/** Sends an ability button release. Owning client only. */
	void ReleaseAbilityInput(int32 InputID);

	/** Whether the ability on this input is running on this machine. */
	bool IsAbilityInputActive(int32 InputID) const;

	/** Retries a remembered press every frame until it fires or goes stale. Owning client only. */
	void TickInputBuffer(float DeltaSeconds);

	/**
	 * How long a press that found the knight busy is kept and retried, in seconds. Without it an
	 * attack pressed during a dodge, or a dodge pressed in a swing's windup, was simply dropped, and
	 * the action came out on the second press instead: which is what "every control feels late" was.
	 */
	UPROPERTY(EditDefaultsOnly, Category="Input", meta=(ClampMin="0.0"))
	float InputBufferSeconds = 0.25f;

	/** The remembered press, as an ability input ID. Zero means none. */
	int32 BufferedInputID = 0;
	float BufferedInputAge = 0.f;

	/** Ability buttons currently down, so a remembered press knows whether to follow with a release. */
	TSet<int32> HeldAbilityInputs;

	UFUNCTION() void OnRep_ShieldRaised();

	/** Server: a raised shield absorbed a hit. Restarts the refill delay and broadcasts the clip. */
	void HandleBlocked(float Absorbed, FVector HitDirection, float KnockbackMultiplier);

	/** Server: the shield reached zero while raised. Marks it broken, cancels the shield ability, starts the break timer. */
	void HandleShieldBroken();
	void ClearShieldBroken();

	/** Server: refills the shield once it has gone ShieldRegenDelaySeconds without blocking. */
	void TickShieldRegen(float DeltaSeconds);

	/** This machine: a footstep every FootstepDistance of ground travel. Purely cosmetic, never replicated. */
	void TickFootsteps(float DeltaSeconds);

	/** This machine: puts the shield model on the arm or the back. */
	void RefreshShieldAttachment();

	/**
	 * This machine: shows, hides and tints the dome from the replicated shield state. Called whenever
	 * any of that state changes, so it never needs to tick.
	 */
	void RefreshShieldBubble();

	/** The dome's colour for the shield left, blended along ShieldBubbleColors. */
	FLinearColor GetShieldBubbleColor() const;

	/** Every machine: the Shield attribute replicated a new value, so the dome needs a new colour. */
	void OnShieldAttributeChanged(const FOnAttributeChangeData& Data);

	/** Every machine: the shield shattered or came back (the tag replicates to all). */
	void OnShieldBrokenTagChanged(const FGameplayTag Tag, int32 NewCount);

	void EndShieldRestoredFlash();

	/** This machine: the hold loop, if the shield is still shown raised. */
	void PlayShieldHold();

	/** Connects this character to the PlayerState's ability system. Server and clients. */
	void InitAbilitySystem();

	/**
	 * Puts the drawn weapon's model in the hand and plays its draw clip. All machines, from the
	 * PlayerState's loadout delegate and once when this body links up. Cosmetic: the loadout itself
	 * is the replicated state.
	 */
	UFUNCTION()
	void RefreshWeaponVisuals();

	/**
	 * Every machine, cosmetic: dresses the knight in the replicated gear. The armour replaces the knight's own
	 * mesh (Spiral Knights builds a knight from its armour, face and helmet; every armour shares the knight's
	 * skeleton, so the animation blueprint carries on), the helmet and shield swap their models.
	 */
	UFUNCTION()
	void RefreshGearVisuals();

	/** Pushes the MoveSpeed attribute, the attacking slow and the recovery lock into the movement component. */
	void RefreshMaxWalkSpeed();

	void OnMoveSpeedChanged(const FOnAttributeChangeData& Data);

	/** Bound to State.Attacking and State.MovementLocked; both just re-evaluate the walk speed. */
	void OnAttackingTagChanged(const FGameplayTag Tag, int32 NewCount);

	/** Server: something damaged this knight. Only the flash broadcast; the attribute set did the maths. */
	void HandleDamaged(AActor* InstigatorActor, AActor* Causer, float Amount, FVector HitDirection, float KnockbackMultiplier, float FamilyMultiplier);

	/** Server: health reached zero. Marks the knight dead, stops it, and schedules the respawn. */
	void HandleOutOfHealth();

	/** Server: spawns a fresh knight for the controller and removes this one. */
	void HandleRespawn();

	/** Cosmetic only. Everyone shows the flash; nothing gameplay-relevant happens here. */
	UFUNCTION(NetMulticast, Unreliable)
	void MulticastHitFlash();

	void ClearHitFlash();

	/** Cosmetic only: the death clip on every machine. The server has already decided the death. */
	UFUNCTION(NetMulticast, Reliable)
	void MulticastPlayDeathMontage();

private:

	/** Which component the delegates are bound to, so a re-init doesn't bind twice. */
	TWeakObjectPtr<UAbilitySystemComponent> BoundAbilitySystemComponent;

	FTimerHandle HitFlashTimer;
	FTimerHandle RespawnTimer;

	/** The throwaway montage playing in each slot, so one can be stopped without touching the other. */
	TMap<FName, TWeakObjectPtr<UAnimMontage>> ActiveSlotMontages;

	/** The clips of a run still to play, the next one's index, its slot, and the timer that plays it. */
	UPROPERTY(Transient)
	TArray<FClockworksClipSegment> PendingSequence;

	int32 PendingSequenceIndex = 0;
	FName PendingSequenceSlot;
	FTimerHandle SequenceTimer;

	/** True while the run itself is playing a clip, so that clip does not cancel the run. */
	bool bPlayingSequenceClip = false;

	/** Local machine only. Plays the next clip of the run and times the one after. */
	void PlayNextSequenceClip();

	/** The weapon whose model is in the hand, so a loadout change that keeps it does nothing. */
	TWeakObjectPtr<UClockworksWeaponDefinition> ShownWeapon;

	/** The gear whose models the knight shows, so a change that keeps a piece leaves it alone. */
	TWeakObjectPtr<const UClockworksGearDefinition> ShownArmor;
	TWeakObjectPtr<const UClockworksGearDefinition> ShownHelmet;
	TWeakObjectPtr<const UClockworksGearDefinition> ShownShield;

	/** The helmet's and shield's other model pieces, riding their meshes. */
	UPROPERTY(Transient)
	TArray<TObjectPtr<UStaticMeshComponent>> HelmetExtraMeshes;

	UPROPERTY(Transient)
	TArray<TObjectPtr<UStaticMeshComponent>> ShieldExtraMeshes;

	/** ShieldMesh's scale as the Blueprint set it, before a shield's own placement scales it. */
	FVector ShieldMeshBaseScale = FVector::OneVector;
	bool bShieldBaseScaleCaptured = false;

public:

	/**
	 * Where the original's knight model puts a shield on each bone (character/pc/model.dat): raised on bone_shield at
	 * scale 0.9; away on bone_shield_away with a small offset and turn, converted from Clyde axes like every gear
	 * placement (INFERRED that our skeleton's bones carry none of it already; check the shield on the back).
	 */
	UPROPERTY(EditDefaultsOnly, Category="Combat|Shield")
	FTransform ShieldRaisedPlacement = FTransform(FQuat::Identity, FVector::ZeroVector, FVector(0.9f));

	UPROPERTY(EditDefaultsOnly, Category="Combat|Shield")
	FTransform ShieldAwayPlacement = FTransform(FQuat(0.1349312f, 0.059897132f, 0.123641595f, 0.9812842f), FVector(-5.f, 0.f, -10.f), FVector::OneVector);

private:

	/** The worn armour's loose pieces (pylons, tassels, scarves), one component each on its bone. Cosmetic. */
	UPROPERTY(Transient)
	TArray<TObjectPtr<UStaticMeshComponent>> ArmorPieceMeshes;

	/** Which of ArmorPieceMeshes turn to face the camera. */
	TArray<bool> ArmorPieceFacesCamera;

	/** Every machine: rebuilds the worn armour's loose pieces. */
	void RefreshArmorPieces(const UClockworksGearDefinition* Armor);

	/** Every machine that draws: turns camera-facing pieces toward this machine's camera. */
	void TickArmorBillboards();

	/** Whether the shield is up. The server decides; everyone reads it for the model's bone. */
	UPROPERTY(ReplicatedUsing = OnRep_ShieldRaised)
	bool bShieldRaised = false;

	/** What this machine currently shows, so repeated calls do nothing. */
	bool bShieldShownRaised = false;

	/** Server: seconds since the shield last absorbed a hit. Starts high so a fresh shield refills at once. */
	float TimeSinceShieldHit = 1000.f;

	FTimerHandle ShieldBrokenTimer;
	FTimerHandle ShieldAnimTimer;
	FTimerHandle ShieldRestoredFlashTimer;

	/** Made once per body from ShieldBubbleMaterial, so the colour can change without new assets. */
	UPROPERTY()
	TObjectPtr<UMaterialInstanceDynamic> ShieldBubbleMaterialInstance;

	/** True while the cyan "the shield is back" flash is showing at the feet. */
	bool bShieldRestoredFlash = false;

	/** True on this machine while the charge-ready aura is up, so a hit flash clearing cannot drop it. */
	bool bChargeReadyShown = false;

	/** Server-side guard so death handling runs once per life. */
	bool bDeathHandled = false;

	/** Ground distance travelled since the last footstep, on this machine. */
	float FootstepTravel = 0.f;

	FTimerHandle HitstopTimer;

	/** Puts the mesh back to normal speed. */
	void EndHitstop();

	// ----- debug auto-fight (see bDebugAutoFight) -----

	/**
	 * One step of the loop, driven from Tick rather than a timer started at BeginPlay, so the flag
	 * can be flipped on a live actor mid-session and take effect immediately. That matters because
	 * the only way to reach a running game from outside is to set a property on it.
	 */
	void TickAutoFight(float DeltaSeconds);

	/** Press attack now, release it HoldSeconds later. A short hold is a swing, a long one a charge. */
	void DebugTapAttack(float HoldSeconds);

	/** Raise the shield now, drop it HoldSeconds later. */
	void DebugHoldShield(float HoldSeconds);

	FTimerHandle DebugAttackReleaseTimer;
	FTimerHandle DebugShieldReleaseTimer;
	int32 DebugAutoFightStepIndex = 0;

	/** Seconds since the last step. Starts negative so the first step waits out the spawn delay. */
	float DebugAutoFightElapsed = 0.f;
	bool bDebugAutoFightStarted = false;

	FTimerHandle SwingTrailTimer;

	/** Drops one mark from the blade. Called repeatedly while a swing is live. */
	void TickSwingTrail();

	/** When the current smear should stop, in world seconds. */
	float SwingTrailEndTime = 0.f;

	/** The looping charge hum while it is playing, so it can be stopped. This machine only. */
	UPROPERTY(Transient)
	TObjectPtr<UAudioComponent> ChargeLoopAudio;
};
