/professional /expert /production-grade /enterprise-level

XCONNECT — PRESENTER WORKFLOW FIX + FINAL THEME REFINEMENT

IMPORTANT:
This is an EXISTING XConnect application that has already been designed and implemented.

The current Attendee experience is approved.
The current Admin experience is approved.
The current Launch/Splash experience is approved.
The current overall Light Theme is approved.

DO NOT redesign the application.

DO NOT recreate the application from scratch.

DO NOT make broad UI changes.

This task is a targeted production-grade refinement to fix specific Presenter workflow issues and make one small global navigation/theme adjustment.

Everything not explicitly mentioned below MUST remain exactly as it currently is.

============================================================
1. ABSOLUTE PRESERVATION RULE
============================================================

Treat the following as LOCKED / APPROVED:

A. LAUNCH / SPLASH SCREEN
B. ATTENDEE EXPERIENCE
C. ADMIN EXPERIENCE
D. CURRENT LIGHT-THEME UI
E. EXISTING PRESENTER VISUAL DESIGN, except for the specific fixes listed below

Do not alter their layouts, functionality, spacing, components, animations, typography, content, or behavior unless explicitly required by this prompt.

The goal is:

EXISTING XCONNECT
+
TARGETED FIXES
=
POLISHED PRODUCTION-GRADE XCONNECT

NOT:

EXISTING XCONNECT
→ COMPLETE REDESIGN


============================================================
2. LAUNCH / SPLASH SCREEN — ABSOLUTELY LOCKED
============================================================

DO NOT TOUCH THE LAUNCH / SPLASH SCREEN.

This screen is already FINAL and PERFECT.

It must remain 100% unchanged.

Do NOT modify:

- Launch background
- Launch colors
- Launch X logo
- X logo artwork
- X logo position
- X zoom animation
- X animation timing
- X animation easing
- Connect animation
- Connect positioning
- XConnect formation animation
- XConnect final position
- Circular/radio/radar wave
- Wave animation
- Animation duration
- Transition into the application

DO NOT apply any new theme changes to the launch screen.

DO NOT replace the launch logo.

DO NOT recolor the launch screen.

DO NOT redesign the launch screen.

The launch screen is READ-ONLY and must remain exactly as it currently appears.


============================================================
3. GLOBAL THEME — REMOVE DARK MODE COMPLETELY
============================================================

There are currently two themes:

- Light Mode
- Dark Mode

REMOVE DARK MODE COMPLETELY.

The application must have ONLY ONE THEME:

LIGHT MODE.

Remove the dark theme from the user-facing application.

Specifically:

- Remove the Light/Dark theme toggle if present.
- Remove Dark Mode from settings/preferences.
- Remove dark-theme selection controls.
- Do not expose any way for users to switch to Dark Mode.
- The application should always launch into/use the approved Light Theme.

IMPORTANT:

DO NOT redesign the Light Theme.

The current Light Theme is already approved.

Preserve its:

- Backgrounds
- Cards
- Typography
- Spacing
- Buttons
- Inputs
- Shadows
- Borders
- Icons
- Layout
- Visual hierarchy
- Components

Only make the bottom navigation change described below.


============================================================
4. BOTTOM NAVIGATION / FOOTER THEME
============================================================

The current bottom navigation/footer is WHITE.

Change ONLY the bottom navigation/footer.

New bottom navigation background:

#0F2F2C

Bottom navigation icons:

#FFFFFF

Bottom navigation labels/text:

#FFFFFF

This applies consistently to:

- Attendee
- Presenter
- Admin

The rest of the application remains the existing Light Theme.

The visual structure should therefore be:

WHITE / LIGHT APPLICATION UI

with

DARK TEAL BOTTOM NAVIGATION
#0F2F2C

and

WHITE NAVIGATION ICONS + LABELS
#FFFFFF


============================================================
5. BOTTOM NAVIGATION — DO NOT CHANGE THE ROLE STRUCTURE
============================================================

Keep the already-approved role-specific navigation structure.

ATTENDEE:

Home | My Activity | Profile

PRESENTER:

Home | Roster | Analysis | Profile

ADMIN:

Monitor | Profile

Do NOT add or remove any navigation items.

Only change the visual treatment of the navigation bar:

Background:
#0F2F2C

Icons:
#FFFFFF

Labels:
#FFFFFF

Maintain the existing active/inactive behavior and navigation functionality.

Do not redesign the navigation component.

============================================================
6. ATTENDEE — LOCKED
============================================================

The Attendee experience is already correct.

DO NOT CHANGE IT.

Preserve:

