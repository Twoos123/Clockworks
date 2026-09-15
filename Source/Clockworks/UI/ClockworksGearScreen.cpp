// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksGearScreen.h"
#include "Clockworks.h"
#include "ClockworksAttributeSet.h"
#include "ClockworksGearDefinition.h"
#include "ClockworksGearStats.h"
#include "ClockworksHUDArt.h"
#include "ClockworksKnightPreview.h"
#include "ClockworksPlayerState.h"
#include "ClockworksWeaponDefinition.h"
#include "World/ClockworksGameState.h"
#include "AssetRegistry/ARFilter.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Border.h"
#include "Components/Button.h"
#include "Components/ButtonSlot.h"
#include "Components/ComboBoxString.h"
#include "Components/EditableTextBox.h"
#include "Components/HorizontalBox.h"
#include "Components/HorizontalBoxSlot.h"
#include "Components/Image.h"
#include "Components/Overlay.h"
#include "Components/OverlaySlot.h"
#include "Components/ProgressBar.h"
#include "Components/ScaleBox.h"
#include "Components/ScrollBox.h"
#include "Components/SizeBox.h"
#include "Components/TextBlock.h"
#include "Components/VerticalBox.h"
#include "Components/VerticalBoxSlot.h"
#include "Engine/Texture2D.h"
#include "Engine/TextureRenderTarget2D.h"
#include "Engine/World.h"
#include "GameFramework/Character.h"
#include "GameFramework/PlayerController.h"
#include "HAL/PlatformTime.h"
#include "Modules/ModuleManager.h"

#define LOCTEXT_NAMESPACE "Clockworks"

namespace
{
	namespace Art = ClockworksHUDArt;

	/** Where the generated weapon catalogue lives. Weapons elsewhere are hand-tuned starters. */
	const TCHAR* CatalogueFolder = TEXT("/Game/TopDown/Gear/Catalogue");

	/** The Arsenal's tabs, in the original's order. */
	enum ECategory : int32 { CatSwords, CatHandguns, CatBombs, CatHelmets, CatArmor, CatShields, CatTrinkets, CatCount };

	/** Status names as gear and weapons name them, in the order the filter menus list them. */
	const TCHAR* StatusNames[] = { TEXT("Fire"), TEXT("Freeze"), TEXT("Shock"), TEXT("Poison"), TEXT("Stun"), TEXT("Curse"), TEXT("Sleep") };

	/** Ink for text on gold and on the pale bonus strips. */
	const FLinearColor Ink(0.04f, 0.06f, 0.10f, 1.f);

	FText ArsenalCategoryName(int32 Category)
	{
		switch (Category)
		{
		case CatSwords:   return LOCTEXT("ArsenalSwords", "Swords");
		case CatHandguns: return LOCTEXT("ArsenalHandguns", "Guns");
		case CatBombs:    return LOCTEXT("ArsenalBombs", "Bombs");
		case CatHelmets:  return LOCTEXT("ArsenalHelmets", "Helmets");
		case CatArmor:    return LOCTEXT("ArsenalArmor", "Armor");
		case CatShields:  return LOCTEXT("ArsenalShields", "Shields");
		default:          return LOCTEXT("ArsenalTrinkets", "Trinkets");
		}
	}

	/** The original's category art for a gear tab; weapons have none. */
	const TCHAR* CategoryArt(int32 Category)
	{
		switch (Category)
		{
		case CatHelmets:  return TEXT("IconInventoryCategoriesIconHelmet");
		case CatArmor:    return TEXT("IconInventoryCategoriesIconArmor");
		case CatShields:  return TEXT("IconInventoryCategoriesIconShield");
		case CatTrinkets: return TEXT("IconInventoryCategoriesIconAmulet");
		default:          return nullptr;
		}
	}

	/** The original's category icon for a Character window gear slot (4 helmet ... 8 trinket), or null for a weapon slot. */
	const TCHAR* SlotIcon(int32 SlotIndex)
	{
		static const int32 GearCategories[] = { CatHelmets, CatArmor, CatShields, CatTrinkets, CatTrinkets };
		const int32 GearIndex = SlotIndex - UClockworksGearScreen::WeaponSlotTotal;
		return GearIndex >= 0 && GearIndex < 5 ? CategoryArt(GearCategories[GearIndex]) : nullptr;
	}

	FText SlotName(int32 SlotIndex)
	{
		switch (SlotIndex - UClockworksGearScreen::WeaponSlotTotal)
		{
		case 0:  return LOCTEXT("SlotHelmet", "Helmet");
		case 1:  return LOCTEXT("SlotArmor", "Armor");
		case 2:  return LOCTEXT("SlotShield", "Shield");
		case 3:
		case 4:  return LOCTEXT("SlotTrinket", "Trinket");
		default: return FText::Format(LOCTEXT("SlotWeapon", "Weapon {0}"), FText::AsNumber(SlotIndex + 1));
		}
	}

	const TCHAR* DefenseIcon(int32 Kind)
	{
		static const TCHAR* Icons[] = { TEXT("StatusImagesDefDef"), TEXT("StatusImagesDefPie"), TEXT("StatusImagesDefEle"), TEXT("StatusImagesDefSha") };
		return Icons[FMath::Clamp(Kind, 0, 3)];
	}

	FText DamageKindName(int32 Kind)
	{
		switch (Kind)
		{
		case 1:  return LOCTEXT("KindPiercing", "Piercing");
		case 2:  return LOCTEXT("KindElemental", "Elemental");
		case 3:  return LOCTEXT("KindShadow", "Shadow");
		default: return LOCTEXT("KindNormal", "Normal");
		}
	}

	/** "VERY_HIGH" -> "Very High". */
	FText NiceLabel(const FString& Label)
	{
		TArray<FString> Words;
		Label.ToLower().ParseIntoArray(Words, TEXT("_"));
		for (FString& Word : Words)
		{
			if (Word.Len() > 0)
			{
				Word[0] = FChar::ToUpper(Word[0]);
			}
		}
		return FText::FromString(FString::Join(Words, TEXT(" ")));
	}

	FText WeaponClassName(bool bAll, EClockworksWeaponClass WeaponClass)
	{
		if (bAll)
		{
			return LOCTEXT("BonusAllWeapons", "Weapon");
		}
		switch (WeaponClass)
		{
		case EClockworksWeaponClass::Handgun: return LOCTEXT("BonusGun", "Gun");
		case EClockworksWeaponClass::Bomb:    return LOCTEXT("BonusBomb", "Bomb");
		default:                              return LOCTEXT("BonusSword", "Sword");
		}
	}

	int32 CategoryOf(const UObject* Item)
	{
		if (const UClockworksWeaponDefinition* Weapon = Cast<UClockworksWeaponDefinition>(Item))
		{
			return FMath::Clamp(static_cast<int32>(Weapon->WeaponClass), 0, 2);
		}
		if (const UClockworksGearDefinition* Gear = Cast<UClockworksGearDefinition>(Item))
		{
			switch (Gear->Slot)
			{
			case EClockworksGearSlot::Helmet: return CatHelmets;
			case EClockworksGearSlot::Armor:  return CatArmor;
			case EClockworksGearSlot::Shield: return CatShields;
			default:                          return CatTrinkets;
			}
		}
		return CatSwords;
	}

	FText NameOf(const UObject* Item)
	{
		if (const UClockworksWeaponDefinition* Weapon = Cast<UClockworksWeaponDefinition>(Item))
		{
			return Weapon->DisplayName.IsEmpty() ? FText::FromString(Weapon->GetName()) : Weapon->DisplayName;
		}
		if (const UClockworksGearDefinition* Gear = Cast<UClockworksGearDefinition>(Item))
		{
			return Gear->DisplayName.IsEmpty() ? FText::FromString(Gear->GetName()) : Gear->DisplayName;
		}
		return FText::GetEmpty();
	}

	UTexture2D* IconOf(const UObject* Item)
	{
		if (const UClockworksWeaponDefinition* Weapon = Cast<UClockworksWeaponDefinition>(Item))
		{
			return Weapon->Icon;
		}
		if (const UClockworksGearDefinition* Gear = Cast<UClockworksGearDefinition>(Item))
		{
			return Gear->Icon;
		}
		return nullptr;
	}

	int32 StarsOf(const UObject* Item)
	{
		if (const UClockworksWeaponDefinition* Weapon = Cast<UClockworksWeaponDefinition>(Item))
		{
			return Weapon->StarRating;
		}
		if (const UClockworksGearDefinition* Gear = Cast<UClockworksGearDefinition>(Item))
		{
			return Gear->StarRating;
		}
		return 0;
	}

	const UObject* UpgradedFrom(const UObject* Item)
	{
		if (const UClockworksWeaponDefinition* Weapon = Cast<UClockworksWeaponDefinition>(Item))
		{
			return Weapon->UpgradesFrom;
		}
		if (const UClockworksGearDefinition* Gear = Cast<UClockworksGearDefinition>(Item))
		{
			return Gear->UpgradesFrom;
		}
		return nullptr;
	}

	/** One bonus as the item card words it, and whether it helps. */
	FText DescribeBonus(const FClockworksGearBonus& Bonus, bool& bOutGood)
	{
		bOutGood = Bonus.Value >= 0.f;
		const FText Level = Bonus.Label.IsEmpty() ? FText::AsPercent(FMath::Abs(Bonus.Value)) : NiceLabel(Bonus.Label);
		const FText Estimated = Bonus.bValueInferred ? LOCTEXT("BonusEstimated", " (estimated)") : FText::GetEmpty();
		const FText Class = WeaponClassName(Bonus.bAllWeaponClasses, Bonus.WeaponClass);

		if (Bonus.Kind == TEXT("RelativeDamageBonus"))
		{
			return FText::Format(LOCTEXT("BonusDamage", "{0} damage bonus: {1}{2}"), Class, Level, Estimated);
		}
		if (Bonus.Kind == TEXT("TaggedDamageBonus"))
		{
			return FText::Format(LOCTEXT("BonusTagged", "Damage bonus vs {0}: {1}"), FText::FromString(Bonus.Tag), Level);
		}
		if (Bonus.Kind == TEXT("ChargeTimeReduction"))
		{
			return FText::Format(LOCTEXT("BonusCharge", "{0} charge time reduction: {1}{2}"), Class, Level, Estimated);
		}
		if (Bonus.Kind == TEXT("AttackSpeedChange"))
		{
			return bOutGood
				? FText::Format(LOCTEXT("BonusAttackSpeedUp", "{0} attack speed increase: {1}"), Class, Level)
				: FText::Format(LOCTEXT("BonusAttackSpeedDown", "{0} attack speed decrease: {1}"), Class, Level);
		}
		if (Bonus.Kind == TEXT("SpeedChange"))
		{
			return bOutGood
				? FText::Format(LOCTEXT("BonusMoveUp", "Movement speed increase: {0}{1}"), Level, Estimated)
				: FText::Format(LOCTEXT("BonusMoveDown", "Movement speed decrease: {0}{1}"), Level, Estimated);
		}
		if (Bonus.Kind == TEXT("HealthBonus"))
		{
			return FText::Format(LOCTEXT("BonusHealth", "Health {0}{1}"), FText::FromString(FString::Printf(TEXT("%+d"), FMath::RoundToInt(Bonus.Value))), Estimated);
		}
		return FText::FromString(Bonus.Kind);
	}
}

// Runs on: the local machine only.
void UClockworksGearChoice::HandleClicked()
{
	if (UClockworksGearScreen* Owner = Screen.Get())
	{
		Owner->HandleChoice(Kind, Index);
	}
}

// Runs on: the local machine only.
void UClockworksGearChoice::HandleHovered()
{
	if (UClockworksGearScreen* Owner = Screen.Get())
	{
		Owner->HandleRowHovered(this);
	}
}

// Runs on: the local machine only.
UClockworksGearScreen::UClockworksGearScreen(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	Title = LOCTEXT("GearScreenTitle", "EQUIPMENT");
	Subtitle = LOCTEXT("GearScreenSubtitle", "Click a slot to open its tab. Hover an item for its card; double-click it to put it on.");
	TitleFontSize = 26;
	bPausesGame = true;
	PanelWidth = 1300.f;
	PanelMaxHeight = 980.f;
}

