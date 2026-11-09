import type pg from "pg";
import type { LookupReceiptClaims } from "../../../shared/contracts/lookup-receipt";
import {
  signLookupReceipt,
  verifyLookupReceipt,
  type LookupReceiptKeys,
} from "./lookup-receipt";
/** Caller holds the card lock; a separate statement samples time after the lock. */
export async function issueLookupReceipt(
  db: pg.PoolClient,
  contextId: string | null,
  attendantId: string,
  cardId: string,
  keys: LookupReceiptKeys,
) {
  if (!contextId || !keys.activeKid) return null;
  const r = (
    await db.query<{
      context_id: string;
      attendant_id: string;
      station_id: string;
      card_id: string;
      card_code: string;
      customer_id: string;
      link_id: string;
      issued_at: Date;
      expires_at: Date;
    }>(
      `WITH stamp AS MATERIALIZED (SELECT date_trunc('milliseconds',clock_timestamp()) AS t)
 SELECT c.id AS context_id,c.attendant_id,p.station_id,card.id AS card_id,card.code AS card_code,l.customer_id,l.id AS link_id,stamp.t AS issued_at,c.offline_expires_at AS expires_at
 FROM capture_context c JOIN assignment a ON a.id=c.assignment_id JOIN pump p ON p.id=a.pump_id
 JOIN card ON card.id=$3 JOIN card_batch b ON b.id=card.batch_id JOIN card_customer_link l ON l.card_id=card.id CROSS JOIN stamp
 WHERE c.id=$1 AND c.attendant_id=$2 AND c.revoked_at IS NULL AND c.signed_in_at<=stamp.t AND c.offline_expires_at>stamp.t
 AND a.effective_from<=stamp.t AND (a.effective_until IS NULL OR a.effective_until>stamp.t)
 AND card.state='linked' AND card.retired_at IS NULL AND b.status='active' AND l.linked_at<=stamp.t AND l.ended_at IS NULL`,
      [contextId, attendantId, cardId],
    )
  ).rows[0];
  if (!r) return null;
  return signLookupReceipt(
    {
      version: 1,
      purpose: "capture_lookup",
      captureContextId: r.context_id,
      originatingAccountId: r.attendant_id,
      stationId: r.station_id,
      cardId: r.card_id,
      cardCode: r.card_code,
      customerId: r.customer_id,
      cardCustomerLinkId: r.link_id,
      issuedAt: r.issued_at.toISOString(),
      expiresAt: r.expires_at.toISOString(),
    },
    keys,
  );
}
export type FrozenLookupEvidence = {
  status: "valid" | "fallback";
  claims: LookupReceiptClaims | null;
  lowerBound: string;
  receivedAt: string;
};
/** Freeze verification in the insert transaction; never verify again during settlement. */
export async function freezeLookupEvidence(
  db: pg.PoolClient,
  input: unknown,
  contextId: string,
  attendantId: string,
  stationId: string,
  cardCode: string,
  keys: LookupReceiptKeys,
): Promise<FrozenLookupEvidence> {
  const claims = verifyLookupReceipt(input, keys);
  // Lock the card before sampling R so concurrent replacements are observed consistently.
  if (claims)
    await db.query("SELECT id FROM card WHERE code=$1 FOR SHARE", [cardCode]);
  const bounds = (
    await db.query<{ s: string; expiry: string; r: string }>(
      `SELECT signed_in_at::text AS s,offline_expires_at::text AS expiry,clock_timestamp()::text AS r FROM capture_context WHERE id=$1 AND attendant_id=$2`,
      [contextId, attendantId],
    )
  ).rows[0]!;
  const fallback: FrozenLookupEvidence = {
    status: "fallback",
    claims: null,
    lowerBound: bounds.s,
    receivedAt: bounds.r,
  };
  if (
    !claims ||
    claims.captureContextId !== contextId ||
    claims.originatingAccountId !== attendantId ||
    claims.stationId !== stationId ||
    claims.cardCode !== cardCode
  )
    return fallback;
  const match = (
    await db.query(
      `SELECT 1 FROM card c JOIN card_customer_link l ON l.card_id=c.id
 WHERE c.id=$1 AND c.code=$2 AND l.id=$3 AND l.customer_id=$4
 AND $5::timestamptz >= $6::timestamptz AND $5::timestamptz < $7::timestamptz
 AND $8::timestamptz = $7::timestamptz AND $5::timestamptz <= LEAST($9::timestamptz,$7::timestamptz)
 AND l.linked_at <= $5::timestamptz`,
      [
        claims.cardId,
        cardCode,
        claims.cardCustomerLinkId,
        claims.customerId,
        claims.issuedAt,
        bounds.s,
        bounds.expiry,
        claims.expiresAt,
        bounds.r,
      ],
    )
  ).rowCount;
  return match
    ? {
        status: "valid",
        claims,
        lowerBound: claims.issuedAt,
        receivedAt: bounds.r,
      }
    : fallback;
}
