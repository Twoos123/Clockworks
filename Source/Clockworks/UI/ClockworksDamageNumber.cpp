// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksDamageNumber.h"
#include "Components/TextRenderComponent.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInterface.h"
#include "UObject/ConstructorHelpers.h"

// Runs on: whichever machine spawned it. Never replicated: a number is a local flourish.
AClockworksDamageNumber::AClockworksDamageNumber()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = true;
	bReplicates = false;
	SetCanBeDamaged(false);

	Text = CreateDefaultSubobject<UTextRenderComponent>(TEXT("Text"));
	RootComponent = Text;
	Text->SetHorizontalAlignment(EHTA_Center);
	Text->SetVerticalAlignment(EVRTA_TextCenter);
	Text->SetWorldSize(34.f);
	Text->SetTextRenderColor(FColor::White);

	// The component's default text material is opaque, which ignores the colour's alpha and so would
	// pop the number out instead of fading it. The engine ships a translucent one.
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> TranslucentText(
		TEXT("/Engine/EngineMaterials/DefaultTextMaterialTranslucent.DefaultTextMaterialTranslucent"));
	if (TranslucentText.Succeeded())
	{
		Text->SetTextMaterial(TranslucentText.Object);
	}

	// Numbers must be readable through whatever they are floating over; a fight is exactly when
	// something is in the way.
	Text->SetCastShadow(false);
	Text->bReceivesDecals = false;
}

// Runs on: the machine that spawned it.
void AClockworksDamageNumber::ShowDamage(float Amount, float FamilyMultiplier)
{
	if (!Text)
	{
		return;
	}

	Text->SetText(FText::AsNumber(FMath::Max(FMath::RoundToInt(Amount), 1)));

	// The three cases the original distinguishes. The thresholds are loose on purpose: a hit that
	// came out at 1.66 or 0.3 should read the same as one that came out near them.
	if (FamilyMultiplier > 1.1f)
	{
		Text->SetTextRenderColor(WeaknessColor);
		Text->SetWorldSize(BaseTextSize * WeaknessTextScale);
	}
	else if (FamilyMultiplier < 0.9f)
	{
		Text->SetTextRenderColor(ResistedColor);
		Text->SetWorldSize(BaseTextSize * 0.85f);
	}
	else
	{
		Text->SetTextRenderColor(NeutralColor);
		Text->SetWorldSize(BaseTextSize);
	}

	StartLocation = GetActorLocation();

	// A little sideways, so three hits in a second do not stack into one unreadable column.
	Drift = FVector(FMath::FRandRange(-Scatter, Scatter), FMath::FRandRange(-Scatter, Scatter), 0.f);

	SetLifeSpan(LifeSeconds + 0.2f);
}

// Runs on: the machine that spawned it. Rise, drift, fade, and always face the camera.
void AClockworksDamageNumber::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	Elapsed += DeltaSeconds;
	const float Alpha = FMath::Clamp(Elapsed / FMath::Max(LifeSeconds, 0.05f), 0.f, 1.f);

	// Quick at first and slowing, which reads as thrown rather than lifted.
	const float Eased = 1.f - FMath::Square(1.f - Alpha);
	SetActorLocation(StartLocation + Drift * Eased + FVector(0.f, 0.f, RiseDistance * Eased));

	// Face whoever is watching. A number turned edge-on is no number at all.
	if (Text)
	{
		if (const APlayerController* Controller = UGameplayStatics::GetPlayerController(this, 0))
		{
			FVector CameraLocation;
			FRotator CameraRotation;
			Controller->GetPlayerViewPoint(CameraLocation, CameraRotation);
			Text->SetWorldRotation((GetActorLocation() - CameraLocation).Rotation());
		}

		// Holds full strength for most of its life and then goes, rather than fading the whole way,
		// so it is legible for as long as possible.
		const float Opacity = 1.f - FMath::Clamp((Alpha - 0.65f) / 0.35f, 0.f, 1.f);
		FColor Colour = Text->TextRenderColor;
		Colour.A = static_cast<uint8>(FMath::Clamp(Opacity * 255.f, 0.f, 255.f));
		Text->SetTextRenderColor(Colour);
	}

	if (Alpha >= 1.f)
	{
		Destroy();
	}
}
