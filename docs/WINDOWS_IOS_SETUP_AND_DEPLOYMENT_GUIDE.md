# Windows Developer Guide: iOS Push Notifications, Multi-Provider Auth & Cloud Deployment

This document is a comprehensive, step-by-step guide for a **Windows developer** to configure **iOS Push Notifications (APNs + Azure Notification Hubs)**, **Multi-Provider Authentication (Firebase, Google, Microsoft Entra ID)**, and deploy iOS builds to **TestFlight** using **Expo Application Services (EAS)** without needing a local MacBook.

---

## 📋 Prerequisites & Information Checklist

Before beginning, ensure you have the following credentials from your manager/team:

| Item | Description | Example / Location |
| :--- | :--- | :--- |
| **APNs Auth Key File** | Apple Push Notification key file | `AuthKey_XXXXXXXXXX.p8` (saved on your Windows PC) |
| **APNs Key ID** | 10-character alphanumeric ID | e.g. `9ABC123XYZ` |
| **Apple Team ID / Issuer ID** | 10-character Team ID from Apple Developer account | e.g. `ABC1234567` |
| **iOS Bundle Identifier** | Target bundle ID registered in Apple Developer | `com.thaqib.confpresencezeropoc` |
| **Azure Portal Access** | Access to Azure Subscription housing the Notification Hub & Entra ID | `portal.azure.com` |
| **Google Cloud Console Access** | Access to project containing Firebase auth | `console.cloud.google.com` |
| **Expo EAS Account** | CLI logged in to Expo team account | `azhar-wct-team` / `thaqib` |

---

## 🔔 Phase 1: Azure Notification Hubs Configuration (In Windows Browser)

Your backend server relies on **Azure Notification Hubs** to dispatch notifications. Since you now have the `.p8` key and Issuer/Team ID, configure Azure to handle Apple devices:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Azure Portal (Browser)                          │
│                                                                        │
│   Azure Notification Hub ──> Settings ──> Apple (APNs)                 │
│                                                                        │
│   • Auth Mode: Token                                                   │
│   • Key ID: <10-char Key ID>                                           │
│   • Team ID: <10-char Team ID / Issuer ID>                             │
│   • Bundle ID: com.thaqib.confpresencezeropoc                          │
│   • Token: [Upload AuthKey_XXXXXXXXXX.p8]                              │
│   • Application Mode: Production (or Sandbox for local dev builds)     │
└────────────────────────────────────────────────────────────────────────┘
```

### Step-by-Step Instructions:
1. Open your browser on Windows and go to [Azure Portal](https://portal.azure.com/).
2. In the search bar at the top, search for **Notification Hubs** and open your Notification Hub instance (`AZURE_NOTIFICATION_HUB_NAME`).
3. In the left navigation pane under **Settings**, click on **Apple (APNs)**.
4. Set **Authentication Mode** to **Token**.
5. Fill in the fields:
   - **Key ID**: Enter the 10-character Key ID provided by your manager.
   - **Team ID**: Enter the 10-character Team ID (Issuer ID) provided by your manager.
   - **Bundle ID**: Enter `com.thaqib.confpresencezeropoc` (must match `app.json`).
   - **Token**: Click **Browse** / **Choose File** and select the `.p8` file from your Windows file system.
   - **Application Mode**:
     - Select **Production** (Recommended for TestFlight and App Store releases; token authentication handles APNs routing).
6. Click **Save** at the top.

---

## 🔐 Phase 2: Google & Microsoft Auth Setup for iOS (In Windows Browser)

### 2.1 Google Cloud Console (Create iOS OAuth Client)
On Android, Google Sign-In uses `GOOGLE_ANDROID_CLIENT_ID`. For iOS, Google requires a dedicated **iOS Client ID** registered with your iOS Bundle Identifier.

1. Open [Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials).
2. Ensure you are in the same project as your Firebase account (`FIREBASE_API_KEY`).
3. Click **+ CREATE CREDENTIALS** at the top → select **OAuth client ID**.
4. In **Application type**, select **iOS**.
5. In **Name**, enter `XConnect iOS Client`.
6. In **Bundle ID**, enter `com.thaqib.confpresencezeropoc`.
7. Click **CREATE**.
8. A modal will pop up with two crucial values:
   - **Client ID**: e.g., `113829759136-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com`
   - **iOS URL scheme (Reversed Client ID)**: e.g., `com.googleusercontent.apps.113829759136-abcdefghijklmnopqrstuvwxyz`
9. Copy both values.

### 2.2 Microsoft Entra ID (Verify iOS Redirect URI)
1. Open [Azure Portal - Entra ID App Registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade).
2. Open your registration (the Application (client) ID in `AUTH_CLIENT_ID`, see 3.1).
3. In the left menu, click **Authentication**.
4. Under **Platform configurations**, verify that a platform exists for **Mobile and desktop applications**.
5. Ensure `xconnect://auth` is present in the list of **Redirect URIs**. (If missing, click **Add URI** and add `xconnect://auth`, then click **Save**).

