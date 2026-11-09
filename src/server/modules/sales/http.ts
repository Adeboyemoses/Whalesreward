import { z } from "zod";
import { authId } from "../../../shared/contracts/auth";
import * as wire from "../../../shared/contracts/sales";
import { database } from "../../lib/db";
import { newId } from "../../lib/ids";
import { adminConfig } from "../admin-access/config";
import { cookieToken as adminCookie } from "../admin-access/http";
import {
  cookieToken as attendantCookie,
  clientIp,
  enforceOrigin,
} from "../auth/http";
import { AuthError } from "../auth/errors";
import { consumeLimits } from "../auth/rate-limit";
import { transaction } from "../admin-access/repo";
import {
  readSales,
  salesAuthority,
  type Audience,
  type ReadAction,
} from "./service";
import { readSalePhoto } from "./evidence";
async function readBody(request: Request) {
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
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 32768) {
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
export async function handleSalesRead(
  request: Request,
  audience: Audience,
  action: ReadAction | "photo" | "photo-access",
  purchaseId?: string,
): Promise<Response> {
  const headers = new Headers({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    }),
    requestId = newId();
  try {
    const config = adminConfig(),
      pool = database(),
      url = new URL(request.url),
      post = action === "search" || action === "photo-access";
    if (request.method !== (post ? "POST" : "GET"))
      throw new AuthError("invalid_request", 400);
    if (purchaseId) authId.parse(purchaseId);
    if (post) {
      enforceOrigin(request, config.origin);
      if (url.search) throw new AuthError("invalid_request", 400);
    }
    if (["detail", "photo"].includes(action) && url.search)
      throw new AuthError("invalid_request", 400);
    const token =
      audience === "admin" ? adminCookie(request) : attendantCookie(request);
    const actor = await transaction(pool, (db) =>
      salesAuthority(db, token, audience),
    );
    const rates = [
      {
        key: `m3-sales-read-ip:${clientIp(request, config.trustedIpHeader)}`,
        capacity: 180,
      },
      { key: `m3-sales-read-account:${actor.userId}`, capacity: 60 },
    ];
    if (action === "photo-access")
      rates.push({
        key: `m3-sales-photo:${actor.userId}:${purchaseId}`,
        capacity: 10,
      });
    await consumeLimits(pool, config.secret, rates);
    let input: unknown = {};
    if (post)
      input = (
        action === "search"
          ? wire.saleFilterSchema
          : wire.photoAccessInputSchema
      ).parse(await readBody(request));
    else if (action === "list" || action === "history") {
      const query: Record<string, unknown> = {};
      for (const [key, value] of url.searchParams) {
        if (key in query) throw new AuthError("invalid_request", 400);
        query[key] = key === "limit" ? Number(value) : value;
      }
      input = (
        action === "list"
          ? wire.salePageInputSchema
          : audience === "admin"
            ? wire.saleHistoryInputSchema
            : wire.attendantHistoryInputSchema
      ).parse(query);
    }
    const data =
      action === "photo" || action === "photo-access"
        ? await readSalePhoto(pool, token, audience, purchaseId!, input)
        : await readSales(
            pool,
            config,
            token,
            audience,
            action,
            input,
            purchaseId,
          );
    if (Buffer.isBuffer(data)) {
      headers.set("Content-Type", "image/jpeg");
      headers.set("Content-Length", String(data.length));
      return new Response(new Uint8Array(data), { headers });
    }
    return Response.json(
      { data, serverTime: new Date().toISOString(), requestId },
      { headers },
    );
  } catch (e) {
    const error =
      e instanceof AuthError
        ? e
        : e instanceof z.ZodError
          ? new AuthError("invalid_request", 400)
          : new AuthError("temporarily_unavailable", 503);
    if (error.retryAfter) headers.set("Retry-After", String(error.retryAfter));
    return Response.json(
      {
        error: {
          code: error.code,
          message: "This request could not be completed.",
          retryable: [429, 503].includes(error.status),
        },
        serverTime: new Date().toISOString(),
        requestId,
      },
      { status: error.status, headers },
    );
  }
}
