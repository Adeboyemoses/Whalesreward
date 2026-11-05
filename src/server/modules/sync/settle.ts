import type pg from "pg";
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
  const ctx = (
    await db.query<{
      signed_in_at: Date;
      offline_expires_at: Date;
      revoked_at: Date | null;
      effective_from: Date;
      effective_until: Date | null;
    }>(
      `SELECT c.signed_in_at,c.offline_expires_at,c.revoked_at,a.effective_from,a.effective_until FROM capture_context c JOIN assignment a ON a.id=c.assignment_id WHERE c.id=$1 AND c.attendant_id=$2 AND a.id=$3 FOR SHARE OF c,a`,
      [p.capture_context_id, p.originating_attendant_id, p.assignment_id],
    )
  ).rows[0]!;
  const prices = (
    await db.query<PriceHistory>(
      `SELECT effective_from AS "effectiveFrom",rate_kobo::text AS "rateKobo",currency FROM product_price_version WHERE station_id=$1 AND product_id=$2 AND effective_from<=$3 ORDER BY effective_from`,
      [p.station_id, p.product_id, p.server_received_at],
    )
  ).rows;
  const settings = (
    await db.query<CampaignHistory>(
      `SELECT effective_from AS "effectiveFrom",purchase_start AS "purchaseStart",purchase_cutoff AS "purchaseCutoff",upload_deadline AS "uploadDeadline",campaign_id AS "campaignId" FROM settings_version WHERE station_id=$1 AND effective_from<=$2 ORDER BY effective_from`,
      [p.station_id, p.server_received_at],
    )
  ).rows;
  const policy = evaluateCapturePolicy({
    signedInAt: ctx.signed_in_at,
    receivedAt: p.server_received_at,
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
  const links = (
    await db.query<{
      linked_at: Date;
      ended_at: Date | null;
      customer_id: string;
    }>(
      "SELECT linked_at,ended_at,customer_id FROM card_customer_link WHERE card_id=$1 ORDER BY linked_at FOR SHARE",
      [p.card_id],
    )
  ).rows;
  const historical = links.filter((l) => l.linked_at <= p.server_received_at);
  if (
    historical.some((l) => l.customer_id !== p.customer_id) ||
    !historical.some(
      (l) =>
        l.customer_id === p.customer_id &&
        l.linked_at <= ctx.signed_in_at &&
        (l.ended_at === null || l.ended_at > p.server_received_at),
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
      operationId,
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
