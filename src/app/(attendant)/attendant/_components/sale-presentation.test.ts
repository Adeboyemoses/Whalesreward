import { describe, expect, it } from "vitest";
import type { OutboxRow, SaleStatus } from "@/client/types";
import { salePresentation, uploadSummary } from "./sale-presentation";
const status: SaleStatus = {
  purchaseId: "019a4890-0000-7000-8000-000000000001",
  operationId: "019a4890-0000-7000-8000-000000000002",
  saleCode: "S009",
  version: 1,
  state: "credited",
  detailsReceived: true,
  photoValidated: true,
  credited: true,
  currentRevisionId: "019a4890-0000-7000-8000-000000000003",
  customer: {
    id: "019a4890-0000-7000-8000-000000000004",
    name: "Amina Bello",
    category: "car_owner",
  },
  holds: [],
  cancellationReason: null,
  pendingReason: null,
  serverReceivedAt: "2026-11-05T10:00:00Z",
};
const row = (
  serverStatus: SaleStatus | null,
  state: OutboxRow["state"] = "saved",
) =>
  ({
    operationId: status.operationId,
    purchaseId: status.purchaseId,
    state,
    serverStatus,
    lastErrorCode: null,
  }) as OutboxRow;
describe("sale presentation authority", () => {
  it("does not show Synced from a local credited flag", () => {
    expect(salePresentation(row(null, "credited")).title).not.toBe(
      "Sale synced",
    );
  });
  it("shows server-confirmed customer credit only with complete evidence", () => {
    expect(salePresentation(row(status)).description).toContain(
      "Amina Bello's loyalty total",
    );
    expect(
      salePresentation(row({ ...status, photoValidated: false })).title,
    ).not.toBe("Sale synced");
  });
  it("keeps all mixed holds visible without credit", () => {
    const result = salePresentation(
      row({
        ...status,
        state: "held",
        credited: false,
        currentRevisionId: null,
        holds: [
          { kind: "price", reasonCode: "price_uncertain" },
          { kind: "card", reasonCode: "replaced_card" },
          { kind: "date", reasonCode: "capture_date_uncertain" },
        ],
      }),
    );
    expect(result.title).toBe("Awaiting price review");
    expect(result.holds).toEqual([
      "Price review",
      "Card eligibility review",
      "Sale date review",
    ]);
  });
  it("does not turn unresolved customer into cancellation", () => {
    expect(
      salePresentation(
        row({
          ...status,
          state: "received",
          credited: false,
          photoValidated: false,
          currentRevisionId: null,
          customer: null,
          pendingReason: "lookup_pending",
        }),
      ).label,
    ).toBe("Uploading");
  });
  it("does not claim a cancelled missing photo was uploaded", () => {
    const cancelled = row({
      ...status,
      state: "cancelled",
      credited: false,
      photoValidated: false,
      currentRevisionId: null,
      cancellationReason: "customer_not_found",
    });
    expect(uploadSummary([cancelled]).completePhotos).toBe(false);
    expect(salePresentation(cancelled).description).toContain("No customer");
  });
});
