import { z } from "zod";
import { authId } from "./auth";
import { actorSchema } from "./admin";
import { categorySchema } from "./customers-cards";
import { priceSchema } from "./station";
import { cardCode } from "./sync";
import { MAX_KOBO } from "../money";
import { amountToQuantity, parseQuantity, quantityToAmount } from "../quantity";

const version = z.number().int().min(1).max(2147483647);
const instant = z.iso
  .datetime({ offset: true })
  .transform((v) => new Date(v).toISOString());
const text = z.string().regex(/^[^\u0000-\u001f\u007f]*$/u);
const reason = text.trim().min(1).max(1000);
const kobo = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((v) => BigInt(v) <= MAX_KOBO);
const quantity = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$/)
  .refine((v) => /[1-9]/.test(v))
  .transform((v) =>
    v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v,
  );
const count = z.string().regex(/^(0|[1-9][0-9]*)$/);
const total = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);
const aggregateQuantity = z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/);
const product = z.enum(["pms", "diesel", "kerosene", "cooking_gas"]);
export const saleDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  });
export const policyBlockSchema = z.enum([
  "capture_authorization_unresolved",
  "capture_time_unresolved",
  "retirement_policy_unresolved",
  "eligibility_configuration_unset",
  "correction_evidence_policy_unset",
  "meter_reconciliation_policy_unset",
  "correction_authorship_unverified",
]);
const blocks = z.array(policyBlockSchema).max(7);
export const numericEditSchema = z.discriminatedUnion("basis", [
  z.strictObject({ basis: z.literal("amount"), enteredAmountKobo: kobo }),
  z.strictObject({ basis: z.literal("quantity"), enteredQuantity: quantity }),
]);
export const saleValuesSchema = z
  .strictObject({
    amountKobo: kobo,
    quantity,
    currency: z.literal("NGN"),
    unit: z.enum(["litre", "kilogram"]),
    basis: z.enum(["amount", "quantity"]),
    enteredAmountKobo: kobo.nullable(),
    enteredQuantity: quantity.nullable(),
    rateKobo: kobo,
    priceVersionId: authId,
    quantityPrecision: z.number().int().min(0).max(6),
    medium: z.enum(["vehicle", "keg", "three_wheeler", "bike", "cylinder"]),
    calculation: z.enum(["captured_rate", "meter_evidence"]),
    verifiedSaleDate: saleDateSchema.nullable(),
  })
  .superRefine((v, ctx) => {
    try {
      parseQuantity(v.quantity, v.quantityPrecision);
      if (v.basis === "amount") {
        if (v.enteredAmountKobo === null || v.enteredQuantity !== null)
          throw new Error();
        if (
          v.calculation === "captured_rate" &&
          (v.amountKobo !== v.enteredAmountKobo ||
            v.quantity !==
              amountToQuantity(
                BigInt(v.enteredAmountKobo),
                BigInt(v.rateKobo),
                v.quantityPrecision,
              ))
        )
          throw new Error();
      } else {
        if (v.enteredQuantity === null || v.enteredAmountKobo !== null)
          throw new Error();
        parseQuantity(v.enteredQuantity, v.quantityPrecision);
        if (
          v.calculation === "captured_rate" &&
          (v.quantity !== v.enteredQuantity ||
            v.amountKobo !==
              quantityToAmount(
                v.enteredQuantity,
                BigInt(v.rateKobo),
                v.quantityPrecision,
              ).toString())
        )
          throw new Error();
      }
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Invalid captured calculation or precision",
      });
    }
  });
export const sellerSchema = z.strictObject({
  attendantId: authId,
  accountId: authId,
  staffCode: text,
  name: text,
  username: text,
});
const holdState = z.enum(["open", "resolved", "cancelled"]);
const holdReason = z.enum([
  "price_uncertain",
  "replaced_card",
  "capture_date_uncertain",
]);
export const attendantHoldSchema = z.strictObject({
  kind: z.enum(["price", "card", "date"]),
  state: holdState,
  reasonCode: holdReason,
});
export const holdDetailSchema = attendantHoldSchema
  .extend({
    id: authId,
    version,
    openedRevisionId: authId,
    resolvedBy: actorSchema.nullable(),
    resolvedAt: instant.nullable(),
    resolutionReason: reason.nullable(),
    resolutionId: authId.nullable(),
  })
  .strict();
const correctionState = z.enum([
  "pending_validation",
  "awaiting_review",
  "accepted",
  "rejected",
]);
const timing = z.enum(["before_midnight", "late", "unresolved"]);
const authorship = z.enum(["authenticated_attendant", "unverified_recovery"]);
export const attendantCorrectionSchema = z.strictObject({
  id: authId,
  purchaseId: authId,
  operationId: authId,
  version,
  basedOnRevisionId: authId,
  proposed: saleValuesSchema,
  reason,
  serverReceivedAt: instant,
  cutoffAtReceipt: instant.nullable(),
  timing,
  state: correctionState,
  decidedAt: instant.nullable(),
  authorship,
  policyBlocks: blocks,
});
export const correctionSchema = attendantCorrectionSchema
  .extend({
    expectedPurchaseVersion: version,
    originatingSeller: sellerSchema,
    requestedBy: sellerSchema.nullable(),
    submittedBy: actorSchema,
    decidedBy: actorSchema.nullable(),
    decisionReason: reason.nullable(),
  })
  .strict();
