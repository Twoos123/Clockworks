// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksPlayerHUD.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksCharacter.h"
#include "ClockworksConsumableBelt.h"
#include "ClockworksGameplayTags.h"
#include "ClockworksGameState.h"
#include "ClockworksHUDArt.h"
#include "ClockworksMinimapPanel.h"
#include "ClockworksPlayerState.h"
#include "ClockworksSystemButtons.h"
#include "ClockworksTargetReadout.h"
#include "ClockworksWeaponWheel.h"
#include "AbilitySystemComponent.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Border.h"
#include "Components/CanvasPanel.h"
#include "Components/CanvasPanelSlot.h"
#include "Components/HorizontalBox.h"
#include "Components/HorizontalBoxSlot.h"
#include "Components/Image.h"
#include "Components/Overlay.h"
#include "Components/OverlaySlot.h"
#include "Components/SizeBox.h"
#include "Components/TextBlock.h"
#include "Components/VerticalBox.h"
#include "Components/VerticalBoxSlot.h"
#include "Engine/Texture2D.h"
#include "Engine/World.h"

#define LOCTEXT_NAMESPACE "ClockworksHUD"

namespace
{
	/** A flat colour for each pip texture, for a machine that has not imported the art. */
	FLinearColor PipFallbackColor(const TCHAR* Key)
	{
		const FString Name(Key);
		if (Name.Contains(TEXT("Damage")))	{ return FLinearColor(0.62f, 0.12f, 0.85f, 1.f); }
		if (Name.Contains(TEXT("Heal")))	{ return FLinearColor(0.20f, 0.90f, 1.00f, 1.f); }
		if (Name.Contains(TEXT("Gold")))	{ return FLinearColor(1.00f, 0.78f, 0.20f, 1.f); }
		if (Name.Contains(TEXT("Silver")))	{ return FLinearColor(0.86f, 0.90f, 0.95f, 1.f); }
		if (Name.Contains(TEXT("Empty")))	{ return FLinearColor(0.05f, 0.07f, 0.12f, 0.95f); }
		if (Name.Contains(TEXT("Half")))	{ return FLinearColor(0.50f, 0.05f, 0.07f, 1.f); }
		return ClockworksHUDArt::HealthRed;
	}

	/** The seven statuses, in the order their icons line up beside the orb. */
	struct FStatusIconDef
	{
		FGameplayTag Tag;
		const TCHAR* TextureName;
		FLinearColor Fallback;
	};

	TArray<FStatusIconDef> GetStatusIconDefs()
	{
		return {
			{ ClockworksTags::Status_Fire,   TEXT("StatusFire"),   FLinearColor(0.95f, 0.35f, 0.10f, 1.f) },
			{ ClockworksTags::Status_Freeze, TEXT("StatusFreeze"), FLinearColor(0.45f, 0.80f, 1.00f, 1.f) },
			{ ClockworksTags::Status_Shock,  TEXT("StatusShock"),  FLinearColor(1.00f, 0.90f, 0.20f, 1.f) },
			{ ClockworksTags::Status_Poison, TEXT("StatusPoison"), FLinearColor(0.35f, 0.85f, 0.25f, 1.f) },
			{ ClockworksTags::Status_Stun,   TEXT("StatusStun"),   FLinearColor(0.70f, 0.45f, 0.95f, 1.f) },
			{ ClockworksTags::Status_Curse,  TEXT("StatusCurse"),  FLinearColor(0.25f, 0.15f, 0.30f, 1.f) },
			{ ClockworksTags::Status_Sleep,  TEXT("StatusSleep"),  FLinearColor(0.30f, 0.40f, 0.90f, 1.f) },
		};
	}
}

// Runs on: the local machine only. UI is never replicated.
UClockworksPlayerHUD::UClockworksPlayerHUD(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	SetIsFocusable(false);

	// The C++ sections work without any asset; a WBP_ child of this HUD may point at restyled ones.
	MinimapPanelClass = UClockworksMinimapPanel::StaticClass();
	SystemButtonsClass = UClockworksSystemButtons::StaticClass();
	ConsumableBeltClass = UClockworksConsumableBelt::StaticClass();
	WeaponWheelClass = UClockworksWeaponWheel::StaticClass();
	TargetReadoutClass = UClockworksTargetReadout::StaticClass();
}

// Runs on: the local machine. A WBP_ child that designed its own tree keeps it.
TSharedRef<SWidget> UClockworksPlayerHUD::RebuildWidget()
{
	if (WidgetTree && !WidgetTree->RootWidget)
	{
		BuildTree();
	}
	return Super::RebuildWidget();
}

