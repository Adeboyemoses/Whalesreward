import { z } from "zod";
import { authId } from "../../../shared/contracts/auth";
import { database } from "../../lib/db";
import { newId } from "../../lib/ids";
import { adminConfig } from "../admin-access/config";
import { cookieToken } from "../admin-access/http";
import { requireAdminSession } from "../../lib/authz";
import { transaction } from "../admin-access/repo";
import { clientIp } from "../auth/http";
import { consumeLimits } from "../auth/rate-limit";
import { AuthError } from "../auth/errors";
import { readProjection } from "./projections";
import type { ProjectionAction } from "./projection-context";
export async function handleProjection(
  request: Request,
  action: ProjectionAction,
  campaignId: string,
  resourceId?: string,
) {
  const headers = {
      "Cache-Control": "no-store",
      Vary: "Cookie",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
    requestId = newId();
  try {
    if (request.method !== "GET") throw new AuthError("invalid_request", 400);
    authId.parse(campaignId);
    if (resourceId) authId.parse(resourceId);
    const config = adminConfig(),
      pool = database(),
      token = cookieToken(request);
    const actor = await transaction(pool, (db) =>
      requireAdminSession(db, token),
    );
    await consumeLimits(pool, config.secret, [
      {
        key: `m2-read-ip:${clientIp(request, config.trustedIpHeader)}`,
        capacity: 180,
      },
      { key: `m2-read-account:${actor.user_id}`, capacity: 60 },
    ]);
    const search = new URL(request.url).searchParams;
    if (new Set(search.keys()).size !== [...search.keys()].length)
      throw new AuthError("invalid_request", 400);
    const data = await readProjection(
      pool,
      config.secret,
      token,
      campaignId,
      action,
      resourceId,
      Object.fromEntries(search),
    );
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
      { headers, status: failure.status },
    );
  }
}
