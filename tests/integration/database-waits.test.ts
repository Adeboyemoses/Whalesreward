import pg from "pg";
import { expect, it } from "vitest";
import { transaction } from "../../src/server/modules/admin-access/repo";

it("WHR-97 discards a client timeout rather than reusing its still-running transaction", async () => {
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
      (await transaction(pool, (db) => db.query("SELECT 1 AS ok"))).rows[0].ok,
    ).toBe(1);
  } finally {
    await pool.end();
  }
});
it("WHR-97 handles an idle transaction timeout without an unhandled client error", async () => {
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
      (await transaction(pool, (db) => db.query("SELECT 1 AS ok"))).rows[0].ok,
    ).toBe(1);
  } finally {
    await pool.end();
  }
});
