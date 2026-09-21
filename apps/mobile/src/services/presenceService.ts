import { PermissionsAndroid, Platform } from "react-native";
import { DeviceMotion, type DeviceMotionMeasurement } from "expo-sensors";
import { getAcousticTokenForRoom, type ParticipantRole, type UltrasonicObservation, type WifiApObservation } from "@confpresence/shared";
import { createRotatingId } from "./deviceIdentity";
import { requireBleModule, subscribeToPeers, type NativePeer } from "../native/confPresenceBle";
import { getWifiFingerprint } from "../native/confPresenceWifi";
import { isUltrasonicAvailable, requireUltrasonicModule, subscribeToUltrasonicTokens } from "../native/confPresenceUltrasonic";
import { AppLogger } from "./appLogger";

const MOTION_SAMPLE_INTERVAL_MS = 200; // ~5Hz, coarse activity level, not gesture recognition

// Fallback only used if a caller doesn't pass config.apiUrl explicitly (App.tsx always does).
// Deliberately not overridable via EXPO_PUBLIC_API_URL — that env var previously let a build
// silently point "Cloud" at a local dev URL with no indication in the UI.
const DEFAULT_API_URL = "https://xconnect-api.onrender.com";
const BATCH_INTERVAL_MS = 10_000;
// How long a heard ultrasonic token stays valid before we treat it as stale and stop
// resending it. Must be well under the server's freshness window (45s) so the gate can
// actually expire client-side once the presenter stops broadcasting, instead of getting
// perpetually refreshed by resending the same old observation every batch.
const ULTRASONIC_OBSERVATION_TTL_MS = 15_000;

async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;

  try {
    if (Platform.Version >= 31) {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      ]);
      const granted = (
        results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
        results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE] === PermissionsAndroid.RESULTS.GRANTED &&
        results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED
      );
      if (!granted) {
        AppLogger.log("WARN", "Android 12+ Bluetooth / Location permissions missing", "warn");
      }
      return granted;
    } else {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: "Location Permission for Presence Tracking",
          message: "ConfPresence ZERO uses Bluetooth and Wi-Fi to detect in-room presence.",
          buttonPositive: "OK"
        }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
  } catch (err: any) {
    AppLogger.log("ERROR", `Permission request failed: ${err?.message || err}`, "error");
    return false;
  }
}

async function requestAudioPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: "Microphone Permission for Ultrasonic Gate",
        message: "XConnect uses inaudible ultrasonic acoustic signals (18-20 kHz) to verify physical room presence.",
        buttonPositive: "OK"
      }
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch (err: any) {
    AppLogger.log("WARN", `Audio permission check skipped: ${err?.message || err}`, "warn");
    return false;
  }
}

export type PresenceStatus = {
  state: "idle" | "starting" | "running" | "error";
  peerCount: number;
  wifiApCount?: number;
  rotatingId?: string;
  ultrasonicState?: "broadcasting" | "listening" | "verified" | "idle";
  ultrasonicToken?: string;
  error?: string;
};

type StartConfig = {
  sessionId: string;
  roomId?: string;
  role: ParticipantRole;
  deviceId: string;
  displayName?: string;
  apiUrl?: string;
};

export class PresenceService {
  private peers = new Map<string, NativePeer>();
  private activePeerCache = new Map<string, { peer: NativePeer; lastSeenAt: number }>();
  private timer?: ReturnType<typeof setInterval>;
  private subscription?: { remove: () => void };
  private config?: StartConfig;
  private rotatingId?: string;
  private isAdvertising = false;
  private lastWifiApCount = 0;
  private lastKnownWifiFingerprint: WifiApObservation[] = [];
  private motionSamples: number[] = [];
  private motionSubscription?: { remove: () => void };
  private latestUltrasonicObservation?: UltrasonicObservation;
  private latestUltrasonicObservedAt?: number;
  private ultrasonicSubscription?: { remove: () => void };
  private emittedUltrasonicToken?: string;
  private currentUltrasonicState: "broadcasting" | "listening" | "verified" | "idle" = "idle";
  private currentUltrasonicToken?: string;
  private isRunning = false;

  private rejectionReported = false;

  constructor(
    private readonly onStatus: (status: PresenceStatus) => void,
    private readonly onRoomRejected?: (message: string) => void
  ) {}

  /** The server refused this presenter because the room already has a live one. Reported once per start. */
  private async handleRoomRejected(res: Response) {
    if (this.rejectionReported) return;
    this.rejectionReported = true;
    const data = await res.json().catch(() => null);
    const who = data?.presenterName ? ` (${data.presenterName})` : "";
    AppLogger.log("WARN", `Room already has a presenter${who}`, "warn");
    this.onRoomRejected?.(`This room already has a presenter${who}. Pick a different room, or wait for them to leave.`);
  }

