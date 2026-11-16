import { describe, expect, it, vi } from "vitest";
import {
  AdminSettingsApi,
  exactInstant,
  parseRetentionDays,
  settingsUncertain,
} from "./admin-settings-api";
import { AdminError, type adminRequest } from "./admin-api";
const id = "019ab100-0000-7000-8000-000000000001";
const settings = {
  version: 1,
  settingsVersionId: null,
  campaign: null,
  timingPolicyVersion: null,
  timingLocked: false,
  retention: {
    days: null,
    deletionEnabled: false,
    policyVersion: null,
    storedCopyPolicy: "unconfigured",
  },
  station: {
    id,
    name: "Station 01",
    timezone: "Africa/Lagos",
    moneyDecimals: 2,
    products: [],
  },
};
const proposal = {
  days: 90,
  reason: "Record intended policy",
  expectedVersion: 1,
};
const review = {
  section: "retention",
  expectedVersion: 1,
  expectedCampaignVersion: null,
  before: settings,
  after: { ...settings, retention: { ...settings.retention, days: 90 } },
  proposal: { days: 90, reason: proposal.reason },
  reviewDigest: "a".repeat(64),
  policyVersions: { timing: null, retention: null },
  asOf: "2026-11-13T12:00:00Z",
};
describe("admin settings boundary", () => {
  it("accepts positive whole days or blank without inventing defaults", () => {
    expect(parseRetentionDays("")).toBe(null);
    expect(parseRetentionDays("36500")).toBe(36500);
    for (const value of ["0", "-1", "1.2", "1e2", "Infinity", "36501", "days"])
      expect(() => parseRetentionDays(value)).toThrow();
  });
  it("decodes settings strictly and rejects deletion enabled", async () => {
    const request = vi.fn().mockResolvedValue({
      ...settings,
      retention: { ...settings.retention, deletionEnabled: true },
    });
    await expect(
      new AdminSettingsApi(request as typeof adminRequest).settings(),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("binds server review to the exact submitted proposal and expected version", async () => {
    const request = vi.fn().mockResolvedValue({
      ...review,
      proposal: { days: 91, reason: proposal.reason },
    });
    await expect(
      new AdminSettingsApi(request as typeof adminRequest).review(proposal),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("freezes one confirmation identity and retries an ambiguous response verbatim", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(review)
      .mockRejectedValueOnce(new AdminError("network"))
      .mockResolvedValueOnce({
        id,
        section: "retention",
        version: 2,
        previousVersionId: null,
        appliedAt: review.asOf,
        actor: { id, code: "ADMIN001", name: "Ada Williams" },
        reason: proposal.reason,
        before: settings.retention,
        after: review.after.retention,
        auditEventId: id,
      });
    const api = new AdminSettingsApi(request as typeof adminRequest);
    const frozen = api.freeze(await api.review(proposal));
    await expect(api.confirm(frozen)).rejects.toMatchObject({
      code: "network",
    });
    await api.confirm(frozen);
    expect(request.mock.calls[1]).toEqual(request.mock.calls[2]);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.body)).toBe(true);
  });
  it("preserves a lost-response confirmation identity when its retry is rate limited", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(review)
      .mockRejectedValueOnce(new AdminError("network"))
      .mockRejectedValueOnce(new AdminError("rate_limited", 429))
      .mockResolvedValueOnce({
        id,
        section: "retention",
        version: 2,
        previousVersionId: null,
        appliedAt: review.asOf,
        actor: { id, code: "ADMIN001", name: "Ada Williams" },
        reason: proposal.reason,
        before: settings.retention,
        after: review.after.retention,
        auditEventId: id,
      });
    const api = new AdminSettingsApi(request as typeof adminRequest);
    const frozen = api.freeze(await api.review(proposal));
    for (const code of ["network", "rate_limited"]) {
      let error: unknown;
      try {
        await api.confirm(frozen);
      } catch (e) {
        error = e;
      }
      expect(error).toMatchObject({ code });
      expect(settingsUncertain(error)).toBe(true);
    }
    await api.confirm(frozen);
    expect(request.mock.calls[2]).toEqual(request.mock.calls[1]);
    expect(request.mock.calls[3]).toEqual(request.mock.calls[1]);
  });
  it("rejects a review that changes an untouched settings section", async () => {
    const request = vi.fn().mockResolvedValue({
      ...review,
      after: {
        ...review.after,
        station: { ...settings.station, name: "Unexpected station" },
      },
    });
    await expect(
      new AdminSettingsApi(request as typeof adminRequest).review(proposal),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("rejects an unrelated successful confirmation instead of marking it saved", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(review)
      .mockResolvedValueOnce({
        id,
        section: "retention",
        version: 2,
        previousVersionId: null,
        appliedAt: review.asOf,
        actor: { id, code: "ADMIN001", name: "Ada Williams" },
        reason: proposal.reason,
        before: settings.retention,
        after: { ...review.after.retention, days: 91 },
        auditEventId: id,
      });
    const api = new AdminSettingsApi(request as typeof adminRequest);
    const frozen = api.freeze(await api.review(proposal));
    let error: unknown;
    try {
      await api.confirm(frozen);
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ code: "invalid_response" });
    expect(settingsUncertain(error)).toBe(true);
  });
  it("keeps unreadable errors and malformed successful replies uncertain", () => {
    for (const error of [
      new AdminError("network"),
      new AdminError("unavailable", 500),
      new AdminError("invalid_response", 201),
      new TypeError("decode"),
    ])
      expect(settingsUncertain(error)).toBe(true);
    expect(settingsUncertain(new AdminError("review_stale", 409))).toBe(false);
    expect(settingsUncertain(new AdminError("version_conflict", 409))).toBe(
      false,
    );
  });
});

describe("P-28 timing boundary", () => {
  const proposal = {
    kind: "create" as const,
    campaignId: null,
    expectedCampaignVersion: null,
    expectedVersion: 1,
    launchAt: "2030-01-01T00:00:00.000Z",
    purchaseStart: "2030-01-02T00:00:00.000Z",
    purchaseCutoff: "2030-02-01T00:00:00.000Z",
    timezone: "Africa/Lagos",
    graceHours: 0,
    reason: "Fictional campaign setup",
  };
  const before = { ...settings, timingPolicyVersion: "campaign-timing-v1" };
  const timing = {
    launchAt: proposal.launchAt,
    purchaseStart: proposal.purchaseStart,
    purchaseCutoff: proposal.purchaseCutoff,
    timezone: proposal.timezone,
    graceHours: 0,
    uploadDeadline: proposal.purchaseCutoff,
    policyVersion: "campaign-timing-v1",
  };
  const campaign = {
    id: null,
    name: "Station 01 campaign",
    version: 1,
    settingsVersionId: null,
    timing,
    dataVersion: "0",
    latestSnapshotId: null,
    reconciliationRequired: true,
    reconciledDataVersion: null,
  };
  const { expectedVersion, expectedCampaignVersion, ...submitted } = proposal;
  const reviewed = {
    section: "giveaway",
    expectedVersion,
    expectedCampaignVersion,
    before,
    after: { ...before, campaign },
    proposal: submitted,
    reviewDigest: "a".repeat(64),
    policyVersions: { timing: "campaign-timing-v1", retention: null },
    asOf: "2026-11-16T01:00:00Z",
  };
  it("compares six-digit server UTC and offset input without losing microseconds", async () => {
    const changed = structuredClone(reviewed);
    const precise = {
      ...proposal,
      launchAt: "2030-01-01T01:00:00.123456+01:00",
      purchaseStart: "2030-01-02T01:00:00.000000+01:00",
      purchaseCutoff: "2030-02-01T01:00:00.987654+01:00",
    };
    Object.assign(changed.proposal, {
      launchAt: "2030-01-01T00:00:00.123456Z",
      purchaseStart: "2030-01-02T00:00:00.000000Z",
      purchaseCutoff: "2030-02-01T00:00:00.987654Z",
    });
    Object.assign(changed.after.campaign.timing, {
      launchAt: changed.proposal.launchAt,
      purchaseStart: changed.proposal.purchaseStart,
      purchaseCutoff: changed.proposal.purchaseCutoff,
      uploadDeadline: changed.proposal.purchaseCutoff,
    });
    await expect(
      new AdminSettingsApi(
        vi.fn().mockResolvedValue(changed) as typeof adminRequest,
      ).reviewTiming(precise),
    ).resolves.toEqual(changed);
    changed.after.campaign.timing.uploadDeadline =
      "2030-02-01T00:00:00.987655Z";
    await expect(
      new AdminSettingsApi(
        vi.fn().mockResolvedValue(changed) as typeof adminRequest,
      ).reviewTiming(precise),
    ).rejects.toMatchObject({ code: "invalid_response" });
    expect(exactInstant("2030-01-01T00:00:00.123456Z")).not.toBe(
      exactInstant("2030-01-01T00:00:00.123999Z"),
    );
  });
  it("accepts unsaved null ID and retries same confirmation after ambiguous transport", async () => {
    const receipt = {
      id,
      section: "giveaway",
      kind: "create",
      campaignId: id,
      version: 2,
      previousVersionId: null,
      appliedAt: reviewed.asOf,
      actor: { id, code: "ADMIN001", name: "Ada Williams" },
      reason: proposal.reason,
      before: null,
      after: timing,
      auditEventId: id,
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce(reviewed)
      .mockRejectedValueOnce(new AdminError("unavailable", 503))
      .mockResolvedValueOnce(receipt);
    const api = new AdminSettingsApi(request as typeof adminRequest);
    const frozen = api.freezeTiming(await api.reviewTiming(proposal));
    expect(Object.isFrozen(frozen.body)).toBe(true);
    await expect(api.confirmTiming(frozen)).rejects.toMatchObject({
      status: 503,
    });
    expect(await api.confirmTiming(frozen)).toEqual(receipt);
    expect(request.mock.calls[1]).toEqual(request.mock.calls[2]);
  });
  it.each([
    "launchAt",
    "purchaseStart",
    "purchaseCutoff",
    "timezone",
    "graceHours",
  ])("rejects substituted %s in proposed timing", async (field) => {
    const changed = structuredClone(reviewed);
    Object.assign(changed.after.campaign.timing, {
      [field]: field === "graceHours" ? 3 : "substituted",
    });
    const api = new AdminSettingsApi(
      vi.fn().mockResolvedValue(changed) as typeof adminRequest,
    );
    await expect(api.reviewTiming(proposal)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
  it("rejects a forged derived upload deadline", async () => {
    const changed = structuredClone(reviewed);
    changed.after.campaign.timing.uploadDeadline = "2030-03-01T00:00:00.000Z";
    await expect(
      new AdminSettingsApi(
        vi.fn().mockResolvedValue(changed) as typeof adminRequest,
      ).reviewTiming(proposal),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
});