// Runs on: the local machine.
void UClockworksPlayerHUD::BuildTree()
{
	UCanvasPanel* Canvas = WidgetTree->ConstructWidget<UCanvasPanel>(UCanvasPanel::StaticClass(), TEXT("HUDCanvas"));
	// Only the real buttons in the corner strips take clicks. Anywhere else, a click is an attack.
	Canvas->SetVisibility(ESlateVisibility::SelfHitTestInvisible);
	WidgetTree->RootWidget = Canvas;

	// The hurt glow goes in first, so every other piece draws over it.
	EdgeGlowTexture = MakeEdgeGlowTexture();
	ScreenGlow = WidgetTree->ConstructWidget<UImage>(UImage::StaticClass(), TEXT("ScreenGlow"));
	FSlateBrush GlowBrush;
	GlowBrush.DrawAs = ESlateBrushDrawType::Image;
	GlowBrush.SetResourceObject(EdgeGlowTexture);
	ScreenGlow->SetBrush(GlowBrush);
	ScreenGlow->SetVisibility(ESlateVisibility::Collapsed);
	if (UCanvasPanelSlot* GlowSlot = Canvas->AddChildToCanvas(ScreenGlow))
	{
		GlowSlot->SetAnchors(FAnchors(0.f, 0.f, 1.f, 1.f));
		GlowSlot->SetOffsets(FMargin(0.f));
	}

	AddSection(Canvas, MinimapPanelClass, TEXT("MinimapPanel"));
	AddSection(Canvas, SystemButtonsClass, TEXT("SystemButtons"));
	AddSection(Canvas, ConsumableBeltClass, TEXT("ConsumableBelt"));
	AddSection(Canvas, TargetReadoutClass, TEXT("TargetReadout"));
	AddSection(Canvas, WeaponWheelClass, TEXT("WeaponWheel"));

	BuildTopLeft(Canvas);
}

// Runs on: the local machine.
UUserWidget* UClockworksPlayerHUD::AddSection(UCanvasPanel* Canvas, TSubclassOf<UUserWidget> SectionClass, FName SectionName)
{
	APlayerController* OwningController = GetOwningPlayer();
	if (!Canvas || !SectionClass || !OwningController)
	{
		return nullptr;
	}

	UUserWidget* Section = CreateWidget<UUserWidget>(OwningController, SectionClass, SectionName);
	if (!Section)
	{
		return nullptr;
	}
	if (UCanvasPanelSlot* SectionSlot = Canvas->AddChildToCanvas(Section))
	{
		SectionSlot->SetAnchors(FAnchors(0.f, 0.f, 1.f, 1.f));
		SectionSlot->SetOffsets(FMargin(0.f));
	}
	return Section;
}

