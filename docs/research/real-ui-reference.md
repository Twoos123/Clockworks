# The real game's screens, as the user's screenshots show them

Written from screenshots of the live client (October 2026, client version 20261006114613) sent
by the user. Use it alongside the install's interface files and the decompiled client: where
the two disagree, check the client code; where the code is silent, follow this.

## Login and knight select

- **Login:** a deep-blue space backdrop with drifting, out-of-focus debris and orange flecks.
  - In the centre is a large planet (green and brown continents, glowing orange cracks, cyan
    glow) with a golden ring band, white cloud wisps and a small icy moon to the right.
  - The SPIRAL KNIGHTS logo sits over the planet.
  - A dark translucent panel holds ACCOUNT NAME and ACCOUNT PASSWORD fields, a Login as Guest
    check box, a status line, a wide Logon button, and Quit and Options buttons. A Terms of
    Service line and Help & Support / Forgot your password links sit under it.
  - The Grey Havens logo is at the bottom centre.
- **Knight select:** the same backdrop, with "SELECT A CHARACTER" above a panel of cards.
  - Each card has a gold name bar and the knight rendered full-body in its gear.
  - Under the knight are "Rank: Vanguard", "Guild: ---" and "Played: 17:05:23:35", with a
    small Delete button (red dot) at the bottom right.

## Town HUD (a town, after login)

- **Status panel:** the portrait, with the battle sprite's mini portrait overlapping its lower
  left. Next to it are the name plate, the health pips (11 red in the shot) with the 100% heart,
  and the shield bar.
- **Activities (right edge, open):** an ACTIVITIES title, then:
  - Go to Haven
  - (dots)
  - Missions
  - Guild Halls
  - Coliseum
  - Party Finder
  - (dots)
  - Supply Depot

  The handle's arrow sits at the panel's left. Folded, only the handle shows at the right edge.
- **Bottom left:** five tall buttons sit directly on the screen's bottom edge, with the handle
  to their right.
  - The buttons are main menu (wrench), help (F1), social (F6), feed (F7) and uplink.
  - The F1/F6/F7 badges hang below them.
- **Bottom right:** the handle, then four buttons, character (P), loadouts (L), forge (U) and
  arsenal (I).
  - The forge button shows a notice star when an item is ready to level.
- **Energy widget:** "Energy" with an energy icon and "00038", above the bottom-right menu
  and under the activities panel. It shows while the arsenal or forge is open.

## Main menu (the wrench button)

A popup list titled MAIN MENU, rising from the button:

- Arsenal (I)
- Character (P)
- Missions (M)
- Social (F6)
- Event Hub (F7)
- Recipes (F5)
- Achievements (O)
- Messages
- Options (Esc)
- Help (F1)
- Support
- Report a Bug
- Crucible
- Crucible Editor
- Purchase Energy
- Redeem Code

The wrench opens this menu. It does not open the options directly.

## Options (Esc)

The options screen covers the whole screen.
- **Frame:** a dark vertical-striped backdrop over the game, with the SPIRAL KNIGHTS logo at the
  top centre. Below the logo is a dark panel with tabs.
- **Tabs:** General, Video, Game, Chat, Controls, Prompts, Partner, About.
- **Bottom bar:** Quit, Logoff, (dots), Return to Haven (with an icon), OK.

What each tab holds:

- **General:**
  - Language (English) and Region (USA) dropdowns, with a "Party with Any" check box.
  - A boxed group of three sliders: Music Volume, Effect Volume, UI Volume.
  - A "Report a Bug" button.
- **Video:**
  - A boxed "Display Mode:" group: a resolution dropdown (1280x800), then Cancel and Apply.
  - "Graphics Quality" slider (High), "Video Options: Edit Advanced", and a "Camera shake
    effects" check box.
  - A boxed "UI Scaling:" group: a "100%" check button, a "Max!" button, and a slider whose
    label shows 100%.
- **Game:** check boxes, all on except Auto Target, then an "Edit Advanced" button. Under it:
  "Some options may require a client restart to take effect."
  - Allow Full Inspect
  - Show Attack Damage
  - Display Monster Health
  - Display NPC Names
  - Show Weapon Selection Wheel
  - Show Weapon Charge Meter
  - Show damage effects on HUD
  - Show "Lockdown" HUD Arrows
  - Auto Target by Default (off)
