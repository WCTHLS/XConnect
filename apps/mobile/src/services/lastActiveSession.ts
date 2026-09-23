import * as SecureStore from "expo-secure-store";
import type { ParticipantRole } from "@confpresence/shared";

const STORE_KEY = "xconnect.lastActiveSession";

// Matches the server's ROOM_MEMBERSHIP_GRACE_MS (apps/api/src/inference.ts) — past this, the
// room's own grace window has already lapsed, so there's nothing meaningful left to "resume".
export const REJOIN_WINDOW_MS = 45_000;

export type ActiveSessionSnapshot = {
  role: ParticipantRole;
  roomId: string;
  sessionId: string;
  updatedAt: number;
};

/**
 * Set while sharing is on, cleared the moment it's stopped deliberately (the toggle, the
 * "Stop & Close Room" confirm, a presenter-conflict rejection, a room-ended notice). Re-saved
 * periodically while running so `updatedAt` reflects the last moment the app was known to be
 * alive, not just when sharing started — a rejoin only makes sense within REJOIN_WINDOW_MS of
 * that, not within REJOIN_WINDOW_MS of a session that's been running for hours.
 */
export async function saveActiveSession(snapshot: Omit<ActiveSessionSnapshot, "updatedAt">): Promise<void> {
  try {
    await SecureStore.setItemAsync(STORE_KEY, JSON.stringify({ ...snapshot, updatedAt: Date.now() }));
  } catch {
    // Best-effort: worst case, no rejoin prompt next launch.
  }
}

export async function clearActiveSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(STORE_KEY);
  } catch {
    // Nothing to do if this fails — a stale entry just means an extra rejoin prompt later.
  }
}

/** Only returns a snapshot still within REJOIN_WINDOW_MS of its last refresh; clears it otherwise. */
export async function getActiveSession(): Promise<ActiveSessionSnapshot | undefined> {
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (parsed?.role !== "presenter" && parsed?.role !== "attendee") return undefined;
    if (typeof parsed.roomId !== "string" || typeof parsed.sessionId !== "string") return undefined;
    if (typeof parsed.updatedAt !== "number") return undefined;
    if (Date.now() - parsed.updatedAt >= REJOIN_WINDOW_MS) {
      await clearActiveSession();
      return undefined;
    }
    return parsed as ActiveSessionSnapshot;
  } catch {
    return undefined;
  }
}