// Runs on: the local machine. Portrait, banner and the plate of rows, in the screenshots' arrangement:
// the round portrait flush with the corner, the banner along the top edge beside it, and under the
// banner the heart row, the shield row, and the orb with the status icons.
void UClockworksPlayerHUD::BuildTopLeft(UCanvasPanel* Canvas)
{
	using namespace ClockworksHUDArt;

	const float PlateLeft = PortraitOrigin.X + PortraitSize * 0.86f;
	const float TuckUnderPortrait = PortraitSize * 0.14f + 10.f;

	// ---- the plate ----
	UBorder* Plate = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("HealthPlate"));
	FSlateBrush PlateBrush = RoundedBrush(Navy, 0.f);
	PlateBrush.OutlineSettings.CornerRadii = FVector4(0.f, 0.f, 16.f, 0.f);
	Plate->SetBrush(PlateBrush);
	Plate->SetPadding(FMargin(TuckUnderPortrait, 6.f, 14.f, 8.f));
	Plate->SetVisibility(ESlateVisibility::HitTestInvisible);

	UVerticalBox* Rows = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("PlateRows"));
	Plate->SetContent(Rows);

	// Row 1: the heart badge with the percentage on it, then the pips. The badge is on the left.
	UHorizontalBox* HeartRow = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass(), TEXT("HeartRow"));
	UOverlay* Heart = WidgetTree->ConstructWidget<UOverlay>(UOverlay::StaticClass(), TEXT("HeartBadge"));
	if (UOverlaySlot* HeartImageSlot = Heart->AddChildToOverlay(MakeImage(WidgetTree, TextureBrush(TEXT("Heart"), FVector2D(40.f), HealthRed, 8.f))))
	{
		HeartImageSlot->SetHorizontalAlignment(HAlign_Fill);
		HeartImageSlot->SetVerticalAlignment(VAlign_Fill);
	}
	PercentText = MakeText(WidgetTree, FText::FromString(TEXT("100%")), 10, TextWhite, EHUDTypeface::BoldItalic, 1);
	if (UOverlaySlot* PercentSlot = Heart->AddChildToOverlay(PercentText))
	{
		PercentSlot->SetHorizontalAlignment(HAlign_Center);
		PercentSlot->SetVerticalAlignment(VAlign_Center);
	}
	if (UHorizontalBoxSlot* HeartSlot = HeartRow->AddChildToHorizontalBox(MakeSized(WidgetTree, Heart, FVector2D(40.f))))
	{
		HeartSlot->SetVerticalAlignment(VAlign_Center);
	}
	PipBox = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass(), TEXT("HealthPips"));
	if (UHorizontalBoxSlot* PipsSlot = HeartRow->AddChildToHorizontalBox(PipBox))
	{
		PipsSlot->SetPadding(FMargin(6.f, 0.f, 0.f, 0.f));
		PipsSlot->SetVerticalAlignment(VAlign_Center);
	}
	Rows->AddChildToVerticalBox(HeartRow);

	// Row 2: the shield badge, then a flat bar as wide as the pips.
	ShieldRow = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass(), TEXT("ShieldRow"));
	ShieldBadge = MakeImage(WidgetTree, TextureBrush(TEXT("Shield"), FVector2D(36.f), ShieldBlue, 6.f));
	if (UHorizontalBoxSlot* BadgeSlot = ShieldRow->AddChildToHorizontalBox(MakeSized(WidgetTree, ShieldBadge, FVector2D(40.f, 36.f))))
	{
		BadgeSlot->SetVerticalAlignment(VAlign_Center);
	}
	UOverlay* ShieldBar = WidgetTree->ConstructWidget<UOverlay>(UOverlay::StaticClass(), TEXT("ShieldBar"));
	if (UOverlaySlot* TrackSlot = ShieldBar->AddChildToOverlay(MakeImage(WidgetTree, RoundedBrush(NavyDark, 2.f))))
	{
		TrackSlot->SetHorizontalAlignment(HAlign_Fill);
		TrackSlot->SetVerticalAlignment(VAlign_Fill);
	}
	ShieldFill = MakeImage(WidgetTree, RoundedBrush(ShieldBlue, 2.f));
	ShieldFillBox = MakeSized(WidgetTree, ShieldFill, FVector2D(ShieldBarWidth, 16.f));
	if (UOverlaySlot* FillSlot = ShieldBar->AddChildToOverlay(ShieldFillBox))
	{
		FillSlot->SetHorizontalAlignment(HAlign_Left);
		FillSlot->SetVerticalAlignment(VAlign_Fill);
	}
	ShieldBarBox = MakeSized(WidgetTree, ShieldBar, FVector2D(ShieldBarWidth, 16.f));
	if (UHorizontalBoxSlot* BarSlot = ShieldRow->AddChildToHorizontalBox(ShieldBarBox))
	{
		BarSlot->SetPadding(FMargin(6.f, 0.f, 0.f, 0.f));
		BarSlot->SetVerticalAlignment(VAlign_Center);
	}
	if (UVerticalBoxSlot* ShieldRowSlot = Rows->AddChildToVerticalBox(ShieldRow))
	{
		ShieldRowSlot->SetPadding(FMargin(0.f, 3.f, 0.f, 0.f));
	}

	// Row 3: the orb, which in the original shows heat and here glows while an attack charges, then
	// one icon per status the knight is under.
	UHorizontalBox* OrbRow = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass(), TEXT("OrbRow"));
	UOverlay* Orb = WidgetTree->ConstructWidget<UOverlay>(UOverlay::StaticClass(), TEXT("ChargeOrb"));
	if (UOverlaySlot* SocketSlot = Orb->AddChildToOverlay(MakeImage(WidgetTree, TextureBrush(TEXT("HeatBacking"), FVector2D(72.f, 36.f), NavyDark, -1.f))))
	{
		SocketSlot->SetHorizontalAlignment(HAlign_Fill);
		SocketSlot->SetVerticalAlignment(VAlign_Fill);
	}
	ChargeOrbGlow = MakeImage(WidgetTree, TextureBrush(TEXT("HeatMask"), FVector2D(34.f), FLinearColor::White, -1.f));
	ChargeOrbGlow->SetColorAndOpacity(FLinearColor(ChargeOrbColor.R, ChargeOrbColor.G, ChargeOrbColor.B, 0.f));
	if (UOverlaySlot* GlowSlot = Orb->AddChildToOverlay(MakeSized(WidgetTree, ChargeOrbGlow, FVector2D(34.f))))
	{
		GlowSlot->SetHorizontalAlignment(HAlign_Left);
		GlowSlot->SetVerticalAlignment(VAlign_Center);
		GlowSlot->SetPadding(FMargin(1.f, 0.f, 0.f, 0.f));
	}
	OrbRow->AddChildToHorizontalBox(MakeSized(WidgetTree, Orb, FVector2D(72.f, 36.f)));

	StatusIcons.Reset();
	StatusShown.Reset();
	for (const FStatusIconDef& Def : GetStatusIconDefs())
	{
		UImage* Icon = MakeImage(WidgetTree, TextureBrush(Def.TextureName, FVector2D(26.f), Def.Fallback, 5.f));
		Icon->SetVisibility(ESlateVisibility::Collapsed);
		if (UHorizontalBoxSlot* IconSlot = OrbRow->AddChildToHorizontalBox(MakeSized(WidgetTree, Icon, FVector2D(26.f))))
		{
			IconSlot->SetPadding(FMargin(4.f, 0.f, 0.f, 0.f));
			IconSlot->SetVerticalAlignment(VAlign_Center);
		}
		StatusIcons.Add(Icon);
		StatusShown.Add(false);
	}
	if (UVerticalBoxSlot* OrbRowSlot = Rows->AddChildToVerticalBox(OrbRow))
	{
		OrbRowSlot->SetPadding(FMargin(0.f, 4.f, 0.f, 0.f));
	}

	if (UCanvasPanelSlot* PlateSlot = Place(Canvas, Plate, FVector2D::ZeroVector, FVector2D::ZeroVector, FVector2D(PlateLeft, BannerHeight)))
	{
		PlateSlot->SetZOrder(1);
	}

	// ---- the name banner, along the top edge ----
	UBorder* Banner = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("NameBanner"));
	FSlateBrush BannerBrush = RoundedBrush(NavyDark, 0.f);
	BannerBrush.OutlineSettings.CornerRadii = FVector4(0.f, 0.f, 12.f, 12.f);
	Banner->SetBrush(BannerBrush);
	Banner->SetPadding(FMargin(TuckUnderPortrait + 4.f, 0.f, 22.f, 0.f));
	Banner->SetVerticalAlignment(VAlign_Center);
	Banner->SetVisibility(ESlateVisibility::HitTestInvisible);
	NameText = MakeText(WidgetTree, FText::GetEmpty(), NameFontSize, Gold, EHUDTypeface::Bold, 1);
	Banner->SetContent(NameText);
	USizeBox* BannerBox = WidgetTree->ConstructWidget<USizeBox>(USizeBox::StaticClass(), TEXT("NameBannerSize"));
	BannerBox->SetHeightOverride(BannerHeight);
	BannerBox->SetMinDesiredWidth(BannerMinWidth);
	BannerBox->SetContent(Banner);
	if (UCanvasPanelSlot* BannerSlot = Place(Canvas, BannerBox, FVector2D::ZeroVector, FVector2D::ZeroVector, FVector2D(PlateLeft, 0.f)))
	{
		BannerSlot->SetZOrder(2);
	}

	// ---- the portrait, over both ----
	const FVector2D PortraitExtent(PortraitSize, PortraitSize);
	UOverlay* Portrait = WidgetTree->ConstructWidget<UOverlay>(UOverlay::StaticClass(), TEXT("Portrait"));
	Portrait->SetVisibility(ESlateVisibility::HitTestInvisible);
	auto AddPortraitLayer = [Portrait](UWidget* Layer, EHorizontalAlignment HAlign, EVerticalAlignment VAlign)
	{
		if (UOverlaySlot* LayerSlot = Portrait->AddChildToOverlay(Layer))
		{
			LayerSlot->SetHorizontalAlignment(HAlign);
			LayerSlot->SetVerticalAlignment(VAlign);
		}
	};

	UImage* Backing = MakeImage(WidgetTree, TextureBrush(TEXT("PortraitBacking"), PortraitExtent, FLinearColor(0.30f, 0.03f, 0.05f, 1.f), -1.f));
	// The original's bust sits on dark red.
	Backing->SetColorAndOpacity(FLinearColor(0.80f, 0.22f, 0.24f, 1.f));
	AddPortraitLayer(Backing, HAlign_Fill, VAlign_Fill);
	AddPortraitLayer(MakeSized(WidgetTree, MakeImage(WidgetTree, TextureBrush(TEXT("PortraitHelm"), PortraitExtent * 0.62f)), PortraitExtent * 0.62f), HAlign_Center, VAlign_Center);
	AddPortraitLayer(MakeImage(WidgetTree, TextureBrush(TEXT("PortraitGloss"), PortraitExtent)), HAlign_Fill, VAlign_Fill);
	const FSlateBrush RingBrush = Texture(TEXT("PortraitRing"))
		? TextureBrush(TEXT("PortraitRing"), PortraitExtent)
		: RoundedBrush(FLinearColor::Transparent, -1.f, SteelBlue, 6.f);
	AddPortraitLayer(MakeImage(WidgetTree, RingBrush), HAlign_Fill, VAlign_Fill);

	if (UCanvasPanelSlot* PortraitSlot = Place(Canvas, Portrait, FVector2D::ZeroVector, FVector2D::ZeroVector, PortraitOrigin, PortraitExtent))
	{
		PortraitSlot->SetZOrder(10);
	}

	// The rim label. In the original it is the knight's rank; this demo has no ranks, so it is how
	// deep the run is.
	DepthText = MakeText(WidgetTree, FText::GetEmpty(), 15, TextWhite, EHUDTypeface::BoldItalic, 2);
	DepthText->SetVisibility(ESlateVisibility::Collapsed);
	if (UCanvasPanelSlot* DepthSlot = Place(Canvas, DepthText, FVector2D::ZeroVector, FVector2D(0.5f, 0.f), FVector2D(PortraitOrigin.X + PortraitSize * 0.5f, PortraitOrigin.Y)))
	{
		DepthSlot->SetZOrder(11);
	}
}

