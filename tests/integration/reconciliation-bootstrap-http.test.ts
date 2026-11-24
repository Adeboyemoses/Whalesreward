import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { giveawayFixture } from "../helpers/giveaway-fixture";
import { config, fixtureId } from "../helpers/cards-adversarial-fixture";
import { newId } from "../../src/server/lib/ids";
import * as databaseModule from "../../src/server/lib/db";
import { healthResponse } from "../../src/server/modules/health/service";
import { handleGiveaway } from "../../src/server/modules/giveaway/http";
import { handleProjection } from "../../src/server/modules/giveaway/projection-http";
import { handlePhones } from "../../src/server/modules/giveaway/phone-http";
import { seedHistorical } from "../helpers/review-evidence-fixture";

let f: Awaited<ReturnType<typeof giveawayFixture>>,
  server: Server,
  origin: string;
beforeEach(async () => {
  // The fixture no longer inserts either reconciliation registry definitions or
  // station bindings. Migration + station bootstrap alone must configure it.
  f = await giveawayFixture();
  vi.spyOn(databaseModule, "database").mockReturnValue(f.pool);
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const request = new Request(origin + req.url, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
    });
    const path = new URL(request.url).pathname;
    const response =
      path === "/api/health"
        ? await healthResponse(request, {
            pool: f.pool,
            probe: async () => {
              await f.pool.query("SELECT 1");
            },
          })
        : path.endsWith("/readiness")
          ? await handleGiveaway(request, "readiness", f.campaignId)
          : path.endsWith("/checklist")
            ? await handleProjection(request, "checklist", f.campaignId)
            : await handlePhones(
                request,
                path.endsWith("/census") ? "census" : "certify",
                f.campaignId,
              );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("HTTP fixture unavailable");
  origin = `http://127.0.0.1:${address.port}`;
}, 30000);
afterEach(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  vi.restoreAllMocks();
  await f?.close();
});
async function call(path: string, body?: unknown, authorized = true) {
  const response = await fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: {
      origin: config.origin,
      ...(authorized ? { cookie: `__Host-whr-admin-session=${f.token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  expect(response.headers.get("cache-control")).toBe("no-store");
  return { response, body: await response.json() };
}
const path = (suffix: string) =>
  `/api/admin/giveaway/${f.campaignId}/${suffix}`;
it("WHR-229 migration-configured real HTTP health, readiness and checklist permit a full phone census and check", async () => {
  const health = await call("/api/health");
  expect(health.response.status).toBe(200);
  expect(health.body.policies.reconciliation).toBe("configured");
  expect(health.body.fullyConfigured).toBe(false);
  const publicHealth = await call("/api/health", undefined, false);
  expect(publicHealth.body).not.toHaveProperty("policies");
  const readiness = await call(path("readiness"));
  expect(readiness.response.status).toBe(200);
  expect(readiness.body.data.blockers).not.toContain(
    "reconciliation_policy_unconfigured",
  );
  expect(readiness.body.data.blockers).toContain("phone_check_required");
  expect(
    (await call(path("checklist"), undefined, false)).response.status,
  ).toBe(401);
  const census = await call(path("census"), {
    operationId: newId(),
    kind: "initial",
    reason: "Fictional physical census",
    ...(await f.guard()),
    expectedCensusVersion: 1,
    phones: [
      {
        label: "Fictional handset",
        attendantIds: (
          await f.pool.query("SELECT DISTINCT attendant_id FROM assignment")
        ).rows.map((r) => r.attendant_id),
      },
    ],
  });
  expect(census.response.status, JSON.stringify(census.body)).toBe(201);
  const row = (
    await f.pool.query(
      "SELECT content FROM giveaway_phone_census WHERE campaign_id=$1",
      [f.campaignId],
    )
  ).rows[0].content;
  const check = await call(path("certify"), {
    operationId: newId(),
    kind: "initial",
    reason: "Fictional phone inspection",
    ...(await f.guard()),
    expectedCensusVersion: 2,
    entries: row.phones.map((phone: { id: string; version: number }) => ({
      phoneId: phone.id,
      expectedPhoneVersion: phone.version,
      result: "empty",
      exclusionId: null,
    })),
  });
  expect(check.response.status, JSON.stringify(check.body)).toBe(201);
  const checklist = await call(path("checklist"));
  expect(checklist.response.status).toBe(200);
  expect(checklist.body.data.checks).toHaveLength(9);
  expect(checklist.body.data.readiness.blockers).not.toContain(
    "reconciliation_policy_unconfigured",
  );
  expect(checklist.body.data.readiness.blockers).not.toContain(
    "phone_check_required",
  );
  expect(JSON.stringify(checklist.body.data.checks)).not.toContain(
    "policy_missing",
  );
  expect(
    (
      await f.pool.query(
        "SELECT policy_version FROM station_reconciliation_policy WHERE station_id=$1",
        [fixtureId(8)],
      )
    ).rows,
  ).toEqual([{ policy_version: "reconciliation-v1" }]);
});
it.each([
  "binding",
  "evaluator_identity",
  "semantics_digest",
  "approval_reference",
  "partial_uploads",
])(
  "WHR-229 %s mismatch stays unconfigured in real HTTP health and blocks checklist certification",
  async (field) => {
    if (field === "binding")
      await seedHistorical(
        f.pool,
        "station_reconciliation_policy",
        "DELETE FROM station_reconciliation_policy",
      );
    else {
      if (field === "partial_uploads")
        await f.pool.query(
          "ALTER TABLE reconciliation_policy_definition DROP CONSTRAINT reconciliation_policy_definition_partial_uploads_check",
        );
      await seedHistorical(
        f.pool,
        "reconciliation_policy_definition",
        `UPDATE reconciliation_policy_definition SET ${field}=$1`,
        [field === "semantics_digest" ? "a".repeat(64) : "unapproved"],
      );
    }
    const health = await call("/api/health");
    expect(health.response.status).toBe(200);
    expect(health.body.policies.reconciliation).toBe("unconfigured");
    const checklist = await call(path("checklist"));
    expect(checklist.response.status).toBe(200);
    expect(checklist.body.data.readiness.blockers).toContain(
      "reconciliation_policy_unconfigured",
    );
    expect(JSON.stringify(checklist.body.data.checks)).toContain(
      "policy_missing",
    );
    const before = (
      await f.pool.query("SELECT count(*)::text n FROM giveaway_phone_census")
    ).rows;
    const census = await call(path("census"), {
      operationId: newId(),
      kind: "initial",
      reason: "Fictional unavailable policy",
      ...(await f.guard()),
      expectedCensusVersion: 1,
      phones: [{ label: "Fictional handset", attendantIds: [fixtureId(6)] }],
    });
    expect(census.response.status).toBe(409);
    expect(census.body.error.code).toBe("reconciliation_policy_unconfigured");
    expect(
      (await f.pool.query("SELECT count(*)::text n FROM giveaway_phone_census"))
        .rows,
    ).toEqual(before);
  },
);
