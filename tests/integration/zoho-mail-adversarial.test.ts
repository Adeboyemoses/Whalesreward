import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import pg from "pg";
import { hashPassword } from "better-auth/crypto";
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
import { logger } from "../../src/server/lib/logger";
import { adminConfig } from "../../src/server/modules/admin-access/config";
import {
  confirmToken,
  enqueue,
  inspectToken,
  processMail,
  requestReset,
} from "../../src/server/modules/admin-access/mail";
import { transaction } from "../../src/server/modules/admin-access/repo";

const schema = `zoho_adversarial_${randomBytes(8).toString("hex")}`;
const root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const realFetch = globalThis.fetch;
const oldPassword = randomBytes(24).toString("hex");
let pool: pg.Pool;
let server: Server;
let localUrl: string;
let passwordHash: string;
let responseStatus = 200;
let requests: Array<{
  subject: string;
  textbody: string;
  to: Array<{ email_address: { address: string } }>;
  track_clicks: boolean;
  track_opens: boolean;
}> = [];

async function account(verified = false) {
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
    "INSERT INTO admin(id,user_id,admin_code,email_normalized,email_verified_at,role_id,version) VALUES($1,$2,$3,$4,$5,$6,1)",
    [
      adminId,
      userId,
      `TEST-${adminId}`,
      email,
      verified ? new Date() : null,
      roleId,
    ],
  );
  await pool.query(
    "INSERT INTO auth_credential(id,user_id,provider,provider_account_id,password_hash,updated_at) VALUES($1,$2::uuid,'credential',$2::text,$3,now())",
    [newId(), userId, passwordHash],
  );
  return { userId, adminId, email };
}
function allow(email: string) {
  vi.stubEnv("EMAIL_ALLOWED_RECIPIENTS", email);
  return adminConfig();
}
async function queue(adminId: string) {
  await transaction(pool, (db) =>
    enqueue(db, adminConfig(), adminId, "verify_email", newId()),
  );
}
function token(index: number) {
  const value = requests[index]!.textbody.match(/#token=([a-zA-Z0-9_-]+)/)?.[1];
  expect(value).toBeTruthy();
  return value!;
}
async function drain() {
  for (let n = 0; n < 10; n++) {
    if (!(await processMail(pool, adminConfig())).processed) return;
  }
  throw new Error("Fixture mail queue did not drain within ten steps");
}

describe("independent staging provider delivery safeguards", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    await root.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set("options", `-c search_path=${schema},public`);
    pool = new pg.Pool({ connectionString: url.toString() });
    const migrations = new URL("../../prisma/migrations/", import.meta.url);
    for (const entry of (await readdir(migrations, { withFileTypes: true }))
      .filter((item) => item.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))) {
      await pool.query(
        await readFile(
          new URL(`${entry.name}/migration.sql`, migrations),
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
    passwordHash = await hashPassword(oldPassword);
    server = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      requests.push(JSON.parse(body));
      res.writeHead(responseStatus, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          responseStatus === 200
            ? { data: [{ code: "EM_104", message: "OK" }] }
            : { error: "synthetic provider failure" },
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
  beforeEach(() => {
    requests = [];
    responseStatus = 200;
    vi.stubEnv("WHR_ENV", "staging");
    vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(32).toString("hex"));
    vi.stubEnv("BETTER_AUTH_URL", "https://station.example.test");
    vi.stubEnv("EMAIL_PROVIDER", "zoho_cpaas");
    vi.stubEnv("ZOHO_CPAAS_API_URL", "https://cpaas.zoho.eu/v1.1/email");
    vi.stubEnv("ZOHO_CPAAS_TOKEN", "synthetic-test-provider-token");
    vi.stubEnv("EMAIL_FROM", "rewards@example.com");
    vi.stubEnv("EMAIL_ALLOWED_RECIPIENTS", "allowed@example.com");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toBe("https://cpaas.zoho.eu/v1.1/email");
        // The production endpoint is validated, but every network byte goes to this loopback stub.
        return realFetch(localUrl, init);
      }),
    );
    vi.spyOn(logger, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
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

  it("I-12 approved staging verification, reset and security notice use the configured provider without verifying on send", async () => {
    const actor = await account();
    const config = allow(actor.email);
    expect(config.delivery).toBe("zoho_cpaas");
    await queue(actor.adminId);
    expect(await processMail(pool, config)).toEqual({
      processed: true,
      delivered: true,
    });
    expect(
      (
        await pool.query("SELECT email_verified_at FROM admin WHERE id=$1", [
          actor.adminId,
        ])
      ).rows[0].email_verified_at,
    ).toBeNull();
    const verifyToken = token(0);
    await confirmToken(pool, config, verifyToken, "verify_email");
    await requestReset(pool, config, actor.email, newId(), "127.0.0.1");
    await drain();
    const resetToken = token(1);
    const nextPassword = randomBytes(24).toString("hex");
    await confirmToken(pool, config, resetToken, "reset_password", {
      newPassword: nextPassword,
      confirmPassword: nextPassword,
    });
    await drain();
    expect(requests).toHaveLength(3);
    for (const message of requests) {
      expect(message.subject.startsWith("[Staging]")).toBe(true);
      expect(message.textbody).toContain(
        "This is a test message from the staging environment.",
      );
      expect(message.to).toEqual([{ email_address: { address: actor.email } }]);
      expect(message.track_clicks).toBe(false);
      expect(message.track_opens).toBe(false);
    }
    expect(requests[2]!.textbody).not.toContain("#token=");
    const audit = JSON.stringify(
      (await pool.query("SELECT * FROM audit_event")).rows,
    );
    for (const sensitive of [
      actor.email,
      verifyToken,
      resetToken,
      oldPassword,
      nextPassword,
      "synthetic-test-provider-token",
    ])
      expect(audit).not.toContain(sensitive);
    const challenges = (
      await pool.query(
        "SELECT secret_hash FROM verification_challenge WHERE user_id=$1",
        [actor.userId],
      )
    ).rows;
    expect(challenges).toHaveLength(2);
    expect(JSON.stringify(challenges)).not.toContain(verifyToken);
    expect(JSON.stringify(challenges)).not.toContain(resetToken);
  }, 30000);

  it("I-12 refused staging recipient makes no request, revokes its challenge and needs a fresh verification request", async () => {
    const actor = await account();
    await queue(actor.adminId);
    expect(await processMail(pool, adminConfig())).toEqual({
      processed: true,
      delivered: false,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
    const result = (
      await pool.query(
        "SELECT m.status,m.failure_code,c.revoked_at FROM mail_request m JOIN verification_challenge c ON c.id=m.challenge_id WHERE m.admin_id=$1",
        [actor.adminId],
      )
    ).rows[0];
    expect(result).toMatchObject({
      status: "failed",
      failure_code: "delivery_failed",
    });
    expect(result.revoked_at).not.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith({
      event: "email.send_failed",
      reason: "config_invalid",
      setting: "EMAIL_ALLOWED_RECIPIENTS",
      adapter: "zoho_cpaas",
    });
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(
      actor.email,
    );
    allow(actor.email);
    await drain();
    expect(fetch).not.toHaveBeenCalled();
    await queue(actor.adminId);
    await drain();
    expect(requests).toHaveLength(1);
    expect(
      await inspectToken(pool, adminConfig(), token(0), "verify_email"),
    ).toMatchObject({ email: actor.email });
  });

  it("I-12 uncertain provider failure revokes the exposed link and never retries it", async () => {
    const actor = await account();
    const config = allow(actor.email);
    responseStatus = 503;
    await queue(actor.adminId);
    expect(await processMail(pool, config)).toEqual({
      processed: true,
      delivered: false,
    });
    const exposedToken = token(0);
    await expect(
      inspectToken(pool, config, exposedToken, "verify_email"),
    ).rejects.toMatchObject({ code: "link_unavailable" });
    responseStatus = 200;
    await drain();
    expect(requests).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify(
        (
          await pool.query(
            "SELECT failure_code FROM mail_request WHERE admin_id=$1",
            [actor.adminId],
          )
        ).rows,
      ),
    ).not.toContain(exposedToken);
  });

  it("I-12 public recovery remains generic for refused, unverified and unknown staging addresses", async () => {
    const verified = await account(true),
      unverified = await account();
    const config = adminConfig();
    const responses = [];
    for (const email of [
      verified.email,
      unverified.email,
      "unknown@example.com",
    ])
      responses.push(
        await requestReset(pool, config, email, newId(), "127.0.0.2"),
      );
    expect(responses[0]).toEqual(responses[1]);
    expect(responses[1]).toEqual(responses[2]);
    await drain();
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM verification_challenge WHERE user_id=$1 AND revoked_at IS NOT NULL",
          [verified.userId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM verification_challenge WHERE user_id=$1",
          [unverified.userId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
});
