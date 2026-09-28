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
  email?: string;
  role: ParticipantRole;
  confidence?: number;
  wifiSimilarity?: number;
  uwbDiscoveryToken?: string;
  motionAnomalyFlag?: boolean;
  /** True if this attendee's phone physically heard and verified the presenter's ultrasonic room token. */
  ultrasonicVerified?: boolean;
  /** Milliseconds this device has been continuously assigned to this room. Resets if the device drops out of the room's cluster for longer than the grace period. */
  durationMs?: number;
  startedAt?: string;
  endedAt?: string | null;
}

/**
 * An admin's check-in invitation to one person for one session label.
 *
 * This is an RSVP, never an attendance record. "accepted" means someone said they plan to be
 * there; whether they actually were still comes only from sensor-verified room membership.
 *
 * "expired" is lazily computed server-side once an invite's `eventAt` has passed while it was
 * still "pending" — it can no longer be accepted, declined, or (if already answered before
 * expiring) changed. An accepted/declined invite is never auto-expired: a session running late
 * shouldn't erase someone's real answer.
 */
export type InviteStatus = "pending" | "accepted" | "declined" | "expired";

/**
 * What an invite asks of someone. An attendee invite asks them to confirm they will be there; a
 * presenter invite is a room assignment, so it carries `roomCode` and accepting it lets them
 * start broadcasting that room without retyping it.
 */
export type InviteRole = "attendee" | "presenter";

/** One row of the admin's response roster. */
export interface SessionInvite {
  id: number;
  sessionId: string;
  email: string;
  /** The person's account name, falling back to their email when they have never signed in. */
  displayName: string;
  status: InviteStatus;
  /** When the event is scheduled for, if the admin set one. Informational only. */
  eventAt: string | null;
  /** Shared by every invite in the same session batch; returned so the admin edit form can
   *  prefill without a second request. */
  title?: string | null;
  message?: string | null;
  inviteRole: InviteRole;
  /** The room a presenter is assigned to. Always null on an attendee invite. */
  roomCode: string | null;
  createdAt: string;
  respondedAt: string | null;
}

/** An invitation as the invited person sees it. Pending ones are shown as a prompt to answer;
 *  answered ones become their reply history. */
export interface MyInvite {
  id: number;
  sessionId: string;
  title?: string | null;
  message?: string | null;
  status: InviteStatus;
  /** When the event is scheduled for, if the admin set one. */
  eventAt: string | null;
  inviteRole: InviteRole;
  /** The room this presenter is assigned to. Always null on an attendee invite. */
  roomCode: string | null;
  createdAt: string;
  respondedAt: string | null;
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

/**
 * Resolves an acoustic token (e.g. "WK-1", "HL-A", "AUD") back to a human-readable room name.
 */
export function getRoomForAcousticToken(token?: string, knownRooms?: string[]): string | undefined {
  if (!token || !token.trim()) return undefined;
  const upperToken = token.trim().toUpperCase();

  // 1. Check against known rooms list
  if (knownRooms && Array.isArray(knownRooms)) {
    const match = knownRooms.find(r => getAcousticTokenForRoom(r) === upperToken);
    if (match) return match;
  }

  // 2. Heuristic resolution for standard prefixes
  if (upperToken.startsWith("WK-")) {
    return `Workshop ${upperToken.slice(3)}`;
  }
  if (upperToken.startsWith("HL-")) {
    return `Hall ${upperToken.slice(3)}`;
  }
  if (upperToken.startsWith("RM-")) {
    return `Room ${upperToken.slice(3)}`;
  }
  if (upperToken.startsWith("ST-")) {
    return `Stage ${upperToken.slice(3)}`;
  }
  if (upperToken === "AUD") {
    return "Auditorium";
  }
  if (upperToken === "CONF") {
    return "Conference Hall";
  }

  return upperToken;
}
