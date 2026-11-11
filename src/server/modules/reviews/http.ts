import { z } from "zod";
import { authId } from "../../../shared/contracts/auth";
import * as wire from "../../../shared/contracts/sales";
import { database } from "../../lib/db";
import {
  requireAdminSession,
  requirePermission,
  securityLock,
} from "../../lib/authz";
import { newId } from "../../lib/ids";
import { adminConfig } from "../admin-access/config";
import { cookieToken } from "../admin-access/http";
import { clientIp, enforceOrigin } from "../auth/http";
import { consumeLimits } from "../auth/rate-limit";
import { AuthError } from "../auth/errors";
import { transaction } from "../sync/repo";
import { correctionStorage } from "../corrections/http";
import { createReviewsService } from "./service";
import { startAutomaticDuplicates } from "../duplicates/runtime";
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
export async function handleReviews(
  request: Request,
  kind: "price" | "card" | "date" | "capture" | "duplicate",
  id: string,
  holdId?: string,
) {
  const headers = new Headers({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    }),
    requestId = newId();
  try {
    const cfg = adminConfig(),
      pool = database();
    if (request.method !== "POST" || new URL(request.url).search)
      throw new AuthError("invalid_request", 400);
    authId.parse(id);
    if (holdId) authId.parse(holdId);
    enforceOrigin(request, cfg.origin);
    const token = cookieToken(request),
      permissions = {
        price: "priceReview",
        card: "cardEligibility",
        date: "dateReview",
        capture: "dateReview",
        duplicate: "duplicates",
      } as const;
    const actor = await transaction(pool, async (db) => {
      await securityLock(db);
      const a = await requireAdminSession(db, token);
      requirePermission(a, "sales");
      requirePermission(a, permissions[kind]);
      return a;
    });
    await consumeLimits(pool, cfg.secret, [
      { key: `m3-review-write-account:${actor.user_id}`, capacity: 20 },
      {
        key: `m3-review-write-ip:${clientIp(request, cfg.trustedIpHeader)}`,
        capacity: 60,
      },
    ]);
    const input = await json(request),
      svc = createReviewsService({ pool, storage: correctionStorage });
    const data =
      kind === "price"
        ? await svc.decidePrice(
            token,
            id,
            holdId!,
            wire.priceDecisionSchema.parse(input),
          )
        : kind === "card"
          ? await svc.decideCard(
              token,
              id,
              holdId!,
              wire.cardDecisionSchema.parse(input),
            )
          : kind === "date"
            ? await svc.decideDate(
                token,
                id,
                holdId!,
                wire.dateDecisionSchema.parse(input),
              )
            : kind === "capture"
              ? await svc.decideCapture(
                  token,
                  id,
                  wire.captureDecisionSchema.parse(input),
                )
              : await svc.decideDuplicate(
                  token,
                  id,
                  wire.duplicateDecisionSchema.parse(input),
                );
    startAutomaticDuplicates();
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
