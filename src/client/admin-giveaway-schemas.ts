import { z } from "zod";
import { authId } from "../shared/contracts/auth";
import { actorSchema } from "../shared/contracts/admin";
import { categorySchema } from "../shared/contracts/customers-cards";
import { campaignSchema, timingSchema } from "../shared/contracts/settings";
import {
  totalsSchema,
  dataVersionSchema,
  reportSourceSchema,
} from "../shared/contracts/reports";
import {
  blockerSchema,
  campaignGuard,
  exclusionSchema,
  rankingRowSchema,
} from "../shared/contracts/giveaway";
export { campaignSchema, rankingRowSchema };
export const countSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
const instant = z.iso.datetime({ offset: true });
export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item),
    nextCursor: z.string().max(4096).nullable(),
  });
export const rankingPageSchema = pageSchema(rankingRowSchema).extend({
  asOf: instant,
  dataVersion: dataVersionSchema,
  basis: z.enum(["campaign_qualifying", "recorded_all_time"]),
  category: categorySchema.nullable(),
  campaign: campaignSchema.nullable(),
  state: z.enum(["unconfigured", "provisional", "recorded"]),
  summary: totalsSchema.nullable(),
  customers: countSchema,
  tieRule: z.literal("competition_v1"),
});
export const readinessSchema = z.strictObject({
  campaign: campaignSchema,
  asOf: instant,
  canPrepare: z.boolean(),
  canConfirm: z.boolean(),
  blockers: z.array(blockerSchema),
  counts: z.strictObject({
    holds: countSchema,
    corrections: countSchema,
    duplicateFlags: countSchema,
    uploads: countSchema,
    policyBlocks: countSchema,
  }),
  reconciliationPolicyVersion: z.string().nullable(),
  phoneCheck: z.strictObject({
    managerAdminId: authId.nullable(),
    censusVersion: z.number().int().positive(),
    phoneCheckId: authId.nullable(),
    state: z.enum(["missing", "stale", "complete"]),
    pendingExclusions: countSchema,
  }),
});
const exclusions = z.array(
  z.strictObject({
    reason: exclusionSchema,
    records: countSchema,
    spend: totalsSchema.shape.spend,
  }),
);
const shared = {
  campaignId: authId,
  previousSnapshotId: authId.nullable(),
  timing: timingSchema,
  reason: z.string(),
  tieRule: z.literal("competition_v1"),
  totals: totalsSchema,
  customers: countSchema,
  exclusions,
  reconciliationPolicyVersion: z.string(),
  reconciliationId: authId,
  phoneCheckId: authId,
};
export const previewSchema = z.strictObject({
  ...shared,
  id: authId,
  kind: z.enum(["initial", "revision"]),
  createdBy: actorSchema,
  preparedAt: instant,
  expiresAt: instant,
  guard: z.strictObject(campaignGuard),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  consumedSnapshotId: authId.nullable(),
});
export const snapshotSchema = z.strictObject({
  ...shared,
  id: authId,
  number: z.number().int().positive(),
  settingsVersionId: authId,
  sourceDataVersion: dataVersionSchema,
  finalizedAt: instant,
  actor: actorSchema,
  auditEventId: authId,
});
export const unchangedSchema = z.strictObject({
  state: z.literal("unchanged"),
  campaign: campaignSchema,
  reconciliationId: authId,
  currentSnapshotId: authId,
  phoneCheckId: authId,
  checkedAt: instant,
  reason: z.string(),
  auditEventId: authId,
});
export const sourceSchema = z.strictObject({
  purchaseId: authId,
  revisionId: authId.nullable(),
  purchaseVersion: z.number().int().positive(),
  included: z.boolean(),
  reasons: z.array(exclusionSchema),
  customerId: authId.nullable(),
  category: categorySchema.nullable(),
  amountKobo: reportSourceSchema.shape.amountKobo,
  currency: reportSourceSchema.shape.currency,
  quantity: reportSourceSchema.shape.quantity,
  unit: reportSourceSchema.shape.unit,
  valuesSource: z.enum(["accepted_revision", "original"]),
  photoAssetId: authId.nullable(),
  detailsReceivedAt: instant,
  photoReceiptAt: instant.nullable(),
  timingPolicyVersion: z.string().nullable(),
  phoneExclusionId: authId.nullable(),
});
export const purchaseChangeSchema = z.strictObject({
  purchaseId: authId,
  before: sourceSchema.nullable(),
  after: sourceSchema.nullable(),
  decisionEventIds: z.array(authId),
});
export const customerChangeSchema = z.strictObject({
  customerId: authId,
  before: rankingRowSchema.nullable(),
  after: rankingRowSchema.nullable(),
});
export type Campaign = z.infer<typeof campaignSchema>;
export type RankingPage = z.infer<typeof rankingPageSchema>;
export type RankingRow = z.infer<typeof rankingRowSchema>;
export type Readiness = z.infer<typeof readinessSchema>;
export type Preview = z.infer<typeof previewSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type PurchaseChange = z.infer<typeof purchaseChangeSchema>;
export type CustomerChange = z.infer<typeof customerChangeSchema>;
export type Page<T> = { items: T[]; nextCursor: string | null };