- **Chat:** Chat Area (Default), Chat Font (Small), Filter Mode (Comicify), Show Names (Speaking
  Distance), Show Rank (check box) and Loot Messages (All). An "Ignored Users" list with an
  Unignore button sits on the right.
- **Controls:**
  - Three big tiles: Mouse Movement, WASD Movement (selected, with a yellow keyboard icon) and
    Gamepad.
  - Below them, a wide "Custom (Click to Change)" button and the restart note.
- **Prompts:** "Confirmation Prompts:" heads a scrolling list of check boxes:
  - Learning recipe
  - Use an upgrade
  - Create party when none found
  - Offer to invite Steam friends
  - Offer to convert to Steam account
  - Offer end-of-session survey
  - Unbinding item with heat
  - Replace item variants
  - Removing a loadout
  - Unlocking a lockbox
  - …
  - Show Mission Introduction
  - Deposit to Guild Treasury
  - Installing a room
  - Installing a door
  - Installing a Guild Hall Theme
  - Installing a Guild Hall Environment
  - Show design mode hint
  - Install Battle Sprite Harness
  - Open Battle Sprite Pod
  - Abandon Party
- **Partner:** "Connect to Discord" on the left. On the right, a Steam group: Enable Voice
  Chat, Push to Talk, and a Voice Volume slider.
- **About:** a scrolling credits page. It starts with "Spiral Knights", the client version and
  "How Bizarre", then the Grey Havens logo and "© Grey Havens, LLC". Then:
  - **DESIGN, ART, MUSIC & SOUND, ENGINEERING:** gold headings with names under them.
  - **Production, Community, Additional Design, Additional Art, Additional Engineering and
    Operations:** blue headings, set in two columns.
  - **Community Contributors.**

## Help (F1)

A HELP window with tabs Support, Controls, Energy, Clockworks and Monsters. The Controls tab
reads:

- **Move:** Hold <None Assigned> or use <W><A><S><D>.
- **Attack:** <Left Mouse>. Hold to do a charge attack. <Left Mouse> also lifts large items,
  speaks to NPCs, and activates stations.
- **Change Weapon:** <Space> or <Wheel Down>.
- **Inventory:** <Tab>.
- **Defend:** Press and hold <Right Mouse>.
- **Chat:** Press <Enter> to enter chat or commands…, then "OPTIONS MENU" (a gold link).

Two big buttons, "Forums" and "Wiki", sit at the bottom.

## Social (F6) and Event Hub (F7)

Both dock at the left edge, side by side: SOCIAL first, then EVENT HUB.

- **SOCIAL:** a search field, then:
  - a FRIENDS (1/107) group with Friends Options and the online friends;
  - a GUILD (0) group with <No Guild> and Guild Options;
  - an OFFLINE section with a FRIENDS (106) list.
- **EVENT HUB:** groups Events (cards with INSPECT! or SIGN UP! buttons), Today, This Week and
  Last Week. Their cards carry "N minutes/days ago" timestamps.

On game open the Event Hub and the Spiral Uplink (NEWS tab) open by themselves.

## Spiral Uplink (mail button)

Tabs NEWS, MAIL and INVITES.
- **MAIL:** Mark All and Compose buttons, then a list with SUBJECT / FROM / DATE columns. A row
  reads "Join my guild!", "Sumerasum", "16 Sep 2026". The footer says "Note: Mail is
  automatically deleted 30 days after sent date."

## Forge (U), with Loadouts (L) and Arsenal (I)

Pressing U opens FORGE docked at the left, then the forge dial and RESULTS panels. LOADOUTS and
ARSENAL dock at the right; each window stacks beside the others, and each has its own red close
button.

- **FORGE list:** a search field, then Sort (Name) and groups Sword, Handgun, Bomb, Helmet, Armor
  and Shield with counts. Only items ready to level are listed (e.g. Blitz Needle ★5, Grim
  Repeater).
- **Dial:** the item name, its heat bar and "09 LEVEL". Below them, "Required Item" with the
  crystal ("Radiant Fire Crystal (21 Available)") and a big "x34".
  - "APPLY CRYSTALS" has three swirl buttons.
  - Under them, red text "Insufficient crystals to forge this item." and a disabled FORGE
    button.
