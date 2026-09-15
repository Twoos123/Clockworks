// Copyright Epic Games, Inc. All Rights Reserved.

#include "ClockworksHUDArt.h"
#include "Blueprint/WidgetTree.h"
#include "Components/CanvasPanel.h"
#include "Components/CanvasPanelSlot.h"
#include "Components/Image.h"
#include "Components/SizeBox.h"
#include "Components/TextBlock.h"
#include "Engine/Font.h"
#include "Engine/Texture2D.h"
#include "Misc/PackageName.h"
#include "Styling/CoreStyle.h"

namespace ClockworksHUDArt
{
	namespace
	{
		/** The typeface in the engine font whose name matches Face. The names differ between engine versions. */
		FName FindTypeface(const UFont* Roboto, EHUDTypeface Face)
		{
			for (const FTypefaceEntry& Entry : Roboto->CompositeFont.DefaultTypeface.Fonts)
			{
				const FString EntryName = Entry.Name.ToString();
				const bool bBold = EntryName.Contains(TEXT("Bold"));
				const bool bItalic = EntryName.Contains(TEXT("Italic"));
				if ((Face == EHUDTypeface::Regular && EntryName.Contains(TEXT("Regular")))
					|| (Face == EHUDTypeface::Bold && bBold && !bItalic)
					|| (Face == EHUDTypeface::BoldItalic && bBold && bItalic))
				{
					return Entry.Name;
				}
			}
			return NAME_None;
		}
	}

	// Runs on: the local machine. Looks once per name; a texture that was never imported is remembered
	// as missing rather than searched for on every repaint.
	UTexture2D* Texture(const TCHAR* Name)
	{
		static TMap<FString, TWeakObjectPtr<UTexture2D>> Found;
		static TSet<FString> Missing;

		const FString Key(Name);
		if (const TWeakObjectPtr<UTexture2D>* Cached = Found.Find(Key))
		{
			if (UTexture2D* CachedTexture = Cached->Get())
			{
				return CachedTexture;
			}
		}
		if (Missing.Contains(Key))
		{
			return nullptr;
		}

		const FString PackagePath = FString::Printf(TEXT("/Game/SK/HUD/T_HUD_%s"), Name);
		UTexture2D* Loaded = nullptr;
		if (FPackageName::DoesPackageExist(PackagePath))
		{
			Loaded = LoadObject<UTexture2D>(nullptr, *FString::Printf(TEXT("%s.T_HUD_%s"), *PackagePath, Name));
		}

		if (Loaded)
		{
			Found.Add(Key, Loaded);
		}
		else
		{
			Missing.Add(Key);
		}
		return Loaded;
	}

	// Runs on: the local machine.
	FSlateBrush TextureBrush(const TCHAR* Name, const FVector2D& Size, const FLinearColor& Fallback, float FallbackRadius)
	{
		if (UTexture2D* Found = Texture(Name))
		{
			FSlateBrush Brush;
			Brush.SetResourceObject(Found);
			Brush.DrawAs = ESlateBrushDrawType::Image;
			Brush.SetImageSize(Size);
			return Brush;
		}

		FSlateBrush Brush = RoundedBrush(Fallback, FallbackRadius);
		Brush.SetImageSize(Size);
		return Brush;
	}

	// Runs on: the local machine. Same caching as Texture, for the gear screen's art under /Game/SK/GearUI.
	UTexture2D* GearTexture(const TCHAR* Name)
	{
		static TMap<FString, TWeakObjectPtr<UTexture2D>> Found;
		static TSet<FString> Missing;

		const FString Key(Name);
		if (const TWeakObjectPtr<UTexture2D>* Cached = Found.Find(Key))
		{
			if (UTexture2D* CachedTexture = Cached->Get())
			{
				return CachedTexture;
			}
		}
		if (Missing.Contains(Key))
		{
			return nullptr;
		}

		const FString PackagePath = FString::Printf(TEXT("/Game/SK/GearUI/T_GearUI_%s"), Name);
		UTexture2D* Loaded = nullptr;
		if (FPackageName::DoesPackageExist(PackagePath))
		{
			Loaded = LoadObject<UTexture2D>(nullptr, *FString::Printf(TEXT("%s.T_GearUI_%s"), *PackagePath, Name));
		}
		if (Loaded)
		{
			Found.Add(Key, Loaded);
		}
		else
		{
			Missing.Add(Key);
		}
		return Loaded;
	}

	// Runs on: the local machine.
	FSlateBrush GearBox(const TCHAR* Name, const FMargin& Margin, const FLinearColor& Fallback, float FallbackRadius)
	{
		if (UTexture2D* Found = GearTexture(Name))
		{
			FSlateBrush Brush;
			Brush.SetResourceObject(Found);
			Brush.DrawAs = ESlateBrushDrawType::Box;
			Brush.Margin = Margin;
			Brush.SetImageSize(FVector2D(Found->GetSizeX(), Found->GetSizeY()));
			return Brush;
		}
		return RoundedBrush(Fallback, FallbackRadius);
	}