// Runs on: the local machine. The fixed frame: the Character window column, the Arsenal with its tabs, search, sort,
// filter and star toggles, the list and the action bar, and the back button. Their contents are rebuilt from state.
void UClockworksGearScreen::BuildContents()
{
	// The windows are wider than a small play window. Shrink them to fit rather than letting the panel clip the
	// Arsenal off the right edge; never grow them past their own size.
	UScaleBox* Fit = WidgetTree->ConstructWidget<UScaleBox>(UScaleBox::StaticClass(), TEXT("GearFit"));
	Fit->SetStretch(EStretch::ScaleToFitX);
	Fit->SetStretchDirection(EStretchDirection::DownOnly);
	if (UVerticalBoxSlot* FitSlot = ContentBox->AddChildToVerticalBox(Fit))
	{
		FitSlot->SetHorizontalAlignment(HAlign_Fill);
	}

	UHorizontalBox* Columns = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass(), TEXT("GearColumns"));
	Fit->SetContent(Columns);

	auto AddColumn = [this, Columns](FName Name, float Width)
	{
		USizeBox* Size = WidgetTree->ConstructWidget<USizeBox>(USizeBox::StaticClass());
		Size->SetWidthOverride(Width);
		UVerticalBox* Box = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), Name);
		Size->SetContent(Box);
		if (UHorizontalBoxSlot* ColumnSlot = Columns->AddChildToHorizontalBox(Size))
		{
			ColumnSlot->SetPadding(FMargin(0.f, 0.f, 14.f, 0.f));
			ColumnSlot->SetVerticalAlignment(VAlign_Top);
		}
		return Box;
	};
	CharacterBox = AddColumn(TEXT("CharacterColumn"), CharacterWindowWidth);
	UVerticalBox* ArsenalColumn = AddColumn(TEXT("ArsenalColumn"), ArsenalWidth);

	ArsenalColumn->AddChildToVerticalBox(MakeHeader(LOCTEXT("ArsenalTitle", "Arsenal")));

	ArsenalTabRow = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass(), TEXT("ArsenalTabs"));
	if (UVerticalBoxSlot* TabsSlot = ArsenalColumn->AddChildToVerticalBox(ArsenalTabRow))
	{
		TabsSlot->SetPadding(FMargin(0.f, 6.f, 0.f, 0.f));
	}

	UBorder* Window = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("ArsenalWindow"));
	Window->SetBrush(Art::GearBox(TEXT("WindowSolid"), FMargin(0.3f), Art::Navy));
	Window->SetPadding(FMargin(10.f));
	UVerticalBox* Body = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("ArsenalBody"));
	Window->SetContent(Body);
	ArsenalColumn->AddChildToVerticalBox(Window);

	// Search, sort and filter.
	UHorizontalBox* Tools = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass(), TEXT("ArsenalTools"));
	SearchBox = WidgetTree->ConstructWidget<UEditableTextBox>(UEditableTextBox::StaticClass(), TEXT("ArsenalSearch"));
	SearchBox->SetHintText(LOCTEXT("ArsenalSearchHint", "Search by name"));
	FEditableTextBoxStyle SearchStyle = SearchBox->GetWidgetStyle();
	SearchStyle.BackgroundImageNormal = Art::GearBox(TEXT("WindowSolidRecess"), FMargin(0.3f), Art::NavyDark, 4.f);
	SearchStyle.BackgroundImageHovered = SearchStyle.BackgroundImageNormal;
	SearchStyle.BackgroundImageFocused = SearchStyle.BackgroundImageNormal;
	SearchStyle.Padding = FMargin(8.f, 5.f);
	SearchStyle.TextStyle.Font = Art::Font(13, Art::EHUDTypeface::Bold);
	SearchStyle.ForegroundColor = FSlateColor(Art::TextWhite);
	SearchBox->SetWidgetStyle(SearchStyle);
	SearchBox->OnTextChanged.AddDynamic(this, &UClockworksGearScreen::OnSearchChanged);
	if (UHorizontalBoxSlot* SearchSlot = Tools->AddChildToHorizontalBox(SearchBox))
	{
		SearchSlot->SetSize(FSlateChildSize(ESlateSizeRule::Fill));
		SearchSlot->SetVerticalAlignment(VAlign_Center);
	}

	SortBox = WidgetTree->ConstructWidget<UComboBoxString>(UComboBoxString::StaticClass(), TEXT("ArsenalSort"));
	SortBox->OnSelectionChanged.AddDynamic(this, &UClockworksGearScreen::OnSortChanged);
	if (UHorizontalBoxSlot* SortSlot = Tools->AddChildToHorizontalBox(Art::MakeSized(WidgetTree, SortBox, FVector2D(150.f, 30.f))))
	{
		SortSlot->SetPadding(FMargin(6.f, 0.f, 0.f, 0.f));
		SortSlot->SetVerticalAlignment(VAlign_Center);
	}

	FilterBox = WidgetTree->ConstructWidget<UComboBoxString>(UComboBoxString::StaticClass(), TEXT("ArsenalFilter"));
	FilterBox->OnSelectionChanged.AddDynamic(this, &UClockworksGearScreen::OnFilterChanged);
	if (UHorizontalBoxSlot* FilterSlot = Tools->AddChildToHorizontalBox(Art::MakeSized(WidgetTree, FilterBox, FVector2D(170.f, 30.f))))
	{
		FilterSlot->SetPadding(FMargin(6.f, 0.f, 0.f, 0.f));
		FilterSlot->SetVerticalAlignment(VAlign_Center);
	}
	Body->AddChildToVerticalBox(Tools);

	// Star toggles and the count.
	UHorizontalBox* StarLine = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass(), TEXT("ArsenalStarLine"));
	StarRow = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass(), TEXT("ArsenalStars"));
	StarLine->AddChildToHorizontalBox(StarRow);
	ArsenalCount = Art::MakeText(WidgetTree, FText::GetEmpty(), 11, Art::MutedText, Art::EHUDTypeface::Regular, 0);
	if (UHorizontalBoxSlot* CountSlot = StarLine->AddChildToHorizontalBox(ArsenalCount))
	{
		CountSlot->SetSize(FSlateChildSize(ESlateSizeRule::Fill));
		CountSlot->SetHorizontalAlignment(HAlign_Right);
		CountSlot->SetVerticalAlignment(VAlign_Center);
	}
	if (UVerticalBoxSlot* StarSlot = Body->AddChildToVerticalBox(StarLine))
	{
		StarSlot->SetPadding(FMargin(0.f, 6.f, 0.f, 0.f));
	}

	// The list.
	USizeBox* ScrollSize = WidgetTree->ConstructWidget<USizeBox>(USizeBox::StaticClass(), TEXT("ArsenalScrollSize"));
	ScrollSize->SetHeightOverride(ArsenalHeight);
	ArsenalScroll = WidgetTree->ConstructWidget<UScrollBox>(UScrollBox::StaticClass(), TEXT("ArsenalScroll"));
	ArsenalList = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("ArsenalList"));
	ArsenalScroll->AddChild(ArsenalList);
	ScrollSize->SetContent(ArsenalScroll);
	if (UVerticalBoxSlot* ListSlot = Body->AddChildToVerticalBox(ScrollSize))
	{
		ListSlot->SetPadding(FMargin(0.f, 8.f, 0.f, 0.f));
	}

	// What is selected, and the button that puts it on.
	UBorder* ActionFrame = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("ArsenalActionFrame"));
	ActionFrame->SetBrush(Art::GearBox(TEXT("WindowSolidRecess"), FMargin(0.3f), Art::NavyDark));
	ActionFrame->SetPadding(FMargin(8.f));
	ActionBar = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("ArsenalAction"));
	ActionFrame->SetContent(ActionBar);
	if (UVerticalBoxSlot* ActionSlot = Body->AddChildToVerticalBox(ActionFrame))
	{
		ActionSlot->SetPadding(FMargin(0.f, 8.f, 0.f, 0.f));
	}

	AddSpacer(TEXT("GearFooterSpace"), 10.f);
	if (UButton* Back = AddMenuButton(TEXT("GearBackButton"), LOCTEXT("MenuBack", "Back")))
	{
		Back->OnClicked.AddDynamic(this, &UClockworksGearScreen::OnBackClicked);
	}
}

// Runs on: the local machine. Every weapon and gear asset in the project, found through the asset registry so a new
// one shows up the moment it exists. Built on first open rather than at start-up: it loads every definition.
void UClockworksGearScreen::BuildCatalogue()
{
	Entries.Reset();
	EntryByItem.Reset();

	IAssetRegistry& AssetRegistry = FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry")).Get();
#if WITH_EDITOR
	// In the editor the registry may still be discovering assets when play starts; wait for the gear folders.
	AssetRegistry.ScanPathsSynchronous({ TEXT("/Game/TopDown/Gear") }, /*bForceRescan*/ false);
#endif

	auto Gather = [&AssetRegistry](UClass* Class, TArray<FAssetData>& Out)
	{
		FARFilter Filter;
		Filter.ClassPaths.Add(Class->GetClassPathName());
		Filter.bRecursiveClasses = true;
		Filter.bRecursivePaths = true;
		Filter.PackagePaths.Add(TEXT("/Game"));
		AssetRegistry.GetAssets(Filter, Out);
		// By asset name, so the order does not change between sessions.
		Out.Sort([](const FAssetData& A, const FAssetData& B) { return A.AssetName.LexicalLess(B.AssetName); });
	};

	// Weapons: the generated catalogue first. A hand-tuned starter with a catalogue weapon's name (the Calibur, the
	// Proto Gun) is that weapon, not a second copy of it.
	TArray<FAssetData> WeaponAssets;
	Gather(UClockworksWeaponDefinition::StaticClass(), WeaponAssets);
	TMap<FString, int32> WeaponByName;
	for (const bool bCataloguePass : { true, false })
	{
		for (const FAssetData& Asset : WeaponAssets)
		{
			if (Asset.PackagePath.ToString().StartsWith(CatalogueFolder) != bCataloguePass)
			{
				continue;
			}
			UClockworksWeaponDefinition* Weapon = Cast<UClockworksWeaponDefinition>(Asset.GetAsset());
			if (!Weapon)
			{
				continue;
			}
			const FString Name = NameOf(Weapon).ToString();
			if (!bCataloguePass)
			{
				if (const int32* Twin = WeaponByName.Find(Name))
				{
					EntryByItem.Add(Weapon, *Twin);
					continue;
				}
			}
			FClockworksArsenalEntry Entry;
			Entry.Item = Weapon;
			Entry.Category = CategoryOf(Weapon);
			const int32 Index = Entries.Add(Entry);
			EntryByItem.Add(Weapon, Index);
			WeaponByName.Add(Name, Index);
		}
	}

	TArray<FAssetData> GearAssets;
	Gather(UClockworksGearDefinition::StaticClass(), GearAssets);
	for (const FAssetData& Asset : GearAssets)
	{
		if (UClockworksGearDefinition* Gear = Cast<UClockworksGearDefinition>(Asset.GetAsset()))
		{
			FClockworksArsenalEntry Entry;
			Entry.Item = Gear;
			Entry.Category = CategoryOf(Gear);
			EntryByItem.Add(Gear, Entries.Add(Entry));
		}
	}

	int32 Counts[CatCount] = { 0, 0, 0, 0, 0, 0, 0 };
	for (const FClockworksArsenalEntry& Entry : Entries)
	{
		++Counts[FMath::Clamp(Entry.Category, 0, CatCount - 1)];
	}
	UE_LOG(LogClockworks, Log, TEXT("Arsenal: %d weapon assets and %d gear assets found; swords %d, guns %d, bombs %d, helmets %d, armour %d, shields %d, trinkets %d"),
		WeaponAssets.Num(), GearAssets.Num(), Counts[CatSwords], Counts[CatHandguns], Counts[CatBombs], Counts[CatHelmets], Counts[CatArmor], Counts[CatShields], Counts[CatTrinkets]);
}

// Runs on: the local machine.
int32 UClockworksGearScreen::EntryOf(const UObject* Item) const
{
	const int32* Found = Item ? EntryByItem.Find(Item) : nullptr;
	return Found ? *Found : INDEX_NONE;
}

// Runs on: the local machine. Search is by name and ignores case; the type menu reads damage type and status for
// weapons, and defense type, resistance or any bonus for gear.
bool UClockworksGearScreen::PassesFilters(int32 EntryIndex) const
{
	const UObject* Item = Entries[EntryIndex].Item;
	if ((StarMask & (1 << FMath::Clamp(StarsOf(Item), 0, 5))) == 0)
	{
		return false;
	}
	if (!SearchText.IsEmpty() && !NameOf(Item).ToString().Contains(SearchText))
	{
		return false;
	}
	if (FilterIndex <= 0)
	{
		return true;
	}

	if (const UClockworksWeaponDefinition* Weapon = Cast<UClockworksWeaponDefinition>(Item))
	{
		if (FilterIndex <= 4)
		{
			return static_cast<int32>(ClockworksGearStats::KindOf(Weapon->DamageType)) == FilterIndex - 1;
		}
		const int32 Status = FilterIndex - 5;
		return Status < UE_ARRAY_COUNT(StatusNames) && Weapon->StatusEffect && Weapon->StatusChance > 0.f
			&& ClockworksGearStats::StatusNameOf(Weapon->StatusEffect) == StatusNames[Status];
	}

	if (const UClockworksGearDefinition* Gear = Cast<UClockworksGearDefinition>(Item))
	{
		if (FilterIndex <= 4)
		{
			const TArray<float>* Curves[] = { &Gear->NormalDefense, &Gear->PiercingDefense, &Gear->ElementalDefense, &Gear->ShadowDefense };
			return Curves[FilterIndex - 1]->Num() > 0;
		}
		const int32 Status = FilterIndex - 5;
		if (Status < UE_ARRAY_COUNT(StatusNames))
		{
			for (const FClockworksGearStatusResist& Resist : Gear->StatusResists)
			{
				if (Resist.Status == StatusNames[Status] && Resist.Resist > 0.f)
				{
					return true;
				}
			}
			return false;
		}
		return Gear->Bonuses.Num() > 0;
	}
	return true;
}

// Runs on: the local machine.
float UClockworksGearScreen::SortStat(int32 EntryIndex) const
{
	const UObject* Item = Entries[EntryIndex].Item;
	if (const UClockworksWeaponDefinition* Weapon = Cast<UClockworksWeaponDefinition>(Item))
	{
		return Weapon->DamageMultiplier;
	}
	if (const UClockworksGearDefinition* Gear = Cast<UClockworksGearDefinition>(Item))
	{
		const float Depth = ClockworksGearStats::CurrentOriginalDepth(GetWorld());
		if (Gear->Slot == EClockworksGearSlot::Shield && Gear->ShieldHealth.Num() > 0)
		{
			return UClockworksGearDefinition::ReadCurve(Gear->ShieldHealth, Depth);
		}
		float Defense[4];
		ClockworksGearStats::PieceDefense(*Gear, Depth, Defense);
		return Defense[0] + Defense[1] + Defense[2] + Defense[3];
	}
	return 0.f;
}