// Runs on: the local machine. The PlayerState may not exist yet on a client.
void UClockworksPlayerHUD::NativeTick(const FGeometry& MyGeometry, float InDeltaTime)
{
	Super::NativeTick(MyGeometry, InDeltaTime);

	HUDClock += InDeltaTime;
	TickScreenGlow(InDeltaTime);

	if (!BoundPlayerState.IsValid() && !TryBind())
	{
		RefreshLabels();
		return;
	}
	RefreshLabels();

	const UAbilitySystemComponent* AbilitySystemComponent = BoundPlayerState->GetAbilitySystemComponent();
	const bool bNowInvulnerable = AbilitySystemComponent && AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Invulnerable);

	bool bAnyFlash = false;
	for (float& Age : PipDamageAge)
	{
		if (Age >= 0.f)
		{
			Age += InDeltaTime;
			if (Age > DamageFlashSeconds + DamageWhiteSeconds)
			{
				Age = -1.f;
			}
			else
			{
				bAnyFlash = true;
			}
		}
	}
	for (float& Age : PipHealAge)
	{
		if (Age >= 0.f)
		{
			Age += InDeltaTime;
			if (Age > HealFlashSeconds)
			{
				Age = -1.f;
			}
			else
			{
				bAnyFlash = true;
			}
		}
	}

	// One more paint after the last flash or the i-frames end, so the row settles on its real state.
	if (bPipsAnimating || bAnyFlash || bNowInvulnerable || bInvulnerable)
	{
		bInvulnerable = bNowInvulnerable;
		PaintPips();
	}
	bPipsAnimating = bAnyFlash;

	RefreshShield();
	TickChargeOrb(InDeltaTime);
	TickStatusIcons();
}

