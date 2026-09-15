// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "AbilitySystemInterface.h"
#include "GameplayTagContainer.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksEnemyCharacter.generated.h"

class AClockworksDamageNumber;
class AClockworksHitSpark;
class UClockworksStatusDisplay;
class UAbilitySystemComponent;
class UAnimMontage;
class UAnimSequenceBase;
class UClockworksAttributeSet;
class UGameplayAbility;
class UClockworksEnemyHealthBar;
class UMaterialInterface;
class USoundBase;
class UStaticMeshComponent;
class UWidgetComponent;

/**
 * Base for anything the player can hit. Owns its own AbilitySystemComponent (enemies don't
 * respawn, so nothing needs to outlive the pawn). Reacts to damage with server-side knockback and a
 * cosmetic flash, and dies at zero health. Blueprint children assign the mesh and tuning.
 */
UCLASS(abstract)
class AClockworksEnemyCharacter : public ACharacter, public IAbilitySystemInterface
{
	GENERATED_BODY()

public:

	AClockworksEnemyCharacter();

	virtual UAbilitySystemComponent* GetAbilitySystemComponent() const override { return AbilitySystemComponent; }

	virtual void PostInitializeComponents() override;

	/** Points the floating bar at this enemy once the ability system component exists. */
	virtual void BeginPlay() override;

	/** Direct animation mode only; a no-op otherwise. */
	virtual void Tick(float DeltaSeconds) override;

	UClockworksAttributeSet* GetAttributeSet() const { return AttributeSet; }

	/**
	 * Plays a raw clip in the Animation Blueprint's slot as a throwaway montage, fitted to the phase
	 * by PlayRate. The same trick the knight uses: the Spiral Knights exports are plain sequences and
	 * montage assets cannot be made outside the editor, so abilities play clips directly. Cosmetic.
	 * Local machine only; the server multicasts when everyone needs to see it.
	 */
	void PlaySlotAnimation(UAnimSequenceBase* Anim, float PlayRate, bool bLoop);
	void StopSlotAnimation(float BlendOutSeconds = 0.1f);

	UFUNCTION(NetMulticast, Unreliable)
	void MulticastPlaySlotAnimation(UAnimSequenceBase* Anim, float PlayRate, bool bLoop);

	/** Fits a clip to a phase length and broadcasts it. Server only; call from an ability. */
	void PlayPhaseAnimation(UAnimSequenceBase* Anim, float PhaseSeconds, bool bLoop = false);

	/** Server: the brain just picked a target after having none. The "it has noticed you" clip. */
	void PlayAggroAnimation();

	FName GetAnimationSlotName() const { return AnimationSlotName; }

	/**
	 * Sets FamilyTag from a tag name, e.g. "Family.Beast".
	 *
	 * Exists for the monster generator: a gameplay tag's name is read-only through Unreal's Python
	 * bindings, so a tool has no supported way to build one. Requesting it by name here also fails
	 * loudly if the tag was never declared in C++.
	 */
	UFUNCTION(BlueprintCallable, Category = "Combat")
	void SetFamilyTagByName(const FString& TagName);

	/** The family as a readable string, for tools. Unreal's Python bindings cannot print a tag. */
	UFUNCTION(BlueprintPure, Category = "Combat")
	FString GetFamilyTagName() const;

	/** Cosmetic: a sound at this enemy on every machine. Server-side call. */
	UFUNCTION(NetMulticast, Unreliable)
	void MulticastPlaySound(USoundBase* Sound);

	/**
	 * The telegraph tint: Spiral Knights washes a monster in a damage-coloured aura for the whole
	 * windup, and that colour is what the eye actually catches, well before the pose reads. Server
	 * call; the multicast paints it everywhere. Purely cosmetic.
	 */
	void SetTelegraph(bool bActive);

	/** This machine only. */
	void ShowTelegraph(bool bActive);

	UFUNCTION(NetMulticast, Unreliable)
	void MulticastSetTelegraph(bool bActive);

	/** This machine only. Freezes the mesh's animation for HitstopSeconds. */
	void ApplyHitstop();

protected:

