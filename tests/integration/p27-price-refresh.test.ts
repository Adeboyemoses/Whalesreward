import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { newId } from "../../src/server/lib/ids";
import { database } from "../../src/server/lib/db";
import { getSession } from "../../src/server/modules/auth/service";
import { digest, sessionSecret } from "../../src/server/modules/auth/crypto";
import { createSyncService } from "../../src/server/modules/sync/service";
import { handleSync } from "../../src/server/modules/sync/http";
import { stationWrite } from "../../src/server/modules/station/service";
import { verifyLookupReceipt } from "../../src/server/modules/sync/lookup-receipt";
import { lookupResponseEnvelopeSchema } from "../../src/shared/contracts/sync";
import { fixtureId as id, newSession } from "../helpers/sync-fixture";

vi.setConfig({ testTimeout: 30000 });
const schema = `p27_${randomBytes(6).toString("hex")}`;
const root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pool: pg.Pool;
let connectionString: string;
let adminToken: string;
const config = {
  secret: randomBytes(32).toString("hex"),
  origin: "https://p27.example.test",
};
const key = randomBytes(32);
const keys = { activeKid: "current", keys: new Map([["current", key]]) };
const storage = {
  signPut: async () => ({ url: "unused", headers: {} }),
  read: async () => Buffer.alloc(0),
  writeFinal: async () => {},
};
const service = (db = pool) =>
  createSyncService({ pool: db, storage, lookupReceiptKeys: () => keys });
