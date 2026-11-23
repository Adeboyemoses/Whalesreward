import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { evidenceDatabase } from "../helpers/review-evidence-fixture";
import { reviewFixtureHarness } from "../helpers/review-fixture";
import { fixtureId } from "../helpers/sync-fixture";
import { monitoringResponse } from "../../src/server/modules/monitoring/http";
import { withOperationalTelemetry } from "../../src/server/modules/monitoring/telemetry";
import { healthResponse } from "../../src/server/modules/health/service";
let fixture: Awaited<ReturnType<typeof evidenceDatabase>>,
  token: string,
  server: Server,
  origin: string;
const secret = "fictional-monitoring-test-secret-32-bytes";
beforeAll(async () => {
  fixture = await evidenceDatabase();
  token = await reviewFixtureHarness(fixture.pool).adminToken();
  vi.stubEnv("WHR_ENV", "staging");
  vi.stubEnv("BETTER_AUTH_SECRET", secret);
  vi.stubEnv("BETTER_AUTH_URL", "https://monitoring.example.test");
  vi.stubEnv("EMAIL_PROVIDER", "noop");
  server = createServer(async (req, res) => {
    const request = new Request(origin + req.url, {
      method: req.method,
      headers: req.headers as Record<string, string>,
    });
    const response = await withOperationalTelemetry(async (request: Request) =>
      req.url?.startsWith("/api/health")
        ? healthResponse(request, {
            pool: fixture.pool,
            probe: async () => {
              await fixture.pool.query("SELECT 1");
            },
          })
        : monitoringResponse(
            request,
            req.url?.includes("deploy-check"),
            fixture.pool,
          ),
    )(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("HTTP fixture failed");
  origin = `http://127.0.0.1:${address.port}`;
}, 30000);
afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await fixture?.close();
  vi.unstubAllEnvs();
});
async function call(path = "/api/admin/monitoring", authorized = true) {
  return fetch(origin + path, {
    headers: authorized ? { cookie: `__Host-whr-admin-session=${token}` } : {},
    signal: AbortSignal.timeout(10000),
  });
}
it("real HTTP denies unauthenticated callers and keeps public health exactly four fields", async () => {
  expect((await call(undefined, false)).status).toBe(401);
  const publicHealth = await (await call("/api/health", false)).json();
  expect(Object.keys(publicHealth).sort()).toEqual([
    "db",
    "fullyConfigured",
    "ok",
    "version",
  ]);
});
it("real PostgreSQL count-only snapshot detects never-run jobs and exposes no business records or config values", async () => {
  const response = await call();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("vary")).toBe("Cookie");
  const { data } = await response.json();
  expect(data.jobs).toHaveLength(2);
  for (const job of data.jobs)
    expect(job.alerts).toContain("missing_heartbeat");
  expect(data.api.scope).toBe("process");
  expect(data.queues.pendingUploads.count).toBe(0);
  expect(data.missingPolicies).toContain("duplicateWindow");
  expect(JSON.stringify(data)).not.toMatch(
    /fictional-monitoring|example\.test|object_key|lease_owner|cursor|08012345678/,
  );
});
it("deploy check names unconfigured policies and lookup readiness without values or enabling them", async () => {
  const before = await fixture.pool.query(
    "SELECT count(*)::text AS n FROM audit_event",
  );
  const response = await call("/api/admin/monitoring/deploy-check");
  expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(data.ready).toBe(false);
  expect(data.missingPolicies).toContain("duplicateWindow");
  expect(data.lookupReceiptIssuance).toBe("unconfigured");
  expect(data.jobs).toBeUndefined();
  expect(
    await fixture.pool.query("SELECT count(*)::text AS n FROM audit_event"),
  ).toMatchObject({ rows: before.rows });
});
it("durable failed and stale schedules survive a monitoring reader restart", async () => {
  await fixture.pool.query(
    "INSERT INTO maintenance_job(job,scope,last_outcome,next_due_at,heartbeat_at,error_code) VALUES('orphans','primary','failed',clock_timestamp()-interval '11 minutes',clock_timestamp()-interval '12 minutes','storage_unavailable')",
  );
  const { data } = await (await call()).json();
  const job = data.jobs.find((j: { job: string }) => j.job === "orphans");
  expect(job.alerts).toEqual(["failed_run", "missed_schedule"]);
  expect(job.errorCode).toBe("storage_unavailable");
});
it("live permission revocation removes monitoring and deploy-check access immediately", async () => {
  await fixture.pool.query("UPDATE auth_user SET enabled=false WHERE id=$1", [
    fixtureId(2),
  ]);
  for (const path of [
    "/api/admin/monitoring",
    "/api/admin/monitoring/deploy-check",
  ]) {
    const response = await call(path);
    expect([401, 403]).toContain(response.status);
    const body = await response.text();
    expect(body).not.toContain("missingPolicies");
    expect(body).not.toContain("jobs");
  }
});
