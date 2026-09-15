// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "ClockworksPlayerHUD.generated.h"

class AClockworksPlayerState;
class UCanvasPanel;
class UClockworksAttributeSet;
class UClockworksConsumableBelt;
class UClockworksMinimapPanel;
class UClockworksSystemButtons;
class UClockworksTargetReadout;
class UClockworksWeaponWheel;
class UHorizontalBox;
class UImage;
class USizeBox;
class UTextBlock;
class UTexture2D;
struct FOnAttributeChangeData;

/**
 * The in-game HUD, laid out after the user's screenshots of the Spiral Knights interface.
 *
 * This widget draws the top-left corner itself: the round portrait with the depth on its rim, the
 * name banner, the heart row of health pips, the shield row, the orb that glows while an attack
 * charges, and the icons of whatever statuses the knight is under. It also draws the red glow at the
 * screen's edges when the knight is hurt. The other corners are child widgets it creates and stretches
 * over the screen: the minimap panel, the button strips, the consumable belt, the weapon wheel and the
 * targeting readout.
 *
 * The pips behave as the original's do: a lost pip flashes purple, then white, then empties; a
 * regained one flashes cyan; the whole row flickers while the dodge's i-frames are up; and past one
 * row of pips they turn silver, then gold, instead of running off the screen.
 *
 * Pure display of the local player's replicated state. It decides nothing and replicates nothing.
 * Built in C++ so there is no designer graph to keep in sync; a WBP_ child can retune the numbers.
 */
UCLASS()
class UClockworksPlayerHUD : public UUserWidget
{
	GENERATED_BODY()

public:

	UClockworksPlayerHUD(const FObjectInitializer& ObjectInitializer);

protected:

	virtual TSharedRef<SWidget> RebuildWidget() override;
	virtual void NativeDestruct() override;
	virtual void NativeTick(const FGeometry& MyGeometry, float InDeltaTime) override;

	void BuildTree();
	void BuildTopLeft(UCanvasPanel* Canvas);

	/** Creates one of the child sections and stretches it over the whole screen. */
	UUserWidget* AddSection(UCanvasPanel* Canvas, TSubclassOf<UUserWidget> SectionClass, FName SectionName);

	/** The PlayerState arrives some frames after the widget on a client; keep trying until it does. */
	bool TryBind();

	const UClockworksAttributeSet* GetAttributes() const;

	/** Rebuilds the pip row when MaxHealth changes. */
	void RebuildPips();

	/** Repaints every pip from health, the running flashes and the i-frame flicker. */
	void PaintPips();

	void RefreshShield();
	void RefreshLabels();
	void TickChargeOrb(float DeltaSeconds);
	void TickStatusIcons();
	void TickScreenGlow(float DeltaSeconds);

	void OnHealthChanged(const FOnAttributeChangeData& Data);
	void OnMaxHealthChanged(const FOnAttributeChangeData& Data);

	/** The soft elliptical vignette the hurt glow is drawn with. Made in code, so it needs no asset. */
	UTexture2D* MakeEdgeGlowTexture() const;

	// ----- sections -----

	UPROPERTY(EditDefaultsOnly, Category = "HUD|Sections")
	TSubclassOf<UClockworksMinimapPanel> MinimapPanelClass;

	UPROPERTY(EditDefaultsOnly, Category = "HUD|Sections")
	TSubclassOf<UClockworksSystemButtons> SystemButtonsClass;

	UPROPERTY(EditDefaultsOnly, Category = "HUD|Sections")
	TSubclassOf<UClockworksConsumableBelt> ConsumableBeltClass;

	UPROPERTY(EditDefaultsOnly, Category = "HUD|Sections")
	TSubclassOf<UClockworksWeaponWheel> WeaponWheelClass;

	UPROPERTY(EditDefaultsOnly, Category = "HUD|Sections")
	TSubclassOf<UClockworksTargetReadout> TargetReadoutClass;

	// ----- top-left layout -----

	UPROPERTY(EditDefaultsOnly, Category = "HUD|Layout", meta = (ClampMin = "32.0"))
	float PortraitSize = 150.f;

	UPROPERTY(EditDefaultsOnly, Category = "HUD|Layout")
	FVector2D PortraitOrigin = FVector2D(4.f, 4.f);

	UPROPERTY(EditDefaultsOnly, Category = "HUD|Layout", meta = (ClampMin = "16.0"))
	float BannerHeight = 34.f;

	UPROPERTY(EditDefaultsOnly, Category = "HUD|Layout", meta = (ClampMin = "0.0"))
	float BannerMinWidth = 320.f;

	UPROPERTY(EditDefaultsOnly, Category = "HUD|Layout", meta = (ClampMin = "6"))
	int32 NameFontSize = 20;

	// ----- health -----

	/** How much health one pip is worth. Spiral Knights: 40, a knight's own five pips being 200 (user's decision, 2026-09-15). */
	UPROPERTY(EditDefaultsOnly, Category = "HUD|Health", meta = (ClampMin = "1.0"))
	float HealthPerPip = 40.f;

