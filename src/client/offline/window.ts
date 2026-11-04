import type { OfflineWindow } from "../types";
export type ClockSample = { wall: number; mono: number; runtimeId: string };
export function advanceWindow(
  row: OfflineWindow,
  now: ClockSample,
  previousMono: number,
): OfflineWindow {
  const wallDelta = now.wall - Date.parse(row.wallTimeAtCheckpoint);
  const monoDelta =
    row.runtimeId === now.runtimeId ? now.mono - previousMono : 0;
  const elapsed = row.elapsedAtCheckpointMs + Math.max(0, wallDelta, monoDelta);
  const duration =
    Date.parse(row.offlineExpiresAt) - Date.parse(row.lastOnlineSignInAt);
  const uncertain =
    !Number.isFinite(elapsed) ||
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
