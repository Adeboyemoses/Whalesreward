import { afterAll, beforeAll, expect, it } from "vitest";
import { evidenceDatabase } from "../helpers/review-evidence-fixture";
import {
  operate,
  parseArguments,
  releaseDigest,
  formatResult,
} from "../../scripts/ops/review-evidence.mjs";
import { randomUUID } from "node:crypto";

let db: Awaited<ReturnType<typeof evidenceDatabase>>;
beforeAll(async () => {
  db = await evidenceDatabase();
}, 30000);
afterAll(async () => {
  await db?.close();
});
const checkEnvironment = async (_db: unknown, environment: string) => {
  if (environment !== "test") throw new Error("Wrong environment");
};
async function input(action = "activate", apply = false) {
  const station = randomUUID();
  await db.pool.query(
    "INSERT INTO station(id,code,name,timezone,version) VALUES($1,$2,'Operator fixture','Africa/Lagos',1)",
    [station, station],
  );
  return parseArguments([
    action,
    "--station",
    station,
    "--environment",
    "test",
    "--digest",
    releaseDigest,
    "--authorization",
    "WHR-114",
    ...(action === "activate"
      ? ["--activated-at", "2026-11-11T12:00:00Z"]
      : []),
    ...(apply ? ["--apply", "--expected-revision", "1"] : []),
  ]);
}
async function counts(station: string) {
  return Promise.all(
    ["review_evidence_approval", "review_evidence_configuration"].map(
      async (table) =>
        Number(
          (
            await db.pool.query(
              `SELECT count(*) FROM ${table} WHERE station_id=$1`,
              [station],
            )
          ).rows[0].count,
        ),
    ),
  );
}
it("dry run previews exact immutable rows and policy without writes", async () => {
  const request = await input();
  const result = await operate(db.pool, request, checkEnvironment);
  expect(result.policy.revision).toBe(1);
  expect(result.configuration.configuration).toEqual(result.policy);
  expect(result.approval?.id).toBe(result.policy.activation.approvalReference);
  expect(formatResult(result)).toContain(
    `WHR_REVIEW_EVIDENCE_POLICY=${JSON.stringify(result.policy)}`,
  );
  expect(await counts(request.stationId)).toEqual([0, 0]);
});
it("applies activation atomically and appends higher inactive and reactivation revisions", async () => {
  const request = await input("activate", true);
  const active = await operate(db.pool, request, checkEnvironment);
  const inactive = await operate(
    db.pool,
    {
      ...request,
      action: "deactivate",
      activatedAt: null,
      expectedRevision: 2,
    },
    checkEnvironment,
  );
  const reactivated = await operate(
    db.pool,
    { ...request, expectedRevision: 3 },
    checkEnvironment,
  );
  expect([
    active.policy.revision,
    inactive.policy.revision,
    reactivated.policy.revision,
  ]).toEqual([1, 2, 3]);
  expect(inactive.policy.activation).toEqual({
    state: "inactive",
    approvalReference: null,
    activatedAt: null,
  });
  expect(await counts(request.stationId)).toEqual([2, 3]);
  const stored = await db.pool.query(
    "SELECT configuration FROM review_evidence_configuration WHERE id=$1",
    [active.configuration.id],
  );
  expect(stored.rows[0].configuration).toEqual(active.policy);
  await expect(
    db.pool.query(
      "UPDATE review_evidence_configuration SET authorization_reference='changed' WHERE id=$1",
      [active.configuration.id],
    ),
  ).rejects.toThrow();
  await expect(
    db.pool.query("DELETE FROM review_evidence_approval WHERE id=$1", [
      active.approval!.id,
    ]),
  ).rejects.toThrow();
});
it("serializes concurrent activation and deactivation and refuses the stale authorized revision", async () => {
  const request = await input("activate", true);
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, (_, i) =>
      operate(
        db.pool,
        i % 2
          ? { ...request, action: "deactivate", activatedAt: null }
          : request,
        checkEnvironment,
      ),
    ),
  );
  expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((x) => x.status === "rejected")).toHaveLength(7);
  const count = await counts(request.stationId);
  expect(count[1]).toBe(1);
  expect(count[0]).toBeLessThanOrEqual(1);
});
it("rolls approval back when the configuration insert fails", async () => {
  const request = await input("activate", true);
  await db.pool.query(
    "CREATE FUNCTION reject_operator_config() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rejection'; END $$",
  );
  await db.pool.query(
    "CREATE TRIGGER reject_operator_config BEFORE INSERT ON review_evidence_configuration FOR EACH ROW EXECUTE FUNCTION reject_operator_config()",
  );
  try {
    await expect(operate(db.pool, request, checkEnvironment)).rejects.toThrow();
    expect(await counts(request.stationId)).toEqual([0, 0]);
  } finally {
    await db.pool.query(
      "DROP TRIGGER reject_operator_config ON review_evidence_configuration",
    );
  }
});
it("includes orphan approval revisions and refuses safe-integer exhaustion", async () => {
  const request = await input("activate", true);
  await db.pool.query(
    "INSERT INTO review_evidence_approval(id,release,digest,revision,station_id,environment,activated_at,authorization_reference) VALUES($1,'review-evidence-v1',$2,12,$3,'test',$4,'fixture')",
    [randomUUID(), releaseDigest, request.stationId, request.activatedAt],
  );
  expect(
    (
      await operate(
        db.pool,
        { ...request, expectedRevision: 13 },
        checkEnvironment,
      )
    ).policy.revision,
  ).toBe(13);
  await db.pool.query(
    "INSERT INTO review_evidence_approval(id,release,digest,revision,station_id,environment,activated_at,authorization_reference) VALUES($1,'review-evidence-v1',$2,9007199254740991,$3,'test',$4,'fixture')",
    [randomUUID(), releaseDigest, request.stationId, request.activatedAt],
  );
  await expect(operate(db.pool, request, checkEnvironment)).rejects.toThrow(
    "exhausted",
  );
  expect(await counts(request.stationId)).toEqual([3, 1]);
});
it("refuses digest and environment mismatches with no rows", async () => {
  const request = await input("activate", true);
  await expect(
    operate(db.pool, { ...request, digest: "a".repeat(64) }, checkEnvironment),
  ).rejects.toThrow();
  await expect(
    operate(
      db.pool,
      { ...request, environment: "production" },
      checkEnvironment,
    ),
  ).rejects.toThrow();
  expect(await counts(request.stationId)).toEqual([0, 0]);
});
it("does not reserve preview revisions or IDs", async () => {
  const request = await input();
  const preview = await operate(db.pool, request, checkEnvironment);
  await operate(
    db.pool,
    { ...request, apply: true, expectedRevision: 1 },
    checkEnvironment,
  );
  await expect(
    operate(
      db.pool,
      { ...request, apply: true, expectedRevision: 1 },
      checkEnvironment,
    ),
  ).rejects.toThrow("Revision changed");
  const applied = await operate(
    db.pool,
    { ...request, apply: true, expectedRevision: 2 },
    checkEnvironment,
  );
  expect(preview.policy.revision).toBe(1);
  expect(applied.policy.revision).toBe(2);
  expect(applied.configuration.id).not.toBe(preview.configuration.id);
});
