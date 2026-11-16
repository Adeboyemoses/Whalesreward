import { z } from "zod";
import { authId } from "../../../shared/contracts/auth";
import { database } from "../../lib/db";
import { newId } from "../../lib/ids";
import { adminConfig } from "../admin-access/config";
import { cookieToken } from "../admin-access/http";
import { clientIp, enforceOrigin } from "../auth/http";
import { consumeLimits } from "../auth/rate-limit";
import { AuthError } from "../auth/errors";
import { transaction } from "../sync/repo";
import {
  requireAdminSession,
  requirePermission,
  securityLock,
} from "../../lib/authz";
import { correctionStorage } from "../corrections/http";
import { createHeldReleaseService } from "./release-service";
async function body(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim() !==
    "application/json"
  )
    throw new AuthError("invalid_request", 400);
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError("invalid_request", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 32768) {
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
export async function handleHeldRelease(
  request: Request,
  action: "propose" | "list" | "get" | "decide" | "photoAccess",
  purchaseId: string,
  proposalId?: string,
) {
  const requestId = newId(),
    headers = new Headers({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      Vary: "Cookie",
    });
  try {
    authId.parse(purchaseId);
    if (proposalId) authId.parse(proposalId);
    const cfg = adminConfig();
    if (request.method !== "GET") enforceOrigin(request, cfg.origin);
    const pool = database(),
      token = cookieToken(request);
    const actor = await transaction(pool, async (db) => {
      await securityLock(db);
      const a = await requireAdminSession(db, token);
      requirePermission(a, "sales");
      return a;
    });
    const read = action === "list" || action === "get";
    await consumeLimits(pool, cfg.secret, [
      {
        key: `m3-release-${read ? "read" : "write"}-account:${actor.user_id}`,
        capacity: read ? 120 : 20,
      },
      {
        key: `m3-release-${read ? "read" : "write"}-ip:${clientIp(request, cfg.trustedIpHeader)}`,
        capacity: read ? 240 : 60,
      },
      ...(action === "photoAccess"
        ? [
            {
              key: `m3-release-photo:${actor.user_id}:${purchaseId}`,
              capacity: 10,
            },
          ]
        : []),
    ]);
    const svc = createHeldReleaseService({ pool, storage: correctionStorage });
    let data: unknown,
      status = 200;
    if (action === "propose") {
      const result = await svc.propose(token, purchaseId, await body(request));
      data = result.proposal;
      status = result.replayed ? 200 : 201;
    } else if (action === "decide")
      data = await svc.decide(
        token,
        purchaseId,
        proposalId!,
        await body(request),
      );
    else if (action === "photoAccess")
      data = await svc.photoAccess(
        token,
        purchaseId,
        proposalId!,
        await body(request),
      );
    else if (action === "get")
      data = await svc.get(token, purchaseId, proposalId!);
    else {
      const params = new URL(request.url).searchParams;
      const query: Record<string, string> = {};
      for (const [key, value] of params) {
        if (Object.hasOwn(query, key))
          throw new AuthError("invalid_request", 400);
        query[key] = value;
      }
      data = await svc.list(token, purchaseId, query);
    }
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
