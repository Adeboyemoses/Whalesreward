import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { storageConfig, type StorageConfig } from "./storage";
import { cardStorageDeadline } from "./card-storage-deadline";
export interface CardArtifactStorage {
  write(
    key: string,
    bytes: Uint8Array,
    contentType: string,
    signal?: AbortSignal,
  ): Promise<void>;
  read(
    key: string,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array>;
}
export function createReportArtifactStorage(
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
    if (!/^final\/report-exports\/[a-f0-9-]+$/.test(key))
      throw new Error("Invalid artifact key");
  };
  return {
    async write(key, bytes, contentType, signal) {
      check(key);
      await cardStorageDeadline(async (deadline) =>
        client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: bytes,
            ContentType: contentType,
          }),
          {
            abortSignal: signal
              ? AbortSignal.any([signal, deadline])
              : deadline,
          },
        ),
      );
    },
    async read(key, maxBytes, signal) {
      check(key);
      return cardStorageDeadline(async (deadline) => {
        const abortSignal = signal
          ? AbortSignal.any([signal, deadline])
          : deadline;
        const r = await client.send(
          new GetObjectCommand({ Bucket: config.bucket, Key: key }),
          { abortSignal },
        );
        const stream = r.Body as
          (AsyncIterable<Uint8Array> & { destroy?: () => void }) | undefined;
        if (!stream) throw new Error("Missing artifact");
        const destroy = () => stream.destroy?.();
        abortSignal.addEventListener("abort", destroy, { once: true });
        try {
          abortSignal.throwIfAborted();
          if (r.ContentLength !== undefined && r.ContentLength > maxBytes)
            throw new Error("Artifact too large");
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of stream) {
            abortSignal.throwIfAborted();
            size += chunk.length;
            if (size > maxBytes) throw new Error("Artifact too large");
            chunks.push(Buffer.from(chunk));
          }
          return Buffer.concat(chunks);
        } finally {
          abortSignal.removeEventListener("abort", destroy);
          destroy();
        }
      });
    },
  };
}
