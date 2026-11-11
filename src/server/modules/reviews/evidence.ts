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
  return { assetId: evidence.assetId, digest: asset.validated_digest };
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
