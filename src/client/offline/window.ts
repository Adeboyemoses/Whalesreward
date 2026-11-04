import type { OfflineWindow } from "../types";
export type ClockSample = { wall: number; mono: number; runtimeId: string };
/** This runtime's elapsed-time observation; another tab's checkpoint cannot replace it. */
export type MonotonicBaseline = {
  captureContextId: string;
  runtimeId: string;
  mono: number;
  elapsedMs: number;
};
export function advanceWindow(
  row: OfflineWindow,
  now: ClockSample,
  baseline?: MonotonicBaseline,
): OfflineWindow {
  const wallDelta = now.wall - Date.parse(row.wallTimeAtCheckpoint);
  const sameContext =
    baseline?.captureContextId === row.captureContextId &&
    baseline.runtimeId === now.runtimeId;
  const monoDelta = sameContext ? now.mono - baseline.mono : 0;
  // Both candidates are elapsed time since the SAME sign-in anchor. Adding a
  // runtime delta to another tab's elapsed checkpoint would count that time twice.
  const elapsed = Math.max(
    row.elapsedAtCheckpointMs + Math.max(0, wallDelta),
    sameContext ? baseline.elapsedMs + Math.max(0, monoDelta) : 0,
  );
  const duration =
    Date.parse(row.offlineExpiresAt) - Date.parse(row.lastOnlineSignInAt);
  const uncertain =
    !Number.isFinite(elapsed) ||
    !Number.isFinite(now.mono) ||
    wallDelta < 0 ||
    monoDelta < 0 ||
    duration !== 86400000;
  return {
    ...row,
    elapsedAtCheckpointMs: elapsed,
    wallTimeAtCheckpoint: new Date(now.wall).toISOString(),
    runtimeId: now.runtimeId,
    locked: row.locked || row.logoutPending || uncertain || elapsed >= duration,
  };
}
/** Full request duration is a conservative upper bound on server-response transit age. */
export function requestDuration(
  start: ClockSample,
  end: ClockSample,
): number | null {
  const wall = end.wall - start.wall;
  const mono = end.mono - start.mono;
  if (
    start.runtimeId !== end.runtimeId ||
    !Number.isFinite(wall) ||
    !Number.isFinite(mono) ||
    wall < 0 ||
    mono < 0
  )
    return null;
  return Math.max(wall, mono);
}
