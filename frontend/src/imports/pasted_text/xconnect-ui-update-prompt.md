/professional /expert /production-grade

XCONNECT — MASTER UI/UX UPDATE PROMPT

IMPORTANT:
This is an existing XConnect application.

DO NOT redesign or recreate the application from scratch.

The current application contains several screens and interactions that are already correct and approved. Preserve them exactly unless a change is explicitly requested in this prompt.

This is a controlled, production-grade UI/UX refinement.

============================================================
0. ABSOLUTE SCOPE & PRESERVATION RULE
============================================================

Make ONLY the changes explicitly described in this prompt.

Everything else in the existing application must remain unchanged.

DO NOT:
- Redesign existing screens unnecessarily
- Recreate existing screens from scratch
- Change existing layouts unnecessarily
- Change existing component hierarchy
- Change existing navigation architecture except where explicitly requested
- Change existing functionality unless explicitly requested
- Change backend/API behavior
- Change existing business logic
- Change existing data models
- Change existing detection logic
- Change existing session logic
- Change existing room logic
- Change existing authentication providers except for the explicitly requested authentication UI changes
- Modify existing animations unless explicitly requested
- Remove existing functionality unless explicitly requested
- Introduce unrelated features
- Make "improvements" that were not requested

The goal is to make the existing XConnect application feel:

- Enterprise-grade
- Production-ready
- Professional
- Clean
- Modern
- Consistent
- Attractive
- User-friendly
- Intuitive
- Visually polished

WITHOUT destroying or unnecessarily changing the existing UI that is already correct.

============================================================
1. LAUNCH / SPLASH SCREEN — COMPLETELY LOCKED
============================================================

CRITICAL:

THE LAUNCH / SPLASH SCREEN IS FINAL AND MUST NOT BE TOUCHED.

DO NOT MODIFY ANYTHING ON THE LAUNCH SCREEN.

The current launch animation is already approved and perfect.

Preserve EXACTLY as it currently exists:

- Launch screen layout
- Background color
- X logo
- X logo artwork
- X zoom/reveal animation
- Animation direction
- Animation timing
- Animation duration
- Easing
- CONNECT entrance animation
- X movement
- XConnect formation
- Final XConnect positioning
- Circular/radio/radar wave animation
- Wave timing
- Final transition into the application

DO NOT:
- Recolor the launch page
- Replace the launch X
- Replace the launch background
- Modify the launch animation
- Modify animation timing
- Modify the wave
- Modify the final XConnect position
- Apply any new theme changes to the launch page

The launch page must remain 100% IDENTICAL to the current approved version.

Treat the launch page as READ-ONLY / LOCKED.

============================================================
2. APPLICATION COLOR THEME — LIGHT MODE ONLY
============================================================

For the APPLICATION UI AFTER the launch screen, use the approved XConnect light enterprise theme.

There must be NO dark mode.

The application should use these three primary brand colors:

PRIMARY DARK TEAL
#0F2F2C

BRIGHT TURQUOISE / MINT
#33D1AC

PURE WHITE
#FFFFFF

Use them intelligently and consistently.

============================================================
3. APPROVED THEME SYSTEM
============================================================

Use:

#FFFFFF
as the primary application surface/background color.

Use:

#0F2F2C
for:
- Primary text
- Important headings
- Strong branding
- Header text where appropriate
- High-importance icons
- Strong UI elements

Use:

#33D1AC
for:
- Primary actions
- Active navigation
- Selected states
- Important highlights
- Presence/connectivity indicators
- Primary brand accents
- Interactive states
- Important status indicators

The visual result should be predominantly LIGHT and WHITE, with dark teal providing professional structure and turquoise providing controlled brand emphasis.

Do NOT make the application predominantly dark.

Do NOT turn the entire application teal.

Do NOT overuse #33D1AC.

The turquoise should be an accent, not the dominant surface color.

The overall visual language should resemble a polished enterprise SaaS/mobile platform rather than a consumer gaming or overly decorative application.

