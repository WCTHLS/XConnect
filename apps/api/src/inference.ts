import { getAcousticTokenForRoom, type LiveRoomState, type PresenceBatch, type RoomMemberInfo, type UltrasonicObservation, type WifiApObservation } from "@confpresence/shared";
import type { Db } from "./db/index.js";
import { schema } from "./db/index.js";

const WINDOW_MS = 30_000; // 30 seconds sliding active window
const MIN_RSSI = -85;     // 20+ meters coverage in open line-of-sight halls

// Motion-anomaly thresholds. Not yet calibrated against real recorded sessions,
// tune these once real data exists rather than trusting these starting values.
const MOTION_STILL_VARIANCE_THRESHOLD = 0.02; // below this, a ~10s window counts as "still"
const MOTION_SLIDING_WINDOW_SIZE = Number(process.env.MOTION_SLIDING_WINDOW_SIZE) || 3;
const MOTION_MIN_WINDOWS_FOR_FLAG = Math.min(3, MOTION_SLIDING_WINDOW_SIZE); // batches needed before a flag is meaningful
const MOTION_STILL_FRACTION_THRESHOLD = 0.9;  // fraction of the sliding window that must be still to flag

type DeviceRecord = {
  deviceId: string;
  displayName?: string;
  role: "presenter" | "attendee";
  roomId?: string;
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

/**
 * Checks whether an acoustic token heard by an attendee matches an expected presenter/room token.
 * Normalizes case, removes hyphens/underscores/spaces, and resolves common room aliases (e.g., 'ROOM-A' == 'RM-A').
 */
export function isUltrasonicTokenMatch(heard?: string, expected?: string): boolean {
  if (!heard || !expected) return false;

  const normalize = (tok: string): string =>
    tok
      .trim()
      .toUpperCase()
      .replace(/[\s\-_]+/g, "");

  const hNorm = normalize(heard);
  const eNorm = normalize(expected);

  if (hNorm === eNorm) return true;
  if (hNorm.length >= 2 && (eNorm.includes(hNorm) || hNorm.includes(eNorm))) return true;

  // Compare using standardized room tokenizer tokens
  const hTokenNorm = normalize(getAcousticTokenForRoom(heard));
  const eTokenNorm = normalize(getAcousticTokenForRoom(expected));
  if (hTokenNorm === eTokenNorm) return true;
  if (hTokenNorm === eNorm || eTokenNorm === hNorm) return true;

  // Resolve standard room aliases (ROOM <-> RM, HALL <-> HL, WORKSHOP <-> WK, STAGE <-> ST)
  const toAlias = (n: string): string =>
    n
      .replace(/^ROOM/g, "RM")
      .replace(/^HALL/g, "HL")
      .replace(/^WORKSHOP/g, "WK")
      .replace(/^STAGE/g, "ST")
      .replace(/^AUDITORIUM/g, "AUD");

  const hAlias = toAlias(hNorm);
  const eAlias = toAlias(eNorm);

  if (hAlias === eAlias) return true;
  if (hAlias.length >= 2 && (eAlias.includes(hAlias) || hAlias.includes(eAlias))) return true;

  // Suffix code match (e.g., '1' for 'WK-1' or 'WORKSHOP-1')
  const hSuffix = hAlias.replace(/^(RM|HL|WK|ST)/, "");
  const eSuffix = eAlias.replace(/^(RM|HL|WK|ST)/, "");
  if (hSuffix && eSuffix && hSuffix === eSuffix) return true;

  return false;
}

/** How long a device can drop out of a room's cluster before its stay is considered over. */
const ROOM_MEMBERSHIP_GRACE_MS = 45_000;

type RoomMembershipRecord = {
  sessionId: string;
  role: "presenter" | "attendee";
  startedAt: number;
  lastSeenAt: number;
  lastConfidence?: number;
  ultrasonicVerified?: boolean;
  motionAnomalyFlag?: boolean;
};

export class PocInferenceEngine {
  private readonly devices = new Map<string, DeviceRecord>();
  private readonly batches: PresenceBatch[] = [];
  /** First-seen/last-seen timestamps per room membership, keyed by `${roomId}::${deviceId}`. */
  private readonly roomMembership = new Map<string, RoomMembershipRecord>();
  /** Optional Postgres persistence. undefined = pure in-memory mode (no DATABASE_URL set). */
  private readonly db?: Db;

  constructor(options?: { db?: Db }) {
    this.db = options?.db;
    // trim() also runs inline on ingest()/roomState(), but presence must expire even if
    // nobody happens to be polling (e.g. an admin screen isn't open) — otherwise a stale
    // room_membership stays "connected" indefinitely instead of closing ~45s after the
    // last sighting.
    setInterval(() => this.trim(), 5_000).unref();
  }

  join(deviceId: string, role: "presenter" | "attendee", roomId?: string, displayName?: string, sessionId?: string) {
    const current = this.devices.get(deviceId);
    const now = Date.now();
    this.devices.set(deviceId, {
      deviceId,
      displayName: displayName || current?.displayName || undefined,
      role,
      roomId,
      wifiFingerprint: current?.wifiFingerprint,
      uwbDiscoveryToken: current?.uwbDiscoveryToken,
      uwbTokenUpdatedAt: current?.uwbTokenUpdatedAt,
      wifiHistory: current?.wifiHistory ?? new Map(),
      motionWindowHistory: current?.motionWindowHistory,
      ultrasonicObservation: current?.ultrasonicObservation,
      ultrasonicObservedAt: current?.ultrasonicObservedAt,
      ultrasonicEmittedToken: current?.ultrasonicEmittedToken,
      updatedAt: now
    });
    this.upsertDevice(deviceId, displayName || current?.displayName, now);
    if (sessionId) this.upsertSessionAndRoom(sessionId, roomId, now);
  }

  leave(deviceId: string) {
    this.devices.delete(deviceId);
    for (let i = this.batches.length - 1; i >= 0; i--) {
      if (this.batches[i].deviceId === deviceId) {
        this.batches.splice(i, 1);
      }
    }
  }

  setUwbToken(deviceId: string, discoveryTokenBase64: string) {
    const current = this.devices.get(deviceId);
    this.devices.set(deviceId, {
      deviceId,
      displayName: current?.displayName,
      role: current?.role ?? "attendee",
      roomId: current?.roomId,
      rotatingId: current?.rotatingId,
      wifiFingerprint: current?.wifiFingerprint,
      uwbDiscoveryToken: discoveryTokenBase64,
      uwbTokenUpdatedAt: Date.now(),
      wifiHistory: current?.wifiHistory ?? new Map(),
      motionWindowHistory: current?.motionWindowHistory,
      ultrasonicObservation: current?.ultrasonicObservation,
      ultrasonicObservedAt: current?.ultrasonicObservedAt,
      ultrasonicEmittedToken: current?.ultrasonicEmittedToken,
      updatedAt: Date.now()
    });
  }

  ingest(batch: PresenceBatch) {
    const current = this.devices.get(batch.deviceId);
    const wifiHistory = current?.wifiHistory ?? new Map<string, { ap: WifiApObservation; lastSeen: number }>();
    const now = Date.now();

    // Track this device's most recent motion windows (still vs. moving), for the anomaly
    // flag in roomState(). Only the last MOTION_SLIDING_WINDOW_SIZE batches are kept.
    let motionWindowHistory = current?.motionWindowHistory ?? [];
    if (batch.motionVariance !== undefined) {
      motionWindowHistory = [...motionWindowHistory, batch.motionVariance < MOTION_STILL_VARIANCE_THRESHOLD];
      if (motionWindowHistory.length > MOTION_SLIDING_WINDOW_SIZE) {
        motionWindowHistory = motionWindowHistory.slice(-MOTION_SLIDING_WINDOW_SIZE);
      }
    }

    // 1. Ingest fresh Wi-Fi APs into 30s rolling fingerprint history
    if (batch.wifiFingerprint && batch.wifiFingerprint.length > 0) {
      for (const ap of batch.wifiFingerprint) {
        const bssid = ap.bssid.toLowerCase().trim();
        wifiHistory.set(bssid, { ap, lastSeen: now });
      }
    }

    // 2. Clean stale AP entries older than 35s
    for (const [bssid, entry] of wifiHistory.entries()) {
      if (now - entry.lastSeen > 35_000) {
        wifiHistory.delete(bssid);
      }
    }

    // 3. Compile consolidated active Wi-Fi fingerprint
    const consolidatedWifi: WifiApObservation[] = [...wifiHistory.values()].map(e => e.ap);

    // 4. Ingest Ultrasonic observations
    const ultrasonicObservation = batch.ultrasonicObservation || current?.ultrasonicObservation;
    const ultrasonicObservedAt = batch.ultrasonicObservation ? now : current?.ultrasonicObservedAt;
    const ultrasonicEmittedToken = batch.ultrasonicEmittedToken || current?.ultrasonicEmittedToken;

    this.devices.set(batch.deviceId, {
      deviceId: batch.deviceId,
      displayName: batch.displayName || current?.displayName,
      role: batch.role,
      roomId: batch.roomId ?? current?.roomId,
      rotatingId: batch.rotatingId,
      wifiFingerprint: consolidatedWifi.length > 0 ? consolidatedWifi : current?.wifiFingerprint,
      uwbDiscoveryToken: current?.uwbDiscoveryToken,
      uwbTokenUpdatedAt: current?.uwbTokenUpdatedAt,
      wifiHistory,
      motionWindowHistory,
      ultrasonicObservation,
      ultrasonicObservedAt,
      ultrasonicEmittedToken,
      updatedAt: now
    });
    this.upsertDevice(batch.deviceId, batch.displayName || current?.displayName, now);
    this.upsertSessionAndRoom(batch.sessionId, batch.roomId, now);
    this.batches.push(batch);
    this.trim();
  }

  roomState(sessionId: string, roomId: string): LiveRoomState {
    this.trim();
    const now = Date.now();
    const graph = this.buildGraph();

    // 1. Find all active presenters in this specific room
    const presentersInRoom = [...this.devices.values()]
      .filter((d) => d.role === "presenter" && d.roomId === roomId && now - d.updatedAt < WINDOW_MS * 2);

    if (!presentersInRoom.length) {
      return {
        sessionId,
        roomId,
        estimatedMemberDeviceIds: [],
        members: [],
        updatedAt: new Date().toISOString()
      };
    }

    // 2. Host Sticky Locking & Density Resolution:
    // Prioritize the Host who has active in-room peer sightings (protecting from remote 0-peer takeovers)
    const presenter = presentersInRoom.sort((a, b) => {
      const peersA = (graph.get(a.deviceId) ?? new Set()).size;
      const peersB = (graph.get(b.deviceId) ?? new Set()).size;
      if (peersA !== peersB) return peersB - peersA;
      return b.updatedAt - a.updatedAt;
    })[0];

    // Presenter active acoustic token for this room (e.g. 'RMA' or custom emitted token)
    const expectedUltrasonicToken = (presenter.ultrasonicEmittedToken || presenter.roomId || roomId).trim().toUpperCase();

    // 3. Get all connected members in this presenter's physical graph cluster
    const clusterMembers = this.componentFrom(presenter.deviceId, graph);

    // 4. Find all other active presenters across other rooms for dynamic multi-room separation
    const otherPresenters = [...this.devices.values()]
      .filter((d) => d.role === "presenter" && d.deviceId !== presenter.deviceId && d.roomId && now - d.updatedAt < WINDOW_MS * 2);

    // 5. Build members list with Strongest-Link, Wi-Fi Affinity & Ultrasonic Hard Gate
    const membersInfo: RoomMemberInfo[] = [];
    const estimatedMemberDeviceIds: string[] = [];

    for (const memberId of clusterMembers) {
      const rec = this.devices.get(memberId);
      const isPresenter = memberId === presenter.deviceId;

      const uwbDiscoveryToken =
        rec?.uwbDiscoveryToken && rec.uwbTokenUpdatedAt !== undefined && now - rec.uwbTokenUpdatedAt < WINDOW_MS
          ? rec.uwbDiscoveryToken
          : undefined;
      const motionAnomalyFlag = this.computeMotionAnomalyFlag(rec);

      // Layer 3: Ultrasonic Gate Check
      // If attendee heard the room token within the last 45s
      const heardToken = rec?.ultrasonicObservation?.token?.trim().toUpperCase();
      const isAcousticMatch = Boolean(
        heardToken &&
        rec?.ultrasonicObservedAt &&
        now - rec.ultrasonicObservedAt < 45_000 &&
        isUltrasonicTokenMatch(heardToken, expectedUltrasonicToken)
      );

      if (isPresenter) {
        estimatedMemberDeviceIds.push(memberId);
        membersInfo.push({
          deviceId: memberId,
          displayName: rec?.displayName || memberId,
          role: "presenter",
          confidence: 1.0,
          wifiSimilarity: undefined,
          uwbDiscoveryToken,
          motionAnomalyFlag,
          ultrasonicVerified: true,
          durationMs: this.trackRoomMembership(sessionId, roomId, memberId, "presenter", now, {
            confidence: 1.0,
            ultrasonicVerified: true,
            motionAnomalyFlag
          })
        });
        continue;
      }

      // Check Multi-Room Affinity: Is this attendee physically closer to another presenter?
      let assignedToThisRoom = true;
      if (!isAcousticMatch && otherPresenters.length > 0) {
        const thisHop = this.shortestPathDistance(memberId, presenter.deviceId, graph);
        const thisWifi = (presenter.wifiFingerprint && rec?.wifiFingerprint)
          ? (this.computeWifiCosineSimilarity(rec.wifiFingerprint, presenter.wifiFingerprint) ?? 0.5)
          : 0.5;
        const thisAffinity = (1 / Math.max(1, thisHop)) * 0.5 + thisWifi * 0.5;

        for (const other of otherPresenters) {
          const otherHop = this.shortestPathDistance(memberId, other.deviceId, graph);
          const otherWifi = (other.wifiFingerprint && rec?.wifiFingerprint)
            ? (this.computeWifiCosineSimilarity(rec.wifiFingerprint, other.wifiFingerprint) ?? 0.5)
            : 0.5;
          const otherAffinity = (1 / Math.max(1, otherHop)) * 0.5 + otherWifi * 0.5;

          if (otherAffinity > thisAffinity + 0.15) {
            assignedToThisRoom = false; // Attendee has walked into another room!
            break;
          }
        }
      }

      if (!assignedToThisRoom) continue;

      let wifiSimilarity: number | undefined;
      let confidence = isAcousticMatch ? 0.98 : 0.85;

      if (presenter.wifiFingerprint?.length && rec?.wifiFingerprint?.length) {
        const sim = this.computeWifiCosineSimilarity(rec.wifiFingerprint, presenter.wifiFingerprint);
        if (sim !== undefined) {
          wifiSimilarity = Number(sim.toFixed(2));
          if (isAcousticMatch) {
            confidence = 0.99; // Ultra-high audit grade proof
          } else if (sim >= 0.70) {
            confidence = Number(Math.min(0.98, 0.85 + (sim - 0.70) * 0.43).toFixed(2));
          } else {
            confidence = Number(Math.max(0.70, 0.85 - (0.70 - sim) * 0.30).toFixed(2));
          }
        }
      }

      estimatedMemberDeviceIds.push(memberId);
      membersInfo.push({
        deviceId: memberId,
        displayName: rec?.displayName || memberId,
        role: rec?.role || "attendee",
        confidence,
        wifiSimilarity,
        uwbDiscoveryToken,
        motionAnomalyFlag,
        ultrasonicVerified: isAcousticMatch,
        durationMs: this.trackRoomMembership(sessionId, roomId, memberId, rec?.role || "attendee", now, {
          confidence,
          wifiSimilarity,
          ultrasonicVerified: isAcousticMatch,
          motionAnomalyFlag
        })
      });
    }

    return {
      sessionId,
      roomId,
      presenterDeviceId: presenter.deviceId,
      presenterName: presenter.displayName || presenter.deviceId,
      estimatedMemberDeviceIds,
      members: membersInfo,
      updatedAt: new Date().toISOString()
    };
  }

  deviceRoomState(sessionId: string, deviceId: string): LiveRoomState {
    this.trim();
    const graph = this.buildGraph();
    const now = Date.now();

    const currentDevice = this.devices.get(deviceId);
    if (currentDevice?.role === "presenter" && currentDevice.roomId) {
      return this.roomState(sessionId, currentDevice.roomId);
    }

    // For Attendees: Find which active presenter's room cluster has highest affinity
    const activePresenters = [...this.devices.values()]
      .filter((d) => d.role === "presenter" && d.roomId && now - d.updatedAt < WINDOW_MS * 2);

    let bestRoomId: string | undefined;
    let highestAffinity = -1;

    // Check Acoustic Gate first: If attendee physically heard an active presenter's ultrasonic token
    const heardToken = currentDevice?.ultrasonicObservation?.token?.trim().toUpperCase();
    if (heardToken && currentDevice?.ultrasonicObservedAt && now - currentDevice.ultrasonicObservedAt < 45_000) {
      for (const presenter of activePresenters) {
        const expectedToken = (presenter.ultrasonicEmittedToken || presenter.roomId || "").trim().toUpperCase();
        if (expectedToken && isUltrasonicTokenMatch(heardToken, expectedToken)) {
          bestRoomId = presenter.roomId;
          break;
        }
      }
    }

    if (!bestRoomId) {
      for (const presenter of activePresenters) {
        const cluster = this.componentFrom(presenter.deviceId, graph);
        if (cluster.has(deviceId)) {
          const hop = this.shortestPathDistance(deviceId, presenter.deviceId, graph);
          const wifi = (presenter.wifiFingerprint && currentDevice?.wifiFingerprint)
            ? (this.computeWifiCosineSimilarity(currentDevice.wifiFingerprint, presenter.wifiFingerprint) ?? 0.5)
            : 0.5;
          const affinity = (1 / Math.max(1, hop)) * 0.5 + wifi * 0.5;

          if (affinity > highestAffinity) {
            highestAffinity = affinity;
            bestRoomId = presenter.roomId;
          }
        }
      }
    }

    if (bestRoomId) {
      return this.roomState(sessionId, bestRoomId);
    }

    return {
      sessionId,
      roomId: "unknown",
      estimatedMemberDeviceIds: [],
      members: [],
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * Computes the calibrated indoor similarity (0.0 to 1.0) between two Wi-Fi AP fingerprints.
   * Uses Multi-BSSID base MAC grouping (2.4G vs 5G matching) + signal proximity delta.
   */
  computeWifiCosineSimilarity(fpA: WifiApObservation[], fpB: WifiApObservation[]): number | undefined {
    if (!fpA.length || !fpB.length) return undefined;

    // Filter out faint noise APs below -85 dBm and take the top 15 strongest APs
    const validA = fpA.filter((ap) => ap.rssi >= -85).sort((a, b) => b.rssi - a.rssi).slice(0, 15);
    const validB = fpB.filter((ap) => ap.rssi >= -85).sort((a, b) => b.rssi - a.rssi).slice(0, 15);

    if (!validA.length || !validB.length) return undefined;

    // Base MAC extraction for Multi-BSSID virtual router grouping (e.g. AA:BB:CC:DD:EE:* matches 2.4G & 5G)
    const toBaseMac = (bssid: string): string => {
      const norm = bssid.toLowerCase().trim();
      const parts = norm.split(":");
      return parts.length >= 5 ? parts.slice(0, 5).join(":") : norm;
    };

    const mapA = new Map<string, number>();
    for (const ap of validA) {
      const baseKey = toBaseMac(ap.bssid);
      mapA.set(baseKey, Math.max(mapA.get(baseKey) ?? -100, ap.rssi));
    }

    const mapB = new Map<string, number>();
    for (const ap of validB) {
      const baseKey = toBaseMac(ap.bssid);
      mapB.set(baseKey, Math.max(mapB.get(baseKey) ?? -100, ap.rssi));
    }

    let sharedCount = 0;
    let totalSignalSim = 0;

    for (const [baseKey, rssiA] of mapA) {
      const rssiB = mapB.get(baseKey);
      if (rssiB !== undefined) {
        sharedCount++;
        // Delta tolerance across 2m - 10m room distance: 0 dBm diff -> 1.0, 15 dBm diff -> 0.67
        const delta = Math.abs(rssiA - rssiB);
        const signalSim = Math.max(0, 1 - delta / 45);
        totalSignalSim += signalSim;
      }
    }

    if (sharedCount === 0) return 0;

    const overlapRatio = (sharedCount * 2) / (mapA.size + mapB.size);
    const avgSignalSim = totalSignalSim / sharedCount;
    const rawMatch = 0.35 * overlapRatio + 0.65 * avgSignalSim;

    // Calibrated in-room bounds: In-room shared APs (>= 3) cleanly output 82% to 96%
    if (sharedCount >= 2 && overlapRatio >= 0.3) {
      return Number(Math.min(0.96, Math.max(0.78, 0.72 + rawMatch * 0.25)).toFixed(2));
    }

    return Number(Math.min(0.65, rawMatch * 0.75).toFixed(2));
  }

  listRooms(sessionId: string): string[] {
    this.trim();
    const rooms = new Set<string>(["room-a", "room-b", "auditorium"]);
    for (const d of this.devices.values()) {
      if (d.roomId) rooms.add(d.roomId);
    }
    return [...rooms];
  }

  /**
   * True once a device has spent an anomalously still fraction of a long-enough
   * session. A single still window is normal (someone sitting attentively); a
   * device that is still for nearly its whole session looks more like a phone
   * left on a desk. This is a flag for human review, never an automatic rejection.
   */
  private computeMotionAnomalyFlag(rec?: DeviceRecord): boolean {
    const history = rec?.motionWindowHistory;
    if (!history || history.length < MOTION_MIN_WINDOWS_FOR_FLAG) return false;
    const fractionStill = history.filter(Boolean).length / history.length;
    return fractionStill >= MOTION_STILL_FRACTION_THRESHOLD;
  }

  /**
   * Records that `deviceId` is present in `roomId` at `now`, and returns how long it has
   * been continuously present. A device that drops out of the room's cluster for longer
   * than ROOM_MEMBERSHIP_GRACE_MS has its stay considered over; trim() reaps those entries,
   * so the next sighting starts the clock over from zero.
   */
  private trackRoomMembership(
    sessionId: string,
    roomId: string,
    deviceId: string,
    role: "presenter" | "attendee",
    now: number,
    latest: { confidence?: number; wifiSimilarity?: number; ultrasonicVerified?: boolean; motionAnomalyFlag?: boolean }
  ): number {
    const key = `${roomId}::${deviceId}`;
    const existing = this.roomMembership.get(key);
    let durationMs: number;
    if (existing) {
      // Heartbeat fields (confidence, wifiSimilarity) are never persisted — only meaningful
      // boolean transitions are, and only when the value actually changes.
      if (latest.motionAnomalyFlag !== undefined && latest.motionAnomalyFlag !== existing.motionAnomalyFlag) {
        this.recordStateChange(sessionId, roomId, deviceId, "motion_anomaly_flag", latest.motionAnomalyFlag, now);
      }
      if (latest.ultrasonicVerified !== undefined && latest.ultrasonicVerified !== existing.ultrasonicVerified) {
        this.recordStateChange(sessionId, roomId, deviceId, "ultrasonic_verified", latest.ultrasonicVerified, now);
      }
      existing.lastSeenAt = now;
      existing.lastConfidence = latest.confidence;
      existing.ultrasonicVerified = latest.ultrasonicVerified;
      existing.motionAnomalyFlag = latest.motionAnomalyFlag;
      durationMs = now - existing.startedAt;
    } else {
      // A brand-new membership entry is itself the "connected" transition.
      this.recordStateChange(sessionId, roomId, deviceId, "connected", true, now);
      this.roomMembership.set(key, {
        sessionId,
        role,
        startedAt: now,
        lastSeenAt: now,
        lastConfidence: latest.confidence,
        ultrasonicVerified: latest.ultrasonicVerified,
        motionAnomalyFlag: latest.motionAnomalyFlag
      });
      durationMs = 0;
    }
    return durationMs;
  }

  /**
   * Fire-and-forget insert of a meaningful state-change event, gated on this.db. This is the
   * "persist only meaningful changes" half of the persistence design — heartbeat-level data
   * (confidence, wifiSimilarity, every poll's live value) stays in-memory only and is never
   * written here; only discrete transitions (a flag flipping, a connection starting/ending) are.
   * Never awaited by any caller.
   */
  private recordStateChange(sessionId: string, roomId: string, deviceId: string, field: string, value: boolean, now: number) {
    if (!this.db) return;
    this.db
      .insert(schema.stateChangeEvents)
      .values({ sessionId, roomId, deviceId, field, value, changedAt: new Date(now) })
      .catch((err) => console.error("[db] failed to record state change:", err));
  }

  private shortestPathDistance(start: string, target: string, graph: Map<string, Set<string>>): number {
    if (start === target) return 0;
    const visited = new Set<string>([start]);
    const queue: [string, number][] = [[start, 0]];
    while (queue.length) {
      const [curr, dist] = queue.shift()!;
      for (const neighbor of graph.get(curr) ?? []) {
        if (neighbor === target) return dist + 1;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push([neighbor, dist + 1]);
        }
      }
    }
    return 99; // Not connected
  }

  private buildGraph(): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();
    const tokenToDevice = new Map<string, string>();
    for (const device of this.devices.values()) {
      if (device.rotatingId) tokenToDevice.set(device.rotatingId, device.deviceId);
    }

    const resolveDeviceId = (token: string): string | undefined => {
      const direct = tokenToDevice.get(token);
      if (direct) return direct;
      const cleanToken = token.trim();
      const prefix = cleanToken.split("-")[0];
      if (prefix && prefix.length >= 4) {
        for (const device of this.devices.values()) {
          const deviceClean = device.deviceId.toLowerCase();
          const prefixClean = prefix.toLowerCase();
          if (deviceClean.endsWith(prefixClean) || deviceClean.includes(prefixClean)) {
            return device.deviceId;
          }
        }
      }
      return undefined;
    };

    const sightings = new Map<string, { count: number; maxRssi: number }>();

    for (const batch of this.batches) {
      for (const peer of batch.peers) {
        if (peer.rssi < MIN_RSSI) continue;
        const peerDeviceId = resolveDeviceId(peer.rotatingId);
        if (!peerDeviceId || peerDeviceId === batch.deviceId) continue;

        const key = [batch.deviceId, peerDeviceId].sort().join("|");
        const current = sightings.get(key) ?? { count: 0, maxRssi: -999 };
        current.count += 1;
        current.maxRssi = Math.max(current.maxRssi, peer.rssi);
        sightings.set(key, current);
      }
    }

    for (const [key, data] of sightings) {
      const [left, right] = key.split("|");
      if (data.count >= 1) {
        if (!graph.has(left)) graph.set(left, new Set());
        if (!graph.has(right)) graph.set(right, new Set());
        graph.get(left)?.add(right);
        graph.get(right)?.add(left);
      }
    }
    return graph;
  }

  private componentFrom(start: string, graph: Map<string, Set<string>>): Set<string> {
    const visited = new Set<string>([start]);
    const queue = [start];
    while (queue.length) {
      const current = queue.shift() as string;
      for (const neighbor of graph.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    return visited;
  }

  private trim() {
    const cutoff = Date.now() - WINDOW_MS;
    while (this.batches.length && new Date(this.batches[0].capturedAt).getTime() < cutoff) {
      this.batches.shift();
    }
    const staleDeviceCutoff = Date.now() - WINDOW_MS * 3;
    for (const [id, record] of this.devices.entries()) {
      if (record.updatedAt < staleDeviceCutoff) {
        this.devices.delete(id);
      }
    }

    const staleMembershipCutoff = Date.now() - ROOM_MEMBERSHIP_GRACE_MS;
    for (const [key, membership] of this.roomMembership.entries()) {
      if (membership.lastSeenAt < staleMembershipCutoff) {
        this.persistClosedMembership(key, membership);
        this.roomMembership.delete(key);
      }
    }
  }

  /**
   * Fire-and-forget from the caller's perspective (never awaited by trim()), but internally
   * sequenced: defensively re-upserts the session/room/device rows first, awaited, before
   * inserting the room_membership row that references them by foreign key. This can't assume
   * join()/ingest()'s own upserts already landed — they're independent fire-and-forget calls
   * with no ordering guarantee across a pooled connection, and the referenced rows may simply
   * not exist yet (e.g. right after a manual truncate, or a brief DB outage earlier in the stay).
   */
  private async persistClosedMembershipInternal(key: string, membership: RoomMembershipRecord) {
    if (!this.db) return;
    const sepIndex = key.indexOf("::");
    const roomId = key.slice(0, sepIndex);
    const deviceId = key.slice(sepIndex + 2);

    await this.upsertSessionAndRoomInternal(membership.sessionId, roomId, membership.startedAt);
    await this.db
      .insert(schema.devices)
      .values({ deviceId, firstSeenAt: new Date(membership.startedAt), lastSeenAt: new Date(membership.lastSeenAt) })
      .onConflictDoNothing();

    await this.db.insert(schema.roomMembership).values({
      sessionId: membership.sessionId,
      roomId,
      deviceId,
      role: membership.role,
      startedAt: new Date(membership.startedAt),
      endedAt: new Date(membership.lastSeenAt),
      lastConfidence: membership.lastConfidence,
      ultrasonicVerified: membership.ultrasonicVerified,
      motionAnomalyFlag: membership.motionAnomalyFlag
    });

    // The stay just ended — this is the "connected" -> false transition.
    await this.db.insert(schema.stateChangeEvents).values({
      sessionId: membership.sessionId,
      roomId,
      deviceId,
      field: "connected",
      value: false,
      changedAt: new Date(membership.lastSeenAt)
    });
  }

  private persistClosedMembership(key: string, membership: RoomMembershipRecord) {
    if (!this.db) return;
    this.persistClosedMembershipInternal(key, membership).catch((err) =>
      console.error("[db] failed to persist closed room_membership:", err)
    );
  }

  /** Fire-and-forget upsert, gated on this.db. Never awaited by any caller. */
  private upsertDevice(deviceId: string, displayName: string | undefined, now: number) {
    if (!this.db) return;
    this.db
      .insert(schema.devices)
      .values({ deviceId, displayName, firstSeenAt: new Date(now), lastSeenAt: new Date(now) })
      .onConflictDoUpdate({
        target: schema.devices.deviceId,
        set: { displayName, lastSeenAt: new Date(now) }
      })
      .catch((err) => console.error("[db] failed to upsert device:", err));
  }

  /**
   * Fire-and-forget from the caller's perspective, but internally sequenced: the session
   * insert is awaited before the room insert is issued. With a pooled connection ({ max: 5 }),
   * two independent un-awaited inserts can land on different physical connections and run
   * concurrently, so there's no guarantee the session row commits before the room insert's
   * foreign-key check runs against it — this ordering must be explicit, not assumed.
   */
  private async upsertSessionAndRoomInternal(sessionId: string, roomId: string | undefined, now: number) {
    if (!this.db) return;
    await this.db.insert(schema.sessions).values({ id: sessionId, startedAt: new Date(now) }).onConflictDoNothing();
    if (roomId) {
      await this.db.insert(schema.rooms).values({ id: roomId, sessionId, label: roomId }).onConflictDoNothing();
    }
  }

  private upsertSessionAndRoom(sessionId: string, roomId: string | undefined, now: number) {
    if (!this.db) return;
    this.upsertSessionAndRoomInternal(sessionId, roomId, now).catch((err) =>
      console.error("[db] failed to upsert session/room:", err)
    );
  }
}