- Attendee Home
- Begin Detection
- Existing live-session experience
- Existing Session History
- My Activity
- Profile
- Attendee role restrictions
- Existing navigation
- Existing interactions
- Existing layout

Only apply the global bottom-navigation color change and removal of Dark Mode.

DO NOT modify Attendee Session History.

DO NOT modify Attendee Home.

DO NOT modify Attendee workflow.

============================================================
7. ADMIN — LOCKED
============================================================

The Admin experience is already correct.

DO NOT CHANGE THE ADMIN EXPERIENCE.

In particular, preserve the existing:

- Monitor screen
- Room monitoring
- Session activity
- Room information
- Active-session information
- Monitoring UI
- Admin functionality
- Admin Profile
- Admin workflow

DO NOT redesign Monitor.

DO NOT change the Monitor layout.

DO NOT change its content.

DO NOT change its functionality.

Only apply:

- Dark Mode removal
- Bottom navigation background #0F2F2C
- Bottom navigation icons/labels #FFFFFF

Admin navigation remains:

Monitor | Profile

============================================================
8. PRESENTER — TARGET OF THIS UPDATE
============================================================

The Presenter UI is generally correct.

Do NOT redesign it.

Only fix the following three issues:

1. Presenter Home / Session History
2. Presenter Home → Host/Anchor workflow
3. Presenter Active Hosting → Attendee roster preview

Everything else in Presenter should remain unchanged.


============================================================
9. PRESENTER HOME — CORRECT THE LANDING EXPERIENCE
============================================================

CURRENT PROBLEM:

When the Presenter selects Home, the application currently takes the Presenter directly into:

Choose Room
→ Room selection
→ Session setup
→ Start Presence / hosting

This is NOT the desired Home experience.

The Choose Room flow should NOT be the Presenter Home screen.

The Presenter Home must instead be a dashboard/landing screen.

------------------------------------------------------------
DESIRED PRESENTER HOME
------------------------------------------------------------

When the Presenter taps:

Home

they should land on the Presenter Home dashboard.

The Home screen must contain:

1. Host / Anchor Room primary action
2. Presenter Session History below it

Conceptually:

------------------------------------------------

XConnect

Host / Anchor Room

------------------------------------------------

Session History

Past hosted sessions...

------------------------------------------------

The exact existing XConnect visual design should be preserved.

Do not introduce an entirely new design language.

============================================================
10. PRESENTER HOME — HOST / ANCHOR ROOM
============================================================

The Presenter Home should contain a clear primary action:

Host / Anchor Room

This is the entry point to the hosting workflow.

The Presenter should NOT immediately be shown the Choose Room screen simply by opening Home.

Instead:

Presenter opens Home
        ↓
Sees Host / Anchor Room
        ↓
Presenter taps Host / Anchor Room
        ↓
Choose Room
        ↓
Room/session setup
        ↓
Session code / relevant existing setup
        ↓
Start hosting / anchoring
        ↓
Active hosting screen

The existing Choose Room and hosting screens should remain functionally and visually intact.

Only change their ENTRY POINT.

DO NOT redesign Choose Room.

DO NOT redesign Session Setup.

DO NOT redesign the active hosting screen except for the roster-preview change specified later.


============================================================
11. PRESENTER SESSION HISTORY ON HOME
============================================================

This is a REQUIRED FIX.

The Presenter Home currently does not show Session History correctly.

Add/restore Presenter Session History directly on the Presenter Home screen.

The Session History must represent:

PAST SESSIONS THAT THE PRESENTER HOSTED / ANCHORED.

It must NOT represent sessions the Presenter attended.

The distinction must remain clear:

ATTENDEE:
Past sessions attended.

PRESENTER:
Past sessions hosted/anchored.

------------------------------------------------------------
SESSION HISTORY CONTENT
------------------------------------------------------------

Show the Presenter's recent historical hosted/anchored sessions.

The Home screen should show approximately the latest 4–5 sessions when available.

Each history item should provide useful existing session information such as:

- Room name
- Session name/code where already supported
- Date
- Time
- Session status/history
- Relevant attendee information where already available

Do not invent new data.

Use the data already supported by the application.

The visual presentation should be compact, readable, and professional.

Do not allow Session History to overwhelm the primary Host / Anchor action.

The priority should be:

1. Host / Anchor Room
2. Recent Session History


============================================================
12. PRESENTER SESSION HISTORY — INTERACTION
============================================================

The Presenter should be able to select a previous hosted session.

When a historical session is selected:

Open the existing appropriate historical/session-detail experience.

The Presenter should be able to review the attendees associated with that past hosted session where the existing application supports this information.

