// Who sees what in a room's live state. An attendee's poll gets the host, itself and a headcount;
// the full roster (emails, readings, who left) is for the room's host and admins. Run with
// `pnpm --filter @confpresence/api test`, same style as test_wifi_inference.ts: no test framework.
import assert from "node:assert/strict";
import { PocInferenceEngine } from "./inference.js";

const engine = new PocInferenceEngine();
const sessionId = "access-session";
const roomId = "room-a";
const now = new Date().toISOString();

// A host and three attendees, each with their own account, all hearing each other over BLE.
engine.join("host-device-01", "presenter", roomId, "Host Hannah", sessionId, "user-host", "hannah@example.com");
engine.join("att-device-02", "attendee", roomId, "Bob", sessionId, "user-bob", "bob@example.com");
engine.join("att-device-03", "attendee", roomId, "Charlie", sessionId, "user-charlie", "charlie@example.com");
engine.join("att-device-04", "attendee", roomId, "Diana", sessionId, "user-diana", "diana@example.com");

const ids: Record<string, string> = {
  "host-device-01": "host-tok-01",
  "att-device-02": "att-tok-02",
  "att-device-03": "att-tok-03",
  "att-device-04": "att-tok-04",
};
for (const [deviceId, rotatingId] of Object.entries(ids)) {
  const isHost = deviceId === "host-device-01";
  const peers = Object.entries(ids)
    .filter(([id]) => id !== deviceId && (isHost || id === "host-device-01"))
    .map(([, tok]) => ({ rotatingId: tok, rssi: -65, seenAt: now }));
  const userId = { "host-device-01": "user-host", "att-device-02": "user-bob", "att-device-03": "user-charlie", "att-device-04": "user-diana" }[deviceId];
  engine.ingest(
    { sessionId, deviceId, role: isHost ? "presenter" : "attendee", roomId, rotatingId, capturedAt: now, peers },
    userId,
    `${userId?.replace("user-", "")}@example.com`
  );
}

// One tick first so everyone has a stay in the room, then Charlie leaves and the next tick puts him
// in the Left list.
engine.tick();
engine.leave("att-device-03");
engine.tick();

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

console.log("Full room state (the host's and an admin's view):");
const full = engine.roomState(sessionId, roomId);
check("lists the host and the two attendees still in the room", () => {
  assert.deepEqual(full.members?.map((m) => m.deviceId).sort(), ["att-device-02", "att-device-04", "host-device-01"]);
});
check("carries emails", () => assert.ok(full.members?.every((m) => m.email)));
check("lists who left", () => assert.deepEqual(full.leftMembers?.map((m) => m.deviceId), ["att-device-03"]));

console.log("Attendee poll (deviceRoomState for an attendee):");
const bob = engine.deviceRoomState(sessionId, "att-device-02");
check("returns only the host and the attendee itself", () => {
  assert.deepEqual(bob.members?.map((m) => m.deviceId).sort(), ["att-device-02", "host-device-01"]);
});
check("does not include other attendees", () => {
  assert.ok(!bob.members?.some((m) => m.deviceId === "att-device-04"));
});
check("has no emails and no UWB tokens", () => {
  assert.ok(bob.members?.every((m) => m.email === undefined && m.uwbDiscoveryToken === undefined));
});
check("has no left list", () => assert.equal(bob.leftMembers, undefined));
check("carries the headcount, host included", () => assert.equal(bob.memberCount, 3));
check("still carries what the attendee screen reads (host name, own confidence)", () => {
  assert.equal(bob.members?.find((m) => m.role === "presenter")?.displayName, "Host Hannah");
  assert.ok((bob.members?.find((m) => m.deviceId === "att-device-02")?.confidence ?? 0) > 0);
});
check("an attendee who left gets no room (the app reads this as out of range)", () => {
  const charlie = engine.deviceRoomState(sessionId, "att-device-03");
  assert.ok(!charlie.members?.some((m) => m.deviceId === "att-device-03"));
});

console.log("The host's own poll:");
check("a host asking by its device id gets the full state", () => {
  const hostView = engine.deviceRoomState(sessionId, "host-device-01");
  assert.equal(hostView.members?.length, 3);
  assert.equal(hostView.leftMembers?.length, 1);
});

console.log("Room poll for someone who is not the host (publicRoomState):");
const pub = engine.publicRoomState(sessionId, roomId);
check("shows the host and the headcount only", () => {
  assert.deepEqual(pub.members?.map((m) => m.deviceId), ["host-device-01"]);
  assert.equal(pub.memberCount, 3);
});
check("has no emails and no left list", () => {
  assert.ok(pub.members?.every((m) => m.email === undefined));
  assert.equal(pub.leftMembers, undefined);
});

console.log("Who counts as the host (isRoomHost):");
check("the host's device with its own account", () => assert.equal(engine.isRoomHost(sessionId, roomId, "host-device-01", "user-host"), true));
check("sign-in off (no account to compare): the host's device is enough", () => assert.equal(engine.isRoomHost(sessionId, roomId, "host-device-01", undefined), true));
check("the host's device id with someone else's account is refused", () => assert.equal(engine.isRoomHost(sessionId, roomId, "host-device-01", "user-bob"), false));
check("an attendee's device is not a host", () => assert.equal(engine.isRoomHost(sessionId, roomId, "att-device-02", "user-bob"), false));
check("an unknown device is not a host", () => assert.equal(engine.isRoomHost(sessionId, roomId, "nobody", "user-host"), false));
check("the host of another room is not this room's host", () => assert.equal(engine.isRoomHost(sessionId, "room-b", "host-device-01", "user-host"), false));

console.log(`\n✅ All ${passed} room access checks passed.`);
