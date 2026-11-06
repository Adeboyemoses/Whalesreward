import type pg from "pg";
/** Serialize committed pricing history against settlement. Take the writer lock
 * before sampling effective_from; take the reader lock in its own SQL statement
 * before history SELECTs so READ COMMITTED observes any writer it waited for.
 * Lock lifetime is the caller's transaction, including its eventual COMMIT.
 */
export async function lockPriceHistory(
  db: pg.PoolClient,
  stationId: string,
  productId: string,
  mode: "read" | "write",
) {
  const key = `price-history:${stationId}:${productId}`;
  if (mode === "write")
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      key,
    ]);
  else
    await db.query(
      "SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",
      [key],
    );
}
