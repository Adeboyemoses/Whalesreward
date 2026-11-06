import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
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
import { newId } from "../../src/server/lib/ids";
import { adminConfig } from "../../src/server/modules/admin-access/config";
import {
  enqueue,
  inspectToken,
  processMail,
} from "../../src/server/modules/admin-access/mail";
import { createMailLoop } from "../../src/server/modules/admin-access/mail-loop";
import { transaction } from "../../src/server/modules/admin-access/repo";

const schema = `mail_loop_${randomBytes(8).toString("hex")}`;
const root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const realFetch = globalThis.fetch;
let pool: pg.Pool;
let connectionString: string;
let server: Server;
let localUrl: string;
let requests: Array<{ textbody: string }>;
let responseStatus: number;
let releaseResponse: (() => void) | undefined;
let responseGate: Promise<void> | undefined;
let loops: ReturnType<typeof createMailLoop>[];

async function until(
  predicate: () => boolean | Promise<boolean>,
  timeout = 3000,
) {
  const deadline = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for local mail fixture state");
    await delay(10);
  }
}
function holdResponse() {
  responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
}
async function queue() {
  const userId = newId(),
    adminId = newId();
  const email = `ada.${adminId}@example.com`;
  const roleId = (
    await pool.query("SELECT id FROM role WHERE is_owner=true LIMIT 1")
  ).rows[0].id;
  await pool.query(
    "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'admin',$2,$2,'Ada Williams',true,1,false,now())",
    [userId, `ada.${userId}`],
  );
  await pool.query(
    "INSERT INTO admin(id,user_id,admin_code,email_normalized,role_id,version) VALUES($1,$2,$3,$4,$5,1)",
    [adminId, userId, `TEST-${adminId}`, email, roleId],
  );
  const allowlist = process.env.EMAIL_ALLOWED_RECIPIENTS;
  vi.stubEnv("EMAIL_ALLOWED_RECIPIENTS", `${allowlist},${email}`);
  await transaction(pool, (db) =>
    enqueue(db, adminConfig(), adminId, "verify_email", newId()),
  );
  return { userId, adminId, email };
}
async function state(adminId: string) {
  return (
    await pool.query(
      "SELECT m.status,m.attempts,m.failure_code,c.revoked_at,c.consumed_at FROM mail_request m LEFT JOIN verification_challenge c ON c.id=m.challenge_id WHERE m.admin_id=$1 ORDER BY m.created_at DESC LIMIT 1",
      [adminId],
    )
  ).rows[0];
}
function loop(options: { intervalMs?: number } = {}) {
  const instancePool = new pg.Pool({ connectionString, max: 2 });
  const processNext = vi.fn(() => processMail(instancePool, adminConfig()));
  const close = vi.fn(() => instancePool.end());
  const report = vi.fn();
  const running = createMailLoop({ processNext, close, report, ...options });
  loops.push(running);
  return { ...running, processNext, close, report };
}

