import { PocInferenceEngine } from "./inference.js";

const engine = new PocInferenceEngine();
const sessionId = "test-session";
const roomId = "room-a";

console.log("1. Joining Presenter and Attendees...");
engine.join("presenter-device-01", "presenter", roomId, "Dr. Alice");
engine.join("attendee-device-02", "attendee", undefined, "Bob (Matching WiFi)");
engine.join("attendee-device-03", "attendee", undefined, "Charlie (No WiFi / Fallback)");
engine.join("attendee-device-04", "attendee", undefined, "Diana (Different WiFi)");

const now = new Date().toISOString();

console.log("2. Ingesting Presence Batches...");
// Presenter batch
engine.ingest({
  sessionId,
  deviceId: "presenter-device-01",
  role: "presenter",
  roomId,
  rotatingId: "pres-tok-01",
  capturedAt: now,
  peers: [
    { rotatingId: "att2-tok-02", rssi: -70, seenAt: now },
    { rotatingId: "att3-tok-03", rssi: -75, seenAt: now },
    { rotatingId: "att4-tok-04", rssi: -82, seenAt: now }
  ],
  wifiFingerprint: [
    { bssid: "aa:bb:cc:01:01:01", ssid: "Conference-5G", rssi: -50, frequency: 5180 },
    { bssid: "aa:bb:cc:01:01:02", ssid: "Conference-2.4G", rssi: -60, frequency: 2412 },
    { bssid: "aa:bb:cc:01:01:03", ssid: "Venue-Guest", rssi: -70, frequency: 5200 }
  ]
});

// Attendee 2 (High Wi-Fi match)
engine.ingest({
  sessionId,
  deviceId: "attendee-device-02",
  role: "attendee",
  rotatingId: "att2-tok-02",
  capturedAt: now,
  peers: [{ rotatingId: "pres-tok-01", rssi: -68, seenAt: now }],
  wifiFingerprint: [
    { bssid: "aa:bb:cc:01:01:01", ssid: "Conference-5G", rssi: -52, frequency: 5180 },
    { bssid: "aa:bb:cc:01:01:02", ssid: "Conference-2.4G", rssi: -58, frequency: 2412 },
    { bssid: "aa:bb:cc:01:01:03", ssid: "Venue-Guest", rssi: -72, frequency: 5200 }
  ]
});

// Attendee 3 (Pure BLE, No Wi-Fi)
engine.ingest({
  sessionId,
  deviceId: "attendee-device-03",
  role: "attendee",
  rotatingId: "att3-tok-03",
  capturedAt: now,
  peers: [{ rotatingId: "pres-tok-01", rssi: -74, seenAt: now }]
});

// Attendee 4 (Different Wi-Fi)
engine.ingest({
  sessionId,
  deviceId: "attendee-device-04",
  role: "attendee",
  rotatingId: "att4-tok-04",
  capturedAt: now,
  peers: [{ rotatingId: "pres-tok-01", rssi: -83, seenAt: now }],
  wifiFingerprint: [
    { bssid: "11:22:33:99:99:99", ssid: "External-Cafe", rssi: -45, frequency: 2462 }
  ]
});

console.log("3. Querying Room State for 'room-a'...");
const state = engine.roomState(sessionId, roomId);
console.log("Room State:", JSON.stringify(state, null, 2));

// Validations
console.log("4. Validations:");
const bob = state.members?.find((m) => m.deviceId === "attendee-device-02");
const charlie = state.members?.find((m) => m.deviceId === "attendee-device-03");
const diana = state.members?.find((m) => m.deviceId === "attendee-device-04");

console.log(`Bob (Matching WiFi): similarity = ${bob?.wifiSimilarity}, confidence = ${bob?.confidence}`);
console.log(`Charlie (No WiFi): similarity = ${charlie?.wifiSimilarity}, confidence = ${charlie?.confidence}`);
console.log(`Diana (Different WiFi): similarity = ${diana?.wifiSimilarity}, confidence = ${diana?.confidence}`);

if (!bob || (bob.wifiSimilarity ?? 0) < 0.95 || (bob.confidence ?? 0) < 0.95) {
  throw new Error("Bob validation failed!");
}
if (!charlie || charlie.wifiSimilarity !== undefined || charlie.confidence !== 0.85) {
  throw new Error("Charlie validation failed!");
}
if (!diana || diana.wifiSimilarity !== 0 || (diana.confidence ?? 0) >= 0.85) {
  throw new Error("Diana validation failed!");
}

console.log("✅ All Wi-Fi inference unit tests PASSED successfully!");
