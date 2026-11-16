import { it, expect } from "vitest";
import {
  m4GiveawayAuditSchema,
  auditEventSchema,
  auditSearchSchema,
} from "../../../shared/contracts/audit";
const id = "019a5000-0000-7000-8000-000000000001";
const event = {
  id,
  eventCode: `AUD-${id}`,
  schemaVersion: 2,
  stationId: id,
  occurredAt: "2026-11-16T12:00:00.000001Z",
  area: "giveaway",
  action: "giveaway_manager_designated",
  actor: {
    kind: "admin",
    userId: id,
    code: "ADMIN001",
    nameAtEvent: "Ada Williams",
    usernameAtEvent: "ada.williams",
    roleAtEvent: "Owner",
  },
  originatingSeller: null,
  target: {
    kind: "campaign",
    id,
    code: `CAMPAIGN-${id}`,
    subjectAtEvent: null,
  },
  operationId: id,
  correlationId: id,
  reason: "Campaign manager designated",
  relatedEventIds: [],
  changes: [
    { field: "managerAdminId", before: null, after: id },
    { field: "campaignVersion", before: "1", after: "2" },
  ],
};
it("version-two giveaway event is independently accepted by persistence and public projection schemas", () => {
  expect(m4GiveawayAuditSchema.safeParse(event).success).toBe(true);
  expect(auditEventSchema.safeParse(event).success).toBe(true);
  expect(auditSearchSchema.safeParse({ area: "giveaway" }).success).toBe(true);
});
it("rejects incomplete duplicate and private arbitrary giveaway changes", () => {
  for (const changes of [
    event.changes.slice(1),
    [...event.changes, event.changes[0]],
    [
      ...event.changes,
      { field: "phoneLabel", before: null, after: "Pump handset" },
    ],
    [event.changes[0], { field: "campaignVersion", before: 1, after: 2 }],
  ])
    expect(m4GiveawayAuditSchema.safeParse({ ...event, changes }).success).toBe(
      false,
    );
});
it("rejects wrong action target and system identity for human giveaway changes", () => {
  expect(
    m4GiveawayAuditSchema.safeParse({
      ...event,
      target: { ...event.target, kind: "customer" },
    }).success,
  ).toBe(false);
  expect(
    m4GiveawayAuditSchema.safeParse({
      ...event,
      actor: {
        kind: "system",
        service: "reconciliation",
        nameAtEvent: "Reconciliation service",
      },
    }).success,
  ).toBe(false);
});
