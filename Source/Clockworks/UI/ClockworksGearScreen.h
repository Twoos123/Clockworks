// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "ClockworksMenuScreen.h"
#include "Types/SlateEnums.h"
#include "ClockworksGearScreen.generated.h"

class AClockworksKnightPreview;
class AClockworksPlayerState;
class UButton;
class UClockworksGearDefinition;
class UClockworksGearScreen;
class UClockworksWeaponDefinition;
class UComboBoxString;
class UEditableTextBox;
class UHorizontalBox;
class UScrollBox;
class UTextBlock;
class UVerticalBox;

/** What a gear-screen button does when it is pressed. */
UENUM()
enum class EClockworksGearChoiceKind : uint8
{
	/** An equipment slot in the Character window (0-3 weapons, 4 helmet, 5 armour, 6 shield, 7 and 8 trinkets). */
	Slot,

	/** A Character window tab: Equipment, Costume, Battle Sprite, Achievements. */
	Tab,

	/** An Arsenal tab: Swords, Handguns, Bombs, Helmets, Armor, Shields, Trinkets. */
	Category,

	/** A star toggle in the Arsenal's filter row (Index is the star count, 0 to 5). */
	StarFilter,

	/** An Arsenal row: selects it; a second click soon after puts it on. */
	Item,

	/** The action bar's Equip button. */
	Equip,

	/** The action bar's Take off button. */
	Unequip,

	/** A saved loadout: switches to it. */
	Loadout,

	/** Saves what is worn and carried into the selected loadout. */
	SaveLoadout
};

/**
 * One clickable thing on the gear screen, carrying which thing it is. Unreal's button delegate has no payload, so
 * each button gets one of these to remember "slot 2" or "the Proto Shield".
 */
UCLASS()
class UClockworksGearChoice : public UObject
{
	GENERATED_BODY()

public:

	int32 Index = INDEX_NONE;

	EClockworksGearChoiceKind Kind = EClockworksGearChoiceKind::Item;

	/** An Arsenal row hangs its item card on its button the first time it is hovered. */
	bool bCardBuilt = false;

	UPROPERTY()
	TWeakObjectPtr<UClockworksGearScreen> Screen;

	UPROPERTY()
	TWeakObjectPtr<UButton> Button;

	UFUNCTION()
	void HandleClicked();

	UFUNCTION()
	void HandleHovered();
};

/** One thing in the Arsenal: a weapon or a piece of gear. */
USTRUCT()
struct FClockworksArsenalEntry
{
	GENERATED_BODY()

	/** A UClockworksWeaponDefinition or a UClockworksGearDefinition. */
	UPROPERTY()
	TObjectPtr<UObject> Item;

	/** Swords, Handguns, Bombs, Helmets, Armor, Shields, Trinkets, in that order. */
	int32 Category = 0;
};

/** Everything worn and carried, saved under one loadout button. */
USTRUCT()
struct FClockworksSavedLoadout
{
	GENERATED_BODY()

	UPROPERTY()
	TArray<TObjectPtr<UClockworksWeaponDefinition>> Weapons;

	UPROPERTY()
	TArray<TObjectPtr<UClockworksGearDefinition>> Gear;
};

/**
 * The equipment screen, laid out like Spiral Knights' own (user's decisions, 2026-09-15): the Character window on the
 * left (tabs, a column of equipment slots, the knight turning on a stand, name and star total, loadouts) and the
 * Arsenal on the right. The Arsenal shows one category at a time behind a row of tabs, with a name search, a sort
 * menu, a damage type / resistance filter and star toggles; rows are grouped by star rating. Hovering a row shows
 * its item card as a tooltip; clicking selects it; double-clicking it, or the Equip button under the list, puts it
 * on. Clicking a slot opens its category with the worn item selected. Costume, Battle Sprite and Achievements are
 * drawn but not working yet.
 *
 * Reachable from the start menu, the pause menu, the HUD's loadouts button and L during play.
 *
 * This screen decides nothing. It sends the chosen weapons and gear to the PlayerState as intent; the server puts
 * them on and replicates the result, and the screen redraws when that result arrives.
 *
 * Saved loadouts are kept in this screen for the session only; nothing is written to disk.
 *
 * Runs on: the local machine only.
 */