	// Runs on: the local machine.
	FSlateBrush GearImage(const TCHAR* Name, const FVector2D& Size, const FLinearColor& Fallback, float FallbackRadius)
	{
		if (UTexture2D* Found = GearTexture(Name))
		{
			FSlateBrush Brush;
			Brush.SetResourceObject(Found);
			Brush.DrawAs = ESlateBrushDrawType::Image;
			Brush.SetImageSize(Size);
			return Brush;
		}
		FSlateBrush Brush = RoundedBrush(Fallback, FallbackRadius);
		Brush.SetImageSize(Size);
		return Brush;
	}

	// Runs on: the local machine.
	FSlateBrush RoundedBrush(const FLinearColor& Fill, float CornerRadius, const FLinearColor& Outline, float OutlineWidth)
	{
		FSlateBrush Brush;
		Brush.DrawAs = ESlateBrushDrawType::RoundedBox;
		Brush.TintColor = FSlateColor(Fill);
		Brush.OutlineSettings.Color = FSlateColor(Outline);
		Brush.OutlineSettings.Width = OutlineWidth;
		if (CornerRadius < 0.f)
		{
			Brush.OutlineSettings.RoundingType = ESlateBrushRoundingType::HalfHeightRadius;
		}
		else
		{
			Brush.OutlineSettings.RoundingType = ESlateBrushRoundingType::FixedRadius;
			Brush.OutlineSettings.CornerRadii = FVector4(CornerRadius, CornerRadius, CornerRadius, CornerRadius);
		}
		return Brush;
	}

	// Runs on: the local machine.
	FSlateFontInfo Font(int32 Size, EHUDTypeface Face, int32 OutlineSize)
	{
		static TWeakObjectPtr<UFont> CachedRoboto;
		UFont* Roboto = CachedRoboto.Get();
		if (!Roboto)
		{
			Roboto = LoadObject<UFont>(nullptr, TEXT("/Engine/EngineFonts/Roboto.Roboto"));
			CachedRoboto = Roboto;
		}

		FSlateFontInfo Info = Roboto
			? FSlateFontInfo(Roboto, static_cast<float>(Size), FindTypeface(Roboto, Face))
			: FCoreStyle::GetDefaultFontStyle(Face == EHUDTypeface::Regular ? TEXT("Regular") : TEXT("Bold"), Size);
		Info.OutlineSettings.OutlineSize = OutlineSize;
		Info.OutlineSettings.OutlineColor = FLinearColor(0.f, 0.f, 0.f, 0.85f);
		return Info;
	}

	// Runs on: the local machine.
	UTextBlock* MakeText(UWidgetTree* Tree, const FText& Text, int32 Size, const FLinearColor& Color, EHUDTypeface Face, int32 OutlineSize)
	{
		UTextBlock* Block = Tree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass());
		Block->SetText(Text);
		Block->SetFont(Font(Size, Face, OutlineSize));
		Block->SetColorAndOpacity(FSlateColor(Color));
		return Block;
	}

	// Runs on: the local machine.
	UImage* MakeImage(UWidgetTree* Tree, const FSlateBrush& Brush)
	{
		UImage* Image = Tree->ConstructWidget<UImage>(UImage::StaticClass());
		Image->SetBrush(Brush);
		return Image;
	}

	// Runs on: the local machine.
	USizeBox* MakeSized(UWidgetTree* Tree, UWidget* Content, const FVector2D& Size)
	{
		USizeBox* Box = Tree->ConstructWidget<USizeBox>(USizeBox::StaticClass());
		Box->SetWidthOverride(Size.X);
		Box->SetHeightOverride(Size.Y);
		if (Content)
		{
			Box->SetContent(Content);
		}
		return Box;
	}

	// Runs on: the local machine.
	UTextBlock* MakeDivider(UWidgetTree* Tree, bool bVertical)
	{
		UTextBlock* Dots = MakeText(Tree, FText::FromString(bVertical ? TEXT("•\n•\n•") : TEXT("•   •   •")),
			7, DividerGrey, EHUDTypeface::Regular, 0);
		Dots->SetJustification(ETextJustify::Center);
		return Dots;
	}

	// Runs on: the local machine.
	UCanvasPanelSlot* Place(UCanvasPanel* Canvas, UWidget* Widget, const FVector2D& Anchor, const FVector2D& Alignment, const FVector2D& Position, const FVector2D& Size)
	{
		if (!Canvas || !Widget)
		{
			return nullptr;
		}
		UCanvasPanelSlot* CanvasSlot = Canvas->AddChildToCanvas(Widget);
		if (!CanvasSlot)
		{
			return nullptr;
		}
		CanvasSlot->SetAnchors(FAnchors(Anchor.X, Anchor.Y));
		CanvasSlot->SetAlignment(Alignment);
		CanvasSlot->SetPosition(Position);
		if (Size.IsNearlyZero())
		{
			CanvasSlot->SetAutoSize(true);
		}
		else
		{
			CanvasSlot->SetAutoSize(false);
			CanvasSlot->SetSize(Size);
		}
		return CanvasSlot;
	}
}