// Runs on: the local machine.
bool UClockworksPlayerHUD::TryBind()
{
	AClockworksPlayerState* PlayerState = GetOwningPlayerState<AClockworksPlayerState>();
	UAbilitySystemComponent* AbilitySystemComponent = PlayerState ? PlayerState->GetAbilitySystemComponent() : nullptr;
	if (!PlayerState || !AbilitySystemComponent || !PlayerState->GetAttributeSet())
	{
		return false;
	}
	BoundPlayerState = PlayerState;

	AbilitySystemComponent->GetGameplayAttributeValueChangeDelegate(UClockworksAttributeSet::GetHealthAttribute()).AddUObject(this, &UClockworksPlayerHUD::OnHealthChanged);
	AbilitySystemComponent->GetGameplayAttributeValueChangeDelegate(UClockworksAttributeSet::GetMaxHealthAttribute()).AddUObject(this, &UClockworksPlayerHUD::OnMaxHealthChanged);

	BuiltForMaxHealth = -1.f;
	RebuildPips();
	PaintPips();
	RefreshShield();
	return true;
}

// Runs on: the local machine. Unbinding keeps a respawn or a rebuilt HUD from stacking delegates.
void UClockworksPlayerHUD::NativeDestruct()
{
	if (AClockworksPlayerState* PlayerState = BoundPlayerState.Get())
	{
		if (UAbilitySystemComponent* AbilitySystemComponent = PlayerState->GetAbilitySystemComponent())
		{
			AbilitySystemComponent->GetGameplayAttributeValueChangeDelegate(UClockworksAttributeSet::GetHealthAttribute()).RemoveAll(this);
			AbilitySystemComponent->GetGameplayAttributeValueChangeDelegate(UClockworksAttributeSet::GetMaxHealthAttribute()).RemoveAll(this);
		}
	}
	BoundPlayerState = nullptr;

	Super::NativeDestruct();
}

// Runs on: the local machine.
const UClockworksAttributeSet* UClockworksPlayerHUD::GetAttributes() const
{
	const AClockworksPlayerState* PlayerState = BoundPlayerState.Get();
	return PlayerState ? PlayerState->GetAttributeSet() : nullptr;
}

// Runs on: the local machine. One image per pip slot; only rebuilt when MaxHealth changes.
void UClockworksPlayerHUD::RebuildPips()
{
	const UClockworksAttributeSet* Attributes = GetAttributes();
	if (!Attributes || !PipBox || !WidgetTree)
	{
		return;
	}

	const float MaxHealth = Attributes->GetMaxHealth();
	if (FMath::IsNearlyEqual(MaxHealth, BuiltForMaxHealth))
	{
		return;
	}
	BuiltForMaxHealth = MaxHealth;

	const int32 Tier = FMath::Max(PipsPerTier, 1);
	BandCount = FMath::Clamp(FMath::CeilToInt(MaxHealth / FMath::Max(HealthPerPip, 1.f)), 1, Tier * 3);
	const int32 SlotCount = FMath::Min(BandCount, Tier);

	PipBox->ClearChildren();
	Pips.Reset();
	PipKeys.Reset();
	PipOpacities.Reset();
	for (int32 Index = 0; Index < SlotCount; ++Index)
	{
		UImage* Pip = ClockworksHUDArt::MakeImage(WidgetTree, FSlateBrush());
		if (UHorizontalBoxSlot* PipSlot = PipBox->AddChildToHorizontalBox(ClockworksHUDArt::MakeSized(WidgetTree, Pip, PipSize)))
		{
			PipSlot->SetPadding(FMargin(Index == 0 ? 0.f : PipSpacing, 0.f, 0.f, 0.f));
		}
		Pips.Add(Pip);
		PipKeys.Add(NAME_None);
		PipOpacities.Add(-1.f);
	}
	PipDamageAge.Init(-1.f, SlotCount);
	PipHealAge.Init(-1.f, SlotCount);

	// The shield bar is as wide as the pip row, as in the original.
	ShieldBarWidth = FMath::Max(SlotCount * (PipSize.X + PipSpacing) - PipSpacing, 90.f);
	if (ShieldBarBox)
	{
		ShieldBarBox->SetWidthOverride(ShieldBarWidth);
	}
	ShownShieldFraction = -1.f;

	PaintPips();
}