	/** Server: knockback and the flash broadcast. */
	void HandleDamaged(AActor* InstigatorActor, AActor* Causer, float Amount, FVector HitDirection, float KnockbackMultiplier, float FamilyMultiplier);

	/** Server: death. */
	void HandleOutOfHealth();

	/** Server and owning machine: State.MovementLocked (attack windup/recovery) zeroes the walk speed. */
	void OnMovementLockChanged(const FGameplayTag Tag, int32 NewCount);

	/** Server: State.Stunned came or went (the shield bash's stun effect). Cancels the running attack. */
	void OnStunnedChanged(const FGameplayTag Tag, int32 NewCount);

	/** Cosmetic only. Everyone shows the flash; nothing gameplay-relevant happens here. */
	UFUNCTION(NetMulticast, Unreliable)
	void MulticastHitFlash();

	void ClearHitFlash();

	/**
	 * The one place the overlay material is decided, because three things now want it and they must
	 * not clear one another: a stun outranks a telegraph, which outranks a hit flash.
	 */
	void RefreshOverlay();

	void EndHitstop();

	/** Cosmetic only: the frozen pose and the held flash while stunned. The server has already decided the stun. */
	UFUNCTION(NetMulticast, Reliable)
	void MulticastSetStunned(bool bNewStunned);

	UFUNCTION(NetMulticast, Unreliable)
	void MulticastPlayAggroAnimation();

	/** Cosmetic only: the death clip on every machine. The server has already decided the death. */
	UFUNCTION(NetMulticast, Reliable)
	void MulticastPlayDeathMontage();

	UPROPERTY(VisibleAnywhere, Category = "Abilities")
	TObjectPtr<UAbilitySystemComponent> AbilitySystemComponent;

	/** Optional rigid head piece riding HeadSocketName (the Mechaknight's helmet is not part of its skin). */
	UPROPERTY(VisibleAnywhere, Category = "Components")
	TObjectPtr<UStaticMeshComponent> HeadMesh;

	/** Bone the head piece attaches to. Set before the mesh is assigned; changing it later needs a re-attach. */
	UPROPERTY(EditDefaultsOnly, Category = "Components")
	FName HeadSocketName = TEXT("bone_helmet");

	/**
	 * The floating health bar. Screen space, so it always faces the camera at a fixed size however
	 * far away the isometric view puts it. Local display of a replicated attribute; nothing extra
	 * goes over the wire for it.
	 */
	UPROPERTY(VisibleAnywhere, Category = "Components")
	TObjectPtr<UWidgetComponent> HealthBarWidget;

	/** Shows and sounds whatever statuses this enemy is under. Cosmetic and local. */
	UPROPERTY(VisibleAnywhere, Category = "Components")
	TObjectPtr<UClockworksStatusDisplay> StatusDisplay;

	/** Height above the enemy's centre for that bar, in cm. Taller enemies need more. */
	UPROPERTY(EditDefaultsOnly, Category = "Components")
	float HealthBarHeight = 110.f;

	UPROPERTY()
	TObjectPtr<UClockworksAttributeSet> AttributeSet;

	/** Granted on the server when the enemy spawns. A training dummy has none; a wolver has its bite. */
	UPROPERTY(EditDefaultsOnly, Category = "Abilities")
	TArray<TSubclassOf<UGameplayAbility>> DefaultAbilities;

	UPROPERTY(EditDefaultsOnly, Category = "Combat", meta = (ClampMin = "1.0"))
	float InitialHealth = 50.f;

	/** Added to every attack's damage. */
	UPROPERTY(EditDefaultsOnly, Category = "Combat", meta = (ClampMin = "0.0"))
	float InitialAttackPower = 0.f;

	/** Subtracted from every hit taken (never below 1). The armoured enemy's whole identity. */
	UPROPERTY(EditDefaultsOnly, Category = "Combat", meta = (ClampMin = "0.0"))
	float InitialDefensePower = 0.f;

