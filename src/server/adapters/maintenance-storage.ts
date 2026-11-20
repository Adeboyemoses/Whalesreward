import { createHash } from "node:crypto";
import {
  S3Client,
  ListObjectVersionsCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import type { StorageConfig } from "./storage.ts";
import type { VersionCursor } from "../modules/maintenance/types.ts";

export type InventoryObject = {
  key: string;
  versionId: string | null;
  lastModified: Date;
  size: number;
  deleteMarker: boolean;
};
/** Deliberately no PUT, DELETE, multipart or lifecycle capabilities. Credentials must also deny them. */
export interface MaintenanceStorage {
  readonly identity?: string;
  listVersions(
    prefix: string,
    cursor: VersionCursor | null,
    limit: number,
    signal: AbortSignal,
  ): Promise<{ objects: InventoryObject[]; cursor: VersionCursor | null }>;
  observe(
    key: string,
    versionId: string | null,
    maximumBytes: number,
    signal: AbortSignal,
  ): Promise<{ digest: string; size: number } | null>;
}
export class MaintenanceStorageError extends Error {
  constructor() {
    super("storage_unavailable");
  }
}
export function createMaintenanceStorage(
  config: StorageConfig & { sessionToken?: string },
): MaintenanceStorage {
  const url = new URL(config.endpoint);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !(url.protocol === "https:" || (local && url.protocol === "http:"))
  )
    throw new MaintenanceStorageError();
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      sessionToken: config.sessionToken,
    },
    forcePathStyle: config.forcePathStyle ?? local,
    maxAttempts: 3,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return {
    identity: createHash("sha256")
      .update(JSON.stringify([url.origin, config.region, config.bucket]))
      .digest("hex"),
    async listVersions(prefix, cursor, limit, signal) {
      try {
        const result = await client.send(
          new ListObjectVersionsCommand({
            Bucket: config.bucket,
            Prefix: prefix,
            MaxKeys: limit,
            KeyMarker: cursor?.keyMarker,
            VersionIdMarker: cursor?.versionIdMarker,
          }),
          { abortSignal: signal },
        );
        const objects: InventoryObject[] = [];
        for (const [items, deleteMarker] of [
          [result.Versions ?? [], false],
          [result.DeleteMarkers ?? [], true],
        ] as const) {
          for (const item of items) {
            const size = "Size" in item ? (item.Size ?? 0) : 0;
            if (
              !item.Key ||
              !item.Key.startsWith(prefix) ||
              item.Key.length > 1024 ||
              !item.LastModified ||
              !Number.isFinite(item.LastModified.getTime()) ||
              !Number.isSafeInteger(size) ||
              size < 0 ||
              (item.VersionId?.length ?? 0) > 2048
            )
              throw new MaintenanceStorageError();
            objects.push({
              key: item.Key,
              versionId: item.VersionId ?? null,
              lastModified: item.LastModified,
              size,
              deleteMarker,
            });
          }
        }
        if (
          objects.length > limit ||
          (result.IsTruncated &&
            (!result.NextKeyMarker ||
              (result.NextKeyMarker === cursor?.keyMarker &&
                result.NextVersionIdMarker === cursor?.versionIdMarker)))
        )
          throw new MaintenanceStorageError();
        return {
          objects,
          cursor: result.IsTruncated
            ? {
                keyMarker: result.NextKeyMarker!,
                versionIdMarker: result.NextVersionIdMarker,
              }
            : null,
        };
      } catch {
        throw new MaintenanceStorageError();
      }
    },
    async observe(key, versionId, maximumBytes, signal) {
      let stream:
        | (AsyncIterable<Uint8Array> & { destroy?: (error?: Error) => void })
        | undefined;
      const abort = () => stream?.destroy?.(new MaintenanceStorageError());
      try {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: key,
            VersionId: versionId ?? undefined,
          }),
          { abortSignal: signal },
        );
        if (result.DeleteMarker) return null;
        stream = result.Body as typeof stream;
        if (!stream) throw new MaintenanceStorageError();
        if (
          result.ContentLength !== undefined &&
          result.ContentLength > maximumBytes
        )
          throw new MaintenanceStorageError();
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) throw new MaintenanceStorageError();
        let size = 0;
        const hash = createHash("sha256");
        for await (const chunk of stream) {
          size += chunk.length;
          if (size > maximumBytes || signal.aborted)
            throw new MaintenanceStorageError();
          hash.update(chunk);
        }
        return { digest: hash.digest("hex"), size };
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "name" in error &&
          (error.name === "NoSuchKey" ||
            error.name === "NotFound" ||
            error.name === "NoSuchVersion")
        )
          return null;
        throw new MaintenanceStorageError();
      } finally {
        signal.removeEventListener("abort", abort);
        stream?.destroy?.();
      }
    },
  };
}
