# HandyMap UI/UX proposals

Draft · 10 September 2026

Implementation note: The three improvements below now have an implementation in this workspace.
The observations describe the original interface.
See [the next design proposals](design-proposals.md) for three further visual directions.

Start with proposal 1. It addresses the distance between the map, the form, and the result on mobile.
Keep the dark green palette, lime accent, and informal product voice.

I reviewed the map, form, card, full-screen code, and API guide source.
I inspected the local interface in Chromium at 1440 × 1000 and 390 × 844.
Browser checks covered map selection, text validation, and three pings at the same location.
The checks used controlled WebSocket messages.
They did not verify the hosted service, real phone keyboards, or user task times.

| Proposal                                 | Intended result                                       | Relative effort | Suggested order |
| ---------------------------------------- | ----------------------------------------------------- | --------------- | --------------- |
| 1. Bring the map and form together       | Help a visitor send and find their first ping         | Medium          | First           |
| 2. Make every active ping reachable      | Help viewers read pings that overlap                  | Medium          | Third           |
| 3. Explain limits and submission results | Help visitors correct errors and decide when to retry | Small–medium    | Second          |

Effort estimates describe scope. They are not delivery commitments.

## 1. Bring the map and form together

**Observed problem.** At 390 × 844, the map starts at approximately y=405 and has a height of 199 pixels.
The latitude field starts at y=962. The Send button starts at y=1346.
A visitor must scroll away from the map to enter their story.
Success updates text below the button but does not bring the accepted ping into view.
At 1440 × 1000, the Send button also extends below the initial viewport.

**Proposed experience.** Shorten the introduction and put a visible “Send a ping” action beside the map.
On mobile, this action opens a bottom panel with two steps: location, then story.
The location step offers “Pick on map” and “Enter coordinates.”
Keep the coordinates available as a keyboard alternative.
A map selection reveals “Use this spot” beside the selected coordinates.
Confirmation opens the story step and moves focus to its title field.

Show title and message first. Put the optional image field under “Add an image.”
Keep the visibility and lifetime notice beside Send.
Use 16-pixel input text and controls with a minimum height of 44 pixels as design targets.
Keep the desktop form beside the map, with the same shorter field order.

After acceptance, close the mobile panel and reveal the new ping with an explicit selected state.
Offer “View your ping” beside the success message on desktop.
Keep draft text when a visitor closes and reopens the panel.
Full-screen mode needs the same entry action inside the map panel.

**Scope and tradeoff.** Change the page structure, responsive styles, form state, and full-screen focus behavior.
The extra step reduces the amount visible at once but adds one confirmation action.
Use explicit confirmation to prevent an accidental map tap from opening the form.

**Acceptance checks.**

- Show the map and entry action without a scroll at 390 × 844.
- Complete the flow with touch or a keyboard, including manual coordinates.
- Keep the active field and Send control reachable with a phone keyboard open.
- Restore focus when the panel closes. Preserve the draft after errors.
- Reveal the accepted ping while it remains active. Show an expired state if it expires first.

Evidence: [page structure](../index.html), [responsive layout](../src/client/style.css), [submission behavior](../src/client/map.ts), [full-screen behavior](../src/client/fullscreen.ts).

## 2. Make every active ping reachable

**Observed problem.** Three pings at identical coordinates produced three buttons with identical bounds.
The map reported three active pings but displayed one dot at that position.
The targets measure 26 × 26 pixels on desktop and 28 × 28 pixels on mobile.
There is no separate list of active pings.
The mobile card also covers the page introduction and part of the map toolbar in the tested position.

**Proposed experience.** Add an “Active pings” list beside the desktop map and below the mobile map.
Each row shows the title, coordinates, and remaining lifetime.
Selecting a row highlights its map position and opens its details.
Keep rows in a stable order while a visitor reads or uses the keyboard.
Show “No active pings” and the send action when the list is empty.

Replace overlapping targets with a count button, such as “3.”
That button opens the matching rows rather than hiding earlier pings beneath newer ones.
Group targets by their screen positions and recalculate groups after resize or full screen.
Use a bottom detail panel on mobile with a clear close control.
Use at least 44-pixel targets for list rows, groups, and detail controls.

**Scope and tradeoff.** Reuse the active ping data already held by the browser.
Add the list, overlap groups, selected state, and coordinated focus behavior.
The list uses screen space and repeats some card content.
Keep secondary details inside the card to limit that cost.
Remove expired content from both views. This proposal does not introduce an archive.

**Acceptance checks.**

- Reach and read each of three pings at identical coordinates with touch and keyboard controls.
- Keep the selected row and map marker consistent after resize and full screen.
- Announce expiry once when an open ping expires. Move focus to a stable control.
- Test an empty map and a dense map without constant screen-reader announcements.

Evidence: [dot and card behavior](../src/client/map.ts), [target sizes and card styles](../src/client/style.css).

## 3. Explain limits and submission results

**Observed problem.** The form does not show title or message limits before submission.
An 81-character title produces a shared error beneath Send.
Focus stays on Send, and the title field has no `aria-invalid` attribute.
The client displays API error text but does not use `retryAfterMs` or `Retry-After`.
The map's quiet-state message also remains present during connection failures.

**Proposed experience.** Add counters beside title and message: “0 / 80” and “0 / 160.”
Count trimmed Unicode code points to match the server contract.
Show an error beside the affected field and connect it with `aria-describedby`.
Set `aria-invalid` and focus the first invalid field after submission.

Distinguish pending, accepted, rejected, and unconfirmed results.
For a shared rate limit, show a countdown from the server's retry information.
Enable a manual retry after that delay. Another caller can still take the next slot.
For the daily limit, show the reset time in the visitor's local time.
Preserve the existing caution after a network failure because the server can accept a request before its response arrives.

Replace the quiet-state invitation with connection-specific text until the browser receives a live snapshot.
Keep connection status separate from submission status: a broken WebSocket does not prove that a POST failed.
Retain the existing Reconnect control.

**Scope and tradeoff.** Change field feedback, API error handling, and map status copy.
Counters add visual detail. Keep them beside their fields and show error copy only when needed.
Do not automatically resubmit an unconfirmed request.

**Acceptance checks.**

- Verify boundary lengths with ordinary text and emoji against the server's counting rule.
- Identify the invalid field through visible text, focus, and assistive technology.
- Verify shared limits, daily limits, service failures, and unconfirmed requests as separate states.
- Preserve form values after every error. Announce status changes without announcing each countdown tick.

Evidence: [form markup](../index.html), [validation and connection states](../src/client/map.ts), [API contract](../src/protocol.ts), [API guide](index.html).

## Review evidence and follow-up

Local screenshots and measurements are in `.context/ui-review/`.
The files include empty desktop and mobile views, open cards, and `observations.json`.
The production build passed during this review.
This document records the original proposal scope.

After implementation, compare task completion with the current interface in a small moderated session.
Ask participants to send a ping, open an overlapping ping, and recover from a rejected submission.
Record completion, errors, and time to find the accepted ping.
The expected benefits above remain hypotheses until that comparison.