- **Buy panel:** under the dial, a small panel offers the crystal with a stack count of 50
  ("Radiant Fire Crystal ★5") and a "Buy Item" button.
- **RESULTS:**
  - Chance for Forge Success: "100% Guaranteed chance of forge success!"
  - Enhancements: "Handgun Power Increase" and "Charge Time Reduction: Medium", each with an up
    arrow.
  - Possible Bonuses: "Add more fire crystals to unlock chances for bonuses!"
- **LOADOUTS:** a search field, then a "Lock 'n Load!" intro box ("Loadouts are configurations of
  equipment that you design! Here you can save your current configuration for later use or
  equip an existing loadout."). Below it:
  - entries such as <Current Equipment>, "Chaos Set", "Fast Swap Guns" and "Vana", each with
    PvE T2/T3 and PvP T3 bars;
  - "PvP Tier 3" at the bottom.
- **ARSENAL:** a search field, then Sort (Name) and groups Battle Sprite (1) and Sword (15),
  with item pills (name, star rank, variant pips). Crowns 17,152 sits at the bottom. Further
  down the list is a Rarity group: fire crystals, orbs of alchemy and Golden Slime Coin, with
  stack counts.

## Character (P)

A "<Current Equipment>" window with a "Save Loadout" button and a "Character Options ▼"
dropdown. The arsenal docks at the right with it.

- **Tabs:** Equipment, Costume, Battle Sprite, Achievements.
- **Battle Sprite tab:**
  - The sprite's family name ("DRAKON"), its heat bar and "59 LEVEL".
  - An Appetite bar.
  - "Required Item: Power Orb".
  - "Select a Power Orb to level up.", a slot and a LEVEL UP! button.
  - A column of skill icons.
  - The sprite turning in a view, with "Ready to level up!" above it and "Level 59 / Corona"
    below.

## The new-knight intro (Create a Knight)

From a recording of the real client, about 100 seconds; frames are in `.scratch/intro-frames`,
which is git-ignored and never committed. The whole intro has a rounded dark vignette at the
edges, like old film, and a small SKIP button at the bottom right.

1. **Opening:** bright cyan clouds, with captions in yellow text with a dark outline: "The Moral
   Wars have brought us to the brink of extinction." and then "We, the crew of the Skylark, fled
   to the stars seeking a source of incredible power, our last hope to save our homeworld."
2. **Fade to white:** a second caption fades through.
3. **Deep space:** a cyan nebula with a bright star and a lens flare. Caption: "What we
   discovered was beyond imagination. We discovered Cradle." The camera drifts toward a small
   planet.
4. **Cradle:** the planet with its golden ring and a moon.
5. **The Skyship Arcadia** (white, red and blue) flies past the planet.
6. **Comic panels:** the cockpit and its monitors, then panels set at angles. A speech bubble:
   "Captain! Energy signatures are shifting! I've never seen anything like-". The hooded
   captain is lit red.
7. **The attack:** pink lasers from the planet hit the ship, and it explodes. Bubble: "All hands:
   Evacuate the ship immediately!"
8. **The fall:** a white flash, then a tilted panel of an escape pod falling toward the planet,
   trailing fire.
9. **Title:** the planet again, then the SPIRAL KNIGHTS logo over it for a few seconds; the camera
   then zooms down into the planet.
10. **Black, then knight creation** at the crash site.

## Knight creation (at the crash site)

- **Scene:** the crash site in daylight, with the pod half-buried and smoking. Grassy cliffs sit
  behind, and out-of-focus grass blades are in the foreground. The knight stands at the right
  of centre, facing the camera, holding a proto sword and shield.
- **Panel (top left):** titled ARMOR. Three rows, each with a big round icon, a label, a slider
  with ◀ ▶ arrows, and the chosen value in italic under it: HELM "Spiral Sallet", ARMOR "Spiral
  Draped Armor", DESIGN "Heavy". A "RANDOMIZE" box with a dice button sits to its right.
- **Next:** a "Next ▼" bar under the panel moves to the next page (colours, name, and so on).
- **Back:** a "BACK" button with the knight emblem at the bottom left.
- **Spinning:** the user says the knight can be spun around.

## A full Clockworks floor (lobby → depth 1 → Level Complete)

From a 135-second recording of the real client; frames are in `.scratch/vid2` (one every 2
seconds, git-ignored). They show the gate lobby, then a Gremlin floor of Cooling Chamber.

- **Loading screen:**
  - A dark band across the middle of the screen with "Loading...39%" in gold.
  - At the left, a tip card: a cog icon, a title bar "The world is always changing...", and
    text: "The Clockworks below the surface cycle levels in real time. You will never see all
    the levels a world has to offer in a single trip. Only a true adventurer will discover all
    the secrets!"
  - Under the band, the level name in big gold italic ("Cooling Chamber") with the stratum
    under it ("Gremlin Grounds").
  - A gold "DEPTH 1" tab at the bottom right.
- **During play:**
  - Monsters show small red health bars above them.
  - Explosive blocks and timed explosive blocks (with a big digit countdown) go off in chains.
  - Damage numbers appear.
  - The chat area at the bottom left fills with grey loot lines as items are picked up (the
    Chat option "Loot Messages: All").
- **Floor end:** the knight walks onto the exit elevator. Then the Level Complete screen:
  - **Title:** "Level Complete!" in big gold letters across the top, over a darkened view.
  - **PRIZE WHEEL (left):** a gold title bar, then a tall panel where a reel spins and lands on
    a prize. It shows a silver crown coin, with "10 Crowns" in the reel's header strip. It
    stays up after the main window goes.
  - **Centre card:** "Advancing to:", "Jigsaw Valley", "Perimeter Promenade", "DEPTH 2", the
    knight posed on a bright burst, and "in 09 seconds..." counting down. Under it are a big
    "ADVANCE NOW" button (green knight icon, arrow) and a small "QUIT EXPEDITION" button: "Leave
    the party and return to Haven."
  - **HEAT ACQUIRED (right):** the heat bar, then one card per item that gained heat (icon, name,
    heat bar, level number). The levelled item is highlighted orange ("Blitz Needle 09 LEVEL").
    The note "Heat levels up your weapons and gear and makes them stronger." sits under them.
  - **After choosing:** the centre card goes. The prize wheel and heat panel stay over the next
    view for a moment.

## Combat up close (Jigsaw Valley, gremlins)

From a 45-second recording; frames are in `.scratch/vid3` (one per second, git-ignored).

- **Weapon switch:** a small card pops up beside the knight with the new weapon's icon and
  name ("Blitz Needle"), then fades.
- **Floating text:**
  - "Health At Max!" (white) over the knight when a heart is picked up at full health.
  - "FIRE!" (red-orange) over a monster as fire takes hold.
  - Damage numbers on hits.
- **Loot lines:** "You have obtained …" in the chat area at the bottom left, about eight lines
  stacked.
- **Shield:** a translucent bubble in the shield's own colour (green-tinted for this shield),
  with a bright ring at the knight's feet.
- **Quickbar:** the three weapons, then the pocket items (vials and capsules, with counts), then
  the vitapod slot.
- **Other sights:** explosions throw debris and leave scorch decals. Orange crystal blocks sit
  in clusters, and gremlins carry bombs and hammers.

## Haven tour: shops, alchemy, auction house, Arcade, forge

From a 215-second recording; frames are in `.scratch/vid4` (one every 2 seconds, git-ignored).

- **Loading into Haven:** the same loading screen, titled "Haven 5" (the town instance number)
  with "Town Square", "Bazaar" or "Arcade" under it.
- **Facing a vendor or machine:**
  - The top centre shows "Press ATTACK <Left Mouse> to browse vendor goods".
  - The target panel at the top shows the NPC's portrait icon, name and title ("Quillion /
    Blade Merchant", "Alchemy Machine").
  - Names float over NPCs and other players, with the title under NPC names. On a closer look
    (f025, f049, f073; vid6 f036) both lines are light grey Arial Black with a black outline
    (character/label.dat, colour print 514), and a prestige icon sits before some names
    (Basil). The only exception is the vendor being browsed: Quillion's title then shows in
    italic teal on a dark bar. No name shows over the player's own knight, which matches the
    client (KnightSprite hides the label of the actor the player controls).
- **Vendor (for example Quillion):**
  - A "VENDOR" list window docked at the left: item rows with icon, name and crown price (3,000
    / 7,500 ...), and a Preview button at the bottom.
  - ARSENAL docked at the right.
  - A "SHOPPING CART" window at the bottom centre, with the keeper's portrait big behind it, the
    cart lines, "CROWNS -7,500", Empty Cart and Checkout. Its footer row reads "GET 2,765 FOR
    ⊙100 ▶ Get Crowns! | Buy Energy".
  - The Energy widget shows at the bottom right.
- **Alchemy machine:**
  - A "RECIPES" list at the left: groups such as Bomb, Armor, Shield and Rarity, with a Preview
    button.
  - Beside it, a recipe card: the item's name, heat bar and "01 LEVEL", its stat bars, the
    bound-on-equip line, the description, the star rank and a 3D preview.
  - Next to the card, the ingredient list with have/need counts ("Blue Shard 450 / 15", "Spark
    Plug 558 / 4", ...), the crown cost (2,500) and a "Transmute" button.
  - An orb panel underneath: "Elite Orb of Alchemy ★4" with Buy Item.
  - ARSENAL at the right, and the energy widget.
- **Mysterious Alchemy Machine (the Arcade):** the same interaction, with the name floating over
  the machine.
- **Auction House:** an "AUCTION HOUSE" window at the left with categories, a results table and
  pages, with ARSENAL at the right. It is a player market, so a single-player port leaves it
  out.
- **Forge:** pressing Forge shows a centred "FORGING" title over the dial, with the item's icon
  in the middle while the lights run around the ring. Then comes the success or failure popup.
- **Loot line wording, exact:**
  - "You have obtained Material (Bronze Bolt)."
  - "You have obtained Rarity (Warm Fire Crystal)."
- **Haven activities:** Ready Room, Missions, Guild Halls, Coliseum, Party Finder, Supply Depot.

## Mission board, mission lobby and loadout menus

From an 83-second recording; frames are in `.scratch/vid6` (one every 2 seconds, git-ignored).

- **Loadouts (L):**
  - Clicking a loadout pops up a menu titled with its name ("Vana"): Equip Loadout, Unmark PvP,
    Remove Loadout.
  - The window docks at the right edge on its own when the arsenal is closed.
- **Mission board (M):**
  - **Header:** "MISSIONS", with "Prestige: 11,995" and "Rank: 10-3" at the top right and the
    red close button.
  - **Rank bar:** a cyan bar with the rank title ("VANGUARD") and a star badge at the left.
  - **Tabs:** RANK, PRESTIGE, EXPANSION and ARCADE (big icon tabs).
  - **Cards:** one row, each card labelled "RANK 10-2" with a lock or completed badge in its
    corner; the selected card is outlined gold. Arrows scroll the row.
  - **Under the cards:** the mission's name and description, and a gold objective line ("Prepare
    for the worst and journey to the Core"). Below that, REWARDS: Prestige 150, Spark of Life,
    "Eternal Orb of Alchemy ★5".
  - **CONFIGURE YOUR PARTY (right):**
    - Join Party, Create Public Party, Create Private Party and Play Solo buttons.
    - A difficulty selector, "◀ Normal ▶".
    - The big START button.
  - **Featured Items (docked left of the board):** two Supply Depot sale cards (item art, star
    rank, energy price such as ⊙3,363, "SALE", "2 hours left"), the Energy line (⊙00038), and
    "Show Full Supply Depot".
  - **First opening:** the intro page with the four category columns and empty panes (see the
    mission board notes earlier).
- **Mission lobby** (Dreams and Nightmares):
  - The arrival banner sits at the bottom centre: "Dreams and Nightmares" in big gold, with
    "Mission Lobby" under it.
  - A "CURRENT OBJECTIVE:" panel docks under the minimap ("Prepare for the worst and journey to
    the Core").
  - The lobby has an Alchemy Machine, a vendor with the shopping cart, and the exit elevator.
  - The knight is armed and the dungeon HUD shows.
- **Elevator:** the whole HUD hides. Only the "Advancing to:" card shows ("Dreams and
  Nightmares", "The Path is Revealed", "DEPTH 24", "in 09 seconds..."), with ADVANCE NOW and
  QUIT EXPEDITION ("Leave the party and return to Haven.").
- **Quitting the expedition:** a "REPORT" window shows the knight, then comes the loading screen
  back to Haven.

## Basil, the Traveling Merchant (mission lobby and terminals)

Frames: `.scratch/vid6/f035–f036`.

- **In the scene:** Basil stands in the mission lobby. "Basil" and the gold title "Traveling
  Merchant" float over him, and the target panel at the top reads "Basil / Traveling Merchant".
- **His shop:** the same layout as a Haven vendor. VENDOR is docked left, ARSENAL right, and
  the SHOPPING CART sits at the bottom centre with Basil large behind it. The cart's footer
  reads "GET 2,765 FOR ⊙100 ▶ Get Crowns! | Buy Energy", and the Energy widget shows at the
  bottom right.
- **His stock**, in groups with counts and crown prices:
  - Capsule (2): Remedy Capsule 100, Ultra Health Capsule 500.
  - Vial (4): Ultra Fire Vial, Ultra Freeze Vial, Ultra Poison Vial and Ultra Shock Vial, 250
    each.
  - Equippable (1): Vitapod +12, 3,000.
  - More groups above these, scrolled out of view.

## Knight creation, every page, and the crash site

From a 52-second recording; frames are in `.scratch/vid7` (one every 2 seconds, git-ignored).
This corrects the earlier note that the client skips the Details window: it does not.

- **The pages:** ARMOR, then DETAILS, then PERSONALIZE, then the name, opened in that order with
  "Next ▼".
  - Each page shows big round icons, a label, a slider with ◀ ▶ arrows and the chosen value in
    italic.
  - A RANDOMIZE box with a dice button sits beside the open page.
  - A finished page collapses to a header bar showing small icons of its choices and a ✓.
    Clicking a header reopens that page.
  - **ARMOR:** HELM (Spiral Sallet), ARMOR (Spiral Draped Armor), DESIGN (Heavy).
  - **DETAILS:** ACCESSORY 1 (e.g. Headband) and ACCESSORY 2 (e.g. Mecha Wings).
  - **PERSONALIZE:**
    - HEIGHT (e.g. Tall).
    - EYES (e.g. Happy Eyes).
    - PERSONAL COLOR, a rainbow hue slider with ◀ ▶ that recolours the knight's trim and visor
      live.
  - **The name:** all three headers collapse. An "ENTER YOUR NAME:" box sits at the bottom
    centre, with a text field and a dark bar under it, and a big "START" button (green knight
    icon and arrow) at the bottom right.
  - BACK (with the emblem) stays at the bottom left throughout.
- **After START:**
  1. The loading screen: "The Crash Site" with "Waking up to a New World" under it, and a tip
     card.
  2. The game opens in letterbox, with black bars at the top and bottom, for a radio call.
     - A "Rhendon" speech panel on the left: "...come in, <Name>, are you there? This is Recon
       Knight Rhendon!"
     - Rhendon's portrait on a green screen with a signal meter, lower left.
     - The player's knight portrait, lower right.
     - The reply row: "● I'm here, what happened?" with a "◀ SPACE" hint.
     - "Use the arrow keys and spacebar to navigate the conversation."
  3. Play in the crash site, at rank 1-1, with the full HUD.
     - Tutorial hint boxes are pinned in the world: "Clear the Path / Attack with <Left Mouse>",
       and "Monsters Ahead! / Aim at enemies with your mouse and attack with <Left Mouse>".
     - Tutorial items lie on the ground, and the path leads up the stairs, past a pool, to the
       Rescue Camp.

## Options in motion: UI scale and Controls

From a 16-second recording; frames are in `.scratch/vid8` (git-ignored).

- **UI Scaling (Video tab):** ticking "Max!" (orange, it gains a ✓) jumps the scale to the
  screen's largest, 130% at 1335x800.
  - The "100%" button greys out, and the slider moves to its right end and is disabled. Its
    label reads "130%".
  - The whole interface redraws larger at once, the options screen and HUD included.
  - The Display Mode dropdown shows the window size ("1335x800").
- **Controls tab:** hovering a tile darkens it and turns its icon and label yellow. The
  selected scheme looks the same, and in the last frame "Custom (Click to Change)" is
  selected that way. The HUD stays visible but dimmed behind the options.

## The mission board's four tabs

From a 20-second recording; frames are in `.scratch/vid9` (one every 2 seconds, git-ignored).

- **ARCADE tab: the Arcade's gates are chosen here.** It is the same board as the Arcade's gate
  machines.
  - **Cards:** one per gate, with its emblem art and name: Diamond Bishop Gate, Dark Serpent
    Gate, Sapphire Queen Gate, Coral King Gate. The selected card is outlined gold with a
    pointer under it.
  - **Two sub-tabs:**
    - "Gate Map" shows the gate's map, rows of stratum and level icons with arrows, as on the
      gate map site.
    - "Gate Materials" lists the materials each tier drops: "TIER 2 / Depths 08-12", then a
      two-column list with icon, name, star rank and count (Ironwood ★4, Rocky Core ★4, Brute
      Core ★3, Redwood ★3, Driftwood ★2, Gel Core ★2, ...).
  - **Right side:** CONFIGURE YOUR PARTY (Join Party, Create Public Party, Create Private Party,
    Play Solo) and the difficulty bar.
  - **Tier buttons:** "TIER 1 (Depth 0)", "TIER 2 (Depth 8)", "TIER 3 (Depth 18)", then START.
- **PRESTIGE tab:**
  - **Cards:** labelled REPLAYABLE, TODAY or TOMORROW (March of the Tortodrones, Heart of Ice,
    Nature of the Beast, Monstrous Research, ...). Arrows scroll the row.
  - **Exchange missions** (e.g. Monstrous Research):
    - the description and a gold instruction line, with REWARDS Prestige 60;
    - a MATERIALS list at the right with have/need and a magnifier ("Phial of Phear 111 / 1",
      "Redwood 199 / 1", "Torchstone 326 / 1");
    - TOGGLE ARSENAL, then a ticked "Confirm these items to be exchanged for the Mission
      Rewards.", then START with a coin icon.
- **EXPANSION tab:** Operation Crimson Hammer cards (red), with long briefing text.
- **RANK tab:** as described earlier.
- **Featured Items timer:** it counts down ("1 more hour").

## Character window tabs and item tooltips

From a 40-second recording; frames are in `.scratch/vid10` (one every 2 seconds, git-ignored).

- **Compare tooltips** (hovering an arsenal pill): two tooltip cards sit side by side to the
  left of the ARSENAL. The worn item is on the left with "EQUIPPED SWORD" in its footer, the
  hovered item on the right with "SWORD".
  - Each card has a gold title bar with the name and "NN LEVEL" (or "-COMPLETE-" under the name
    once maxed), the heat bar, and the attack bars (NORMAL, ELEMENTAL, SPEED).
  - Then the bonus rows, each with an up-arrow badge: "Good chance of causing Strong FIRE",
    "Attack Speed Increased: High", "Charge Time Reduction: Medium", "Damage Bonus vs Beast:
    High".
  - Then "This item is bound to you.", the description, the star rank, and the 3D model.
- **Character window (P)**, titled "<Current Equipment>" with Save Loadout and "Character
  Options ▼":
  - **Equipment tab:**
    - A narrow slot column at the left, with the worn items' icons and padlocks on locked
      slots.
    - A big 3D view of the knight in a blue room.
    - Under the knight: "Vanguard(10-3)", the name in gold ("Twoos") and "★ 11,995" (prestige).
  - **Battle Sprite tab, skills page:**
    - A skill ("Firestorm") with its icon, then "Skill Points: 0".
    - Three upgrade rows, each with a bar, a "+" button and a tooltip ("Extra Crispy" /
      "Increases the potency of the fire and chance of …", "SKILL POWER").
    - Cancel and Confirm buttons.
    - "Cooldown: 55 seconds" and the skill text ("Summon the power of true dragon fire to burn
      everything in your path.").
    - The sprite's skill icons in a column, and the sprite in its view ("Level 59 / Corona").
  - **Achievements tab:** a grid of square achievement icons. Earned ones are coloured (gold,
    red, purple), unearned ones grey-blue, and some show padlocks. It scrolls.
