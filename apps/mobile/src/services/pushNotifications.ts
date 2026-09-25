import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { getOrCreateDeviceId } from "./deviceIdentity";
import { authFetch } from "./auth";
import { AppLogger } from "./appLogger";

// Module-load side effect, deliberately not inside a function: FCM only auto-displays a
// notification in the system tray when the app is backgrounded or closed. With the app open in
// the foreground (the common case while testing), nothing shows at all unless a handler like this
// explicitly tells the OS to display it anyway — this is why a "sent" notification with a
// registered device can still produce nothing visible if the app happens to be open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false
  })
});

/**
 * Registers this device for push notifications, straight to Azure Notification Hubs — not
 * Expo's own push service. Gets the RAW FCM device token (not Expo's wrapped one), since the
 * server hands it directly to Notification Hubs, which relays to FCM itself. Uses the device's
 * own stable id as the installation id, so re-registering (e.g. every sign-in) is an idempotent
 * overwrite, not a growing list of stale installations per device.
 */
export async function registerForPushNotifications(serverUrl: string): Promise<void> {
  if (Platform.OS !== "android") return; // FCM v1 only — no APNs credentials configured yet.

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
    const token = await Notifications.getDevicePushTokenAsync();

    const res = await authFetch(`${serverUrl}/api/push/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ installationId, pushChannel: token.data })
    });
    if (res.ok) {
      AppLogger.log("INFO", "Registered for push notifications");
    } else {
      AppLogger.log("WARN", `Push registration returned ${res.status}`, "warn");
    }
  } catch (err: any) {
    AppLogger.log("ERROR", `Push registration failed: ${err?.message || err}`, "error");
  }
}
