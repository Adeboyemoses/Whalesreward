import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionSchema as clientSessionSchema } from "../../src/client/types";
import { newId } from "../../src/server/lib/ids";
import {
  signIn,
  getSession,
  signOut,
} from "../../src/server/modules/auth/service";
import { consumeLimits } from "../../src/server/modules/auth/rate-limit";
import { digest, sessionSecret } from "../../src/server/modules/auth/crypto";
import { seedAttendantCredentials } from "../../prisma/seed-auth.mjs";
import { handleAuth, COOKIE } from "../../src/server/modules/auth/http";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 15,
});
const config = {
  secret: randomBytes(32).toString("hex"),
  origin: "https://station.example.test",
};
const password = randomBytes(24).toString("hex");
const id = (n: number) =>
  `019a5000-0000-7000-8000-${String(n).padStart(12, "0")}`;
let hash: string;
async function fixture(pumpId = id(14)) {
  const userId = newId(),
    attendantId = newId(),
    assignmentId = newId();
  const username = `test.${userId}`;
  await pool.query(
    "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'attendant',$2,$2,'Grace Test',true,1,false,now())",
    [userId, username],
  );
  await pool.query(
    "INSERT INTO attendant(id,user_id,staff_code,version) VALUES($1,$2,$3,1)",
    [attendantId, userId, `TEST-${attendantId}`],
  );
  await pool.query(
    "INSERT INTO auth_credential(id,user_id,provider,provider_account_id,password_hash,updated_at) VALUES($1,$2::uuid,'credential',$2::text,$3,now())",
    [newId(), userId, hash],
  );
  await pool.query(
    "INSERT INTO assignment(id,attendant_id,pump_id,assignment_version,effective_from,changed_by,reason) VALUES($1,$2,$3,1,now(),$4,'Fictional auth test')",
    [assignmentId, attendantId, pumpId, id(5)],
  );
  return {
    userId,
    attendantId,
    assignmentId,
    input: { username, password, deviceId: newId() },
    ip: newId(),
  };
}
const failure = (code: string, status: number) => ({ code, status });
describe("attendant authentication and sessions", () => {
  beforeAll(async () => {
    await pool.query(
      await readFile(
        new URL("../../prisma/fixtures.sql", import.meta.url),
        "utf8",
      ),
    );
    hash = await hashPassword(password);
    process.env.BETTER_AUTH_SECRET = config.secret;
    process.env.BETTER_AUTH_URL = config.origin;
  });
  afterAll(async () => {
    await pool.end();
  });
  it("I-01/I-02 returns attendant identity and exact assignment/product/price with no credentials", async () => {
    const f = await fixture();
    const result = await signIn(pool, config, f.input, newId(), f.ip);
    expect(clientSessionSchema.parse(result.session)).toEqual(result.session);
    expect(result.session.account.id).toBe(f.attendantId);
    expect(result.session.assignment.id).toBe(f.assignmentId);
    expect(result.session.price.rateKobo).toBe("100000");
    expect(result.session.product).toMatchObject({
      code: "pms",
      unit: "litre",
    });
    expect(JSON.stringify(result.session)).not.toContain(result.token);
    expect(JSON.stringify(result.session)).not.toContain(password);
  });
  it("I-03 concurrent credential-validated replay creates one immutable anchor/context", async () => {
    const f = await fixture();
    const key = newId();
    const results = await Promise.all([
      signIn(pool, config, f.input, key, f.ip),
      signIn(pool, config, f.input, key, f.ip),
    ]);
    expect(results[0]!.token).toBe(results[1]!.token);
    expect(results[0]!.session.captureContextId).toBe(
      results[1]!.session.captureContextId,
    );
    expect(results[0]!.session.lastOnlineSignInAt).toBe(
      results[1]!.session.lastOnlineSignInAt,
    );
    const s = results[0]!.session;
    expect(
      Date.parse(s.offlineExpiresAt) - Date.parse(s.lastOnlineSignInAt),
    ).toBe(86400000);
    expect(
      (
        await pool.query("SELECT count(*) FROM auth_session WHERE user_id=$1", [
          f.userId,
        ])
      ).rows[0].count,
    ).toBe("1");
    const refreshed = await getSession(pool, config, results[0]!.token, f.ip);
    expect(refreshed.lastOnlineSignInAt).toBe(s.lastOnlineSignInAt);
    await expect(
      signIn(pool, config, { ...f.input, deviceId: newId() }, key, f.ip),
    ).rejects.toMatchObject(failure("operation_conflict", 409));
    await expect(
      signIn(pool, config, { ...f.input, password: "incorrect" }, key, f.ip),
    ).rejects.toMatchObject(failure("invalid_credentials", 401));
  });
  it("I-09 refuses disabled, unknown, wrong-password and admin users identically", async () => {
    const f = await fixture();
    await expect(
      signIn(
        pool,
        config,
        { ...f.input, password: "incorrect" },
        newId(),
        f.ip,
      ),
    ).rejects.toMatchObject(failure("invalid_credentials", 401));
    await expect(
      signIn(pool, config, { ...f.input, username: "absent" }, newId(), f.ip),
    ).rejects.toMatchObject(failure("invalid_credentials", 401));
    await pool.query("UPDATE auth_user SET enabled=false WHERE id=$1", [
      f.userId,
    ]);
    await expect(
      signIn(pool, config, f.input, newId(), f.ip),
    ).rejects.toMatchObject(failure("invalid_credentials", 401));
    await expect(
      signIn(
        pool,
        config,
        { ...f.input, username: "ada.williams" },
        newId(),
        f.ip,
      ),
    ).rejects.toMatchObject(failure("invalid_credentials", 401));
  });
  it("I-06/I-09 logout revokes immediately, preserves context and refuses replay", async () => {
    const f = await fixture();
    const key = newId();
    const result = await signIn(pool, config, f.input, key, f.ip);
    await signOut(pool, config, result.token, f.ip);
    await signOut(pool, config, result.token, f.ip);
    await signOut(pool, config, undefined, f.ip);
    await expect(
      getSession(pool, config, result.token, f.ip),
    ).rejects.toMatchObject(failure("unauthenticated", 401));
    await expect(
      signIn(pool, config, f.input, key, f.ip),
    ).rejects.toMatchObject(failure("unauthenticated", 401));
    expect(
      (
        await pool.query("SELECT count(*) FROM capture_context WHERE id=$1", [
          result.session.captureContextId,
        ])
      ).rows[0].count,
    ).toBe("1");
  });
  it("I-09 checks live enabled status and auth version on each request", async () => {
    const f = await fixture();
    const result = await signIn(pool, config, f.input, newId(), f.ip);
    await pool.query("UPDATE auth_user SET auth_version=2 WHERE id=$1", [
      f.userId,
    ]);
    await expect(
      getSession(pool, config, result.token, f.ip),
    ).rejects.toMatchObject(failure("unauthenticated", 401));
    const fresh = await signIn(pool, config, f.input, newId(), f.ip);
    await pool.query("UPDATE auth_user SET enabled=false WHERE id=$1", [
      f.userId,
    ]);
    await expect(
      getSession(pool, config, fresh.token, f.ip),
    ).rejects.toMatchObject(failure("unauthenticated", 401));
  });
  it("I-05/I-05a retains acknowledged assignment and context until fresh sign-in", async () => {
    const f = await fixture();
    const first = await signIn(pool, config, f.input, newId(), f.ip);
    await pool.query(
      "UPDATE assignment SET effective_until=clock_timestamp() WHERE id=$1",
      [f.assignmentId],
    );
    const next = newId();
    await pool.query(
      "INSERT INTO assignment(id,attendant_id,pump_id,assignment_version,effective_from,changed_by,reason) VALUES($1,$2,$3,2,clock_timestamp(),$4,'Fictional reassignment')",
      [next, f.attendantId, id(17), id(5)],
    );
    const old = await getSession(pool, config, first.token, f.ip);
    expect(old.assignment.id).toBe(f.assignmentId);
    expect(old.reassignmentRequiresSignIn).toBe(true);
    expect(old.captureContextId).toBe(first.session.captureContextId);
    const fresh = await signIn(pool, config, f.input, newId(), f.ip);
    expect(fresh.session.assignment.id).toBe(next);
    expect(fresh.session.product.unit).toBe("kilogram");
    expect(fresh.session.captureContextId).not.toBe(old.captureContextId);
  });
  it("expired retry tombstone cannot renew the anchor", async () => {
    const f = await fixture();
    const key = newId();
    const first = await signIn(pool, config, f.input, key, f.ip);
    await pool.query(
      "UPDATE attendant_sign_in_request SET created_at=created_at-interval '6 minutes',expires_at=expires_at-interval '6 minutes' WHERE request_key=$1",
      [key],
    );
    await expect(
      signIn(pool, config, f.input, key, f.ip),
    ).rejects.toMatchObject(failure("sign_in_retry_expired", 409));
    expect(
      (await getSession(pool, config, first.token, f.ip)).captureContextId,
    ).toBe(first.session.captureContextId);
  });
  it("rate limits are durable and concurrent token consumption is atomic", async () => {
    const key = newId();
    const outcomes = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        consumeLimits(pool, config.secret, [{ key, capacity: 5 }]),
      ),
    );
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);
    const secondPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
    });
    try {
      await expect(
        consumeLimits(secondPool, config.secret, [{ key, capacity: 5 }]),
      ).rejects.toMatchObject(failure("rate_limited", 429));
    } finally {
      await secondPool.end();
    }
  });
  it("HTTP enforces origin, strict input, secure host-only cookie, no-store and generic errors", async () => {
    const f = await fixture();
    const headers = {
      "content-type": "application/json",
      origin: config.origin,
      "idempotency-key": newId(),
    };
    const request = (body: unknown, h = headers) =>
      new Request(`${config.origin}/api/attendant/sign-in`, {
        method: "POST",
        headers: h,
        body: JSON.stringify(body),
      });
    const bad = await handleAuth(
      request(f.input, { ...headers, origin: "https://evil.test" }),
      "sign-in",
    );
    expect(bad.status).toBe(403);
    const extra = await handleAuth(
      request({ ...f.input, pumpId: newId() }),
      "sign-in",
    );
    expect(extra.status).toBe(400);
    const response = await handleAuth(request(f.input), "sign-in");
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain(`${COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Domain=");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const read = await handleAuth(
      new Request(`${config.origin}/api/attendant/session`, {
        headers: { cookie: cookie.split(";")[0]! },
      }),
      "session",
    );
    expect(read.status).toBe(200);
    const logout = await handleAuth(
      new Request(`${config.origin}/api/attendant/sign-out`, {
        method: "POST",
        headers: { ...headers, cookie: cookie.split(";")[0]! },
        body: "{}",
      }),
      "sign-out",
    );
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("missing assignment returns 422 without committing a session or context", async () => {
    const f = await fixture();
    await pool.query(
      "UPDATE assignment SET effective_until=clock_timestamp() WHERE id=$1",
      [f.assignmentId],
    );
    await expect(
      signIn(pool, config, f.input, newId(), f.ip),
    ).rejects.toMatchObject(failure("assignment_unavailable", 422));
    expect(
      (
        await pool.query("SELECT count(*) FROM auth_session WHERE user_id=$1", [
          f.userId,
        ])
      ).rows[0].count,
    ).toBe("0");
  });
  it("I-03 session reads after the exact 24-hour boundary preserve the expired offline anchor", async () => {
    const f = await fixture();
    const contextId = newId(),
      sessionId = newId();
    const t = new Date(Date.now() - 86400000),
      expiry = new Date(t.getTime() + 86400000);
    await pool.query(
      "INSERT INTO capture_context(id,attendant_id,assignment_id,signed_in_at,offline_expires_at,seller_name,seller_username,device_binding_digest) VALUES($1,$2,$3,$4,$5,'Grace Test',$6,'fictional-test-device')",
      [contextId, f.attendantId, f.assignmentId, t, expiry, f.input.username],
    );
    await pool.query(
      "INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at,assignment_id,capture_context_id,created_at) VALUES($1,$2,$3,$4,1,$5,$6,$7,$5)",
      [
        sessionId,
        f.userId,
        digest(sessionSecret(config.secret, sessionId)),
        new Date(Date.now() + 86400000),
        t,
        f.assignmentId,
        contextId,
      ],
    );
    const response = await getSession(
      pool,
      config,
      sessionSecret(config.secret, sessionId),
      f.ip,
    );
    expect(response.lastOnlineSignInAt).toBe(t.toISOString());
    expect(response.offlineExpiresAt).toBe(expiry.toISOString());
    expect(Date.parse(response.serverTime)).toBeGreaterThanOrEqual(
      Date.parse(response.offlineExpiresAt),
    );
  });
  it("expired database sessions are refused", async () => {
    const f = await fixture();
    const sessionId = newId();
    await pool.query(
      "INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at,created_at) VALUES($1,$2,$3,now()-interval '1 hour',1,now()-interval '2 hours',now()-interval '2 hours')",
      [sessionId, f.userId, digest(sessionSecret(config.secret, sessionId))],
    );
    await expect(
      getSession(pool, config, sessionSecret(config.secret, sessionId), f.ip),
    ).rejects.toMatchObject(failure("unauthenticated", 401));
  });
  it("price refresh changes future price only, leaving the capture context and sign-in anchor intact", async () => {
    const station = newId(),
      pump = newId();
    await pool.query(
      "INSERT INTO station(id,code,name,timezone,version) VALUES($1,$2,'Test station','Africa/Lagos',1)",
      [station, `TEST-${station}`],
    );
    await pool.query(
      "INSERT INTO pump(id,station_id,code,product_id,enabled,version) VALUES($1,$2,'TEST01',$3,true,1)",
      [pump, station, id(9)],
    );
    await pool.query(
      "INSERT INTO product_price_version(id,station_id,product_id,version,rate_kobo,currency,quantity_precision,effective_from,actor_id,reason) VALUES($1,$2,$3,1,100000,'NGN',2,now(),$4,'Test price')",
      [newId(), station, id(9), id(5)],
    );
    const f = await fixture(pump);
    const first = await signIn(pool, config, f.input, newId(), f.ip);
    await pool.query(
      "INSERT INTO product_price_version(id,station_id,product_id,version,rate_kobo,currency,quantity_precision,effective_from,actor_id,reason) VALUES($1,$2,$3,2,110000,'NGN',3,clock_timestamp(),$4,'Test price refresh')",
      [newId(), station, id(9), id(5)],
    );
    const refreshed = await getSession(pool, config, first.token, f.ip);
    expect(refreshed.price).toMatchObject({
      version: 2,
      rateKobo: "110000",
      quantityPrecision: 3,
    });
    expect(refreshed.captureContextId).toBe(first.session.captureContextId);
    expect(refreshed.lastOnlineSignInAt).toBe(first.session.lastOnlineSignInAt);
  });
  it("HTTP throttling returns integer Retry-After and sign-out without a cookie remains 204", async () => {
    const f = await fixture();
    const headers = {
      "content-type": "application/json",
      origin: config.origin,
      "idempotency-key": newId(),
    };
    const attempt = () =>
      handleAuth(
        new Request(`${config.origin}/api/attendant/sign-in`, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...f.input, password: "incorrect" }),
        }),
        "sign-in",
      );
    for (let n = 0; n < 5; n++) expect((await attempt()).status).toBe(401);
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^[1-9][0-9]*$/);
    const request = () =>
      new Request(`${config.origin}/api/attendant/sign-out`, {
        method: "POST",
        headers,
        body: "{}",
      });
    expect((await handleAuth(request(), "sign-out")).status).toBe(204);
    expect((await handleAuth(request(), "sign-out")).status).toBe(204);
  });
  it("fixture credential seeding is explicit outside local, repeatable and never resets credentials", async () => {
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    try {
      await seedAttendantCredentials(client, { WHR_ENV: "staging" });
      await seedAttendantCredentials(client, {
        WHR_ENV: "staging",
        WHR_SEED_ATTENDANT_PASSWORD: password,
      });
      const first = (
        await client.query(
          "SELECT password_hash FROM auth_credential WHERE user_id=$1",
          [id(3)],
        )
      ).rows[0].password_hash;
      await seedAttendantCredentials(client, {
        WHR_ENV: "staging",
        WHR_SEED_ATTENDANT_PASSWORD: randomBytes(24).toString("hex"),
      });
      expect(
        (
          await client.query(
            "SELECT password_hash FROM auth_credential WHERE user_id=$1",
            [id(3)],
          )
        ).rows[0].password_hash,
      ).toBe(first);
      await expect(
        seedAttendantCredentials(client, { WHR_ENV: "production" }),
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
  });
  it("session reads make progress with a one-connection pool and recheck authority", async () => {
    const f = await fixture();
    const first = await signIn(pool, config, f.input, newId(), f.ip);
    const single = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
    });
    try {
      expect(
        (await getSession(single, config, first.token, f.ip)).account.id,
      ).toBe(f.attendantId);
    } finally {
      await single.end();
    }
  });
});
