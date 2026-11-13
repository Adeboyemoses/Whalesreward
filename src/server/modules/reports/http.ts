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
import { requirePermission } from "../../lib/authz";
import { readReport, createReportExport, readReportExport } from "./service";
import { readOverview } from "../overview/service";
import { downloadReportExport } from "./exports";
import { reportAuthority } from "./data";
import { createReportArtifactStorage } from "../../adapters/report-artifacts";
import { startAutomaticReportExports } from "./runtime";
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
export async function handleReports(
  request: Request,
  action: "query" | "sources" | "export" | "status" | "file" | "overview",
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
    const config = adminConfig(),
      pool = database(),
      token = cookieToken(request),
      post = ["query", "sources", "export"].includes(action);
    if (
      request.method !== (post ? "POST" : "GET") ||
      new URL(request.url).search
    )
      throw new AuthError("invalid_request", 400);
    if (id) authId.parse(id);
    if (post) enforceOrigin(request, config.origin);
    const actor = await transaction(pool, async (db) => {
      const { actor } = await reportAuthority(
        db,
        token,
        action === "overview" ? "overview" : "reports",
      );
      if (["export", "status", "file"].includes(action))
        requirePermission(actor, "reportExport");
      return actor;
    });
    const exported = action === "export" || action === "file";
    await consumeLimits(pool, config.secret, [
      {
        key: `m2-${exported ? "export" : "read"}-ip:${clientIp(request, config.trustedIpHeader)}`,
        capacity: exported ? 20 : 180,
      },
      {
        key: `m2-${exported ? "export" : "read"}-account:${actor.user_id}`,
        capacity: exported ? 5 : 60,
      },
    ]);
    let data: unknown,
      status = 200;
    if (action === "query" || action === "sources")
      data = await readReport(pool, config, token, action, await body(request));
    else if (action === "overview")
      data = await readOverview(pool, config, token);
    else if (action === "export") {
      const result = await createReportExport(
        pool,
        config,
        token,
        await body(request),
      );
      data = result.data;
      status = result.replayed ? 200 : 202;
      startAutomaticReportExports();
    } else if (action === "status")
      data = await readReportExport(pool, token, id!);
    else {
      const file = await downloadReportExport(
        pool,
        token,
        id!,
        createReportArtifactStorage(),
      );
      headers.set("Content-Type", file.contentType);
      headers.set(
        "Content-Disposition",
        `attachment; filename="${file.filename}"`,
      );
      headers.set("Content-Length", String(file.bytes.byteLength));
      return new Response(Buffer.from(file.bytes), { headers });
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
