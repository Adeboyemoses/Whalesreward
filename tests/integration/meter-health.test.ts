import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomBytes } from "node:crypto";
import { healthResponse } from "../../src/server/modules/health/service";
import * as resolver from "../../src/server/modules/reviews/evidence-evaluator";
import { newId } from "../../src/server/lib/ids";
import { fixtureId } from "../helpers/sync-fixture";
import { activate, seedHistorical } from "../helpers/review-evidence-fixture";
import {
  meterDatabase,
  meterFixture,
  meterDecide,
  meterDenied,
  installMeterPolicy,
  profileVariant,
} from "../helpers/meter-fixture";
type Fixture = Awaited<ReturnType<typeof meterFixture>>;
let db: Awaited<ReturnType<typeof meterDatabase>>;
function configure(x: Fixture) {
  vi.stubEnv("WHR_ENV", "test");
  vi.stubEnv("WHR_REVIEW_EVIDENCE_POLICY", JSON.stringify(x.config));
  vi.stubEnv("WHR_METER_POLICY", JSON.stringify(x.meterPolicy));
  vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(32).toString("hex"));
  vi.stubEnv("BETTER_AUTH_URL", "https://meter.example.test");
}
async function call(
  x: Fixture,
  cookie = `__Host-whr-admin-session=${x.token}`,
  failure = false,
  probe?: () => Promise<void>,
) {
  const response = await healthResponse(
    new Request("https://meter.example.test/api/health?policies=true", {
      headers: { cookie, "x-role": "owner" },
    }),
    {
      pool: db.pool,
      probe:
        probe ??
        (async () => {
          if (failure) throw new Error("private-db-host-canary");
          await db.pool.query("SELECT 1");
        }),
    },
  );
  expect(response.status).toBe(failure ? 503 : 200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("vary")).toBe("Cookie");
  const result = await response.json();
  for (const value of [
    x.profile.id,
    x.profile.digest,
    x.profile.verificationReference,
    x.meterPolicy.digest,
    x.config.digest,
    "amountStepKobo",
    "quantityStep",
    "approvalReference",
    "private-db-host-canary",
    "WHR_METER_POLICY",
  ])
    expect(JSON.stringify(result)).not.toContain(value);
  return result;
}
function publicOnly(body: object) {
  expect(Object.keys(body).sort()).toEqual([
    "db",
    "fullyConfigured",
    "ok",
    "version",
  ]);
}

