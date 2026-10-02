import type {
  LiveRoomState,
  PresenceBatch,
  RoomMemberInfo,
  WifiApObservation,
} from "@confpresence/shared";
import type { Db } from "./db/index.js";
import {
  type ActiveRoomRecord,
  type DeviceRecord,
  type RecentlyLeftRecord,
  type RoomMembershipRecord,
  MIN_RSSI,
  MOTION_SLIDING_WINDOW_SIZE,
  MOTION_STILL_VARIANCE_THRESHOLD,
  ROOM_AUTO_EXPIRY_MS,
  ROOM_ENDED_NOTICE_TTL_MS,
  ROOM_MEMBERSHIP_GRACE_MS,
  TICK_INTERVAL_MS,
  WINDOW_MS,
} from "./engine/types.js";
import { isUltrasonicTokenMatch } from "./engine/ultrasonic.js";
import { computeWifiCosineSimilarity } from "./engine/wifi.js";
import { computeMotionAnomalyFlag } from "./engine/motion.js";
import { buildBleGraph, computeHopDistances } from "./engine/graph.js";
import { EnginePersistenceManager } from "./engine/persistence.js";

// Re-export public utilities
export { isUltrasonicTokenMatch };
export * from "./engine/types.js";

export class PocInferenceEngine {
  private readonly devices = new Map<string, DeviceRecord>();
  /**
   * Recent sensor batches, grouped by the device that sent them (each sub-array stays in arrival
   * order). Grouped rather than one flat list so a device leaving can drop its own entries in
   * O(1) — deleting one Map key — instead of scanning every batch in the system to find the few
   * that belong to it, which is what made many devices leaving at once expensive.
   */
  private readonly batchesByDevice = new Map<string, PresenceBatch[]>();
  /** First-seen/last-seen timestamps per room membership, keyed by `${occurrenceRoomId}::${deviceId}`. */
  private readonly roomMembership = new Map<string, RoomMembershipRecord>();
  /** Which occurrence a (session label, room name) pair currently resolves to. */
  private readonly activeRoomsByKey = new Map<string, ActiveRoomRecord>();
  /**
   * Devices whose room was ended out from under them (presenter left, or admin ended the
   * session), keyed by device ID. Clients see this on their next live poll and switch sharing
   * off. Cleared when the device joins again or leaves; entries otherwise expire after
   * ROOM_ENDED_NOTICE_TTL_MS so a device that never polls again can't leak one forever.
   */
  private readonly roomEndedNotices = new Map<string, { roomCode: string; endedAt: number }>();
  /**
   * Attendees who left each still-active room occurrence mid-session, keyed by occurrence ID
   * then device ID, so the live view can show a "Left" tab alongside who's in the room right
   * now. Populated wherever a membership closes other than the whole room ending (see
   * closeMembershipAsLeft), and dropped entirely once the room occurrence itself ends.
   */
  private readonly recentlyLeftByRoom = new Map<string, Map<string, RecentlyLeftRecord>>();
  /** Persistence manager for Postgres storage & state event logging. */
  private readonly persistence: EnginePersistenceManager;
  /** BLE proximity graph as of the last tick. Request handlers read this rather than rebuild it. */
  private currentGraph: Map<string, Set<string>> = new Map();
  /** Every active room's computed live state as of the last tick, keyed like activeRoomsByKey. */
  private readonly roomSnapshots = new Map<string, LiveRoomState>();
  /**
   * Which active room (keyed like activeRoomsByKey) each non-presenter device was resolved into
   * as of the last tick, via the same acoustic-gate-then-affinity matching deviceRoomState used to
   * run per request. A device with no current match has no entry.
   */
  private readonly deviceRoomIndex = new Map<string, string>();
  /**
   * One BFS per active presenter per tick (deviceId -> hop distance for every device reachable
   * from it), computed once and read by every room's affinity check and resolveDeviceRooms. The
   * per-member-per-presenter version of this (a fresh BFS for every member against every
   * presenter) was the actual dominant cost once the graph rebuild itself stopped running per
   * request — thousands of full-graph traversals per tick at real room sizes, down to one per
   * presenter.
   */
  private presenterHopMaps = new Map<string, Map<string, number>>();

  constructor(options?: { db?: Db }) {
    this.persistence = new EnginePersistenceManager(options?.db);
    setInterval(() => this.tick(), TICK_INTERVAL_MS).unref();
  }