---

## 💻 Phase 3: Codebase Updates (On Your Windows PC)

Follow these exact code changes to enable cross-platform support for both Android and iOS.

### 3.1 Update `apps/mobile/src/config/authConfig.ts`
Add the new iOS Google Client ID alongside the Android one:

```ts
// apps/mobile/src/config/authConfig.ts

export const FIREBASE_API_KEY = "AIzaSyDskycfYoUxF_TMPWJ_QR_OH5sED7q9Roc";

// Android OAuth client
export const GOOGLE_ANDROID_CLIENT_ID = "113829759136-bh8qvak0thcvkl4o1cscmbfhe2iijs08.apps.googleusercontent.com";

// iOS OAuth client (Generated in Phase 2.1)
export const GOOGLE_IOS_CLIENT_ID = "113829759136-YOUR_IOS_CLIENT_ID.apps.googleusercontent.com";

// Microsoft sign-in
export const AUTH_AUTHORITY = "https://login.microsoftonline.com/common/v2.0";
export const AUTH_CLIENT_ID = "<Application (client) ID of the Microsoft app registration>";
export const AUTH_REDIRECT_SCHEME = "xconnect";
```

---

### 3.2 Update `apps/mobile/src/services/auth.ts`
Update Google Sign-In to select the appropriate OAuth Client ID and Redirect Scheme depending on whether the app is running on Android or iOS:

```ts
// apps/mobile/src/services/auth.ts

import { 
  AUTH_AUTHORITY, 
  AUTH_CLIENT_ID, 
  AUTH_REDIRECT_SCHEME, 
  FIREBASE_API_KEY, 
  GOOGLE_ANDROID_CLIENT_ID,
  GOOGLE_IOS_CLIENT_ID 
} from "../config/authConfig";

export const emailSignInAvailable = Boolean(FIREBASE_API_KEY);
export const googleSignInAvailable = 
  Boolean(FIREBASE_API_KEY) && 
  Boolean(Platform.OS === "android" ? GOOGLE_ANDROID_CLIENT_ID : GOOGLE_IOS_CLIENT_ID);
export const microsoftSignInAvailable = Boolean(AUTH_AUTHORITY && AUTH_CLIENT_ID);
export const authConfigured = emailSignInAvailable || microsoftSignInAvailable || googleSignInAvailable;

export async function signInWithGoogle(): Promise<{ ok: boolean; error?: string }> {
  try {
    const clientId = Platform.OS === "ios" ? GOOGLE_IOS_CLIENT_ID : GOOGLE_ANDROID_CLIENT_ID;
    if (!clientId) throw new Error("Google Client ID not configured for this platform");

    const discovery = await AuthSession.fetchDiscoveryAsync("https://accounts.google.com");
    
    // Standard OAuth redirect URI matching Google's reversed client ID scheme
    const redirectUri = `com.googleusercontent.apps.${clientId.replace(".apps.googleusercontent.com", "")}:/oauthredirect`;
    
    const request = new AuthSession.AuthRequest({
      clientId,
      redirectUri,
      scopes: ["openid", "profile", "email"],
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true
    });
    
    const result = await request.promptAsync(discovery);
    if (result.type !== "success") {
      return { ok: false, error: result.type === "cancel" || result.type === "dismiss" ? undefined : "Google sign-in failed" };
    }
    
    const tokens = await AuthSession.exchangeCodeAsync(
      {
        clientId,
        code: result.params.code,
        redirectUri,
        extraParams: request.codeVerifier ? { code_verifier: request.codeVerifier } : undefined
      },
      discovery
    );
    
    if (!tokens.idToken) return { ok: false, error: "Google did not return a sign-in token." };
    
    const data = await firebasePost("accounts:signInWithIdp", {
      postBody: `id_token=${encodeURIComponent(tokens.idToken)}&providerId=google.com`,
      requestUri: "http://localhost",
      returnSecureToken: true,
      returnIdpCredential: true
    });
    
    await finishFirebaseSignIn(data);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Google sign-in failed" };
  }
}
```

