import { z } from "zod";
import { adminRequest, AdminError, adminOperationId } from "./admin-api";
import {
  settingsSchema,
  timingReviewSchema,
  timingConfirmSchema,
  reviewedSettingsSchema,
  timingSchema,
  settingsChangeSchema,
  retentionReviewSchema,
  retentionConfirmSchema,
  settingsHistorySchema,
  retentionSchema,
  type Settings,
  type SettingsChange,
} from "../shared/contracts/settings";
const reviewSchema = z.strictObject({
  section: z.literal("retention"),
  expectedVersion: retentionReviewSchema.shape.expectedVersion,
  expectedCampaignVersion: z.null(),
  before: settingsSchema,
  after: settingsSchema,
  proposal: retentionReviewSchema.omit({ expectedVersion: true }),
  reviewDigest: retentionConfirmSchema.shape.reviewDigest,
  policyVersions: z.strictObject({
    timing: z.string().nullable(),
    retention: z.string().nullable(),
  }),
  asOf: z.iso.datetime({ offset: true }),
});
const timingReviewResult = z.strictObject({
  section: z.literal("giveaway"),
  expectedVersion: z.number().int().positive(),
  expectedCampaignVersion: z.number().int().positive().nullable(),
  before: settingsSchema,
  after: reviewedSettingsSchema,
  proposal: z.strictObject({
    kind: z.enum(["create", "update"]),
    campaignId: z.string().uuid().nullable(),
    launchAt: z.string(),
    purchaseStart: z.string(),
    purchaseCutoff: z.string(),
    timezone: z.string(),
    graceHours: z.number(),
    reason: z.string(),
  }),
  reviewDigest: retentionConfirmSchema.shape.reviewDigest,
  policyVersions: z.strictObject({
    timing: z.string().nullable(),
    retention: z.string().nullable(),
  }),
  asOf: z.iso.datetime({ offset: true }),
});
export type TimingReview = z.infer<typeof timingReviewResult>;
export type TimingProposal = z.infer<typeof timingReviewSchema>;
export type FrozenTiming = Readonly<{
  body: Readonly<z.infer<typeof timingConfirmSchema>>;
  before: z.infer<typeof timingSchema> | null;
  after: z.infer<typeof timingSchema>;
}>;
const historySchema = z.strictObject({
  items: z.array(settingsChangeSchema),
  nextCursor: z.string().nullable(),
});
export type RetentionReview = z.infer<typeof reviewSchema>;
export type RetentionProposal = z.infer<typeof retentionReviewSchema>;
export type SettingsHistory = z.infer<typeof historySchema>;
export type FrozenRetention = Readonly<{
  body: Readonly<z.infer<typeof retentionConfirmSchema>>;
  before: Settings["retention"];
}>;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
/** Compare instants without discarding fractional digits below milliseconds. */
export function exactInstant(value: string): bigint {
  const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(
    value,
  );
  if (!match || (match[2]?.length ?? 0) > 6)
    throw new AdminError("invalid_response", 200);
  const seconds = Date.parse(match[1] + match[3]!);
  if (!Number.isFinite(seconds)) throw new AdminError("invalid_response", 200);
  return BigInt(seconds) * 1000n + BigInt((match[2] ?? "").padEnd(6, "0"));
}
const instantKeys = ["launchAt", "purchaseStart", "purchaseCutoff"] as const;
export class AdminSettingsApi {
  constructor(private request: typeof adminRequest = adminRequest) {}
  private async read<T>(path: string, schema: z.ZodType<T>, body?: unknown) {
    const parsed = schema.safeParse(await this.request<unknown>(path, body));
    if (!parsed.success) throw new AdminError("invalid_response", 200);
    return parsed.data;
  }
  settings(): Promise<Settings> {
    return this.read("settings", settingsSchema);
  }
  history(cursor?: string): Promise<SettingsHistory> {
    const input = settingsHistorySchema.parse({ cursor, limit: 25 });
    const query = new URLSearchParams({
      limit: String(input.limit),
      ...(input.cursor ? { cursor: input.cursor } : {}),
    });
    return this.read(`settings/history?${query}`, historySchema);
  }
  async reviewTiming(input: TimingProposal): Promise<TimingReview> {
    const proposal = timingReviewSchema.parse(input);
    const review = await this.read(
      "settings/giveaway/review",
      timingReviewResult,
      proposal,
    );
    const normalized = {
      kind: proposal.kind,
      campaignId: proposal.campaignId,
      launchAt: proposal.launchAt,
      purchaseStart: proposal.purchaseStart,
      purchaseCutoff: proposal.purchaseCutoff,
      timezone: proposal.timezone,
      graceHours: proposal.graceHours,
      reason: proposal.reason,
    };
    const campaign = review.after.campaign;
    if (
      review.expectedVersion !== proposal.expectedVersion ||
      review.before.version !== proposal.expectedVersion ||
      review.expectedCampaignVersion !== proposal.expectedCampaignVersion ||
      !same(
        {
          ...review.proposal,
          ...Object.fromEntries(
            instantKeys.map((key) => [
              key,
              exactInstant(review.proposal[key]).toString(),
            ]),
          ),
        },
        {
          ...normalized,
          ...Object.fromEntries(
            instantKeys.map((key) => [
              key,
              exactInstant(normalized[key]).toString(),
            ]),
          ),
        },
      ) ||
      !campaign ||
      (proposal.kind === "create"
        ? review.before.campaign !== null || campaign.id !== null
        : review.before.campaign?.id !== proposal.campaignId ||
          review.before.campaign.version !== proposal.expectedCampaignVersion ||
          campaign.id !== proposal.campaignId) ||
      !same(review.after, { ...review.before, campaign }) ||
      !same(review.after.retention, review.before.retention) ||
      review.policyVersions.timing !== review.before.timingPolicyVersion ||
      !review.policyVersions.timing ||
      campaign.timing.policyVersion !== review.policyVersions.timing ||
      [
        "launchAt",
        "purchaseStart",
        "purchaseCutoff",
        "timezone",
        "graceHours",
      ].some((key) =>
        instantKeys.includes(key as (typeof instantKeys)[number])
          ? exactInstant(
              campaign.timing[key as (typeof instantKeys)[number]]!,
            ) !== exactInstant(normalized[key as (typeof instantKeys)[number]])
          : campaign.timing[key as keyof typeof campaign.timing] !==
            normalized[key as keyof typeof normalized],
      )
    )
      throw new AdminError("invalid_response", 200);
    const timing = campaign.timing;
    if (
      !timing.purchaseCutoff ||
      !timing.uploadDeadline ||
      !Number.isSafeInteger(proposal.graceHours) ||
      exactInstant(timing.uploadDeadline) !==
        exactInstant(timing.purchaseCutoff) +
          BigInt(proposal.graceHours) * 3600000000n ||
      !Number.isSafeInteger(proposal.graceHours) ||
      proposal.graceHours < 0 ||
      review.before.timingLocked ||
      (review.before.campaign &&
        !same(campaign, { ...review.before.campaign, timing }))
    )
      throw new AdminError("invalid_response", 200);
    return review;
  }
  freezeTiming(review: TimingReview): FrozenTiming {
    return Object.freeze({
      body: Object.freeze(
        timingConfirmSchema.parse({
          ...review.proposal,
          expectedVersion: review.expectedVersion,
          expectedCampaignVersion: review.expectedCampaignVersion,
          reviewDigest: review.reviewDigest,
          operationId: adminOperationId(),
        }),
      ),
      before: review.before.campaign
        ? Object.freeze({ ...review.before.campaign.timing })
        : null,
      after: Object.freeze({ ...review.after.campaign!.timing }),
    });
  }
  async confirmTiming(frozen: FrozenTiming): Promise<SettingsChange> {
    const parsed = settingsChangeSchema.safeParse(
      await this.request<unknown>(
        "settings/giveaway/confirm",
        frozen.body,
        "POST",
        frozen.body.operationId,
      ),
    );
    if (!parsed.success) throw new AdminError("invalid_response", 201);
    const result = parsed.data;
    if (
      result.section !== "giveaway" ||
      result.kind !== frozen.body.kind ||
      (frozen.body.kind === "update" &&
        result.campaignId !== frozen.body.campaignId) ||
      result.reason !== frozen.body.reason ||
      result.version !== frozen.body.expectedVersion + 1 ||
      !same(result.before, frozen.before) ||
      !same(result.after, frozen.after)
    )
      throw new AdminError("invalid_response", 201);
    return result;
  }
  async review(input: RetentionProposal) {
    const proposal = retentionReviewSchema.parse(input);
    retentionSchema.shape.days.parse(proposal.days);
    const review = await this.read(
      "settings/retention/review",
      reviewSchema,
      proposal,
    );
    const expectedAfter = {
      ...review.before,
      retention: {
        ...review.before.retention,
        days: proposal.days,
        policyVersion: null,
        deletionEnabled: false,
      },
    };
    if (
      review.expectedVersion !== proposal.expectedVersion ||
      review.before.version !== proposal.expectedVersion ||
      !same(review.proposal, {
        days: proposal.days,
        reason: proposal.reason,
      }) ||
      !same(review.after, expectedAfter)
    )
      throw new AdminError("invalid_response", 200);
    return review;
  }
  freeze(review: RetentionReview): FrozenRetention {
    return Object.freeze({
      body: Object.freeze(
        retentionConfirmSchema.parse({
          ...review.proposal,
          expectedVersion: review.expectedVersion,
          reviewDigest: review.reviewDigest,
          operationId: adminOperationId(),
        }),
      ),
      before: Object.freeze({ ...review.before.retention }),
    });
  }
  async confirm(frozen: FrozenRetention): Promise<SettingsChange> {
    const result = settingsChangeSchema.safeParse(
      await this.request<unknown>(
        "settings/retention/confirm",
        frozen.body,
        "POST",
        frozen.body.operationId,
      ),
    );
    if (
      !result.success ||
      result.data.section !== "retention" ||
      result.data.after.days !== frozen.body.days ||
      result.data.reason !== frozen.body.reason ||
      !same(result.data.before, frozen.before)
    )
      throw new AdminError("invalid_response", 201);
    return result.data;
  }
}
export function parseRetentionDays(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[0-9]+$/.test(trimmed))
    throw new Error("Enter positive whole days, or leave blank for Not set.");
  const days = Number(trimmed);
  if (!Number.isSafeInteger(days) || days < 1 || days > 36500)
    throw new Error(
      "Enter whole days from 1 to 36,500, or leave blank for Not set.",
    );
  return days;
}
export function settingsUncertain(error: unknown) {
  return (
    !(error instanceof AdminError) ||
    error.status === 0 ||
    error.status === 429 ||
    error.code === "invalid_response" ||
    error.code === "unavailable" ||
    error.status >= 500
  );
}
export function settingsMessage(error: unknown): string {
  const code = error instanceof AdminError ? error.code : "";
  return (
    (
      {
        review_stale:
          "The settings review is out of date. Reload the current settings and review your changes again before confirming.",
        version_conflict:
          "These settings changed. Reload the current settings and review your changes again before confirming.",
        no_change:
          "The proposed values are already saved. No settings change was recorded.",
        owner_required:
          "Only an Owner with settings permission can create or change campaign timing.",
        campaign_exists:
          "A campaign has already been created. Reload settings and review the saved campaign.",
        timing_locked:
          "Campaign timing is locked because purchases have started or a result has been saved.",
        timing_invalid:
          "Check the launch, start, cutoff, timezone and whole grace hours. Start must be in the future and cutoff must follow start.",
        retention_invalid:
          "Enter positive whole days, or leave blank for Not set.",
        invalid_request:
          "Check the retention period and reason. Use a reason without phone numbers or secrets.",
        timing_policy_unconfigured:
          "Campaign timing policy is not configured. An Owner can enter dates once it is available.",
      } as Record<string, string>
    )[code] ??
    (error instanceof Error
      ? error.message
      : "Settings could not be loaded. Try again.")
  );
}
