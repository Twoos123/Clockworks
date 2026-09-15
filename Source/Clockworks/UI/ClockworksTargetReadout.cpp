// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksTargetReadout.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksEnemyCharacter.h"
#include "ClockworksGameplayAbility.h"
#include "ClockworksGameplayTags.h"
#include "ClockworksHUDArt.h"
#include "ClockworksGearStats.h"
#include "World/ClockworksGameState.h"
#include "AbilitySystemComponent.h"
#include "Abilities/GameplayAbility.h"
#include "Blueprint/WidgetLayoutLibrary.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Border.h"
#include "Components/CanvasPanel.h"
#include "Components/HorizontalBox.h"
#include "Components/HorizontalBoxSlot.h"
#include "Components/Image.h"
#include "Components/Overlay.h"
#include "Components/OverlaySlot.h"
#include "Components/SizeBox.h"
#include "Components/TextBlock.h"
#include "Components/VerticalBox.h"
#include "Components/VerticalBoxSlot.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"

#define LOCTEXT_NAMESPACE "ClockworksHUD"

namespace
{
	/** The four damage types, each with its icon and the original's colour for it. */
	struct FDamageTypeDef
	{
		FGameplayTag Tag;
		const TCHAR* TextureName;
		FLinearColor Fallback;
	};

	TArray<FDamageTypeDef> GetDamageTypeDefs()
	{
		return {
			{ ClockworksTags::Data_Damage_Normal,    TEXT("DamageNormal"),    FLinearColor(0.85f, 0.20f, 0.20f, 1.f) },
			{ ClockworksTags::Data_Damage_Piercing,  TEXT("DamagePiercing"),  FLinearColor(0.95f, 0.80f, 0.20f, 1.f) },
			{ ClockworksTags::Data_Damage_Elemental, TEXT("DamageElemental"), FLinearColor(0.25f, 0.80f, 0.30f, 1.f) },
			{ ClockworksTags::Data_Damage_Shadow,    TEXT("DamageShadow"),    FLinearColor(0.60f, 0.30f, 0.85f, 1.f) },
		};
	}
}

// Runs on: the local machine only. UI is never replicated.
UClockworksTargetReadout::UClockworksTargetReadout(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	SetIsFocusable(false);
}

// Runs on: the local machine.
TSharedRef<SWidget> UClockworksTargetReadout::RebuildWidget()
{
	if (WidgetTree && !WidgetTree->RootWidget)
	{
		BuildTree();
	}
	return Super::RebuildWidget();
}

