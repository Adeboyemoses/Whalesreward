import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createStorage, storageConfig, type StorageConfig } from "./storage";
export const SALE_PHOTO_TTL_SECONDS = 60;
export interface SaleEvidenceReader {
  read(key: string, maxBytes: number): Promise<Buffer>;
  available(key: string, bytes: bigint): Promise<boolean>;
  signGet(key: string, expiresAt: Date): Promise<string>;
}
export class EvidenceObjectMissing extends Error {}
/** Read-only application capability. No PUT, delete or final write is exposed. */
export function createSaleEvidenceReader(
  config: StorageConfig = storageConfig(),
): SaleEvidenceReader {
  const reader = createStorage(config); // Shares the existing endpoint validation.
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle:
      config.forcePathStyle ??
      ["localhost", "127.0.0.1", "::1"].includes(
        new URL(config.endpoint).hostname,
      ),
  });
  const keyCheck = (key: string) => {
    if (!key.startsWith("final/")) throw new Error("Invalid evidence path");
  };
  return {
    async read(key, maxBytes) {
      keyCheck(key);
      try {
        return await reader.read(key, maxBytes);
      } catch (e) {
        if (missing(e)) throw new EvidenceObjectMissing();
        throw e;
      }
    },
    async available(key, bytes) {
      keyCheck(key);
      try {
        const head = await client.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
          { abortSignal: AbortSignal.timeout(30000) },
        );
        return (
          head.ContentLength !== undefined &&
          BigInt(head.ContentLength) === bytes
        );
      } catch (e) {
        if (missing(e)) return false;
        throw e;
      }
    },
    async signGet(key, expiresAt) {
      keyCheck(key);
      const remaining = Math.ceil((expiresAt.getTime() - Date.now()) / 1000);
      if (remaining < 1 || remaining > 300)
        throw new Error("Invalid evidence expiry");
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: key,
          ResponseContentType: "image/jpeg",
          ResponseCacheControl: "no-store",
        }),
        { expiresIn: remaining },
      );
    },
  };
}
function missing(e: unknown) {
  return e instanceof Error && ["NoSuchKey", "NotFound"].includes(e.name);
}
