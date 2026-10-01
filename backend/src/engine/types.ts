import type { UltrasonicObservation, WifiApObservation } from "@confpresence/shared";

export const WINDOW_MS = 30_000; // 30 seconds sliding active window
export const MIN_RSSI = -85;     // 20+ meters coverage in open line-of-sight halls

// Motion-anomaly thresholds.
export const MOTION_STILL_VARIANCE_THRESHOLD = 0.02; // below this, a ~10s window counts as "still"
export const MOTION_SLIDING_WINDOW_SIZE = Number(process.env.MOTION_SLIDING_WINDOW_SIZE) || 3;
export const MOTION_MIN_WINDOWS_FOR_FLAG = Math.min(3, MOTION_SLIDING_WINDOW_SIZE); // batches needed before a flag is meaningful
export const MOTION_STILL_FRACTION_THRESHOLD = 0.9;  // fraction of the sliding window that must be still to flag

/** How long a device can drop out of a room's cluster before its stay is considered over. */
export const ROOM_MEMBERSHIP_GRACE_MS = 45_000;

/**
 * How long a room can go quiet before the next use of its name starts a brand-new occurrence
 * instead of resuming the old one.
 */
export const ROOM_AUTO_EXPIRY_MS = 15 * 60 * 1000;

/** How long a "your room was ended" notice stays available to a device that hasn't polled yet. */
export const ROOM_ENDED_NOTICE_TTL_MS = 10 * 60 * 1000;

export type DeviceRecord = {
  deviceId: string;
  displayName?: string;
  role: "presenter" | "attendee";
  roomId?: string;
  /** Signed-in person behind this device (undefined when auth is off). */
  userId?: string;
  email?: string;
  /** Session label the device joined under (grouping only; a room's identity is its occurrence ID). */
  sessionLabel?: string;
  rotatingId?: string;
  wifiFingerprint?: WifiApObservation[];
  uwbDiscoveryToken?: string;
  uwbTokenUpdatedAt?: number;
  wifiHistory?: Map<string, { ap: WifiApObservation; lastSeen: number }>;
  /** Most recent motion windows (true = still), newest last, capped at MOTION_SLIDING_WINDOW_SIZE. */
  motionWindowHistory?: boolean[];
  /** Ultrasonic acoustic observation (if heard) */
  ultrasonicObservation?: UltrasonicObservation;
  ultrasonicObservedAt?: number;
  /** Active ultrasonic token emitted (if presenter) */
  ultrasonicEmittedToken?: string;
  updatedAt: number;
};

export type ActiveRoomRecord = {
  /** Real, unique identity of this occurrence of the room (rooms.id). */
  roomId: string;
  code: string;
  sessionLabel: string;
  startedAt: number;
  lastActivityAt: number;
  /**
   * Signed-in person currently hosting this occurrence, refreshed on every presenter join/ingest
   * so a takeover moves ownership with it.
   */
  ownerUserId?: string;
};

export type RoomMembershipRecord = {
  /** Occurrence ID (rooms.id) this stay belongs to. */
  roomId: string;
  roomCode: string;
  sessionLabel: string;
  userId?: string;
  role: "presenter" | "attendee";
  startedAt: number;
  lastSeenAt: number;
  lastConfidence?: number;
  /** Running mean of every heartbeat's confidence, kept as sum/count so each batch is O(1) and
   *  the individual readings never have to be held (or written) anywhere. */
  confidenceSum: number;
  confidenceCount: number;
  ultrasonicVerified?: boolean;
  motionAnomalyFlag?: boolean;
};

/**
 * An attendee's just-closed stay in a room that is still active, kept so the live view can show
 * who left mid-session separately from who's currently in the room. Snapshotted off the closing
 * RoomMembershipRecord (plus whatever displayName/email the device record still had), not kept
 * as a live reference to either — both can be deleted or reused the instant after this is built.
 * Dropped entirely when the room occurrence ends; the final record is in Postgres by then.
 */
export type RecentlyLeftRecord = {
  deviceId: string;
  displayName?: string;
  email?: string;
  startedAt: number;
  leftAt: number;
  lastConfidence?: number;
  motionAnomalyFlag?: boolean;
  ultrasonicVerified?: boolean;
};
