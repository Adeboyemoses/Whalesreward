import { z } from "zod";
import { authId } from "./auth";
import { actorSchema } from "./admin";
import { safeAuditText } from "./audit-privacy";
import { productCode } from "./station";
const version = z.number().int().positive().max(2147483647);
const instant = z.iso.datetime({ offset: true });
const reason = z.string().trim().min(1).max(1000).refine(safeAuditText);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const retentionSchema = z.strictObject({
  days: z.number().int().min(1).max(36500).nullable(),
  deletionEnabled: z.literal(false),
  policyVersion: z.string().max(120).nullable(),
  storedCopyPolicy: z.enum([
    "unconfigured",
    "compressed_only",
    "original_and_compressed",
  ]),
});
export const timingSchema = z.strictObject({
  launchAt: instant.nullable(),
  purchaseStart: instant.nullable(),
  purchaseCutoff: instant.nullable(),
  graceHours: z.number().int().nonnegative().nullable(),
  uploadDeadline: instant.nullable(),
  timezone: z.string().min(1),
  policyVersion: z.string().max(120).nullable(),
});
export const campaignSchema = z.strictObject({
  id: authId,
  name: z.string(),
  version,
  settingsVersionId: authId.nullable(),
  timing: timingSchema,
  dataVersion: z.string().regex(/^(0|[1-9][0-9]*)$/),
  latestSnapshotId: authId.nullable(),
  reconciliationRequired: z.boolean(),
  reconciledDataVersion: z.string().nullable(),
});
export const settingsSchema = z.strictObject({
  version,
  settingsVersionId: authId.nullable(),
  campaign: campaignSchema.nullable(),
  timingPolicyVersion: z.string().max(120).nullable(),
  timingLocked: z.boolean(),
  retention: retentionSchema,
  station: z.strictObject({
    id: authId,
    name: z.string(),
    timezone: z.string(),
    moneyDecimals: z.literal(2),
    products: z.array(
      z.strictObject({
        product: productCode,
        quantityPrecision: z.number().int().min(0).max(6).nullable(),
      }),
    ),
  }),
});
export const retentionReviewSchema = z.strictObject({
  days: z.number().nullable(),
  reason,
  expectedVersion: version,
});
const timingInputs = {
  launchAt: instant,
  purchaseStart: instant,
  purchaseCutoff: instant,
  timezone: z.string().min(1).max(120),
  graceHours: z.number(),
  reason,
  expectedVersion: version,
};
const timingCreate = z.strictObject({
  ...timingInputs,
  kind: z.literal("create"),
  campaignId: z.null(),
  expectedCampaignVersion: z.null(),
});
const timingUpdate = z.strictObject({
  ...timingInputs,
  kind: z.literal("update"),
  campaignId: authId,
  expectedCampaignVersion: version,
});
export const timingReviewSchema = z.discriminatedUnion("kind", [
  timingCreate,
  timingUpdate,
]);
export const retentionConfirmSchema = retentionReviewSchema.extend({
  operationId: authId,
  reviewDigest: digest,
});
export const timingConfirmSchema = z.discriminatedUnion("kind", [
  timingCreate.extend({ operationId: authId, reviewDigest: digest }),
  timingUpdate.extend({ operationId: authId, reviewDigest: digest }),
]);
export const reviewedSettingsSchema = settingsSchema.extend({
  campaign: campaignSchema.extend({ id: authId.nullable() }).nullable(),
});
export const settingsHistorySchema = z.strictObject({
  section: z.enum(["giveaway", "retention"]).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.number().int().min(1).max(100).default(25),
});
const commonChange = {
  id: authId,
  version,
  previousVersionId: authId.nullable(),
  appliedAt: instant,
  actor: actorSchema,
  reason,
  auditEventId: authId,
};
export const settingsChangeSchema = z.discriminatedUnion("section", [
  z.strictObject({
    ...commonChange,
    section: z.literal("retention"),
    before: retentionSchema,
    after: retentionSchema,
  }),
  z.strictObject({
    ...commonChange,
    section: z.literal("giveaway"),
    kind: z.enum(["create", "update"]),
    campaignId: authId,
    before: timingSchema.nullable(),
    after: timingSchema,
  }),
]);
export type Settings = z.infer<typeof settingsSchema>;
export type SettingsChange = z.infer<typeof settingsChangeSchema>;
export type SettingsSection = "giveaway" | "retention";
