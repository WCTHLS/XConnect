import {
  NotificationHubsClient,
  createFcmV1Notification,
  createFcmV1Installation,
  createFirebaseV1NotificationBody,
  createAppleInstallation,
  createAppleNotification,
  createAppleNotificationBody,
  createTagExpression
} from "@azure/notification-hubs";
import { db, schema } from "./db/index.js";

const CONNECTION_STRING = process.env.AZURE_NOTIFICATION_HUB_CONNECTION_STRING;
const HUB_NAME = process.env.AZURE_NOTIFICATION_HUB_NAME;

export const pushEnabled = Boolean(CONNECTION_STRING && HUB_NAME);

const client = pushEnabled ? new NotificationHubsClient(CONNECTION_STRING!, HUB_NAME!) : undefined;

// Notification Hubs tags allow letters, numbers, and `_ @ # . : -` only — `+` (valid in an email
// address) is not one of them. Lowercased for consistent matching regardless of how the address
// was typed; the `+` stripping means a `+`-tagged address (e.g. someone+test@x.com) collides with
// its base address as a tag, which is an acceptable POC-scope limitation, not a security issue.
function emailTag(email: string): string {
  return `email:${email.trim().toLowerCase().replace(/\+/g, "")}`;
}

/** Registers (or re-registers) one device's push channel, tagged by its signed-in user's email. Supports Android (FCM v1) and iOS (APNs). */
export async function registerInstallation(
  installationId: string,
  userId: string,
  email: string | undefined,
  pushChannel: string,
  platform: string = "android"
) {
  if (!client) throw new Error("Push notifications are not configured (AZURE_NOTIFICATION_HUB_CONNECTION_STRING / AZURE_NOTIFICATION_HUB_NAME not set)");

  const isIos = platform.toLowerCase() === "ios";
  const tags = email ? [emailTag(email)] : [];

  if (isIos) {
    const installation = createAppleInstallation({
      installationId,
      pushChannel,
      userId,
      tags
    });
    await client.createOrUpdateInstallation(installation);
  } else {
    const installation = createFcmV1Installation({
      installationId,
      pushChannel,
      userId,
      tags
    });
    await client.createOrUpdateInstallation(installation);
  }

  if (db) {
    const now = new Date();
    const storedPlatform = isIos ? "apns" : "fcmv1";
    await db
      .insert(schema.pushInstallations)
      .values({ installationId, userId, email, platform: storedPlatform, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.pushInstallations.installationId,
        set: { userId, email, platform: storedPlatform, updatedAt: now }
      });
  }
}

/**
 * Sends one plain notification to every device tagged with any of the given emails.
 * Dispatches to both Android (FCM v1) and iOS (APNs) in parallel so all registered devices receive it.
 */
export async function sendToEmails(emails: string[], title: string, body: string): Promise<{ matchedEmails: string[]; unmatchedEmails: string[] }> {
  if (!client) throw new Error("Push notifications are not configured (AZURE_NOTIFICATION_HUB_CONNECTION_STRING / AZURE_NOTIFICATION_HUB_NAME not set)");

  const tagExpression = createTagExpression(emails.map(emailTag));

  const fcmNotification = createFcmV1Notification({
    body: createFirebaseV1NotificationBody({ message: { notification: { title, body } } })
  });

  const appleNotification = createAppleNotification({
    body: createAppleNotificationBody({
      aps: {
        alert: { title, body },
        sound: "default"
      }
    })
  });

  await Promise.allSettled([
    client.sendNotification(fcmNotification, { tagExpression }),
    client.sendNotification(appleNotification, { tagExpression })
  ]);

  let matchedEmails = emails;
  let unmatchedEmails: string[] = [];
  if (db) {
    const lowered = emails.map((e) => e.trim().toLowerCase());
    const rows = await db
      .select({ email: schema.pushInstallations.email })
      .from(schema.pushInstallations);
    const registered = new Set(rows.map((r) => r.email?.trim().toLowerCase()).filter(Boolean));
    matchedEmails = emails.filter((_, i) => registered.has(lowered[i]));
    unmatchedEmails = emails.filter((_, i) => !registered.has(lowered[i]));
  }
  return { matchedEmails, unmatchedEmails };
}