	/**
	 * How hard this monster is to push: a knight's shield push-back moves it only if the push's level is at least this
	 * (the original's impulseLevel: most 1; Alpha Wolver and Gorgo 3; Lumber 5; Trojan and Royal Jelly 7; Tortodrone and
	 * Vanaduke 10; the ≥ comparison is INFERRED).
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Combat", meta = (ClampMin = "0"))
	int32 ImpulseLevel = 1;

	/**
	 * The original's numbers by the demo's depth, index 0 (the lobby) to 8 (the Core); research in
	 * D:\Dev\SKAssets\_research\monsters\monster_numbers.json, written by apply_monster_numbers.py. Health replaces
	 * InitialHealth when set. Defense per damage type replaces InitialDefensePower and the family chart: the
	 * original's families are defense values (a weakness halves that type's defense, a resistance adds 1400).
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Combat|Depth")
	TArray<float> HealthByDepth;

	UPROPERTY(EditDefaultsOnly, Category = "Combat|Depth")
	TArray<float> NormalDefenseByDepth;

	UPROPERTY(EditDefaultsOnly, Category = "Combat|Depth")
	TArray<float> PiercingDefenseByDepth;

	UPROPERTY(EditDefaultsOnly, Category = "Combat|Depth")
	TArray<float> ElementalDefenseByDepth;

	UPROPERTY(EditDefaultsOnly, Category = "Combat|Depth")
	TArray<float> ShadowDefenseByDepth;

	/**
	 * Which family this enemy belongs to, which decides what it is weak and strong against. Wolvers
	 * are Beast, the Mechaknight and the Gunpuppy are Construct. Leave it unset for something that
	 * should take every damage type at face value, like a training dummy.
	 */
	UPROPERTY(EditAnywhere, Category = "Combat", meta = (Categories = "Family"))
	FGameplayTag FamilyTag;

	/** Zero keeps a training dummy or a turret in place. Enemies that walk get a real number. */
	UPROPERTY(EditDefaultsOnly, Category = "Combat", meta = (ClampMin = "0.0"))
	float InitialMoveSpeed = 0.f;

	/** The brain stops chasing and attacks inside this distance, in cm. Melee: a body length. Ranged: the whole room. */
	UPROPERTY(EditDefaultsOnly, Category = "AI", meta = (ClampMin = "0.0"))
	float AttackRange = 220.f;

	/** If set, the brain only attacks with a clear line to the target. Shooters, so walls are an answer to them. */
	UPROPERTY(EditDefaultsOnly, Category = "AI")
	bool bAttackNeedsLineOfSight = false;

	/** How fast a stationary enemy turns to track its target, in degrees per second. */
	UPROPERTY(EditDefaultsOnly, Category = "AI", meta = (ClampMin = "0.0"))
	float TurnRateDegrees = 180.f;

public:

	float GetAttackRange() const { return AttackRange; }
	bool AttackNeedsLineOfSight() const { return bAttackNeedsLineOfSight; }
	float GetTurnRateDegrees() const { return TurnRateDegrees; }
	bool IsStationary() const { return InitialMoveSpeed <= 0.f; }

	/** The family, for the targeting readout's weakness chart. Valid on every machine (a class default). */
	const FGameplayTag& GetFamilyTag() const { return FamilyTag; }

	/** How hard this monster is to push (the original's impulse level). Valid on every machine (a class default). */
	int32 GetImpulseLevel() const { return ImpulseLevel; }

	/** Whether this monster carries the original's defense by depth (then the family chart does not apply to it). */
	bool HasDepthDefense() const { return NormalDefenseByDepth.Num() > 0; }

	/** Defense against a damage kind (0 Normal, 1 Piercing, 2 Elemental, 3 Shadow) at a demo depth. 0 without the numbers. */
	float GetDefenseAt(int32 Kind, int32 DemoDepth) const;

	/** The attacks it is granted. The readout reads their damage type off the class defaults. */
	const TArray<TSubclassOf<UGameplayAbility>>& GetDefaultAbilities() const { return DefaultAbilities; }

protected:

