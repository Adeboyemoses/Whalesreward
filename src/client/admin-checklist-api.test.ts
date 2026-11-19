import { describe, expect, it, vi } from "vitest";
import { AdminChecklistApi } from "./admin-checklist-api";
import type { adminRequest } from "./admin-api";
const id = "019ab100-0000-7000-8000-000000000001";
const other = "019ab100-0000-7000-8000-000000000002";
const view = {
  asOf: "2026-11-19T10:00:00Z",
  viewToken: "opaque",
  kind: "initial",
  guard: {
    expectedVersion: 2,
    expectedSettingsVersionId: id,
    expectedDataVersion: "3",
    expectedPreviousSnapshotId: null,
  },
  censusId: null,
  censusVersion: 1,
  designationId: null,
  phoneCheckId: null,
  reconciliationPolicyVersion: "reconciliation-v1",
};
const manager = {
  adminId: id,
  adminCode: "ADMIN001",
  name: "Fictional manager",
  personVerified: true,
  eligibleFor: ["initial"],
};
describe("checklist client integrity", () => {
  it("loads complete selector pages and binds every later page to the first view", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce({
        view,
        items: [manager],
        nextCursor: "next",
        currentDesignation: null,
      })
      .mockResolvedValueOnce({
        view,
        items: [{ ...manager, adminId: other }],
        nextCursor: null,
        currentDesignation: null,
      });
    const result = await new AdminChecklistApi(
      transport as typeof adminRequest,
    ).managers(id);
    expect(result.items).toHaveLength(2);
    expect(transport.mock.calls[1]![0]).toContain("expectedView=opaque");
    expect(transport.mock.calls[1]![0]).toContain("cursor=next");
  });
  it("refuses changed view and duplicate rows instead of certifying a partial selection", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce({
        view,
        items: [manager],
        nextCursor: "next",
        currentDesignation: null,
      })
      .mockResolvedValueOnce({
        view: { ...view, viewToken: "changed" },
        items: [manager],
        nextCursor: null,
        currentDesignation: null,
      });
    await expect(
      new AdminChecklistApi(transport as typeof adminRequest).managers(id),
    ).rejects.toMatchObject({ code: "read_view_stale" });
  });
  it("never treats an ineligible manager returned by malformed success as a choice", async () => {
    const transport = vi.fn().mockResolvedValue({
      view,
      items: [{ ...manager, eligibleFor: ["revision"] }],
      nextCursor: null,
      currentDesignation: null,
    });
    await expect(
      new AdminChecklistApi(transport as typeof adminRequest).managers(id),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("freezes exact bounded census body including partitions and same retry operation", () => {
    const api = new AdminChecklistApi();
    const draft = {
      operationId: id,
      kind: "initial",
      reason: "Physical inventory checked",
      ...view.guard,
      expectedCensusVersion: 1,
      phones: [{ label: "Pump handset", attendantIds: [id] }],
    };
    const frozen = api.freeze(id, "census", draft);
    draft.phones[0]!.attendantIds.push(other);
    expect((frozen.body as typeof draft).phones[0]!.attendantIds).toEqual([id]);
    expect(Object.isFrozen(frozen.body)).toBe(true);
  });
  it("refuses duplicate partitions and oversized atomic census before sending", () => {
    const api = new AdminChecklistApi();
    const body = {
      operationId: id,
      kind: "initial",
      reason: "Physical inventory checked",
      ...view.guard,
      expectedCensusVersion: 1,
      phones: [{ label: "Pump handset", attendantIds: [id, id] }],
    };
    expect(() => api.freeze(id, "census", body)).toThrow();
  });
  it("decision request has no campaign guard and cannot silently accept extra fields", () => {
    expect(() =>
      new AdminChecklistApi().freeze(
        id,
        "decision",
        {
          operationId: id,
          decision: "approve",
          reason: "Evidence independently checked",
          ...view.guard,
        },
        other,
      ),
    ).toThrow();
  });
});

it("refuses a validly shaped manager receipt for a different campaign generation", async () => {
  const campaign = {
    id,
    name: "Fictional campaign",
    version: 9,
    settingsVersionId: id,
    dataVersion: "3",
    latestSnapshotId: null,
    reconciliationRequired: true,
    reconciledDataVersion: null,
    timing: {
      launchAt: "2026-11-01T00:00:00Z",
      purchaseStart: "2026-11-02T00:00:00Z",
      purchaseCutoff: "2026-11-03T00:00:00Z",
      graceHours: 0,
      uploadDeadline: "2026-11-03T00:00:00Z",
      timezone: "Africa/Lagos",
      policyVersion: "timing-v1",
    },
  };
  const transport = vi
    .fn()
    .mockResolvedValue({ campaign, auditEventId: other });
  const api = new AdminChecklistApi(transport as typeof adminRequest);
  const frozen = api.freeze(id, "manager", {
    operationId: id,
    expectedVersion: 2,
    managerAdminId: other,
    reason: "Fictional designation review",
  });
  await expect(api.send(frozen)).rejects.toMatchObject({
    code: "invalid_response",
  });
});