  /**
   * Rebuilds the BLE graph once and recomputes every active room's live state from it, instead of
   * each poll doing its own full rebuild — the thing that made request cost scale with total
   * device count rather than staying flat. Normally driven by the interval above; exposed so a
   * one-shot script (or a future force-refresh) can call it directly without waiting on the timer.
   */
  tick() {
    const t0 = performance.now();
    this.trim();
    const now = Date.now();
    this.currentGraph = buildBleGraph(this.devices, this.batchesByDevice, MIN_RSSI);
    const tGraph = performance.now();

    const activePresenters = [...this.devices.values()].filter(
      (d) => d.role === "presenter" && d.roomId && d.sessionLabel && now - d.updatedAt < WINDOW_MS * 2
    );
    this.presenterHopMaps = new Map();
    for (const presenter of activePresenters) {
      this.presenterHopMaps.set(presenter.deviceId, computeHopDistances(presenter.deviceId, this.currentGraph));
    }
    const tHops = performance.now();

    const liveKeys = new Set<string>();
    for (const [key, room] of this.activeRoomsByKey.entries()) {
      if (now - room.lastActivityAt >= ROOM_AUTO_EXPIRY_MS) continue;
      liveKeys.add(key);
      this.roomSnapshots.set(key, this.computeRoomState(room, now, this.currentGraph));
    }
    const tRooms = performance.now();
    // Drop snapshots for rooms that expired or ended since the last tick, so a stale one can't
    // linger and be served by roomState()'s cache lookup.
    for (const key of this.roomSnapshots.keys()) {
      if (!liveKeys.has(key)) this.roomSnapshots.delete(key);
    }

    this.resolveDeviceRooms(now, activePresenters);
    const tDone = performance.now();
    // A warning, not routine telemetry: at TICK_INTERVAL_MS = 2s, a tick taking even half that is
    // worth knowing about well before it reaches the point of actually falling behind.
    if (tDone - t0 > TICK_INTERVAL_MS / 2) {
      console.warn(`[tick] slow: total ${(tDone - t0).toFixed(1)}ms (graph ${(tGraph - t0).toFixed(1)}ms, hops ${(tHops - tGraph).toFixed(1)}ms, rooms ${(tRooms - tHops).toFixed(1)}ms, deviceRooms ${(tDone - tRooms).toFixed(1)}ms)`);
    }
  }

  /**
   * For every non-presenter device, works out which active room's physical cluster it's actually
   * in — the acoustic-gate-then-affinity matching deviceRoomState used to run fresh on every poll,
   * now done once per tick for every device instead. Reads presenterHopMaps (built just before
   * this is called) rather than running its own BFS per presenter per device.
   */
  private resolveDeviceRooms(now: number, activePresenters: DeviceRecord[]) {
    this.deviceRoomIndex.clear();
    for (const [deviceId, device] of this.devices) {
      if (device.role === "presenter") continue;

      let bestMatchKey: string | undefined;

      // Check Acoustic Gate first
      const heardToken = device.ultrasonicObservation?.token?.trim().toUpperCase();
      if (heardToken && device.ultrasonicObservedAt && now - device.ultrasonicObservedAt < 45_000) {
        for (const presenter of activePresenters) {
          const expectedToken = (presenter.ultrasonicEmittedToken || presenter.roomId || "").trim().toUpperCase();
          if (expectedToken && isUltrasonicTokenMatch(heardToken, expectedToken)) {
            bestMatchKey = PocInferenceEngine.roomKey(presenter.sessionLabel!, presenter.roomId!);
            break;
          }
        }
      }

      if (!bestMatchKey) {
        let highestAffinity = -1;
        for (const presenter of activePresenters) {
          const hop = this.presenterHopMaps.get(presenter.deviceId)?.get(deviceId);
          if (hop === undefined) continue;
          const wifi =
            presenter.wifiFingerprint && device.wifiFingerprint
              ? computeWifiCosineSimilarity(device.wifiFingerprint, presenter.wifiFingerprint) ?? 0.5
              : 0.5;
          const affinity = (1 / Math.max(1, hop)) * 0.5 + wifi * 0.5;
          if (affinity > highestAffinity) {
            highestAffinity = affinity;
            bestMatchKey = PocInferenceEngine.roomKey(presenter.sessionLabel!, presenter.roomId!);
          }
        }
      }

      if (bestMatchKey) this.deviceRoomIndex.set(deviceId, bestMatchKey);
    }
  }

  private static roomKey(sessionLabel: string, roomCode: string): string {
    return `${sessionLabel}::${roomCode}`;
  }

