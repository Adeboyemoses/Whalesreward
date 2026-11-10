import { transaction } from "../../lib/transaction";
import type pg from "pg";
import { AuthError } from "./errors";
import { hmac } from "./crypto";

export async function consumeLimits(
  pool: pg.Pool,
  secret: string,
  limits: { key: string; capacity: number }[],
) {
  let retryAfter = 0;
  await transaction(pool, async (db) => {
    // Deterministic ordering prevents deadlocks when dimensions overlap.
    for (const limit of limits
      .map((l) => ({ ...l, key: hmac(secret, "rate-v1", l.key) }))
      .sort((a, b) => a.key.localeCompare(b.key))) {
      await db.query(
        "INSERT INTO auth_rate_bucket VALUES ($1,$2,clock_timestamp()) ON CONFLICT DO NOTHING",
        [limit.key, limit.capacity],
      );
      const result = await db.query<{ remaining: string; retry: number }>(
        `WITH locked AS (
        SELECT *, clock_timestamp() AS t FROM auth_rate_bucket WHERE key_digest=$1 FOR UPDATE
      ), available AS (
        SELECT LEAST($2::numeric, tokens + GREATEST(0, EXTRACT(EPOCH FROM(t-updated_at))) * $2::numeric / 60) AS n,t FROM locked
      ) UPDATE auth_rate_bucket SET tokens=CASE WHEN n>=1 THEN n-1 ELSE n END, updated_at=t
      FROM available WHERE key_digest=$1 RETURNING n::text AS remaining, CEIL((1-n)*60/$2)::integer AS retry`,
        [limit.key, limit.capacity],
      );
      if (Number(result.rows[0]!.remaining) < 1)
        retryAfter = Math.max(retryAfter, result.rows[0]!.retry, 1);
    }
  });
  if (retryAfter) throw new AuthError("rate_limited", 429, retryAfter);
}
