Please refine the XConnect mobile prototype with the following targeted enterprise UI fixes, role-adaptive navigation, and aesthetic upgrades. Keep the rest of the working UI, clickable room audit drill-down, and light mode theme intact:

=======================================================
1. LAUNCH ANIMATION: REVERSE-ZOOM "XCONNECT" ASSEMBLY
=======================================================
- Replace the intro sequence with the following 1.8s signature brand assembly:
  - Stage 1: The screen starts in clean slate (#F8FAFC). A large geometric 'X' zooms OUT from beyond the viewport edges inward, settling smoothly into the center with spring physics.
  - Stage 2: As the 'X' locks in place, the word 'Connect' smoothly slides in from the right (with subtle tracking expansion) and attaches to 'X', forming the unified brand logo: "XConnect".
  - Stage 3: A soft emerald acoustic wave ring radiates outward from the logo, which then dissolves smoothly into the Role Selection / Login screen.
  - Include an interactive "Replay Intro" button in the top bar to preview the animation anytime.

=======================================================
2. ROLE-BASED LOGIN & STRICT ACCESS CONTROL
=======================================================
- On the Login screen, allow selecting the role BEFORE logging in:
  - Segmented Selector: [ Attendee / Participant ] | [ Presenter / Host ] | [ Admin Login ].
- SSO Options: "Continue with Google", "Continue with Microsoft 365", "Work Email".
- Automatic Profile Inheritance: Logging in automatically captures the user's name and avatar. NEVER ask the user to type their name again anywhere in the app.
- Role-Specific Experience:
  - ATTENDEE VIEW: Privacy-first.
    - Home screen displays "Find My Room (Auto-Detect)" and live connection status.
    - Zero visibility into other attendees' data or the full room roster.
  - PRESENTER VIEW: Full room control.
    - Home screen displays "Anchor a Room", room selection chips, and live room broadcast.
    - Full access to the Live Attendee Roster for their anchored room.
  - ADMIN VIEW:
    - Tab labeled "Admin Login" (not "Admin Portal").
    - 2-Step Authentication: First prompts for Admin SSO/Email login, THEN displays the 4-digit PIN unlock screen ("2468") before granting access to the Multi-Room Overview.

=======================================================
3. ROLE-ADAPTIVE FOOTER NAVIGATION BAR (DYNAMIC TAB 3)
=======================================================
- The docked bottom navigation bar dynamically adapts based on the logged-in role:
  - FOR ATTENDEE:
    - Tab 1: [ Radar ] (Radar icon) — Zero-touch room discovery.
    - Tab 2: [ Rooms ] (Building icon) — Conference hall directory & schedule.
    - Tab 3: [ My Activity ] (Clock icon) — Strictly displays their OWN personal attendance timeline (e.g., "Currently in Hall A · Joined 10:14 AM · Active 32m · Verified by Acoustic Gate") and past sessions. ATTENDEES CANNOT SEE OTHER PARTICIPANTS.
    - Tab 4: [ Pass / Proof ] (Badge/Shield icon) — Personal verified attendance certificate.
    - Tab 5: [ Profile ] (User icon) — User SSO profile & theme toggle.
  - FOR PRESENTER:
    - Tab 1: [ Radar ] (Radar icon) — Room anchor broadcasting controls.
    - Tab 2: [ Rooms ] (Building icon) — Room management & anchor switcher.
    - Tab 3: [ Live Roster ] (Users/People icon) — Full live participant roster for their room with verification badges, inactivity flags, and "Export CSV".
    - Tab 4: [ Analytics ] (BarChart icon) — Room dwell statistics and peak concurrency.
    - Tab 5: [ Profile ] (User icon) — User SSO profile & theme toggle.

=======================================================
4. HOME SCREEN HEADER CLEANUP
=======================================================
- In the Home Screen top header:
  - Display ONLY the user avatar, user name (e.g., "Dr. Sarah Jenkins"), and the live "● Cloud Connected" pill.
  - REMOVE the designation/company line ("Lead Researcher · Research Corp") to eliminate clutter and provide clean, open breathing room.

=======================================================
5. ROOM SETUP FIXES (REMOVE REDUNDANT INPUTS & FIX "+ NEW")
=======================================================
- In the Presenter "Room Setup" screen:
  - REMOVE the "ROOM NAME" input box and placeholder text completely. Selecting a chip (e.g., "Hall A", "Workshop 1") directly activates that room.
  - REMOVE the "DISPLAY NAME" input box completely (already inherited from login).
  - FIX THE "+ NEW" BUTTON:
    - Clicking the "+ New" chip opens an interactive modal popup / bottom-sheet:
      - Title: "Add New Room Anchor"
      - Subtitle: "Enter the room identifier to broadcast"
      - Input Field: "e.g., Hall C, Innovation Lab, Boardroom"
      - Buttons: [ Cancel ] and [ Add & Select Room ].
    - Submitting adds the new room chip to the horizontal selector and automatically selects it.

=======================================================
6. PRESERVE EXISTING AUDIT FEATURES
=======================================================
- Keep the light mode default theme (#F8FAFC background, #FFFFFF elevated cards, #059669 emerald accents).
- Keep the Admin Room Overview with clickable room cards (Hall A, Workshop 1, etc.) and attendee drill-down intact with the Back button [ < ] on the top-left.
