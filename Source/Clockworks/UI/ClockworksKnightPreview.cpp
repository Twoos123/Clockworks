// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksKnightPreview.h"
#include "Animation/AnimSequenceBase.h"
#include "Components/PointLightComponent.h"
#include "Components/SceneCaptureComponent2D.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/SkeletalMesh.h"
#include "Engine/StaticMesh.h"
#include "Engine/TextureRenderTarget2D.h"
#include "GameFramework/Character.h"

// Runs on: the local machine (and the class default object).
AClockworksKnightPreview::AClockworksKnightPreview()
{
	PrimaryActorTick.bCanEverTick = false;
	bReplicates = false;
	SetCanBeDamaged(false);

	// The stand stays still and carries the camera and the light; the turntable on it carries the knight.
	USceneComponent* Stand = CreateDefaultSubobject<USceneComponent>(TEXT("Stand"));
	RootComponent = Stand;

	Turntable = CreateDefaultSubobject<USceneComponent>(TEXT("Turntable"));
	Turntable->SetupAttachment(Stand);

	Body = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("Body"));
	Body->SetupAttachment(Turntable);
	Body->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Body->SetAnimationMode(EAnimationMode::AnimationSingleNode);
	// The gear screen pauses the game; the knight keeps breathing anyway.
	Body->SetTickableWhenPaused(true);

	// The camera stands in front of the knight (the mesh faces +X once the character's own mesh turn is copied) and
	// never moves; the turntable turns the knight instead.
	Capture = CreateDefaultSubobject<USceneCaptureComponent2D>(TEXT("Capture"));
	Capture->SetupAttachment(Stand);
	Capture->SetRelativeLocation(FVector(430.f, 0.f, 0.f));
	Capture->SetRelativeRotation(FRotator(-6.f, 180.f, 0.f));
	Capture->FOVAngle = 30.f;
	Capture->PrimitiveRenderMode = ESceneCapturePrimitiveRenderMode::PRM_UseShowOnlyList;
	Capture->CaptureSource = ESceneCaptureSource::SCS_FinalColorLDR;
	Capture->bCaptureEveryFrame = true;
	Capture->bCaptureOnMovement = false;
	Capture->SetTickableWhenPaused(true);
	Capture->ShowFlags.SetAtmosphere(false);
	Capture->ShowFlags.SetFog(false);
	Capture->ShowFlags.SetVolumetricFog(false);
	Capture->ShowFlags.SetLumenGlobalIllumination(false);
	Capture->ShowFlags.SetLumenReflections(false);
	Capture->ShowFlags.SetDistanceFieldAO(false);
	Capture->ShowFlags.SetScreenSpaceReflections(false);
	Capture->ShowFlags.SetAmbientOcclusion(false);
	Capture->ShowFlags.SetMotionBlur(false);
	Capture->ShowFlags.SetBloom(false);
	// A fixed exposure: auto exposure over a small knight on an empty background swings wildly.
	Capture->PostProcessSettings.bOverride_AutoExposureMethod = true;
	Capture->PostProcessSettings.AutoExposureMethod = EAutoExposureMethod::AEM_Manual;
	Capture->PostProcessSettings.bOverride_AutoExposureApplyPhysicalCameraExposure = true;
	Capture->PostProcessSettings.AutoExposureApplyPhysicalCameraExposure = false;
	Capture->PostProcessSettings.bOverride_AutoExposureBias = true;
	Capture->PostProcessSettings.AutoExposureBias = 0.f;

	KeyLight = CreateDefaultSubobject<UPointLightComponent>(TEXT("KeyLight"));
	KeyLight->SetupAttachment(Stand);
	KeyLight->SetRelativeLocation(FVector(300.f, 160.f, 220.f));
	KeyLight->SetAttenuationRadius(1500.f);
	KeyLight->SetCastShadows(false);

	IdleAnim = TSoftObjectPtr<UAnimSequenceBase>(FSoftObjectPath(TEXT("/Game/SK/Knights/PlayerKnight/SkeletalMeshes/PlayerKnightidle.PlayerKnightidle")));
}

