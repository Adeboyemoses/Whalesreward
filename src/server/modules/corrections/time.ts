import { nextStationMidnight, stationDate } from "../../lib/time";
export const CORRECTION_TIME_POLICY = "p20-bounded-day-v1";
/** Neither a phone claim nor a later administrative date supplies a new window. */
export function reliableCutoff(
  signedIn: Date,
  receipt: Date,
  expires: Date,
): Date | null {
  const s = signedIn.getTime(),
    r = receipt.getTime(),
    e = expires.getTime(),
    u = Math.min(r, e);
  if (
    ![s, r, e].every(Number.isFinite) ||
    s > u ||
    e <= s ||
    stationDate(signedIn) !== stationDate(new Date(u))
  )
    return null;
  return nextStationMidnight(signedIn);
}
export function correctionTiming(
  cutoff: Date | null,
  receipt: Date,
): "before_midnight" | "late" | "unresolved" {
  return cutoff === null
    ? "unresolved"
    : receipt.getTime() < cutoff.getTime()
      ? "before_midnight"
      : "late";
}