  private emitStatus(stateOverride?: "idle" | "starting" | "running" | "error", error?: string) {
    this.onStatus({
      state: stateOverride ?? (this.isRunning ? "running" : "idle"),
      peerCount: this.activePeerCache.size,
      wifiApCount: this.lastWifiApCount,
      rotatingId: this.rotatingId,
      ultrasonicState: this.currentUltrasonicState,
      ultrasonicToken: this.currentUltrasonicToken,
      error
    });
  }

  async start(config: StartConfig) {
    this.config = config;
    this.rejectionReported = false;
    this.isRunning = true;
    this.lastWifiApCount = 0;
    this.lastKnownWifiFingerprint = [];
    this.peers.clear();
    this.activePeerCache.clear();
    this.isAdvertising = false;
    this.latestUltrasonicObservation = undefined;
    this.latestUltrasonicObservedAt = undefined;
    this.emittedUltrasonicToken = undefined;
    this.currentUltrasonicState = config.role === "presenter" ? "broadcasting" : "listening";
    this.currentUltrasonicToken = undefined;
    this.emitStatus("starting");
    AppLogger.log("INFO", `Starting presence service as ${config.role.toUpperCase()} (Device: ${config.deviceId.slice(-8)})`);

    const granted = await requestBlePermissions();
    if (!granted) {
      AppLogger.log("ERROR", "Bluetooth / Nearby devices permissions denied by user", "error");
      throw new Error("Nearby devices / Bluetooth permissions are required. Please grant permissions in your phone settings.");
    }

    // Attempt join asynchronously without blocking local BLE hardware activation
    this.joinSession(config).catch(() => {
      // Offline / connecting
    });

    await this.rotateAndAdvertise(true);
    const ble = requireBleModule();
    this.subscription = subscribeToPeers((peer) => this.onPeer(peer));
    await ble.startScanning();
    AppLogger.log("BLE", "Native BLE scanner started successfully in Low-Latency mode");

    this.startMotionSensing();

    // Start Ultrasonic Acoustic Gate subsystem
    if (isUltrasonicAvailable()) {
      if (config.role === "presenter") {
        try {
          const ultrasonic = requireUltrasonicModule();
          this.emittedUltrasonicToken = getAcousticTokenForRoom(config.roomId);
          this.currentUltrasonicToken = this.emittedUltrasonicToken;
          this.currentUltrasonicState = "broadcasting";
          await ultrasonic.startBroadcasting(this.emittedUltrasonicToken);
          AppLogger.log("ULTRASONIC", `Broadcasting acoustic room token: '${this.emittedUltrasonicToken}' (18.5-19.5 kHz)`);
        } catch (err: any) {
          AppLogger.log("WARN", `Ultrasonic broadcaster init: ${err?.message || err}`, "warn");
        }
      } else {
        try {
          void requestAudioPermissions();
          const ultrasonic = requireUltrasonicModule();
          this.ultrasonicSubscription = subscribeToUltrasonicTokens((obs) => {
            this.latestUltrasonicObservation = obs;
            this.latestUltrasonicObservedAt = Date.now();
            this.currentUltrasonicState = "verified";
            this.currentUltrasonicToken = obs.token;
            AppLogger.log("ULTRASONIC", `Heard acoustic token '${obs.token}' (${Math.round(obs.confidence * 100)}% conf) -> Hard Gate Verified!`);
            this.emitStatus();
          });
          await ultrasonic.startListening();
          AppLogger.log("ULTRASONIC", "Acoustic listener started (Goertzel 18.5-19.5 kHz)");
        } catch (err: any) {
          AppLogger.log("WARN", `Ultrasonic listener init: ${err?.message || err}`, "warn");
        }
      }
    }

    this.timer = setInterval(() => void this.flushAndRotate(), BATCH_INTERVAL_MS);
    this.emitStatus("running");
  }

