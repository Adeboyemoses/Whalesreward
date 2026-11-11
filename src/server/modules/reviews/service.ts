import {
  pinReviewEvidencePolicy,
  reviewEvidenceApprovalValid,
  type ReviewEnvironment,
} from "./config";
import {
  evaluateEvidenceV1,
  reviewEvidenceV1Installed,
  recheckEvidenceSources,
} from "./evidence-evaluator";
import type pg from "pg";
import { parseQuantity } from "../../../shared/quantity";
import { z } from "zod";
import * as wire from "../../../shared/contracts/sales";
import type { EvidenceStorage } from "../../adapters/storage";
import {
  requireAdminSession,
  requirePermission,
  securityLock,
} from "../../lib/authz";
import { newId } from "../../lib/ids";
import { stationDate } from "../../lib/time";
import { AuthError } from "../auth/errors";
import { transaction } from "../sync/repo";
import { payloadDigest } from "../sync/canonical";
import { reviewAuditAction } from "./audit-actions";
import { safeReason, snapshotText } from "../corrections/service";
import { enqueueDuplicateDetection } from "../duplicates/service";
import * as sql from "../sales/projections";
import {
  inspectReviewEvidence,
  type ReviewEvidencePolicy,
  type ReviewEvidence,
  type ReviewConclusion,
} from "./evidence";