  /**
   * Resolves a human-typed room name (within a session label) to the real, unique ID of its
   * currently active occurrence, minting and persisting a new one if there is none (never used,
   * ended, or quiet for longer than ROOM_AUTO_EXPIRY_MS). Only participating devices call this
   * (presenter join/ingest, and membership tracking) — read-only views never create rooms.
   */
  private resolveRoom(sessionLabel: string, roomCode: string, now: number = Date.now(), presenterUserId?: string): string {
    const key = PocInferenceEngine.roomKey(sessionLabel, roomCode);
    const existing = this.activeRoomsByKey.get(key);
    if (existing && now - existing.lastActivityAt < ROOM_AUTO_EXPIRY_MS) {
      existing.lastActivityAt = now;
      // Keep ownership pointed at whoever is currently hosting, so a takeover transfers it and a
      // signed-out/anonymous report doesn't wipe a known owner.
      if (presenterUserId) existing.ownerUserId = presenterUserId;
      return existing.roomId;
    }

    const safeCode = roomCode.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "room";
    const roomId = `${safeCode}__${now.toString(36)}`;
    this.activeRoomsByKey.set(key, {
      roomId,
      code: roomCode,
      sessionLabel,
      startedAt: now,
      lastActivityAt: now,
      ownerUserId: presenterUserId,
    });

    if (this.persistence.hasDb) {
      const write = this.persistence
        .upsertRoom(roomId, roomCode, sessionLabel, now)
        .catch((err) => console.error("[db] failed to create room row:", err))
        .finally(() => this.persistence.pendingRoomCreation.delete(roomId));
      this.persistence.pendingRoomCreation.set(roomId, write);
    }
    return roomId;
  }

  /** The active occurrence for this room, or undefined. Never creates one, and never bumps activity. */
  private activeRoomId(sessionLabel: string, roomCode: string, now: number = Date.now()): string | undefined {
    const existing = this.activeRoomsByKey.get(PocInferenceEngine.roomKey(sessionLabel, roomCode));
    return existing && now - existing.lastActivityAt < ROOM_AUTO_EXPIRY_MS ? existing.roomId : undefined;
  }

  /**
   * Closes every currently active room under a session label, so the next use of any of those
   * room names starts a fresh occurrence. Returns false if the label had no active rooms.
   */
  endSession(sessionLabel: string): boolean {
    let ended = false;
    for (const [key, room] of [...this.activeRoomsByKey.entries()]) {
      if (room.sessionLabel !== sessionLabel) continue;
      this.endRoomOccurrence(key, room);
      ended = true;
    }
    return ended;
  }

  /** Closes one specific active room occurrence. Returns false if it wasn't active. */
  endRoom(sessionLabel: string, roomCode: string): boolean {
    const key = PocInferenceEngine.roomKey(sessionLabel, roomCode);
    const room = this.activeRoomsByKey.get(key);
    if (!room) return false;
    this.endRoomOccurrence(key, room);
    return true;
  }

  /**
   * Self-service room-end for the presenter rejoin flow: only succeeds if userId actually owns
   * this room, so one signed-in user can never end a room that belongs to someone else just by
   * guessing its sessionLabel/roomCode.
   */
  endRoomIfOwner(sessionLabel: string, roomCode: string, userId: string): boolean {
    const key = PocInferenceEngine.roomKey(sessionLabel, roomCode);
    const room = this.activeRoomsByKey.get(key);
    if (!room) return false;
    const owns =
      room.ownerUserId === userId ||
      (!room.ownerUserId &&
        [...this.devices.values()].some(
          (d) => d.role === "presenter" && d.roomId === roomCode && d.sessionLabel === sessionLabel && d.userId === userId
        ));
    if (!owns) return false;
    this.endRoomOccurrence(key, room);
    return true;
  }

  /**
   * Ends one active room occurrence: flushes all its open stays right away (otherwise devices
   * still sending batches would carry their open stays into the next occurrence) and stamps
   * rooms.ended_at.
   */
  private endRoomOccurrence(key: string, room: ActiveRoomRecord) {
    this.activeRoomsByKey.delete(key);
    // Drop the cached snapshot immediately rather than waiting for the next tick to notice this
    // key is gone — the roomEndedNotice flag below already tells clients to stop regardless, but
    // there's no reason to keep serving a stale "who's in the room" body in the meantime.
    this.roomSnapshots.delete(key);
    // The room itself is ending, not just this one attendee — there's no more "still active
    // room" for a Left tab to describe, and the final attendance record is about to be written
    // to Postgres anyway, so this in-memory copy no longer serves anything.
    this.recentlyLeftByRoom.delete(room.roomId);
    const now = Date.now();
    const prefix = `${room.roomId}::`;
    for (const [membershipKey, membership] of this.roomMembership.entries()) {
      if (membershipKey.startsWith(prefix)) {
        const deviceId = membershipKey.slice(prefix.length);
        const current = this.devices.get(deviceId);
        const movedToDifferentRoom =
          current?.role === "presenter" &&
          (current.roomId !== room.code || current.sessionLabel !== room.sessionLabel);
        if (!movedToDifferentRoom) {
          this.roomEndedNotices.set(deviceId, { roomCode: room.code, endedAt: now });
        }
        membership.lastSeenAt = now;
        this.persistence.persistClosedMembership(membershipKey, membership);
        this.roomMembership.delete(membershipKey);
      }
    }
    for (const [deviceId, d] of [...this.devices.entries()]) {
      if (d.roomId === room.code && d.sessionLabel === room.sessionLabel) {
        this.roomEndedNotices.set(deviceId, { roomCode: room.code, endedAt: now });
        if (d.role === "presenter") this.devices.delete(deviceId);
      }
    }
    this.persistence.endRoom(room.roomId, now).catch((err) => console.error("[db] failed to mark room ended:", err));
  }

