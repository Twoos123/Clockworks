// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksGuideScreen.h"
#include "Components/Button.h"

#define LOCTEXT_NAMESPACE "Clockworks"

// Runs on: the local machine only.
UClockworksGuideScreen::UClockworksGuideScreen(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	Title = LOCTEXT("GuideTitle", "HOW TO PLAY");
	Subtitle = LOCTEXT("GuideSubtitle",
		"Six things you can do, three kinds of weapon, and two rules that decide which weapon to bring.");
	bPausesGame = true;
	PanelWidth = 700.f;
}

// Runs on: the local machine.
void UClockworksGuideScreen::BuildContents()
{
	// ----- controls -----

	AddSectionHeading(TEXT("ControlsHeading"), LOCTEXT("GuideControls", "CONTROLS"));

	AddDefinitionRow(TEXT("GMove"), LOCTEXT("GMoveKey", "W A S D"),
		LOCTEXT("GMoveDef", "Move, relative to the screen rather than to the way you are facing. "
			"You always face the mouse cursor, so you can back away from something while still hitting it."));
	AddDefinitionRow(TEXT("GAttack"), LOCTEXT("GAttackKey", "Left mouse"),
		LOCTEXT("GAttackDef", "Attack. Tap it three times for a sword's three-hit combo; the third swing is the one that moves you."));
	AddDefinitionRow(TEXT("GCharge"), LOCTEXT("GChargeKey", "Hold left mouse"),
		LOCTEXT("GChargeDef", "Charge. Keep holding after a swing and your knight glows; let go and you get a much bigger attack. "
			"Let go too early and you lose it."));
	AddDefinitionRow(TEXT("GShield"), LOCTEXT("GShieldKey", "Right mouse"),
		LOCTEXT("GShieldDef", "Raise your shield. A raised shield takes the whole of a hit instead of you, even one bigger than it has left, "
			"and then shatters. It refills a few seconds after it last took anything."));
	AddDefinitionRow(TEXT("GDodge"), LOCTEXT("GDodgeKey", "Shift + right mouse"),
		LOCTEXT("GDodgeDef", "Dodge. A short burst in the direction you are moving, and you cannot be hit during it."));
	AddDefinitionRow(TEXT("GBash"), LOCTEXT("GBashKey", "Shift + left mouse"),
		LOCTEXT("GBashDef", "Shield bash. Needs a full shield and spends half of it: you launch shield-first, "
			"knocking back and stunning what you hit. This is how you make room when you are surrounded."));
	AddDefinitionRow(TEXT("GSwitch"), LOCTEXT("GSwitchKey", "Space / mouse wheel"),
		LOCTEXT("GSwitchDef", "Draw the next weapon on your toolbar, bottom right."));
	AddDefinitionRow(TEXT("GMenu"), LOCTEXT("GMenuKey", "Esc / L"),
		LOCTEXT("GMenuDef", "Pause, and open your loadout, at any point during play."));

	// ----- weapon classes -----

	AddSectionHeading(TEXT("ClassesHeading"), LOCTEXT("GuideClasses", "THE THREE WEAPON CLASSES"));

	AddDefinitionRow(TEXT("GSword"), LOCTEXT("GSwordTerm", "Swords"),
		LOCTEXT("GSwordDef", "Close range, three-hit combos, and the highest damage in the game if you can stay next to something. "
			"Each swing carries you forward a little, which is both how you close distance and how you walk into trouble. "
			"A charged sword attack spins you on the spot and hits everything around you."));
	AddDefinitionRow(TEXT("GGun"), LOCTEXT("GGunTerm", "Handguns"),
		LOCTEXT("GGunDef", "Safety. You fire a short clip, then reload, and you keep walking the whole time. "
			"Less damage than a sword, but you are choosing where to stand rather than being forced next to the thing hitting you."));
	AddDefinitionRow(TEXT("GBomb"), LOCTEXT("GBombTerm", "Bombs"),
		LOCTEXT("GBombDef", "Area control, and the only class with no quick attack at all. "
			"You hold the button for two seconds to arm one, drop it at your feet on release, "
			"and it goes off a second and a half later in a circle you can see marked on the floor. "
			"It cannot hurt you. Letting go early drops a dud and leaves you standing still for most of a second, "
			"so bombs are something you commit to before a fight, not during one."));

	// ----- damage types -----

	AddSectionHeading(TEXT("TypesHeading"), LOCTEXT("GuideTypes", "DAMAGE TYPES AND MONSTER FAMILIES"));

	AddBodyText(TEXT("TypesIntro"), LOCTEXT("GuideTypesIntro",
		"Every weapon deals one of four damage types, and every monster belongs to a family. "
		"A family takes about two thirds again from the type it is weak to, and only about a third from the type it resists. "
		"This is the single biggest reason a weapon feels excellent in one room and useless in the next, "
		"and it is why the toolbar holds three weapons rather than one."));

	AddDefinitionRow(TEXT("GBeast"), LOCTEXT("GBeastTerm", "Beast"),
		LOCTEXT("GBeastDef", "Wolvers and their kin. Weak to Piercing, resistant to Shadow."));
	AddDefinitionRow(TEXT("GConstruct"), LOCTEXT("GConstructTerm", "Construct"),
		LOCTEXT("GConstructDef", "Mechaknights, gun puppies, anything built. Weak to Elemental, resistant to Normal — "
			"which is exactly what your starting sword and gun deal, so bring something else."));
	AddDefinitionRow(TEXT("GSlime"), LOCTEXT("GSlimeTerm", "Slime"),
		LOCTEXT("GSlimeDef", "Jellies and lichens. Weak to Piercing, resistant to Elemental."));
	AddDefinitionRow(TEXT("GUndead"), LOCTEXT("GUndeadTerm", "Undead"),
		LOCTEXT("GUndeadDef", "Weak to Elemental, resistant to Piercing."));
	AddDefinitionRow(TEXT("GGremlin"), LOCTEXT("GGremlinTerm", "Gremlin"),
		LOCTEXT("GGremlinDef", "Weak to Shadow, resistant to Piercing."));
	AddDefinitionRow(TEXT("GFiend"), LOCTEXT("GFiendTerm", "Fiend"),
		LOCTEXT("GFiendDef", "Weak to Piercing, resistant to Shadow."));

	// ----- statuses -----

	AddSectionHeading(TEXT("StatusHeading"), LOCTEXT("GuideStatus", "STATUSES"));

	AddBodyText(TEXT("StatusIntro"), LOCTEXT("GuideStatusIntro",
		"Some weapons also inflict a status when they land. A status is often worth more than the damage: "
		"a weapon that freezes is worth carrying into a room that resists its damage type, "
		"because something that cannot move cannot hit you."));

	AddDefinitionRow(TEXT("GFire"), LOCTEXT("GFireTerm", "Fire"),
		LOCTEXT("GFireDef", "Burns for damage every second until it wears off. Good against anything with a lot of health."));
	AddDefinitionRow(TEXT("GFreeze"), LOCTEXT("GFreezeTerm", "Freeze"),
		LOCTEXT("GFreezeDef", "Plants the target where it stands. The safest status in the game, and the best one to use when outnumbered."));
	AddDefinitionRow(TEXT("GShock"), LOCTEXT("GShockTerm", "Shock"),
		LOCTEXT("GShockDef", "Interrupts whatever the target was doing and briefly stops it acting. "
			"Aimed at the right moment it cancels an attack that was about to land on you."));

	// ----- reading a fight -----

	AddSectionHeading(TEXT("ReadingHeading"), LOCTEXT("GuideReading", "READING A FIGHT"));

	AddBodyText(TEXT("ReadingBody"), LOCTEXT("GuideReadingBody",
		"Monsters tell you before they hit you. A monster winding up to attack is tinted for the whole of its windup, "
		"and the tint comes off at the moment its attack actually becomes dangerous. That tint is your window to walk out of the way, "
		"raise your shield, or shield bash it out of the attack entirely.\n\n"
		"Your own health is the row of red pips at the top left; the blue bar under it is your shield. "
		"A monster's health appears over its head once you have hit it."));

	AddSpacer(TEXT("GuideFooterSpace"), 16.f);

	if (UButton* Back = AddMenuButton(TEXT("GuideBackButton"), LOCTEXT("MenuBack", "Back")))
	{
		Back->OnClicked.AddDynamic(this, &UClockworksGuideScreen::OnBackClicked);
	}
}

// Runs on: the local machine.
void UClockworksGuideScreen::OnBackClicked()
{
	PlayClick();
	CloseMenu();

	if (UClockworksMenuScreen* Return = ReturnMenu.Get())
	{
		Return->SetVisibility(ESlateVisibility::Visible);
		Return->OpenMenu();
	}
}

#undef LOCTEXT_NAMESPACE