  async stop() {
    AppLogger.log("INFO", "Stopping presence service...");
    this.isRunning = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.subscription?.remove();
    this.subscription = undefined;
    this.peers.clear();
    this.activePeerCache.clear();
    this.isAdvertising = false;
    this.lastWifiApCount = 0;
    this.lastKnownWifiFingerprint = [];
    this.stopMotionSensing();

    // Stop ultrasonic subsystem
    this.ultrasonicSubscription?.remove();
    this.ultrasonicSubscription = undefined;
    this.latestUltrasonicObservation = undefined;
    this.latestUltrasonicObservedAt = undefined;
    this.emittedUltrasonicToken = undefined;
    this.currentUltrasonicState = "idle";
    this.currentUltrasonicToken = undefined;

    if (isUltrasonicAvailable()) {
      try {
        const ultrasonic = requireUltrasonicModule();
        await Promise.all([ultrasonic.stopBroadcasting(), ultrasonic.stopListening()]);
        AppLogger.log("ULTRASONIC", "Ultrasonic hardware stopped");
      } catch {
        // Ignore
      }
    }

    if (this.config) {
      this.leaveSession(this.config).catch(() => {});
    }

    try {
      const ble = requireBleModule();
      await Promise.all([ble.stopAdvertising(), ble.stopScanning()]);
      AppLogger.log("BLE", "BLE advertising and scanning stopped");
    } catch {
      // The app may be stopping before the native module is available.
    }
    this.emitStatus("idle");
  }

  private cleanExpiredPeers(now: number = Date.now()) {
    // Sliding 45s window for accurate real-time external peer counting
    for (const [key, item] of this.activePeerCache.entries()) {
      if (now - item.lastSeenAt > 45_000) {
        this.activePeerCache.delete(key);
      }
    }
  }

  private onPeer(peer: NativePeer) {
    if (!peer.rotatingId) return;

    // Self-packet rejection (Filter out BLE loopback from own phone)
    const myPrefix = this.config?.deviceId ? this.config.deviceId.slice(-8).toLowerCase() : "";
    const peerPrefix = peer.rotatingId.split("-")[0].toLowerCase();
    if (myPrefix && peerPrefix === myPrefix) return;
    if (this.rotatingId && peer.rotatingId === this.rotatingId) return;
    if (!peerPrefix) return;

    const now = Date.now();
    const isNew = !this.activePeerCache.has(peerPrefix);
    this.peers.set(peerPrefix, peer);
    this.activePeerCache.set(peerPrefix, { peer, lastSeenAt: now });
    this.cleanExpiredPeers(now);

    if (isNew) {
      AppLogger.log("BLE", `Heard Peer: ${peerPrefix} (RSSI: ${peer.rssi} dBm)`);
    }

    this.emitStatus();
  }

  private async rotateAndAdvertise(force = false) {
    if (!this.config) return;
    const nextToken = createRotatingId(this.config.deviceId);
    if (!force && nextToken === this.rotatingId && this.isAdvertising) {
      return;
    }
    this.rotatingId = nextToken;
    const ble = requireBleModule();
    try {
      await ble.stopAdvertising();
    } catch {
      // Ignore stop errors
    }
    try {
      await ble.startAdvertising(this.rotatingId);
      this.isAdvertising = true;
      AppLogger.log("BLE", `Broadcasting rotating token: ${this.rotatingId}`);
    } catch (err: any) {
      this.isAdvertising = false;
      AppLogger.log("WARN", `BLE advertise busy, retrying: ${err?.message || err}`, "warn");
    }
  }

  private startMotionSensing() {
    this.motionSamples = [];
    DeviceMotion.setUpdateInterval(MOTION_SAMPLE_INTERVAL_MS);
    this.motionSubscription = DeviceMotion.addListener((data) => this.onMotionSample(data));
  }

  private stopMotionSensing() {
    this.motionSubscription?.remove();
    this.motionSubscription = undefined;
    this.motionSamples = [];
  }

  private onMotionSample(data: DeviceMotionMeasurement) {
    // .acceleration is gravity-compensated (unlike .accelerationIncludingGravity),
    // so a phone lying still and upright both read near zero, not just upright.
    const accel = data.acceleration;
    if (!accel) return;
    const magnitude = Math.sqrt(accel.x * accel.x + accel.y * accel.y + accel.z * accel.z);
    this.motionSamples.push(magnitude);
  }

  /** Variance of accelerometer magnitude since the last flush. Drains the sample buffer. */
  private computeMotionVariance(): number | undefined {
    const samples = this.motionSamples;
    this.motionSamples = [];
    if (samples.length < 2) return undefined;
    const mean = samples.reduce((sum, v) => sum + v, 0) / samples.length;
    const variance = samples.reduce((sum, v) => sum + (v - mean) ** 2, 0) / samples.length;
    return variance;
  }

