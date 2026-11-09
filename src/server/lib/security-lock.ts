import type pg from "pg";
/** Serialize administrative access changes before loading live authority. */
export async function securityLock(db: pg.PoolClient) {
  await db.query("SELECT id FROM security_state WHERE id=true FOR UPDATE");
}