const input = { source: "code" as const, code: "A7K3M9Q" };
async function fixture(pumpId = id(14), age = 60000) {
  const userId = newId(),
    attendantId = newId(),
    assignmentId = newId();
  const username = `p27.${userId}`;
  await pool.query(
    "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'attendant',$2,$2,'Grace Okon',true,1,false,clock_timestamp())",
    [userId, username],
  );
  await pool.query(
    "INSERT INTO attendant(id,user_id,staff_code,version) VALUES($1,$2,$3,1)",
    [attendantId, userId, `P27-${attendantId}`],
  );
  await pool.query(
    "INSERT INTO assignment(id,attendant_id,pump_id,assignment_version,effective_from,changed_by,reason) VALUES($1,$2,$3,1,clock_timestamp()-interval '30 hours',$4,'P27 test')",
    [assignmentId, attendantId, pumpId, id(5)],
  );
  return {
    userId,
    attendantId,
    assignmentId,
    username,
    pumpId,
    ...(await newSession(
      pool,
      { userId, attendantId, assignmentId, username },
      new Date(Date.now() - age),
    )),
  };
}
async function current(product = id(9)) {
  return (
    await pool.query(
      "SELECT *,rate_kobo::text FROM product_price_version WHERE station_id=$1 AND product_id=$2 ORDER BY version DESC LIMIT 1",
      [id(8), product],
    )
  ).rows[0];
}
async function activate(db = pool, code = "pms", precisionOnly = false) {
  const product = code === "pms" ? id(9) : id(12),
    old = await current(product);
  return stationWrite(
    db,
    config,
    adminToken,
    "prices-activate",
    {
      operationId: newId(),
      expectedVersion: old.version,
      rateKobo: precisionOnly
        ? old.rate_kobo
        : (BigInt(old.rate_kobo) - 1n).toString(),
      currency: "NGN",
      quantityPrecision: precisionOnly
        ? (old.quantity_precision + 1) % 7
        : old.quantity_precision,
      reason: "P27 read race",
    },
    code,
  );
}
function barrier(dbPool: pg.Pool, fragment: string) {
  let release!: () => void,
    reached!: () => void,
    used = false;
  const paused = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const resume = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    paused,
    release,
    pool: new Proxy(dbPool, {
      get(target, property) {
        if (property === "connect")
          return async () => {
            const db = await target.connect();
            return new Proxy(db, {
              get(client, key) {
                if (key === "query")
                  return async (...args: unknown[]) => {
                    if (
                      !used &&
                      typeof args[0] === "string" &&
                      args[0].includes(fragment)
                    ) {
                      used = true;
                      reached();
                      await resume;
                    }
                    return Reflect.apply(client.query, client, args);
                  };
                const value = Reflect.get(client, key);
                return typeof value === "function" ? value.bind(client) : value;
              },
            });
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
  };
}
async function waiting(name: string) {
  for (let i = 0; i < 200; i++) {
    if (
      (
        await pool.query(
          "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory') AS waiting",
          [name],
        )
      ).rows[0].waiting
    )
      return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return false;
}
async function http(
  token: string,
  headers: Record<string, string> = {},
  body: unknown = input,
) {
  return handleSync(
    new Request(`${config.origin}/api/attendant/cards/lookup`, {
      method: "POST",
      headers: {
        Origin: config.origin,
        "Content-Type": "application/json",
        Cookie: `__Host-whr-session=${token}`,
        "X-Test-IP": newId(),
        ...headers,
      },
      body: JSON.stringify(body),
    }),
    "lookup",
  );
}
beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  await root.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  connectionString = url.toString();
  pool = new pg.Pool({ connectionString, max: 12 });
  const migrations = new URL("../../prisma/migrations/", import.meta.url);
  for (const dir of (await readdir(migrations, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name)))
    await pool.query(
      await readFile(new URL(`${dir.name}/migration.sql`, migrations), "utf8"),
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
  const session = newId();
  adminToken = sessionSecret(config.secret, session);
  await pool.query(
    "INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour',1,clock_timestamp())",
    [session, id(2), digest(adminToken)],
  );
  vi.stubEnv("DATABASE_URL", connectionString);
  vi.stubEnv("BETTER_AUTH_SECRET", config.secret);
  vi.stubEnv("BETTER_AUTH_URL", config.origin);
  vi.stubEnv("WHR_ENV", "test");
  vi.stubEnv("WHR_TRUSTED_IP_HEADER", "x-test-ip");
  vi.stubEnv("WHR_LOOKUP_RECEIPT_ACTIVE_KID", "current");
  vi.stubEnv(
    "WHR_LOOKUP_RECEIPT_KEYS",
    JSON.stringify({ current: key.toString("base64url") }),
  );
}, 30000);
afterAll(async () => {
  await database().end();
  await pool?.end();
  vi.unstubAllEnvs();
  await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await root.end();
});
describe("P-27 capability and context (PR-T1-01/02/05/09/12)", () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    "projects receipt=%s refresh=%s independently through HTTP",
    async (receipt, refresh) => {
      const f = await fixture();
      const response = await http(f.token, {
        ...(receipt ? { "X-WR-Lookup-Receipt": "1" } : {}),
        ...(refresh ? { "X-WR-Price-Refresh": "1" } : {}),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const result = lookupResponseEnvelopeSchema.parse(await response.json());
      expect("lookupReceipt" in result.data).toBe(receipt);
      expect("priceRefresh" in result.data).toBe(refresh);
      if (refresh)
        expect(result.data).toMatchObject({
          priceRefresh: {
            captureContextId: f.contextId,
            originatingAccountId: f.attendantId,
            stationId: id(8),
            assignmentId: f.assignmentId,
            pumpId: f.pumpId,
            productId: id(9),
          },
        });
    },
  );
  it.each(["0", "true", "2", "1, 1"])(
    "unknown capability %s never opts in",
    async (value) => {
      const f = await fixture();
      const response = await http(f.token, {
        "X-WR-Lookup-Receipt": value,
        "X-WR-Price-Refresh": value,
      });
      expect(response.status).toBe(200);
      expect(Object.keys((await response.json()).data).sort()).toEqual([
        "cardCode",
        "customer",
        "lookedUpAt",
      ]);
    },
  );
  it("keeps receipt nullable independently from disabled-pump configuration", async () => {
    const f = await fixture();
    await pool.query(
      "UPDATE pump SET enabled=false,version=version+1 WHERE id=$1",
      [f.pumpId],
    );
    try {
      const result = await service().lookup(f.token, input, true, true);
      expect(result.priceRefresh).toBeNull();
      expect(result.lookupReceipt).toBeTypeOf("string");
      await expect(
        getSession(pool, config, f.token, newId()),
      ).rejects.toMatchObject({ code: "assignment_unavailable" });
    } finally {
      await pool.query(
        "UPDATE pump SET enabled=true,version=version+1 WHERE id=$1",
        [f.pumpId],
      );
    }
    const noKeys = createSyncService({
      pool,
      storage,
      lookupReceiptKeys: () => ({ activeKid: null, keys: new Map() }),
    });
    expect(await noKeys.lookup(f.token, input, true, true)).toMatchObject({
      lookupReceipt: null,
      priceRefresh: { captureContextId: f.contextId },
    });
  });
  it("retains acknowledged assignment and immutable anchors across reassignment and fresh sign-in", async () => {
    const f = await fixture();
    const before = (
      await pool.query(
        "SELECT row_to_json(c) AS value FROM capture_context c WHERE id=$1",
        [f.contextId],
      )
    ).rows[0].value;
    const other = newId();
    await pool.query(
      "UPDATE assignment SET effective_until=clock_timestamp() WHERE id=$1",
      [f.assignmentId],
    );
    await pool.query(
      "INSERT INTO assignment(id,attendant_id,pump_id,assignment_version,effective_from,changed_by,reason) VALUES($1,$2,$3,2,clock_timestamp(),$4,'P27 reassignment')",
      [other, f.attendantId, id(17), id(5)],
    );
    const lookup = await service().lookup(f.token, input, true, true),
      session = await getSession(pool, config, f.token, newId());
    expect(lookup).toMatchObject({
      lookupReceipt: null,
      priceRefresh: {
        assignmentId: f.assignmentId,
        pumpId: f.pumpId,
        productId: id(9),
      },
    });
    expect(session).toMatchObject({
      captureContextId: f.contextId,
      reassignmentRequiresSignIn: true,
      assignment: { id: f.assignmentId },
    });
    const fresh = await newSession(pool, { ...f, assignmentId: other });
    expect(
      await service().lookup(fresh.token, input, false, true),
    ).toMatchObject({
      priceRefresh: {
        captureContextId: fresh.contextId,
        assignmentId: other,
        pumpId: id(17),
        productId: id(12),
      },
    });
    expect(
      (
        await pool.query(
          "SELECT row_to_json(c) AS value FROM capture_context c WHERE id=$1",
          [f.contextId],
        )
      ).rows[0].value,
    ).toEqual(before);
  });
  it("returns null for revoked context but does not weaken session, account or expiry denials", async () => {
    const f = await fixture();
    await pool.query(
      "UPDATE capture_context SET revoked_at=clock_timestamp() WHERE id=$1",
      [f.contextId],
    );
    expect(
      (await service().lookup(f.token, input, true, true)).priceRefresh,
    ).toBeNull();
    await expect(
      getSession(pool, config, f.token, newId()),
    ).rejects.toMatchObject({ code: "assignment_unavailable" });
    for (const mutation of [
      "UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1",
    ]) {
      const denied = await fixture();
      await pool.query(mutation, [denied.sessionId]);
      const response = await http(denied.token, { "X-WR-Price-Refresh": "1" });
      expect(response.status).toBe(401);
      expect(await response.json()).not.toHaveProperty("data");
    }
    const disabled = await fixture();
    await pool.query("UPDATE auth_user SET enabled=false WHERE id=$1", [
      disabled.userId,
    ]);
    await expect(
      service().lookup(disabled.token, input, true, true),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    const expired = await fixture(id(14), 25 * 3600000);
    await expect(
      service().lookup(expired.token, input, true, true),
    ).rejects.toMatchObject({ code: "online_sign_in_required" });
    expect(
      (await getSession(pool, config, expired.token, newId()))
        .offlineExpiresAt < new Date().toISOString(),
    ).toBe(true);
  });
  it("revocation winning during a request denies the response before snapshots are read", async () => {
    const f = await fixture();
    const connections = new pg.Pool({ connectionString, max: 2 });
    const gate = barrier(
      connections,
      "SELECT user_id FROM auth_session WHERE secret_verifier",
    );
    const pending = service(gate.pool).lookup(f.token, input, true, true);
    const assertion = expect(pending).rejects.toMatchObject({
      code: "unauthenticated",
    });
    try {
      await gate.paused;
      await pool.query(
        "UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1",
        [f.sessionId],
      );
      gate.release();
      await assertion;
    } finally {
      gate.release();
      await assertion;
      await connections.end();
    }
  });
  it("restricted reads omit price and errors omit refresh, preserve Origin and account limit", async () => {
    const f = await fixture();
    await pool.query(
      "UPDATE auth_user SET must_change_password=true WHERE id=$1",
      [f.userId],
    );
    expect(
      await getSession(pool, config, f.token, newId(), true),
    ).not.toHaveProperty("price");
    expect((await http(f.token, { "X-WR-Price-Refresh": "1" })).status).toBe(
      403,
    );
    const live = await fixture();
    expect(
      (
        await http(live.token, {
          Origin: "https://foreign.example.test",
          "X-WR-Price-Refresh": "1",
        })
      ).status,
    ).toBe(403);
    const bad = await http(
      live.token,
      { "X-WR-Price-Refresh": "1" },
      { ...input, pumpId: id(17) },
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).not.toHaveProperty("data");
    for (let i = 0; i < 29; i++)
      expect(
        (await http(live.token, { "X-WR-Price-Refresh": "1" })).status,
      ).toBe(200);
    const limited = await http(live.token, { "X-WR-Price-Refresh": "1" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(await limited.json()).not.toHaveProperty("data");
  });
});
describe("P-27 committed snapshot races (PR-T1-03/04/08)", () => {
  it("ordinary reads expose price decreases and precision-only versions as whole snapshots", async () => {
    for (const [pump, code] of [
      [id(14), "pms"],
      [id(17), "cooking_gas"],
    ]) {
      const f = await fixture(pump);
      const first = await getSession(pool, config, f.token, newId());
      await activate(pool, code);
      const decreased = await service().lookup(f.token, input, true, true);
      expect(decreased.priceRefresh!.price.version).toBe(
        first.price.version + 1,
      );
      expect(BigInt(decreased.priceRefresh!.price.rateKobo)).toBe(
        BigInt(first.price.rateKobo) - 1n,
      );
      await activate(pool, code, true);
      const precise = await getSession(pool, config, f.token, newId());
      expect(precise.price.version).toBe(first.price.version + 2);
      expect(precise.price.rateKobo).toBe(
        decreased.priceRefresh!.price.rateKobo,
      );
      expect(precise.price.quantityPrecision).not.toBe(
        first.price.quantityPrecision,
      );
      expect(precise.lastOnlineSignInAt).toBe(first.lastOnlineSignInAt);
      expect(precise.offlineExpiresAt).toBe(first.offlineExpiresAt);
    }
  });
  it.each(["session", "lookup"])(
    "%s waits for in-flight activation commit before selecting latest version",
    async (kind) => {
      const f = await fixture(),
        old = await current();
      const writer = new pg.Pool({ connectionString, max: 1 }),
        name = `p27-reader-${newId()}`,
        reader = new pg.Pool({
          connectionString,
          max: 4,
          application_name: name,
        });
      const gate = barrier(writer, "COMMIT");
      const activation = activate(gate.pool);
      let read: Promise<unknown> | undefined;
      try {
        await gate.paused;
        read =
          kind === "session"
            ? getSession(reader, config, f.token, newId())
            : service(reader).lookup(f.token, input, true, true);
        expect(await waiting(name)).toBe(true);
        gate.release();
        await activation;
        const result = await read;
        const price =
          kind === "session"
            ? (
                result as Awaited<ReturnType<typeof getSession>> & {
                  price: typeof old;
                }
              ).price
            : (
                result as Awaited<
                  ReturnType<ReturnType<typeof service>["lookup"]>
                >
              ).priceRefresh!.price;
        expect(price.version).toBe(old.version + 1);
        if (kind === "lookup") {
          const lookup = result as Awaited<
            ReturnType<ReturnType<typeof service>["lookup"]>
          >;
          const claims = verifyLookupReceipt(lookup.lookupReceipt, keys)!;
          expect(
            (
              await pool.query(
                "SELECT id FROM product_price_version WHERE station_id=$1 AND product_id=$2 AND effective_from<=$3 ORDER BY effective_from DESC LIMIT 1",
                [id(8), id(9), claims.issuedAt],
              )
            ).rows[0].id,
          ).toBe(lookup.priceRefresh!.price.priceVersionId);
        }
      } finally {
        gate.release();
        await activation;
        await read;
        await writer.end();
        await reader.end();
      }
    },
  );
  it("activation cannot commit between the locked price observation and receipt issuance", async () => {
    const f = await fixture(),
      old = await current();
    const reader = new pg.Pool({ connectionString, max: 2 }),
      name = `p27-writer-${newId()}`,
      writer = new pg.Pool({
        connectionString,
        max: 2,
        application_name: name,
      });
    const gate = barrier(
      reader,
      "SELECT c.id AS context_id,c.attendant_id,p.station_id,card.id AS card_id",
    );
    const lookup = service(gate.pool).lookup(f.token, input, true, true);
    let activation: ReturnType<typeof activate> | undefined;
    try {
      await gate.paused;
      activation = activate(writer);
      expect(await waiting(name)).toBe(true);
      gate.release();
      const result = await lookup;
      await activation;
      expect(result.priceRefresh!.price.priceVersionId).toBe(old.id);
      const claims = verifyLookupReceipt(result.lookupReceipt, keys)!;
      const at = (
        await pool.query(
          "SELECT id FROM product_price_version WHERE station_id=$1 AND product_id=$2 AND effective_from<=$3 ORDER BY effective_from DESC LIMIT 1",
          [id(8), id(9), claims.issuedAt],
        )
      ).rows[0];
      expect(at.id).toBe(old.id);
    } finally {
      gate.release();
      await lookup;
      await activation;
      await reader.end();
      await writer.end();
    }
  });
});

it("a valid lookup with missing acknowledged-product pricing has null refresh and session retains assignment_unavailable", async () => {
  const station = newId(),
    pump = newId();
  await pool.query(
    "INSERT INTO station(id,code,name,timezone,version) VALUES($1,$2,'P27 unconfigured station','Africa/Lagos',1)",
    [station, `P27-${station}`],
  );
  await pool.query(
    "INSERT INTO pump(id,station_id,code,product_id,enabled,version) VALUES($1,$2,'P27-EMPTY',$3,true,1)",
    [pump, station, id(9)],
  );
  const f = await fixture(pump);
  const result = await service().lookup(f.token, input, true, true);
  expect(result.priceRefresh).toBeNull();
  expect(result.lookupReceipt).toBeTypeOf("string");
  await expect(
    getSession(pool, config, f.token, newId()),
  ).rejects.toMatchObject({ code: "assignment_unavailable" });
});
