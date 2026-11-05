import { createHash } from "node:crypto";
import sharp from "sharp";
import { SYNC_LIMITS } from "../../../shared/contracts/sync";
import { SyncError } from "./errors";
export async function validatePhoto(
  bytes: Buffer,
  expectedDigest: string,
  expectedBytes: number,
) {
  const invalid = (reason: string): never => {
    throw new SyncError("photo_invalid", 422, reason);
  };
  if (
    !bytes.length ||
    bytes.length > SYNC_LIMITS.maxBytes ||
    bytes.length !== expectedBytes
  )
    invalid("size_exceeded");
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expectedDigest) invalid("digest_mismatch");
  try {
    const image = sharp(bytes, {
      limitInputPixels: SYNC_LIMITS.maxPixels,
      failOn: "warning",
      sequentialRead: true,
    });
    const meta = await image.metadata();
    if (meta.format !== "jpeg") invalid("type_invalid");
    if (
      !meta.width ||
      !meta.height ||
      meta.width > SYNC_LIMITS.maxDimension ||
      meta.height > SYNC_LIMITS.maxDimension ||
      meta.width * meta.height > SYNC_LIMITS.maxPixels
    )
      invalid("size_exceeded");
    // metadata alone does not decode the entropy-coded image. Force full bounded decode.
    await image.raw().toBuffer();
    return {
      digest,
      width: meta.width!,
      height: meta.height!,
      bytes: bytes.length,
    };
  } catch (error) {
    if (error instanceof SyncError) throw error;
    invalid("decode_failed");
  }
}