// Runs on: the local machine. Name and family on one line, the health bar under it, then what it hits
// with, what it is weak to and what it resists.
void UClockworksTargetReadout::BuildTree()
{
	using namespace ClockworksHUDArt;

	UCanvasPanel* Canvas = WidgetTree->ConstructWidget<UCanvasPanel>(UCanvasPanel::StaticClass(), TEXT("TargetCanvas"));
	Canvas->SetVisibility(ESlateVisibility::HitTestInvisible);
	WidgetTree->RootWidget = Canvas;

	UBorder* Panel = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("TargetPanel"));
	Panel->SetBrush(RoundedBrush(Navy, 8.f, FLinearColor(0.13f, 0.27f, 0.41f, 1.f), 1.f));
	Panel->SetPadding(FMargin(12.f, 6.f, 12.f, 8.f));

	UVerticalBox* Column = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass());
	Panel->SetContent(Column);

	UHorizontalBox* Title = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass());
	NameText = MakeText(WidgetTree, FText::GetEmpty(), 17, TextWhite, EHUDTypeface::BoldItalic, 1);
	Title->AddChildToHorizontalBox(NameText);
	FamilyText = MakeText(WidgetTree, FText::GetEmpty(), 12, MutedText, EHUDTypeface::Bold, 0);
	if (UHorizontalBoxSlot* FamilySlot = Title->AddChildToHorizontalBox(FamilyText))
	{
		FamilySlot->SetPadding(FMargin(8.f, 0.f, 0.f, 0.f));
		FamilySlot->SetVerticalAlignment(VAlign_Bottom);
	}
	Column->AddChildToVerticalBox(Title);

	HealthBarWidth = PanelWidth - 24.f;
	UOverlay* HealthBar = WidgetTree->ConstructWidget<UOverlay>(UOverlay::StaticClass());
	if (UOverlaySlot* TrackSlot = HealthBar->AddChildToOverlay(MakeImage(WidgetTree, RoundedBrush(NavyDark, 3.f))))
	{
		TrackSlot->SetHorizontalAlignment(HAlign_Fill);
		TrackSlot->SetVerticalAlignment(VAlign_Fill);
	}
	HealthFillBox = MakeSized(WidgetTree, MakeImage(WidgetTree, RoundedBrush(HealthRed, 3.f)), FVector2D(HealthBarWidth, 10.f));
	if (UOverlaySlot* FillSlot = HealthBar->AddChildToOverlay(HealthFillBox))
	{
		FillSlot->SetHorizontalAlignment(HAlign_Left);
		FillSlot->SetVerticalAlignment(VAlign_Fill);
	}
	if (UVerticalBoxSlot* BarSlot = Column->AddChildToVerticalBox(MakeSized(WidgetTree, HealthBar, FVector2D(HealthBarWidth, 10.f))))
	{
		BarSlot->SetPadding(FMargin(0.f, 4.f, 0.f, 5.f));
	}

	UHorizontalBox* Chips = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass());
	auto AddChip = [Chips](UWidget* Chip, float Left)
	{
		if (UHorizontalBoxSlot* ChipSlot = Chips->AddChildToHorizontalBox(Chip))
		{
			ChipSlot->SetPadding(FMargin(Left, 0.f, 0.f, 0.f));
			ChipSlot->SetVerticalAlignment(VAlign_Center);
		}
	};
	AttackBox = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass());
	WeakBox = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass());
	ResistBox = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass());
	WeakLabel = MakeText(WidgetTree, LOCTEXT("TargetWeak", "WEAK"), 10, Gold, EHUDTypeface::Bold, 0);
	ResistLabel = MakeText(WidgetTree, LOCTEXT("TargetResists", "RESISTS"), 10, MutedText, EHUDTypeface::Bold, 0);

	AddChip(MakeText(WidgetTree, LOCTEXT("TargetAttacks", "ATTACKS"), 10, MutedText, EHUDTypeface::Bold, 0), 0.f);
	AddChip(AttackBox, 0.f);
	AddChip(WeakLabel, 14.f);
	AddChip(WeakBox, 0.f);
	AddChip(ResistLabel, 14.f);
	AddChip(ResistBox, 0.f);
	Column->AddChildToVerticalBox(Chips);

	PanelRoot = Panel;
	Panel->SetVisibility(ESlateVisibility::Collapsed);
	Place(Canvas, Panel, FVector2D(0.5f, 0.f), FVector2D(0.5f, 0.f), FVector2D(0.f, TopMargin));
}

// Runs on: the local machine.
void UClockworksTargetReadout::NativeTick(const FGeometry& MyGeometry, float InDeltaTime)
{
	Super::NativeTick(MyGeometry, InDeltaTime);

	PickClock += InDeltaTime;
	if (PickClock >= PickInterval)
	{
		PickClock = 0.f;
		if (AClockworksEnemyCharacter* UnderCursor = FindTargetUnderCursor())
		{
			Target = UnderCursor;
			LingerAge = 0.f;
		}
		else
		{
			LingerAge += PickInterval;
		}
	}

	const AClockworksEnemyCharacter* Enemy = Target.Get();
	if (!PanelRoot)
	{
		return;
	}
	if (!IsAlive(Enemy) || LingerAge > LingerSeconds)
	{
		if (PanelRoot->GetVisibility() != ESlateVisibility::Collapsed)
		{
			PanelRoot->SetVisibility(ESlateVisibility::Collapsed);
		}
		Target = nullptr;
		ChartBuiltFor = nullptr;
		return;
	}

	if (ChartBuiltFor.Get() != Enemy)
	{
		BuildChart(Enemy);
	}

	if (const UClockworksAttributeSet* Attributes = Enemy->GetAttributeSet())
	{
		const float MaxHealth = Attributes->GetMaxHealth();
		const float Fraction = MaxHealth > 0.f ? FMath::Clamp(Attributes->GetHealth() / MaxHealth, 0.f, 1.f) : 0.f;
		if (HealthFillBox && !FMath::IsNearlyEqual(Fraction, ShownHealthFraction, 0.002f))
		{
			ShownHealthFraction = Fraction;
			HealthFillBox->SetWidthOverride(HealthBarWidth * Fraction);
		}
	}

	if (PanelRoot->GetVisibility() == ESlateVisibility::Collapsed)
	{
		PanelRoot->SetVisibility(ESlateVisibility::HitTestInvisible);
	}
}

