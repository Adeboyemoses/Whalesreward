import { describe, it, expect } from "vitest";
import {
  retentionReviewSchema,
  retentionConfirmSchema,
  timingReviewSchema,
} from "../../../shared/contracts/settings";
import { m4SettingsAuditSchema } from "../../../shared/contracts/audit";
import { timingPolicyConfigured, requireTimingPolicy } from "./policy";
const id = "019a5000-0000-7000-8000-000000000001";
const event = {
  id,
  eventCode: `AUD-${id}`,
  schemaVersion: 2,
  stationId: id,
  occurredAt: "2026-11-13T00:00:00Z",
  area: "settings",
  action: "retention_intent_changed",
  actor: {
    kind: "admin",
    userId: id,
    code: "ADMIN001",
    nameAtEvent: "Ada Williams",
    usernameAtEvent: "ada",
    roleAtEvent: "Owner",
  },
  originatingSeller: null,
  target: {
    kind: "settings",
    id,
    code: `SETTINGS-${id}`,
    subjectAtEvent: null,
  },
  operationId: id,
  correlationId: id,
  reason: "Record intended period",
  relatedEventIds: [],
  changes: [
    { field: "settingsVersionId", before: null, after: id },
    { field: "settingsVersion", before: "1", after: "2" },
    { field: "retentionDays", before: null, after: "30" },
    { field: "deletionEnabled", before: false, after: false },
  ],
};
describe("M4 settings contracts", () => {
  it("rejects client authority, derived fields and private reasons", () => {
    const valid = {
      days: null,
      reason: "Clear intended period",
      expectedVersion: 1,
    };
    expect(retentionReviewSchema.parse(valid)).toEqual(valid);
    for (const extra of [
      { deletionEnabled: true },
      { actor: id },
      { stationId: id },
      { retentionApproved: true },
    ])
      expect(
        retentionReviewSchema.safeParse({ ...valid, ...extra }).success,
      ).toBe(false);
    expect(
      retentionReviewSchema.safeParse({ ...valid, reason: "Call 08012345678" })
        .success,
    ).toBe(false);
    expect(
      retentionConfirmSchema.safeParse({
        ...valid,
        operationId: id,
        reviewDigest: "x",
      }).success,
    ).toBe(false);
    expect(
      timingReviewSchema.safeParse({
        campaignId: id,
        purchaseCutoff: "2026-11-14T00:00:00Z",
        graceHours: 0,
        reason: "Adjust cutoff",
        expectedVersion: 1,
        expectedCampaignVersion: 1,
        uploadDeadline: "2026-11-15T00:00:00Z",
      }).success,
    ).toBe(false);
  });
  it("keeps WHR-55 unconfigured with a nonretryable domain conflict", () => {
    expect(timingPolicyConfigured()).toBe(false);
    expect(requireTimingPolicy).toThrowError(
      expect.objectContaining({
        code: "timing_policy_unconfigured",
        status: 409,
      }),
    );
  });
  it("validates the exact v2 settings mapping and typed values", () => {
    expect(m4SettingsAuditSchema.safeParse(event).success).toBe(true);
    for (const patch of [
      { action: "settings_changed" },
      { schemaVersion: 1 },
      { area: "sales" },
      { operationId: null },
      { originatingSeller: { name: "Private" } },
    ])
      expect(
        m4SettingsAuditSchema.safeParse({ ...event, ...patch }).success,
      ).toBe(false);
    for (const changes of [
      event.changes.slice(1),
      [...event.changes, event.changes[0]],
      event.changes.map((c) =>
        c.field === "retentionDays" ? { ...c, after: 30 } : c,
      ),
      event.changes.map((c) =>
        c.field === "deletionEnabled" ? { ...c, after: true } : c,
      ),
      event.changes.map((c) =>
        c.field === "retentionDays" ? { ...c, after: "36501" } : c,
      ),
    ])
      expect(
        m4SettingsAuditSchema.safeParse({ ...event, changes }).success,
      ).toBe(false);
  });
});