  /**
   * If another presenter already holds this room under this session label and is still live, returns its name.
   */
  presenterConflict(sessionLabel: string, roomCode: string, deviceId: string, userId?: string): { presenterName: string } | undefined {
    const now = Date.now();
    for (const d of this.devices.values()) {
      if (
        d.role === "presenter" &&
        d.deviceId !== deviceId &&
        !(userId && d.userId === userId) &&
        d.roomId === roomCode &&
        d.sessionLabel === sessionLabel &&
        now - d.updatedAt < WINDOW_MS * 2
      ) {
        return { presenterName: d.displayName || d.deviceId };
      }
    }
    return undefined;
  }

  /** True (with the room's name) if this device's room was ended and it hasn't rejoined since. */
  roomEndedNotice(deviceId: string): { roomCode: string } | undefined {
    const notice = this.roomEndedNotices.get(deviceId);
    if (!notice) return undefined;
    if (Date.now() - notice.endedAt > ROOM_ENDED_NOTICE_TTL_MS) {
      this.roomEndedNotices.delete(deviceId);
      return undefined;
    }
    return { roomCode: notice.roomCode };
  }

  join(
    deviceId: string,
    role: "presenter" | "attendee",
    roomId?: string,
    displayName?: string,
    sessionLabel?: string,
    userId?: string,
    email?: string
  ) {
    const current = this.devices.get(deviceId);
    const now = Date.now();
    this.roomEndedNotices.delete(deviceId);
    this.devices.set(deviceId, {
      deviceId,
      displayName: displayName || current?.displayName || undefined,
      role,
      roomId,
      userId: userId ?? current?.userId,
      email: email ?? current?.email,
      sessionLabel: sessionLabel ?? current?.sessionLabel,
      wifiFingerprint: current?.wifiFingerprint,
      uwbDiscoveryToken: current?.uwbDiscoveryToken,
      uwbTokenUpdatedAt: current?.uwbTokenUpdatedAt,
      wifiHistory: current?.wifiHistory ?? new Map(),
      motionWindowHistory: current?.motionWindowHistory,
      ultrasonicObservation: current?.ultrasonicObservation,
      ultrasonicObservedAt: current?.ultrasonicObservedAt,
      ultrasonicEmittedToken: current?.ultrasonicEmittedToken,
      updatedAt: now,
    });
    this.persistence.upsertDevice(deviceId, displayName || current?.displayName, now);
    if (role === "presenter" && roomId && sessionLabel) {
      if (userId) {
        for (const [id, d] of this.devices) {
          if (id !== deviceId && d.userId === userId && d.role === "presenter" && d.roomId === roomId && d.sessionLabel === sessionLabel) {
            this.devices.delete(id);
          }
        }
      }
      this.resolveRoom(sessionLabel, roomId, now, userId);
    }
  }

  leave(deviceId: string) {
    const device = this.devices.get(deviceId);
    if (device?.role === "presenter" && device.roomId && device.sessionLabel) {
      const key = PocInferenceEngine.roomKey(device.sessionLabel, device.roomId);
      const room = this.activeRoomsByKey.get(key);
      if (room) this.endRoomOccurrence(key, room);
    } else if (device?.role === "attendee" && device.roomId && device.sessionLabel) {
      // An explicit leave means the person told us they're gone — close their stay right now
      // rather than leaving it open for the same 45s grace that exists to cover a silent
      // disconnect, where nobody's actually said anything yet.
      const occurrenceId = this.activeRoomId(device.sessionLabel, device.roomId);
      if (occurrenceId) {
        const membershipKey = `${occurrenceId}::${deviceId}`;
        const membership = this.roomMembership.get(membershipKey);
        if (membership) this.closeMembershipAsLeft(membershipKey, membership, Date.now());
      }
    }
    this.devices.delete(deviceId);
    this.roomEndedNotices.delete(deviceId);
    this.batchesByDevice.delete(deviceId);
  }

  setUwbToken(deviceId: string, discoveryTokenBase64: string) {
    const current = this.devices.get(deviceId);
    this.devices.set(deviceId, {
      deviceId,
      displayName: current?.displayName,
      role: current?.role ?? "attendee",
      roomId: current?.roomId,
      userId: current?.userId,
      sessionLabel: current?.sessionLabel,
      rotatingId: current?.rotatingId,
      wifiFingerprint: current?.wifiFingerprint,
      uwbDiscoveryToken: discoveryTokenBase64,
      uwbTokenUpdatedAt: Date.now(),
      wifiHistory: current?.wifiHistory ?? new Map(),
      motionWindowHistory: current?.motionWindowHistory,
      ultrasonicObservation: current?.ultrasonicObservation,
      ultrasonicObservedAt: current?.ultrasonicObservedAt,
      ultrasonicEmittedToken: current?.ultrasonicEmittedToken,
      updatedAt: Date.now(),
    });
  }