// Runs on: the local machine. Enemies are replicated actors every machine has; nothing is traced, the
// cursor is compared with where each one is drawn.
AClockworksEnemyCharacter* UClockworksTargetReadout::FindTargetUnderCursor() const
{
	const APlayerController* OwningController = GetOwningPlayer();
	UWorld* World = GetWorld();
	if (!OwningController || !World)
	{
		return nullptr;
	}

	const FVector2D Mouse = UWidgetLayoutLibrary::GetMousePositionOnViewport(this);
	AClockworksEnemyCharacter* Best = nullptr;
	float BestDistance = PickRadius;

	for (TActorIterator<AClockworksEnemyCharacter> It(World); It; ++It)
	{
		AClockworksEnemyCharacter* Enemy = *It;
		if (!IsAlive(Enemy))
		{
			continue;
		}
		FVector2D ScreenPosition;
		if (!UWidgetLayoutLibrary::ProjectWorldLocationToWidgetPosition(OwningController, Enemy->GetActorLocation(), ScreenPosition, /*bPlayerViewportRelative*/ true))
		{
			continue;
		}
		const float Distance = FVector2D::Distance(ScreenPosition, Mouse);
		if (Distance < BestDistance)
		{
			BestDistance = Distance;
			Best = Enemy;
		}
	}
	return Best;
}

// Runs on: the local machine. Rebuilt only when the target changes.
void UClockworksTargetReadout::BuildChart(const AClockworksEnemyCharacter* Enemy)
{
	ChartBuiltFor = Enemy;
	ShownHealthFraction = -1.f;

	if (NameText)
	{
		NameText->SetText(MakeEnemyName(Enemy));
	}

	const FGameplayTag Family = Enemy->GetFamilyTag();
	if (FamilyText)
	{
		FString FamilyName = Family.IsValid() ? Family.ToString() : FString();
		int32 LastDot = INDEX_NONE;
		if (FamilyName.FindLastChar(TEXT('.'), LastDot))
		{
			FamilyName = FamilyName.Mid(LastDot + 1);
		}
		FamilyText->SetText(FText::FromString(FamilyName));
	}

	if (!AttackBox || !WeakBox || !ResistBox)
	{
		return;
	}
	AttackBox->ClearChildren();
	WeakBox->ClearChildren();
	ResistBox->ClearChildren();

	// What it hits with: the damage types its attacks carry at this depth (the original's split), or each attack's own
	// type, Normal where it names none.
	const AClockworksGameState* GameState = GetWorld() ? GetWorld()->GetGameState<AClockworksGameState>() : nullptr;
	const int32 Depth = GameState ? GameState->GetDepth() : 0;
	static const FGameplayTag KindTags[] = {
		ClockworksTags::Data_Damage_Normal, ClockworksTags::Data_Damage_Piercing,
		ClockworksTags::Data_Damage_Elemental, ClockworksTags::Data_Damage_Shadow,
	};
	TSet<FGameplayTag> AttackTypes;
	for (const TSubclassOf<UGameplayAbility>& AbilityClass : Enemy->GetDefaultAbilities())
	{
		const UClockworksGameplayAbility* Ability = AbilityClass ? Cast<UClockworksGameplayAbility>(AbilityClass->GetDefaultObject()) : nullptr;
		if (!Ability)
		{
			continue;
		}
		bool bHasTables = false;
		for (int32 Kind = 0; Kind < 4; ++Kind)
		{
			const TArray<float>& Table = Ability->GetDamageByDepth(Kind);
			if (Table.Num() > 0)
			{
				bHasTables = true;
				if (Table[FMath::Clamp(Depth, 0, Table.Num() - 1)] > 0.f)
				{
					AttackTypes.Add(KindTags[Kind]);
				}
			}
		}
		if (!bHasTables)
		{
			const FGameplayTag Type = Ability->GetDamageTypeFallback();
			AttackTypes.Add(Type.IsValid() ? Type : FGameplayTag(ClockworksTags::Data_Damage_Normal));
		}
	}

	// Weak and resistant, straight from the rule the attribute set applies: the monster's own defense per type when it
	// carries the original's numbers (a weakness is half its Normal defense, a resistance 1400 more), else the family chart.
	for (const FDamageTypeDef& Type : GetDamageTypeDefs())
	{
		if (AttackTypes.Contains(Type.Tag))
		{
			AddTypeIcon(AttackBox, Type.TextureName, Type.Fallback);
		}
		float Multiplier = 1.f;
		if (Enemy->HasDepthDefense())
		{
			const float NormalDefense = Enemy->GetDefenseAt(0, Depth);
			const float OwnDefense = Enemy->GetDefenseAt(static_cast<int32>(ClockworksGearStats::KindOf(Type.Tag)), Depth);
			Multiplier = OwnDefense < NormalDefense * 0.8f ? 1.66f : (OwnDefense > NormalDefense + 500.f ? 0.3f : 1.f);
		}
		else
		{
			Multiplier = UClockworksAttributeSet::GetFamilyMultiplier(Family, Type.Tag);
		}
		if (Multiplier > 1.01f)
		{
			AddTypeIcon(WeakBox, Type.TextureName, Type.Fallback);
		}
		else if (Multiplier < 0.99f)
		{
			AddTypeIcon(ResistBox, Type.TextureName, Type.Fallback);
		}
	}

	const bool bHasWeakness = WeakBox->GetChildrenCount() > 0;
	const bool bHasResistance = ResistBox->GetChildrenCount() > 0;
	if (WeakLabel)
	{
		WeakLabel->SetVisibility(bHasWeakness ? ESlateVisibility::HitTestInvisible : ESlateVisibility::Collapsed);
	}
	if (ResistLabel)
	{
		ResistLabel->SetVisibility(bHasResistance ? ESlateVisibility::HitTestInvisible : ESlateVisibility::Collapsed);
	}
}

