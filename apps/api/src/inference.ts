import type { LiveRoomState, PresenceBatch, RoomMemberInfo, WifiApObservation } from "@confpresence/shared";

const WINDOW_MS = 30_000; // 30 seconds sliding active window
const MIN_RSSI = -85;     // 20+ meters coverage in open line-of-sight halls

// Motion-anomaly thresholds. Not yet calibrated against real recorded sessions,
// tune these once real data exists rather than trusting these starting values.
const MOTION_STILL_VARIANCE_THRESHOLD = 0.02; // below this, a ~10s window counts as "still"
const MOTION_SLIDING_WINDOW_SIZE = Number(process.env.MOTION_SLIDING_WINDOW_SIZE) || 3;
const MOTION_MIN_WINDOWS_FOR_FLAG = Math.min(3, MOTION_SLIDING_WINDOW_SIZE); // batches needed before a flag is meaningful
const MOTION_STILL_FRACTION_THRESHOLD = 0.9;  // fraction of the sliding window that must be still to flag

type DeviceRecord = {
  deviceId: string;
  displayName?: string;
  role: "presenter" | "attendee";
  roomId?: string;
  rotatingId?: string;
  wifiFingerprint?: WifiApObservation[];
  uwbDiscoveryToken?: string;
  uwbTokenUpdatedAt?: number;
  wifiHistory?: Map<string, { ap: WifiApObservation; lastSeen: number }>;
  /** Most recent motion windows (true = still), newest last, capped at MOTION_SLIDING_WINDOW_SIZE. */
  motionWindowHistory?: boolean[];
  updatedAt: number;
};

export class PocInferenceEngine {
  private readonly devices = new Map<string, DeviceRecord>();
  private readonly batches: PresenceBatch[] = [];

  join(deviceId: string, role: "presenter" | "attendee", roomId?: string, displayName?: string) {
    const current = this.devices.get(deviceId);
    this.devices.set(deviceId, {
      deviceId,
      displayName: displayName || current?.displayName || undefined,
      role,
      roomId,
      wifiFingerprint: current?.wifiFingerprint,
      uwbDiscoveryToken: current?.uwbDiscoveryToken,
      uwbTokenUpdatedAt: current?.uwbTokenUpdatedAt,
      wifiHistory: current?.wifiHistory ?? new Map(),
      motionWindowHistory: current?.motionWindowHistory,
      updatedAt: Date.now()
    });
  }

  leave(deviceId: string) {
    this.devices.delete(deviceId);
    for (let i = this.batches.length - 1; i >= 0; i--) {
      if (this.batches[i].deviceId === deviceId) {
        this.batches.splice(i, 1);
      }
    }
  }

  setUwbToken(deviceId: string, discoveryTokenBase64: string) {
    const current = this.devices.get(deviceId);
    this.devices.set(deviceId, {
      deviceId,
      displayName: current?.displayName,
      role: current?.role ?? "attendee",
      roomId: current?.roomId,
      rotatingId: current?.rotatingId,
      wifiFingerprint: current?.wifiFingerprint,
      uwbDiscoveryToken: discoveryTokenBase64,
      uwbTokenUpdatedAt: Date.now(),
      wifiHistory: current?.wifiHistory ?? new Map(),
      motionWindowHistory: current?.motionWindowHistory,
      updatedAt: Date.now()
    });
  }

  ingest(batch: PresenceBatch) {
    const current = this.devices.get(batch.deviceId);
    const wifiHistory = current?.wifiHistory ?? new Map<string, { ap: WifiApObservation; lastSeen: number }>();
    const now = Date.now();

    // Track this device's most recent motion windows (still vs. moving), for the anomaly
    // flag in roomState(). Only the last MOTION_SLIDING_WINDOW_SIZE batches are kept.
    let motionWindowHistory = current?.motionWindowHistory ?? [];
    if (batch.motionVariance !== undefined) {
      motionWindowHistory = [...motionWindowHistory, batch.motionVariance < MOTION_STILL_VARIANCE_THRESHOLD];
      if (motionWindowHistory.length > MOTION_SLIDING_WINDOW_SIZE) {
        motionWindowHistory = motionWindowHistory.slice(-MOTION_SLIDING_WINDOW_SIZE);
      }
    }

    // 1. Ingest fresh Wi-Fi APs into 30s rolling fingerprint history
    if (batch.wifiFingerprint && batch.wifiFingerprint.length > 0) {
      for (const ap of batch.wifiFingerprint) {
        const bssid = ap.bssid.toLowerCase().trim();
        wifiHistory.set(bssid, { ap, lastSeen: now });
      }
    }

    // 2. Clean stale AP entries older than 35s
    for (const [bssid, entry] of wifiHistory.entries()) {
      if (now - entry.lastSeen > 35_000) {
        wifiHistory.delete(bssid);
      }
    }

    // 3. Compile consolidated active Wi-Fi fingerprint
    const consolidatedWifi: WifiApObservation[] = [...wifiHistory.values()].map(e => e.ap);

    this.devices.set(batch.deviceId, {
      deviceId: batch.deviceId,
      displayName: batch.displayName || current?.displayName,
      role: batch.role,
      roomId: batch.roomId ?? current?.roomId,
      rotatingId: batch.rotatingId,
      wifiFingerprint: consolidatedWifi.length > 0 ? consolidatedWifi : current?.wifiFingerprint,
      uwbDiscoveryToken: current?.uwbDiscoveryToken,
      uwbTokenUpdatedAt: current?.uwbTokenUpdatedAt,
      wifiHistory,
      motionWindowHistory,
      updatedAt: now
    });
    this.batches.push(batch);
    this.trim();
  }

