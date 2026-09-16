export type ParticipantRole = "presenter" | "attendee";

export interface PeerObservation {
  rotatingId: string;
  rssi: number;
  seenAt: string;
}

export interface WifiApObservation {
  bssid: string;
  ssid?: string;
  rssi: number;
  frequency?: number;
}

export interface UltrasonicObservation {
  token: string;
  confidence: number;
  detectedAt: string;
  frequency?: number;
}

export interface PresenceBatch {
  sessionId: string;
  deviceId: string;
  displayName?: string;
  rotatingId: string;
  role: ParticipantRole;
  roomId?: string;
  capturedAt: string;
  peers: PeerObservation[];
  wifiFingerprint?: WifiApObservation[];
  motionState?: "moving" | "still" | "unknown";
  /** Variance of accelerometer magnitude over this batch's window (gravity-compensated). Low and sustained across a session suggests an unattended device. */
  motionVariance?: number;
  /** Acoustic token observed via ultrasonic microphone sensor (if heard during duty cycle). */
  ultrasonicObservation?: UltrasonicObservation;
  /** Active ultrasonic token emitted by this device (if presenter). */
  ultrasonicEmittedToken?: string;
}

export interface JoinSessionRequest {
  sessionId: string;
  deviceId: string;
  displayName?: string;
  role: ParticipantRole;
  roomId?: string;
}

export interface UwbTokenRequest {
  deviceId: string;
  discoveryTokenBase64: string;
}

export interface RoomMemberInfo {
  deviceId: string;
  displayName: string;
  role: ParticipantRole;
  confidence?: number;
  wifiSimilarity?: number;
  uwbDiscoveryToken?: string;
  motionAnomalyFlag?: boolean;
  /** True if this attendee's phone physically heard and verified the presenter's ultrasonic room token. */
  ultrasonicVerified?: boolean;
  /** Milliseconds this device has been continuously assigned to this room. Resets if the device drops out of the room's cluster for longer than the grace period. */
  durationMs?: number;
}

export interface LiveRoomState {
  sessionId: string;
  roomId: string;
  presenterDeviceId?: string;
  presenterName?: string;
  estimatedMemberDeviceIds: string[];
  members?: RoomMemberInfo[];
  updatedAt: string;
}

/**
 * Derives a standardized 3-6 character uppercase acoustic token for any arbitrary room name.
 * Examples:
 * - "room-a" -> "RM-A", "room-b" -> "RM-B"
 * - "hall-1" -> "HL-1", "hall-b" -> "HL-B"
 * - "workshop-c" -> "WK-C", "workshop-1" -> "WK-1"
 * - "stage-3" -> "ST-3"
 * - "auditorium" -> "AUD"
 * - "conference-hall" -> "CONF"
 */
export function getAcousticTokenForRoom(roomId?: string): string {
  if (!roomId || !roomId.trim()) return "RM-A";
  const clean = roomId.trim().toLowerCase();

  if (clean.startsWith("room-") || clean.startsWith("room_") || clean.startsWith("room ")) {
    const suffix = clean.replace(/^room[\-_ ]+/i, "").toUpperCase();
    return `RM-${suffix}`.slice(0, 6);
  }
  if (clean.startsWith("hall-") || clean.startsWith("hall_") || clean.startsWith("hall ")) {
    const suffix = clean.replace(/^hall[\-_ ]+/i, "").toUpperCase();
    return `HL-${suffix}`.slice(0, 6);
  }
  if (clean.startsWith("workshop-") || clean.startsWith("workshop_") || clean.startsWith("workshop ")) {
    const suffix = clean.replace(/^workshop[\-_ ]+/i, "").toUpperCase();
    return `WK-${suffix}`.slice(0, 6);
  }
  if (clean.startsWith("stage-") || clean.startsWith("stage_") || clean.startsWith("stage ")) {
    const suffix = clean.replace(/^stage[\-_ ]+/i, "").toUpperCase();
    return `ST-${suffix}`.slice(0, 6);
  }
  if (clean === "auditorium" || clean.startsWith("aud")) {
    return "AUD";
  }

  const alpha = clean.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return (alpha || "RM-A").slice(0, 6);
}
