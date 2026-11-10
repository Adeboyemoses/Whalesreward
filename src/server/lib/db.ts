import pg from "pg";
import { logger } from "./logger";
let pool: pg.Pool | undefined;
export function database(): pg.Pool {
  if (!process.env.DATABASE_URL)
    throw new Error("Database configuration is unavailable");
  if (pool) return pool;
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 5000,
    lock_timeout: 3000,
    statement_timeout: 5000,
    query_timeout: 6000,
    idle_in_transaction_session_timeout: 15000,
  });
  pool.on("error", () => logger.error({ event: "database.pool_failed" }));
  return pool;
}
