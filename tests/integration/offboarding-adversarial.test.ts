import { createHash, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";
import sharp from "sharp";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import {
  createStorage,
  type EvidenceStorage,
} from "../../src/server/adapters/storage";
import { createSyncService } from "../../src/server/modules/sync/service";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { seedAdminCredentials } from "../../prisma/seed-auth.mjs";
import { newId } from "../../src/server/lib/ids";
import { handleAdmin } from "../../src/server/modules/admin-access/http";
import { handleAuth } from "../../src/server/modules/auth/http";
import { handleStation } from "../../src/server/modules/station/http";
import { handleSync } from "../../src/server/modules/sync/http";

vi.setConfig({ testTimeout: 30000 });
vi.mock(
  "@/server/modules/station/http",
  async () => import("../../src/server/modules/station/http"),
);
const origin = "https://station.example.test";
const password = randomBytes(24).toString("hex");
const schema = `offboarding_adversarial_${randomBytes(8).toString("hex")}`;
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

async function target(restricted = false) {
  const username = `leave.${newId().slice(-12)}`;
  const created = await createAttendant(username);
  expect(created.response.status, JSON.stringify(created.body)).toBe(201);
  const account = (
    await pool.query("SELECT user_id FROM attendant WHERE id=$1", [
      created.body.data.id,
    ])
  ).rows[0];
  if (!restricted)
    await pool.query(
      "UPDATE auth_user SET must_change_password=false WHERE id=$1",
      [account.user_id],
    );
  return { ...created.body.data, username, userId: account.user_id };
}
function endInput(f: { version: number; assignment: { id: string } }) {
  return {
    operationId: newId(),
    expectedVersion: f.version,
    expectedAssignmentId: f.assignment.id,
    reason: "Fictional approved departure",
  };
}
async function snapshot(attendantId: string) {
  return (
    await pool.query(
      `SELECT to_jsonb(a) attendant,
    (SELECT jsonb_agg(to_jsonb(g) ORDER BY g.id) FROM assignment g WHERE g.attendant_id=a.id) assignments,
    (SELECT to_jsonb(u) FROM auth_user u WHERE u.id=a.user_id) account,
    (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM auth_session s WHERE s.user_id=a.user_id) sessions,
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM capture_context c WHERE c.attendant_id=a.id) contexts,
    (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM audit_event e WHERE e.target_id=a.id) audits
    FROM attendant a WHERE a.id=$1`,
      [attendantId],
    )
  ).rows[0];
}
async function end(f: { id: string }, body: unknown, cookie = ownerCookie) {
  return station("attendants-assignment-end", { cookie, target: f.id, body });
}

describe("independent P-21 offboarding adversarial checks", () => {
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

  // Each case owns its isolated schema; resetting only rate buckets prevents
  // fixture provisioning from consuming another case's HTTP quota.
  beforeEach(async () => {
    await pool.query("DELETE FROM auth_rate_bucket");
  });

  it.each(["pumps", "attendants"])(
    "I-07 P-21 either %s grant independently authorizes assignment end",
    async (grant) => {
      const actor = await admin([grant]);
      const f = await target();
      const input = endInput(f);
      const ended = await end(f, input, actor.cookie);
      expect(ended.response.status, JSON.stringify(ended.body)).toBe(200);
      expect(ended.body.data.attendant).toMatchObject({
        id: f.id,
        assignment: null,
        handover: "unassigned",
        version: f.version + 1,
      });
      const audit = (
        await pool.query(
          "SELECT action,actor_user_id,operation_id,reason FROM audit_event WHERE target_id=$1 AND action='assignment_ended'",
          [f.id],
        )
      ).rows;
      expect(audit).toEqual([
        {
          action: "assignment_ended",
          actor_user_id: actor.userId,
          operation_id: input.operationId,
          reason: input.reason,
        },
      ]);
    },
  );

  it("I-07 P-21 no-grant admins and ordinary attendants cannot end assignments or acquire recovery authority", async () => {
    const actor = await admin([]),
      f = await target();
    const login = await attendantLogin(f.username);
    const before = await snapshot(f.id);
    for (const [cookie, expectedStatus] of [
      [actor.cookie, 403],
      [login.cookie, 401],
    ] as const) {
      const denied = await end(f, endInput(f), cookie);
      expect(denied.response.status, JSON.stringify(denied.body)).toBe(
        expectedStatus,
      );
    }
    expect(await snapshot(f.id)).toEqual(before);
    // M3 recovery and review do not exist in this milestone. End authority
    // cannot be repurposed as ordinary account impersonation or queue access.
    const impersonation = await station("configured-assignment", {
      cookie: actor.cookie,
    });
    expect(impersonation.response.status).toBe(401);
  });

  it("I-07/I-41 P-21 strict HTTP and exact non-null guards reject without side effects", async () => {
    const f = await target(),
      base = endInput(f);
    await attendantLogin(f.username);
    const before = await snapshot(f.id);
    const noVersion: Record<string, unknown> = { ...base };
    delete noVersion.expectedVersion;
    const noAssignment: Record<string, unknown> = { ...base };
    delete noAssignment.expectedAssignmentId;
    for (const body of [
      noVersion,
      noAssignment,
      { ...base, expectedAssignmentId: null },
      { ...base, expectedVersion: null },
      { ...base, effectiveUntil: new Date().toISOString() },
      { ...base, reason: "   " },
    ]) {
      const denied = await end(f, body);
      expect(denied.response.status, JSON.stringify(denied.body)).toBe(400);
      expect(denied.response.headers.get("cache-control")).toBe("no-store");
      expect(await snapshot(f.id)).toEqual(before);
    }
    for (const body of [
      { ...base, expectedVersion: f.version + 1 },
      { ...base, expectedAssignmentId: newId() },
    ]) {
      const denied = await end(f, body);
      expect(denied.response.status, JSON.stringify(denied.body)).toBe(409);
      expect(denied.body.error.code).toBe("version_conflict");
      expect(await snapshot(f.id)).toEqual(before);
    }
    for (const options of [
      { origin: "https://other.example.test", body: base },
      { body: base, query: "?impersonate=true" },
      { method: "GET" },
      { rawBody: "{" },
    ]) {
      const denied = await station("attendants-assignment-end", {
        cookie: ownerCookie,
        target: f.id,
        ...options,
      });
      expect([400, 403]).toContain(denied.response.status);
      expect(await snapshot(f.id)).toEqual(before);
    }
    const tooLarge = await station("attendants-assignment-end", {
      cookie: ownerCookie,
      target: f.id,
      rawBody: JSON.stringify({ ...base, reason: "x".repeat(33000) }),
    });
    expect(tooLarge.response.status).toBe(413);
    expect(await snapshot(f.id)).toEqual(before);
  });

  it("I-09/I-41 P-21 disabled and absent targets cannot produce a receipt or ending audit", async () => {
    const f = await target();
    await pool.query("UPDATE auth_user SET enabled=false WHERE id=$1", [
      f.userId,
    ]);
    const before = await snapshot(f.id);
    const denied = await end(f, endInput(f));
    expect(denied.response.status, JSON.stringify(denied.body)).toBe(422);
    expect(denied.body.error.code).toBe("attendant_unavailable");
    expect(await snapshot(f.id)).toEqual(before);
    const absentId = newId();
    const missing = await end({ id: absentId }, endInput(f));
    expect(missing.response.status).toBe(404);
    expect(missing.body.error.code).toBe("not_found");
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit_event WHERE target_id=$1",
          [absentId],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("I-07/I-09 P-21 permission removed while waiting on security lock cannot authorize end", async () => {
    const actor = await admin(["pumps"]),
      f = await target();
    const before = await snapshot(f.id),
      client = await pool.connect();
    let pending: ReturnType<typeof end> | undefined;
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT id FROM security_state WHERE id=true FOR UPDATE",
      );
      pending = end(f, endInput(f), actor.cookie);
      let waiting = false;
      for (let n = 0; n < 200; n++) {
        const r = await pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%security_state%'",
          [schema],
        );
        if (r.rowCount) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(
        waiting,
        "assignment ending must wait for live authority serialization",
      ).toBe(true);
      await client.query("DELETE FROM role_permission WHERE role_id=$1", [
        actor.roleId,
      ]);
      await client.query("COMMIT");
      const denied = await pending;
      expect(denied.response.status, JSON.stringify(denied.body)).toBe(403);
      expect(denied.body.error.code).toBe("permission_denied");
      expect(await snapshot(f.id)).toEqual(before);
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await pending;
    }
  });

  it("I-07 P-21 successful replay rechecks the actor's current grant before returning the stored receipt", async () => {
    const actor = await admin(["attendants"]),
      f = await target(),
      input = endInput(f);
    expect((await end(f, input, actor.cookie)).response.status).toBe(200);
    const before = await snapshot(f.id);
    await pool.query("DELETE FROM role_permission WHERE role_id=$1", [
      actor.roleId,
    ]);
    const denied = await end(f, input, actor.cookie);
    expect(denied.response.status).toBe(403);
    expect(denied.body.error.code).toBe("permission_denied");
    expect(await snapshot(f.id)).toEqual(before);
  });

  it("I-09 P-21 every existing protected attendant read and write rejects full and restricted device cookies after end", async () => {
    const f = await target();
    const first = await attendantLogin(f.username),
      second = await attendantLogin(f.username);
    await pool.query(
      "UPDATE auth_user SET must_change_password=true WHERE id=$1",
      [f.userId],
    );
    const restricted = await attendantLogin(f.username);
    expect(restricted.body.data.state).toBe("password_change_required");
    expect((await end(f, endInput(f))).response.status).toBe(200);
    const before = await snapshot(f.id);
    for (const signed of [first, second, restricted]) {
      expect(signed.cookie).toBeTruthy();
      const cookie = signed.cookie;
      const responses = [
        await handleAuth(request("attendant/session", { cookie }), "session"),
        await handleAuth(
          request("attendant/first-password", {
            cookie,
            body: {
              operationId: newId(),
              currentPassword: password,
              newPassword: "Fictional replacement password 246!",
              confirmPassword: "Fictional replacement password 246!",
            },
          }),
          "first-password",
        ),
        await handleStation(
          request("attendant/configured-assignment", { cookie }),
          "configured-assignment",
        ),
        ...(await Promise.all(
          (
            [
              ["lookup", undefined, { cardCode: "A7K3M9Q" }],
              ["submit", undefined, {}],
              ["status", newId(), undefined],
              ["upload-permission", newId(), {}],
              ["finalize", newId(), {}],
            ] as const
          ).map(([action, id, body]) =>
            handleSync(request(`sync/${action}`, { cookie, body }), action, id),
          ),
        )),
      ];
      for (const response of responses) {
        const body = await response.json();
        expect(response.status, JSON.stringify(body)).toBe(401);
        expect(body.error.code).toBe("unauthenticated");
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
    }
    expect(await snapshot(f.id)).toEqual(before);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM auth_session WHERE user_id=$1 AND revoked_at IS NULL",
          [f.userId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("I-09/I-26 P-21 assignment end during a real evidence write prevents finalize credit at commit", async () => {
    const f = await target(),
      signed = await attendantLogin(f.username);
    expect(signed.response.status).toBe(200);
    const session = signed.body.data,
      token = signed.cookie!.split("=")[1]!;
    const config = {
      endpoint: "http://127.0.0.1:9000",
      region: "us-east-1",
      bucket: `offboard-${newId()}`,
      accessKeyId: "whr-local",
      secretAccessKey: "local-development-only",
      forcePathStyle: true,
    };
    const s3 = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    });
    try {
      await s3.send(new CreateBucketCommand({ Bucket: config.bucket }));
      const storage = createStorage(config),
        service = createSyncService({ pool, storage });
      const jpeg = await sharp({
        create: { width: 640, height: 480, channels: 3, background: "#123456" },
      })
        .jpeg()
        .toBuffer();
      const original = {
        operationId: newId(),
        captureContextId: session.captureContextId,
        assignmentId: session.assignment.id,
        cardCode: "A7K3M9Q",
        appCapturedAt: session.lastOnlineSignInAt,
        priceVersionId: session.price.priceVersionId,
        rateKobo: "100000",
        currency: "NGN" as const,
        quantityPrecision: 2,
        unit: "litre" as const,
        medium: "vehicle" as const,
        entry: {
          basis: "amount" as const,
          enteredAmountKobo: "2000000",
          amountKobo: "2000000",
          quantity: "20",
        },
        photo: {
          sha256: createHash("sha256").update(jpeg).digest("hex"),
          bytes: jpeg.length,
          mediaType: "image/jpeg" as const,
        },
      };
      const submitted = await service.submit(token, original);
      expect(submitted.status.state).toBe("photo_pending");
      const purchaseId = submitted.status.purchaseId;
      const upload = await service.uploadPermission(token, purchaseId, {
        operationId: newId(),
        ...original.photo,
      });
      const put = await fetch(upload.url, {
        method: "PUT",
        headers: upload.headers,
        body: new Uint8Array(jpeg),
      });
      expect(put.status).toBe(200);
      let arrived!: () => void, release!: () => void;
      const reachedStorage = new Promise<void>((resolve) => {
        arrived = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const paused: EvidenceStorage = {
        signPut: storage.signPut.bind(storage),
        read: storage.read.bind(storage),
        writeFinal: async (key, bytes) => {
          await storage.writeFinal(key, bytes);
          arrived();
          await released;
        },
      };
      const finalize = {
        operationId: newId(),
        uploadId: upload.uploadId,
        expectedVersion: submitted.status.version,
      };
      // Attach the rejection handler before releasing storage to avoid an
      // unhandled-rejection race in the test runner.
      const outcome = createSyncService({ pool, storage: paused })
        .finalize(token, purchaseId, finalize)
        .then(
          (value) => ({ value, error: undefined }),
          (error) => ({ value: undefined, error }),
        );
      try {
        await reachedStorage;
        const ended = await end(f, endInput(f));
        expect(ended.response.status, JSON.stringify(ended.body)).toBe(200);
      } finally {
        release();
      }
      const result = await outcome;
      expect(result.error).toMatchObject({
        status: 401,
        code: "unauthenticated",
      });
      expect(result.value).toBeUndefined();
      const persisted = (
        await pool.query(
          `SELECT p.status,p.current_revision_id,
        (SELECT count(*)::int FROM purchase_revision r WHERE r.purchase_id=p.id) revisions,
        (SELECT count(*)::int FROM audit_event e WHERE e.target_id=p.id AND e.action IN ('purchase.credited','purchase.held')) settlement_audits,
        (SELECT completed_at FROM sync_finalize_operation o WHERE o.purchase_id=p.id AND o.operation_id=$2) completed_at
        FROM purchase p WHERE p.id=$1`,
          [purchaseId, finalize.operationId],
        )
      ).rows[0];
      expect(persisted).toEqual({
        status: "photo_pending",
        current_revision_id: null,
        revisions: 0,
        settlement_audits: 0,
        completed_at: null,
      });
      const asset = (
        await pool.query(
          "SELECT state,validated_at,final_key FROM photo_asset WHERE id=$1",
          [upload.uploadId],
        )
      ).rows[0];
      expect(asset).toEqual({
        state: "staged",
        validated_at: null,
        final_key: null,
      });
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM audit_event WHERE target_id=$1 AND action='assignment_ended'",
            [f.id],
          )
        ).rows[0].n,
      ).toBe(1);
      await expect(
        service.finalize(token, purchaseId, finalize),
      ).rejects.toMatchObject({ status: 401, code: "unauthenticated" });
    } finally {
      s3.destroy();
    }
  });
  it("I-07 P-21 the actual POST route passes the URL attendant ID to guarded assignment ending", async () => {
    const f = await target();
    const route =
      await import("../../src/app/api/admin/attendants/[attendantId]/assignment/end/route");
    const response = await route.POST(
      request(`admin/attendants/${f.id}/assignment/end`, {
        cookie: ownerCookie,
        body: endInput(f),
      }),
      { params: Promise.resolve({ attendantId: f.id }) },
    );
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.data.attendant.id).toBe(f.id);
    expect(body.data.attendant.assignment).toBeNull();
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit_event WHERE target_id=$1 AND action='assignment_ended'",
          [f.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("I-09 P-21 protected reads waiting behind assignment end reauthorize after its commit", async () => {
    const f = await target(),
      signed = await attendantLogin(f.username);
    expect(signed.response.status).toBe(200);
    const marker = await pool.connect();
    const key = randomBytes(4).readUInt32BE() % 2147483647;
    const name = `offboarding_barrier_${newId().replaceAll("-", "")}`;
    let ending: ReturnType<typeof end> | undefined;
    let readers: Promise<Response>[] = [];
    // Hold the real transaction at its ending audit insert, after revocation
    // writes but before COMMIT. The barrier changes no production behaviour.
    await pool.query(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.target_id='${f.id}'::uuid AND NEW.action='assignment_ended' THEN PERFORM pg_advisory_xact_lock(${key}::bigint); END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${name} BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    );
    const waitForLocks = async (minimum: number) => {
      for (let n = 0; n < 200; n++) {
        const count = (
          await pool.query(
            "SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
            [schema],
          )
        ).rows[0].n;
        if (count >= minimum) return true;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return false;
    };
    try {
      await marker.query("SELECT pg_advisory_lock($1::bigint)", [key]);
      ending = end(f, endInput(f));
      expect(
        await waitForLocks(1),
        "ending reached the pre-COMMIT audit barrier",
      ).toBe(true);
      readers = [
        handleAuth(
          request("attendant/session", { cookie: signed.cookie }),
          "session",
        ),
        handleStation(
          request("attendant/configured-assignment", { cookie: signed.cookie }),
          "configured-assignment",
        ),
        handleSync(
          request("attendant/cards/lookup", {
            cookie: signed.cookie,
            body: { cardCode: "A7K3M9Q" },
          }),
          "lookup",
        ),
      ];
      expect(
        await waitForLocks(4),
        "all three protected reads must serialize behind termination",
      ).toBe(true);
      await marker.query("SELECT pg_advisory_unlock($1::bigint)", [key]);
      expect((await ending).response.status).toBe(200);
      for (const response of await Promise.all(readers)) {
        expect(response.status).toBe(401);
        expect((await response.json()).error.code).toBe("unauthenticated");
      }
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM audit_event WHERE target_id=$1 AND action='assignment_ended'",
            [f.id],
          )
        ).rows[0].n,
      ).toBe(1);
    } finally {
      await marker.query("SELECT pg_advisory_unlock($1::bigint)", [key]);
      marker.release();
      await ending;
      await Promise.allSettled(readers);
      await pool.query(`DROP TRIGGER ${name} ON audit_event`);
      await pool.query(`DROP FUNCTION ${name}()`);
    }
  });
});
