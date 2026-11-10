import { CaptureDatabase } from "../offline/db";
import { needsUpload } from "../offline/sync-status";
/** Internal boolean only: never expose another account's queue or count. */
export async function hasPendingSales(db: CaptureDatabase): Promise<boolean> {
  return (await db.outbox.toArray()).some(needsUpload);
}
let capturing = false;
let frozen = false;
export function markCaptureStarted() {
  capturing = true;
}
export function markCaptureEnded() {
  capturing = false;
}
export function isCaptureActive() {
  return capturing;
}
export function isUpdateFrozen() {
  return frozen;
}
export function setUpdateFrozen(value: boolean) {
  frozen = value;
}
