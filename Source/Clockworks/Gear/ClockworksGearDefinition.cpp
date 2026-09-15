// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksGearDefinition.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/Actor.h"
#include "Materials/MaterialInterface.h"

// Runs on: anywhere. The samples mine_gear.py reads every curve at.
const TArray<float>& UClockworksGearDefinition::OriginalDepthSamples()
{
	static const TArray<float> Samples = { 1.f, 3.f, 7.f, 12.f, 17.f, 23.f, 30.f };
	return Samples;
}

// Runs on: anywhere.
float UClockworksGearDefinition::ReadCurve(const TArray<float>& Curve, float OriginalDepth)
{
	const TArray<float>& Depths = OriginalDepthSamples();
	const int32 Count = FMath::Min(Curve.Num(), Depths.Num());
	if (Count == 0)
	{
		return 0.f;
	}
	if (OriginalDepth <= Depths[0])
	{
		return Curve[0];
	}
	for (int32 Index = 1; Index < Count; ++Index)
	{
		if (OriginalDepth <= Depths[Index])
		{
			const float Alpha = (OriginalDepth - Depths[Index - 1]) / FMath::Max(Depths[Index] - Depths[Index - 1], 1.f);
			return FMath::Lerp(Curve[Index - 1], Curve[Index], Alpha);
		}
	}
	return Curve[Count - 1];
}

// Runs on: every machine. Cosmetic only; every machine reads the same data asset and paints its own.
void UClockworksGearDefinition::ShowModel(const UClockworksGearDefinition* Gear, UStaticMeshComponent* MainMesh, TArray<TObjectPtr<UStaticMeshComponent>>& ExtraComponents)
{
	if (!MainMesh)
	{
		return;
	}

	// The piece's skin replaces the exporter's placeholder; a part in a material of its own keeps it. A tinted skin
	// (SkinSwaps) then replaces the imported material it names, placeholder or not.
	auto Paint = [Gear](UStaticMeshComponent* Component)
	{
		Component->EmptyOverrideMaterials();
		const UStaticMesh* Model = Component->GetStaticMesh();
		if (!Gear || !Model)
		{
			return;
		}
		for (int32 MaterialIndex = 0; MaterialIndex < Component->GetNumMaterials(); ++MaterialIndex)
		{
			const UMaterialInterface* Own = Model->GetMaterial(MaterialIndex);
			if (Gear->MeshMaterial && (!Own || Own->GetName().StartsWith(TEXT("dummymtl")) || MaterialIndex == 0))
			{
				Component->SetMaterial(MaterialIndex, Gear->MeshMaterial);
			}
			if (const TObjectPtr<UMaterialInterface>* Swap = Own ? Gear->SkinSwaps.Find(Own->GetFName()) : nullptr)
			{
				Component->SetMaterial(MaterialIndex, *Swap);
			}
		}
	};

	MainMesh->SetStaticMesh(Gear ? Gear->Mesh.Get() : nullptr);
	Paint(MainMesh);

	const int32 Wanted = Gear ? Gear->ExtraMeshes.Num() : 0;
	for (int32 Index = 0; Index < Wanted; ++Index)
	{
		if (!ExtraComponents.IsValidIndex(Index) || !ExtraComponents[Index])
		{
			AActor* Owner = MainMesh->GetOwner();
			if (!Owner)
			{
				break;
			}
			UStaticMeshComponent* Piece = NewObject<UStaticMeshComponent>(Owner, NAME_None, RF_Transient);
			Piece->SetCollisionEnabled(ECollisionEnabled::NoCollision);
			Piece->RegisterComponent();
			Piece->AttachToComponent(MainMesh, FAttachmentTransformRules::SnapToTargetNotIncludingScale);
			ExtraComponents.SetNum(FMath::Max(ExtraComponents.Num(), Index + 1));
			ExtraComponents[Index] = Piece;
		}
		UStaticMeshComponent* Piece = ExtraComponents[Index];
		Piece->SetStaticMesh(Gear->ExtraMeshes[Index]);
		Piece->SetRelativeTransform(FTransform::Identity);
		Piece->SetHiddenInGame(MainMesh->bHiddenInGame);
		Paint(Piece);
	}
	for (int32 Index = Wanted; Index < ExtraComponents.Num(); ++Index)
	{
		if (ExtraComponents[Index])
		{
			ExtraComponents[Index]->SetStaticMesh(nullptr);
		}
	}
}
