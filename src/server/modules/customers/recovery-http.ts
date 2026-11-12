import { z } from "zod";
import { authId } from "../../../shared/contracts/auth";
import { pageSchema } from "../../../shared/contracts/admin";
import { database } from "../../lib/db";
import { newId } from "../../lib/ids";
import {
  requireAdminSession,
  requirePermission,
  securityLock,
} from "../../lib/authz";
import { adminSessionConfig } from "../admin-access/config";
import { transaction } from "../admin-access/repo";
import { cookieToken } from "../admin-access/http";
import { clientIp, enforceOrigin } from "../auth/http";
import { consumeLimits } from "../auth/rate-limit";
import { AuthError } from "../auth/errors";
import {
  recoveryRead,
  recoveryWrite,
  recoveryWriteSchemas,
  type RecoveryWrite,
} from "./recovery";
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
export async function handleCustomerRecovery(
  request: Request,
  action:
    RecoveryWrite | "context" | "challenge" | "changes" | "cases" | "case",
  customerId: string,
  targetId?: string,
): Promise<Response> {
  const headers = new Headers({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    }),
    requestId = newId();
  try {
    const config = adminSessionConfig(),
      pool = database(),
      url = new URL(request.url),
      token = cookieToken(request),
      ip = clientIp(request, config.trustedIpHeader);
    authId.parse(customerId);
    if (targetId) authId.parse(targetId);
    const write = Object.hasOwn(recoveryWriteSchemas, action);
    if (request.method !== (write ? "POST" : "GET"))
      throw new AuthError("invalid_request", 400);
    if (write) enforceOrigin(request, config.origin);
    if ((write || !["changes", "cases"].includes(action)) && url.search)
      throw new AuthError("invalid_request", 400);
    const actor = await transaction(pool, async (db) => {
      await securityLock(db);
      const actor = await requireAdminSession(db, token);
      requirePermission(actor, "customers");
      if (["cases", "case"].includes(action))
        requirePermission(actor, "recovery", "managerRecovery");
      else if (action !== "changes") requirePermission(actor, "recovery");
      return actor;
    });
    await consumeLimits(pool, config.secret, [
      {
        key: `customer-recovery-${write ? "write" : "read"}-ip:${ip}`,
        capacity: write ? 60 : 180,
      },
      {
        key: `customer-recovery-${write ? "write" : "read"}-actor:${actor.user_id}`,
        capacity: write ? 20 : 60,
      },
    ]);
    let data: unknown;
    if (write) {
      const name = action as RecoveryWrite;
      data = await recoveryWrite(
        pool,
        config,
        token,
        name,
        customerId,
        recoveryWriteSchemas[name].parse(await body(request)),
        { ip },
        targetId,
      );
    } else {
      const query: Record<string, unknown> = {};
      for (const [key, value] of url.searchParams) {
        if (key in query) throw new AuthError("invalid_request", 400);
        query[key] = key === "limit" ? Number(value) : value;
      }
      const parsed = pageSchema.parse(query);
      data = await recoveryRead(
        pool,
        config,
        token,
        action as "context" | "challenge" | "changes" | "cases" | "case",
        customerId,
        parsed,
        targetId,
      );
    }
    return Response.json(
      { data, serverTime: new Date().toISOString(), requestId },
      {
        status: action === "issue" ? 202 : action === "case-create" ? 201 : 200,
        headers,
      },
    );
  } catch (error) {
    const failure =
      error instanceof AuthError
        ? error
        : error instanceof z.ZodError
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