// Runs on: the local machine.
void UClockworksPlayerHUD::PaintPips()
{
	const UClockworksAttributeSet* Attributes = GetAttributes();
	if (!Attributes)
	{
		return;
	}

	const float Health = Attributes->GetHealth();
	const float MaxHealth = Attributes->GetMaxHealth();
	const float PerPip = FMath::Max(HealthPerPip, 1.f);
	const int32 Tier = FMath::Max(PipsPerTier, 1);
	const bool bFlickerDim = bInvulnerable && FMath::Frac(HUDClock * InvulnerableFlickerHz) >= 0.5f;

	static const TCHAR* FullKeys[] = { TEXT("PipFull"), TEXT("PipSilverFull"), TEXT("PipGoldFull") };
	static const TCHAR* HalfKeys[] = { TEXT("PipHalf"), TEXT("PipSilverHalf"), TEXT("PipGoldHalf") };

	for (int32 Index = 0; Index < Pips.Num(); ++Index)
	{
		const TCHAR* Key = TEXT("PipEmpty");
		bool bLit = false;

		if (PipDamageAge.IsValidIndex(Index) && PipDamageAge[Index] >= 0.f)
		{
			// Purple, then white, then the empty pip underneath.
			Key = PipDamageAge[Index] < DamageFlashSeconds ? TEXT("PipDamageFull") : TEXT("PipSilverFull");
		}
		else if (PipHealAge.IsValidIndex(Index) && PipHealAge[Index] >= 0.f)
		{
			Key = TEXT("PipHealFull");
			bLit = true;
		}
		else
		{
			// The highest tier with any health in it at this slot wins: red, then silver, then gold.
			for (int32 TierIndex = 2; TierIndex >= 0; --TierIndex)
			{
				const int32 Band = Index + TierIndex * Tier;
				const float Floor = Band * PerPip;
				if (Band < BandCount && Health > Floor + UE_KINDA_SMALL_NUMBER)
				{
					const bool bFull = Health >= FMath::Min(Floor + PerPip, MaxHealth) - UE_KINDA_SMALL_NUMBER;
					Key = bFull ? FullKeys[TierIndex] : HalfKeys[TierIndex];
					bLit = true;
					break;
				}
			}
		}

		UImage* Pip = Pips[Index];
		if (!Pip)
		{
			continue;
		}
		const FName KeyName(Key);
		if (PipKeys[Index] != KeyName)
		{
			Pip->SetBrush(ClockworksHUDArt::TextureBrush(Key, PipSize, PipFallbackColor(Key), 2.f));
			PipKeys[Index] = KeyName;
		}
		const float Opacity = (bLit && bFlickerDim) ? 0.3f : 1.f;
		if (!FMath::IsNearlyEqual(PipOpacities[Index], Opacity))
		{
			Pip->SetRenderOpacity(Opacity);
			PipOpacities[Index] = Opacity;
		}
	}

	// The badge reads a percentage rather than a fraction, as the original's does.
	const int32 Percent = MaxHealth > 0.f ? FMath::CeilToInt(100.f * Health / MaxHealth) : 0;
	if (PercentText && Percent != ShownPercent)
	{
		ShownPercent = Percent;
		PercentText->SetText(FText::FromString(FString::Printf(TEXT("%d%%"), Percent)));
	}
}

