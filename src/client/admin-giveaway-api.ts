import { z } from "zod";
import { adminRequest, AdminError, adminOperationId } from "./admin-api";
import { authId } from "../shared/contracts/auth";
import {
  leaderboardQuery,
  prepareGiveawaySchema,
  confirmGiveawaySchema,
} from "../shared/contracts/giveaway";
import {
  campaignSchema,
  rankingPageSchema,
  readinessSchema,
  previewSchema,
  snapshotSchema,
  unchangedSchema,
  rankingRowSchema,
  pageSchema,
  sourceSchema,
  purchaseChangeSchema,
  customerChangeSchema,
  type Campaign,
  type Preview,
  type Readiness,
} from "./admin-giveaway-schemas";
import type { Category } from "./customer-admin-types";
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export const giveawayGuard = (c: Campaign) => ({
  expectedVersion: c.version,
  expectedSettingsVersionId: c.settingsVersionId,
  expectedDataVersion: c.dataVersion,
  expectedPreviousSnapshotId: c.latestSnapshotId,
});
function frozen<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}
export type FrozenPreparation = Readonly<{
  campaignId: string;
  body: Readonly<z.infer<typeof prepareGiveawaySchema>>;
}>;
export type FrozenConfirmation = Readonly<{
  campaignId: string;
  preview: Preview;
  body: Readonly<z.infer<typeof confirmGiveawaySchema>>;
}>;
export function matchingPreview(p: Preview, r: Readiness, adminId: string) {
  return (
    r.canConfirm &&
    p.campaignId === r.campaign.id &&
    p.createdBy.id === adminId &&
    p.consumedSnapshotId === null &&
    same(p.guard, giveawayGuard(r.campaign)) &&
    p.phoneCheckId === r.phoneCheck.phoneCheckId &&
    p.reconciliationPolicyVersion === r.reconciliationPolicyVersion &&
    p.previousSnapshotId === r.campaign.latestSnapshotId &&
    (p.kind === "revision") === Boolean(p.previousSnapshotId) &&
    Date.parse(p.expiresAt) > Date.parse(r.asOf)
  );
}
export class AdminGiveawayApi {
  constructor(private request: typeof adminRequest = adminRequest) {}
  private async read<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    key?: string,
  ) {
    const result = schema.safeParse(
      await this.request<unknown>(
        path,
        body,
        body === undefined ? "GET" : "POST",
        key,
      ),
    );
    if (!result.success) throw new AdminError("invalid_response", 200);
    return result.data;
  }
  private root(campaignId: string) {
    return `giveaway/${authId.parse(campaignId)}`;
  }
  campaign() {
    return this.read(
      "giveaway/campaign",
      z.strictObject({ campaign: campaignSchema.nullable() }),
    );
  }
  async readiness(campaignId: string) {
    const r = await this.read(
      `${this.root(campaignId)}/readiness`,
      readinessSchema,
    );
    if (r.campaign.id !== campaignId)
      throw new AdminError("invalid_response", 200);
    return r;
  }
  async rankings(
    basis: "campaign_qualifying" | "recorded_all_time",
    campaignId?: string,
    category?: Category,
    cursor?: string,
    expectedDataVersion?: string,
  ) {
    const q = leaderboardQuery.parse({
      basis,
      campaignId,
      category,
      cursor,
      limit: 25,
    });
    const search = new URLSearchParams(
      Object.entries(q).flatMap(([k, v]) =>
        v === undefined ? [] : [[k, String(v)]],
      ),
    );
    const r = await this.read(`leaderboards?${search}`, rankingPageSchema);
    if (
      r.basis !== basis ||
      r.category !== (category ?? null) ||
      (basis === "campaign_qualifying"
        ? r.campaign?.id !== campaignId
        : r.campaign !== null) ||
      (expectedDataVersion !== undefined &&
        r.dataVersion !== expectedDataVersion) ||
      (r.state === "unconfigured" &&
        (r.items.length ||
          r.summary !== null ||
          r.customers !== "0" ||
          r.nextCursor !== null)) ||
      (basis === "recorded_all_time" && r.state !== "recorded")
    )
      throw new AdminError("invalid_response", 200);
    return r;
  }
  freezePreparation(
    campaign: Campaign,
    kind: "initial" | "revision",
    reason: string,
  ): FrozenPreparation {
    return frozen({
      campaignId: campaign.id,
      body: prepareGiveawaySchema.parse({
        operationId: adminOperationId(),
        kind,
        reason,
        ...giveawayGuard(campaign),
      }),
    });
  }
  async prepare(p: FrozenPreparation) {
    const r = await this.read(
      `${this.root(p.campaignId)}/previews`,
      z.union([previewSchema, unchangedSchema]),
      p.body,
      p.body.operationId,
    );
    if ("state" in r) {
      if (
        p.body.kind !== "revision" ||
        r.campaign.id !== p.campaignId ||
        r.currentSnapshotId !== p.body.expectedPreviousSnapshotId ||
        r.campaign.latestSnapshotId !== r.currentSnapshotId ||
        r.reason !== p.body.reason ||
        r.campaign.dataVersion !== p.body.expectedDataVersion
      )
        throw new AdminError("invalid_response", 200);
    } else if (
      r.campaignId !== p.campaignId ||
      r.kind !== p.body.kind ||
      r.reason !== p.body.reason ||
      r.previousSnapshotId !== p.body.expectedPreviousSnapshotId ||
      r.guard.expectedPreviousSnapshotId !==
        p.body.expectedPreviousSnapshotId ||
      r.guard.expectedDataVersion !== p.body.expectedDataVersion ||
      r.guard.expectedSettingsVersionId !== p.body.expectedSettingsVersionId ||
      r.guard.expectedVersion !== p.body.expectedVersion + 1
    )
      throw new AdminError("invalid_response", 201);
    return r;
  }
  async preview(campaignId: string, id: string) {
    const r = await this.read(
      `${this.root(campaignId)}/previews/${authId.parse(id)}`,
      previewSchema,
    );
    if (r.id !== id || r.campaignId !== campaignId)
      throw new AdminError("invalid_response", 200);
    return r;
  }
  freezeConfirmation(preview: Preview): FrozenConfirmation {
    const p = previewSchema.parse(preview);
    return frozen({
      campaignId: p.campaignId,
      preview: p,
      body: confirmGiveawaySchema.parse({
        operationId: adminOperationId(),
        previewId: p.id,
        contentDigest: p.contentDigest,
        ...p.guard,
      }),
    });
  }
  async confirm(p: FrozenConfirmation) {
    const v = p.preview,
      path = v.previousSnapshotId
        ? `snapshots/${authId.parse(v.previousSnapshotId)}/revisions`
        : "snapshots";
    const r = await this.read(
      `${this.root(p.campaignId)}/${path}`,
      snapshotSchema,
      p.body,
      p.body.operationId,
    );
    if (
      r.campaignId !== p.campaignId ||
      r.previousSnapshotId !== v.previousSnapshotId ||
      r.sourceDataVersion !== p.body.expectedDataVersion ||
      r.settingsVersionId !== p.body.expectedSettingsVersionId ||
      r.reason !== v.reason ||
      !same(r.actor, v.createdBy) ||
      !same(r.totals, v.totals) ||
      !same(r.timing, v.timing) ||
      !same(r.exclusions, v.exclusions) ||
      r.customers !== v.customers ||
      r.tieRule !== v.tieRule ||
      r.reconciliationId !== v.reconciliationId ||
      r.phoneCheckId !== v.phoneCheckId ||
      r.reconciliationPolicyVersion !== v.reconciliationPolicyVersion
    )
      throw new AdminError("invalid_response", 201);
    return r;
  }
  snapshots(campaignId: string, cursor?: string) {
    return this.read(
      `${this.root(campaignId)}/snapshots?${new URLSearchParams({ limit: "25", ...(cursor ? { cursor } : {}) })}`,
      pageSchema(snapshotSchema),
    );
  }
  async snapshot(campaignId: string, id: string) {
    const r = await this.read(
      `${this.root(campaignId)}/snapshots/${authId.parse(id)}`,
      snapshotSchema,
    );
    if (r.id !== id || r.campaignId !== campaignId)
      throw new AdminError("invalid_response", 200);
    return r;
  }
  rows(
    campaignId: string,
    collection: "previews" | "snapshots",
    id: string,
    category?: Category,
    cursor?: string,
  ) {
    return this.read(
      `${this.root(campaignId)}/${collection}/${authId.parse(id)}/rows?${new URLSearchParams({ limit: "25", ...(category ? { category } : {}), ...(cursor ? { cursor } : {}) })}`,
      pageSchema(rankingRowSchema),
    );
  }
  sources(campaignId: string, id: string, cursor?: string) {
    return this.read(
      `${this.root(campaignId)}/snapshots/${authId.parse(id)}/sources?${new URLSearchParams({ limit: "25", ...(cursor ? { cursor } : {}) })}`,
      pageSchema(sourceSchema),
    );
  }
  customerChanges(
    campaignId: string,
    collection: "previews" | "snapshots",
    id: string,
    cursor?: string,
  ) {
    return this.read(
      `${this.root(campaignId)}/${collection}/${authId.parse(id)}/changes?${new URLSearchParams({ kind: "customers", limit: "25", ...(cursor ? { cursor } : {}) })}`,
      pageSchema(customerChangeSchema),
    );
  }
  purchaseChanges(
    campaignId: string,
    collection: "previews" | "snapshots",
    id: string,
    cursor?: string,
  ) {
    return this.read(
      `${this.root(campaignId)}/${collection}/${authId.parse(id)}/changes?${new URLSearchParams({ kind: "purchases", limit: "25", ...(cursor ? { cursor } : {}) })}`,
      pageSchema(purchaseChangeSchema),
    );
  }
}
export function giveawayUncertain(e: unknown) {
  return (
    !(e instanceof AdminError) ||
    e.status === 0 ||
    e.status === 429 ||
    e.status >= 500 ||
    e.code === "invalid_response"
  );
}
export function giveawayMessage(e: unknown) {
  const messages: Record<string, string> = {
    read_view_stale:
      "Records changed while this list was loading. Refresh the complete list before reviewing.",
    version_conflict:
      "This review is out of date. Refresh the evidence and review again.",
    snapshot_superseded:
      "This review is out of date. Refresh the evidence and review again.",
    preview_stale:
      "The records changed. Refresh readiness and prepare a new preview.",
    preview_expired:
      "This preview can no longer be confirmed. Refresh the checks and prepare a new preview.",
    preview_used:
      "This preview can no longer be confirmed. Refresh the checks and prepare a new preview.",
    preview_mismatch:
      "This preview can no longer be confirmed. Refresh the checks and prepare a new preview.",
    finalization_blocked:
      "Finalization is blocked. Refresh the current checks and resolve every reported blocker.",
    operation_conflict:
      "This request ID was used for different content. Stop and reload the recorded result before making another change.",
    reconciliation_policy_unconfigured:
      "Finalization checklist policy is not configured. An Owner must arrange configuration; no check can be certified.",
    snapshot_exists:
      "A snapshot has already been saved. Refresh and review the saved result.",
    snapshot_missing:
      "No saved snapshot is available to revise. Refresh the current campaign.",
    currency_mismatch:
      "The ranking contains mixed currencies and cannot be displayed or finalized. Contact support.",
    aggregate_overflow:
      "The ranking exceeds the supported total. Contact support.",
    invalid_request:
      "Check the reason. Do not include phone numbers or secrets.",
    not_found: "This record is unavailable.",
  };
  return (
    (e instanceof AdminError && messages[e.code]) ||
    (e instanceof Error
      ? e.message
      : "Finalization evidence could not be loaded. Retry.")
  );
}
