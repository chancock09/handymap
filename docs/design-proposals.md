# Three design directions for HandyMap

Selected direction: Open atlas with the Quiet paper feed as a horizontal ticker.
The workspace implements this combination. The preview below preserves the three original proposals.

These proposals build on the implemented form, active list, and error feedback.
Open the [interactive design preview](design-proposals.html) to compare desktop and phone layouts.
The preview uses sample pings. It does not send requests or change the app.

## 1. Open atlas — recommended

**Purpose:** Give the map most of the screen and show controls when a visitor needs them.

Use one compact header with the brand, live status, API guide, and Send action.
Remove the large introduction, outer workspace border, API strip, and repeated map captions.
Keep one short instruction inside the map.
An activity button at the bottom shows the current count and opens the active list.
The existing form opens from Send, while ping details remain attached to the map.

On phones, place the activity button above the bottom safe area.
Use the existing bottom panels for the form and ping details.
Keep the send action visible when the active list opens.

**Visual rules:** Keep the dark green palette and lime signals.
Reserve borders for controls and open panels.
Use one heading, one instruction, and one status for each task.

**Tradeoff:** A viewer needs an extra action to open the list.
Keep its count visible to make that action clear.

**Relative effort:** Medium. Reuse the form, list, grouping rules, and expiry behavior.

**Review checks:** Show the map, Send action, and activity count without page scroll at 390 × 844 and 1440 × 900.
Keep map targets clear of the controls.
Check the empty, disconnected, and open-panel states.

## 2. Compact desk

**Purpose:** Support frequent use with the map and controls in one stable workspace.

Place the map beside one side panel beneath a compact header.
The panel has two tabs: Activity and Send.
Both tabs use the same width and height.
Keep the draft when the visitor switches tabs.
After acceptance, select Activity and highlight the new ping.

Remove the separate introduction, caption strip, and lower API section.
Use one connection status in the header.
Keep the lifetime note beside the Send button instead of repeating it across sections.

On phones, put the tabs below the map.
The Send tab opens the existing form panel, then returns to Activity after acceptance.

**Visual rules:** Keep the current palette.
Use a single divider between the map and panel.
Use a consistent type scale: 24-pixel titles, 16-pixel inputs, and 13–14-pixel support text.

**Tradeoff:** The active list hides while the visitor writes a ping.
Keep its count on the Activity tab.

**Relative effort:** Medium. Add tab state and adapt the current layout.

**Review checks:** Keep the desktop header and primary controls within a 900-pixel viewport height.
Check tab focus, draft preservation, long titles, and arrival of new pings during form use.

## 3. Quiet paper

**Purpose:** Give the app a lighter character with clear text and fewer visual containers.

Use a warm off-white background, forest text, pale green land, and dark green signals.
Replace the uppercase section labels with short sentence-case headings.
Remove nested cards and use space or thin rules to separate content.
Keep one compact introduction and one Send action.

Place three readable ping summaries below the desktop map.
Let the active list scroll within that area when it contains more pings.
Stack those summaries below the map on phones.
Open the existing form and details only when a visitor selects an action.

**Visual rules:** Use the lighter palette across the map, forms, cards, and API guide.
Reserve the darkest green for text and primary actions.
Use larger text instead of extra borders to define the hierarchy.

**Tradeoff:** This direction changes the app's visual character and requires a new palette across all states.
It also leaves less room for a dense active list on desktop.

**Relative effort:** Medium to large. Change shared style tokens and review each page and state.

**Review checks:** Measure text and control contrast for the new palette.
Check map visibility in bright conditions, reduced motion, and error states.
Review a long title and a failed image before choosing the final spacing.

## Decision

Start with Open atlas if the map is the main reason to visit.
Choose Compact desk if repeated submission and activity review are the main tasks.
Choose Quiet paper if a lighter visual identity is the main aim.

These are proposed outcomes and scope estimates, not measured usability gains or delivery commitments.
The preview keeps sample times fixed so the designs remain easy to compare.
Its city names describe sample data. The app still uses coordinates.