  roomState(sessionId: string, roomId: string): LiveRoomState {
    this.trim();
    const now = Date.now();
    const graph = this.buildGraph();

    // 1. Find all active presenters in this specific room
    const presentersInRoom = [...this.devices.values()]
      .filter((d) => d.role === "presenter" && d.roomId === roomId && now - d.updatedAt < WINDOW_MS * 2);

    if (!presentersInRoom.length) {
      return {
        sessionId,
        roomId,
        estimatedMemberDeviceIds: [],
        members: [],
        updatedAt: new Date().toISOString()
      };
    }

    // 2. Host Sticky Locking & Density Resolution:
    // Prioritize the Host who has active in-room peer sightings (protecting from remote 0-peer takeovers)
    const presenter = presentersInRoom.sort((a, b) => {
      const peersA = (graph.get(a.deviceId) ?? new Set()).size;
      const peersB = (graph.get(b.deviceId) ?? new Set()).size;
      if (peersA !== peersB) return peersB - peersA;
      return b.updatedAt - a.updatedAt;
    })[0];

    // 3. Get all connected members in this presenter's physical graph cluster
    const clusterMembers = this.componentFrom(presenter.deviceId, graph);

    // 4. Find all other active presenters across other rooms for dynamic multi-room separation
    const otherPresenters = [...this.devices.values()]
      .filter((d) => d.role === "presenter" && d.deviceId !== presenter.deviceId && d.roomId && now - d.updatedAt < WINDOW_MS * 2);

    // 5. Build members list with Strongest-Link & Wi-Fi Affinity Room Assignment
    const membersInfo: RoomMemberInfo[] = [];
    const estimatedMemberDeviceIds: string[] = [];

    for (const memberId of clusterMembers) {
      const rec = this.devices.get(memberId);
      const isPresenter = memberId === presenter.deviceId;

      const uwbDiscoveryToken =
        rec?.uwbDiscoveryToken && rec.uwbTokenUpdatedAt !== undefined && now - rec.uwbTokenUpdatedAt < WINDOW_MS
          ? rec.uwbDiscoveryToken
          : undefined;
      const motionAnomalyFlag = this.computeMotionAnomalyFlag(rec);

      if (isPresenter) {
        estimatedMemberDeviceIds.push(memberId);
        membersInfo.push({
          deviceId: memberId,
          displayName: rec?.displayName || memberId,
          role: "presenter",
          confidence: 1.0,
          wifiSimilarity: undefined,
          uwbDiscoveryToken,
          motionAnomalyFlag
        });
        continue;
      }

      // Check Multi-Room Affinity: Is this attendee physically closer to another presenter?
      let assignedToThisRoom = true;
      if (otherPresenters.length > 0) {
        const thisHop = this.shortestPathDistance(memberId, presenter.deviceId, graph);
        const thisWifi = (presenter.wifiFingerprint && rec?.wifiFingerprint)
          ? (this.computeWifiCosineSimilarity(rec.wifiFingerprint, presenter.wifiFingerprint) ?? 0.5)
          : 0.5;
        const thisAffinity = (1 / Math.max(1, thisHop)) * 0.5 + thisWifi * 0.5;

        for (const other of otherPresenters) {
          const otherHop = this.shortestPathDistance(memberId, other.deviceId, graph);
          const otherWifi = (other.wifiFingerprint && rec?.wifiFingerprint)
            ? (this.computeWifiCosineSimilarity(rec.wifiFingerprint, other.wifiFingerprint) ?? 0.5)
            : 0.5;
          const otherAffinity = (1 / Math.max(1, otherHop)) * 0.5 + otherWifi * 0.5;

          if (otherAffinity > thisAffinity + 0.15) {
            assignedToThisRoom = false; // Attendee has walked into another room!
            break;
          }
        }
      }

      if (!assignedToThisRoom) continue;

      let wifiSimilarity: number | undefined;
      let confidence = 0.85;

      if (presenter.wifiFingerprint?.length && rec?.wifiFingerprint?.length) {
        const sim = this.computeWifiCosineSimilarity(rec.wifiFingerprint, presenter.wifiFingerprint);
        if (sim !== undefined) {
          wifiSimilarity = Number(sim.toFixed(2));
          if (sim >= 0.70) {
            confidence = Number(Math.min(0.98, 0.85 + (sim - 0.70) * 0.43).toFixed(2));
          } else {
            confidence = Number(Math.max(0.70, 0.85 - (0.70 - sim) * 0.30).toFixed(2));
          }
        }
      }

      estimatedMemberDeviceIds.push(memberId);
      membersInfo.push({
        deviceId: memberId,
        displayName: rec?.displayName || memberId,
        role: rec?.role || "attendee",
        confidence,
        wifiSimilarity,
        uwbDiscoveryToken,
        motionAnomalyFlag
      });
    }

    return {
      sessionId,
      roomId,
      presenterDeviceId: presenter.deviceId,
      presenterName: presenter.displayName || presenter.deviceId,
      estimatedMemberDeviceIds,
      members: membersInfo,
      updatedAt: new Date().toISOString()
    };
  }

