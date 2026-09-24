# Azure Notification Hub + GCP/Firebase setup (push notifications)

Step-by-step record of how push notifications were wired up for this app: Azure
Notification Hubs as the send/orchestration layer, Firebase Cloud Messaging (FCM) as the
mandatory Android delivery channel. This is what was actually provisioned this session —
follow it to reproduce the setup in another subscription/project, or to understand what
the `AZURE_NOTIFICATION_HUB_*` env vars and `google-services.json` are for.

## Why two providers are needed

FCM is a required Android push delivery channel no matter what orchestrates the send —
Azure Notification Hubs, Expo's push service, OneSignal, anything. Azure Notification
Hubs doesn't replace FCM, it sits in front of it (and APNs, WNS, etc.) so the server only
has to talk to one API regardless of platform. That means **one Google/Firebase project**
is needed either way, and it can be (and here, is) the same Firebase project already used
for email/Google sign-in.

Two distinct artifacts come out of that one Firebase project, easy to confuse:

| Artifact | Used for | Goes where |
|---|---|---|
| **Service account JSON** | Server-side *sending* — proves to FCM that Notification Hubs is allowed to deliver on the project's behalf | Uploaded into the Notification Hub's "Google (FCM v1)" settings, never committed to the repo |
| **`google-services.json`** | Client-side *token acquisition* — lets the Android app's embedded Firebase Messaging SDK register with FCM and obtain a device token at all | Placed at `apps/mobile/google-services.json`, gitignored |

## Part 1 — GCP/Firebase side

