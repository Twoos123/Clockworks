// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksWeaponDefinition.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/Actor.h"
#include "GameplayTagsManager.h"
#include "Materials/MaterialInterface.h"

// Runs on: every machine. Cosmetic only; the caller decides when (a weapon switch, a bomb's weapon
// arriving). Nothing here is replicated: every machine reads the same data asset and paints its own.
void UClockworksWeaponDefinition::ShowModel(const UClockworksWeaponDefinition* Weapon, UStaticMeshComponent* MainMesh, TArray<TObjectPtr<UStaticMeshComponent>>& ExtraComponents)
{
	if (!MainMesh)
	{
		return;
	}

	// The weapon's skin replaces the exporter's placeholder and the model's own base skin. A piece in a
	// material of its own (a Node Slime's jelly next to its sword-and-board) keeps that material.
	const UMaterialInterface* BaseSkin = (Weapon && Weapon->Mesh) ? Weapon->Mesh->GetMaterial(0) : nullptr;
	auto Paint = [Weapon, BaseSkin](UStaticMeshComponent* Component)
	{
		Component->EmptyOverrideMaterials();
		const UStaticMesh* Model = Component->GetStaticMesh();
		if (!Weapon || !Weapon->MeshMaterial || !Model)
		{
			return;
		}
		for (int32 MaterialIndex = 0; MaterialIndex < Component->GetNumMaterials(); ++MaterialIndex)
		{
			const UMaterialInterface* Own = Model->GetMaterial(MaterialIndex);
			if (!Own || Own == BaseSkin || Own->GetName().StartsWith(TEXT("dummymtl")))
			{
				Component->SetMaterial(MaterialIndex, Weapon->MeshMaterial);
			}
		}
	};

	MainMesh->SetStaticMesh(Weapon ? Weapon->Mesh.Get() : nullptr);
	Paint(MainMesh);

	const int32 Wanted = Weapon ? Weapon->ExtraMeshes.Num() : 0;
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

		// The exporter bakes each piece's place in the model into the piece, so every one sits at the
		// main mesh's origin.
		UStaticMeshComponent* Piece = ExtraComponents[Index];
		Piece->SetStaticMesh(Weapon->ExtraMeshes[Index]);
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

// Runs on: the editor, from the catalogue generator. See the header for why this exists.
void UClockworksWeaponDefinition::SetDamageTypeByName(const FString& TagName)
{
	// ErrorIfNotFound, deliberately: a generator writing hundreds of assets should stop on a
	// misspelled tag rather than quietly leave every weapon dealing Normal damage.
	DamageType = UGameplayTagsManager::Get().RequestGameplayTag(FName(*TagName), /*ErrorIfNotFound*/ true);
}

// Runs on: anywhere. Tools only; the game reads the tag itself.
FString UClockworksWeaponDefinition::GetDamageTypeName() const
{
	return DamageType.IsValid() ? DamageType.ToString() : TEXT("none");
}
