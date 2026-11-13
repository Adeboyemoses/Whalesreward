import { describe, expect, it, vi } from "vitest";
import {
  AdminSettingsApi,
  parseRetentionDays,
  settingsUncertain,
} from "./admin-settings-api";
import { AdminError, type adminRequest } from "./admin-api";
const id = "019ab100-0000-7000-8000-000000000001";
const settings = {
  version: 1,
  settingsVersionId: null,
  campaign: null,
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
  it("rejects a review that changes an untouched settings section", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({
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