	/** How hard a hit shoves this enemy, in cm/s along the hit direction. */
	UPROPERTY(EditDefaultsOnly, Category = "Combat|Feedback", meta = (ClampMin = "0.0"))
	float KnockbackSpeed = 600.f;

	/** Drawn over the mesh for a moment when hit. An unlit additive material reads best. */
	UPROPERTY(EditDefaultsOnly, Category = "Combat|Feedback")
	TObjectPtr<UMaterialInterface> HitFlashMaterial;

	UPROPERTY(EditDefaultsOnly, Category = "Combat|Feedback", meta = (ClampMin = "0.0"))
	float HitFlashSeconds = 0.1f;

	/**
	 * Drawn over the mesh for the whole attack windup. Falls back to HitFlashMaterial when unset, so
	 * an enemy always has *some* tell even before a per-family colour exists.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Combat|Feedback")
	TObjectPtr<UMaterialInterface> TelegraphMaterial;

	/** The freeze on a landed hit. Cosmetic: it pauses the mesh's clock, never the actor's. */
	UPROPERTY(EditDefaultsOnly, Category = "Combat|Feedback", meta = (ClampMin = "0.0"))
	float HitstopSeconds = 0.06f;

	/** The flash where a hit lands. Spawned locally on every machine from the hit flash; never replicated. */
	UPROPERTY(EditAnywhere, Category = "Combat|Feedback")
	TSubclassOf<AClockworksHitSpark> HitSparkClass;

	/** How far up the body the spark appears, in cm. Taller enemies want more. */
	UPROPERTY(EditAnywhere, Category = "Combat|Feedback")
	float HitSparkHeight = 55.f;

	/** This machine only. The impact flash. Does nothing without a HitSparkClass. */
	void SpawnHitSpark(const FVector& WorldLocation);

	/** The floating number spawned where a hit lands. Cosmetic; never replicated. */
	UPROPERTY(EditAnywhere, Category = "Combat|Feedback")
	TSubclassOf<AClockworksDamageNumber> DamageNumberClass;

	/** This machine only. Shows what a hit did, coloured by how the family took it. */
	void ShowDamageNumber(float Amount, float FamilyMultiplier);

	/** Cosmetic: the number on every machine. Server-side call. */
	UFUNCTION(NetMulticast, Unreliable)
	void MulticastDamageNumber(float Amount, float FamilyMultiplier);


	/** Seconds between dying and being removed from the world. Match it to the death clip's length. */
	UPROPERTY(EditDefaultsOnly, Category = "Combat", meta = (ClampMin = "0.0"))
	float DeathDestroyDelay = 2.f;

	/** Optional. Played on death; the body stays visible until DeathDestroyDelay runs out. Needs a DefaultSlot in the Animation Blueprint. */
	UPROPERTY(EditDefaultsOnly, Category = "Combat|Feedback")
	TObjectPtr<UAnimMontage> DeathMontage;

	/**
	 * Optional flinch when hit (the Spiral Knights "reacting" clip), fitted to HurtSeconds. Skipped
	 * while the enemy is attacking, so a hit never wipes out a telegraph the player is reading.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Combat|Feedback")
	TObjectPtr<UAnimSequenceBase> HurtAnim;

	UPROPERTY(EditDefaultsOnly, Category = "Combat|Feedback", meta = (ClampMin = "0.0"))
	float HurtSeconds = 0.3f;

	/**
	 * Optional clip played once when the enemy first notices a player (SK activate / bark / Aggro).
	 * The tell that it is coming for you, before it starts moving.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Combat|Feedback")
	TObjectPtr<UAnimSequenceBase> AggroAnim;

	UPROPERTY(EditDefaultsOnly, Category = "Combat|Feedback", meta = (ClampMin = "0.0"))
	float AggroSeconds = 0.5f;

	/**
	 * The bark, growl or spin-up when it notices you; the flinch when hit; the death cry.
	 *
	 * EditAnywhere rather than EditDefaultsOnly on purpose: this map places its enemies by hand and
	 * One File Per Actor had already written an empty value into each placed actor's package before
	 * these existed, which no change to the Blueprint could then override. Being settable per
	 * instance is also useful in itself, for one enemy in a room that should sound different.
	 */
	UPROPERTY(EditAnywhere, Category = "Combat|Sound")
	TObjectPtr<USoundBase> AggroSound;