	/** Pips in one row. Past this many they turn silver, and past twice this many gold, as in the original. */
	UPROPERTY(EditDefaultsOnly, Category = "HUD|Health", meta = (ClampMin = "1"))
	int32 PipsPerTier = 30;

	UPROPERTY(EditDefaultsOnly, Category = "HUD|Health")
	FVector2D PipSize = FVector2D(14.f, 36.f);

	UPROPERTY(EditDefaultsOnly, Category = "HUD|Health", meta = (ClampMin = "0.0"))
	float PipSpacing = 2.f;

	/** How long a lost pip shows purple. */
	UPROPERTY(EditDefaultsOnly, Category = "HUD|Health", meta = (ClampMin = "0.0"))
	float DamageFlashSeconds = 0.35f;

	/** How long it then shows white before it empties. */
	UPROPERTY(EditDefaultsOnly, Category = "HUD|Health", meta = (ClampMin = "0.0"))
	float DamageWhiteSeconds = 0.15f;

	/** How long a regained pip shows cyan. */
	UPROPERTY(EditDefaultsOnly, Category = "HUD|Health", meta = (ClampMin = "0.0"))
	float HealFlashSeconds = 0.45f;

	/** Blinks per second while the dodge's i-frames are up. */
	UPROPERTY(EditDefaultsOnly, Category = "HUD|Health", meta = (ClampMin = "0.1"))
	float InvulnerableFlickerHz = 12.f;

	// ----- the hurt glow -----

	UPROPERTY(EditDefaultsOnly, Category = "HUD|Hurt Glow")
	FLinearColor ScreenGlowColor = FLinearColor(0.85f, 0.02f, 0.02f, 1.f);

	UPROPERTY(EditDefaultsOnly, Category = "HUD|Hurt Glow", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float ScreenGlowPeakOpacity = 0.55f;

	UPROPERTY(EditDefaultsOnly, Category = "HUD|Hurt Glow", meta = (ClampMin = "0.01"))
	float ScreenGlowSeconds = 0.35f;

	// ----- the charge orb -----

	UPROPERTY(EditDefaultsOnly, Category = "HUD|Charge Orb")
	FLinearColor ChargeOrbColor = FLinearColor(1.f, 0.42f, 0.08f, 1.f);

	/**
	 * Roughly how long a charge takes, for how fast the orb brightens. It never reaches full brightness
	 * until the knight's charge is actually ready, so a weapon with a longer charge just sits near full.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "HUD|Charge Orb", meta = (ClampMin = "0.1"))
	float ChargeRampSeconds = 2.5f;

private:

	// ----- pips -----

	UPROPERTY()
	TObjectPtr<UHorizontalBox> PipBox;

	UPROPERTY()
	TArray<TObjectPtr<UImage>> Pips;

	/** Which texture each pip shows, so a repaint that changes nothing sets nothing. */
	TArray<FName> PipKeys;
	TArray<float> PipOpacities;

	/** Seconds since each pip slot started flashing, or below zero when it is not. */
	TArray<float> PipDamageAge;
	TArray<float> PipHealAge;

	/** How many pips' worth of health there is in total, across every tier. */
	int32 BandCount = 0;

	UPROPERTY()
	TObjectPtr<UTextBlock> PercentText;

	int32 ShownPercent = -1;

	// ----- shield -----

	UPROPERTY()
	TObjectPtr<UHorizontalBox> ShieldRow;

	UPROPERTY()
	TObjectPtr<UImage> ShieldBadge;

	UPROPERTY()
	TObjectPtr<USizeBox> ShieldBarBox;

	UPROPERTY()
	TObjectPtr<USizeBox> ShieldFillBox;

	UPROPERTY()
	TObjectPtr<UImage> ShieldFill;

	float ShieldBarWidth = 90.f;
	float ShownShieldFraction = -1.f;
	bool bShownShieldBroken = false;

	// ----- labels -----

	UPROPERTY()
	TObjectPtr<UTextBlock> NameText;

	UPROPERTY()
	TObjectPtr<UTextBlock> DepthText;

	FString ShownName;
	int32 ShownDepth = -2;

	// ----- orb, statuses, glow -----

	UPROPERTY()
	TObjectPtr<UImage> ChargeOrbGlow;

	float ChargeElapsed = 0.f;
	float ChargeGlow = 0.f;

	UPROPERTY()
	TArray<TObjectPtr<UImage>> StatusIcons;

	TArray<bool> StatusShown;

	UPROPERTY()
	TObjectPtr<UImage> ScreenGlow;

	UPROPERTY(Transient)
	TObjectPtr<UTexture2D> EdgeGlowTexture;

	float ScreenGlowAge = -1.f;

	// ----- binding -----

	TWeakObjectPtr<AClockworksPlayerState> BoundPlayerState;

	float BuiltForMaxHealth = -1.f;
	bool bPipsAnimating = false;
	bool bInvulnerable = false;
	float HUDClock = 0.f;
};
