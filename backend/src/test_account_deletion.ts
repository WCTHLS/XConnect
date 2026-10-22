/**
 * Account deletion: what the live engine forgets, and what the database keeps and removes.
 *
 *   pnpm exec tsx src/test_account_deletion.ts
 *
 * Part 1 runs on the in-memory engine alone. Part 2 needs the local Postgres (the one `drizzle-kit
 * migrate` was run against, DATABASE_URL or postgres://postgres:dev@localhost:5432/confpresence); it
 * creates rows under a random prefix, deletes accounts through deleteAccountData, and removes every
 * row it made. If no database answers, part 2 is skipped and the run still passes, so `pnpm test`
 * works on a machine without Docker.
 */
import assert from "node:assert/strict";
import { and, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { deleteAccountData } from "./accountDeletion.js";
import * as schema from "./db/schema.js";
import { EnginePersistenceManager } from "./engine/persistence.js";
import { purgeSavedAttendeeData } from "./retention.js";
import { PocInferenceEngine } from "./inference.js";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// ---------------------------------------------------------------------------------------------
// Part 1: the live engine
// ---------------------------------------------------------------------------------------------
console.log("Live engine:");
{
  const engine = new PocInferenceEngine();
  const sessionId = "del-session";
  const roomId = "room-a";
  const now = new Date().toISOString();

  engine.join("host-dev-01", "presenter", roomId, "Host Hannah", sessionId, "user-host", "hannah@example.com");
  engine.join("att-dev-02", "attendee", roomId, "Bob", sessionId, "user-bob", "bob@example.com");
  engine.join("att-dev-03", "attendee", roomId, "Charlie", sessionId, "user-charlie", "charlie@example.com");

  const ids: Record<string, string> = { "host-dev-01": "h-tok-01", "att-dev-02": "a-tok-02", "att-dev-03": "a-tok-03" };
  const owner: Record<string, string> = { "host-dev-01": "user-host", "att-dev-02": "user-bob", "att-dev-03": "user-charlie" };
  for (const [deviceId, rotatingId] of Object.entries(ids)) {
    const isHost = deviceId === "host-dev-01";
    const peers = Object.entries(ids)
      .filter(([id]) => id !== deviceId && (isHost || id === "host-dev-01"))
      .map(([, tok]) => ({ rotatingId: tok, rssi: -65, seenAt: now }));
    engine.ingest(
      { sessionId, deviceId, role: isHost ? "presenter" : "attendee", roomId, rotatingId, capturedAt: now, peers },
      owner[deviceId],
      `${owner[deviceId].replace("user-", "")}@example.com`
    );
  }
  engine.tick();

  // Charlie leaves on his own first, so he is in the live "Left" list when his account is deleted.
  engine.leave("att-dev-03");
  engine.tick();
  check("Charlie is in the Left list before his account is deleted", () => {
    assert.deepEqual(engine.roomState(sessionId, roomId).leftMembers?.map((m) => m.deviceId), ["att-dev-03"]);
  });

  const releasedCharlie = engine.leaveAllDevicesOf("user-charlie");
  engine.tick(); // the live view is rebuilt on the tick
  check("deleting someone who already left removes them from the Left list", () => {
    assert.deepEqual(engine.roomState(sessionId, roomId).leftMembers ?? [], []);
    assert.deepEqual(releasedCharlie, []);
  });

  const releasedBob = engine.leaveAllDevicesOf("user-bob");
  engine.tick();
  check("deleting a present attendee releases their phone", () => assert.deepEqual(releasedBob, ["att-dev-02"]));
  check("and takes them out of the room and out of the Left list", () => {
    const state = engine.roomState(sessionId, roomId);
    assert.deepEqual(state.members?.map((m) => m.deviceId), ["host-dev-01"]);
    assert.deepEqual(state.leftMembers ?? [], []);
  });

  check("deleting someone twice is harmless", () => assert.deepEqual(engine.leaveAllDevicesOf("user-bob"), []));

  const releasedHost = engine.leaveAllDevicesOf("user-host");
  check("deleting the host ends their room", () => {
    assert.deepEqual(releasedHost, ["host-dev-01"]);
    assert.equal(engine.myActiveRooms("user-host").length, 0);
  });
}

// ---------------------------------------------------------------------------------------------
// Part 2: the database
// ---------------------------------------------------------------------------------------------
const url = process.env.DATABASE_URL ?? "postgres://postgres:dev@localhost:5432/confpresence";
const sql = postgres(url, { max: 2, connect_timeout: 4, onnotice: () => {} });
const db = drizzle(sql, { schema });

let reachable = true;
try {
  await sql`select 1`;
} catch {
  reachable = false;
}

if (!reachable) {
  console.log("Database: skipped (no Postgres answered at the DATABASE_URL, start Docker and run the migrations to run it)");
} else {
  console.log("Database:");
  const p = `deltest${Math.random().toString(36).slice(2, 8)}`;
  const A = `${p}-a`; // the account that is deleted
  const B = `${p}-b`; // someone else, who must be untouched
  const C = `${p}-c`; // deleted with the email kept, has a preferred name
  const dA1 = `${p}-dev-a1`;
  const dA2 = `${p}-dev-a2`;
  const dB1 = `${p}-dev-b1`;
  const dC1 = `${p}-dev-c1`;
  const room = `${p}-room`;
  const emailA = `Dana.Delete.${p}@Example.com`;
  const emailB = `bob.${p}@example.com`;
  const emailC = `cee.${p}@example.com`;

  async function cleanup() {
    await db.delete(schema.sessionInvites).where(like(schema.sessionInvites.sessionCode, `${p}%`));
    await db.delete(schema.pushInstallations).where(like(schema.pushInstallations.installationId, `${p}%`));
    await db.delete(schema.stateChangeEvents).where(like(schema.stateChangeEvents.roomId, `${p}%`));
    await db.delete(schema.roomMembership).where(like(schema.roomMembership.roomId, `${p}%`));
    await db.delete(schema.devices).where(like(schema.devices.deviceId, `${p}%`));
    await db.delete(schema.rooms).where(like(schema.rooms.id, `${p}%`));
    await db.delete(schema.sessions).where(like(schema.sessions.id, `${p}%`));
    await db.delete(schema.users).where(like(schema.users.id, `${p}%`));
  }

  try {
    await db.insert(schema.users).values([
      { id: A, email: emailA, displayName: "Dana Delete" },
      { id: B, email: emailB, displayName: "Bob Keep" },
      { id: C, email: emailC, displayName: "Charles", preferredName: "Cee" },
    ]);
    await db.insert(schema.devices).values([
      { deviceId: dA1, displayName: "Dana phone" },
      { deviceId: dA2, displayName: "Dana tablet" },
      { deviceId: dB1, displayName: "Bob phone" },
      { deviceId: dC1, displayName: "Cee phone" },
    ]);
    await db.insert(schema.rooms).values({ id: room, code: "room-a" });
    const at = (m: number) => new Date(Date.UTC(2026, 9, 20, 9, m));
    await db.insert(schema.roomMembership).values([
      { roomId: room, deviceId: dA1, userId: A, role: "attendee", startedAt: at(0), endedAt: at(30) },
      { roomId: room, deviceId: dA2, userId: A, role: "attendee", startedAt: at(40), endedAt: at(50) },
      { roomId: room, deviceId: dB1, userId: B, role: "attendee", startedAt: at(0), endedAt: at(55) },
      { roomId: room, deviceId: dC1, userId: C, role: "attendee", startedAt: at(5), endedAt: at(25) },
    ]);
    await db.insert(schema.pushInstallations).values([
      { installationId: dA1, userId: A, email: emailA, platform: "fcmv1" },
      { installationId: dB1, userId: B, email: emailB, platform: "fcmv1" },
    ]);
    await db.insert(schema.sessionInvites).values([
      { sessionCode: `${p}-s1`, email: emailB, userId: B, invitedByUserId: A, status: "pending" }, // A invited B
      { sessionCode: `${p}-s2`, email: emailA.toLowerCase(), userId: A, status: "accepted" }, // invited A, signed in
      { sessionCode: `${p}-s3`, email: emailA.toLowerCase(), status: "pending" }, // invited A before sign-up
      { sessionCode: `${p}-s4`, email: `other.${p}@example.com`, invitedByUserId: B, status: "pending" }, // B's, untouched
    ]);

    const calls: string[] = [];
    const engine = {
      leaveAllDevicesOf: (id: string) => {
        calls.push(`leave:${id}`);
        return id === A ? [dA1, dA2] : id === C ? [dC1] : [];
      },
      settlePersistence: async () => {
        calls.push("settle");
      },
    };
    const unregistered: string[][] = [];
    const deleted: string[] = [];
    const common = {
      db: db as never,
      engine,
      unregister: async (ids: string[]) => {
        unregistered.push(ids);
        return 0;
      },
      onDeleted: (id: string) => deleted.push(id),
    };

    const result = await deleteAccountData({ ...common, userId: A, retainEmail: false });

    check("waits for the stay writes before touching the database", () => {
      assert.deepEqual(calls, [`leave:${A}`, "settle"]);
    });
    check("reports what it did", () => {
      assert.deepEqual(result, { stays: 2, invitations: 2, invitationsSentKept: 1, pushRegistrations: 1, hubFailures: 0 });
    });

    const [userRowA] = await db.select().from(schema.users).where(eq(schema.users.id, A));
    const [userRowB] = await db.select().from(schema.users).where(eq(schema.users.id, B));
    check("removes the account's row and leaves other accounts alone", () => {
      assert.equal(userRowA, undefined);
      assert.equal(userRowB?.email, emailB);
    });

    const stays = await db.select().from(schema.roomMembership).where(eq(schema.roomMembership.roomId, room));
    const staysA = stays.filter((s) => s.deviceId === dA1 || s.deviceId === dA2);
    check("keeps both attendance stays, now without the account link", () => {
      assert.equal(staysA.length, 2);
      assert.ok(staysA.every((s) => s.userId === null));
    });
    check("copies the name onto each stay and not the email (the default)", () => {
      assert.ok(staysA.every((s) => s.attendeeName === "Dana Delete" && s.attendeeEmail === null));
    });
    check("stamps when the name was saved, for the retention job", () => {
      assert.ok(staysA.every((s) => s.attendeeSavedAt instanceof Date && Date.now() - s.attendeeSavedAt.getTime() < 60_000));
    });
    check("does not touch anyone else's stay", () => {
      const b = stays.find((s) => s.deviceId === dB1);
      assert.equal(b?.userId, B);
      assert.equal(b?.attendeeName, null);
    });

    const devices = await db.select().from(schema.devices).where(like(schema.devices.deviceId, `${p}%`));
    const nameOf = (id: string) => devices.find((d) => d.deviceId === id)?.displayName;
    check("clears the name typed on the account's devices, and only theirs", () => {
      assert.equal(nameOf(dA1), null);
      assert.equal(nameOf(dA2), null);
      assert.equal(nameOf(dB1), "Bob phone");
    });

    const pushes = await db.select().from(schema.pushInstallations).where(like(schema.pushInstallations.installationId, `${p}%`));
    check("removes their push registrations and keeps others", () => {
      assert.deepEqual(pushes.map((r) => r.installationId), [dB1]);
    });
    check("asks the hub to drop their devices", () => {
      assert.deepEqual([...unregistered[0]].sort(), [dA1, dA2].sort());
    });

    const invites = await db.select().from(schema.sessionInvites).where(like(schema.sessionInvites.sessionCode, `${p}%`));
    check("removes invitations addressed to them, by account and by email", () => {
      assert.deepEqual(invites.map((i) => i.sessionCode).sort(), [`${p}-s1`, `${p}-s4`]);
    });
    check("keeps an invitation they sent, without the sender", () => {
      const s1 = invites.find((i) => i.sessionCode === `${p}-s1`);
      assert.equal(s1?.userId, B);
      assert.equal(s1?.invitedByUserId, null);
    });
    check("leaves invitations that have nothing to do with them", () => {
      const s4 = invites.find((i) => i.sessionCode === `${p}-s4`);
      assert.equal(s4?.invitedByUserId, B);
    });
    check("drops caches and marks the token dead", () => assert.deepEqual(deleted, [A]));

    const again = await deleteAccountData({ ...common, userId: A, retainEmail: false });
    check("running it again is harmless", () => {
      assert.deepEqual(again, { stays: 0, invitations: 0, invitationsSentKept: 0, pushRegistrations: 0, hubFailures: 0 });
    });

    // The email setting, and a preferred name winning over the account name.
    await deleteAccountData({ ...common, userId: C, retainEmail: true });
    const [stayC] = await db
      .select()
      .from(schema.roomMembership)
      .where(and(eq(schema.roomMembership.roomId, room), eq(schema.roomMembership.deviceId, dC1)));
    check("with the email setting on, keeps the email too, lowercased", () => assert.equal(stayC.attendeeEmail, emailC));
    check("keeps the preferred name, not the account name", () => assert.equal(stayC.attendeeName, "Cee"));

    // The race that settlePersistence exists for: a stay closed an instant before the deletion is
    // written in the background with a foreign key to the user, so deleting the user first would
    // lose it (or fail it). Nothing is awaited between closing the stay and deleting the account.
    const D = `${p}-d`;
    const dD1 = `${p}-dev-d1`;
    const room2 = `${p}-room2`;
    await db.insert(schema.users).values({ id: D, email: `dee.${p}@example.com`, displayName: "Dee Race" });
    const persistence = new EnginePersistenceManager(db as never);
    persistence.persistClosedMembership(`${room2}::${dD1}`, {
      roomId: room2,
      roomCode: "room-r",
      sessionLabel: `${p}-sess`,
      userId: D,
      role: "attendee",
      startedAt: Date.now() - 60_000,
      lastSeenAt: Date.now(),
      confidenceSum: 0.8,
      confidenceCount: 1,
    });
    await deleteAccountData({
      ...common,
      engine: { leaveAllDevicesOf: () => [dD1], settlePersistence: () => persistence.settle() },
      userId: D,
      retainEmail: false,
    });
    const raced = await db.select().from(schema.roomMembership).where(eq(schema.roomMembership.roomId, room2));
    check("a stay closed just before the deletion is saved, then kept with the name", () => {
      assert.equal(raced.length, 1);
      assert.equal(raced[0].userId, null);
      assert.equal(raced[0].attendeeName, "Dee Race");
    });

    // Retention. The purge looks at the whole table, so this runs inside a transaction that is always
    // rolled back: it can never change rows that are not its own, and the checks look only at its own.
    class Rollback extends Error {}
    try {
      await db.transaction(async (tx) => {
        const room3 = `${p}-room3`;
        const R = `${p}-r`;
        const live = `${p}-live`;
        const day = 24 * 60 * 60 * 1000;
        const ago = (days: number) => new Date(Date.now() - days * day);
        await tx.insert(schema.rooms).values({ id: room3, code: "room-ret" });
        await tx.insert(schema.users).values({ id: live, email: `live.${p}@example.com`, displayName: "Still Here" });
        await tx.insert(schema.devices).values(["old", "fresh", "legacy", "email", "live"].map((k) => ({ deviceId: `${R}-${k}` })));
        const base = { roomId: room3, role: "attendee", startedAt: ago(40), endedAt: ago(40) };
        await tx.insert(schema.roomMembership).values([
          { ...base, deviceId: `${R}-old`, attendeeName: "Old Person", attendeeSavedAt: ago(31) },
          { ...base, deviceId: `${R}-fresh`, attendeeName: "Fresh Person", attendeeSavedAt: ago(2) },
          { ...base, deviceId: `${R}-legacy`, attendeeName: "Legacy Person", attendeeSavedAt: null },
          { ...base, deviceId: `${R}-email`, attendeeEmail: "gone@example.com", attendeeSavedAt: ago(45) },
          { ...base, deviceId: `${R}-live`, userId: live },
        ]);

        await purgeSavedAttendeeData(tx as never, 30);
        const rows = await tx.select().from(schema.roomMembership).where(eq(schema.roomMembership.roomId, room3));
        const row = (k: string) => rows.find((r) => r.deviceId === `${R}-${k}`)!;

        check("clears a name saved more than 30 days ago", () => {
          assert.equal(row("old").attendeeName, null);
        });
        check("clears a saved email of that age too", () => assert.equal(row("email").attendeeEmail, null));
        check("keeps a name saved 2 days ago", () => assert.equal(row("fresh").attendeeName, "Fresh Person"));
        check("clears a saved name that has no date, and dates it now", () => {
          assert.equal(row("legacy").attendeeName, null);
          assert.ok(row("legacy").attendeeSavedAt instanceof Date);
        });
        check("keeps the stay and its marker after clearing", () => {
          assert.equal(rows.length, 5);
          assert.ok(row("old").attendeeSavedAt instanceof Date);
        });
        check("does not touch a stay that still belongs to an account", () => {
          assert.equal(row("live").userId, live);
          assert.equal(row("live").attendeeSavedAt, null);
        });

        const again = await purgeSavedAttendeeData(tx as never, 30);
        check("running it again clears nothing more of these rows", () => {
          assert.equal(again, 0);
          assert.equal(row("fresh").attendeeName, "Fresh Person");
        });
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  } finally {
    await cleanup().catch((err) => console.error("cleanup failed:", err));
  }
}
await sql.end();

console.log(`\n${passed} checks passed`);