UCLASS()
class UClockworksGearScreen : public UClockworksMenuScreen
{
	GENERATED_BODY()

public:

	UClockworksGearScreen(const FObjectInitializer& ObjectInitializer);

	/** The menu to go back to when this one closes. Null when it was opened straight from play. */
	void SetReturnMenu(UClockworksMenuScreen* InReturnMenu) { ReturnMenu = InReturnMenu; }

	/** Called by a UClockworksGearChoice when its button is pressed. */
	void HandleChoice(EClockworksGearChoiceKind Kind, int32 Index);

	/** Called by an Arsenal row's choice when the row is first hovered: hangs the item card on it. */
	void HandleRowHovered(UClockworksGearChoice* Choice);

	virtual void OpenMenu() override;
	virtual void CloseMenu() override;

	/** Four weapons, helmet, armour, shield, two trinkets (user's decision, 2026-09-15). */
	static constexpr int32 SlotTotal = 9;
	static constexpr int32 WeaponSlotTotal = 4;
	static constexpr int32 LoadoutTotal = 5;

protected:

	virtual void BuildContents() override;
	virtual void NativeTick(const FGeometry& MyGeometry, float InDeltaTime) override;
	virtual void NativeDestruct() override;

	UFUNCTION() void OnBackClicked();

	/** Bound to the PlayerState: the server changed what the knight wears or carries. */
	UFUNCTION() void HandleEquipmentChanged();

	UFUNCTION() void OnTurnLeftPressed();
	UFUNCTION() void OnTurnLeftReleased();
	UFUNCTION() void OnTurnRightPressed();
	UFUNCTION() void OnTurnRightReleased();

	UFUNCTION() void OnSearchChanged(const FText& Text);
	UFUNCTION() void OnSortChanged(FString Option, ESelectInfo::Type SelectionType);
	UFUNCTION() void OnFilterChanged(FString Option, ESelectInfo::Type SelectionType);

	/** How fast the arrows turn the knight, in degrees a second. */
	UPROPERTY(EditDefaultsOnly, Category = "Gear", meta = (ClampMin = "0.0"))
	float TurnDegreesPerSecond = 140.f;

	/** Two clicks on the same row within this long put the item on. */
	UPROPERTY(EditDefaultsOnly, Category = "Gear", meta = (ClampMin = "0.1"))
	float DoubleClickSeconds = 0.4f;

	UPROPERTY(EditDefaultsOnly, Category = "Gear|Style")
	float CharacterWindowWidth = 640.f;

	UPROPERTY(EditDefaultsOnly, Category = "Gear|Style")
	float ArsenalWidth = 560.f;

	/** Height of the Arsenal's scrolling list. */
	UPROPERTY(EditDefaultsOnly, Category = "Gear|Style")
	float ArsenalHeight = 520.f;

private:

	// ----- catalogue -----

	/** Every weapon and piece of gear in the project into Entries. */
	void BuildCatalogue();

	int32 EntryOf(const UObject* Item) const;

	/** Whether an entry of the open tab passes the search, star and type filters. */
	bool PassesFilters(int32 EntryIndex) const;

	/** The number the third sort option orders by: damage for weapons, shield health for shields, defense otherwise. */
	float SortStat(int32 EntryIndex) const;

	// ----- the knight -----

	AClockworksPlayerState* GetKnight() const;
	void BindKnight();
	void UnbindKnight();

	/** What is in a Character window slot now, or null. */
	UObject* ItemInSlot(int32 SlotIndex) const;
	bool IsEquipped(int32 EntryIndex) const;

	void SelectSlot(int32 SlotIndex);
	void EquipEntry(int32 EntryIndex);
	void UnequipEntry(int32 EntryIndex);
	void SendWeapons(const TArray<UClockworksWeaponDefinition*>& Weapons) const;
	void SwitchLoadout(int32 LoadoutIndex);

	// ----- drawing -----

	void RebuildAll();
	void RebuildCharacter();
	void RebuildArsenalTabs();
	void RebuildFilters();
	void RebuildArsenal();
	void RebuildActionBar();
	void EnsurePreview();

