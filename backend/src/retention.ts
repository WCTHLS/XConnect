import { and, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "./db/index.js";
import { schema } from "./db/index.js";

/** How long a deleted account's saved name (and email, if the server keeps it) stays on attendance records. */
export const DELETED_NAME_RETENTION_DAYS = Number(process.env.DELETED_NAME_RETENTION_DAYS) || 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const RUN_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Clears the name and email that account deletion copied onto attendance stays, once they have been
 * there for `retentionDays`. The stay itself stays, with its times and scores and no link to a person,
 * so event totals remain right. `attendee_saved_at` is kept: it marks the stay as one that belonged to a
 * deleted account, which is how reports label it "Former attendee" instead of a device id.
 *
 * A stay that has a saved name but no timestamp cannot be dated, so it is cleared straight away and
 * stamped now (this only covers rows saved before the timestamp existed).
 *
 * Safe to run any number of times, and from more than one process at once.
 */
export async function purgeSavedAttendeeData(db: Db, retentionDays: number, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const cleared = await db
    .update(schema.roomMembership)
    .set({
      attendeeName: null,
      attendeeEmail: null,
      attendeeSavedAt: sql`coalesce(${schema.roomMembership.attendeeSavedAt}, ${now.toISOString()}::timestamptz)`,
    })
    .where(
      and(
        or(isNotNull(schema.roomMembership.attendeeName), isNotNull(schema.roomMembership.attendeeEmail)),
        or(isNull(schema.roomMembership.attendeeSavedAt), lt(schema.roomMembership.attendeeSavedAt, cutoff))
      )
    )
    .returning({ id: schema.roomMembership.id });
  return cleared.length;
}

/** Runs the purge shortly after start-up and then every few hours, for as long as the process lives. */
export function startRetentionJob(db: Db, retentionDays: number = DELETED_NAME_RETENTION_DAYS) {
  const run = () =>
    purgeSavedAttendeeData(db, retentionDays)
      .then((count) => {
        if (count > 0) console.log(`\u{1F9F9} [RETENTION] cleared the saved name on ${count} attendance stays older than ${retentionDays} days`);
      })
      .catch((err) => console.error("[retention] purge failed:", err));

  setTimeout(run, 60_000).unref();
  setInterval(run, RUN_EVERY_MS).unref();
}
