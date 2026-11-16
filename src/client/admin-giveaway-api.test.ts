import { describe, expect, it, vi } from "vitest";
import {
  AdminGiveawayApi,
  giveawayUncertain,
  matchingPreview,
} from "./admin-giveaway-api";
import { AdminError, type adminRequest } from "./admin-api";
import { leaderboardQuery } from "../shared/contracts/giveaway";
const id = "019ab100-0000-7000-8000-000000000001";
const other = "019ab100-0000-7000-8000-000000000002";
const at = "2026-11-16T10:00:00Z";
const totals = {
  purchases: "2",
  spend: [{ currency: "NGN", amountKobo: "900719925474099300" }],
  litres: "12.5",
  kilograms: "0",
  products: [],
};
const campaign = {
  id,
  name: "Fictional campaign",
  version: 4,
  settingsVersionId: id,
  dataVersion: "7",
  latestSnapshotId: null,
  reconciliationRequired: false,
  reconciledDataVersion: "7",
  timing: {
    launchAt: at,
    purchaseStart: at,
    purchaseCutoff: at,
    graceHours: 0,
    uploadDeadline: at,
    timezone: "Africa/Lagos",
    policyVersion: "timing-v1",
  },
};
const guard = {
  expectedVersion: 4,
  expectedSettingsVersionId: id,
  expectedDataVersion: "7",
  expectedPreviousSnapshotId: null,
};
const preview = {
  id: other,
  campaignId: id,
  kind: "initial" as const,
  createdBy: { id, code: "ADMIN009", name: "Grace Okon" },
  preparedAt: at,
  expiresAt: "2026-11-16T10:15:00Z",
  guard,
  reason: "Records inspected",
  timing: campaign.timing,
  tieRule: "competition_v1" as const,
  totals,
  customers: "2",
  exclusions: [],
  reconciliationPolicyVersion: "reconciliation-v1",
  contentDigest: "a".repeat(64),
  previousSnapshotId: null,
  consumedSnapshotId: null,
  reconciliationId: id,
  phoneCheckId: id,
};
const ready = {
  campaign,
  asOf: at,
  canPrepare: true,
  canConfirm: true,
  blockers: [],
  counts: {
    holds: "0",
    corrections: "0",
    duplicateFlags: "0",
    uploads: "0",
    policyBlocks: "0",
  },
  reconciliationPolicyVersion: "reconciliation-v1",
  phoneCheck: {
    managerAdminId: id,
    censusVersion: 2,
    phoneCheckId: id,
    state: "complete" as const,
    pendingExclusions: "0",
  },
};
const snapshot = {
  id,
  campaignId: id,
  number: 1,
  previousSnapshotId: null,
  settingsVersionId: id,
  timing: campaign.timing,
  sourceDataVersion: "7",
  finalizedAt: at,
  actor: preview.createdBy,
  reason: preview.reason,
  tieRule: preview.tieRule,
  totals,
  customers: "2",
  exclusions: [],
  reconciliationPolicyVersion: "reconciliation-v1",
  reconciliationId: id,
  phoneCheckId: id,
  auditEventId: id,
};
describe("giveaway client boundary", () => {
  for (const basis of ["campaign_qualifying", "recorded_all_time"] as const) {
    for (const category of [undefined, "car_owner"] as const) {
      for (const cursor of [undefined, "opaque+cursor/value="] as const) {
        it(`sends a strict ${basis} URL with category ${category ?? "absent"} and cursor ${cursor ? "present" : "absent"}`, async () => {
          const request = vi.fn(async (path: string) => {
            const url = new URL(path, "https://example.com/api/admin/");
            const actual = Object.fromEntries(url.searchParams);
            const parsed = leaderboardQuery.parse(actual);
            expect(parsed).toEqual({
              basis,
              ...(basis === "campaign_qualifying" ? { campaignId: id } : {}),
              ...(category ? { category } : {}),
              ...(cursor ? { cursor } : {}),
              limit: 25,
            });
            expect(url.searchParams.has("category")).toBe(
              category !== undefined,
            );
            expect(url.searchParams.has("cursor")).toBe(cursor !== undefined);
            expect(url.searchParams.has("campaignId")).toBe(
              basis === "campaign_qualifying",
            );
            return {
              items: [],
              nextCursor: null,
              asOf: at,
              dataVersion: "7",
              basis,
              category: category ?? null,
              campaign: basis === "campaign_qualifying" ? campaign : null,
              state:
                basis === "campaign_qualifying" ? "provisional" : "recorded",
              summary: totals,
              customers: "0",
              tieRule: "competition_v1",
            };
          });
          await new AdminGiveawayApi(request as typeof adminRequest).rankings(
            basis,
            basis === "campaign_qualifying" ? id : undefined,
            category,
            cursor,
          );
          expect(request).toHaveBeenCalledOnce();
        });
      }
    }
  }
  it("keeps exact aggregate kobo and shared ranks from the full server ranking", async () => {
    const row = {
      customerId: id,
      customerCode: "CUST009",
      name: "Grace Okon",
      cardCode: null,
      category: "car_owner",
      rank: "2",
      sharedRank: true,
      totals,
    };
    const request = vi.fn().mockResolvedValue({
      items: [row],
      nextCursor: "next",
      asOf: at,
      dataVersion: "7",
      basis: "campaign_qualifying",
      category: null,
      campaign,
      state: "provisional",
      summary: totals,
      customers: "3",
      tieRule: "competition_v1",
    });
    const result = await new AdminGiveawayApi(
      request as typeof adminRequest,
    ).rankings("campaign_qualifying", id);
    expect(result.items[0]?.totals.spend[0]?.amountKobo).toBe(
      "900719925474099300",
    );
    expect(result.items[0]).toMatchObject({ rank: "2", sharedRank: true });
    expect(result.nextCursor).toBe("next");
  });
  it("rejects malformed readiness and preserves grouped non-additive counts", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        ...ready,
        counts: { ...ready.counts, holds: "2", policyBlocks: "2" },
      })
      .mockResolvedValueOnce({ ...ready, granularChecks: [] });
    const api = new AdminGiveawayApi(request as typeof adminRequest);
    expect((await api.readiness(id)).counts).toMatchObject({
      holds: "2",
      policyBlocks: "2",
    });
    await expect(api.readiness(id)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
  it("freezes prepare and confirm retries verbatim and uses the returned preview guard", async () => {
    const changedPreview = {
      ...preview,
      guard: { ...guard, expectedVersion: 5 },
    };
    const request = vi
      .fn()
      .mockRejectedValueOnce(new AdminError("network"))
      .mockResolvedValueOnce(changedPreview)
      .mockRejectedValueOnce(new AdminError("network"))
      .mockResolvedValueOnce(snapshot);
    const api = new AdminGiveawayApi(request as typeof adminRequest);
    const p = api.freezePreparation(campaign, "initial", preview.reason);
    await expect(api.prepare(p)).rejects.toMatchObject({ code: "network" });
    const received = await api.prepare(p);
    expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);
    if ("state" in received) throw new Error("unexpected unchanged");
    const frozen = api.freezeConfirmation(received);
    expect(frozen.body.expectedVersion).toBe(5);
    expect(Object.isFrozen(frozen.body)).toBe(true);
    await expect(api.confirm(frozen)).rejects.toMatchObject({
      code: "network",
    });
    await api.confirm(frozen);
    expect(request.mock.calls[2]).toEqual(request.mock.calls[3]);
  });
  it("rejects a successful-looking receipt for a different preview result", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ ...snapshot, sourceDataVersion: "8" });
    const api = new AdminGiveawayApi(request as typeof adminRequest);
    await expect(
      api.confirm(api.freezeConfirmation(preview)),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("does not call an unchanged reconciliation a new snapshot", async () => {
    const previous = { ...campaign, latestSnapshotId: other };
    const request = vi.fn().mockResolvedValue({
      state: "unchanged",
      campaign: { ...previous, version: 5 },
      currentSnapshotId: other,
      reconciliationId: id,
      phoneCheckId: id,
      checkedAt: at,
      reason: preview.reason,
      auditEventId: id,
    });
    const api = new AdminGiveawayApi(request as typeof adminRequest);
    expect(
      await api.prepare(
        api.freezePreparation(previous, "revision", preview.reason),
      ),
    ).toMatchObject({ state: "unchanged", currentSnapshotId: other });
  });
  it("requires the exact current owned unconsumed preview and server canConfirm", () => {
    expect(matchingPreview(preview, ready, id)).toBe(true);
    expect(matchingPreview(preview, ready, other)).toBe(false);
    expect(
      matchingPreview({ ...preview, consumedSnapshotId: id }, ready, id),
    ).toBe(false);
    expect(
      matchingPreview(
        preview,
        { ...ready, campaign: { ...campaign, version: 5 } },
        id,
      ),
    ).toBe(false);
    expect(matchingPreview(preview, { ...ready, canConfirm: false }, id)).toBe(
      false,
    );
  });
  it("keeps uncertainty for network, rate-limit, server and invalid-success responses", () => {
    for (const e of [
      new AdminError("network"),
      new AdminError("rate_limited", 429),
      new AdminError("temporarily_unavailable", 503),
      new AdminError("invalid_response", 201),
    ])
      expect(giveawayUncertain(e)).toBe(true);
    expect(giveawayUncertain(new AdminError("preview_stale", 409))).toBe(false);
    expect(giveawayUncertain(new AdminError("operation_conflict", 409))).toBe(
      false,
    );
  });
});