	UButton* MakeChoiceButton(EClockworksGearChoiceKind Kind, int32 Index, TArray<TObjectPtr<UClockworksGearChoice>>& Owners);
	void StyleArtButton(UButton* Button, const TCHAR* Normal, const TCHAR* Hovered, const TCHAR* Pressed, const FMargin& Margin, const FLinearColor& Fallback) const;
	UWidget* MakeHeader(const FText& Text) const;
	UWidget* MakeStars(int32 Stars, float Size) const;
	UWidget* MakeBar(const TCHAR* IconName, float Fraction, const FText& Value) const;
	UWidget* MakeModifierRow(bool bGood, const FText& Text) const;
	UWidget* MakeSlotButton(int32 SlotIndex);
	UWidget* MakePreview();
	UWidget* MakeItemRow(int32 EntryIndex);
	UWidget* MakeRowStats(int32 EntryIndex) const;
	UWidget* MakeCard(int32 EntryIndex) const;
	UWidget* MakeLabelButton(EClockworksGearChoiceKind Kind, int32 Index, const FText& Label, bool bBlue, TArray<TObjectPtr<UClockworksGearChoice>>& Owners);

	UPROPERTY()
	TArray<FClockworksArsenalEntry> Entries;

	/** Entry index by item, including hand-tuned starter weapons that duplicate a catalogue weapon. */
	TMap<const UObject*, int32> EntryByItem;

	bool bCatalogueBuilt = false;

	UPROPERTY()
	TObjectPtr<UVerticalBox> CharacterBox;

	UPROPERTY()
	TObjectPtr<UHorizontalBox> ArsenalTabRow;

	UPROPERTY()
	TObjectPtr<UHorizontalBox> StarRow;

	UPROPERTY()
	TObjectPtr<UTextBlock> ArsenalCount;

	UPROPERTY()
	TObjectPtr<UEditableTextBox> SearchBox;

	UPROPERTY()
	TObjectPtr<UComboBoxString> SortBox;

	UPROPERTY()
	TObjectPtr<UComboBoxString> FilterBox;

	UPROPERTY()
	TObjectPtr<UVerticalBox> ArsenalList;

	UPROPERTY()
	TObjectPtr<UScrollBox> ArsenalScroll;

	UPROPERTY()
	TObjectPtr<UVerticalBox> ActionBar;

	UPROPERTY()
	TArray<TObjectPtr<UClockworksGearChoice>> CharacterChoices;

	UPROPERTY()
	TArray<TObjectPtr<UClockworksGearChoice>> TabChoices;

	UPROPERTY()
	TArray<TObjectPtr<UClockworksGearChoice>> ArsenalChoices;

	UPROPERTY()
	TArray<TObjectPtr<UClockworksGearChoice>> ActionChoices;

	UPROPERTY()
	TWeakObjectPtr<UClockworksMenuScreen> ReturnMenu;

	UPROPERTY()
	TWeakObjectPtr<AClockworksPlayerState> BoundKnight;

	UPROPERTY()
	TWeakObjectPtr<AClockworksKnightPreview> Preview;

	/** The selected row, scrolled into view on the next frame (its Slate widget does not exist until then). */
	UPROPERTY()
	TWeakObjectPtr<UWidget> PendingScrollRow;

	UPROPERTY()
	TArray<FClockworksSavedLoadout> SavedLoadouts;

	/** The options the sort and filter menus hold for the open tab, in order. */
	TArray<FString> SortOptions;
	TArray<FString> FilterOptions;

	FString SearchText;

	int32 SelectedSlot = 0;
	int32 LastWeaponSlot = 0;
	int32 SelectedTab = 0;
	int32 ArsenalTab = 0;
	int32 SelectedEntry = INDEX_NONE;
	int32 SelectedLoadout = 0;
	int32 SortIndex = 0;
	int32 FilterIndex = 0;

	/** Which star ratings are shown, one bit per star count 0 to 5. */
	int32 StarMask = 0x3F;

	int32 LastClickEntry = INDEX_NONE;
	double LastClickTime = 0.0;

	bool bDirty = false;
	bool bFiltersDirty = false;
	bool bUpdatingFilters = false;
	bool bScrollToSelected = false;
	bool bPreviewDirty = false;
	bool bTurnLeft = false;
	bool bTurnRight = false;
};
