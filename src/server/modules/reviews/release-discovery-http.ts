import { z } from "zod";
import { database } from "../../lib/db";
import { newId } from "../../lib/ids";
import { transaction } from "../../lib/transaction";
import {
  requireAdminSession,
  requirePermission,
  securityLock,
} from "../../lib/authz";
import { adminConfig } from "../admin-access/config";
import { cookieToken } from "../admin-access/http";
import { clientIp } from "../auth/http";
import { consumeLimits } from "../auth/rate-limit";
import { AuthError } from "../auth/errors";
import { createReleaseDiscoveryService } from "./release-discovery";

export async function handleReleaseDiscovery(
  request: Request,
  purchaseId?: string,
) {
  const requestId = newId();
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    Vary: "Cookie",
  });
  try {
    const query: Record<string, string> = Object.create(null);
    for (const [key, value] of new URL(request.url).searchParams) {
      if (Object.hasOwn(query, key))
        throw new AuthError("invalid_request", 400);
      query[key] = value;
    }
    const pool = database(),
      token = cookieToken(request),
      cfg = adminConfig();
    const actor = await transaction(pool, async (db) => {
      await securityLock(db);
      const a = await requireAdminSession(db, token);
      requirePermission(a, "sales");
      return a;
    });
    await consumeLimits(pool, cfg.secret, [
      { key: `m3-release-read-account:${actor.user_id}`, capacity: 120 },
      {
        key: `m3-release-read-ip:${clientIp(request, cfg.trustedIpHeader)}`,
        capacity: 240,
      },
    ]);
    const service = createReleaseDiscoveryService({ pool });
    const data =
      purchaseId === undefined
        ? await service.pending(token, query)
        : await service.prepare(token, purchaseId, query);
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
