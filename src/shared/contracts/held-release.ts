import { z } from "zod";
import { authId } from "./auth";
import { saleValuesSchema, decisionSchema } from "./sales";
import { SYNC_LIMITS } from "./sync";

const version = z.number().int().min(1).max(2147483647);
const reason = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .regex(/^[^\u0000-\u001f\u007f]*$/u);
const instant = z.iso
  .datetime({ offset: true })
  .refine((v) => !/\.\d{4,}/.test(v))
  .transform((v) => new Date(v).toISOString());
const guard = {
  expectedVersion: version,
  expectedRevisionId: authId.nullable(),
};
export const releaseTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.enum(["price", "card", "date"]),
    holdId: authId,
    expectedHoldVersion: version,
  }),
  z.strictObject({
    kind: z.literal("capture"),
    blocks: z
      .array(
        z.strictObject({
          id: authId,
          version,
          code: z.enum([
            "capture_authorization_unresolved",
            "capture_time_unresolved",
          ]),
        }),
      )
      .min(1)
      .max(2)
      .refine(
        (v) =>
          v.every((b, i) => i === 0 || v[i - 1]!.id < b.id) &&
          new Set(v.map((b) => b.code)).size === v.length,
      ),
  }),
]);
export const attestedFactsSchema = z
  .strictObject({
    source: z.enum(["shift_sheet", "sales_log"]),
    entryReference: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[^\u0000-\u001f\u007f]*$/u)
      .refine((v) => !/(?:https?:|www\.|@|\+?\d[\d ()-]{8,}\d)/i.test(v)),
    stationId: authId,
    accountId: authId,
    pumpId: authId,
    product: z.enum(["pms", "diesel", "kerosene", "cooking_gas"]),
    customerId: authId,
    cardId: authId,
    recordedAmountKobo: saleValuesSchema.shape.amountKobo.nullable(),
    recordedQuantity: saleValuesSchema.shape.quantity.nullable(),
    recordedRateKobo: saleValuesSchema.shape.rateKobo.nullable(),
    observedCapture: z
      .strictObject({
        from: instant,
        through: instant,
        timezone: z.literal("Africa/Lagos"),
      })
      .refine((v) => v.from <= v.through),
    finding: z.enum(["sale_recorded", "entry_marked_void"]),
  })
  .refine((v) => v.recordedAmountKobo !== null || v.recordedQuantity !== null);
export const releaseProposalInputSchema = z.strictObject({
  ...guard,
  operationId: authId,
  target: releaseTargetSchema,
  outcome: z.enum(["confirm", "cancel"]),
  sheetAssetId: authId,
  meterAssetId: authId,
  facts: attestedFactsSchema,
  reason,
});
export const releaseDecisionInputSchema = z.strictObject({
  ...guard,
  operationId: authId,
  expectedProposalVersion: version,
  outcome: z.enum(["approve", "reject"]),
  reason,
});
export const releaseSheetReservationSchema = z.strictObject({
  operationId: authId,
  target: releaseTargetSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive().max(SYNC_LIMITS.maxBytes),
  contentType: z.literal("image/jpeg"),
});
export const releaseSheetFinalizeSchema = z.strictObject({
  operationId: authId,
});
export const releasePhotoAccessSchema = z.strictObject({ assetId: authId });
export type ReleaseTarget = z.infer<typeof releaseTargetSchema>;
export type AttestedFacts = z.infer<typeof attestedFactsSchema>;
export type ReleaseProposalInput = z.infer<typeof releaseProposalInputSchema>;

export const releaseActorSchema = z.strictObject({
  id: authId,
  code: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
});
export const releaseDecisionSchema = z.strictObject({
  id: authId,
  proposalId: authId,
  operationId: authId,
  outcome: z.enum(["approve", "reject"]),
  actor: releaseActorSchema,
  reason,
  decidedAt: z.iso.datetime({ offset: true }),
  auditEventId: authId,
  result: decisionSchema.nullable(),
});
export const releaseProposalSchema = z.strictObject({
  id: authId,
  purchaseId: authId,
  version,
  target: releaseTargetSchema,
  outcome: z.enum(["confirm", "cancel"]),
  facts: attestedFactsSchema,
  sheetAssetId: authId,
  meterAssetId: authId,
  proposedBy: releaseActorSchema,
  proposedAt: z.iso.datetime({ offset: true }),
  reason,
  state: z.enum(["pending", "approved", "rejected", "superseded"]),
  policy: z.strictObject({
    release: z.literal("review-evidence-v2"),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    revision: version,
  }),
  guardAtProposal: z.strictObject(guard),
  decision: releaseDecisionSchema.nullable(),
});
export const releaseDecisionResponseSchema = z.strictObject({
  proposal: releaseProposalSchema,
  decision: releaseDecisionSchema,
});
