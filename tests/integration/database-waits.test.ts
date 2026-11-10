import pg from "pg";
import { expect, it } from "vitest";
import { transaction as syncTransaction } from "../../src/server/modules/sync/repo";
import { getSession } from "../../src/server/modules/auth/service";
import { consumeLimits } from "../../src/server/modules/auth/rate-limit";
import { randomUUID } from "node:crypto";
import { transaction } from "../../src/server/modules/admin-access/repo";

it.each([
  ["admin", transaction],
  ["sync", syncTransaction],
] as const)(
  "WHR-97 %s discards a client timeout rather than reusing its still-running transaction",
  async (_name, transaction) => {
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 500,
      query_timeout: 50,
      statement_timeout: 200,
    });
    try {
      await expect(
        transaction(pool, (db) => db.query("SELECT pg_sleep(10)")),
      ).rejects.toThrow("Query read timeout");
      expect(pool.totalCount).toBe(0);
      expect(
        (await transaction(pool, (db) => db.query("SELECT 1 AS ok"))).rows[0]
          .ok,
      ).toBe(1);
    } finally {
      await pool.end();
    }
  },
);
it.each([
  ["admin", transaction],
  ["sync", syncTransaction],
] as const)(
  "WHR-97 %s handles an idle transaction timeout without an unhandled client error",
  async (_name, transaction) => {
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 500,
      query_timeout: 500,
      idle_in_transaction_session_timeout: 50,
    });
    try {
      await expect(
        transaction(pool, async (db) => {
          await new Promise((r) => setTimeout(r, 150));
          await db.query("SELECT 1");
        }),
      ).rejects.toThrow();
      expect(pool.totalCount).toBe(0);
      expect(
        (await transaction(pool, (db) => db.query("SELECT 1 AS ok"))).rows[0]
          .ok,
      ).toBe(1);
    } finally {
      await pool.end();
    }
  },
);

it.each([
  ["auth-session", "query"],
  ["rate-limit", "query"],
  ["auth-session", "idle"],
  ["rate-limit", "idle"],
] as const)(
  "WHR-97 %s %s timeout discards the connection and preserves later requests",
  async (kind, mode) => {
    const schema = "whr97_wait_" + randomUUID().replaceAll("-", "");
    const root = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await root.connect();
    await root.query(`CREATE SCHEMA ${schema}`);
    await root.query(
      `CREATE TABLE ${schema}.auth_rate_bucket(key_digest TEXT PRIMARY KEY,tokens NUMERIC(30,15) NOT NULL,updated_at TIMESTAMPTZ NOT NULL)`,
    );
    await root.query(
      `CREATE TABLE ${schema}.auth_session(user_id UUID,secret_verifier TEXT)`,
    );
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
      max: 1,
      connectionTimeoutMillis: 500,
      query_timeout: mode === "query" ? 50 : 500,
      statement_timeout: 200,
      idle_in_transaction_session_timeout: mode === "idle" ? 50 : 0,
    });
    // Introduce a real idle gap in the actual caller between BEGIN and its next
    // query; PostgreSQL emits the termination event while no query is pending.
    let injectIdle = mode === "idle";
    pool.on("connect", (client) => {
      const query = client.query;
      client.query = ((text: string, ...args: unknown[]) => {
        const target =
          kind === "auth-session"
            ? text.includes("SELECT user_id FROM auth_session")
            : text.includes("INSERT INTO auth_rate_bucket");
        if (injectIdle && target) {
          injectIdle = false;
          return new Promise((resolve) => setTimeout(resolve, 150)).then(() =>
            Reflect.apply(query, client, [text, ...args]),
          );
        }
        return Reflect.apply(query, client, [text, ...args]);
      }) as typeof client.query;
    });
    try {
      if (mode === "query") {
        await root.query("BEGIN");
        await root.query(
          `LOCK TABLE ${schema}.${kind === "auth-session" ? "auth_session" : "auth_rate_bucket"} IN ACCESS EXCLUSIVE MODE`,
        );
      }
      const operation =
        kind === "auth-session"
          ? getSession(
              pool,
              { secret: "fictional", origin: "https://example.test" },
              "fictional",
              "127.0.0.1",
            )
          : consumeLimits(pool, "fictional", [{ key: "fixture", capacity: 1 }]);
      await expect(operation).rejects.toThrow(
        mode === "query" ? "Query read timeout" : undefined,
      );
      expect(pool.totalCount).toBe(0);
      await root.query("ROLLBACK");
      await expect(
        consumeLimits(pool, "fictional", [{ key: "after", capacity: 1 }]),
      ).resolves.toBeUndefined();
      await expect(
        consumeLimits(pool, "fictional", [
          { key: "after", capacity: 1 },
          { key: "fresh-dimension", capacity: 1 },
        ]),
      ).rejects.toMatchObject({ code: "rate_limited" });
      // The denied attempt must still commit the other dimension's consumption.
      await expect(
        consumeLimits(pool, "fictional", [
          { key: "fresh-dimension", capacity: 1 },
        ]),
      ).rejects.toMatchObject({ code: "rate_limited" });
      const client = await pool.connect();
      try {
        expect((await client.query("SELECT 1 AS ok")).rows[0].ok).toBe(1);
        expect(client.getTransactionStatus()).toBe("I");
      } finally {
        client.release();
      }
    } finally {
      await root.query("ROLLBACK");
      await pool.end();
      await root.query(`DROP SCHEMA ${schema} CASCADE`);
      await root.end();
    }
  },
);