describe("independent durable automatic mail polling", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    await root.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set("options", `-c search_path=${schema},public`);
    connectionString = url.toString();
    pool = new pg.Pool({ connectionString });
    const migrations = new URL("../../prisma/migrations/", import.meta.url);
    for (const entry of (await readdir(migrations, { withFileTypes: true }))
      .filter((item) => item.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name)))
      await pool.query(
        await readFile(
          new URL(`${entry.name}/migration.sql`, migrations),
          "utf8",
        ),
      );
    await pool.query(
      await readFile(
        new URL("../../prisma/fixtures.sql", import.meta.url),
        "utf8",
      ),
    );
    server = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      requests.push(JSON.parse(body));
      if (responseGate) await responseGate;
      res.writeHead(responseStatus, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          responseStatus === 200
            ? { data: [{ code: "EM_104" }] }
            : { error: "synthetic failure" },
        ),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Local stub unavailable");
    localUrl = `http://127.0.0.1:${address.port}/v1.1/email`;
  }, 30000);
  beforeEach(async () => {
    requests = [];
    loops = [];
    responseStatus = 200;
    responseGate = undefined;
    releaseResponse = undefined;
    await pool.query(
      "UPDATE mail_request SET status='superseded' WHERE status='pending'",
    );
    vi.stubEnv("WHR_ENV", "staging");
    vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(32).toString("hex"));
    vi.stubEnv("BETTER_AUTH_URL", "https://station.example.test");
    vi.stubEnv("EMAIL_PROVIDER", "zoho_cpaas");
    vi.stubEnv("ZOHO_CPAAS_API_URL", "https://cpaas.zoho.eu/v1.1/email");
    vi.stubEnv("ZOHO_CPAAS_TOKEN", "synthetic-provider-token");
    vi.stubEnv("EMAIL_FROM", "rewards@example.com");
    vi.stubEnv("EMAIL_ALLOWED_RECIPIENTS", "allowed@example.com");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toBe("https://cpaas.zoho.eu/v1.1/email");
        return realFetch(localUrl, init);
      }),
    );
  });
  afterEach(async () => {
    releaseResponse?.();
    await Promise.all(loops.map((running) => running.stop()));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await pool?.end();
    if (server)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await root.end();
  });

  it("I-12/I-52 two live polling instances claim a queued verification once", async () => {
    const actor = await queue();
    holdResponse();
    const first = loop({ intervalMs: 25 }),
      second = loop({ intervalMs: 25 });
    await until(
      () =>
        requests.length === 1 &&
        first.report.mock.calls.length + second.report.mock.calls.length > 0,
    );
    expect(await state(actor.adminId)).toMatchObject({
      status: "sending",
      attempts: 1,
    });
    releaseResponse?.();
    await until(async () => (await state(actor.adminId)).status === "sent");
    await Promise.all([first.stop(), second.stop()]);
    expect(requests).toHaveLength(1);
    expect(await state(actor.adminId)).toMatchObject({
      status: "sent",
      attempts: 1,
      revoked_at: null,
    });
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it("I-12/I-52 redeploy revokes an expired in-flight lease without replay and fences a late acknowledgement", async () => {
    const actor = await queue();
    holdResponse();
    const old = loop();
    await until(() => requests.length === 1);
    const token = requests[0]!.textbody.match(/#token=([a-zA-Z0-9_-]+)/)![1]!;
    await pool.query(
      "UPDATE mail_request SET lease_until=clock_timestamp()-interval '1 second' WHERE admin_id=$1 AND status='sending'",
      [actor.adminId],
    );
    const replacement = loop();
    await until(async () => (await state(actor.adminId)).status === "failed");
    await replacement.stop();
    const stopping = old.stop();
    releaseResponse?.();
    await stopping;
    expect(await state(actor.adminId)).toMatchObject({
      status: "failed",
      attempts: 1,
      failure_code: "delivery_uncertain",
    });
    expect((await state(actor.adminId)).revoked_at).not.toBeNull();
    expect(requests).toHaveLength(1);
    await expect(
      inspectToken(pool, adminConfig(), token, "verify_email"),
    ).rejects.toMatchObject({ code: "link_unavailable" });
  });

  it("I-12 failed automatic delivery stays failed across replacement polling loops", async () => {
    const actor = await queue();
    responseStatus = 503;
    const first = loop();
    await until(async () => (await state(actor.adminId)).status === "failed");
    await first.stop();
    responseStatus = 200;
    const replacement = loop();
    await until(() => replacement.report.mock.calls.length > 0);
    await replacement.stop();
    expect(requests).toHaveLength(1);
    expect(await state(actor.adminId)).toMatchObject({
      status: "failed",
      attempts: 1,
      failure_code: "delivery_failed",
    });
    expect((await state(actor.adminId)).revoked_at).not.toBeNull();
  });

  it("I-52 one recovery step retires at most twenty-five abandoned sends without reconstructing their links", async () => {
    const actorIds: string[] = [];
    for (let n = 0; n < 26; n++) {
      const actor = await queue();
      actorIds.push(actor.adminId);
      const challengeId = newId();
      await pool.query(
        "INSERT INTO verification_challenge(id,user_id,purpose,target_digest,secret_hash,expires_at,attempts,max_attempts,operation_id,version,issuance_generation,mail_request_id,target_key_version) SELECT $1,$2,'verify_email',target_digest,$3,clock_timestamp()+interval '1 hour',0,10,$4,1,generation,id,'v1' FROM mail_request WHERE admin_id=$5",
        [
          challengeId,
          actor.userId,
          randomBytes(32).toString("hex"),
          newId(),
          actor.adminId,
        ],
      );
      await pool.query(
        "UPDATE mail_request SET status='sending',challenge_id=$2,lease_nonce=$3,lease_until=clock_timestamp()-interval '1 second',attempts=1,fencing_version=fencing_version+1 WHERE admin_id=$1",
        [actor.adminId, challengeId, randomBytes(32).toString("hex")],
      );
    }
    expect(await processMail(pool, adminConfig())).toMatchObject({
      processed: true,
    });
    const counts = async () =>
      (
        await pool.query(
          "SELECT count(*) FILTER(WHERE m.status='failed')::int AS failed,count(*) FILTER(WHERE m.status='sending')::int AS sending,count(*) FILTER(WHERE c.revoked_at IS NOT NULL)::int AS revoked FROM mail_request m JOIN verification_challenge c ON c.id=m.challenge_id WHERE m.admin_id=ANY($1::uuid[])",
          [actorIds],
        )
      ).rows[0];
    expect(await counts()).toEqual({ failed: 25, sending: 1, revoked: 25 });
    expect(await processMail(pool, adminConfig())).toMatchObject({
      processed: true,
    });
    expect(await counts()).toEqual({ failed: 26, sending: 0, revoked: 26 });
    expect(fetch).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });

  it("I-52 shutdown drains the claimed send but leaves later work for a replacement instance", async () => {
    const firstActor = await queue(),
      nextActor = await queue();
    holdResponse();
    const active = loop();
    await until(() => requests.length === 1);
    let stopped = false;
    const stopping = active.stop().then(() => {
      stopped = true;
    });
    await delay(30);
    expect(stopped).toBe(false);
    expect(active.close).not.toHaveBeenCalled();
    releaseResponse?.();
    await stopping;
    expect(requests).toHaveLength(1);
    expect(await state(firstActor.adminId)).toMatchObject({
      status: "sent",
      attempts: 1,
    });
    expect(await state(nextActor.adminId)).toMatchObject({
      status: "pending",
      attempts: 0,
    });
    expect(active.close).toHaveBeenCalledTimes(1);
    const replacement = loop();
    await until(async () => (await state(nextActor.adminId)).status === "sent");
    await replacement.stop();
    expect(requests).toHaveLength(2);
  });

  it("I-52 an empty outbox waits between polls and newly queued work sends within sixty seconds with counts-only reports", async () => {
    const active = loop();
    await until(() => active.report.mock.calls.length > 0);
    expect(active.processNext).toHaveBeenCalledTimes(1);
    await delay(50);
    expect(active.processNext).toHaveBeenCalledTimes(1);
    const queuedAt = Date.now(),
      actor = await queue();
    await until(
      async () => (await state(actor.adminId)).status === "sent",
      10000,
    );
    expect(Date.now() - queuedAt).toBeLessThan(60000);
    await active.stop();
    expect(requests).toHaveLength(1);
    for (const [counts] of active.report.mock.calls) {
      expect(Object.keys(counts).sort()).toEqual([
        "delivered",
        "errors",
        "failed",
        "processed",
      ]);
      expect(
        Object.values(counts).every(
          (value) =>
            typeof value === "number" && Number.isInteger(value) && value >= 0,
        ),
      ).toBe(true);
    }
    expect(JSON.stringify(active.report.mock.calls)).not.toContain(actor.email);
    expect(JSON.stringify(active.report.mock.calls)).not.toContain("#token=");
  }, 15000);
});
