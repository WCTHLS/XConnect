import type { PresenceBatch } from "@confpresence/shared";
import type { DeviceRecord } from "./types.js";

/**
 * Constructs an undirected graph of co-located devices based on BLE peer observations.
 */
export function buildBleGraph(
  devices: Map<string, DeviceRecord>,
  batches: PresenceBatch[],
  minRssi: number
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  const tokenToDevice = new Map<string, string>();
  for (const device of devices.values()) {
    if (device.rotatingId) tokenToDevice.set(device.rotatingId, device.deviceId);
  }

  const resolveDeviceId = (token: string): string | undefined => {
    const direct = tokenToDevice.get(token);
    if (direct) return direct;
    const cleanToken = token.trim();
    const prefix = cleanToken.split("-")[0];
    if (prefix && prefix.length >= 4) {
      for (const device of devices.values()) {
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

  for (const batch of batches) {
    for (const peer of batch.peers) {
      if (peer.rssi < minRssi) continue;
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

/**
 * Returns all reachable member device IDs in a connected graph component via BFS.
 */
export function findConnectedComponent(start: string, graph: Map<string, Set<string>>): Set<string> {
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

/**
 * Calculates the shortest hop distance between two devices in the proximity graph via BFS.
 */
export function computeShortestHop(start: string, target: string, graph: Map<string, Set<string>>): number {
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
