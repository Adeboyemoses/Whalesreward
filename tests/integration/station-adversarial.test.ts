import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { seedAdminCredentials } from "../../prisma/seed-auth.mjs";
import { newId } from "../../src/server/lib/ids";
import { handleAdmin } from "../../src/server/modules/admin-access/http";
import { handleAuth } from "../../src/server/modules/auth/http";
import { handleStation } from "../../src/server/modules/station/http";
import { handleSync } from "../../src/server/modules/sync/http";

vi.setConfig({ testTimeout: 30000 });
const origin = "https://station.example.test";
const password = randomBytes(24).toString("hex");
const schema = `station_adversarial_${randomBytes(8).toString("hex")}`;
const rootPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const fixtureId = (n: number) =>
  `019a5000-0000-7000-8000-${String(n).padStart(12, "0")}`;
let pool: pg.Pool;
let passwordHash: string;
let ownerCookie: string;
let ip = 1;

type Options = {
  body?: unknown;
  rawBody?: string;
  cookie?: string;
  target?: string;
  query?: string;
  origin?: string;
  method?: string;
};
function request(action: string, options: Options = {}) {
  const headers = new Headers({
    origin: options.origin ?? origin,
    "x-test-ip": `10.52.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    "idempotency-key": newId(),
  });
  if (options.cookie) headers.set("cookie", options.cookie);
  const body =
    options.rawBody ??
    (options.body === undefined ? undefined : JSON.stringify(options.body));
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`${origin}/api/${action}${options.query ?? ""}`, {
    method: options.method ?? (body === undefined ? "GET" : "POST"),
    headers,
    body,
  });
}
async function result(response: Response) {
  return {
    response,
    body: response.status === 204 ? null : await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
async function station(action: string, options: Options = {}) {
  return result(
    await handleStation(
      request(`admin/${action}`, options),
      action,
      options.target,
    ),
  );
}
async function adminLogin(username: string) {
  const login = await result(
    await handleAdmin(
      request("admin/auth/sign-in", {
        body: { username, password },
      }),
      "sign-in",
    ),
  );
  expect(login.response.status, JSON.stringify(login.body)).toBe(200);
  expect(login.cookie).toBeTruthy();
  return login.cookie!;
}
async function role(permissions: string[]) {
  const id = newId();
  await pool.query(
    "INSERT INTO role(id,name,is_owner,enabled,version) VALUES($1,$2,false,true,1)",
    [id, `Station test ${id}`],
  );
  for (const code of permissions)
    await pool.query(
      "INSERT INTO role_permission(role_id,permission_code) VALUES($1,$2)",
      [id, code],
    );
  return id;
}
async function admin(permissions: string[]) {
  const roleId = await role(permissions),
    userId = newId(),
    adminId = newId();
  const username = `station.${userId.slice(-12)}`;
  await pool.query(
    "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'admin',$2,$2,'Ada Test',true,1,false,now())",
    [userId, username],
  );
  await pool.query(
    "INSERT INTO admin(id,user_id,admin_code,role_id,version) VALUES($1,$2,$3,$4,1)",
    [adminId, userId, `TEST-${adminId}`, roleId],
  );
  await pool.query(
    "INSERT INTO auth_credential(id,user_id,provider,provider_account_id,password_hash,updated_at) VALUES($1,$2::uuid,'credential',$2::text,$3,now())",
    [newId(), userId, passwordHash],
  );
  return {
    roleId,
    userId,
    adminId,
    username,
    cookie: await adminLogin(username),
  };
}
async function createAttendant(username = `staff.${newId().slice(-12)}`) {
  return station("attendants-create", {
    cookie: ownerCookie,
    body: {
      operationId: newId(),
      name: "Favour James",
      username,
      password,
      pumpId: fixtureId(13),
      expectedPumpVersion: 1,
    },
  });
}
async function attendantLogin(username: string, secret = password) {
  return result(
    await handleAuth(
      request("attendant/auth/sign-in", {
        body: { username, password: secret, deviceId: newId() },
      }),
      "sign-in",
    ),
  );
}

describe("independent M2 station adversarial checks", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    await rootPool.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set("options", `-c search_path=${schema},public`);
    url.searchParams.set("application_name", schema);
    process.env.DATABASE_URL = url.toString();
    pool = new pg.Pool({ connectionString: url.toString(), max: 12 });
    const migrations = new URL("../../prisma/migrations/", import.meta.url);
    for (const directory of (await readdir(migrations, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name)))
      await pool.query(
        await readFile(
          new URL(`${directory.name}/migration.sql`, migrations),
          "utf8",
        ),
      );
    await pool.query(
      await readFile(
        new URL("../../prisma/fixtures.sql", import.meta.url),
        "utf8",
      ),
    );
    passwordHash = await hashPassword(password);
    const client = await pool.connect();
    try {
      await seedAdminCredentials(client, {
        WHR_ENV: "staging",
        WHR_SEED_ADMIN_PASSWORD: password,
      });
    } finally {
      client.release();
    }
    await pool.query(
      "UPDATE auth_user SET must_change_password=false WHERE id=$1",
      [fixtureId(2)],
    );
    process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("hex");
    process.env.BETTER_AUTH_URL = origin;
    process.env.WHR_ENV = "local";
    process.env.WHR_TRUSTED_IP_HEADER = "x-test-ip";
    ownerCookie = await adminLogin("ada.williams");
  }, 30000);
  afterAll(async () => {
    await pool?.end();
    await rootPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await rootPool.end();
  });

  it("I-07 pump, attendant and price picker grants never imply attendant account creation", async () => {
    const pumpManager = await admin(["pumps"]);
    for (const [action, target] of [
      ["pumps-list", undefined],
      ["assignment-candidates", undefined],
      ["pumps-assignments", fixtureId(13)],
      ["attendants-assignments", fixtureId(6)],
    ]) {
      const read = await station(action!, {
        cookie: pumpManager.cookie,
        target,
      });
      expect(
        read.response.status,
        `${action}: ${JSON.stringify(read.body)}`,
      ).toBe(200);
    }
    const denied = await station("attendants-create", {
      cookie: pumpManager.cookie,
      body: {
        operationId: newId(),
        name: "Grace Okon",
        username: "denied.creation",
        password,
        pumpId: fixtureId(13),
        expectedPumpVersion: 1,
      },
    });
    expect(denied.response.status).toBe(403);
    expect(denied.body.error.code).toBe("permission_denied");
    const priceManager = await admin(["prices"]);
    expect(
      (await station("pumps-list", { cookie: priceManager.cookie })).response
        .status,
    ).toBe(200);
    expect(
      (await station("assignment-candidates", { cookie: priceManager.cookie }))
        .response.status,
    ).toBe(403);
    const attendantManager = await admin(["attendants"]);
    expect(
      (await station("pumps-list", { cookie: attendantManager.cookie }))
        .response.status,
    ).toBe(200);
    expect(
      (await station("products", { cookie: attendantManager.cookie })).response
        .status,
    ).toBe(403);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM auth_user WHERE username_normalized='denied.creation'",
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("I-07 a grant removed while a station write waits for the security lock cannot authorize its commit", async () => {
    const actor = await admin(["pumps"]);
    const client = await pool.connect();
    const name = `Denied ${newId()}`;
    let pending: ReturnType<typeof station> | undefined;
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT id FROM security_state WHERE id=true FOR UPDATE",
      );
      pending = station("pumps-create", {
        cookie: actor.cookie,
        body: { operationId: newId(), name, productCode: "pms" },
      });
      let waiting = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const rows = await pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%security_state%'",
          [schema],
        );
        if (rows.rowCount) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(
        waiting,
        "station mutation must serialize against the live security lock",
      ).toBe(true);
      await client.query(
        "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='pumps'",
        [actor.roleId],
      );
      await client.query("COMMIT");
      const denied = await pending;
      expect(denied.response.status, JSON.stringify(denied.body)).toBe(403);
      expect(denied.body.error.code).toBe("permission_denied");
      expect(
        (
          await pool.query("SELECT count(*)::int n FROM pump WHERE name=$1", [
            name,
          ])
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await pending;
    }
  });

  it("I-07 replay reauthorizes the actor before returning an old successful station receipt", async () => {
    const actor = await admin(["pumps"]);
    const input = {
      operationId: newId(),
      name: `Replay ${newId()}`,
      productCode: "pms",
    };
    const created = await station("pumps-create", {
      cookie: actor.cookie,
      body: input,
    });
    expect(created.response.status, JSON.stringify(created.body)).toBe(201);
    await pool.query(
      "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='pumps'",
      [actor.roleId],
    );
    const denied = await station("pumps-create", {
      cookie: actor.cookie,
      body: input,
    });
    expect(denied.response.status).toBe(403);
    expect(denied.body.error.code).toBe("permission_denied");
    expect(
      (
        await pool.query("SELECT count(*)::int n FROM pump WHERE name=$1", [
          input.name,
        ])
      ).rows[0].n,
    ).toBe(1);
  });

  it("I-07 station cursors cannot cross endpoints or attendant-search filters", async () => {
    const page = await station("pumps-list", {
      cookie: ownerCookie,
      query: "?limit=1",
    });
    expect(page.response.status).toBe(200);
    expect(page.body.data.nextCursor).toBeTruthy();
    const wrongEndpoint = await station("assignment-candidates", {
      cookie: ownerCookie,
      query: `?limit=1&cursor=${encodeURIComponent(page.body.data.nextCursor)}`,
    });
    expect(wrongEndpoint.response.status).toBe(400);
    const search = await station("attendants-search", {
      cookie: ownerCookie,
      body: { limit: 1 },
    });
    expect(search.response.status, JSON.stringify(search.body)).toBe(200);
    expect(search.body.data.nextCursor).toBeTruthy();
    const changedFilter = await station("attendants-search", {
      cookie: ownerCookie,
      body: { query: "Grace", limit: 1, cursor: search.body.data.nextCursor },
    });
    expect(changedFilter.response.status).toBe(400);
    const tampered = await station("pumps-list", {
      cookie: ownerCookie,
      query: `?cursor=${encodeURIComponent(page.body.data.nextCursor.slice(0, -2) + "xx")}`,
    });
    expect(tampered.response.status).toBe(400);
  });

  it("I-07 station HTTP rejects cross-origin, oversized, extra-field and invalid exact-rate requests without caching", async () => {
    const invalid: Array<[string, Options, number]> = [
      [
        "pumps-create",
        {
          cookie: ownerCookie,
          origin: "https://other.example.test",
          body: {
            operationId: newId(),
            name: "Wrong origin",
            productCode: "pms",
          },
        },
        403,
      ],
      [
        "attendants-search",
        { cookie: ownerCookie, origin: "https://other.example.test", body: {} },
        403,
      ],
      [
        "pumps-create",
        {
          cookie: ownerCookie,
          rawBody: JSON.stringify({
            operationId: newId(),
            name: "X".repeat(33000),
            productCode: "pms",
          }),
        },
        413,
      ],
      [
        "pumps-create",
        {
          cookie: ownerCookie,
          body: {
            operationId: newId(),
            name: "Extra field",
            productCode: "pms",
            stationId: fixtureId(8),
          },
        },
        400,
      ],
      ["pumps-list", { cookie: ownerCookie, query: "?sort=name" }, 400],
      [
        "prices-activate",
        {
          cookie: ownerCookie,
          target: "pms",
          body: {
            operationId: newId(),
            expectedVersion: 1,
            rateKobo: "9223372036854775808",
            currency: "NGN",
            quantityPrecision: 2,
            reason: "Fictional oversized rate",
          },
        },
        422,
      ],
      [
        "prices-activate",
        {
          cookie: ownerCookie,
          target: "pms",
          body: {
            operationId: newId(),
            expectedVersion: 1,
            rateKobo: "100000.5",
            currency: "NGN",
            quantityPrecision: 2,
            reason: "Fictional fractional kobo",
          },
        },
        422,
      ],
    ];
    for (const [action, options, status] of invalid) {
      const denied = await station(action, options);
      expect(
        denied.response.status,
        `${action}: ${JSON.stringify(denied.body)}`,
      ).toBe(status);
      expect(denied.response.headers.get("cache-control")).toBe("no-store");
      if (action === "prices-activate")
        expect(denied.body.error.code).toBe("rate_invalid");
    }
    const normal = await station("pumps-list", { cookie: ownerCookie });
    expect(normal.response.status).toBe(200);
    expect(normal.response.headers.get("cache-control")).toBe("no-store");
  });

  it("I-01 attendant provisioning cannot reuse an admin username or leave partial credentials and assignments", async () => {
    const before = (
      await pool.query(
        "SELECT (SELECT count(*) FROM attendant)::int attendants,(SELECT count(*) FROM auth_credential)::int credentials,(SELECT count(*) FROM assignment)::int assignments",
      )
    ).rows[0];
    const collision = await createAttendant(" ADA.WILLIAMS ");
    expect(collision.response.status, JSON.stringify(collision.body)).toBe(409);
    expect(collision.body.error.code).toBe("username_in_use");
    const after = (
      await pool.query(
        "SELECT (SELECT count(*) FROM attendant)::int attendants,(SELECT count(*) FROM auth_credential)::int credentials,(SELECT count(*) FROM assignment)::int assignments",
      )
    ).rows[0];
    expect(after).toEqual(before);
  });

  it("I-05 configured-assignment reads never acknowledge a new pump or rewrite an existing capture context", async () => {
    const username = `context.${newId().slice(-12)}`;
    const created = await createAttendant(username);
    expect(created.response.status, JSON.stringify(created.body)).toBe(201);
    // This fixture is already past its first password; the separate case below
    // verifies newly provisioned accounts cannot bypass that requirement.
    await pool.query(
      "UPDATE auth_user SET must_change_password=false WHERE username_normalized=$1",
      [username],
    );
    const signedIn = await attendantLogin(username);
    expect(signedIn.response.status, JSON.stringify(signedIn.body)).toBe(200);
    const contextId = signedIn.body.data.captureContextId;
    const before = (
      await pool.query(
        "SELECT to_jsonb(c) snapshot FROM capture_context c WHERE id=$1",
        [contextId],
      )
    ).rows[0].snapshot;
    const changed = await station("attendants-assignment", {
      cookie: ownerCookie,
      target: created.body.data.id,
      body: {
        operationId: newId(),
        expectedVersion: created.body.data.version,
        expectedAssignmentId: created.body.data.assignment.id,
        pumpId: fixtureId(14),
        expectedPumpVersion: 1,
        reason: "Fictional assignment handover",
      },
    });
    expect(changed.response.status, JSON.stringify(changed.body)).toBe(200);
    for (let attempt = 0; attempt < 2; attempt++) {
      const configured = await station("configured-assignment", {
        cookie: signedIn.cookie,
      });
      expect(configured.response.status, JSON.stringify(configured.body)).toBe(
        200,
      );
      expect(configured.body.data).toMatchObject({
        configured: { pump: { id: fixtureId(14) } },
        acknowledgedAssignmentId: created.body.data.assignment.id,
        reassignmentRequiresSignIn: true,
      });
      expect(
        (
          await pool.query(
            "SELECT to_jsonb(c) snapshot FROM capture_context c WHERE id=$1",
            [contextId],
          )
        ).rows[0].snapshot,
      ).toEqual(before);
    }
    const fresh = await attendantLogin(username);
    expect(fresh.response.status, JSON.stringify(fresh.body)).toBe(200);
    expect(fresh.body.data.assignment.id).toBe(
      changed.body.data.attendant.assignment.id,
    );
    expect(fresh.body.data.captureContextId).not.toBe(contextId);
    const acknowledged = await station("configured-assignment", {
      cookie: fresh.cookie,
    });
    expect(acknowledged.body.data.reassignmentRequiresSignIn).toBe(false);
    expect(
      (
        await pool.query(
          "SELECT to_jsonb(c) snapshot FROM capture_context c WHERE id=$1",
          [contextId],
        )
      ).rows[0].snapshot,
    ).toEqual(before);
  });

  it("I-04 restricted first-password sessions have no capture context and cannot use configured assignment or sync", async () => {
    const username = `first.${newId().slice(-12)}`;
    const created = await createAttendant(username);
    expect(created.response.status, JSON.stringify(created.body)).toBe(201);
    const signedIn = await attendantLogin(username);
    expect(signedIn.response.status, JSON.stringify(signedIn.body)).toBe(200);
    expect(signedIn.body.data.state).toBe("password_change_required");
    expect(signedIn.body.data.captureContextId).toBeUndefined();
    expect(signedIn.cookie).toBeTruthy();
    const contexts = await pool.query(
      "SELECT count(*)::int n FROM capture_context WHERE attendant_id=$1",
      [created.body.data.id],
    );
    expect(contexts.rows[0].n).toBe(0);
    const configured = await station("configured-assignment", {
      cookie: signedIn.cookie,
    });
    expect(configured.response.status).toBe(403);
    expect(configured.body.error.code).toBe("password_change_required");
    const synced = await result(
      await handleSync(
        request("sync/status", { cookie: signedIn.cookie }),
        "status",
        newId(),
      ),
    );
    expect(synced.response.status).toBe(403);
    expect(synced.body.error.code).toBe("password_change_required");
    const changedPassword = randomBytes(24).toString("hex");
    const changed = await result(
      await handleAuth(
        request("attendant/first-password", {
          cookie: signedIn.cookie,
          body: {
            operationId: newId(),
            currentPassword: password,
            newPassword: changedPassword,
            confirmPassword: changedPassword,
          },
        }),
        "first-password",
      ),
    );
    expect(changed.response.status, JSON.stringify(changed.body)).toBe(204);
    expect(changed.response.headers.get("set-cookie")).toContain("Max-Age=0");
    const stale = await result(
      await handleAuth(
        request("attendant/session", { cookie: signedIn.cookie }),
        "session",
      ),
    );
    expect(stale.response.status).toBe(401);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM capture_context WHERE attendant_id=$1",
          [created.body.data.id],
        )
      ).rows[0].n,
    ).toBe(0);
    const fresh = await attendantLogin(username, changedPassword);
    expect(fresh.response.status, JSON.stringify(fresh.body)).toBe(200);
    expect(fresh.body.data.captureContextId).toBeTruthy();
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM capture_context WHERE attendant_id=$1",
          [created.body.data.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });
});
