import {
  MOTION_MIN_WINDOWS_FOR_FLAG,
  MOTION_STILL_FRACTION_THRESHOLD,
  type DeviceRecord,
} from "./types.js";

/**
 * True once a device has spent an anomalously still fraction of a long-enough
 * session. A single still window is normal (someone sitting attentively); a
 * device that is still for nearly its whole session looks more like a phone
 * left on a desk. This is a flag for human review, never an automatic rejection.
 */
export function computeMotionAnomalyFlag(rec?: DeviceRecord): boolean {
  const history = rec?.motionWindowHistory;
  if (!history || history.length < MOTION_MIN_WINDOWS_FOR_FLAG) return false;
  const fractionStill = history.filter(Boolean).length / history.length;
  return fractionStill >= MOTION_STILL_FRACTION_THRESHOLD;
}
