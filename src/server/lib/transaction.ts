import type pg from "pg";

/** Shared by every checked-out request transaction; timeout errors must never poison the pool. */
export async function transaction<T>(
  pool: pg.Pool,
  run: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  let discard = false;
  const onError = () => {
    discard = true;
  };
  db.on("error", onError);
  try {
    await db.query("BEGIN");
    const r = await run(db);
    await db.query("COMMIT");
    return r;
  } catch (e) {
    // Client query timeouts do not cancel PostgreSQL work. Never return that
    // connection to the pool (nor queue ROLLBACK behind the still-running query).
    if (e instanceof Error && e.message === "Query read timeout")
      discard = true;
    else {
      try {
        await db.query("ROLLBACK");
      } catch {
        discard = true;
      }
    }
    throw e;
  } finally {
    db.removeListener("error", onError);
    db.release(discard);
  }
}