export const correctionSubmissionSchema = z.strictObject({
  operationId: authId,
  expectedVersion: version,
  basedOnRevisionId: authId,
  edit: numericEditSchema,
  evidenceAssetId: authId,
  reason,
});
export const correctionDecisionSchema = z.strictObject({
  operationId: authId,
  expectedVersion: version,
  expectedRevisionId: authId.nullable(),
  expectedCorrectionVersion: version,
  outcome: z.enum(["approve", "reject"]),
  reason,
});
const revisionKind = z.enum([
  "original",
  "attendant_correction",
  "admin_correction",
  "price_resolution",
  "date_resolution",
]);
export const attendantRevisionSchema = z.strictObject({
  id: authId,
  number: version,
  kind: revisionKind,
  state: z.enum(["proposed", "accepted", "rejected", "superseded"]),
  basedOnRevisionId: authId.nullable(),
  values: saleValuesSchema,
  receivedAt: instant,
});
export const revisionSchema = attendantRevisionSchema
  .extend({ actor: actorSchema, reason: reason.nullable() })
  .strict();
const decisionKind = z.enum([
  "correction",
  "duplicate",
  "price",
  "card",
  "date",
  "capture",
]);
const outcome = z.enum([
  "approve",
  "reject",
  "keep_both",
  "cancel",
  "accept_captured",
  "correct_meter",
  "confirm_earlier",
  "verify_date",
  "confirm",
]);
export const attendantDecisionSchema = z.strictObject({
  id: authId,
  kind: decisionKind,
  outcome,
  decidedAt: instant,
  before: saleValuesSchema,
  after: saleValuesSchema,
  creditedAfter: z.boolean(),
  remainingHolds: z.array(attendantHoldSchema),
  policyBlocks: blocks,
});
export const decisionSchema = attendantDecisionSchema
  .extend({
    operationId: authId,
    purchaseId: authId,
    actor: actorSchema,
    reason,
    auditEventId: authId,
    appliedPurchaseVersion: version,
    appliedRevisionId: authId.nullable(),
    remainingHolds: z.array(holdDetailSchema),
  })
  .strict();
export const duplicateFlagSchema = z.strictObject({
  id: authId,
  version,
  purchaseIds: z.tuple([authId, authId]),
  state: z.enum(["open", "cleared", "cancelled"]),
  reason,
  cancelledPurchaseId: authId.nullable(),
});
export const evidenceSchema = z.strictObject({
  assetId: authId.nullable(),
  state: z.enum(["missing", "pending", "validated", "deleted"]),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  validatedAt: instant.nullable(),
});
const correctionWindow = z.strictObject({
  cutoff: instant.nullable(),
  automaticEligible: z.boolean(),
  reason: z.enum([
    "open",
    "midnight_passed",
    "date_unresolved",
    "policy_unconfigured",
    "sale_unavailable",
  ]),
});
const rowFields = {
  id: authId,
  operationId: authId,
  saleCode: text,
  version,
  customer: z
    .strictObject({
      id: authId,
      customerCode: text,
      name: text,
      category: categorySchema,
    })
    .nullable(),
  capturedCardCode: cardCode,
  seller: sellerSchema,
  station: z.strictObject({ id: authId, code: text }),
  pump: z.strictObject({ id: authId, code: text }),
  product,
  appCapturedAt: instant,
  serverReceivedAt: instant,
  verifiedSaleDate: saleDateSchema.nullable(),
  state: z.enum([
    "received",
    "photo_pending",
    "finalizing",
    "credited",
    "held",
    "cancelled",
  ]),
  credited: z.boolean(),
  currentRevisionId: authId.nullable(),
  displayedValues: saleValuesSchema,
  displayedSource: z.enum(["accepted_revision", "original"]),
  policyBlocks: blocks,
  duplicateFlag: z.boolean(),
  correctionPending: z.boolean(),
};
export const saleRowSchema = z.strictObject({
  ...rowFields,
  holds: z.array(holdDetailSchema),
});
export const attendantSaleRowSchema = z.strictObject({
  ...rowFields,
  holds: z.array(attendantHoldSchema),
});
const cursor = z.string().min(1).max(2048);
const histories = {
  revisions: cursor.nullable(),
  corrections: cursor.nullable(),
  decisions: cursor.nullable(),
};
export const saleDetailSchema = saleRowSchema
  .extend({
    original: saleValuesSchema,
    evidence: evidenceSchema,
    correctionWindow,
    revisions: z.array(revisionSchema).max(25),
    corrections: z.array(correctionSchema).max(25),
    duplicateFlags: z.array(duplicateFlagSchema).max(25),
    replacement: z
      .strictObject({
        eventId: authId,
        replacedAt: instant,
        replacementCardCode: cardCode,
      })
      .nullable(),
    priceReference: priceSchema.nullable(),
    decisions: z.array(decisionSchema).max(25),
    historyCursors: z.strictObject({
      ...histories,
      duplicateFlags: cursor.nullable(),
    }),
  })
  .strict();
