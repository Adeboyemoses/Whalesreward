import { z } from "zod";
import type pg from "pg";
import {
  correctionSubmissionSchema,
  correctionDecisionSchema,
  attendantCorrectionSchema,
  saleValuesSchema,
  decisionSchema,
  type SaleValues,
} from "../../../shared/contracts/sales";
import {
  amountToQuantity,
  quantityToAmount,
  parseQuantity,
} from "../../../shared/quantity";
import { parseKobo } from "../../../shared/money";
import {
  requireSession,
  requireAdminSession,
  requirePermission,
  securityLock,
} from "../../lib/authz";
import { newId } from "../../lib/ids";
import { AuthError } from "../auth/errors";
import { digest } from "../auth/crypto";
import { auditText } from "../admin-access/privacy";
import { transaction } from "../sync/repo";
import { payloadDigest } from "../sync/canonical";
import type { EvidenceStorage } from "../../adapters/storage";
import { validatePhoto } from "../sync/photo";
import { SYNC_LIMITS } from "../../../shared/contracts/sync";
import {
  CORRECTION_TIME_POLICY,
  correctionTiming,
  reliableCutoff,
} from "./time";

type Purchase = {
  id: string;
  originating_attendant_id: string;
  station_id: string;
  version: number;
  current_revision_id: string | null;
  resolution_candidate_revision_id: string | null;
  status: string;
  basis: "amount" | "quantity";
  correction_time_policy_version: string | null;
  correction_cutoff_at: Date | null;
  expected_photo_digest: string;
  customer_id: string | null;
  card_id: string | null;
};
type Revision = {
  id: string;
  amount_kobo: string;
  quantity: string;
  currency: "NGN";
  unit: "litre" | "kilogram";
  basis: "amount" | "quantity";
  entered_amount_kobo: string | null;
  entered_quantity: string | null;
  rate_kobo: string;
  price_version_id: string;
  quantity_precision: number;
  medium: SaleValues["medium"];
  calculation_mode: SaleValues["calculation"];
  verified_sale_date: Date | null;
  evidence_asset_id: string | null;
};
type Correction = {
  id: string;
  purchase_id: string;
  originating_attendant_id: string;
  operation_id: string;
  payload_digest: string;
  based_on_revision_id: string;
  proposed_revision_id: string;
  first_received_at: Date;
  cutoff_at_receipt: Date | null;
  timing: "before_midnight" | "late" | "unresolved";
  state: "pending_validation" | "awaiting_review" | "accepted" | "rejected";
  reason: string;
  version: number;
  authorship: "authenticated_attendant" | "unverified_recovery";
  policy_blocks: string[];
  decided_at: Date | null;
  authority_session_id: string;
  reserved_purchase_version: number;
  attempts: number;
  lease_token: string | null;
  lease_until: Date | null;
  recovery_executor_id: string | null;
  recovery_authorizing_admin_id: string | null;
  submitted_by_user_id: string;
  receipt: unknown;
};
export function revisionValues(r: Revision): SaleValues {
  return saleValuesSchema.parse({
    amountKobo: r.amount_kobo,
    quantity: r.quantity,
    currency: r.currency,
    unit: r.unit,
    basis: r.basis,
    enteredAmountKobo: r.entered_amount_kobo,
    enteredQuantity: r.entered_quantity,
    rateKobo: r.rate_kobo,
    priceVersionId: r.price_version_id,
    quantityPrecision: r.quantity_precision,
    medium: r.medium,
    calculation: r.calculation_mode,
    verifiedSaleDate: r.verified_sale_date?.toISOString().slice(0, 10) ?? null,
  });
}
async function revision(db: pg.PoolClient, purchaseId: string, id: string) {
  const r = (
    await db.query<Revision>(
      "SELECT * FROM purchase_revision WHERE purchase_id=$1 AND id=$2",
      [purchaseId, id],
    )
  ).rows[0];
  if (!r) throw new AuthError("not_found", 404);
  return r;
}
async function purchase(db: pg.PoolClient, id: string, attendantId?: string) {
  const p = (
    await db.query<Purchase>(
      `SELECT * FROM purchase WHERE id=$1 ${attendantId ? "AND originating_attendant_id=$2" : ""} FOR UPDATE`,
      attendantId ? [id, attendantId] : [id],
    )
  ).rows[0];
  if (!p) throw new AuthError("not_found", 404);
  return p;
}
async function ownAuthority(db: pg.PoolClient, verifier: string, write = true) {
  await securityLock(db);
  const s = await requireSession(db, verifier);
  const a = (
    await db.query<{ id: string; expired: boolean }>(
      "SELECT a.id,c.offline_expires_at<=clock_timestamp() AS expired FROM attendant a JOIN capture_context c ON c.id=$2 AND c.attendant_id=a.id WHERE a.user_id=$1",
      [s.user_id, s.capture_context_id],
    )
  ).rows[0];
  if (!a) throw new AuthError("unauthenticated", 401);
  if (write && a.expired) throw new AuthError("online_sign_in_required", 403);
  return { ...s, attendantId: a.id };
}
async function correction(db: pg.PoolClient, purchaseId: string, id: string) {
  const c = (
    await db.query<Correction>(
      "SELECT * FROM correction_request WHERE purchase_id=$1 AND id=$2 FOR UPDATE",
      [purchaseId, id],
    )
  ).rows[0];
  if (!c) throw new AuthError("not_found", 404);
  return c;
}
async function view(db: pg.PoolClient, c: Correction) {
  return attendantCorrectionSchema.parse({
    id: c.id,
    purchaseId: c.purchase_id,
    operationId: c.operation_id,
    version: c.version,
    basedOnRevisionId: c.based_on_revision_id,
    proposed: revisionValues(
      await revision(db, c.purchase_id, c.proposed_revision_id),
    ),
    reason: c.reason,
    serverReceivedAt: c.first_received_at.toISOString(),
    cutoffAtReceipt: c.cutoff_at_receipt?.toISOString() ?? null,
    timing: c.timing,
    state: c.state,
    decidedAt: c.decided_at?.toISOString() ?? null,
    authorship: c.authorship,
    policyBlocks: c.policy_blocks,
  });
}
function privateAuditText(value: string) {
  return auditText(value)
    .replace(
      /\b(?:otp|password|token|secret)\s*(?:[:=]\s*|\s+)\S+/gi,
      "[secret removed]",
    )
    .replace(
      /\b(?:verification code|one[- ]time code|code)\s*(?::|=|is)?\s*\d{4,8}\b/gi,
      "[secret removed]",
    )
    .replace(/(?:\+234|0)[789][01][\d*•xX ()-]{7,}/g, "[phone removed]");
}
function safeReason(reason: string) {
  if (
    privateAuditText(reason) !== reason ||
    /\b(?:otp|code|password|token|secret)\s*[:=]/i.test(reason)
  )
    throw new AuthError("invalid_request", 400);
}
async function evidence(db: pg.PoolClient, p: Purchase, assetId: string) {
  const a = (
    await db.query<{
      id: string;
      final_key: string;
      validated_digest: string;
      validated_bytes: string;
    }>(
      "SELECT id,final_key,validated_digest,validated_bytes FROM photo_asset WHERE purchase_id=$1 AND id=$2 AND state='validated' AND validated_digest=$3",
      [p.id, assetId, p.expected_photo_digest],
    )
  ).rows[0];
  if (!a) throw new AuthError("evidence_unavailable", 422);
  return a;
}
async function inspect(
  storage: EvidenceStorage,
  a: { final_key: string; validated_digest: string; validated_bytes: string },
) {
  let bytes: Buffer;
  try {
    bytes = await storage.read(a.final_key, SYNC_LIMITS.maxBytes);
  } catch {
    throw new AuthError("evidence_unavailable", 422);
  }
  try {
    await validatePhoto(
      bytes,
      a.validated_digest,
      parseInt(a.validated_bytes, 10),
    );
  } catch {
    throw new AuthError("evidence_unavailable", 422);
  }
}
async function markCampaigns(db: pg.PoolClient, purchaseId: string) {
  await db.query(
    `UPDATE campaign SET reconciliation_required=true,version=version+1 WHERE id IN (SELECT DISTINCT s.campaign_id FROM giveaway_snapshot s JOIN giveaway_snapshot_source x ON x.snapshot_id=s.id WHERE x.purchase_id=$1)`,
    [purchaseId],
  );
}
/** Existing original validation is immutable. Corrections never rerun settle or clear its gates. */
async function apply(
  db: pg.PoolClient,
  p: Purchase,
  c: Correction,
  actor: string,
  reason: string,
) {
  const r = await revision(db, p.id, c.proposed_revision_id);
  await evidence(db, p, r.evidence_asset_id!);
  const gate = (
    await db.query<{ blocked: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM purchase_hold WHERE purchase_id=$1 AND state='open') OR EXISTS(SELECT 1 FROM purchase_validation_block WHERE purchase_id=$1 AND resolved_at IS NULL) OR NOT EXISTS(SELECT 1 FROM sync_validation WHERE purchase_id=$1) OR EXISTS(
 SELECT 1 FROM sync_validation v CROSS JOIN LATERAL jsonb_array_elements_text(v.reasons) AS reason(code)
 WHERE v.purchase_id=$1 AND NOT (
 (reason.code IN ('price_uncertain','replaced_card') AND EXISTS(SELECT 1 FROM purchase_hold h WHERE h.purchase_id=$1 AND h.state='resolved' AND h.kind=CASE WHEN reason.code='price_uncertain' THEN 'price' ELSE 'card' END AND h.reason_code=reason.code))
 OR (reason.code IN ('capture_authorization_unresolved','capture_time_unresolved') AND EXISTS(SELECT 1 FROM purchase_validation_block b WHERE b.purchase_id=$1 AND b.code=reason.code AND b.resolved_at IS NOT NULL AND b.resolution_reference IS NOT NULL))
 )) AS blocked`,
      [p.id],
    )
  ).rows[0]!;
  // Numeric approval can stage a resolution while unrelated holds remain; it never grants credit.
  if (p.current_revision_id) {
    await db.query(
      "UPDATE purchase_revision SET state='superseded',version=version+1 WHERE id=$1 AND purchase_id=$2 AND state='accepted'",
      [p.current_revision_id, p.id],
    );
  }
  await db.query(
    "UPDATE purchase_revision SET state='accepted',version=version+1,decision_actor_id=$3,decision_reason=$4,decided_at=clock_timestamp() WHERE id=$1 AND purchase_id=$2 AND state='proposed'",
    [r.id, p.id, actor, reason],
  );
  await db.query(
    `UPDATE purchase SET current_revision_id=$2,resolution_candidate_revision_id=NULL,status=CASE WHEN $4 THEN 'held' ELSE status END,version=version+1 WHERE id=$1 AND version=$3`,
    [p.id, r.id, p.version, gate.blocked],
  );
  await markCampaigns(db, p.id);
}
const auditHumanSchema = z.strictObject({
  kind: z.enum(["admin", "attendant"]),
  userId: z.uuid(),
  code: z.string().max(120),
  nameAtEvent: z.string().max(120),
  usernameAtEvent: z.string().max(120),
  roleAtEvent: z.string().max(120).nullable(),
});
const auditSellerSchema = z.strictObject({
  attendantId: z.uuid(),
  accountId: z.uuid(),
  staffCode: z.string().max(120),
  name: z.string().max(120),
  username: z.string().max(120),
});
const auditValuesSchema = z.strictObject({
  amountKobo: z.string().regex(/^[1-9][0-9]*$/),
  quantity: z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/),
  currency: z.literal("NGN"),
  unit: z.enum(["litre", "kilogram"]),
  basis: z.enum(["amount", "quantity"]),
  medium: z.enum(["vehicle", "keg", "three_wheeler", "bike", "cylinder"]),
  rateKobo: z.string().regex(/^[1-9][0-9]*$/),
  priceVersionId: z.uuid(),
  revisionId: z.uuid().nullable(),
  credited: z.boolean(),
  correctionState: z
    .enum(["pending_validation", "awaiting_review", "accepted", "rejected"])
    .nullable(),
});
function snapshotText(value: string) {
  return privateAuditText(value).slice(0, 120);
}
/** Material effective fields only. A received proposal does not yet change credited values. */
async function auditEffective(
  db: pg.PoolClient,
  p: Purchase,
  state: Correction["state"] | null,
) {
  const r = await revision(db, p.id, p.current_revision_id!);
  const values = revisionValues(r);
  return auditValuesSchema.parse({
    amountKobo: values.amountKobo,
    quantity: values.quantity,
    currency: values.currency,
    unit: values.unit,
    basis: values.basis,
    medium: values.medium,
    rateKobo: values.rateKobo,
    priceVersionId: values.priceVersionId,
    revisionId: p.current_revision_id,
    credited: p.status === "credited",
    correctionState: state,
  });
}
async function correctionAudit(
  db: pg.PoolClient,
  p: Purchase,
  c: Correction,
  actor: string | null,
  action:
    | "correction_received"
    | "correction_applied"
    | "correction_approved"
    | "correction_rejected",
  operationId: string,
  reason: string,
  beforeState: Correction["state"] | null,
) {
  safeReason(reason);
  const current = await purchase(db, p.id);
  const before = await auditEffective(db, p, beforeState),
    after = await auditEffective(db, current, c.state);
  let actorSnapshot:
    | z.infer<typeof auditHumanSchema>
    | { kind: "system"; service: "validation"; nameAtEvent: string };
  if (actor) {
    const user = (
      await db.query<{
        kind: "admin" | "attendant";
        user_id: string;
        code: string;
        display_name: string;
        username: string;
        role_name: string | null;
      }>(
        `SELECT u.kind,u.id AS user_id,coalesce(a.admin_code,t.staff_code) AS code,u.display_name,u.username,r.name AS role_name FROM auth_user u LEFT JOIN admin a ON a.user_id=u.id LEFT JOIN role r ON r.id=a.role_id LEFT JOIN attendant t ON t.user_id=u.id WHERE u.id=$1`,
        [actor],
      )
    ).rows[0];
    if (!user) throw new AuthError("temporarily_unavailable", 503);
    actorSnapshot = auditHumanSchema.parse({
      kind: user.kind,
      userId: user.user_id,
      code: snapshotText(user.code),
      nameAtEvent: snapshotText(user.display_name),
      usernameAtEvent: snapshotText(user.username),
      roleAtEvent:
        user.role_name === null ? null : snapshotText(user.role_name),
    });
  } else
    actorSnapshot = {
      kind: "system",
      service: "validation",
      nameAtEvent: "Correction validation",
    };
  const seller = (
    await db.query<{
      attendant_id: string;
      account_id: string;
      staff_code: string;
      seller_name: string;
      seller_username: string;
    }>(
      `SELECT a.id AS attendant_id,a.user_id AS account_id,a.staff_code,p.seller_name,p.seller_username FROM purchase p JOIN attendant a ON a.id=p.originating_attendant_id WHERE p.id=$1`,
      [p.id],
    )
  ).rows[0]!;
  const sellerSnapshot = auditSellerSchema.parse({
    attendantId: seller.attendant_id,
    accountId: seller.account_id,
    staffCode: snapshotText(seller.staff_code),
    name: snapshotText(seller.seller_name),
    username: snapshotText(seller.seller_username),
  });
  const id = newId();
  await db.query(
    `INSERT INTO audit_event(id,actor_user_id,actor_kind,action,target_type,target_id,operation_id,before,after,reason,occurred_at,actor_snapshot,originating_seller_snapshot) VALUES($1,$2,$3,$4,'purchase',$5,$6,$7,$8,$9,clock_timestamp(),$10,$11)`,
    [
      id,
      actor,
      actor ? "user" : "system",
      action,
      p.id,
      operationId,
      JSON.stringify(before),
      JSON.stringify(after),
      reason,
      JSON.stringify(actorSnapshot),
      JSON.stringify(sellerSnapshot),
    ],
  );
  return id;
}
export function createCorrectionsService({
  pool,
  storage,
}: {
  pool: pg.Pool;
  storage: EvidenceStorage;
}) {
  return {
    async submit(
      token: string | undefined,
      purchaseId: string,
      input: unknown,
    ) {
      const body = correctionSubmissionSchema.parse(input);
      safeReason(body.reason);
      return transaction(pool, async (db) => {
        const auth = await ownAuthority(db, digest(token ?? ""));
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `correction:${auth.attendantId}:${body.operationId}`,
        ]);
        const old = (
          await db.query<Correction>(
            "SELECT * FROM correction_request WHERE originating_attendant_id=$1 AND operation_id=$2",
            [auth.attendantId, body.operationId],
          )
        ).rows[0];
        const source = (
          await db.query<{
            id: string;
            operation_id: string;
            expected_photo_digest: string;
          }>(
            "SELECT id,operation_id,expected_photo_digest FROM purchase WHERE id=$1 AND originating_attendant_id=$2",
            [old?.purchase_id ?? purchaseId, auth.attendantId],
          )
        ).rows[0];
        if (!source) throw new AuthError("not_found", 404);
        const frozenBase = await revision(
          db,
          source.id,
          old?.based_on_revision_id ?? body.basedOnRevisionId,
        );
        const hash = payloadDigest({
          kind: "correction_submit",
          originatingAttendantId: auth.attendantId,
          purchaseId,
          originalOperationId: source.operation_id,
          baseValuesDigest: payloadDigest(revisionValues(frozenBase)),
          evidenceDigest: source.expected_photo_digest,
          ...body,
        });
        if (old) {
          if (old.payload_digest !== hash)
            throw new AuthError("operation_conflict", 409);
          return {
            data: attendantCorrectionSchema.parse(old.receipt),
            replayed: true,
          };
        }
        const p = await purchase(db, purchaseId, auth.attendantId);
        if (p.status === "cancelled" || !p.current_revision_id)
          throw new AuthError("sale_not_correctable", 409);
        if (
          p.version !== body.expectedVersion ||
          p.current_revision_id !== body.basedOnRevisionId
        )
          throw new AuthError("version_conflict", 409);
        if (
          p.resolution_candidate_revision_id &&
          p.resolution_candidate_revision_id !== p.current_revision_id
        )
          throw new AuthError("base_revision_changed", 409);
        if (
          (
            await db.query(
              "SELECT 1 FROM correction_request WHERE purchase_id=$1 AND state IN ('pending_validation','awaiting_review')",
              [p.id],
            )
          ).rowCount
        )
          throw new AuthError("correction_pending", 409);
        const base = await revision(db, p.id, body.basedOnRevisionId);
        if (base.calculation_mode !== "captured_rate")
          throw new AuthError("sale_not_correctable", 409);
        if (body.edit.basis !== p.basis)
          throw new AuthError("invalid_request", 400);
        if (body.evidenceAssetId !== base.evidence_asset_id)
          throw new AuthError("evidence_unavailable", 422);
        await evidence(db, p, body.evidenceAssetId);
        const values = revisionValues(base);
        let amount: string, quantity: string;
        try {
          if (body.edit.basis === "amount") {
            amount = parseKobo(body.edit.enteredAmountKobo).toString();
            quantity = amountToQuantity(
              BigInt(amount),
              BigInt(base.rate_kobo),
              base.quantity_precision,
            );
          } else {
            parseQuantity(body.edit.enteredQuantity, base.quantity_precision);
            quantity = body.edit.enteredQuantity;
            amount = quantityToAmount(
              quantity,
              BigInt(base.rate_kobo),
              base.quantity_precision,
            ).toString();
          }
        } catch {
          throw new AuthError("calculation_invalid", 422);
        }
        const proposed = saleValuesSchema.parse({
          ...values,
          amountKobo: amount,
          quantity,
          basis: body.edit.basis,
          enteredAmountKobo: body.edit.basis === "amount" ? amount : null,
          enteredQuantity: body.edit.basis === "quantity" ? quantity : null,
        });
        if (
          proposed.amountKobo === values.amountKobo &&
          proposed.quantity === values.quantity
        )
          throw new AuthError("no_change", 409);
        const ctx = (
          await db.query<{
            signed_in_at: Date;
            offline_expires_at: Date;
            server_received_at: Date;
          }>(
            "SELECT c.signed_in_at,c.offline_expires_at,p.server_received_at FROM purchase p JOIN capture_context c ON c.id=p.capture_context_id WHERE p.id=$1",
            [p.id],
          )
        ).rows[0]!;
        const cutoff = p.correction_time_policy_version
          ? p.correction_cutoff_at
          : reliableCutoff(
              ctx.signed_in_at,
              ctx.server_received_at,
              ctx.offline_expires_at,
            );
        const now = (
          await db.query<{ now: Date }>("SELECT clock_timestamp() AS now")
        ).rows[0]!.now;
        const id = newId(),
          rid = newId();
        const receipt = attendantCorrectionSchema.parse({
          id,
          purchaseId: p.id,
          operationId: body.operationId,
          version: 1,
          basedOnRevisionId: base.id,
          proposed,
          reason: body.reason,
          serverReceivedAt: now.toISOString(),
          cutoffAtReceipt: cutoff?.toISOString() ?? null,
          timing: correctionTiming(cutoff, now),
          state: "pending_validation",
          decidedAt: null,
          authorship: "authenticated_attendant",
          policyBlocks: [],
        });
        const durable = (
          await db.query<Correction>(
            `INSERT INTO correction_request(id,purchase_id,originating_attendant_id,operation_id,payload_digest,frozen_request_digest,based_on_revision_id,expected_purchase_version,proposed_revision_id,first_received_at,cutoff_at_receipt,time_policy_version,timing,state,reason,submitted_by_user_id,verified_author_attendant_id,authorship,authority_session_id,reserved_purchase_version,receipt) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,clock_timestamp(),$9,$10,$11,'pending_validation',$12,$13,$3,'authenticated_attendant',$14,$15,$16) RETURNING *`,
            [
              id,
              p.id,
              auth.attendantId,
              body.operationId,
              hash,
              base.id,
              p.version,
              rid,

              cutoff,
              p.correction_time_policy_version ?? CORRECTION_TIME_POLICY,
              receipt.timing,
              body.reason,
              auth.user_id,
              auth.id,
              p.version + 1,
              JSON.stringify(receipt),
            ],
          )
        ).rows[0]!;
        await db.query(
          `INSERT INTO purchase_revision(id,purchase_id,revision_number,operation_id,actor_user_id,payload_digest,based_on_revision_id,kind,state,reason,server_received_at,amount_kobo,quantity,currency,unit,quantity_precision,basis,entered_amount_kobo,entered_quantity,rate_kobo,price_version_id,medium,verified_sale_date,evidence_asset_id,correction_id) SELECT $1,$2,coalesce(max(revision_number),0)+1,$3,$4,$5,$6,'attendant_correction','proposed',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22 FROM purchase_revision WHERE purchase_id=$2`,
          [
            rid,
            p.id,
            body.operationId,
            auth.user_id,
            hash,
            base.id,
            body.reason,
            durable.first_received_at,
            amount,
            quantity,
            base.currency,
            base.unit,
            base.quantity_precision,
            proposed.basis,
            proposed.enteredAmountKobo,
            proposed.enteredQuantity,
            base.rate_kobo,
            base.price_version_id,
            base.medium,
            base.verified_sale_date,
            body.evidenceAssetId,
            id,
          ],
        );
        await db.query(
          "UPDATE purchase SET version=version+1,correction_cutoff_at=$3,correction_time_policy_version=$4,correction_date_reliable=$5 WHERE id=$1 AND version=$2",
          [
            p.id,
            p.version,
            cutoff,
            p.correction_time_policy_version ?? CORRECTION_TIME_POLICY,
            cutoff !== null,
          ],
        );
        await correctionAudit(
          db,
          p,
          await correction(db, p.id, id),
          auth.user_id,
          "correction_received",
          body.operationId,
          body.reason,
          null,
        );
        return {
          data: attendantCorrectionSchema.parse(durable.receipt),
          replayed: false,
        };
      });
    },
    async byOperation(
      token: string | undefined,
      purchaseId: string,
      operationId: string,
    ) {
      return transaction(pool, async (db) => {
        const auth = await ownAuthority(db, digest(token ?? ""), false);
        const c = (
          await db.query<Correction>(
            "SELECT * FROM correction_request WHERE purchase_id=$1 AND operation_id=$2 AND originating_attendant_id=$3 AND authorship='authenticated_attendant'",
            [purchaseId, operationId, auth.attendantId],
          )
        ).rows[0];
        if (!c) throw new AuthError("not_found", 404);
        return view(db, c);
      });
    },
    async processNext() {
      const claimed = await transaction(pool, async (db) => {
        const c = (
          await db.query<Correction>(
            `SELECT * FROM correction_request WHERE state='pending_validation' AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<=clock_timestamp()) ORDER BY first_received_at,id FOR UPDATE SKIP LOCKED LIMIT 1`,
          )
        ).rows[0];
        if (!c) return null;
        const nonce = newId();
        await db.query(
          "UPDATE correction_request SET lease_token=$2,lease_until=clock_timestamp()+interval '45 seconds',attempts=least(attempts+1,5) WHERE id=$1",
          [c.id, nonce],
        );
        return {
          ...c,
          lease_token: nonce,
          attempts: Math.min(c.attempts + 1, 5),
          exhausted: c.attempts >= 5,
        };
      });
      if (!claimed) return false;
      let failure: string | null = claimed.exhausted
        ? "validation_exhausted"
        : null;
      try {
        if (claimed.exhausted) throw new AuthError("validation_exhausted", 422);
        const a = await transaction(pool, async (db) => {
          const p = await purchase(db, claimed.purchase_id);
          return evidence(
            db,
            p,
            (await revision(db, p.id, claimed.proposed_revision_id))
              .evidence_asset_id!,
          );
        });
        await inspect(storage, a);
      } catch {
        failure = claimed.exhausted
          ? "validation_exhausted"
          : "evidence_unavailable";
      }
      return transaction(pool, async (db) => {
        await securityLock(db);
        let authorityLost = false;
        // Persisted verifier is opaque authentication material, never a renewed session or token.
        const session = (
          await db.query<{ secret_verifier: string }>(
            "SELECT secret_verifier FROM auth_session WHERE id=$1",
            [claimed.authority_session_id],
          )
        ).rows[0];
        try {
          if (!session) throw new Error();
          if (claimed.authorship === "unverified_recovery")
            failure = "recovery_validation_unavailable";
          else await ownAuthority(db, session.secret_verifier);
        } catch {
          authorityLost = true;
        }
        const p = await purchase(db, claimed.purchase_id),
          c = await correction(db, p.id, claimed.id);
        if (
          c.state !== "pending_validation" ||
          c.lease_token !== claimed.lease_token ||
          !c.lease_until ||
          c.lease_until.getTime() <= Date.now()
        )
          return true;
        if (authorityLost) failure = "authority_lost";
        if (p.status === "cancelled") failure = "sale_cancelled";
        if (
          p.version !== c.reserved_purchase_version ||
          p.current_revision_id !== c.based_on_revision_id ||
          p.resolution_candidate_revision_id
        )
          failure = "base_revision_changed";
        if (failure === "evidence_unavailable" && claimed.attempts < 5) {
          await db.query(
            "UPDATE correction_request SET lease_token=NULL,lease_until=NULL,next_attempt_at=clock_timestamp()+interval '5 seconds',validation_error=$2 WHERE id=$1 AND lease_token=$3",
            [c.id, failure, c.lease_token],
          );
          return true;
        }
        const state = failure
          ? "rejected"
          : c.timing === "before_midnight" &&
              c.authorship === "authenticated_attendant"
            ? "accepted"
            : "awaiting_review";
        if (state === "accepted")
          await apply(
            db,
            p,
            c,
            c.submitted_by_user_id,
            "Validated before-midnight correction",
          );
        else
          await db.query(
            "UPDATE purchase SET version=version+1 WHERE id=$1 AND version=$2",
            [p.id, p.version],
          );
        await db.query(
          `UPDATE correction_request SET state=$2,version=version+1,lease_token=NULL,lease_until=NULL,validation_error=$3,decided_at=CASE WHEN $2 IN ('accepted','rejected') THEN clock_timestamp() ELSE NULL END,decision_reason=$3 WHERE id=$1 AND state='pending_validation' AND lease_token=$4`,
          [c.id, state, failure, c.lease_token],
        );
        if (state === "accepted" || state === "rejected")
          await correctionAudit(
            db,
            p,
            { ...c, state },
            null,
            state === "accepted" ? "correction_applied" : "correction_rejected",
            c.operation_id,
            state === "rejected"
              ? `Correction validation rejected: ${failure}`
              : c.reason,
            c.state,
          );
        return true;
      });
    },
    async decide(
      token: string | undefined,
      purchaseId: string,
      correctionId: string,
      input: unknown,
    ) {
      const body = correctionDecisionSchema.parse(input);
      safeReason(body.reason);
      const prepare = () =>
        transaction(pool, async (db) => {
          await securityLock(db);
          const a = await requireAdminSession(db, token);
          requirePermission(a, "sales");
          requirePermission(a, "corrections");
          const p = await purchase(db, purchaseId),
            c = await correction(db, p.id, correctionId);
          if (
            c.authorship === "unverified_recovery" &&
            (a.admin_id === c.recovery_executor_id ||
              a.admin_id === c.recovery_authorizing_admin_id)
          )
            throw new AuthError("permission_denied", 403);
          const hash = payloadDigest({
            kind: "correction_decision",
            purchaseId,
            correctionId,
            ...body,
          });
          const old = (
            await db.query<{ payload_digest: string; response: unknown }>(
              "SELECT payload_digest,response FROM sale_decision WHERE actor_user_id=$1 AND operation_id=$2",
              [a.user_id, body.operationId],
            )
          ).rows[0];
          if (old) {
            if (old.payload_digest !== hash)
              throw new AuthError("operation_conflict", 409);
            return { old: decisionSchema.parse(old.response), a, p, c, hash };
          }
          if (p.status === "cancelled")
            throw new AuthError("sale_not_correctable", 409);
          if (c.state !== "awaiting_review")
            throw new AuthError("review_closed", 409);
          if (
            p.version !== body.expectedVersion ||
            p.current_revision_id !== body.expectedRevisionId ||
            c.version !== body.expectedCorrectionVersion
          )
            throw new AuthError("version_conflict", 409);
          if (
            body.outcome === "approve" &&
            (p.current_revision_id !== c.based_on_revision_id ||
              p.resolution_candidate_revision_id)
          )
            throw new AuthError("base_revision_changed", 409);
          const r = await revision(db, p.id, c.proposed_revision_id);
          const asset = await evidence(db, p, r.evidence_asset_id!);
          return { a, p, c, r, asset, hash };
        });
      const prep = await prepare();
      if (prep.old) return prep.old;
      await inspect(storage, prep.asset!);
      return transaction(pool, async (db) => {
        await securityLock(db);
        const a = await requireAdminSession(db, token);
        requirePermission(a, "sales");
        requirePermission(a, "corrections");
        const p = await purchase(db, purchaseId),
          c = await correction(db, p.id, correctionId);
        if (
          c.authorship === "unverified_recovery" &&
          (a.admin_id === c.recovery_executor_id ||
            a.admin_id === c.recovery_authorizing_admin_id)
        )
          throw new AuthError("permission_denied", 403);
        const old = (
          await db.query<{ payload_digest: string; response: unknown }>(
            "SELECT payload_digest,response FROM sale_decision WHERE actor_user_id=$1 AND operation_id=$2",
            [a.user_id, body.operationId],
          )
        ).rows[0];
        if (old) {
          if (old.payload_digest !== prep.hash)
            throw new AuthError("operation_conflict", 409);
          return decisionSchema.parse(old.response);
        }
        if (c.state !== "awaiting_review")
          throw new AuthError("review_closed", 409);
        if (p.status === "cancelled")
          throw new AuthError("sale_not_correctable", 409);
        if (
          p.version !== body.expectedVersion ||
          c.version !== body.expectedCorrectionVersion ||
          p.current_revision_id !== body.expectedRevisionId
        )
          throw new AuthError("version_conflict", 409);
        if (
          body.outcome === "approve" &&
          (p.current_revision_id !== c.based_on_revision_id ||
            p.resolution_candidate_revision_id)
        )
          throw new AuthError("base_revision_changed", 409);
        await evidence(db, p, prep.r!.evidence_asset_id!);
        const before = revisionValues(
          await revision(db, p.id, p.current_revision_id!),
        );
        const approved = body.outcome === "approve";
        if (
          approved &&
          c.policy_blocks.some((b) => b !== "correction_authorship_unverified")
        )
          throw new AuthError("policy_review_required", 422);
        if (approved) await apply(db, p, c, a.user_id, body.reason);
        else {
          await db.query(
            "UPDATE purchase_revision SET state='rejected',version=version+1,decision_actor_id=$3,decision_reason=$4,decided_at=clock_timestamp() WHERE id=$1 AND purchase_id=$2 AND state='proposed'",
            [c.proposed_revision_id, p.id, a.user_id, body.reason],
          );
          await db.query(
            "UPDATE purchase SET version=version+1 WHERE id=$1 AND version=$2",
            [p.id, p.version],
          );
        }
        const did = newId(),
          now = (
            await db.query<{ now: Date }>("SELECT clock_timestamp() AS now")
          ).rows[0]!.now;
        await db.query(
          "UPDATE correction_request SET state=$2,version=version+1,decision_id=$3,policy_blocks=array_remove(policy_blocks,'correction_authorship_unverified'),decided_by_user_id=$4,decided_at=$5,decision_reason=$6 WHERE id=$1 AND state='awaiting_review' AND version=$7",
          [
            c.id,
            approved ? "accepted" : "rejected",
            did,
            a.user_id,
            now,
            body.reason,
            c.version,
          ],
        );
        const auditId = await correctionAudit(
          db,
          p,
          { ...c, state: approved ? "accepted" : "rejected" },
          a.user_id,
          approved ? "correction_approved" : "correction_rejected",
          body.operationId,
          body.reason,
          c.state,
        );
        const current = await purchase(db, p.id);
        const holds = (
          await db.query(
            'SELECT id,kind,version,state,reason_code AS "reasonCode",opened_revision_id AS "openedRevisionId" FROM purchase_hold WHERE purchase_id=$1 AND state=\'open\' ORDER BY kind',
            [p.id],
          )
        ).rows.map((h) => ({
          ...h,
          resolvedBy: null,
          resolvedAt: null,
          resolutionReason: null,
          resolutionId: null,
        }));
        const user = (
          await db.query<{ code: string; name: string }>(
            "SELECT a.admin_code AS code,u.display_name AS name FROM admin a JOIN auth_user u ON u.id=a.user_id WHERE a.id=$1",
            [a.admin_id],
          )
        ).rows[0]!;
        const blocks = (
          await db.query<{ code: string }>(
            "SELECT code FROM purchase_validation_block WHERE purchase_id=$1 AND resolved_at IS NULL ORDER BY code",
            [p.id],
          )
        ).rows.map((b) => b.code);
        const response = decisionSchema.parse({
          id: did,
          operationId: body.operationId,
          purchaseId: p.id,
          kind: "correction",
          outcome: body.outcome,
          actor: { id: a.admin_id, ...user },
          reason: body.reason,
          decidedAt: now.toISOString(),
          auditEventId: auditId,
          appliedPurchaseVersion: current.version,
          appliedRevisionId: current.current_revision_id,
          before,
          after: approved ? revisionValues(prep.r!) : before,
          creditedAfter:
            current.status === "credited" &&
            holds.length === 0 &&
            blocks.length === 0,
          remainingHolds: holds,
          policyBlocks: blocks,
        });
        await db.query(
          `INSERT INTO sale_decision(id,purchase_id,operation_id,actor_user_id,payload_digest,kind,outcome,correction_id,expected_purchase_version,expected_revision_id,result_revision_id,applied_purchase_version,before_values,after_values,evidence_asset_id,reason,decided_at,audit_event_id,response) VALUES($1,$2,$3,$4,$5,'correction',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [
            did,
            p.id,
            body.operationId,
            a.user_id,
            prep.hash,
            body.outcome,
            c.id,
            body.expectedVersion,
            body.expectedRevisionId,
            current.current_revision_id,
            current.version,
            JSON.stringify(before),
            JSON.stringify(response.after),
            prep.r!.evidence_asset_id,
            body.reason,
            now,
            auditId,
            JSON.stringify(response),
          ],
        );
        return response;
      });
    },
  };
}
