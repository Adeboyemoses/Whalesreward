import { z } from "zod";
import { authId } from "../../../shared/contracts/auth";
import { releaseSheetReservationSchema } from "../../../shared/contracts/held-release";
import { database } from "../../lib/db";
import { newId } from "../../lib/ids";
import { adminConfig } from "../admin-access/config";
import { cookieToken } from "../admin-access/http";
import { clientIp, enforceOrigin } from "../auth/http";
import { consumeLimits } from "../auth/rate-limit";
import { AuthError } from "../auth/errors";
import { transaction } from "../sync/repo";
import { securityLock, requireAdminSession } from "../../lib/authz";
import { correctionStorage } from "../corrections/http";
import { createReleaseUploadsService } from "./release-uploads";
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

export async function handleReleaseUpload(
  request: Request,
  purchaseId: string,
  action: "reserve" | "url" | "finalize",
  uploadId?: string,
) {
  const headers = new Headers({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    }),
    requestId = newId();
  try {
    if (request.method !== "POST" || new URL(request.url).search)
      throw new AuthError("invalid_request", 400);
    authId.parse(purchaseId);
    if (uploadId) authId.parse(uploadId);
    const cfg = adminConfig(),
      pool = database();
    enforceOrigin(request, cfg.origin);
    const token = cookieToken(request);
    const actor = await transaction(pool, async (db) => {
      await securityLock(db);
      return requireAdminSession(db, token);
    });
    await consumeLimits(pool, cfg.secret, [
      { key: `held-release-upload-account:${actor.user_id}`, capacity: 20 },
      {
        key: `held-release-upload-ip:${clientIp(request, cfg.trustedIpHeader)}`,
        capacity: 60,
      },
      ...(action === "url"
        ? [
            {
              key: `held-release-upload-url:${actor.user_id}:${purchaseId}`,
              capacity: 10,
            },
          ]
        : []),
    ]);
    const input = await json(request),
      svc = createReleaseUploadsService({ pool, storage: correctionStorage });
    if (action === "reserve") {
      const result = await svc.reserve(
        token,
        purchaseId,
        releaseSheetReservationSchema.parse(input),
      );
      return Response.json(
        { data: result.data, serverTime: new Date().toISOString(), requestId },
        { headers, status: result.replayed ? 200 : 201 },
      );
    }
    const data =
      action === "url"
        ? await svc.uploadUrl(token, purchaseId, uploadId!, input)
        : await svc.finalize(token, purchaseId, uploadId!, input);
    return Response.json(
      { data, serverTime: new Date().toISOString(), requestId },
      { headers },
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