type Kind = "price" | "card" | "date" | "capture" | "duplicate";
type Guard = { expectedVersion: number; expectedRevisionId: string | null };
type Purchase = {
  id: string;
  station_id: string;
  status: string;
  version: number;
  current_revision_id: string | null;
  resolution_candidate_revision_id: string | null;
  server_received_at: Date;
  customer_id: string | null;
  card_id: string | null;
};
type Revision = {
  id: string;
  state: string;
  evidence_asset_id: string | null;
  values: wire.SaleValues;
};
const permissions = {
  price: "priceReview",
  card: "cardEligibility",
  date: "dateReview",
  capture: "dateReview",
  duplicate: "duplicates",
} as const;
const safeText = safeReason;
async function authority(
  db: pg.PoolClient,
  token: string | undefined,
  kind: Kind,
) {
  await securityLock(db);
  const a = await requireAdminSession(db, token);
  requirePermission(a, "sales");
  requirePermission(a, permissions[kind]);
  const stations = (
    await db.query<{ id: string }>("SELECT id FROM station ORDER BY id LIMIT 2")
  ).rows;
  if (stations.length !== 1) throw new AuthError("permission_denied", 403);
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('reporting:'||$1::text,0))",
    [stations[0]!.id],
  );
  return { ...a, stationId: stations[0]!.id };
}
async function purchase(db: pg.PoolClient, id: string, station: string) {
  const p = (
    await db.query<Purchase>(
      "SELECT * FROM purchase WHERE id=$1 AND station_id=$2 FOR UPDATE",
      [id, station],
    )
  ).rows[0];
  if (!p) throw new AuthError("not_found", 404);
  return p;
}
function guard(p: Purchase, g: Guard) {
  if (
    p.version !== g.expectedVersion ||
    p.current_revision_id !== g.expectedRevisionId
  )
    throw new AuthError("version_conflict", 409);
  if (p.status === "cancelled") throw new AuthError("review_closed", 409);
}
async function candidate(db: pg.PoolClient, p: Purchase) {
  const r = (
    await db.query<Revision>(
      `SELECT r.id,r.state,r.evidence_asset_id,${sql.values("r")} AS values FROM purchase_revision r WHERE r.purchase_id=$1 AND (r.id=$2 OR ($2::uuid IS NULL AND r.kind='original')) ORDER BY r.revision_number DESC LIMIT 1`,
      [p.id, p.resolution_candidate_revision_id ?? p.current_revision_id],
    )
  ).rows[0];
  if (!r) throw new AuthError("review_closed", 409);
  r.values = wire.saleValuesSchema.parse(r.values);
  return r;
}
async function replay(
  db: pg.PoolClient,
  actor: string,
  operation: string,
  hash: string,
) {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `sale-decision:${actor}:${operation}`,
  ]);
  const old = (
    await db.query<{
      payload_digest: string;
      response: unknown;
      replay_response: unknown;
    }>(
      "SELECT payload_digest,response,replay_response FROM sale_decision WHERE actor_user_id=$1 AND operation_id=$2",
      [actor, operation],
    )
  ).rows[0];
  if (old && old.payload_digest !== hash)
    throw new AuthError("operation_conflict", 409);
  return old;
}
async function markCampaigns(db: pg.PoolClient, id: string) {
  await db.query(
    "UPDATE campaign SET reconciliation_required=true,version=version+1 WHERE id IN (SELECT s.campaign_id FROM giveaway_snapshot s JOIN giveaway_snapshot_source x ON x.snapshot_id=s.id WHERE x.purchase_id=$1)",
    [id],
  );
}
async function cancel(
  db: pg.PoolClient,
  p: Purchase,
  actor: string,
  admin: string,
  did: string,
  reason: string,
  r: Revision,
  operationId: string,
) {
  if (!["held", "credited", "received", "photo_pending"].includes(p.status))
    throw new AuthError("sale_not_cancellable", 409);
  await db.query(
    "UPDATE purchase_hold SET state='cancelled',resolved_by=$2,resolution_operation_id=$3,resolution_reason=$4,resolved_at=clock_timestamp(),resolution_revision_id=$5,version=version+1 WHERE purchase_id=$1 AND state='open'",
    [p.id, admin, operationId, reason, r.id],
  );
  await db.query(
    "UPDATE purchase_validation_block SET resolved_at=clock_timestamp(),resolution_reference=$2,closure_kind='cancelled',version=version+1 WHERE purchase_id=$1 AND resolved_at IS NULL",
    [p.id, did],
  );
  await db.query(
    "UPDATE purchase_revision SET state='rejected',version=version+1,decision_actor_id=$2,decision_reason=$3,decided_at=clock_timestamp() WHERE purchase_id=$1 AND state='proposed'",
    [p.id, actor, reason],
  );
  // Terminally close proposal work before the purchase trigger runs; the original
  // submission receipt remains immutable, while current review state records cancellation.
  await db.query(
    "UPDATE correction_request SET state='rejected',version=version+1,validation_error='sale_cancelled',decision_reason=$3,decision_id=$4,decided_by_user_id=$2,decided_at=clock_timestamp(),lease_token=NULL,lease_until=NULL WHERE purchase_id=$1 AND state IN ('pending_validation','awaiting_review')",
    [p.id, actor, reason, did],
  );
  const result = await db.query(
    "UPDATE purchase SET status='cancelled',cancellation_reason=$3,resolution_candidate_revision_id=NULL,version=version+1 WHERE id=$1 AND version=$2 AND status=$4",
    [p.id, p.version, reason, p.status],
  );
  if (result.rowCount !== 1) throw new AuthError("version_conflict", 409);
  await markCampaigns(db, p.id);
}
/** Accept only a fully validated candidate; an unrelated decision never waives a gate. */
async function accept(
  db: pg.PoolClient,
  p: Purchase,
  r: Revision,
  actor: string,
  reason: string,
) {
  const blocked = (
    await db.query<{ blocked: boolean }>(
      `SELECT
    $2::uuid IS NULL OR NOT EXISTS(SELECT 1 FROM photo_asset a WHERE a.id=$3 AND a.purchase_id=$1 AND a.state='validated' AND a.validated_digest=(SELECT expected_photo_digest FROM purchase WHERE id=$1))
    OR EXISTS(SELECT 1 FROM purchase_hold WHERE purchase_id=$1 AND state='open')
    OR EXISTS(SELECT 1 FROM purchase_validation_block WHERE purchase_id=$1 AND resolved_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM sync_validation WHERE purchase_id=$1)
    OR EXISTS(SELECT 1 FROM sync_validation v CROSS JOIN LATERAL jsonb_array_elements_text(v.reasons) reason(code) WHERE v.purchase_id=$1 AND NOT (
      (reason.code IN ('price_uncertain','replaced_card','capture_date_uncertain') AND EXISTS(SELECT 1 FROM purchase_hold h WHERE h.purchase_id=$1 AND h.state='resolved' AND h.reason_code=reason.code))
      OR (reason.code IN ('capture_authorization_unresolved','capture_time_unresolved') AND EXISTS(SELECT 1 FROM purchase_validation_block b WHERE b.purchase_id=$1 AND b.code=reason.code AND b.resolved_at IS NOT NULL AND b.closure_kind='confirmed'))
    )) AS blocked`,
      [p.id, p.customer_id, r.evidence_asset_id],
    )
  ).rows[0]!.blocked;
  if (!blocked && r.id !== p.current_revision_id) {
    if (p.current_revision_id)
      await db.query(
        "UPDATE purchase_revision SET state='superseded',version=version+1 WHERE id=$1 AND purchase_id=$2 AND state='accepted'",
        [p.current_revision_id, p.id],
      );
    const changed = await db.query(
      "UPDATE purchase_revision SET state='accepted',version=version+1,decision_actor_id=$3,decision_reason=$4,decided_at=clock_timestamp() WHERE id=$1 AND purchase_id=$2 AND state='proposed'",
      [r.id, p.id, actor, reason],
    );
    if (changed.rowCount !== 1) throw new AuthError("version_conflict", 409);
  }
  const changed = await db.query(
    "UPDATE purchase SET current_revision_id=$3,resolution_candidate_revision_id=$4,status=$5,verified_sale_date=$6,version=version+1 WHERE id=$1 AND version=$2 AND status=$7",
    [
      p.id,
      p.version,
      blocked ? p.current_revision_id : r.id,
      blocked ? r.id : null,
      blocked ? "held" : "credited",
      r.values.verifiedSaleDate,
      p.status,
    ],
  );
  if (changed.rowCount !== 1) throw new AuthError("version_conflict", 409);
  if (!blocked && r.id !== p.current_revision_id)
    await enqueueDuplicateDetection(db, p.id);
  await markCampaigns(db, p.id);
}
async function dateRevision(
  db: pg.PoolClient,
  p: Purchase,
  r: Revision,
  date: string,
  actor: string,
  operation: string,
  hash: string,
  did: string,
  reason: string,
) {
  const id = newId();
  await db.query(
    `INSERT INTO purchase_revision(id,purchase_id,revision_number,operation_id,actor_user_id,payload_digest,based_on_revision_id,kind,state,reason,server_received_at,amount_kobo,quantity,currency,unit,quantity_precision,basis,entered_amount_kobo,entered_quantity,rate_kobo,price_version_id,medium,verified_sale_date,evidence_asset_id,calculation_mode,resolution_id)
  SELECT $1,purchase_id,(SELECT max(revision_number)+1 FROM purchase_revision WHERE purchase_id=$2),$3,$4,$5,id,'date_resolution','proposed',$6,clock_timestamp(),amount_kobo,quantity,currency,unit,quantity_precision,basis,entered_amount_kobo,entered_quantity,rate_kobo,price_version_id,medium,$7,evidence_asset_id,calculation_mode,$8 FROM purchase_revision WHERE id=$9 AND purchase_id=$2`,
    [id, p.id, operation, actor, hash, reason, date, did, r.id],
  );
  return {
    ...r,
    id,
    state: "proposed",
    values: { ...r.values, verifiedSaleDate: date },
  };
}
type Authority = Awaited<ReturnType<typeof authority>>;
async function record(
  db: pg.PoolClient,
  a: Authority,
  p: Purchase,
  before: wire.SaleValues,
  after: wire.SaleValues,
  kind: Kind,
  outcome: string,
  body: { operationId: string; reason: string },
  hash: string,
  did: string,
  extra: {
    holdId?: string;
    flagId?: string;
    evidence?: ReviewEvidence;
    conclusion?: ReviewConclusion;
    evaluation?: Record<string, unknown>;
    replay?: (response: wire.Decision) => Promise<unknown>;
  } = {},
) {
  const current = await purchase(db, p.id, a.stationId);
  const actor = (
    await db.query<{
      code: string;
      name: string;
      username: string;
      role: string;
    }>(
      "SELECT ad.admin_code code,u.display_name name,u.username,r.name role FROM admin ad JOIN auth_user u ON u.id=ad.user_id JOIN role r ON r.id=ad.role_id WHERE ad.id=$1",
      [a.admin_id],
    )
  ).rows[0]!;
  const holdRows = (
    await db.query<{ data: unknown }>(
      `SELECT ${sql.holds(false)} data FROM purchase p WHERE p.id=$1`,
      [p.id],
    )
  ).rows[0]!.data;
  const holds = z
    .array(wire.holdDetailSchema)
    .parse(holdRows)
    .filter((h) => h.state === "open");
  const blocks = (
    await db.query<{ code: string }>(
      "SELECT code FROM purchase_validation_block WHERE purchase_id=$1 AND resolved_at IS NULL ORDER BY code",
      [p.id],
    )
  ).rows.map((b) => b.code);
  const auditId = newId(),
    now = (await db.query<{ now: Date }>("SELECT clock_timestamp() now"))
      .rows[0]!.now;
  const auditValue = (
    values: wire.SaleValues,
    revision: string | null,
    credited: boolean,
  ) => ({
    amountKobo: values.amountKobo,
    quantity: values.quantity,
    currency: values.currency,
    unit: values.unit,
    basis: values.basis,
    medium: values.medium,
    rateKobo: values.rateKobo,
    priceVersionId: values.priceVersionId,
    revisionId: revision,
    credited,
    correctionState: null,
  });
  const seller = (
    await db.query<{
      attendantId: string;
      accountId: string;
      staffCode: string;
      name: string;
      username: string;
    }>(
      `SELECT t.id AS "attendantId",t.user_id AS "accountId",t.staff_code AS "staffCode",p.seller_name AS name,p.seller_username AS username FROM purchase p JOIN attendant t ON t.id=p.originating_attendant_id WHERE p.id=$1`,
      [p.id],
    )
  ).rows[0]!;
  const sellerSnapshot = {
    ...seller,
    staffCode: snapshotText(seller.staffCode),
    name: snapshotText(seller.name),
    username: snapshotText(seller.username),
  };
  await db.query(
    `INSERT INTO audit_event(id,actor_user_id,actor_kind,action,target_type,target_id,operation_id,before,after,reason,occurred_at,actor_snapshot,originating_seller_snapshot)
  SELECT $1,$2,'user',$3,'purchase',p.id,$4,$5,$6,$7,$8,$9,$11 FROM purchase p JOIN attendant t ON t.id=p.originating_attendant_id WHERE p.id=$10`,
    [
      auditId,
      a.user_id,
      reviewAuditAction(kind, outcome),
      body.operationId,
      JSON.stringify(
        auditValue(before, p.current_revision_id, p.status === "credited"),
      ),
      JSON.stringify({
        ...auditValue(
          after,
          current.current_revision_id,
          current.status === "credited",
        ),
        ...(extra.evaluation
          ? {
              reviewPolicy: (() => {
                const policy = extra.evaluation.policy as {
                  release: string;
                  digest: string;
                  revision: number;
                };
                return {
                  release: policy.release,
                  digest: policy.digest,
                  revision: policy.revision,
                };
              })(),
              reviewConclusions: (
                extra.evaluation.conclusions as { tag: string }[]
              ).map((c) => c.tag),
              reviewEvaluationId: did,
            }
          : {}),
      }),
      body.reason,
      now,
      JSON.stringify({
        kind: "admin",
        userId: a.user_id,
        code: snapshotText(actor.code),
        nameAtEvent: snapshotText(actor.name),
        usernameAtEvent: snapshotText(actor.username),
        roleAtEvent: snapshotText(actor.role),
      }),
      p.id,
      JSON.stringify(sellerSnapshot),
    ],
  );
  const response = wire.decisionSchema.parse({
    id: did,
    operationId: body.operationId,
    purchaseId: p.id,
    kind,
    outcome,
    actor: { id: a.admin_id, code: actor.code, name: actor.name },
    reason: body.reason,
    decidedAt: now.toISOString(),
    auditEventId: auditId,
    appliedPurchaseVersion: current.version,
    appliedRevisionId: current.current_revision_id,
    before,
    after,
    creditedAfter:
      current.status === "credited" &&
      holds.length === 0 &&
      blocks.length === 0,
    remainingHolds: holds,
    policyBlocks: blocks,
  });
  await db.query(
    `INSERT INTO sale_decision(id,purchase_id,operation_id,actor_user_id,payload_digest,kind,outcome,expected_purchase_version,expected_revision_id,result_revision_id,applied_purchase_version,before_values,after_values,evidence_asset_id,reason,decided_at,audit_event_id,response,hold_id,flag_id,evidence_evaluation,replay_response,capture_evaluation,resolved_capture_block_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
    [
      did,
      p.id,
      body.operationId,
      a.user_id,
      hash,
      kind,
      outcome,
      p.version,
      p.current_revision_id,
      current.current_revision_id,
      current.version,
      JSON.stringify(before),
      JSON.stringify(after),
      extra.evidence?.assetId ?? null,
      body.reason,
      now,
      auditId,
      JSON.stringify(response),
      extra.holdId ?? null,
      extra.flagId ?? null,
      extra.conclusion
        ? JSON.stringify({
            conclusion: extra.conclusion,
            referenceIds: extra.evidence!.referenceIds,
            notes: extra.evidence!.notes,
            context: extra.evaluation ?? null,
          })
        : null,
      extra.replay ? JSON.stringify(await extra.replay(response)) : null,
      kind === "capture" ? JSON.stringify(extra.evaluation) : null,
      kind === "capture"
        ? (
            extra.evaluation?.target as { captureBlocks: { id: string }[] }
          ).captureBlocks.map((b) => b.id)
        : [],
    ],
  );
  if (extra.evaluation) {
    await db.query(
      "INSERT INTO review_evaluation(decision_id,purchase_id,provenance) VALUES($1,$2,$3)",
      [
        did,
        p.id,
        JSON.stringify({
          ...extra.evaluation,
          result: {
            actorId: a.user_id,
            reason: body.reason,
            decidedAt: now.toISOString(),
            evidenceAssetId: extra.evidence!.assetId,
            notes: extra.evidence!.notes,
            resultingRevisionId: current.current_revision_id,
            appliedPurchaseVersion: current.version,
            remainingHolds: holds,
            remainingBlocks: blocks,
            credited: response.creditedAfter,
            closure: outcome === "cancel" ? "cancelled" : "confirmed",
          },
        }),
      ],
    );
  }
  await db.query(
    "INSERT INTO duplicate_reporting_state(station_id,generation) VALUES($1,1) ON CONFLICT(station_id) DO UPDATE SET generation=duplicate_reporting_state.generation+1",
    [p.station_id],
  );
  return response;
}
export function createReviewsService({
  pool,
  storage,
  env = process.env,
}: {
  pool: pg.Pool;
  storage: EvidenceStorage;
  evidencePolicy?: ReviewEvidencePolicy;
  env?: ReviewEnvironment;
}) {
  async function decide(
    kind: Exclude<Kind, "duplicate">,
    token: string | undefined,
    purchaseId: string,
    holdId: string | undefined,
    input: unknown,
  ) {
    const body =
      kind === "price"
        ? wire.priceDecisionSchema.parse(input)
        : kind === "card"
          ? wire.cardDecisionSchema.parse(input)
          : kind === "date"
            ? wire.dateDecisionSchema.parse(input)
            : wire.captureDecisionSchema.parse(input);
    safeText(body.reason);
    safeText(body.evidence.notes);
    const outcome =
      "decision" in body
        ? body.decision.outcome
        : "outcome" in body
          ? body.outcome
          : "verify_date";
    const hash = payloadDigest({
      kind,
      purchaseId,
      holdId: holdId ?? null,
      ...body,
    });
    const historical = await transaction(pool, async (db) => {
      const a = await authority(db, token, kind);
      const old = await replay(db, a.user_id, body.operationId, hash);
      if (old) return wire.decisionSchema.parse(old.response);
      const p = await purchase(db, purchaseId, a.stationId);
      guard(p, body);
      if (outcome === "correct_meter")
        throw new AuthError("meter_policy_unconfigured", 409);
      if (kind === "date" && "verifiedSaleDate" in body) {
        if (!wire.saleDateSchema.safeParse(body.verifiedSaleDate).success)
          throw new AuthError("date_invalid", 422);
        if (body.verifiedSaleDate > stationDate(p.server_received_at))
          throw new AuthError("date_after_receipt", 422);
      }
      return null;
    });
    if (historical) return historical;
    const photo = await transaction(pool, (db) =>
      inspectReviewEvidence(db, storage, purchaseId, body.evidence),
    );
    return transaction(pool, async (db) => {
      const a = await authority(db, token, kind);
      const old = await replay(db, a.user_id, body.operationId, hash);
      if (old) return wire.decisionSchema.parse(old.response);
      const p = await purchase(db, purchaseId, a.stationId);
      guard(p, body);
      let hold:
        | {
            id: string;
            state: string;
            version: number;
            kind: string;
            reason_code: string;
          }
        | undefined;
      if (kind !== "capture") {
        hold = (
          await db.query(
            "SELECT * FROM purchase_hold WHERE id=$1 AND purchase_id=$2 FOR UPDATE",
            [holdId, p.id],
          )
        ).rows[0];
        if (!hold) throw new AuthError("not_found", 404);
        if (hold.kind !== kind) throw new AuthError("hold_kind_mismatch", 422);
        if (hold.state !== "open") throw new AuthError("review_closed", 409);
        if (
          !("expectedHoldVersion" in body) ||
          hold.version !== body.expectedHoldVersion
        )
          throw new AuthError("version_conflict", 409);
      }
      const captureRows = (
        await db.query<{ id: string; code: string; version: number }>(
          "SELECT id,code,version FROM purchase_validation_block WHERE purchase_id=$1 AND resolved_at IS NULL AND code IN ('capture_authorization_unresolved','capture_time_unresolved') ORDER BY code FOR UPDATE",
          [p.id],
        )
      ).rows;
      const captureBlocks = captureRows.map((x) => x.code);
      if (kind === "capture" && !captureBlocks.length)
        throw new AuthError("review_closed", 409);
      if (outcome === "correct_meter")
        throw new AuthError("meter_policy_unconfigured", 409);
      let r = await candidate(db, p);
      const before = r.values,
        did = newId();
      const bound = await db.query(
        "SELECT id FROM photo_asset WHERE id=$1 AND purchase_id=$2 AND state='validated' AND validated_digest=(SELECT expected_photo_digest FROM purchase WHERE id=$2)",
        [body.evidence.assetId, p.id],
      );
      if (!bound.rowCount) throw new AuthError("evidence_unavailable", 422);
      if (!reviewEvidenceV1Installed())
        throw new AuthError("evidence_insufficient", 422);
      const policy = await pinReviewEvidencePolicy(db, a.stationId, env);
      if (kind === "card" && hold!.reason_code !== "replaced_card")
        throw new AuthError("policy_review_required", 422);
      const conclusion = await evaluateEvidenceV1(db, {
        purchaseId: p.id,
        kind,
        outcome,
        evidence: body.evidence,
        decisionId: did,
        policy,
        ...("verifiedSaleDate" in body
          ? { verifiedSaleDate: body.verifiedSaleDate }
          : {}),
      });
      const evaluatedRevisionId = r.id;
      const originalRevision = (
        await db.query<{ id: string }>(
          "SELECT id FROM purchase_revision WHERE purchase_id=$1 AND kind='original'",
          [p.id],
        )
      ).rows[0];
      if (!originalRevision) throw new AuthError("evidence_insufficient", 422);
      await recheckEvidenceSources(
        db,
        p.id,
        conclusion.historyGeneration,
        body.evidence.assetId,
      );
      if (!(await reviewEvidenceApprovalValid(db, policy)))
        throw new AuthError("evidence_insufficient", 422);
      // Re-read live session after slow evidence I/O while security-state lock remains held.
      const live = await requireAdminSession(db, token);
      requirePermission(live, "sales");
      requirePermission(live, permissions[kind]);
      if (outcome === "cancel") {
        if (conclusion.invalidSale !== true)
          throw new AuthError("evidence_insufficient", 422);
        await cancel(
          db,
          p,
          a.user_id,
          a.admin_id,
          did,
          body.reason,
          r,
          body.operationId,
        );
      } else {
        if (kind === "price") {
          if (conclusion.validPrice !== true)
            throw new AuthError("evidence_insufficient", 422);
          const original = (
            await db.query<{ values: wire.SaleValues }>(
              `SELECT ${sql.values("p", true)} values FROM purchase p WHERE id=$1`,
              [p.id],
            )
          ).rows[0]!.values;
          if (
            r.values.amountKobo !== original.amountKobo ||
            parseQuantity(r.values.quantity) !==
              parseQuantity(original.quantity) ||
            r.values.calculation !== "captured_rate"
          )
            throw new AuthError("no_change", 409);
        }
        if (kind === "card") {
          if (hold!.reason_code !== "replaced_card")
            throw new AuthError("policy_review_required", 422);
          if (conclusion.beforeReplacement !== true)
            throw new AuthError("evidence_insufficient", 422);
          const link = await db.query(
            "SELECT l.id FROM card_customer_link l JOIN card c ON c.id=l.card_id WHERE c.id=$1 AND l.customer_id=$2 AND c.state='retired' AND c.replaced_by_card_id IS NOT NULL AND l.ended_at IS NOT NULL AND l.ended_at<=(SELECT server_received_at FROM purchase WHERE id=$3) FOR SHARE OF c,l",
            [p.card_id, p.customer_id, p.id],
          );
          if (!link.rowCount)
            throw new AuthError("policy_review_required", 422);
        }
        if (kind === "date" && "verifiedSaleDate" in body) {
          const date = body.verifiedSaleDate,
            parsed = wire.saleDateSchema.safeParse(date);
          if (!parsed.success) throw new AuthError("date_invalid", 422);
          if (date > stationDate(p.server_received_at))
            throw new AuthError("date_after_receipt", 422);
          if (conclusion.verifiedSaleDate !== date)
            throw new AuthError("evidence_insufficient", 422);
          r = await dateRevision(
            db,
            p,
            r,
            date,
            a.user_id,
            body.operationId,
            hash,
            did,
            body.reason,
          );
        }
        if (kind === "capture") {
          if (
            captureBlocks.includes("capture_authorization_unresolved") &&
            conclusion.authorizedCapture !== true
          )
            throw new AuthError("evidence_insufficient", 422);
          if (
            captureBlocks.includes("capture_time_unresolved") &&
            typeof conclusion.campaignEligible !== "boolean"
          )
            throw new AuthError("evidence_insufficient", 422);
          await db.query(
            "UPDATE purchase_validation_block SET resolved_at=clock_timestamp(),resolution_reference=$2,closure_kind='confirmed',version=version+1 WHERE purchase_id=$1 AND resolved_at IS NULL AND code=ANY($3::text[])",
            [p.id, did, captureBlocks],
          );
        } else {
          const changed = await db.query(
            "UPDATE purchase_hold SET state='resolved',resolved_by=$3,resolution_operation_id=$4,resolution_reason=$5,resolved_at=clock_timestamp(),resolution_revision_id=$6,version=version+1 WHERE id=$1 AND purchase_id=$2 AND state='open' AND version=$7",
            [
              hold!.id,
              p.id,
              a.admin_id,
              body.operationId,
              body.reason,
              r.id,
              hold!.version,
            ],
          );
          if (changed.rowCount !== 1)
            throw new AuthError("version_conflict", 409);
        }
        await accept(db, p, r, a.user_id, body.reason);
      }
      return record(
        db,
        a,
        p,
        before,
        r.values,
        kind,
        outcome,
        body,
        hash,
        did,
        {
          holdId,
          evidence: body.evidence,
          conclusion,
          evaluation: {
            ...conclusion,
            policy,
            evidenceDigest: photo.digest,
            target: {
              decisionId: did,
              purchaseId: p.id,
              originalRevisionId: originalRevision.id,
              evaluatedRevisionId,
              expectedPurchaseVersion: p.version,
              expectedRevisionId: p.current_revision_id,
              kind,
              outcome,
              hold: hold ? { id: hold.id, version: hold.version } : null,
              captureBlocks: kind === "capture" ? captureRows : [],
            },
          },
        },
      );
    });
  }
  return {
    decidePrice: (
      token: string | undefined,
      id: string,
      hold: string,
      input: unknown,
    ) => decide("price", token, id, hold, input),
    decideCard: (
      token: string | undefined,
      id: string,
      hold: string,
      input: unknown,
    ) => decide("card", token, id, hold, input),
    decideDate: (
      token: string | undefined,
      id: string,
      hold: string,
      input: unknown,
    ) => decide("date", token, id, hold, input),
    decideCapture: (token: string | undefined, id: string, input: unknown) =>
      decide("capture", token, id, undefined, input),
    async decideDuplicate(
      token: string | undefined,
      flagId: string,
      input: unknown,
    ) {
      const body = wire.duplicateDecisionSchema.parse(input);
      safeText(body.reason);
      const hash = payloadDigest({ kind: "duplicate", flagId, ...body });
      return transaction(pool, async (db) => {
        const a = await authority(db, token, "duplicate");
        const old = await replay(db, a.user_id, body.operationId, hash);
        if (old) return duplicateResponse.parse(old.replay_response);
        const f = (
          await db.query<{
            id: string;
            purchase_id: string;
            other_purchase_id: string;
            state: string;
            version: number;
            reason: string;
          }>(
            "SELECT f.* FROM duplicate_flag f JOIN purchase p ON p.id=f.purchase_id JOIN purchase q ON q.id=f.other_purchase_id WHERE f.id=$1 AND p.station_id=$2 AND q.station_id=$2",
            [flagId, a.stationId],
          )
        ).rows[0];
        if (!f) throw new AuthError("not_found", 404);
        const ids = [f.purchase_id, f.other_purchase_id];
        if (
          new Set(body.purchases.map((p) => p.id)).size !== 2 ||
          body.purchases.some((p) => !ids.includes(p.id)) ||
          (body.decision.outcome === "cancel" &&
            !ids.includes(body.decision.cancelPurchaseId))
        )
          throw new AuthError("comparison_invalid", 422);
        const ps: Purchase[] = [];
        for (const id of ids.sort())
          ps.push(await purchase(db, id, a.stationId));
        await db.query("SELECT id FROM duplicate_flag WHERE id=$1 FOR UPDATE", [
          f.id,
        ]);
        if (f.state !== "open") throw new AuthError("review_closed", 409);
        if (f.version !== body.expectedFlagVersion)
          throw new AuthError("version_conflict", 409);
        for (const p of ps) {
          if (p.status === "cancelled")
            throw new AuthError("sale_not_cancellable", 409);
          guard(
            p,
            body.purchases.find((g) => g.id === p.id)!,
          );
        }
        const cancelled =
          body.decision.outcome === "cancel"
            ? body.decision.cancelPurchaseId
            : null;
        const primary = ps.find((p) => p.id === cancelled) ?? ps[0]!,
          r = await candidate(db, primary),
          did = newId();
        for (const p of ps) {
          if (p.id === cancelled)
            await cancel(
              db,
              p,
              a.user_id,
              a.admin_id,
              did,
              body.reason,
              r,
              body.operationId,
            );
          else {
            const changed = await db.query(
              "UPDATE purchase SET version=version+1 WHERE id=$1 AND version=$2 AND status=$3",
              [p.id, p.version, p.status],
            );
            if (changed.rowCount !== 1)
              throw new AuthError("version_conflict", 409);
          }
        }
        const changed = await db.query(
          "UPDATE duplicate_flag SET state=$2,resolved_by=$3,resolution_reason=$4,resolved_at=clock_timestamp(),operation_id=$5,cancelled_purchase_id=$6,version=version+1 WHERE id=$1 AND state='open' AND version=$7",
          [
            f.id,
            cancelled ? "cancelled" : "cleared",
            a.admin_id,
            body.reason,
            body.operationId,
            cancelled,
            f.version,
          ],
        );
        if (changed.rowCount !== 1)
          throw new AuthError("version_conflict", 409);
        let result: z.infer<typeof duplicateResponse> | undefined;
        await record(
          db,
          a,
          primary,
          r.values,
          r.values,
          "duplicate",
          body.decision.outcome,
          body,
          hash,
          did,
          {
            flagId,
            replay: async (decision) => {
              const rows = (
                await db.query<{ data: unknown }>(
                  `SELECT ${sql.row(false)} data FROM purchase p ${sql.joins} WHERE p.id=ANY($1::uuid[]) AND p.station_id=$2 ORDER BY p.id`,
                  [ids, a.stationId],
                )
              ).rows.map((x) => wire.saleRowSchema.parse(x.data));
              result = duplicateResponse.parse({
                decision,
                flag: {
                  id: f.id,
                  version: f.version + 1,
                  purchaseIds: ids,
                  state: cancelled ? "cancelled" : "cleared",
                  reason: f.reason,
                  cancelledPurchaseId: cancelled,
                },
                purchases: rows,
              });
              return result;
            },
          },
        );
        return result!;
      });
    },
  };
}
const duplicateResponse = z.strictObject({
  decision: wire.decisionSchema,
  flag: wire.duplicateFlagSchema,
  purchases: z.array(wire.saleRowSchema).length(2),
});
