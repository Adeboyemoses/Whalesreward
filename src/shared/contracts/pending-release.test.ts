import { describe, expect, it } from "vitest";
import {
  pendingReleaseFilterSchema,
  pendingReleaseSummarySchema,
} from "./pending-release";
import {
  attendantSaleRowSchema,
  saleRowSchema,
  saleFilterSchema,
} from "./sales";

const summary = {
  proposalId: "0199a000-0000-7000-8000-000000000001",
  proposalVersion: 1,
  kind: "capture",
  outcome: "confirm",
  state: "pending",
  proposedBy: {
    id: "0199a000-0000-7000-8000-000000000002",
    code: "ADMIN001",
    name: "Ada Williams",
  },
  proposedAt: "2026-11-16T10:00:00.000123Z",
};

describe("T-20 strict pending discovery contracts", () => {
  it("RD-05 allows only safe immutable pending summary fields and actor snapshot", () => {
    expect(pendingReleaseSummarySchema.parse(summary)).toEqual(summary);
    for (const field of [
      "reason",
      "facts",
      "sheetAssetId",
      "personId",
      "digest",
      "url",
    ])
      expect(
        pendingReleaseSummarySchema.safeParse({
          ...summary,
          [field]: "private",
        }).success,
      ).toBe(false);
    expect(
      pendingReleaseSummarySchema.safeParse({
        ...summary,
        proposedBy: { ...summary.proposedBy, personId: "private" },
      }).success,
    ).toBe(false);
  });
  it("RD-05 keeps pendingRelease required only on admin sale projections", () => {
    expect("pendingRelease" in saleRowSchema.shape).toBe(true);
    expect(
      saleRowSchema.shape.pendingRelease.safeParse(undefined).success,
    ).toBe(false);
    expect(saleRowSchema.shape.pendingRelease.safeParse(null).success).toBe(
      true,
    );
    expect("pendingRelease" in attendantSaleRowSchema.shape).toBe(false);
  });
  it("RD-04 accepts pending status and bounded strict station filters", () => {
    expect(saleFilterSchema.parse({ status: "pending_release" }).status).toBe(
      "pending_release",
    );
    expect(pendingReleaseFilterSchema.parse({}).limit).toBe(25);
    expect(pendingReleaseFilterSchema.parse({ limit: "100" }).limit).toBe(100);
    for (const value of [
      { limit: 101 },
      { limit: 0 },
      { limit: 1.5 },
      { kind: "all" },
      { day: "2026-11-16" },
      { cursor: "x".repeat(4097) },
    ])
      expect(pendingReleaseFilterSchema.safeParse(value).success).toBe(false);
  });
});
