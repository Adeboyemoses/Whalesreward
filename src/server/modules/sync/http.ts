import { authId } from "../../../shared/contracts/auth";
import {
  lookupSchema,
  originalSaleSchema,
  uploadSchema,
  finalizeSchema,
} from "../../../shared/contracts/sync";
import { database } from "../../lib/db";
import { newId } from "../../lib/ids";
import {
  createStorage,
  storageConfig,
  type EvidenceStorage,
} from "../../adapters/storage";
import { authConfig } from "../auth/config";
import { clientIp, enforceOrigin, COOKIE } from "../auth/http";
import { consumeLimits } from "../auth/rate-limit";
import { AuthError } from "../auth/errors";
import { SyncError } from "./errors";
import { createSyncService } from "./service";
type Action = "lookup" | "submit" | "upload-permission" | "finalize" | "status";
function token(request: Request) {
  const tokens = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.startsWith(`${COOKIE}=`));
  if (tokens.length !== 1) return;
  const value = tokens[0]!.slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}
async function json(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim() !==
    "application/json"
  )
    throw new SyncError("invalid_request", 400);
  const reader = request.body?.getReader();
  if (!reader) throw new SyncError("invalid_request", 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 16384) {
        await reader.cancel();
        throw new SyncError("invalid_request", 400);
      }
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new SyncError("invalid_request", 400);
  } finally {
    reader.releaseLock();
  }
}
// Lazy construction permits lookup/status without requiring storage credentials.
const runtimeStorage: EvidenceStorage = {
  signPut: (...args) => createStorage(storageConfig()).signPut(...args),
  read: (...args) => createStorage(storageConfig()).read(...args),
  writeFinal: (...args) => createStorage(storageConfig()).writeFinal(...args),
};
export async function handleSync(
  request: Request,
  action: Action,
  id?: string,
): Promise<Response> {
  const headers = new Headers({ "Cache-Control": "no-store" }),
    requestId = newId();
  try {
    const config = authConfig(),
      pool = database(),
      service = createSyncService({ pool, storage: runtimeStorage });
    if (new URL(request.url).search)
      throw new SyncError("invalid_request", 400);
    if (action !== "status") enforceOrigin(request, config.origin);
    if (id !== undefined && !authId.safeParse(id).success)
      throw new SyncError("invalid_request", 400);
    const credential = token(request),
      identity = await service.identity(credential),
      ip = clientIp(request, config.trustedIpHeader);
    const limits =
      action === "lookup"
        ? [30, 120]
        : action === "status"
          ? [120, 240]
          : [60, 180];
    await consumeLimits(pool, config.secret, [
      {
        key: `sync:${action}:account:${identity.attendantId}`,
        capacity: limits[0]!,
      },
      { key: `sync:${action}:ip:${ip}`, capacity: limits[1]! },
      ...(action === "finalize" || action === "upload-permission"
        ? [{ key: `sync:${action}:purchase:${id}`, capacity: 10 }]
        : []),
    ]);
    let data: unknown,
      status = 200;
    if (action === "status") data = await service.status(credential, id!);
    else {
      const input = await json(request);
      if (action === "lookup") {
        const body = lookupSchema.safeParse(input);
        if (!body.success) throw new SyncError("invalid_request", 400);
        data = await service.lookup(
          credential,
          body.data,
          request.headers.get("X-WR-Lookup-Receipt") === "1",
        );
      } else if (action === "submit") {
        const body = originalSaleSchema.safeParse(input);
        if (!body.success) throw new SyncError("invalid_request", 400);
        const result = await service.submit(credential, body.data);
        data = result.status;
        status = result.created ? 201 : 200;
      } else if (action === "upload-permission") {
        const body = uploadSchema.safeParse(input);
        if (!body.success) throw new SyncError("invalid_request", 400);
        data = await service.uploadPermission(credential, id!, body.data);
      } else {
        const body = finalizeSchema.safeParse(input);
        if (!body.success) throw new SyncError("invalid_request", 400);
        data = await service.finalize(credential, id!, body.data);
      }
    }
    return Response.json(
      { data, serverTime: new Date().toISOString(), requestId },
      { headers, status },
    );
  } catch (error) {
    const failure =
      error instanceof SyncError || error instanceof AuthError
        ? error
        : new SyncError("temporarily_unavailable", 503);
    if (failure instanceof AuthError && failure.retryAfter)
      headers.set("Retry-After", String(failure.retryAfter));
    return Response.json(
      {
        error: {
          code: failure.code,
          message: "This request could not be completed.",
          retryable: [429, 503].includes(failure.status),
          ...(failure instanceof SyncError && failure.reason
            ? { fields: [{ path: "photo", code: failure.reason }] }
            : {}),
        },
        serverTime: new Date().toISOString(),
        requestId,
      },
      { status: failure.status, headers },
    );
  }
}
