# iOS Setup Guide: Push Notifications & Multi-Provider Authentication

This guide provides exhaustive, step-by-step instructions for configuring **Push Notifications (APNs + Azure Notification Hubs)** and **Multi-Provider Authentication (Firebase, Google, Microsoft Entra ID, Apple)** for the **XConnect** iOS app on macOS.

---

## 📱 App Identifiers & Specs

- **App Name**: `XConnect`
- **Bundle Identifier**: `com.thaqib.confpresencezeropoc`
- **URL Scheme**: `xconnect://`
- **Framework**: Expo SDK 54 / React Native 0.81 / Swift Native Modules
- **EAS Project ID**: `7dd6c543-831d-4c0c-8d12-bbef07b96e6e`

---

## 🔔 Section 1: Push Notification Setup (APNs + Azure Notification Hubs)

The XConnect backend uses **Azure Notification Hubs** for push notifications. On Android, FCM v1 is used; on iOS, Apple Push Notification service (APNs) token-based authentication must be configured in Azure.

```
┌─────────────────────┐       ┌───────────────────────────────┐       ┌─────────────────────┐
│  iOS Device (App)   │ ────> │ XConnect API Server           │ ────> │ Azure Notification  │
│ (Gets APNs Token)   │       │ (/api/push/register)          │       │ Hubs                │
└─────────────────────┘       └───────────────────────────────┘       └──────────┬──────────┘
                                                                                 │ APNs Key (.p8)
                                                                                 ▼
                                                                      ┌─────────────────────┐
                                                                      │ Apple APNs Server   │
                                                                      └─────────────────────┘
```

### Step 1.1: Generate APNs Authentication Key (.p8) in Apple Developer Portal
1. Navigate to [Apple Developer Portal - Keys](https://developer.apple.com/account/resources/authkeys/list).
2. Click the **(+)** button to create a new key.
3. Set **Key Name** to: `XConnect APNs Key`.
4. Check the box for **Apple Push Notifications service (APNs)**.
5. Click **Continue**, then click **Register**.
6. **Download the `.p8` key file** (Save it in a secure location — Apple allows downloading this file only once).
7. Record the following values:
   - **Key ID**: (10-character alphanumeric string displayed on the download screen).
   - **Team ID**: (10-character ID in the top right corner of your Apple Developer account).

### Step 1.2: Configure APNs in Azure Notification Hubs
1. Open the [Azure Portal](https://portal.azure.com/).
2. Open your Notification Hub resource (`AZURE_NOTIFICATION_HUB_NAME`).
3. In the left navigation menu under **Settings**, select **Apple (APNs)**.
4. Set **Authentication Mode** to **Token**.
5. Provide the required details:
   - **Key ID**: The 10-character Key ID from Step 1.1.
   - **Team ID**: Your Apple Developer Team ID.
   - **Bundle ID**: `com.thaqib.confpresencezeropoc`
   - **Token (.p8 file)**: Upload the downloaded `.p8` file.
   - **Application Mode**:
     - Select **Sandbox** for development/TestFlight testing.
     - Select **Production** for live App Store releases.
6. Click **Save**.

### Step 1.3: Configure iOS Push Entitlements in `app.json`
Ensure `apps/mobile/app.json` has background notification modes and the notification plugin:
```json
{
  "expo": {
    "ios": {
      "bundleIdentifier": "com.thaqib.confpresencezeropoc",
      "infoPlist": {
        "UIBackgroundModes": ["remote-notification"]
      },
      "entitlements": {
        "aps-environment": "development"
      }
    },
    "plugins": [
      "expo-notifications"
    ]
  }
}
```

### Step 1.4: Mobile Code Integration (`apps/mobile/src/services/pushNotifications.ts`)
Update device push token registration to handle iOS:
```ts
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { getOrCreateDeviceId } from "./deviceIdentity";
import { authFetch } from "./auth";
import { AppLogger } from "./appLogger";

export async function registerForPushNotifications(serverUrl: string): Promise<void> {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (status !== "granted") {
      const result = await Notifications.requestPermissionsAsync();
      status = result.status;
    }
    if (status !== "granted") {
      AppLogger.log("WARN", "Push notification permission denied", "warn");
      return;
    }

    const installationId = await getOrCreateDeviceId();
    // On iOS, this returns the raw APNs device token hex string
    const token = await Notifications.getDevicePushTokenAsync();

    const res = await authFetch(`${serverUrl}/api/push/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        installationId,
        pushChannel: token.data,
        platform: Platform.OS // "ios" | "android"
      })
    });
    if (res.ok) {
      AppLogger.log("INFO", "Registered for push notifications");
    }
  } catch (err: any) {
    AppLogger.log("ERROR", `Push registration failed: ${err?.message || err}`, "error");
  }
}
```

### Step 1.5: Backend APNs Installation Support (`backend/src/notifications.ts`)
Update Azure Notification Hub registration to handle APNs installations:
```ts
import { 
  NotificationHubsClient, 
  createFcmV1Installation, 
  createApnsInstallation,
  createFirebaseV1NotificationBody,
  createAppleNotificationBody
} from "@azure/notification-hubs";

