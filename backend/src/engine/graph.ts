import type { PresenceBatch } from "@confpresence/shared";
import type { DeviceRecord } from "./types.js";

/**
 * Constructs an undirected graph of co-located devices based on BLE peer observations.
 *
 * Takes batches grouped by the device that sent them, rather than one flat list, so that a
 * device leaving can drop its own entries in O(1) (deleting one Map key) instead of scanning
 * every batch in the system to find the handful that belong to it.
 */
export function buildBleGraph(
  devices: Map<string, DeviceRecord>,
  batchesByDevice: Map<string, PresenceBatch[]>,
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

  for (const deviceBatches of batchesByDevice.values()) {
    for (const batch of deviceBatches) {
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
 *
 * Reads the queue with an index instead of `Array.shift()` — shift() re-indexes every remaining
 * element on each call, making a single BFS O(n²) instead of O(n). That's cheap for one call, but
 * this runs once per member per presenter per tick, so at real device counts the O(n²) cost is
 * what turns a sub-second tick into a multi-second one.
 */
export function findConnectedComponent(start: string, graph: Map<string, Set<string>>): Set<string> {
  const visited = new Set<string>([start]);
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
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
 * Same read-index queue as findConnectedComponent, for the same reason.
 */
export function computeShortestHop(start: string, target: string, graph: Map<string, Set<string>>): number {
  if (start === target) return 0;
  const visited = new Set<string>([start]);
  const queue: [string, number][] = [[start, 0]];
  let head = 0;
  while (head < queue.length) {
    const [curr, dist] = queue[head++];
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

/**
 * Hop distance from `start` to every node reachable from it — a single BFS that answers what
 * would otherwise be a separate computeShortestHop() call per target. The room-affinity check
 * used to call computeShortestHop once per member per presenter (easily thousands of full-graph
 * traversals per tick at real room sizes); computing one of these per presenter per tick instead,
 * and having every member look itself up in the result, cuts that to one traversal per presenter.
 * The returned map's keys double as the presenter's connected component (findConnectedComponent's
 * job), so callers that need both get them from this one BFS instead of two.
 */
export function computeHopDistances(start: string, graph: Map<string, Set<string>>): Map<string, number> {
  const distances = new Map<string, number>([[start, 0]]);
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const dist = distances.get(current)!;
    for (const neighbor of graph.get(current) ?? []) {
      if (!distances.has(neighbor)) {
        distances.set(neighbor, dist + 1);
        queue.push(neighbor);
      }
    }
  }
  return distances;
}
