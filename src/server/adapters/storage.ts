import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { SYNC_LIMITS } from "../../shared/contracts/sync";
export interface EvidenceStorage {
  signPut(
    key: string,
    expiresAt: Date,
  ): Promise<{ url: string; headers: Record<string, string> }>;
  read(key: string, maxBytes: number): Promise<Buffer>;
  writeFinal(key: string, bytes: Buffer): Promise<void>;
}
export class StorageSizeError extends Error {}
export type StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
};
export function storageConfig(): StorageConfig {
  const {
    STORAGE_ENDPOINT: endpoint,
    STORAGE_REGION: region,
    STORAGE_BUCKET: bucket,
    STORAGE_ACCESS_KEY_ID: accessKeyId,
    STORAGE_SECRET_ACCESS_KEY: secretAccessKey,
  } = process.env;
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey)
    throw new Error("Storage configuration unavailable");
  return { endpoint, region, bucket, accessKeyId, secretAccessKey };
}
export function createStorage(config: StorageConfig): EvidenceStorage {
  const url = new URL(config.endpoint);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !(url.protocol === "https:" || (local && url.protocol === "http:"))
  )
    throw new Error("Storage endpoint invalid");
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle ?? local,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return {
    async signPut(key, expiresAt) {
      if (!key.startsWith("staging/"))
        throw new Error("Only staging writes may be signed");
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ContentType: "image/jpeg",
      });
      const signed = await getSignedUrl(client, command, {
        expiresIn: SYNC_LIMITS.uploadSeconds,
        signingDate: new Date(
          expiresAt.getTime() - SYNC_LIMITS.uploadSeconds * 1000,
        ),
        signableHeaders: new Set(["content-type"]),
      });
      return { url: signed, headers: { "Content-Type": "image/jpeg" } };
    },
    async read(key, maxBytes) {
      const result = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(30000) },
      );
      const body = result.Body;
      if (!body) throw new Error("Storage body absent");
      const stream = body as AsyncIterable<Uint8Array> & {
        destroy?: () => void;
      };
      if (
        result.ContentLength !== undefined &&
        result.ContentLength > maxBytes
      ) {
        stream.destroy?.();
        throw new StorageSizeError();
      }
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        for await (const chunk of stream) {
          size += chunk.length;
          if (size > maxBytes) throw new StorageSizeError();
          chunks.push(Buffer.from(chunk));
        }
      } finally {
        stream.destroy?.();
      }
      return Buffer.concat(chunks);
    },
    async writeFinal(key, bytes) {
      if (!key.startsWith("final/"))
        throw new Error("Invalid final object path");
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: bytes,
          ContentType: "image/jpeg",
        }),
        { abortSignal: AbortSignal.timeout(30000) },
      );
    },
  };
}
