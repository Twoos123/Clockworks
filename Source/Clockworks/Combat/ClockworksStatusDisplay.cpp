// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksStatusDisplay.h"
#include "AbilitySystemComponent.h"
#include "AbilitySystemInterface.h"
#include "Components/AudioComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/Actor.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Sound/SoundBase.h"
#include "UObject/ConstructorHelpers.h"

// Runs on: all machines (class default object and every instance). Cosmetic, so it never replicates.
UClockworksStatusDisplay::UClockworksStatusDisplay()
{
	PrimaryComponentTick.bCanEverTick = false;
	SetIsReplicatedByDefault(false);
}

// Runs on: every machine. Status tags arrive on every machine as part of the ability system's own
// replicated state, so each one paints its own aura and nothing extra is sent for it.
void UClockworksStatusDisplay::BeginPlay()
{
	Super::BeginPlay();

	AActor* Owner = GetOwner();
	if (!Owner || StatusVisuals.Num() == 0)
	{
		return;
	}

	// The shell. Built here rather than in the constructor so it can attach to whatever root the
	// owner turned out to have.
	if (AuraMaterial && Owner->GetRootComponent())
	{
		AuraMesh = NewObject<UStaticMeshComponent>(Owner, TEXT("StatusAuraMesh"));
		if (AuraMesh)
		{
			AuraMesh->SetupAttachment(Owner->GetRootComponent());
			AuraMesh->RegisterComponent();
			AuraMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
			AuraMesh->SetCastShadow(false);
			AuraMesh->bReceivesDecals = false;

			if (UStaticMesh* Sphere = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere")))
			{
				AuraMesh->SetStaticMesh(Sphere);
			}

			// The engine sphere is 100 cm across, so a radius in centimetres is scale = radius / 50.
			AuraMesh->SetRelativeLocation(FVector(0.f, 0.f, AuraHeight));
			AuraMesh->SetRelativeScale3D(FVector(AuraRadius / 50.f));

			AuraMaterialInstance = UMaterialInstanceDynamic::Create(AuraMaterial, this);
			AuraMesh->SetMaterial(0, AuraMaterialInstance);
			AuraMaterialInstance->SetScalarParameterValue(AuraBrightnessParameterName, AuraBrightness);
			AuraMesh->SetHiddenInGame(true);
		}
	}

	const IAbilitySystemInterface* AbilityInterface = Cast<IAbilitySystemInterface>(Owner);
	UAbilitySystemComponent* AbilitySystemComponent = AbilityInterface ? AbilityInterface->GetAbilitySystemComponent() : nullptr;
	if (!AbilitySystemComponent)
	{
		// A player's component lives on the PlayerState, which may not have arrived yet. The owner
		// re-runs this through its own possession path in that case; nothing to do here.
		return;
	}
	BoundAbilitySystemComponent = AbilitySystemComponent;

	for (const FClockworksStatusVisual& Visual : StatusVisuals)
	{
		if (!Visual.StatusTag.IsValid())
		{
			continue;
		}
		TagHandles.Add(AbilitySystemComponent
			->RegisterGameplayTagEvent(Visual.StatusTag, EGameplayTagEventType::NewOrRemoved)
			.AddUObject(this, &UClockworksStatusDisplay::OnStatusTagChanged));
	}
}

// Runs on: every machine.
void UClockworksStatusDisplay::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (UAbilitySystemComponent* AbilitySystemComponent = BoundAbilitySystemComponent.Get())
	{
		for (int32 Index = 0; Index < StatusVisuals.Num() && Index < TagHandles.Num(); ++Index)
		{
			AbilitySystemComponent
				->RegisterGameplayTagEvent(StatusVisuals[Index].StatusTag, EGameplayTagEventType::NewOrRemoved)
				.Remove(TagHandles[Index]);
		}
	}
	TagHandles.Reset();

	if (LoopAudio)
	{
		LoopAudio->Stop();
		LoopAudio = nullptr;
	}

	Super::EndPlay(EndPlayReason);
}

// Runs on: every machine. A status landing is the cue the player reacts to, so the one-shot plays
// here rather than waiting for the repaint to decide which status wins.
void UClockworksStatusDisplay::OnStatusTagChanged(const FGameplayTag Tag, int32 NewCount)
{
	if (NewCount > 0)
	{
		if (const FClockworksStatusVisual* Visual = FindVisual(Tag))
		{
			if (Visual->ApplySound && GetOwner())
			{
				UGameplayStatics::PlaySoundAtLocation(this, Visual->ApplySound, GetOwner()->GetActorLocation());
			}
		}
	}
	Refresh();
}

// Runs on: every machine.
const FClockworksStatusVisual* UClockworksStatusDisplay::FindVisual(const FGameplayTag& Tag) const
{
	return StatusVisuals.FindByPredicate([&Tag](const FClockworksStatusVisual& Visual)
	{
		return Visual.StatusTag == Tag;
	});
}

// Runs on: every machine. One aura at a time: several statuses at once would otherwise blend into a
// colour that means nothing, so the one that most needs acting on is the one that shows.
void UClockworksStatusDisplay::Refresh()
{
	UAbilitySystemComponent* AbilitySystemComponent = BoundAbilitySystemComponent.Get();
	if (!AbilitySystemComponent)
	{
		return;
	}

	const FClockworksStatusVisual* Winner = nullptr;
	for (const FClockworksStatusVisual& Visual : StatusVisuals)
	{
		if (!Visual.StatusTag.IsValid() || !AbilitySystemComponent->HasMatchingGameplayTag(Visual.StatusTag))
		{
			continue;
		}
		if (!Winner || Visual.Priority > Winner->Priority)
		{
			Winner = &Visual;
		}
	}

	const FGameplayTag NewStatus = Winner ? Winner->StatusTag : FGameplayTag();
	if (NewStatus == ShownStatus)
	{
		return;
	}
	ShownStatus = NewStatus;

	if (LoopAudio)
	{
		LoopAudio->Stop();
		LoopAudio = nullptr;
	}

	if (!Winner)
	{
		if (AuraMesh)
		{
			AuraMesh->SetHiddenInGame(true);
		}
		return;
	}

	if (AuraMesh && AuraMaterialInstance)
	{
		AuraMaterialInstance->SetVectorParameterValue(AuraColorParameterName, Winner->AuraColor);
		AuraMaterialInstance->SetScalarParameterValue(AuraOpacityParameterName, AuraOpacity);
		AuraMesh->SetHiddenInGame(false);
	}

	if (Winner->LoopSound && GetOwner() && GetOwner()->GetRootComponent())
	{
		LoopAudio = UGameplayStatics::SpawnSoundAttached(Winner->LoopSound, GetOwner()->GetRootComponent());
	}
}