---

### 3.3 Update `apps/mobile/src/services/pushNotifications.ts`
Remove the Android-only restriction so iOS devices can register their raw APNs device token:

```ts
// apps/mobile/src/services/pushNotifications.ts

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { getOrCreateDeviceId } from "./deviceIdentity";
import { authFetch } from "./auth";
import { AppLogger } from "./appLogger";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false
  })
});

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
    
    // On Android, this returns the FCM registration token.
    // On iOS, this returns the raw APNs device token hex string.
    const token = await Notifications.getDevicePushTokenAsync();

    const res = await authFetch(`${serverUrl}/api/push/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ 
        installationId, 
        pushChannel: token.data,
        platform: Platform.OS // "android" | "ios"
      })
    });
    
    if (res.ok) {
      AppLogger.log("INFO", `Registered for push notifications (${Platform.OS})`);
    } else {
      AppLogger.log("WARN", `Push registration returned ${res.status}`, "warn");
    }
  } catch (err: any) {
    AppLogger.log("ERROR", `Push registration failed: ${err?.message || err}`, "error");
  }
}
```

---

### 3.4 Update Backend Server (`backend/src/notifications.ts`)
Support both FCM v1 and APNs installations and notifications in Azure Notification Hubs:

```ts
// backend/src/notifications.ts

import { 
  NotificationHubsClient, 
  createFcmV1Notification, 
  createFcmV1Installation, 
  createFirebaseV1NotificationBody, 
  createApnsInstallation,
  createAppleNotificationBody,
  createAppleNotification,
  createTagExpression 
} from "@azure/notification-hubs";
import { db, schema } from "./db/index.js";

const CONNECTION_STRING = process.env.AZURE_NOTIFICATION_HUB_CONNECTION_STRING;
const HUB_NAME = process.env.AZURE_NOTIFICATION_HUB_NAME;

export const pushEnabled = Boolean(CONNECTION_STRING && HUB_NAME);
const client = pushEnabled ? new NotificationHubsClient(CONNECTION_STRING!, HUB_NAME!) : undefined;

function emailTag(email: string): string {
  return `email:${email.trim().toLowerCase().replace(/\+/g, "")}`;
}