// Runs on: the local machine.
AClockworksPlayerState* UClockworksGearScreen::GetKnight() const
{
	const APlayerController* Controller = GetOwningPlayer();
	return Controller ? Controller->GetPlayerState<AClockworksPlayerState>() : nullptr;
}

// Runs on: the local machine. The PlayerState's delegates fire on every machine when the server's result arrives.
void UClockworksGearScreen::BindKnight()
{
	AClockworksPlayerState* Knight = GetKnight();
	if (Knight == BoundKnight.Get())
	{
		return;
	}
	UnbindKnight();
	if (Knight)
	{
		Knight->OnLoadoutChanged.AddUniqueDynamic(this, &UClockworksGearScreen::HandleEquipmentChanged);
		Knight->OnGearChanged.AddUniqueDynamic(this, &UClockworksGearScreen::HandleEquipmentChanged);
		BoundKnight = Knight;
	}
}

// Runs on: the local machine.
void UClockworksGearScreen::UnbindKnight()
{
	if (AClockworksPlayerState* Knight = BoundKnight.Get())
	{
		Knight->OnLoadoutChanged.RemoveDynamic(this, &UClockworksGearScreen::HandleEquipmentChanged);
		Knight->OnGearChanged.RemoveDynamic(this, &UClockworksGearScreen::HandleEquipmentChanged);
	}
	BoundKnight.Reset();
}

// Runs on: the local machine. Redrawn on the next frame: this can arrive in the middle of a button's own click.
void UClockworksGearScreen::HandleEquipmentChanged()
{
	bDirty = true;
	bPreviewDirty = true;
}

// Runs on: the local machine.
UObject* UClockworksGearScreen::ItemInSlot(int32 SlotIndex) const
{
	const AClockworksPlayerState* Knight = GetKnight();
	if (!Knight)
	{
		return nullptr;
	}
	if (SlotIndex < WeaponSlotTotal)
	{
		const TArray<TObjectPtr<UClockworksWeaponDefinition>>& Weapons = Knight->GetWeaponSlots();
		return Weapons.IsValidIndex(SlotIndex) ? Weapons[SlotIndex].Get() : nullptr;
	}
	return Knight->GetGear(static_cast<EClockworksGearSlotIndex>(SlotIndex - WeaponSlotTotal));
}

// Runs on: the local machine.
bool UClockworksGearScreen::IsEquipped(int32 EntryIndex) const
{
	for (int32 SlotIndex = 0; SlotIndex < SlotTotal; ++SlotIndex)
	{
		if (EntryIndex != INDEX_NONE && EntryOf(ItemInSlot(SlotIndex)) == EntryIndex)
		{
			return true;
		}
	}
	return false;
}

// Runs on: the local machine. A slot opens the Arsenal tab its item lives in, with the worn item selected.
void UClockworksGearScreen::SelectSlot(int32 SlotIndex)
{
	SelectedSlot = FMath::Clamp(SlotIndex, 0, SlotTotal - 1);
	if (SelectedSlot < WeaponSlotTotal)
	{
		LastWeaponSlot = SelectedSlot;
	}

	int32 Category = ArsenalTab;
	const int32 Entry = EntryOf(ItemInSlot(SelectedSlot));
	if (Entries.IsValidIndex(Entry))
	{
		Category = Entries[Entry].Category;
		SelectedEntry = Entry;
	}
	else if (SelectedSlot >= WeaponSlotTotal)
	{
		static const int32 GearCategories[] = { CatHelmets, CatArmor, CatShields, CatTrinkets, CatTrinkets };
		Category = GearCategories[SelectedSlot - WeaponSlotTotal];
	}
	else if (Category > CatBombs)
	{
		Category = CatSwords;
	}

	if (Category != ArsenalTab)
	{
		ArsenalTab = Category;
		bFiltersDirty = true;
	}
}

// Runs on: the local machine. Intent only: the server decides whether anything changes.
void UClockworksGearScreen::EquipEntry(int32 EntryIndex)
{
	AClockworksPlayerState* Knight = GetKnight();
	if (!Knight || !Entries.IsValidIndex(EntryIndex))
	{
		return;
	}

	if (UClockworksWeaponDefinition* Weapon = Cast<UClockworksWeaponDefinition>(Entries[EntryIndex].Item))
	{
		TArray<UClockworksWeaponDefinition*> Weapons;
		Weapons.Init(nullptr, WeaponSlotTotal);
		const TArray<TObjectPtr<UClockworksWeaponDefinition>>& Carried = Knight->GetWeaponSlots();
		for (int32 Index = 0; Index < WeaponSlotTotal && Index < Carried.Num(); ++Index)
		{
			Weapons[Index] = Carried[Index];
		}
		const int32 Target = SelectedSlot < WeaponSlotTotal ? SelectedSlot : LastWeaponSlot;
		if (Weapons[Target] && EntryOf(Weapons[Target]) == EntryIndex)
		{
			return;
		}
		// Carrying the same weapon twice is no use: picking one carried elsewhere swaps the two slots.
		for (int32 Other = 0; Other < WeaponSlotTotal; ++Other)
		{
			if (Other != Target && Weapons[Other] && EntryOf(Weapons[Other]) == EntryIndex)
			{
				Weapons[Other] = Weapons[Target];
				break;
			}
		}
		Weapons[Target] = Weapon;
		SendWeapons(Weapons);
		return;
	}

	if (UClockworksGearDefinition* Gear = Cast<UClockworksGearDefinition>(Entries[EntryIndex].Item))
	{
		TArray<UClockworksGearDefinition*> Pieces;
		Pieces.Init(nullptr, static_cast<int32>(EClockworksGearSlotIndex::Count));
		const TArray<TObjectPtr<UClockworksGearDefinition>>& Worn = Knight->GetGearSlots();
		for (int32 Index = 0; Index < Pieces.Num() && Index < Worn.Num(); ++Index)
		{
			Pieces[Index] = Worn[Index];
		}

		const int32 Trinket1 = static_cast<int32>(EClockworksGearSlotIndex::Trinket1);
		const int32 Trinket2 = static_cast<int32>(EClockworksGearSlotIndex::Trinket2);
		int32 Target = Trinket1;
		switch (Gear->Slot)
		{
		case EClockworksGearSlot::Helmet: Target = static_cast<int32>(EClockworksGearSlotIndex::Helmet); break;
		case EClockworksGearSlot::Armor:  Target = static_cast<int32>(EClockworksGearSlotIndex::Armor); break;
		case EClockworksGearSlot::Shield: Target = static_cast<int32>(EClockworksGearSlotIndex::Shield); break;
		default:
			// The selected trinket slot, else the first; a trinket worn in the other slot swaps over.
			Target = (SelectedSlot == WeaponSlotTotal + Trinket2) ? Trinket2 : Trinket1;
			if (Pieces[Target == Trinket1 ? Trinket2 : Trinket1] == Gear)
			{
				Pieces[Target == Trinket1 ? Trinket2 : Trinket1] = Pieces[Target];
			}
			break;
		}
		if (Pieces[Target] == Gear)
		{
			return;
		}
		Pieces[Target] = Gear;
		Knight->RequestSetGear(Pieces);
	}
}

// Runs on: the local machine. Weapons and trinkets come off; a knight always keeps a helmet, armour, shield and one weapon.
void UClockworksGearScreen::UnequipEntry(int32 EntryIndex)
{
	AClockworksPlayerState* Knight = GetKnight();
	if (!Knight || !Entries.IsValidIndex(EntryIndex))
	{
		return;
	}

	if (Cast<UClockworksWeaponDefinition>(Entries[EntryIndex].Item))
	{
		TArray<UClockworksWeaponDefinition*> Weapons;
		for (const TObjectPtr<UClockworksWeaponDefinition>& Carried : Knight->GetWeaponSlots())
		{
			if (Carried && EntryOf(Carried) != EntryIndex)
			{
				Weapons.Add(Carried);
			}
		}
		if (Weapons.Num() > 0)
		{
			SendWeapons(Weapons);
		}
		return;
	}

	const UClockworksGearDefinition* Gear = Cast<UClockworksGearDefinition>(Entries[EntryIndex].Item);
	if (Gear && Gear->Slot == EClockworksGearSlot::Trinket)
	{
		TArray<UClockworksGearDefinition*> Pieces;
		for (const TObjectPtr<UClockworksGearDefinition>& Worn : Knight->GetGearSlots())
		{
			Pieces.Add(Worn == Gear ? nullptr : Worn.Get());
		}
		Knight->RequestSetGear(Pieces);
	}
}

// Runs on: the local machine. The toolbar is packed: an empty slot between two weapons closes up.
void UClockworksGearScreen::SendWeapons(const TArray<UClockworksWeaponDefinition*>& Weapons) const
{
	AClockworksPlayerState* Knight = GetKnight();
	TArray<UClockworksWeaponDefinition*> Packed;
	for (UClockworksWeaponDefinition* Weapon : Weapons)
	{
		if (Weapon)
		{
			Packed.Add(Weapon);
		}
	}
	if (Knight && Packed.Num() > 0)
	{
		Knight->RequestSetLoadout(Packed);
	}
}

// Runs on: the local machine.
void UClockworksGearScreen::SwitchLoadout(int32 LoadoutIndex)
{
	AClockworksPlayerState* Knight = GetKnight();
	if (!Knight || !SavedLoadouts.IsValidIndex(LoadoutIndex) || SavedLoadouts[LoadoutIndex].Weapons.Num() == 0)
	{
		return;
	}
	TArray<UClockworksWeaponDefinition*> Weapons;
	for (const TObjectPtr<UClockworksWeaponDefinition>& Weapon : SavedLoadouts[LoadoutIndex].Weapons)
	{
		Weapons.Add(Weapon);
	}
	TArray<UClockworksGearDefinition*> Pieces;
	for (const TObjectPtr<UClockworksGearDefinition>& Piece : SavedLoadouts[LoadoutIndex].Gear)
	{
		Pieces.Add(Piece);
	}
	SendWeapons(Weapons);
	Knight->RequestSetGear(Pieces);
}

// Runs on: the local machine. Every click only records what it means; the screen redraws on the next frame.
void UClockworksGearScreen::HandleChoice(EClockworksGearChoiceKind Kind, int32 Index)
{
	PlayClick();
	switch (Kind)
	{
	case EClockworksGearChoiceKind::Slot:
		SelectSlot(Index);
		bScrollToSelected = true;
		break;
	case EClockworksGearChoiceKind::Tab:
		SelectedTab = FMath::Clamp(Index, 0, 3);
		break;
	case EClockworksGearChoiceKind::Category:
		if (Index != ArsenalTab)
		{
			ArsenalTab = FMath::Clamp(Index, 0, CatCount - 1);
			bFiltersDirty = true;
			if (ArsenalScroll)
			{
				ArsenalScroll->ScrollToStart();
			}
		}
		break;
	case EClockworksGearChoiceKind::StarFilter:
		StarMask ^= 1 << FMath::Clamp(Index, 0, 5);
		break;
	case EClockworksGearChoiceKind::Item:
	{
		const double Now = FPlatformTime::Seconds();
		if (Index == LastClickEntry && Now - LastClickTime <= DoubleClickSeconds)
		{
			EquipEntry(Index);
			LastClickEntry = INDEX_NONE;
		}
		else
		{
			LastClickEntry = Index;
			LastClickTime = Now;
		}
		SelectedEntry = Index;
		break;
	}
	case EClockworksGearChoiceKind::Equip:
		EquipEntry(Index);
		break;
	case EClockworksGearChoiceKind::Unequip:
		UnequipEntry(Index);
		break;
	case EClockworksGearChoiceKind::Loadout:
		SelectedLoadout = FMath::Clamp(Index, 0, LoadoutTotal - 1);
		SwitchLoadout(SelectedLoadout);
		break;
	case EClockworksGearChoiceKind::SaveLoadout:
		if (const AClockworksPlayerState* Knight = GetKnight())
		{
			FClockworksSavedLoadout& Saved = SavedLoadouts[SelectedLoadout];
			Saved.Weapons.Reset();
			for (const TObjectPtr<UClockworksWeaponDefinition>& Weapon : Knight->GetWeaponSlots())
			{
				if (Weapon)
				{
					Saved.Weapons.Add(Weapon);
				}
			}
			Saved.Gear = Knight->GetGearSlots();
		}
		break;
	}
	bDirty = true;
}

// Runs on: the local machine. The card is built the first time a row is hovered, not for every row up front.
void UClockworksGearScreen::HandleRowHovered(UClockworksGearChoice* Choice)
{
	if (!Choice || Choice->bCardBuilt || !Entries.IsValidIndex(Choice->Index))
	{
		return;
	}
	if (UButton* Row = Choice->Button.Get())
	{
		Row->SetToolTip(MakeCard(Choice->Index));
		Choice->bCardBuilt = true;
	}
}

// Runs on: the local machine.
void UClockworksGearScreen::OnSearchChanged(const FText& Text)
{
	SearchText = Text.ToString().TrimStartAndEnd();
	RebuildArsenal();
}

// Runs on: the local machine.
void UClockworksGearScreen::OnSortChanged(FString Option, ESelectInfo::Type SelectionType)
{
	if (bUpdatingFilters)
	{
		return;
	}
	SortIndex = FMath::Max(SortOptions.IndexOfByKey(Option), 0);
	RebuildArsenal();
}

