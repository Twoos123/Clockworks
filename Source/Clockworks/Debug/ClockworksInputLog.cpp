// Copyright Epic Games, Inc. All Rights Reserved.

#include "Debug/ClockworksInputLog.h"
#include "Clockworks.h"
#include "Blueprint/UserWidget.h"
#include "Engine/Engine.h"
#include "Framework/Application/IInputProcessor.h"
#include "Framework/Application/SlateApplication.h"
#include "HAL/IConsoleManager.h"
#include "HAL/PlatformTime.h"
#include "Input/Events.h"
#include "Layout/WidgetPath.h"
#include "Slate/SObjectWidget.h"

namespace
{
	TAutoConsoleVariable<int32> CVarLogInput(
		TEXT("Clockworks.LogInput"),
		2,
		TEXT("Logs every key and mouse button and what the game did with it. 0 off, 1 Output Log and screen, 2 Output Log only."));

	double StartSeconds = 0.0;

	/**
	 * What a click landed on. Slate hit-tests the cursor the same way it routes the click, so a widget
	 * named here is one that could keep the click from the game; "the game view" means nothing did.
	 */
	FString DescribeUnderCursor(FSlateApplication& App, const FPointerEvent& Event)
	{
		const FWidgetPath Path = App.LocateWindowUnderMouse(Event.GetScreenSpacePosition(), App.GetInteractiveTopLevelWindows());
		if (!Path.IsValid() || Path.Widgets.Num() == 0)
		{
			return TEXT("nothing (outside the window)");
		}
		const TSharedRef<SWidget> Deepest = Path.Widgets.Last().Widget;

		// The innermost UMG widget on the path says which part of the HUD or which menu it was.
		for (int32 Index = Path.Widgets.Num() - 1; Index >= 0; --Index)
		{
			const TSharedRef<SWidget> Widget = Path.Widgets[Index].Widget;
			if (Widget->GetType() == FName(TEXT("SObjectWidget")))
			{
				const UUserWidget* Owner = StaticCastSharedRef<SObjectWidget>(Widget)->GetWidgetObject();
				return FString::Printf(TEXT("%s in %s"), *Deepest->GetTypeAsString(), Owner ? *Owner->GetClass()->GetName() : TEXT("a UI widget"));
			}
		}
		return FString::Printf(TEXT("the game view (%s)"), *Deepest->GetTypeAsString());
	}

	/** Sees every key and mouse event first and never keeps one: it only watches. */
	class FInputLogProcessor : public IInputProcessor
	{
	public:

		virtual void Tick(const float DeltaTime, FSlateApplication& SlateApp, TSharedRef<ICursor> Cursor) override {}

		virtual bool HandleKeyDownEvent(FSlateApplication& SlateApp, const FKeyEvent& InKeyEvent) override
		{
			if (!InKeyEvent.IsRepeat())
			{
				Key(InKeyEvent, TEXT("down"));
			}
			return false;
		}

		virtual bool HandleKeyUpEvent(FSlateApplication& SlateApp, const FKeyEvent& InKeyEvent) override
		{
			Key(InKeyEvent, TEXT("up"));
			return false;
		}

		virtual bool HandleMouseButtonDownEvent(FSlateApplication& SlateApp, const FPointerEvent& MouseEvent) override
		{
			Mouse(SlateApp, MouseEvent, TEXT("down"));
			return false;
		}

		virtual bool HandleMouseButtonUpEvent(FSlateApplication& SlateApp, const FPointerEvent& MouseEvent) override
		{
			Mouse(SlateApp, MouseEvent, TEXT("up"));
			return false;
		}

		virtual bool HandleMouseButtonDoubleClickEvent(FSlateApplication& SlateApp, const FPointerEvent& MouseEvent) override
		{
			Mouse(SlateApp, MouseEvent, TEXT("double-click"));
			return false;
		}

		virtual bool HandleMouseWheelOrGestureEvent(FSlateApplication& SlateApp, const FPointerEvent& InWheelEvent, const FPointerEvent* InGestureEvent) override
		{
			if (ClockworksInputLog::IsEnabled() && !FMath::IsNearlyZero(InWheelEvent.GetWheelDelta()))
			{
				ClockworksInputLog::Write(FString::Printf(TEXT("[button] mouse wheel %s"), InWheelEvent.GetWheelDelta() > 0.f ? TEXT("up") : TEXT("down")), FColor::Cyan);
			}
			return false;
		}

		virtual const TCHAR* GetDebugName() const override { return TEXT("ClockworksInputLog"); }

	private:

		static void Key(const FKeyEvent& Event, const TCHAR* What)
		{
			if (ClockworksInputLog::IsEnabled())
			{
				ClockworksInputLog::Write(FString::Printf(TEXT("[button] %s %s"), *Event.GetKey().GetDisplayName().ToString(), What), FColor::Cyan);
			}
		}

		static void Mouse(FSlateApplication& App, const FPointerEvent& Event, const TCHAR* What)
		{
			if (ClockworksInputLog::IsEnabled())
			{
				ClockworksInputLog::Write(FString::Printf(TEXT("[button] %s %s, over %s"),
					*Event.GetEffectingButton().GetDisplayName().ToString(), What, *DescribeUnderCursor(App, Event)), FColor::Cyan);
			}
		}
	};

	TSharedPtr<FInputLogProcessor> Processor;
	int32 Listeners = 0;
}

// Runs on: the local machine.
bool ClockworksInputLog::IsEnabled()
{
	return CVarLogInput.GetValueOnGameThread() != 0;
}

// Runs on: the local machine. The screen copy lasts eight seconds, newest at the top.
void ClockworksInputLog::Write(const FString& Line, const FColor& Color)
{
	if (!IsEnabled())
	{
		return;
	}
	const FString Stamped = FString::Printf(TEXT("%7.2f  %s"), FPlatformTime::Seconds() - StartSeconds, *Line);
	UE_LOG(LogClockworks, Display, TEXT("Input: %s"), *Stamped);
	if (GEngine && CVarLogInput.GetValueOnGameThread() == 1)
	{
		GEngine->AddOnScreenDebugMessage(-1, 8.f, Color, Stamped);
	}
}

// Runs on: the local machine, from the local player controller's BeginPlay.
void ClockworksInputLog::StartListening()
{
	++Listeners;
	if (Listeners > 1 || !FSlateApplication::IsInitialized())
	{
		return;
	}
	StartSeconds = FPlatformTime::Seconds();
	Processor = MakeShared<FInputLogProcessor>();
	FSlateApplication::Get().RegisterInputPreProcessor(Processor);
	Write(TEXT("input log on. Console: Clockworks.LogInput 0 turns it off, 2 keeps it out of the game screen"), FColor::Cyan);
}

// Runs on: the local machine, from the local player controller's EndPlay.
void ClockworksInputLog::StopListening()
{
	if (Listeners == 0)
	{
		return;
	}
	--Listeners;
	if (Listeners > 0)
	{
		return;
	}
	if (Processor && FSlateApplication::IsInitialized())
	{
		FSlateApplication::Get().UnregisterInputPreProcessor(Processor);
	}
	Processor.Reset();
}