Maintain strong contrast, clean spacing, visual hierarchy, and accessibility.

Do not introduce unnecessary colors.

Where system states such as errors, warnings, or validation require additional visual distinction, use them minimally and only where functionally necessary.

============================================================
4. AUTHENTICATION PAGE — PRESERVE EXISTING DESIGN
============================================================

The existing authentication page should remain visually consistent with its current design.

DO NOT redesign the entire authentication page.

Only make the explicitly requested authentication changes.

------------------------------------------------------------
4.1 X LOGO
------------------------------------------------------------

Use the EXACT X icon image attached with this prompt.

The attached image is the single source of truth for the X logo.

DO NOT:
- Recreate the X
- Redraw the X
- Simplify the X
- Generate another X
- Substitute a generic X icon
- Change its geometry
- Change its proportions
- Change its internal circle
- Change its colors
- Apply an unwanted background
- Crop it incorrectly
- Replace it with an icon-library X

Use the attached image as the actual logo asset.

The X logo must be completely visible.

Do not allow the white portions of the X to disappear into the background.

Preserve the logo's original artwork exactly.

------------------------------------------------------------
4.2 AUTHENTICATION BRANDING ORDER
------------------------------------------------------------

At the top of the authentication page, the branding should appear in this order:

1. X logo
2. XConnect

The X logo comes FIRST.

"XConnect" appears BELOW the X logo.

The composition should be visually centered and professionally balanced.

Example structure:

        [ X LOGO ]

          XConnect

    [existing authentication UI]

Do not put the user's name above XConnect.

Do not put the user's name beside the logo.

Do not use:

SJ
Dr. Sarah Jenkins
XConnect

The authentication page should establish the application identity first.

------------------------------------------------------------
4.3 EXISTING AUTHENTICATION OPTIONS
------------------------------------------------------------

Preserve the existing authentication experience and its visual style.

Authentication should provide:

- Connect with Google
- Connect with Microsoft
- Manual login using Email + Password

Remove the Admin authentication PIN.

There must be NO Admin PIN authentication screen or field.

Do not introduce a separate authentication method for Admin.

Authentication should remain consistent across roles.

============================================================
5. EMAIL + PASSWORD LOGIN
============================================================

The manual login option should use:

Email

Placeholder:
"Enter your email"

Password

Placeholder:
"Enter your password"

Include:

"Forgot password?"

and:

"New here? Create an account"

"Forgot password?" should behave as the password recovery action.

"Create an account" should navigate to the account creation flow.

Preserve the existing input/button visual style wherever possible.

Do not redesign the entire login page.

============================================================
6. CREATE ACCOUNT
============================================================

The existing "New here? Create an account" action should open the Create Account / Sign Up experience.

The account creation form must contain:

Full Name
Placeholder:
"Enter your full name"

Email
Placeholder:
"Enter your email"

Password
Placeholder:
"Create a password"

Confirm Password
Placeholder:
"Confirm your password"

Include an appropriate primary Create Account action.

The screen must use the existing XConnect visual language and approved light theme.

Do not create an unrelated design.

============================================================
7. GLOBAL APPLICATION BRANDING AFTER LOGIN
============================================================

Across authenticated application screens, the current top application branding/name should be replaced with:

XConnect

Only:

XConnect

should represent the application name in the top header.

Do NOT display:

SJ
Dr. Sarah Jenkins
XConnect

as the top application branding.

The user's name belongs in Profile, not in the global application header.

IMPORTANT:

Do not redesign the existing header.

Preserve:
- Header position
- Header height
- Existing spacing
- Existing navigation controls
- Existing icons
- Existing profile controls
- Existing layout

Only replace the existing application branding/name with:

XConnect

============================================================
8. USER PROFILE
============================================================

The Profile screen should be user-friendly and editable.

Users should be able to modify their appropriate personal information.

For example:

- Full Name
- Email where appropriate according to the existing authentication/account model
- Profile information supported by the current application

Provide a clear Edit Profile experience.

