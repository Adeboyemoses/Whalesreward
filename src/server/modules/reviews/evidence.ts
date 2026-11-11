import type pg from "pg";
import { z } from "zod";
import {
  reviewEvidenceSchema,
  saleDateSchema,
} from "../../../shared/contracts/sales";
import {
  type EvidenceStorage,
  StorageNotFoundError,
  StorageSizeError,
} from "../../adapters/storage";
import { SYNC_LIMITS } from "../../../shared/contracts/sync";
import { validatePhoto } from "../sync/photo";
import { AuthError } from "../auth/errors";

export type ReviewEvidence = z.infer<typeof reviewEvidenceSchema>;
const conclusionSchema = z.strictObject({
  policyVersion: z.string().trim().min(1).max(120),
  referenceIds: z.array(z.uuid()).min(1).max(20),
  validPrice: z.boolean().optional(),
  invalidSale: z.boolean().optional(),
  authorizedCapture: z.boolean().optional(),
  campaignEligible: z.boolean().optional(),
  verifiedSaleDate: saleDateSchema.optional(),
  beforeReplacement: z.boolean().optional(),
});
export type ReviewConclusion = z.infer<typeof conclusionSchema>;
/** Server-only approved policy. Notes and client claims are never proof. */
export interface ReviewEvidencePolicy {
  evaluate(
    db: pg.PoolClient,
    context: {
      purchaseId: string;
      kind: "price" | "card" | "date" | "capture";
      referenceIds: readonly string[];
    },
  ): Promise<ReviewConclusion | null>;
}
export async function inspectReviewEvidence(
  db: pg.PoolClient,
  storage: EvidenceStorage,
  purchaseId: string,
  evidence: ReviewEvidence,
) {
  const asset = (
    await db.query<{
      final_key: string;
      validated_digest: string;
      validated_bytes: string;
    }>(
      `SELECT final_key,validated_digest,validated_bytes FROM photo_asset
      WHERE id=$1 AND purchase_id=$2 AND state='validated' AND validated_digest=(SELECT expected_photo_digest FROM purchase WHERE id=$2)`,
      [evidence.assetId, purchaseId],
    )
  ).rows[0];
  if (!asset) throw new AuthError("evidence_unavailable", 422);
  let bytes: Buffer;
  try {
    bytes = await storage.read(asset.final_key, SYNC_LIMITS.maxBytes);
  } catch (error) {
    if (
      error instanceof StorageNotFoundError ||
      error instanceof StorageSizeError
    )
      throw new AuthError("evidence_unavailable", 422);
    throw new AuthError("temporarily_unavailable", 503);
  }
  try {
    await validatePhoto(
      bytes,
      asset.validated_digest,
      parseInt(asset.validated_bytes, 10),
    );
  } catch {
    throw new AuthError("evidence_unavailable", 422);
  }
  // Only immutable records already bound to this purchase are admissible here.
  for (const id of evidence.referenceIds) {
    const found = await db.query(
      `SELECT id FROM audit_event WHERE id=$1 AND target_id=$2 AND target_type='purchase'
      UNION ALL SELECT id FROM sale_decision WHERE id=$1 AND purchase_id=$2
      UNION ALL SELECT c.id FROM capture_context c JOIN purchase p ON p.capture_context_id=c.id WHERE c.id=$1 AND p.id=$2
      UNION ALL SELECT a.id FROM assignment a JOIN purchase p ON p.assignment_id=a.id WHERE a.id=$1 AND p.id=$2
      UNION ALL SELECT v.id FROM product_price_version v JOIN purchase p ON p.price_version_id=v.id WHERE v.id=$1 AND p.id=$2
      UNION ALL SELECT l.id FROM card_customer_link l JOIN purchase p ON p.card_id=l.card_id AND p.customer_id=l.customer_id WHERE l.id=$1 AND p.id=$2
      UNION ALL SELECT e.id FROM audit_event e JOIN purchase p ON p.card_id=e.target_id WHERE e.id=$1 AND p.id=$2 AND e.target_type='card' `,
      [id, purchaseId],
    );
    if (!found.rowCount) throw new AuthError("evidence_insufficient", 422);
  }
}
export async function evaluateReviewEvidence(
  db: pg.PoolClient,
  policy: ReviewEvidencePolicy | undefined,
  purchaseId: string,
  kind: "price" | "card" | "date" | "capture",
  evidence: ReviewEvidence,
) {
  if (!policy || evidence.referenceIds.length === 0)
    throw new AuthError("evidence_insufficient", 422);
  const evaluated = await policy.evaluate(db, {
    purchaseId,
    kind,
    referenceIds: evidence.referenceIds,
  });
  const parsed = conclusionSchema.safeParse(evaluated);
  const result = parsed.success ? parsed.data : null;
  if (
    !result ||
    !result.policyVersion ||
    result.referenceIds.length === 0 ||
    result.referenceIds.some((id) => !evidence.referenceIds.includes(id))
  )
    throw new AuthError("evidence_insufficient", 422);
  return result;
}