// Runs on: the local machine.
void AClockworksKnightPreview::BeginPlay()
{
	Super::BeginPlay();

	RenderTarget = NewObject<UTextureRenderTarget2D>(this);
	RenderTarget->RenderTargetFormat = ETextureRenderTargetFormat::RTF_RGBA8;
	RenderTarget->ClearColor = FLinearColor(0.01f, 0.02f, 0.04f, 1.f);
	RenderTarget->InitAutoFormat(PictureWidth, PictureHeight);
	RenderTarget->UpdateResourceImmediate(true);

	Capture->TextureTarget = RenderTarget;
	Capture->ShowOnlyActors.Add(this);
	Capture->ShowFlags.SetLighting(bLit);
	KeyLight->SetVisibility(bLit);
	SetFilming(false);
}

// Runs on: the local machine. Pieces are copied parent first, so an extra piece riding a weapon lands on the copy of
// that weapon; anything not riding the body (the shield dome on the capsule) is left out.
void AClockworksKnightPreview::CopyLook(const ACharacter* Source)
{
	for (UStaticMeshComponent* Piece : Pieces)
	{
		if (Piece)
		{
			Piece->DestroyComponent();
		}
	}
	Pieces.Reset();

	const USkeletalMeshComponent* SourceBody = Source ? Source->GetMesh() : nullptr;
	if (!SourceBody || !Body)
	{
		return;
	}

	if (Body->GetSkeletalMeshAsset() != SourceBody->GetSkeletalMeshAsset())
	{
		Body->SetSkeletalMeshAsset(SourceBody->GetSkeletalMeshAsset());
		if (UAnimSequenceBase* Idle = IdleAnim.LoadSynchronous())
		{
			Body->PlayAnimation(Idle, /*bLooping*/ true);
		}
	}
	Body->SetRelativeTransform(SourceBody->GetRelativeTransform());
	Body->EmptyOverrideMaterials();
	for (int32 MaterialIndex = 0; MaterialIndex < SourceBody->GetNumMaterials(); ++MaterialIndex)
	{
		Body->SetMaterial(MaterialIndex, SourceBody->GetMaterial(MaterialIndex));
	}

	TInlineComponentArray<UStaticMeshComponent*> SourcePieces(Source);
	TArray<const UStaticMeshComponent*> Waiting;
	for (const UStaticMeshComponent* SourcePiece : SourcePieces)
	{
		if (SourcePiece && SourcePiece->GetStaticMesh() && SourcePiece->IsVisible())
		{
			Waiting.Add(SourcePiece);
		}
	}

	TMap<const USceneComponent*, USceneComponent*> Copies;
	Copies.Add(SourceBody, Body);
	for (int32 Pass = 0; Pass < 4 && Waiting.Num() > 0; ++Pass)
	{
		for (int32 Index = Waiting.Num() - 1; Index >= 0; --Index)
		{
			const UStaticMeshComponent* SourcePiece = Waiting[Index];
			USceneComponent** Parent = Copies.Find(SourcePiece->GetAttachParent());
			if (!Parent)
			{
				continue;
			}
			UStaticMeshComponent* Copy = NewObject<UStaticMeshComponent>(this);
			Copy->SetStaticMesh(SourcePiece->GetStaticMesh());
			Copy->SetCollisionEnabled(ECollisionEnabled::NoCollision);
			Copy->RegisterComponent();
			Copy->AttachToComponent(*Parent, FAttachmentTransformRules::KeepRelativeTransform, SourcePiece->GetAttachSocketName());
			Copy->SetRelativeTransform(SourcePiece->GetRelativeTransform());
			for (int32 MaterialIndex = 0; MaterialIndex < SourcePiece->GetNumMaterials(); ++MaterialIndex)
			{
				Copy->SetMaterial(MaterialIndex, SourcePiece->GetMaterial(MaterialIndex));
			}
			Copies.Add(SourcePiece, Copy);
			Pieces.Add(Copy);
			Waiting.RemoveAt(Index);
		}
	}
}

// Runs on: the local machine.
void AClockworksKnightPreview::AddTurn(float Degrees)
{
	if (Turntable)
	{
		Turntable->AddRelativeRotation(FRotator(0.f, Degrees, 0.f));
	}
}

// Runs on: the local machine.
void AClockworksKnightPreview::SetFilming(bool bFilming)
{
	if (Capture)
	{
		Capture->SetComponentTickEnabled(bFilming);
	}
	if (Body)
	{
		Body->SetComponentTickEnabled(bFilming);
	}
}