Do NOT expose administrative permissions to normal users.

For Presenter and Attendee:

REMOVE:
- Admin access
- Admin controls
- Admin permissions
- Admin authentication options

The user's role should remain system-controlled.

A Presenter cannot promote themselves to Admin.

An Attendee cannot promote themselves to Presenter/Admin.

============================================================
9. SENSOR CALIBRATION
============================================================

Remove Sensor Calibration from the normal Presenter and Attendee Profile experience.

Normal users should NOT need to see or manage sensor calibration.

The normal user experience should remain focused on:

Attendee:
Attend / detect presence

Presenter:
Host / anchor a room

However:

If the existing application requires sensor calibration/diagnostics internally, DO NOT delete the underlying capability unnecessarily.

If already present and required operationally, keep it available only through an appropriate Admin/internal diagnostics area.

Do not expose it in normal user profiles.

============================================================
10. ROLE-BASED EXPERIENCE
============================================================

The application must clearly separate the three roles:

ATTENDEE
Purpose:
Attend sessions and have presence detected.

PRESENTER
Purpose:
Host/anchor a room and manage the session.

ADMIN
Purpose:
Monitor rooms, sessions, and system activity.

Role-specific UI must be consistent throughout the application.

Do not merely hide navigation items.

Ensure the actual available actions are consistent with the user's role.

============================================================
11. ATTENDEE EXPERIENCE
============================================================

An Attendee should ONLY be able to attend sessions.

The Attendee must NOT be able to:
- Host a room
- Present
- Anchor a room
- Start presenter functionality
- Access presenter-only tools

------------------------------------------------------------
11.1 ATTENDEE HOME
------------------------------------------------------------

The Attendee Home screen should be the existing "Begin Detection" experience.

Keep the current Begin Detection functionality and UI behavior.

Do NOT give the Attendee a Host/Anchor option.

The primary Attendee action should be:

Begin Detection

This is the user's primary way of attending a session.

------------------------------------------------------------
11.2 ATTENDEE BOTTOM NAVIGATION
------------------------------------------------------------

The Attendee bottom navigation must contain ONLY:

1. Home
2. My Activity
3. Profile

Remove all other Attendee bottom navigation items.

Do not add unnecessary navigation items.

------------------------------------------------------------
11.3 ATTENDEE MY ACTIVITY
------------------------------------------------------------

IMPORTANT:

The CURRENT LIVE SESSION view in My Activity is already correct.

PRESERVE IT.

Do NOT replace or redesign the existing live-session activity experience.

Extend the existing My Activity experience to include historical sessions.

The My Activity screen should contain:

A. Current / Live Session

Keep the existing live session section exactly as it currently works.

B. Session History

Add a history section for sessions the Attendee joined previously.

The user should be able to see past sessions they attended.

The history should be organized clearly and professionally, for example by:

- Session
- Room
- Date
- Time
- Attendance status
- Duration where the existing data supports it

Do not unnecessarily change the existing live-session UI.

The requirement is:

CURRENT LIVE ACTIVITY
+
PAST SESSION HISTORY

within My Activity.

============================================================
12. PRESENTER EXPERIENCE
============================================================

A Presenter should ONLY host/anchor rooms.

The Presenter must NOT use Attendee detection mode.

Remove the "Begin Detection" option from the Presenter experience.

The Presenter should instead have the ability to:

Host / Anchor a Room

------------------------------------------------------------
12.1 PRESENTER HOME
------------------------------------------------------------

Presenter Home should be the existing hosting/anchoring experience.

The primary action should be:

Host / Anchor Room

Do NOT show:

Begin Detection

because the Presenter is not functioning as an Attendee.

------------------------------------------------------------
12.2 PRESENTER BOTTOM NAVIGATION
------------------------------------------------------------

The Presenter bottom navigation must contain ONLY:

1. Home
2. Roster
3. Analysis
4. Profile

Remove all other Presenter navigation items.

------------------------------------------------------------
12.3 PRESENTER ROSTER
------------------------------------------------------------