export const attendantSaleDetailSchema = attendantSaleRowSchema
  .extend({
    original: saleValuesSchema,
    evidence: evidenceSchema,
    correctionWindow,
    revisions: z.array(attendantRevisionSchema).max(25),
    corrections: z.array(attendantCorrectionSchema).max(25),
    decisions: z.array(attendantDecisionSchema).max(25),
    historyCursors: z.strictObject(histories),
  })
  .strict();
export const salePageInputSchema = z.strictObject({
  cursor: cursor.optional(),
  limit: z.number().int().min(1).max(100).default(25),
});
export const saleFilterSchema = salePageInputSchema
  .extend({
    query: text.trim().min(1).max(120).optional(),
    customerId: authId.optional(),
    status: z
      .enum([
        "all",
        "completed",
        "incomplete",
        "late_correction",
        "duplicate",
        "price_review",
        "card_review",
        "date_review",
        "cancelled",
        "policy_review",
      ])
      .optional(),
    day: saleDateSchema.optional(),
  })
  .strict();
export const attendantHistoryInputSchema = salePageInputSchema
  .extend({ kind: z.enum(["revisions", "corrections", "decisions"]) })
  .strict();
export const saleHistoryInputSchema = salePageInputSchema
  .extend({
    kind: z.enum(["revisions", "corrections", "decisions", "duplicateFlags"]),
  })
  .strict();
export const pageOf = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item).max(100),
    nextCursor: cursor.nullable(),
  });
export const attendantSalePageSchema = pageOf(attendantSaleRowSchema);
export const salePageSchema = pageOf(saleRowSchema)
  .extend({
    asOf: instant,
    summary: z.strictObject({
      records: count,
      completed: count,
      spend: z.array(
        z.strictObject({ currency: z.literal("NGN"), amountKobo: total }),
      ),
      quantities: z.array(
        z.strictObject({
          product,
          unit: z.enum(["litre", "kilogram"]),
          quantity: aggregateQuantity,
        }),
      ),
    }),
  })
  .strict();
export const photoAccessInputSchema = z.strictObject({ assetId: authId });
export const photoAccessSchema = z.strictObject({
  url: z.url(),
  expiresAt: instant,
  assetId: authId,
});
export type SaleValues = z.infer<typeof saleValuesSchema>;
export type NumericEdit = z.infer<typeof numericEditSchema>;
export type CorrectionSubmission = z.infer<typeof correctionSubmissionSchema>;
export type CorrectionDecision = z.infer<typeof correctionDecisionSchema>;
export type Correction = z.infer<typeof correctionSchema>;
export type AttendantCorrection = z.infer<typeof attendantCorrectionSchema>;
export type Decision = z.infer<typeof decisionSchema>;
export type SaleFilter = z.infer<typeof saleFilterSchema>;

export const reviewEvidenceSchema = z.strictObject({
  assetId: authId,
  notes: reason,
  referenceIds: z.array(authId).max(20),
});
const reviewGuard = {
  operationId: authId,
  expectedVersion: version,
  expectedRevisionId: authId.nullable(),
  reason,
};
const holdGuard = {
  ...reviewGuard,
  expectedHoldVersion: version,
  evidence: reviewEvidenceSchema,
};
export const priceDecisionSchema = z.strictObject({
  ...holdGuard,
  decision: z.discriminatedUnion("outcome", [
    z.strictObject({ outcome: z.literal("accept_captured") }),
    z.strictObject({
      outcome: z.literal("correct_meter"),
      amountKobo: kobo,
      quantity,
    }),
    z.strictObject({ outcome: z.literal("cancel") }),
  ]),
});
export const cardDecisionSchema = z.strictObject({
  ...holdGuard,
  outcome: z.enum(["confirm_earlier", "cancel"]),
});
export const dateDecisionSchema = z.strictObject({
  ...holdGuard,
  verifiedSaleDate: z.string(),
});
export const captureDecisionSchema = z.strictObject({
  ...reviewGuard,
  outcome: z.enum(["confirm", "cancel"]),
  evidence: reviewEvidenceSchema,
});
export const duplicateDecisionSchema = z.strictObject({
  operationId: authId,
  expectedFlagVersion: version,
  purchases: z.tuple([
    z.strictObject({
      id: authId,
      expectedVersion: version,
      expectedRevisionId: authId.nullable(),
    }),
    z.strictObject({
      id: authId,
      expectedVersion: version,
      expectedRevisionId: authId.nullable(),
    }),
  ]),
  decision: z.discriminatedUnion("outcome", [
    z.strictObject({ outcome: z.literal("keep_both") }),
    z.strictObject({ outcome: z.literal("cancel"), cancelPurchaseId: authId }),
  ]),
  reason,
});
