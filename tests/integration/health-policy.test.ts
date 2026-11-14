import { readFile, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import pg from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { healthResponse } from "../../src/server/modules/health/service";
import { policyNames } from "../../src/server/modules/health/policies";
import { digest } from "../../src/server/modules/auth/crypto";
import { newId } from "../../src/server/lib/ids";
import { transaction } from "../../src/server/lib/transaction";
import { activate } from "../helpers/review-evidence-fixture";
import * as evaluator from "../../src/server/modules/reviews/evidence-evaluator";
import { securityLock } from "../../src/server/lib/authz";

const schema = `health_policy_${randomBytes(6).toString("hex")}`;
const root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pool: pg.Pool;
const origin = "https://health.example.test";
const secret = randomBytes(32).toString("hex");
const adminCookie = (token: string) => `__Host-whr-admin-session=${token}`;
async function actor(state = "full") {
  const user = newId(),
    admin = newId(),
    role = newId(),
    session = newId(),
    token = randomBytes(32).toString("hex");
  await pool.query(
    "INSERT INTO role(id,name,is_owner,enabled,version) VALUES($1,$2,false,true,1)",
    [role, `Fictional ${role}`],
  );
  await pool.query(
    "INSERT INTO role_permission(role_id,permission_code) VALUES($1,'settings')",
    [role],
  );
  await pool.query(
    "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'admin',$2,$2,'Ada Williams',true,1,false,clock_timestamp())",
    [user, `fictional.${user}`],
  );
  await pool.query(
    "INSERT INTO admin(id,user_id,admin_code,email_normalized,role_id,version) VALUES($1,$2,$3,$4,$5,1)",
    [admin, user, `TEST-${admin}`, `${admin}@example.com`, role],
  );
  await pool.query(
    "INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at,created_at,access_scope) VALUES($1,$2,$3,clock_timestamp()+($4::text)::interval,1,clock_timestamp(),clock_timestamp()-interval '2 hours',$5)",
    [
      session,
      user,
      digest(token),
      state === "expired" ? "-1 hour" : "1 hour",
      state === "first-password" ? "first_password" : "full",
    ],
  );
  return { user, admin, role, session, token };
}
async function call(
  cookie?: string,
  failure = false,
  probe?: () => Promise<void>,
) {
  const response = await healthResponse(
    new Request(`${origin}/api/health?policies=true`, {
      headers: {
        ...(cookie ? { cookie } : {}),
        "x-role": "owner",
        "x-health-policies": "true",
      },
    }),
    {
      pool,
      probe:
        probe ??
        (async () => {
          if (failure) throw new Error("private-db-canary");
          await pool.query("SELECT 1");
        }),
    },
  );
  const body = await response.json();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("vary")).toBe("Cookie");
  expect(response.status).toBe(failure ? 503 : 200);
  expect(body).toMatchObject({
    ok: !failure,
    db: failure ? "unavailable" : "ok",
    fullyConfigured: false,
  });
  expect(body).not.toHaveProperty("cardPrint");
  for (const word of [
    secret,
    "private",
    "pageWidthMm",
    "EMAIL_PROVIDER",
    "health.example.test",
    "ng-mobile-v1",
  ])
    expect(JSON.stringify(body)).not.toContain(word);
  return body;
}
function expectPublic(body: Record<string, unknown>) {
  expect(Object.keys(body).sort()).toEqual([
    "db",
    "fullyConfigured",
    "ok",
    "version",
  ]);
}