// Runs on: the local machine.
void UClockworksGearScreen::OnFilterChanged(FString Option, ESelectInfo::Type SelectionType)
{
	if (bUpdatingFilters)
	{
		return;
	}
	FilterIndex = FMath::Max(FilterOptions.IndexOfByKey(Option), 0);
	RebuildArsenal();
}

// Runs on: the local machine.
void UClockworksGearScreen::OpenMenu()
{
	Super::OpenMenu();

	if (!bCatalogueBuilt)
	{
		BuildCatalogue();
		bCatalogueBuilt = true;
		bFiltersDirty = true;
	}
	SavedLoadouts.SetNum(LoadoutTotal);
	BindKnight();
	EnsurePreview();
	if (AClockworksKnightPreview* PreviewActor = Preview.Get())
	{
		PreviewActor->SetFilming(true);
	}
	SelectSlot(SelectedSlot);
	bScrollToSelected = true;
	if (bFiltersDirty)
	{
		bFiltersDirty = false;
		RebuildFilters();
	}
	RebuildAll();
	bPreviewDirty = true;
}

// Runs on: the local machine.
void UClockworksGearScreen::CloseMenu()
{
	if (AClockworksKnightPreview* PreviewActor = Preview.Get())
	{
		PreviewActor->SetFilming(false);
	}
	UnbindKnight();
	bTurnLeft = false;
	bTurnRight = false;
	Super::CloseMenu();
}

// Runs on: the local machine. Widgets tick while the game is paused, so the knight keeps turning.
void UClockworksGearScreen::NativeTick(const FGeometry& MyGeometry, float InDeltaTime)
{
	Super::NativeTick(MyGeometry, InDeltaTime);
	if (!IsMenuOpen())
	{
		return;
	}

	if (bDirty)
	{
		bDirty = false;
		if (bFiltersDirty)
		{
			bFiltersDirty = false;
			RebuildFilters();
		}
		RebuildAll();
	}

	// The selected row's Slate widget exists only after the frame that built it.
	if (UWidget* Row = PendingScrollRow.Get())
	{
		if (ArsenalScroll && Row->GetCachedWidget().IsValid())
		{
			ArsenalScroll->ScrollWidgetIntoView(Row, /*AnimateScroll*/ false, EDescendantScrollDestination::Center);
			PendingScrollRow.Reset();
		}
	}

	AClockworksKnightPreview* PreviewActor = Preview.Get();
	if (PreviewActor && bTurnLeft != bTurnRight)
	{
		PreviewActor->AddTurn((bTurnRight ? 1.f : -1.f) * TurnDegreesPerSecond * InDeltaTime);
	}
	// A frame after the change, so the knight itself has already put the new piece on.
	if (PreviewActor && bPreviewDirty)
	{
		bPreviewDirty = false;
		PreviewActor->CopyLook(Cast<ACharacter>(GetOwningPlayerPawn()));
	}
}

// Runs on: the local machine.
void UClockworksGearScreen::NativeDestruct()
{
	UnbindKnight();
	if (AClockworksKnightPreview* PreviewActor = Preview.Get())
	{
		PreviewActor->Destroy();
	}
	Preview.Reset();
	Super::NativeDestruct();
}

// Runs on: the local machine. The preview is local and unreplicated, far from the level where nothing sees it.
void UClockworksGearScreen::EnsurePreview()
{
	UWorld* World = GetWorld();
	if (Preview.IsValid() || !World)
	{
		return;
	}
	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	Params.ObjectFlags |= RF_Transient;
	Preview = World->SpawnActor<AClockworksKnightPreview>(AClockworksKnightPreview::StaticClass(), FVector(200000.f, 200000.f, -50000.f), FRotator::ZeroRotator, Params);
}

void UClockworksGearScreen::OnTurnLeftPressed()   { bTurnLeft = true; }
void UClockworksGearScreen::OnTurnLeftReleased()  { bTurnLeft = false; }
void UClockworksGearScreen::OnTurnRightPressed()  { bTurnRight = true; }
void UClockworksGearScreen::OnTurnRightReleased() { bTurnRight = false; }

// Runs on: the local machine. Opened from a menu, it goes back to it; opened with L during play, it just closes.
void UClockworksGearScreen::OnBackClicked()
{
	PlayClick();
	CloseMenu();

	if (UClockworksMenuScreen* Return = ReturnMenu.Get())
	{
		Return->SetVisibility(ESlateVisibility::Visible);
		Return->OpenMenu();
	}
}

// ---------------------------------------------------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------------------------------------------------

// Runs on: the local machine.
void UClockworksGearScreen::RebuildAll()
{
	RebuildCharacter();
	RebuildArsenalTabs();
	RebuildArsenal();
	RebuildActionBar();
}

// Runs on: the local machine.
UButton* UClockworksGearScreen::MakeChoiceButton(EClockworksGearChoiceKind Kind, int32 Index, TArray<TObjectPtr<UClockworksGearChoice>>& Owners)
{
	// No name: these are rebuilt, and a rebuilt widget must not collide with one still waiting to be collected.
	UButton* Button = WidgetTree->ConstructWidget<UButton>(UButton::StaticClass());
	UClockworksGearChoice* Choice = NewObject<UClockworksGearChoice>(this);
	Choice->Index = Index;
	Choice->Kind = Kind;
	Choice->Screen = this;
	Choice->Button = Button;
	Owners.Add(Choice);
	Button->OnClicked.AddDynamic(Choice, &UClockworksGearChoice::HandleClicked);
	return Button;
}

// Runs on: the local machine. A button in the original's button art with a text label.
UWidget* UClockworksGearScreen::MakeLabelButton(EClockworksGearChoiceKind Kind, int32 Index, const FText& Label, bool bBlue, TArray<TObjectPtr<UClockworksGearChoice>>& Owners)
{
	UButton* Button = MakeChoiceButton(Kind, Index, Owners);
	StyleArtButton(Button,
		bBlue ? TEXT("ButtonBlueUp") : TEXT("ButtonUp"),
		bBlue ? TEXT("ButtonBlueOver") : TEXT("ButtonOver"),
		bBlue ? TEXT("ButtonBlueDown") : TEXT("ButtonDown"),
		FMargin(0.35f), bBlue ? Art::ButtonBlueHover : Art::ButtonBlue);
	if (UButtonSlot* LabelSlot = Cast<UButtonSlot>(Button->AddChild(Art::MakeText(WidgetTree, Label, 14, Art::TextWhite, Art::EHUDTypeface::Bold, 1))))
	{
		LabelSlot->SetPadding(FMargin(16.f, 5.f));
	}
	return Button;
}

// Runs on: the local machine. The original's button art in three states; flat colours where it is not imported.
void UClockworksGearScreen::StyleArtButton(UButton* Button, const TCHAR* Normal, const TCHAR* Hovered, const TCHAR* Pressed, const FMargin& Margin, const FLinearColor& Fallback) const
{
	if (!Button)
	{
		return;
	}
	FButtonStyle Style = Button->GetStyle();
	Style.Normal = Art::GearBox(Normal, Margin, Fallback, 6.f);
	Style.Hovered = Art::GearBox(Hovered, Margin, Fallback + FLinearColor(0.08f, 0.10f, 0.14f, 0.f), 6.f);
	Style.Pressed = Art::GearBox(Pressed, Margin, Fallback * 0.8f, 6.f);
	Style.Disabled = Style.Normal;
	Style.NormalPadding = FMargin(0.f);
	Style.PressedPadding = FMargin(0.f);
	Button->SetStyle(Style);
}

// Runs on: the local machine. A gold title strip, like the tops of the original's windows.
UWidget* UClockworksGearScreen::MakeHeader(const FText& Text) const
{
	UBorder* Header = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass());
	Header->SetBrush(Art::RoundedBrush(Art::Gold, 4.f));
	Header->SetPadding(FMargin(12.f, 5.f));
	Header->SetContent(Art::MakeText(WidgetTree, Text, 17, Ink, Art::EHUDTypeface::BoldItalic, 0));
	return Header;
}

// Runs on: the local machine.
UWidget* UClockworksGearScreen::MakeStars(int32 Stars, float Size) const
{
	UHorizontalBox* Row = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass());
	for (int32 Index = 0; Index < 5; ++Index)
	{
		const bool bLit = Index < Stars;
		UImage* Star = Art::MakeImage(WidgetTree, Art::GearImage(bLit ? TEXT("WindowGeartipRarityStar") : TEXT("WindowGeartipRarityEmpty"),
			FVector2D(Size), bLit ? Art::Gold : Art::DividerGrey, Size * 0.5f));
		if (UHorizontalBoxSlot* StarSlot = Row->AddChildToHorizontalBox(Star))
		{
			StarSlot->SetPadding(FMargin(0.f, 0.f, 1.f, 0.f));
			StarSlot->SetVerticalAlignment(VAlign_Center);
		}
	}
	return Row;
}

// Runs on: the local machine. A stat bar in the original's tier-bar art: icon, bar, number.
UWidget* UClockworksGearScreen::MakeBar(const TCHAR* IconName, float Fraction, const FText& Value) const
{
	UHorizontalBox* Row = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass());
	if (IconName)
	{
		if (UHorizontalBoxSlot* IconSlot = Row->AddChildToHorizontalBox(Art::MakeImage(WidgetTree, Art::GearImage(IconName, FVector2D(24.f, 26.f), Art::SteelBlue, 12.f))))
		{
			IconSlot->SetVerticalAlignment(VAlign_Center);
			IconSlot->SetPadding(FMargin(0.f, 0.f, 6.f, 0.f));
		}
	}

	UProgressBar* Bar = WidgetTree->ConstructWidget<UProgressBar>(UProgressBar::StaticClass());
	FProgressBarStyle Style = Bar->GetWidgetStyle();
	Style.BackgroundImage = Art::GearBox(TEXT("WindowTooltipPartsTierbarBacking"), FMargin(0.1f, 0.3f), Art::NavyDark, 4.f);
	Style.FillImage = Art::GearBox(TEXT("WindowTooltipPartsTierbarCurrent"), FMargin(0.1f, 0.3f), Art::ShieldBlue, 4.f);
	Bar->SetWidgetStyle(Style);
	Bar->SetFillColorAndOpacity(FLinearColor::White);
	Bar->SetPercent(FMath::Clamp(Fraction, 0.f, 1.f));
	if (UHorizontalBoxSlot* BarSlot = Row->AddChildToHorizontalBox(Art::MakeSized(WidgetTree, Bar, FVector2D(190.f, 24.f))))
	{
		BarSlot->SetVerticalAlignment(VAlign_Center);
	}

	if (UHorizontalBoxSlot* ValueSlot = Row->AddChildToHorizontalBox(Art::MakeText(WidgetTree, Value, 14, Art::TextWhite, Art::EHUDTypeface::Bold, 0)))
	{
		ValueSlot->SetVerticalAlignment(VAlign_Center);
		ValueSlot->SetPadding(FMargin(8.f, 0.f, 0.f, 0.f));
	}
	return Row;
}

// Runs on: the local machine. A bonus or a penalty on the item card, on the original's strips.
UWidget* UClockworksGearScreen::MakeModifierRow(bool bGood, const FText& Text) const
{
	UBorder* Row = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass());
	Row->SetBrush(Art::GearBox(bGood ? TEXT("WindowTooltipPartsBackingBonus") : TEXT("WindowTooltipPartsBackingPenalty"),
		FMargin(0.4f, 0.3f), bGood ? FLinearColor(0.35f, 0.75f, 0.90f, 1.f) : FLinearColor(0.90f, 0.45f, 0.35f, 1.f), 4.f));
	Row->SetPadding(FMargin(4.f, 3.f, 8.f, 3.f));

	UHorizontalBox* Body = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass());
	if (UHorizontalBoxSlot* IconSlot = Body->AddChildToHorizontalBox(Art::MakeImage(WidgetTree,
		Art::GearImage(bGood ? TEXT("WindowTooltipPartsIconBonus") : TEXT("WindowTooltipPartsIconPenalty"), FVector2D(20.f), FLinearColor::Transparent))))
	{
		IconSlot->SetVerticalAlignment(VAlign_Center);
		IconSlot->SetPadding(FMargin(0.f, 0.f, 8.f, 0.f));
	}
	UTextBlock* Label = Art::MakeText(WidgetTree, Text, 12, Ink, Art::EHUDTypeface::Bold, 0);
	Label->SetAutoWrapText(true);
	if (UHorizontalBoxSlot* LabelSlot = Body->AddChildToHorizontalBox(Label))
	{
		LabelSlot->SetVerticalAlignment(VAlign_Center);
		LabelSlot->SetSize(FSlateChildSize(ESlateSizeRule::Fill));
	}
	Row->SetContent(Body);
	return Row;
}

