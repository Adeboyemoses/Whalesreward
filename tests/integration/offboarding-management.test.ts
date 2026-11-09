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
vi.setConfig({ testTimeout: 30000 });
const schema = `offboarding_management_${randomBytes(6).toString("hex")}`;
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
describe("P-21 assignment-ending transaction", () => {
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

  it("ends exactly one interval with durable applied receipt, immutable opening history and actual ending audit", async () => {
    const f = await create();
    const opening = (
      await pool.query("SELECT * FROM assignment WHERE id=$1", [
        f.attendant.assignment.id,
      ])
    ).rows[0];
    const userBefore = (
      await pool.query("SELECT auth_version FROM auth_user WHERE id=$1", [
        f.attendant.accountId,
      ])
    ).rows[0];
    const input = {
      operationId: newId(),
      expectedVersion: 1,
      expectedAssignmentId: opening.id,
      reason: "  End assignment after departure  ",
    };
    const ended = await call(
      "attendants-assignment-end",
      input,
      f.attendant.id,
    );
    expect(ended.response.status, JSON.stringify(ended.body)).toBe(200);
    expect(ended.body.data.attendant).toMatchObject({
      version: 2,
      assignment: null,
      handover: "unassigned",
    });
    expect(ended.body.data.ended).toMatchObject({
      assignmentId: opening.id,
      assignmentVersion: 1,
      pumpId: opening.pump_id,
      actor: { id: id(5) },
      reason: input.reason.trim(),
    });
    const closed = (
      await pool.query("SELECT * FROM assignment WHERE id=$1", [opening.id])
    ).rows[0];
    expect({ ...closed, effective_until: null }).toEqual(opening);
    expect(closed.effective_until.getTime()).toBeGreaterThanOrEqual(
      opening.effective_from.getTime(),
    );
    const event = (
      await pool.query(
        "SELECT *,occurred_at::text AS exact_time FROM audit_event WHERE action='assignment_ended' AND target_id=$1",
        [f.attendant.id],
      )
    ).rows;
    expect(event).toHaveLength(1);
    expect(event[0]).toMatchObject({
      actor_user_id: id(2),
      target_type: "attendant",
      operation_id: input.operationId,
      reason: input.reason.trim(),
      before: {
        assignmentId: opening.id,
        pumpId: opening.pump_id,
        effectiveUntil: null,
        attendantVersion: "1",
        authVersion: String(userBefore.auth_version),
      },
      after: {
        assignmentId: null,
        pumpId: null,
        attendantVersion: "2",
        authVersion: String(userBefore.auth_version + 1),
      },
    });
    expect(event[0].occurred_at).toEqual(closed.effective_until);
    expect(new Date(event[0].after.effectiveUntil)).toEqual(
      closed.effective_until,
    );
    const reassigned = await call(
      "attendants-assignment",
      {
        operationId: newId(),
        expectedVersion: 2,
        expectedAssignmentId: null,
        pumpId: id(15),
        expectedPumpVersion: 1,
        reason: "Return after gap",
      },
      f.attendant.id,
    );
    expect(reassigned.response.status, JSON.stringify(reassigned.body)).toBe(
      200,
    );
    expect(reassigned.body.data.attendant.assignment.version).toBe(2);
    const replay = await call(
      "attendants-assignment-end",
      input,
      f.attendant.id,
    );
    expect(replay.body.data).toEqual(ended.body.data);
    const latest = await call("attendants-get", undefined, f.attendant.id);
    expect(latest.body.data.assignment.id).toBe(
      reassigned.body.data.attendant.assignment.id,
    );
    expect(
      (
        await pool.query(
          "SELECT count(*) FROM audit_event WHERE action='assignment_ended' AND target_id=$1",
          [f.attendant.id],
        )
      ).rows[0].count,
    ).toBe("1");
    const changed = await call(
      "attendants-assignment-end",
      { ...input, reason: "Different" },
      f.attendant.id,
    );
    expect(changed.body.error.code).toBe("operation_conflict");
  });
  it("serializes end/end and end/reassignment with exactly one reviewed winner", async () => {
    for (const other of ["end", "reassign"]) {
      const f = await create();
      const guard = {
        expectedVersion: 1,
        expectedAssignmentId: f.attendant.assignment.id,
        reason: "Reviewed change",
      };
      const results = await Promise.all([
        call(
          "attendants-assignment-end",
          { ...guard, operationId: newId() },
          f.attendant.id,
        ),
        call(
          other === "end"
            ? "attendants-assignment-end"
            : "attendants-assignment",
          {
            ...guard,
            operationId: newId(),
            ...(other === "reassign"
              ? { pumpId: id(15), expectedPumpVersion: 1 }
              : {}),
          },
          f.attendant.id,
        ),
      ]);
      expect(results.map((r) => r.response.status).sort()).toEqual([200, 409]);
      expect(
        results.find((r) => r.response.status === 409)!.body.error.code,
      ).toBe("version_conflict");
      expect(
        (
          await pool.query("SELECT version FROM attendant WHERE id=$1", [
            f.attendant.id,
          ])
        ).rows[0].version,
      ).toBe(2);
    }
  });
  it("failed guards and audit failure roll back assignment, auth state and receipt", async () => {
    const f = await create();
    const input = {
      operationId: newId(),
      expectedVersion: 1,
      expectedAssignmentId: f.attendant.assignment.id,
      reason: "Rollback test",
    };
    for (const bad of [
      { ...input, expectedVersion: 2 },
      { ...input, expectedAssignmentId: newId() },
    ]) {
      expect(
        (await call("attendants-assignment-end", bad, f.attendant.id)).body
          .error.code,
      ).toBe("version_conflict");
    }
    await pool.query(
      `CREATE FUNCTION reject_end_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='assignment_ended' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      "CREATE TRIGGER reject_end_audit BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION reject_end_audit()",
    );
    try {
      expect(
        (await call("attendants-assignment-end", input, f.attendant.id))
          .response.status,
      ).toBe(503);
    } finally {
      await pool.query("DROP TRIGGER reject_end_audit ON audit_event");
    }
    expect(
      (
        await pool.query("SELECT effective_until FROM assignment WHERE id=$1", [
          f.attendant.assignment.id,
        ])
      ).rows[0].effective_until,
    ).toBeNull();
    expect(
      (
        await pool.query("SELECT auth_version FROM auth_user WHERE id=$1", [
          f.attendant.accountId,
        ])
      ).rows[0].auth_version,
    ).toBe(1);
    expect(
      (
        await pool.query("SELECT version FROM attendant WHERE id=$1", [
          f.attendant.id,
        ])
      ).rows[0].version,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT count(*) FROM mutation_receipt WHERE operation_id=$1",
          [input.operationId],
        )
      ).rows[0].count,
    ).toBe("0");
    expect(
      (await call("attendants-assignment-end", input, f.attendant.id)).response
        .status,
    ).toBe(200);
  });
});