  deviceRoomState(sessionId: string, deviceId: string): LiveRoomState {
    this.trim();
    const graph = this.buildGraph();
    const now = Date.now();

    const currentDevice = this.devices.get(deviceId);
    if (currentDevice?.role === "presenter" && currentDevice.roomId) {
      return this.roomState(sessionId, currentDevice.roomId);
    }

    // For Attendees: Find which active presenter's room cluster has highest affinity
    const activePresenters = [...this.devices.values()]
      .filter((d) => d.role === "presenter" && d.roomId && now - d.updatedAt < WINDOW_MS * 2);

    let bestRoomId: string | undefined;
    let highestAffinity = -1;

    for (const presenter of activePresenters) {
      const cluster = this.componentFrom(presenter.deviceId, graph);
      if (cluster.has(deviceId)) {
        const hop = this.shortestPathDistance(deviceId, presenter.deviceId, graph);
        const wifi = (presenter.wifiFingerprint && currentDevice?.wifiFingerprint)
          ? (this.computeWifiCosineSimilarity(currentDevice.wifiFingerprint, presenter.wifiFingerprint) ?? 0.5)
          : 0.5;
        const affinity = (1 / Math.max(1, hop)) * 0.5 + wifi * 0.5;

        if (affinity > highestAffinity) {
          highestAffinity = affinity;
          bestRoomId = presenter.roomId;
        }
      }
    }

    if (bestRoomId) {
      return this.roomState(sessionId, bestRoomId);
    }

    return {
      sessionId,
      roomId: "unknown",
      estimatedMemberDeviceIds: [],
      members: [],
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * Computes the calibrated indoor similarity (0.0 to 1.0) between two Wi-Fi AP fingerprints.
   * Uses Multi-BSSID base MAC grouping (2.4G vs 5G matching) + signal proximity delta.
   */
  computeWifiCosineSimilarity(fpA: WifiApObservation[], fpB: WifiApObservation[]): number | undefined {
    if (!fpA.length || !fpB.length) return undefined;

    // Filter out faint noise APs below -85 dBm and take the top 15 strongest APs
    const validA = fpA.filter((ap) => ap.rssi >= -85).sort((a, b) => b.rssi - a.rssi).slice(0, 15);
    const validB = fpB.filter((ap) => ap.rssi >= -85).sort((a, b) => b.rssi - a.rssi).slice(0, 15);

    if (!validA.length || !validB.length) return undefined;

    // Base MAC extraction for Multi-BSSID virtual router grouping (e.g. AA:BB:CC:DD:EE:* matches 2.4G & 5G)
    const toBaseMac = (bssid: string): string => {
      const norm = bssid.toLowerCase().trim();
      const parts = norm.split(":");
      return parts.length >= 5 ? parts.slice(0, 5).join(":") : norm;
    };

    const mapA = new Map<string, number>();
    for (const ap of validA) {
      const baseKey = toBaseMac(ap.bssid);
      mapA.set(baseKey, Math.max(mapA.get(baseKey) ?? -100, ap.rssi));
    }

    const mapB = new Map<string, number>();
    for (const ap of validB) {
      const baseKey = toBaseMac(ap.bssid);
      mapB.set(baseKey, Math.max(mapB.get(baseKey) ?? -100, ap.rssi));
    }

    let sharedCount = 0;
    let totalSignalSim = 0;

    for (const [baseKey, rssiA] of mapA) {
      const rssiB = mapB.get(baseKey);
      if (rssiB !== undefined) {
        sharedCount++;
        // Delta tolerance across 2m - 10m room distance: 0 dBm diff -> 1.0, 15 dBm diff -> 0.67
        const delta = Math.abs(rssiA - rssiB);
        const signalSim = Math.max(0, 1 - delta / 45);
        totalSignalSim += signalSim;
      }
    }

    if (sharedCount === 0) return 0;

    const overlapRatio = (sharedCount * 2) / (mapA.size + mapB.size);
    const avgSignalSim = totalSignalSim / sharedCount;
    const rawMatch = 0.35 * overlapRatio + 0.65 * avgSignalSim;

    // Calibrated in-room bounds: In-room shared APs (>= 3) cleanly output 82% to 96%
    if (sharedCount >= 2 && overlapRatio >= 0.3) {
      return Number(Math.min(0.96, Math.max(0.78, 0.72 + rawMatch * 0.25)).toFixed(2));
    }

    return Number(Math.min(0.65, rawMatch * 0.75).toFixed(2));
  }

  listRooms(sessionId: string): string[] {
    this.trim();
    const rooms = new Set<string>(["room-a", "room-b", "auditorium"]);
    for (const d of this.devices.values()) {
      if (d.roomId) rooms.add(d.roomId);
    }
    return [...rooms];
  }

  /**
   * True once a device has spent an anomalously still fraction of a long-enough
   * session. A single still window is normal (someone sitting attentively); a
   * device that is still for nearly its whole session looks more like a phone
   * left on a desk. This is a flag for human review, never an automatic rejection.
   */
  private computeMotionAnomalyFlag(rec?: DeviceRecord): boolean {
    const history = rec?.motionWindowHistory;
    if (!history || history.length < MOTION_MIN_WINDOWS_FOR_FLAG) return false;
    const fractionStill = history.filter(Boolean).length / history.length;
    return fractionStill >= MOTION_STILL_FRACTION_THRESHOLD;
  }

  private shortestPathDistance(start: string, target: string, graph: Map<string, Set<string>>): number {
    if (start === target) return 0;
    const visited = new Set<string>([start]);
    const queue: [string, number][] = [[start, 0]];
    while (queue.length) {
      const [curr, dist] = queue.shift()!;
      for (const neighbor of graph.get(curr) ?? []) {
        if (neighbor === target) return dist + 1;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push([neighbor, dist + 1]);
        }
      }
    }
    return 99; // Not connected
  }

  private buildGraph(): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();
    const tokenToDevice = new Map<string, string>();
    for (const device of this.devices.values()) {
      if (device.rotatingId) tokenToDevice.set(device.rotatingId, device.deviceId);
    }

    const resolveDeviceId = (token: string): string | undefined => {
      const direct = tokenToDevice.get(token);
      if (direct) return direct;
      const cleanToken = token.trim();
      const prefix = cleanToken.split("-")[0];
      if (prefix && prefix.length >= 4) {
        for (const device of this.devices.values()) {
          const deviceClean = device.deviceId.toLowerCase();
          const prefixClean = prefix.toLowerCase();
          if (deviceClean.endsWith(prefixClean) || deviceClean.includes(prefixClean)) {
            return device.deviceId;
          }
        }
      }
      return undefined;
    };

    const sightings = new Map<string, { count: number; maxRssi: number }>();

    for (const batch of this.batches) {
      for (const peer of batch.peers) {
        if (peer.rssi < MIN_RSSI) continue;
        const peerDeviceId = resolveDeviceId(peer.rotatingId);
        if (!peerDeviceId || peerDeviceId === batch.deviceId) continue;

        const key = [batch.deviceId, peerDeviceId].sort().join("|");
        const current = sightings.get(key) ?? { count: 0, maxRssi: -999 };
        current.count += 1;
        current.maxRssi = Math.max(current.maxRssi, peer.rssi);
        sightings.set(key, current);
      }
    }

    for (const [key, data] of sightings) {
      const [left, right] = key.split("|");
      if (data.count >= 1) {
        if (!graph.has(left)) graph.set(left, new Set());
        if (!graph.has(right)) graph.set(right, new Set());
        graph.get(left)?.add(right);
        graph.get(right)?.add(left);
      }
    }
    return graph;
  }

  private componentFrom(start: string, graph: Map<string, Set<string>>): Set<string> {
    const visited = new Set<string>([start]);
    const queue = [start];
    while (queue.length) {
      const current = queue.shift() as string;
      for (const neighbor of graph.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    return visited;
  }

  private trim() {
    const cutoff = Date.now() - WINDOW_MS;
    while (this.batches.length && new Date(this.batches[0].capturedAt).getTime() < cutoff) {
      this.batches.shift();
    }
    const staleDeviceCutoff = Date.now() - WINDOW_MS * 3;
    for (const [id, record] of this.devices.entries()) {
      if (record.updatedAt < staleDeviceCutoff) {
        this.devices.delete(id);
      }
    }
  }
}