	UPROPERTY(EditAnywhere, Category = "Combat|Sound")
	TObjectPtr<USoundBase> HurtSound;

	UPROPERTY(EditAnywhere, Category = "Combat|Sound")
	TObjectPtr<USoundBase> DeathSound;

	/** Slot in the enemy's Animation Blueprint that one-off clips play in. Unused in direct mode. */
	UPROPERTY(EditDefaultsOnly, Category = "Combat|Animation")
	FName AnimationSlotName = TEXT("DefaultSlot");

	/**
	 * Drive the mesh directly instead of through an Animation Blueprint.
	 *
	 * A monster in this game needs four things from its animation: an idle loop, a movement loop, a
	 * one-off clip for an attack or a flinch, and a death clip. None of that needs a blend tree, and
	 * an Animation Blueprint cannot be authored without opening the editor by hand, which for
	 * fourteen monsters is fourteen manual jobs. Single-node mode gets all four for free: the
	 * character picks the loop each frame and swaps to a one-off clip when something asks for one.
	 *
	 * The cost is that there is no blending, so a clip change is instant. At this camera distance
	 * that reads as snappy rather than broken, and any monster that deserves better can be given a
	 * real Animation Blueprint later by turning this off.
	 */
	UPROPERTY(EditAnywhere, Category = "Combat|Animation")
	bool bUseDirectAnimation = false;

	/** Looped while standing still. Direct mode only. */
	UPROPERTY(EditAnywhere, Category = "Combat|Animation")
	TObjectPtr<UAnimSequenceBase> IdleAnim;

	/** Looped while walking. Direct mode only. */
	UPROPERTY(EditAnywhere, Category = "Combat|Animation")
	TObjectPtr<UAnimSequenceBase> MoveAnim;

	/** Played once on death. Direct mode's equivalent of DeathMontage; the body holds its last pose. */
	UPROPERTY(EditAnywhere, Category = "Combat|Animation")
	TObjectPtr<UAnimSequenceBase> DeathAnim;

	/** Speed in cm/s above which the movement loop plays instead of the idle. */
	UPROPERTY(EditAnywhere, Category = "Combat|Animation", meta = (ClampMin = "0.0"))
	float MoveAnimSpeedThreshold = 10.f;

	/** Plays MoveAnim at the walk speed divided by this, so a fast monster's legs keep up. Zero disables. */
	UPROPERTY(EditAnywhere, Category = "Combat|Animation", meta = (ClampMin = "0.0"))
	float MoveAnimReferenceSpeed = 0.f;

	/** Direct mode: picks the idle or movement loop for this frame. Does nothing while a clip is playing. */
	void TickDirectAnimation();

	/** Direct mode: plays one clip, then returns to the loops when it is done. */
	void PlayDirectAnimation(UAnimSequenceBase* Anim, float PlayRate, bool bLoop);

private:

	FTimerHandle HitFlashTimer;
	bool bDead = false;

	/** The throwaway montage PlaySlotAnimation is currently playing, so it can be stopped. */
	TWeakObjectPtr<UAnimMontage> ActiveSlotMontage;

	/** This machine's cosmetic stun state, so a hit flash clearing does not drop the held overlay. */
	bool bStunnedShown = false;

	/** Direct mode: which loop is playing, so the same one is not restarted every frame. */
	TWeakObjectPtr<UAnimSequenceBase> ShownLoopAnim;

	/** Direct mode: set while a one-off clip owns the mesh, so the loops leave it alone. */
	bool bDirectClipPlaying = false;
	FTimerHandle DirectClipTimer;

	/** This machine's telegraph and hit-flash states. RefreshOverlay resolves the three together. */
	bool bTelegraphShown = false;
	bool bHitFlashShown = false;

	FTimerHandle HitstopTimer;
};
