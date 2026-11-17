import { saleValuesSchema } from "./sales";
import { safeAuditText } from "./audit-privacy";
import { z } from "zod";
import { authId } from "./auth";
import { actorSchema } from "./admin";
import { campaignSchema } from "./settings";
import { blockerSchema, campaignGuard } from "./giveaway";
export const checkNames = [
  "timing",
  "holds",
  "corrections",
  "duplicates",
  "two_person_proposals",
  "uploads",
  "complete_photo_deadline",
  "eligibility",
  "phone_census",
] as const;
export const checkNameSchema = z.enum(checkNames);
const count = z.string().regex(/^(0|[1-9][0-9]*)$/);
const version = z.number().int().positive().max(2147483647);
const instant = z.iso.datetime({ offset: true });
const label = z.string().min(1).max(1000);
const kind = z.enum(["initial", "revision"]);
const comparison = z.string().min(1).max(4096);
export const checklistQuery = z.strictObject({
  expectedView: comparison.optional(),
});
export const selectionQuery = checklistQuery.extend({
  cursor: comparison.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const projectionViewSchema = z.strictObject({
  asOf: instant,
  viewToken: comparison,
  kind,
  guard: z.strictObject(campaignGuard),
  censusId: authId.nullable(),
  censusVersion: version,
  designationId: authId.nullable(),
  phoneCheckId: authId.nullable(),
  reconciliationPolicyVersion: label.nullable(),
});
export const reasonCodes = {
  timing: [
    "campaign_unconfigured",
    "timing_policy_unconfigured",
    "before_cutoff",
    "grace_open",
  ],
  holds: ["holds_open"],
  corrections: ["corrections_pending"],
  duplicates: ["duplicates_open"],
  two_person_proposals: ["release_proposals_pending"],
  uploads: [
    "uploads_incomplete",
    "validation_pending",
    "no_applicable_sources",
  ],
  complete_photo_deadline: [
    "photo_proof_missing",
    "photo_proof_unbound",
    "photo_deadline_uncertain",
    "no_applicable_sources",
  ],
  eligibility: [
    "eligibility_unresolved",
    "timing_unresolved",
    "capture_release_pending",
  ],
  phone_census: [
    "manager_missing",
    "manager_ineligible",
    "census_missing",
    "census_incomplete",
    "phone_check_missing",
    "phone_check_stale",
    "phone_unchecked",
    "phone_exclusion_pending",
    "exclusion_unusable",
  ],
} as const;
export const checkOutcomeSchema = z
  .strictObject({
    name: checkNameSchema,
    outcome: z.enum(["resolved", "unresolved", "not_applicable"]),
    checked: count.nullable(),
    blocking: count.nullable(),
    unit: z.enum(["campaigns", "purchases", "phones"]),
    reasonCodes: z.array(z.string()).max(12),
    links: z.array(
      z.strictObject({
        href: z.enum(["/admin/settings", "/admin/sales"]),
        label,
      }),
    ),
    access: z.enum(["available", "restricted"]),
  })
  .superRefine((v, ctx) => {
    const expectedUnit =
      v.name === "timing"
        ? "campaigns"
        : v.name === "phone_census"
          ? "phones"
          : "purchases";
    if (v.unit !== expectedUnit)
      ctx.addIssue({ code: "custom", message: "Wrong count unit" });
    if (v.outcome === "unresolved" && v.blocking === "0")
      ctx.addIssue({
        code: "custom",
        message: "Unresolved count cannot be zero",
      });
    if (
      v.reasonCodes.some(
        (r) =>
          r !== "policy_missing" &&
          !(reasonCodes[v.name] as readonly string[]).includes(r),
      )
    )
      ctx.addIssue({ code: "custom", message: "Unknown check reason" });
    if (v.outcome !== "unresolved" && v.blocking !== "0")
      ctx.addIssue({ code: "custom", message: "Resolved count must be zero" });
    if (
      v.outcome === "not_applicable" &&
      (!["uploads", "complete_photo_deadline"].includes(v.name) ||
        v.checked !== "0")
    )
      ctx.addIssue({ code: "custom", message: "Invalid applicability" });
    if (v.access === "restricted" && v.links.length)
      ctx.addIssue({ code: "custom", message: "Restricted links" });
  });
export type CheckOutcome = z.infer<typeof checkOutcomeSchema>;
export const projectionReadinessSchema = z.strictObject({
  campaign: campaignSchema,
  asOf: instant,
  canPrepare: z.boolean(),
  canConfirm: z.boolean(),
  blockers: z.array(blockerSchema),
  counts: z.strictObject({
    holds: count,
    corrections: count,
    duplicateFlags: count,
    uploads: count,
    policyBlocks: count,
  }),
  reconciliationPolicyVersion: label.nullable(),
  phoneCheck: z.strictObject({
    managerAdminId: authId.nullable(),
    censusVersion: version,
    phoneCheckId: authId.nullable(),
    state: z.enum(["missing", "stale", "complete"]),
    pendingExclusions: count,
  }),
});
const ordered = <T extends { name: string }>(rows: T[]) =>
  rows.length === checkNames.length &&
  rows.every((r, i) => r.name === checkNames[i]);
export const checklistProjectionSchema = z.strictObject({
  view: projectionViewSchema,
  readiness: projectionReadinessSchema,
  checks: z.array(checkOutcomeSchema).refine(ordered),
  latestStoredResultId: authId.nullable(),
});
export const storedChecklistSchema = z.strictObject({
  id: authId,
  campaignId: authId,
  kind,
  checkedAt: instant,
  sourceDataVersion: count,
  settingsVersionId: authId,
  timingPolicyVersion: label,
  reconciliationPolicyVersion: label,
  previousSnapshotId: authId.nullable(),
  phoneCheckId: authId,
  approvedExclusionIds: z.array(authId).max(100),
  actor: actorSchema,
  reason: z.string().min(1).max(1000),
  auditEventId: authId,
  outcome: z.enum(["preview_prepared", "unchanged"]),
  checks: z
    .array(
      z.strictObject({
        name: checkNameSchema,
        result: z.literal("clear"),
        checked: count,
        blocking: z.literal("0"),
      }),
    )
    .refine(ordered),
  countBasis: z.literal("reconciliation_v1_stored"),
  historical: z.literal(true),
});
export const managerChoiceSchema = z.strictObject({
  adminId: authId,
  adminCode: label,
  name: label,
  personVerified: z.literal(true),
  eligibleFor: z.array(kind).min(1).max(2),
});
export const currentDesignationSchema = z.strictObject({
  id: authId,
  manager: z.strictObject({ adminId: authId, adminCode: label, name: label }),
});
export const attendantChoiceSchema = z.strictObject({
  attendantId: authId,
  staffCode: label,
  name: label,
  username: label,
  enabled: z.boolean(),
  hasCurrentAssignment: z.boolean(),
  required: z.literal(true),
});
export const phoneChoiceSchema = z.strictObject({
  id: authId,
  version,
  label: z.string().min(1).max(80).refine(safeAuditText),
  attendantIds: z.array(authId).min(1).max(100),
  state: z.enum([
    "unchecked",
    "empty",
    "unavailable_pending",
    "unavailable_approved",
  ]),
  censusId: authId,
  censusVersion: version,
  phoneCheckState: z.enum(["missing", "stale", "complete"]),
});
export const incompleteChoiceSchema = z.strictObject({
  purchaseId: authId,
  purchaseVersion: version,
  originatingAttendantId: authId,
  state: z.enum(["received", "photo_pending"]),
  detailsReceivedAt: instant,
  amountKobo: saleValuesSchema.shape.amountKobo,
  currency: z.string().regex(/^[A-Z]{3}$/),
  quantity: saleValuesSchema.shape.quantity,
  unit: z.enum(["litre", "kilogram"]),
  everAccepted: z.literal(false),
  hasTrustedByteObservation: z.literal(false),
  hasCompletePhotoFact: z.literal(false),
  phoneAttribution: z.literal("manager_attestation_required"),
});
export const selectionPageSchema = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    view: projectionViewSchema,
    items: z.array(item).max(100),
    nextCursor: comparison.nullable(),
  });
export const managerSelectionSchema = selectionPageSchema(
  managerChoiceSchema,
).extend({ currentDesignation: currentDesignationSchema.nullable() });
export const attendantSelectionSchema = selectionPageSchema(
  attendantChoiceSchema,
);
export const phoneSelectionSchema = selectionPageSchema(phoneChoiceSchema);
export const incompleteSelectionSchema = selectionPageSchema(
  incompleteChoiceSchema,
);
