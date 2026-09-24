Please continue the XConnect mobile prototype with the following enterprise UI additions, layout fixes, and aesthetic overhauls. 

IMPORTANT DEFAULT THEME INSTRUCTION:
- Set LIGHT MODE as the default initial theme for the entire app (with Dark Mode still toggleable via the header theme switch).
- The light mode aesthetic must feel ultra-premium, clean, and enterprise-grade (inspired by Stripe, Linear, and Apple Health): crisp off-white background (#F8FAFC), pristine elevated white cards (#FFFFFF) with subtle borders (#E2E8F0), deep slate typography (#0F172A), and vibrant emerald accents (#059669 / #10B981).

=======================================================
1. FIX HEADER BACK BUTTON (ON ROOM OVERVIEW)
=======================================================
- In the "Room Overview" screen, move the Back Navigation Button [ < ] from the top-right to the standard TOP-LEFT corner of the header.
- Align the title "Room Overview" and subtitle cleanly on the left side beside/below the back button.
- Keep the top-right corner reserved for utility icons (e.g., Theme Toggle).
- Preserve the existing room cards (Hall A, Workshop 1, etc.) and their clickable attendee drill-down functionality exactly as they are.

=======================================================
2. CINEMATIC NETFLIX-STYLE INTRO ANIMATION
=======================================================
- Build a 1.6s cinematic launch sequence:
  - Begins with a deep cinematic backdrop.
  - The geometric XConnect "X" monogram glows in vibrant emerald (#10B981) and sky cyan (#0284C7) with expanding acoustic sonic wave rings.
  - The "X" accelerates and zooms dramatically close-up directly through the camera (mimicking the iconic Netflix "N" zoom-through effect) and smoothly cross-fades into the Light Mode Login screen.
  - Include an interactive "Replay Intro" button in the header so it can be re-triggered anytime during demos.

=======================================================
3. ENTERPRISE SSO AUTHENTICATION (NO MANUAL NAME TYPING)
=======================================================
- Replace manual text inputs with a modern enterprise SSO authentication gateway in clean light mode:
  - Segmented toggle at top: [ Participant / Host Login ] vs [ Admin Monitoring Portal ].
  - Participant / Host Login:
    - 1-Tap "Continue with Google" (with official Google G icon and white elevated button)
    - 1-Tap "Continue with Microsoft 365" (with official Microsoft icon)
    - "Continue with Corporate Email"
    - Successful login auto-populates user profile name, job title, and avatar (e.g., "Dr. Sarah Jenkins · Lead Researcher").
  - Admin Login:
    - Enterprise Security PIN unlock ("2468") or SSO Admin credentials.
    - Directly navigates to the existing Room Overview admin screen.

=======================================================
4. OVERHAUL OF THE HOME SCREEN DASHBOARD (LIGHT MODE DEFAULT)
=======================================================
- Replace the plain "Your Role" form with an executive, high-tech enterprise dashboard:
  - Background: Crisp slate canvas (#F8FAFC).
  - Top Bar: Authenticated user avatar, company badge, and live server status pill ("● Cloud Connected" in soft emerald).
  - Hero Section: An interactive "Living Presence Core" featuring an ambient pulsing signal orb reflecting real-time physical space readiness.
  - Action Cards (Elevated white surfaces #FFFFFF, subtle 1px border #E2E8F0, soft drop shadow):
    1. "Anchor a Room" (Presenter): Emerald glowing accent pill, quick room selection chips (Hall A, Workshop 1, Auditorium, + Add), and a 1-tap "Start Broadcasting" button.
    2. "Find My Room" (Attendee): Sky-cyan wave radar graphic, 1-tap zero-touch room detection.
  - Quick strip: "Recent Sessions" carousel showing previously attended conference halls with recorded dwell times.

=======================================================
5. DOCKED ENTERPRISE FOOTER NAVIGATION BAR
=======================================================
- Implement a persistent, docked bottom navigation bar styled for Light Mode by default:
  - Styling: Translucent frosted glassmorphism (background: rgba(255, 255, 255, 0.88), backdrop-filter: blur(20px), border-top: 1px solid #E2E8F0) with safe-area bottom padding above the iOS home indicator and Android gesture bar.
  - 5 interactive tabs with modern vector icons and 11pt labels:
    1. [ Radar / Live ] (Radar icon) — Real-time proximity radar and room anchor controls.
    2. [ Rooms ] (Building icon) — Directory of all conference halls and current occupancies.
    3. [ Activity ] (Clock/Timeline icon) — Personal attendance history, join/leave duration logs.
    4. [ Monitor ] (Shield/Lock icon) — Navigates to the existing Room Overview admin screen.
    5. [ Profile ] (User icon) — User SSO profile details, sensor calibration status, and Light/Dark toggle.
  - Active Tab State: Clean emerald capsule highlight (#ECFDF5 background, #059669 text/icon) with smooth spring transition when switching tabs.

=======================================================
6. AESTHETICS, REFINED PALETTE & MOTION
=======================================================
- Color System:
  - Light Mode (Default): Canvas (#F8FAFC), Cards (#FFFFFF), Border (#E2E8F0), Primary Text (#0F172A), Secondary (#475569), Verified Emerald (#059669), Mesh Sky (#0284C7).
  - Dark Mode (Toggleable): Canvas (#0B0F17), Cards (#131C2E), Border (#22314E), Primary Text (#F8FAFC).
- Animations:
  - Micro-scale 0.98 feedback on button and card press.
  - Gentle CSS pulse on "● HEALTHY" and "● Active In-Room" badges.
  - Smooth page transitions between screens and tabs.
- Full interactive responsiveness on iPhone 16 Pro (393×852) and Pixel 8 (412×915).
