import type { WifiApObservation } from "@confpresence/shared";

/**
 * Computes the calibrated indoor similarity (0.0 to 1.0) between two Wi-Fi AP fingerprints.
 * Uses Multi-BSSID base MAC grouping (2.4G vs 5G matching) + signal proximity delta.
 */
export function computeWifiCosineSimilarity(fpA: WifiApObservation[], fpB: WifiApObservation[]): number | undefined {
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
