import { Redis } from "ioredis";

export type RedisClient = Redis;

/**
 * `undefined` when REDIS_URL isn't set — same "unset means off" switch DATABASE_URL uses. With
 * it unset, the engine checkpoints nothing and runs exactly as it did before Redis existed: pure
 * in-memory state, lost on restart. Redis here is a durability backstop, not a requirement.
 */
export const redis: RedisClient | undefined = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3 })
  : undefined;

if (redis) {
  redis.on("error", (err: Error) => console.error("[redis] connection error:", err));
}
