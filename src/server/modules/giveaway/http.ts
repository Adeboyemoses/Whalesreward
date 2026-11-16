import { z } from "zod";
import { authId } from "../../../shared/contracts/auth";
import { database } from "../../lib/db";
import { newId } from "../../lib/ids";
import { adminConfig } from "../admin-access/config";
import { cookieToken } from "../admin-access/http";
import { transaction } from "../admin-access/repo";
import { enforceOrigin, clientIp } from "../auth/http";
import { consumeLimits } from "../auth/rate-limit";
import { AuthError } from "../auth/errors";
import { authority } from "./data";
import {
  readCampaign,
  readReadiness,
  prepareGiveaway,
  confirmGiveaway,
} from "./service";
import { readLeaderboards } from "../leaderboards/service";
import { readGiveawayHistory } from "./history";
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
export async function handleGiveaway(
  request: Request,
  action:
    | "campaign"
    | "leaderboards"
    | "readiness"
    | "prepare"
    | "confirm"
    | "history",
  campaignId?: string,
  collection?: "previews" | "snapshots",
  id?: string,
  child?: "rows" | "sources" | "changes",
) {
  const headers = new Headers({
      "Cache-Control": "no-store",
      Vary: "Cookie",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    }),
    requestId = newId();
  try {
    const config = adminConfig(),
      pool = database(),
      token = cookieToken(request),
      post = action === "prepare" || action === "confirm";
    if (request.method !== (post ? "POST" : "GET"))
      throw new AuthError("invalid_request", 400);
    if (campaignId) authId.parse(campaignId);
    if (id) authId.parse(id);
    const url = new URL(request.url);
    if (post && url.search) throw new AuthError("invalid_request", 400);
    if (post) enforceOrigin(request, config.origin);
    const actor = await transaction(
      pool,
      async (db) => (await authority(db, token)).actor,
    );
    await consumeLimits(pool, config.secret, [
      {
        key: `m2-${post ? "write" : "read"}-ip:${clientIp(request, config.trustedIpHeader)}`,
        capacity: post ? 60 : 180,
      },
      {
        key: `m2-${post ? "write" : "read"}-account:${actor.user_id}`,
        capacity: post ? 20 : 60,
      },
    ]);
    const query = Object.fromEntries(url.searchParams);
    if ([...url.searchParams.keys()].length !== Object.keys(query).length)
      throw new AuthError("invalid_request", 400);
    let data: unknown,
      status = 200;
    if (action === "campaign") {
      if (url.search) throw new AuthError("invalid_request", 400);
      data = await readCampaign(pool, token);
    } else if (action === "leaderboards")
      data = await readLeaderboards(pool, config, token, query);
    else if (action === "readiness") {
      if (url.search) throw new AuthError("invalid_request", 400);
      data = await readReadiness(pool, token, campaignId!);
    } else if (action === "prepare") {
      const r = await prepareGiveaway(
        pool,
        token,
        campaignId!,
        await body(request),
        config,
      );
      data = r.data;
      status = r.replayed || "state" in r.data ? 200 : 201;
    } else if (action === "confirm") {
      const r = await confirmGiveaway(
        pool,
        token,
        campaignId!,
        await body(request),
        id,
        config,
      );
      data = r.data;
      status = r.replayed ? 200 : 201;
    } else
      data = await readGiveawayHistory(
        pool,
        config,
        token,
        campaignId!,
        collection!,
        id,
        child,
        query,
      );
    return Response.json(
      { data, serverTime: new Date().toISOString(), requestId },
      { headers, status },
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
