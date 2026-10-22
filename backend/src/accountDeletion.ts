import { eq, inArray, or } from "drizzle-orm";
import type { Db } from "./db/index.js";
import { schema } from "./db/index.js";

/** The part of the live engine that account deletion needs. PocInferenceEngine implements it. */
export type DeletionEngine = {
  leaveAllDevicesOf(userId: string): string[];
  settlePersistence(): Promise<void>;
};

export type DeletionResult = {
  /** Attendance stays kept, with the person's name copied onto them and the link to the account cut. */
  stays: number;
  /** Invitations to this person that were deleted. */
  invitations: number;
  /** Invitations this person sent to others, kept without the sender. */
  invitationsSentKept: number;
  pushRegistrations: number;
  /** Hub removals that failed. The account is deleted regardless. */
  hubFailures: number;
};

/**
 * Deletes a person's data. What goes:
 *   - the users row (name, email, preferred name),
 *   - their push registrations (and the devices at the notification hub),
 *   - invitations addressed to them, by account or by email,
 *   - the name saved on their devices.
 * What stays, on purpose: their attendance stays. Each one gets the person's name copied onto it
 * (and the email, only when `retainEmail` is set), stamped with the time, and the link to the account is
 * cut, so reports for recent events remain complete. The retention job (retention.ts) clears the name
 * and email once the stamp is older than the retention period. Invitations
 * they SENT stay for the people who received them, without the sender.
 *
 * Safe to run twice: the second run finds nothing to do.
 */
export async function deleteAccountData(args: {
  db: Db;
  engine: DeletionEngine;
  userId: string;
  retainEmail: boolean;
  /** Removes devices from the notification hub; returns how many removals failed. */
  unregister: (installationIds: string[]) => Promise<number>;
  /** Called last: drop caches and refuse tokens issued before now. */
  onDeleted: (userId: string) => void;
}): Promise<DeletionResult> {
  const { db, engine, userId, retainEmail } = args;

  // Phones leave, open stays close and are queued for writing. Wait for those writes: each one
  // references the user's row, which is about to go.
  const releasedDevices = engine.leaveAllDevicesOf(userId);
  await engine.settlePersistence();

  const { result, installationIds } = await db.transaction(async (tx) => {
    const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, userId));
    const name = user?.preferredName?.trim() || user?.displayName?.trim() || null;
    const email = user?.email?.trim().toLowerCase() || null;

    const installs = await tx
      .select({ installationId: schema.pushInstallations.installationId })
      .from(schema.pushInstallations)
      .where(eq(schema.pushInstallations.userId, userId));

    const stays = await tx
      .update(schema.roomMembership)
      .set({ attendeeName: name, attendeeEmail: retainEmail ? email : null, attendeeSavedAt: new Date(), userId: null })
      .where(eq(schema.roomMembership.userId, userId))
      .returning({ deviceId: schema.roomMembership.deviceId });

    // The name a person typed when joining sits on the device row. It must not outlive the account
    // as a second copy of the name that the retention setting knows nothing about.
    const deviceIds = [...new Set([...releasedDevices, ...stays.map((s) => s.deviceId), ...installs.map((i) => i.installationId)])];
    if (deviceIds.length > 0) {
      await tx.update(schema.devices).set({ displayName: null }).where(inArray(schema.devices.deviceId, deviceIds));
    }

    const removedPush = await tx
      .delete(schema.pushInstallations)
      .where(eq(schema.pushInstallations.userId, userId))
      .returning({ id: schema.pushInstallations.installationId });

    // Invitations they sent keep existing for the people who got them.
    const sentKept = await tx
      .update(schema.sessionInvites)
      .set({ invitedByUserId: null })
      .where(eq(schema.sessionInvites.invitedByUserId, userId))
      .returning({ id: schema.sessionInvites.id });

    const addressedToThem = email
      ? or(eq(schema.sessionInvites.userId, userId), eq(schema.sessionInvites.email, email))
      : eq(schema.sessionInvites.userId, userId);
    const removedInvites = await tx.delete(schema.sessionInvites).where(addressedToThem).returning({ id: schema.sessionInvites.id });

    await tx.delete(schema.users).where(eq(schema.users.id, userId));

    return {
      installationIds: [...new Set([...installs.map((i) => i.installationId), ...releasedDevices])],
      result: {
        stays: stays.length,
        invitations: removedInvites.length,
        invitationsSentKept: sentKept.length,
        pushRegistrations: removedPush.length,
        hubFailures: 0,
      } satisfies DeletionResult,
    };
  });

  result.hubFailures = await args.unregister(installationIds);
  args.onDeleted(userId);
  return result;
}
