import { z } from "zod";

// Kept self-contained so the operator command uses the same validation under
// Node's type stripping, without loading the application or its configuration.
export const auditId = z.uuid().refine((v) => v === v.toLowerCase());
import { safeAuditText } from "./audit-privacy.ts";
export { safeAuditText } from "./audit-privacy.ts";
const text = z.string().trim().min(1).max(120).refine(safeAuditText);
const reason = z.string().trim().min(1).max(1000).refine(safeAuditText);
const code = z
  .string()
  .max(80)
  .regex(
    /^(?:(?:[A-Z][A-Z_]{1,20})-[0-9a-f-]{36}|(?:ADMIN|STAFF|PUMP|CUST|BATCH|SALE|S|B)[0-9]{1,15}|pms|diesel|kerosene|cooking_gas)$/,
  );
const instant = z.iso.datetime({ offset: true });
export const auditDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  });
const positive = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .refine((v) => BigInt(v) <= BigInt(Number.MAX_SAFE_INTEGER));
const count = z.string().regex(/^(0|[1-9][0-9]*)$/);
const kobo = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
const unique = <T extends z.ZodType>(schema: T, max = 100) =>
  z
    .array(schema)
    .max(max)
    .refine((v) => new Set(v).size === v.length);
const permissions = z.enum([
  "overview",
  "sales",
  "corrections",
  "duplicates",
  "priceReview",
  "queueRecovery",
  "cardEligibility",
  "dateReview",
  "giveawayFinalize",
  "giveawayRevise",
  "customers",
  "recovery",
  "managerRecovery",
  "leaderboards",
  "reports",
  "reportExport",
  "cards",
  "cardGenerate",
  "cardExport",
  "cardPrint",
  "cardActivate",
  "attendants",
  "pumps",
  "prices",
  "settings",
  "audit",
  "users",
  "roles",
]);
export const auditFieldValues = {
  state: z.enum([
    "received",
    "photo_pending",
    "finalizing",
    "credited",
    "held",
    "cancelled",
  ]),
  revisionId: auditId,
  candidateRevisionId: auditId,
  amountKobo: kobo,
  rateKobo: kobo,
  creditedSpendKobo: kobo,
  quantity: z
    .string()
    .regex(/^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$/)
    .refine((v) => /[1-9]/.test(v)),
  currency: z.literal("NGN"),
  unit: z.enum(["litre", "kilogram"]),
  medium: z.enum(["vehicle", "keg", "three_wheeler", "bike", "cylinder"]),
  basis: z.enum(["amount", "quantity"]),
  calculation: z.enum(["captured_rate", "meter_evidence"]),
  priceVersionId: auditId,
  pumpId: auditId,
  photoAssetId: auditId,
  verifiedSaleDate: auditDate,
  credited: z.boolean(),
  holdKinds: unique(z.enum(["price", "card", "date"]), 3),
  policyBlocks: unique(
    z.enum([
      "capture_authorization_unresolved",
      "capture_time_unresolved",
      "retirement_policy_unresolved",
      "eligibility_configuration_unset",
      "correction_evidence_policy_unset",
      "meter_reconciliation_policy_unset",
      "correction_authorship_unverified",
    ]),
    7,
  ),
  decisionId: auditId,
  flagId: auditId,
  purchaseIds: z.tuple([auditId, auditId]).refine(([a, b]) => a < b),
  duplicateState: z.enum(["open", "cleared", "cancelled"]),
  correctionState: z.enum([
    "pending_validation",
    "awaiting_review",
    "accepted",
    "rejected",
  ]),
  outcome: z.enum([
    "approve",
    "reject",
    "keep_both",
    "cancel",
    "accept_captured",
    "correct_meter",
    "confirm_earlier",
    "verify_date",
    "confirm",
  ]),
  reviewEvaluationId: auditId,
  reviewPolicyRelease: z.literal("review-evidence-v1"),
  reviewPolicyRevision: positive,
  reviewConclusions: unique(
    z.enum([
      "price_valid_throughout",
      "card_before_replacement",
      "card_after_replacement",
      "sale_day",
      "capture_authorized_throughout",
      "capture_unauthorized_throughout",
      "campaign_membership_uniform",
    ]),
    7,
  ),
  meterPolicyRelease: z.literal("meter-reconciliation-v1"),
  meterPolicyRevision: positive,
  meterProfileId: auditId,
  meterEvaluationId: auditId,
  meterConclusion: z.literal("meter_reconciled"),
  phoneChanged: z.boolean(),
  customerId: auditId,
  cardId: auditId,
  oldCardId: auditId,
  newCardId: auditId,
  challengeId: auditId,
  identityChangeId: auditId,
  caseId: auditId,
  customerCategory: z.enum([
    "car_owner",
    "commercial_bus_driver",
    "three_wheeler_user",
    "bike_user",
    "keg_buyer",
    "cooking_gas_customer",
  ]),
  verificationMethod: z.enum([
    "card_present",
    "registered_phone_code",
    "manager_intake",
  ]),
  verificationState: z.enum(["issued", "verified"]),
  grantId: auditId,
  originatingAccountId: auditId,
  recordCount: count,
  recoveryState: z.enum(["active", "revoked", "expired", "submitted"]),
  detailsReceived: z.boolean(),
  photoValidated: z.boolean(),
  roleId: auditId,
  roleName: text,
  permissions: unique(permissions, 28),
  enabled: z.boolean(),
  emailVerified: z.boolean(),
  quantityPrecision: z.string().regex(/^[0-6]$/),
  productId: auditId,
  assignmentId: auditId,
  effectiveFrom: instant,
  pumpVersion: positive,
  attendantVersion: positive,
  assignmentVersion: positive,
  priceVersion: positive,
  batchVersion: positive,
  batchStatus: z.enum(["generated", "printed", "active"]),
  exportId: auditId,
  exportFormat: z.enum(["pdf", "xlsx"]),
  effectiveUntil: instant,
  authVersion: positive,
  settingsVersionId: auditId,
  approvalId: auditId,
  configurationId: auditId,
  policyRelease: z.literal("review-evidence-v1"),
  policyRevision: positive,
  policyEnvironment: z.enum(["development", "test", "staging", "production"]),
  policyState: z.enum(["active", "inactive"]),
  activatedAt: instant,
} as const;
export type AuditField = keyof typeof auditFieldValues;
export type AuditChange = {
  [K in AuditField]: {
    field: K;
    before: z.infer<(typeof auditFieldValues)[K]> | null;
    after: z.infer<(typeof auditFieldValues)[K]> | null;
  };
}[AuditField];
const alternatives = Object.entries(auditFieldValues).map(([field, value]) =>
  z.strictObject({
    field: z.literal(field),
    before: value.nullable(),
    after: value.nullable(),
  }),
);
export const auditChangeSchema = z.discriminatedUnion(
  "field",
  alternatives as [(typeof alternatives)[number], ...typeof alternatives],
) as z.ZodType<AuditChange>;
const V = [
  "amountKobo",
  "quantity",
  "currency",
  "unit",
  "basis",
  "medium",
  "rateKobo",
  "priceVersionId",
  "revisionId",
  "credited",
  "calculation",
] as const;
const G = ["state", "holdKinds", "policyBlocks", "creditedSpendKobo"] as const;
export const reviewFields = [
  "reviewPolicyRelease",
  "reviewPolicyRevision",
  "reviewEvaluationId",
  "reviewConclusions",
] as const;
export const meterFields = [
  "meterPolicyRelease",
  "meterPolicyRevision",
  "meterProfileId",
  "meterEvaluationId",
  "meterConclusion",
] as const;
export const auditAreas = [
  "reports",
  "sales",
  "customers",
  "cards",
  "prices",
  "assignments",
  "access",
  "settings",
  "recovery",
] as const;
export const auditTargetKinds = [
  "purchase",
  "customer",
  "card",
  "card_batch",
  "product",
  "attendant",
  "admin",
  "role",
  "settings",
  "recovery_grant",
  "manager_case",
  "pump",
  "review_evidence_approval",
  "review_evidence_configuration",
] as const;
export type AuditTargetKind = (typeof auditTargetKinds)[number];
type Rule = {
  area: (typeof auditAreas)[number];
  targets: readonly AuditTargetKind[];
  actors: readonly string[];
  fields: readonly AuditField[];
  optional?: readonly AuditField[];
};
const rule = (
  area: Rule["area"],
  target: AuditTargetKind,
  actors: Rule["actors"],
  fields: Rule["fields"],
  optional?: Rule["optional"],
): Rule => ({ area, targets: [target], actors, fields, optional });
export const auditRules = {
  sale_received: rule(
    "sales",
    "purchase",
    ["attendant", "admin"],
    ["state", "detailsReceived"],
  ),
  sale_credited: rule(
    "sales",
    "purchase",
    ["system:validation"],
    [...V, ...G, "photoAssetId", "candidateRevisionId"],
  ),
  sale_held: rule(
    "sales",
    "purchase",
    ["system:validation"],
    [...V, ...G, "photoAssetId", "candidateRevisionId"],
  ),
  sale_cancelled_unmatched: rule(
    "sales",
    "purchase",
    ["system:sync"],
    ["state", "credited", "creditedSpendKobo"],
  ),
  correction_received: rule(
    "sales",
    "purchase",
    ["attendant", "admin"],
    [...V, "correctionState"],
  ),
  correction_applied: rule(
    "sales",
    "purchase",
    ["system:validation"],
    [...V, "correctionState"],
  ),
  correction_approved: rule(
    "sales",
    "purchase",
    ["admin"],
    [...V, "correctionState", "decisionId", "outcome"],
  ),
  correction_rejected: rule(
    "sales",
    "purchase",
    ["admin", "system:validation"],
    [...V, "correctionState"],
    ["decisionId", "outcome"],
  ),
  duplicate_flagged: rule(
    "sales",
    "purchase",
    ["system:validation"],
    ["flagId", "purchaseIds", "duplicateState"],
  ),
  duplicate_cleared: rule(
    "sales",
    "purchase",
    ["admin"],
    [
      ...V,
      ...G,
      "decisionId",
      "outcome",
      "flagId",
      "purchaseIds",
      "duplicateState",
    ],
  ),
  duplicate_cancelled: rule(
    "sales",
    "purchase",
    ["admin"],
    [
      ...V,
      ...G,
      "decisionId",
      "outcome",
      "flagId",
      "purchaseIds",
      "duplicateState",
    ],
  ),
  price_accepted: rule(
    "sales",
    "purchase",
    ["admin"],
    [...V, ...G, "decisionId", "outcome", "candidateRevisionId"],
    reviewFields,
  ),
  price_cancelled: rule(
    "sales",
    "purchase",
    ["admin"],
    [...V, ...G, "decisionId", "outcome", "candidateRevisionId"],
    reviewFields,
  ),
  price_corrected: rule(
    "sales",
    "purchase",
    ["admin"],
    [
      ...V,
      ...G,
      "decisionId",
      "outcome",
      "candidateRevisionId",
      ...reviewFields,
      ...meterFields,
    ],
  ),
  card_eligibility_confirmed: rule(
    "sales",
    "purchase",
    ["admin"],
    [...V, ...G, "decisionId", "outcome"],
    reviewFields,
  ),
  card_eligibility_cancelled: rule(
    "sales",
    "purchase",
    ["admin"],
    [...V, ...G, "decisionId", "outcome"],
    reviewFields,
  ),
  sale_date_verified: rule(
    "sales",
    "purchase",
    ["admin"],
    [...V, ...G, "decisionId", "outcome", "verifiedSaleDate", ...reviewFields],
  ),
  capture_confirmed: rule(
    "sales",
    "purchase",
    ["admin"],
    [...V, ...G, "decisionId", "outcome", ...reviewFields],
  ),
  capture_cancelled: rule(
    "sales",
    "purchase",
    ["admin"],
    [...V, ...G, "decisionId", "outcome", ...reviewFields],
  ),
  customer_registered: rule(
    "customers",
    "customer",
    ["attendant"],
    ["customerCategory", "cardId"],
  ),
  phone_changed: rule(
    "customers",
    "customer",
    ["admin"],
    ["phoneChanged", "verificationMethod", "identityChangeId"],
  ),
  card_replaced: rule(
    "cards",
    "card",
    ["admin"],
    [
      "customerId",
      "oldCardId",
      "newCardId",
      "verificationMethod",
      "identityChangeId",
    ],
  ),
  manager_case_recorded: rule(
    "customers",
    "manager_case",
    ["admin"],
    ["caseId", "verificationMethod"],
  ),
  card_verification_issued: rule(
    "cards",
    "customer",
    ["admin"],
    ["challengeId", "verificationMethod", "verificationState"],
  ),
  card_verification_verified: rule(
    "cards",
    "customer",
    ["admin"],
    ["challengeId", "verificationMethod", "verificationState"],
  ),
  recovery_authorized: rule(
    "recovery",
    "recovery_grant",
    ["admin"],
    ["grantId", "originatingAccountId", "recordCount", "recoveryState"],
  ),
  recovery_revoked: rule(
    "recovery",
    "recovery_grant",
    ["admin", "system:validation"],
    ["grantId", "originatingAccountId", "recordCount", "recoveryState"],
  ),
  recovery_item_received: rule(
    "recovery",
    "purchase",
    ["admin"],
    ["grantId", "originatingAccountId", "detailsReceived", "photoValidated"],
  ),
  user_created: rule(
    "access",
    "admin",
    ["admin"],
    ["roleId", "roleName", "enabled", "emailVerified"],
  ),
  user_access_changed: rule(
    "access",
    "admin",
    ["admin"],
    ["roleId", "roleName", "enabled", "emailVerified"],
  ),
  role_created: rule("access", "role", ["admin"], ["roleName", "permissions"]),
  role_changed: rule("access", "role", ["admin"], ["roleName", "permissions"]),
  verification_requested: rule("access", "admin", ["admin"], ["emailVerified"]),
  email_verified: rule("access", "admin", ["system:access"], ["emailVerified"]),
  password_reset: rule("access", "admin", ["system:access"], []),
  password_changed: {
    ...rule("access", "admin", ["admin", "attendant"], []),
    targets: ["admin", "attendant"],
  },
  pump_created: rule(
    "assignments",
    "pump",
    ["admin"],
    ["productId", "pumpVersion"],
  ),
  attendant_created: rule(
    "access",
    "attendant",
    ["admin"],
    ["attendantVersion"],
  ),
  assignment_changed: rule(
    "assignments",
    "attendant",
    ["admin"],
    ["assignmentId", "pumpId", "assignmentVersion", "effectiveFrom"],
  ),
  assignment_ended: rule(
    "assignments",
    "attendant",
    ["admin"],
    [
      "assignmentId",
      "pumpId",
      "effectiveUntil",
      "attendantVersion",
      "authVersion",
    ],
  ),
  price_activated: rule(
    "prices",
    "product",
    ["admin"],
    [
      "priceVersionId",
      "priceVersion",
      "rateKobo",
      "currency",
      "quantityPrecision",
      "effectiveFrom",
    ],
  ),
  batch_generated: rule(
    "cards",
    "card_batch",
    ["admin"],
    ["batchStatus", "batchVersion"],
  ),
  batch_printed: rule(
    "cards",
    "card_batch",
    ["admin"],
    ["batchStatus", "batchVersion"],
  ),
  batch_activated: rule(
    "cards",
    "card_batch",
    ["admin"],
    ["batchStatus", "batchVersion"],
  ),
  export_requested: rule(
    "cards",
    "card_batch",
    ["admin"],
    ["exportId", "exportFormat", "recordCount"],
  ),
  export_prepared: rule(
    "cards",
    "card_batch",
    ["system:export"],
    ["exportId", "exportFormat"],
  ),
  export_failed: rule(
    "cards",
    "card_batch",
    ["system:export"],
    ["exportId", "exportFormat"],
  ),
  review_evidence_approved: rule(
    "settings",
    "review_evidence_approval",
    ["system:operations"],
    [
      "approvalId",
      "policyRelease",
      "policyRevision",
      "policyEnvironment",
      "activatedAt",
    ],
  ),
  review_evidence_configured: rule(
    "settings",
    "review_evidence_configuration",
    ["system:operations"],
    [
      "configurationId",
      "approvalId",
      "policyRelease",
      "policyRevision",
      "policyEnvironment",
      "policyState",
      "activatedAt",
    ],
  ),
  review_evidence_deactivated: rule(
    "settings",
    "review_evidence_configuration",
    ["system:operations"],
    [
      "configurationId",
      "approvalId",
      "policyRelease",
      "policyRevision",
      "policyEnvironment",
      "policyState",
      "activatedAt",
    ],
  ),
} as const satisfies Record<string, Rule>;
export type AuditAction = keyof typeof auditRules;
export const auditAction = z.enum(
  Object.keys(auditRules) as [AuditAction, ...AuditAction[]],
);
export const auditActorSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("admin"),
    userId: auditId,
    code,
    nameAtEvent: text,
    usernameAtEvent: text,
    roleAtEvent: text.nullable(),
  }),
  z.strictObject({
    kind: z.literal("attendant"),
    userId: auditId,
    code,
    nameAtEvent: text,
    usernameAtEvent: text,
    roleAtEvent: text.nullable(),
  }),
  z.strictObject({
    kind: z.literal("system"),
    service: z.enum([
      "sync",
      "validation",
      "reconciliation",
      "export",
      "retention",
      "access",
      "operations",
    ]),
    nameAtEvent: text,
  }),
]);
export type AuditActor = z.infer<typeof auditActorSchema>;
export const auditSellerSchema = z.strictObject({
  attendantId: auditId,
  accountId: auditId,
  staffCode: code,
  name: text,
  username: text,
});
export type AuditSeller = z.infer<typeof auditSellerSchema>;
export const auditTargetSchema = z.strictObject({
  kind: z.enum(auditTargetKinds),
  id: auditId,
  code,
  subjectAtEvent: text.nullable(),
});
const base = {
  id: auditId,
  eventCode: code,
  stationId: auditId,
  occurredAt: instant,
  area: z.enum(auditAreas),
  originatingSeller: auditSellerSchema.nullable(),
  operationId: auditId.nullable(),
  reason,
  changes: z.array(auditChangeSchema).max(100),
  relatedEventIds: unique(auditId, 20),
};
export const currentAuditEventSchema = z
  .strictObject({
    ...base,
    schemaVersion: z.literal(1),
    action: auditAction,
    actor: auditActorSchema,
    target: auditTargetSchema,
    correlationId: auditId,
  })
  .superRefine((v, ctx) => {
    const r: Rule = auditRules[v.action];
    const nullableAfter: AuditField[] = [
      "revisionId",
      "candidateRevisionId",
      "photoAssetId",
      "verifiedSaleDate",
      "correctionState",
    ];
    if (v.action === "assignment_ended")
      nullableAfter.push("assignmentId", "pumpId");
    if (v.action === "review_evidence_deactivated")
      nullableAfter.push("approvalId", "activatedAt");
    for (const c of v.changes)
      if (c.after === null && !nullableAfter.includes(c.field))
        ctx.addIssue({ code: "custom", message: "Missing committed value" });
    const fields = v.changes.map((c) => c.field);
    const allowed = [...r.fields, ...(r.optional ?? [])];
    const actor =
      v.actor.kind === "system" ? `system:${v.actor.service}` : v.actor.kind;
    if (
      r.area !== v.area ||
      !r.targets.includes(v.target.kind) ||
      !r.actors.includes(actor) ||
      new Set(fields).size !== fields.length ||
      r.fields.some((f) => !fields.includes(f)) ||
      fields.some((f) => !allowed.includes(f))
    )
      ctx.addIssue({ code: "custom", message: "Invalid audit shape" });
    if (v.action === "password_changed" && v.actor.kind !== v.target.kind)
      ctx.addIssue({ code: "custom", message: "Invalid actor" });
    for (const group of [reviewFields, meterFields])
      if (
        group.some((f) => fields.includes(f)) &&
        !group.every((f) => fields.includes(f))
      )
        ctx.addIssue({
          code: "custom",
          message: "Incomplete policy projection",
        });
    if (
      v.action === "correction_rejected" &&
      ((v.actor.kind === "admin") !== fields.includes("decisionId") ||
        fields.includes("decisionId") !== fields.includes("outcome"))
    )
      ctx.addIssue({ code: "custom", message: "Invalid decision projection" });
  });