// Runs on: the local machine. One equipment slot: the item's icon, or the slot kind's own icon faded.
UWidget* UClockworksGearScreen::MakeSlotButton(int32 SlotIndex)
{
	const UObject* Item = ItemInSlot(SlotIndex);
	const bool bSelected = SlotIndex == SelectedSlot;

	UButton* Button = MakeChoiceButton(EClockworksGearChoiceKind::Slot, SlotIndex, CharacterChoices);
	StyleArtButton(Button, bSelected ? TEXT("SlotOver") : (Item ? TEXT("SlotOccupied") : TEXT("SlotEmpty")), TEXT("SlotOver"), TEXT("SlotOver"),
		FMargin(0.25f), bSelected ? Art::ButtonBlueHover : Art::ButtonBlue);
	Button->SetToolTipText(Item ? FText::Format(LOCTEXT("SlotTip", "{0}: {1}"), SlotName(SlotIndex), NameOf(Item)) : SlotName(SlotIndex));

	UWidget* Content = nullptr;
	if (UTexture2D* Icon = IconOf(Item))
	{
		UImage* Image = WidgetTree->ConstructWidget<UImage>(UImage::StaticClass());
		Image->SetBrushFromTexture(Icon, /*bMatchSize*/ false);
		Content = Art::MakeSized(WidgetTree, Image, FVector2D(46.f));
	}
	else if (const TCHAR* KindIcon = SlotIcon(SlotIndex))
	{
		UImage* Image = Art::MakeImage(WidgetTree, Art::GearImage(KindIcon, FVector2D(40.f), FLinearColor::Transparent));
		Image->SetColorAndOpacity(FLinearColor(1.f, 1.f, 1.f, 0.35f));
		Content = Image;
	}
	else
	{
		Content = Art::MakeText(WidgetTree, FText::AsNumber(SlotIndex + 1), 16, Art::MutedText, Art::EHUDTypeface::Bold, 0);
	}
	if (UButtonSlot* ContentSlot = Cast<UButtonSlot>(Button->AddChild(Content)))
	{
		ContentSlot->SetPadding(FMargin(5.f));
		ContentSlot->SetHorizontalAlignment(HAlign_Center);
		ContentSlot->SetVerticalAlignment(VAlign_Center);
	}
	return Art::MakeSized(WidgetTree, Button, FVector2D(62.f));
}

// Runs on: the local machine. The stand: the knight picture on the original's backing, the turn arrows, the name plate
// and the star total.
UWidget* UClockworksGearScreen::MakePreview()
{
	UOverlay* Stage = WidgetTree->ConstructWidget<UOverlay>(UOverlay::StaticClass());

	if (UOverlaySlot* BackingSlot = Stage->AddChildToOverlay(Art::MakeImage(WidgetTree, Art::GearBox(TEXT("StatusImagesBackingPreview"), FMargin(0.1f), Art::NavyDark, 6.f))))
	{
		BackingSlot->SetHorizontalAlignment(HAlign_Fill);
		BackingSlot->SetVerticalAlignment(VAlign_Fill);
	}

	const AClockworksKnightPreview* PreviewActor = Preview.Get();
	if (PreviewActor && PreviewActor->GetRenderTarget())
	{
		FSlateBrush Picture;
		Picture.SetResourceObject(PreviewActor->GetRenderTarget());
		Picture.DrawAs = ESlateBrushDrawType::Image;
		Picture.SetImageSize(FVector2D(AClockworksKnightPreview::PictureWidth, AClockworksKnightPreview::PictureHeight));
		if (UOverlaySlot* PictureSlot = Stage->AddChildToOverlay(Art::MakeImage(WidgetTree, Picture)))
		{
			PictureSlot->SetHorizontalAlignment(HAlign_Fill);
			PictureSlot->SetVerticalAlignment(VAlign_Fill);
			PictureSlot->SetPadding(FMargin(12.f));
		}
	}

	auto AddArrow = [this, Stage](bool bLeft)
	{
		UButton* Arrow = WidgetTree->ConstructWidget<UButton>(UButton::StaticClass());
		StyleArtButton(Arrow,
			bLeft ? TEXT("PreviewTurnarrowLeftUp") : TEXT("PreviewTurnarrowRightUp"),
			bLeft ? TEXT("PreviewTurnarrowLeftOver") : TEXT("PreviewTurnarrowRightOver"),
			bLeft ? TEXT("PreviewTurnarrowLeftDown") : TEXT("PreviewTurnarrowRightDown"),
			FMargin(0.f), Art::ButtonBlue);
		Arrow->SetToolTipText(LOCTEXT("TurnKnight", "Hold to turn the knight"));
		if (bLeft)
		{
			Arrow->OnPressed.AddDynamic(this, &UClockworksGearScreen::OnTurnLeftPressed);
			Arrow->OnReleased.AddDynamic(this, &UClockworksGearScreen::OnTurnLeftReleased);
		}
		else
		{
			Arrow->OnPressed.AddDynamic(this, &UClockworksGearScreen::OnTurnRightPressed);
			Arrow->OnReleased.AddDynamic(this, &UClockworksGearScreen::OnTurnRightReleased);
		}
		if (UOverlaySlot* ArrowSlot = Stage->AddChildToOverlay(Art::MakeSized(WidgetTree, Arrow, FVector2D(20.f, 60.f))))
		{
			ArrowSlot->SetHorizontalAlignment(bLeft ? HAlign_Left : HAlign_Right);
			ArrowSlot->SetVerticalAlignment(VAlign_Center);
			ArrowSlot->SetPadding(FMargin(6.f));
		}
	};
	AddArrow(true);
	AddArrow(false);

	// Name plate, top left: just the name (no rank, by decision).
	const AClockworksPlayerState* Knight = GetKnight();
	UOverlay* Plate = WidgetTree->ConstructWidget<UOverlay>(UOverlay::StaticClass());
	Plate->AddChildToOverlay(Art::MakeImage(WidgetTree, Art::GearImage(TEXT("StatusPreviewcornerTl"), FVector2D(226.f, 71.f), FLinearColor::Transparent)));
	if (UOverlaySlot* NameSlot = Plate->AddChildToOverlay(Art::MakeText(WidgetTree, FText::FromString(Knight ? Knight->GetPlayerName() : FString()), 14, Ink, Art::EHUDTypeface::BoldItalic, 0)))
	{
		NameSlot->SetPadding(FMargin(66.f, 6.f, 8.f, 0.f));
	}
	if (UOverlaySlot* PlateSlot = Stage->AddChildToOverlay(Plate))
	{
		PlateSlot->SetHorizontalAlignment(HAlign_Left);
		PlateSlot->SetVerticalAlignment(VAlign_Top);
	}

	// Star total, bottom right.
	int32 StarTotal = 0;
	for (int32 SlotIndex = 0; SlotIndex < SlotTotal; ++SlotIndex)
	{
		StarTotal += StarsOf(ItemInSlot(SlotIndex));
	}
	UOverlay* StarPlate = WidgetTree->ConstructWidget<UOverlay>(UOverlay::StaticClass());
	StarPlate->AddChildToOverlay(Art::MakeImage(WidgetTree, Art::GearImage(TEXT("StatusPreviewcornerLr"), FVector2D(78.f, 82.f), FLinearColor::Transparent)));
	UVerticalBox* StarColumn = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass());
	if (UVerticalBoxSlot* StarSlot = StarColumn->AddChildToVerticalBox(Art::MakeImage(WidgetTree, Art::GearImage(TEXT("WindowGeartipRarityStar"), FVector2D(22.f), Art::Gold, 11.f))))
	{
		StarSlot->SetHorizontalAlignment(HAlign_Center);
	}
	UTextBlock* StarCount = Art::MakeText(WidgetTree, FText::AsNumber(StarTotal), 16, Art::TextWhite, Art::EHUDTypeface::Bold, 1);
	StarCount->SetJustification(ETextJustify::Center);
	StarColumn->AddChildToVerticalBox(StarCount);
	if (UOverlaySlot* ColumnSlot = StarPlate->AddChildToOverlay(StarColumn))
	{
		ColumnSlot->SetHorizontalAlignment(HAlign_Center);
		ColumnSlot->SetVerticalAlignment(VAlign_Center);
		ColumnSlot->SetPadding(FMargin(12.f, 10.f, 0.f, 0.f));
	}
	StarPlate->SetToolTipText(LOCTEXT("StarTotal", "Stars of everything worn and carried"));
	if (UOverlaySlot* StarPlateSlot = Stage->AddChildToOverlay(StarPlate))
	{
		StarPlateSlot->SetHorizontalAlignment(HAlign_Right);
		StarPlateSlot->SetVerticalAlignment(VAlign_Bottom);
	}

	return Art::MakeSized(WidgetTree, Stage, FVector2D(380.f, 470.f));
}

// Runs on: the local machine. The Character window: title, tabs, slots and the knight, stats, loadouts.
void UClockworksGearScreen::RebuildCharacter()
{
	if (!CharacterBox)
	{
		return;
	}
	CharacterBox->ClearChildren();
	CharacterChoices.Reset();

	CharacterBox->AddChildToVerticalBox(MakeHeader(LOCTEXT("CurrentEquipment", "Current Equipment")));

	UHorizontalBox* Tabs = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass());
	const FText TabNames[] = {
		LOCTEXT("TabEquipment", "Equipment"),
		LOCTEXT("TabCostume", "Costume"),
		LOCTEXT("TabSprite", "Battle Sprite"),
		LOCTEXT("TabAchievements", "Achievements"),
	};
	for (int32 TabIndex = 0; TabIndex < UE_ARRAY_COUNT(TabNames); ++TabIndex)
	{
		const bool bActive = TabIndex == SelectedTab;
		UButton* Tab = MakeChoiceButton(EClockworksGearChoiceKind::Tab, TabIndex, CharacterChoices);
		StyleArtButton(Tab, bActive ? TEXT("StatusTabMiddleActive") : TEXT("StatusTabMiddleIdle"), TEXT("StatusTabMiddleActive"), TEXT("StatusTabMiddleActive"),
			FMargin(0.3f), bActive ? Art::ButtonBlueHover : Art::ButtonBlue);
		if (UButtonSlot* LabelSlot = Cast<UButtonSlot>(Tab->AddChild(Art::MakeText(WidgetTree, TabNames[TabIndex], 13, bActive ? Art::TextWhite : Art::MutedText, Art::EHUDTypeface::Bold, 0))))
		{
			LabelSlot->SetPadding(FMargin(14.f, 5.f));
		}
		if (UHorizontalBoxSlot* TabSlot = Tabs->AddChildToHorizontalBox(Tab))
		{
			TabSlot->SetPadding(FMargin(0.f, 0.f, 2.f, 0.f));
		}
	}
	if (UVerticalBoxSlot* TabsSlot = CharacterBox->AddChildToVerticalBox(Tabs))
	{
		TabsSlot->SetPadding(FMargin(0.f, 6.f, 0.f, 0.f));
	}

	UBorder* Window = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass());
	Window->SetBrush(Art::GearBox(TEXT("WindowSolid"), FMargin(0.3f), Art::Navy));
	Window->SetPadding(FMargin(12.f));
	UVerticalBox* WindowBody = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass());
	Window->SetContent(WindowBody);
	CharacterBox->AddChildToVerticalBox(Window);

	const AClockworksPlayerState* Knight = GetKnight();

	if (SelectedTab == 0)
	{
		UHorizontalBox* Row = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass());
		for (const bool bWeapons : { true, false })
		{
			UVerticalBox* Column = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass());
			const int32 First = bWeapons ? 0 : WeaponSlotTotal;
			const int32 Last = bWeapons ? WeaponSlotTotal : SlotTotal;
			for (int32 SlotIndex = First; SlotIndex < Last; ++SlotIndex)
			{
				if (UVerticalBoxSlot* ButtonSlot = Column->AddChildToVerticalBox(MakeSlotButton(SlotIndex)))
				{
					ButtonSlot->SetPadding(FMargin(0.f, 0.f, 0.f, 6.f));
				}
			}
			if (UHorizontalBoxSlot* ColumnSlot = Row->AddChildToHorizontalBox(Column))
			{
				ColumnSlot->SetPadding(FMargin(0.f, 0.f, bWeapons ? 6.f : 14.f, 0.f));
			}
		}
		Row->AddChildToHorizontalBox(MakePreview());
		WindowBody->AddChildToVerticalBox(Row);

		// What the gear adds up to here: health and defense by type, at this depth.
		if (Knight)
		{
			const FClockworksGearTotals Totals = ClockworksGearStats::TotalFor(Knight);
			const UClockworksAttributeSet* Attributes = Knight->GetAttributeSet();
			UHorizontalBox* Stats = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass());
			const FText Health = FText::Format(LOCTEXT("CharacterHealth", "Health {0}"), FText::AsNumber(FMath::RoundToInt(Attributes ? Attributes->GetMaxHealth() : 0.f)));
			if (UHorizontalBoxSlot* HealthSlot = Stats->AddChildToHorizontalBox(Art::MakeText(WidgetTree, Health, 14, Art::TextWhite, Art::EHUDTypeface::Bold, 0)))
			{
				HealthSlot->SetVerticalAlignment(VAlign_Center);
				HealthSlot->SetPadding(FMargin(0.f, 0.f, 18.f, 0.f));
			}
			for (int32 Kind = 0; Kind < 4; ++Kind)
			{
				UImage* KindIcon = Art::MakeImage(WidgetTree, Art::GearImage(DefenseIcon(Kind), FVector2D(22.f, 24.f), Art::SteelBlue, 11.f));
				KindIcon->SetToolTipText(FText::Format(LOCTEXT("DefenseTip", "{0} defense"), DamageKindName(Kind)));
				if (UHorizontalBoxSlot* IconSlot = Stats->AddChildToHorizontalBox(KindIcon))
				{
					IconSlot->SetVerticalAlignment(VAlign_Center);
				}
				if (UHorizontalBoxSlot* NumberSlot = Stats->AddChildToHorizontalBox(Art::MakeText(WidgetTree, FText::AsNumber(FMath::RoundToInt(Totals.Defense[Kind])), 14, Art::TextWhite, Art::EHUDTypeface::Bold, 0)))
				{
					NumberSlot->SetVerticalAlignment(VAlign_Center);
					NumberSlot->SetPadding(FMargin(4.f, 0.f, 14.f, 0.f));
				}
			}
			if (UVerticalBoxSlot* StatsSlot = WindowBody->AddChildToVerticalBox(Stats))
			{
				StatsSlot->SetPadding(FMargin(0.f, 10.f, 0.f, 0.f));
			}
		}
	}
	else
	{
		// Pictures of what is to come (by decision): the tab's own icon and a line saying so.
		const TCHAR* Icon = SelectedTab == 1 ? TEXT("IconInventoryCategoriesIconCostume")
			: SelectedTab == 2 ? TEXT("IconInventoryCategoriesIconBattlesprite") : TEXT("IconInventoryIconLocked");
		const FText Line = SelectedTab == 1 ? LOCTEXT("TabCostumeLater", "Costumes come after gear.")
			: SelectedTab == 2 ? LOCTEXT("TabSpriteLater", "Battle sprites are not in the demo yet.") : LOCTEXT("TabAchievementsLater", "Achievements are not in the demo yet.");
		UImage* Picture = Art::MakeImage(WidgetTree, Art::GearImage(Icon, FVector2D(180.f), FLinearColor::Transparent));
		Picture->SetColorAndOpacity(FLinearColor(1.f, 1.f, 1.f, 0.5f));
		if (UVerticalBoxSlot* PictureSlot = WindowBody->AddChildToVerticalBox(Picture))
		{
			PictureSlot->SetHorizontalAlignment(HAlign_Center);
			PictureSlot->SetPadding(FMargin(0.f, 60.f, 0.f, 12.f));
		}
		UTextBlock* Caption = Art::MakeText(WidgetTree, Line, 15, Art::MutedText, Art::EHUDTypeface::Bold, 0);
		if (UVerticalBoxSlot* CaptionSlot = WindowBody->AddChildToVerticalBox(Caption))
		{
			CaptionSlot->SetHorizontalAlignment(HAlign_Center);
			CaptionSlot->SetPadding(FMargin(0.f, 0.f, 0.f, 150.f));
		}
	}

	// Loadouts: save everything worn and carried under a number, and switch back to it with one click.
	UHorizontalBox* Loadouts = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass());
	if (UHorizontalBoxSlot* LabelSlot = Loadouts->AddChildToHorizontalBox(Art::MakeText(WidgetTree, LOCTEXT("LoadoutsLabel", "Loadouts"), 13, Art::MutedText, Art::EHUDTypeface::Bold, 0)))
	{
		LabelSlot->SetVerticalAlignment(VAlign_Center);
		LabelSlot->SetPadding(FMargin(0.f, 0.f, 10.f, 0.f));
	}
	for (int32 LoadoutIndex = 0; LoadoutIndex < LoadoutTotal; ++LoadoutIndex)
	{
		const bool bSaved = SavedLoadouts.IsValidIndex(LoadoutIndex) && SavedLoadouts[LoadoutIndex].Weapons.Num() > 0;
		const bool bSelected = LoadoutIndex == SelectedLoadout;
		UButton* Pick = MakeChoiceButton(EClockworksGearChoiceKind::Loadout, LoadoutIndex, CharacterChoices);
		StyleArtButton(Pick, bSelected ? TEXT("ButtonSelected") : TEXT("ButtonUp"), TEXT("ButtonOver"), TEXT("ButtonDown"), FMargin(0.35f),
			bSelected ? Art::ButtonBlueHover : Art::ButtonBlue);
		Pick->SetToolTipText(bSaved ? FText::Format(LOCTEXT("LoadoutSwitch", "Switch to loadout {0}"), FText::AsNumber(LoadoutIndex + 1))
			: LOCTEXT("LoadoutEmpty", "Empty: pick it, then Save Loadout"));
		if (UButtonSlot* NumberSlot = Cast<UButtonSlot>(Pick->AddChild(Art::MakeText(WidgetTree, FText::AsNumber(LoadoutIndex + 1), 14,
			bSaved ? Art::TextWhite : Art::MutedText, Art::EHUDTypeface::Bold, 0))))
		{
			NumberSlot->SetPadding(FMargin(11.f, 4.f));
		}
		if (UHorizontalBoxSlot* PickSlot = Loadouts->AddChildToHorizontalBox(Pick))
		{
			PickSlot->SetPadding(FMargin(0.f, 0.f, 4.f, 0.f));
		}
	}
	if (UHorizontalBoxSlot* SaveSlot = Loadouts->AddChildToHorizontalBox(
		MakeLabelButton(EClockworksGearChoiceKind::SaveLoadout, SelectedLoadout, LOCTEXT("SaveLoadout", "Save Loadout"), true, CharacterChoices)))
	{
		SaveSlot->SetPadding(FMargin(10.f, 0.f, 0.f, 0.f));
	}
	if (UVerticalBoxSlot* LoadoutsSlot = WindowBody->AddChildToVerticalBox(Loadouts))
	{
		LoadoutsSlot->SetPadding(FMargin(0.f, 12.f, 0.f, 0.f));
	}
	if (UVerticalBoxSlot* HintSlot = WindowBody->AddChildToVerticalBox(Art::MakeText(WidgetTree,
		LOCTEXT("LoadoutsHint", "Saved loadouts are kept until you quit the game."), 11, Art::MutedText, Art::EHUDTypeface::Regular, 0)))
	{
		HintSlot->SetPadding(FMargin(0.f, 4.f, 0.f, 0.f));
	}
}

