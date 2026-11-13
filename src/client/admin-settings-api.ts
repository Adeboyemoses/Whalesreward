import { z } from "zod";
import { adminRequest, AdminError, adminOperationId } from "./admin-api";
import {
  settingsSchema,
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
          "The proposed retention period is already saved. No settings change was recorded.",
        retention_invalid:
          "Enter positive whole days, or leave blank for Not set.",
        invalid_request:
          "Check the retention period and reason. Use a reason without phone numbers or secrets.",
        timing_policy_unconfigured:
          "Campaign dates can't be changed until Whales approves the timing rules",
      } as Record<string, string>
    )[code] ??
    (error instanceof Error
      ? error.message
      : "Settings could not be loaded. Try again.")
  );
}