The current Presenter Roster functionality shows the attendee roster for the active/current session.

PRESERVE THIS CURRENT BEHAVIOR.

During an active session:

Roster
→ shows the attendees currently associated with that session.

DO NOT remove or redesign this current functionality.

After a session ends, extend the Roster experience to provide historical session access.

The Presenter should be able to view past sessions organized by ROOM / SESSION.

For example:

Roster

Current Session
→ Current attendees

Session History
→ Room A
→ Past Session — Date/Time
→ View Attendees

The Presenter should be able to select a previous session/room and see the historical list of people who joined that session.

The history should be room/session based.

The Presenter should be able to:

1. Select a past room/session
2. Open its historical session
3. View the attendees who joined
4. Review the relevant attendance/session information already supported by the application

Do not replace the existing live roster.

Extend it with historical session access.

============================================================
13. PRESENTER ANALYSIS
============================================================

Keep the existing Analysis screen and functionality.

Do not redesign it unnecessarily.

It should remain accessible through:

Home | Roster | Analysis | Profile

Only apply the approved light theme and required branding changes.

Do not remove existing analysis functionality.

============================================================
14. ADMIN EXPERIENCE
============================================================

IMPORTANT:

THE EXISTING ADMIN MONITOR SCREEN IS ALREADY CORRECT.

DO NOT REDESIGN THE ADMIN MONITOR SCREEN.

DO NOT CHANGE:
- Room monitoring
- Session activity
- Active room information
- Existing monitor layout
- Existing monitor cards
- Existing monitor functionality
- Existing session activity display
- Existing monitoring behavior

The Admin Monitor screen should remain exactly as it currently is, apart from necessary global branding/theme changes that are explicitly requested.

------------------------------------------------------------
14.1 ADMIN BOTTOM NAVIGATION
------------------------------------------------------------

The Admin bottom navigation must contain ONLY:

1. Monitor
2. Profile

Remove all other Admin bottom navigation options.

Do NOT add Home, Roster, Analysis, My Activity, or Begin Detection to the Admin navigation.

The existing Monitor screen remains the Admin's primary application screen.

============================================================
15. ADMIN PROFILE
============================================================

Admin should have the same clean, professional Profile experience.

Profile should allow appropriate personal information to be edited.

Do not expose unnecessary system controls inside the normal Profile screen.

The Admin's monitoring functionality belongs in:

Monitor

not Profile.

============================================================
16. BOTTOM NAVIGATION — CONSISTENCY
============================================================

Use the existing bottom navigation visual design and adapt it to the approved XConnect light theme.

Do NOT redesign the navigation component unnecessarily.

Only change the navigation items according to role.

ATTENDEE:

Home | My Activity | Profile

PRESENTER:

Home | Roster | Analysis | Profile

ADMIN:

Monitor | Profile

The active item should be clearly distinguishable using the XConnect accent:

#33D1AC

while maintaining strong readability and professional contrast.

============================================================
17. ROLE ACCESS MATRIX
============================================================

Implement the role separation consistently.

ATTENDEE:

✓ Home
✓ Begin Detection
✓ My Activity
✓ Live Session
✓ Session History
✓ Profile

✗ Host Room
✗ Anchor Room
✗ Presenter tools
✗ Presenter Roster
✗ Presenter Analysis
✗ Admin Monitor

PRESENTER:

✓ Home
✓ Host / Anchor Room
✓ Roster
✓ Current Attendee Roster
✓ Historical Session/Room Roster
✓ Analysis
✓ Profile

✗ Begin Detection as Attendee
✗ Admin Monitor
✗ Admin controls

ADMIN:

✓ Monitor
✓ Profile

✗ Attendee Begin Detection
✗ Presenter hosting UI unless already explicitly part of Admin functionality
✗ Presenter Roster
✗ Presenter Analysis

Do not expose role-inappropriate actions through alternate screens.

============================================================
18. DESIGN QUALITY REQUIREMENTS
============================================================