// Runs on: the local machine. The Arsenal's category tabs and its star toggles.
void UClockworksGearScreen::RebuildArsenalTabs()
{
	if (ArsenalTabRow)
	{
		ArsenalTabRow->ClearChildren();
		TabChoices.Reset();
		for (int32 Category = 0; Category < CatCount; ++Category)
		{
			const bool bActive = Category == ArsenalTab;
			UButton* Tab = MakeChoiceButton(EClockworksGearChoiceKind::Category, Category, TabChoices);
			StyleArtButton(Tab, bActive ? TEXT("StatusTabMiddleActive") : TEXT("StatusTabMiddleIdle"), TEXT("StatusTabMiddleActive"), TEXT("StatusTabMiddleActive"),
				FMargin(0.3f), bActive ? Art::ButtonBlueHover : Art::ButtonBlue);

			UVerticalBox* Body = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass());
			// The original's category art for gear; weapons have none, so their tab shows the class's first weapon.
			UWidget* Icon = nullptr;
			if (const TCHAR* CategoryIcon = CategoryArt(Category))
			{
				Icon = Art::MakeImage(WidgetTree, Art::GearImage(CategoryIcon, FVector2D(30.f), FLinearColor::Transparent));
			}
			else
			{
				const UObject* First = nullptr;
				for (const FClockworksArsenalEntry& Entry : Entries)
				{
					if (Entry.Category == Category && IconOf(Entry.Item) && (!First || StarsOf(Entry.Item) < StarsOf(First)))
					{
						First = Entry.Item;
					}
				}
				if (First)
				{
					UImage* Image = WidgetTree->ConstructWidget<UImage>(UImage::StaticClass());
					Image->SetBrushFromTexture(IconOf(First), /*bMatchSize*/ false);
					Icon = Art::MakeSized(WidgetTree, Image, FVector2D(30.f));
				}
			}
			if (Icon)
			{
				if (UVerticalBoxSlot* IconSlot = Body->AddChildToVerticalBox(Icon))
				{
					IconSlot->SetHorizontalAlignment(HAlign_Center);
				}
			}
			UTextBlock* Label = Art::MakeText(WidgetTree, ArsenalCategoryName(Category), 11, bActive ? Art::TextWhite : Art::MutedText, Art::EHUDTypeface::Bold, 0);
			Label->SetJustification(ETextJustify::Center);
			if (UVerticalBoxSlot* LabelSlot = Body->AddChildToVerticalBox(Label))
			{
				LabelSlot->SetHorizontalAlignment(HAlign_Center);
			}
			if (UButtonSlot* BodySlot = Cast<UButtonSlot>(Tab->AddChild(Body)))
			{
				BodySlot->SetPadding(FMargin(4.f, 4.f));
			}
			if (UHorizontalBoxSlot* TabSlot = ArsenalTabRow->AddChildToHorizontalBox(Tab))
			{
				TabSlot->SetSize(FSlateChildSize(ESlateSizeRule::Fill));
				TabSlot->SetPadding(FMargin(0.f, 0.f, 2.f, 0.f));
			}
		}
	}

	if (StarRow)
	{
		StarRow->ClearChildren();
		if (UHorizontalBoxSlot* LabelSlot = StarRow->AddChildToHorizontalBox(Art::MakeText(WidgetTree, LOCTEXT("ArsenalStarsLabel", "Stars"), 12, Art::MutedText, Art::EHUDTypeface::Bold, 0)))
		{
			LabelSlot->SetVerticalAlignment(VAlign_Center);
			LabelSlot->SetPadding(FMargin(0.f, 0.f, 8.f, 0.f));
		}
		for (int32 Stars = 0; Stars <= 5; ++Stars)
		{
			const bool bOn = (StarMask & (1 << Stars)) != 0;
			UButton* Toggle = MakeChoiceButton(EClockworksGearChoiceKind::StarFilter, Stars, TabChoices);
			StyleArtButton(Toggle, bOn ? TEXT("ButtonSelected") : TEXT("ButtonUp"), TEXT("ButtonOver"), TEXT("ButtonDown"), FMargin(0.35f),
				bOn ? Art::ButtonBlueHover : Art::ButtonBlue);
			Toggle->SetToolTipText(FText::Format(LOCTEXT("StarToggleTip", "Show or hide {0}-star items"), FText::AsNumber(Stars)));
			UHorizontalBox* Content = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass());
			if (UHorizontalBoxSlot* NumberSlot = Content->AddChildToHorizontalBox(Art::MakeText(WidgetTree, FText::AsNumber(Stars), 12, bOn ? Art::TextWhite : Art::MutedText, Art::EHUDTypeface::Bold, 0)))
			{
				NumberSlot->SetVerticalAlignment(VAlign_Center);
				NumberSlot->SetPadding(FMargin(0.f, 0.f, 2.f, 0.f));
			}
			if (UHorizontalBoxSlot* StarSlot = Content->AddChildToHorizontalBox(Art::MakeImage(WidgetTree, Art::GearImage(TEXT("WindowGeartipRarityStar"), FVector2D(12.f), Art::Gold, 6.f))))
			{
				StarSlot->SetVerticalAlignment(VAlign_Center);
			}
			if (UButtonSlot* ContentSlot = Cast<UButtonSlot>(Toggle->AddChild(Content)))
			{
				ContentSlot->SetPadding(FMargin(7.f, 3.f));
			}
			if (UHorizontalBoxSlot* ToggleSlot = StarRow->AddChildToHorizontalBox(Toggle))
			{
				ToggleSlot->SetPadding(FMargin(0.f, 0.f, 3.f, 0.f));
			}
		}
	}
}

// Runs on: the local machine. The sort and filter menus hold different options for weapons and for gear.
void UClockworksGearScreen::RebuildFilters()
{
	const bool bWeapons = ArsenalTab <= CatBombs;
	SortOptions.Reset();
	SortOptions.Add(TEXT("Sort: stars"));
	SortOptions.Add(TEXT("Sort: name"));
	SortOptions.Add(bWeapons ? TEXT("Sort: damage") : (ArsenalTab == CatShields ? TEXT("Sort: shield health") : TEXT("Sort: defense")));

	FilterOptions.Reset();
	FilterOptions.Add(bWeapons ? TEXT("Any damage type") : TEXT("Any"));
	for (int32 Kind = 0; Kind < 4; ++Kind)
	{
		FilterOptions.Add(DamageKindName(Kind).ToString() + (bWeapons ? TEXT(" damage") : TEXT(" defense")));
	}
	for (const TCHAR* Status : StatusNames)
	{
		FilterOptions.Add(FString(bWeapons ? TEXT("Inflicts ") : TEXT("Resists ")) + Status);
	}
	if (!bWeapons)
	{
		FilterOptions.Add(TEXT("Has a bonus"));
	}

	SortIndex = FMath::Clamp(SortIndex, 0, SortOptions.Num() - 1);
	FilterIndex = 0;

	// Filling the menus fires their change events; those must not rebuild the list half way through.
	bUpdatingFilters = true;
	if (SortBox)
	{
		SortBox->ClearOptions();
		for (const FString& Option : SortOptions)
		{
			SortBox->AddOption(Option);
		}
		SortBox->SetSelectedOption(SortOptions[SortIndex]);
	}
	if (FilterBox)
	{
		FilterBox->ClearOptions();
		for (const FString& Option : FilterOptions)
		{
			FilterBox->AddOption(Option);
		}
		FilterBox->SetSelectedOption(FilterOptions[0]);
	}
	bUpdatingFilters = false;
}