describe("MR-T1-20 PostgreSQL meter configuration readiness and protected health", () => {
  beforeAll(async () => {
    vi.stubEnv("WHR_ENV", "test");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    db = await meterDatabase();
  }, 30000);
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await db?.close();
  });
  it("MR-T1-20 complete current profile coverage reports configured without exposing profile values", async () => {
    const x = await meterFixture(db);
    configure(x);
    for (const fail of [false, true]) {
      const body = await call(x, undefined, fail);
      expect(body.policies.meter).toBe("configured");
      expect(body.policies.reviewEvidence).toBe("configured");
      expect(body.fullyConfigured).toBe(
        Object.values(body.policies).every((s) => s === "configured"),
      );
      publicOnly(await call(x, "", fail));
    }
  });
  it.each([
    "absent",
    "malformed",
    "inactive",
    "bad-digest",
    "unapproved",
    "bad-profile-digest",
    "bad-resolver-digest",
    "missing-resolver",
    "inactive-resolver",
    "profile-expired",
    "profile-future",
    "missing-pump",
    "wrong-precision",
  ])(
    "MR-T1-20 %s makes meter unconfigured independently of other flags",
    async (mode) => {
      const x = await meterFixture(db);
      configure(x);
      const p = structuredClone(x.meterPolicy);
      if (mode === "absent") vi.stubEnv("WHR_METER_POLICY", undefined);
      else if (mode === "malformed") vi.stubEnv("WHR_METER_POLICY", "{");
      else if (mode === "missing-resolver")
        vi.stubEnv("WHR_REVIEW_EVIDENCE_POLICY", undefined);
      else if (mode === "inactive-resolver")
        await activate(db.pool, x.f.stationId, 2, false);
      else if (
        ["profile-expired", "profile-future", "wrong-precision"].includes(mode)
      ) {
        const changed = profileVariant(
          x.profile,
          mode === "profile-expired"
            ? { validUntil: "2026-11-11T00:00:00Z" }
            : mode === "profile-future"
              ? { validFrom: "2099-01-01T00:00:00Z" }
              : { quantityPrecision: 4 },
        );
        const current = await installMeterPolicy(x, [changed], 2);
        vi.stubEnv("WHR_METER_POLICY", JSON.stringify(current));
      } else if (mode === "missing-pump") {
        await db.pool.query(
          "INSERT INTO pump(id,station_id,product_id,code,enabled,version) VALUES($1,$2,$3,'UNCOVERED',true,1)",
          [newId(), x.f.stationId, fixtureId(9)],
        );
      } else {
        if (mode === "inactive")
          p.activation = {
            state: "inactive",
            approvalReference: null,
            activatedAt: null,
          };
        if (mode === "bad-digest") p.digest = "a".repeat(64);
        if (mode === "unapproved" && p.activation.state === "active")
          p.activation.approvalReference = newId();
        if (mode === "bad-profile-digest")
          p.profiles[0]!.digest = "b".repeat(64);
        if (mode === "bad-resolver-digest") p.resolver.digest = "c".repeat(64);
        vi.stubEnv("WHR_METER_POLICY", JSON.stringify(p));
      }
      expect((await call(x)).policies.meter).toBe("unconfigured");
    },
  );
  it("MR-T1-20 healthy current coverage cannot authorize an uncovered older sale", async () => {
    const x = await meterFixture(db);
    const policy = await installMeterPolicy(
      x,
      [profileVariant(x.profile, { validFrom: "2026-11-12T00:00:00Z" })],
      2,
    );
    x.meterPolicy = policy;
    x.env.WHR_METER_POLICY = JSON.stringify(policy);
    configure(x);
    expect((await call(x)).policies.meter).toBe("configured");
    await meterDenied(
      x,
      () => meterDecide(x),
      "meter_policy_unconfigured",
      409,
    );
  });
  it.each([
    "public",
    "attendant",
    "recovery",
    "first-password",
    "revoked",
    "no-settings",
    "disabled",
    "expired",
    "malformed",
  ])(
    "MR-T1-20 %s receives aggregate only including database failure",
    async (mode) => {
      const x = await meterFixture(db);
      configure(x);
      let cookie = `__Host-whr-admin-session=${x.token}`;
      if (mode === "public") cookie = "";
      if (mode === "attendant")
        cookie = `__Host-whr-attendant-session=${x.token}`;
      if (mode === "recovery")
        cookie = `__Host-whr-recovery-session=${x.token}`;
      if (mode === "malformed") cookie = "__Host-whr-admin-session=not-a-token";
      if (mode === "first-password")
        await seedHistorical(
          db.pool,
          "auth_session",
          "UPDATE auth_session SET access_scope='first_password' WHERE user_id=$1",
          [fixtureId(2)],
        );
      if (mode === "revoked")
        await db.pool.query(
          "UPDATE auth_session SET revoked_at=clock_timestamp() WHERE user_id=$1",
          [fixtureId(2)],
        );
      if (mode === "expired")
        await seedHistorical(
          db.pool,
          "auth_session",
          "UPDATE auth_session SET created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
          [fixtureId(2)],
        );
      if (mode === "disabled")
        await db.pool.query("UPDATE auth_user SET enabled=false WHERE id=$1", [
          fixtureId(2),
        ]);
      if (mode === "no-settings")
        await db.pool.query(
          "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='settings'",
          [fixtureId(1)],
        );
      try {
        for (const fail of [false, true])
          publicOnly(await call(x, cookie, fail));
      } finally {
        await db.pool.query("UPDATE auth_user SET enabled=true WHERE id=$1", [
          fixtureId(2),
        ]);
        if (mode === "no-settings")
          await db.pool.query(
            "INSERT INTO role_permission(role_id,permission_code) VALUES($1,'settings') ON CONFLICT DO NOTHING",
            [fixtureId(1)],
          );
      }
    },
  );
  it("MR-T1-20 revocation before response removes diagnostics without altering meter configuration", async () => {
    const x = await meterFixture(db);
    configure(x);
    const body = await call(x, undefined, false, async () => {
      await db.pool.query(
        "UPDATE auth_session SET revoked_at=clock_timestamp() WHERE user_id=$1",
        [fixtureId(2)],
      );
    });
    publicOnly(body);
    expect(
      (await db.pool.query("SELECT count(*)::int n FROM meter_configuration"))
        .rows[0].n,
    ).toBe(1);
  });
  it("MR-T1-20 unavailable resolver evaluator fails closed despite valid approved records", async () => {
    const x = await meterFixture(db);
    configure(x);
    const spy = vi
      .spyOn(resolver, "reviewEvidenceV1Installed")
      .mockReturnValue(false);
    try {
      const body = await call(x);
      expect(body.policies.meter).toBe("unconfigured");
      expect(body.policies.reviewEvidence).toBe("unconfigured");
    } finally {
      spy.mockRestore();
    }
  });
  it("MR-T1-20 health reads configuration only without inspecting sales or mutating domain records", async () => {
    const x = await meterFixture(db);
    configure(x);
    const spy = vi.spyOn(db.pool, "query");
    try {
      expect((await call(x)).policies.meter).toBe("configured");
      const statements = spy.mock.calls
        .map(([q]) =>
          typeof q === "string" ? q : ((q as { text?: string }).text ?? ""),
        )
        .join("\n");
      expect(statements).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
      expect(statements).not.toMatch(
        /\b(?:FROM|JOIN)\s+(?:purchase|purchase_revision|photo_asset|sale_decision|meter_evaluation)\b/i,
      );
    } finally {
      spy.mockRestore();
    }
  });
});
