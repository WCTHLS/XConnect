import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";
import type { RoomMembershipRecord } from "./types.js";

export class EnginePersistenceManager {
  /**
   * In-flight "create this room row" write, keyed by occurrence ID. Writers that reference the
   * room by foreign key (membership rows, state-change events) await this first, since on a
   * pooled connection their insert could otherwise reach Postgres before the room row exists.
   */
  readonly pendingRoomCreation = new Map<string, Promise<void>>();

  /**
   * In-flight device upserts, so a state change recorded in the same tick as a device's very
   * first appearance waits for its row instead of being rejected by the foreign key. Mirrors
   * pendingRoomCreation above, which solves the identical race for rooms.
   */
  readonly pendingDeviceCreation = new Map<string, Promise<void>>();

  /**
   * What each device's row last held in Postgres, so an unchanged device is not written again on
   * every sensor batch. Lost on a restart on purpose: each active device then writes once on its
   * next batch, and the upsert is idempotent. Not shared through Redis, because there is a single
   * API process.
   */
  private readonly deviceWritten = new Map<string, { name: string | undefined; at: number }>();

  /** An unchanged device is rewritten at most this often, which keeps `last_seen_at` roughly current. */
  static readonly DEVICE_REFRESH_MS = 10 * 60 * 1000;

  /** Bounds the map above. Past this it is cleared, costing one extra write per active device. */
  static readonly DEVICE_CACHE_MAX = 20_000;

  constructor(private readonly db?: Db) {}

  get hasDb(): boolean {
    return Boolean(this.db);
  }

  /**
   * Inserts the session label row (grouping only) then the room occurrence row, in that order —
   * the room references the label by foreign key, and two un-awaited inserts on a pooled
   * connection have no ordering guarantee. Both are onConflictDoNothing, so callers with the
   * same values racing each other is harmless.
   */
  async upsertRoom(roomId: string, roomCode: string, sessionLabel: string | undefined, now: number): Promise<void> {
    if (!this.db) return;
    if (sessionLabel) {
      await this.db
        .insert(schema.sessions)
        .values({ id: sessionLabel, code: sessionLabel, startedAt: new Date(now) })
        .onConflictDoNothing();
    }
    await this.db
      .insert(schema.rooms)
      .values({ id: roomId, code: roomCode, sessionId: sessionLabel, label: roomCode, startedAt: new Date(now) })
      .onConflictDoNothing();
  }

  /**
   * Fire-and-forget upsert, gated on this.db — no caller awaits it. The promise is parked in
   * pendingDeviceCreation for the duration so that anything writing a row which references this
   * device (state_change_events) can wait for it, rather than racing the device's own insert on
   * its first ever appearance and losing the write to a foreign key violation.
   */
  upsertDevice(deviceId: string, displayName: string | undefined, now: number) {
    if (!this.db) return;

    // Called for every sensor batch from every device (about 100 a second at 1000 devices), and
    // each write holds a connection for a full round trip. Over a long link to the database that
    // is more than the pool can send, and the unsent writes pile up in memory. What the row needs
    // is: to exist (the foreign key for state-change events), the current name (read by history),
    // and a roughly current last_seen_at. So a device already written is only written again when
    // its name changes or DEVICE_REFRESH_MS has passed.
    const known = this.deviceWritten.get(deviceId);
    const nameChanged = displayName !== undefined && displayName !== known?.name;
    if (known && !nameChanged && now - known.at < EnginePersistenceManager.DEVICE_REFRESH_MS) return;

    if (this.deviceWritten.size >= EnginePersistenceManager.DEVICE_CACHE_MAX) this.deviceWritten.clear();
    // Recorded as the write starts, not when it lands, so two batches arriving together don't both write.
    const entry = { name: displayName ?? known?.name, at: now };
    this.deviceWritten.set(deviceId, entry);

    const write = this.db
      .insert(schema.devices)
      .values({ deviceId, displayName, firstSeenAt: new Date(now), lastSeenAt: new Date(now) })
      .onConflictDoUpdate({
        target: schema.devices.deviceId,
        set: { displayName, lastSeenAt: new Date(now) }
      })
      .then(() => undefined)
      .catch((err) => {
        console.error("[db] failed to upsert device:", err);
        // Forget it, so the next batch tries again instead of trusting a write that never landed.
        if (this.deviceWritten.get(deviceId) === entry) this.deviceWritten.delete(deviceId);
      })
      .finally(() => {
        // Only clear the entry if it is still this write: a later upsert for the same device may
        // already have replaced it, and deleting that one would reopen the race.
        if (this.pendingDeviceCreation.get(deviceId) === write) this.pendingDeviceCreation.delete(deviceId);
      });
    this.pendingDeviceCreation.set(deviceId, write);
  }

