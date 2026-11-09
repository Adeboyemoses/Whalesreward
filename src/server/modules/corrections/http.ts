import { z } from "zod";
import { authId } from "../../../shared/contracts/auth";
import {
  correctionSubmissionSchema,
  correctionDecisionSchema,
} from "../../../shared/contracts/sales";
import { database } from "../../lib/db";
import {
  requireSession,
  requireAdminSession,
  requirePermission,
  securityLock,
} from "../../lib/authz";
import { newId } from "../../lib/ids";
import {
  createStorage,
  storageConfig,
  type EvidenceStorage,
} from "../../adapters/storage";
import { adminConfig } from "../admin-access/config";
import { cookieToken as adminCookie } from "../admin-access/http";
import { cookieToken, clientIp, enforceOrigin } from "../auth/http";
import { digest } from "../auth/crypto";
import { consumeLimits } from "../auth/rate-limit";
import { AuthError } from "../auth/errors";
import { transaction } from "../sync/repo";
import { createCorrectionsService } from "./service";
import { startAutomaticCorrections } from "./runtime";
export const correctionStorage: EvidenceStorage = {
  signPut: (...args) => createStorage(storageConfig()).signPut(...args),
  read: (...args) => createStorage(storageConfig()).read(...args),
  writeFinal: (...args) => createStorage(storageConfig()).writeFinal(...args),
};
async function json(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim() !==
    "application/json"
  )
    throw new AuthError("invalid_request", 400);
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError("invalid_request", 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 32768) {
        await reader.cancel();
        throw new AuthError("request_too_large", 413);
      }
      chunks.push(part.value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch {
      throw new AuthError("invalid_request", 400);
    }
  } finally {
    reader.releaseLock();
  }
}
export async function handleCorrections(
  request: Request,
  action: "submit" | "lookup" | "decide",
  purchaseId: string,
  id?: string,
) {
  const headers = new Headers({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    }),
    requestId = newId();
  try {
    const cfg = adminConfig(),
      pool = database();
    if (
      request.method !== (action === "lookup" ? "GET" : "POST") ||
      new URL(request.url).search
    )
      throw new AuthError("invalid_request", 400);
    authId.parse(purchaseId);
    if (id) authId.parse(id);
    if (action !== "lookup") enforceOrigin(request, cfg.origin);
    const token =
      action === "decide" ? adminCookie(request) : cookieToken(request);
    const actor = await transaction(pool, async (db) => {
      await securityLock(db);
      if (action === "decide") {
        const a = await requireAdminSession(db, token);
        requirePermission(a, "sales");
        requirePermission(a, "corrections");
        return a;
      }
      return requireSession(db, digest(token ?? ""));
    });
    const write = action !== "lookup";
    await consumeLimits(pool, cfg.secret, [
      {
        key: `m3-correction-${write ? "write" : "read"}-account:${actor.user_id}`,
        capacity: write ? 20 : 60,
      },
      {
        key: `m3-correction-${write ? "write" : "read"}-ip:${clientIp(request, cfg.trustedIpHeader)}`,
        capacity: write ? 60 : 180,
      },
    ]);
    const svc = createCorrectionsService({ pool, storage: correctionStorage });
    let data: unknown,
      status = 200;
    if (action === "lookup")
      data = await svc.byOperation(token, purchaseId, id!);
    else if (action === "submit") {
      const result = await svc.submit(
        token,
        purchaseId,
        correctionSubmissionSchema.parse(await json(request)),
      );
      data = result.data;
      status = result.replayed ? 200 : 201;
      startAutomaticCorrections();
    } else
      data = await svc.decide(
        token,
        purchaseId,
        id!,
        correctionDecisionSchema.parse(await json(request)),
      );
    return Response.json(
      { data, serverTime: new Date().toISOString(), requestId },
      { status, headers },
    );
  } catch (error) {
    const e =
      error instanceof AuthError
        ? error
        : error instanceof z.ZodError
          ? new AuthError("invalid_request", 400)
          : new AuthError("temporarily_unavailable", 503);
    if (e.retryAfter) headers.set("Retry-After", String(e.retryAfter));
    return Response.json(
      {
        error: {
          code: e.code,
          message: "This request could not be completed.",
          retryable: [429, 503].includes(e.status),
        },
        serverTime: new Date().toISOString(),
        requestId,
      },
      { status: e.status, headers },
    );
  }
}
