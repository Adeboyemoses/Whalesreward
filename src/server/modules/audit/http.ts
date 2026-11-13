import { z } from "zod";
import { auditSearchSchema, auditId } from "../../../shared/contracts/audit";
import { database } from "../../lib/db";
import { newId } from "../../lib/ids";
import { adminConfig } from "../admin-access/config";
import { cookieToken } from "../admin-access/http";
import { transaction } from "../admin-access/repo";
import { enforceOrigin, clientIp } from "../auth/http";
import { consumeLimits } from "../auth/rate-limit";
import { AuthError } from "../auth/errors";
import { requireAdminSession } from "../../lib/authz";
import { readAudit } from "./service";
async function body(request: Request) {
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
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > 32768) {
        await reader.cancel();
        throw new AuthError("request_too_large", 413);
      }
      chunks.push(next.value);
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
export async function handleAudit(
  request: Request,
  action: "search" | "detail",
  eventId?: string,
) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  const requestId = newId();
  try {
    const config = adminConfig(),
      pool = database(),
      token = cookieToken(request);
    if (
      request.method !== (action === "search" ? "POST" : "GET") ||
      new URL(request.url).search
    )
      throw new AuthError("invalid_request", 400);
    if (action === "search") enforceOrigin(request, config.origin);
    else auditId.parse(eventId);
    const actor = await transaction(pool, (db) =>
      requireAdminSession(db, token),
    );
    await consumeLimits(pool, config.secret, [
      {
        key: `admin-read-ip:${clientIp(request, config.trustedIpHeader)}`,
        capacity: 180,
      },
      { key: `admin-read-account:${actor.user_id}`, capacity: 60 },
    ]);
    const input =
      action === "search" ? auditSearchSchema.parse(await body(request)) : {};
    const data = await readAudit(pool, config, token, action, input, eventId);
    return Response.json(
      { data, serverTime: new Date().toISOString(), requestId },
      { headers },
    );
  } catch (e) {
    const failure =
      e instanceof AuthError
        ? e
        : e instanceof z.ZodError
          ? new AuthError("invalid_request", 400)
          : new AuthError("temporarily_unavailable", 503);
    if (failure.retryAfter)
      headers.set("Retry-After", String(failure.retryAfter));
    return Response.json(
      {
        error: {
          code: failure.code,
          message: "This request could not be completed.",
          retryable: [429, 503].includes(failure.status),
        },
        serverTime: new Date().toISOString(),
        requestId,
      },
      { status: failure.status, headers },
    );
  }
}
