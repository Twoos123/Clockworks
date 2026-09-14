// Copyright Epic Games, Inc. All Rights Reserved.

using UnrealBuildTool;

public class Clockworks : ModuleRules
{
	public Clockworks(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[] {
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore",
			"EnhancedInput",
			"AIModule",
			"NavigationSystem",
			"StateTreeModule",
			"GameplayStateTreeModule",
			"Niagara",
			"UMG",
			"Slate",
			"GameplayAbilities",
			"GameplayTags",
			"GameplayTasks"
		});

		PrivateDependencyModuleNames.AddRange(new string[] { });

		PublicIncludePaths.AddRange(new string[] {
			"Clockworks",
			"Clockworks/AbilitySystem",
			"Clockworks/AI",
			"Clockworks/Variant_Strategy",
			"Clockworks/Variant_Strategy/UI",
			"Clockworks/Variant_TwinStick",
			"Clockworks/Variant_TwinStick/AI",
			"Clockworks/Variant_TwinStick/Gameplay",
			"Clockworks/Variant_TwinStick/UI"
		});

		// Uncomment if you are using Slate UI
		// PrivateDependencyModuleNames.AddRange(new string[] { "Slate", "SlateCore" });

		// Uncomment if you are using online features
		// PrivateDependencyModuleNames.Add("OnlineSubsystem");

		// To include OnlineSubsystemSteam, add it to the plugins section in your uproject file with the Enabled attribute set to true
	}
}
