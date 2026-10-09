import type { RedisClient } from "../redis/index.js";
import type { ActiveRoomRecord, RoomMembershipRecord } from "./types.js";

export type RoomEndedNotice = { roomCode: string; endedAt: number };

/**
 * Checkpoints the two parts of the engine's state that actually need to survive a restart: which
 * room occurrence is current for each room name (activeRoomsByKey), and who's actively in one
 * right now (roomMembership) — including the running confidence mean, which has no intermediate
 * Postgres write until a stay closes. Everything else the engine holds (devices, raw sensor
 * batches, the tick's own derived caches) is either sub-30-second sensor data or fully rebuilt
 * within one tick of boot, so none of it is worth the round trip.
 *
 * "Room ended" notices get their own native-TTL keys instead of riding along in the blobs above,
 * since each one expires on its own schedule rather than all at once.
 *
 * Keys are namespaced by instanceId (the server's own port, by default) so two backend processes
 * pointed at the same Redis — a real instance and a leftover local test server, say — can never
 * silently stomp on each other's checkpoint. This isn't about supporting multiple cooperating
 * production instances (that's Phase 4, with a different, room-sharded design); it's purely
 * isolation against accidental collisions, which is exactly what caused a real session's room to
 * get wrongly force-closed during this phase's own testing.
 */
export class RedisCheckpointManager {
  private readonly activeRoomsKey: string;
  private readonly roomMembershipKey: string;
  private readonly roomEndedNoticePrefix: string;

  constructor(private readonly redis?: RedisClient, instanceId: string = "default") {
    const prefix = `engine:${instanceId}:`;
    this.activeRoomsKey = `${prefix}active-rooms`;
    this.roomMembershipKey = `${prefix}room-membership`;
    this.roomEndedNoticePrefix = `${prefix}room-ended-notice:`;
  }

  get hasRedis(): boolean {
    return Boolean(this.redis);
  }

  /** Fire-and-forget — tick() doesn't block on a Redis round trip every 2 seconds. */
  checkpoint(activeRooms: Map<string, ActiveRoomRecord>, roomMembership: Map<string, RoomMembershipRecord>) {
    if (!this.redis) return;
    const redis = this.redis;
    Promise.all([
      redis.set(this.activeRoomsKey, JSON.stringify([...activeRooms.entries()])),
      redis.set(this.roomMembershipKey, JSON.stringify([...roomMembership.entries()])),
    ]).catch((err) => console.error("[redis] checkpoint failed:", err));
  }

  /** Called once at boot, before the tick loop starts producing its own state. */
  async restore(): Promise<{
    activeRooms: Map<string, ActiveRoomRecord>;
    roomMembership: Map<string, RoomMembershipRecord>;
    roomEndedNotices: Map<string, RoomEndedNotice>;
  }> {
    const empty = {
      activeRooms: new Map<string, ActiveRoomRecord>(),
      roomMembership: new Map<string, RoomMembershipRecord>(),
      roomEndedNotices: new Map<string, RoomEndedNotice>(),
    };
    if (!this.redis) return empty;

    const [activeRoomsRaw, roomMembershipRaw, noticeKeys] = await Promise.all([
      this.redis.get(this.activeRoomsKey),
      this.redis.get(this.roomMembershipKey),
      this.scanNoticeKeys(),
    ]);

    const activeRooms = new Map<string, ActiveRoomRecord>(activeRoomsRaw ? JSON.parse(activeRoomsRaw) : []);
    const roomMembership = new Map<string, RoomMembershipRecord>(roomMembershipRaw ? JSON.parse(roomMembershipRaw) : []);

    const roomEndedNotices = new Map<string, RoomEndedNotice>();
    if (noticeKeys.length > 0) {
      const values = await this.redis.mget(...noticeKeys);
      noticeKeys.forEach((key, i) => {
        const raw = values[i];
        if (!raw) return;
        roomEndedNotices.set(key.slice(this.roomEndedNoticePrefix.length), JSON.parse(raw));
      });
    }

    return { activeRooms, roomMembership, roomEndedNotices };
  }

  private async scanNoticeKeys(): Promise<string[]> {
    if (!this.redis) return [];
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await this.redis.scan(cursor, "MATCH", `${this.roomEndedNoticePrefix}*`, "COUNT", 200);
      keys.push(...batch);
      cursor = next;
    } while (cursor !== "0");
    return keys;
  }

  /**
   * Same as setRoomEndedNotice, but for every device a just-ended room notifies at once — one
   * pipelined round trip instead of one command per device, since a room can hold hundreds.
   */
  setRoomEndedNotices(entries: { deviceId: string; roomCode: string; endedAt: number }[], ttlMs: number) {
    if (!this.redis || entries.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const { deviceId, roomCode, endedAt } of entries) {
      pipeline.set(`${this.roomEndedNoticePrefix}${deviceId}`, JSON.stringify({ roomCode, endedAt }), "PX", ttlMs);
    }
    pipeline.exec().catch((err) => console.error("[redis] failed to batch room-ended notices:", err));
  }

  clearRoomEndedNotice(deviceId: string) {
    if (!this.redis) return;
    this.redis
      .del(`${this.roomEndedNoticePrefix}${deviceId}`)
      .catch((err) => console.error("[redis] failed to clear room-ended notice:", err));
  }
}
