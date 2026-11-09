import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { storageConfig, type StorageConfig } from "./storage";
export interface CardArtifactStorage {
  write(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  read(key: string, maxBytes: number): Promise<Uint8Array>;
}
export function createCardArtifactStorage(
  config: StorageConfig = storageConfig(),
): CardArtifactStorage {
  const url = new URL(config.endpoint),
    local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
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
  const check = (key: string) => {
    if (!/^final\/card-exports\/[a-f0-9-]+$/.test(key))
      throw new Error("Invalid artifact key");
  };
  return {
    async write(key, bytes, contentType) {
      check(key);
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
        }),
        { abortSignal: AbortSignal.timeout(30000) },
      );
    },
    async read(key, maxBytes) {
      check(key);
      const r = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(30000) },
      );
      const stream = r.Body as
        (AsyncIterable<Uint8Array> & { destroy?: () => void }) | undefined;
      if (!stream) throw new Error("Missing artifact");
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        if (r.ContentLength !== undefined && r.ContentLength > maxBytes)
          throw new Error("Artifact too large");
        for await (const chunk of stream) {
          size += chunk.length;
          if (size > maxBytes) throw new Error("Artifact too large");
          chunks.push(Buffer.from(chunk));
        }
      } finally {
        stream.destroy?.();
      }
      return Buffer.concat(chunks);
    },
  };
}
