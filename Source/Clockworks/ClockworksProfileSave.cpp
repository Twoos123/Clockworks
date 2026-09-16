// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksProfileSave.h"

#include "Clockworks.h"
#include "Kismet/GameplayStatics.h"

// Runs on: the local machine only.
UClockworksProfileSave* UClockworksProfileSave::Load()
{
	if (UGameplayStatics::DoesSaveGameExist(SlotName(), 0))
	{
		if (UClockworksProfileSave* Loaded = Cast<UClockworksProfileSave>(
			UGameplayStatics::LoadGameFromSlot(SlotName(), 0)))
		{
			return Loaded;
		}
		UE_LOG(LogClockworks, Warning, TEXT("Profile: the knights save exists but would not load; starting empty"));
	}

	return Cast<UClockworksProfileSave>(
		UGameplayStatics::CreateSaveGameObject(UClockworksProfileSave::StaticClass()));
}

// Runs on: the local machine only.
void UClockworksProfileSave::Save() const
{
	UGameplayStatics::SaveGameToSlot(const_cast<UClockworksProfileSave*>(this), SlotName(), 0);
}

// Runs on: the local machine only.
int32 UClockworksProfileSave::AddKnight(const FString& Name)
{
	FClockworksKnightRecord Record;
	Record.Name = Name.IsEmpty() ? TEXT("Knight") : Name;
	Record.Created = FDateTime::Now();

	const int32 Index = Knights.Add(Record);
	LastPlayed = Index;
	Save();

	UE_LOG(LogClockworks, Warning, TEXT("Profile: new knight '%s' (%d in all)"), *Record.Name, Knights.Num());
	return Index;
}

// Runs on: the local machine only.
void UClockworksProfileSave::RemoveKnight(int32 Index)
{
	if (!Knights.IsValidIndex(Index))
	{
		return;
	}

	UE_LOG(LogClockworks, Warning, TEXT("Profile: knight '%s' deleted"), *Knights[Index].Name);
	Knights.RemoveAt(Index);
	LastPlayed = FMath::Clamp(LastPlayed, 0, FMath::Max(0, Knights.Num() - 1));
	Save();
}

FString UClockworksProfileSave::FormatPlayed(double Seconds)
{
	const int32 Whole = FMath::Max(0, FMath::FloorToInt(Seconds));
	return FString::Printf(TEXT("%02d:%02d:%02d"), Whole / 3600, (Whole / 60) % 60, Whole % 60);
}
