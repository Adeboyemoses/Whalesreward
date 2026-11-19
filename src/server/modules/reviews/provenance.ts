import { z } from "zod";

/**
 * Protected storage envelope shared by ordinary and two-person review writers
 * and contribution reads. Target-specific facts and private provenance remain
 * intact; these common fields bind a conclusion to the committed sale decision.
 * A historical decision is matched to its own version/revision, not the current
 * purchase, so a later numeric correction cannot erase an applicable timing fact.
 */
export const reviewProvenanceSchema = z.looseObject({
  policy: z.looseObject({
    scope: z.looseObject({ stationId: z.uuid() }),
  }),
  target: z.looseObject({ purchaseId: z.uuid(), decisionId: z.uuid() }),
  result: z.looseObject({
    closure: z.enum(["confirmed", "cancelled"]),
    appliedPurchaseVersion: z.number().int().positive(),
    resultingRevisionId: z.uuid().nullable(),
    evidenceAssetId: z.uuid(),
  }),
  // The target evaluators own typed conclusions. Keep unknown retained values
  // here so membership's existing malformed/contradictory-proof checks fail closed.
  conclusions: z.array(z.unknown()),
});
export type ReviewProvenance = z.infer<typeof reviewProvenanceSchema>;

export const campaignMembershipProofSchema = z.looseObject({
  campaignIds: z.array(z.string()),
  configurationIds: z.array(z.string()),
  inside: z.boolean(),
});