// Runs on: the local machine. The shield break is a loose tag rather than an attribute, so this is
// polled; it only touches a widget when something it shows has changed.
void UClockworksPlayerHUD::RefreshShield()
{
	const UClockworksAttributeSet* Attributes = GetAttributes();
	const AClockworksPlayerState* PlayerState = BoundPlayerState.Get();
	const UAbilitySystemComponent* AbilitySystemComponent = PlayerState ? PlayerState->GetAbilitySystemComponent() : nullptr;
	if (!Attributes || !ShieldFillBox || !ShieldRow)
	{
		return;
	}

	const float MaxShield = Attributes->GetMaxShield();
	const float Fraction = MaxShield > 0.f ? FMath::Clamp(Attributes->GetShield() / MaxShield, 0.f, 1.f) : 0.f;
	const bool bBroken = AbilitySystemComponent && AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_ShieldBroken);

	const ESlateVisibility RowVisibility = MaxShield > 0.f ? ESlateVisibility::HitTestInvisible : ESlateVisibility::Collapsed;
	if (ShieldRow->GetVisibility() != RowVisibility)
	{
		ShieldRow->SetVisibility(RowVisibility);
	}

	if (!FMath::IsNearlyEqual(Fraction, ShownShieldFraction, 0.002f))
	{
		ShownShieldFraction = Fraction;
		ShieldFillBox->SetWidthOverride(FMath::Max(ShieldBarWidth * Fraction, 0.f));
	}

	if (bBroken != bShownShieldBroken)
	{
		bShownShieldBroken = bBroken;
		if (ShieldBadge)
		{
			ShieldBadge->SetBrush(ClockworksHUDArt::TextureBrush(bBroken ? TEXT("ShieldDisabled") : TEXT("Shield"), FVector2D(36.f),
				bBroken ? FLinearColor(0.35f, 0.08f, 0.08f, 1.f) : ClockworksHUDArt::ShieldBlue, 6.f));
		}
		if (ShieldFill)
		{
			ShieldFill->SetColorAndOpacity(bBroken ? FLinearColor(0.75f, 0.12f, 0.12f, 1.f) : FLinearColor::White);
		}
	}
}

// Runs on: the local machine. The depth is readable even before a PlayerState exists on a client.
void UClockworksPlayerHUD::RefreshLabels()
{
	const UWorld* World = GetWorld();
	const AClockworksGameState* GameState = World ? World->GetGameState<AClockworksGameState>() : nullptr;
	const int32 Depth = GameState ? GameState->GetDepth() : INDEX_NONE;
	if (DepthText && Depth != ShownDepth)
	{
		ShownDepth = Depth;
		if (GameState)
		{
			DepthText->SetText(FText::Format(LOCTEXT("PortraitDepth", "Depth {0}"), FText::AsNumber(Depth)));
			DepthText->SetVisibility(ESlateVisibility::HitTestInvisible);
		}
		else
		{
			// No game state means a test level rather than a run: nothing to say.
			DepthText->SetVisibility(ESlateVisibility::Collapsed);
		}
	}

	if (NameText)
	{
		if (const AClockworksPlayerState* PlayerState = BoundPlayerState.Get())
		{
			const FString PlayerName = PlayerState->GetPlayerName();
			if (PlayerName != ShownName)
			{
				ShownName = PlayerName;
				NameText->SetText(FText::FromString(PlayerName));
			}
		}
	}
}

// Runs on: the local machine. Brightens while the knight charges and pulses once the charge is
// loaded. Reads the charging tag, which the owning client adds itself, and the knight's own
// charge-ready flag, which every machine keeps for the aura.
void UClockworksPlayerHUD::TickChargeOrb(float DeltaSeconds)
{
	if (!ChargeOrbGlow)
	{
		return;
	}

	const AClockworksCharacter* Knight = Cast<AClockworksCharacter>(GetOwningPlayerPawn());
	const AClockworksPlayerState* PlayerState = BoundPlayerState.Get();
	const UAbilitySystemComponent* AbilitySystemComponent = PlayerState ? PlayerState->GetAbilitySystemComponent() : nullptr;
	const bool bCharging = AbilitySystemComponent && AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Charging);
	const bool bReady = Knight && Knight->IsChargeReadyShown();

	float Target = 0.f;
	if (bReady)
	{
		Target = 0.85f + 0.15f * FMath::Sin(HUDClock * 8.f);
	}
	else if (bCharging)
	{
		ChargeElapsed += DeltaSeconds;
		Target = 0.15f + 0.55f * FMath::Clamp(ChargeElapsed / ChargeRampSeconds, 0.f, 1.f);
	}
	if (!bCharging && !bReady)
	{
		ChargeElapsed = 0.f;
	}

	const float NewGlow = FMath::FInterpTo(ChargeGlow, Target, DeltaSeconds, 12.f);
	if (!FMath::IsNearlyEqual(NewGlow, ChargeGlow, 0.001f))
	{
		ChargeGlow = NewGlow;
		ChargeOrbGlow->SetColorAndOpacity(FLinearColor(ChargeOrbColor.R, ChargeOrbColor.G, ChargeOrbColor.B, ChargeGlow));
	}
}

// Runs on: the local machine. Status effects grant their tags to the knight's ability system, which
// replicates them to the owning client.
void UClockworksPlayerHUD::TickStatusIcons()
{
	const AClockworksPlayerState* PlayerState = BoundPlayerState.Get();
	const UAbilitySystemComponent* AbilitySystemComponent = PlayerState ? PlayerState->GetAbilitySystemComponent() : nullptr;
	if (!AbilitySystemComponent)
	{
		return;
	}

	const TArray<FStatusIconDef> Defs = GetStatusIconDefs();
	for (int32 Index = 0; Index < Defs.Num() && Index < StatusIcons.Num(); ++Index)
	{
		const bool bActive = AbilitySystemComponent->HasMatchingGameplayTag(Defs[Index].Tag);
		if (StatusIcons[Index] && bActive != StatusShown[Index])
		{
			StatusShown[Index] = bActive;
			StatusIcons[Index]->SetVisibility(bActive ? ESlateVisibility::HitTestInvisible : ESlateVisibility::Collapsed);
		}
	}
}