  /** Returns false (and stores nothing) if this device's room was ended and it hasn't rejoined. */
  ingest(batch: PresenceBatch, userId?: string, email?: string): boolean {
    if (this.roomEndedNotice(batch.deviceId)) return false;
    const current = this.devices.get(batch.deviceId);
    const wifiHistory = current?.wifiHistory ?? new Map<string, { ap: WifiApObservation; lastSeen: number }>();
    const now = Date.now();

    // Track motion window history
    let motionWindowHistory = current?.motionWindowHistory ?? [];
    if (batch.motionVariance !== undefined) {
      motionWindowHistory = [...motionWindowHistory, batch.motionVariance < MOTION_STILL_VARIANCE_THRESHOLD];
      if (motionWindowHistory.length > MOTION_SLIDING_WINDOW_SIZE) {
        motionWindowHistory = motionWindowHistory.slice(-MOTION_SLIDING_WINDOW_SIZE);
      }
    }

    // 1. Ingest fresh Wi-Fi APs
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
    const consolidatedWifi: WifiApObservation[] = [...wifiHistory.values()].map((e) => e.ap);

    // 4. Ingest Ultrasonic observations
    const ultrasonicObservation = batch.ultrasonicObservation || current?.ultrasonicObservation;
    const ultrasonicObservedAt = batch.ultrasonicObservation ? now : current?.ultrasonicObservedAt;
    const ultrasonicEmittedToken = batch.ultrasonicEmittedToken || current?.ultrasonicEmittedToken;

    this.devices.set(batch.deviceId, {
      deviceId: batch.deviceId,
      displayName: batch.displayName || current?.displayName,
      role: batch.role,
      roomId: batch.roomId ?? current?.roomId,
      userId: userId ?? current?.userId,
      email: email ?? current?.email,
      sessionLabel: batch.sessionId,
      rotatingId: batch.rotatingId,
      wifiFingerprint: consolidatedWifi.length > 0 ? consolidatedWifi : current?.wifiFingerprint,
      uwbDiscoveryToken: current?.uwbDiscoveryToken,
      uwbTokenUpdatedAt: current?.uwbTokenUpdatedAt,
      wifiHistory,
      motionWindowHistory,
      ultrasonicObservation,
      ultrasonicObservedAt,
      ultrasonicEmittedToken,
      updatedAt: now,
    });
    this.persistence.upsertDevice(batch.deviceId, batch.displayName || current?.displayName, now);
    const ingestRoomCode = batch.roomId ?? current?.roomId;
    if (batch.role === "presenter" && ingestRoomCode) {
      this.resolveRoom(batch.sessionId, ingestRoomCode, now, userId ?? current?.userId);
    }
    let deviceBatches = this.batchesByDevice.get(batch.deviceId);
    if (!deviceBatches) {
      deviceBatches = [];
      this.batchesByDevice.set(batch.deviceId, deviceBatches);
    }
    deviceBatches.push(batch);
    return true;
  }

  /**
   * O(1) read of the last tick's computed state for this room — no graph work here. Falls back to
   * an empty "nobody here" shape when there's no active occurrence or the first tick hasn't run
   * yet, same shape callers always got from a brand-new room.
   */
  roomState(sessionLabel: string, roomId: string): LiveRoomState {
    return (
      this.roomSnapshots.get(PocInferenceEngine.roomKey(sessionLabel, roomId)) ?? {
        sessionId: sessionLabel,
        roomId,
        estimatedMemberDeviceIds: [],
        members: [],
        leftMembers: [],
        updatedAt: new Date().toISOString(),
      }
    );
  }