export const historicalAuditEventSchema = z.strictObject({
  ...base,
  schemaVersion: z.literal(0),
  action: z.union([auditAction, z.literal("legacy_event")]),
  actor: auditActorSchema.nullable(),
  target: z.strictObject({
    kind: z.enum([...auditTargetKinds, "legacy"]),
    id: auditId,
    code: code.nullable(),
    subjectAtEvent: text.nullable(),
  }),
  correlationId: auditId.nullable(),
});
// M4 settings events have their own closed schema; M3 remains version 1.
const m4SettingsValues = {
  campaignId: auditId,
  settingsVersionId: auditId,
  settingsVersion: positive,
  campaignVersion: positive,
  launchAt: instant,
  purchaseStart: instant,
  purchaseCutoff: instant,
  uploadDeadline: instant,
  graceHours: z
    .string()
    .regex(/^(0|[1-9][0-9]*)$/)
    .refine((v) => BigInt(v) <= 2147483647n),
  retentionDays: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .refine((v) => BigInt(v) <= 36500n),
  deletionEnabled: z.literal(false),
  timezone: z.string().refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }),
  timingPolicyVersion: text,
} as const;
const m4Changes = Object.entries(m4SettingsValues).map(([field, value]) =>
  z.strictObject({
    field: z.literal(field),
    before: value.nullable(),
    after: value.nullable(),
  }),
);
export const m4SettingsAuditSchema = z
  .strictObject({
    ...base,
    schemaVersion: z.literal(2),
    area: z.literal("settings"),
    action: z.enum([
      "campaign_created",
      "giveaway_timing_changed",
      "retention_intent_changed",
    ]),
    actor: auditActorSchema,
    originatingSeller: z.null(),
    target: z.strictObject({
      kind: z.enum(["settings", "campaign"]),
      id: auditId,
      code,
      subjectAtEvent: z.null(),
    }),
    correlationId: auditId,
    changes: z
      .array(
        z.discriminatedUnion(
          "field",
          m4Changes as [(typeof m4Changes)[number], ...typeof m4Changes],
        ),
      )
      .max(100),
  })
  .superRefine((v, ctx) => {
    const required =
      v.action === "retention_intent_changed"
        ? [
            "settingsVersionId",
            "settingsVersion",
            "retentionDays",
            "deletionEnabled",
          ]
        : [
            "campaignId",
            "settingsVersionId",
            "settingsVersion",
            "campaignVersion",
            "launchAt",
            "purchaseStart",
            "purchaseCutoff",
            "graceHours",
            "uploadDeadline",
            "timezone",
            "timingPolicyVersion",
          ];
    const fields = v.changes.map((c) => c.field);
    if (
      v.target.kind !==
      (v.action === "campaign_created" ? "campaign" : "settings")
    )
      ctx.addIssue({ code: "custom", message: "Invalid timing target" });
    if (
      v.actor.kind !== "admin" ||
      !v.operationId ||
      new Set(fields).size !== fields.length ||
      fields.length !== required.length ||
      required.some((f) => !fields.includes(f))
    )
      ctx.addIssue({ code: "custom", message: "Invalid M4 audit mapping" });
    for (const c of v.changes) {
      if (
        ([
          "settingsVersionId",
          "settingsVersion",
          "campaignVersion",
          "timezone",
        ].includes(c.field) &&
          c.after === null) ||
        (c.field === "deletionEnabled" &&
          (c.before !== false || c.after !== false))
      )
        ctx.addIssue({ code: "custom", message: "Invalid M4 audit value" });
    }
  });
