import type pg from "pg";
import {
  priceRefreshSchema,
  type PriceRefresh,
} from "../../shared/contracts/sync";
import { lockPriceHistory } from "./price-history-lock";

/** Caller holds live session/assignment authority for this transaction. */
export async function readOnlinePrice(
  db: pg.PoolClient,
  userId: string,
  contextId: string | null,
): Promise<PriceRefresh | null> {
  if (!contextId) return null;
  const context = (
    await db.query<{
      context_id: string;
      attendant_id: string;
      assignment_id: string;
      station_id: string;
      pump_id: string;
      product_id: string;
    }>(
      `SELECT c.id AS context_id,c.attendant_id,a.id AS assignment_id,p.station_id,p.id AS pump_id,p.product_id
       FROM capture_context c JOIN attendant att ON att.id=c.attendant_id
       JOIN assignment a ON a.id=c.assignment_id AND a.attendant_id=c.attendant_id
       JOIN pump p ON p.id=a.pump_id AND p.enabled
       WHERE c.id=$1 AND att.user_id=$2 AND c.revoked_at IS NULL`,
      [contextId, userId],
    )
  ).rows[0];
  if (!context) return null;
  // Separate lock statement is essential: the next READ COMMITTED snapshot must
  // see an activation that committed while this reader was waiting.
  await lockPriceHistory(db, context.station_id, context.product_id, "read");
  // P-23 timestamps have millisecond precision; activations have microseconds.
  // Wait for the real clock to pass that boundary at receipt precision, rather
  // than rounding issuance into the future or returning pre-activation evidence.
  await db.query(
    `SELECT pg_sleep(0.001) FROM product_price_version
     WHERE station_id=$1 AND product_id=$2 AND effective_from<=clock_timestamp()
     AND effective_from>date_trunc('milliseconds',clock_timestamp())`,
    [context.station_id, context.product_id],
  );
  const price = (
    await db.query<{
      id: string;
      version: number;
      rate_kobo: string;
      currency: string;
      quantity_precision: number;
      effective_from: Date;
      fetched_at: Date;
    }>(
      `WITH stamp AS MATERIALIZED (SELECT clock_timestamp() AS t)
       SELECT v.id,v.version,v.rate_kobo::text,v.currency,v.quantity_precision,v.effective_from,stamp.t AS fetched_at
       FROM product_price_version v CROSS JOIN stamp
       WHERE v.station_id=$1 AND v.product_id=$2 AND v.effective_from<=stamp.t
       ORDER BY v.effective_from DESC,v.version DESC LIMIT 1`,
      [context.station_id, context.product_id],
    )
  ).rows[0];
  if (!price) return null;
  return priceRefreshSchema.parse({
    captureContextId: context.context_id,
    originatingAccountId: context.attendant_id,
    stationId: context.station_id,
    assignmentId: context.assignment_id,
    pumpId: context.pump_id,
    productId: context.product_id,
    price: {
      priceVersionId: price.id,
      version: price.version,
      rateKobo: price.rate_kobo,
      currency: price.currency,
      quantityPrecision: price.quantity_precision,
      effectiveFrom: price.effective_from.toISOString(),
      fetchedAt: price.fetched_at.toISOString(),
    },
  });
}