// Runs on: the local machine. Quick to arrive, easing away.
void UClockworksPlayerHUD::TickScreenGlow(float DeltaSeconds)
{
	if (!ScreenGlow || ScreenGlowAge < 0.f)
	{
		return;
	}

	ScreenGlowAge += DeltaSeconds;
	const float Alpha = FMath::Clamp(ScreenGlowAge / ScreenGlowSeconds, 0.f, 1.f);
	if (Alpha >= 1.f)
	{
		ScreenGlowAge = -1.f;
		ScreenGlow->SetVisibility(ESlateVisibility::Collapsed);
		return;
	}

	const float Opacity = ScreenGlowPeakOpacity * FMath::Square(1.f - Alpha);
	ScreenGlow->SetColorAndOpacity(FLinearColor(ScreenGlowColor.R, ScreenGlowColor.G, ScreenGlowColor.B, Opacity));
	ScreenGlow->SetVisibility(ESlateVisibility::HitTestInvisible);
}

// Runs on: the local machine, whenever the replicated attribute lands. The change carries its old
// value, which is what says whether this was a hit or a heal and which pips to flash.
void UClockworksPlayerHUD::OnHealthChanged(const FOnAttributeChangeData& Data)
{
	const float PerPip = FMath::Max(HealthPerPip, 1.f);
	const int32 Tier = FMath::Max(PipsPerTier, 1);

	auto MarkBands = [&](float Low, float High, TArray<float>& Start, TArray<float>& Stop)
	{
		const int32 From = FMath::Max(FMath::FloorToInt(Low / PerPip), 0);
		const int32 To = FMath::Min(FMath::CeilToInt(High / PerPip) - 1, BandCount - 1);
		for (int32 Band = From; Band <= To; ++Band)
		{
			const int32 SlotIndex = Band % Tier;
			if (Start.IsValidIndex(SlotIndex))
			{
				Start[SlotIndex] = 0.f;
			}
			if (Stop.IsValidIndex(SlotIndex))
			{
				Stop[SlotIndex] = -1.f;
			}
		}
	};

	if (Data.NewValue < Data.OldValue - UE_KINDA_SMALL_NUMBER)
	{
		MarkBands(Data.NewValue, Data.OldValue, PipDamageAge, PipHealAge);
		ScreenGlowAge = 0.f;
		bPipsAnimating = true;
	}
	else if (Data.NewValue > Data.OldValue + UE_KINDA_SMALL_NUMBER && Data.OldValue > UE_KINDA_SMALL_NUMBER)
	{
		// A respawn refills from nothing; that is not a heal worth flashing.
		MarkBands(Data.OldValue, Data.NewValue, PipHealAge, PipDamageAge);
		bPipsAnimating = true;
	}

	PaintPips();
}

void UClockworksPlayerHUD::OnMaxHealthChanged(const FOnAttributeChangeData& Data)
{
	RebuildPips();
}

// Runs on: the local machine, once per HUD. White with an elliptical alpha: clear in the middle,
// deepest in the corners, the shape of the original's own low-health overlay. Tinted red when drawn.
UTexture2D* UClockworksPlayerHUD::MakeEdgeGlowTexture() const
{
	const int32 Size = 128;
	TArray<uint8> Pixels;
	Pixels.SetNumZeroed(Size * Size * 4);

	for (int32 Y = 0; Y < Size; ++Y)
	{
		for (int32 X = 0; X < Size; ++X)
		{
			const float U = (X + 0.5f) / Size * 2.f - 1.f;
			const float V = (Y + 0.5f) / Size * 2.f - 1.f;
			const float Alpha = FMath::SmoothStep(0.55f, 1.3f, FMath::Sqrt(U * U + V * V));

			const int32 Offset = (Y * Size + X) * 4;
			Pixels[Offset] = 255;
			Pixels[Offset + 1] = 255;
			Pixels[Offset + 2] = 255;
			Pixels[Offset + 3] = static_cast<uint8>(FMath::Clamp(FMath::RoundToInt(Alpha * 255.f), 0, 255));
		}
	}

	UTexture2D* Glow = UTexture2D::CreateTransient(Size, Size, PF_B8G8R8A8, NAME_None, TConstArrayView64<uint8>(Pixels.GetData(), Pixels.Num()));
	if (Glow)
	{
		Glow->Filter = TF_Bilinear;
		Glow->AddressX = TA_Clamp;
		Glow->AddressY = TA_Clamp;
		Glow->UpdateResource();
	}
	return Glow;
}

#undef LOCTEXT_NAMESPACE
