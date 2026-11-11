import { describe, expect, it } from "vitest";
import {
  correctionPreview,
  inputFromValues,
  salesMessage,
  saleStatusLabel,
} from "./sales-display";
import type { SaleValues } from "@/shared/contracts/sales";
const values: SaleValues = {
  amountKobo: "1234567",
  quantity: "12.346",
  currency: "NGN",
  unit: "litre",
  basis: "amount",
  enteredAmountKobo: "1234567",
  enteredQuantity: null,
  rateKobo: "100000",
  priceVersionId: "018f0000-0000-7000-8000-000000000001",
  quantityPrecision: 3,
  medium: "vehicle",
  calculation: "captured_rate",
  verifiedSaleDate: null,
};
describe("P-22 correction presentation", () => {
  it("preserves entered kobo instead of reconstructing it from rounded quantity", () => {
    expect(inputFromValues(values)).toBe("12345.67");
    expect(correctionPreview(values, "12345.68")).toEqual({
      amountKobo: "1234568",
      quantity: "12.346",
      changed: true,
    });
  });
  it("uses captured precision and rounds quantity mode once", () => {
    const gas = {
      ...values,
      basis: "quantity" as const,
      unit: "kilogram" as const,
      enteredQuantity: "1.001",
      enteredAmountKobo: null,
      quantity: "1.001",
      rateKobo: "1005",
      amountKobo: "1006",
    };
    expect(correctionPreview(gas, "1.003")).toEqual({
      amountKobo: "1008",
      quantity: "1.003",
      changed: true,
    });
    expect(() => correctionPreview(gas, "1.0001")).toThrow();
  });
  it("does not allow zero or meter-evidence ordinary correction", () => {
    expect(() => correctionPreview(values, "0")).toThrow();
    expect(() =>
      correctionPreview({ ...values, calculation: "meter_evidence" }, "15000"),
    ).toThrow();
  });
  it("does not report a proposal as credited", () => {
    expect(saleStatusLabel({ credited: false, state: "photo_pending" })).toBe(
      "Incomplete upload",
    );
    expect(saleStatusLabel({ credited: true, state: "credited" }, true)).toBe(
      "Synced",
    );
  });
  it("explains stale and pending proposals without promising a retry will overwrite them", () => {
    expect(salesMessage({ code: "base_revision_changed" })).toContain("review");
    expect(salesMessage({ code: "correction_pending" })).toContain("already");
  });
});