// Runs on: the local machine. A compact line under a row's name: damage type and status for a weapon, the defenses
// (and a shield's health) for gear, at this depth.
UWidget* UClockworksGearScreen::MakeRowStats(int32 EntryIndex) const
{
	UHorizontalBox* Stats = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass());
	const UObject* Item = Entries[EntryIndex].Item;

	if (const UClockworksWeaponDefinition* Weapon = Cast<UClockworksWeaponDefinition>(Item))
	{
		FText Line = DamageKindName(static_cast<int32>(ClockworksGearStats::KindOf(Weapon->DamageType)));
		if (Weapon->StatusEffect && Weapon->StatusChance > 0.f)
		{
			const FString Status = ClockworksGearStats::StatusNameOf(Weapon->StatusEffect);
			if (!Status.IsEmpty())
			{
				Line = FText::Format(LOCTEXT("RowWeaponStatus", "{0}  ·  {1}"), Line, FText::FromString(Status));
			}
		}
		Stats->AddChildToHorizontalBox(Art::MakeText(WidgetTree, Line, 10, Art::MutedText, Art::EHUDTypeface::Bold, 0));
		return Stats;
	}

	if (const UClockworksGearDefinition* Gear = Cast<UClockworksGearDefinition>(Item))
	{
		const float Depth = ClockworksGearStats::CurrentOriginalDepth(GetWorld());
		if (Gear->Slot == EClockworksGearSlot::Shield && Gear->ShieldHealth.Num() > 0)
		{
			const FText Health = FText::Format(LOCTEXT("RowShieldHealth", "Shield {0}"), FText::AsNumber(FMath::RoundToInt(UClockworksGearDefinition::ReadCurve(Gear->ShieldHealth, Depth))));
			if (UHorizontalBoxSlot* HealthSlot = Stats->AddChildToHorizontalBox(Art::MakeText(WidgetTree, Health, 10, Art::MutedText, Art::EHUDTypeface::Bold, 0)))
			{
				HealthSlot->SetVerticalAlignment(VAlign_Center);
				HealthSlot->SetPadding(FMargin(0.f, 0.f, 8.f, 0.f));
			}
		}
		float Defense[4];
		ClockworksGearStats::PieceDefense(*Gear, Depth, Defense);
		for (int32 Kind = 0; Kind < 4; ++Kind)
		{
			if (Defense[Kind] <= 0.f)
			{
				continue;
			}
			if (UHorizontalBoxSlot* IconSlot = Stats->AddChildToHorizontalBox(Art::MakeImage(WidgetTree, Art::GearImage(DefenseIcon(Kind), FVector2D(13.f, 14.f), Art::SteelBlue, 6.f))))
			{
				IconSlot->SetVerticalAlignment(VAlign_Center);
			}
			if (UHorizontalBoxSlot* NumberSlot = Stats->AddChildToHorizontalBox(Art::MakeText(WidgetTree, FText::AsNumber(FMath::RoundToInt(Defense[Kind])), 10, Art::MutedText, Art::EHUDTypeface::Bold, 0)))
			{
				NumberSlot->SetVerticalAlignment(VAlign_Center);
				NumberSlot->SetPadding(FMargin(2.f, 0.f, 7.f, 0.f));
			}
		}
	}
	return Stats;
}

// Runs on: the local machine. One Arsenal row: the icon in the pill's circle, the name, stars and a stat line. Gold
// when worn, lighter when selected.
UWidget* UClockworksGearScreen::MakeItemRow(int32 EntryIndex)
{
	const UObject* Item = Entries[EntryIndex].Item;
	const bool bEquipped = IsEquipped(EntryIndex);
	const bool bSelected = EntryIndex == SelectedEntry;

	UButton* Row = MakeChoiceButton(EClockworksGearChoiceKind::Item, EntryIndex, ArsenalChoices);
	Row->OnHovered.AddDynamic(ArsenalChoices.Last().Get(), &UClockworksGearChoice::HandleHovered);
	StyleArtButton(Row,
		bEquipped ? TEXT("RecipesPartsPillRecipeSelected") : (bSelected ? TEXT("RecipesPartsPillRecipeNormalHover") : TEXT("RecipesPartsPillRecipeNormal")),
		bEquipped ? TEXT("RecipesPartsPillRecipeSelectedHover") : TEXT("RecipesPartsPillRecipeNormalHover"),
		bEquipped ? TEXT("RecipesPartsPillRecipeSelectedHover") : TEXT("RecipesPartsPillRecipeNormalHover"),
		FMargin(0.27f, 0.45f, 0.14f, 0.45f), bEquipped ? Art::Gold * 0.8f : (bSelected ? Art::ButtonBlueHover : Art::ButtonBlue));

	UHorizontalBox* Body = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass());
	UImage* Icon = WidgetTree->ConstructWidget<UImage>(UImage::StaticClass());
	if (UTexture2D* IconTexture = IconOf(Item))
	{
		Icon->SetBrushFromTexture(IconTexture, /*bMatchSize*/ false);
	}
	else
	{
		Icon->SetColorAndOpacity(FLinearColor::Transparent);
	}
	if (UHorizontalBoxSlot* IconSlot = Body->AddChildToHorizontalBox(Art::MakeSized(WidgetTree, Icon, FVector2D(34.f))))
	{
		IconSlot->SetVerticalAlignment(VAlign_Center);
		IconSlot->SetPadding(FMargin(0.f, 0.f, 14.f, 0.f));
	}

	UVerticalBox* Words = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass());
	Words->AddChildToVerticalBox(Art::MakeText(WidgetTree, NameOf(Item), 13, bEquipped ? Ink : Art::TextWhite, Art::EHUDTypeface::Bold, 0));
	UHorizontalBox* Under = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass());
	if (UHorizontalBoxSlot* StarsSlot = Under->AddChildToHorizontalBox(MakeStars(StarsOf(Item), 10.f)))
	{
		StarsSlot->SetVerticalAlignment(VAlign_Center);
		StarsSlot->SetPadding(FMargin(0.f, 0.f, 10.f, 0.f));
	}
	if (UHorizontalBoxSlot* StatsSlot = Under->AddChildToHorizontalBox(MakeRowStats(EntryIndex)))
	{
		StatsSlot->SetVerticalAlignment(VAlign_Center);
	}
	Words->AddChildToVerticalBox(Under);
	if (UHorizontalBoxSlot* WordsSlot = Body->AddChildToHorizontalBox(Words))
	{
		WordsSlot->SetVerticalAlignment(VAlign_Center);
		WordsSlot->SetSize(FSlateChildSize(ESlateSizeRule::Fill));
	}

	if (bEquipped)
	{
		if (UHorizontalBoxSlot* WornSlot = Body->AddChildToHorizontalBox(Art::MakeText(WidgetTree, LOCTEXT("RowWorn", "WORN"), 11, Ink, Art::EHUDTypeface::BoldItalic, 0)))
		{
			WornSlot->SetVerticalAlignment(VAlign_Center);
			WornSlot->SetPadding(FMargin(6.f, 0.f, 4.f, 0.f));
		}
	}

	if (UButtonSlot* BodySlot = Cast<UButtonSlot>(Row->AddChild(Body)))
	{
		BodySlot->SetPadding(FMargin(4.f, 3.f, 8.f, 3.f));
		BodySlot->SetHorizontalAlignment(HAlign_Fill);
		BodySlot->SetVerticalAlignment(VAlign_Center);
	}

	USizeBox* Size = WidgetTree->ConstructWidget<USizeBox>(USizeBox::StaticClass());
	Size->SetHeightOverride(46.f);
	Size->SetContent(Row);
	return Size;
}

// Runs on: the local machine. The open tab's items that pass the filters, sorted, under star headings when sorted by
// stars. Rebuilt on every change; only one tab is ever built.
void UClockworksGearScreen::RebuildArsenal()
{
	if (!ArsenalList)
	{
		return;
	}
	const float Offset = ArsenalScroll ? ArsenalScroll->GetScrollOffset() : 0.f;
	ArsenalList->ClearChildren();
	ArsenalChoices.Reset();

	TArray<int32> Shown;
	int32 InTab = 0;
	for (int32 Index = 0; Index < Entries.Num(); ++Index)
	{
		if (Entries[Index].Category != ArsenalTab)
		{
			continue;
		}
		++InTab;
		if (PassesFilters(Index))
		{
			Shown.Add(Index);
		}
	}

	TMap<int32, float> Stat;
	if (SortIndex == 2)
	{
		for (int32 Index : Shown)
		{
			Stat.Add(Index, SortStat(Index));
		}
	}
	Shown.Sort([this, &Stat](int32 A, int32 B)
	{
		const FText NameA = NameOf(Entries[A].Item);
		const FText NameB = NameOf(Entries[B].Item);
		if (SortIndex == 0)
		{
			const int32 StarsA = StarsOf(Entries[A].Item);
			const int32 StarsB = StarsOf(Entries[B].Item);
			if (StarsA != StarsB)
			{
				return StarsA > StarsB;
			}
		}
		else if (SortIndex == 2)
		{
			const float StatA = Stat.FindRef(A);
			const float StatB = Stat.FindRef(B);
			if (!FMath::IsNearlyEqual(StatA, StatB))
			{
				return StatA > StatB;
			}
		}
		return NameA.CompareTo(NameB) < 0;
	});

	if (ArsenalCount)
	{
		ArsenalCount->SetText(FText::Format(LOCTEXT("ArsenalShown", "{0} of {1} {2}"), FText::AsNumber(Shown.Num()), FText::AsNumber(InTab),
			ArsenalCategoryName(ArsenalTab)));
	}

	TMap<int32, int32> PerStar;
	for (int32 Index : Shown)
	{
		++PerStar.FindOrAdd(StarsOf(Entries[Index].Item));
	}

	int32 LastStars = INDEX_NONE;
	for (int32 Index : Shown)
	{
		const int32 Stars = StarsOf(Entries[Index].Item);
		if (SortIndex == 0 && Stars != LastStars)
		{
			LastStars = Stars;
			UHorizontalBox* Heading = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass());
			if (UHorizontalBoxSlot* StarsSlot = Heading->AddChildToHorizontalBox(MakeStars(Stars, 14.f)))
			{
				StarsSlot->SetVerticalAlignment(VAlign_Center);
			}
			if (UHorizontalBoxSlot* CountSlot = Heading->AddChildToHorizontalBox(Art::MakeText(WidgetTree,
				FText::Format(LOCTEXT("ArsenalStarHeading", "{0} {0}|plural(one=star,other=stars)  ({1})"), FText::AsNumber(Stars), FText::AsNumber(PerStar.FindRef(Stars))),
				12, Art::Gold, Art::EHUDTypeface::Bold, 0)))
			{
				CountSlot->SetVerticalAlignment(VAlign_Center);
				CountSlot->SetPadding(FMargin(8.f, 0.f, 0.f, 0.f));
			}
			if (UVerticalBoxSlot* HeadingSlot = ArsenalList->AddChildToVerticalBox(Heading))
			{
				HeadingSlot->SetPadding(FMargin(2.f, LastStars == Stars && ArsenalList->GetChildrenCount() > 1 ? 10.f : 2.f, 0.f, 4.f));
			}
		}

		UWidget* Row = MakeItemRow(Index);
		if (UVerticalBoxSlot* RowSlot = ArsenalList->AddChildToVerticalBox(Row))
		{
			RowSlot->SetPadding(FMargin(0.f, 0.f, 0.f, 3.f));
		}
		if (bScrollToSelected && Index == SelectedEntry)
		{
			PendingScrollRow = Row;
		}
	}

	if (Shown.Num() == 0)
	{
		UTextBlock* Nothing = Art::MakeText(WidgetTree, InTab == 0
			? LOCTEXT("ArsenalEmptyTab", "Nothing of this kind was found in the project.")
			: LOCTEXT("ArsenalNoMatch", "Nothing matches. Clear the search, or turn more stars or types back on."), 13, Art::MutedText, Art::EHUDTypeface::Regular, 0);
		Nothing->SetAutoWrapText(true);
		if (UVerticalBoxSlot* NothingSlot = ArsenalList->AddChildToVerticalBox(Nothing))
		{
			NothingSlot->SetPadding(FMargin(4.f, 12.f));
		}
	}

	bScrollToSelected = false;
	if (ArsenalScroll && !PendingScrollRow.IsValid())
	{
		ArsenalScroll->SetScrollOffset(Offset);
	}
}

