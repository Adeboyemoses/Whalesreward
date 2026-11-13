import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  reportsFixture,
  config,
  memoryArtifacts,
} from "../helpers/reports-adversarial-fixture";
import {
  createReportExport,
  readReport,
} from "../../src/server/modules/reports/service";
import { prepareReportExport } from "../../src/server/modules/reports/exports";
import { reportSchema } from "../../src/shared/contracts/reports";
import { newId } from "../../src/server/lib/ids";
import * as artifacts from "../../src/server/adapters/report-artifacts";
let f: Awaited<ReturnType<typeof reportsFixture>>;
let handle: typeof import("../../src/server/modules/reports/http").handleReports;
function request(
  action: "query" | "sources" | "export" | "status" | "file" | "overview",
  token = f.admin.token,
  body: unknown = f.filters,
  origin = config.origin,
  id?: string,
) {
  const post = ["query", "sources", "export"].includes(action);
  return handle(
    new Request(`${config.origin}/api/admin/reports/${action}`, {
      method: post ? "POST" : "GET",
      headers: {
        origin,
        "content-type": "application/json",
        cookie: `__Host-whr-admin-session=${token}`,
        "x-test-ip": "198.51.100.10",
      },
      ...(post
        ? { body: typeof body === "string" ? body : JSON.stringify(body) }
        : {}),
    }),
    action,
    id,
  );
}
async function makeExport() {
  const report = reportSchema.parse(
    await readReport(f.pool, config, f.admin.token, "query", f.filters),
  );
  return (
    await createReportExport(f.pool, config, f.admin.token, {
      operationId: newId(),
      format: "pdf",
      filters: f.filters,
      expectedDataVersion: report.dataVersion,
    })
  ).data;
}
describe("WO-core-13 real PostgreSQL HTTP boundaries", () => {
  beforeAll(async () => {
    f = await reportsFixture();
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    handle = (await import("../../src/server/modules/reports/http"))
      .handleReports;
  }, 30000);
  afterAll(async () => {
    await (await import("../../src/server/lib/db")).database().end();
    await f?.close();
    vi.unstubAllEnvs();
  });
  it("failed, pending and expired exports keep their nonretryable status even when artifact storage is unavailable", async () => {
    const failed = await makeExport(),
      pending = await makeExport(),
      expired = await makeExport();
    await f.pool.query(
      "UPDATE report_export SET status='failed',failure_code='preparation_failed' WHERE id=$1",
      [failed.id],
    );
    await prepareReportExport(
      f.pool,
      { storage: memoryArtifacts() },
      expired.id,
    );
    await f.pool.query(
      "UPDATE report_export SET prepared_at=statement_timestamp()-interval '25 hours',expires_at=statement_timestamp()-interval '1 hour' WHERE id=$1",
      [expired.id],
    );
    const spy = vi
      .spyOn(artifacts, "createReportArtifactStorage")
      .mockImplementation(() => {
        throw new Error("Storage deliberately unconfigured");
      });
    try {
      for (const [id, status, code] of [
        [failed.id, 409, "export_failed"],
        [pending.id, 409, "export_not_ready"],
        [expired.id, 410, "export_expired"],
      ] as const) {
        const response = await request(
          "file",
          f.admin.token,
          {},
          config.origin,
          id,
        );
        expect(response.status).toBe(status);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toMatchObject({
          error: { code, retryable: false },
        });
      }
    } finally {
      spy.mockRestore();
    }
  });
  it("POST reads reject foreign origins and strict malformed or oversized requests", async () => {
    const foreign = await request(
      "query",
      f.admin.token,
      f.filters,
      "https://foreign.example.test",
    );
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({
      error: { code: "origin_rejected", retryable: false },
    });
    const unknown = await request("query", f.admin.token, {
      ...f.filters,
      stationId: newId(),
    });
    expect(unknown.status).toBe(400);
    const impossible = await request("query", f.admin.token, {
      ...f.filters,
      from: "2026-02-30",
    });
    expect(impossible.status).toBe(422);
    expect(await impossible.json()).toMatchObject({
      error: { code: "date_invalid", retryable: false },
    });
    const reversed = await request("query", f.admin.token, {
      ...f.filters,
      from: "2026-11-13",
      to: "2026-11-12",
    });
    expect(reversed.status).toBe(422);
    expect(await reversed.json()).toMatchObject({
      error: { code: "date_range_invalid" },
    });
    const range = await request("query", f.admin.token, {
      ...f.filters,
      from: "2025-01-01",
      to: "2026-11-13",
    });
    expect(range.status).toBe(422);
    expect(await range.json()).toMatchObject({
      error: { code: "range_too_large", retryable: false },
    });
    const huge = await request(
      "query",
      f.admin.token,
      '{"x":"' + "a".repeat(33000) + '"}',
    );
    expect(huge.status).toBe(413);
    expect(await huge.json()).toMatchObject({
      error: { code: "request_too_large", retryable: false },
    });
  });
  it("first-password and disabled live sessions cannot read reports or overview", async () => {
    const limited = await f.actor(["reports", "overview"], true);
    const denied = await request("query", limited.token);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({
      error: { code: "password_change_required", retryable: false },
    });
    const disabled = await f.actor(["reports", "overview"]);
    await f.pool.query("UPDATE auth_user SET enabled=false WHERE id=$1", [
      disabled.userId,
    ]);
    expect((await request("overview", disabled.token)).status).toBe(401);
  });
});
