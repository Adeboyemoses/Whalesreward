import { z } from "zod";
import { authId } from "../../../shared/contracts/auth";
import {
  activatePriceSchema,
  assignAttendantSchema,
  endAssignmentSchema,
  attendantSearchSchema,
  candidateSchema,
  createAttendantSchema,
  createPumpSchema,
  productCode,
  stationPageSchema,
} from "../../../shared/contracts/station";
import { database } from "../../lib/db";
import { newId } from "../../lib/ids";
import {
  requireAdminSession,
  requireSession,
  securityLock,
} from "../../lib/authz";
import { transaction } from "../admin-access/repo";
import { adminConfig } from "../admin-access/config";
import { cookieToken as adminCookie } from "../admin-access/http";
import {
  cookieToken as attendantCookie,
  clientIp,
  enforceOrigin,
} from "../auth/http";
import { consumeLimits } from "../auth/rate-limit";
import { digest } from "../auth/crypto";
import { AuthError } from "../auth/errors";
import { assignmentView } from "./repo";
import { stationRead, stationWrite } from "./service";
const writeSchemas: Record<string, z.ZodType> = {
  "pumps-create": createPumpSchema,
  "prices-activate": activatePriceSchema,
  "attendants-create": createAttendantSchema,
  "attendants-assignment": assignAttendantSchema,
  "attendants-assignment-end": endAssignmentSchema,
};
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
export async function handleStation(
  request: Request,
  action: string,
  targetId?: string,
): Promise<Response> {
  const headers = new Headers({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    }),
    requestId = newId();
  try {
    const config = adminConfig(),
      pool = database(),
      ip = clientIp(request, config.trustedIpHeader),
      url = new URL(request.url);
    const write = writeSchemas[action];
    if (
      request.method !==
      (write || action === "attendants-search" ? "POST" : "GET")
    )
      throw new AuthError("invalid_request", 400);
    if (targetId) {
      if (action === "prices-activate" || action === "prices-history")
        productCode.parse(targetId);
      else authId.parse(targetId);
    }
    if (request.method !== "GET") enforceOrigin(request, config.origin);
    if (
      (write ||
        action === "attendants-search" ||
        [
          "products",
          "prices-list",
          "pumps-get",
          "attendants-get",
          "configured-assignment",
        ].includes(action)) &&
      url.search
    )
      throw new AuthError("invalid_request", 400);
    let data: unknown;
    if (action === "configured-assignment") {
      const token = attendantCookie(request);
      await consumeLimits(pool, config.secret, [
        { key: `station-read-ip:${ip}`, capacity: 180 },
      ]);
      const identity = await transaction(pool, (db) =>
        requireSession(db, digest(token ?? "")),
      );
      await consumeLimits(pool, config.secret, [
        { key: `station-read-account:${identity.user_id}`, capacity: 60 },
      ]);
      data = await transaction(pool, async (db) => {
        const session = await requireSession(db, digest(token ?? ""));
        const r = (
          await db.query(
            `SELECT ag.id AS configured_id,c.assignment_id AS acknowledged_id,c.offline_expires_at FROM attendant a JOIN assignment ag ON ag.attendant_id=a.id AND ag.effective_until IS NULL JOIN pump p ON p.id=ag.pump_id AND p.enabled JOIN capture_context c ON c.id=$2 AND c.attendant_id=a.id WHERE a.user_id=$1`,
            [session.user_id, session.capture_context_id],
          )
        ).rows[0];
        if (!r) throw new AuthError("assignment_unavailable", 422);
        if (r.offline_expires_at.getTime() <= Date.now())
          throw new AuthError("online_sign_in_required", 403);
        return {
          configured: await assignmentView(db, r.configured_id),
          acknowledgedAssignmentId: r.acknowledged_id,
          reassignmentRequiresSignIn: r.configured_id !== r.acknowledged_id,
        };
      });
    } else {
      const token = adminCookie(request);
      const actor = await transaction(pool, async (db) => {
        await securityLock(db);
        return requireAdminSession(db, token);
      });
      await consumeLimits(pool, config.secret, [
        {
          key: `admin-${write ? "write" : "read"}-ip:${ip}`,
          capacity: write ? 60 : 180,
        },
        {
          key: `admin-${write ? "write" : "read"}-account:${actor.user_id}`,
          capacity: write ? 20 : 60,
        },
      ]);
      if (write)
        data = await stationWrite(
          pool,
          config,
          token,
          action,
          write.parse(await body(request)),
          targetId,
        );
      else {
        let input: unknown = {};
        if (action === "attendants-search")
          input = attendantSearchSchema.parse(await body(request));
        else if (
          !["products", "prices-list", "pumps-get", "attendants-get"].includes(
            action,
          )
        ) {
          const query: Record<string, unknown> = {};
          for (const [k, v] of url.searchParams) {
            if (k in query) throw new AuthError("invalid_request", 400);
            query[k] = k === "limit" ? Number(v) : v;
          }
          input = (
            action === "assignment-candidates"
              ? candidateSchema
              : stationPageSchema
          ).parse(query);
        }
        data = await stationRead(pool, config, token, action, input, targetId);
      }
    }
    return Response.json(
      { data, serverTime: new Date().toISOString(), requestId },
      {
        status: [
          "pumps-create",
          "attendants-create",
          "prices-activate",
        ].includes(action)
          ? 201
          : 200,
        headers,
      },
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