describe("WHR-100 I-07/I-09 policy health authorization", () => {
  beforeAll(async () => {
    await root.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set("options", `-c search_path=${schema},public`);
    pool = new pg.Pool({
      connectionString: url.toString(),
      max: 2,
      connectionTimeoutMillis: 1500,
      statement_timeout: 1500,
      lock_timeout: 1000,
      query_timeout: 2000,
    });
    const migrations = new URL("../../prisma/migrations/", import.meta.url);
    for (const dir of (await readdir(migrations, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name)))
      await pool.query(
        await readFile(
          new URL(`${dir.name}/migration.sql`, migrations),
          "utf8",
        ),
      );
    await pool.query(
      await readFile(
        new URL("../../prisma/fixtures.sql", import.meta.url),
        "utf8",
      ),
    );
  });
  beforeEach(() => {
    vi.stubEnv("WHR_REVIEW_EVIDENCE_POLICY", undefined);
    vi.stubEnv("WHR_ENV", "staging");
    vi.stubEnv("BETTER_AUTH_SECRET", secret);
    vi.stubEnv("BETTER_AUTH_URL", origin);
    vi.stubEnv("WHR_ADMIN_RECEIPT_KEYS", undefined);
    vi.stubEnv("EMAIL_PROVIDER", "noop");
    vi.stubEnv("WHR_PHONE_POLICY", "ng-mobile-v1");
    vi.stubEnv(
      "WHR_CARD_PRINT_LAYOUT",
      '{"pageWidthMm":210,"pageHeightMm":297,"cardWidthMm":85.6,"cardHeightMm":54,"marginMm":10,"gapMm":2}',
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await pool?.end();
    await root.query(`DROP SCHEMA ${schema} CASCADE`);
    await root.end();
  });

  it.each([false, true])(
    "only a current full admin with settings gets exact policy names, even with failed probe=%s",
    async (failure) => {
      const a = await actor();
      const before = (
        await pool.query("SELECT * FROM auth_session WHERE id=$1", [a.session])
      ).rows;
      const body = await call(adminCookie(a.token), failure);
      expect(Object.keys(body).sort()).toEqual([
        "db",
        "fullyConfigured",
        "ok",
        "policies",
        "version",
      ]);
      expect(Object.keys(body.policies)).toEqual(policyNames);
      expect(body.policies).toEqual({
        auth: "configured",
        delivery: "unconfigured",
        duplicateWindow: "unconfigured",
        reviewEvidence: "unconfigured",
        delegation: "configured",
        phone: "configured",
        meter: "unconfigured",
        phoneVerification: "unconfigured",
        recovery: "unconfigured",
        reconciliation: "unconfigured",
        timing: "configured",
        cardPrint: "configured",
      });
      expect(
        (
          await pool.query("SELECT * FROM auth_session WHERE id=$1", [
            a.session,
          ])
        ).rows,
      ).toEqual(before);
      expectPublic(await call(undefined, failure));
    },
  );
  it.each([
    "first-password",
    "must-change",
    "expired",
    "idle",
    "revoked",
    "auth-version",
    "disabled-account",
    "disabled-role",
    "no-settings",
  ])(
    "%s cannot read named policies on success or database failure",
    async (state) => {
      await activePolicy();
      const a = await actor(state);
      if (state === "must-change")
        await pool.query(
          "UPDATE auth_user SET must_change_password=true WHERE id=$1",
          [a.user],
        );
      if (state === "idle")
        await pool.query(
          "UPDATE auth_session SET last_activity_at=clock_timestamp()-interval '1 hour' WHERE id=$1",
          [a.session],
        );
      if (state === "revoked")
        await pool.query(
          "UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1",
          [a.session],
        );
      if (state === "auth-version")
        await pool.query(
          "UPDATE auth_user SET auth_version=auth_version+1 WHERE id=$1",
          [a.user],
        );
      if (state === "disabled-account")
        await pool.query("UPDATE auth_user SET enabled=false WHERE id=$1", [
          a.user,
        ]);
      if (state === "disabled-role")
        await pool.query(
          "UPDATE role SET enabled=false,version=version+1 WHERE id=$1",
          [a.role],
        );
      if (state === "no-settings")
        await pool.query("DELETE FROM role_permission WHERE role_id=$1", [
          a.role,
        ]);
      for (const failure of [false, true])
        expectPublic(await call(adminCookie(a.token), failure));
    },
  );
  it("attendant, recovery, malformed, duplicate and unknown cookies never select named policies", async () => {
    await activePolicy();
    const a = await actor();
    const attendantToken = randomBytes(32).toString("hex");
    await pool.query(
      "INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at) VALUES($1,'019a5000-0000-7000-8000-000000000003',$2,clock_timestamp()+interval '1 hour',1,clock_timestamp())",
      [newId(), digest(attendantToken)],
    );
    for (const cookie of [
      `__Host-whr-session=${attendantToken}`,
      adminCookie(attendantToken),
      `__Host-whr-recovery=${a.token}`,
      adminCookie("bad-token"),
      adminCookie(randomBytes(32).toString("hex")),
      `${adminCookie(a.token)}; ${adminCookie(a.token)}`,
    ])
      for (const failure of [false, true])
        expectPublic(await call(cookie, failure));
  });
  it("permission revoked while the probe is pending is checked before response", async () => {
    await activePolicy();
    const a = await actor();
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const result = call(adminCookie(a.token), false, async () => {
      entered();
      await blocked;
    });
    await started;
    await transaction(pool, async (db) => {
      await securityLock(db);
      await db.query(
        "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='settings'",
        [a.role],
      );
    });
    release();
    expectPublic(await result);
  });
  it("missing auth configuration cannot authorize diagnostics, while malformed unrelated delivery stays isolated", async () => {
    const a = await actor();
    vi.stubEnv("EMAIL_PROVIDER", "private-invalid-canary");
    expect((await call(adminCookie(a.token))).policies).toMatchObject({
      auth: "configured",
      delivery: "unconfigured",
    });
    vi.stubEnv("BETTER_AUTH_SECRET", undefined);
    expectPublic(await call(adminCookie(a.token)));
    vi.stubEnv("BETTER_AUTH_SECRET", secret);
    vi.stubEnv("WHR_ENV", "production");
    expectPublic(await call(adminCookie(a.token)));
  });
  it.each([
    ["WHR_ENV", "prod"],
    ["WHR_ENV", ""],
    ["WHR_ENV", "staging "],
    ["WHR_ENV", "STAGING"],
    ["NODE_ENV", "prod"],
    ["NODE_ENV", ""],
  ])(
    "WHR-100 malformed %s=%j denies named health to a valid privileged session",
    async (key, value) => {
      const a = await actor();
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv(key, value);
      for (const failure of [false, true]) {
        const body = await call(adminCookie(a.token), failure);
        expect(body.fullyConfigured).toBe(false);
        expectPublic(body);
      }
    },
  );
  it("P-24 configured duplicate window is named only in protected health and hides its threshold and version", async () => {
    vi.stubEnv("DUPLICATE_WINDOW_STATION_ID", newId());
    vi.stubEnv(
      "DUPLICATE_WINDOW_POLICY",
      JSON.stringify({ version: 789, windowSeconds: 600 }),
    );
    const a = await actor(),
      protectedBody = await call(adminCookie(a.token));
    expect(protectedBody.policies.duplicateWindow).toBe("configured");
    expect(JSON.stringify(protectedBody)).not.toContain("windowSeconds");
    expect(JSON.stringify(protectedBody)).not.toContain("789");
    expectPublic(await call());
    vi.stubEnv("DUPLICATE_WINDOW_STATION_ID", undefined);
    expect((await call(adminCookie(a.token))).policies.duplicateWindow).toBe(
      "unconfigured",
    );
  });
  async function activePolicy() {
    vi.stubEnv("WHR_ENV", "test");
    const station = newId();
    await pool.query(
      "INSERT INTO station(id,code,name,timezone,version) VALUES($1,$2,'Fictional health station','Africa/Lagos',1)",
      [station, `HEALTH-${station}`],
    );
    const policy = await activate(pool, station);
    vi.stubEnv("WHR_REVIEW_EVIDENCE_POLICY", JSON.stringify(policy));
    return policy;
  }
  it("RE-20 approved active matching runtime configuration reports only twelve statuses without enabling meter or revealing policy identity", async () => {
    const policy = await activePolicy(),
      a = await actor();
    for (const failure of [false, true]) {
      const body = await call(adminCookie(a.token), failure);
      expect(Object.keys(body.policies).sort()).toEqual([
        "auth",
        "cardPrint",
        "delegation",
        "delivery",
        "duplicateWindow",
        "meter",
        "phone",
        "phoneVerification",
        "reconciliation",
        "recovery",
        "reviewEvidence",
        "timing",
      ]);
      expect(body.policies.reviewEvidence).toBe("configured");
      expect(body.policies.meter).toBe("unconfigured");
      expect(body.fullyConfigured).toBe(
        Object.values(body.policies).every((s) => s === "configured"),
      );
      for (const value of [
        policy.release,
        policy.digest,
        policy.scope.stationId,
        policy.activation.approvalReference!,
        "approvalReference",
        "activatedAt",
        "authorization_reference",
      ])
        expect(JSON.stringify(body)).not.toContain(value);
      expectPublic(await call(undefined, failure));
    }
  });
  it.each([
    "missing",
    "malformed",
    "extra",
    "nested-extra",
    "string-revision",
    "unknown-release",
    "digest",
    "environment",
    "station",
    "unapproved",
    "missing-approval-record",
    "approval-digest-mismatch",
    "future",
    "inactive",
    "superseded",
  ])(
    "RE-20 %s runtime policy fails closed without affecting other statuses",
    async (state) => {
      const policy = await activePolicy(),
        a = await actor();
      const changed = structuredClone(policy) as Record<string, unknown>;
      if (state === "extra") changed.secret = "private-canary";
      if (state === "nested-extra")
        changed.scope = { ...policy.scope, secret: "private-canary" };
      if (state === "string-revision") changed.revision = "1";
      if (state === "unknown-release") changed.release = "review-evidence-v99";
      if (state === "digest") changed.digest = "a".repeat(64);
      if (state === "environment")
        changed.scope = { ...policy.scope, environment: "production" };
      if (state === "station")
        changed.scope = { ...policy.scope, stationId: newId() };
      if (state === "unapproved")
        changed.activation = {
          ...policy.activation,
          approvalReference: newId(),
        };
      if (
        state === "missing-approval-record" ||
        state === "approval-digest-mismatch"
      ) {
        const approval = newId();
        changed.revision = 2;
        changed.activation = {
          ...policy.activation,
          approvalReference: approval,
        };
        if (state === "approval-digest-mismatch") {
          await pool.query(
            "INSERT INTO review_evidence_approval(id,release,digest,revision,station_id,environment,activated_at,authorization_reference) VALUES($1,$2,$3,2,$4,'test',$5,'Fictional approval')",
            [
              approval,
              policy.release,
              "b".repeat(64),
              policy.scope.stationId,
              policy.activation.activatedAt,
            ],
          );
        }
        await pool.query(
          "INSERT INTO review_evidence_configuration(id,station_id,environment,revision,configuration,authorization_reference) VALUES($1,$2,'test',2,$3,'Fictional approval')",
          [newId(), policy.scope.stationId, changed],
        );
      }
      if (state === "future") {
        const approval = newId();
        changed.revision = 2;
        changed.activation = {
          ...policy.activation,
          approvalReference: approval,
          activatedAt: "2999-01-01T00:00:00Z",
        };
        await pool.query(
          "INSERT INTO review_evidence_approval(id,release,digest,revision,station_id,environment,activated_at,authorization_reference) VALUES($1,$2,$3,2,$4,'test','2999-01-01','Fictional approval')",
          [approval, policy.release, policy.digest, policy.scope.stationId],
        );
        await pool.query(
          "INSERT INTO review_evidence_configuration(id,station_id,environment,revision,configuration,authorization_reference) VALUES($1,$2,'test',2,$3,'Fictional approval')",
          [newId(), policy.scope.stationId, changed],
        );
      }
      if (state === "inactive")
        Object.assign(
          changed,
          await activate(pool, policy.scope.stationId, 2, false),
        );
      if (state === "superseded")
        await activate(pool, policy.scope.stationId, 2, false);
      vi.stubEnv(
        "WHR_REVIEW_EVIDENCE_POLICY",
        state === "missing"
          ? undefined
          : state === "malformed"
            ? "private-canary"
            : JSON.stringify(changed),
      );
      const body = await call(adminCookie(a.token));
      expect(body.policies).toMatchObject({
        reviewEvidence: "unconfigured",
        auth: "configured",
        cardPrint: "configured",
      });
    },
  );
  it("RE-20 partial evaluator installation denies an otherwise approved runtime policy", async () => {
    await activePolicy();
    const a = await actor();
    vi.spyOn(evaluator, "reviewEvidenceV1Installed").mockReturnValue(false);
    expect((await call(adminCookie(a.token))).policies.reviewEvidence).toBe(
      "unconfigured",
    );
  });
  it("RE-20 health reads configuration and authority only without purchase, photo, provider probes or writes", async () => {
    await activePolicy();
    const a = await actor();
    const fetch = vi.spyOn(globalThis, "fetch");
    const queries = vi.spyOn(pg.Client.prototype, "query");
    expect((await call(adminCookie(a.token))).policies.reviewEvidence).toBe(
      "configured",
    );
    expectPublic(await call());
    expect(fetch).not.toHaveBeenCalled();
    const sql = queries.mock.calls
      .map(([query]) =>
        typeof query === "string" ? query : (query as { text: string }).text,
      )
      .join("\n");
    expect(sql).toContain("review_evidence_configuration");
    expect(sql).not.toMatch(
      /(?:^\s*(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b|\b(?:purchase|photo_asset|review_evaluation|sale_decision|customer)\b)/im,
    );
  });
  it("RE-20 permission revoked during approval lookup is checked before disclosure", async () => {
    await activePolicy();
    const a = await actor();
    const query = pool.query.bind(pool);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const blocked = new Promise<void>((r) => {
      release = r;
    });
    vi.spyOn(pool, "query").mockImplementation((async (
      ...args: Parameters<typeof pool.query>
    ) => {
      const result = await query(...args);
      if (
        typeof args[0] === "string" &&
        args[0].includes("SELECT c.id FROM review_evidence_configuration")
      ) {
        entered();
        await blocked;
      }
      return result;
    }) as typeof pool.query);
    const response = call(adminCookie(a.token));
    await started;
    await transaction(pool, async (db) => {
      await securityLock(db);
      await db.query("DELETE FROM role_permission WHERE role_id=$1", [a.role]);
    });
    release();
    expectPublic(await response);
  });
  it("RE-20 approval storage failure returns redacted 503 while live authorization still governs projection", async () => {
    await activePolicy();
    const a = await actor();
    await pool.query(
      "ALTER TABLE review_evidence_configuration RENAME TO unavailable_health_configuration",
    );
    try {
      // Keep the name occupied in this schema: a missing relation would fall
      // through search_path to a separately migrated public database table.
      await pool.query(
        "CREATE VIEW review_evidence_configuration AS SELECT NULL::uuid AS id",
      );
      await expect(
        pool.query("SELECT station_id FROM review_evidence_configuration"),
      ).rejects.toMatchObject({ code: "42703" });
      const body = await call(adminCookie(a.token), true, async () => {
        await pool.query("SELECT 1");
      });
      expect(body.policies.reviewEvidence).toBe("unconfigured");
      expectPublic(
        await call(undefined, true, async () => {
          await pool.query("SELECT 1");
        }),
      );
    } finally {
      await pool.query("DROP VIEW IF EXISTS review_evidence_configuration");
      await pool.query(
        "ALTER TABLE unavailable_health_configuration RENAME TO review_evidence_configuration",
      );
    }
  });
  it("RE-20 unavailable authorization storage falls back to public fields without leaking errors", async () => {
    await activePolicy();
    const a = await actor();
    await pool.query(
      "ALTER TABLE auth_session RENAME TO unavailable_health_session",
    );
    try {
      await pool.query("CREATE VIEW auth_session AS SELECT NULL::uuid AS id");
      await expect(
        pool.query("SELECT user_id FROM auth_session"),
      ).rejects.toMatchObject({ code: "42703" });
      for (const failure of [false, true])
        expectPublic(await call(adminCookie(a.token), failure));
    } finally {
      await pool.query("DROP VIEW IF EXISTS auth_session");
      await pool.query(
        "ALTER TABLE unavailable_health_session RENAME TO auth_session",
      );
    }
  });
});