  /**
   * The actual per-room computation, run once per tick for every active room rather than once per
   * poll. Moving trackRoomMembership() in here (instead of inside the old per-request roomState)
   * is what fixes a GET mutating attendance, and the tick visiting every active room regardless of
   * who's polling is what fixes an unpolled room recording no time at all.
   */
  private computeRoomState(room: ActiveRoomRecord, now: number, graph: Map<string, Set<string>>): LiveRoomState {
    const sessionLabel = room.sessionLabel;
    const roomId = room.code;
    const occurrenceId = room.roomId;

    // 1. Find all active presenters in this specific room
    const presentersInRoom = [...this.devices.values()].filter(
      (d) => d.role === "presenter" && d.roomId === roomId && d.sessionLabel === sessionLabel && now - d.updatedAt < WINDOW_MS * 2
    );

    if (!presentersInRoom.length) {
      return {
        sessionId: sessionLabel,
        roomId,
        estimatedMemberDeviceIds: [],
        members: [],
        leftMembers: this.buildLeftMembers(occurrenceId),
        updatedAt: new Date().toISOString(),
      };
    }

    // 2. Host Sticky Locking & Density Resolution
    const presenter = presentersInRoom.sort((a, b) => {
      const peersA = (graph.get(a.deviceId) ?? new Set()).size;
      const peersB = (graph.get(b.deviceId) ?? new Set()).size;
      if (peersA !== peersB) return peersB - peersA;
      return b.updatedAt - a.updatedAt;
    })[0];

    const expectedUltrasonicToken = (presenter.ultrasonicEmittedToken || presenter.roomId || roomId).trim().toUpperCase();

    // 3. Get all connected members in this presenter's physical graph cluster — the keys of its
    // hop-distance map (computed once per presenter in tick(), not per room) double as this.
    const presenterHops = this.presenterHopMaps.get(presenter.deviceId);
    const clusterMembers = new Set(presenterHops?.keys() ?? []);

    // 4. Find all other active presenters across other rooms
    const otherPresenters = [...this.devices.values()].filter(
      (d) => d.role === "presenter" && d.deviceId !== presenter.deviceId && d.roomId && now - d.updatedAt < WINDOW_MS * 2
    );

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
      const motionAnomalyFlag = computeMotionAnomalyFlag(rec);

      // Layer 3: Ultrasonic Gate Check
      const heardToken = rec?.ultrasonicObservation?.token?.trim().toUpperCase();
      const isAcousticMatch = Boolean(
        heardToken &&
        rec?.ultrasonicObservedAt &&
        now - rec.ultrasonicObservedAt < 45_000 &&
        isUltrasonicTokenMatch(heardToken, expectedUltrasonicToken)
      );

      if (isPresenter) {
        estimatedMemberDeviceIds.push(memberId);
        const membership = this.trackRoomMembership(occurrenceId, roomId, sessionLabel, memberId, "presenter", now, {
          confidence: 1.0,
          ultrasonicVerified: true,
          motionAnomalyFlag,
        });
        membersInfo.push({
          deviceId: memberId,
          displayName: rec?.displayName || memberId,
          email: rec?.email,
          role: "presenter",
          confidence: 1.0,
          wifiSimilarity: undefined,
          uwbDiscoveryToken,
          motionAnomalyFlag,
          ultrasonicVerified: true,
          durationMs: membership.durationMs,
          startedAt: membership.startedAt,
        });
        continue;
      }

      if (rec?.role === "presenter") {
        continue;
      }

      if (rec?.roomId !== roomId || rec?.sessionLabel !== sessionLabel) {
        continue;
      }

      // Check Multi-Room Affinity. Hop distances are read from presenterHopMaps (one BFS per
      // presenter, computed once in tick()) rather than a fresh BFS per member here — this loop
      // runs per member per room, so the per-request version of this was the actual dominant cost
      // once the graph itself stopped being rebuilt per request.
      let assignedToThisRoom = true;
      if (!isAcousticMatch && otherPresenters.length > 0) {
        const thisHop = presenterHops?.get(memberId) ?? 99;
        const thisWifi =
          presenter.wifiFingerprint && rec?.wifiFingerprint
            ? computeWifiCosineSimilarity(rec.wifiFingerprint, presenter.wifiFingerprint) ?? 0.5
            : 0.5;
        const thisAffinity = (1 / Math.max(1, thisHop)) * 0.5 + thisWifi * 0.5;

        for (const other of otherPresenters) {
          const otherHop = this.presenterHopMaps.get(other.deviceId)?.get(memberId) ?? 99;
          const otherWifi =
            other.wifiFingerprint && rec?.wifiFingerprint
              ? computeWifiCosineSimilarity(rec.wifiFingerprint, other.wifiFingerprint) ?? 0.5
              : 0.5;
          const otherAffinity = (1 / Math.max(1, otherHop)) * 0.5 + otherWifi * 0.5;

          if (otherAffinity > thisAffinity + 0.15) {
            assignedToThisRoom = false;
            break;
          }
        }
      }

      if (!assignedToThisRoom) continue;

      let wifiSimilarity: number | undefined;
      let confidence = isAcousticMatch ? 0.98 : 0.85;

      if (presenter.wifiFingerprint?.length && rec?.wifiFingerprint?.length) {
        const sim = computeWifiCosineSimilarity(rec.wifiFingerprint, presenter.wifiFingerprint);
        if (sim !== undefined) {
          wifiSimilarity = Number(sim.toFixed(2));
          if (isAcousticMatch) {
            confidence = 0.99;
          } else if (sim >= 0.7) {
            confidence = Number(Math.min(0.98, 0.85 + (sim - 0.7) * 0.43).toFixed(2));
          } else {
            confidence = Number(Math.max(0.7, 0.85 - (0.7 - sim) * 0.3).toFixed(2));
          }
        }
      }

      estimatedMemberDeviceIds.push(memberId);
      const membership = this.trackRoomMembership(occurrenceId, roomId, sessionLabel, memberId, rec?.role || "attendee", now, {
        confidence,
        wifiSimilarity,
        ultrasonicVerified: isAcousticMatch,
        motionAnomalyFlag,
      });
      membersInfo.push({
        deviceId: memberId,
        displayName: rec?.displayName || memberId,
        email: rec?.email,
        role: rec?.role || "attendee",
        confidence,
        wifiSimilarity,
        uwbDiscoveryToken,
        motionAnomalyFlag,
        ultrasonicVerified: isAcousticMatch,
        durationMs: membership.durationMs,
        startedAt: membership.startedAt,
      });
    }


