// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksEnemyHealthBar.h"
#include "ClockworksAttributeSet.h"
#include "AbilitySystemComponent.h"
#include "AbilitySystemInterface.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Border.h"
#include "Components/ProgressBar.h"
#include "Components/SizeBox.h"

// Runs on: the local machine only. UI is never replicated.
UClockworksEnemyHealthBar::UClockworksEnemyHealthBar(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	SetIsFocusable(false);
}

// Runs on: the local machine.
TSharedRef<SWidget> UClockworksEnemyHealthBar::RebuildWidget()
{
	if (WidgetTree && !WidgetTree->RootWidget)
	{
		BuildTree();
	}
	return Super::RebuildWidget();
}

// Runs on: the local machine.
void UClockworksEnemyHealthBar::BuildTree()
{
	USizeBox* Size = WidgetTree->ConstructWidget<USizeBox>(USizeBox::StaticClass(), TEXT("BarSize"));
	Size->SetWidthOverride(BarWidth);
	Size->SetHeightOverride(BarHeight);
	Size->SetVisibility(ESlateVisibility::HitTestInvisible);
	WidgetTree->RootWidget = Size;

	Background = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("BarBackground"));
	Background->SetBrushColor(BackgroundColor);
	Background->SetPadding(FMargin(1.f));

	Bar = WidgetTree->ConstructWidget<UProgressBar>(UProgressBar::StaticClass(), TEXT("Bar"));
	Bar->SetFillColorAndOpacity(HealthyColor);
	Bar->SetPercent(1.f);

	Background->SetContent(Bar);
	Size->SetContent(Background);
}

// Runs on: the local machine. Called by the enemy once its ability system component is ready.
void UClockworksEnemyHealthBar::SetTargetActor(AActor* InTarget)
{
	const IAbilitySystemInterface* Interface = Cast<IAbilitySystemInterface>(InTarget);
	UAbilitySystemComponent* AbilitySystemComponent = Interface ? Interface->GetAbilitySystemComponent() : nullptr;
	if (!AbilitySystemComponent)
	{
		return;
	}
	TargetActor = InTarget;

	// Health replicates to everyone, so each machine drives its own bar off the same number.
	AbilitySystemComponent->GetGameplayAttributeValueChangeDelegate(UClockworksAttributeSet::GetHealthAttribute()).AddUObject(this, &UClockworksEnemyHealthBar::OnHealthChanged);
	AbilitySystemComponent->GetGameplayAttributeValueChangeDelegate(UClockworksAttributeSet::GetMaxHealthAttribute()).AddUObject(this, &UClockworksEnemyHealthBar::OnHealthChanged);
	Refresh();
}

// Runs on: the local machine.
void UClockworksEnemyHealthBar::NativeDestruct()
{
	if (AActor* Target = TargetActor.Get())
	{
		if (const IAbilitySystemInterface* Interface = Cast<IAbilitySystemInterface>(Target))
		{
			if (UAbilitySystemComponent* AbilitySystemComponent = Interface->GetAbilitySystemComponent())
			{
				AbilitySystemComponent->GetGameplayAttributeValueChangeDelegate(UClockworksAttributeSet::GetHealthAttribute()).RemoveAll(this);
				AbilitySystemComponent->GetGameplayAttributeValueChangeDelegate(UClockworksAttributeSet::GetMaxHealthAttribute()).RemoveAll(this);
			}
		}
	}
	TargetActor = nullptr;

	Super::NativeDestruct();
}

// Runs on: the local machine.
void UClockworksEnemyHealthBar::Refresh()
{
	AActor* Target = TargetActor.Get();
	const IAbilitySystemInterface* Interface = Cast<IAbilitySystemInterface>(Target);
	const UAbilitySystemComponent* AbilitySystemComponent = Interface ? Interface->GetAbilitySystemComponent() : nullptr;
	const UClockworksAttributeSet* Attributes = AbilitySystemComponent ? AbilitySystemComponent->GetSet<UClockworksAttributeSet>() : nullptr;
	if (!Attributes || !Bar)
	{
		return;
	}

	const float MaxHealth = Attributes->GetMaxHealth();
	const float Fraction = MaxHealth > 0.f ? FMath::Clamp(Attributes->GetHealth() / MaxHealth, 0.f, 1.f) : 0.f;
	Bar->SetPercent(Fraction);
	Bar->SetFillColorAndOpacity(FMath::Lerp(DyingColor, HealthyColor, Fraction));

	// An untouched enemy shows nothing, so a room reads as a room rather than a wall of bars.
	const bool bShow = Fraction < 1.f && Fraction > 0.f;
	SetVisibility(bShow ? ESlateVisibility::HitTestInvisible : ESlateVisibility::Hidden);
}

// Runs on: the local machine, whenever the replicated attribute lands.
void UClockworksEnemyHealthBar::OnHealthChanged(const FOnAttributeChangeData& Data)
{
	Refresh();
}
