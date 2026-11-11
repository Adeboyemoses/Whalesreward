import { createHash } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { AuthError } from "../auth/errors";
import { reviewEvidenceReleaseArtifact } from "./release";

export const reviewEvidenceReleaseDigest = createHash("sha256")
  .update(reviewEvidenceReleaseArtifact, "utf8")
  .digest("hex");
export const reviewEvidencePolicySchema = z.strictObject({
  release: z.literal("review-evidence-v1"),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  scope: z.strictObject({
    stationId: z.uuid(),
    environment: z.enum(["development", "test", "staging", "production"]),
  }),
  activation: z.discriminatedUnion("state", [
    z.strictObject({
      state: z.literal("inactive"),
      approvalReference: z.null(),
      activatedAt: z.null(),
    }),
    z.strictObject({
      state: z.literal("active"),
      approvalReference: z.uuid(),
      activatedAt: z.iso.datetime({ offset: true }),
    }),
  ]),
});
export type ReviewEvidenceConfiguration = z.infer<
  typeof reviewEvidencePolicySchema
>;
export type ReviewEnvironment = Readonly<Record<string, string | undefined>>;
export function reviewEnvironment(env: ReviewEnvironment) {
  if (env.WHR_ENV === "local") return "development";
  if (env.WHR_ENV) return env.WHR_ENV;
  return env.NODE_ENV ?? "development";
}
export function reviewEvidenceConfiguration(
  env: ReviewEnvironment,
): ReviewEvidenceConfiguration | null {
  try {
    const parsed = reviewEvidencePolicySchema.parse(
      JSON.parse(env.WHR_REVIEW_EVIDENCE_POLICY ?? "null"),
    );
    if (
      parsed.digest !== reviewEvidenceReleaseDigest ||
      parsed.scope.environment !== reviewEnvironment(env)
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}
/** Same lock as the append-only configuration insert trigger, held until decision commit. */
export async function pinReviewEvidencePolicy(
  db: pg.PoolClient,
  stationId: string,
  env: ReviewEnvironment = process.env,
) {
  const policy = reviewEvidenceConfiguration(env);
  if (
    !policy ||
    policy.scope.stationId !== stationId ||
    policy.activation.state !== "active"
  )
    throw new AuthError("evidence_insufficient", 422);
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('review-evidence:'||$1::text||':'||$2::text,0))",
    [stationId, policy.scope.environment],
  );
  const valid = await reviewEvidenceApprovalValid(db, policy);
  if (!valid) throw new AuthError("evidence_insufficient", 422);
  return policy;
}
/** Configuration-only query: health never reads purchases, providers or photos. */
export async function reviewEvidenceApprovalValid(
  db: Pick<pg.PoolClient, "query">,
  policy: ReviewEvidenceConfiguration,
) {
  if (policy.activation.state !== "active") return false;
  const found = await db.query(
    `SELECT c.id FROM review_evidence_configuration c JOIN review_evidence_approval a ON a.id=$4
     WHERE c.station_id=$1 AND c.environment=$2 AND c.revision=$3 AND c.configuration=$5::jsonb
     AND c.revision=(SELECT max(revision) FROM review_evidence_configuration WHERE station_id=$1 AND environment=$2)
     AND a.station_id=c.station_id AND a.environment=c.environment AND a.revision=c.revision
     AND a.release=$6 AND a.digest=$7 AND a.activated_at=$8::timestamptz AND a.activated_at<=clock_timestamp()`,
    [
      policy.scope.stationId,
      policy.scope.environment,
      policy.revision,
      policy.activation.approvalReference,
      JSON.stringify(policy),
      policy.release,
      policy.digest,
      policy.activation.activatedAt,
    ],
  );
  return found.rowCount === 1;
}