export async function registerInstallation(
  installationId: string, 
  userId: string, 
  email: string | undefined, 
  pushChannel: string,
  platform: string = "android"
) {
  if (!client) throw new Error("Push notifications are not configured");

  const tags = email ? [emailTag(email)] : [];
  const normalizedPlatform = platform.toLowerCase() === "ios" ? "ios" : "fcmv1";

  if (normalizedPlatform === "ios") {
    const installation = createApnsInstallation({
      installationId,
      pushChannel, // APNs Device Token
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

  if (db) {
    const now = new Date();
    await db
      .insert(schema.pushInstallations)
      .values({ installationId, userId, email, platform: normalizedPlatform, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.pushInstallations.installationId,
        set: { userId, email, platform: normalizedPlatform, updatedAt: now }
      });
  }
}

export async function sendToEmails(
  emails: string[], 
  title: string, 
  body: string
): Promise<{ matchedEmails: string[]; unmatchedEmails: string[] }> {
  if (!client) throw new Error("Push notifications are not configured");

  const tagExpression = createTagExpression(emails.map(emailTag));

  // 1. Send to Android devices (FCM v1)
  const androidNotification = createFcmV1Notification({
    body: createFirebaseV1NotificationBody({ message: { notification: { title, body } } })
  });
  
  // 2. Send to iOS devices (APNs)
  const iosNotification = createAppleNotification({
    body: createAppleNotificationBody({
      aps: {
        alert: { title, body },
        sound: "default"
      }
    })
  });

  // Dispatch both in parallel
  await Promise.allSettled([
    client.sendNotification(androidNotification, { tagExpression }),
    client.sendNotification(iosNotification, { tagExpression })
  ]);

  let matchedEmails = emails;
  let unmatchedEmails: string[] = [];
  if (db) {
    const lowered = emails.map((e) => e.trim().toLowerCase());
    const rows = await db
      .select({ email: schema.pushInstallations.email })
      .from(schema.pushInstallations);
    const registered = new Set(rows.map((r) => r.email?.trim().toLowerCase()).filter(Boolean));
    matchedEmails = emails.filter((_, i) => registered.has(lowered[i]));
    unmatchedEmails = emails.filter((_, i) => !registered.has(lowered[i]));
  }
  return { matchedEmails, unmatchedEmails };
}
```

---

### 3.5 Update `apps/mobile/app.json`
Configure iOS notification background modes and URL schemes:

```json
{
  "expo": {
    "name": "XConnect",
    "slug": "xconnect-poc",
    "scheme": "xconnect",
    "version": "0.1.0",
    "icon": "./assets/icon.png",
    "orientation": "portrait",
    "userInterfaceStyle": "light",
    "android": {
      "package": "com.confpresence.zero",
      "googleServicesFile": "./google-services.json",
      "permissions": [
        "android.permission.BLUETOOTH_SCAN",
        "android.permission.BLUETOOTH_ADVERTISE",
        "android.permission.BLUETOOTH_CONNECT",
        "android.permission.ACCESS_FINE_LOCATION"
      ]
    },
    "ios": {
      "bundleIdentifier": "com.thaqib.confpresencezeropoc",
      "supportsTablet": true,
      "infoPlist": {
        "UIBackgroundModes": ["remote-notification"],
        "NSBluetoothAlwaysUsageDescription": "ConfPresence ZERO uses Bluetooth Low Energy to detect in-room peer presence.",
        "NSBluetoothPeripheralUsageDescription": "ConfPresence ZERO broadcasts BLE tokens for zero-hardware presence detection.",
        "NSLocationWhenInUseUsageDescription": "ConfPresence ZERO uses location services to verify in-room Wi-Fi network fingerprints.",
        "ITSAppUsesNonExemptEncryption": false
      }
    },
    "extra": {
      "eas": {
        "projectId": "7dd6c543-831d-4c0c-8d12-bbef07b96e6e"
      }
    },
    "plugins": [
      "expo-web-browser",
      "expo-secure-store",
      "expo-notifications",
      "@react-native-community/datetimepicker"
    ]
  }
}
```

---

## ☁️ Phase 4: Building & Deploying iOS from Windows (Using EAS Cloud)

Because Expo provides **EAS Cloud Builders (macOS runners)**, you can build iOS binaries and deploy directly to TestFlight from your Windows terminal.

```
┌───────────────────────────────┐
│ Windows Terminal (Powershell) │
│                               │
│ Run: eas build --platform ios │
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│ Expo Cloud macOS Builder      │ ──> Compiles Swift Native Modules & CocoaPods
└───────────────┬───────────────┘     Signs with Apple Distribution Certificate
                │
                ▼
┌───────────────────────────────┐
│ App Store Connect /           │
│ TestFlight (Automatic Upload) │
└───────────────────────────────┘
```

### Step 4.1: Log in to EAS on Windows
```powershell
cd c:\Users\Admin\Documents\Codex\2026-08-13\XConnect\apps\mobile
npx eas-cli login
```

### Step 4.2: Trigger iOS Cloud Build
Run the production build:
```powershell
npx eas-cli build --platform ios --profile production
```

#### What EAS will prompt you on first run:
1. **Apple ID Authentication**: EAS will ask you to log in to your Apple Developer account or provide an **App Store Connect API Key**.
2. **Certificates & Provisioning Profiles**: Select **"Let EAS handle credentials"**. EAS will automatically generate the Apple Distribution Certificate and Provisioning Profile for `com.thaqib.confpresencezeropoc`.
3. **Build Execution**: EAS will compress your repository, send it to an Expo cloud macOS server, install CocoaPods, build the `.ipa`, and provide a progress link.

### Step 4.3: Submit to TestFlight from Windows
Once the build completes, submit it directly to TestFlight without leaving Windows:
```powershell
npx eas-cli submit --platform ios --profile production
```
*Or combine build and submission in one command:*
```powershell
npx eas-cli build --platform ios --profile production --auto-submit
```

---

## 🧪 Phase 5: Verification & End-to-End Test Plan

1. **Install Build on TestFlight**: Open TestFlight on an iOS device and install the newly published build.
2. **Test Push Notifications**:
   - Launch app on iPhone → Accept notification permissions prompt.
   - Check server logs or trigger `POST /api/admin/notifications/send` with the user's email.
   - Confirm notification appears in iOS Notification Center.
3. **Test Multi-Provider Auth**:
   - **Email/Password**: Create account & sign in.
   - **Google Sign-In**: Click "Sign in with Google", complete web consent, and verify redirect back to app.
   - **Microsoft Sign-In**: Click "Sign in with Microsoft", complete Entra ID auth, and verify redirect via `xconnect://auth`.
