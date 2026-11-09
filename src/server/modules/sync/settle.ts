import type pg from "pg";
import { lockPriceHistory } from "../../lib/price-history-lock";
import { newId } from "../../lib/ids";
import {
  evaluateCapturePolicy,
  CAPTURE_POLICY_VERSION,
  type CampaignHistory,
  type PriceHistory,
} from "./capture-policy";
import { audit, type Purchase } from "./repo";
/** Called only under the scoped purchase row lock, after evidence and live authority. */
export async function settle(
  db: pg.PoolClient,
  p: Purchase,
  userId: string,
  operationId: string,
  assetId: string,
) {
  // A price activation may already have sampled an in-interval effective time
  // while still uncommitted. Wait before opening the history query snapshot.
  await lockPriceHistory(db, p.station_id, p.product_id, "read");
  const ctx = (
    await db.query<{
      signed_in_at: string;
      received_at: string;
      offline_expires_at: string;
      revoked_at: string | null;
      effective_from: string;
      effective_until: string | null;
    }>(
      `SELECT (EXTRACT(EPOCH FROM c.signed_in_at)*1000000)::bigint::text AS signed_in_at,
 (EXTRACT(EPOCH FROM p.server_received_at)*1000000)::bigint::text AS received_at,
 (EXTRACT(EPOCH FROM c.offline_expires_at)*1000000)::bigint::text AS offline_expires_at,
 (EXTRACT(EPOCH FROM c.revoked_at)*1000000)::bigint::text AS revoked_at,
 (EXTRACT(EPOCH FROM a.effective_from)*1000000)::bigint::text AS effective_from,
 (EXTRACT(EPOCH FROM a.effective_until)*1000000)::bigint::text AS effective_until
 FROM capture_context c JOIN assignment a ON a.id=c.assignment_id JOIN purchase p ON p.id=$4
 WHERE c.id=$1 AND c.attendant_id=$2 AND a.id=$3 FOR SHARE OF c,a`,
      [p.capture_context_id, p.originating_attendant_id, p.assignment_id, p.id],
    )
  ).rows[0]!;
  const prices = (
    await db.query<PriceHistory>(
      `SELECT (EXTRACT(EPOCH FROM effective_from)*1000000)::bigint::text AS "effectiveFrom",rate_kobo::text AS "rateKobo",currency FROM product_price_version WHERE station_id=$1 AND product_id=$2 AND effective_from<=(SELECT server_received_at FROM purchase WHERE id=$3) ORDER BY effective_from`,
      [p.station_id, p.product_id, p.id],
    )
  ).rows;
  const settings = (
    await db.query<CampaignHistory>(
      `SELECT (EXTRACT(EPOCH FROM effective_from)*1000000)::bigint::text AS "effectiveFrom",(EXTRACT(EPOCH FROM purchase_start)*1000000)::bigint::text AS "purchaseStart",(EXTRACT(EPOCH FROM purchase_cutoff)*1000000)::bigint::text AS "purchaseCutoff",(EXTRACT(EPOCH FROM upload_deadline)*1000000)::bigint::text AS "uploadDeadline",campaign_id AS "campaignId" FROM settings_version WHERE station_id=$1 AND effective_from<=(SELECT server_received_at FROM purchase WHERE id=$2) ORDER BY effective_from`,
      [p.station_id, p.id],
    )
  ).rows;
  const policy = evaluateCapturePolicy({
    signedInAt: ctx.signed_in_at,
    receivedAt: ctx.received_at,
    offlineExpiresAt: ctx.offline_expires_at,
    contextRevokedAt: ctx.revoked_at,
    assignment: {
      effectiveFrom: ctx.effective_from,
      effectiveUntil: ctx.effective_until,
    },
    rateKobo: p.rate_kobo,
    currency: p.currency,
    prices,
    settings,
  });
  // Card state is checked again at acceptance, not trusted from the earlier lookup.
  const card = (
    await db.query<{ state: string; replaced_by_card_id: string | null }>(
      "SELECT state,replaced_by_card_id FROM card WHERE id=$1 FOR SHARE",
      [p.card_id],
    )
  ).rows[0];
  if (card?.state === "retired")
    policy.reasons.push(
      card.replaced_by_card_id ? "replaced_card" : "card_policy_unresolved",
    );
  if (!card || !p.customer_id)
    policy.reasons.push("capture_history_incomplete");
  const historical = (
    await db.query<{
      customer_id: string;
      linked_before_signin: boolean;
      ends_after_receipt: boolean;
    }>(
      `SELECT l.customer_id,l.linked_at<=c.signed_in_at AS linked_before_signin,
       (l.ended_at IS NULL OR l.ended_at>p.server_received_at) AS ends_after_receipt
       FROM card_customer_link l JOIN purchase p ON p.id=$2
       JOIN capture_context c ON c.id=p.capture_context_id
       WHERE l.card_id=$1 AND l.linked_at<=p.server_received_at ORDER BY l.linked_at FOR SHARE OF l`,
      [p.card_id, p.id],
    )
  ).rows;
  if (
    historical.some((l) => l.customer_id !== p.customer_id) ||
    !historical.some(
      (l) =>
        l.customer_id === p.customer_id &&
        l.linked_before_signin &&
        l.ends_after_receipt,
    )
  ) {
    if (!policy.reasons.includes("replaced_card"))
      policy.reasons.push("card_policy_unresolved");
  }
  const reasons = [...new Set(policy.reasons)];
  const held = reasons.length > 0;
  const revisionId = newId();
  await db.query(
    `INSERT INTO purchase_revision(id,purchase_id,revision_number,operation_id,actor_user_id,payload_digest,kind,state,server_received_at,amount_kobo,quantity,currency,unit,quantity_precision,basis,entered_amount_kobo,entered_quantity,rate_kobo,price_version_id,medium,evidence_asset_id,decision_actor_id,decision_reason,decided_at)
 SELECT $1,id,1,$2,$3,payload_digest,'original',$4,server_received_at,amount_kobo,quantity,currency,unit,quantity_precision,basis,entered_amount_kobo,entered_quantity,rate_kobo,price_version_id,medium,$5,CASE WHEN $4='accepted' THEN $3::uuid ELSE NULL END,CASE WHEN $4='accepted' THEN 'Validated original sale' ELSE NULL END,CASE WHEN $4='accepted' THEN clock_timestamp() ELSE NULL END FROM purchase WHERE id=$6`,
    [
      revisionId,
      p.operation_id,
      userId,
      held ? "proposed" : "accepted",
      assetId,
      p.id,
    ],
  );
  const holds: { kind: string; reason: string }[] = [];
  if (reasons.includes("price_uncertain"))
    holds.push({ kind: "price", reason: "price_uncertain" });
  if (reasons.includes("replaced_card"))
    holds.push({ kind: "card", reason: "replaced_card" });
  // M3 amendment: authorization/time policy blocks are separate from holds.
  // M1 exposes them through held + policy_review_required; reasons stay durable.
  for (const hold of holds)
    await db.query(
      `INSERT INTO purchase_hold(id,purchase_id,kind,state,opened_revision_id,reason_code,version) VALUES($1,$2,$3,'open',$4,$5,1)`,
      [newId(), p.id, hold.kind, revisionId, hold.reason],
    );
  await db.query(
    "INSERT INTO sync_validation(purchase_id,policy_version,reasons,campaign_eligible) VALUES($1,$2,$3,$4)",
    [
      p.id,
      CAPTURE_POLICY_VERSION,
      JSON.stringify(reasons),
      policy.campaignEligible && !held,
    ],
  );
  for (const code of reasons.filter(
    (r) =>
      r === "capture_authorization_unresolved" ||
      r === "capture_time_unresolved",
  ))
    await db.query(
      "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,$3,$4,clock_timestamp(),1)",
      [newId(), p.id, code, `p20-${CAPTURE_POLICY_VERSION}`],
    );
  await db.query(
    `UPDATE purchase SET status=$2,current_revision_id=$3,version=version+1 WHERE id=$1 AND status='finalizing'`,
    [p.id, held ? "held" : "credited", held ? null : revisionId],
  );
  await audit(
    db,
    userId,
    p.id,
    operationId,
    held ? "purchase.held" : "purchase.credited",
    {
      revisionId,
      assetId,
      reasons,
      campaignEligible: policy.campaignEligible && !held,
    },
  );
}
