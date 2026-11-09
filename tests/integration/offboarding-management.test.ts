import { readFile, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { signIn } from "../../src/server/modules/auth/service";
import { firstPassword } from "../../src/server/modules/auth/first-password";
import { createSyncService } from "../../src/server/modules/sync/service";
import type { OriginalSale } from "../../src/shared/contracts/sync";
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
    url.searchParams.set("application_name", schema);
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

  it.each(["sign-in", "first-password"])(
    "end committed before waiting %s cannot mint authority",
    async (action) => {
      const f = await create();
      const login = await auth("sign-in", {
        username: f.input.username,
        password,
        deviceId: newId(),
      });
      const barrier = pauseCommit(
        pool,
        "UPDATE assignment SET effective_until",
      );
      const ending = stationWrite(
        barrier.pool,
        adminConfig(),
        token,
        "attendants-assignment-end",
        {
          operationId: newId(),
          expectedVersion: 1,
          expectedAssignmentId: f.attendant.assignment.id,
          reason: "Departure",
        },
        f.attendant.id,
      );
      await barrier.paused;
      const nextPassword = randomBytes(20).toString("hex");
      const pending =
        action === "sign-in"
          ? signIn(
              pool,
              adminConfig(),
              { username: f.input.username, password, deviceId: newId() },
              newId(),
              `race-${newId()}`,
              true,
            )
          : firstPassword(
              pool,
              adminConfig(),
              login.cookie!.split("=")[1],
              {
                operationId: newId(),
                currentPassword: password,
                newPassword: nextPassword,
                confirmPassword: nextPassword,
              },
              `race-${newId()}`,
            );
      const checked = expect(pending).rejects.toMatchObject(
        action === "sign-in"
          ? { code: "assignment_unavailable", status: 422 }
          : { code: "unauthenticated", status: 401 },
      );
      try {
        await waitForSecurityWait();
      } finally {
        barrier.resume();
      }
      await ending;
      await checked;
      expect(
        (
          await pool.query(
            "SELECT count(*) FROM auth_session WHERE user_id=$1 AND revoked_at IS NULL",
            [f.attendant.accountId],
          )
        ).rows[0].count,
      ).toBe("0");
      expect(
        (
          await pool.query(
            "SELECT must_change_password FROM auth_user WHERE id=$1",
            [f.attendant.accountId],
          )
        ).rows[0].must_change_password,
      ).toBe(true);
    },
  );
  it("sign-in ordered before end commits is revoked with its context", async () => {
    const f = await create();
    await pool.query(
      "UPDATE auth_user SET must_change_password=false WHERE id=$1",
      [f.attendant.accountId],
    );
    const barrier = pauseCommit(pool, "INSERT INTO auth_session");
    const signing = signIn(
      barrier.pool,
      adminConfig(),
      { username: f.input.username, password, deviceId: newId() },
      newId(),
      `race-${newId()}`,
      true,
    );
    await barrier.paused;
    const ending = stationWrite(
      pool,
      adminConfig(),
      token,
      "attendants-assignment-end",
      {
        operationId: newId(),
        expectedVersion: 1,
        expectedAssignmentId: f.attendant.assignment.id,
        reason: "Departure",
      },
      f.attendant.id,
    );
    try {
      await waitForSecurityWait();
    } finally {
      barrier.resume();
    }
    const signed = await signing;
    await ending;
    expect(
      (await auth("session", undefined, `__Host-whr-session=${signed.token}`))
        .response.status,
    ).toBe(401);
    expect(
      (
        await pool.query(
          "SELECT count(*) FROM capture_context WHERE attendant_id=$1 AND revoked_at IS NULL",
          [f.attendant.id],
        )
      ).rows[0].count,
    ).toBe("0");
  });
  it("first-password completion before end invalidates old credential proof waiting to sign in", async () => {
    const f = await create();
    const login = await auth("sign-in", {
      username: f.input.username,
      password,
      deviceId: newId(),
    });
    const barrier = pauseCommit(
      pool,
      "UPDATE auth_user SET must_change_password=false",
    );
    const nextPassword = randomBytes(20).toString("hex");
    const changing = firstPassword(
      barrier.pool,
      adminConfig(),
      login.cookie!.split("=")[1],
      {
        operationId: newId(),
        currentPassword: password,
        newPassword: nextPassword,
        confirmPassword: nextPassword,
      },
      `race-${newId()}`,
    );
    await barrier.paused;
    const oldSigning = signIn(
      pool,
      adminConfig(),
      { username: f.input.username, password, deviceId: newId() },
      newId(),
      `race-${newId()}`,
      true,
    );
    const checked = expect(oldSigning).rejects.toMatchObject({
      code: "invalid_credentials",
      status: 401,
    });
    try {
      await waitForSecurityWait();
    } finally {
      barrier.resume();
    }
    await changing;
    await checked;
    const ended = await call(
      "attendants-assignment-end",
      {
        operationId: newId(),
        expectedVersion: 1,
        expectedAssignmentId: f.attendant.assignment.id,
        reason: "Departure after password completion",
      },
      f.attendant.id,
    );
    expect(ended.response.status).toBe(200);
    expect(
      (
        await pool.query(
          "SELECT count(*) FROM auth_session WHERE user_id=$1 AND revoked_at IS NULL",
          [f.attendant.accountId],
        )
      ).rows[0].count,
    ).toBe("0");
  });
  it.each([1, 0, -1])(
    "P-20 end at U minus %s microsecond preserves original bounds and first receipt through actual same-account resumption",
    async (offset) => {
      const f = await historicalAttendant();
      const context = newId();
      // Fixture-only trigger creates exact historical S/U from trusted end T. This
      // avoids JS millisecond rounding at the closed authorization boundary.
      const trigger = `context_${context.replaceAll("-", "")}`;
      await pool.query(
        `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${f.assignment}'::uuid THEN INSERT INTO capture_context(id,attendant_id,assignment_id,signed_in_at,offline_expires_at,seller_name,seller_username,device_binding_digest) VALUES('${context}','${f.attendant}','${f.assignment}',NEW.effective_until-interval '24 hours'+interval '${offset} microseconds',NEW.effective_until+interval '${offset} microseconds','Grace Test','${f.username}','fictional-device'); END IF; RETURN NEW; END $$`,
      );
      await pool.query(
        `CREATE TRIGGER ${trigger} BEFORE UPDATE ON assignment FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
      );
      let ended;
      try {
        ended = await call(
          "attendants-assignment-end",
          {
            operationId: newId(),
            expectedVersion: 1,
            expectedAssignmentId: f.assignment,
            reason: "P-20 termination boundary",
          },
          f.attendant,
        );
      } finally {
        await pool.query(`DROP TRIGGER ${trigger} ON assignment`);
      }
      expect(ended.response.status, JSON.stringify(ended.body)).toBe(200);
      const before = (
        await pool.query(
          "SELECT *,signed_in_at::text AS exact_s,offline_expires_at::text AS exact_u,revoked_at::text AS exact_t FROM capture_context WHERE id=$1",
          [context],
        )
      ).rows[0];
      const reassigned = await call(
        "attendants-assignment",
        {
          operationId: newId(),
          expectedVersion: 2,
          expectedAssignmentId: null,
          pumpId: id(15),
          expectedPumpVersion: 1,
          reason: "Later authorized return",
        },
        f.attendant,
      );
      expect(reassigned.response.status).toBe(200);
      const fresh = await auth("sign-in", {
        username: f.username,
        password,
        deviceId: newId(),
      });
      expect(fresh.response.status).toBe(200);
      expect(fresh.body.data.pump.id).toBe(id(15));
      const jpeg = await sharp({
        create: { width: 40, height: 30, channels: 3, background: "#ffffff" },
      })
        .jpeg()
        .toBuffer();
      const written = new Map<string, Buffer>();
      const service = createSyncService({
        pool,
        storage: {
          async signPut() {
            return { url: "https://storage.example.test/staging", headers: {} };
          },
          async read() {
            return jpeg;
          },
          async writeFinal(key, bytes) {
            written.set(key, bytes);
          },
        },
      });
      const original: OriginalSale = {
        operationId: newId(),
        captureContextId: context,
        assignmentId: f.assignment,
        cardCode: "A7K3M9Q",
        appCapturedAt: before.signed_in_at.toISOString(),
        priceVersionId: id(20),
        rateKobo: "100000",
        currency: "NGN",
        quantityPrecision: 2,
        unit: "litre",
        medium: "vehicle",
        entry: {
          basis: "amount",
          enteredAmountKobo: "2000000",
          amountKobo: "2000000",
          quantity: "20",
        },
        photo: {
          sha256: createHash("sha256").update(jpeg).digest("hex"),
          bytes: jpeg.length,
          mediaType: "image/jpeg",
        },
      };
      const freshToken = fresh.cookie!.split("=")[1]!;
      const submitted = await service.submit(freshToken, original);
      const receipt = (
        await pool.query("SELECT * FROM purchase WHERE id=$1", [
          submitted.status.purchaseId,
        ])
      ).rows[0];
      expect(receipt).toMatchObject({
        originating_attendant_id: f.attendant,
        assignment_id: f.assignment,
        pump_id: id(13),
        capture_context_id: context,
        operation_id: original.operationId,
      });
      const upload = await service.uploadPermission(freshToken, receipt.id, {
        operationId: newId(),
        ...original.photo,
      });
      const finalize = {
        operationId: newId(),
        uploadId: upload.uploadId,
        expectedVersion: submitted.status.version,
      };
      const result = await service.finalize(freshToken, receipt.id, finalize);
      expect(result.state).toBe(offset >= 0 ? "held" : "credited");
      expect(result.credited).toBe(offset < 0);
      expect(written.size).toBe(1);
      expect(
        (
          await pool.query(
            "SELECT reasons FROM sync_validation WHERE purchase_id=$1",
            [receipt.id],
          )
        ).rows[0].reasons,
      ).toEqual(offset >= 0 ? ["capture_authorization_unresolved"] : []);
      expect((await service.submit(freshToken, original)).status).toEqual(
        result,
      );
      expect(await service.finalize(freshToken, receipt.id, finalize)).toEqual(
        result,
      );
      expect(
        (
          await pool.query("SELECT * FROM capture_context WHERE id=$1", [
            context,
          ])
        ).rows[0],
      ).toMatchObject({
        signed_in_at: before.signed_in_at,
        offline_expires_at: before.offline_expires_at,
        revoked_at: before.revoked_at,
        assignment_id: f.assignment,
      });
      expect(
        (
          await pool.query(
            "SELECT server_received_at FROM purchase WHERE id=$1",
            [receipt.id],
          )
        ).rows[0].server_received_at,
      ).toEqual(receipt.server_received_at);
      expect(
        (
          await pool.query(
            "SELECT count(*) FROM purchase_revision WHERE purchase_id=$1 AND state='accepted'",
            [receipt.id],
          )
        ).rows[0].count,
      ).toBe(offset < 0 ? "1" : "0");
      const other = await create();
      await pool.query(
        "UPDATE auth_user SET must_change_password=false WHERE id=$1",
        [other.attendant.accountId],
      );
      const stranger = await auth("sign-in", {
        username: other.input.username,
        password,
        deviceId: newId(),
      });
      await expect(
        service.submit(stranger.cookie!.split("=")[1], original),
      ).rejects.toMatchObject({ code: "capture_context_invalid" });
      await expect(
        service.status(stranger.cookie!.split("=")[1], receipt.id),
      ).rejects.toMatchObject({ code: "sale_not_found" });
    },
  );
  it("ends exactly one interval with durable applied receipt, immutable opening history and actual ending audit", async () => {
    const f = await create();
    await pool.query(
      "UPDATE auth_user SET must_change_password=false WHERE id=$1",
      [f.attendant.accountId],
    );
    const prior = await auth("sign-in", {
      username: f.input.username,
      password,
      deviceId: newId(),
    });
    await pool.query(
      "UPDATE capture_context SET revoked_at=clock_timestamp() WHERE id=$1",
      [prior.body.data.captureContextId],
    );
    const revokedContext = (
      await pool.query("SELECT * FROM capture_context WHERE id=$1", [
        prior.body.data.captureContextId,
      ])
    ).rows[0];
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
    const returning = await auth("sign-in", {
      username: f.input.username,
      password,
      deviceId: newId(),
    });
    expect(returning.response.status).toBe(200);
    const replay = await call(
      "attendants-assignment-end",
      input,
      f.attendant.id,
    );
    expect(replay.body.data).toEqual(ended.body.data);
    expect(
      (await auth("session", undefined, returning.cookie)).response.status,
    ).toBe(200);
    expect(
      (
        await pool.query("SELECT * FROM capture_context WHERE id=$1", [
          prior.body.data.captureContextId,
        ])
      ).rows[0],
    ).toEqual(revokedContext);
    expect(
      (
        await pool.query("SELECT revoked_at FROM capture_context WHERE id=$1", [
          returning.body.data.captureContextId,
        ])
      ).rows[0].revoked_at,
    ).toBeNull();

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

function pauseCommit(target: pg.Pool, mutation: string) {
  let pausedResolve!: () => void, resumeResolve!: () => void;
  const paused = new Promise<void>((r) => {
      pausedResolve = r;
    }),
    resume = new Promise<void>((r) => {
      resumeResolve = r;
    });
  const wrapped = new Proxy(target, {
    get(pool, key) {
      if (key === "connect")
        return async () => {
          const db = await pool.connect();
          let armed = false;
          return new Proxy(db, {
            get(client, property) {
              if (property === "query")
                return async (...args: unknown[]) => {
                  if (typeof args[0] === "string" && args[0].includes(mutation))
                    armed = true;
                  if (args[0] === "COMMIT" && armed) {
                    pausedResolve();
                    await resume;
                  }
                  return Reflect.apply(client.query, client, args);
                };
              const value = Reflect.get(client, property);
              return typeof value === "function" ? value.bind(client) : value;
            },
          });
        };
      const value = Reflect.get(pool, key);
      return typeof value === "function" ? value.bind(pool) : value;
    },
  });
  return { pool: wrapped, paused, resume: resumeResolve };
}
async function waitForSecurityWait() {
  for (let i = 0; i < 200; i++) {
    const row = (
      await pool.query(
        "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%security_state%') AS waiting",
        [schema],
      )
    ).rows[0];
    if (row.waiting) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("Expected a real database security-state lock wait");
}
async function historicalAttendant() {
  const user = newId(),
    attendant = newId(),
    assignment = newId(),
    username = `history.${randomBytes(5).toString("hex")}`;
  await pool.query(
    "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'attendant',$2,$2,'Grace Test',true,1,false,clock_timestamp())",
    [user, username],
  );
  await pool.query(
    "INSERT INTO auth_credential(id,user_id,provider,provider_account_id,password_hash,updated_at) VALUES($1,$2::uuid,'credential',$2::text,$3,clock_timestamp())",
    [newId(), user, await hashPassword(password)],
  );
  await pool.query(
    "INSERT INTO attendant(id,user_id,staff_code,version) VALUES($1,$2,$3,1)",
    [attendant, user, `TEST-${attendant}`],
  );
  await pool.query(
    "INSERT INTO assignment(id,attendant_id,pump_id,assignment_version,effective_from,changed_by,reason) VALUES($1,$2,$3,1,clock_timestamp()-interval '48 hours',$4,'Historical opening')",
    [assignment, attendant, id(13), id(5)],
  );
  return { user, attendant, assignment, username };
}
