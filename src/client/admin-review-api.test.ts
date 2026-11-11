import { describe, expect, it, vi } from "vitest";
import {
  AdminReviewApi,
  reviewReferences,
  reviewUncertain,
} from "./admin-review-api";
import { AdminError, type adminRequest } from "./admin-api";
import type { AdminSaleDetail } from "./admin-sales-api";
const id = (n: number) =>
  `018f0000-0000-7000-8000-${String(n).padStart(12, "0")}`;
function sale(): AdminSaleDetail {
  return {
    id: id(1),
    saleCode: "S001",
    version: 7,
    currentRevisionId: id(2),
    original: { priceVersionId: id(3) },
    evidence: { state: "validated", assetId: id(4) },
    holds: [
      { id: id(5), kind: "price", state: "open", version: 3 },
      { id: id(6), kind: "card", state: "open", version: 4 },
      { id: id(7), kind: "date", state: "open", version: 5 },
    ],
    policyBlocks: [
      "capture_authorization_unresolved",
      "capture_time_unresolved",
    ],
    duplicateFlags: [
      { id: id(8), version: 2, state: "open", purchaseIds: [id(1), id(9)] },
    ],
    replacement: null,
  } as AdminSaleDetail;
}
describe("guarded admin review decisions", () => {
  it("uses latest sale and hold guards, exact evidence asset, and permits no optional references", () => {
    const a = sale(),
      api = new AdminReviewApi();
    const request = api.prepare(
      a,
      "price",
      "accept_captured",
      " Reason ",
      " Explanation ",
      [],
    );
    expect(request.body).toMatchObject({
      expectedVersion: 7,
      expectedRevisionId: id(2),
      expectedHoldVersion: 3,
      reason: "Reason",
      evidence: { assetId: id(4), notes: "Explanation", referenceIds: [] },
      decision: { outcome: "accept_captured" },
    });
    expect(request.path).toBe(`sales/${id(1)}/holds/${id(5)}/price-decision`);
    a.version = 8;
    a.holds[0]!.version = 4;
    expect(
      api.prepare(a, "price", "accept_captured", "Reason", "Explanation", [])
        .body,
    ).toMatchObject({ expectedVersion: 8, expectedHoldVersion: 4 });
    expect(request.body.expectedVersion).toBe(7);
  });
  it("never prepares unavailable meter correction or price cancellation", () => {
    const api = new AdminReviewApi();
    for (const choice of ["cancel", "correct_meter"] as const)
      expect(() =>
        api.prepare(
          sale(),
          "price",
          choice as "cancel",
          "Reason",
          "Explanation",
          [],
        ),
      ).toThrow();
  });
  it("admits only server-offered reference IDs and a validated same-sale photo", () => {
    const a = sale(),
      api = new AdminReviewApi();
    expect(reviewReferences(a).map((r) => r.id)).toEqual([id(1), id(4), id(3)]);
    expect(() =>
      api.prepare(a, "card", "confirm_earlier", "Reason", "Explanation", [
        id(99),
      ]),
    ).toThrow();
    a.evidence.state = "deleted";
    expect(() =>
      api.prepare(a, "card", "confirm_earlier", "Reason", "Explanation", []),
    ).toThrow();
  });
  it("freezes both duplicate guards and the explicitly named cancellation member", () => {
    const a = sale(),
      b = {
        ...sale(),
        id: id(9),
        saleCode: "S009",
        version: 11,
        currentRevisionId: null,
      },
      api = new AdminReviewApi();
    const r = api.prepareDuplicate(
      a,
      b,
      id(8),
      b.id,
      "Separate copy of same purchase",
    );
    expect(r.body).toMatchObject({
      expectedFlagVersion: 2,
      purchases: [
        { id: a.id, expectedVersion: 7, expectedRevisionId: id(2) },
        { id: b.id, expectedVersion: 11, expectedRevisionId: null },
      ],
      decision: { outcome: "cancel", cancelPurchaseId: b.id },
    });
    expect(() => api.prepareDuplicate(a, b, id(8), id(99), "Reason")).toThrow();
    expect(
      api.prepareDuplicate(a, b, id(8), null, "Repeat purchase").body.decision,
    ).toEqual({ outcome: "keep_both" });
  });
  it("refuses every new duplicate outcome when either latest-read member is cancelled", () => {
    for (const cancelled of ["first", "second"] as const) {
      const a = sale(),
        b = { ...sale(), id: id(9), saleCode: "S009" };
      (cancelled === "first" ? a : b).state = "cancelled";
      const api = new AdminReviewApi();
      for (const target of [null, a.id, b.id]) {
        expect(() =>
          api.prepareDuplicate(a, b, id(8), target, "Reason"),
        ).toThrowError(
          expect.objectContaining({ code: "sale_not_cancellable" }),
        );
      }
    }
  });
  it("preserves a frozen duplicate retry after a member becomes cancelled", async () => {
    const transport = vi.fn(async () => {
      throw new AdminError("network");
    });
    const api = new AdminReviewApi(transport as typeof adminRequest);
    const a = sale(),
      b = { ...sale(), id: id(9), saleCode: "S009" };
    const frozen = api.prepareDuplicate(
      a,
      b,
      id(8),
      b.id,
      "Duplicate purchase",
    );
    await expect(api.submit(frozen)).rejects.toMatchObject({ code: "network" });
    b.state = "cancelled";
    await expect(api.submit(frozen)).rejects.toMatchObject({ code: "network" });
    expect(transport.mock.calls[0]).toEqual(transport.mock.calls[1]);
  });
  it("capture covers all open capture blocks with aggregate guard and no invented hold", () => {
    const api = new AdminReviewApi(),
      a = sale();
    const r = api.prepare(a, "capture", "confirm", "Reason", "Explanation", []);
    expect(r.body).toMatchObject({
      expectedVersion: 7,
      expectedRevisionId: id(2),
      outcome: "confirm",
    });
    expect(r.body).not.toHaveProperty("expectedHoldVersion");
    expect(r.path).toBe(`sales/${a.id}/capture-decision`);
    a.policyBlocks = [];
    expect(() =>
      api.prepare(a, "capture", "confirm", "Reason", "Explanation", []),
    ).toThrow();
  });
  it("retries uncertain delivery using the same operation, route and immutable body", async () => {
    const transport = vi.fn(async () => {
        throw new AdminError("network");
      }),
      api = new AdminReviewApi(transport as typeof adminRequest);
    const a = sale(),
      r = api.prepare(
        a,
        "date",
        "verify_date",
        "Reason",
        "Explanation",
        [],
        "2026-11-11",
      );
    await expect(api.submit(r)).rejects.toMatchObject({ code: "network" });
    a.version++;
    a.currentRevisionId = null;
    await expect(api.submit(r)).rejects.toMatchObject({ code: "network" });
    expect(transport.mock.calls[0]).toEqual(transport.mock.calls[1]);
    expect(transport).toHaveBeenLastCalledWith(
      r.path,
      r.body,
      "POST",
      r.body.operationId,
    );
  });
  it("malformed success and unreadable non-OK response keep uncertainty, definitive conflicts require reread", async () => {
    const api = new AdminReviewApi(
      vi.fn(async () => ({ credited: true })) as typeof adminRequest,
    );
    await expect(
      api.submit(
        api.prepare(
          sale(),
          "price",
          "accept_captured",
          "Reason",
          "Explanation",
          [],
        ),
      ),
    ).rejects.toMatchObject({ code: "invalid_response" });
    for (const error of [
      new AdminError("invalid_response", 200),
      new AdminError("unavailable", 400),
      new Error("decoder"),
      null,
      new AdminError("network"),
    ])
      expect(reviewUncertain(error)).toBe(true);
    for (const code of [
      "version_conflict",
      "review_closed",
      "operation_conflict",
    ])
      expect(reviewUncertain(new AdminError(code, 409))).toBe(false);
  });
});
