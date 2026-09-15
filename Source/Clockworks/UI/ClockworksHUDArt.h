// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Fonts/SlateFontInfo.h"
#include "Styling/SlateBrush.h"

class UCanvasPanel;
class UCanvasPanelSlot;
class UImage;
class USizeBox;
class UTextBlock;
class UTexture2D;
class UWidget;
class UWidgetTree;

/**
 * The shared look of the in-game HUD: the Spiral Knights interface art imported under
 * Content/SK/HUD, the house font, the navy-and-gold palette read off the user's screenshots of the
 * original, and the few widget-building helpers every HUD piece uses.
 *
 * Every texture is optional. Content/SK is git-ignored placeholder art, so on a machine that has not
 * run the import the HUD still draws, in flat colours, rather than drawing nothing.
 *
 * Local display only. Nothing here decides or replicates anything.
 */
namespace ClockworksHUDArt
{
	enum class EHUDTypeface : uint8
	{
		Regular,
		Bold,
		/** The original's voice for every label that matters: names, headers, the depth. */
		BoldItalic
	};

	/** A HUD texture by short name: "PipFull" is /Game/SK/HUD/T_HUD_PipFull. Null when not imported. */
	UTexture2D* Texture(const TCHAR* Name);

	/** The named texture as a brush of the given size, or a flat rounded brush in Fallback when it is missing. */
	FSlateBrush TextureBrush(const TCHAR* Name, const FVector2D& Size, const FLinearColor& Fallback = FLinearColor::Transparent, float FallbackRadius = 0.f);

	/** A gear-screen texture by short name: "SlotEmpty" is /Game/SK/GearUI/T_GearUI_SlotEmpty. Null when not imported. */
	UTexture2D* GearTexture(const TCHAR* Name);

	/**
	 * A gear-screen texture drawn as a nine-slice box, the way the original draws its small window textures at any
	 * size: Margin is the fraction of each edge kept unstretched. A flat rounded box in Fallback when it is missing.
	 */
	FSlateBrush GearBox(const TCHAR* Name, const FMargin& Margin, const FLinearColor& Fallback = FLinearColor::Transparent, float FallbackRadius = 4.f);

	/** A gear-screen texture drawn whole at Size, or a flat rounded brush in Fallback. */
	FSlateBrush GearImage(const TCHAR* Name, const FVector2D& Size, const FLinearColor& Fallback = FLinearColor::Transparent, float FallbackRadius = 0.f);

	/** A flat panel with rounded corners and an optional outline. A radius below zero makes a circle or a pill. */
	FSlateBrush RoundedBrush(const FLinearColor& Fill, float CornerRadius, const FLinearColor& Outline = FLinearColor::Transparent, float OutlineWidth = 0.f);

	/** The engine's Roboto at a size, with an optional dark outline so it reads over the world. */
	FSlateFontInfo Font(int32 Size, EHUDTypeface Face = EHUDTypeface::Bold, int32 OutlineSize = 0);

	UTextBlock* MakeText(UWidgetTree* Tree, const FText& Text, int32 Size, const FLinearColor& Color, EHUDTypeface Face = EHUDTypeface::Bold, int32 OutlineSize = 1);

	UImage* MakeImage(UWidgetTree* Tree, const FSlateBrush& Brush);

	/** Wraps Content at a fixed size, which a box or overlay slot would otherwise stretch or shrink. */
	USizeBox* MakeSized(UWidgetTree* Tree, UWidget* Content, const FVector2D& Size);

	/** The three small dots the original sets between groups of buttons. */
	UTextBlock* MakeDivider(UWidgetTree* Tree, bool bVertical);

	/** Adds Widget to Canvas at a point anchor. A zero Size sizes it to its content. */
	UCanvasPanelSlot* Place(UCanvasPanel* Canvas, UWidget* Widget, const FVector2D& Anchor, const FVector2D& Alignment, const FVector2D& Position, const FVector2D& Size = FVector2D::ZeroVector);

	// ----- palette, from the screenshots -----

	/** Every panel, strip and plate. */
	inline const FLinearColor Navy(0.030f, 0.050f, 0.090f, 0.94f);

	/** The name banner and the badge fills: a shade darker than the panels. */
	inline const FLinearColor NavyDark(0.015f, 0.025f, 0.050f, 0.97f);

	/** The metal rims on the portrait and the minimap. */
	inline const FLinearColor SteelBlue(0.22f, 0.45f, 0.68f, 1.f);

	/** Names, headers, key hints. The one warm colour. */
	inline const FLinearColor Gold(0.98f, 0.78f, 0.24f, 1.f);

	inline const FLinearColor TextWhite(0.95f, 0.97f, 1.f, 1.f);

	inline const FLinearColor MutedText(0.60f, 0.68f, 0.80f, 1.f);

	inline const FLinearColor DividerGrey(0.45f, 0.52f, 0.62f, 0.9f);

	/** The tall corner buttons and the slim activity buttons. */
	inline const FLinearColor ButtonBlue(0.10f, 0.27f, 0.54f, 1.f);

	inline const FLinearColor ButtonBlueHover(0.18f, 0.42f, 0.80f, 1.f);

	inline const FLinearColor ButtonOutline(0.01f, 0.03f, 0.07f, 1.f);

	/** The large "Go to" buttons in the activities panel. */
	inline const FLinearColor PaleButton(0.80f, 0.87f, 0.96f, 1.f);

	inline const FLinearColor HealthRed(0.80f, 0.06f, 0.08f, 1.f);

	inline const FLinearColor ShieldBlue(0.10f, 0.36f, 0.82f, 1.f);
}
