import { readFile, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import pg from "pg";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { newId } from "../../src/server/lib/ids";
import { digest, sessionSecret } from "../../src/server/modules/auth/crypto";
import { stationWrite } from "../../src/server/modules/station/service";
import { handleStation } from "../../src/server/modules/station/http";
import { handleAuth } from "../../src/server/modules/auth/http";
import { adminConfig } from "../../src/server/modules/admin-access/config";
import { evaluateCapturePolicy } from "../../src/server/modules/sync/capture-policy";
vi.setConfig({ testTimeout: 30000 });
const schema = `station_management_${randomBytes(6).toString("hex")}`;
const root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pool: pg.Pool;
const id = (n: number) =>
  `019a5000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const secret = randomBytes(32).toString("hex"),
  password = randomBytes(20).toString("hex"),
  origin = "https://station.example.test";
let token: string;
let ip = 1;
async function call(
  action: string,
  input?: unknown,
  target?: string,
  query = "",
) {
  const r = await handleStation(
    new Request(`${origin}/api/admin/test${query}`, {
      method: input === undefined ? "GET" : "POST",
      headers: {
        cookie: `__Host-whr-admin-session=${token}`,
        origin,
        "content-type": "application/json",
        "x-test-ip": `10.45.0.${ip++}`,
      },
      body: input === undefined ? undefined : JSON.stringify(input),
    }),
    action,
    target,
  );
  return { response: r, body: await r.json() };
}
async function create(name = `Grace ${newId()}`) {
  const input = {
    operationId: newId(),
    name,
    username: `grace.${randomBytes(5).toString("hex")}`,
    password,
    pumpId: id(14),
    expectedPumpVersion: 1,
  };
  const result = await call("attendants-create", input);
  expect(result.response.status, JSON.stringify(result.body)).toBe(201);
  return { input, attendant: result.body.data };
}
async function auth(
  action: "sign-in" | "session" | "first-password",
  input?: unknown,
  cookie?: string,
  key = newId(),
) {
  const r = await handleAuth(
    new Request(`${origin}/api/attendant/${action}`, {
      method: input === undefined ? "GET" : "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "idempotency-key": key,
        ...(cookie ? { cookie } : {}),
      },
      body: input === undefined ? undefined : JSON.stringify(input),
    }),
    action,
  );
  return {
    response: r,
    body: r.status === 204 ? null : await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
describe("M2 station and assignment management", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
    await root.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set("options", `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString();
    pool = new pg.Pool({ connectionString: url.toString(), max: 15 });
    const migrations = new URL("../../prisma/migrations/", import.meta.url);
    for (const d of (await readdir(migrations, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name)))
      await pool.query(
        await readFile(new URL(`${d.name}/migration.sql`, migrations), "utf8"),
      );
    await pool.query(
      await readFile(
        new URL("../../prisma/fixtures.sql", import.meta.url),
        "utf8",
      ),
    );
    await pool.query(
      "UPDATE auth_user SET must_change_password=false WHERE id=$1",
      [id(2)],
    );
    process.env.BETTER_AUTH_SECRET = secret;
    process.env.BETTER_AUTH_URL = origin;
    process.env.WHR_ENV = "test";
    process.env.WHR_TRUSTED_IP_HEADER = "x-test-ip";
    const session = newId();
    token = sessionSecret(secret, session);
    await pool.query(
      "INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour',1,clock_timestamp())",
      [session, id(2), digest(token)],
    );
  });
  // Each acceptance case has an independent request budget in this isolated schema.
  beforeEach(async () => {
    await pool.query("DELETE FROM auth_rate_bucket");
  });
  afterAll(async () => {
    await pool?.end();
    await root.query(`DROP SCHEMA ${schema} CASCADE`);
    await root.end();
  });
  it("I-32 creates a unique pump, derives product and replays the original result", async () => {
    const input = {
      operationId: newId(),
      name: "New PMS pump",
      productCode: "pms",
    };
    // Direct service exposes transaction errors while this new path is developed.
    const result = await stationWrite(
      pool,
      adminConfig(),
      token,
      "pumps-create",
      input,
    );
    const first = await call("pumps-create", input);
    expect(first.response.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.data).toEqual(result);
    const duplicate = await call("pumps-create", {
      ...input,
      operationId: newId(),
      name: "  NEW PMS PUMP  ",
    });
    expect(duplicate.response.status).toBe(409);
    expect(duplicate.body.error.code).toBe("pump_name_in_use");
    const conflict = await call("pumps-create", { ...input, name: "Other" });
    expect(conflict.body.error.code).toBe("operation_conflict");
  });
  it("I-32 concurrent price activations have one winner and never rewrite old price versions", async () => {
    const before = (
      await pool.query(
        "SELECT * FROM product_price_version WHERE product_id=$1 ORDER BY version",
        [id(10)],
      )
    ).rows;
    const common = {
      expectedVersion: before.at(-1).version,
      rateKobo: "123456",
      currency: "NGN",
      quantityPrecision: 3,
      reason: "Fictional meter update",
    };
    const results = await Promise.all([
      call("prices-activate", { ...common, operationId: newId() }, "diesel"),
      call(
        "prices-activate",
        { ...common, operationId: newId(), rateKobo: "123457" },
        "diesel",
      ),
    ]);
    expect(results.map((r) => r.response.status).sort()).toEqual([201, 409]);
    expect(
      results.find((r) => r.response.status === 409)!.body.error.code,
    ).toBe("version_conflict");
    const after = (
      await pool.query(
        "SELECT * FROM product_price_version WHERE product_id=$1 ORDER BY version",
        [id(10)],
      )
    ).rows;
    expect(after.slice(0, -1)).toEqual(before);
    const winner = results.find((r) => r.response.status === 201)!.body.data;
    expect(winner.actor.id).toBe(id(5));
    expect(winner.reason).toBe(common.reason);
    await expect(
      pool.query(
        "UPDATE product_price_version SET rate_kobo=rate_kobo+1 WHERE id=$1",
        [before[0].id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("I-32 precision-only activation is versioned; no-change, overflow and stale confirmations do not write", async () => {
    const old = (
      await pool.query(
        "SELECT * FROM product_price_version WHERE product_id=$1 ORDER BY version DESC LIMIT 1",
        [id(11)],
      )
    ).rows[0];
    const input = {
      operationId: newId(),
      expectedVersion: old.version,
      rateKobo: old.rate_kobo,
      currency: "NGN",
      quantityPrecision: (old.quantity_precision + 1) % 7,
      reason: "Match meter precision",
    };
    const changed = await call("prices-activate", input, "kerosene");
    expect(changed.response.status).toBe(201);
    const replay = await call("prices-activate", input, "kerosene");
    expect(replay.body.data).toEqual(changed.body.data);
    expect(
      (
        await call(
          "prices-activate",
          { ...input, operationId: newId() },
          "kerosene",
        )
      ).body.error.code,
    ).toBe("version_conflict");
    expect(
      (
        await call(
          "prices-activate",
          { ...input, operationId: newId(), expectedVersion: old.version + 1 },
          "kerosene",
        )
      ).body.error.code,
    ).toBe("no_change");
    expect(
      (
        await call(
          "prices-activate",
          { ...input, operationId: newId(), rateKobo: "9223372036854775808" },
          "kerosene",
        )
      ).body.error.code,
    ).toBe("rate_invalid");
  });
  it("I-01 first password sessions cannot capture; completion revokes and fresh sign-in creates the first context", async () => {
    const f = await create();
    const login = await auth("sign-in", {
      username: f.input.username,
      password,
      deviceId: newId(),
    });
    expect(login.response.status, JSON.stringify(login.body)).toBe(200);
    expect(login.body.data.state).toBe("password_change_required");
    expect(login.body.data).not.toHaveProperty("captureContextId");
    expect(
      (
        await pool.query(
          "SELECT count(*) FROM capture_context WHERE attendant_id=$1",
          [f.attendant.id],
        )
      ).rows[0].count,
    ).toBe("0");
    const configured = await handleStation(
      new Request(`${origin}/api/attendant/configured-assignment`, {
        headers: { cookie: login.cookie! },
      }),
      "configured-assignment",
    );
    expect(configured.status).toBe(403);
    const bad = await auth(
      "first-password",
      {
        operationId: newId(),
        currentPassword: password,
        newPassword: password,
        confirmPassword: password,
      },
      login.cookie,
    );
    expect(bad.body.error.code).toBe("password_policy");
    const next = randomBytes(20).toString("hex");
    const changed = await auth(
      "first-password",
      {
        operationId: newId(),
        currentPassword: password,
        newPassword: next,
        confirmPassword: next,
      },
      login.cookie,
    );
    expect(changed.response.status, JSON.stringify(changed.body)).toBe(204);
    expect(
      (await auth("session", undefined, login.cookie)).response.status,
    ).toBe(401);
    expect(
      (
        await pool.query(
          "SELECT count(*) FROM capture_context WHERE attendant_id=$1",
          [f.attendant.id],
        )
      ).rows[0].count,
    ).toBe("0");
    const fresh = await auth("sign-in", {
      username: f.input.username,
      password: next,
      deviceId: newId(),
    });
    expect(fresh.response.status).toBe(200);
    expect(fresh.body.data.pump.id).toBe(id(14));
    expect(fresh.body.data).toHaveProperty("captureContextId");
    const receipt = (
      await pool.query(
        "SELECT request_digest,result_snapshot FROM mutation_receipt WHERE actor_user_id=$1",
        [f.attendant.accountId],
      )
    ).rows;
    expect(JSON.stringify(receipt)).not.toContain(next);
    expect(JSON.stringify(receipt)).not.toContain(password);
  });
  it("first password accepts bounded multibyte credentials, rejects bad proof and oversized bodies without exposing secrets", async () => {
    const oldPassword = "€".repeat(1024),
      newPassword = "漢".repeat(1024);
    const input = {
      operationId: newId(),
      name: "Grace Test",
      username: `unicode.${randomBytes(5).toString("hex")}`,
      password: oldPassword,
      pumpId: id(14),
      expectedPumpVersion: 1,
    };
    const created = await call("attendants-create", input);
    expect(created.response.status).toBe(201);
    const login = await auth("sign-in", {
      username: input.username,
      password: oldPassword,
      deviceId: newId(),
    });
    expect(login.response.status).toBe(200);
    const change = {
      operationId: newId(),
      currentPassword: oldPassword,
      newPassword,
      confirmPassword: newPassword,
    };
    const bad = await auth(
      "first-password",
      { ...change, currentPassword: "wrong fictional password" },
      login.cookie,
    );
    expect(bad.response.status).toBe(401);
    expect(
      (
        await auth(
          "first-password",
          { ...change, extra: "x".repeat(33000) },
          login.cookie,
        )
      ).response.status,
    ).toBe(413);
    const result = await auth("first-password", change, login.cookie);
    expect(result.response.status).toBe(204);
    const fresh = await auth("sign-in", {
      username: input.username,
      password: newPassword,
      deviceId: newId(),
    });
    expect(fresh.response.status).toBe(200);
    const before = (
      await pool.query("SELECT auth_version FROM auth_user WHERE id=$1", [
        created.body.data.accountId,
      ])
    ).rows[0].auth_version;
    expect(
      (await auth("first-password", change, fresh.cookie)).response.status,
    ).toBe(204);
    expect(
      (
        await pool.query("SELECT auth_version FROM auth_user WHERE id=$1", [
          created.body.data.accountId,
        ])
      ).rows[0].auth_version,
    ).toBe(before);
  });
  it("I-05 concurrent reassignments close one interval; fresh sign-in acknowledges new pump without rewriting old context", async () => {
    const f = await create();
    await pool.query(
      "UPDATE auth_user SET must_change_password=false WHERE id=$1",
      [f.attendant.accountId],
    );
    const before = await auth("sign-in", {
      username: f.input.username,
      password,
      deviceId: newId(),
    });
    expect(before.response.status).toBe(200);
    const context = (
      await pool.query("SELECT * FROM capture_context WHERE id=$1", [
        before.body.data.captureContextId,
      ])
    ).rows[0];
    const input = {
      operationId: newId(),
      expectedVersion: 1,
      expectedAssignmentId: f.attendant.assignment.id,
      pumpId: id(15),
      expectedPumpVersion: 1,
      reason: "Fictional pump transfer",
    };
    const results = await Promise.all([
      call("attendants-assignment", input, f.attendant.id),
      call(
        "attendants-assignment",
        { ...input, operationId: newId(), pumpId: id(17) },
        f.attendant.id,
      ),
    ]);
    expect(results.map((r) => r.response.status).sort()).toEqual([200, 409]);
    const change = results.find((r) => r.response.status === 200)!.body.data;
    expect(change.attendant.handover).toBe("fresh_sign_in_required");
    expect(
      (
        await pool.query("SELECT * FROM capture_context WHERE id=$1", [
          context.id,
        ])
      ).rows[0],
    ).toEqual(context);
    const stale = await auth("session", undefined, before.cookie);
    expect(stale.body.data.pump.id).toBe(id(14));
    expect(stale.body.data.reassignmentRequiresSignIn).toBe(true);
    const fresh = await auth("sign-in", {
      username: f.input.username,
      password,
      deviceId: newId(),
    });
    expect(fresh.body.data.pump.id).toBe(change.attendant.assignment.pump.id);
    expect(fresh.body.data.reassignmentRequiresSignIn).toBe(false);
    const history = await call(
      "attendants-assignments",
      undefined,
      f.attendant.id,
    );
    expect(history.body.data.items).toHaveLength(2);
    expect(history.body.data.items[1].effectiveUntil).toBe(
      history.body.data.items[0].effectiveFrom,
    );
  });
  it("I-09 disabled accounts lose live session and cannot accept new assignments", async () => {
    const f = await create();
    await pool.query(
      "UPDATE auth_user SET must_change_password=false WHERE id=$1",
      [f.attendant.accountId],
    );
    const login = await auth("sign-in", {
      username: f.input.username,
      password,
      deviceId: newId(),
    });
    expect(login.response.status).toBe(200);
    await pool.query(
      "UPDATE auth_user SET enabled=false,auth_version=auth_version+1 WHERE id=$1",
      [f.attendant.accountId],
    );
    expect(
      (await auth("session", undefined, login.cookie)).response.status,
    ).toBe(401);
    const result = await call(
      "attendants-assignment",
      {
        operationId: newId(),
        expectedVersion: 1,
        expectedAssignmentId: f.attendant.assignment.id,
        pumpId: id(15),
        expectedPumpVersion: 1,
        reason: "Move disabled account",
      },
      f.attendant.id,
    );
    expect(result.body.error.code).toBe("attendant_unavailable");
  });
  it.each([true, false])(
    "P-20 price activation inside=%s capped [S,U] uses immutable original context and actual price history",
    async (inside) => {
      const product = inside ? id(9) : id(12),
        code = inside ? "pms" : "cooking_gas",
        pump = inside ? id(14) : id(17);
      const f = await historicalContext(pump, inside ? 1 : 25);
      const old = (
        await pool.query(
          "SELECT *,rate_kobo::text FROM product_price_version WHERE product_id=$1 ORDER BY version DESC LIMIT 1",
          [product],
        )
      ).rows[0];
      const result = await call(
        "prices-activate",
        {
          operationId: newId(),
          expectedVersion: old.version,
          rateKobo: (BigInt(old.rate_kobo) + 1n).toString(),
          currency: "NGN",
          quantityPrecision: old.quantity_precision,
          reason: "P-20 regression price change",
        },
        code,
      );
      expect(result.response.status, JSON.stringify(result.body)).toBe(201);
      const evaluated = await policyFromHistory(f.context, old.rate_kobo);
      expect(evaluated.reasons.includes("price_uncertain")).toBe(inside);
      if (!inside) expect(evaluated.reasons).toEqual([]);
      expect(
        (
          await pool.query("SELECT * FROM capture_context WHERE id=$1", [
            f.context,
          ])
        ).rows[0],
      ).toEqual(f.original);
    },
  );
  it.each([true, false])(
    "P-20 assignment change inside=%s capped [S,U] preserves old queue ownership and attribution",
    async (inside) => {
      const f = await historicalContext(id(16), inside ? 1 : 25);
      const oldRate = (
        await pool.query(
          "SELECT rate_kobo::text FROM product_price_version WHERE product_id=$1 ORDER BY version LIMIT 1",
          [id(11)],
        )
      ).rows[0].rate_kobo;
      const result = await call(
        "attendants-assignment",
        {
          operationId: newId(),
          expectedVersion: 1,
          expectedAssignmentId: f.assignment,
          pumpId: id(15),
          expectedPumpVersion: 1,
          reason: "P-20 regression transfer",
        },
        f.attendant,
      );
      expect(result.response.status, JSON.stringify(result.body)).toBe(200);
      const evaluated = await policyFromHistory(f.context, oldRate);
      expect(
        evaluated.reasons.includes("capture_authorization_unresolved"),
      ).toBe(inside);
      if (!inside) expect(evaluated.reasons).toEqual([]);
      const unchanged = (
        await pool.query("SELECT * FROM capture_context WHERE id=$1", [
          f.context,
        ])
      ).rows[0];
      expect(unchanged).toEqual(f.original);
      expect(unchanged.assignment_id).toBe(f.assignment);
      const old = (
        await pool.query("SELECT * FROM assignment WHERE id=$1", [f.assignment])
      ).rows[0];
      expect(old.pump_id).toBe(id(16));
      expect(old.effective_until).not.toBeNull();
    },
  );
});
async function historicalContext(pump: string, hours: number) {
  const user = newId(),
    attendant = newId(),
    assignment = newId(),
    context = newId(),
    username = `history.${randomBytes(5).toString("hex")}`;
  await pool.query(
    "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'attendant',$2,$2,'Grace Test',true,1,false,clock_timestamp())",
    [user, username],
  );
  await pool.query(
    "INSERT INTO attendant(id,user_id,staff_code,version) VALUES($1,$2,$3,1)",
    [attendant, user, `TEST-${attendant}`],
  );
  await pool.query(
    "INSERT INTO assignment(id,attendant_id,pump_id,assignment_version,effective_from,changed_by,reason) VALUES($1,$2,$3,1,clock_timestamp()-interval '30 hours',$4,'Historical assignment fixture')",
    [assignment, attendant, pump, id(5)],
  );
  await pool.query(
    "INSERT INTO capture_context(id,attendant_id,assignment_id,signed_in_at,offline_expires_at,seller_name,seller_username,device_binding_digest) SELECT $1,$2,$3,s,s+interval '24 hours','Grace Test',$4,'fictional-device-digest' FROM (SELECT clock_timestamp()-($5::integer*interval '1 hour') AS s) t",
    [context, attendant, assignment, username, hours],
  );
  return {
    attendant,
    assignment,
    context,
    original: (
      await pool.query("SELECT * FROM capture_context WHERE id=$1", [context])
    ).rows[0],
  };
}
async function policyFromHistory(context: string, rate: string) {
  const r = (
    await pool.query(
      `SELECT c.*,ag.pump_id,p.station_id,p.product_id,(extract(epoch from c.signed_in_at)*1000000)::bigint::text AS s,(extract(epoch from c.offline_expires_at)*1000000)::bigint::text AS expiry,(extract(epoch from clock_timestamp())*1000000)::bigint::text AS received,(extract(epoch from ag.effective_from)*1000000)::bigint::text AS assignment_from,(extract(epoch from ag.effective_until)*1000000)::bigint::text AS assignment_until FROM capture_context c JOIN assignment ag ON ag.id=c.assignment_id JOIN pump p ON p.id=ag.pump_id WHERE c.id=$1`,
      [context],
    )
  ).rows[0];
  const prices = (
    await pool.query(
      'SELECT (extract(epoch from effective_from)*1000000)::bigint::text AS "effectiveFrom",rate_kobo::text AS "rateKobo",currency FROM product_price_version WHERE station_id=$1 AND product_id=$2',
      [r.station_id, r.product_id],
    )
  ).rows;
  return evaluateCapturePolicy({
    signedInAt: r.s,
    receivedAt: r.received,
    offlineExpiresAt: r.expiry,
    contextRevokedAt: null,
    assignment: {
      effectiveFrom: r.assignment_from,
      effectiveUntil: r.assignment_until,
    },
    rateKobo: rate,
    currency: "NGN",
    prices,
    settings: [],
  });
}