1. Reuse the existing Firebase project (`xconnect-2b9a3` in this repo's case) — no need
   for a second project. If starting fresh, create a project at
   [console.firebase.google.com](https://console.firebase.google.com).
2. **Add an Android app to the Firebase project** (if not already present):
   - Firebase Console → Project settings → "Add app" → Android.
   - Package name must exactly match the app's applicationId (`com.confpresence.zero`).
   - Download the generated `google-services.json`.
3. **Place `google-services.json`**:
   - Copy it to `apps/mobile/google-services.json`.
   - Already gitignored (`.gitignore` → "Firebase Android app config" section) since it's
     tied to a specific Firebase project + package name.
   - Wired into the build via `apps/mobile/app.json`:
     ```json
     "android": {
       "googleServicesFile": "./google-services.json"
     }
     ```
   - Requires a native rebuild (`expo prebuild` + gradle build) to take effect — it's not
     picked up by Fast Refresh/OTA JS updates.
4. **Get a service account key for server-side sending**:
   - Firebase Console → Project settings → Service accounts tab.
   - "Generate new private key" → downloads a JSON file containing `project_id`,
     `client_email`, and `private_key`.
   - This file is only used once, to copy three fields into the Azure portal (Part 2,
     step 4) — it does not need to be committed or stored in the repo at all.

## Part 2 — Azure Notification Hub side

1. **Create a Notification Hub Namespace**:
   - Azure Portal → "Create a resource" → search "Notification Hub".
   - Name: e.g. `xconnect-notifications-test`.
   - Pricing tier: **Free** (sufficient for dev/test volume).
   - Pick any resource group/region — this is a plain subscription-scoped resource, not
     tied to any Entra tenant used for sign-in (confirmed: Notification Hubs and identity
     tenants are unrelated axes; both can live under the same "Default Directory" without
     conflict, unlike app registrations which are genuinely tenant-scoped).
2. **Create a Notification Hub inside that namespace**:
   - Once the namespace finishes deploying, open it → "Notification Hubs" → "+ Hub".
   - Name: e.g. `xconnect-hub-test`.
3. **Open the hub's platform settings**:
   - Inside the hub → Settings → "Google (FCM v1)".
   - (Ignore "Google (GCM Legacy)" — deprecated, FCM v1 is the current API. The other
     entries — Apple/APNS, Windows/WNS, MPNS, ADM, Baidu, Browser — are for other
     platforms; not needed for Android-only.)
4. **Upload the FCM v1 credentials**, copied from the service account JSON downloaded in
   Part 1 step 4:
   - **Project ID** → `project_id`
   - **Client email** → `client_email`
   - **Private key** → `private_key`, including the `-----BEGIN PRIVATE KEY-----` and
     `-----END PRIVATE KEY-----` lines exactly as they appear in the JSON.
   - Save.
5. **Get the connection string**:
   - Hub → Settings → "Access Policies" (or namespace-level "Access Policies", depending
     on portal version) → find `DefaultFullSharedAccessSignature` → copy its connection
     string.
6. **Set environment variables** in `.env`:
   ```
   AZURE_NOTIFICATION_HUB_CONNECTION_STRING=<the connection string from step 5>
   AZURE_NOTIFICATION_HUB_NAME=xconnect-hub-test
   ```
   These are read server-side by `apps/api/src/notifications.ts` via
   `@azure/notification-hubs`'s `NotificationHubsClient`.

## Verifying it works

1. Run the DB migration if not already applied (`push_installations` table).
2. Rebuild and install the app on a device (native rebuild required after the
   `google-services.json` + `expo-notifications` plugin changes).
3. Sign in — `App.tsx` calls `registerForPushNotifications(serverUrl)` on sign-in, which
   requests notification permission, gets a raw FCM device token via
   `Notifications.getDevicePushTokenAsync()`, and posts it to `POST /api/push/register`.
4. From the admin app's "Notify" tab, send a test notification to that account's email.
5. **If nothing shows up while the app is open**: this is expected without a foreground
   handler — FCM only auto-displays notifications when the app is backgrounded/closed.
   `apps/mobile/src/services/pushNotifications.ts` registers
   `Notifications.setNotificationHandler({...})` at module load specifically to force
   display while the app is in the foreground too.

## Part 3 — iOS / APNs (not yet done in this repo — reference for later)

Everything above is Android-only. iOS delivery goes through Apple Push Notification
service (APNs) instead of FCM, and Notification Hubs needs its own separate credential
for that channel. None of this has been provisioned yet — no iOS native project exists in
this repo (`expo prebuild` has only been run for Android), and it needs a Mac to build and
sign an iOS binary at all. Recorded here so the Android setup above doesn't have to be
re-derived when iOS support is picked up.

### Requirements

- An **Apple Developer Program membership** ($99/year, enrolled as either an individual
  or an organization) — required to get an APNs key at all; there's no free tier
  equivalent to Firebase's here.
- A **Mac**, to run `expo prebuild` for iOS, open the generated Xcode project, and produce
  signed builds (App Store, TestFlight, or ad-hoc/device builds). Not required for the
  Apple Developer portal steps themselves, only for actually building the app.
- The bundle identifier registered in App Store Connect must exactly match the app's iOS
  bundle id (the iOS equivalent of Android's `applicationId` / package name).

### Steps

1. **Create an APNs Authentication Key** (preferred over the older per-app certificate
   approach — one key works across all of an account's apps and doesn't expire yearly):
   - [developer.apple.com](https://developer.apple.com) → Account → "Certificates,
     Identifiers & Profiles" → "Keys" → "+".
   - Enable the **Apple Push Notifications service (APNs)** capability on the key.
   - Download the generated `.p8` file — **this can only be downloaded once**, so store it
     somewhere durable immediately (not committed to the repo — same treatment as the
     Firebase service account JSON).
   - Note the **Key ID** (shown next to the key in the portal) and the account's **Team
     ID** (Account → Membership details).
2. **Register an App ID** for the app (if not already present):
   - Identifiers → "+" → App IDs → App.
   - Bundle ID must match the iOS project's bundle identifier exactly.
   - Enable the **Push Notifications** capability on this App ID.
3. **Upload the key to the Notification Hub**:
   - Azure Portal → the same Notification Hub used for Android → Settings → "Apple
     (APNS)".
   - Authentication mode: **Token** (uses the `.p8` key — the modern approach, vs. the
     legacy "Certificate" mode which needs a `.p12` and yearly renewal).
   - Paste in the **Key ID**, **Team ID / App ID Prefix**, upload the `.p8` file, and set
     the **Bundle ID** to the iOS app's bundle identifier.
   - **Endpoint**: use the Sandbox endpoint while testing with development/TestFlight
     builds, Production once shipping to the App Store — the hub can only target one at a
     time per this setting, so this needs to be flipped when moving from dev testing to
     release.
4. **Build the iOS project**:
   - `expo prebuild` (once an iOS platform config exists in `app.json`, mirroring the
     Android `googleServicesFile` entry — iOS doesn't need an equivalent file since APNs
     credentials live entirely server-side/in the Apple portal, not bundled into the app).
   - Open the generated Xcode project, confirm the Push Notifications capability is
     enabled on the target (should be added automatically by `expo-notifications`' config
     plugin, matching how it wires the Android manifest today), then build and run on a
     physical device — push notifications **do not work on the iOS Simulator**, only real
     hardware.
5. **Server-side platform branching** — `apps/api/src/notifications.ts` currently only
   builds Android/FCM installations and notifications unconditionally. Supporting iOS
   needs:
   - Track each installation's platform (Android vs. iOS) — `push_installations` doesn't
     currently store this, since only Android has existed so far.
   - Use `createAppleInstallation` instead of `createFcmV1Installation` when registering
     an iOS device (`Platform.OS === "ios"` client-side, via
     `apps/mobile/src/services/pushNotifications.ts`, which also currently early-returns
     for any non-Android platform and needs that guard removed).
   - Use `createAppleNotification`/the Apple notification body builder instead of the FCM
     v1 equivalent when sending, or send both bodies and let Notification Hubs' tag
     expression route each to the right platform's registered installations (this is the
     standard mixed-platform pattern — one send call fans out per-platform automatically
     once both platforms have registered installations under the hub).

### Notes

- The **Google (FCM v1)** settings from Part 2 stay exactly as they are — iOS support is
  additive, doesn't change anything about the Android setup already working.
- Same foreground-notification-handler caveat as Android applies conceptually, but iOS's
  exact foreground display behavior differs slightly (`expo-notifications`' handler API
  is meant to be cross-platform, so `pushNotifications.ts`'s existing
  `setNotificationHandler` call should not need changes once iOS is added — verify once
  there's an actual iOS build to test against).

## Known gaps / not yet handled

- **iOS/APNs**: see Part 3 above — not configured, needs Apple Developer Program
  enrollment and a Mac to build.
- **Denied notification permission**: currently fails silently (`pushNotifications.ts`
  logs a warning and returns; no user-facing message, no retry prompt). Deferred
  intentionally until the final UI pass.
