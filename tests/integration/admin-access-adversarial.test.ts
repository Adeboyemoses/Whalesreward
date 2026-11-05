import { readFile, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "../../src/server/lib/ids";
import {
  handleAuth,
  COOKIE as ATTENDANT_COOKIE,
} from "../../src/server/modules/auth/http";
import { handleAdmin } from "../../src/server/modules/admin-access/http";

const origin = "https://station.example.test";
const password = randomBytes(24).toString("hex");
const schema = `admin_adversarial_${randomBytes(8).toString("hex")}`;
const rootPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pool: pg.Pool;
let passwordHash: string;
let ownerCookie: string;
const fixtureId = (n: number) =>
  `019a5000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const catalogue = [
  "overview",
  "sales",
  "corrections",
  "duplicates",
  "priceReview",
  "queueRecovery",
  "cardEligibility",
  "dateReview",
  "giveawayFinalize",
  "giveawayRevise",
  "customers",
  "recovery",
  "managerRecovery",
  "leaderboards",
  "reports",
  "reportExport",
  "cards",
  "cardGenerate",
  "cardExport",
  "cardPrint",
  "cardActivate",
  "attendants",
  "pumps",
  "prices",
  "settings",
  "audit",
  "users",
  "roles",
].sort();
let ipCounter = 1;
async function call(
  action: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
    target?: string;
    key?: string;
    query?: string;
    origin?: string;
  } = {},
) {
  const method =
    options.method ?? (options.body === undefined ? "GET" : "POST");
  const headers = new Headers({
    origin: options.origin ?? origin,
    "x-test-ip": `10.20.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`,
  });
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.body !== undefined)
    headers.set("content-type", "application/json");
  headers.set("idempotency-key", options.key ?? newId());
  const response = await handleAdmin(
    new Request(`${origin}/api/admin/${action}${options.query ?? ""}`, {
      method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    action,
    options.target,
  );
  const body = response.status === 204 ? null : await response.json();
  return {
    response,
    body,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
async function login(username: string, secret = password) {
  const result = await call("sign-in", {
    body: { username, password: secret },
  });
  expect(result.response.status, JSON.stringify(result.body)).toBe(200);
  expect(result.cookie).toBeTruthy();
  return result.cookie!;
}
async function role(permissions: string[]) {
  const id = newId();
  await pool.query(
    "INSERT INTO role(id,name,is_owner,enabled,version) VALUES($1,$2,false,true,1)",
    [id, `Test ${id}`],
  );
  for (const permission of permissions)
    await pool.query(
      "INSERT INTO role_permission(role_id,permission_code) VALUES($1,$2)",
      [id, permission],
    );
  return id;
}
async function account(
  roleId: string,
  options: { restricted?: boolean; verified?: boolean } = {},
) {
  const userId = newId(),
    adminId = newId();
  const username = `test.${userId.slice(-12)}`;
  const email = `${username}@example.com`;
  await pool.query(
    "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'admin',$2,$2,'Ada Test',true,1,$3,now())",
    [userId, username, options.restricted ?? false],
  );
  await pool.query(
    "INSERT INTO admin(id,user_id,admin_code,email_normalized,email_verified_at,role_id,version) VALUES($1,$2,$3,$4,$5,$6,1)",
    [
      adminId,
      userId,
      `TEST-${adminId}`,
      email,
      options.verified ? new Date() : null,
      roleId,
    ],
  );
  await pool.query(
    "INSERT INTO auth_credential(id,user_id,provider,provider_account_id,password_hash,updated_at) VALUES($1,$2::uuid,'credential',$2::text,$3,now())",
    [newId(), userId, passwordHash],
  );
  return {
    userId,
    adminId,
    username,
    email,
    roleId,
    cookie: await login(username),
  };
}
const reason = "Fictional access test";

describe("independent M2 admin access adversarial checks", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    await rootPool.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set("options", `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString();
    pool = new pg.Pool({ connectionString: url.toString(), max: 12 });
    const migrations = new URL("../../prisma/migrations/", import.meta.url);
    for (const directory of (await readdir(migrations, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))) {
      await pool.query(
        await readFile(
          new URL(`${directory.name}/migration.sql`, migrations),
          "utf8",
        ),
      );
    }
    await pool.query(
      await readFile(
        new URL("../../prisma/fixtures.sql", import.meta.url),
        "utf8",
      ),
    );
    passwordHash = await hashPassword(password);
    await pool.query(
      "INSERT INTO auth_credential(id,user_id,provider,provider_account_id,password_hash,updated_at) VALUES($1,$2::uuid,'credential',$2::text,$3,now())",
      [newId(), fixtureId(2), passwordHash],
    );
    await pool.query(
      "UPDATE auth_user SET must_change_password=false WHERE id=$1",
      [fixtureId(2)],
    );
    process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("hex");
    process.env.BETTER_AUTH_URL = origin;
    process.env.WHR_ENV = "local";
    process.env.WHR_TRUSTED_IP_HEADER = "x-test-ip";
    ownerCookie = await login("ada.williams");
  }, 30000);
  afterAll(async () => {
    await pool?.end();
    await rootPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await rootPool.end();
  });

  it("I-07/I-11 exposes exactly 28 independent action permissions and no legacy aliases", async () => {
    const result = await call("permissions", { cookie: ownerCookie });
    expect(result.response.status).toBe(200);
    expect(
      result.body.data.items
        .map((entry: { code: string }) => entry.code)
        .sort(),
    ).toEqual(catalogue);
    for (const code of [
      "queueRecovery",
      "cardEligibility",
      "dateReview",
      "priceReview",
    ]) {
      expect(
        result.body.data.items.find(
          (entry: { code: string }) => entry.code === code,
        ),
      ).toMatchObject({ requiredView: "sales", sensitiveOwnerDefault: true });
    }
    for (const code of ["giveawayFinalize", "giveawayRevise"])
      expect(
        result.body.data.items.find(
          (entry: { code: string }) => entry.code === code,
        ),
      ).toMatchObject({
        requiredView: "leaderboards",
        sensitiveOwnerDefault: true,
      });
  });

  it("I-07 every protected access route denies a live zero-grant account", async () => {
    const emptyRole = await role([]);
    const actor = await account(emptyRole);
    const routes = [
      ["permissions", undefined, undefined],
      ["users-search", {}, undefined],
      ["users-get", undefined, fixtureId(5)],
      [
        "users-create",
        {
          operationId: newId(),
          name: "Amina Test",
          username: "amina.test",
          email: "amina.test@example.com",
          temporaryPassword: password,
          roleId: emptyRole,
          expectedRoleVersion: 1,
          reason,
        },
        undefined,
      ],
      [
        "users-access",
        {
          operationId: newId(),
          expectedVersion: 1,
          roleId: emptyRole,
          expectedRoleVersion: 1,
          enabled: false,
          reason,
        },
        actor.adminId,
      ],
      ["roles-list", undefined, undefined],
      ["roles-get", undefined, emptyRole],
      [
        "roles-create",
        { operationId: newId(), name: "Denied role", permissions: [], reason },
        undefined,
      ],
      [
        "roles-edit",
        {
          operationId: newId(),
          expectedVersion: 1,
          name: "Denied edit",
          permissions: [],
          reason,
        },
        emptyRole,
      ],
      ["assignable-roles", undefined, undefined],
      ["access-history", undefined, undefined],
      [
        "verification-requests",
        { operationId: newId(), expectedVersion: 1 },
        actor.adminId,
      ],
    ] as const;
    for (const [action, body, target] of routes) {
      const result = await call(action, {
        body,
        target,
        cookie: actor.cookie,
        method: ["roles-edit", "users-access"].includes(action)
          ? "PATCH"
          : undefined,
      });
      expect(result.response.status, action).toBe(403);
      expect(result.body.error.code, action).toBe("permission_denied");
      expect(result.response.headers.get("cache-control"), action).toBe(
        "no-store",
      );
    }
    const session = await call("session", { cookie: actor.cookie });
    expect(session.body.data.landing).toBe("no_access");
    expect(session.body.data.permissions).toEqual([]);
  });

  it("I-13 restricted sessions cannot access admin data and first-password racing succeeds once", async () => {
    const actor = await account(await role(["users", "roles"]), {
      restricted: true,
    });
    const session = await call("session", { cookie: actor.cookie });
    expect(session.body.data.state).toBe("password_change_required");
    expect(session.body.data).not.toHaveProperty("permissions");
    for (const action of ["roles-list", "permissions", "users-search"]) {
      const denied = await call(action, {
        cookie: actor.cookie,
        body: action === "users-search" ? {} : undefined,
      });
      expect(denied.response.status).toBe(403);
      expect(denied.body.error.code).toBe("password_change_required");
    }
    const secondCookie = await login(actor.username);
    const nextPassword = randomBytes(24).toString("hex");
    const results = await Promise.all(
      [actor.cookie, secondCookie].map((cookie) =>
        call("first-password", {
          cookie,
          body: {
            operationId: newId(),
            newPassword: nextPassword,
            confirmPassword: nextPassword,
          },
        }),
      ),
    );
    expect(
      results.filter((result) => result.response.status === 200),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.response.status !== 200),
    ).toHaveLength(1);
    for (const cookie of [actor.cookie, secondCookie])
      expect((await call("session", { cookie })).response.status).toBe(401);
    const fresh = await login(actor.username, nextPassword);
    expect((await call("session", { cookie: fresh })).body.data.state).toBe(
      "ready",
    );
  });

  it("I-10 delegation checks the existing target role before a lower-role disable", async () => {
    const manager = await account(await role(["users", "roles"]));
    const powerful = await account(await role(["users", "roles", "sales"]));
    const lowerRole = await role([]);
    const denied = await call("users-access", {
      cookie: manager.cookie,
      target: powerful.adminId,
      method: "PATCH",
      body: {
        operationId: newId(),
        expectedVersion: 1,
        roleId: lowerRole,
        expectedRoleVersion: 1,
        enabled: false,
        reason,
      },
    });
    expect(denied.response.status).toBe(403);
    expect(denied.body.error.code).toBe("delegation_denied");
    expect(
      (
        await pool.query("SELECT enabled FROM auth_user WHERE id=$1", [
          powerful.userId,
        ])
      ).rows[0].enabled,
    ).toBe(true);
    const roleDenied = await call("roles-edit", {
      cookie: manager.cookie,
      target: powerful.roleId,
      method: "PATCH",
      body: {
        operationId: newId(),
        expectedVersion: 1,
        name: "Lowered authority",
        permissions: [],
        reason,
      },
    });
    expect(roleDenied.response.status).toBe(403);
    expect(roleDenied.body.error.code).toBe("delegation_denied");
  });

  it("I-11 incomplete permission dependencies fail without implicit grants", async () => {
    for (const permission of [
      "queueRecovery",
      "cardEligibility",
      "dateReview",
      "priceReview",
      "giveawayFinalize",
      "giveawayRevise",
    ]) {
      const result = await call("roles-create", {
        cookie: ownerCookie,
        body: {
          operationId: newId(),
          name: `Invalid ${permission}`,
          permissions: [permission],
          reason,
        },
      });
      expect(result.response.status, permission).toBe(422);
      expect(result.body.error.code, permission).toBe("permission_dependency");
    }
  });

  it("I-09 removing a role permission revokes every existing member session", async () => {
    const roleId = await role(["users"]);
    const actor = await account(roleId);
    const second = await login(actor.username);
    const edited = await call("roles-edit", {
      cookie: ownerCookie,
      target: roleId,
      method: "PATCH",
      body: {
        operationId: newId(),
        expectedVersion: 1,
        name: "Revoked role",
        permissions: [],
        reason,
      },
    });
    expect(edited.response.status, JSON.stringify(edited.body)).toBe(200);
    for (const cookie of [actor.cookie, second])
      expect((await call("session", { cookie })).response.status).toBe(401);
    expect(
      (await call("session", { cookie: await login(actor.username) })).body.data
        .permissions,
    ).toEqual([]);
  });
  it("I-07 surface cookies, cross-origin requests and oversized JSON cannot authorize", async () => {
    const renamed = `${ATTENDANT_COOKIE}=${ownerCookie.split("=")[1]}`;
    expect((await call("session", { cookie: renamed })).response.status).toBe(
      401,
    );
    const attendant = await handleAuth(
      new Request(`${origin}/api/attendant/session`, {
        headers: { cookie: renamed },
      }),
      "session",
    );
    expect(attendant.status).toBe(401);
    const cross = await call("users-search", {
      cookie: ownerCookie,
      body: {},
      origin: "https://attacker.example.test",
    });
    expect(cross.response.status).toBe(403);
    expect(cross.body.error.code).toBe("origin_rejected");
    const oversized = await call("users-search", {
      cookie: ownerCookie,
      body: { query: "x".repeat(32769) },
    });
    expect(oversized.response.status).toBe(413);
    expect(oversized.body.error.code).toBe("request_too_large");
  });

  it("I-10 role replay preserves the original result and rejects changed inputs", async () => {
    const input = {
      operationId: newId(),
      name: `Replay ${newId()}`,
      permissions: ["sales"],
      reason,
    };
    const first = await call("roles-create", {
      cookie: ownerCookie,
      body: input,
    });
    expect(first.response.status, JSON.stringify(first.body)).toBe(201);
    const edited = await call("roles-edit", {
      cookie: ownerCookie,
      target: first.body.data.id,
      method: "PATCH",
      body: {
        operationId: newId(),
        expectedVersion: 1,
        name: "Changed after creation",
        permissions: [],
        reason,
      },
    });
    expect(edited.response.status).toBe(200);
    const replay = await call("roles-create", {
      cookie: ownerCookie,
      body: input,
    });
    expect(replay.response.status).toBe(201);
    expect(replay.body.data).toEqual(first.body.data);
    const conflict = await call("roles-create", {
      cookie: ownerCookie,
      body: { ...input, permissions: [] },
    });
    expect(conflict.response.status).toBe(409);
    expect(conflict.body.error.code).toBe("operation_conflict");
  });

  it("I-10 non-Owner with all grants still cannot promote an Owner and Owner role is immutable", async () => {
    const actor = await account(await role(catalogue));
    const target = await account(await role([]));
    const promoted = await call("users-access", {
      cookie: actor.cookie,
      target: target.adminId,
      method: "PATCH",
      body: {
        operationId: newId(),
        expectedVersion: 1,
        roleId: fixtureId(1),
        expectedRoleVersion: 1,
        enabled: true,
        reason,
      },
    });
    expect(promoted.response.status).toBe(403);
    expect(promoted.body.error.code).toBe("delegation_denied");
    const edited = await call("roles-edit", {
      cookie: ownerCookie,
      target: fixtureId(1),
      method: "PATCH",
      body: {
        operationId: newId(),
        expectedVersion: 1,
        name: "Changed Owner",
        permissions: catalogue,
        reason,
      },
    });
    expect(edited.response.status).toBe(409);
    expect(edited.body.error.code).toBe("protected_owner");
  });

  it("I-08 two concurrent Owner self-demotions leave exactly one active Owner", async () => {
    const second = await account(fixtureId(1));
    const emptyRole = await role([]);
    const results = await Promise.all(
      [{ cookie: ownerCookie, adminId: fixtureId(5) }, second].map((actor) =>
        call("users-access", {
          cookie: actor.cookie,
          target: actor.adminId,
          method: "PATCH",
          body: {
            operationId: newId(),
            expectedVersion: 1,
            roleId: emptyRole,
            expectedRoleVersion: 1,
            enabled: true,
            reason,
          },
        }),
      ),
    );
    expect(
      results.filter((result) => result.response.status === 200),
    ).toHaveLength(1);
    const refused = results.find((result) => result.response.status !== 200)!;
    expect(refused.response.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body.error.code).toBe("last_owner");
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM admin a JOIN auth_user u ON u.id=a.user_id JOIN role r ON r.id=a.role_id WHERE u.enabled AND r.enabled AND r.is_owner",
        )
      ).rows[0].count,
    ).toBe(1);
  });
});