// Runs on: the local machine.
void UClockworksTargetReadout::AddTypeIcon(UHorizontalBox* Box, const TCHAR* TextureName, const FLinearColor& Fallback)
{
	using namespace ClockworksHUDArt;

	const FVector2D IconSize(22.f, 22.f);
	if (UHorizontalBoxSlot* IconSlot = Box->AddChildToHorizontalBox(MakeSized(WidgetTree, MakeImage(WidgetTree, TextureBrush(TextureName, IconSize, Fallback, 4.f)), IconSize)))
	{
		IconSlot->SetPadding(FMargin(4.f, 0.f, 0.f, 0.f));
		IconSlot->SetVerticalAlignment(VAlign_Center);
	}
}

// Runs on: any machine.
bool UClockworksTargetReadout::IsAlive(const AClockworksEnemyCharacter* Enemy)
{
	if (!Enemy || Enemy->IsHidden())
	{
		return false;
	}
	const UAbilitySystemComponent* AbilitySystemComponent = Enemy->GetAbilitySystemComponent();
	return !(AbilitySystemComponent && AbilitySystemComponent->HasMatchingGameplayTag(ClockworksTags::State_Dead));
}

// Runs on: any machine.
FText UClockworksTargetReadout::MakeEnemyName(const AClockworksEnemyCharacter* Enemy)
{
	FString Raw = Enemy->GetClass()->GetName();
	Raw.RemoveFromStart(TEXT("BP_"));
	Raw.RemoveFromEnd(TEXT("_C"));

	FString Spaced;
	for (int32 Index = 0; Index < Raw.Len(); ++Index)
	{
		const TCHAR Character = Raw[Index];
		if (Index > 0 && FChar::IsUpper(Character) && FChar::IsLower(Raw[Index - 1]))
		{
			Spaced.AppendChar(TEXT(' '));
		}
		Spaced.AppendChar(Character == TEXT('_') ? TEXT(' ') : Character);
	}
	return FText::FromString(Spaced);
}

#undef LOCTEXT_NAMESPACE
