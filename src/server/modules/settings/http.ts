import { z } from "zod";
import { database } from "../../lib/db";
import { newId } from "../../lib/ids";
import { adminConfig } from "../admin-access/config";
import { cookieToken } from "../admin-access/http";
import { transaction } from "../admin-access/repo";
import { enforceOrigin, clientIp } from "../auth/http";
import { consumeLimits } from "../auth/rate-limit";
import { AuthError } from "../auth/errors";
import { requireAdminSession, requirePermission } from "../../lib/authz";
import { readSettings, reviewSettings, confirmSettings } from "./service";
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
export async function handleSettings(
  request: Request,
  action:
    | "get"
    | "history"
    | "giveaway-review"
    | "giveaway-confirm"
    | "retention-review"
    | "retention-confirm",
) {
  const headers = new Headers({
      "Cache-Control": "no-store",
      Vary: "Cookie",
      "Referrer-Policy": "no-referrer",
    }),
    requestId = newId();
  try {
    const config = adminConfig(),
      pool = database(),
      token = cookieToken(request),
      url = new URL(request.url);
    const post = action !== "get" && action !== "history",
      confirm = action.endsWith("-confirm");
    if (
      request.method !== (post ? "POST" : "GET") ||
      (action !== "history" && url.search)
    )
      throw new AuthError("invalid_request", 400);
    if (post) enforceOrigin(request, config.origin);
    const actor = await transaction(pool, async (db) => {
      const a = await requireAdminSession(db, token);
      requirePermission(a, "settings");
      return a;
    });
    await consumeLimits(pool, config.secret, [
      {
        key: `admin-${confirm ? "write" : "read"}-ip:${clientIp(request, config.trustedIpHeader)}`,
        capacity: confirm ? 60 : 180,
      },
      {
        key: `admin-${confirm ? "write" : "read"}-account:${actor.user_id}`,
        capacity: confirm ? 20 : 60,
      },
    ]);
    let input: unknown = {};
    if (post) input = await body(request);
    else if (action === "history") {
      const query: Record<string, unknown> = {};
      for (const [k, v] of url.searchParams) {
        if (k in query) throw new AuthError("invalid_request", 400);
        query[k] = k === "limit" ? Number(v) : v;
      }
      input = query;
    }
    let data: unknown,
      status = 200;
    if (action === "get" || action === "history")
      data = await readSettings(pool, config, token, action, input);
    else {
      const section = action.startsWith("giveaway") ? "giveaway" : "retention";
      if (confirm) {
        const result = await confirmSettings(
          pool,
          config,
          token,
          section,
          input,
        );
        data = result.data;
        status = result.replayed ? 200 : 201;
      } else data = await reviewSettings(pool, config, token, section, input);
    }
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