Do NOT create a completely new unrelated history system.

Reuse existing session/roster structures wherever possible.

The key requirement is:

Presenter Home
→ Session History
→ Select previous hosted session
→ View its historical session/attendee information


============================================================
13. PRESENTER ACTIVE HOSTING SCREEN — ROSTER PREVIEW
============================================================

The current Presenter Active Hosting / Anchoring UI is visually good.

KEEP THE EXISTING DESIGN.

There is already a:

View Full Roster

action.

That workflow is CORRECT.

DO NOT REMOVE IT.

DO NOT CHANGE where it navigates.

The only required improvement is the visibility of attendees on the Active Hosting screen itself.

------------------------------------------------------------
CURRENT ISSUE
------------------------------------------------------------

Currently the hosting screen does not provide enough visible attendee information.

The Presenter has to select:

View Full Roster

before being able to properly see the attendee list.

This is not ideal for quick live monitoring.

------------------------------------------------------------
REQUIRED BEHAVIOR
------------------------------------------------------------

The Active Hosting page itself must display a compact live attendee preview.

Approximately:

3–4 attendees

should be visible directly on the hosting screen when attendees are present.

For example:

Active Room

Room: [Existing Room]

Session: [Existing Session]

Status: Active

--------------------------------

Live Attendees

• Attendee 1
• Attendee 2
• Attendee 3
• Attendee 4

View Full Roster

--------------------------------

The exact styling should follow the existing Presenter hosting UI.

Do NOT create a completely new component style.

============================================================
14. ACTIVE HOSTING PAGE MUST BE SCROLLABLE
============================================================

The Presenter Active Hosting page must support normal vertical scrolling.

The entire page should be scrollable so that the Presenter can naturally move through:

- Session information
- Live presence information
- Attendee preview
- Other existing hosting information
- View Full Roster

Do NOT create a fixed, clipped, or hidden attendee section.

The first 3–4 attendees should be visibly accessible without opening another page.

If there are more attendees than can reasonably fit in the preview, that is fine.

The Presenter can then select:

View Full Roster

to access the complete attendee list.

============================================================
15. VIEW FULL ROSTER — PRESERVE EXISTING FLOW
============================================================

The existing:

View Full Roster

button/action is CORRECT.

KEEP IT.

When selected:

→ Navigate to the existing full live attendee roster screen.

Do not redesign the full roster screen unless required for basic scrolling/visibility.

Do not change its existing purpose.

The desired flow is:

ACTIVE HOSTING PAGE
        ↓
First 3–4 attendees visible
        ↓
View Full Roster
        ↓
FULL LIVE ROSTER


============================================================
16. PRESENTER ROLE RESTRICTIONS — PRESERVE
============================================================

Presenter remains a Presenter.

Presenter should:

✓ Host / Anchor rooms
✓ View current attendee roster
✓ View historical hosted sessions
✓ View historical session attendees where supported
✓ View Analysis
✓ Edit Profile

Presenter should NOT:

✗ Use Attendee Begin Detection
✗ Function as an Attendee
✗ Access Admin Monitor
✗ Access Admin-only controls

Do not change existing role permissions beyond fixing the specific workflow described above.


============================================================
17. VISUAL / UX QUALITY REQUIREMENTS
============================================================

The final Presenter experience must be:

- Enterprise-level
- Production-grade
- Clean
- Professional
- Intuitive
- Modern
- Attractive
- Consistent with the existing XConnect UI
- Easy to understand
- Easy to navigate

Avoid:

- Excessive animation
- Unnecessary gradients
- Excessive shadows
- Decorative UI
- Oversized components
- Clutter
- Unnecessary cards
- Unnecessary redesigns

The application should feel like a mature enterprise product.

The Presenter should immediately understand:

"Host/Anchor Room"
→ Start a hosted session

"Session History"
→ Review previous hosted sessions

"View Full Roster"
→ See all current attendees


============================================================
18. RESPONSIVE BEHAVIOR
============================================================

Ensure the Presenter Home and Active Hosting pages work properly on supported mobile screen sizes.

In particular:

- Home should scroll naturally if Session History extends beyond the viewport.
- Active Hosting should scroll naturally.
- Attendee preview should not be clipped.
- 3–4 attendees should be visibly accessible where screen size permits.
- View Full Roster should remain easy to tap.
- Bottom navigation must remain accessible.
- No content should overlap the bottom navigation.
- Respect safe-area/inset behavior.
- Do not allow text or controls to be clipped.

============================================================
19. DO NOT MODIFY THESE AREAS
============================================================

Unless explicitly required above, DO NOT modify:

