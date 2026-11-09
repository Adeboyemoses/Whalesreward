import { z } from "zod";
import { authId } from "../../../shared/contracts/auth";
import { pageSchema } from "../../../shared/contracts/admin";
import {
  registrationSchema,
  phoneLookupSchema,
  customerSearchSchema,
  createBatchSchema,
  batchTransitionSchema,
  createExportSchema,
  batchListSchema,
  cardListSchema,
} from "../../../shared/contracts/customers-cards";
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
import { digest } from "../auth/crypto";
import { consumeLimits } from "../auth/rate-limit";
import { AuthError } from "../auth/errors";
import {
  registerCustomer,
  lookupCustomer,
  customerRead,
} from "../customers/service";
import { cardsWrite, cardsRead } from "./service";
import { downloadCardExport } from "./exports";
import { createCardArtifactStorage } from "../../adapters/card-artifacts";
import { startAutomaticCardExports } from "./runtime";
const schemas: Record<string, z.ZodType> = {
  register: registrationSchema,
  lookup: phoneLookupSchema,
  search: customerSearchSchema,
  create: createBatchSchema,
  "mark-printed": batchTransitionSchema,
  activate: batchTransitionSchema,
  export: createExportSchema,
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
export async function handleCardsCustomers(
  request: Request,
  area: "customers" | "cards",
  action: string,
  targetId?: string,
  exportId?: string,
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
      ip = clientIp(request, config.trustedIpHeader),
      schema = schemas[action];
    if (request.method !== (schema ? "POST" : "GET"))
      throw new AuthError("invalid_request", 400);
    if (targetId) authId.parse(targetId);
    if (exportId) authId.parse(exportId);
    if (schema) {
      enforceOrigin(request, config.origin);
      if (url.search) throw new AuthError("invalid_request", 400);
    } else if (
      ["profile", "detail", "export-detail", "file"].includes(action) &&
      url.search
    )
      throw new AuthError("invalid_request", 400);
    const isAttendant =
        area === "customers" && ["register", "lookup"].includes(action),
      token = isAttendant ? attendantCookie(request) : adminCookie(request);
    const actor = await transaction(pool, async (db) => {
      await securityLock(db);
      return isAttendant
        ? requireSession(db, digest(token ?? ""))
        : requireAdminSession(db, token);
    });
    const exportRate = ["export", "file"].includes(action),
      generate = action === "create",
      write = [
        "register",
        "create",
        "mark-printed",
        "activate",
        "export",
      ].includes(action),
      lookup = action === "lookup";
    const capacity = exportRate || generate ? 5 : write || lookup ? 20 : 60,
      ipCapacity = exportRate || generate ? 20 : write || lookup ? 60 : 180,
      profile = exportRate
        ? "export"
        : generate
          ? "generate"
          : lookup
            ? "customer-lookup"
            : write
              ? "write"
              : "read";
    await consumeLimits(pool, config.secret, [
      { key: `m2-${profile}-ip:${ip}`, capacity: ipCapacity },
      { key: `m2-${profile}-account:${actor.user_id}`, capacity },
    ]);
    let input: unknown = {};
    if (schema) input = schema.parse(await body(request));
    else if (!["profile", "detail", "export-detail", "file"].includes(action)) {
      const query: Record<string, unknown> = {};
      for (const [k, v] of url.searchParams) {
        if (k in query) throw new AuthError("invalid_request", 400);
        query[k] = k === "limit" ? Number(v) : v;
      }
      input = (
        action === "list"
          ? batchListSchema
          : action === "cards"
            ? cardListSchema
            : pageSchema
      ).parse(query);
    }
    let data: unknown,
      status = 200;
    if (area === "customers") {
      if (action === "register") {
        const result = await registerCustomer(pool, config, token, input);
        data = result.data;
        status = result.replayed ? 200 : 201;
      } else if (action === "lookup")
        data = await lookupCustomer(pool, token, input);
      else
        data = await customerRead(pool, config, token, action, input, targetId);
    } else if (action === "file") {
      const file = await downloadCardExport(
        pool,
        token,
        targetId!,
        exportId!,
        createCardArtifactStorage(),
      );
      headers.set("Content-Type", file.contentType);
      headers.set(
        "Content-Disposition",
        `attachment; filename="${file.filename}"`,
      );
      headers.set("Content-Length", String(file.bytes.byteLength));
      return new Response(Buffer.from(file.bytes), { headers });
    } else if (write) {
      const result = await cardsWrite(
        pool,
        config,
        token,
        action,
        input,
        targetId,
      );
      data = result.data;
      status = action === "create" ? 201 : action === "export" ? 202 : 200;
      if (action === "export") startAutomaticCardExports();
    } else
      data = await cardsRead(
        pool,
        config,
        token,
        action,
        input,
        targetId,
        exportId,
      );
    return Response.json(
      { data, serverTime: new Date().toISOString(), requestId },
      { status, headers },
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
