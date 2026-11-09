import type pg from "pg";
/** Lock before loading authority/history in a separate SQL statement so a reader
 * waiting for an assignment change sees its committed boundary. Writers take
 * securityLock first; all locks live until the operation transaction commits.
 */
export async function lockAssignmentHistory(
  db: pg.PoolClient,
  userId: string,
  mode: "read" | "write",
) {
  const fn =
    mode === "write" ? "pg_advisory_xact_lock" : "pg_advisory_xact_lock_shared";
  await db.query(`SELECT ${fn}(hashtextextended($1,0))`, [
    `assignment-history:${userId}`,
  ]);
}
