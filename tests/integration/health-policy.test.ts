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
  afterEach(() => vi.unstubAllEnvs());
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
        delegation: "configured",
        phone: "configured",
        meter: "unconfigured",
        phoneVerification: "unconfigured",
        recovery: "unconfigured",
        reconciliation: "unconfigured",
        timing: "unconfigured",
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
      expectPublic(await call(cookie));
  });
  it("permission revoked while the probe is pending is checked before response", async () => {
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
});