    return {
      sessionId: sessionLabel,
      roomId,
      presenterDeviceId: presenter.deviceId,
      presenterName: presenter.displayName || presenter.deviceId,
      estimatedMemberDeviceIds,
      members: membersInfo,
      leftMembers: this.buildLeftMembers(occurrenceId),
      updatedAt: new Date().toISOString(),
    };
  }

  myActiveRooms(userId: string): LiveRoomState[] {
    const now = Date.now();
    const results: LiveRoomState[] = [];
    for (const room of this.activeRoomsByKey.values()) {
      if (now - room.lastActivityAt >= ROOM_AUTO_EXPIRY_MS) continue;

      const ownsRoom =
        room.ownerUserId === userId ||
        (!room.ownerUserId &&
          [...this.devices.values()].some(
            (d) =>
              d.role === "presenter" &&
              d.roomId === room.code &&
              d.sessionLabel === room.sessionLabel &&
              d.userId === userId
          ));

      if (ownsRoom) results.push(this.roomState(room.sessionLabel, room.code));
    }
    return results;
  }

  /**
   * O(1) read of the last tick's resolved room for this device — no graph work here. An
   * attendee's own device doesn't self-report which room it's physically in, so "which room is
   * this" used to be resolved fresh on every poll (resolveDeviceRooms, above, now does it once
   * per tick for every device instead).
   */
  deviceRoomState(sessionLabel: string, deviceId: string): LiveRoomState {
    const currentDevice = this.devices.get(deviceId);
    if (currentDevice?.role === "presenter" && currentDevice.roomId) {
      return this.roomState(sessionLabel, currentDevice.roomId);
    }

    const key = this.deviceRoomIndex.get(deviceId);
    const snapshot = key ? this.roomSnapshots.get(key) : undefined;
    if (snapshot) return snapshot;

    return {
      sessionId: sessionLabel,
      roomId: "unknown",
      estimatedMemberDeviceIds: [],
      members: [],
      updatedAt: new Date().toISOString(),
    };
  }

  computeWifiCosineSimilarity(fpA: WifiApObservation[], fpB: WifiApObservation[]): number | undefined {
    return computeWifiCosineSimilarity(fpA, fpB);
  }

  listActiveRooms(): { sessionLabel: string; roomCode: string }[] {
    const now = Date.now();
    return [...this.activeRoomsByKey.values()]
      .filter((room) => now - room.lastActivityAt < ROOM_AUTO_EXPIRY_MS)
      .map((room) => ({ sessionLabel: room.sessionLabel, roomCode: room.code }));
  }

  listActiveSessionLabels(): string[] {
    return [...new Set(this.listActiveRooms().map((r) => r.sessionLabel))];
  }

  listRooms(sessionLabel: string): string[] {
    const rooms = new Set<string>(["room-a", "room-b", "auditorium"]);
    for (const d of this.devices.values()) {
      if (d.roomId && d.sessionLabel === sessionLabel) rooms.add(d.roomId);
    }
    return [...rooms];
  }

  /**
   * Closes an open membership the same way trim()'s passive staleness sweep always has
   * (persist, then delete), and additionally records it in recentlyLeftByRoom when it's an
   * attendee leaving a room that is still going — the two callers this serves are an explicit
   * leave() and that same staleness sweep, neither of which is the whole room ending (that path,
   * endRoomOccurrence, closes every stay at once and clears recentlyLeftByRoom instead, since
   * there's no more "still active room" for a Left tab to describe).
   */
  private closeMembershipAsLeft(key: string, membership: RoomMembershipRecord, now: number) {
    this.persistence.persistClosedMembership(key, membership);
    this.roomMembership.delete(key);
    if (membership.role !== "attendee") return;
    const deviceId = key.slice(membership.roomId.length + 2);
    const device = this.devices.get(deviceId);
    let left = this.recentlyLeftByRoom.get(membership.roomId);
    if (!left) {
      left = new Map();
      this.recentlyLeftByRoom.set(membership.roomId, left);
    }
    left.set(deviceId, {
      deviceId,
      displayName: device?.displayName,
      email: device?.email,
      startedAt: membership.startedAt,
      leftAt: now,
      lastConfidence: membership.lastConfidence,
      motionAnomalyFlag: membership.motionAnomalyFlag,
      ultrasonicVerified: membership.ultrasonicVerified,
    });
  }

  /** The live view's "Left" tab for one room occurrence, most recently left first. */
  private buildLeftMembers(occurrenceId: string | undefined): RoomMemberInfo[] {
    if (!occurrenceId) return [];
    const left = this.recentlyLeftByRoom.get(occurrenceId);
    if (!left || left.size === 0) return [];
    return [...left.values()]
      .sort((a, b) => b.leftAt - a.leftAt)
      .map((r) => ({
        deviceId: r.deviceId,
        displayName: r.displayName || r.deviceId,
        email: r.email,
        role: "attendee",
        confidence: r.lastConfidence,
        motionAnomalyFlag: r.motionAnomalyFlag,
        ultrasonicVerified: r.ultrasonicVerified,
        durationMs: r.leftAt - r.startedAt,
        startedAt: new Date(r.startedAt).toISOString(),
        endedAt: new Date(r.leftAt).toISOString(),
      }));
  }

  /**
   * Called only from computeRoomState, once per tick per clustered member — the caller already
   * knows the occurrence is active (it's iterating activeRoomsByKey directly), so this no longer
   * needs to re-resolve it itself the way the old per-request call site did.
   */
  private trackRoomMembership(
    roomId: string,
    roomCode: string,
    sessionLabel: string,
    deviceId: string,
    role: "presenter" | "attendee",
    now: number,
    latest: { confidence?: number; wifiSimilarity?: number; ultrasonicVerified?: boolean; motionAnomalyFlag?: boolean }
  ): { durationMs: number; startedAt: string } {
    const key = `${roomId}::${deviceId}`;
    const existing = this.roomMembership.get(key);
    let durationMs: number;
    let startedAtMs: number;

    if (existing) {
      if (latest.motionAnomalyFlag !== undefined && latest.motionAnomalyFlag !== existing.motionAnomalyFlag) {
        this.persistence.recordStateChange(roomId, deviceId, "motion_anomaly_flag", latest.motionAnomalyFlag, now);
      }
      if (latest.ultrasonicVerified !== undefined && latest.ultrasonicVerified !== existing.ultrasonicVerified) {
        this.persistence.recordStateChange(roomId, deviceId, "ultrasonic_verified", latest.ultrasonicVerified, now);
      }
      existing.lastSeenAt = now;
      existing.lastConfidence = latest.confidence;
      if (latest.confidence !== undefined) {
        existing.confidenceSum += latest.confidence;
        existing.confidenceCount += 1;
      }
      existing.ultrasonicVerified = latest.ultrasonicVerified;
      existing.motionAnomalyFlag = latest.motionAnomalyFlag;
      durationMs = now - existing.startedAt;
      startedAtMs = existing.startedAt;
    } else {
      // If this device was sitting in the Left tab for this room, it just came back — a rejoin
      // is a brand-new membership either way, so there's nothing to merge, only this to clear.
      this.recentlyLeftByRoom.get(roomId)?.delete(deviceId);
      this.persistence.recordStateChange(roomId, deviceId, "connected", true, now);
      if (latest.motionAnomalyFlag !== undefined) {
        this.persistence.recordStateChange(roomId, deviceId, "motion_anomaly_flag", latest.motionAnomalyFlag, now);
      }
      if (role !== "presenter" && latest.ultrasonicVerified !== undefined) {
        this.persistence.recordStateChange(roomId, deviceId, "ultrasonic_verified", latest.ultrasonicVerified, now);
      }
      this.roomMembership.set(key, {
        roomId,
        roomCode,
        sessionLabel,
        userId: this.devices.get(deviceId)?.userId,
        role,
        startedAt: now,
        lastSeenAt: now,
        lastConfidence: latest.confidence,
        confidenceSum: latest.confidence ?? 0,
        confidenceCount: latest.confidence === undefined ? 0 : 1,
        ultrasonicVerified: latest.ultrasonicVerified,
        motionAnomalyFlag: latest.motionAnomalyFlag,
      });
      durationMs = 0;
      startedAtMs = now;
    }
    return { durationMs, startedAt: new Date(startedAtMs).toISOString() };
  }

  private trim() {
    const cutoff = Date.now() - WINDOW_MS;
    for (const [deviceId, deviceBatches] of this.batchesByDevice) {
      while (deviceBatches.length && new Date(deviceBatches[0].capturedAt).getTime() < cutoff) {
        deviceBatches.shift();
      }
      // A device that went stale without an explicit leave (crash, dropped connection) still
      // needs its now-empty entry cleared, or every device that's ever connected would leave a
      // permanent empty array behind in this map for the life of the server.
      if (deviceBatches.length === 0) this.batchesByDevice.delete(deviceId);
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
        this.closeMembershipAsLeft(key, membership, Date.now());
      }
    }
  }
}