LAUNCH:
- Animation
- Logo
- Background
- Colors
- Timing
- Wave
- Transition

ATTENDEE:
- Home
- Begin Detection
- My Activity
- Live Session
- Session History
- Profile
- Existing workflows

ADMIN:
- Monitor
- Rooms
- Session activity
- Monitoring behavior
- Profile
- Existing workflows

PRESENTER:
- Existing Analysis screen
- Existing Profile screen
- Existing Roster design
- Existing Choose Room design
- Existing Session Setup design
- Existing Full Roster screen
- Existing Active Hosting visual design

Only modify the specific Presenter Home workflow, Presenter Home Session History, and Active Hosting roster preview described above.


============================================================
20. FINAL ACCEPTANCE CRITERIA
============================================================

Before considering the update complete, verify all of the following.

THEME:

✓ Dark Mode completely removed
✓ Only Light Mode remains
✓ Existing Light Theme preserved
✓ Bottom navigation background = #0F2F2C
✓ Bottom navigation icons = #FFFFFF
✓ Bottom navigation labels = #FFFFFF
✓ No unnecessary theme redesign

LAUNCH:

✓ Completely unchanged
✓ Existing launch animation preserved
✓ Existing launch X preserved
✓ Existing launch background preserved
✓ Existing wave preserved
✓ Existing timing preserved

ATTENDEE:

✓ Existing experience unchanged
✓ Begin Detection unchanged
✓ Live session unchanged
✓ Session History unchanged
✓ My Activity unchanged
✓ Profile unchanged
✓ Navigation structure unchanged

ADMIN:

✓ Existing Monitor unchanged
✓ Existing room monitoring unchanged
✓ Existing session activity unchanged
✓ Admin workflow unchanged
✓ Navigation structure remains Monitor + Profile

PRESENTER HOME:

✓ Home opens to Presenter Dashboard
✓ Does NOT immediately open Choose Room
✓ Host / Anchor Room is the primary action
✓ Session History appears below it
✓ History represents hosted/anchored sessions
✓ Recent 4–5 sessions visible when available
✓ History is selectable

HOSTING FLOW:

✓ Host / Anchor Room opens Choose Room
✓ Existing Choose Room flow preserved
✓ Existing Session Setup preserved
✓ Existing session code flow preserved
✓ Existing hosting flow preserved

ACTIVE HOSTING:

✓ Existing visual design preserved
✓ Page is vertically scrollable
✓ Live attendee preview is visible
✓ Approximately 3–4 attendees visible when available
✓ View Full Roster remains present
✓ View Full Roster opens existing full roster
✓ No attendee information is unnecessarily hidden

ROLE SEPARATION:

✓ Attendee cannot host/anchor
✓ Presenter cannot use Begin Detection as Attendee
✓ Admin remains focused on Monitor
✓ Existing role restrictions preserved


============================================================
21. FINAL INSTRUCTION TO FIGMA MAKE
============================================================

THIS IS A TARGETED PRODUCTION FIX.

DO NOT REDESIGN THE APPLICATION.

DO NOT REBUILD THE APPLICATION.

DO NOT CHANGE APPROVED SCREENS.

DO NOT MODIFY THE LAUNCH SCREEN UNDER ANY CIRCUMSTANCES.

DO NOT MODIFY THE APPROVED ATTENDEE EXPERIENCE.

DO NOT MODIFY THE APPROVED ADMIN EXPERIENCE.

DO NOT MODIFY EXISTING PRESENTER SCREENS UNLESS THEY ARE SPECIFICALLY IDENTIFIED ABOVE.

Preserve the existing XConnect visual identity and UI.

Make the Presenter experience logically correct:

PRESENTER HOME
→ Host / Anchor Room
→ Choose Room
→ Session Setup
→ Active Hosting

and separately:

PRESENTER HOME
→ Session History
→ Previous Hosted Session
→ Historical Session Information

and during an active session:

ACTIVE HOSTING
→ 3–4 attendee preview
→ View Full Roster
→ Full Live Roster

The final application must look and feel like the SAME XConnect application that already exists, with only these targeted fixes applied.

PRIORITY ORDER:

1. Preserve Launch Screen
2. Preserve Attendee
3. Preserve Admin
4. Remove Dark Mode
5. Change bottom navigation to #0F2F2C with white icons/text
6. Correct Presenter Home
7. Restore Presenter Session History on Home
8. Correct Host/Anchor navigation flow
9. Make Active Hosting scrollable
10. Show 3–4 attendees directly on Active Hosting
11. Preserve View Full Roster
12. Preserve all other existing UI and functionality

MAKE ONLY THESE CHANGES.