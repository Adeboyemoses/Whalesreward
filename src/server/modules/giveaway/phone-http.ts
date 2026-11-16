import { z } from "zod";
import { authId } from "../../../shared/contracts/auth";
import { database } from "../../lib/db";
import { newId } from "../../lib/ids";
import { adminConfig } from "../admin-access/config";
import { cookieToken } from "../admin-access/http";
import { requireAdminSession, requirePermission } from "../../lib/authz";
import { transaction } from "../admin-access/repo";
import { enforceOrigin, clientIp } from "../auth/http";
import { consumeLimits } from "../auth/rate-limit";
import { AuthError } from "../auth/errors";
import { createPhoneService } from "./phones";
import { phoneAudit } from "./phone-audit";
import { campaignData, campaignView } from "./data";
import { readPhones } from "./phone-reads";
type Action =
  | "designate"
  | "census"
  | "propose"
  | "decide"
  | "certify"
  | "phones"
  | "required-attendants"
  | "exclusions"
  | "exclusion"
  | "check"
  | "entries";
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
      return JSON.parse(Buffer.concat(chunks).toString()) as unknown;
    } catch {
      throw new AuthError("invalid_request", 400);
    }
  } finally {
    reader.releaseLock();
  }
}
export async function handlePhones(
  request: Request,
  action: Action,
  campaignId: string,
  id?: string,
) {
  const headers = new Headers({
      "Cache-Control": "no-store",
      Vary: "Cookie",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    }),
    requestId = newId();
  try {
    authId.parse(campaignId);
    if (id) authId.parse(id);
    const write = [
      "designate",
      "census",
      "propose",
      "decide",
      "certify",
    ].includes(action);
    if (request.method !== (write ? "POST" : "GET"))
      throw new AuthError("invalid_request", 400);
    const config = adminConfig(),
      pool = database(),
      token = cookieToken(request);
    if (write) enforceOrigin(request, config.origin);
    const actor = await transaction(pool, async (db) => {
      const a = await requireAdminSession(db, token);
      requirePermission(a, "sales");
      if (action === "designate") requirePermission(a, "settings");
      else requirePermission(a, "leaderboards");
      return a;
    });
    await consumeLimits(pool, config.secret, [
      {
        key: `m2-${write ? "write" : "read"}-ip:${clientIp(request, config.trustedIpHeader)}`,
        capacity: write ? 60 : 180,
      },
      {
        key: `m2-${write ? "write" : "read"}-account:${actor.user_id}`,
        capacity: write ? 20 : 60,
      },
    ]);
    let data: unknown;
    const query = Object.fromEntries(new URL(request.url).searchParams);
    if (write && Object.keys(query).length)
      throw new AuthError("invalid_request", 400);
    const service = createPhoneService(
      pool,
      config,
      phoneAudit,
      async (db, cid) => {
        const s = (
          await db.query("SELECT station_id FROM campaign WHERE id=$1", [cid])
        ).rows[0];
        return campaignView(await campaignData(db, s.station_id, cid));
      },
    );
    if (action === "designate")
      data = await service.designate(token, campaignId, await body(request));
    else if (action === "census")
      data = await service.census(token, campaignId, await body(request));
    else if (action === "propose")
      data = await service.propose(token, campaignId, id!, await body(request));
    else if (action === "decide")
      data = await service.decide(token, campaignId, id!, await body(request));
    else if (action === "certify")
      data = await service.check(token, campaignId, await body(request));
    else
      data = await readPhones(
        pool,
        config.secret,
        token,
        campaignId,
        action,
        id,
        query,
      );
    return Response.json(
      { data, serverTime: new Date().toISOString(), requestId },
      { headers, status: 200 },
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
