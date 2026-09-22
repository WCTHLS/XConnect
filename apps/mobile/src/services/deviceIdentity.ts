import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const STORE_KEY = "xconnect.deviceId";

let cachedId: string | undefined;

/**
 * Stable per-install identifier: generated once, then persisted, so closing and reopening the
 * app (or a brief network drop) resumes the same device instead of the server seeing a new one
 * every launch. Deliberately distinct from the signed-in account's user id — this identifies the
 * physical device, which is what live proximity tracking (BLE, room_membership) keys off, and it
 * stays independent so the same account can be signed in on more than one device at once. A
 * reinstall or cleared app storage starts a fresh id, same as a genuinely new device.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  if (cachedId) return cachedId;
  try {
    const stored = await SecureStore.getItemAsync(STORE_KEY);
    if (stored) {
      cachedId = stored;
      return cachedId;
    }
  } catch {
    // Storage unavailable: fall through and hand out a fresh id for this run only.
  }
  const fresh = `${Platform.OS}-${Math.random().toString(36).slice(2, 12)}`;
  try {
    await SecureStore.setItemAsync(STORE_KEY, fresh);
  } catch {
    // Couldn't persist it — this launch still works, just won't resume as the same device later.
  }
  cachedId = fresh;
  return cachedId;
}

export function createRotatingId(deviceId: string, epochMs = 60_000): string {
  const epoch = Math.floor(Date.now() / epochMs);
  const prefix = deviceId.slice(-8).padStart(8, "0");
  const epochStr = epoch.toString(36).slice(-6).padStart(6, "0");
  return `${prefix}-${epochStr}`;
}