  /**
   * Fire-and-forget insert of a meaningful state-change event, gated on this.db.
   * Both parents must exist first: this row references rooms AND devices.
   */
  recordStateChange(roomId: string, deviceId: string, field: string, value: boolean, now: number) {
    if (!this.db) return;
    const db = this.db;
    (async () => {
      const pendingRoom = this.pendingRoomCreation.get(roomId);
      if (pendingRoom) await pendingRoom;
      const pendingDevice = this.pendingDeviceCreation.get(deviceId);
      if (pendingDevice) await pendingDevice;
      await db.insert(schema.stateChangeEvents).values({ roomId, deviceId, field, value, changedAt: new Date(now) });
    })().catch((err) => console.error("[db] failed to record state change:", err));
  }

  /**
   * Stamped rooms.ended_at when a room is explicitly ended or expires.
   */
  async endRoom(roomId: string, now: number): Promise<void> {
    if (!this.db) return;
    const pending = this.pendingRoomCreation.get(roomId);
    if (pending) await pending;
    await this.db.update(schema.rooms).set({ endedAt: new Date(now) }).where(eq(schema.rooms.id, roomId));
  }

  /**
   * Fire-and-forget from the caller's perspective (never awaited by trim()), but internally
   * sequenced: defensively re-upserts the room/device rows first, awaited, before inserting the
   * room_membership row that references them by foreign key.
   */
  private async persistClosedMembershipInternal(key: string, membership: RoomMembershipRecord) {
    if (!this.db) return;
    const deviceId = key.slice(membership.roomId.length + 2);

    const pending = this.pendingRoomCreation.get(membership.roomId);
    if (pending) await pending;
    await this.upsertRoom(membership.roomId, membership.roomCode, membership.sessionLabel, membership.startedAt);
    await this.db
      .insert(schema.devices)
      .values({ deviceId, firstSeenAt: new Date(membership.startedAt), lastSeenAt: new Date(membership.lastSeenAt) })
      .onConflictDoNothing();

    await this.db.insert(schema.roomMembership).values({
      roomId: membership.roomId,
      deviceId,
      userId: membership.userId,
      role: membership.role,
      startedAt: new Date(membership.startedAt),
      endedAt: new Date(membership.lastSeenAt),
      lastConfidence: membership.lastConfidence,
      avgConfidence:
        membership.confidenceCount > 0 ? membership.confidenceSum / membership.confidenceCount : null,
      ultrasonicVerified: membership.ultrasonicVerified,
      motionAnomalyFlag: membership.motionAnomalyFlag
    });

    // The stay just ended — this is the "connected" -> false transition. Any flag still true is
    // closed at the same instant.
    const endedAt = new Date(membership.lastSeenAt);
    const closing: { field: string; value: boolean }[] = [{ field: "connected", value: false }];
    if (membership.motionAnomalyFlag) closing.push({ field: "motion_anomaly_flag", value: false });
    if (membership.role !== "presenter" && membership.ultrasonicVerified) {
      closing.push({ field: "ultrasonic_verified", value: false });
    }
    await this.db.insert(schema.stateChangeEvents).values(
      closing.map((c) => ({ roomId: membership.roomId, deviceId, field: c.field, value: c.value, changedAt: endedAt }))
    );
  }

  /** Stay writes that have been started but have not reached Postgres yet. See settle(). */
  private readonly inFlightMemberships = new Set<Promise<void>>();

  persistClosedMembership(key: string, membership: RoomMembershipRecord) {
    if (!this.db) return;
    const write: Promise<void> = this.persistClosedMembershipInternal(key, membership)
      .catch((err) => console.error("[db] failed to persist closed room_membership:", err))
      .finally(() => this.inFlightMemberships.delete(write));
    this.inFlightMemberships.add(write);
  }

  /**
   * Resolves once every stay write started so far has finished (or failed and been logged).
   * Deleting an account needs this: a stay that was just closed is written in the background with a
   * foreign key to the user's row, so the row must not be deleted until that insert has landed.
   */
  async settle(): Promise<void> {
    while (this.inFlightMemberships.size > 0) {
      await Promise.all([...this.inFlightMemberships]);
    }
  }
}
