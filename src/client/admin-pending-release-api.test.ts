import { describe, expect, it, vi } from "vitest";
import {
  AdminPendingReleaseApi,
  releaseProposalHref,
  releaseReviewAllowed,
} from "./admin-pending-release-api";
import type { adminRequest } from "./admin-api";
const id = "018f0000-0000-7000-8000-000000000001";
const row = {
  proposalId: id,
  proposalVersion: 2,
  kind: "capture",
  outcome: "confirm",
  state: "pending",
  proposedBy: { id, code: "ADMIN1", name: "Ada Williams" },
  proposedAt: "2026-11-16T10:00:00.000Z",
  purchaseId: id,
  saleCode: "SALE1",
};
describe("T-20 complete pending release discovery", () => {
  it("requests the server queue without retained sale/customer/day filters and preserves opaque seek cursor", async () => {
    const transport = vi.fn(async () => ({
      items: [row],
      nextCursor: "next/page",
      asOf: row.proposedAt,
      summary: { pending: "122" },
    }));
    const api = new AdminPendingReleaseApi(transport as typeof adminRequest);
    const page = await api.pending({ cursor: "opaque/page", limit: 25 });
    expect(transport).toHaveBeenCalledWith(
      "release-proposals/pending?cursor=opaque%2Fpage&limit=25",
    );
    expect(page.summary.pending).toBe("122");
    expect(page.items).toHaveLength(1);
  });
  it("rejects malformed success and never substitutes empty for unavailable", async () => {
    const api = new AdminPendingReleaseApi(
      vi.fn(async () => ({
        items: [],
        nextCursor: null,
        summary: { pending: "0" },
      })) as typeof adminRequest,
    );
    await expect(api.pending({})).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
  it("rejects queue rows carrying sheet facts or URLs", async () => {
    const api = new AdminPendingReleaseApi(
      vi.fn(async () => ({
        items: [{ ...row, sheetAssetId: id }],
        nextCursor: null,
        asOf: row.proposedAt,
        summary: { pending: "1" },
      })) as typeof adminRequest,
    );
    await expect(api.pending({})).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
  it("keeps existing safe return context and identifies the protected proposal destination", () => {
    expect(
      releaseProposalHref(
        id,
        { kind: "capture", proposalId: id },
        "?customer=" + id,
      ),
    ).toBe(`/admin/sales/${id}/capture-review?customer=${id}&proposal=${id}`);
  });
  it("requires sales and the selected live kind grant without treating Owner as a bypass", () => {
    expect(releaseReviewAllowed(["sales"], "price")).toBe(false);
    expect(releaseReviewAllowed(["priceReview"], "price")).toBe(false);
    expect(releaseReviewAllowed(["sales", "dateReview"], "capture")).toBe(true);
    expect(releaseReviewAllowed(["sales", "dateReview"], "card")).toBe(false);
  });
});
