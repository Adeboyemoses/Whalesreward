import { z } from "zod";
import { authId } from "./auth";
import { categorySchema } from "./customers-cards";
import { dataVersionSchema, totalsSchema } from "./reports";
export const giveawayPage = {
  cursor: z.string().max(4096).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};
export const leaderboardQuery = z
  .strictObject({
    basis: z.enum(["campaign_qualifying", "recorded_all_time"]),
    campaignId: authId.optional(),
    category: categorySchema.optional(),
    ...giveawayPage,
  })
  .refine((v) => (v.basis === "campaign_qualifying") === Boolean(v.campaignId));
export const rankingRowSchema = z.strictObject({
  customerId: authId,
  customerCode: z.string(),
  name: z.string(),
  cardCode: z.string().nullable(),
  category: categorySchema,
  rank: z.string().regex(/^[1-9][0-9]*$/),
  sharedRank: z.boolean(),
  totals: totalsSchema,
});
export type RankingRow = z.infer<typeof rankingRowSchema>;
export const campaignGuard = {
  expectedVersion: z.number().int().positive(),
  expectedSettingsVersionId: authId.nullable(),
  expectedDataVersion: dataVersionSchema,
  expectedPreviousSnapshotId: authId.nullable(),
};
export const prepareGiveawaySchema = z.strictObject({
  operationId: authId,
  kind: z.enum(["initial", "revision"]),
  reason: z.string().trim().min(1).max(1000),
  ...campaignGuard,
});
export const confirmGiveawaySchema = z.strictObject({
  operationId: authId,
  previewId: authId,
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  ...campaignGuard,
});
export const exclusionSchema = z.enum([
  "cancelled",
  "held",
  "incomplete",
  "ineligible",
  "before_launch",
  "outside_period",
  "upload_late",
  "timing_unresolved",
  "evidence_deadline_unresolved",
  "phone_unavailable",
]);
export type Exclusion = z.infer<typeof exclusionSchema>;
export const blockerSchema = z.enum([
  "campaign_unconfigured",
  "timing_policy_unconfigured",
  "before_cutoff",
  "grace_open",
  "reviews_unresolved",
  "uploads_unresolved",
  "eligibility_unresolved",
  "reconciliation_policy_unconfigured",
  "reconciliation_required",
  "phone_check_required",
  "phone_exclusion_pending",
]);
export type Blocker = z.infer<typeof blockerSchema>;