// Runs on: the local machine. Under the list: what is selected, and Equip or Take off.
void UClockworksGearScreen::RebuildActionBar()
{
	if (!ActionBar)
	{
		return;
	}
	ActionBar->ClearChildren();
	ActionChoices.Reset();

	if (!Entries.IsValidIndex(SelectedEntry) || !Entries[SelectedEntry].Item)
	{
		UTextBlock* Hint = Art::MakeText(WidgetTree, LOCTEXT("ActionHint", "Hover an item for its card. Click to select it; double-click, or Equip, puts it on."),
			12, Art::MutedText, Art::EHUDTypeface::Regular, 0);
		Hint->SetAutoWrapText(true);
		ActionBar->AddChildToVerticalBox(Hint);
		return;
	}

	const UObject* Item = Entries[SelectedEntry].Item;
	const bool bEquipped = IsEquipped(SelectedEntry);

	UHorizontalBox* Row = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass());
	UImage* Icon = WidgetTree->ConstructWidget<UImage>(UImage::StaticClass());
	if (UTexture2D* IconTexture = IconOf(Item))
	{
		Icon->SetBrushFromTexture(IconTexture, /*bMatchSize*/ false);
	}
	if (UHorizontalBoxSlot* IconSlot = Row->AddChildToHorizontalBox(Art::MakeSized(WidgetTree, Icon, FVector2D(42.f))))
	{
		IconSlot->SetVerticalAlignment(VAlign_Center);
		IconSlot->SetPadding(FMargin(0.f, 0.f, 10.f, 0.f));
	}
	UVerticalBox* Words = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass());
	Words->AddChildToVerticalBox(Art::MakeText(WidgetTree, NameOf(Item), 15, Art::TextWhite, Art::EHUDTypeface::BoldItalic, 0));
	Words->AddChildToVerticalBox(MakeStars(StarsOf(Item), 12.f));
	if (UHorizontalBoxSlot* WordsSlot = Row->AddChildToHorizontalBox(Words))
	{
		WordsSlot->SetVerticalAlignment(VAlign_Center);
		WordsSlot->SetSize(FSlateChildSize(ESlateSizeRule::Fill));
	}

	const UClockworksGearDefinition* Gear = Cast<UClockworksGearDefinition>(Item);
	const bool bRemovable = Cast<UClockworksWeaponDefinition>(Item) || (Gear && Gear->Slot == EClockworksGearSlot::Trinket);
	if (!bEquipped)
	{
		if (UHorizontalBoxSlot* EquipSlot = Row->AddChildToHorizontalBox(MakeLabelButton(EClockworksGearChoiceKind::Equip, SelectedEntry, LOCTEXT("ActionEquip", "Equip"), true, ActionChoices)))
		{
			EquipSlot->SetVerticalAlignment(VAlign_Center);
		}
	}
	else
	{
		if (UHorizontalBoxSlot* WornSlot = Row->AddChildToHorizontalBox(Art::MakeText(WidgetTree, LOCTEXT("ActionWorn", "Worn"), 14, Art::Gold, Art::EHUDTypeface::BoldItalic, 0)))
		{
			WornSlot->SetVerticalAlignment(VAlign_Center);
			WornSlot->SetPadding(FMargin(0.f, 0.f, 10.f, 0.f));
		}
		if (bRemovable)
		{
			if (UHorizontalBoxSlot* OffSlot = Row->AddChildToHorizontalBox(MakeLabelButton(EClockworksGearChoiceKind::Unequip, SelectedEntry, LOCTEXT("ActionTakeOff", "Take off"), false, ActionChoices)))
			{
				OffSlot->SetVerticalAlignment(VAlign_Center);
			}
		}
	}
	ActionBar->AddChildToVerticalBox(Row);

	// Where it will go, so a weapon never lands in a surprising slot.
	FText Where;
	if (!bEquipped && Cast<UClockworksWeaponDefinition>(Item))
	{
		Where = FText::Format(LOCTEXT("ActionWeaponSlot", "Goes into weapon slot {0}. Click a weapon slot on the left to choose another."),
			FText::AsNumber((SelectedSlot < WeaponSlotTotal ? SelectedSlot : LastWeaponSlot) + 1));
	}
	else if (!bEquipped && Gear && Gear->Slot == EClockworksGearSlot::Trinket)
	{
		Where = FText::Format(LOCTEXT("ActionTrinketSlot", "Goes into trinket slot {0}."),
			FText::AsNumber(SelectedSlot == WeaponSlotTotal + static_cast<int32>(EClockworksGearSlotIndex::Trinket2) ? 2 : 1));
	}
	if (!Where.IsEmpty())
	{
		if (UVerticalBoxSlot* WhereSlot = ActionBar->AddChildToVerticalBox(Art::MakeText(WidgetTree, Where, 11, Art::MutedText, Art::EHUDTypeface::Regular, 0)))
		{
			WhereSlot->SetPadding(FMargin(0.f, 4.f, 0.f, 0.f));
		}
	}
}

// Runs on: the local machine. The item card, shown as a row's tooltip: name and stars on gold, the picture, level 10,
// the stats at this depth, resistances and bonuses, what it upgrades from, the flavour text.
UWidget* UClockworksGearScreen::MakeCard(int32 EntryIndex) const
{
	const FClockworksArsenalEntry& Entry = Entries[EntryIndex];
	const UObject* Item = Entry.Item;
	const bool bEquipped = IsEquipped(EntryIndex);

	UVerticalBox* Card = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass());

	UBorder* Top = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass());
	Top->SetBrush(Art::GearBox(bEquipped ? TEXT("WindowGeartipTopEquiped") : TEXT("WindowGeartipTop"), FMargin(0.3f, 0.3f, 0.3f, 0.45f), Art::Gold));
	Top->SetPadding(FMargin(14.f, 8.f, 14.f, 14.f));
	UVerticalBox* TopBody = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass());
	UTextBlock* Name = Art::MakeText(WidgetTree, NameOf(Item), 19, Ink, Art::EHUDTypeface::BoldItalic, 0);
	Name->SetAutoWrapText(true);
	TopBody->AddChildToVerticalBox(Name);
	TopBody->AddChildToVerticalBox(MakeStars(StarsOf(Item), 16.f));
	Top->SetContent(TopBody);
	Card->AddChildToVerticalBox(Top);

	UBorder* Bottom = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass());
	Bottom->SetBrush(Art::GearBox(bEquipped ? TEXT("WindowGeartipBottomEquiped") : TEXT("WindowGeartipBottom"), FMargin(0.3f), Art::Navy));
	Bottom->SetPadding(FMargin(14.f, 10.f));
	UVerticalBox* Body = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass());
	Bottom->SetContent(Body);
	Card->AddChildToVerticalBox(Bottom);

	auto AddRow = [Body](UWidget* Widget, float TopPadding = 6.f)
	{
		if (UVerticalBoxSlot* RowSlot = Body->AddChildToVerticalBox(Widget))
		{
			RowSlot->SetPadding(FMargin(0.f, TopPadding, 0.f, 0.f));
		}
	};

	// The picture.
	UOverlay* Picture = WidgetTree->ConstructWidget<UOverlay>(UOverlay::StaticClass());
	Picture->AddChildToOverlay(Art::MakeImage(WidgetTree, Art::GearBox(TEXT("WindowBackingPreview"), FMargin(0.2f), Art::NavyDark, 6.f)));
	if (UTexture2D* Icon = IconOf(Item))
	{
		UImage* IconImage = WidgetTree->ConstructWidget<UImage>(UImage::StaticClass());
		IconImage->SetBrushFromTexture(Icon, /*bMatchSize*/ false);
		if (UOverlaySlot* IconSlot = Picture->AddChildToOverlay(Art::MakeSized(WidgetTree, IconImage, FVector2D(110.f))))
		{
			IconSlot->SetHorizontalAlignment(HAlign_Center);
			IconSlot->SetVerticalAlignment(VAlign_Center);
		}
	}
	if (UVerticalBoxSlot* PictureSlot = Body->AddChildToVerticalBox(Art::MakeSized(WidgetTree, Picture, FVector2D(136.f))))
	{
		PictureSlot->SetHorizontalAlignment(HAlign_Center);
	}

	// Fully heated, by decision.
	UHorizontalBox* Level = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass());
	if (UHorizontalBoxSlot* LevelTextSlot = Level->AddChildToHorizontalBox(Art::MakeText(WidgetTree, LOCTEXT("CardLevel", "Level 10"), 13, Art::Gold, Art::EHUDTypeface::Bold, 0)))
	{
		LevelTextSlot->SetVerticalAlignment(VAlign_Center);
		LevelTextSlot->SetPadding(FMargin(0.f, 0.f, 8.f, 0.f));
	}
	if (UHorizontalBoxSlot* LevelBarSlot = Level->AddChildToHorizontalBox(Art::MakeImage(WidgetTree, Art::GearImage(TEXT("WindowGeartipLevelbar"), FVector2D(216.f, 18.f), Art::Gold, 4.f))))
	{
		LevelBarSlot->SetVerticalAlignment(VAlign_Center);
	}
	AddRow(Level, 10.f);

	const UWorld* World = GetWorld();
	const float Depth = ClockworksGearStats::CurrentOriginalDepth(World);
	const AClockworksGameState* GameState = World ? World->GetGameState<AClockworksGameState>() : nullptr;
	AddRow(Art::MakeText(WidgetTree, FText::Format(LOCTEXT("CardDepth", "Numbers at depth {0}"), FText::AsNumber(GameState ? GameState->GetDepth() : 0)),
		11, Art::MutedText, Art::EHUDTypeface::Regular, 0), 4.f);

	if (const UClockworksGearDefinition* Gear = Cast<UClockworksGearDefinition>(Item))
	{
		// Bars measure against the strongest piece of the same kind at this depth.
		float Strongest = 1.f;
		float StrongestShield = 1.f;
		for (const FClockworksArsenalEntry& Other : Entries)
		{
			const UClockworksGearDefinition* OtherGear = Other.Category == Entry.Category ? Cast<UClockworksGearDefinition>(Other.Item) : nullptr;
			if (!OtherGear)
			{
				continue;
			}
			float OtherDefense[4];
			ClockworksGearStats::PieceDefense(*OtherGear, Depth, OtherDefense);
			for (float Value : OtherDefense)
			{
				Strongest = FMath::Max(Strongest, Value);
			}
			if (OtherGear->ShieldHealth.Num() > 0)
			{
				StrongestShield = FMath::Max(StrongestShield, UClockworksGearDefinition::ReadCurve(OtherGear->ShieldHealth, Depth));
			}
		}

		float Defense[4];
		ClockworksGearStats::PieceDefense(*Gear, Depth, Defense);
		for (int32 Kind = 0; Kind < 4; ++Kind)
		{
			if (Defense[Kind] > 0.f)
			{
				AddRow(MakeBar(DefenseIcon(Kind), Defense[Kind] / Strongest, FText::AsNumber(FMath::RoundToInt(Defense[Kind]))));
			}
		}
		if (Gear->Slot == EClockworksGearSlot::Shield && Gear->ShieldHealth.Num() > 0)
		{
			const float ShieldHealth = UClockworksGearDefinition::ReadCurve(Gear->ShieldHealth, Depth);
			AddRow(Art::MakeText(WidgetTree, LOCTEXT("CardShieldHealth", "Shield health"), 12, Art::MutedText, Art::EHUDTypeface::Bold, 0), 8.f);
			AddRow(MakeBar(nullptr, ShieldHealth / StrongestShield, FText::AsNumber(FMath::RoundToInt(ShieldHealth))), 2.f);
		}

		float HeatHealth = 0.f;
		for (const FClockworksGearHealthStep& Step : Gear->HeatHealth)
		{
			HeatHealth += Depth >= Step.MinDepth ? Step.Health : 0.f;
		}
		if (HeatHealth > 0.f)
		{
			AddRow(MakeModifierRow(true, FText::Format(LOCTEXT("CardHeatHealth", "Health +{0} (level 10)"), FText::AsNumber(FMath::RoundToInt(HeatHealth)))), 8.f);
		}
		for (const FClockworksGearStatusResist& Resist : Gear->StatusResists)
		{
			const FText Text = Resist.Resist >= 0.f
				? FText::Format(LOCTEXT("CardResist", "{0} resistance +{1}"), FText::FromString(Resist.Status), FText::AsNumber(FMath::RoundToInt(Resist.Resist)))
				: FText::Format(LOCTEXT("CardWeakness", "{0} weakness {1}"), FText::FromString(Resist.Status), FText::AsNumber(FMath::RoundToInt(Resist.Resist)));
			AddRow(MakeModifierRow(Resist.Resist >= 0.f, Text), 4.f);
		}
		for (const FClockworksGearBonus& Bonus : Gear->Bonuses)
		{
			bool bGood = true;
			const FText Text = DescribeBonus(Bonus, bGood);
			AddRow(MakeModifierRow(bGood, Text), 4.f);
		}
		if (Gear->bUnreleased)
		{
			AddRow(Art::MakeText(WidgetTree, LOCTEXT("CardUnreleased", "Never released in the original."), 11, Art::MutedText, Art::EHUDTypeface::Regular, 0), 6.f);
		}
	}
	else if (const UClockworksWeaponDefinition* Weapon = Cast<UClockworksWeaponDefinition>(Item))
	{
		const int32 Kind = static_cast<int32>(ClockworksGearStats::KindOf(Weapon->DamageType));
		AddRow(Art::MakeText(WidgetTree, FText::Format(LOCTEXT("CardDamageType", "{0} damage"), DamageKindName(Kind)), 12, Art::MutedText, Art::EHUDTypeface::Bold, 0), 8.f);
		FNumberFormattingOptions TwoPlaces;
		TwoPlaces.MaximumFractionalDigits = 2;
		AddRow(MakeBar(DefenseIcon(Kind), Weapon->DamageMultiplier / 3.f,
			FText::Format(LOCTEXT("CardDamageMultiplier", "x{0}"), FText::AsNumber(Weapon->DamageMultiplier, &TwoPlaces))), 2.f);
		if (Weapon->StatusEffect && Weapon->StatusChance > 0.f)
		{
			const FString Status = ClockworksGearStats::StatusNameOf(Weapon->StatusEffect);
			AddRow(MakeModifierRow(true, FText::Format(LOCTEXT("CardStatusChance", "{0} chance: {1}%"),
				FText::FromString(Status.IsEmpty() ? TEXT("Status") : Status), FText::AsNumber(FMath::RoundToInt(Weapon->StatusChance * 100.f)))), 6.f);
		}
	}

	if (const UObject* Parent = UpgradedFrom(Item))
	{
		AddRow(Art::MakeText(WidgetTree, FText::Format(LOCTEXT("CardUpgradesFrom", "Upgrades from {0}"), NameOf(Parent)), 11, Art::MutedText, Art::EHUDTypeface::Regular, 0), 8.f);
	}

	const UClockworksGearDefinition* FlavourGear = Cast<UClockworksGearDefinition>(Item);
	if (FlavourGear && !FlavourGear->Flavor.IsEmpty())
	{
		UTextBlock* Flavor = Art::MakeText(WidgetTree, FlavourGear->Flavor, 12, Art::MutedText, Art::EHUDTypeface::Regular, 0);
		Flavor->SetAutoWrapText(true);
		AddRow(Flavor, 10.f);
	}

	AddRow(Art::MakeText(WidgetTree, bEquipped ? LOCTEXT("CardWornHint", "Worn now.") : LOCTEXT("CardEquipHint", "Double-click to put it on."),
		11, Art::Gold, Art::EHUDTypeface::BoldItalic, 0), 10.f);

	return Art::MakeSized(WidgetTree, Card, FVector2D(360.f, 0.f));
}

#undef LOCTEXT_NAMESPACE
