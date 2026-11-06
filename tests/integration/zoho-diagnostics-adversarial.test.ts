import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
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
import { logger } from "../../src/server/lib/logger";
import {
  adminConfig,
  type AdminConfig,
} from "../../src/server/modules/admin-access/config";
import {
  enqueue,
  inspectToken,
  processMail,
} from "../../src/server/modules/admin-access/mail";
import { transaction } from "../../src/server/modules/admin-access/repo";

const schema = `zoho_diagnostics_${randomBytes(8).toString("hex")}`;
const root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const realFetch = globalThis.fetch;
const providerToken = "synthetic-diagnostics-token-canary";
const sender = "diagnostics-sender@example.com";
const endpoints = {
  us: "https://cpaas.zoho.com/v1.1/email",
  eu: "https://cpaas.zoho.eu/v1.1/email",
} as const;
type Message = {
  textbody: string;
  subject: string;
  to: Array<{ email_address: { address: string } }>;
};
let pool: pg.Pool;
let server: Server;
let localUrl: string;
let endpoint: string;
let status: number;
let response: (message: Message) => string;
let requests: Message[];

function secret(message: Message) {
  const token = message.textbody.match(/#token=([a-zA-Z0-9_-]+)/)?.[1];
  expect(token).toBeTruthy();
  return token!;
}
function hostileDetails(message: Message) {
  return {
    address: message.to[0]!.email_address.address,
    sender,
    token: providerToken,
    link: `https://station.example.test/admin/verify-email#token=${secret(message)}`,
    subject: message.subject,
    body: message.textbody,
  };
}
async function queued() {
  const userId = newId(),
    adminId = newId();
  const email = `diagnostics.${adminId}@example.com`;
  const roleId = (
    await pool.query("SELECT id FROM role WHERE is_owner=true LIMIT 1")
  ).rows[0].id;
  await pool.query(
    "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'admin',$2,$2,'Ada Williams',true,1,false,now())",
    [userId, `diagnostics.${userId}`],
  );
  await pool.query(
    "INSERT INTO admin(id,user_id,admin_code,email_normalized,role_id,version) VALUES($1,$2,$3,$4,$5,1)",
    [adminId, userId, `TEST-${adminId}`, email, roleId],
  );
  vi.stubEnv("EMAIL_ALLOWED_RECIPIENTS", email);
  const config = adminConfig();
  await transaction(pool, (db) =>
    enqueue(db, config, adminId, "verify_email", newId()),
  );
  return { userId, adminId, email, config };
}
async function state(adminId: string) {
  return (
    await pool.query(
      "SELECT m.status,m.attempts,m.failure_code,c.revoked_at,a.email_verified_at FROM mail_request m JOIN verification_challenge c ON c.id=m.challenge_id JOIN admin a ON a.id=m.admin_id WHERE m.admin_id=$1",
      [adminId],
    )
  ).rows[0];
}
function privateValuesAbsent(email: string) {
  const logs = JSON.stringify([
    vi.mocked(logger.warn).mock.calls,
    vi.mocked(logger.info).mock.calls,
    vi.mocked(logger.error).mock.calls,
  ]);
  for (const value of [
    email,
    sender,
    providerToken,
    ...requests.flatMap((m) => [m.textbody, m.subject, secret(m)]),
  ])
    expect(logs).not.toContain(value);
  expect(logs).not.toContain("#token=");
  expect(logs).not.toContain("https://");
}
async function failedOnce(
  actor: Awaited<ReturnType<typeof queued>>,
  expected: Record<string, unknown>,
  config: AdminConfig = actor.config,
) {
  expect(await processMail(pool, config)).toEqual({
    processed: true,
    delivered: false,
  });
  expect(await state(actor.adminId)).toMatchObject({
    status: "failed",
    attempts: 1,
    failure_code: "delivery_failed",
    email_verified_at: null,
  });
  expect((await state(actor.adminId)).revoked_at).not.toBeNull();
  expect(logger.warn).toHaveBeenCalledExactlyOnceWith({
    event: "email.send_failed",
    adapter: "zoho_cpaas",
    ...expected,
  });
  if (requests.length)
    await expect(
      inspectToken(pool, actor.config, secret(requests[0]!), "verify_email"),
    ).rejects.toMatchObject({ code: "link_unavailable" });
  const count = requests.length;
  status = 200;
  response = () => JSON.stringify({ data: [{ code: "EM_104" }] });
  expect(await processMail(pool, actor.config)).toEqual({ processed: false });
  expect(requests).toHaveLength(count);
  expect(logger.warn).toHaveBeenCalledTimes(1);
  privateValuesAbsent(actor.email);
}

describe("independent Zoho acceptance and safe durable failure diagnostics", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    await root.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set("options", `-c search_path=${schema},public`);
    pool = new pg.Pool({ connectionString: url.toString() });
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
      const message = JSON.parse(body) as Message;
      requests.push(message);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(response(message));
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
    endpoint = endpoints.eu;
    status = 200;
    requests = [];
    response = () => JSON.stringify({ data: [{ code: "EM_104" }] });
    vi.stubEnv("WHR_ENV", "staging");
    vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(32).toString("hex"));
    vi.stubEnv("BETTER_AUTH_URL", "https://station.example.test");
    vi.stubEnv("EMAIL_PROVIDER", "zoho_cpaas");
    vi.stubEnv("ZOHO_CPAAS_API_URL", endpoint);
    vi.stubEnv("ZOHO_CPAAS_TOKEN", providerToken);
    vi.stubEnv("EMAIL_FROM", sender);
    vi.stubEnv("EMAIL_ALLOWED_RECIPIENTS", "allowed@example.com");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toBe(endpoint);
        // Validate the selected production URL but route every network byte to loopback.
        return realFetch(localUrl, init);
      }),
    );
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "info").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
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

  it.each([
    { region: "us", acceptedStatus: 201 },
    { region: "eu", acceptedStatus: 200 },
  ] as const)(
    "I-12/I-52 $region HTTP $acceptedStatus with EM_104 sends once across competing workers and preserves the unconfirmed link",
    async ({ region, acceptedStatus }) => {
      endpoint = endpoints[region];
      vi.stubEnv("ZOHO_CPAAS_API_URL", endpoint);
      status = acceptedStatus;
      const actor = await queued();
      const outcomes = await Promise.all([
        processMail(pool, actor.config),
        processMail(pool, actor.config),
      ]);
      expect(
        outcomes.filter((result) => "delivered" in result && result.delivered),
      ).toHaveLength(1);
      expect(requests).toHaveLength(1);
      expect(await state(actor.adminId)).toMatchObject({
        status: "sent",
        attempts: 1,
        revoked_at: null,
        email_verified_at: null,
      });
      expect(
        await inspectToken(
          pool,
          actor.config,
          secret(requests[0]!),
          "verify_email",
        ),
      ).toMatchObject({ email: actor.email });
      expect(await processMail(pool, actor.config)).toEqual({
        processed: false,
      });
      expect(requests).toHaveLength(1);
      expect(logger.warn).not.toHaveBeenCalled();
      privateValuesAbsent(actor.email);
    },
  );

  it("I-12/I-41 a rejected HTTP status records only its safe provider code, revokes the link and never replays", async () => {
    status = 400;
    response = (message) =>
      JSON.stringify({
        data: { error_code: "TM_3004" },
        details: hostileDetails(message),
      });
    await failedOnce(await queued(), {
      reason: "http_status",
      status: 400,
      error_code: "TM_3004",
    });
  });
  it("I-12/I-41 HTTP 201 with a provider error does not accept or leak the failed link", async () => {
    status = 201;
    response = (message) =>
      JSON.stringify({
        data: { error_code: "SERR_157" },
        details: hostileDetails(message),
      });
    await failedOnce(await queued(), {
      reason: "provider_error",
      status: 201,
      error_code: "SERR_157",
    });
  });
  it("I-12/I-41 HTTP 201 without a valid acknowledgement revokes the link with response_invalid", async () => {
    status = 201;
    response = (message) =>
      JSON.stringify({
        data: [{ code: "EM_999" }],
        details: hostileDetails(message),
      });
    await failedOnce(await queued(), {
      reason: "response_invalid",
      status: 201,
    });
  });
  it("I-12/I-41 a successful-looking acknowledgement on HTTP 202 remains a single failed attempt", async () => {
    status = 202;
    await failedOnce(await queued(), { reason: "http_status", status: 202 });
  });
  it("I-41 a provider error code with an appended private payload is omitted from failure diagnostics", async () => {
    status = 400;
    response = (message) =>
      JSON.stringify({
        data: {
          error_code: `TM_3004\n${message.to[0]!.email_address.address}`,
        },
        details: hostileDetails(message),
      });
    await failedOnce(await queued(), { reason: "http_status", status: 400 });
  });
  it("I-12/I-41 explicit prefixed-token configuration is refused before transport and revokes the queued challenge", async () => {
    const actor = await queued();
    const config = {
      ...actor.config,
      email: {
        ...actor.config.email!,
        token: `Zoho-enczapikey ${providerToken}`,
      },
    };
    await failedOnce(
      actor,
      { reason: "config_invalid", setting: "ZOHO_CPAAS_TOKEN" },
      config,
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });
});
