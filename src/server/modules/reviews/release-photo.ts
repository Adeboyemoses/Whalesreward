import sharp from "sharp";
import { randomUUID } from "node:crypto";
import type { EvidenceStorage } from "../../adapters/storage";
import { StorageNotFoundError, StorageSizeError } from "../../adapters/storage";
import { SYNC_LIMITS } from "../../../shared/contracts/sync";
import { validatePhoto } from "../sync/photo";
import { SyncError } from "../sync/errors";
import { AuthError } from "../auth/errors";

/** Only call with a server-loaded authorized reservation, never request-supplied keys.
 * The caller reauthorizes and CASes the reservation after this slow work.
 * Losing CAS leaves private orphans; it never replaces accepted source bytes.
 */
export async function prepareReleaseSheet(
  storage: EvidenceStorage,
  reservation: { stagingKey: string; digest: string; bytes: number },
  environment: "development" | "test" | "staging" | "production",
) {
  let source: Buffer;
  try {
    source = await storage.read(reservation.stagingKey, SYNC_LIMITS.maxBytes);
  } catch (error) {
    if (error instanceof StorageNotFoundError)
      throw new AuthError("evidence_pending", 409);
    if (error instanceof StorageSizeError)
      throw new AuthError("photo_invalid", 422);
    throw new AuthError("storage_unavailable", 503);
  }
  try {
    await validatePhoto(source, reservation.digest, reservation.bytes);
  } catch (error) {
    if (error instanceof SyncError) throw new AuthError("photo_invalid", 422);
    throw error;
  }
  let display: Buffer;
  try {
    // sharp strips metadata by default; never use withMetadata/keepMetadata here.
    display = await sharp(source, {
      limitInputPixels: SYNC_LIMITS.maxPixels,
      failOn: "warning",
    })
      .rotate()
      .jpeg()
      .toBuffer();
  } catch {
    throw new AuthError("photo_invalid", 422);
  }
  const finalKey = `final/${environment}/held_release_sheet/${randomUUID()}`;
  const displayKey = `final/${environment}/held_release_sheet/${randomUUID()}`;
  try {
    await storage.writeFinal(finalKey, source);
    await storage.writeFinal(displayKey, display);
  } catch {
    throw new AuthError("storage_unavailable", 503);
  }
  return { finalKey, displayKey };
}