export type M4SettingsAuditEvent = z.infer<typeof m4SettingsAuditSchema>;
const reportAuditValues = {
  creatorAdminId: auditId,
  sourceDataVersion: z
    .string()
    .regex(/^(0|[1-9][0-9]{0,18})$/)
    .refine((v) => BigInt(v) <= 9223372036854775807n),
  reportFrom: auditDate,
  reportTo: auditDate,
  reportProduct: z.enum(["pms", "diesel", "kerosene", "cooking_gas"]),
  reportGroupBy: z.enum(["product", "attendant", "pump"]),
  exportFormat: z.enum(["pdf", "xlsx"]),
  exportState: z.enum(["pending", "ready", "failed", "expired"]),
  failureCode: z.enum(["preparation_failed", "precision_not_representable"]),
};
const reportAuditChanges = Object.entries(reportAuditValues).map(
  ([field, value]) =>
    z.strictObject({
      field: z.literal(field),
      before: value.nullable(),
      after: value.nullable(),
    }),
);
export const m4ReportAuditSchema = z
  .strictObject({
    ...base,
    schemaVersion: z.literal(2),
    area: z.literal("reports"),
    action: z.enum([
      "report_export_requested",
      "report_export_prepared",
      "report_export_failed",
    ]),
    actor: auditActorSchema,
    originatingSeller: z.null(),
    target: z.strictObject({
      kind: z.literal("report_export"),
      id: auditId,
      code,
      subjectAtEvent: z.null(),
    }),
    correlationId: auditId,
    changes: z
      .array(
        z.discriminatedUnion(
          "field",
          reportAuditChanges as [
            (typeof reportAuditChanges)[number],
            ...typeof reportAuditChanges,
          ],
        ),
      )
      .max(100),
  })
  .superRefine((v, ctx) => {
    const requested = v.action === "report_export_requested",
      required = requested
        ? [
            "creatorAdminId",
            "sourceDataVersion",
            "reportFrom",
            "reportTo",
            "reportProduct",
            "reportGroupBy",
            "exportFormat",
            "exportState",
          ]
        : ["creatorAdminId", "exportState", "failureCode"],
      fields = v.changes.map((c) => c.field);
    if (
      new Set(fields).size !== fields.length ||
      fields.length !== required.length ||
      required.some((f) => !fields.includes(f)) ||
      (requested
        ? v.actor.kind !== "admin" || !v.operationId
        : v.actor.kind !== "system" || v.actor.service !== "export")
    )
      ctx.addIssue({ code: "custom", message: "Invalid report audit mapping" });
    for (const c of v.changes) {
      if (
        (requested && c.before !== null) ||
        (!requested && c.field === "creatorAdminId" && c.before !== c.after)
      )
        ctx.addIssue({
          code: "custom",
          message: "Invalid report event context",
        });
      if (
        c.after === null &&
        !["reportProduct", "failureCode"].includes(c.field)
      )
        ctx.addIssue({ code: "custom", message: "Invalid null report value" });
      if (
        c.field === "exportState" &&
        (c.after !==
          (requested
            ? "pending"
            : v.action === "report_export_prepared"
              ? "ready"
              : "failed") ||
          c.before !== (requested ? null : "pending"))
      )
        ctx.addIssue({ code: "custom", message: "Invalid export transition" });
      if (
        c.field === "failureCode" &&
        ((v.action === "report_export_failed") !== (c.after !== null) ||
          c.before !== null)
      )
        ctx.addIssue({ code: "custom", message: "Invalid export failure" });
    }
  });
export type M4ReportAuditEvent = z.infer<typeof m4ReportAuditSchema>;
export const m4AuditSchema = z.union([
  m4SettingsAuditSchema,
  m4ReportAuditSchema,
]);
export const auditEventSchema = z.union([
  m4AuditSchema,
  currentAuditEventSchema,
  historicalAuditEventSchema,
]);
export type AuditEvent = z.infer<typeof auditEventSchema>;
export const auditSearchSchema = z.strictObject({
  query: z.string().trim().max(120).optional(),
  area: z.enum(auditAreas).optional(),
  actorKind: z.enum(["admin", "attendant", "system"]).optional(),
  from: z.string().max(32).optional(),
  to: z.string().max(32).optional(),
  targetId: auditId.optional(),
  cursor: z.string().max(4096).optional(),
  limit: z.number().int().min(1).max(100).default(25),
});
export type AuditSearch = z.infer<typeof auditSearchSchema>;
export const auditPageSchema = z.strictObject({
  items: z.array(auditEventSchema).max(100),
  nextCursor: z.string().nullable(),
});
