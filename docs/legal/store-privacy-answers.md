# Store privacy answers (internal working notes, not for publishing)

Starting answers for the **Google Play Data safety form** and the **Apple App Privacy ("nutrition label")
questions**, based on what the app does (checked against the code on 2026-10-20). Review them with whoever
handles legal matters, and keep them consistent with `xconnect-privacy-policy.html`. A form that
contradicts the policy is a common cause of store rejection.

Items marked **DECIDE** need a person to choose. Items marked **CONFIRM** are facts to double-check.

## Facts the answers rest on

- Collected from the user: name, email, sign-in method, optional preferred name, optional join name.
- Created by use: attendance records (room, times, role, confidence), invitations and replies, a random
  device identifier (kept in secure storage until uninstall), push token plus platform plus email as the
  notification label.
- Read from sensors and sent to the server: nearby Bluetooth codes (rotate every 60 s, no hardware
  addresses), nearby Wi-Fi names and hardware addresses (Android only), motion state, and whether an
  inaudible room code was heard by the microphone.
- No analytics, crash-reporting or advertising packages in the app. No GPS coordinates (CONFIRM).
- No audio recorded, stored or sent (CONFIRM).
- Data in transit is encrypted (HTTPS). Processed by Google (Firebase), Microsoft (Azure, Entra) and the
  Apple and Google push services, all acting on our behalf.
- Users can delete the account in the app and on a web page (`xconnect-delete-account.html`, to be hosted).

## Google Play: Data safety form

| Play category | Data type | Collected? | Shared? | Required or optional | Purpose |
|---|---|---|---|---|---|
| Personal info | Name | Yes | No | Required | App functionality, account management |
| Personal info | Email address | Yes | No | Required | App functionality, account management, communications |
| Personal info | User IDs (account ID) | Yes | No | Required | App functionality, account management |
| App activity | Other user-generated content (join name, invitation replies) | Yes | No | Optional | App functionality |
| App activity | Other actions (attendance records) | Yes | No | Required | App functionality |
| Device or other IDs | Device or other IDs (random app-created device identifier, push token) | Yes | No | Required | App functionality |
| Location | Approximate location | **DECIDE** | No | Required | App functionality |
| Audio | Voice or sound recordings | No (CONFIRM) | n/a | n/a | n/a |

Notes on the table:

- **Shared = No.** Play does not count passing data to a service provider that processes it on our behalf as
  "sharing". Google, Microsoft and Apple here act as providers. CONFIRM with legal.
- **Location: DECIDE.** The app does not read GPS. It does read the names and hardware addresses of nearby
  Wi-Fi networks, which can reveal a rough location. The cautious answer is to declare **approximate
  location, collected, for app functionality**. The permissive answer is "not collected". Choose with
  legal, and make the privacy policy say the same.
- **Data security section:** data is encrypted in transit: **Yes**. You can request that data is deleted:
  **Yes**, with the URL of the deletion page. Committed to the Play Families policy: **No** (not directed
  to children).
- **Optional vs required:** the account, attendance and device identifier are needed for the app to work.

### Permissions to declare or review in Play Console

- Location (foreground only). Explain in the listing and in the app that it is for Bluetooth and Wi-Fi
  scanning.
- Bluetooth scan, advertise and connect. If the app does not use Bluetooth to work out location, the scan
  permission can be declared with the `neverForLocation` flag. Check against the Wi-Fi use first.
- Microphone, for the inaudible room code.
- Notifications.
- **Remove before submitting:** `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE` and
  `SYSTEM_ALERT_WINDOW` appear in the Android manifest and the app does not appear to need them. Play
  reviewers question them, especially "draw over other apps".

## Apple: App Privacy questions (App Store Connect)

| Apple category | Data type | Collected? | Linked to the user? | Used for tracking? | Purpose |
|---|---|---|---|---|---|
| Contact Info | Name | Yes | Yes | No | App functionality |
| Contact Info | Email Address | Yes | Yes | No | App functionality |
| Identifiers | User ID | Yes | Yes | No | App functionality |
| Identifiers | Device ID | Yes | Yes | No | App functionality |
| Usage Data | Product Interaction (attendance activity) | Yes | Yes | No | App functionality |
| Location | Coarse Location | **DECIDE** (same question as Play) | Yes | No | App functionality |
| Other Data | Other Data Types (nearby Bluetooth and Wi-Fi signal readings, motion) | Yes | Yes | No | App functionality |
| Audio Data | Audio Data | No (CONFIRM) | n/a | n/a | n/a |

Notes on the table:

- **Tracking: No.** Tracking means linking data with other companies' data for advertising or sharing it with
  data brokers. The app does neither, so no App Tracking Transparency prompt is needed.
- Everything is **linked to the user**, because it is tied to the account.
- On iOS, Wi-Fi scanning is not available, so the Wi-Fi row applies to Android only. State this in the policy.

### Apple requirements beyond the labels

- A **privacy policy URL**, and **in-app account deletion** (App Store guideline 5.1.1(v)), which must be
  easy to find, not just a link to email.
- **Sign in with Apple** is required when the app offers Google or Microsoft sign-in (guideline 4.8).
- A **microphone usage description** in `Info.plist` (`NSMicrophoneUsageDescription`). It is missing from
  `app.json` today, and the ultrasonic check uses the microphone.
- The Bluetooth and location usage descriptions already exist, and should explain the purpose in plain
  language, since reviewers read them.

## Keep these consistent

| Item | Where it must match |
|---|---|
| What is collected | Privacy policy section 2, Play Data safety form, Apple App Privacy answers |
| Location answer | Privacy policy sections 2.5 and 4, both store forms |
| What deletion removes and what may be kept | Policy section 9, deletion page, both store forms |
| Retention periods | Policy section 8 |
| Regions where data is stored | Policy section 7 (App runs in South India, database in West US 2 at the time of writing) |