The resulting UI must feel:

ENTERPRISE-LEVEL
PRODUCTION-GRADE
PROFESSIONAL
MODERN
CLEAN
POLISHED
ATTRACTIVE
USER-FRIENDLY
INTUITIVE
CONSISTENT

Use:

- Clear visual hierarchy
- Consistent spacing
- Strong typography hierarchy
- Clean cards
- Controlled use of shadows
- Consistent corner radius
- Consistent icon sizing
- Proper alignment
- Adequate touch targets
- Clear active/inactive states
- Strong contrast
- Minimal visual clutter
- Professional micro-interactions where existing interactions already support them

Do NOT over-animate the application.

Do NOT add decorative effects just for visual appeal.

Do NOT make the UI look like a gaming application.

Do NOT make it overly flashy.

The design should communicate:

TRUST
CONNECTIVITY
PRESENCE
RELIABILITY
PROFESSIONALISM

============================================================
19. RESPONSIVENESS & MOBILE UI
============================================================

Preserve the existing responsive behavior.

Ensure the updated UI remains properly usable across supported mobile screen sizes.

Do not allow:
- Text clipping
- Button overflow
- Navigation overflow
- Broken alignment
- Overlapping components
- Unreadable text
- Improperly scaled logos

The attached X logo must maintain its aspect ratio.

============================================================
20. FINAL PRESERVATION CHECK
============================================================

Before completing the implementation, verify:

LAUNCH:
✓ Completely untouched
✓ Animation unchanged
✓ X unchanged
✓ Background unchanged
✓ Wave unchanged

AUTHENTICATION:
✓ X logo uses exact attached asset
✓ X appears first
✓ XConnect appears below X
✓ Google authentication retained
✓ Microsoft authentication retained
✓ Email/password retained
✓ Forgot password retained
✓ Create account retained
✓ Admin PIN removed

GLOBAL BRANDING:
✓ Top application name is XConnect
✓ User name removed from global header
✓ User name remains available through Profile

THEME:
✓ Light mode only
✓ #0F2F2C
✓ #33D1AC
✓ #FFFFFF
✓ Professional white-first enterprise appearance
✓ No unnecessary dark mode

ATTENDEE:
✓ Home
✓ Begin Detection
✓ My Activity
✓ Existing live session preserved
✓ Historical session history added
✓ Profile
✓ No Presenter/Anchor capability

PRESENTER:
✓ Home
✓ Host/Anchor Room
✓ Roster
✓ Existing live attendee roster preserved
✓ Historical room/session roster added
✓ Analysis
✓ Profile
✓ No Begin Detection

ADMIN:
✓ Existing Monitor screen preserved
✓ Existing rooms/session activity preserved
✓ Bottom navigation only Monitor + Profile
✓ Profile
✓ No unnecessary navigation items

PROFILE:
✓ Editable
✓ No Admin access for Attendee/Presenter
✓ No Sensor Calibration for normal users
✓ Role remains controlled by the system

============================================================
FINAL INSTRUCTION
============================================================

THIS IS AN EXISTING PRODUCT.

DO NOT REBUILD IT.

DO NOT REDESIGN IT FROM SCRATCH.

DO NOT CHANGE APPROVED FUNCTIONALITY.

Make the requested changes surgically and preserve all existing correct functionality and UI.

The highest-priority preservation rules are:

1. LAUNCH PAGE MUST NOT CHANGE.
2. EXISTING ADMIN MONITOR MUST NOT CHANGE.
3. EXISTING ATTENDEE LIVE SESSION / ACTIVITY EXPERIENCE MUST NOT CHANGE.
4. EXISTING PRESENTER LIVE ROSTER MUST NOT CHANGE.
5. Existing functionality must be preserved unless explicitly modified above.

The final result should feel like the SAME XConnect application, evolved into a polished, coherent, enterprise-level production UI — not a completely different application.

Use the attached X image EXACTLY where the authentication-page X logo is requested.

Make ONLY the requested changes.