  private async flushAndRotate() {
    if (!this.config || !this.rotatingId) return;
    const targetUrl = this.config.apiUrl || DEFAULT_API_URL;
    
    // High-watermark fallback: If Android scan throttle returns < 3 APs, fallback to latest full scan
    const rawWifi = await getWifiFingerprint().catch(() => [] as WifiApObservation[]);
    if (rawWifi.length >= 3) {
      this.lastKnownWifiFingerprint = rawWifi;
    }
    const wifiFingerprint = rawWifi.length >= 3 ? rawWifi : this.lastKnownWifiFingerprint;
    this.lastWifiApCount = wifiFingerprint.length;

    // Log Wi-Fi scan update
    if (rawWifi.length >= 3) {
      const topAp = [...rawWifi].sort((a, b) => b.rssi - a.rssi)[0];
      AppLogger.log("WIFI", `Scanned ${rawWifi.length} APs (Strongest: ${topAp.ssid || topAp.bssid} ${topAp.rssi} dBm)`);
    } else if (this.lastKnownWifiFingerprint.length > 0) {
      AppLogger.log("WIFI", `Wi-Fi throttled by OS, using active buffer (${this.lastKnownWifiFingerprint.length} APs)`);
    }

    // Native BLE Scanner Keep-Alive Watchdog:
    if (this.peers.size === 0) {
      try {
        const ble = requireBleModule();
        await ble.startScanning();
        AppLogger.log("BLE", "Watchdog: Pulsed BLE scanner to prevent Android power sleep");
      } catch {
        // Ignore keep-alive errors
      }
    }

    const motionVariance = this.computeMotionVariance();
    if (motionVariance !== undefined) {
      AppLogger.log("MOTION", `Variance: ${motionVariance.toFixed(4)} (${motionVariance < 0.02 ? "still" : "moving"})`);
    }

    // Expire a stale ultrasonic observation locally instead of resending it forever -
    // otherwise the server's freshness window never lapses once a presenter stops
    // broadcasting, since every batch would keep "renewing" the last-heard token.
    if (
      this.latestUltrasonicObservedAt !== undefined &&
      Date.now() - this.latestUltrasonicObservedAt > ULTRASONIC_OBSERVATION_TTL_MS
    ) {
      this.latestUltrasonicObservation = undefined;
      this.latestUltrasonicObservedAt = undefined;
      if (this.currentUltrasonicState === "verified") {
        this.currentUltrasonicState = "listening";
        this.currentUltrasonicToken = undefined;
        AppLogger.log("ULTRASONIC", "No fresh acoustic token heard recently -> Hard Gate expired");
        this.emitStatus();
      }
    }

    const body = {
      ...this.config,
      rotatingId: this.rotatingId,
      capturedAt: new Date().toISOString(),
      motionVariance,
      ultrasonicObservation: this.latestUltrasonicObservation,
      ultrasonicEmittedToken: this.emittedUltrasonicToken,
      peers: [...this.peers.values()],
      wifiFingerprint: wifiFingerprint.length > 0 ? wifiFingerprint : undefined
    };
    this.peers.clear();
    this.cleanExpiredPeers();

    const tStart = Date.now();
    try {
      const res = await fetch(`${targetUrl}/api/observations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const latency = Date.now() - tStart;
      if (res.ok) {
        AppLogger.log("API", `Synced batch to cloud -> 200 OK (${latency}ms)`);
      } else if (res.status === 409) {
        await this.handleRoomRejected(res);
      } else {
        AppLogger.log("WARN", `Sync returned status ${res.status} (${latency}ms)`, "warn");
      }
    } catch (err: any) {
      AppLogger.log("ERROR", `Sync failed: ${err?.message || "Network Error"}`, "error");
    }

    // Only restart hardware transmitter if 60s token epoch has actually changed
    await this.rotateAndAdvertise(false);

    this.emitStatus();
  }

  private async joinSession(config: StartConfig) {
    const targetUrl = config.apiUrl || DEFAULT_API_URL;
    try {
      const res = await fetch(`${targetUrl}/api/session/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config)
      });
      if (res.ok) {
        AppLogger.log("API", `Session joined: ${config.sessionId} as ${config.role}`);
      } else if (res.status === 409) {
        await this.handleRoomRejected(res);
      }
    } catch (err: any) {
      AppLogger.log("WARN", `Session join pending server wake: ${err?.message || "Offline"}`, "warn");
    }
  }

  private async leaveSession(config: StartConfig) {
    const targetUrl = config.apiUrl || DEFAULT_API_URL;
    try {
      await fetch(`${targetUrl}/api/session/leave`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: config.deviceId })
      });
      AppLogger.log("API", "Session left");
    } catch {
      // Ignore
    }
  }
}