export async function registerInstallation(
  installationId: string, 
  userId: string, 
  email: string | undefined, 
  pushChannel: string,
  platform: "android" | "ios" = "android"
) {
  if (!client) throw new Error("Push notifications not configured");

  const tags = email ? [`email:${email.trim().toLowerCase().replace(/\+/g, "")}`] : [];

  if (platform === "ios") {
    const installation = createApnsInstallation({
      installationId,
      pushChannel, // Raw APNs device token
      userId,
      tags
    });
    await client.createOrUpdateInstallation(installation);
  } else {
    const installation = createFcmV1Installation({
      installationId,
      pushChannel, // FCM Token
      userId,
      tags
    });
    await client.createOrUpdateInstallation(installation);
  }
}
```

---

## 🔐 Section 2: Multi-Provider Authentication Setup for iOS

XConnect uses stateless JWT token verification directly against identity provider endpoints.

### 2.1 Firebase Email & Password
- **Status**: **Fully operational out-of-the-box on iOS.**
- **Details**: Built directly on Firebase REST endpoints (`identitytoolkit.googleapis.com`). No native iOS pods or `GoogleService-Info.plist` required.

---

### 2.2 Google Sign-In for iOS
Google OAuth uses `expo-auth-session` with Authorization Code + PKCE.

#### Step 2.2.1: Create iOS OAuth Client in Google Cloud Console
1. Go to [Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials) under the XConnect project.
2. Click **Create Credentials** → **OAuth client ID**.
3. Set **Application type** to: **iOS**.
4. Set **Name** to: `XConnect iOS Client`.
5. Set **Bundle ID** to: `com.thaqib.confpresencezeropoc`.
6. Click **Create**.
7. Copy the generated:
   - **Client ID** (e.g., `113829759136-xxxxxxxx.apps.googleusercontent.com`).
   - **iOS URL Scheme / Reversed Client ID** (e.g., `com.googleusercontent.apps.113829759136-xxxxxxxx`).

#### Step 2.2.2: Add Client ID to Config (`apps/mobile/src/config/authConfig.ts`)
```ts
export const GOOGLE_IOS_CLIENT_ID = "113829759136-xxxxxxxx.apps.googleusercontent.com";
```

#### Step 2.2.3: Support Dynamic Platform OAuth in `apps/mobile/src/services/auth.ts`
```ts
const googleClientId = Platform.OS === "ios" ? GOOGLE_IOS_CLIENT_ID : GOOGLE_ANDROID_CLIENT_ID;
const redirectUri = `com.googleusercontent.apps.${googleClientId.replace(".apps.googleusercontent.com", "")}:/oauthredirect`;
```

---

### 2.3 Microsoft Entra ID (Azure AD) Sign-In
- **App Registration ID**: `7181eccc-9044-4908-b881-dcdb45b388a4`
- **Authority**: `https://login.microsoftonline.com/common/v2.0`
- **Redirect URI**: `xconnect://auth`

#### Configuration Check:
1. Open [Azure Portal - Entra ID App Registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade).
2. Open the registration `7181eccc-9044-4908-b881-dcdb45b388a4`.
3. Under **Authentication** → **Platform configurations**, verify that `xconnect://auth` is registered under **Mobile and desktop applications**.
4. Because `scheme: "xconnect"` is set in `app.json`, iOS system Safari automatically redirects back into the app upon successful authentication.

---

### 2.4 Apple Review Requirement: Sign in with Apple (Guideline 4.8)
> [!WARNING]
> Apple App Store Review Guideline 4.8 requires that any app offering third-party social login (such as Google) must also provide **Sign in with Apple**.

#### Implementation Steps:
1. In [Apple Developer Portal - Identifiers](https://developer.apple.com/account/resources/identifiers/list), select `com.thaqib.confpresencezeropoc` and enable the **Sign in with Apple** capability.
2. Install Expo's Apple Auth module:
   ```bash
   npx expo install expo-apple-authentication
   ```
3. Add the Apple Sign-In button on iOS in `LoginScreen.tsx`:
   ```tsx
   import * as AppleAuthentication from "expo-apple-authentication";

   {Platform.OS === "ios" && (
     <AppleAuthentication.AppleAuthenticationButton
       buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
       buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
       cornerRadius={8}
       style={{ width: "100%", height: 48 }}
       onPress={handleAppleSignIn}
     />
   )}
   ```

---

## 🛠️ Section 3: Local macOS Development & Build Commands

Run these commands in `apps/mobile` on your MacBook:

```bash
# 1. Install dependencies
npm install

# 2. Generate native iOS workspace and install CocoaPods
npx expo prebuild --platform ios

# 3. Run on iOS Simulator or connected iPhone
npx expo run:ios

# 4. Trigger production TestFlight build via EAS
eas build --platform ios --profile production

# 5. Submit to TestFlight
eas submit --platform ios --profile production
```

---

## ✅ Section 4: iOS Verification Checklist

- [ ] Native Swift modules compile cleanly (`ConfPresenceBleModule`, `ConfPresenceUltrasonicModule`, `ConfPresenceWifiModule`).
- [ ] Email/Password sign-up and sign-in works.
- [ ] Google Sign-In displays OAuth consent and redirects back.
- [ ] Microsoft Entra ID sign-in authenticates and returns valid JWT.
- [ ] iOS Push Notification permission dialog appears on first launch.
- [ ] Test notification sent from server (`POST /api/admin/notifications/send`) appears in iOS Notification Center.
